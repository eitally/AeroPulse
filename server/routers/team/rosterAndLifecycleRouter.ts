import express, { type Request, type Response } from 'express';
import {
  escapeHtml,
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../../securityUtils.ts';
import { getUserById, getUserByProvider } from '../../authService.ts';
import { getScopedRuntimeStore } from '../../sessionContext.ts';
import {
  inviteTeamCoachingStaff,
  updateAssistantCoachEventGroups,
  updateTeamPracticeVenues,
} from '../../teamFieldAndDailyOpsService.ts';
import {
  declineAndPurgeParentConsent,
  graduateTeamClass,
  issueOrResendParentConsentLink,
  leaveOrGraduateTeam,
  mergeDuplicateRosterMembers,
  previewParentConsentToken,
  revokeAthleteGuardianConsentForTeam,
  transferTeamHeadCoachOwnership,
  updateMemberRole,
  updateMemberRosterLifecycleStatus,
  updateMyTeamSharingTier,
} from '../../teamLifecycleService.ts';
import {
  acknowledgeParentConsent,
  autoLinkPendingTeamInvitesByEmail,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  getTeamGovernanceAuditLog,
  isResendConfigured,
  listTeamsForUser,
  previewTeamJoinInvite,
  recordGuardianSafetyAlert,
  resendPendingTeamInvites,
  syncAthleteSnapshotAcrossTeams,
  updateTeamBranding,
  updateTeamMemberEventGroup,
  updateTeamMemberPhotoRelease,
} from '../../teamService.ts';
import {
  normalizeCoachEventGroup,
  sanitizeTargetEventGroups,
} from '../../../src/physiology/teamOnboardingEngine.ts';
import type {
  CoachDataSharingTier,
  CoachEventGroup,
  TeamInviteStatus,
  TeamMemberRole,
} from '../../../src/types.ts';

export const rosterAndLifecycleRouter = express.Router();

// Static `/api/teams/*` routes mounted before parameterized `/api/teams/:teamId` routes

// List All Teams for Active Session (Multi-Team Switcher)
rosterAndLifecycleRouter.get(['/api/teams/mine', '/api/teams'], async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.json({
        ok: true,
        resendConfigured: isResendConfigured(),
        teams: [],
      });
      return;
    }

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

    const originUrl = resolveTrustedRequestOrigin(req);
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

// Create New School / Club / Coaching Team
rosterAndLifecycleRouter.post('/api/teams', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const team = await createTeamForCoach({
      callerSid: claims.sid,
      originUrl,
      name: String(req.body?.name || ''),
      shortName: req.body?.shortName ? String(req.body.shortName) : undefined,
      mascotOrMotto: req.body?.mascotOrMotto ? String(req.body.mascotOrMotto) : undefined,
      districtName: typeof req.body?.districtName === 'string' ? req.body.districtName : undefined,
      practiceVenues: Array.isArray(req.body?.practiceVenues) ? req.body.practiceVenues : undefined,
      orgType: req.body?.orgType || 'HIGH_SCHOOL',
      primarySport: req.body?.primarySport,
      primaryHex: req.body?.primaryHex,
      secondaryHex: req.body?.secondaryHex,
      logoDataUrl: req.body?.logoDataUrl,
      defaultSafeSportShield: req.body?.defaultSafeSportShield,
      enableParentGuardianCc: req.body?.enableParentGuardianCc,
      coachDisplayName: req.body?.coachDisplayName,
      coachEmail: req.body?.coachEmail,
      externalSync: req.body?.externalSync,
      attribution: req.body?.attribution,
      coachEventGroups: sanitizeTargetEventGroups(req.body?.eventGroups),
    });
    res.json({
      ok: true,
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

// Public Preview for Magic Join URL (`/join/<slug>?t=<token>`) or Join Code
rosterAndLifecycleRouter.get('/api/teams/join-preview', async (req: Request, res: Response) => {
  try {
    const codeOrSlug = String(req.query.codeOrSlug || '').trim();
    const token = req.query.t ? String(req.query.t).trim() : undefined;
    let verifiedCallerEmail: string | undefined;
    const claims = getVerifiedSessionClaims(req);
    if (isCanonicalAuthenticatedClaims(claims) && claims?.sub?.startsWith('usr_')) {
      const u = await getUserById(claims.sub);
      if (u?.email) verifiedCallerEmail = u.email;
    }
    const preview = await previewTeamJoinInvite(codeOrSlug, token, verifiedCallerEmail);
    res.json(preview);
  } catch (err) {
    res.status(400).json({
      found: false,
      error: err instanceof Error ? err.message : 'Failed to preview invite.',
    });
  }
});

// Claim Team Membership & Auto-Calibrate Baseline
rosterAndLifecycleRouter.post('/api/teams/join-claim', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Please sign in before joining a team.' });
      return;
    }
    const athleteName = String(req.body?.athleteName || '').trim();
    const originUrl = resolveTrustedRequestOrigin(req);
    const rawUnit = String(req.body?.distanceUnit || '').toLowerCase();
    const distanceUnit: 'mi' | 'km' = rawUnit === 'km' ? 'km' : 'mi';
    const rawTier = String(req.body?.sharingTier || '').toUpperCase();
    const sharingTier =
      rawTier === 'FULL_STREAMS' || rawTier === 'LOAD_ONLY'
        ? rawTier
        : 'SUMMARY_ONLY';

    let user = claims.sub?.startsWith('usr_')
      ? await getUserById(claims.sub)
      : claims.sub
        ? await getUserByProvider('strava', claims.sub)
        : null;
    const verifiedEmail = user?.email ? user.email.trim().toLowerCase() : undefined;
    const verifiedBirthMonthYear = user?.birthMonthYear;
    const store = getScopedRuntimeStore(req);
    const stravaFromUser =
      user?.authProviders?.find((p) => p.provider === 'strava')?.providerId ||
      user?.connectedServices?.find((s) => s.service === 'strava')?.athleteId;
    const verifiedStravaId =
      (store?.stravaAthleteId ? String(store.stravaAthleteId).trim() : '') ||
      (stravaFromUser ? String(stravaFromUser).trim() : '') ||
      (!claims.sub?.startsWith('usr_') && /^\d+$/.test(claims.sub || '') ? claims.sub : '') ||
      undefined;

    const claimed = await claimTeamJoinInvite({
      callerSid: claims.sid,
      originUrl,
      codeOrSlug: String(req.body?.codeOrSlug || '').trim(),
      inviteToken: req.body?.inviteToken ? String(req.body.inviteToken).trim() : undefined,
      athleteName: athleteName || user?.name || undefined,
      athleteEmail: verifiedEmail,
      stravaAthleteId: verifiedStravaId,
      squadGroup: req.body?.squadGroup ? String(req.body.squadGroup) : undefined,
      seedMarkOrFtp: req.body?.seedMarkOrFtp ? String(req.body.seedMarkOrFtp) : undefined,
      distanceUnit,
      sharingTier,
      birthYear: verifiedBirthMonthYear
        ? Number(verifiedBirthMonthYear.slice(0, 4))
        : typeof req.body?.birthYear === 'number'
          ? req.body.birthYear
          : req.body?.birthYear
            ? Number(req.body.birthYear)
            : undefined,
      birthMonthYear:
        verifiedBirthMonthYear ||
        (req.body?.birthMonthYear ? String(req.body.birthMonthYear).trim() : undefined),
      graduationYear:
        typeof req.body?.graduationYear === 'number'
          ? req.body.graduationYear
          : req.body?.graduationYear
            ? Number(req.body.graduationYear)
            : undefined,
      parentGuardianEmail: req.body?.parentGuardianEmail
        ? String(req.body.parentGuardianEmail).trim()
        : undefined,
      deferParentEmail: Boolean(req.body?.deferParentEmail),
    });

    if (!claimed.ok || !claimed.summary) {
      const isValidationError =
        Boolean(claimed.error) &&
        /COPPA|13 or older|Parent or guardian email|Minor birth date|Valid YYYY-MM|Valid 4-digit/i.test(
          claimed.error || ''
        );
      res.status(claimed.statusCode || (isValidationError ? 400 : 404)).json({
        ok: false,
        error: claimed.error || 'Team invite could not be claimed.',
      });
      return;
    }

    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
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

// Sync Athlete Clean-Room Readiness Snapshot Across Joined Teams
rosterAndLifecycleRouter.post('/api/teams/sync-snapshot', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.json({ ok: true, teams: [] });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const verifiedUser = claims.sub?.startsWith('usr_')
      ? await getUserById(claims.sub).catch(() => null)
      : null;
    const mergedSnapshot = {
      ...(req.body?.snapshot || {}),
      ...(req.body?.privacySettings && !req.body?.snapshot?.privacySettings
        ? { privacySettings: req.body.privacySettings }
        : {}),
    };
    const teams = await syncAthleteSnapshotAcrossTeams({
      callerSid: claims.sid,
      originUrl,
      athleteName: req.body?.athleteName ? String(req.body.athleteName) : undefined,
      verifiedUserBirthMonthYear: verifiedUser?.birthMonthYear,
      snapshot: mergedSnapshot,
    });
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to sync team snapshot.',
    });
  }
});

