import React, { useCallback } from 'react';
import type {
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  ConnectedAthleteRecord,
  ConnectionStatus,
  PlannedWorkoutEvent,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  buildCompleteAthleteProfile,
  getSavedIntervalsHeaders,
  mergeActivitiesNonDestructive,
  recomputeWellnessDaysWithActivityImport,
  replaceGearItemsInStore,
  savePersistedTelemetrySnapshot,
} from '../utils/telemetryStorage';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';

interface UseAthleteProfileAndGoalsParams {
  isSampleDemoMode: boolean;
  activeConnectedAthlete: ConnectedAthleteRecord | null;
  triggerReadOnlyAlert: (athleteName: string, actionLabel: string) => void;
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  plannedEventsRef: React.MutableRefObject<PlannedWorkoutEvent[]>;
  gearItemsRef: React.MutableRefObject<AthleteGearItem[]>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  redactedStravaCountRef: React.MutableRefObject<number>;
  sampleDemoProfile: AthleteProfile;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  setGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setIsSyncingProfile: React.Dispatch<React.SetStateAction<boolean>>;
  setAnnualMileageGoals: React.Dispatch<React.SetStateAction<AnnualMileageGoal[]>>;
  setTargetGoals: React.Dispatch<React.SetStateAction<TargetGoal[]>>;
  setConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setSampleDemoProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setSampleDemoActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setSampleDemoWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  setSampleDemoAnnualGoals: React.Dispatch<React.SetStateAction<AnnualMileageGoal[]>>;
  setSampleDemoTargetGoals: React.Dispatch<React.SetStateAction<TargetGoal[]>>;
  setSampleDemoGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  setSampleDemoConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
}

/**
 * Manages athlete profile calibration, remote profile sync, race/activity imports,
 * gear inventory, and annual/target goals across both personal and Sample Demo modes.
 */
