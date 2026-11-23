import React, { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AnnualMileageGoal,
  AthleteGearItem,
  AthletePrivacySettings,
  AthleteProfile,
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  TargetGoal,
  TeamSummaryWithRole,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { INITIAL_ANNUAL_MILEAGE_GOALS } from '../data/mockTelemetry';
import { buildSampleDemoDataset } from '../data/sampleDemoData';
import {
  DEFAULT_SELF_PRIVACY_SETTINGS,
  buildInitialConnectedAthletes,
} from '../data/athleteRosterData';

const DEMO_STOPWATCH_BACKUP_KEY = 'thresh_trackside_stopwatch_backup_v1';

export function backupRealStopwatchForDemo(): void {
  try {
    if (typeof window === 'undefined') return;
    if (!window.localStorage.getItem(DEMO_STOPWATCH_BACKUP_KEY)) {
      const existingReal = window.localStorage.getItem('thresh_trackside_stopwatch_v1');
      if (existingReal !== null) {
        window.localStorage.setItem(DEMO_STOPWATCH_BACKUP_KEY, existingReal);
      }
    }
  } catch {
    // ignore storage errors
  }
}

export function restoreRealStopwatchAfterDemo(): void {
  try {
    if (typeof window === 'undefined') return;
    const backup = window.localStorage.getItem(DEMO_STOPWATCH_BACKUP_KEY);
    if (backup !== null) {
      window.localStorage.setItem('thresh_trackside_stopwatch_v1', backup);
      window.localStorage.removeItem(DEMO_STOPWATCH_BACKUP_KEY);
    }
    window.localStorage.removeItem('thresh_sample_demo_active');
    window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
  } catch {
    // ignore storage errors
  }
}

interface UseSampleDemoWorkspaceParams {
  initialIsSampleQuery: boolean;
  setSelectedActivity: React.Dispatch<React.SetStateAction<UnifiedActivity | null>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
  setInspectedFromCoach: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Isolates ephemeral Sample Demo workspace state and stopwatch localStorage backup/restore
 * so entering or resetting sample mode never mutates real athlete telemetry.
 */
export function useSampleDemoWorkspace({
  initialIsSampleQuery,
  setSelectedActivity,
  setActiveViewedAthleteId,
  setInspectedFromCoach,
}: UseSampleDemoWorkspaceParams) {
  const [isSampleDemoMode, setIsSampleDemoMode] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        if (initialIsSampleQuery) {
          backupRealStopwatchForDemo();
          return true;
        }
        if (localStorage.getItem('thresh_sample_demo_active') === 'true') {
          backupRealStopwatchForDemo();
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  });

  const sampleDemoDataset = useMemo(() => buildSampleDemoDataset(), []);
  const [sampleDemoPlannedEvents, setSampleDemoPlannedEvents] = useState<PlannedWorkoutEvent[]>(
    () => sampleDemoDataset.plannedEvents
  );
  const [sampleDemoProfile, setSampleDemoProfile] = useState<AthleteProfile>(
    () => sampleDemoDataset.athleteProfile
  );
  const [sampleDemoActivities, setSampleDemoActivities] = useState<UnifiedActivity[]>(
    () => sampleDemoDataset.activities
  );
  const [sampleDemoWellnessDays, setSampleDemoWellnessDays] = useState<UnifiedWellnessDay[]>(
    () => sampleDemoDataset.wellnessDays
  );
  const [sampleDemoAnnualGoals, setSampleDemoAnnualGoals] = useState<AnnualMileageGoal[]>(
    () => INITIAL_ANNUAL_MILEAGE_GOALS
  );
  const [sampleDemoTargetGoals, setSampleDemoTargetGoals] = useState<TargetGoal[]>(
    () => sampleDemoDataset.targetGoals
  );
  const [sampleDemoGearItems, setSampleDemoGearItems] = useState<AthleteGearItem[]>(
    () => sampleDemoDataset.gearItems
  );
  const [sampleDemoPrivacySettings, setSampleDemoPrivacySettings] =
    useState<AthletePrivacySettings>(() => DEFAULT_SELF_PRIVACY_SETTINGS);
  const [sampleDemoConnectedAthletes, setSampleDemoConnectedAthletes] = useState<
    ConnectedAthleteRecord[]
  >(() => buildInitialConnectedAthletes());
  const [sampleDemoTeams, setSampleDemoTeams] = useState<TeamSummaryWithRole[]>(
    () => sampleDemoDataset.demoTeams || []
  );
  const [sampleDemoActiveTeamId, setSampleDemoActiveTeamId] = useState<string | null>(
    () => sampleDemoDataset.demoTeams?.[0]?.brand.teamId || null
  );
  const [sampleDemoExplicitPersonal, setSampleDemoExplicitPersonal] = useState(false);

  const resetDemoCheckInsRef = useRef<(() => void) | null>(null);

  const resetSampleDemoEphemeralState = useCallback(
    (options?: { clearDemoStopwatch?: boolean }) => {
      const fresh = buildSampleDemoDataset();
      setSampleDemoPlannedEvents(fresh.plannedEvents);
      setSampleDemoProfile(fresh.athleteProfile);
      setSampleDemoActivities(fresh.activities);
      setSampleDemoWellnessDays(fresh.wellnessDays);
      setSampleDemoAnnualGoals(INITIAL_ANNUAL_MILEAGE_GOALS);
      setSampleDemoTargetGoals(fresh.targetGoals);
      setSampleDemoGearItems(fresh.gearItems);
      setSampleDemoPrivacySettings(DEFAULT_SELF_PRIVACY_SETTINGS);
      setSampleDemoConnectedAthletes(buildInitialConnectedAthletes());
      setSampleDemoTeams(fresh.demoTeams || []);
      setSampleDemoActiveTeamId(fresh.demoTeams?.[0]?.brand.teamId || null);
      setSampleDemoExplicitPersonal(false);
      setSelectedActivity(null);
      setActiveViewedAthleteId('SELF');
      setInspectedFromCoach(false);
      resetDemoCheckInsRef.current?.();
      if (options?.clearDemoStopwatch) {
        backupRealStopwatchForDemo();
        try {
          window.localStorage.removeItem('thresh_trackside_stopwatch_v1');
          window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
        } catch {
          // ignore storage errors
        }
      }
    },
    [setSelectedActivity, setActiveViewedAthleteId, setInspectedFromCoach]
  );

  const exitSampleDemoMode = useCallback(() => {
    restoreRealStopwatchAfterDemo();
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('demo') || params.has('sample')) {
        params.delete('demo');
        params.delete('sample');
        const nextSearch = params.toString();
        const cleanUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', cleanUrl);
      }
    } catch {
      // ignore history errors
    }
    setIsSampleDemoMode(false);
    resetSampleDemoEphemeralState();
  }, [resetSampleDemoEphemeralState]);

  return {
    isSampleDemoMode,
    setIsSampleDemoMode,
    sampleDemoPlannedEvents,
    setSampleDemoPlannedEvents,
    sampleDemoProfile,
    setSampleDemoProfile,
    sampleDemoActivities,
    setSampleDemoActivities,
    sampleDemoWellnessDays,
    setSampleDemoWellnessDays,
    sampleDemoAnnualGoals,
    setSampleDemoAnnualGoals,
    sampleDemoTargetGoals,
    setSampleDemoTargetGoals,
    sampleDemoGearItems,
    setSampleDemoGearItems,
    sampleDemoPrivacySettings,
    setSampleDemoPrivacySettings,
    sampleDemoConnectedAthletes,
    setSampleDemoConnectedAthletes,
    sampleDemoTeams,
    setSampleDemoTeams,
    sampleDemoActiveTeamId,
    setSampleDemoActiveTeamId,
    sampleDemoExplicitPersonal,
    setSampleDemoExplicitPersonal,
    resetDemoCheckInsRef,
    resetSampleDemoEphemeralState,
    exitSampleDemoMode,
  };
}
