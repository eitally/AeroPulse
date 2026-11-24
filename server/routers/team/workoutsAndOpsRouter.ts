import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../../securityUtils.ts';
import { checkDistributedRateLimitAsync } from '../../rateLimiter.ts';
import {
  listTeamFieldMarks,
  recordTeamAttendanceBatch,
  recordTeamFieldMarks,
  selfCheckInTeamAttendance,
} from '../../teamFieldAndDailyOpsService.ts';
import {
  broadcastWorkoutBatchToTeamSquad,
  broadcastWorkoutToTeamSquad,
  deleteBroadcastPlanBlockFromTeam,
  deleteBroadcastWorkoutFromTeam,
  deleteTeamWorkoutLibraryTemplate,
  listTeamWorkoutComments,
  listTeamWorkoutLibrary,
  listTeamsForUser,
  postTeamWorkoutComment,
  saveTeamWorkoutLibraryTemplate,
  updateBroadcastWorkoutOnTeam,
} from '../../teamService.ts';
import { sanitizeTargetEventGroups } from '../../../src/physiology/teamOnboardingEngine.ts';
import type {
  FieldEventCode,
  FieldTrialEntry,
  TeamAttendanceStatus,
} from '../../../src/types.ts';

export const workoutsAndOpsRouter = express.Router();