// Parent/Guardian Consent Verification & Decline Portal (Non-mutating GET -> Explicit POST)
rosterAndLifecycleRouter.get('/api/teams/parent-consent', async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || req.query.t || '').trim();
    const preview = await previewParentConsentToken(token);
    if (!preview.ok) {
      res.status(400).send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Parent Consent Link Error · MeetReady</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px 16px;max-width:480px;margin:0 auto;text-align:center;color:#1F2937;">
  <h2 style="color:#DC2626;">Invalid or Expired Link</h2>
  <p>${escapeHtml(preview.error || 'This consent link could not be verified.')}</p>
  <a href="/" style="display:inline-block;margin-top:16px;color:#14532D;font-weight:700;">Return to MeetReady</a>
</body>
</html>`);
      return;
    }

    const safeAthlete = escapeHtml(preview.athleteName || 'Athlete');
    const safeTeam = escapeHtml(preview.teamName || 'Team');
    const safeCoach = escapeHtml(preview.coachName || 'Coach');
    const safeToken = escapeHtml(token);
    const statusLine = preview.alreadyAcknowledged
      ? 'Safeguarding consent is already active. You may review details or revoke access below.'
      : 'Please confirm parental consent for your athlete’s team workspace below, or decline and purge their team data.';

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Parent &amp; Guardian Consent · MeetReady</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F4F6F3;padding:40px 16px;margin:0;color:#111318;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:18px;border:1px solid #E2E8F0;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#15803D;text-transform:uppercase;">COPPA &amp; SAFE-SPORT SAFEGUARDS</div>
    <h2 style="margin:8px 0 12px;font-size:22px;color:#111318;">Parent / Guardian Authorization</h2>
    <p style="font-size:14px;color:#4B5563;line-height:1.6;margin:0 0 18px;">${escapeHtml(statusLine)}</p>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px;font-size:13px;color:#334155;margin-bottom:20px;">
      <div><strong>Athlete:</strong> ${safeAthlete}</div>
      <div><strong>Team:</strong> ${safeTeam}</div>
      <div><strong>Coach:</strong> ${safeCoach}</div>
      <div><strong>Protections:</strong> Weight &amp; W/kg masking is locked ON until age 18.</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      <form method="POST" action="/api/teams/parent-consent" style="flex:1;">
        <input type="hidden" name="token" value="${safeToken}" />
        <input type="hidden" name="action" value="APPROVE" />
        <button type="submit" style="width:100%;min-height:44px;background:#14532D;color:#FFFFFF;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;padding:10px 16px;">Approve &amp; Acknowledge Safeguards</button>
      </form>
      <form method="POST" action="/api/teams/parent-consent" style="flex:1;">
        <input type="hidden" name="token" value="${safeToken}" />
        <input type="hidden" name="action" value="DECLINE" />
        <button type="submit" style="width:100%;min-height:44px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;padding:10px 16px;">Decline &amp; Delete Child Data</button>
      </form>
    </div>
  </div>
</body>
</html>`);
  } catch {
    res.status(500).send('An error occurred while loading parent consent status.');
  }
});

