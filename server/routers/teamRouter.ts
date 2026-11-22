import express, { type Request, type Response } from 'express';
import {
  deleteTeamAnnouncement,
  inviteTeamCoachingStaff,
  postTeamAnnouncement,
  recordTeamAttendanceBatch,
  recordTeamFieldMarks,
  updateAssistantCoachEventGroups,
} from '../teamFieldAndDailyOpsService.ts';
import {
  dispatchPushPayloadToUsers,
  getOrInitVapidKeys,
  listUserPushSubscriptions,
  removeUserPushSubscription,
  saveUserPushSubscription,
} from '../pushNotificationService.ts';
import {
  acknowledgeTeamMessage,
  flagTeamMessageForReview,
  postTeamMessage,
  updateTeamMessagingPolicy,
} from '../teamMessagingService.ts';
import {
  escapeHtml,
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  isProductionDeployment,
  resolveSafeOrigin,
  setSessionCookie,
} from '../securityUtils.ts';
import { getUserById, getUserByProvider } from '../authService.ts';
import { getScopedRuntimeStore } from '../sessionContext.ts';
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
} from '../teamLifecycleService.ts';
import {
  acknowledgeParentConsent,
  autoLinkPendingTeamInvitesByEmail,
  broadcastWorkoutBatchToTeamSquad,
  broadcastWorkoutToTeamSquad,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  deleteBroadcastPlanBlockFromTeam,
  deleteBroadcastWorkoutFromTeam,
  deleteTeamWorkoutLibraryTemplate,
  getTeamGovernanceAuditLog,
  isResendConfigured,
  listTeamWorkoutComments,
  listTeamWorkoutLibrary,
  listTeamsForUser,
  postTeamWorkoutComment,
  previewTeamJoinInvite,
  recordCoachStopwatchActivities,
  recordGuardianSafetyAlert,
  requestEmailOtpCode,
  resendPendingTeamInvites,
  saveTeamWorkoutLibraryTemplate,
  syncAthleteSnapshotAcrossTeams,
  updateBroadcastWorkoutOnTeam,
  updateTeamBranding,
  updateTeamMemberEventGroup,
  verifyEmailOtpCode,
} from '../teamService.ts';
import {
  normalizeCoachEventGroup,
  sanitizeTargetEventGroups,
} from '../../src/physiology/teamOnboardingEngine.ts';
import type {
  CoachDataSharingTier,
  CoachEventGroup,
  TeamInviteStatus,
  TeamMemberRole,
} from '../../src/types.ts';

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
  return 'https://meetready.app';
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
      ...(!isProductionDeployment() && result.devPreviewCode
        ? { devPreviewCode: result.devPreviewCode }
        : {}),
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
      result.sid,
      'verified'
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const team = await createTeamForCoach({
      callerSid: claims.sid,
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
      externalSync: req.body?.externalSync,
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

// 5. Update Team Branding, Colors, Crest & Safeguarding Settings
teamRouter.put('/api/teams/:teamId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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

// 9. Claim Team Membership & Auto-Calibrate Baseline
teamRouter.post('/api/teams/join-claim', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Please sign in before joining a team.' });
      return;
    }
    const athleteName = String(req.body?.athleteName || '').trim();
    const originUrl = resolveRequestOrigin(req);
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
        /COPPA|13 or older|Parent or guardian email/i.test(claimed.error || '');
      res.status(isValidationError ? 400 : 404).json({
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

// 10. Sync Athlete Clean-Room Readiness Snapshot Across Joined Teams
teamRouter.post('/api/teams/sync-snapshot', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.json({ ok: true, teams: [] });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
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

// 11. Broadcast Structured Workout to Whole Team, Squad Pod, or Specific Athletes
teamRouter.post('/api/teams/:teamId/workouts/broadcast', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds)
      ? req.body.targetMembershipIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    const targetEventGroups = sanitizeTargetEventGroups(req.body?.targetEventGroups);
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
      scheduledTime: req.body?.scheduledTime,
      sessionSlot: req.body?.sessionSlot,
      locationName: req.body?.locationName,
      locationCategory: req.body?.locationCategory,
      meetingNotes: req.body?.meetingNotes,
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
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds)
      ? req.body.targetMembershipIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : undefined;
    const targetEventGroups = sanitizeTargetEventGroups(req.body?.targetEventGroups);
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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

// 11f. Update Single Broadcast Workout on Team Calendar
teamRouter.put('/api/teams/:teamId/workouts/:broadcastId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const updated = await updateBroadcastWorkoutOnTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      broadcastId: String(req.params.broadcastId || ''),
      originUrl,
      updates: {
        ...(typeof body.date === 'string' ? { date: body.date } : {}),
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(body.sportCategory ? { sportCategory: body.sportCategory } : {}),
        ...(body.plannedDurationSecs !== undefined
          ? { plannedDurationSecs: Number(body.plannedDurationSecs) }
          : {}),
        ...(body.plannedLoad !== undefined ? { plannedLoad: Number(body.plannedLoad) } : {}),
        ...(typeof body.workoutSyntax === 'string' ? { workoutSyntax: body.workoutSyntax } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...('scheduledTime' in body ? { scheduledTime: body.scheduledTime } : {}),
        ...('sessionSlot' in body ? { sessionSlot: body.sessionSlot } : {}),
        ...('locationName' in body ? { locationName: body.locationName } : {}),
        ...('locationCategory' in body ? { locationCategory: body.locationCategory } : {}),
        ...('meetingNotes' in body ? { meetingNotes: body.meetingNotes } : {}),
        ...('trackSpec' in body ? { trackSpec: body.trackSpec } : {}),
      },
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: 'Coach permissions or broadcast workout not found.' });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update broadcast workout.',
    });
  }
});

