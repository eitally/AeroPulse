import React, { useCallback } from 'react';
import type {
  ActiveTab,
  AnnualMileageGoal,
  AthleteGearItem,
  AthletePrivacySettings,
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  ConnectionStatus,
  DistanceUnit,
  PlannedWorkoutEvent,
  TargetGoal,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { FirstRunCalibrationPayload } from '../components/StravaAuthGate';
import type { RosterTab } from '../components/AthleteRosterModal';
import { INITIAL_ANNUAL_MILEAGE_GOALS } from '../data/mockTelemetry';
import {
  DEFAULT_SELF_PRIVACY_SETTINGS,
  buildInitialConnectedAthletes,
} from '../data/athleteRosterData';
import { clearAllUserBrowserStorage } from '../utils/storageKeys';
import { markSessionActiveHint } from '../utils/sessionHint';
import { clearFieldOutboxDb } from '../utils/fieldEventsOutbox';
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  getSavedIntervalsHeaders,
  isGenericAthleteName,
  savePersistedTelemetrySnapshot,
} from '../utils/telemetryStorage';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';

interface UseWorkspaceOnboardingParams {
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  plannedEventsRef: React.MutableRefObject<PlannedWorkoutEvent[]>;
  gearItemsRef: React.MutableRefObject<AthleteGearItem[]>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  redactedStravaCountRef: React.MutableRefObject<number>;
  hasEnteredWorkspaceRef: React.MutableRefObject<boolean>;
  idbHydratedRef: React.MutableRefObject<boolean>;
  athleteProfile: AthleteProfile;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  setGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setRedactedStravaCount: React.Dispatch<React.SetStateAction<number>>;
  setTargetGoals: React.Dispatch<React.SetStateAction<TargetGoal[]>>;
  setAnnualMileageGoals: React.Dispatch<React.SetStateAction<AnnualMileageGoal[]>>;
  setSelfPrivacySettings: React.Dispatch<React.SetStateAction<AthletePrivacySettings>>;
  setConnectedAthletes: React.Dispatch<React.SetStateAction<ConnectedAthleteRecord[]>>;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  setActiveTeamId: React.Dispatch<React.SetStateAction<string | null>>;
  setExplicitPersonalMode: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedActivity: React.Dispatch<React.SetStateAction<UnifiedActivity | null>>;
  setInspectedFromCoach: React.Dispatch<React.SetStateAction<boolean>>;
  setDismissedStravaBanner: React.Dispatch<React.SetStateAction<boolean>>;
  setDismissedQuickConnectBanner: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsProfileModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<ThreshUser | null>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setIdbSavedAt: React.Dispatch<React.SetStateAction<string | null>>;
  setIsSampleDemoMode: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSessionLoggedOut: React.Dispatch<React.SetStateAction<boolean>>;
  setHasEnteredWorkspace: React.Dispatch<React.SetStateAction<boolean>>;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setActiveTab: React.Dispatch<React.SetStateAction<ActiveTab>>;
  setCoachSubTab: React.Dispatch<React.SetStateAction<CoachWorkspaceSubTab>>;
  setIsDataSourcesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRosterInitialTab: React.Dispatch<React.SetStateAction<RosterTab>>;
  setIsRosterModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  resetSampleDemoEphemeralState: () => void;
  resetUserCloudSyncState: () => void;
  fetchServerConfigStatus: () => Promise<unknown>;
  handleTeamsUpdated: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
  handleSaveProfileOverride: (profile: AthleteProfile) => Promise<void>;
}