rosterAndLifecycleRouter.post(
  '/api/teams/parent-consent',
  express.urlencoded({ extended: false }),
  async (req: Request, res: Response) => {
    try {
      const token = String(req.body?.token || req.query.token || '').trim();
      const action = String(req.body?.action || req.query.action || 'APPROVE')
        .trim()
        .toUpperCase();
      const wantsHtml = String(req.headers.accept || '').includes('text/html');

      if (action === 'DECLINE') {
        const decl = await declineAndPurgeParentConsent(token);
        if (!decl.ok) {
          res.status(400).json({ ok: false, error: decl.error });
          return;
        }
        if (wantsHtml) {
          res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px 16px;max-width:480px;margin:0 auto;text-align:center;"><h2>Child Data Removed</h2><p>Membership and synced biometrics for <strong>${escapeHtml(decl.athleteName || 'Athlete')}</strong> on <strong>${escapeHtml(decl.teamName || 'Team')}</strong> have been revoked and cleared.</p><a href="/">Return to MeetReady</a></body></html>`);
          return;
        }
        res.json({ ...decl, declined: true });
        return;
      }

      const result = await acknowledgeParentConsent(token);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      if (wantsHtml) {
        res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px 16px;max-width:480px;margin:0 auto;text-align:center;"><h2 style="color:#15803D;">Safeguarding Acknowledged</h2><p>Parental acknowledgment for <strong>${escapeHtml(result.athleteName || 'Athlete')}</strong> on <strong>${escapeHtml(result.teamName || 'Team')}</strong> has been confirmed.</p><a href="/" style="display:inline-block;margin-top:16px;color:#14532D;font-weight:700;">Visit MeetReady</a></body></html>`);
        return;
      }
      res.json({ ...result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed confirming consent.',
      });
    }
  }
);

