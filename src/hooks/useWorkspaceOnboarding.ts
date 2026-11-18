import React, { useCallback } from 'react';
import type {
  ActiveTab,
  AthleteGearItem,
  AthleteProfile,
  CoachWorkspaceSubTab,
  ConnectionStatus,
  DistanceUnit,
  PlannedWorkoutEvent,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import type { FirstRunCalibrationPayload } from '../components/StravaAuthGate';
import type { RosterTab } from '../components/AthleteRosterModal';
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
  athleteProfile: AthleteProfile;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  setGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setRedactedStravaCount: React.Dispatch<React.SetStateAction<number>>;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  setActiveTeamId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
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
  fetchServerConfigStatus: () => Promise<void>;
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
  athleteProfile,
  setActivities,
  setWellnessDays,
  setPlannedEvents,
  setGearItems,
  setAthleteProfile,
  setRedactedStravaCount,
  setMyTeams,
  setActiveTeamId,
  setActiveViewedAthleteId,
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
  fetchServerConfigStatus,
  handleTeamsUpdated,
  handleSaveProfileOverride,
}: UseWorkspaceOnboardingParams) {
  const resetClientWorkspaceStateOnLogout = useCallback(
    async (clearAllVaultKeys: boolean) => {
      setIsSampleDemoMode(false);
      resetSampleDemoEphemeralState();
      setIsSessionLoggedOut(true);
      setHasEnteredWorkspace(false);
      hasEnteredWorkspaceRef.current = false;
      const activeHeaders = getSavedIntervalsHeaders();
      try {
        localStorage.setItem('aeropulse_logged_out', '1');
        localStorage.removeItem('aeropulse_auth_gate_passed');
        localStorage.removeItem('aeropulse_session_token');
        localStorage.removeItem('aeropulse_strava_access_token');
        localStorage.removeItem('aeropulse_strava_refresh_token');
        localStorage.removeItem('aeropulse_strava_expires_at');
        localStorage.removeItem('thresh_my_teams_v1');
        localStorage.removeItem('thresh_active_team_id_v1');
        sessionStorage.removeItem('thresh_pending_team_join_v1');
        if (clearAllVaultKeys) {
          localStorage.removeItem('aeropulse_calibrated_v1');
          localStorage.removeItem('aeropulse_strava_athlete_id');
          localStorage.removeItem('aeropulse_strava_athlete_name');
          localStorage.removeItem('aeropulse_strava_athlete_weight_kg');
          localStorage.removeItem('aeropulse_strava_athlete_ftp');
          localStorage.removeItem('aeropulse_strava_sync_policy');
          localStorage.removeItem('aeropulse_store_owner_athlete_id');
          localStorage.removeItem('thresh_primary_sport');
          localStorage.removeItem('aeropulse_intervals_api_key');
          localStorage.removeItem('aeropulse_intervals_athlete_id');
          localStorage.removeItem('aeropulse_intervals_athlete_name');
          localStorage.removeItem('aeropulse_strava_client_secret');
          localStorage.removeItem('aeropulse_garmin_personal_api_key');
          localStorage.removeItem('aeropulse_garmin_bearer_token');
          localStorage.removeItem('aeropulse_garmin_oauth1_token');
          localStorage.removeItem('aeropulse_garmin_oauth1_secret');
          localStorage.removeItem('aeropulse_garmin_athlete_name');
        }
      } catch {
        // ignore
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
      setMyTeams([]);
      setActiveTeamId(null);
      setActiveViewedAthleteId('SELF');
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
        stravaConnected: false,
        stravaAthleteId: undefined,
        stravaAthleteName: undefined,
        stravaGrantedScope: undefined,
        stravaSyncPolicy: undefined,
        stravaSource: 'NONE',
        garminConnected: false,
        garminAthleteName: undefined,
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
      if (clearAllVaultKeys) {
        await clearPersistedTelemetrySnapshot();
        setIdbSavedAt(null);
      }
      await fetchServerConfigStatus();
    },
    [
      activitiesRef,
      athleteProfileRef,
      fetchServerConfigStatus,
      gearItemsRef,
      hasEnteredWorkspaceRef,
      plannedEventsRef,
      redactedStravaCountRef,
      resetSampleDemoEphemeralState,
      setActiveTeamId,
      setActiveViewedAthleteId,
      setActivities,
      setAthleteProfile,
      setConnectionStatus,
      setCurrentUser,
      setGearItems,
      setHasEnteredWorkspace,
      setIdbSavedAt,
      setIsSampleDemoMode,
      setIsSessionLoggedOut,
      setMyTeams,
      setPlannedEvents,
      setRedactedStravaCount,
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
        if (payload.sessionToken) {
          localStorage.setItem('aeropulse_session_token', payload.sessionToken);
        }
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
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteName: athleteProfile.name || 'Athlete' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { sessionToken?: string };
        if (data.sessionToken) {
          localStorage.setItem('aeropulse_session_token', data.sessionToken);
        }
      }
      if (!localStorage.getItem('aeropulse_session_token')) {
        localStorage.setItem('aeropulse_session_token', `offline_${Date.now()}`);
      }
    } catch {
      try {
        localStorage.removeItem('aeropulse_logged_out');
        localStorage.setItem('aeropulse_auth_gate_passed', '1');
        if (!localStorage.getItem('aeropulse_session_token')) {
          localStorage.setItem('aeropulse_session_token', `offline_${Date.now()}`);
        }
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
