import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnnualMileageGoal,
  AthleteCloudStateEnvelope,
  AthleteGearItem,
  AthletePrivacySettings,
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  SportCategory,
  TargetGoal,
  TeamSummaryWithRole,
  ThreshUser,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types.ts';
import type { SafetySwapEventInput } from '../physiology/sessionCheckInAndDigestEngine.ts';
import { consumePendingSharedWorkout } from '../utils/shareWorkoutRoute.ts';
import { mergeActivitiesNonDestructive } from '../utils/telemetryStorage.ts';
import { buildThreshSessionHeaders } from '../utils/teamLifecycleApi.ts';
import { STORAGE_KEYS } from '../utils/storageKeys.ts';

const CLOUD_UPDATED_AT_KEY = 'thresh_cloud_state_updated_at';
const CHECKINS_STORAGE_KEY = 'thresh_session_checkins_v1';

type TrackedCloudField =
  | 'plannedEvents'
  | 'targetGoals'
  | 'annualMileageGoals'
  | 'athleteProfile'
  | 'distanceUnit'
  | 'gearItems'
  | 'sessionCheckIns';

export function computeTeamSnapshotLoadAndCara(
  activities: UnifiedActivity[],
  referenceDateIso?: string
): {
  acuteLoad7d: number;
  lowAerobicPct: number;
  highAerobicPct: number;
  neuromuscularPct: number;
  caraHours7d: number;
} {
  const refIso = referenceDateIso
    ? referenceDateIso.slice(0, 10)
    : (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      })();
  const refDateObj = new Date(`${refIso}T12:00:00Z`);
  const startDateObj = new Date(refDateObj.getTime() - 6 * 86_400_000);
  const startIso = Number.isNaN(startDateObj.getTime())
    ? refIso
    : startDateObj.toISOString().slice(0, 10);

  const recent7dActs = activities.filter((a) => {
    const dayKey = String(a?.startDateLocal || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dayKey) && dayKey >= startIso && dayKey <= refIso;
  });

  const acuteLoad7d = Math.round(
    recent7dActs.reduce((acc, a) => acc + (a.trainingLoad || 0), 0)
  );

  // Energy system breakdown from 7d zone seconds (falls back cleanly when zoneSecs is absent)
  let lowSecs = 0;
  let highSecs = 0;
  let neuroSecs = 0;
  for (const a of recent7dActs) {
    const z = a.zoneSecs?.pace || a.zoneSecs?.hr || a.zoneSecs?.power;
    if (Array.isArray(z) && z.length >= 5) {
      lowSecs += (z[0] || 0) + (z[1] || 0);
      highSecs += (z[2] || 0) + (z[3] || 0);
      neuroSecs += (z[4] || 0) + (z[5] || 0) + (z[6] || 0);
    } else if ((a.movingTimeSecs || 0) > 0) {
      const secs = a.movingTimeSecs;
      const intensity = a.intensityFactor || 0.72;
      if (intensity >= 0.96 || Boolean(a.officialRaceData)) {
        lowSecs += secs * 0.3;
        highSecs += secs * 0.45;
        neuroSecs += secs * 0.25;
      } else if (intensity >= 0.82) {
        lowSecs += secs * 0.55;
        highSecs += secs * 0.35;
        neuroSecs += secs * 0.1;
      } else {
        lowSecs += secs * 0.85;
        highSecs += secs * 0.13;
        neuroSecs += secs * 0.02;
      }
    }
  }
  const totalZoneSecs = lowSecs + highSecs + neuroSecs;
  let lowAerobicPct = 0;
  let highAerobicPct = 0;
  let neuromuscularPct = 0;
  if (totalZoneSecs > 0) {
    lowAerobicPct = Math.round((lowSecs / totalZoneSecs) * 100);
    highAerobicPct = Math.round((highSecs / totalZoneSecs) * 100);
    neuromuscularPct = Math.max(0, 100 - lowAerobicPct - highAerobicPct);
  }

  // NCAA Bylaw 17.1.7.1: any competition day counts flat 3.0h (do NOT double-count warmup/shakeout on that same day)
  const hoursByDay = new Map<string, number>();
  const competitionDays = new Set<string>();
  for (const a of recent7dActs) {
    const dayKey = String(a.startDateLocal || '').slice(0, 10);
    if (Boolean(a.officialRaceData) || Boolean(a.isCompetitionDay)) {
      competitionDays.add(dayKey);
    }
    hoursByDay.set(dayKey, (hoursByDay.get(dayKey) || 0) + Math.max(0, a.movingTimeSecs || 0) / 3600);
  }
  for (const compDay of competitionDays) {
    hoursByDay.set(compDay, 3.0);
  }
  let totalCaraHours = 0;
  for (const dayHrs of hoursByDay.values()) {
    totalCaraHours += dayHrs;
  }

  return {
    acuteLoad7d,
    lowAerobicPct,
    highAerobicPct,
    neuromuscularPct,
    caraHours7d: Number(totalCaraHours.toFixed(1)),
  };
}

