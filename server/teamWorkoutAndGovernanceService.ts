import crypto from 'crypto';
import {
  sanitizeTelemetryForCleanRoom,
  stripSafeSportWeightAndBodyCompFields,
} from './cleanRoomFirewall.ts';
import { archiveCoachActivitiesForMember } from './athleteArchiveHelper.ts';
import { escapeHtml } from './securityUtils.ts';
import { evaluateSafeSportPatternWatch } from '../src/physiology/safeSportPatternWatchEngine.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import {
  appendAuditLogAsync,
  listTeamAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withTeamRowLock,
} from './tokenVault.ts';
import {
  sanitizePracticeVenueCategory,
  sanitizeScheduledTime,
  sanitizeSessionSlot,
} from '../src/utils/workoutScheduleUtils.ts';
import { isResendConfigured, sendEmailViaResend } from './teamEmailAndOtpService.ts';
import {
  canProgramWorkoutsRole,
  canViewAuditLogRole,
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  maskEmailForDisplay,
  projectTeamSummaryForCaller,
  sanitizeTargetEventGroups,
  saveTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
  type StoredMembershipInternal,
  type StoredTeamDocument,
  type UserTeamsIndex,
} from './teamStoreCore.ts';
import type {
  CoachDataSharingTier,
  CoachEventGroup,
  GuardianSafetyAlertRecord,
  PracticeVenueCategory,
  SessionCheckInRecord,
  SportCategory,
  TeamAthleteLiveSnapshot,
  TeamAuditLogEntry,
  TeamBroadcastWorkout,
  TeamSummaryWithRole,
  TeamWorkoutComment,
  TeamWorkoutLibraryCategory,
  TeamWorkoutLibraryTemplate,
  TrackWorkoutSpec,
  UnifiedActivity,
  WorkoutSessionSlot,
} from '../src/types.ts';

