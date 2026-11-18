import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconContext } from './components/icons/PhosphorIcons';
import type {
  ActiveTab,
  AnnualMileageGoal,
  AthleteGearItem,
  AthletePrivacySettings,
  AthleteProfile,
  BenchmarkSegmentHistory,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  ConnectionStatus,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  StravaSyncWindow,
  TargetGoal,
  TeamSummaryWithRole,
  ThreshUser,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from './types';
import type { PlannedEventBatchItem } from './components/GoalsView';
import {
  INITIAL_ANNUAL_MILEAGE_GOALS,
} from './data/mockTelemetry';
import { buildSampleDemoDataset } from './data/sampleDemoData';
import {
  DEFAULT_SELF_PRIVACY_SETTINGS,
  applyAthletePrivacyShield,
  buildInitialConnectedAthletes,
} from './data/athleteRosterData';
import {
  StravaAuthGate,
  type FirstRunCalibrationPayload,
} from './components/StravaAuthGate';
import { OfflineIndicator } from './components/PWAInstallButton';
import type { RosterTab } from './components/AthleteRosterModal';
import type { SavedStopwatchEntry } from './components/TracksideStopwatchView';
import { applyTeamBrandToDocument } from './utils/teamBrandDom';
import {
  partitionSavedStopwatchEntries,
  persistCoachStopwatchActivitiesToServer,
} from './utils/stopwatchTeamSync';
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  inferPrimarySportFromActivities,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  loadPersistedTelemetrySnapshot,
  mergeActivitiesNonDestructive,
  reRankActivitiesSegments,
  savePersistedTelemetrySnapshot,
  getSavedIntervalsHeaders,
} from './utils/telemetryStorage';

import { CockpitHeader } from './components/CockpitHeader';
import { CockpitStageBanners } from './components/CockpitStageBanners';
import { WorkspaceRouter } from './components/WorkspaceRouter';
import { CockpitFooter } from './components/CockpitFooter';
import { MobileDock } from './components/MobileDock';
import { CockpitModals } from './components/CockpitModals';

import { useTelemetrySync, hasStravaClientCredentials, type CompleteStravaAuthFn } from './hooks/useTelemetrySync';
import { useTelemetryConnectors } from './hooks/useTelemetryConnectors';
import { useRouteStreams } from './hooks/useRouteStreams';
import { usePlannedEvents } from './hooks/usePlannedEvents';
import { useTeamRoster } from './hooks/useTeamRoster';
import { useCoachChat } from './hooks/useCoachChat';
import { useRosterActions } from './hooks/useRosterActions';
import { useBrandStudioRoute } from './utils/brandRoute';
import { useShareWorkoutRoute, sharedWorkoutToPlannedEventInput } from './utils/shareWorkoutEngine';
import { useAthleteCloudSync } from './hooks/useAthleteCloudSync';

const BrandGuidePage = React.lazy(() => import('./components/BrandGuidePage'));
const ShareWorkoutPage = React.lazy(() => import('./components/ShareWorkoutPage'));

const DEV_APP_URL = 'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';
const SHARED_APP_URL = 'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';