// 11g. Recall / Delete Single Broadcast Workout from Team Calendar
teamRouter.delete('/api/teams/:teamId/workouts/:broadcastId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await deleteBroadcastWorkoutFromTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      broadcastId: String(req.params.broadcastId || ''),
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
      error: err instanceof Error ? err.message : 'Failed to delete broadcast workout.',
    });
  }
});

// 11c. Update Roster Member Event Group
teamRouter.patch('/api/teams/:teamId/members/:membershipId/event-group', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const eventGroup: CoachEventGroup | null = normalizeCoachEventGroup(req.body?.eventGroup);
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
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
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

// 11c. Athlete Voluntary Team Leave / Alumni Graduation
teamRouter.post('/api/teams/:teamId/leave', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const modeRaw = String(req.body?.mode || 'LEAVE').toUpperCase();
    const mode = modeRaw === 'GRADUATE_ALUMNI' ? 'GRADUATE_ALUMNI' : 'LEAVE';
    const originUrl = resolveRequestOrigin(req);
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

// 11d. Athlete 18+ Guardian CC Revocation (FERPA transfer of rights at 18)
teamRouter.delete('/api/teams/:teamId/members/me/guardian', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
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
});

// 11d-bis. Post-Join Athlete / Member Sharing Tier Self-Service Control (RT-14)
teamRouter.patch(
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
      const originUrl = resolveRequestOrigin(req);
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

// 11e. Coach Roster Member Lifecycle Status (ACTIVE / INJURED / OFF_SEASON / ALUMNI / REVOKED)
teamRouter.patch(
  '/api/teams/:teamId/members/:membershipId/status',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
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
      const originUrl = resolveRequestOrigin(req);
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

// 11e-bis. Coach Issue / Resend 1-Click Parent Consent Link
teamRouter.post(
  '/api/teams/:teamId/members/:membershipId/parent-consent-link',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveRequestOrigin(req);
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

// 11f. Graduate Seniors Class -> ALUMNI
teamRouter.post('/api/teams/:teamId/graduate-class', async (req: Request, res: Response) => {
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
    const originUrl = resolveRequestOrigin(req);
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

// 11g. Assign Assistant Coach Role & Transfer Head Coach Ownership
teamRouter.patch(
  '/api/teams/:teamId/members/:membershipId/role',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
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
      const originUrl = resolveRequestOrigin(req);
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

teamRouter.post('/api/teams/:teamId/transfer-ownership', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
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

// 11h. Merge Pre-Seeded/Imported Ghost Duplicate Onto Claimed Athlete Row
teamRouter.post('/api/teams/:teamId/members/merge', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
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

// 12. Parent/Guardian Consent Verification & Decline Portal (Non-mutating GET -> Explicit POST)
teamRouter.get('/api/teams/parent-consent', async (req: Request, res: Response) => {
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

teamRouter.post(
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

// 13. Governance Audit Log (HEAD_COACH / ORG_ADMIN only)
teamRouter.get('/api/teams/:teamId/audit-log', async (req: Request, res: Response) => {
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

// 14. Guardian Safety Alerts (Coach / AT / Self athlete -> Guardian CC & Audit Log)
teamRouter.post('/api/teams/:teamId/safety-alerts', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
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

// 15. Reusable Team Workout Library (Coach programming roles only for mutations)
teamRouter.get('/api/teams/:teamId/workout-library', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const result = await listTeamWorkoutLibrary({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || 'Forbidden.' });
      return;
    }
    res.json({ ok: true, templates: result.templates || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading workout library.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/workout-library', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const result = await saveTeamWorkoutLibraryTemplate({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      originUrl,
      template: {
        ...(body.id ? { id: String(body.id) } : {}),
        name: String(body.name || ''),
        category: body.category || 'TRACK',
        sportCategory: body.sportCategory || 'Running',
        workoutSyntax: String(body.workoutSyntax || ''),
        description: String(body.description || ''),
        plannedDurationSecs: Number(body.plannedDurationSecs || 2400),
        plannedLoad: Number(body.plannedLoad || 55),
        ...(body.trackSpec ? { trackSpec: body.trackSpec } : {}),
      },
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Coach permissions required.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, template: result.template, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving workout template.',
    });
  }
});

teamRouter.delete(
  '/api/teams/:teamId/workout-library/:templateId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveRequestOrigin(req);
      const result = await deleteTeamWorkoutLibraryTemplate({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        templateId: String(req.params.templateId || ''),
        originUrl,
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || 'Coach permissions required.',
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.summary, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed deleting workout template.',
      });
    }
  }
);

// 16. Logged Workout Comments with Mandatory U18 Guardian CC (SafeSport MAAPP)
teamRouter.get('/api/teams/:teamId/comments', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const result = await listTeamWorkoutComments({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      targetMembershipId: req.query?.targetMembershipId
        ? String(req.query.targetMembershipId)
        : undefined,
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || 'Forbidden.' });
      return;
    }
    res.json({ ok: true, comments: result.comments || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading comments.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/comments', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const result = await postTeamWorkoutComment({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      targetMembershipId: String(body.targetMembershipId || ''),
      workoutDate: body.workoutDate ? String(body.workoutDate) : undefined,
      activityId: body.activityId ? String(body.activityId) : undefined,
      body: String(body.body || ''),
      privateDirectToMinor: body.privateDirectToMinor === true,
      guardianCc: body.guardianCc,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to post workout comment.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, comment: result.comment, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed posting workout comment.',
    });
  }
});

// ============================================================================
// 17. Wave 1B / Wave 2 Daily Ops, Attendance, Announcements & Field Marks
// ============================================================================

teamRouter.post('/api/teams/:teamId/attendance', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      date?: unknown;
      entries?: Array<{ membershipId?: unknown; status?: unknown; note?: unknown }>;
    };
    const entries = Array.isArray(body.entries)
      ? body.entries.map((entry) => ({
          membershipId: String(entry?.membershipId || ''),
          status: String(entry?.status || 'PRESENT') as 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED',
          note: typeof entry?.note === 'string' ? entry.note : undefined,
        }))
      : [];
    const result = await recordTeamAttendanceBatch({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      date: String(body.date || ''),
      entries,
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({
        ok: false,
        error: result.error || 'Unable to record attendance.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, recordedCount: result.recordedCount, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed recording attendance.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/announcements', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      title?: unknown;
      body?: unknown;
      category?: unknown;
      targetEventGroups?: unknown;
      publishToParentHub?: unknown;
    };
    const result = await postTeamAnnouncement({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      title: String(body.title || ''),
      body: String(body.body || ''),
      category: typeof body.category === 'string'
        ? (body.category as 'WEATHER' | 'SCHEDULE_CHANGE' | 'MEET_LOGISTICS' | 'GENERAL')
        : undefined,
      targetEventGroups: Array.isArray(body.targetEventGroups)
        ? body.targetEventGroups.map((g) => String(g) as import('../../src/types.ts').CoachEventGroup)
        : undefined,
      publishToParentHub: body.publishToParentHub === true,
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({
        ok: false,
        error: result.error || 'Unable to post announcement.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, announcement: result.announcement, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed posting announcement.',
    });
  }
});

teamRouter.delete('/api/teams/:teamId/announcements/:announcementId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await deleteTeamAnnouncement({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      announcementId: String(req.params.announcementId || ''),
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({
        ok: false,
        error: result.error || 'Unable to delete announcement.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed deleting announcement.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/field-marks', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      entries?: Array<{
        membershipId?: unknown;
        athleteName?: unknown;
        date?: unknown;
        eventCode?: unknown;
        isCompetition?: unknown;
        meetOrPracticeTitle?: unknown;
        implementSpec?: unknown;
        poleSpec?: unknown;
        approachSteps?: unknown;
        attempts?: unknown;
        multiPoints?: unknown;
        rpe?: unknown;
      }>;
    };
    const entries = Array.isArray(body.entries)
      ? body.entries.map((entry) => ({
          membershipId: typeof entry?.membershipId === 'string' ? entry.membershipId : undefined,
          athleteName: String(entry?.athleteName || ''),
          date: String(entry?.date || ''),
          eventCode: String(entry?.eventCode || 'LJ') as import('../../src/types.ts').FieldEventCode,
          isCompetition: entry?.isCompetition === true,
          meetOrPracticeTitle: typeof entry?.meetOrPracticeTitle === 'string' ? entry.meetOrPracticeTitle : undefined,
          implementSpec: typeof entry?.implementSpec === 'string' ? entry.implementSpec : undefined,
          poleSpec: typeof entry?.poleSpec === 'string' ? entry.poleSpec : undefined,
          approachSteps: typeof entry?.approachSteps === 'number' ? entry.approachSteps : undefined,
          attempts: Array.isArray(entry?.attempts)
            ? (entry.attempts as import('../../src/types.ts').FieldTrialEntry[])
            : [],
          multiPoints: typeof entry?.multiPoints === 'number' ? entry.multiPoints : undefined,
          rpe: typeof entry?.rpe === 'number' ? entry.rpe : undefined,
        }))
      : [];
    const result = await recordTeamFieldMarks({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      entries,
      originUrl,
    });
    if (!result.ok) {
      res.status(403).json({
        ok: false,
        error: result.error || 'Unable to record field marks.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, recordedCount: result.recordedCount, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed recording field marks.',
    });
  }
});

teamRouter.patch('/api/teams/:teamId/members/:membershipId/coach-groups', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      coachEventGroups?: unknown;
      coachSpecialtyTitle?: unknown;
      assignedAthleteMembershipIds?: unknown;
    };
    const coachEventGroups = Array.isArray(body.coachEventGroups)
      ? body.coachEventGroups.map((g) => String(g) as import('../../src/types.ts').CoachEventGroup)
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
            assignedAthleteMembershipIds: body.assignedAthleteMembershipIds.map((id) => String(id)),
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
});

// ============================================================================
// 18. Wave 3 SafeSport MAAPP Coach–Athlete Transparent Messaging
// ============================================================================

teamRouter.post('/api/teams/:teamId/messages', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      channelScope?: unknown;
      eventGroup?: unknown;
      targetMembershipId?: unknown;
      body?: unknown;
      privateDirectToMinor?: unknown;
      guardianCc?: unknown;
      clientLocalHour?: unknown;
      isEmergencyOverride?: unknown;
    };
    const scope = String(body.channelScope || 'ALL_TEAM') as import('../../src/types.ts').TeamMessageChannelScope;
    const result = await postTeamMessage({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      channelScope: scope,
      eventGroup: typeof body.eventGroup === 'string' ? body.eventGroup : undefined,
      targetMembershipId: typeof body.targetMembershipId === 'string' ? body.targetMembershipId : undefined,
      body: String(body.body || ''),
      privateDirectToMinor: body.privateDirectToMinor === true,
      guardianCc: typeof body.guardianCc === 'boolean' ? body.guardianCc : undefined,
      clientLocalHour: typeof body.clientLocalHour === 'number' ? body.clientLocalHour : undefined,
      isEmergencyOverride: body.isEmergencyOverride === true,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to send message.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, message: result.message, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed sending team message.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/messages/:messageId/ack', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await acknowledgeTeamMessage({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      messageId: String(req.params.messageId || ''),
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to acknowledge message.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed acknowledging message.',
    });
  }
});

teamRouter.post('/api/teams/:teamId/messages/:messageId/flag', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as { reason?: unknown };
    const result = await flagTeamMessageForReview({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      messageId: String(req.params.messageId || ''),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to flag message.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed flagging message.',
    });
  }
});

teamRouter.patch('/api/teams/:teamId/messaging-policy', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      athleteRepliesEnabled?: unknown;
      quietHoursStartHour?: unknown;
      quietHoursEndHour?: unknown;
    };
    const result = await updateTeamMessagingPolicy({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      athleteRepliesEnabled:
        typeof body.athleteRepliesEnabled === 'boolean' ? body.athleteRepliesEnabled : undefined,
      quietHoursStartHour:
        typeof body.quietHoursStartHour === 'number' ? body.quietHoursStartHour : undefined,
      quietHoursEndHour:
        typeof body.quietHoursEndHour === 'number' ? body.quietHoursEndHour : undefined,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to update messaging policy.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: result.team, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed updating messaging policy.',
    });
  }
});