export function useAthleteProfileAndGoals({
  isSampleDemoMode,
  activeConnectedAthlete,
  triggerReadOnlyAlert,
  activitiesRef,
  wellnessDaysRef,
  plannedEventsRef,
  gearItemsRef,
  athleteProfileRef,
  redactedStravaCountRef,
  sampleDemoProfile,
  setActivities,
  setWellnessDays,
  setGearItems,
  setAthleteProfile,
  setConnectionStatus,
  setIsSyncingProfile,
  setAnnualMileageGoals,
  setTargetGoals,
  setConnectedAthletes,
  setSampleDemoProfile,
  setSampleDemoActivities,
  setSampleDemoWellnessDays,
  setSampleDemoAnnualGoals,
  setSampleDemoTargetGoals,
  setSampleDemoGearItems,
  setSampleDemoConnectedAthletes,
}: UseAthleteProfileAndGoalsParams) {
  const handleSyncProfileFromRemote = useCallback(async () => {
    setIsSyncingProfile(true);
    try {
      const resp = await fetch('/api/intervals/profile/sync', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getSavedIntervalsHeaders(),
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.athleteProfile) {
          if (
            data.athleteProfile.name &&
            data.athleteProfile.name !== 'Athlete' &&
            data.athleteProfile.name !== 'Strava Athlete' &&
            data.athleteProfile.name !== 'Strava User'
          ) {
            try {
              localStorage.setItem('aeropulse_strava_athlete_name', data.athleteProfile.name);
            } catch {
              // ignore storage errors
            }
          }
          const latestW =
            wellnessDaysRef.current.length > 0
              ? wellnessDaysRef.current[wellnessDaysRef.current.length - 1]
              : undefined;
          const synced = buildCompleteAthleteProfile(
            data.athleteProfile,
            latestW,
            activitiesRef.current
          );
          setAthleteProfile(synced);
          athleteProfileRef.current = synced;
          setConnectionStatus((prev) => ({
            ...prev,
            athleteFtp: synced.ftp,
            athleteIndoorFtp: synced.indoorFtp,
            athleteRunFtp: synced.runFtp,
            athleteLthr: synced.lthr,
            athleteMaxHr: synced.maxHr,
            athleteProfile: synced,
          }));
          void savePersistedTelemetrySnapshot({
            activities: activitiesRef.current,
            wellnessDays: wellnessDaysRef.current,
            plannedEvents: plannedEventsRef.current,
            gearItems: gearItemsRef.current,
            athleteProfile: synced,
            redactedStravaCount: redactedStravaCountRef.current,
          });
        }
      }
    } finally {
      setIsSyncingProfile(false);
    }
  }, [
    activitiesRef,
    wellnessDaysRef,
    plannedEventsRef,
    gearItemsRef,
    athleteProfileRef,
    redactedStravaCountRef,
    setIsSyncingProfile,
    setAthleteProfile,
    setConnectionStatus,
  ]);

  const handleSaveProfileOverride = useCallback(
    async (updatedProfile: AthleteProfile) => {
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'update physiological zones');
          return;
        }
        const applyRosterProfile = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id ? { ...a, athleteProfile: updatedProfile } : a
          );
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(applyRosterProfile);
        } else {
          setConnectedAthletes(applyRosterProfile);
        }
        return;
      }

      if (isSampleDemoMode) {
        setSampleDemoProfile(updatedProfile);
        return;
      }

      setAthleteProfile(updatedProfile);
      athleteProfileRef.current = updatedProfile;
      setConnectionStatus((prev) => ({
        ...prev,
        athleteFtp: updatedProfile.ftp,
        athleteIndoorFtp: updatedProfile.indoorFtp,
        athleteRunFtp: updatedProfile.runFtp,
        athleteLthr: updatedProfile.lthr,
        athleteMaxHr: updatedProfile.maxHr,
        athleteProfile: updatedProfile,
      }));
      void savePersistedTelemetrySnapshot({
        activities: activitiesRef.current,
        wellnessDays: wellnessDaysRef.current,
        plannedEvents: plannedEventsRef.current,
        gearItems: gearItemsRef.current,
        athleteProfile: updatedProfile,
        redactedStravaCount: redactedStravaCountRef.current,
      });
      try {
        await fetch('/api/athlete/profile', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getSavedIntervalsHeaders(),
          },
          body: JSON.stringify({ athleteProfile: updatedProfile }),
        });
      } catch {
        // ignore offline error
      }
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      activitiesRef,
      wellnessDaysRef,
      plannedEventsRef,
      gearItemsRef,
      athleteProfileRef,
      redactedStravaCountRef,
      setSampleDemoConnectedAthletes,
      setConnectedAthletes,
      setSampleDemoProfile,
      setAthleteProfile,
      setConnectionStatus,
    ]
  );

  // Import watchless Official FAT Race Results into activities archive & IndexedDB
  const handleImportOfficialRaces = useCallback(
    (importedRaces: UnifiedActivity[]) => {
      if (!importedRaces || importedRaces.length === 0) return;
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'import official race results');
          return;
        }
        const mergeRosterRaces = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id
              ? { ...a, activities: mergeActivitiesNonDestructive(a.activities, importedRaces) }
              : a
          );
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(mergeRosterRaces);
        } else {
          setConnectedAthletes(mergeRosterRaces);
        }
        return;
      }
      if (isSampleDemoMode) {
        setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, importedRaces));
        return;
      }
      setActivities((prev) => {
        const merged = mergeActivitiesNonDestructive(prev, importedRaces);
        activitiesRef.current = merged;
        void savePersistedTelemetrySnapshot({
          activities: merged,
          wellnessDays: wellnessDaysRef.current,
          plannedEvents: plannedEventsRef.current,
          gearItems: gearItemsRef.current,
          athleteProfile: athleteProfileRef.current,
          redactedStravaCount: redactedStravaCountRef.current,
        });
        return merged;
      });
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      activitiesRef,
      wellnessDaysRef,
      plannedEventsRef,
      gearItemsRef,
      athleteProfileRef,
      redactedStravaCountRef,
      setSampleDemoConnectedAthletes,
      setConnectedAthletes,
      setSampleDemoActivities,
      setActivities,
    ]
  );

  const handleUpdateAnnualMileageGoal = useCallback(
    (sport: 'Running' | 'Cycling' | 'Swimming', targetMeters: number) => {
      const updater = (prev: AnnualMileageGoal[]) => {
        const exists = prev.some((g) => g.sportCategory === sport);
        if (!exists) {
          const fallbackYear = prev[0]?.year || new Date().getFullYear();
          return [
            ...prev,
            {
              sportCategory: sport,
              year: fallbackYear,
              targetDistanceMeters: targetMeters,
            },
          ];
        }
        return prev.map((g) =>
          g.sportCategory === sport ? { ...g, targetDistanceMeters: targetMeters } : g
        );
      };
      if (isSampleDemoMode) {
        setSampleDemoAnnualGoals(updater);
        return;
      }
      setAnnualMileageGoals(updater);
    },
    [isSampleDemoMode, setSampleDemoAnnualGoals, setAnnualMileageGoals]
  );

  const handleAddTargetGoal = useCallback(
    (newGoal: Omit<TargetGoal, 'id'>) => {
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'add target race or power goals');
          return;
        }
        const created: TargetGoal = { ...newGoal, id: `goal-${Date.now()}` };
        const applyAddRosterGoal = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id
              ? { ...a, targetGoals: [created, ...a.targetGoals] }
              : a
          );
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(applyAddRosterGoal);
        } else {
          setConnectedAthletes(applyAddRosterGoal);
        }
        return;
      }
      if (isSampleDemoMode) {
        setSampleDemoTargetGoals((prev) => [{ ...newGoal, id: `goal-${Date.now()}` }, ...prev]);
        return;
      }
      setTargetGoals((prev) => [{ ...newGoal, id: `goal-${Date.now()}` }, ...prev]);
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      setSampleDemoConnectedAthletes,
      setConnectedAthletes,
      setSampleDemoTargetGoals,
      setTargetGoals,
    ]
  );

  const handleDeleteTargetGoal = useCallback(
    (id: string) => {
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'delete target goals');
          return;
        }
        const applyDeleteRosterGoal = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id
              ? { ...a, targetGoals: a.targetGoals.filter((g) => g.id !== id) }
              : a
          );
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(applyDeleteRosterGoal);
        } else {
          setConnectedAthletes(applyDeleteRosterGoal);
        }
        return;
      }
      if (isSampleDemoMode) {
        setSampleDemoTargetGoals((prev) => prev.filter((g) => g.id !== id));
        return;
      }
      setTargetGoals((prev) => prev.filter((g) => g.id !== id));
    },
    [
      activeConnectedAthlete,
      isSampleDemoMode,
      triggerReadOnlyAlert,
      setSampleDemoConnectedAthletes,
      setConnectedAthletes,
      setSampleDemoTargetGoals,
      setTargetGoals,
    ]
  );

  const handleSaveGearItems = useCallback(
    async (nextItems: AthleteGearItem[]) => {
      if (isSampleDemoMode) {
        setSampleDemoGearItems(nextItems);
        return;
      }
      gearItemsRef.current = nextItems;
      setGearItems(nextItems);
      await replaceGearItemsInStore(nextItems);
    },
    [isSampleDemoMode, gearItemsRef, setSampleDemoGearItems, setGearItems]
  );

  const applyImportedActivities = useCallback(
    (incomingActs: UnifiedActivity[]) => {
      if (!incomingActs || incomingActs.length === 0) return;
      const todayIso = getLocalDateIso();
      if (isSampleDemoMode) {
        setSampleDemoActivities((prev) => {
          const merged = mergeActivitiesNonDestructive(prev, incomingActs);
          setSampleDemoWellnessDays((prevW) =>
            recomputeWellnessDaysWithActivityImport(prevW, merged, todayIso, sampleDemoProfile)
          );
          return merged;
        });
        return;
      }
      const merged = mergeActivitiesNonDestructive(activitiesRef.current, incomingActs);
      activitiesRef.current = merged;
      setActivities(merged);
      const rebuiltWellness = recomputeWellnessDaysWithActivityImport(
        wellnessDaysRef.current,
        merged,
        todayIso,
        athleteProfileRef.current
      );
      wellnessDaysRef.current = rebuiltWellness;
      setWellnessDays(rebuiltWellness);
    },
    [
      isSampleDemoMode,
      sampleDemoProfile,
      activitiesRef,
      wellnessDaysRef,
      athleteProfileRef,
      setSampleDemoActivities,
      setSampleDemoWellnessDays,
      setActivities,
      setWellnessDays,
    ]
  );

  const handleImportSingleParsedActivity = useCallback(
    (newAct: UnifiedActivity) => {
      applyImportedActivities([newAct]);
    },
    [applyImportedActivities]
  );

  const handleImportMultipleParsedActivities = useCallback(
    (newActs: UnifiedActivity[]) => {
      applyImportedActivities(newActs);
    },
    [applyImportedActivities]
  );

  return {
    handleSyncProfileFromRemote,
    handleSaveProfileOverride,
    handleImportOfficialRaces,
    handleUpdateAnnualMileageGoal,
    handleAddTargetGoal,
    handleDeleteTargetGoal,
    handleSaveGearItems,
    applyImportedActivities,
    handleImportSingleParsedActivity,
    handleImportMultipleParsedActivities,
  };
}