export default function App() {
  const { isBrandRoute, openBrand, closeBrand } = useBrandStudioRoute();
  const { isShareRoute, sharedWorkout, closeShareWorkout } = useShareWorkoutRoute();
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    try {
      if (typeof window !== 'undefined') {
        const hash = window.location.hash.replace(/^#/, '');
        if (hash === 'plan-builder') return 'totals';
        if (['fitness', 'calendar', 'activities', 'totals', 'curves', 'trends', 'charts', 'stopwatch', 'coach'].includes(hash)) {
          return hash as ActiveTab;
        }
      }
    } catch {
      // ignore
    }
    return 'fitness';
  });
  const [coachSubTab, setCoachSubTab] = useState<CoachWorkspaceSubTab>('CLIPBOARD');

  useEffect(() => {
    const handleHashChange = () => {
      try {
        const hash = window.location.hash.replace(/^#/, '');
        if (hash === 'plan-builder') {
          setActiveTab('totals');
          return;
        }
        if (['fitness', 'calendar', 'activities', 'totals', 'curves', 'trends', 'charts', 'stopwatch', 'coach'].includes(hash)) {
          setActiveTab(hash as ActiveTab);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('thresh_theme_dark');
      if (saved === '1') return true;
      if (saved === '0') return false;
      return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(() => {
    try {
      const saved = localStorage.getItem('thresh_distance_unit');
      return saved === 'km' || saved === 'mi' ? saved : 'mi';
    } catch {
      return 'mi';
    }
  });
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('COMBINED');
  const [selectedSport, setSelectedSport] = useState<SportCategory | 'ALL'>('ALL');

  // Telemetry state — hydrated from Browser IndexedDB on boot when workspace session is active
  const [wellnessDays, setWellnessDays] = useState<UnifiedWellnessDay[]>([]);
  const [activities, setActivities] = useState<UnifiedActivity[]>([]);
  const [plannedEvents, setPlannedEvents] = useState<PlannedWorkoutEvent[]>([]);
  const [gearItems, setGearItems] = useState<AthleteGearItem[]>([]);
  const [athleteProfile, setAthleteProfile] = useState<AthleteProfile>(() =>
    buildCompleteAthleteProfile(null)
  );
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isOfficialRaceModalOpen, setIsOfficialRaceModalOpen] = useState<boolean>(false);
  const [isRosterModalOpen, setIsRosterModalOpen] = useState<boolean>(false);
  const [rosterInitialTab, setRosterInitialTab] = useState<RosterTab>('TEAMS_BRANDING');
  const [showMetricsGuide, setShowMetricsGuide] = useState<boolean>(false);

  const [hasEnteredWorkspace, setHasEnteredWorkspace] = useState<boolean>(() => {
    try {
      const isGatePassed =
        localStorage.getItem('aeropulse_auth_gate_passed') === '1' &&
        localStorage.getItem('aeropulse_logged_out') !== '1';
      const hasStravaSession = Boolean(
        localStorage.getItem('aeropulse_session_token') ||
          localStorage.getItem('aeropulse_strava_access_token') ||
          localStorage.getItem('aeropulse_strava_refresh_token')
      );
      return isGatePassed && hasStravaSession;
    } catch {
      return false;
    }
  });
  const hasEnteredWorkspaceRef = useRef<boolean>(hasEnteredWorkspace);
  useEffect(() => {
    hasEnteredWorkspaceRef.current = hasEnteredWorkspace;
  }, [hasEnteredWorkspace]);
  const [isSessionLoggedOut, setIsSessionLoggedOut] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aeropulse_logged_out') === '1';
    } catch {
      return false;
    }
  });
  const [activeViewedAthleteId, setActiveViewedAthleteId] = useState<string>('SELF');
  const [selfPrivacySettings, setSelfPrivacySettings] = useState<AthletePrivacySettings>(() => {
    try {
      const saved = localStorage.getItem('aeropulse_self_privacy_settings');
      return saved ? JSON.parse(saved) : DEFAULT_SELF_PRIVACY_SETTINGS;
    } catch {
      return DEFAULT_SELF_PRIVACY_SETTINGS;
    }
  });
  const [connectedAthletes, setConnectedAthletes] = useState<ConnectedAthleteRecord[]>(() => {
    try {
      const saved = localStorage.getItem('aeropulse_connected_athletes_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return buildInitialConnectedAthletes();
  });
  const [isSyncingProfile, setIsSyncingProfile] = useState<boolean>(false);
  const [benchmarkSegments] = useState<BenchmarkSegmentHistory[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<UnifiedActivity | null>(null);
  const [idbSavedAt, setIdbSavedAt] = useState<string | null>(null);

  const idbHydratedRef = useRef<boolean>(false);
  const activitiesRef = useRef<UnifiedActivity[]>([]);
  const wellnessDaysRef = useRef<UnifiedWellnessDay[]>([]);
  const plannedEventsRef = useRef<PlannedWorkoutEvent[]>([]);
  const gearItemsRef = useRef<AthleteGearItem[]>([]);
  const athleteProfileRef = useRef<AthleteProfile>(athleteProfile);
  const redactedStravaCountRef = useRef<number>(0);

  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);
  useEffect(() => {
    wellnessDaysRef.current = wellnessDays;
  }, [wellnessDays]);
  useEffect(() => {
    plannedEventsRef.current = plannedEvents;
  }, [plannedEvents]);
  useEffect(() => {
    gearItemsRef.current = gearItems;
  }, [gearItems]);
  useEffect(() => {
    athleteProfileRef.current = athleteProfile;
  }, [athleteProfile]);

  // Persisted Annual Mileage & Target Race Goals (purge any legacy seed goal-1/2/3 dummy goals)
  const [annualMileageGoals, setAnnualMileageGoals] = useState<AnnualMileageGoal[]>(() => {
    try {
      const saved = localStorage.getItem('aeropulse_annual_mileage_goals');
      return saved ? JSON.parse(saved) : INITIAL_ANNUAL_MILEAGE_GOALS;
    } catch {
      return INITIAL_ANNUAL_MILEAGE_GOALS;
    }
  });

  const [targetGoals, setTargetGoals] = useState<TargetGoal[]>(() => {
    try {
      const saved = localStorage.getItem('aeropulse_target_goals');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (g: TargetGoal) => g.id !== 'goal-1' && g.id !== 'goal-2' && g.id !== 'goal-3'
      );
    } catch {
      return [];
    }
  });

  // Data Sources & Sync Modal State
  const [isDataSourcesOpen, setIsDataSourcesOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [redactedStravaCount, setRedactedStravaCount] = useState<number>(0);
  const [dismissedStravaBanner, setDismissedStravaBanner] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aeropulse_dismiss_strava_banner') === '1';
    } catch {
      return false;
    }
  });
  const [dismissedQuickConnectBanner, setDismissedQuickConnectBanner] = useState<boolean>(false);
  const [isSampleDemoMode, setIsSampleDemoMode] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        const search = window.location.search;
        if (search.includes('demo=1') || search.includes('sample=true')) {
          return true;
        }
        return localStorage.getItem('thresh_sample_demo_active') === 'true';
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
  const [sampleDemoAnnualGoals, setSampleDemoAnnualGoals] = useState<AnnualMileageGoal[]>(
    () => INITIAL_ANNUAL_MILEAGE_GOALS
  );
  const [sampleDemoTargetGoals, setSampleDemoTargetGoals] = useState<TargetGoal[]>(
    () => sampleDemoDataset.targetGoals
  );
  const [sampleDemoPrivacySettings, setSampleDemoPrivacySettings] =
    useState<AthletePrivacySettings>(() => DEFAULT_SELF_PRIVACY_SETTINGS);
  const [sampleDemoConnectedAthletes, setSampleDemoConnectedAthletes] = useState<
    ConnectedAthleteRecord[]
  >(() => buildInitialConnectedAthletes());

  const resetSampleDemoEphemeralState = useCallback(() => {
    const fresh = buildSampleDemoDataset();
    setSampleDemoPlannedEvents(fresh.plannedEvents);
    setSampleDemoProfile(fresh.athleteProfile);
    setSampleDemoActivities(fresh.activities);
    setSampleDemoAnnualGoals(INITIAL_ANNUAL_MILEAGE_GOALS);
    setSampleDemoTargetGoals(fresh.targetGoals);
    setSampleDemoPrivacySettings(DEFAULT_SELF_PRIVACY_SETTINGS);
    setSampleDemoConnectedAthletes(buildInitialConnectedAthletes());
    setSelectedActivity(null);
    setActiveViewedAthleteId('SELF');
    resetDemoCheckInsRef.current?.();
    try {
      window.localStorage.removeItem('thresh_trackside_stopwatch_v1');
      window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
    } catch {
      // ignore storage errors
    }
  }, []);

  // Global Workspace Keyboard Accelerators: Alt+1..4 switches Today / Plan / Activities / Progress
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        setActiveTab('fitness');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveTab('calendar');
      } else if (e.key === '3') {
        e.preventDefault();
        setActiveTab('totals');
      } else if (e.key === '4') {
        e.preventDefault();
        setActiveTab('activities');
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  useEffect(() => {
    redactedStravaCountRef.current = redactedStravaCount;
  }, [redactedStravaCount]);

  const [readOnlyNotice, setReadOnlyNotice] = useState<string | null>(null);

  const triggerReadOnlyAlert = useCallback((athleteName: string, actionLabel: string) => {
    setReadOnlyNotice(
      `Read-Only Friend View: You cannot ${actionLabel} while viewing ${athleteName}'s profile. Switch their role to Coach Edit in Roster to modify.`
    );
  }, []);

  useEffect(() => {
    if (!readOnlyNotice) return;
    const t = window.setTimeout(() => setReadOnlyNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [readOnlyNotice]);

  const lastLabTabRef = useRef<'totals' | 'curves' | 'trends' | 'charts'>('totals');
  useEffect(() => {
    if (
      activeTab === 'totals' ||
      activeTab === 'curves' ||
      activeTab === 'trends' ||
      activeTab === 'charts'
    ) {
      lastLabTabRef.current = activeTab;
    }
  }, [activeTab]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    mode: 'SANDBOX_CALIBRATION',
    intervalsConnected: false,
    intervalsAthleteId: '0',
    intervalsSource: 'NONE',
    stravaConnected: false,
    stravaSource: 'NONE',
    hasGeminiServerKey: true,
    autoSyncCronActive: true,
    devCallbackUrl: `${DEV_APP_URL}/api/strava/callback`,
    sharedCallbackUrl: `${SHARED_APP_URL}/api/strava/callback`,
    currentOriginCallbackUrl:
      typeof window !== 'undefined'
        ? `${window.location.origin}/api/strava/callback`
        : `${DEV_APP_URL}/api/strava/callback`,
  });
  const [currentUser, setCurrentUser] = useState<ThreshUser | null>(null);

  // Automatically persist telemetry state changes (workouts, planned events, calibrated profile) to IndexedDB
  useEffect(() => {
    if (isSampleDemoMode || !idbHydratedRef.current) return;
    if (
      !hasEnteredWorkspace &&
      activities.length === 0 &&
      wellnessDays.length === 0 &&
      plannedEvents.length === 0
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const earliestActivityDate =
        activities.length > 0
          ? activities[activities.length - 1].startDateLocal.slice(0, 10)
          : undefined;
      savePersistedTelemetrySnapshot({
        activities,
        wellnessDays,
        plannedEvents,
        gearItems,
        athleteProfile,
        redactedStravaCount,
        earliestActivityDate,
      }).then((savedTimestamp) => {
        if (savedTimestamp) setIdbSavedAt(savedTimestamp);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    isSampleDemoMode,
    hasEnteredWorkspace,
    activities,
    wellnessDays,
    plannedEvents,
    gearItems,
    athleteProfile,
    redactedStravaCount,
  ]);

  // Sync Dark Mode class with <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('thresh_theme_dark', isDark ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Save goals & privacy/roster preferences to localStorage (never during ephemeral Sample Demo Mode)
  useEffect(() => {
    if (isSampleDemoMode) return;
    try {
      localStorage.setItem('aeropulse_annual_mileage_goals', JSON.stringify(annualMileageGoals));
    } catch {
      // ignore storage quota errors
    }
  }, [annualMileageGoals, isSampleDemoMode]);

  useEffect(() => {
    if (isSampleDemoMode) return;
    try {
      localStorage.setItem('aeropulse_target_goals', JSON.stringify(targetGoals));
    } catch {
      // ignore
    }
  }, [targetGoals, isSampleDemoMode]);

  useEffect(() => {
    if (isSampleDemoMode) return;
    try {
      localStorage.setItem('aeropulse_self_privacy_settings', JSON.stringify(selfPrivacySettings));
    } catch {
      // ignore
    }
  }, [selfPrivacySettings, isSampleDemoMode]);

  useEffect(() => {
    if (isSampleDemoMode) return;
    try {
      localStorage.setItem('aeropulse_connected_athletes_v1', JSON.stringify(connectedAthletes));
    } catch {
      // ignore
    }
  }, [connectedAthletes, isSampleDemoMode]);

  useEffect(() => {
    if (isSampleDemoMode) return;
    try {
      localStorage.setItem('thresh_distance_unit', distanceUnit);
    } catch {
      // ignore
    }
  }, [distanceUnit, isSampleDemoMode]);

  useEffect(() => {
    if (isSampleDemoMode || !hasEnteredWorkspace || isSessionLoggedOut) return;
    fetch('/api/auth/session', { method: 'POST', credentials: 'include' }).catch(() => null);
  }, [isSampleDemoMode, hasEnteredWorkspace, isSessionLoggedOut]);

  const {
    myTeams,
    setMyTeams,
    activeTeamId,
    setActiveTeamId,
    activeTeam,
    resendConfigured,
    pendingUrlJoinOffer,
    handleSelectActiveTeam,
    handleTeamsUpdated,
    handleAcceptJoinOffer,
    handleDismissJoinOffer,
    cloudTeamRosterAthletes,
    myTeamRecordedActivities,
  } = useTeamRoster({
    isSampleDemoMode,
    hasEnteredWorkspace,
    isSessionLoggedOut,
  });

  const completeStravaAuthHandshakeRef = useRef<CompleteStravaAuthFn | null>(null);
  const { reconcileStoreOwnerAthleteId, fetchServerConfigStatus, syncLiveTelemetry } =
    useTelemetrySync({
      activitiesRef,
      setActivities,
      wellnessDaysRef,
      setWellnessDays,
      plannedEventsRef,
      setPlannedEvents,
      gearItemsRef,
      setGearItems,
      redactedStravaCountRef,
      setRedactedStravaCount,
      athleteProfileRef,
      setAthleteProfile,
      setConnectionStatus,
      setCurrentUser,
      setDistanceUnit,
      setIdbSavedAt,
      setIsSyncing,
      setSyncError,
      setMyTeams,
      setActiveTeamId,
      setActiveViewedAthleteId,
      idbHydratedRef,
      hasEnteredWorkspace,
      hasEnteredWorkspaceRef,
      setHasEnteredWorkspace,
      isSessionLoggedOut,
      setIsSessionLoggedOut,
      isSampleDemoMode,
      completeStravaAuthHandshakeRef,
    });

  const {
    completeStravaAuthHandshake,
    handleLaunchIntervalsOAuth,
    handleConnectIntervals,
    handleDisconnectIntervals,
    handleDisconnectGarmin,
    handleLaunchWahooOAuth,
    handleDisconnectWahoo,
    handleLaunchPolarOAuth,
    handleDisconnectPolar,
    handleUpdateStravaSyncPolicy,
    handleClearPersistedArchive,
    handleSaveStravaCredentials,
    handleLaunchStravaOAuth,
    handleExchangeStravaCode,
    handleSaveStravaDirectToken,
    handleSaveMapTileConfig,
    handleSaveGeminiApiKey,
    handleExportConnectionBundle,
    handleImportConnectionBundle,
  } = useTelemetryConnectors({
    setSyncError,
    fetchServerConfigStatus,
    syncLiveTelemetry,
    reconcileStoreOwnerAthleteId,
    athleteProfileRef,
    setAthleteProfile,
    wellnessDaysRef,
    activitiesRef,
    setConnectionStatus,
    setDistanceUnit,
    setIsSessionLoggedOut,
    isSessionLoggedOut,
    hasEnteredWorkspaceRef,
    setHasEnteredWorkspace,
    setIdbSavedAt,
  });

  completeStravaAuthHandshakeRef.current = completeStravaAuthHandshake;

  const {
    isScanningSegments,
    isHydratingRoutes,
    handleScanMoreSegments,
    handleHydrateMoreRoutes,
    handleToggleActivityKudos,
    handleAddActivityComment,
    loadStreamsForActivity,
    handleSelectActivity,
  } = useRouteStreams({
    activitiesRef,
    setActivities,
    setSampleDemoActivities,
    setSelectedActivity,
    connectionStatus,
    isSampleDemoMode,
    reRankActivitiesSegments,
  });

  const combinedRoster = useMemo(
    () =>
      isSampleDemoMode
        ? sampleDemoConnectedAthletes
        : myTeams.length > 0
          ? cloudTeamRosterAthletes
          : connectedAthletes,
    [
      isSampleDemoMode,
      sampleDemoConnectedAthletes,
      myTeams.length,
      cloudTeamRosterAthletes,
      connectedAthletes,
    ]
  );

  // Multi-Athlete Context Resolution & Privacy Shield Enforcement
  const activeConnectedAthlete = useMemo(
    () =>
      activeViewedAthleteId === 'SELF'
        ? null
        : combinedRoster.find((a) => a.id === activeViewedAthleteId) || null,
    [activeViewedAthleteId, combinedRoster]
  );

  const {
    handleCreatePlannedEvent,
    handleBatchCreatePlannedEvents,
    handleUpdatePlannedEvent,
    handleDeletePlannedEvent,
    handleDeletePlanBlock,
  } = usePlannedEvents({
    activeConnectedAthlete,
    activeTeam,
    handleTeamsUpdated,
    isSampleDemoMode,
    triggerReadOnlyAlert,
    setPlannedEvents,
    setSampleDemoPlannedEvents,
    setConnectedAthletes,
    setSampleDemoConnectedAthletes,
  });

  const resetDemoCheckInsRef = useRef<(() => void) | null>(null);
  const {
    handleApproveAthleteRequest,
    handleRemoveOrDeclineAthlete,
    handleToggleAthleteRole,
    handleAddFollowByInviteOrName,
    handlePushCoachWorkout,
  } = useRosterActions({
    isSampleDemoMode,
    activeTeam,
    handleTeamsUpdated,
    setConnectedAthletes,
    setSampleDemoConnectedAthletes,
    setActiveViewedAthleteId,
  });
  const handleSyncProfileFromRemote = useCallback(async () => {
    setIsSyncingProfile(true);
    try {
      const resp = await fetch('/api/intervals/profile/sync', {
        method: 'POST',
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
  }, []);

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
    [activeConnectedAthlete, isSampleDemoMode, triggerReadOnlyAlert]
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
    [activeConnectedAthlete, isSampleDemoMode, triggerReadOnlyAlert]
  );

  // Privacy Shield Enforcement & Ephemeral Sample Demo Resolution
  const shieldedConnectedTelemetry = useMemo(
    () => (activeConnectedAthlete ? applyAthletePrivacyShield(activeConnectedAthlete) : null),
    [activeConnectedAthlete]
  );

  const effectiveWellnessDays = useMemo(() => {
    if (shieldedConnectedTelemetry) return shieldedConnectedTelemetry.wellnessDays;
    if (isSampleDemoMode) return sampleDemoDataset.wellnessDays;
    return wellnessDays;
  }, [shieldedConnectedTelemetry, isSampleDemoMode, sampleDemoDataset.wellnessDays, wellnessDays]);

  const effectiveActivities = useMemo(() => {
    if (shieldedConnectedTelemetry) return shieldedConnectedTelemetry.activities;
    if (isSampleDemoMode) return sampleDemoActivities;
    return myTeamRecordedActivities.length > 0
      ? mergeActivitiesNonDestructive(activities, myTeamRecordedActivities)
      : activities;
  }, [shieldedConnectedTelemetry, isSampleDemoMode, sampleDemoActivities, activities, myTeamRecordedActivities]);

  const effectivePlannedEvents = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.plannedEvents;
    if (isSampleDemoMode) return sampleDemoPlannedEvents;
    if (!activeTeam || !Array.isArray(activeTeam.broadcastWorkouts)) return plannedEvents;
    const isTeamCoach =
      activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ASSISTANT_COACH';
    const teamEvents: PlannedWorkoutEvent[] = activeTeam.broadcastWorkouts
      .filter((bw) => {
        if (isTeamCoach) return true;
        if (activeTeam.myMembershipId && bw.athleteOverrides?.[activeTeam.myMembershipId]) {
          return true;
        }
        if (
          Boolean(activeTeam.myMembershipId) &&
          Array.isArray(bw.targetMembershipIds) &&
          bw.targetMembershipIds.length > 0
        ) {
          return bw.targetMembershipIds.includes(activeTeam.myMembershipId);
        }
        const squadMatch =
          bw.targetSquadGroup === 'ALL' || bw.targetSquadGroup === activeTeam.mySquadGroup;
        if (!squadMatch) return false;
        if (Array.isArray(bw.targetEventGroups) && bw.targetEventGroups.length > 0) {
          return (
            Boolean(activeTeam.myEventGroup) &&
            bw.targetEventGroups.includes(activeTeam.myEventGroup!)
          );
        }
        return true;
      })
      .map((bw) => {
        const ov = activeTeam.myMembershipId
          ? bw.athleteOverrides?.[activeTeam.myMembershipId]
          : undefined;
        return {
          id: bw.broadcastId,
          date: bw.date,
          name: ov?.name || bw.name,
          sportCategory: bw.sportCategory,
          environmentPreference: 'FLEXIBLE',
          description: ov?.description || bw.description,
          plannedLoad: ov?.plannedLoad ?? bw.plannedLoad,
          plannedDurationSecs: ov?.plannedDurationSecs ?? bw.plannedDurationSecs,
          targetZoneSummary: `${activeTeam.brand.shortName} Squad Session`,
          workoutSyntax: ov?.workoutSyntax || bw.workoutSyntax,
          ...(ov?.trackSpec || bw.trackSpec ? { trackSpec: ov?.trackSpec || bw.trackSpec } : {}),
          ...(bw.planBlockId ? { planBlockId: bw.planBlockId } : {}),
          ...(bw.planBlockName ? { planBlockName: bw.planBlockName } : {}),
          ...(typeof bw.planWeekNum === 'number' ? { planWeekNum: bw.planWeekNum } : {}),
          source: 'USER',
        };
      });
    const existingIds = new Set(plannedEvents.map((e) => e.id));
    return [
      ...plannedEvents,
      ...teamEvents.filter((te) => !existingIds.has(te.id)),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [activeConnectedAthlete, isSampleDemoMode, sampleDemoPlannedEvents, plannedEvents, activeTeam]);

  const effectiveAthleteProfile = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.athleteProfile;
    if (isSampleDemoMode) return sampleDemoProfile;
    const inferredSport = !athleteProfile.primarySport ? inferPrimarySportFromActivities(effectiveActivities) : undefined;
    const withSafeSport =
      activeTeam?.brand.defaultSafeSportShield && !athleteProfile.safeSportHideWeight
        ? { ...athleteProfile, safeSportHideWeight: true }
        : athleteProfile;
    return inferredSport ? { ...withSafeSport, primarySport: inferredSport } : withSafeSport;
  }, [
    activeConnectedAthlete,
    isSampleDemoMode,
    sampleDemoProfile,
    athleteProfile,
    activeTeam,
    effectiveActivities,
  ]);

  const effectiveTargetGoals = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.targetGoals;
    if (isSampleDemoMode) return sampleDemoTargetGoals;
    return targetGoals;
  }, [activeConnectedAthlete, isSampleDemoMode, sampleDemoTargetGoals, targetGoals]);

  const effectiveAnnualMileageGoals = isSampleDemoMode
    ? sampleDemoAnnualGoals
    : annualMileageGoals;
  const effectiveGearItems = useMemo(
    () => (isSampleDemoMode ? [] : gearItems),
    [isSampleDemoMode, gearItems]
  );
  const effectiveSelfPrivacySettings = isSampleDemoMode
    ? sampleDemoPrivacySettings
    : selfPrivacySettings;

  const selfLatestWellness = isSampleDemoMode
    ? sampleDemoDataset.wellnessDays[sampleDemoDataset.wellnessDays.length - 1] || undefined
    : wellnessDays[wellnessDays.length - 1] || undefined;
  const latestWellness = effectiveWellnessDays[effectiveWellnessDays.length - 1] || undefined;

  const {
    effectiveSessionCheckIns,
    handleRecordSessionCheckIn,
    resetDemoSessionCheckIns,
  } = useAthleteCloudSync({
    isSampleDemoMode, hasEnteredWorkspace, isSessionLoggedOut, currentUser,
    stravaAthleteId: connectionStatus.stravaAthleteId, plannedEvents, setPlannedEvents,
    targetGoals, setTargetGoals, annualMileageGoals, setAnnualMileageGoals,
    athleteProfile, setAthleteProfile, distanceUnit, setDistanceUnit,
    activities, wellnessDays, selfLatestWellness, selfPrivacySettings,
    garminConnected: Boolean(connectionStatus.garminConnected),
    intervalsConnected: Boolean(connectionStatus.intervalsConnected),
    myTeamsCount: myTeams.length, setMyTeams,
    handleCreatePlannedEvent, onPendingWorkoutImported: () => setActiveTab('calendar'),
  });
  resetDemoCheckInsRef.current = resetDemoSessionCheckIns;
  const latestCtl = latestWellness?.ctl ?? 0;
  const latestWeightKg = effectiveAthleteProfile.weightKg || latestWellness?.weightKg || 70.0;
  const athleteFtp =
    effectiveAthleteProfile.ftp || connectionStatus.athleteFtp || latestWellness?.rideEftp || 250;

  const primaryAthleteDisplayName = useMemo(() => {
    if (isSampleDemoMode) return 'Sample Athlete (Demo)';
    const storedStravaName =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('aeropulse_strava_athlete_name')?.trim()
        : undefined;
    const storedGarminName =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('aeropulse_garmin_athlete_name')?.trim()
        : undefined;
    const storedIntervalsName =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('aeropulse_intervals_athlete_name')?.trim()
        : undefined;
    const candidates = [
      athleteProfile.name,
      connectionStatus.stravaAthleteName,
      storedStravaName,
      connectionStatus.garminAthleteName,
      storedGarminName,
      connectionStatus.intervalsAthleteName,
      storedIntervalsName,
    ];
    for (const candidate of candidates) {
      if (candidate && !isGenericAthleteName(candidate)) {
        return candidate.trim();
      }
    }
    return 'Athlete';
  }, [
    isSampleDemoMode,
    athleteProfile.name,
    connectionStatus.stravaAthleteName,
    connectionStatus.garminAthleteName,
    connectionStatus.intervalsAthleteName,
  ]);

  const primaryAthleteInitials = useMemo(() => {
    const cleaned = primaryAthleteDisplayName.replace(/\([^)]*\)/g, '').trim();
    const parts = cleaned
      .split(/\s+/)
      .map((p) => p.replace(/[^A-Za-z0-9]/g, ''))
      .filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase() || 'AT';
    }
    return 'AT';
  }, [primaryAthleteDisplayName]);

  const selfInviteCode = useMemo(() => {
    const cleanTag = primaryAthleteDisplayName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'THRESH';
    let hash = 0;
    for (let i = 0; i < cleanTag.length; i++) {
      hash = (hash * 31 + cleanTag.charCodeAt(i)) % 9000;
    }
    const codeDigits = String(1000 + Math.abs(hash));
    return `TH-${codeDigits}-${cleanTag}`;
  }, [primaryAthleteDisplayName]);

  const resetClientWorkspaceStateOnLogout = useCallback(async (clearAllVaultKeys: boolean) => {
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
  }, [fetchServerConfigStatus, resetSampleDemoEphemeralState]);

  const handleLogoutSession = useCallback(() => {
    void resetClientWorkspaceStateOnLogout(false);
  }, [resetClientWorkspaceStateOnLogout]);

  const handleLogoutAndClearData = useCallback(async () => {
    await resetClientWorkspaceStateOnLogout(true);
  }, [resetClientWorkspaceStateOnLogout]);


  const {
    isCoachDrawerOpen,
    setIsCoachDrawerOpen,
    chatMessages,
    isSendingChat,
    coachDraftPrompt,
    setCoachDraftPrompt,
    handleSendChatMessage,
    handleCancelSendChat,
    handleOpenCoachWithPrompt,
  } = useCoachChat({
    latestWellness,
    effectiveActivities,
    effectiveAthleteProfile,
    effectiveWellnessDays,
    effectiveAnnualMileageGoals,
    envFilter,
    distanceUnit,
    effectivePlannedEvents,
    effectiveTargetGoals,
  });
  const handleUpdateAnnualMileageGoal = useCallback(
    (sport: 'Running' | 'Cycling', targetMeters: number) => {
      const updater = (prev: AnnualMileageGoal[]) =>
        prev.map((g) =>
          g.sportCategory === sport ? { ...g, targetDistanceMeters: targetMeters } : g
        );
      if (isSampleDemoMode) {
        setSampleDemoAnnualGoals(updater);
        return;
      }
      setAnnualMileageGoals(updater);
    },
    [isSampleDemoMode]
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
    [activeConnectedAthlete, isSampleDemoMode, triggerReadOnlyAlert]
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
    [activeConnectedAthlete, isSampleDemoMode, triggerReadOnlyAlert]
  );

  const handleSelectActivityAndOpenTab = useCallback(
    (act: UnifiedActivity) => {
      void handleSelectActivity(act);
    },
    [handleSelectActivity]
  );

  const handleCalendarCreatePlannedEvent = useCallback(
    async (evt: {
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
    }) => {
      if (activeConnectedAthlete && activeConnectedAthlete.role === 'COACH_EDIT') {
        handlePushCoachWorkout(activeConnectedAthlete.id, {
          date: evt.date,
          name: evt.name,
          sportCategory: evt.sportCategory === 'Cycling' ? 'Cycling' : 'Running',
          plannedDurationSecs: evt.plannedDurationSecs,
          plannedLoad: evt.plannedLoad,
          workoutSyntax: evt.workoutSyntax || '',
          description: evt.description,
        });
      } else {
        await handleCreatePlannedEvent(evt);
      }
    },
    [activeConnectedAthlete, handlePushCoachWorkout, handleCreatePlannedEvent]
  );

  const handleOpenTodayTab = useCallback(() => setActiveTab('fitness'), []);
  const handleOpenGoalsTab = useCallback(() => setActiveTab('totals'), []);
  const handleSwitchToCalendarTab = useCallback(() => setActiveTab('calendar'), []);
  const handleOpenActivitiesTab = useCallback(() => setActiveTab('activities'), []);
  const handleOpenProfileModal = useCallback(() => setIsProfileModalOpen(true), []);
  const handleOpenOfficialRaceModal = useCallback(() => setIsOfficialRaceModalOpen(true), []);
  const handleOpenRosterModal = useCallback(() => setIsRosterModalOpen(true), []);

  const handleImportSingleParsedActivity = useCallback(
    (newAct: UnifiedActivity) => {
      if (isSampleDemoMode) {
        setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, [newAct]));
        return;
      }
      setActivities((prev) => mergeActivitiesNonDestructive(prev, [newAct]));
    },
    [isSampleDemoMode]
  );

  const handleImportMultipleParsedActivities = useCallback(
    (newActs: UnifiedActivity[]) => {
      if (isSampleDemoMode) {
        setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
        return;
      }
      setActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
    },
    [isSampleDemoMode]
  );

  const handleSaveStopwatchActivities = useCallback(
    (entries: SavedStopwatchEntry[]): number => {
      if (!entries || entries.length === 0) return 0;
      const { selfActs, rosterByRunnerId, teamApiEntries, savedCount } =
        partitionSavedStopwatchEntries(entries, combinedRoster);

      if (selfActs.length > 0) {
        if (isSampleDemoMode) {
          setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, selfActs));
        } else {
          setActivities((prev) => {
            const merged = mergeActivitiesNonDestructive(prev, selfActs);
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
        }
      }

      if (rosterByRunnerId.size > 0) {
        const mergeRosterActs = (prev: ConnectedAthleteRecord[]) =>
          prev.map((a) => {
            const added = rosterByRunnerId.get(a.id);
            return added && added.length > 0
              ? { ...a, activities: mergeActivitiesNonDestructive(a.activities, added) }
              : a;
          });
        if (isSampleDemoMode) {
          setSampleDemoConnectedAthletes(mergeRosterActs);
        } else {
          setConnectedAthletes(mergeRosterActs);
          if (activeTeamId && teamApiEntries.length > 0) {
            void persistCoachStopwatchActivitiesToServer(activeTeamId, teamApiEntries).then((updatedTeam) => {
              if (updatedTeam) {
                setMyTeams((prev) =>
                  prev.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t))
                );
              }
            });
          }
        }
      }

      return savedCount;
    },
    [combinedRoster, isSampleDemoMode, activeTeamId, setMyTeams]
  );

  const handleCompleteCalibrationEntry = async (payload: FirstRunCalibrationPayload) => {
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
      setActiveTab('fitness');
      setRosterInitialTab('TEAMS_BRANDING');
      setIsRosterModalOpen(true);
    } else {
      setActiveTab('fitness');
    }
  };

  if (isBrandRoute) {
    const hasWorkspace = isSampleDemoMode || (!isSessionLoggedOut && hasEnteredWorkspace && (hasStravaClientCredentials() || Boolean(currentUser)));
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-mono text-white">Loading THRESH Brand Studio…</div>}>
          <BrandGuidePage isDark={isDark} onToggleDark={() => setIsDark((d) => !d)} hasActiveWorkspace={hasWorkspace} onExitBrand={() => closeBrand(hasWorkspace ? activeTab : undefined)} />
        </React.Suspense>
      </IconContext.Provider>
    );
  }

  if (isShareRoute) {
    const hasWorkspace = isSampleDemoMode || (!isSessionLoggedOut && hasEnteredWorkspace && (hasStravaClientCredentials() || Boolean(currentUser)));
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-mono">Loading THRESH Share…</div>}>
          <ShareWorkoutPage
            sharedWorkout={sharedWorkout} isDark={isDark} onToggleDark={() => setIsDark((d) => !d)} hasActiveWorkspace={hasWorkspace}
            initialFtpWatts={athleteProfile.ftp} initialThresholdPaceSecsPerKm={athleteProfile.thresholdPaceSecsPerKm} initialUnit={distanceUnit}
            onImportToWorkspace={async (p, f, pace, u) => { await handleCreatePlannedEvent(sharedWorkoutToPlannedEventInput(p, { ftpWatts: f, thresholdPaceSecsPerKm: pace, unit: u })); closeShareWorkout(); setActiveTab('calendar'); }}
            onExitToSignIn={closeShareWorkout} onExitToWorkspace={closeShareWorkout}
          />
        </React.Suspense>
      </IconContext.Provider>
    );
  }

  if (
    !isSampleDemoMode &&
    (isSessionLoggedOut || !hasEnteredWorkspace || (!hasStravaClientCredentials() && !currentUser))
  ) {
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <StravaAuthGate
          status={connectionStatus}
          currentUser={currentUser}
          onAuthenticatedUser={(user) => {
            setCurrentUser(user);
            if (user.name && isGenericAthleteName(athleteProfile.name)) {
              setAthleteProfile((prev) => ({ ...prev, name: user.name }));
            }
          }}
          onLaunchStravaOAuth={async (mode = 'cloud', joinContext, forcePrompt) => {
            await handleLaunchStravaOAuth(mode, joinContext, forcePrompt);
          }}
          onSaveStravaCredentials={handleSaveStravaCredentials}
          onSaveStravaDirectToken={handleSaveStravaDirectToken}
          onExchangeStravaCode={async (codeOrUrl) => {
            await handleExchangeStravaCode(codeOrUrl);
          }}
          onConnectIntervals={handleConnectIntervals}
          onLaunchIntervalsOAuth={handleLaunchIntervalsOAuth}
          onLaunchWahooOAuth={handleLaunchWahooOAuth}
          onLaunchPolarOAuth={handleLaunchPolarOAuth}
          onSyncNow={syncLiveTelemetry}
          onCompleteCalibrationEntry={handleCompleteCalibrationEntry}
          onDisconnectCredentials={handleLogoutAndClearData}
          isSyncing={isSyncing}
          errorMessage={syncError}
          isDark={isDark}
          onToggleDark={() => setIsDark((d) => !d)}
          onEnterSampleDemo={() => {
            resetSampleDemoEphemeralState();
            setIsSampleDemoMode(true);
            setActiveTab('fitness');
          }}
          onImportBatchActivities={handleImportMultipleParsedActivities}
          existingActivities={activities}
          distanceUnit={distanceUnit}
          onOpenBrandStudio={openBrand}
          onBypassToLocalSession={async () => {
            try {
              localStorage.removeItem('aeropulse_logged_out');
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
              } else if (!localStorage.getItem('aeropulse_session_token')) {
                localStorage.setItem('aeropulse_session_token', `offline_${Date.now()}`);
              }
            } catch {
              if (!localStorage.getItem('aeropulse_session_token')) {
                localStorage.setItem('aeropulse_session_token', `offline_${Date.now()}`);
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
          }}
        />
      </IconContext.Provider>
    );
  }

  const anySourceConnected = Boolean(
    connectionStatus.stravaConnected ||
      connectionStatus.garminConnected ||
      connectionStatus.intervalsConnected
  );

  return (
    <IconContext.Provider value={{ weight: 'duotone' }}>
      <div className="ap-shell text-slate-900 dark:text-slate-100">
        <a href="#main-content" className="ap-skip-link">
          Skip to main content
        </a>
        <OfflineIndicator />

        {/* Simplified Global Header Bar (Responsive Mobile & Desktop) */}
        <CockpitHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          coachSubTab={coachSubTab}
          onSelectCoachSubTab={setCoachSubTab}
          activeTeam={activeTeam}
          myTeams={myTeams}
          activeTeamId={activeTeamId}
          onSelectActiveTeam={handleSelectActiveTeam}
          onOpenRosterModalWithTab={(tab) => {
            setRosterInitialTab(tab);
            setIsRosterModalOpen(true);
          }}
          syncLiveTelemetry={syncLiveTelemetry}
          isSyncing={isSyncing}
          latestWellness={latestWellness}
          envFilter={envFilter}
          setEnvFilter={setEnvFilter}
          selectedSport={selectedSport}
          setSelectedSport={setSelectedSport}
          lastProgressTab={lastLabTabRef.current}
          activeViewedAthleteId={activeViewedAthleteId}
          setActiveViewedAthleteId={(id) => {
            setActiveViewedAthleteId(id);
            setSelectedActivity(null);
          }}
          setSelectedActivity={setSelectedActivity}
          primaryAthleteDisplayName={primaryAthleteDisplayName}
          primaryAthleteInitials={primaryAthleteInitials}
          combinedRoster={combinedRoster}
          anySourceConnected={anySourceConnected}
          onOpenDataSources={() => setIsDataSourcesOpen(true)}
          onOpenCoach={() => setIsCoachDrawerOpen(true)}
          isDark={isDark}
          onToggleDark={() => setIsDark((prev) => !prev)}
          currentUser={currentUser}
          effectiveActivities={effectiveActivities}
          effectiveAthleteProfile={effectiveAthleteProfile}
          onOpenProfileModal={() => setIsProfileModalOpen(true)}
          onOpenGuide={() => setShowMetricsGuide(true)}
          distanceUnit={distanceUnit}
          setDistanceUnit={setDistanceUnit}
          onLogoutSession={handleLogoutSession}
          onLogoutAndClearData={handleLogoutAndClearData}
        />

        {/* Global Content Container & Stage Banners */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 ap-container py-3 sm:py-4 min-w-0 flex flex-col gap-4">
            <CockpitStageBanners
              pendingUrlJoinOffer={pendingUrlJoinOffer}
              onAcceptJoinOffer={handleAcceptJoinOffer}
              onDismissJoinOffer={handleDismissJoinOffer}
              isSyncing={isSyncing}
              activitiesCount={effectiveActivities.length}
              onOpenDataSources={() => setIsDataSourcesOpen(true)}
              activeConnectedAthlete={activeConnectedAthlete}
              shieldedConnectedTelemetry={shieldedConnectedTelemetry}
              onOpenRosterModal={() => setIsRosterModalOpen(true)}
              onReturnToMyProfile={() => {
                setActiveViewedAthleteId('SELF');
                setSelectedActivity(null);
              }}
              readOnlyNotice={readOnlyNotice}
              onDismissReadOnlyNotice={() => setReadOnlyNotice(null)}
              redactedStravaCount={redactedStravaCount}
              connectionStatus={connectionStatus}
              dismissedStravaBanner={dismissedStravaBanner}
              onLaunchStravaOAuth={(mode) => handleLaunchStravaOAuth(mode as any)}
              onDismissStravaBanner={() => {
                setDismissedStravaBanner(true);
                try {
                  localStorage.setItem('aeropulse_dismiss_strava_banner', '1');
                } catch {
                  // ignore
                }
              }}
              isSampleDemoMode={isSampleDemoMode}
              onExitSampleDemo={(connectStrava) => {
                setIsSampleDemoMode(false);
                resetSampleDemoEphemeralState();
                if (connectStrava) {
                  void handleLaunchStravaOAuth('cloud');
                }
              }}
              dismissedQuickConnectBanner={dismissedQuickConnectBanner}
              onDismissQuickConnectBanner={() => setDismissedQuickConnectBanner(true)}
              myTeamsCount={isSampleDemoMode ? 0 : myTeams.length}
              isCoachMode={activeTab === 'coach'}
              athleteProfile={effectiveAthleteProfile}
              distanceUnit={distanceUnit}
              onOpenProfileModal={handleOpenProfileModal}
              onOpenPlanBuilder={handleOpenGoalsTab}
              onExploreFitness={handleOpenTodayTab}
            />

            <main id="main-content" className="flex-1 min-w-0" tabIndex={-1}>
              <WorkspaceRouter
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                stravaSyncWindow={connectionStatus.stravaSyncPolicy?.window}
                onOpenDataSources={() => setIsDataSourcesOpen(true)}
                coachSubTab={coachSubTab}
                setCoachSubTab={setCoachSubTab}
                activeTeam={isSampleDemoMode ? null : activeTeam}
                activeViewedAthleteId={activeViewedAthleteId}
                onSelectAthleteViewport={(id) => {
                  setActiveViewedAthleteId(id);
                  setSelectedActivity(null);
                }}
                resendConfigured={resendConfigured}
                onSelectActiveTeam={handleSelectActiveTeam}
                onTeamsUpdated={handleTeamsUpdated}
                effectiveActivities={effectiveActivities}
                effectiveWellnessDays={effectiveWellnessDays}
                effectivePlannedEvents={effectivePlannedEvents}
                effectiveTargetGoals={effectiveTargetGoals}
                effectiveAnnualMileageGoals={effectiveAnnualMileageGoals}
                effectiveGearItems={effectiveGearItems}
                effectiveSessionCheckIns={effectiveSessionCheckIns}
                onRecordSessionCheckIn={handleRecordSessionCheckIn}
                envFilter={envFilter}
                setEnvFilter={setEnvFilter}
                selectedSport={selectedSport}
                setSelectedSport={setSelectedSport}
                distanceUnit={distanceUnit}
                athleteFtp={athleteFtp}
                latestWeightKg={latestWeightKg}
                latestCtl={latestCtl}
                effectiveAthleteProfile={effectiveAthleteProfile}
                primaryAthleteDisplayName={primaryAthleteDisplayName}
                combinedRoster={combinedRoster}
                myTeams={isSampleDemoMode ? [] : myTeams}
                activeTeamId={isSampleDemoMode ? null : activeTeamId}
                selectedActivity={selectedActivity}
                benchmarkSegments={benchmarkSegments}
                isScanningSegments={isScanningSegments}
                isHydratingRoutes={isHydratingRoutes}
                handleSelectActivityAndOpenTab={handleSelectActivityAndOpenTab}
                handleCalendarCreatePlannedEvent={handleCalendarCreatePlannedEvent}
                handleUpdatePlannedEvent={handleUpdatePlannedEvent}
                handleDeletePlannedEvent={handleDeletePlannedEvent}
                handleDeletePlanBlock={handleDeletePlanBlock}
                handleBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
                handleOpenTodayTab={handleOpenTodayTab}
                handleOpenProfileModal={handleOpenProfileModal}
                handleOpenGoalsTab={handleOpenGoalsTab}
                handleOpenOfficialRaceModal={handleOpenOfficialRaceModal}
                handleOpenCoachWithPrompt={handleOpenCoachWithPrompt}
                handleOpenRosterModal={handleOpenRosterModal}
                handleCreatePlannedEvent={handleCreatePlannedEvent}
                handleSelectActivity={handleSelectActivity}
                loadStreamsForActivity={loadStreamsForActivity}
                handleScanMoreSegments={handleScanMoreSegments}
                handleHydrateMoreRoutes={handleHydrateMoreRoutes}
                handleToggleActivityKudos={handleToggleActivityKudos}
                handleAddActivityComment={handleAddActivityComment}
                handleImportSingleParsedActivity={handleImportSingleParsedActivity}
                handleImportMultipleParsedActivities={handleImportMultipleParsedActivities}
                handleOpenActivitiesTab={handleOpenActivitiesTab}
                handleUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
                handleAddTargetGoal={handleAddTargetGoal}
                handleDeleteTargetGoal={handleDeleteTargetGoal}
                handleSaveProfileOverride={handleSaveProfileOverride}
                handleSwitchToCalendarTab={handleSwitchToCalendarTab}
                handleSaveStopwatchActivities={handleSaveStopwatchActivities}
              />
            </main>

            <CockpitFooter
              athleteFtp={effectiveAthleteProfile.ftp}
              onOpenProfile={() => setIsProfileModalOpen(true)}
              onOpenDataSources={() => setIsDataSourcesOpen(true)}
              onOpenGuide={() => setShowMetricsGuide(true)}
              onOpenBrandStudio={openBrand}
            />
          </div>
        </div>

        <MobileDock
          activeTab={activeTab}
          lastProgressTab={lastLabTabRef.current}
          coachSubTab={coachSubTab}
          onSelectCoachSubTab={setCoachSubTab}
          onSelectTab={(tab) => {
            setActiveTab(
              tab === 'totals'
                ? activeTab === 'totals'
                  ? 'totals'
                  : lastLabTabRef.current
                : tab
            );
          }}
        />

        <CockpitModals
          isCoachDrawerOpen={isCoachDrawerOpen}
          onCloseCoachDrawer={() => setIsCoachDrawerOpen(false)}
          activeViewName={activeTab}
          latestWellness={latestWellness}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChatMessage}
          isSendingChat={isSendingChat}
          onCancelSendChat={handleCancelSendChat}
          coachDraftPrompt={coachDraftPrompt}
          onClearDraftPrompt={() => setCoachDraftPrompt('')}
          hasGeminiKey={Boolean(connectionStatus.hasGeminiServerKey)}
          onSaveGeminiApiKey={handleSaveGeminiApiKey}
          onScheduleProposedWorkout={async (workout) => {
            await handleCreatePlannedEvent({
              date: workout.date || new Date().toISOString().slice(0, 10),
              name: workout.name || 'Structured Workout',
              sportCategory: workout.sportCategory || 'Running',
              environmentPreference: workout.environmentPreference || 'FLEXIBLE',
              plannedDurationSecs: workout.plannedDurationSecs || 3600,
              plannedLoad: workout.plannedLoad || 65,
              workoutSyntax: workout.workoutSyntax || '',
              description: workout.description || '',
            });
          }}
          isProfileModalOpen={isProfileModalOpen}
          onCloseProfileModal={() => setIsProfileModalOpen(false)}
          effectiveAthleteProfile={effectiveAthleteProfile}
          distanceUnit={distanceUnit}
          intervalsConnected={connectionStatus.intervalsConnected}
          isSyncingProfile={isSyncingProfile}
          onSyncProfileFromRemote={handleSyncProfileFromRemote}
          onSaveProfileOverride={handleSaveProfileOverride}
          isDataSourcesOpen={isDataSourcesOpen}
          onCloseDataSources={() => setIsDataSourcesOpen(false)}
          connectionStatus={connectionStatus}
          onConnectIntervals={handleConnectIntervals}
          onLaunchIntervalsOAuth={handleLaunchIntervalsOAuth}
          onDisconnectIntervals={handleDisconnectIntervals}
          onLaunchWahooOAuth={handleLaunchWahooOAuth}
          onDisconnectWahoo={handleDisconnectWahoo}
          onLaunchPolarOAuth={handleLaunchPolarOAuth}
          onDisconnectPolar={handleDisconnectPolar}
          onDisconnectGarmin={handleDisconnectGarmin}
          onDisconnectStrava={handleLogoutSession}
          onUpdateStravaSyncPolicy={handleUpdateStravaSyncPolicy}
          onSaveStravaCredentials={handleSaveStravaCredentials}
          onLaunchStravaOAuth={handleLaunchStravaOAuth}
          onExchangeStravaCode={handleExchangeStravaCode}
          onSaveStravaDirectToken={handleSaveStravaDirectToken}
          onSaveMapTileConfig={handleSaveMapTileConfig}
          onExportBundle={handleExportConnectionBundle}
          onImportBundle={handleImportConnectionBundle}
          onSyncNow={syncLiveTelemetry}
          isSyncing={isSyncing}
          syncError={syncError}
          idbSavedAt={idbSavedAt}
          persistedWorkoutCount={activities.length}
          onRebuildPersistedArchive={handleClearPersistedArchive}
          effectiveActivities={effectiveActivities}
          onImportBatchActivities={(newActs) => {
            if (isSampleDemoMode) {
              setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
              return;
            }
            setActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
          }}
          isOfficialRaceModalOpen={isOfficialRaceModalOpen}
          onCloseOfficialRaceModal={() => setIsOfficialRaceModalOpen(false)}
          onImportOfficialRaces={handleImportOfficialRaces}
          isRosterModalOpen={isRosterModalOpen}
          onCloseRosterModal={() => setIsRosterModalOpen(false)}
          primaryAthleteDisplayName={primaryAthleteDisplayName}
          selfInviteCode={selfInviteCode}
          selfLatestWellness={selfLatestWellness}
          effectiveSelfPrivacySettings={effectiveSelfPrivacySettings}
          onUpdateSelfPrivacy={
            isSampleDemoMode ? setSampleDemoPrivacySettings : setSelfPrivacySettings
          }
          combinedRoster={combinedRoster}
          activeViewedAthleteId={activeViewedAthleteId}
          onSelectAthleteViewport={(id) => {
            setActiveViewedAthleteId(id);
            setSelectedActivity(null);
          }}
          onApproveAthleteRequest={handleApproveAthleteRequest}
          onRemoveOrDeclineAthlete={handleRemoveOrDeclineAthlete}
          onToggleAthleteRole={handleToggleAthleteRole}
          onAddFollowByInviteOrName={handleAddFollowByInviteOrName}
          onPushCoachWorkout={handlePushCoachWorkout}
          myTeams={isSampleDemoMode ? [] : myTeams}
          activeTeamId={isSampleDemoMode ? null : activeTeamId}
          resendConfigured={resendConfigured}
          rosterInitialTab={rosterInitialTab}
          onSelectActiveTeam={handleSelectActiveTeam}
          onTeamsUpdated={handleTeamsUpdated}
          onOpenFullScreenStopwatch={() => {
            setIsRosterModalOpen(false);
            setActiveTab('stopwatch');
          }}
          showMetricsGuide={showMetricsGuide}
          onCloseMetricsGuide={() => setShowMetricsGuide(false)}
          onNavigateTab={(tab) => setActiveTab(tab)}
          onOpenDataSourcesFromGuide={() => setIsDataSourcesOpen(true)}
          onOpenRosterModalFromGuide={() => setIsRosterModalOpen(true)}
          onOpenProfileModalFromGuide={() => setIsProfileModalOpen(true)}
          onOpenOfficialRaceModalFromGuide={() => setIsOfficialRaceModalOpen(true)}
          onOpenAICoachFromGuide={(prompt) => {
            if (prompt) {
              handleOpenCoachWithPrompt(prompt);
            } else {
              setIsCoachDrawerOpen(true);
            }
          }}
        />
      </div>
    </IconContext.Provider>
  );
}