// Parameterized `/api/teams/:teamId/*` team config, invites, members & governance routes

rosterAndLifecycleRouter.put('/api/teams/:teamId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

rosterAndLifecycleRouter.put('/api/teams/:teamId/practice-venues', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as { practiceVenues?: unknown };
    const result = await updateTeamPracticeVenues({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      practiceVenues: body.practiceVenues,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.statusCode || 403).json({
        ok: false,
        error: result.error || 'Coach or Org Admin permissions required.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      practiceVenues: result.practiceVenues,
      team: result.team,
      teams,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed updating practice venues.',
    });
  }
});

rosterAndLifecycleRouter.post('/api/teams/:teamId/invites/bulk', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

rosterAndLifecycleRouter.post('/api/teams/:teamId/invites/resend', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/:membershipId/event-group',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const eventGroup: CoachEventGroup | null = normalizeCoachEventGroup(req.body?.eventGroup);
      const originUrl = resolveTrustedRequestOrigin(req);
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
  }
);

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/:membershipId/photo-release',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const result = await updateTeamMemberPhotoRelease({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        membershipId: String(req.params.membershipId || ''),
        photoReleaseOptOut: req.body?.photoReleaseOptOut === true,
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Unable to update photo release setting.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update photo release setting.',
      });
    }
  }
);

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/:membershipId/coach-groups',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as {
        coachEventGroups?: unknown;
        coachSpecialtyTitle?: unknown;
        assignedAthleteMembershipIds?: unknown;
      };
      const coachEventGroups = Array.isArray(body.coachEventGroups)
        ? body.coachEventGroups.map((g) => String(g) as CoachEventGroup)
        : [];
      const result = await updateAssistantCoachEventGroups({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        membershipId: String(req.params.membershipId || ''),
        coachEventGroups,
        ...(body.coachSpecialtyTitle !== undefined
          ? { coachSpecialtyTitle: String(body.coachSpecialtyTitle || '') }
          : {}),
        ...(Array.isArray(body.assignedAthleteMembershipIds)
          ? {
              assignedAthleteMembershipIds: body.assignedAthleteMembershipIds.map((id) =>
                String(id)
              ),
            }
          : {}),
        originUrl,
      });
      if (!result.ok) {
        res.status(403).json({
          ok: false,
          error: result.error || 'Unable to update assistant coach groups.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.team, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed updating assistant coach groups.',
      });
    }
  }
);

rosterAndLifecycleRouter.post('/api/teams/:teamId/leave', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const modeRaw = String(req.body?.mode || 'LEAVE').toUpperCase();
    const mode = modeRaw === 'GRADUATE_ALUMNI' ? 'GRADUATE_ALUMNI' : 'LEAVE';
    const originUrl = resolveTrustedRequestOrigin(req);
    const outcome = await leaveOrGraduateTeam({
      callerSid: claims.sid,
      userId: claims.sub?.startsWith('usr_') ? claims.sub : undefined,
      teamId: String(req.params.teamId || ''),
      mode,
      originUrl,
    });
    if (!outcome.ok) {
      res.status(400).json({ ok: false, error: outcome.error || 'Could not leave team.' });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to leave team.',
    });
  }
});

