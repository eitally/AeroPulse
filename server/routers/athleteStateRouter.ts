import express, { type Request, type Response } from 'express';
import {
  getScopedPlannedEventsFile,
  getScopedRuntimeStore,
  getVerifiedSessionClaims,
  loadJsonFile,
  loadTenantVaultAsync,
  resolveSessionScopeKey,
  saveTenantVaultAsync,
} from '../sessionContext.ts';
import { isCanonicalAuthenticatedClaims } from '../securityUtils.ts';
import type { RuntimeSessionStore } from '../sessionContext.ts';
import type {
  AnnualMileageGoal,
  AthleteCloudStateEnvelope,
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  TargetGoal,
  UnifiedActivity,
} from '../../src/types.ts';
import { sanitizePracticeVenueCategory } from '../../src/utils/workoutScheduleUtils.ts';

export const athleteStateRouter = express.Router();

/**
 * Ensures cold-start/standalone requests with a valid signed thresh_session cookie
 * have their Strava identity hydrated from thresh_tenant_vault if available.
 */
async function ensureStoreSessionHydrated(req: Request): Promise<void> {
  const store = getScopedRuntimeStore(req);
  if (store?.stravaAthleteId) return;
  const verified = getVerifiedSessionClaims(req);
  if (!verified?.sid) return;
  const shortSid = verified.sid.slice(0, 24);
  const persisted =
    (await loadTenantVaultAsync<Partial<RuntimeSessionStore> | null>(
      `session_${shortSid}`,
      null
    )) ||
    (await loadTenantVaultAsync<Partial<RuntimeSessionStore> | null>(
      `session_${verified.sid}`,
      null
    ));
  if (persisted?.stravaAthleteId && store) {
    store.stravaAthleteId = String(persisted.stravaAthleteId);
  }
}

const SAFE_PROFILE_KEYS: Array<keyof AthleteProfile> = [
  'name',
  'primarySport',
  'weightKg',
  'restingHr',
  'ftp',
  'indoorFtp',
  'runFtp',
  'lthr',
  'maxHr',
  'runLthr',
  'runMaxHr',
  'thresholdPaceSecsPerKm',
  'swimCssSecsPer100m',
  'swimZones',
  'thresholdHistory',
  'safeSportHideWeight',
  'birthMonthYear',
  'academicDivision',
  'competitionGender',
];

/**
 * Resolves a device-agnostic AES-256-GCM vault key for first-party athlete plans,
 * goals, check-ins, and threshold settings.
 * Anchored to canonical MeetReady userId (`usr_...`) FIRST so connecting Strava later
 * never strands previously created plans/goals, then verified Strava Athlete ID, then session sid.
 */
export function resolveCanonicalAthleteVaultKey(req: Request): string | null {
  const verified = getVerifiedSessionClaims(req);
  if (verified && !isCanonicalAuthenticatedClaims(verified)) {
    return null;
  }
  const sub = String(verified?.sub || '').trim();
  if (sub.startsWith('usr_')) {
    const cleanUserId = sub.replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanUserId) {
      return `athlete_state_user_${cleanUserId}`;
    }
  }

  const store = getScopedRuntimeStore(req);
  const stravaId = String(store?.stravaAthleteId || '').trim().replace(/[^0-9a-zA-Z_-]/g, '');
  if (stravaId) {
    return `athlete_state_strava_${stravaId}`;
  }

  if (verified?.sid) {
    const cleanSid = verified.sid.replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 32);
    if (cleanSid) {
      return `athlete_state_sid_${cleanSid}`;
    }
  }

  const scopeKey = resolveSessionScopeKey(req);
  if (scopeKey && !verified) {
    return `athlete_state_sid_${scopeKey}`;
  }

  return null;
}

/**
 * Enforces CMP-01 Clean-Room boundaries: strips any raw Strava/Garmin/Wahoo activity streams
 * or payload keys and retains only whitelisted first-party athlete planning/threshold fields.
 */