// ============================================================================
// 19. Wave 4 Multi-Coach Coaching Staff Invites & Web Push Device Notifications
// ============================================================================

teamRouter.post('/api/teams/:teamId/staff/invite', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = (req.body || {}) as {
      staffName?: unknown;
      staffEmail?: unknown;
      role?: unknown;
      coachSpecialtyTitle?: unknown;
      coachEventGroups?: unknown;
      assignedAthleteMembershipIds?: unknown;
    };
    const coachEventGroups = Array.isArray(body.coachEventGroups)
      ? body.coachEventGroups.map((g) => String(g) as import('../../src/types.ts').CoachEventGroup)
      : undefined;
    const assignedAthleteMembershipIds = Array.isArray(body.assignedAthleteMembershipIds)
      ? body.assignedAthleteMembershipIds.map((id) => String(id))
      : undefined;

    const result = await inviteTeamCoachingStaff({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      staffName: String(body.staffName || ''),
      staffEmail: typeof body.staffEmail === 'string' ? body.staffEmail : undefined,
      role:
        typeof body.role === 'string'
          ? (body.role as import('../../src/types.ts').TeamMemberRole)
          : undefined,
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

teamRouter.get('/api/push/vapid-public-key', async (_req: Request, res: Response) => {
  try {
    const keys = await getOrInitVapidKeys();
    res.json({ ok: true, publicKey: keys.publicKey });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed initializing Web Push VAPID keys.',
    });
  }
});

teamRouter.get('/api/push/status', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const subs = await listUserPushSubscriptions(claims.sid);
    res.json({
      ok: true,
      subscriptionCount: subs.length,
      subscriptions: subs.map((s) => ({
        id: s.id,
        endpointPreview: `${s.endpoint.slice(0, 42)}…`,
        userAgent: s.userAgent,
        updatedAt: s.updatedAt,
        muteQuietHours: Boolean(s.muteQuietHours),
      })),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading push subscription status.',
    });
  }
});