export async function updateTeamMemberEventGroup(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  membershipId: string;
  eventGroup: CoachEventGroup | null;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const targetMem = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== 'REVOKED'
    );
    if (!targetMem) return null;

    targetMem.eventGroup = params.eventGroup || undefined;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function broadcastWorkoutToTeamSquad(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  targetSquadGroup: string;
  targetEventGroups?: CoachEventGroup[];
  targetMembershipIds?: string[];
  date: string;
  name: string;
  sportCategory: SportCategory;
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  scheduledTime?: string;
  sessionSlot?: WorkoutSessionSlot;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  meetingNotes?: string;
  trackSpec?: TrackWorkoutSpec;
  athleteOverrides?: TeamBroadcastWorkout['athleteOverrides'];
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  replaceSameDateTarget?: boolean;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const cleanTargets = Array.isArray(params.targetMembershipIds)
      ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const cleanEventGroups = sanitizeTargetEventGroups(params.targetEventGroups);
    const dateStr = String(params.date || nowIso.slice(0, 10)).slice(0, 10);
    const targetSquadGroup = String(params.targetSquadGroup || 'ALL').trim() || 'ALL';
    const scheduledTime = sanitizeScheduledTime(params.scheduledTime);
    const sessionSlot = sanitizeSessionSlot(params.sessionSlot);
    const locationName = params.locationName
      ? String(params.locationName).trim().slice(0, 120)
      : undefined;
    const locationCategory = sanitizePracticeVenueCategory(params.locationCategory);
    const meetingNotes = params.meetingNotes
      ? String(params.meetingNotes).trim().slice(0, 240)
      : undefined;

    const workout: TeamBroadcastWorkout = {
      broadcastId: `bw_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      targetSquadGroup,
      ...(cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {}),
      ...(cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {}),
      date: dateStr,
      name: String(params.name || 'Team Prescribed Session').trim().slice(0, 100),
      sportCategory: params.sportCategory || 'Running',
      plannedDurationSecs: Math.max(300, Number(params.plannedDurationSecs) || 3600),
      plannedLoad: Math.max(5, Number(params.plannedLoad) || 65),
      workoutSyntax: String(params.workoutSyntax || '').slice(0, 3000),
      description: String(params.description || '').slice(0, 1000),
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(sessionSlot ? { sessionSlot } : {}),
      ...(locationName ? { locationName } : {}),
      ...(locationCategory ? { locationCategory } : {}),
      ...(meetingNotes ? { meetingNotes } : {}),
      ...(params.trackSpec ? { trackSpec: params.trackSpec } : {}),
      ...(params.athleteOverrides && Object.keys(params.athleteOverrides).length > 0
        ? { athleteOverrides: params.athleteOverrides }
        : {}),
      ...(params.planBlockId ? { planBlockId: String(params.planBlockId).slice(0, 80) } : {}),
      ...(params.planBlockName ? { planBlockName: String(params.planBlockName).slice(0, 120) } : {}),
      ...(typeof params.planWeekNum === 'number' ? { planWeekNum: params.planWeekNum } : {}),
      ...(params.publishMode ? { publishMode: params.publishMode } : {}),
      pushedByCoachName: callerMem.invitedName || doc.brand.coachDisplayName,
      createdAt: nowIso,
    };

    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const nextSlot = workout.sessionSlot || 'SINGLE';
    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceSameDateTarget === false) return true;
      const sameDate = bw.date === dateStr;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers =
        JSON.stringify((bw.targetMembershipIds || []).slice().sort()) ===
        JSON.stringify((cleanTargets || []).slice().sort());
      const sameSlot = (bw.sessionSlot || 'SINGLE') === nextSlot;
      const sameSport = (bw.sportCategory || 'Running') === workout.sportCategory;
      return !(sameDate && sameSquad && sameGroups && sameMembers && sameSlot && sameSport);
    });

    doc.broadcastWorkouts = [workout, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function broadcastWorkoutBatchToTeamSquad(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  targetSquadGroup: string;
  targetEventGroups?: CoachEventGroup[];
  targetMembershipIds?: string[];
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  planBlockId?: string;
  planBlockName?: string;
  replaceExistingCohortRange?: boolean;
  workouts: Array<{
    date: string;
    name: string;
    sportCategory: SportCategory;
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    planWeekNum?: number;
  }>;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const cleanTargets = Array.isArray(params.targetMembershipIds)
      ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const cleanEventGroups = sanitizeTargetEventGroups(params.targetEventGroups);
    const targetSquadGroup = String(params.targetSquadGroup || 'ALL').trim() || 'ALL';
    const cleanBlockId = params.planBlockId
      ? String(params.planBlockId).slice(0, 80)
      : `tm-blk-${Date.now()}`;
    const cleanBlockName = params.planBlockName
      ? String(params.planBlockName).slice(0, 120)
      : undefined;
    const publishMode =
      params.publishMode === 'ROLLING_1W' ||
      params.publishMode === 'ROLLING_2W' ||
      params.publishMode === 'FULL_BLOCK'
        ? params.publishMode
        : 'FULL_BLOCK';

    const createdWorkouts: TeamBroadcastWorkout[] = (params.workouts || [])
      .slice(0, 160)
      .map((w) => {
        const scheduledTime = sanitizeScheduledTime(w.scheduledTime);
        const sessionSlot = sanitizeSessionSlot(w.sessionSlot);
        const locationName = w.locationName ? String(w.locationName).trim().slice(0, 120) : undefined;
        const locationCategory = sanitizePracticeVenueCategory(w.locationCategory);
        const meetingNotes = w.meetingNotes ? String(w.meetingNotes).trim().slice(0, 240) : undefined;
        return {
          broadcastId: `bw_${crypto.randomBytes(6).toString('hex')}`,
          teamId: doc.brand.teamId,
          targetSquadGroup,
          ...(cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {}),
          ...(cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {}),
          date: String(w.date || nowIso.slice(0, 10)).slice(0, 10),
          name: String(w.name || 'Team Prescribed Session').trim().slice(0, 100),
          sportCategory: w.sportCategory || 'Running',
          plannedDurationSecs: Math.max(300, Number(w.plannedDurationSecs) || 3600),
          plannedLoad: Math.max(5, Number(w.plannedLoad) || 65),
          workoutSyntax: String(w.workoutSyntax || '').slice(0, 3000),
          description: String(w.description || '').slice(0, 1000),
          ...(scheduledTime ? { scheduledTime } : {}),
          ...(sessionSlot ? { sessionSlot } : {}),
          ...(locationName ? { locationName } : {}),
          ...(locationCategory ? { locationCategory } : {}),
          ...(meetingNotes ? { meetingNotes } : {}),
          ...(w.trackSpec ? { trackSpec: w.trackSpec } : {}),
          planBlockId: cleanBlockId,
          ...(cleanBlockName ? { planBlockName: cleanBlockName } : {}),
          ...(typeof w.planWeekNum === 'number' ? { planWeekNum: w.planWeekNum } : {}),
          publishMode,
          pushedByCoachName: doc.brand.coachDisplayName,
          createdAt: nowIso,
        };
      });

    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const membersSignature = JSON.stringify((cleanTargets || []).slice().sort());
    const dates = createdWorkouts.map((c) => c.date).sort();
    const minDate = dates[0] || '';
    const maxDate = dates[dates.length - 1] || '';

    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceExistingCohortRange === false || !minDate || !maxDate) return true;
      const inRange = bw.date >= minDate && bw.date <= maxDate;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers = JSON.stringify((bw.targetMembershipIds || []).slice().sort()) === membersSignature;
      return !(inRange && sameSquad && sameGroups && sameMembers);
    });

    doc.broadcastWorkouts = [...createdWorkouts, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function updateBroadcastWorkoutOnTeam(params: {
  callerSid: string;
  teamId: string;
  broadcastId: string;
  originUrl: string;
  updates: {
    date?: string;
    name?: string;
    sportCategory?: SportCategory;
    plannedDurationSecs?: number;
    plannedLoad?: number;
    workoutSyntax?: string;
    description?: string;
    scheduledTime?: string | null;
    sessionSlot?: WorkoutSessionSlot | null;
    locationName?: string | null;
    locationCategory?: PracticeVenueCategory | null;
    meetingNotes?: string | null;
    trackSpec?: TrackWorkoutSpec | null;
  };
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const cleanId = String(params.broadcastId || '').trim();
    const list = Array.isArray(doc.broadcastWorkouts) ? doc.broadcastWorkouts : [];
    const targetIdx = list.findIndex((bw) => bw.broadcastId === cleanId);
    if (targetIdx === -1) return null;

    const existing = list[targetIdx];
    const u = params.updates || {};
    const updatedWorkout: TeamBroadcastWorkout = {
      ...existing,
      ...(typeof u.date === 'string' && u.date.trim() ? { date: u.date.trim().slice(0, 10) } : {}),
      ...(typeof u.name === 'string' && u.name.trim()
        ? { name: u.name.trim().slice(0, 100) }
        : {}),
      ...(u.sportCategory ? { sportCategory: u.sportCategory } : {}),
      ...(typeof u.plannedDurationSecs === 'number' && Number.isFinite(u.plannedDurationSecs)
        ? { plannedDurationSecs: Math.max(60, Math.round(u.plannedDurationSecs)) }
        : {}),
      ...(typeof u.plannedLoad === 'number' && Number.isFinite(u.plannedLoad)
        ? { plannedLoad: Math.max(1, Math.round(u.plannedLoad)) }
        : {}),
      ...(typeof u.workoutSyntax === 'string'
        ? { workoutSyntax: u.workoutSyntax.slice(0, 3000) }
        : {}),
      ...(typeof u.description === 'string'
        ? { description: u.description.slice(0, 1000) }
        : {}),
      ...(u.trackSpec === null ? { trackSpec: undefined } : u.trackSpec ? { trackSpec: u.trackSpec } : {}),
    };

    if ('scheduledTime' in u) {
      const cleanTime = sanitizeScheduledTime(u.scheduledTime ?? undefined);
      if (cleanTime) updatedWorkout.scheduledTime = cleanTime;
      else delete updatedWorkout.scheduledTime;
    }
    if ('sessionSlot' in u) {
      const cleanSlot = sanitizeSessionSlot(u.sessionSlot ?? undefined);
      if (cleanSlot) updatedWorkout.sessionSlot = cleanSlot;
      else delete updatedWorkout.sessionSlot;
    }
    if ('locationName' in u) {
      const cleanLoc = u.locationName ? String(u.locationName).trim().slice(0, 120) : '';
      if (cleanLoc) updatedWorkout.locationName = cleanLoc;
      else delete updatedWorkout.locationName;
    }
    if ('locationCategory' in u) {
      const cleanCat = sanitizePracticeVenueCategory(u.locationCategory ?? undefined);
      if (cleanCat) updatedWorkout.locationCategory = cleanCat;
      else delete updatedWorkout.locationCategory;
    }
    if ('meetingNotes' in u) {
      const cleanNotes = u.meetingNotes ? String(u.meetingNotes).trim().slice(0, 240) : '';
      if (cleanNotes) updatedWorkout.meetingNotes = cleanNotes;
      else delete updatedWorkout.meetingNotes;
    }

    doc.broadcastWorkouts = [
      ...list.slice(0, targetIdx),
      updatedWorkout,
      ...list.slice(targetIdx + 1),
    ];
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function deleteBroadcastPlanBlockFromTeam(params: {
  callerSid: string;
  teamId: string;
  blockId: string;
  originUrl: string;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const cleanBlockId = String(params.blockId || '').trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.planBlockId !== cleanBlockId
    );
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function deleteBroadcastWorkoutFromTeam(params: {
  callerSid: string;
  teamId: string;
  broadcastId: string;
  originUrl: string;
}): Promise<TeamSummaryWithRole | null> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const cleanBroadcastId = String(params.broadcastId || '').trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.broadcastId !== cleanBroadcastId
    );
    doc.updatedAt = new Date().toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);

    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}

export async function recordCoachStopwatchActivities(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>;
}): Promise<TeamSummaryWithRole | null> {
  const archiveQueue: Array<{
    member: StoredMembershipInternal;
    activity: UnifiedActivity;
  }> = [];

  const summary = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }

    const nowIso = new Date().toISOString();
    for (const entry of params.entries || []) {
      const cleanId = String(entry?.membershipId || '').trim();
      const rawAct = entry?.activity;
      if (!cleanId || !rawAct || !rawAct.id) continue;

      const mem = doc.memberships.find(
        (m) => m.membershipId === cleanId && m.status !== 'REVOKED'
      );
      if (!mem) continue;

      const enforceHideWeight = Boolean(doc.brand.defaultSafeSportShield || mem.isMinorU18);
      const cleanList = (sanitizeTelemetryForCleanRoom({ activities: [rawAct] }).activities ||
        []) as UnifiedActivity[];
      const safeAct = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(cleanList, { maskWellnessWeightKgZero: true })[0]
        : cleanList[0];
      if (!safeAct) continue;

      const prevRecorded = Array.isArray(mem.coachRecordedActivities)
        ? mem.coachRecordedActivities
        : [];
      mem.coachRecordedActivities = [
        safeAct,
        ...prevRecorded.filter((a) => a.id !== safeAct.id),
      ].slice(0, 50);

      archiveQueue.push({ member: { ...mem }, activity: safeAct });

      const baseSnap: TeamAthleteLiveSnapshot = mem.liveSnapshot || {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: 'Coach Track Session',
        readinessScore: 80,
        ctl: 0,
        atl: 0,
        tsb: 0,
        acuteLoad7d: 0,
        lowAerobicPct: 80,
        highAerobicPct: 15,
        neuromuscularPct: 5,
        caraHours7d: 0,
        safeSportHideWeight: enforceHideWeight,
        sharingTier: mem.sharingTier || 'SUMMARY_ONLY',
        activities: [],
      };
      const prevSnapActs = Array.isArray(baseSnap.activities) ? baseSnap.activities : [];
      mem.liveSnapshot = {
        ...baseSnap,
        updatedAt: nowIso,
        safeSportHideWeight: baseSnap.safeSportHideWeight || enforceHideWeight,
        activities: [safeAct, ...prevSnapActs.filter((a) => a.id !== safeAct.id)].slice(0, 30),
      };
    }

    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });

  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(item.member, [item.activity]).catch(() => undefined);
  }
  return summary;
}

/**
 * Produces coach-consented activity summaries according to the athlete's chosen sharing tier.
 * Always strips Strava social metadata (kudos, comments, segments), and strips GPS polylines/latlngs
 * unless the athlete explicitly selected `FULL_STREAMS` AND `privacySettings.shareGpsRoutes !== 'PRIVATE'`
 * on first-party/clean-room eligible workouts.
 */
function buildConsentedCoachActivities(
  rawActivities: UnifiedActivity[] | undefined,
  sharingTier: CoachDataSharingTier,
  allowGpsRoutes: boolean
): UnifiedActivity[] {
  if (!Array.isArray(rawActivities) || sharingTier === 'LOAD_ONLY') {
    return [];
  }
  const sortedNewestFirst = [...rawActivities].sort((a, b) =>
    String(b?.startDateLocal || '').localeCompare(String(a?.startDateLocal || ''))
  );
  const newest25 = sortedNewestFirst.slice(0, 25);
  const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
    activities: newest25,
  });
  const cleanRoomActivities = (
    Array.isArray(cleanRoomPayload.activities) ? cleanRoomPayload.activities : []
  ) as UnifiedActivity[];
  const firstPartyIds = new Set(
    cleanRoomActivities.map((a) => String(a?.id || ''))
  );

  // Clean-Room & Strava Nov 2024 API Compliance: never forward Strava-sourced activities
  // into cross-user coach snapshots; FULL_STREAMS unlocks 1Hz streams & GPS on first-party hardware only.
  const sourceList = cleanRoomActivities;

  return sourceList.map((act) => {
    const isFirstParty = firstPartyIds.has(String(act.id || ''));
    const includeGps = sharingTier === 'FULL_STREAMS' && allowGpsRoutes && isFirstParty;
    const sanitized: UnifiedActivity = {
      ...act,
      // Always strip Strava social/segment/gear payloads from cross-user coach snapshots (Strava Nov 2024 Developer Agreement Sec 5.3)
      kudoers: undefined,
      comments: undefined,
      segmentEfforts: [],
      gearName: isFirstParty ? act.gearName : undefined,
      summaryPolyline: includeGps ? act.summaryPolyline : undefined,
      routeLatLngs: includeGps ? act.routeLatLngs : undefined,
      startLatLng: includeGps ? act.startLatLng : undefined,
      endLatLng: includeGps ? act.endLatLng : undefined,
      streams: sharingTier === 'FULL_STREAMS' && isFirstParty ? act.streams : undefined,
    };
    return sanitized;
  });
}

export async function syncAthleteSnapshotAcrossTeams(params: {
  callerSid: string;
  originUrl: string;
  athleteName?: string;
  verifiedUserBirthMonthYear?: string;
  snapshot: Partial<TeamAthleteLiveSnapshot>;
}): Promise<TeamSummaryWithRole[]> {
  const userIdx = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(params.callerSid),
    {
      teamIds: [],
      updatedAt: '',
    }
  );
  if (userIdx.teamIds.length === 0) return [];

  const nowIso = new Date().toISOString();
  const summaries: TeamSummaryWithRole[] = [];

  for (const teamId of userIdx.teamIds) {
    const proj = await withTeamRowLock(teamId, async () => {
      const doc = await loadTenantVaultAsync<StoredTeamDocument | null>(
        teamDocVaultKey(teamId),
        null
      );
      if (!doc) return null;

      const mem = doc.memberships.find(
        (m) =>
          m.userSid === params.callerSid &&
          m.status !== 'REVOKED' &&
          m.status !== 'ALUMNI'
      );
      if (!mem) return null;

      const canonicalBirthMonthYear =
        mem.birthMonthYear ||
        params.verifiedUserBirthMonthYear ||
        (mem.isMinorU18 || mem.birthYear ? undefined : params.snapshot.birthMonthYear);
      const ageCompliance = resolveAthleteAgeTier({
        birthMonthYear: canonicalBirthMonthYear,
        birthYear: mem.birthYear,
        orgType: doc.brand.orgType,
        graduationYear: mem.graduationYear,
        now: nowIso,
      });

      // Automatic High School senior graduation rollover after July 15 -> stop leaking live biometrics
      if (ageCompliance.shouldAutoGraduateHs) {
        mem.status = 'ALUMNI';
        mem.graduatedAt = nowIso;
        mem.liveSnapshot = undefined;
        doc.updatedAt = nowIso;
        await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
        return null;
      }

      const effectiveIsMinor =
        ageCompliance.ageTier === 'UNKNOWN'
          ? Boolean(mem.isMinorU18)
          : ageCompliance.isMinorU18;
      mem.isMinorU18 = effectiveIsMinor;
      if (ageCompliance.birthMonthYear && !mem.birthMonthYear) {
        mem.birthMonthYear = ageCompliance.birthMonthYear;
      }
      if (ageCompliance.ageTier === 'ADULT_18_PLUS' && mem.parentConsentStatus === 'PENDING') {
        mem.parentConsentStatus = 'NOT_REQUIRED';
        mem.parentConsentToken = undefined;
        mem.parentConsentTokenHash = undefined;
      }

      const quarantineMinorPendingConsent = Boolean(
        effectiveIsMinor && mem.parentConsentStatus !== 'ACKNOWLEDGED'
      );

      let effectiveTier: CoachDataSharingTier = quarantineMinorPendingConsent
        ? 'LOAD_ONLY'
        : params.snapshot.sharingTier || mem.sharingTier || 'SUMMARY_ONLY';
      if (params.snapshot.sharingTier && !quarantineMinorPendingConsent) {
        mem.sharingTier = params.snapshot.sharingTier;
      } else if (!mem.sharingTier) {
        mem.sharingTier = effectiveTier;
      }

      const enforceHideWeight = Boolean(
        doc.brand.defaultSafeSportShield ||
          effectiveIsMinor ||
          params.snapshot.safeSportHideWeight
      );

      const priv = params.snapshot.privacySettings;
      const hidePrivateWellness = priv?.shareWellnessAndHrv === 'PRIVATE';
      const allowGpsRoutes =
        !priv || (priv.shareGpsRoutes !== 'PRIVATE' && !priv.stravaComplianceShield);

      const rawCoachActivities = buildConsentedCoachActivities(
        params.snapshot.activities,
        effectiveTier,
        allowGpsRoutes
      );
      const coachActivities = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(rawCoachActivities, {
            maskWellnessWeightKgZero: true,
          })
        : rawCoachActivities;

      const rawSanitizedWellness =
        quarantineMinorPendingConsent ||
        hidePrivateWellness ||
        !Array.isArray(params.snapshot.wellnessDays)
          ? undefined
          : params.snapshot.wellnessDays.slice(-56);
      const sanitizedWellness =
        rawSanitizedWellness && enforceHideWeight
          ? stripSafeSportWeightAndBodyCompFields(rawSanitizedWellness, {
              maskWellnessWeightKgZero: true,
            })
          : rawSanitizedWellness;

      const watchReport = evaluateSafeSportPatternWatch({
        activities: params.snapshot.activities || [],
        wellnessDays: rawSanitizedWellness,
        isMinorU18: effectiveIsMinor,
        hasParentGuardianCc: Boolean(mem.parentGuardianEmail && effectiveIsMinor),
        hasAthleticTrainer: doc.brand.orgType === 'HIGH_SCHOOL' || doc.brand.orgType === 'COLLEGIATE',
      });

      if (params.athleteName?.trim() && mem.invitedName === 'Team Athlete') {
        mem.invitedName = params.athleteName.trim().slice(0, 64);
      }

      const sanitizedCheckIns: SessionCheckInRecord[] | undefined =
        quarantineMinorPendingConsent || hidePrivateWellness
          ? undefined
          : Array.isArray(params.snapshot.sessionCheckIns)
            ? params.snapshot.sessionCheckIns.slice(0, 28).map((c) => {
                const validArea =
                  c?.painArea === 'KNEE' ||
                  c?.painArea === 'SHIN' ||
                  c?.painArea === 'ACHILLES' ||
                  c?.painArea === 'HAMSTRING' ||
                  c?.painArea === 'HIP' ||
                  c?.painArea === 'FOOT' ||
                  c?.painArea === 'BACK' ||
                  c?.painArea === 'OTHER'
                    ? c.painArea
                    : undefined;
                const validLegFeel =
                  c?.legFeel === 'FRESH' || c?.legFeel === 'NORMAL' || c?.legFeel === 'HEAVY'
                    ? c.legFeel
                    : undefined;
                const validRitualSlot =
                  c?.ritualSlot === 'MORNING' ||
                  c?.ritualSlot === 'POST_SESSION' ||
                  c?.ritualSlot === 'TONIGHT'
                    ? c.ritualSlot
                    : undefined;
                const rawSleepTarget = Number(c?.sleepTargetHours);
                const validSleepTarget =
                  Number.isFinite(rawSleepTarget) && rawSleepTarget >= 5 && rawSleepTarget <= 12
                    ? Number(rawSleepTarget.toFixed(1))
                    : undefined;
                return {
                  id: String(c?.id || `chk-${Date.now()}`).slice(0, 64),
                  date: String(c?.date || nowIso.slice(0, 10)).slice(0, 10),
                  ...(c?.plannedEventId ? { plannedEventId: String(c.plannedEventId).slice(0, 64) } : {}),
                  ...(c?.workoutName ? { workoutName: String(c.workoutName).slice(0, 100) } : {}),
                  rpe: Math.max(1, Math.min(10, Math.round(Number(c?.rpe) || 5))),
                  painFlag: Boolean(c?.painFlag),
                  ...(validArea ? { painArea: validArea } : {}),
                  ...(c?.sorenessNote ? { sorenessNote: String(c.sorenessNote).slice(0, 140) } : {}),
                  ...(c?.autoSwappedToRecovery ? { autoSwappedToRecovery: true } : {}),
                  ...(validLegFeel ? { legFeel: validLegFeel } : {}),
                  ...(c?.lifeStressFlag ? { lifeStressFlag: true } : {}),
                  ...(validSleepTarget ? { sleepTargetHours: validSleepTarget } : {}),
                  ...(c?.tomorrowLocked ? { tomorrowLocked: true } : {}),
                  ...(validRitualSlot ? { ritualSlot: validRitualSlot } : {}),
                  createdAt: String(c?.createdAt || nowIso).slice(0, 40),
                };
              })
            : mem.liveSnapshot?.sessionCheckIns;

      const assembledSnapshot: TeamAthleteLiveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: Boolean(params.snapshot.hasConnectedWatch),
        verdictLabel: quarantineMinorPendingConsent
          ? 'Awaiting Parent Consent'
          : String(params.snapshot.verdictLabel || 'Active').slice(0, 48),
        readinessScore: quarantineMinorPendingConsent
          ? 0
          : Number(params.snapshot.readinessScore ?? 0),
        ctl: Number(params.snapshot.ctl ?? 0),
        atl: Number(params.snapshot.atl ?? 0),
        tsb: Number(params.snapshot.tsb ?? 0),
        acuteLoad7d: Number(params.snapshot.acuteLoad7d ?? 0),
        lowAerobicPct: Number(params.snapshot.lowAerobicPct ?? 0),
        highAerobicPct: Number(params.snapshot.highAerobicPct ?? 0),
        neuromuscularPct: Number(params.snapshot.neuromuscularPct ?? 0),
        caraHours7d: Number(params.snapshot.caraHours7d ?? 0),
        ftpWatts: params.snapshot.ftpWatts,
        thresholdPaceSecsPerKm: params.snapshot.thresholdPaceSecsPerKm,
        safeSportHideWeight: enforceHideWeight,
        sharingTier: effectiveTier,
        privacySettings: priv,
        wellnessDays: sanitizedWellness,
        activities: coachActivities,
        ...(sanitizedCheckIns && sanitizedCheckIns.length > 0
          ? { sessionCheckIns: sanitizedCheckIns }
          : {}),
        safeSportWatch: {
          trafficLight: watchReport.trafficLight,
          coachSafeSummaryLabel: watchReport.coachSafeSummaryLabel,
          privateAlertForSelfAndParentOnly: watchReport,
        },
      };
      mem.liveSnapshot = enforceHideWeight
        ? stripSafeSportWeightAndBodyCompFields(assembledSnapshot, {
            maskWellnessWeightKgZero: true,
          })
        : assembledSnapshot;

      const latestPainCheckIn = Array.isArray(params.snapshot.sessionCheckIns)
        ? params.snapshot.sessionCheckIns.find((c) => Boolean(c?.painFlag))
        : undefined;
      if (
        latestPainCheckIn &&
        (effectiveIsMinor || doc.brand.orgType === 'HIGH_SCHOOL')
      ) {
        const painCheckInId = String(latestPainCheckIn.id || '').slice(0, 64);
        const existingAlerts = Array.isArray(doc.guardianSafetyAlerts)
          ? doc.guardianSafetyAlerts
          : [];
        const alreadyRecorded =
          Boolean(painCheckInId) &&
          existingAlerts.some(
            (a) =>
              a.sourceCheckInId === painCheckInId &&
              a.targetMembershipId === mem.membershipId
          );
        if (!alreadyRecorded) {
          const painArea = latestPainCheckIn.painArea || 'OTHER';
          const guardianEmail = mem.parentGuardianEmail?.trim().toLowerCase();
          let deliveryStatus: GuardianSafetyAlertRecord['deliveryStatus'] =
            guardianEmail ? 'LOCAL_LOGGED' : 'NO_GUARDIAN_ON_FILE';
          const alertSummary = `${mem.invitedName} flagged ${painArea} pain (${latestPainCheckIn.autoSwappedToRecovery ? 'auto-swapped to low-impact recovery' : 'safety review requested'}).`;
          if (guardianEmail && isResendConfigured()) {
            const sendRes = await sendEmailViaResend({
              to: guardianEmail,
              subject: `[THRESH Safety Alert] ${mem.invitedName} · ${doc.brand.shortName}`,
              html: `<p>${escapeHtml(alertSummary)}</p><p>Logged inside ${escapeHtml(doc.brand.name)} under U18 Safe-Sport &amp; Guardian visibility.</p>`,
              text: `${alertSummary}\nTeam: ${doc.brand.name}`,
            });
            deliveryStatus = sendRes.delivered ? 'SENT' : 'LOCAL_LOGGED';
          }
          const alertRecord: GuardianSafetyAlertRecord = {
            id: `gsa_${crypto.randomBytes(6).toString('hex')}`,
            teamId: doc.brand.teamId,
            targetMembershipId: mem.membershipId,
            athleteName: mem.invitedName,
            ...(painCheckInId ? { sourceCheckInId: painCheckInId } : {}),
            severity: 'CAUTION',
            category: 'PAIN_FLAG',
            summary: alertSummary,
            painLocation: painArea,
            guardianEmailMasked: maskEmailForDisplay(guardianEmail),
            deliveryStatus,
            createdAt: nowIso,
          };
          doc.guardianSafetyAlerts = [alertRecord, ...existingAlerts].slice(0, 120);
          await appendAuditLogAsync({
            teamId: doc.brand.teamId,
            actorSid: params.callerSid,
            action: 'GUARDIAN_SAFETY_ALERT',
            targetId: mem.membershipId,
            metadata: {
              category: alertRecord.category,
              painLocation: painArea,
              deliveryStatus,
            },
          });
        }
      }

      doc.updatedAt = nowIso;
      await saveTeamDocRaw(teamId, doc);
      return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    });
    if (proj) summaries.push(proj);
  }

  return summaries;
}

/**
 * Allows coaching/athletic training staff or an athlete to record a guardian-visible safety alert
 * (e.g., pain flag, high ACWR strain, or medical return-to-play caution).
 */
export async function recordGuardianSafetyAlert(params: {
  callerSid: string;
  teamId: string;
  targetMembershipId: string;
  category: GuardianSafetyAlertRecord['category'];
  severity: GuardianSafetyAlertRecord['severity'];
  summary: string;
  painLocation?: string;
  originUrl: string;
}): Promise<{
  ok: boolean;
  alert?: GuardianSafetyAlertRecord;
  summary?: TeamSummaryWithRole | null;
  error?: string;
}> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem) return { ok: false, error: 'Not a member of this team.' };

    const target = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== 'REVOKED'
    );
    if (!target) return { ok: false, error: 'Target athlete not found.' };

    const isSelf = target.userSid === params.callerSid;
    if (!isSelf && !canViewSafeguardingMedicalRole(callerMem.role)) {
      return { ok: false, error: 'Coach or Athletic Trainer permission required.' };
    }

    const nowIso = new Date().toISOString();
    const guardianEmail = target.parentGuardianEmail?.trim().toLowerCase();
    const cleanSummary = String(params.summary || '').trim().slice(0, 280);
    if (!cleanSummary) {
      return { ok: false, error: 'Safety alert summary is required.' };
    }

    let deliveryStatus: GuardianSafetyAlertRecord['deliveryStatus'] =
      guardianEmail ? 'LOCAL_LOGGED' : 'NO_GUARDIAN_ON_FILE';
    if (guardianEmail && isResendConfigured()) {
      const sendRes = await sendEmailViaResend({
        to: guardianEmail,
        subject: `[THRESH Safety Alert] ${target.invitedName} · ${doc.brand.shortName}`,
        html: `<p>${escapeHtml(cleanSummary)}</p><p>Reported via ${escapeHtml(doc.brand.name)} Safeguarding Desk.</p>`,
        text: `${cleanSummary}\nTeam: ${doc.brand.name}`,
      });
      deliveryStatus = sendRes.delivered ? 'SENT' : 'LOCAL_LOGGED';
    }

    const alertRecord: GuardianSafetyAlertRecord = {
      id: `gsa_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      targetMembershipId: target.membershipId,
      athleteName: target.invitedName,
      severity: params.severity === 'HIGH' ? 'HIGH' : 'CAUTION',
      category:
        params.category === 'HIGH_STRAIN' || params.category === 'SAFE_SPORT_WATCH'
          ? params.category
          : 'PAIN_FLAG',
      summary: cleanSummary,
      ...(params.painLocation
        ? { painLocation: String(params.painLocation).trim().slice(0, 32) }
        : {}),
      guardianEmailMasked: maskEmailForDisplay(guardianEmail),
      deliveryStatus,
      createdAt: nowIso,
    };

    doc.guardianSafetyAlerts = [alertRecord, ...(doc.guardianSafetyAlerts || [])].slice(0, 120);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'GUARDIAN_SAFETY_ALERT',
      targetId: target.membershipId,
      metadata: {
        category: alertRecord.category,
        severity: alertRecord.severity,
        deliveryStatus,
      },
    });

    return {
      ok: true,
      alert: alertRecord,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function listTeamWorkoutLibrary(params: {
  callerSid: string;
  teamId: string;
}): Promise<{ ok: boolean; templates?: TeamWorkoutLibraryTemplate[]; error?: string }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, error: 'Team not found.' };
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem) return { ok: false, error: 'Membership required.' };
  return { ok: true, templates: doc.workoutLibrary || [] };
}

