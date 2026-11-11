import express, { type Request, type Response } from 'express';
import {
  decodeAndVerifyToken,
  getVerifiedSessionClaims,
  resolveSafeOrigin,
  setSessionCookie,
} from '../securityUtils.ts';
import {
  broadcastWorkoutToTeamSquad,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  isResendConfigured,
  listTeamsForUser,
  previewTeamJoinInvite,
  requestEmailOtpCode,
  resendPendingTeamInvites,
  syncAthleteSnapshotAcrossTeams,
  updateTeamBranding,
  verifyEmailOtpCode,
} from '../teamService.ts';

export const teamRouter = express.Router();

function resolveRequestOrigin(req: Request): string {
  const explicit = resolveSafeOrigin(
    String(req.body?.origin || req.query?.origin || '')
  );
  if (explicit) return explicit;

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const proto =
    forwardedProto === 'https' || req.secure ? 'https' : 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (host) {
    const candidate = resolveSafeOrigin(`${proto}://${host}`);
    if (candidate) return candidate;
  }
  return 'https://thresh.app';
}

function ensureSessionSid(
  req: Request,
  res: Response,
  subjectHint = 'thresh-athlete'
): { sid: string; sessionToken?: string } {
  const existing = getVerifiedSessionClaims(req);
  if (existing?.sid) {
    return { sid: existing.sid };
  }
  const sessionToken = setSessionCookie(req, res, subjectHint);
  const decoded = decodeAndVerifyToken(sessionToken);
  return {
    sid: decoded?.sid || '000000000000000000000000',
    sessionToken,
  };
}

// 1. Send 6-Digit Cross-Device Email OTP via Resend
teamRouter.post('/api/auth/email/send-otp', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim();
    const result = await requestEmailOtpCode(email);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error || 'Unable to send OTP.' });
      return;
    }
    res.json({
      ok: true,
      deliveryStatus: result.deliveryStatus,
      resendConfigured: isResendConfigured(),
      ...(result.devPreviewCode ? { devPreviewCode: result.devPreviewCode } : {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send verification code.',
    });
  }
});

// 2. Verify 6-Digit Email OTP & Bind Persistent Cross-Device Session
teamRouter.post('/api/auth/email/verify-otp', async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim();
    const code = String(req.body?.code || '').trim();
    const currentClaims = getVerifiedSessionClaims(req);
    const result = await verifyEmailOtpCode(email, code, currentClaims?.sid);
    if (!result.ok || !result.sid) {
      res.status(400).json({ ok: false, error: result.error || 'Invalid code.' });
      return;
    }

    const sessionToken = setSessionCookie(
      req,
      res,
      result.displayName || result.email || 'thresh-athlete',
      result.sid
    );
    const originUrl = resolveRequestOrigin(req);
    const teams = await listTeamsForUser(result.sid, originUrl);

    res.json({
      ok: true,
      sessionToken,
      email: result.email,
      displayName: result.displayName,
      teams,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Verification failed.',
    });
  }
});

// 3. List All Teams for Active Session (Multi-Team Switcher)
teamRouter.get('/api/teams/mine', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.json({
        ok: true,
        resendConfigured: isResendConfigured(),
        teams: [],
      });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      resendConfigured: isResendConfigured(),
      teams,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to load teams.',
    });
  }
});

// 4. Create New School / Club / Coaching Team
teamRouter.post('/api/teams', async (req: Request, res: Response) => {
  try {
    const { sid, sessionToken } = ensureSessionSid(
      req,
      res,
      String(req.body?.coachDisplayName || 'thresh-coach')
    );
    const originUrl = resolveRequestOrigin(req);
    const team = await createTeamForCoach({
      callerSid: sid,
      originUrl,
      name: String(req.body?.name || ''),
      shortName: req.body?.shortName ? String(req.body.shortName) : undefined,
      mascotOrMotto: req.body?.mascotOrMotto ? String(req.body.mascotOrMotto) : undefined,
      orgType: req.body?.orgType || 'HIGH_SCHOOL',
      primarySport: req.body?.primarySport,
      primaryHex: req.body?.primaryHex,
      secondaryHex: req.body?.secondaryHex,
      logoDataUrl: req.body?.logoDataUrl,
      defaultSafeSportShield: req.body?.defaultSafeSportShield,
      enableParentGuardianCc: req.body?.enableParentGuardianCc,
      coachDisplayName: req.body?.coachDisplayName,
      coachEmail: req.body?.coachEmail,
    });
    res.json({
      ok: true,
      ...(sessionToken ? { sessionToken } : {}),
      resendConfigured: isResendConfigured(),
      team,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create team.',
    });
  }
});

// 5. Update Team Branding, Colors, Crest & Safeguarding Settings
teamRouter.put('/api/teams/:teamId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await updateTeamBranding({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      updates: req.body || {},
    });
    if (!updated) {
      res.status(403).json({
        ok: false,
        error: 'Only team coaches can modify team branding and safeguarding settings.',
      });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update team.',
    });
  }
});