export function sanitizeAthleteCloudState(
  raw: Partial<AthleteCloudStateEnvelope> | null | undefined,
  existing?: AthleteCloudStateEnvelope | null
): AthleteCloudStateEnvelope {
  const input = raw || {};
  const base = existing || {
    version: 1 as const,
    updatedAt: '',
    plannedEvents: [],
    targetGoals: [],
    annualMileageGoals: [],
  };

  const plannedEvents: PlannedWorkoutEvent[] = Array.isArray(input.plannedEvents)
    ? input.plannedEvents.slice(0, 450).map((ev) => ({
        id: String(ev?.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        date: String(ev?.date || '').slice(0, 10),
        name: String(ev?.name || 'Structured Workout').slice(0, 140),
        sportCategory: ev?.sportCategory || 'Running',
        environmentPreference: ev?.environmentPreference || 'FLEXIBLE',
        description: String(ev?.description || '').slice(0, 1200),
        plannedLoad: Number(ev?.plannedLoad || 0),
        plannedDurationSecs: Number(ev?.plannedDurationSecs || 0),
        targetZoneSummary: String(ev?.targetZoneSummary || '').slice(0, 140),
        ...(typeof ev?.workoutSyntax === 'string'
          ? { workoutSyntax: ev.workoutSyntax.slice(0, 4000) }
          : {}),
        ...(typeof ev?.scheduledTime === 'string' && ev.scheduledTime.trim()
          ? { scheduledTime: ev.scheduledTime.trim().slice(0, 16) }
          : {}),
        ...(ev?.sessionSlot === 'SINGLE' || ev?.sessionSlot === 'AM' || ev?.sessionSlot === 'PM'
          ? { sessionSlot: ev.sessionSlot }
          : {}),
        ...(typeof ev?.locationName === 'string' && ev.locationName.trim()
          ? { locationName: ev.locationName.trim().slice(0, 120) }
          : {}),
        ...(() => {
          const cleanCat = sanitizePracticeVenueCategory(ev?.locationCategory);
          return cleanCat ? { locationCategory: cleanCat } : {};
        })(),
        ...(typeof ev?.meetingNotes === 'string' && ev.meetingNotes.trim()
          ? { meetingNotes: ev.meetingNotes.trim().slice(0, 240) }
          : {}),
        ...(Array.isArray(ev?.structuredSteps)
          ? { structuredSteps: ev.structuredSteps.slice(0, 80) }
          : {}),
        ...(ev?.trackSpec && typeof ev.trackSpec === 'object' ? { trackSpec: ev.trackSpec } : {}),
        ...(ev?.footwearClass ? { footwearClass: ev.footwearClass } : {}),
        ...(typeof ev?.spikedDistanceMeters === 'number'
          ? { spikedDistanceMeters: ev.spikedDistanceMeters }
          : {}),
        ...(ev?.trackFacility ? { trackFacility: ev.trackFacility } : {}),
        ...(ev?.meetPriorityTier ? { meetPriorityTier: ev.meetPriorityTier } : {}),
        ...(ev?.source ? { source: ev.source } : {}),
        ...(ev?.planBlockId ? { planBlockId: String(ev.planBlockId) } : {}),
        ...(ev?.planBlockName ? { planBlockName: String(ev.planBlockName) } : {}),
        ...(typeof ev?.planWeekNum === 'number' ? { planWeekNum: ev.planWeekNum } : {}),
      }))
    : base.plannedEvents;

  const targetGoals: TargetGoal[] = Array.isArray(input.targetGoals)
    ? input.targetGoals.slice(0, 120)
    : base.targetGoals;

  const annualMileageGoals: AnnualMileageGoal[] = Array.isArray(input.annualMileageGoals)
    ? input.annualMileageGoals.slice(0, 24)
    : base.annualMileageGoals;

  let athleteProfile = base.athleteProfile;
  if (input.athleteProfile && typeof input.athleteProfile === 'object') {
    const picked: Partial<AthleteProfile> = {};
    for (const key of SAFE_PROFILE_KEYS) {
      if (key in input.athleteProfile && input.athleteProfile[key] !== undefined) {
        (picked as Record<string, unknown>)[key] = input.athleteProfile[key];
      }
    }
    if (Object.keys(picked).length > 0) {
      athleteProfile = picked;
    }
  }

  const distanceUnit: DistanceUnit | undefined =
    input.distanceUnit === 'km' || input.distanceUnit === 'mi'
      ? input.distanceUnit
      : base.distanceUnit;

  const sessionCheckIns: SessionCheckInRecord[] | undefined = Array.isArray(input.sessionCheckIns)
    ? input.sessionCheckIns.slice(0, 200)
    : base.sessionCheckIns;

  const coachArchivedActivities: UnifiedActivity[] | undefined = Array.isArray(
    input.coachArchivedActivities
  )
    ? input.coachArchivedActivities.slice(0, 150).map((act) => ({
        ...act,
        streams: undefined,
      }))
    : base.coachArchivedActivities;

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    ...(athleteProfile ? { athleteProfile } : {}),
    ...(distanceUnit ? { distanceUnit } : {}),
    ...(sessionCheckIns ? { sessionCheckIns } : {}),
    ...(coachArchivedActivities?.length ? { coachArchivedActivities } : {}),
  };
}