export async function saveTeamWorkoutLibraryTemplate(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  template: {
    id?: string;
    name: string;
    category: TeamWorkoutLibraryCategory;
    sportCategory: SportCategory;
    workoutSyntax: string;
    description: string;
    plannedDurationSecs: number;
    plannedLoad: number;
    trackSpec?: TrackWorkoutSpec;
  };
}): Promise<{
  ok: boolean;
  status?: number;
  template?: TeamWorkoutLibraryTemplate;
  summary?: TeamSummaryWithRole | null;
  error?: string;
}> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: 'Only Head or Assistant Coaches may edit the team Workout Library.',
      };
    }

    const cleanName = String(params.template.name || '').trim().slice(0, 100);
    if (!cleanName) {
      return { ok: false, status: 400, error: 'Template name is required.' };
    }
    const validCat: TeamWorkoutLibraryCategory =
      params.template.category === 'TRACK' ||
      params.template.category === 'XC_TEMPO' ||
      params.template.category === 'ROAD' ||
      params.template.category === 'CYCLING' ||
      params.template.category === 'SWIMMING' ||
      params.template.category === 'TRIATHLON' ||
      params.template.category === 'RECOVERY'
        ? params.template.category
        : 'TRACK';
    const nowIso = new Date().toISOString();
    const id = params.template.id
      ? String(params.template.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      : `wlib_${crypto.randomBytes(6).toString('hex')}`;

    const record: TeamWorkoutLibraryTemplate = {
      id: id || `wlib_${crypto.randomBytes(6).toString('hex')}`,
      name: cleanName,
      category: validCat,
      sportCategory: params.template.sportCategory || 'Running',
      workoutSyntax: String(params.template.workoutSyntax || '').slice(0, 3000),
      description: String(params.template.description || '').slice(0, 1000),
      plannedDurationSecs: Math.max(300, Number(params.template.plannedDurationSecs) || 2400),
      plannedLoad: Math.max(5, Number(params.template.plannedLoad) || 55),
      ...(params.template.trackSpec ? { trackSpec: params.template.trackSpec } : {}),
      createdByName: callerMem.invitedName || doc.brand.coachDisplayName,
      createdAt: nowIso,
    };

    const existing = Array.isArray(doc.workoutLibrary) ? doc.workoutLibrary : [];
    doc.workoutLibrary = [record, ...existing.filter((t) => t.id !== record.id)].slice(0, 120);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'WORKOUT_LIBRARY_SAVED',
      targetId: record.id,
      metadata: { name: record.name, category: record.category },
    });

    return {
      ok: true,
      template: record,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function deleteTeamWorkoutLibraryTemplate(params: {
  callerSid: string;
  teamId: string;
  templateId: string;
  originUrl: string;
}): Promise<{ ok: boolean; status?: number; summary?: TeamSummaryWithRole | null; error?: string }> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: 'Only Head or Assistant Coaches may delete Workout Library templates.',
      };
    }

    const cleanId = String(params.templateId || '').trim();
    doc.workoutLibrary = (doc.workoutLibrary || []).filter((t) => t.id !== cleanId);
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'WORKOUT_LIBRARY_DELETED',
      targetId: cleanId,
      metadata: {},
    });

    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function listTeamWorkoutComments(params: {
  callerSid: string;
  teamId: string;
  targetMembershipId?: string;
}): Promise<{ ok: boolean; comments?: TeamWorkoutComment[]; error?: string }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, error: 'Team not found.' };

  const summary = projectTeamSummaryForCaller(doc, params.callerSid, 'https://thresh.app');
  if (!summary) return { ok: false, error: 'Membership required.' };

  const allVisible = summary.workoutComments || [];
  const filtered = params.targetMembershipId
    ? allVisible.filter((c) => c.targetMembershipId === params.targetMembershipId)
    : allVisible;
  return { ok: true, comments: filtered };
}