export function useWorkspaceOnboarding({
  activitiesRef,
  wellnessDaysRef,
  plannedEventsRef,
  gearItemsRef,
  athleteProfileRef,
  redactedStravaCountRef,
  hasEnteredWorkspaceRef,
  idbHydratedRef,
  athleteProfile,
  setActivities,
  setWellnessDays,
  setPlannedEvents,
  setGearItems,
  setAthleteProfile,
  setRedactedStravaCount,
  setTargetGoals,
  setAnnualMileageGoals,
  setSelfPrivacySettings,
  setConnectedAthletes,
  setMyTeams,
  setActiveTeamId,
  setExplicitPersonalMode,
  setActiveViewedAthleteId,
  setSelectedActivity,
  setInspectedFromCoach,
  setDismissedStravaBanner,
  setDismissedQuickConnectBanner,
  setSyncError,
  setIsProfileModalOpen,
  setCurrentUser,
  setConnectionStatus,
  setIdbSavedAt,
  setIsSampleDemoMode,
  setIsSessionLoggedOut,
  setHasEnteredWorkspace,
  setDistanceUnit,
  setActiveTab,
  setCoachSubTab,
  setIsDataSourcesOpen,
  setRosterInitialTab,
  setIsRosterModalOpen,
  resetSampleDemoEphemeralState,
  resetUserCloudSyncState,
  fetchServerConfigStatus,
  handleTeamsUpdated,
  handleSaveProfileOverride,
}: UseWorkspaceOnboardingParams) {
  const resetClientWorkspaceStateOnLogout = useCallback(
    async (clearAllVaultKeys: boolean) => {
      const activeHeaders = getSavedIntervalsHeaders();
      setIsSampleDemoMode(false);
      resetSampleDemoEphemeralState();
      resetUserCloudSyncState();
      setIsSessionLoggedOut(true);
      setHasEnteredWorkspace(false);
      hasEnteredWorkspaceRef.current = false;
      idbHydratedRef.current = false;

      // Always purge all user/credential/team browser keys unconditionally on Sign Out so shared devices
      // never leak User A tokens, backfill markers, check-ins, or goals into User B's session.
      clearAllUserBrowserStorage({ preserveLoggedOutFlag: true });
      if (typeof window !== 'undefined') {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          let changed = false;
          for (const transientKey of [
            'auth_just_signed_in',
            'oauth_just_connected',
            'oauth',
            'code',
            'state',
          ]) {
            if (urlParams.has(transientKey)) {
              urlParams.delete(transientKey);
              changed = true;
            }
          }
          if (changed) {
            const cleanQs = urlParams.toString();
            const nextUrl = `${window.location.pathname}${cleanQs ? `?${cleanQs}` : ''}${window.location.hash}`;
            window.history.replaceState({}, '', nextUrl);
          }
        } catch {
          // ignore URL cleanup errors
        }
      }

      applyTeamBrandToDocument(null);
      setActivities([]);
      activitiesRef.current = [];
      setWellnessDays([]);
      wellnessDaysRef.current = [];
      setPlannedEvents([]);
      plannedEventsRef.current = [];
      setGearItems([]);
      gearItemsRef.current = [];
      setTargetGoals([]);
      setAnnualMileageGoals(INITIAL_ANNUAL_MILEAGE_GOALS);
      setSelfPrivacySettings(DEFAULT_SELF_PRIVACY_SETTINGS);
      setConnectedAthletes(buildInitialConnectedAthletes());
      setMyTeams([]);
      setActiveTeamId(null);
      setExplicitPersonalMode(false);
      setActiveViewedAthleteId('SELF');
      setSelectedActivity(null);
      setInspectedFromCoach(false);
      setDismissedStravaBanner(false);
      setDismissedQuickConnectBanner(false);
      setSyncError(null);
      setActiveTab('fitness');
      setIsDataSourcesOpen(false);
      setIsRosterModalOpen(false);
      setIsProfileModalOpen(false);
      setCurrentUser(null);
      const defaultProf = buildCompleteAthleteProfile(null);
      setAthleteProfile(defaultProf);
      athleteProfileRef.current = defaultProf;
      setRedactedStravaCount(0);
      redactedStravaCountRef.current = 0;
      setConnectionStatus((prev) => ({
        ...prev,
        mode: 'SANDBOX_CALIBRATION',
        currentUser: null,
        athleteProfile: undefined,
        athleteFtp: undefined,
        athleteIndoorFtp: undefined,
        athleteRunFtp: undefined,
        athleteLthr: undefined,
        athleteMaxHr: undefined,
        stravaConnected: false,
        stravaAthleteId: undefined,
        stravaAthleteName: undefined,
        stravaGrantedScope: undefined,
        stravaSyncPolicy: undefined,
        stravaSource: 'NONE',
        garminConnected: false,
        garminAthleteName: undefined,
        wahooConnected: false,
        wahooAthleteName: undefined,
        polarConnected: false,
        polarAthleteName: undefined,
        intervalsConnected: false,
        intervalsAthleteId: '0',
        intervalsAthleteName: undefined,
        intervalsSource: 'NONE',
      }));
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...activeHeaders },
          body: JSON.stringify({ clearCredentials: clearAllVaultKeys }),
        });
      } catch {
        // ignore
      }
      // Always purge shared-device IndexedDB workouts & wellness on Sign Out so the next user
      // on a school iPad / Chromebook never inherits the prior athlete's history.
      await clearPersistedTelemetrySnapshot();
      await clearFieldOutboxDb();
      setIdbSavedAt(null);
      await fetchServerConfigStatus();
    },
    [
      activitiesRef,
      athleteProfileRef,
      fetchServerConfigStatus,
      gearItemsRef,
      hasEnteredWorkspaceRef,
      idbHydratedRef,
      plannedEventsRef,
      redactedStravaCountRef,
      resetSampleDemoEphemeralState,
      resetUserCloudSyncState,
      setActiveTab,
      setActiveTeamId,
      setActiveViewedAthleteId,
      setActivities,
      setAnnualMileageGoals,
      setAthleteProfile,
      setConnectedAthletes,
      setConnectionStatus,
      setCurrentUser,
      setDismissedQuickConnectBanner,
      setDismissedStravaBanner,
      setExplicitPersonalMode,
      setGearItems,
      setHasEnteredWorkspace,
      setIdbSavedAt,
      setInspectedFromCoach,
      setIsDataSourcesOpen,
      setIsProfileModalOpen,
      setIsRosterModalOpen,
      setIsSampleDemoMode,
      setIsSessionLoggedOut,
      setMyTeams,
      setPlannedEvents,
      setRedactedStravaCount,
      setSelectedActivity,
      setSelfPrivacySettings,
      setSyncError,
      setTargetGoals,
      setWellnessDays,
      wellnessDaysRef,
    ]
  );

  const handleLogoutSession = useCallback(() => {
    void resetClientWorkspaceStateOnLogout(false);
  }, [resetClientWorkspaceStateOnLogout]);

  const handleLogoutAndClearData = useCallback(async () => {
    await resetClientWorkspaceStateOnLogout(true);
  }, [resetClientWorkspaceStateOnLogout]);

  const handleCompleteCalibrationEntry = useCallback(
    async (payload: FirstRunCalibrationPayload) => {
      const cleanName = payload.athleteName.trim() || athleteProfileRef.current.name || 'Athlete';
      const hasSeedOverride = Boolean(payload.hasCustomSeedMark);

      let thresholdPaceSecsPerKm = athleteProfileRef.current.thresholdPaceSecsPerKm || 260;
      if (hasSeedOverride && payload.thresholdPaceInput) {
        const paceMatch = payload.thresholdPaceInput.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (paceMatch) {
          const totalSecs = Number(paceMatch[1]) * 60 + Number(paceMatch[2]);
          if (totalSecs >= 120 && totalSecs <= 900) {
            thresholdPaceSecsPerKm =
              payload.distanceUnit === 'mi'
                ? Math.round(totalSecs / 1.609344)
                : Math.round(totalSecs);
          }
        }
      }

      const customFtp =
        hasSeedOverride && payload.cyclingFtpWatts && payload.cyclingFtpWatts > 50
          ? Math.round(payload.cyclingFtpWatts)
          : undefined;

      const calibratedProfile = buildCompleteAthleteProfile(
        {
          ...athleteProfileRef.current,
          ...(hasSeedOverride ? { source: 'CUSTOM_OVERRIDE' as const } : {}),
          name: !isGenericAthleteName(cleanName) ? cleanName : athleteProfileRef.current.name,
          primarySport: payload.primarySport,
          ...(customFtp ? { ftp: customFtp, indoorFtp: customFtp } : {}),
          ...(hasSeedOverride ? { thresholdPaceSecsPerKm } : {}),
          safeSportHideWeight: Boolean(
            payload.safeSportHideWeight || athleteProfileRef.current.safeSportHideWeight
          ),
          ...(payload.birthMonthYear ? { birthMonthYear: payload.birthMonthYear } : {}),
        },
        wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
        activitiesRef.current
      );

      setIsSampleDemoMode(false);
      setDistanceUnit(payload.distanceUnit);
      try {
        localStorage.setItem('thresh_primary_sport', payload.primarySport);
        localStorage.setItem('thresh_distance_unit', payload.distanceUnit);
        localStorage.setItem('thresh_distance_unit_user_set', '1');
        localStorage.removeItem('aeropulse_logged_out');
        localStorage.setItem('aeropulse_auth_gate_passed', '1');
        localStorage.setItem('aeropulse_calibrated_v1', '1');
        markSessionActiveHint();
        if (
          window.location.pathname.startsWith('/join/') ||
          window.location.search.includes('join=')
        ) {
          window.history.replaceState({}, '', '/');
        }
      } catch {
        // ignore storage quota errors
      }

      if (payload.stravaSyncPolicy) {
        setConnectionStatus((prev) => ({
          ...prev,
          stravaSyncPolicy: payload.stravaSyncPolicy,
        }));
      }

      if (payload.claimedTeams && payload.claimedTeams.length > 0) {
        handleTeamsUpdated(
          payload.claimedTeams,
          payload.activeTeamId || payload.claimedTeams[0].brand.teamId
        );
      }

      if (hasSeedOverride) {
        await handleSaveProfileOverride(calibratedProfile);
      } else {
        setAthleteProfile(calibratedProfile);
        athleteProfileRef.current = calibratedProfile;
      }
      void savePersistedTelemetrySnapshot({
        activities: activitiesRef.current,
        wellnessDays: wellnessDaysRef.current,
        plannedEvents: plannedEventsRef.current,
        gearItems: gearItemsRef.current,
        athleteProfile: calibratedProfile,
        redactedStravaCount: redactedStravaCountRef.current,
      });

      setIsSessionLoggedOut(false);
      setHasEnteredWorkspace(true);
      hasEnteredWorkspaceRef.current = true;

      if (payload.entryTarget === 'DATA_SOURCES') {
        setIsDataSourcesOpen(true);
      } else if (payload.entryTarget === 'UPLOAD_FIT') {
        setActiveTab('activities');
      } else if (payload.entryTarget === 'COACH_MODE') {
        setActiveTab('coach');
        setCoachSubTab('CLIPBOARD');
      } else if (payload.entryTarget === 'CREATE_TEAM') {
        setActiveTab('coach');
        setCoachSubTab('ROSTER');
      } else {
        setActiveTab('fitness');
      }
    },
    [
      activitiesRef,
      athleteProfileRef,
      gearItemsRef,
      handleSaveProfileOverride,
      handleTeamsUpdated,
      hasEnteredWorkspaceRef,
      plannedEventsRef,
      redactedStravaCountRef,
      setActiveTab,
      setAthleteProfile,
      setCoachSubTab,
      setConnectionStatus,
      setDistanceUnit,
      setHasEnteredWorkspace,
      setIsDataSourcesOpen,
      setIsRosterModalOpen,
      setIsSampleDemoMode,
      setIsSessionLoggedOut,
      setRosterInitialTab,
      wellnessDaysRef,
    ]
  );

  const handleBypassToLocalSession = useCallback(async () => {
    try {
      localStorage.removeItem('aeropulse_logged_out');
      localStorage.setItem('aeropulse_auth_gate_passed', '1');
      markSessionActiveHint();
      await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteName: athleteProfile.name || 'Athlete' }),
      });
    } catch {
      try {
        localStorage.removeItem('aeropulse_logged_out');
        localStorage.setItem('aeropulse_auth_gate_passed', '1');
        markSessionActiveHint();
      } catch {
        // ignore storage quota errors
      }
    }
    setHasEnteredWorkspace(true);
    hasEnteredWorkspaceRef.current = true;
    setIsSessionLoggedOut(false);
    setConnectionStatus((prev) => ({
      ...prev,
      stravaConnected: true,
      stravaAthleteName: prev.stravaAthleteName || athleteProfile.name || 'Local Athlete',
    }));
  }, [
    athleteProfile.name,
    hasEnteredWorkspaceRef,
    setConnectionStatus,
    setHasEnteredWorkspace,
    setIsSessionLoggedOut,
  ]);

  return {
    handleLogoutSession,
    handleLogoutAndClearData,
    handleCompleteCalibrationEntry,
    handleBypassToLocalSession,
  };
}