// 6. Bulk Roster Invite Import + Resend Branded Email Dispatch
teamRouter.post('/api/teams/:teamId/invites/bulk', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await bulkCreateAndSendInvites({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      rawCsvOrText: req.body?.rawCsvOrText,
      rows: Array.isArray(req.body?.rows) ? req.body.rows : undefined,
      sendEmailsNow: req.body?.sendEmailsNow !== false,
    });
    if (!result.summary) {
      res.status(403).json({
        ok: false,
        error: 'Coach permissions required to invite athletes to this team.',
      });
      return;
    }
    res.json({
      ok: true,
      team: result.summary,
      addedCount: result.addedCount,
      emailedCount: result.emailedCount,
      manualLinkCount: result.manualLinkCount,
      resendConfigured: result.resendConfigured,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to process bulk invites.',
    });
  }
});

// 7. Resend / Nudge Pending Invites via Resend
teamRouter.post('/api/teams/:teamId/invites/resend', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await resendPendingTeamInvites({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      membershipId: req.body?.membershipId ? String(req.body.membershipId) : 'ALL_PENDING',
    });
    if (!result.summary) {
      res.status(403).json({ ok: false, error: 'Coach permissions required.' });
      return;
    }
    res.json({
      ok: true,
      team: result.summary,
      emailedCount: result.emailedCount,
      resendConfigured: result.resendConfigured,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to resend invites.',
    });
  }
});

// 8. Public Preview for Magic Join URL (`/join/<slug>?t=<token>`) or Join Code
teamRouter.get('/api/teams/join-preview', async (req: Request, res: Response) => {
  try {
    const codeOrSlug = String(req.query.codeOrSlug || '').trim();
    const token = req.query.t ? String(req.query.t).trim() : undefined;
    const preview = await previewTeamJoinInvite(codeOrSlug, token);
    res.json(preview);
  } catch (err) {
    res.status(400).json({
      found: false,
      error: err instanceof Error ? err.message : 'Failed to preview invite.',
    });
  }
});

// 9. Claim Team Membership & Auto-Calibrate Baseline
teamRouter.post('/api/teams/join-claim', async (req: Request, res: Response) => {
  try {
    const athleteName = String(req.body?.athleteName || '').trim();
    const { sid, sessionToken } = ensureSessionSid(
      req,
      res,
      athleteName || 'thresh-athlete'
    );
    const originUrl = resolveRequestOrigin(req);
    const claimed = await claimTeamJoinInvite({
      callerSid: sid,
      originUrl,
      codeOrSlug: String(req.body?.codeOrSlug || '').trim(),
      inviteToken: req.body?.inviteToken ? String(req.body.inviteToken).trim() : undefined,
      athleteName: athleteName || undefined,
      athleteEmail: req.body?.athleteEmail ? String(req.body.athleteEmail) : undefined,
      squadGroup: req.body?.squadGroup ? String(req.body.squadGroup) : undefined,
      seedMarkOrFtp: req.body?.seedMarkOrFtp ? String(req.body.seedMarkOrFtp) : undefined,
    });

    if (!claimed.ok || !claimed.summary) {
      res.status(404).json({
        ok: false,
        error: claimed.error || 'Team invite could not be claimed.',
      });
      return;
    }

    const teams = await listTeamsForUser(sid, originUrl);
    res.json({
      ok: true,
      ...(sessionToken ? { sessionToken } : {}),
      team: claimed.summary,
      teams,
      calibrated: claimed.calibrated,
      safeSportShieldEnforced: claimed.safeSportShieldEnforced,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to join team.',
    });
  }
});

// 10. Sync Athlete Clean-Room Readiness Snapshot Across Joined Teams
teamRouter.post('/api/teams/sync-snapshot', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.json({ ok: true, teams: [] });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const teams = await syncAthleteSnapshotAcrossTeams({
      callerSid: claims.sid,
      originUrl,
      athleteName: req.body?.athleteName ? String(req.body.athleteName) : undefined,
      snapshot: req.body?.snapshot || {},
    });
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to sync team snapshot.',
    });
  }
});

// 11. Broadcast Structured Workout to Whole Team or Specific Squad Pod
teamRouter.post('/api/teams/:teamId/workouts/broadcast', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await broadcastWorkoutToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || 'ALL'),
      date: String(req.body?.date || ''),
      name: String(req.body?.name || ''),
      sportCategory: req.body?.sportCategory || 'Running',
      plannedDurationSecs: Number(req.body?.plannedDurationSecs || 3600),
      plannedLoad: Number(req.body?.plannedLoad || 65),
      workoutSyntax: String(req.body?.workoutSyntax || ''),
      description: String(req.body?.description || ''),
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions required.' });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to broadcast workout.',
    });
  }
});