export async function postTeamWorkoutComment(params: {
  callerSid: string;
  teamId: string;
  targetMembershipId: string;
  workoutDate?: string;
  activityId?: string;
  body: string;
  privateDirectToMinor?: boolean;
  guardianCc?: boolean;
  originUrl: string;
}): Promise<{
  ok: boolean;
  status?: number;
  comment?: TeamWorkoutComment;
  summary?: TeamSummaryWithRole | null;
  error?: string;
}> {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (!callerMem) {
      return { ok: false, status: 403, error: 'Membership required to post workout comments.' };
    }

    const targetMem = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== 'REVOKED'
    );
    if (!targetMem) {
      return { ok: false, status: 404, error: 'Target athlete not found.' };
    }

    const isSelf = targetMem.userSid === params.callerSid;
    const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
    if (!isSelf && !isStaff) {
      return {
        ok: false,
        status: 403,
        error: 'Only coaching/medical staff or the athlete may post workout comments.',
      };
    }

    const targetIsProtectedMinor = Boolean(
      targetMem.isMinorU18 || doc.brand.orgType === 'HIGH_SCHOOL'
    );
    if (
      targetIsProtectedMinor &&
      (params.privateDirectToMinor === true || params.guardianCc === false)
    ) {
      return {
        ok: false,
        status: 403,
        error:
          'SafeSport policy requires parent/guardian visibility on all youth athlete workout comments.',
      };
    }

    const cleanBody = String(params.body || '').trim().slice(0, 600);
    if (!cleanBody) {
      return { ok: false, status: 400, error: 'Comment text is required.' };
    }

    const nowIso = new Date().toISOString();
    const guardianCcApplied = Boolean(
      targetIsProtectedMinor || (doc.brand.enableParentGuardianCc && targetMem.parentGuardianEmail)
    );
    const comment: TeamWorkoutComment = {
      id: `cmt_${crypto.randomBytes(6).toString('hex')}`,
      teamId: doc.brand.teamId,
      targetMembershipId: targetMem.membershipId,
      targetAthleteName: targetMem.invitedName,
      ...(params.activityId ? { activityId: String(params.activityId).slice(0, 80) } : {}),
      workoutDate: String(params.workoutDate || nowIso.slice(0, 10)).slice(0, 10),
      authorSid: params.callerSid,
      authorName: callerMem.invitedName || doc.brand.coachDisplayName,
      authorRole: callerMem.role,
      body: cleanBody,
      guardianCcApplied,
      guardianVisible: true,
      createdAt: nowIso,
    };

    if (
      guardianCcApplied &&
      targetMem.parentGuardianEmail &&
      callerMem.userSid !== targetMem.userSid &&
      isResendConfigured()
    ) {
      void sendEmailViaResend({
        to: targetMem.parentGuardianEmail,
        subject: `[THRESH Guardian CC] Coach note for ${targetMem.invitedName}`,
        html: `<p><strong>${escapeHtml(comment.authorName)}</strong> commented on ${escapeHtml(targetMem.invitedName)}&apos;s ${escapeHtml(comment.workoutDate)} workout:</p><blockquote>${escapeHtml(cleanBody)}</blockquote>`,
        text: `${comment.authorName} commented on ${targetMem.invitedName}'s ${comment.workoutDate} workout: ${cleanBody}`,
      });
    }

    doc.workoutComments = [comment, ...(doc.workoutComments || [])].slice(0, 300);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'WORKOUT_COMMENT_POSTED',
      targetId: targetMem.membershipId,
      metadata: {
        guardianCcApplied,
        workoutDate: comment.workoutDate,
      },
    });

    return {
      ok: true,
      comment,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function getTeamGovernanceAuditLog(params: {
  callerSid: string;
  teamId: string;
  limit?: number;
}): Promise<{ ok: boolean; status?: number; entries?: TeamAuditLogEntry[]; error?: string }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem || !canViewAuditLogRole(callerMem.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Audit log access requires HEAD_COACH or ORG_ADMIN role.',
    };
  }

  const entries = await listTeamAuditLogAsync(params.teamId, params.limit ?? 100);
  return { ok: true, entries };
}
