import express, { type Request, type Response } from 'express';
import {
  decodeAndVerifyToken,
  getVerifiedSessionClaims,
  resolveSafeOrigin,
  setSessionCookie,
} from '../securityUtils.ts';
import { getUserById } from '../authService.ts';
import {
  acknowledgeParentConsent,
  autoLinkPendingTeamInvitesByEmail,
  broadcastWorkoutBatchToTeamSquad,
  broadcastWorkoutToTeamSquad,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  deleteBroadcastPlanBlockFromTeam,
  isResendConfigured,
  listTeamsForUser,
  previewTeamJoinInvite,
  recordCoachStopwatchActivities,
  requestEmailOtpCode,
  resendPendingTeamInvites,
  syncAthleteSnapshotAcrossTeams,
  updateTeamBranding,
  updateTeamMemberEventGroup,
  verifyEmailOtpCode,
} from '../teamService.ts';
import type { CoachEventGroup } from '../../src/types.ts';

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
teamRouter.get(['/api/teams/mine', '/api/teams'], async (req: Request, res: Response) => {
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

    // Auto-link pending team invites if session belongs to verified user with email
    if (claims.sub?.startsWith('usr_')) {
      const u = await getUserById(claims.sub);
      if (u?.email) {
        await autoLinkPendingTeamInvitesByEmail({
          email: u.email,
          userSid: claims.sid,
          athleteName: u.name,
        });
      }
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
    let email = req.query.email ? String(req.query.email).trim().toLowerCase() : undefined;
    if (!email) {
      const claims = getVerifiedSessionClaims(req);
      if (claims?.sub?.startsWith('usr_')) {
        const u = await getUserById(claims.sub);
        if (u?.email) email = u.email;
      }
    }
    const preview = await previewTeamJoinInvite(codeOrSlug, token, email);
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
    const rawUnit = String(req.body?.distanceUnit || '').toLowerCase();
    const distanceUnit: 'mi' | 'km' = rawUnit === 'km' ? 'km' : 'mi';
    const rawTier = String(req.body?.sharingTier || '').toUpperCase();
    const sharingTier =
      rawTier === 'FULL_STREAMS' || rawTier === 'LOAD_ONLY'
        ? rawTier
        : 'SUMMARY_ONLY';

    let athleteEmail = req.body?.athleteEmail ? String(req.body.athleteEmail).trim().toLowerCase() : undefined;
    if (!athleteEmail) {
      const claims = getVerifiedSessionClaims(req);
      if (claims?.sub?.startsWith('usr_')) {
        const u = await getUserById(claims.sub);
        if (u?.email) athleteEmail = u.email;
      }
    }

    const claimed = await claimTeamJoinInvite({
      callerSid: sid,
      originUrl,
      codeOrSlug: String(req.body?.codeOrSlug || '').trim(),
      inviteToken: req.body?.inviteToken ? String(req.body.inviteToken).trim() : undefined,
      athleteName: athleteName || undefined,
      athleteEmail,
      stravaAthleteId: req.body?.stravaAthleteId
        ? String(req.body.stravaAthleteId).trim()
        : undefined,
      squadGroup: req.body?.squadGroup ? String(req.body.squadGroup) : undefined,
      seedMarkOrFtp: req.body?.seedMarkOrFtp ? String(req.body.seedMarkOrFtp) : undefined,
      distanceUnit,
      sharingTier,
      birthYear:
        typeof req.body?.birthYear === 'number'
          ? req.body.birthYear
          : req.body?.birthYear
            ? Number(req.body.birthYear)
            : undefined,
      parentGuardianEmail: req.body?.parentGuardianEmail
        ? String(req.body.parentGuardianEmail).trim()
        : undefined,
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

// 11. Broadcast Structured Workout to Whole Team, Squad Pod, or Specific Athletes
teamRouter.post('/api/teams/:teamId/workouts/broadcast', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds)
      ? req.body.targetMembershipIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    const targetEventGroups = Array.isArray(req.body?.targetEventGroups)
      ? req.body.targetEventGroups.filter(
          (g: unknown): g is CoachEventGroup =>
            g === 'SPRINTS' || g === 'MID_DISTANCE' || g === 'DISTANCE'
        )
      : undefined;
    const updated = await broadcastWorkoutToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || 'ALL'),
      targetEventGroups,
      targetMembershipIds,
      date: String(req.body?.date || ''),
      name: String(req.body?.name || ''),
      sportCategory: req.body?.sportCategory || 'Running',
      plannedDurationSecs: Number(req.body?.plannedDurationSecs || 3600),
      plannedLoad: Number(req.body?.plannedLoad || 65),
      workoutSyntax: String(req.body?.workoutSyntax || ''),
      description: String(req.body?.description || ''),
      trackSpec: req.body?.trackSpec,
      athleteOverrides: req.body?.athleteOverrides,
      replaceSameDateTarget:
        typeof req.body?.replaceSameDateTarget === 'boolean'
          ? req.body.replaceSameDateTarget
          : true,
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

// 11d. Batch-Broadcast Rolling or Full-Block Training Plans to Team or Event-Group Cohorts
teamRouter.post('/api/teams/:teamId/workouts/broadcast-batch', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds)
      ? req.body.targetMembershipIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    const targetEventGroups = Array.isArray(req.body?.targetEventGroups)
      ? req.body.targetEventGroups.filter(
          (g: unknown): g is CoachEventGroup =>
            g === 'SPRINTS' || g === 'MID_DISTANCE' || g === 'DISTANCE'
        )
      : undefined;
    const workouts = Array.isArray(req.body?.workouts) ? req.body.workouts : [];
    const updated = await broadcastWorkoutBatchToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || 'ALL'),
      targetEventGroups,
      targetMembershipIds,
      publishMode: req.body?.publishMode,
      planBlockId: req.body?.planBlockId ? String(req.body.planBlockId) : undefined,
      planBlockName: req.body?.planBlockName ? String(req.body.planBlockName) : undefined,
      replaceExistingCohortRange:
        typeof req.body?.replaceExistingCohortRange === 'boolean'
          ? req.body.replaceExistingCohortRange
          : true,
      workouts,
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions required.' });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams, publishedCount: Math.min(160, workouts.length) });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to batch-broadcast training plan.',
    });
  }
});