rosterAndLifecycleRouter.delete(
  '/api/teams/:teamId/members/me/guardian',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const verifiedUser = claims.sub?.startsWith('usr_')
        ? await getUserById(claims.sub).catch(() => null)
        : null;
      const outcome = await revokeAthleteGuardianConsentForTeam({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        birthMonthYear: req.body?.birthMonthYear ? String(req.body.birthMonthYear) : undefined,
        verifiedUserBirthMonthYear: verifiedUser?.birthMonthYear,
      });
      if (!outcome.ok) {
        res.status(400).json({ ok: false, error: outcome.error });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: outcome.summary, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to revoke guardian access.',
      });
    }
  }
);

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/me/sharing-tier',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const rawTier = String(req.body?.sharingTier || '').toUpperCase();
      if (
        rawTier !== 'LOAD_ONLY' &&
        rawTier !== 'SUMMARY_ONLY' &&
        rawTier !== 'FULL_STREAMS'
      ) {
        res.status(400).json({ ok: false, error: 'Invalid coach data sharing tier.' });
        return;
      }
      const sharingTier = rawTier as CoachDataSharingTier;
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await updateMyTeamSharingTier({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        sharingTier,
        originUrl,
      });
      if (!outcome.ok) {
        res.status(400).json({ ok: false, error: outcome.error });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: outcome.summary, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update team sharing tier.',
      });
    }
  }
);

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/:membershipId/status',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const rawStatus = String(req.body?.status || '').toUpperCase();
      type MemberLifecycleStatus = Extract<
        TeamInviteStatus,
        'ACTIVE' | 'INJURED' | 'OFF_SEASON' | 'ALUMNI' | 'REVOKED'
      >;
      const allowed: MemberLifecycleStatus[] = [
        'ACTIVE',
        'INJURED',
        'OFF_SEASON',
        'ALUMNI',
        'REVOKED',
      ];
      const validatedStatus = allowed.find((s) => s === rawStatus);
      if (!validatedStatus) {
        res.status(400).json({ ok: false, error: 'Invalid member lifecycle status.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await updateMemberRosterLifecycleStatus({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        membershipId: String(req.params.membershipId || ''),
        status: validatedStatus,
        originUrl,
      });
      if (!outcome.ok || !outcome.summary) {
        res.status(403).json({ ok: false, error: outcome.error || 'Could not update member status.' });
        return;
      }
      res.json({ ok: true, team: outcome.summary });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed updating member status.',
      });
    }
  }
);

rosterAndLifecycleRouter.post(
  '/api/teams/:teamId/members/:membershipId/parent-consent-link',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await issueOrResendParentConsentLink({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        membershipId: String(req.params.membershipId || ''),
        originUrl,
        parentGuardianEmail: req.body?.parentGuardianEmail
          ? String(req.body.parentGuardianEmail).trim()
          : undefined,
      });
      if (!outcome.ok) {
        const isAuthError = /permission/i.test(outcome.error || '');
        res.status(isAuthError ? 403 : 400).json({
          ok: false,
          error: outcome.error || 'Could not issue parent consent link.',
        });
        return;
      }
      res.json({
        ok: true,
        consentUrl: outcome.consentUrl,
        emailStatus: outcome.emailStatus,
        team: outcome.team,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed issuing parent consent link.',
      });
    }
  }
);

rosterAndLifecycleRouter.post('/api/teams/:teamId/graduate-class', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const graduationYear = Number(req.body?.graduationYear);
    if (!Number.isFinite(graduationYear) || graduationYear < 2000 || graduationYear > 2100) {
      res.status(400).json({ ok: false, error: 'Valid graduationYear is required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const outcome = await graduateTeamClass({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      graduationYear,
      originUrl,
    });
    if (!outcome.ok) {
      res.status(403).json({ ok: false, error: outcome.error || 'Head Coach permission required.' });
      return;
    }
    res.json({ ok: true, graduatedCount: outcome.graduatedCount, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed graduating class.',
    });
  }
});