teamRouter.post('/api/push/subscribe', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const body = (req.body || {}) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
      userAgent?: unknown;
      muteQuietHours?: unknown;
    };
    const result = await saveUserPushSubscription({
      userSid: claims.sid,
      endpoint: String(body.endpoint || ''),
      keys: {
        p256dh: String(body.keys?.p256dh || ''),
        auth: String(body.keys?.auth || ''),
      },
      userAgent: typeof body.userAgent === 'string' ? body.userAgent : req.get('user-agent'),
      muteQuietHours: body.muteQuietHours === true,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error || 'Invalid push subscription.' });
      return;
    }
    const subs = await listUserPushSubscriptions(claims.sid);
    res.json({ ok: true, subscriptionCount: subs.length });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed saving device push subscription.',
    });
  }
});

teamRouter.delete('/api/push/subscribe', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const body = (req.body || {}) as { endpoint?: unknown };
    const result = await removeUserPushSubscription({
      userSid: claims.sid,
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : undefined,
    });
    res.json({ ok: true, remainingCount: result.remainingCount });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed removing device push subscription.',
    });
  }
});

teamRouter.post('/api/push/test', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const result = await dispatchPushPayloadToUsers({
      recipientSids: [claims.sid],
      payload: {
        title: 'MeetReady Practice Alerts Active',
        body: 'Device push notifications are connected for coach messages and weather updates.',
        tag: 'thresh-test',
        url: '/?openMessages=1',
        isEmergency: false,
      },
    });
    res.json({ ok: true, deliveredCount: result.deliveredCount, prunedCount: result.prunedCount });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed sending test notification.',
    });
  }
});