// 11e. Recall / Delete Broadcast Training Block from Team Calendar
teamRouter.delete('/api/teams/:teamId/workouts/blocks/:blockId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await deleteBroadcastPlanBlockFromTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      blockId: String(req.params.blockId || ''),
      originUrl,
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions required.' });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to recall team training block.',
    });
  }
});

// 11c. Update Roster Member Event Group ('SPRINTS' | 'MID_DISTANCE' | 'DISTANCE' | null)
teamRouter.patch('/api/teams/:teamId/members/:membershipId/event-group', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const rawGroup = req.body?.eventGroup;
    const eventGroup: CoachEventGroup | null =
      rawGroup === 'SPRINTS' || rawGroup === 'MID_DISTANCE' || rawGroup === 'DISTANCE'
        ? rawGroup
        : null;
    const originUrl = resolveRequestOrigin(req);
    const updated = await updateTeamMemberEventGroup({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      membershipId: String(req.params.membershipId || ''),
      originUrl,
      eventGroup,
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions or roster member not found.' });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update athlete event group.',
    });
  }
});

// 11b. Record Coach Trackside Stopwatch Activities onto Team Athlete Profiles
teamRouter.post('/api/teams/:teamId/stopwatch-activities', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const originUrl = resolveRequestOrigin(req);
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

// 12. Parent/Guardian Consent Acknowledgment (COPPA & Safe Sport Youth Safeguards)
teamRouter.get('/api/teams/parent-consent', async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || req.query.t || '').trim();
    const result = await acknowledgeParentConsent(token);
    if (!result.ok) {
      res.status(400).send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Parent Acknowledgment Error · THRESH</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px 16px;max-width:480px;margin:0 auto;text-align:center;color:#1F2937;">
  <h2 style="color:#DC2626;">Invalid or Expired Link</h2>
  <p>${result.error || 'This consent link could not be verified.'}</p>
  <a href="/" style="display:inline-block;margin-top:16px;color:#14532D;font-weight:700;">Return to THRESH</a>
</body>
</html>`);
      return;
    }

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Parent Acknowledgment Confirmed · THRESH</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F4F6F3;padding:40px 16px;margin:0;color:#111318;">
  <div style="max-width:500px;margin:0 auto;background:#FFFFFF;border-radius:18px;border:1px solid #E2E8F0;padding:32px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="width:48px;height:48px;border-radius:24px;background:#DCFCE7;color:#15803D;font-size:24px;line-height:48px;margin:0 auto 16px;">✓</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#15803D;text-transform:uppercase;">SAFEGUARDING ACKNOWLEDGED</div>
    <h2 style="margin:8px 0 12px;font-size:22px;color:#111318;">Enrollment Confirmed</h2>
    <p style="font-size:14px;color:#4B5563;line-height:1.6;margin:0 0 20px;">
      Thank you. Your parent acknowledgment for <strong>${result.athleteName || 'Athlete'}</strong> on <strong>${result.teamName || 'Team'}</strong> has been recorded.
    </p>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px;text-align:left;font-size:13px;color:#334155;margin-bottom:24px;">
      <div><strong>Team:</strong> ${result.teamName || ''}</div>
      <div><strong>Coach:</strong> ${result.coachName || ''}</div>
      <div><strong>Safeguards:</strong> Safe-Sport RED-S weight shield is active.</div>
    </div>
    <a href="/" style="display:inline-block;background:#14532D;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">Visit THRESH</a>
  </div>
</body>
</html>`);
  } catch {
    res.status(500).send('An error occurred while confirming consent.');
  }
});

teamRouter.post('/api/teams/parent-consent', async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token || req.query.token || '').trim();
    const result = await acknowledgeParentConsent(token);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({ ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed confirming consent.',
    });
  }
});