rosterAndLifecycleRouter.patch(
  '/api/teams/:teamId/members/:membershipId/role',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const role = String(req.body?.role || '').toUpperCase();
      if (
        role !== 'ATHLETE' &&
        role !== 'ASSISTANT_COACH' &&
        role !== 'ORG_ADMIN' &&
        role !== 'ATHLETIC_TRAINER'
      ) {
        res.status(400).json({
          ok: false,
          error: 'Role must be ATHLETE, ASSISTANT_COACH, ORG_ADMIN, or ATHLETIC_TRAINER.',
        });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
      const outcome = await updateMemberRole({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        membershipId: String(req.params.membershipId || ''),
        role: role as Extract<
          TeamMemberRole,
          'ATHLETE' | 'ASSISTANT_COACH' | 'ORG_ADMIN' | 'ATHLETIC_TRAINER'
        >,
        originUrl,
      });
      if (!outcome.ok || !outcome.summary) {
        res.status(403).json({ ok: false, error: outcome.error || 'Head Coach permission required.' });
        return;
      }
      res.json({ ok: true, team: outcome.summary });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed updating member role.',
      });
    }
  }
);

rosterAndLifecycleRouter.post('/api/teams/:teamId/transfer-ownership', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const outcome = await transferTeamHeadCoachOwnership({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      newHeadCoachMembershipId: String(
        req.body?.newHeadCoachMembershipId || req.body?.targetMembershipId || ''
      ),
      originUrl,
    });
    if (!outcome.ok || !outcome.summary) {
      res.status(403).json({ ok: false, error: outcome.error || 'Could not transfer ownership.' });
      return;
    }
    res.json({ ok: true, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed transferring ownership.',
    });
  }
});

rosterAndLifecycleRouter.post('/api/teams/:teamId/members/merge', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const outcome = await mergeDuplicateRosterMembers({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      sourceMembershipId: String(req.body?.sourceMembershipId || ''),
      targetMembershipId: String(req.body?.targetMembershipId || ''),
      originUrl,
    });
    if (!outcome.ok || !outcome.summary) {
      res.status(400).json({ ok: false, error: outcome.error || 'Could not merge members.' });
      return;
    }
    res.json({ ok: true, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed merging roster entries.',
    });
  }
});

rosterAndLifecycleRouter.post('/api/teams/:teamId/staff/invite', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      staffName?: unknown;
      staffEmail?: unknown;
      role?: unknown;
      coachSpecialtyTitle?: unknown;
      coachEventGroups?: unknown;
      assignedAthleteMembershipIds?: unknown;
    };
    const coachEventGroups = Array.isArray(body.coachEventGroups)
      ? body.coachEventGroups.map((g) => String(g) as CoachEventGroup)
      : undefined;
    const assignedAthleteMembershipIds = Array.isArray(body.assignedAthleteMembershipIds)
      ? body.assignedAthleteMembershipIds.map((id) => String(id))
      : undefined;

    const result = await inviteTeamCoachingStaff({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      staffName: String(body.staffName || ''),
      staffEmail: typeof body.staffEmail === 'string' ? body.staffEmail : undefined,
      role: typeof body.role === 'string' ? (body.role as TeamMemberRole) : undefined,
      coachSpecialtyTitle:
        typeof body.coachSpecialtyTitle === 'string' ? body.coachSpecialtyTitle : undefined,
      coachEventGroups,
      assignedAthleteMembershipIds,
      originUrl,
    });
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        error: result.error || 'Unable to invite coaching staff member.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      member: result.member,
      inviteUrl: result.inviteUrl,
      emailStatus: result.emailStatus,
      team: result.team,
      teams,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed inviting coaching staff member.',
    });
  }
});

rosterAndLifecycleRouter.get('/api/teams/:teamId/audit-log', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const limit = Number(req.query?.limit || 100);
    const result = await getTeamGovernanceAuditLog({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      limit: Number.isFinite(limit) ? limit : 100,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Audit log permission required.',
      });
      return;
    }
    res.json({ ok: true, entries: result.entries || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading audit log.',
    });
  }
});

rosterAndLifecycleRouter.post('/api/teams/:teamId/safety-alerts', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const result = await recordGuardianSafetyAlert({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      targetMembershipId: String(req.body?.targetMembershipId || ''),
      category: req.body?.category || 'PAIN_FLAG',
      severity: req.body?.severity || 'CAUTION',
      summary: String(req.body?.summary || ''),
      painLocation: req.body?.painLocation ? String(req.body.painLocation) : undefined,
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || 'Unable to record safety alert.' });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, alert: result.alert, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed recording safety alert.',
    });
  }
});
