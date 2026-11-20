import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconContext } from './components/icons/PhosphorIcons';
import { useSundownTheme } from './utils/sundownThemeEngine';
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
  PracticeVenueCategory,
  SportCategory,
  StravaSyncWindow,
  TargetGoal,
  TeamSummaryWithRole,
  ThreshUser,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
  WorkoutSessionSlot,
} from './types';
import { sortPlannedEventsChronologically } from './utils/workoutScheduleUtils';
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
import { OfflineIndicator } from './components/PWAInstallButton';
import type { RosterTab } from './components/AthleteRosterModal';
import type { UserGuideChapterId } from './components/UserGuideModal';
import type { SavedStopwatchEntry } from './components/TracksideStopwatchView';
import {
  enqueueStopwatchOutboxBatch,
  flushStopwatchOutbox,
  overlayPendingStopwatchOutboxOnTeams,
  partitionSavedStopwatchEntries,
  persistWalkOnStopwatchEntriesLocal,
  type StopwatchOutboxFlushResult,
  type StopwatchSaveResult,
} from './utils/stopwatchTeamSync';
import {
  buildCompleteAthleteProfile,
  inferPrimarySportFromActivities,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  loadPersistedTelemetrySnapshot,
  mergeActivitiesNonDestructive,
  reRankActivitiesSegments,
  recomputeWellnessDaysWithActivityImport,
  savePersistedTelemetrySnapshot,
  getSavedIntervalsHeaders,
} from './utils/telemetryStorage';

import { CockpitHeader } from './components/CockpitHeader';
import { CockpitStageBanners } from './components/CockpitStageBanners';
import { WorkspaceRouter } from './components/WorkspaceRouter';
import { CockpitFooter } from './components/CockpitFooter';
import { MobileDock } from './components/MobileDock';
import { CockpitModals } from './components/CockpitModals';
import { SessionAuthProvider } from './contexts/SessionAuthContext';
import { TelemetryWorkspaceProvider } from './contexts/TelemetryWorkspaceContext';
import { TeamCoachProvider } from './contexts/TeamCoachContext';

import { useTelemetrySync, hasStravaClientCredentials, type CompleteStravaAuthFn } from './hooks/useTelemetrySync';
import { useTelemetryConnectors } from './hooks/useTelemetryConnectors';
import { useRouteStreams } from './hooks/useRouteStreams';
import { usePlannedEvents } from './hooks/usePlannedEvents';
import {
  useTeamRoster,
  buildConnectedRosterFromTeam,
  resolveEffectiveActiveTeam,
  buildMergedTeamBroadcastEvents,
} from './hooks/useTeamRoster';
import { resolveAthleteAgeTier } from './physiology/ageAndComplianceEngine';
import { useCoachChat } from './hooks/useCoachChat';
import { useRosterActions } from './hooks/useRosterActions';
import { useBrandStudioRoute } from './utils/brandRoute';
import { usePublicTeamHubRoute } from './utils/publicTeamHubRoute';
import { useShareWorkoutRoute, sharedWorkoutToPlannedEventInput } from './utils/shareWorkoutEngine';
import { useAthleteCloudSync } from './hooks/useAthleteCloudSync';
import { useWorkspaceOnboarding } from './hooks/useWorkspaceOnboarding';
import { WorkspaceErrorBoundary } from './components/WorkspaceErrorBoundary';
import { getLocalDateIso } from './physiology/stravaLoadCalibration';
import {
  consumeRestoredTabAfterChunkReload,
  lazyWithRetry,
  sanitizePersistedAnnualGoals,
  sanitizePersistedTargetGoals,
} from './utils/lazyWithRetry';
import { STORAGE_KEYS } from './utils/storageKeys';

const StravaAuthGate = lazyWithRetry(
  () => import('./components/StravaAuthGate').then((m) => ({ default: m.StravaAuthGate })),
  { chunkKey: 'StravaAuthGate' }
);

const DEMO_STOPWATCH_BACKUP_KEY = 'thresh_trackside_stopwatch_backup_v1';