function isCloudStateDirty(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEYS.CLOUD_STATE_DIRTY) === '1';
  } catch {
    return false;
  }
}

function setCloudStateDirty(dirty: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (dirty) {
      localStorage.setItem(STORAGE_KEYS.CLOUD_STATE_DIRTY, '1');
    } else {
      localStorage.removeItem(STORAGE_KEYS.CLOUD_STATE_DIRTY);
    }
  } catch {
    // ignore storage errors
  }
}

interface UseAthleteCloudSyncParams {
  isSampleDemoMode: boolean;
  hasEnteredWorkspace: boolean;
  isSessionLoggedOut: boolean;
  currentUser: ThreshUser | null;
  stravaAthleteId?: string;
  plannedEvents: PlannedWorkoutEvent[];
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  targetGoals: TargetGoal[];
  setTargetGoals: React.Dispatch<React.SetStateAction<TargetGoal[]>>;
  annualMileageGoals: AnnualMileageGoal[];
  setAnnualMileageGoals: React.Dispatch<React.SetStateAction<AnnualMileageGoal[]>>;
  athleteProfile: AthleteProfile;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  distanceUnit: DistanceUnit;
  setDistanceUnit: React.Dispatch<React.SetStateAction<DistanceUnit>>;
  gearItems?: AthleteGearItem[];
  setGearItems?: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  activities: UnifiedActivity[];
  setActivities?: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  wellnessDays: UnifiedWellnessDay[];
  selfLatestWellness?: UnifiedWellnessDay;
  selfPrivacySettings: AthletePrivacySettings;
  garminConnected: boolean;
  intervalsConnected: boolean;
  myTeamsCount: number;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  handleCreatePlannedEvent: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onPendingWorkoutImported?: () => void;
}

/**
 * Synchronizes first-party plans, goals, gear, threshold settings, unit preferences, and
 * RPE/pain session check-ins via AES-256-GCM /api/athlete-state and /api/teams/sync-snapshot,
 * and auto-imports any pending shared workout across OAuth login.
 */
