import React, { useEffect, useRef } from 'react';
import type {
  AnnualMileageGoal,
  AthleteCloudStateEnvelope,
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  TargetGoal,
  ThreshUser,
  TrackWorkoutSpec,
} from '../types.ts';
import {
  consumePendingSharedWorkout,
  sharedWorkoutToPlannedEventInput,
} from '../utils/shareWorkoutEngine.ts';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage.ts';

const CLOUD_UPDATED_AT_KEY = 'thresh_cloud_state_updated_at';

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
 * Synchronizes first-party plans, goals, threshold settings, and unit preferences
 * across devices via encrypted AES-256-GCM /api/athlete-state, and auto-imports
 * any pending shared workout across OAuth login.
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
  handleCreatePlannedEvent,
  onPendingWorkoutImported,
}: UseAthleteCloudSyncParams): void {
  const hydratedIdentityRef = useRef<string | null>(null);
  const skipNextSaveRef = useRef<boolean>(false);

  const hasLiveWorkspace = !isSampleDemoMode && hasEnteredWorkspace && !isSessionLoggedOut;
  const hasAnyWorkspace = isSampleDemoMode || hasLiveWorkspace;
  const identityKey = hasLiveWorkspace
    ? `live:${stravaAthleteId || currentUser?.id || 'session'}`
    : isSampleDemoMode
      ? 'demo'
      : 'logged_out';

  // Reset hydration tracking on logout
  useEffect(() => {
    if (!hasLiveWorkspace) {
      if (!isSampleDemoMode) {
        hydratedIdentityRef.current = null;
      }
    }
  }, [hasLiveWorkspace, isSampleDemoMode]);

  // Auto-import any shared workout stashed prior to OAuth sign-in or demo launch
  useEffect(() => {
    if (!hasAnyWorkspace) return;
    const pending = consumePendingSharedWorkout();
    if (!pending) return;

    const eventInput = sharedWorkoutToPlannedEventInput(pending, {
      ftpWatts: athleteProfile.ftp || 260,
      thresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm || 245,
      unit: distanceUnit,
    });
    void handleCreatePlannedEvent(eventInput).then(() => {
      onPendingWorkoutImported?.();
    });
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
          headers: getSavedIntervalsHeaders(),
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

          if (cloudState.plannedEvents.length > 0 && serverIsNewer) {
            setPlannedEvents(cloudState.plannedEvents);
          } else if (cloudState.plannedEvents.length > 0 && plannedEvents.length === 0) {
            setPlannedEvents(cloudState.plannedEvents);
          }

          if (cloudState.targetGoals.length > 0 && serverIsNewer) {
            setTargetGoals(cloudState.targetGoals);
          } else if (cloudState.targetGoals.length > 0 && targetGoals.length === 0) {
            setTargetGoals(cloudState.targetGoals);
          }

          if (cloudState.annualMileageGoals.length > 0 && serverIsNewer) {
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
    setPlannedEvents,
    setTargetGoals,
    setAnnualMileageGoals,
    setDistanceUnit,
    setAthleteProfile,
  ]);

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
          academicDivision: athleteProfile.academicDivision,
          competitionGender: athleteProfile.competitionGender,
        };

        const res = await fetch('/api/athlete-state', {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getSavedIntervalsHeaders(),
          },
          body: JSON.stringify({
            plannedEvents,
            targetGoals,
            annualMileageGoals,
            athleteProfile: cleanProfile,
            distanceUnit,
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
  ]);
}