function backupRealStopwatchForDemo(): void {
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

function restoreRealStopwatchAfterDemo(): void {
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

function parseWorkspaceHash(rawHash: string): {
  tab?: ActiveTab;
  coachSubTab?: CoachWorkspaceSubTab;
} {
  const hash = rawHash.replace(/^#/, '').trim();
  if (!hash) return {};
  if (hash === 'today' || hash === 'fitness') return { tab: 'fitness' };
  if (hash === 'progress' || hash === 'curves') return { tab: 'curves' };
  if (hash === 'trends') return { tab: 'trends' };
  if (hash === 'charts') return { tab: 'charts' };
  if (hash === 'plan-builder') return { tab: 'totals' };
  if (hash === 'totals') return { tab: 'totals' };
  if (hash === 'coach-sync' || hash === 'coach') return { tab: 'coach' };
  if (hash.startsWith('coach/')) {
    const sub = hash.slice('coach/'.length).toUpperCase();
    if (sub === 'PLAN' || sub === 'TEAM_PLAN') {
      return { tab: 'coach', coachSubTab: 'TEAM_PLAN' };
    }
    if (sub === 'ROSTER' || sub === 'CLIPBOARD' || sub === 'STOPWATCH') {
      return { tab: 'coach', coachSubTab: sub as CoachWorkspaceSubTab };
    }
    return { tab: 'coach' };
  }
  if (['calendar', 'activities', 'stopwatch'].includes(hash)) {
    return { tab: hash as ActiveTab };
  }
  return {};
}

function buildWorkspaceHash(tab: ActiveTab, coachSubTab: CoachWorkspaceSubTab): string {
  if (tab === 'fitness') return '#today';
  if (tab === 'totals') return '#plan-builder';
  if (tab === 'coach') {
    const sub = coachSubTab === 'TEAM_PLAN' ? 'plan' : coachSubTab.toLowerCase();
    return `#coach/${sub}`;
  }
  return `#${tab}`;
}

const BrandGuidePage = lazyWithRetry(() => import('./components/BrandGuidePage'), {
  chunkKey: 'BrandGuidePage',
});
const ShareWorkoutPage = lazyWithRetry(() => import('./components/ShareWorkoutPage'), {
  chunkKey: 'ShareWorkoutPage',
});
const PublicTeamHubPage = lazyWithRetry(() => import('./components/PublicTeamHubPage'), {
  chunkKey: 'PublicTeamHubPage',
});

const DEV_APP_URL = 'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';
const SHARED_APP_URL = 'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';

export default function App() {
  const { isBrandRoute, openBrand, closeBrand } = useBrandStudioRoute();
  const { isShareRoute, sharedWorkout, closeShareWorkout } = useShareWorkoutRoute();
  const { publicTeamSlug, openPublicTeamHub, closePublicTeamHub } = usePublicTeamHubRoute();
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const restoredTab = consumeRestoredTabAfterChunkReload();
    if (restoredTab) return restoredTab;
    try {
      if (typeof window !== 'undefined') {
        const parsed = parseWorkspaceHash(window.location.hash);
        if (parsed.tab) return parsed.tab;
      }
    } catch {
      // ignore
    }
    return 'fitness';
  });
  const [coachSubTab, setCoachSubTab] = useState<CoachWorkspaceSubTab>(() => {
    try {
      if (typeof window !== 'undefined') {
        const parsed = parseWorkspaceHash(window.location.hash);
        if (parsed.coachSubTab) return parsed.coachSubTab;
      }
    } catch {
      // ignore
    }
    return 'CLIPBOARD';
  });

  useEffect(() => {
    const handleHashChange = () => {
      try {
        const hash = window.location.hash.replace(/^#/, '');
        if (hash === 'plan-builder') {
          setActiveTab('totals');
          return;
        }
        const parsed = parseWorkspaceHash(hash);
        if (parsed.coachSubTab) {
          setCoachSubTab(parsed.coachSubTab);
        }
        if (parsed.tab) {
          setActiveTab(parsed.tab);
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const {
    isDark,
    activeVariant: activeThemeVariant,
    daytimePalette,
    setDaytimePalette,
    sundownPolicy,
    setSundownPolicy,
    sunsetLabel12h,
    toggleQuickLightDark,
  } = useSundownTheme();
  const [plainLanguageMode, setPlainLanguageMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.PLAIN_LANGUAGE) === '1';
    } catch {
      return false;
    }
  });
  const handleTogglePlainLanguage = useCallback(() => {
    setPlainLanguageMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.PLAIN_LANGUAGE, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
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
  const [rosterInitialTab, setRosterInitialTab] = useState<RosterTab>('CONNECT_INVITE');
  const [showMetricsGuide, setShowMetricsGuide] = useState<boolean>(false);
  const [guideInitialChapter, setGuideInitialChapter] =
    useState<UserGuideChapterId>('ch1-quickstart');
  const [inspectedFromCoach, setInspectedFromCoach] = useState<boolean>(false);

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
      return saved
        ? sanitizePersistedAnnualGoals(JSON.parse(saved), INITIAL_ANNUAL_MILEAGE_GOALS)
        : INITIAL_ANNUAL_MILEAGE_GOALS;
    } catch {
      return INITIAL_ANNUAL_MILEAGE_GOALS;
    }
  });

  const [targetGoals, setTargetGoals] = useState<TargetGoal[]>(() => {
    try {
      const saved = localStorage.getItem('aeropulse_target_goals');
      if (!saved) return [];
      return sanitizePersistedTargetGoals(JSON.parse(saved));
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

  const resetSampleDemoEphemeralState = useCallback(
    (options?: { clearDemoStopwatch?: boolean }) => {
      const fresh = buildSampleDemoDataset();
      setSampleDemoPlannedEvents(fresh.plannedEvents);
      setSampleDemoProfile(fresh.athleteProfile);
      setSampleDemoActivities(fresh.activities);
      setSampleDemoWellnessDays(fresh.wellnessDays);
      setSampleDemoAnnualGoals(INITIAL_ANNUAL_MILEAGE_GOALS);
      setSampleDemoTargetGoals(fresh.targetGoals);
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
    []
  );

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
      })
        .then((savedTimestamp) => {
          if (savedTimestamp) setIdbSavedAt(savedTimestamp);
        })
        .catch(() => undefined);
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

  // Save goals & privacy/roster preferences to localStorage (never during Sample Demo or logged-out transitions)
  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    try {
      localStorage.setItem('aeropulse_annual_mileage_goals', JSON.stringify(annualMileageGoals));
    } catch {
      // ignore storage quota errors
    }
  }, [annualMileageGoals, isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace]);

  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    try {
      localStorage.setItem('aeropulse_target_goals', JSON.stringify(targetGoals));
    } catch {
      // ignore
    }
  }, [targetGoals, isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace]);

  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    try {
      localStorage.setItem('aeropulse_self_privacy_settings', JSON.stringify(selfPrivacySettings));
    } catch {
      // ignore
    }
  }, [selfPrivacySettings, isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace]);

  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    try {
      localStorage.setItem('aeropulse_connected_athletes_v1', JSON.stringify(connectedAthletes));
    } catch {
      // ignore
    }
  }, [connectedAthletes, isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace]);

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
    explicitPersonalMode,
    setExplicitPersonalMode,
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

  const effectiveTeams = isSampleDemoMode ? sampleDemoTeams : myTeams;
  const effectiveActiveTeamId = isSampleDemoMode ? sampleDemoActiveTeamId : activeTeamId;
  const effectiveExplicitPersonalMode = isSampleDemoMode
    ? sampleDemoExplicitPersonal
    : explicitPersonalMode;
  const effectiveActiveTeam = useMemo(
    () =>
      resolveEffectiveActiveTeam(
        effectiveTeams,
        effectiveActiveTeamId,
        effectiveExplicitPersonalMode
      ),
    [effectiveTeams, effectiveActiveTeamId, effectiveExplicitPersonalMode]
  );

  const effectiveOnTeamsUpdated = useCallback(
    (nextTeams: TeamSummaryWithRole[], nextActiveId?: string | null) => {
      if (isSampleDemoMode) {
        setSampleDemoTeams(nextTeams);
        if (nextActiveId !== undefined) {
          setSampleDemoExplicitPersonal(nextActiveId === null && nextTeams.length > 0);
          setSampleDemoActiveTeamId(nextActiveId ?? null);
        } else if (nextTeams.length > 0 && !sampleDemoActiveTeamId && !sampleDemoExplicitPersonal) {
          setSampleDemoActiveTeamId(nextTeams[0].brand.teamId);
        }
        return;
      }
      handleTeamsUpdated(nextTeams, nextActiveId);
    },
    [isSampleDemoMode, sampleDemoActiveTeamId, sampleDemoExplicitPersonal, handleTeamsUpdated]
  );

  const effectiveOnSelectActiveTeam = useCallback(
    (nextId: string | null) => {
      if (isSampleDemoMode) {
        setSampleDemoExplicitPersonal(nextId === null);
        setSampleDemoActiveTeamId(nextId);
        return;
      }
      handleSelectActiveTeam(nextId);
    },
    [isSampleDemoMode, handleSelectActiveTeam]
  );

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
    handleDisconnectStravaOnly,
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

  const combinedRoster = useMemo(() => {
    if (isSampleDemoMode) {
      if (sampleDemoTeams.length > 0) {
        const syncedRoster = buildConnectedRosterFromTeam(effectiveActiveTeam);
        const existingIds = new Set(syncedRoster.map((a) => a.id));
        return [
          ...syncedRoster,
          ...sampleDemoConnectedAthletes.filter((a) => !existingIds.has(a.id)),
        ];
      }
      return sampleDemoConnectedAthletes;
    }
    return myTeams.length > 0 ? cloudTeamRosterAthletes : connectedAthletes;
  }, [
    isSampleDemoMode,
    sampleDemoTeams.length,
    effectiveActiveTeam,
    sampleDemoConnectedAthletes,
    myTeams.length,
    cloudTeamRosterAthletes,
    connectedAthletes,
  ]);

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
    activeTeam: effectiveActiveTeam,
    handleTeamsUpdated: effectiveOnTeamsUpdated,
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
    activeTeam: effectiveActiveTeam,
    handleTeamsUpdated: effectiveOnTeamsUpdated,
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
    if (isSampleDemoMode) return sampleDemoWellnessDays;
    return wellnessDays;
  }, [shieldedConnectedTelemetry, isSampleDemoMode, sampleDemoWellnessDays, wellnessDays]);

  const effectiveActivities = useMemo(() => {
    if (shieldedConnectedTelemetry) return shieldedConnectedTelemetry.activities;
    if (isSampleDemoMode) return sampleDemoActivities;
    return myTeamRecordedActivities.length > 0
      ? mergeActivitiesNonDestructive(activities, myTeamRecordedActivities)
      : activities;
  }, [shieldedConnectedTelemetry, isSampleDemoMode, sampleDemoActivities, activities, myTeamRecordedActivities]);

  const effectivePlannedEvents = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.plannedEvents;
    const baseEvents = isSampleDemoMode ? sampleDemoPlannedEvents : plannedEvents;
    const teamEvents = buildMergedTeamBroadcastEvents(
      effectiveTeams,
      effectiveActiveTeam,
      effectiveExplicitPersonalMode
    );
    if (teamEvents.length === 0) return baseEvents;
    const existingIds = new Set(baseEvents.map((e) => e.id));
    return sortPlannedEventsChronologically([
      ...baseEvents,
      ...teamEvents.filter((te) => !existingIds.has(te.id)),
    ]);
  }, [
    activeConnectedAthlete,
    isSampleDemoMode,
    sampleDemoPlannedEvents,
    plannedEvents,
    effectiveTeams,
    effectiveActiveTeam,
    effectiveExplicitPersonalMode,
  ]);

  const effectiveAthleteProfile = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.athleteProfile;
    if (isSampleDemoMode) return sampleDemoProfile;
    const inferredSport = !athleteProfile.primarySport
      ? inferPrimarySportFromActivities(effectiveActivities)
      : undefined;
    const effectiveBirthMonthYear =
      athleteProfile.birthMonthYear || currentUser?.birthMonthYear;
    const ageTier = resolveAthleteAgeTier({
      birthMonthYear: effectiveBirthMonthYear,
      orgType: effectiveActiveTeam?.brand.orgType,
    });
    const enforceSafeSportWeightLock =
      ageTier.ageTier === 'U13_COPPA' ||
      ageTier.ageTier === 'YOUTH_13_17' ||
      Boolean(effectiveActiveTeam?.brand.defaultSafeSportShield);
    const withSafeSport: AthleteProfile = {
      ...athleteProfile,
      ...(effectiveBirthMonthYear && !athleteProfile.birthMonthYear
        ? { birthMonthYear: effectiveBirthMonthYear }
        : {}),
      ...(enforceSafeSportWeightLock ? { safeSportHideWeight: true } : {}),
    };
    return inferredSport ? { ...withSafeSport, primarySport: inferredSport } : withSafeSport;
  }, [
    activeConnectedAthlete,
    isSampleDemoMode,
    sampleDemoProfile,
    athleteProfile,
    currentUser?.birthMonthYear,
    effectiveActiveTeam,
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
    ? sampleDemoWellnessDays[sampleDemoWellnessDays.length - 1] || undefined
    : wellnessDays[wellnessDays.length - 1] || undefined;
  const latestWellness = effectiveWellnessDays[effectiveWellnessDays.length - 1] || undefined;

  const {
    effectiveSessionCheckIns,
    handleRecordSessionCheckIn,
    resetDemoSessionCheckIns,
    resetUserCloudSyncState,
  } = useAthleteCloudSync({
    isSampleDemoMode, hasEnteredWorkspace, isSessionLoggedOut, currentUser,
    stravaAthleteId: connectionStatus.stravaAthleteId, plannedEvents, setPlannedEvents,
    targetGoals, setTargetGoals, annualMileageGoals, setAnnualMileageGoals,
    athleteProfile, setAthleteProfile, distanceUnit, setDistanceUnit,
    activities, setActivities, wellnessDays, selfLatestWellness, selfPrivacySettings,
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

  const {
    handleLogoutSession,
    handleLogoutAndClearData,
    handleCompleteCalibrationEntry,
    handleBypassToLocalSession,
  } = useWorkspaceOnboarding({
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
  });


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

  const closeAllGlobalModals = useCallback(() => {
    setIsDataSourcesOpen(false);
    setIsCoachDrawerOpen(false);
    setIsProfileModalOpen(false);
    setIsOfficialRaceModalOpen(false);
    setIsRosterModalOpen(false);
    setShowMetricsGuide(false);
    setSelectedActivity(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('thresh-close-popovers'));
    }
  }, []);

  const handleSelectActivityMutex = useCallback(
    (act: UnifiedActivity | null) => {
      if (act) closeAllGlobalModals();
      return handleSelectActivity(act);
    },
    [closeAllGlobalModals, handleSelectActivity]
  );

  const handleSelectActivityAndOpenTab = useCallback(
    (act: UnifiedActivity) => {
      closeAllGlobalModals();
      void handleSelectActivity(act);
    },
    [closeAllGlobalModals, handleSelectActivity]
  );

  const handleOpenCoachPromptMutex = useCallback(
    (prompt: string) => {
      closeAllGlobalModals();
      handleOpenCoachWithPrompt(prompt);
    },
    [closeAllGlobalModals, handleOpenCoachWithPrompt]
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
      scheduledTime?: string;
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
      replaceExistingDate?: boolean;
    }) => {
      if (activeConnectedAthlete && activeConnectedAthlete.role === 'COACH_EDIT') {
        handlePushCoachWorkout(activeConnectedAthlete.id, {
          date: evt.date,
          name: evt.name,
          sportCategory: evt.sportCategory,
          plannedDurationSecs: evt.plannedDurationSecs,
          plannedLoad: evt.plannedLoad,
          workoutSyntax: evt.workoutSyntax || '',
          description: evt.description,
          scheduledTime: evt.scheduledTime,
          sessionSlot: evt.sessionSlot,
          locationName: evt.locationName,
          locationCategory: evt.locationCategory,
          meetingNotes: evt.meetingNotes,
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
  const handleOpenProfileModal = useCallback(() => {
    closeAllGlobalModals();
    setIsProfileModalOpen(true);
  }, [closeAllGlobalModals]);
  const handleOpenOfficialRaceModal = useCallback(() => {
    closeAllGlobalModals();
    setIsOfficialRaceModalOpen(true);
  }, [closeAllGlobalModals]);
  const handleOpenRosterModal = useCallback(() => {
    closeAllGlobalModals();
    setIsRosterModalOpen(true);
  }, [closeAllGlobalModals]);
  const handleOpenDataSourcesModal = useCallback(() => {
    closeAllGlobalModals();
    setIsDataSourcesOpen(true);
  }, [closeAllGlobalModals]);
  const handleOpenCoachDrawerModal = useCallback(() => {
    closeAllGlobalModals();
    setIsCoachDrawerOpen(true);
  }, [closeAllGlobalModals]);
  const handleOpenMetricsGuideModal = useCallback(() => {
    closeAllGlobalModals();
    setGuideInitialChapter(activeTab === 'coach' ? 'ch7-coaching' : 'ch1-quickstart');
    setShowMetricsGuide(true);
  }, [closeAllGlobalModals, activeTab]);
  const handleOpenCoachGuideModal = useCallback(() => {
    closeAllGlobalModals();
    setGuideInitialChapter('ch7-coaching');
    setShowMetricsGuide(true);
  }, [closeAllGlobalModals]);

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
    [isSampleDemoMode, sampleDemoProfile]
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

  const applyUpdatedTeamToState = useCallback(
    (updatedTeam: TeamSummaryWithRole) => {
      setMyTeams((prev) => {
        const replaced = prev.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        );
        const withOutbox = overlayPendingStopwatchOutboxOnTeams(replaced);
        try {
          localStorage.setItem('thresh_my_teams_v1', JSON.stringify(withOutbox));
        } catch {
          // ignore
        }
        return withOutbox;
      });
    },
    [setMyTeams]
  );

  const handleFlushStopwatchOutbox = useCallback(async (): Promise<StopwatchOutboxFlushResult> => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) {
      return { syncedBatches: 0, syncedEntries: 0, remainingBatches: 0, remainingEntries: 0 };
    }
    return flushStopwatchOutbox(applyUpdatedTeamToState);
  }, [isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace, applyUpdatedTeamToState]);

  useEffect(() => {
    if (isSampleDemoMode || isSessionLoggedOut || !hasEnteredWorkspace) return;
    void handleFlushStopwatchOutbox();
    const onOnline = () => {
      void handleFlushStopwatchOutbox();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [isSampleDemoMode, isSessionLoggedOut, hasEnteredWorkspace, handleFlushStopwatchOutbox]);

  const handleSaveStopwatchActivities = useCallback(
    async (entries: SavedStopwatchEntry[]): Promise<StopwatchSaveResult> => {
      if (!entries || entries.length === 0) {
        return {
          savedCount: 0,
          selfCount: 0,
          rosterCount: 0,
          teamCount: 0,
          walkOnCount: 0,
          pendingTeamCount: 0,
          skippedReadOnlyNames: [],
          syncStatus: 'LOCAL_ONLY',
        };
      }

      const activeTeamForCoach = !isSampleDemoMode ? effectiveActiveTeam : null;
      const isTeamCoach = Boolean(
        activeTeamForCoach &&
          (activeTeamForCoach.myRole === 'HEAD_COACH' ||
            activeTeamForCoach.myRole === 'ASSISTANT_COACH')
      );
      const activeTeamMembershipIds = activeTeamForCoach
        ? new Set(activeTeamForCoach.memberships.map((m) => m.membershipId))
        : undefined;

      const {
        selfActs,
        rosterByRunnerId,
        teamApiEntries,
        walkOnEntries,
        skippedReadOnlyNames,
        savedCount,
      } = partitionSavedStopwatchEntries(entries, combinedRoster, {
        isTeamCoach,
        activeTeamMembershipIds,
      });

      if (selfActs.length > 0) {
        if (isSampleDemoMode) {
          applyImportedActivities(selfActs);
        } else {
          const merged = mergeActivitiesNonDestructive(activitiesRef.current, selfActs);
          activitiesRef.current = merged;
          setActivities(merged);
          const rebuiltWellness = recomputeWellnessDaysWithActivityImport(
            wellnessDaysRef.current,
            merged,
            getLocalDateIso(),
            athleteProfileRef.current
          );
          wellnessDaysRef.current = rebuiltWellness;
          setWellnessDays(rebuiltWellness);
          void savePersistedTelemetrySnapshot({
            activities: merged,
            wellnessDays: rebuiltWellness,
            plannedEvents: plannedEventsRef.current,
            gearItems: gearItemsRef.current,
            athleteProfile: athleteProfileRef.current,
            redactedStravaCount: redactedStravaCountRef.current,
          });
        }
      }

      if (walkOnEntries.length > 0 && !isSampleDemoMode) {
        persistWalkOnStopwatchEntriesLocal(walkOnEntries);
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
        }
      }

      let syncStatus: StopwatchSaveResult['syncStatus'] = 'LOCAL_ONLY';
      let pendingTeamCount = 0;

      if (!isSampleDemoMode && activeTeamId && teamApiEntries.length > 0) {
        enqueueStopwatchOutboxBatch(activeTeamId, teamApiEntries);
        setMyTeams((prev) => {
          const withOutbox = overlayPendingStopwatchOutboxOnTeams(prev);
          try {
            localStorage.setItem('thresh_my_teams_v1', JSON.stringify(withOutbox));
          } catch {
            // ignore
          }
          return withOutbox;
        });
        const flushRes = await flushStopwatchOutbox(applyUpdatedTeamToState);
        pendingTeamCount = flushRes.remainingEntries;
        syncStatus = flushRes.remainingEntries === 0 ? 'SYNCED' : 'PENDING_OFFLINE';
      }

      return {
        savedCount,
        selfCount: selfActs.length,
        rosterCount: rosterByRunnerId.size,
        teamCount: teamApiEntries.length,
        walkOnCount: walkOnEntries.length,
        pendingTeamCount,
        skippedReadOnlyNames,
        syncStatus,
      };
    },
    [
      combinedRoster,
      isSampleDemoMode,
      activeTeamId,
      effectiveActiveTeam,
      setMyTeams,
      applyUpdatedTeamToState,
      applyImportedActivities,
    ]
  );

  const isStopwatchFullscreen =
    activeTab === 'stopwatch' ||
    (activeTab === 'coach' && coachSubTab === 'STOPWATCH');

  const isWorkspaceRendered = Boolean(
    !publicTeamSlug &&
      !isBrandRoute &&
      !isShareRoute &&
      (isSampleDemoMode ||
        (!isSessionLoggedOut &&
          hasEnteredWorkspace &&
          (hasStravaClientCredentials() || Boolean(currentUser))))
  );

  useEffect(() => {
    if (!isWorkspaceRendered || typeof window === 'undefined') return;
    try {
      const nextHash = buildWorkspaceHash(activeTab, coachSubTab);
      if (window.location.hash !== nextHash) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${nextHash}`
        );
      }
    } catch {
      // ignore history errors
    }
  }, [isWorkspaceRendered, activeTab, coachSubTab]);

  const hasStandaloneAccount = Boolean(
    currentUser &&
      (Boolean(currentUser.email) ||
        currentUser.authProviders?.some((p) => p.provider !== 'strava'))
  );

  const sessionAuthValue = useMemo(
    () => ({
      currentUser,
      onUserUpdated: setCurrentUser,
      onAccountDeleted: () => {
        setIsRosterModalOpen(false);
        void handleLogoutAndClearData();
      },
      hasStandaloneAccount,
      connectionStatus,
      hasGeminiKey: Boolean(connectionStatus.hasGeminiServerKey),
      intervalsConnected: connectionStatus.intervalsConnected,
      isSyncingProfile,
      isSyncing,
      syncError,
      idbSavedAt,
      persistedWorkoutCount: activities.length,
      stravaSyncWindow: connectionStatus.stravaSyncPolicy?.window,
      isSampleDemoMode,
      plainLanguageMode,
      distanceUnit,
      resendConfigured,
      onConnectIntervals: handleConnectIntervals,
      onLaunchIntervalsOAuth: handleLaunchIntervalsOAuth,
      onDisconnectIntervals: handleDisconnectIntervals,
      onLaunchWahooOAuth: handleLaunchWahooOAuth,
      onDisconnectWahoo: handleDisconnectWahoo,
      onLaunchPolarOAuth: handleLaunchPolarOAuth,
      onDisconnectPolar: handleDisconnectPolar,
      onDisconnectGarmin: handleDisconnectGarmin,
      onDisconnectStrava: hasStandaloneAccount ? handleDisconnectStravaOnly : handleLogoutSession,
      onUpdateStravaSyncPolicy: handleUpdateStravaSyncPolicy,
      onSaveStravaCredentials: handleSaveStravaCredentials,
      onLaunchStravaOAuth: handleLaunchStravaOAuth,
      onExchangeStravaCode: handleExchangeStravaCode,
      onSaveStravaDirectToken: handleSaveStravaDirectToken,
      onSaveMapTileConfig: handleSaveMapTileConfig,
      onSaveGeminiApiKey: handleSaveGeminiApiKey,
      onExportBundle: handleExportConnectionBundle,
      onImportBundle: handleImportConnectionBundle,
      onSyncNow: syncLiveTelemetry,
      onSyncProfileFromRemote: handleSyncProfileFromRemote,
      onRebuildPersistedArchive: handleClearPersistedArchive,
      onImportBatchActivities: (newActs: UnifiedActivity[]) => {
        if (isSampleDemoMode) {
          setSampleDemoActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
          return;
        }
        setActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
      },
      onImportOfficialRaces: handleImportOfficialRaces,
    }),
    [
      currentUser,
      setCurrentUser,
      setIsRosterModalOpen,
      handleLogoutAndClearData,
      hasStandaloneAccount,
      connectionStatus,
      isSyncingProfile,
      isSyncing,
      syncError,
      idbSavedAt,
      activities.length,
      isSampleDemoMode,
      plainLanguageMode,
      distanceUnit,
      resendConfigured,
      handleConnectIntervals,
      handleLaunchIntervalsOAuth,
      handleDisconnectIntervals,
      handleLaunchWahooOAuth,
      handleDisconnectWahoo,
      handleLaunchPolarOAuth,
      handleDisconnectPolar,
      handleDisconnectGarmin,
      handleDisconnectStravaOnly,
      handleLogoutSession,
      handleUpdateStravaSyncPolicy,
      handleSaveStravaCredentials,
      handleLaunchStravaOAuth,
      handleExchangeStravaCode,
      handleSaveStravaDirectToken,
      handleSaveMapTileConfig,
      handleSaveGeminiApiKey,
      handleExportConnectionBundle,
      handleImportConnectionBundle,
      syncLiveTelemetry,
      handleSyncProfileFromRemote,
      handleClearPersistedArchive,
      setSampleDemoActivities,
      setActivities,
      handleImportOfficialRaces,
    ]
  );

  const telemetryWorkspaceValue = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      effectiveActivities,
      effectiveWellnessDays,
      latestWellness,
      effectivePlannedEvents,
      effectiveTargetGoals,
      effectiveAnnualMileageGoals,
      effectiveGearItems,
      effectiveSessionCheckIns,
      onRecordSessionCheckIn: handleRecordSessionCheckIn,
      envFilter,
      setEnvFilter,
      selectedSport,
      setSelectedSport,
      athleteFtp,
      latestWeightKg,
      latestCtl,
      effectiveAthleteProfile,
      selectedActivity,
      benchmarkSegments,
      isScanningSegments,
      isHydratingRoutes,
      handleSelectActivityAndOpenTab,
      handleCalendarCreatePlannedEvent,
      handleUpdatePlannedEvent,
      handleDeletePlannedEvent,
      handleDeletePlanBlock,
      handleBatchCreatePlannedEvents,
      handleCreatePlannedEvent,
      handleScheduleProposedWorkout: async (workout: Partial<PlannedWorkoutEvent>) => {
        await handleCreatePlannedEvent({
          date: workout.date || getLocalDateIso(),
          name: workout.name || 'Structured Workout',
          sportCategory: workout.sportCategory || 'Running',
          environmentPreference: workout.environmentPreference || 'FLEXIBLE',
          plannedDurationSecs: workout.plannedDurationSecs || 3600,
          plannedLoad: workout.plannedLoad || 65,
          workoutSyntax: workout.workoutSyntax || '',
          description: workout.description || '',
        });
      },
      handleSelectActivity: handleSelectActivityMutex,
      loadStreamsForActivity,
      handleScanMoreSegments,
      handleHydrateMoreRoutes,
      handleToggleActivityKudos,
      handleAddActivityComment,
      handleImportSingleParsedActivity,
      handleImportMultipleParsedActivities,
      handleUpdateAnnualMileageGoal,
      handleAddTargetGoal,
      handleDeleteTargetGoal,
      handleSaveProfileOverride,
      handleOpenTodayTab,
      handleOpenActivitiesTab,
      handleOpenGoalsTab,
      handleSwitchToCalendarTab,
      handleOpenProfileModal,
      handleOpenOfficialRaceModal,
      handleOpenDataSources: handleOpenDataSourcesModal,
      handleOpenRosterModal,
      handleOpenCoachWithPrompt: handleOpenCoachPromptMutex,
    }),
    [
      activeTab,
      setActiveTab,
      effectiveActivities,
      effectiveWellnessDays,
      latestWellness,
      effectivePlannedEvents,
      effectiveTargetGoals,
      effectiveAnnualMileageGoals,
      effectiveGearItems,
      effectiveSessionCheckIns,
      handleRecordSessionCheckIn,
      envFilter,
      setEnvFilter,
      selectedSport,
      setSelectedSport,
      athleteFtp,
      latestWeightKg,
      latestCtl,
      effectiveAthleteProfile,
      selectedActivity,
      benchmarkSegments,
      isScanningSegments,
      isHydratingRoutes,
      handleSelectActivityAndOpenTab,
      handleCalendarCreatePlannedEvent,
      handleUpdatePlannedEvent,
      handleDeletePlannedEvent,
      handleDeletePlanBlock,
      handleBatchCreatePlannedEvents,
      handleCreatePlannedEvent,
      handleSelectActivityMutex,
      loadStreamsForActivity,
      handleScanMoreSegments,
      handleHydrateMoreRoutes,
      handleToggleActivityKudos,
      handleAddActivityComment,
      handleImportSingleParsedActivity,
      handleImportMultipleParsedActivities,
      handleUpdateAnnualMileageGoal,
      handleAddTargetGoal,
      handleDeleteTargetGoal,
      handleSaveProfileOverride,
      handleOpenTodayTab,
      handleOpenActivitiesTab,
      handleOpenGoalsTab,
      handleSwitchToCalendarTab,
      handleOpenProfileModal,
      handleOpenOfficialRaceModal,
      handleOpenDataSourcesModal,
      handleOpenRosterModal,
      handleOpenCoachPromptMutex,
    ]
  );

  const teamCoachValue = useMemo(
    () => ({
      coachSubTab,
      setCoachSubTab,
      activeTeam: effectiveActiveTeam,
      myTeams: effectiveTeams,
      activeTeamId: effectiveActiveTeamId,
      combinedRoster,
      activeViewedAthleteId,
      primaryAthleteDisplayName,
      selfInviteCode,
      selfLatestWellness,
      effectiveSelfPrivacySettings,
      onUpdateSelfPrivacy: isSampleDemoMode
        ? setSampleDemoPrivacySettings
        : setSelfPrivacySettings,
      onSelectAthleteViewportFromWorkspace: (id: string) => {
        setInspectedFromCoach(activeTab === 'coach' && id !== 'SELF');
        setActiveViewedAthleteId(id);
        setSelectedActivity(null);
      },
      onSelectAthleteViewportFromModal: (id: string) => {
        setActiveViewedAthleteId(id);
        setSelectedActivity(null);
      },
      onSelectActiveTeam: effectiveOnSelectActiveTeam,
      onTeamsUpdated: effectiveOnTeamsUpdated,
      onApproveAthleteRequest: handleApproveAthleteRequest,
      onRemoveOrDeclineAthlete: handleRemoveOrDeclineAthlete,
      onToggleAthleteRole: handleToggleAthleteRole,
      onAddFollowByInviteOrName: handleAddFollowByInviteOrName,
      onPushCoachWorkout: handlePushCoachWorkout,
      onOpenPublicTeamHub: openPublicTeamHub,
      onOpenCoachGuide: handleOpenCoachGuideModal,
      onOpenFullScreenStopwatch: () => {
        setIsRosterModalOpen(false);
        if (activeTab === 'coach') {
          setCoachSubTab('STOPWATCH');
        } else {
          setActiveTab('stopwatch');
        }
      },
      onOpenCoachWorkspace: (subTab?: CoachWorkspaceSubTab) => {
        setInspectedFromCoach(false);
        setActiveViewedAthleteId('SELF');
        setSelectedActivity(null);
        setActiveTab('coach');
        if (subTab) setCoachSubTab(subTab);
      },
      handleSaveStopwatchActivities,
      handleFlushStopwatchOutbox,
      chatMessages,
      onSendChatMessage: handleSendChatMessage,
      isSendingChat,
      onCancelSendChat: handleCancelSendChat,
      coachDraftPrompt,
      onClearDraftPrompt: () => setCoachDraftPrompt(''),
      onOpenAICoachFromGuide: (prompt?: string) => {
        if (prompt) {
          handleOpenCoachPromptMutex(prompt);
        } else {
          handleOpenCoachDrawerModal();
        }
      },
    }),
    [
      coachSubTab,
      setCoachSubTab,
      effectiveActiveTeam,
      effectiveTeams,
      effectiveActiveTeamId,
      combinedRoster,
      activeViewedAthleteId,
      primaryAthleteDisplayName,
      selfInviteCode,
      selfLatestWellness,
      effectiveSelfPrivacySettings,
      isSampleDemoMode,
      setSampleDemoPrivacySettings,
      setSelfPrivacySettings,
      activeTab,
      setInspectedFromCoach,
      setActiveViewedAthleteId,
      setSelectedActivity,
      effectiveOnSelectActiveTeam,
      effectiveOnTeamsUpdated,
      handleApproveAthleteRequest,
      handleRemoveOrDeclineAthlete,
      handleToggleAthleteRole,
      handleAddFollowByInviteOrName,
      handlePushCoachWorkout,
      openPublicTeamHub,
      handleOpenCoachGuideModal,
      setIsRosterModalOpen,
      setActiveTab,
      handleSaveStopwatchActivities,
      handleFlushStopwatchOutbox,
      chatMessages,
      handleSendChatMessage,
      isSendingChat,
      handleCancelSendChat,
      coachDraftPrompt,
      setCoachDraftPrompt,
      handleOpenCoachPromptMutex,
      handleOpenCoachDrawerModal,
    ]
  );

  if (publicTeamSlug) {
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <WorkspaceErrorBoundary
          resetKey={`public-team-hub-${publicTeamSlug}`}
          fallbackTitle="Team Hub Needs Recovery"
        >
          <React.Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                Loading THRESH Team Hub…
              </div>
            }
          >
            <PublicTeamHubPage
              slugOrCode={publicTeamSlug}
              isDark={isDark}
              onToggleDark={toggleQuickLightDark}
              localTeamsFallback={effectiveTeams}
              onFollowedTeam={effectiveOnTeamsUpdated}
              onExitHub={() => closePublicTeamHub(activeTab)}
            />
          </React.Suspense>
        </WorkspaceErrorBoundary>
      </IconContext.Provider>
    );
  }

  if (isBrandRoute) {
    const hasWorkspace = isSampleDemoMode || (!isSessionLoggedOut && hasEnteredWorkspace && (hasStravaClientCredentials() || Boolean(currentUser)));
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-xs font-mono text-white">Loading THRESH Brand Studio…</div>}>
          <BrandGuidePage isDark={isDark} onToggleDark={toggleQuickLightDark} hasActiveWorkspace={hasWorkspace} onExitBrand={() => closeBrand(hasWorkspace ? activeTab : undefined)} />
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
            sharedWorkout={sharedWorkout} isDark={isDark} onToggleDark={toggleQuickLightDark} hasActiveWorkspace={hasWorkspace}
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
        <WorkspaceErrorBoundary fallbackTitle="THRESH Sign In">
          <React.Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center text-xs font-mono text-white">
                Loading THRESH…
              </div>
            }
          >
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
              onToggleDark={toggleQuickLightDark}
              onEnterSampleDemo={(preferredRole) => {
                resetSampleDemoEphemeralState({ clearDemoStopwatch: true });
                setIsSampleDemoMode(true);
                if (preferredRole === 'COACH') {
                  setActiveTab('coach');
                  setCoachSubTab('CLIPBOARD');
                } else {
                  setActiveTab('fitness');
                }
              }}
              onImportBatchActivities={handleImportMultipleParsedActivities}
              existingActivities={activities}
              distanceUnit={distanceUnit}
              onOpenBrandStudio={openBrand}
              onBypassToLocalSession={handleBypassToLocalSession}
            />
          </React.Suspense>
        </WorkspaceErrorBoundary>
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
      <SessionAuthProvider value={sessionAuthValue}>
        <TelemetryWorkspaceProvider value={telemetryWorkspaceValue}>
          <TeamCoachProvider value={teamCoachValue}>
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
          activeTeam={effectiveActiveTeam}
          myTeams={effectiveTeams}
          activeTeamId={effectiveActiveTeamId}
          onSelectActiveTeam={effectiveOnSelectActiveTeam}
          onOpenRosterModalWithTab={(tab) => {
            closeAllGlobalModals();
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
          onOpenDataSources={handleOpenDataSourcesModal}
          onOpenCoach={handleOpenCoachDrawerModal}
          isDark={isDark}
          onToggleDark={toggleQuickLightDark}
          activeThemeVariant={activeThemeVariant}
          daytimePalette={daytimePalette}
          onSelectDaytimePalette={setDaytimePalette}
          sundownPolicy={sundownPolicy}
          onSelectSundownPolicy={setSundownPolicy}
          sunsetLabel12h={sunsetLabel12h}
          currentUser={currentUser}
          effectiveActivities={effectiveActivities}
          effectiveAthleteProfile={effectiveAthleteProfile}
          onOpenProfileModal={handleOpenProfileModal}
          onOpenGuide={handleOpenMetricsGuideModal}
          distanceUnit={distanceUnit}
          setDistanceUnit={setDistanceUnit}
          isSampleDemoMode={isSampleDemoMode}
          plainLanguageMode={plainLanguageMode}
          onTogglePlainLanguage={handleTogglePlainLanguage}
          onLogoutSession={handleLogoutSession}
          onLogoutAndClearData={handleLogoutAndClearData}
        />

        {/* Global Content Container & Stage Banners */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 ap-container py-2 sm:py-3 min-w-0 flex flex-col gap-2.5 sm:gap-3">
            <div
              data-testid="cockpit-content-stage"
              className="ap-content-stage p-1.5 sm:p-2 lg:p-5 space-y-3 sm:space-y-4 min-w-0 flex-1 flex flex-col"
            >
              <CockpitStageBanners
              pendingUrlJoinOffer={pendingUrlJoinOffer}
              onAcceptJoinOffer={handleAcceptJoinOffer}
              onDismissJoinOffer={handleDismissJoinOffer}
              isSyncing={isSyncing}
              activitiesCount={effectiveActivities.length}
              onOpenDataSources={handleOpenDataSourcesModal}
              activeConnectedAthlete={activeConnectedAthlete}
              shieldedConnectedTelemetry={shieldedConnectedTelemetry}
              onOpenRosterModal={handleOpenRosterModal}
              onReturnToMyProfile={() => {
                setInspectedFromCoach(false);
                setActiveViewedAthleteId('SELF');
                setSelectedActivity(null);
              }}
              onReturnToCoachWorkspace={
                inspectedFromCoach
                  ? () => {
                      setInspectedFromCoach(false);
                      setActiveViewedAthleteId('SELF');
                      setSelectedActivity(null);
                      setActiveTab('coach');
                      setCoachSubTab('ROSTER');
                    }
                  : undefined
              }
              onOpenCoachWorkspace={() => {
                setActiveTab('coach');
                setCoachSubTab('ROSTER');
              }}
              readOnlyNotice={readOnlyNotice}
              onDismissReadOnlyNotice={() => setReadOnlyNotice(null)}
              redactedStravaCount={redactedStravaCount}
              connectionStatus={connectionStatus}
              dismissedStravaBanner={dismissedStravaBanner}
              onLaunchStravaOAuth={(mode) => handleLaunchStravaOAuth(mode)}
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
                if (connectStrava) {
                  void handleLaunchStravaOAuth('cloud');
                }
              }}
              dismissedQuickConnectBanner={dismissedQuickConnectBanner}
              onDismissQuickConnectBanner={() => setDismissedQuickConnectBanner(true)}
              myTeamsCount={effectiveTeams.length}
              isCoachMode={activeTab === 'coach'}
              isStopwatchMode={
                activeTab === 'stopwatch' ||
                (activeTab === 'coach' && coachSubTab === 'STOPWATCH')
              }
              athleteProfile={effectiveAthleteProfile}
              distanceUnit={distanceUnit}
              onOpenProfileModal={handleOpenProfileModal}
              onOpenPlanBuilder={handleOpenGoalsTab}
              onExploreFitness={handleOpenTodayTab}
            />

            <main id="main-content" className="flex-1 min-w-0" tabIndex={-1}>
              <WorkspaceRouter />
            </main>
            </div>

            {!isStopwatchFullscreen && (
              <CockpitFooter
                athleteFtp={effectiveAthleteProfile.ftp}
                onOpenProfile={handleOpenProfileModal}
                onOpenDataSources={handleOpenDataSourcesModal}
                onOpenGuide={handleOpenMetricsGuideModal}
                onOpenBrandStudio={openBrand}
              />
            )}
          </div>
        </div>

        <MobileDock
          activeTab={activeTab}
          lastProgressTab={lastLabTabRef.current}
          coachSubTab={coachSubTab}
          onSelectCoachSubTab={setCoachSubTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
          }}
        />

        <CockpitModals
          isCoachDrawerOpen={isCoachDrawerOpen}
          onCloseCoachDrawer={() => setIsCoachDrawerOpen(false)}
          isProfileModalOpen={isProfileModalOpen}
          onCloseProfileModal={() => setIsProfileModalOpen(false)}
          isDataSourcesOpen={isDataSourcesOpen}
          onCloseDataSources={() => setIsDataSourcesOpen(false)}
          isOfficialRaceModalOpen={isOfficialRaceModalOpen}
          onCloseOfficialRaceModal={() => setIsOfficialRaceModalOpen(false)}
          isRosterModalOpen={isRosterModalOpen}
          onCloseRosterModal={() => setIsRosterModalOpen(false)}
          rosterInitialTab={rosterInitialTab}
          showMetricsGuide={showMetricsGuide}
          guideInitialChapter={guideInitialChapter}
          onCloseMetricsGuide={() => setShowMetricsGuide(false)}
        />
            </div>
          </TeamCoachProvider>
        </TelemetryWorkspaceProvider>
      </SessionAuthProvider>
    </IconContext.Provider>
  );
}