export function useAthleteCloudSync({
  isSampleDemoMode,
  hasEnteredWorkspace,
  isSessionLoggedOut,
  currentUser,
  stravaAthleteId,
  plannedEvents,
  setPlannedEvents,
  targetGoals,
  setTargetGoals,
  annualMileageGoals,
  setAnnualMileageGoals,
  athleteProfile,
  setAthleteProfile,
  distanceUnit,
  setDistanceUnit,
  gearItems,
  setGearItems,
  activities,
  setActivities,
  wellnessDays,
  selfLatestWellness,
  selfPrivacySettings,
  garminConnected,
  intervalsConnected,
  myTeamsCount,
  setMyTeams,
  handleCreatePlannedEvent,
  onPendingWorkoutImported,
}: UseAthleteCloudSyncParams) {
  const hydratedIdentityRef = useRef<string | null>(null);
  const skipNextSaveRef = useRef<boolean>(false);
  const applyingCloudHydrationRef = useRef<boolean>(false);
  const localMutationRevRef = useRef<number>(0);
  const syncedRevRef = useRef<number>(0);
  const sessionEditedFieldsRef = useRef<Set<TrackedCloudField>>(new Set());
  const prevTeamsCountRef = useRef<number>(myTeamsCount);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const pendingSaveNeededRef = useRef<boolean>(false);

  const [sessionCheckIns, setSessionCheckIns] = useState<SessionCheckInRecord[]>(() => {
    try {
      const raw = localStorage.getItem(CHECKINS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });
  const [sampleDemoCheckIns, setSampleDemoCheckIns] = useState<SessionCheckInRecord[]>([]);
  const [archivedCoachActivities, setArchivedCoachActivities] = useState<UnifiedActivity[]>([]);
  const [hydrateRetryNonce, setHydrateRetryNonce] = useState(0);

  const effectiveSessionCheckIns = isSampleDemoMode ? sampleDemoCheckIns : sessionCheckIns;

  const hasLiveWorkspace = !isSampleDemoMode && hasEnteredWorkspace && !isSessionLoggedOut;
  const hasAnyWorkspace = isSampleDemoMode || hasLiveWorkspace;
  const identityKey = hasLiveWorkspace
    ? `live:${stravaAthleteId || currentUser?.id || 'session'}`
    : isSampleDemoMode
      ? 'demo'
      : 'logged_out';

  const hasLiveWorkspaceRef = useRef<boolean>(hasLiveWorkspace);
  hasLiveWorkspaceRef.current = hasLiveWorkspace;

  const latestSyncStateRef = useRef({
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    athleteProfile,
    distanceUnit,
    gearItems,
    sessionCheckIns,
  });
  latestSyncStateRef.current = {
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    athleteProfile,
    distanceUnit,
    gearItems,
    sessionCheckIns,
  };

  const prevLiveTrackedRef = useRef<{
    hasLive: boolean;
    plannedEvents: PlannedWorkoutEvent[];
    targetGoals: TargetGoal[];
    annualMileageGoals: AnnualMileageGoal[];
    athleteProfile: AthleteProfile;
    distanceUnit: DistanceUnit;
    gearItems: AthleteGearItem[] | undefined;
    sessionCheckIns: SessionCheckInRecord[];
  }>({
    hasLive: hasLiveWorkspace,
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    athleteProfile,
    distanceUnit,
    gearItems,
    sessionCheckIns,
  });

  // Track monotonic local mutation revisions whenever user state changes in live mode
  useEffect(() => {
    const prev = prevLiveTrackedRef.current;
    const editedFields: TrackedCloudField[] = [];
    if (prev.plannedEvents !== plannedEvents) editedFields.push('plannedEvents');
    if (prev.targetGoals !== targetGoals) editedFields.push('targetGoals');
    if (prev.annualMileageGoals !== annualMileageGoals) editedFields.push('annualMileageGoals');
    if (prev.athleteProfile !== athleteProfile) editedFields.push('athleteProfile');
    if (prev.distanceUnit !== distanceUnit) editedFields.push('distanceUnit');
    if (prev.gearItems !== gearItems) editedFields.push('gearItems');
    if (prev.sessionCheckIns !== sessionCheckIns) editedFields.push('sessionCheckIns');
    const changed = editedFields.length > 0;

    prevLiveTrackedRef.current = {
      hasLive: hasLiveWorkspace,
      plannedEvents,
      targetGoals,
      annualMileageGoals,
      athleteProfile,
      distanceUnit,
      gearItems,
      sessionCheckIns,
    };

    if (applyingCloudHydrationRef.current) {
      applyingCloudHydrationRef.current = false;
      return;
    }

    if (prev.hasLive && hasLiveWorkspace && changed) {
      for (const field of editedFields) {
        sessionEditedFieldsRef.current.add(field);
      }
      localMutationRevRef.current += 1;
      setCloudStateDirty(true);
    }
  }, [
    hasLiveWorkspace,
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    athleteProfile,
    distanceUnit,
    gearItems,
    sessionCheckIns,
  ]);

  const flushCloudStateSave = useCallback(async () => {
    if (inFlightSaveRef.current) {
      pendingSaveNeededRef.current = true;
      return inFlightSaveRef.current;
    }

    const runSaveLoop = async () => {
      do {
        pendingSaveNeededRef.current = false;
        if (!hasLiveWorkspaceRef.current) break;

        const targetRev = localMutationRevRef.current;
        const snap = latestSyncStateRef.current;
        try {
          const cleanProfile: Partial<AthleteProfile> = {
            name: snap.athleteProfile.name,
            primarySport: snap.athleteProfile.primarySport,
            weightKg: snap.athleteProfile.weightKg,
            restingHr: snap.athleteProfile.restingHr,
            ftp: snap.athleteProfile.ftp,
            indoorFtp: snap.athleteProfile.indoorFtp,
            runFtp: snap.athleteProfile.runFtp,
            lthr: snap.athleteProfile.lthr,
            maxHr: snap.athleteProfile.maxHr,
            runLthr: snap.athleteProfile.runLthr,
            runMaxHr: snap.athleteProfile.runMaxHr,
            thresholdPaceSecsPerKm: snap.athleteProfile.thresholdPaceSecsPerKm,
            thresholdHistory: snap.athleteProfile.thresholdHistory,
            safeSportHideWeight: snap.athleteProfile.safeSportHideWeight,
            birthMonthYear: snap.athleteProfile.birthMonthYear,
            academicDivision: snap.athleteProfile.academicDivision,
            competitionGender: snap.athleteProfile.competitionGender,
          };

          const res = await fetch('/api/athlete-state', {
            method: 'PUT',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              plannedEvents: snap.plannedEvents,
              targetGoals: snap.targetGoals,
              annualMileageGoals: snap.annualMileageGoals,
              athleteProfile: cleanProfile,
              distanceUnit: snap.distanceUnit,
              ...(snap.gearItems !== undefined ? { gearItems: snap.gearItems } : {}),
              sessionCheckIns: snap.sessionCheckIns,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { state?: { updatedAt?: string } };
            if (data.state?.updatedAt) {
              try {
                localStorage.setItem(CLOUD_UPDATED_AT_KEY, data.state.updatedAt);
              } catch {
                // ignore storage errors
              }
            }
            syncedRevRef.current = targetRev;
            if (localMutationRevRef.current === targetRev && !pendingSaveNeededRef.current) {
              setCloudStateDirty(false);
            } else {
              pendingSaveNeededRef.current = true;
            }
          } else {
            setCloudStateDirty(true);
          }
        } catch {
          setCloudStateDirty(true);
        }
      } while (pendingSaveNeededRef.current && hasLiveWorkspaceRef.current);
    };

    const activePromise = runSaveLoop().finally(() => {
      inFlightSaveRef.current = null;
    });
    inFlightSaveRef.current = activePromise;
    return activePromise;
  }, []);

  const resetDemoSessionCheckIns = useCallback(() => {
    setSampleDemoCheckIns([]);
  }, []);

  const resetUserCloudSyncState = useCallback(() => {
    hydratedIdentityRef.current = null;
    skipNextSaveRef.current = false;
    applyingCloudHydrationRef.current = false;
    localMutationRevRef.current = 0;
    syncedRevRef.current = 0;
    sessionEditedFieldsRef.current.clear();
    pendingSaveNeededRef.current = false;
    setSessionCheckIns([]);
    setArchivedCoachActivities([]);
    try {
      localStorage.removeItem(CHECKINS_STORAGE_KEY);
      localStorage.removeItem(CLOUD_UPDATED_AT_KEY);
      localStorage.removeItem(STORAGE_KEYS.CLOUD_STATE_DIRTY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleRecordSessionCheckIn = useCallback(
    async (
      input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
      safetySwapEvent?: SafetySwapEventInput | null
    ) => {
      const record: SessionCheckInRecord = {
        ...input,
        id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: input.date.slice(0, 10),
        rpe: Math.max(1, Math.min(10, Math.round(input.rpe))),
        autoSwappedToRecovery: Boolean(safetySwapEvent || input.autoSwappedToRecovery),
        createdAt: new Date().toISOString(),
      };

      const upsert = (prev: SessionCheckInRecord[]) => {
        const targetKey = `${record.date}:${record.plannedEventId || 'daily'}`;
        const filtered = prev.filter(
          (c) => `${(c.date || '').slice(0, 10)}:${c.plannedEventId || 'daily'}` !== targetKey
        );
        return [record, ...filtered].slice(0, 120);
      };

      if (isSampleDemoMode) {
        setSampleDemoCheckIns(upsert);
      } else {
        setSessionCheckIns((prev) => {
          const next = upsert(prev);
          try {
            localStorage.setItem(CHECKINS_STORAGE_KEY, JSON.stringify(next));
          } catch {
            // ignore storage errors
          }
          return next;
        });
      }

      if (safetySwapEvent) {
        await handleCreatePlannedEvent({
          ...safetySwapEvent,
          replaceExistingDate: true,
        });
      }
    },
    [isSampleDemoMode, handleCreatePlannedEvent]
  );

  // Reset hydration tracking on logout
  useEffect(() => {
    if (!hasLiveWorkspace && !isSampleDemoMode) {
      hydratedIdentityRef.current = null;
      sessionEditedFieldsRef.current.clear();
    }
  }, [hasLiveWorkspace, isSampleDemoMode]);

  // Auto-import any shared workout stashed prior to OAuth sign-in or demo launch
  useEffect(() => {
    if (!hasAnyWorkspace) return;
    const pending = consumePendingSharedWorkout();
    if (!pending) return;

    void import('../utils/shareWorkoutEngine.ts')
      .then(({ sharedWorkoutToPlannedEventInput }) => {
        const eventInput = sharedWorkoutToPlannedEventInput(pending, {
          ftpWatts: athleteProfile.ftp || 260,
          thresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm || 245,
          unit: distanceUnit,
        });
        return handleCreatePlannedEvent(eventInput).then(() => {
          onPendingWorkoutImported?.();
        });
      })
      .catch(() => undefined);
  }, [
    hasAnyWorkspace,
    athleteProfile.ftp,
    athleteProfile.thresholdPaceSecsPerKm,
    distanceUnit,
    handleCreatePlannedEvent,
    onPendingWorkoutImported,
  ]);

  // 1. Hydrate cross-device state from GET /api/athlete-state when live workspace starts
  useEffect(() => {
    if (!hasLiveWorkspace) return;
    if (hydratedIdentityRef.current === identityKey) return;

    let cancelled = false;
    const revAtStart = localMutationRevRef.current;
    const dirtyAtStart = isCloudStateDirty();

    const hydrate = async () => {
      let hydrationSucceeded = false;
      try {
        const res = await fetch('/api/athlete-state', {
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
        });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          authenticated?: boolean;
          state?: AthleteCloudStateEnvelope | null;
        };
        if (cancelled) return;
        hydrationSucceeded = true;

        const cloudState = data?.authenticated ? data.state : null;
        if (cloudState) {
          if (
            Array.isArray(cloudState.coachArchivedActivities) &&
            cloudState.coachArchivedActivities.length > 0
          ) {
            setArchivedCoachActivities(cloudState.coachArchivedActivities);
            setActivities?.((prev) =>
              mergeActivitiesNonDestructive(prev, cloudState.coachArchivedActivities!)
            );
          } else {
            setArchivedCoachActivities([]);
          }

          const hasUnsavedLocalMutations =
            dirtyAtStart ||
            isCloudStateDirty() ||
            localMutationRevRef.current > revAtStart;

          const latest = latestSyncStateRef.current;
          let localUpdatedAt = '';
          try {
            localUpdatedAt = localStorage.getItem(CLOUD_UPDATED_AT_KEY) || '';
          } catch {
            // ignore storage errors
          }
          const serverIsNewer =
            Boolean(cloudState.updatedAt) &&
            (!localUpdatedAt || cloudState.updatedAt >= localUpdatedAt);

          let didUpdateState = false;
          const hydratedSnapshot = { ...latest };

          const canReplaceList = <T,>(
            field: TrackedCloudField,
            cloudArr: T[],
            localArr: T[]
          ): boolean => {
            if (sessionEditedFieldsRef.current.has(field)) return false;
            if (!hasUnsavedLocalMutations) {
              return serverIsNewer || (cloudArr.length > 0 && localArr.length === 0);
            }
            return cloudArr.length > 0 && localArr.length === 0;
          };

          if (
            Array.isArray(cloudState.plannedEvents) &&
            canReplaceList('plannedEvents', cloudState.plannedEvents, latest.plannedEvents)
          ) {
            setPlannedEvents(cloudState.plannedEvents);
            hydratedSnapshot.plannedEvents = cloudState.plannedEvents;
            didUpdateState = true;
          }

          if (
            Array.isArray(cloudState.targetGoals) &&
            canReplaceList('targetGoals', cloudState.targetGoals, latest.targetGoals)
          ) {
            setTargetGoals(cloudState.targetGoals);
            hydratedSnapshot.targetGoals = cloudState.targetGoals;
            didUpdateState = true;
          }

          if (
            Array.isArray(cloudState.annualMileageGoals) &&
            canReplaceList(
              'annualMileageGoals',
              cloudState.annualMileageGoals,
              latest.annualMileageGoals
            )
          ) {
            setAnnualMileageGoals(cloudState.annualMileageGoals);
            hydratedSnapshot.annualMileageGoals = cloudState.annualMileageGoals;
            didUpdateState = true;
          }

          if (
            setGearItems &&
            Array.isArray(cloudState.gearItems) &&
            canReplaceList('gearItems', cloudState.gearItems, latest.gearItems || [])
          ) {
            setGearItems(cloudState.gearItems);
            hydratedSnapshot.gearItems = cloudState.gearItems;
            didUpdateState = true;
          }

          if (
            !hasUnsavedLocalMutations &&
            !sessionEditedFieldsRef.current.has('distanceUnit') &&
            cloudState.distanceUnit &&
            serverIsNewer
          ) {
            setDistanceUnit(cloudState.distanceUnit);
            hydratedSnapshot.distanceUnit = cloudState.distanceUnit;
            didUpdateState = true;
          }

          if (
            !hasUnsavedLocalMutations &&
            !sessionEditedFieldsRef.current.has('athleteProfile') &&
            cloudState.athleteProfile &&
            serverIsNewer
          ) {
            setAthleteProfile((prev) => ({
              ...prev,
              ...cloudState.athleteProfile,
            }));
            hydratedSnapshot.athleteProfile = {
              ...latest.athleteProfile,
              ...cloudState.athleteProfile,
            };
            didUpdateState = true;
          }

          if (
            Array.isArray(cloudState.sessionCheckIns) &&
            canReplaceList(
              'sessionCheckIns',
              cloudState.sessionCheckIns,
              latest.sessionCheckIns
            )
          ) {
            setSessionCheckIns(cloudState.sessionCheckIns);
            hydratedSnapshot.sessionCheckIns = cloudState.sessionCheckIns;
            didUpdateState = true;
            try {
              localStorage.setItem(
                CHECKINS_STORAGE_KEY,
                JSON.stringify(cloudState.sessionCheckIns)
              );
            } catch {
              // ignore storage errors
            }
          }

          if (didUpdateState) {
            latestSyncStateRef.current = hydratedSnapshot;
            skipNextSaveRef.current = true;
            applyingCloudHydrationRef.current = true;
            if (
              hasUnsavedLocalMutations &&
              sessionEditedFieldsRef.current.size === 0 &&
              serverIsNewer &&
              latest.plannedEvents.length === 0 &&
              latest.targetGoals.length === 0 &&
              latest.annualMileageGoals.length === 0 &&
              (latest.gearItems?.length ?? 0) === 0 &&
              latest.sessionCheckIns.length === 0
            ) {
              setCloudStateDirty(false);
            }
          }

          if (cloudState.updatedAt && (serverIsNewer || didUpdateState)) {
            try {
              localStorage.setItem(CLOUD_UPDATED_AT_KEY, cloudState.updatedAt);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // Non-fatal offline fallback to local IndexedDB/localStorage; retry on reconnect
      } finally {
        if (!cancelled && hydrationSucceeded) {
          hydratedIdentityRef.current = identityKey;
          if (isCloudStateDirty() || localMutationRevRef.current > syncedRevRef.current) {
            void flushCloudStateSave();
          }
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    hasLiveWorkspace,
    identityKey,
    hydrateRetryNonce,
    setPlannedEvents,
    setTargetGoals,
    setAnnualMileageGoals,
    setDistanceUnit,
    setAthleteProfile,
    setGearItems,
    setActivities,
    flushCloudStateSave,
  ]);

  // 1b. When leaving/graduating from a team in-session, re-pull coachArchivedActivities immediately
  useEffect(() => {
    const prevCount = prevTeamsCountRef.current;
    prevTeamsCountRef.current = myTeamsCount;
    if (!hasLiveWorkspace || myTeamsCount >= prevCount) return;
    let cancelled = false;
    fetch('/api/athlete-state', {
      credentials: 'include',
      headers: buildThreshSessionHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const archived = data?.state?.coachArchivedActivities;
        if (Array.isArray(archived) && archived.length > 0) {
          setArchivedCoachActivities(archived);
          setActivities?.((prev) => mergeActivitiesNonDestructive(prev, archived));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasLiveWorkspace, myTeamsCount, setActivities]);

  // 2. Debounced (600ms) Clean-Room PUT /api/athlete-state on state changes
  useEffect(() => {
    if (!hasLiveWorkspace) return;
    if (hydratedIdentityRef.current !== identityKey) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      if (!isCloudStateDirty() && localMutationRevRef.current <= syncedRevRef.current) {
        return;
      }
    }

    const timer = window.setTimeout(() => {
      void flushCloudStateSave();
    }, 600);

    return () => window.clearTimeout(timer);
  }, [
    hasLiveWorkspace,
    identityKey,
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    athleteProfile,
    distanceUnit,
    gearItems,
    sessionCheckIns,
    flushCloudStateSave,
  ]);

  // 2b. Retry failed hydration or dirty state automatically when network connectivity returns
  useEffect(() => {
    if (!hasLiveWorkspace || typeof window === 'undefined') return;
    const handleOnline = () => {
      if (hydratedIdentityRef.current !== identityKey) {
        setHydrateRetryNonce((n) => n + 1);
        return;
      }
      if (isCloudStateDirty() || localMutationRevRef.current > syncedRevRef.current) {
        void flushCloudStateSave();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [hasLiveWorkspace, identityKey, flushCloudStateSave]);

  // 3. Debounced Clean-Room readiness, check-ins & 7d productivity sync across joined teams
  useEffect(() => {
    if (isSampleDemoMode || !hasEnteredWorkspace || isSessionLoggedOut || myTeamsCount === 0) {
      return;
    }
    if (activities.length === 0 && wellnessDays.length === 0 && sessionCheckIns.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      const snapshotMetrics = computeTeamSnapshotLoadAndCara(activities);
      const { acuteLoad7d, lowAerobicPct, highAerobicPct, neuromuscularPct, caraHours7d } =
        snapshotMetrics;
      const ctlVal = selfLatestWellness?.ctl ?? 0;
      const atlVal = selfLatestWellness?.atl ?? Math.round(acuteLoad7d / 7);
      const tsbVal = selfLatestWellness?.tsb ?? Number((ctlVal - atlVal).toFixed(1));
      const verdictLabel =
        selfLatestWellness?.garminTrainingStatus ||
        (tsbVal < -20
          ? 'Strained · Recover'
          : acuteLoad7d > 0 && acuteLoad7d >= Math.max(120, ctlVal * 5.2)
            ? 'Productive · Building'
            : 'Maintaining');
      const readinessScore =
        selfLatestWellness?.readinessStatus === 'Strain'
          ? 52
          : selfLatestWellness?.readinessStatus === 'Caution'
            ? 70
            : 86;
      const hasWatch = Boolean(garminConnected || intervalsConnected || activities.length > 0);
      fetch('/api/teams/sync-snapshot', {
        method: 'POST',
        credentials: 'include',
        headers: buildThreshSessionHeaders(),
        body: JSON.stringify({
          origin: window.location.origin,
          athleteName: athleteProfile.name,
          privacySettings: selfPrivacySettings,
          snapshot: {
            hasConnectedWatch: hasWatch,
            verdictLabel,
            readinessScore,
            ctl: ctlVal,
            atl: atlVal,
            tsb: tsbVal,
            acuteLoad7d,
            lowAerobicPct,
            highAerobicPct,
            neuromuscularPct,
            caraHours7d,
            ftpWatts: athleteProfile.ftp,
            thresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm,
            safeSportHideWeight: Boolean(athleteProfile.safeSportHideWeight),
            birthMonthYear: athleteProfile.birthMonthYear,
            wellnessDays: wellnessDays.slice(-14),
            activities: activities.slice(0, 14),
            sessionCheckIns: sessionCheckIns.slice(0, 14),
            privacySettings: selfPrivacySettings,
          },
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.teams && Array.isArray(data.teams)) {
            setMyTeams(data.teams);
          }
        })
        .catch(() => {});
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [
    isSampleDemoMode,
    hasEnteredWorkspace,
    isSessionLoggedOut,
    myTeamsCount,
    activities,
    wellnessDays,
    selfLatestWellness,
    athleteProfile.name,
    athleteProfile.ftp,
    athleteProfile.thresholdPaceSecsPerKm,
    athleteProfile.safeSportHideWeight,
    athleteProfile.birthMonthYear,
    selfPrivacySettings,
    garminConnected,
    intervalsConnected,
    sessionCheckIns,
    setMyTeams,
  ]);

  return {
    effectiveSessionCheckIns,
    archivedCoachActivities,
    handleRecordSessionCheckIn,
    resetDemoSessionCheckIns,
    resetUserCloudSyncState,
  };
}
