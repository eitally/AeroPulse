import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnnualMileageGoal,
  AthleteCloudStateEnvelope,
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
import { getSavedIntervalsHeaders, mergeActivitiesNonDestructive } from '../utils/telemetryStorage.ts';
import { buildThreshSessionHeaders } from '../utils/teamLifecycleApi.ts';

const CLOUD_UPDATED_AT_KEY = 'thresh_cloud_state_updated_at';
const CHECKINS_STORAGE_KEY = 'thresh_session_checkins_v1';

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
 * Synchronizes first-party plans, goals, threshold settings, unit preferences, and
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
  const prevTeamsCountRef = useRef<number>(myTeamsCount);

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

  const effectiveSessionCheckIns = isSampleDemoMode ? sampleDemoCheckIns : sessionCheckIns;

  const resetDemoSessionCheckIns = useCallback(() => {
    setSampleDemoCheckIns([]);
  }, []);

  const resetUserCloudSyncState = useCallback(() => {
    hydratedIdentityRef.current = null;
    skipNextSaveRef.current = false;
    setSessionCheckIns([]);
    setArchivedCoachActivities([]);
    try {
      localStorage.removeItem(CHECKINS_STORAGE_KEY);
      localStorage.removeItem(CLOUD_UPDATED_AT_KEY);
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

  const hasLiveWorkspace = !isSampleDemoMode && hasEnteredWorkspace && !isSessionLoggedOut;
  const hasAnyWorkspace = isSampleDemoMode || hasLiveWorkspace;
  const identityKey = hasLiveWorkspace
    ? `live:${stravaAthleteId || currentUser?.id || 'session'}`
    : isSampleDemoMode
      ? 'demo'
      : 'logged_out';

  // Reset hydration tracking on logout
  useEffect(() => {
    if (!hasLiveWorkspace && !isSampleDemoMode) {
      hydratedIdentityRef.current = null;
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
    const hydrate = async () => {
      try {
        const res = await fetch('/api/athlete-state', {
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
        });
        if (!res.ok || cancelled) {
          hydratedIdentityRef.current = identityKey;
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          authenticated?: boolean;
          state?: AthleteCloudStateEnvelope | null;
        };
        if (cancelled) return;

        const cloudState = data?.authenticated ? data.state : null;
        if (cloudState) {
          let localUpdatedAt = '';
          try {
            localUpdatedAt = localStorage.getItem(CLOUD_UPDATED_AT_KEY) || '';
          } catch {
            // ignore storage errors
          }
          const serverIsNewer =
            Boolean(cloudState.updatedAt) &&
            (!localUpdatedAt || cloudState.updatedAt >= localUpdatedAt);

          skipNextSaveRef.current = true;

          if (serverIsNewer && Array.isArray(cloudState.plannedEvents)) {
            setPlannedEvents(cloudState.plannedEvents);
          } else if (cloudState.plannedEvents.length > 0 && plannedEvents.length === 0) {
            setPlannedEvents(cloudState.plannedEvents);
          }

          if (serverIsNewer && Array.isArray(cloudState.targetGoals)) {
            setTargetGoals(cloudState.targetGoals);
          } else if (cloudState.targetGoals.length > 0 && targetGoals.length === 0) {
            setTargetGoals(cloudState.targetGoals);
          }

          if (serverIsNewer && Array.isArray(cloudState.annualMileageGoals)) {
            setAnnualMileageGoals(cloudState.annualMileageGoals);
          } else if (
            cloudState.annualMileageGoals.length > 0 &&
            annualMileageGoals.length === 0
          ) {
            setAnnualMileageGoals(cloudState.annualMileageGoals);
          }

          if (cloudState.distanceUnit && serverIsNewer) {
            setDistanceUnit(cloudState.distanceUnit);
          }

          if (cloudState.athleteProfile && serverIsNewer) {
            setAthleteProfile((prev) => ({
              ...prev,
              ...cloudState.athleteProfile,
            }));
          }

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

          if (
            Array.isArray(cloudState.sessionCheckIns) &&
            (serverIsNewer ||
              (cloudState.sessionCheckIns.length > 0 && sessionCheckIns.length === 0))
          ) {
            setSessionCheckIns(cloudState.sessionCheckIns);
            try {
              localStorage.setItem(
                CHECKINS_STORAGE_KEY,
                JSON.stringify(cloudState.sessionCheckIns)
              );
            } catch {
              // ignore storage errors
            }
          }

          if (cloudState.updatedAt) {
            try {
              localStorage.setItem(CLOUD_UPDATED_AT_KEY, cloudState.updatedAt);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // Non-fatal offline fallback to local IndexedDB/localStorage
      } finally {
        if (!cancelled) {
          hydratedIdentityRef.current = identityKey;
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
    plannedEvents.length,
    targetGoals.length,
    annualMileageGoals.length,
    sessionCheckIns.length,
    setPlannedEvents,
    setTargetGoals,
    setAnnualMileageGoals,
    setDistanceUnit,
    setAthleteProfile,
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
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const cleanProfile: Partial<AthleteProfile> = {
          name: athleteProfile.name,
          primarySport: athleteProfile.primarySport,
          weightKg: athleteProfile.weightKg,
          restingHr: athleteProfile.restingHr,
          ftp: athleteProfile.ftp,
          indoorFtp: athleteProfile.indoorFtp,
          runFtp: athleteProfile.runFtp,
          lthr: athleteProfile.lthr,
          maxHr: athleteProfile.maxHr,
          runLthr: athleteProfile.runLthr,
          runMaxHr: athleteProfile.runMaxHr,
          thresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm,
          thresholdHistory: athleteProfile.thresholdHistory,
          safeSportHideWeight: athleteProfile.safeSportHideWeight,
          birthMonthYear: athleteProfile.birthMonthYear,
          academicDivision: athleteProfile.academicDivision,
          competitionGender: athleteProfile.competitionGender,
        };

        const res = await fetch('/api/athlete-state', {
          method: 'PUT',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({
            plannedEvents,
            targetGoals,
            annualMileageGoals,
            athleteProfile: cleanProfile,
            distanceUnit,
            sessionCheckIns,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { state?: { updatedAt?: string } };
          if (data.state?.updatedAt) {
            localStorage.setItem(CLOUD_UPDATED_AT_KEY, data.state.updatedAt);
          }
        }
      } catch {
        // Non-fatal offline persistence continues in IndexedDB/localStorage
      }
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
    sessionCheckIns,
  ]);

  // 3. Debounced Clean-Room readiness, check-ins & 7d productivity sync across joined teams
  useEffect(() => {
    if (isSampleDemoMode || !hasEnteredWorkspace || isSessionLoggedOut || myTeamsCount === 0) {
      return;
    }
    if (activities.length === 0 && wellnessDays.length === 0 && sessionCheckIns.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      const sevenDaysAgoMs = Date.now() - 7 * 86_400_000;
      const recent7dActs = activities.filter(
        (a) => new Date(a.startDateLocal).getTime() >= sevenDaysAgoMs
      );
      const acuteLoad7d = Math.round(
        recent7dActs.reduce((acc, a) => acc + (a.trainingLoad || 0), 0)
      );
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
            lowAerobicPct: 76,
            highAerobicPct: 18,
            neuromuscularPct: 6,
            caraHours7d: Number(
              (() => {
                // NCAA Bylaw 17.1.7.3.2: every competition day counts as 3.0 CARA hours
                const competitionDays = new Set<string>();
                let practiceSecs = 0;
                for (const a of recent7dActs) {
                  if (a.officialRaceData) {
                    competitionDays.add(String(a.startDateLocal || '').slice(0, 10));
                  } else {
                    practiceSecs += a.movingTimeSecs || 0;
                  }
                }
                return (practiceSecs / 3600 + competitionDays.size * 3.0).toFixed(1);
              })()
            ),
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