export async function loadAthleteCloudState(req: Request): Promise<AthleteCloudStateEnvelope | null> {
  await ensureStoreSessionHydrated(req);
  const vaultKey = resolveCanonicalAthleteVaultKey(req);
  if (!vaultKey) return null;

  const existing = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(vaultKey, null);
  if (
    existing &&
    (Array.isArray(existing.plannedEvents) ||
      Array.isArray(existing.coachArchivedActivities) ||
      Boolean(existing.athleteProfile))
  ) {
    return existing;
  }

  // Fallback migration: check legacy Strava key, session sid key & /tmp planned events JSON
  const store = getScopedRuntimeStore(req);
  const stravaId = String(store?.stravaAthleteId || '').trim().replace(/[^0-9a-zA-Z_-]/g, '');
  if (stravaId) {
    const stravaKey = `athlete_state_strava_${stravaId}`;
    if (stravaKey !== vaultKey) {
      const stravaEnv = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(stravaKey, null);
      if (stravaEnv && Array.isArray(stravaEnv.plannedEvents)) {
        await saveTenantVaultAsync(vaultKey, stravaEnv);
        return stravaEnv;
      }
    }
  }

  const verified = getVerifiedSessionClaims(req);
  const sidKey = verified?.sid
    ? `athlete_state_sid_${verified.sid.replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 32)}`
    : null;
  if (sidKey && sidKey !== vaultKey) {
    const sidEnvelope = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(sidKey, null);
    if (sidEnvelope && Array.isArray(sidEnvelope.plannedEvents)) {
      await saveTenantVaultAsync(vaultKey, sidEnvelope);
      return sidEnvelope;
    }
  }

  const legacyFile = getScopedPlannedEventsFile(req);
  const legacyEvents = legacyFile ? loadJsonFile<PlannedWorkoutEvent[]>(legacyFile, []) : [];
  if (legacyEvents.length > 0) {
    const migrated = sanitizeAthleteCloudState({ plannedEvents: legacyEvents });
    await saveTenantVaultAsync(vaultKey, migrated);
    return migrated;
  }

  const emptyUnsaved = sanitizeAthleteCloudState({
    plannedEvents: [],
    targetGoals: [],
    annualMileageGoals: [],
  });
  // Empty string marks an uninitialized cloud vault so local plans created pre-sign-in are never wiped on first sync
  emptyUnsaved.updatedAt = '';
  return emptyUnsaved;
}

export async function saveAthleteCloudState(
  req: Request,
  patch: Partial<AthleteCloudStateEnvelope>
): Promise<AthleteCloudStateEnvelope | null> {
  await ensureStoreSessionHydrated(req);
  const vaultKey = resolveCanonicalAthleteVaultKey(req);
  if (!vaultKey) return null;

  const existing = await loadAthleteCloudState(req);
  const sanitized = sanitizeAthleteCloudState(patch, existing);
  await saveTenantVaultAsync(vaultKey, sanitized);
  return sanitized;
}

athleteStateRouter.get('/api/athlete-state', async (req: Request, res: Response) => {
  try {
    const vaultKey = resolveCanonicalAthleteVaultKey(req);
    if (!vaultKey) {
      res.json({ ok: true, authenticated: false, state: null });
      return;
    }
    const state = await loadAthleteCloudState(req);
    res.json({ ok: true, authenticated: true, vaultKeyScope: vaultKey.slice(0, 20), state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load athlete cloud state',
    });
  }
});

athleteStateRouter.put('/api/athlete-state', async (req: Request, res: Response) => {
  try {
    const vaultKey = resolveCanonicalAthleteVaultKey(req);
    if (!vaultKey) {
      res.status(401).json({ error: 'Authentication required to persist athlete cloud state.' });
      return;
    }
    const saved = await saveAthleteCloudState(req, (req.body || {}) as Partial<AthleteCloudStateEnvelope>);
    res.json({ ok: true, authenticated: true, state: saved });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to save athlete cloud state',
    });
  }
});
