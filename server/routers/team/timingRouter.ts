import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../../securityUtils.ts';
import {
  checkDistributedRateLimitAsync,
  getClientRateLimitIp,
  resetRateLimitsForTesting,
} from '../../rateLimiter.ts';
import {
  listTeamsForUser,
  recordCoachStopwatchActivities,
} from '../../teamService.ts';
import {
  createDelegatedTimingSession,
  getPublicDelegatedTimingPass,
  reviewDelegatedSplitSubmission,
  revokeDelegatedTimingSession,
  submitDelegatedSplits,
} from '../../teamTimingDelegationService.ts';

export const timingRouter = express.Router();

export function resetTimingDelegationRateLimitsForTesting(): void {
  resetRateLimitsForTesting('timing_');
}

// Public & Authenticated Delegated Race Timing Pass Lookup + Split Submission
timingRouter.get('/api/teams/public/timing-pass/:passCode', async (req: Request, res: Response) => {
  try {
    const passCode = String(req.params.passCode || '').trim().toUpperCase();
    const clientIp = getClientRateLimitIp(req);
    const lookupLimit = await checkDistributedRateLimitAsync(
      `timing_pass_get:${clientIp}:${passCode}`,
      40,
      60_000
    );
    if (!lookupLimit.allowed) {
      res.status(429).json({
        found: false,
        error: 'Too many timing pass lookups. Please wait a moment.',
        retryAfterSecs: lookupLimit.retryAfterSecs,
      });
      return;
    }

    const headerPin = req.headers['x-timing-pin'];
    const rawPin =
      typeof headerPin === 'string'
        ? headerPin.trim()
        : typeof req.query.pin === 'string'
          ? req.query.pin.trim()
          : undefined;
    if (rawPin) {
      const pinLimit = await checkDistributedRateLimitAsync(
        `timing_pin_try:${clientIp}:${passCode}`,
        8,
        10 * 60_000
      );
      if (!pinLimit.allowed) {
        res.status(429).json({
          found: true,
          pinRequired: true,
          pinVerified: false,
          error: 'Too many PIN attempts. Ask the coach for a fresh pass or try again shortly.',
          retryAfterSecs: pinLimit.retryAfterSecs,
        });
        return;
      }
    }

    const payload = await getPublicDelegatedTimingPass({ passCode, pin: rawPin });
    const { statusCode, ...body } = payload;
    res.status(statusCode).json(body);
  } catch (err) {
    res.status(500).json({
      found: false,
      error: err instanceof Error ? err.message : 'Failed to load timing pass.',
    });
  }
});

timingRouter.post(
  '/api/teams/public/timing-pass/:passCode/submissions',
  async (req: Request, res: Response) => {
    try {
      const passCode = String(req.params.passCode || '').trim().toUpperCase();
      const clientIp = getClientRateLimitIp(req);
      const subLimit = await checkDistributedRateLimitAsync(
        `timing_sub:${clientIp}:${passCode}`,
        20,
        60_000
      );
      if (!subLimit.allowed) {
        res.status(429).json({
          ok: false,
          error: 'Too many split submissions. Please wait a moment before retrying.',
          retryAfterSecs: subLimit.retryAfterSecs,
        });
        return;
      }

      const headerPin = req.headers['x-timing-pin'];
      const pin =
        typeof headerPin === 'string'
          ? headerPin.trim()
          : typeof req.body?.pin === 'string'
            ? req.body.pin.trim()
            : undefined;
      if (pin) {
        const pinLimit = await checkDistributedRateLimitAsync(
          `timing_pin_try:${clientIp}:${passCode}`,
          8,
          10 * 60_000
        );
        if (!pinLimit.allowed) {
          res.status(429).json({
            ok: false,
            error: 'Too many PIN attempts. Please wait a few minutes.',
            retryAfterSecs: pinLimit.retryAfterSecs,
          });
          return;
        }
      }

      const claims = getVerifiedSessionClaims(req);
      const callerSid =
        claims?.sid && isCanonicalAuthenticatedClaims(claims) ? claims.sid : undefined;
      const originUrl = resolveTrustedRequestOrigin(req);

      const outcome = await submitDelegatedSplits({
        passCode,
        pin,
        callerSid,
        clientSubmissionId: req.body?.clientSubmissionId,
        capturedByName: req.body?.capturedByName,
        gunStartEpochMs: req.body?.gunStartEpochMs,
        entries: req.body?.entries,
        originUrl,
      });
      if (!outcome.ok) {
        res.status(outcome.statusCode).json({
          ok: false,
          error: outcome.error || 'Failed to submit splits.',
        });
        return;
      }
      const teams = callerSid ? await listTeamsForUser(callerSid, originUrl) : undefined;
      res.status(outcome.statusCode).json({
        ok: true,
        deduplicated: Boolean(outcome.deduplicated),
        submission: outcome.submission,
        ...(outcome.team ? { team: outcome.team } : {}),
        ...(teams ? { teams } : {}),
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to submit splits.',
      });
    }
  }
);

// Record Coach Trackside Stopwatch Activities onto Team Athlete Profiles
timingRouter.post('/api/teams/:teamId/stopwatch-activities', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const originUrl = resolveTrustedRequestOrigin(req);
    const updated = await recordCoachStopwatchActivities({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      entries,
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions required.' });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save stopwatch activities.',
    });
  }
});

// Coach Delegated Timing Pass Creation, Revocation & Staging Queue Review
timingRouter.post('/api/teams/:teamId/timing-sessions', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as Record<string, unknown>;
    const outcome = await createDelegatedTimingSession({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      meetTitle: body.meetTitle,
      meetDate: body.meetDate,
      eventCode: body.eventCode,
      eventLabel: body.eventLabel,
      heatLabel: body.heatLabel,
      stationType: body.stationType,
      stationLabel: body.stationLabel,
      splitPlanLabel: body.splitPlanLabel,
      targetSplitMeters: body.targetSplitMeters,
      targetLapCount: body.targetLapCount,
      runners: body.runners,
      assignedMembershipId: body.assignedMembershipId,
      pin: body.pin,
      expiresAt: body.expiresAt,
    });
    if (!outcome.ok || !outcome.session) {
      res.status(outcome.statusCode || 400).json({
        ok: false,
        error: outcome.error || 'Failed to create delegated timing session.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      session: outcome.session,
      passUrl: outcome.passUrl,
      team: outcome.team,
      teams,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create delegated timing session.',
    });
  }
});

timingRouter.delete(
  '/api/teams/:teamId/timing-sessions/:sessionId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await revokeDelegatedTimingSession({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        sessionId: String(req.params.sessionId || ''),
        originUrl,
      });
      if (!outcome.ok) {
        res.status(outcome.statusCode || 400).json({
          ok: false,
          error: outcome.error || 'Failed to revoke timing session.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        team: outcome.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to revoke timing session.',
      });
    }
  }
);

timingRouter.post(
  '/api/teams/:teamId/timing-submissions/:submissionId/review',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await reviewDelegatedSplitSubmission({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        submissionId: String(req.params.submissionId || ''),
        action: req.body?.action,
        originUrl,
      });
      if (!outcome.ok) {
        res.status(outcome.statusCode || 400).json({
          ok: false,
          error: outcome.error || 'Failed to review delegated split submission.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        submission: outcome.submission,
        team: outcome.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to review delegated split submission.',
      });
    }
  }
);