// Broadcast Structured Workout to Whole Team, Squad Pod, or Specific Athletes
workoutsAndOpsRouter.post('/api/teams/:teamId/workouts/broadcast', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Batch-Broadcast Rolling or Full-Block Training Plans to Team or Event-Group Cohorts
workoutsAndOpsRouter.post('/api/teams/:teamId/workouts/broadcast-batch', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Recall / Delete Broadcast Training Block from Team Calendar
workoutsAndOpsRouter.delete('/api/teams/:teamId/workouts/blocks/:blockId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Update Single Broadcast Workout on Team Calendar
workoutsAndOpsRouter.put('/api/teams/:teamId/workouts/:broadcastId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Recall / Delete Single Broadcast Workout from Team Calendar
workoutsAndOpsRouter.delete('/api/teams/:teamId/workouts/:broadcastId', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Reusable Team Workout Library (Coach programming roles only for mutations)
workoutsAndOpsRouter.get('/api/teams/:teamId/workout-library', async (req: Request, res: Response) => {
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

workoutsAndOpsRouter.post('/api/teams/:teamId/workout-library', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

workoutsAndOpsRouter.delete(
  '/api/teams/:teamId/workout-library/:templateId',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const originUrl = resolveTrustedRequestOrigin(req);
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

// Logged Workout Comments with Mandatory U18 Guardian CC (SafeSport MAAPP)
workoutsAndOpsRouter.get('/api/teams/:teamId/comments', async (req: Request, res: Response) => {
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

workoutsAndOpsRouter.post('/api/teams/:teamId/comments', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
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

// Attendance & GPS Geofence Self Check-In
workoutsAndOpsRouter.post('/api/teams/:teamId/attendance', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      date?: unknown;
      entries?: Array<{ membershipId?: unknown; status?: unknown; note?: unknown }>;
    };
    const entries = Array.isArray(body.entries)
      ? body.entries.map((entry) => ({
          membershipId: String(entry?.membershipId || ''),
          status: String(entry?.status || 'PRESENT') as TeamAttendanceStatus,
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

workoutsAndOpsRouter.post('/api/teams/:teamId/attendance/self-checkin', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const rl = await checkDistributedRateLimitAsync(
      `gps_checkin_u:${claims.sid}`,
      10,
      10 * 60 * 1000
    );
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSecs || 1));
      res.status(429).json({
        ok: false,
        verifiedOnSite: false,
        error: 'Too many GPS self check-in attempts. Please wait a few minutes and try again.',
        retryAfterSecs: rl.retryAfterSecs,
      });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      date?: unknown;
      venueId?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      accuracyMeters?: unknown;
    };
    const parseCoord = (raw: unknown): number => {
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
      return Number.NaN;
    };
    const parsedAccuracy = parseCoord(body.accuracyMeters);
    const result = await selfCheckInTeamAttendance({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      date: typeof body.date === 'string' ? body.date : undefined,
      venueId: typeof body.venueId === 'string' ? body.venueId : undefined,
      latitude: parseCoord(body.latitude),
      longitude: parseCoord(body.longitude),
      accuracyMeters: Number.isFinite(parsedAccuracy) ? parsedAccuracy : undefined,
      originUrl,
    });
    if (!result.ok) {
      res.status(result.statusCode || 400).json({
        ok: false,
        verifiedOnSite: false,
        ...(typeof result.distanceMeters === 'number' ? { distanceMeters: result.distanceMeters } : {}),
        ...(typeof result.radiusMeters === 'number' ? { radiusMeters: result.radiusMeters } : {}),
        ...(result.venueId ? { venueId: result.venueId } : {}),
        ...(result.venueName ? { venueName: result.venueName } : {}),
        error: result.error || 'Practice geofence check-in failed.',
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      verifiedOnSite: true,
      distanceMeters: result.distanceMeters,
      radiusMeters: result.radiusMeters,
      venueId: result.venueId,
      venueName: result.venueName,
      record: result.record,
      team: result.team,
      teams,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      verifiedOnSite: false,
      error: err instanceof Error ? err.message : 'Failed GPS practice check-in.',
    });
  }
});

// Field Marks Read & Batch Recording
workoutsAndOpsRouter.get('/api/teams/:teamId/field-marks', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const eventCode =
      typeof req.query.eventCode === 'string' && req.query.eventCode.trim()
        ? req.query.eventCode.trim().toUpperCase()
        : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const rawOffset = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;
    const result = await listTeamFieldMarks({
      teamId: String(req.params.teamId || ''),
      callerSid: claims.sid,
      ...(eventCode ? { eventCode } : {}),
      ...(typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? { limit: rawLimit } : {}),
      ...(typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? { offset: rawOffset } : {}),
    });
    if (!result.ok) {
      const status = result.error === 'Team not found.' ? 404 : 403;
      res.status(status).json({
        ok: false,
        error: result.error || 'Unable to list field marks.',
      });
      return;
    }
    res.json({
      ok: true,
      logs: result.logs,
      totalCount: result.totalCount,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading field marks.',
    });
  }
});

workoutsAndOpsRouter.post('/api/teams/:teamId/field-marks', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const originUrl = resolveTrustedRequestOrigin(req);
    const body = (req.body || {}) as {
      clientBatchId?: unknown;
      entries?: Array<{
        membershipId?: unknown;
        athleteName?: unknown;
        date?: unknown;
        eventCode?: unknown;
        isCompetition?: unknown;
        meetOrPracticeTitle?: unknown;
        flightName?: unknown;
        implementSpec?: unknown;
        poleSpec?: unknown;
        approachSteps?: unknown;
        attempts?: unknown;
        bestMarkMeters?: unknown;
        bestWindLegalMeters?: unknown;
        bestMarkWindMps?: unknown;
        isWindAidedBest?: unknown;
        isNoHeight?: unknown;
        missesAtClearingHeight?: unknown;
        totalVerticalMisses?: unknown;
        placeRank?: unknown;
        advancedToFinals?: unknown;
        multiPoints?: unknown;
        rpe?: unknown;
        clientBatchId?: unknown;
      }>;
    };
    const topClientBatchId =
      typeof body.clientBatchId === 'string' ? body.clientBatchId : undefined;
    const entries = Array.isArray(body.entries)
      ? body.entries.map((entry) => ({
          membershipId: typeof entry?.membershipId === 'string' ? entry.membershipId : undefined,
          athleteName: String(entry?.athleteName || ''),
          date: String(entry?.date || ''),
          eventCode: String(entry?.eventCode || 'LJ') as FieldEventCode,
          isCompetition: entry?.isCompetition === true,
          meetOrPracticeTitle:
            typeof entry?.meetOrPracticeTitle === 'string' ? entry.meetOrPracticeTitle : undefined,
          flightName: typeof entry?.flightName === 'string' ? entry.flightName : undefined,
          implementSpec: typeof entry?.implementSpec === 'string' ? entry.implementSpec : undefined,
          poleSpec: typeof entry?.poleSpec === 'string' ? entry.poleSpec : undefined,
          approachSteps: typeof entry?.approachSteps === 'number' ? entry.approachSteps : undefined,
          attempts: Array.isArray(entry?.attempts) ? (entry.attempts as FieldTrialEntry[]) : [],
          bestMarkMeters:
            typeof entry?.bestMarkMeters === 'number' ? entry.bestMarkMeters : undefined,
          bestWindLegalMeters:
            typeof entry?.bestWindLegalMeters === 'number' ? entry.bestWindLegalMeters : undefined,
          bestMarkWindMps:
            typeof entry?.bestMarkWindMps === 'number' ? entry.bestMarkWindMps : undefined,
          isWindAidedBest:
            typeof entry?.isWindAidedBest === 'boolean' ? entry.isWindAidedBest : undefined,
          isNoHeight: typeof entry?.isNoHeight === 'boolean' ? entry.isNoHeight : undefined,
          missesAtClearingHeight:
            typeof entry?.missesAtClearingHeight === 'number'
              ? entry.missesAtClearingHeight
              : undefined,
          totalVerticalMisses:
            typeof entry?.totalVerticalMisses === 'number' ? entry.totalVerticalMisses : undefined,
          placeRank: typeof entry?.placeRank === 'number' ? entry.placeRank : undefined,
          advancedToFinals:
            typeof entry?.advancedToFinals === 'boolean' ? entry.advancedToFinals : undefined,
          multiPoints: typeof entry?.multiPoints === 'number' ? entry.multiPoints : undefined,
          rpe: typeof entry?.rpe === 'number' ? entry.rpe : undefined,
          clientBatchId:
            typeof entry?.clientBatchId === 'string' ? entry.clientBatchId : topClientBatchId,
        }))
      : [];
    const result = await recordTeamFieldMarks({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
      clientBatchId: topClientBatchId,
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
