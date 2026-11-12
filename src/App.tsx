import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Calendar,
  HeartPulse,
  LineChart,
  Moon,
  RefreshCw,
  Shield,
  Sliders,
  Sun,
  Target,
  TrendingUp,
  Users,
  Eye,
  Lock,
  CalendarPlus,
  LogIn,
  LogOut,
  Settings,
  ChevronDown,
  HelpCircle,
  Database,
  IconContext,
} from "./components/icons/PhosphorIcons";
import {
  AnnualMileageGoal,
  AthleteGearItem,
  AthletePrivacySettings,
  AthleteProfile,
  BenchmarkSegmentHistory,
  CoachChatMessage,
  ConnectedAthleteRecord,
  ConnectionStatus,
  DistanceUnit,
  EnvironmentFilter,
  MapTileProvider,
  PlannedWorkoutEvent,
  SportCategory,
  StravaSyncPolicy,
  StravaSyncWindow,
  TargetGoal,
  TeamSummaryWithRole,
  UnifiedActivity,
  UnifiedWellnessDay,
} from './types';
import {
  INITIAL_ANNUAL_MILEAGE_GOALS,
  INITIAL_CHAT_MESSAGES,
  INITIAL_POWER_PACE_CURVES,
} from './data/mockTelemetry';
import {
  DEFAULT_SELF_PRIVACY_SETTINGS,
  applyAthletePrivacyShield,
  buildInitialConnectedAthletes,
  createConnectedAthleteRecord,
} from './data/athleteRosterData';
import {
  StravaAuthGate,
  type FirstRunCalibrationPayload,
  type StravaOAuthJoinContext,
} from './components/StravaAuthGate';
import { AeroPulseLogo } from './components/AeroPulseLogo';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { applyTeamBrandToDocument } from './utils/teamBrandDom';

const CalendarView = lazy(() =>
  import('./components/CalendarView').then((m) => ({ default: m.CalendarView }))
);
const FitnessHealthView = lazy(() =>
  import('./components/FitnessHealthView').then((m) => ({ default: m.FitnessHealthView }))
);
const PhysiologicalTrendsView = lazy(() =>
  import('./components/PhysiologicalTrendsView').then((m) => ({
    default: m.PhysiologicalTrendsView,
  }))
);
const CustomChartsView = lazy(() =>
  import('./components/CustomChartsView').then((m) => ({ default: m.CustomChartsView }))
);
const ActivitiesView = lazy(() =>
  import('./components/ActivitiesView').then((m) => ({ default: m.ActivitiesView }))
);
const PhysiologyView = lazy(() =>
  import('./components/PhysiologyView').then((m) => ({ default: m.PhysiologyView }))
);
const GoalsView = lazy(() =>
  import('./components/GoalsView').then((m) => ({ default: m.GoalsView }))
);
const AICoachDrawer = lazy(() =>
  import('./components/AICoachDrawer').then((m) => ({ default: m.AICoachDrawer }))
);
const DataSourcesModal = lazy(() =>
  import('./components/DataSourcesModal').then((m) => ({ default: m.DataSourcesModal }))
);
const AthleteProfileModal = lazy(() =>
  import('./components/AthleteProfileModal').then((m) => ({ default: m.AthleteProfileModal }))
);
const OfficialRaceModal = lazy(() =>
  import('./components/OfficialRaceModal').then((m) => ({ default: m.OfficialRaceModal }))
);
const AthleteRosterModal = lazy(() =>
  import('./components/AthleteRosterModal').then((m) => ({ default: m.AthleteRosterModal }))
);
const UserGuideModal = lazy(() =>
  import('./components/UserGuideModal').then((m) => ({ default: m.UserGuideModal }))
);

const ViewLoadingSkeleton: React.FC = () => (
  <div className="rounded-2xl liquid-glass p-8 text-center text-xs font-mono text-slate-500 dark:text-slate-400 animate-pulse">
    Loading THRESH workspace...
  </div>
);
import { computeAnnualMileageSummary, formatDistance } from './utils/formatters';
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
  computeWellnessDaysFromActivities,
  isGenericAthleteName,
  isUncalibratedDefaultProfile,
  loadPersistedTelemetrySnapshot,
  mergeActivitiesNonDestructive,
  mergeWellnessDaysNonDestructive,
  reclassifyActivityEnvironment,
  savePersistedTelemetrySnapshot,
  saveRotatedStravaTokensToStorage,
} from './utils/telemetryStorage';
import {
  getActivityStreamFromDexie,
  saveActivityStreamToDexie,
} from './db/workoutStore';
import { upsampleAndAnalyzeActivityInWorker } from './workers/activityWorkerClient';

type ActiveTab =
  | 'calendar'
  | 'fitness'
  | 'trends'
  | 'charts'
  | 'activities'
  | 'curves'
  | 'totals';

const DEV_APP_URL = 'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';
const SHARED_APP_URL = 'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('fitness');
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
  const [rosterInitialTab, setRosterInitialTab] = useState<
    'TEAMS_BRANDING' | 'LEADERBOARD' | 'SCHOLASTIC_COACH' | 'CONNECT_INVITE' | 'PRIVACY_SHIELD'
  >('TEAMS_BRANDING');
  const [myTeams, setMyTeams] = useState<TeamSummaryWithRole[]>(() => {
    try {
      const cached = localStorage.getItem('thresh_my_teams_v1');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('thresh_active_team_id_v1') || null;
    } catch {
      return null;
    }
  });
  const [resendConfigured, setResendConfigured] = useState<boolean>(false);
  const [pendingUrlJoinOffer, setPendingUrlJoinOffer] = useState<{
    codeOrSlug: string;
    token?: string;
    teamName: string;
    shortName: string;
  } | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);
  const [showMetricsGuide, setShowMetricsGuide] = useState<boolean>(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

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

  // Omnipresent Slide-Over AI Coach Drawer State
  const [isCoachDrawerOpen, setIsCoachDrawerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<CoachChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [isSendingChat, setIsSendingChat] = useState(false);

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

  // Global Escape key listener to dismiss any open modal or slide-over drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsRosterModalOpen(false);
        setIsOfficialRaceModalOpen(false);
        setIsProfileModalOpen(false);
        setIsDataSourcesOpen(false);
        setIsCoachDrawerOpen(false);
        setSelectedActivity(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Automatically persist telemetry state changes (workouts, planned events, calibrated profile) to IndexedDB
  useEffect(() => {
    if (!idbHydratedRef.current) return;
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
  }, [activities, wellnessDays, plannedEvents, gearItems, athleteProfile, redactedStravaCount]);

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

  // Save goals to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('aeropulse_annual_mileage_goals', JSON.stringify(annualMileageGoals));
    } catch {
      // ignore storage quota errors
    }
  }, [annualMileageGoals]);

  useEffect(() => {
    try {
      localStorage.setItem('aeropulse_target_goals', JSON.stringify(targetGoals));
    } catch {
      // ignore
    }
  }, [targetGoals]);

  useEffect(() => {
    try {
      localStorage.setItem('aeropulse_self_privacy_settings', JSON.stringify(selfPrivacySettings));
    } catch {
      // ignore
    }
  }, [selfPrivacySettings]);

  useEffect(() => {
    try {
      localStorage.setItem('aeropulse_connected_athletes_v1', JSON.stringify(connectedAthletes));
    } catch {
      // ignore
    }
  }, [connectedAthletes]);

  useEffect(() => {
    try {
      localStorage.setItem('thresh_distance_unit', distanceUnit);
    } catch {
      // ignore
    }
  }, [distanceUnit]);

  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut) return;
    fetch('/api/auth/session', { method: 'POST', credentials: 'include' }).catch(() => null);
  }, [hasEnteredWorkspace, isSessionLoggedOut]);

  const getSavedIntervalsHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    try {
      const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
      const sessionToken = localStorage.getItem('aeropulse_session_token') || '';
      if (sessionToken && notLoggedOut) {
        headers['x-session-token'] = sessionToken;
      }
      const apiKey = localStorage.getItem('aeropulse_intervals_api_key') || '';
      const athleteId = localStorage.getItem('aeropulse_intervals_athlete_id') || '0';
      if (apiKey && notLoggedOut) {
        headers['x-intervals-api-key'] = apiKey;
        headers['x-intervals-athlete-id'] = athleteId;
      }
      const stravaClientId = localStorage.getItem('aeropulse_strava_client_id') || '';
      const stravaClientSecret = localStorage.getItem('aeropulse_strava_client_secret') || '';
      const stravaRefreshToken = localStorage.getItem('aeropulse_strava_refresh_token') || '';
      const stravaAccessToken = localStorage.getItem('aeropulse_strava_access_token') || '';
      const stravaExpiresAt = localStorage.getItem('aeropulse_strava_expires_at') || '';
      const mapTileApiKey = localStorage.getItem('aeropulse_map_tile_api_key') || '';
      const mapTileProvider = localStorage.getItem('aeropulse_map_tile_provider') || '';
      const geminiApiKey = localStorage.getItem('aeropulse_gemini_api_key') || '';
      if (stravaClientId) headers['x-strava-client-id'] = stravaClientId;
      if (stravaClientSecret) headers['x-strava-client-secret'] = stravaClientSecret;
      if (stravaRefreshToken && notLoggedOut) headers['x-strava-refresh-token'] = stravaRefreshToken;
      if (stravaAccessToken && notLoggedOut) headers['x-strava-access-token'] = stravaAccessToken;
      if (stravaExpiresAt && notLoggedOut) headers['x-strava-expires-at'] = stravaExpiresAt;
      if (mapTileApiKey) headers['x-map-tile-api-key'] = mapTileApiKey;
      if (mapTileProvider) headers['x-map-tile-provider'] = mapTileProvider;
      if (geminiApiKey) headers['x-gemini-api-key'] = geminiApiKey;
      const garminPersonalKey = localStorage.getItem('aeropulse_garmin_personal_api_key');
      const garminBearer = localStorage.getItem('aeropulse_garmin_bearer_token');
      const garminOauth1 = localStorage.getItem('aeropulse_garmin_oauth1_token');
      const garminSecret = localStorage.getItem('aeropulse_garmin_oauth1_secret');
      if (garminPersonalKey && notLoggedOut) headers['x-garmin-personal-api-key'] = garminPersonalKey;
      if (garminBearer && notLoggedOut) headers['x-garmin-bearer-token'] = garminBearer;
      if (garminOauth1 && notLoggedOut) headers['x-garmin-oauth1-token'] = garminOauth1;
      if (garminSecret && notLoggedOut) headers['x-garmin-oauth1-secret'] = garminSecret;
    } catch {
      // ignore
    }
    return headers;
  };

  const hasStravaClientCredentials = (): boolean => {
    try {
      const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
      return Boolean(
        notLoggedOut &&
          (localStorage.getItem('aeropulse_session_token') ||
            localStorage.getItem('aeropulse_strava_access_token') ||
            localStorage.getItem('aeropulse_strava_refresh_token'))
      );
    } catch {
      return false;
    }
  };

  const hasLocalClientCredentials = (): boolean => {
    return hasStravaClientCredentials();
  };

  const reconcileStoreOwnerAthleteId = useCallback(async (incomingAthleteId?: string | number) => {
    const cleanId = incomingAthleteId ? String(incomingAthleteId).trim() : '';
    if (!cleanId) return;
    try {
      const prevOwner =
        localStorage.getItem('aeropulse_store_owner_athlete_id') ||
        localStorage.getItem('aeropulse_strava_athlete_id') ||
        '';
      if (prevOwner && prevOwner !== cleanId) {
        await clearPersistedTelemetrySnapshot();
        setIdbSavedAt(null);
        setActivities([]);
        activitiesRef.current = [];
        setWellnessDays([]);
        wellnessDaysRef.current = [];
        setPlannedEvents([]);
        plannedEventsRef.current = [];
        setGearItems([]);
        gearItemsRef.current = [];
        setRedactedStravaCount(0);
        redactedStravaCountRef.current = 0;
        setMyTeams([]);
        setActiveTeamId(null);
        setActiveViewedAthleteId('SELF');
        const cleanProf = buildCompleteAthleteProfile(null);
        setAthleteProfile(cleanProf);
        athleteProfileRef.current = cleanProf;
        localStorage.removeItem('thresh_my_teams_v1');
        localStorage.removeItem('thresh_active_team_id_v1');
        localStorage.removeItem('aeropulse_garmin_athlete_name');
        localStorage.removeItem('aeropulse_intervals_athlete_name');
      }
      localStorage.setItem('aeropulse_store_owner_athlete_id', cleanId);
      localStorage.setItem('aeropulse_strava_athlete_id', cleanId);
    } catch {
      // ignore storage errors
    }
  }, []);

  const safeParseResponseJson = async (resp: Response): Promise<any> => {
    const text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      return {
        error: `Server returned an unexpected response (HTTP ${resp.status})${snippet ? `: ${snippet}` : ''}`,
      };
    }
  };

  const fetchServerConfigStatus = useCallback(async () => {
    try {
      let notLoggedOut = true;
      let savedStravaName: string | undefined;
      try {
        notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
        savedStravaName = localStorage.getItem('aeropulse_strava_athlete_name') || undefined;
      } catch {
        // ignore
      }
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`, {
        credentials: 'include',
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await safeParseResponseJson(resp);
      if (data?.error && !data?.callbackUrl) return null;

      const isActiveStravaSession = Boolean(
        notLoggedOut && (data.stravaConnected || hasStravaClientCredentials())
      );

      if (isActiveStravaSession && data.stravaAthleteId) {
        await reconcileStoreOwnerAthleteId(data.stravaAthleteId);
      }

      if (isActiveStravaSession && data.sessionToken) {
        try {
          localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
        } catch {
          // ignore
        }
      }
      if (isActiveStravaSession && data.stravaTokens) {
        saveRotatedStravaTokensToStorage(data.stravaTokens);
      }
      if (data.mapTileApiKey) {
        try {
          if (!localStorage.getItem('aeropulse_map_tile_api_key')) {
            localStorage.setItem('aeropulse_map_tile_api_key', data.mapTileApiKey);
          }
          if (data.mapTileProvider && !localStorage.getItem('aeropulse_map_tile_provider')) {
            localStorage.setItem('aeropulse_map_tile_provider', data.mapTileProvider);
          }
        } catch {
          // ignore
        }
      }
      if (isActiveStravaSession) {
        try {
          if (data.stravaAthleteName && !isGenericAthleteName(data.stravaAthleteName)) {
            localStorage.setItem(
              'aeropulse_strava_athlete_name',
              String(data.stravaAthleteName).trim()
            );
          }
          if (data.garminAthleteName && !isGenericAthleteName(data.garminAthleteName)) {
            localStorage.setItem(
              'aeropulse_garmin_athlete_name',
              String(data.garminAthleteName).trim()
            );
          }
          if (data.intervalsAthleteName && !isGenericAthleteName(data.intervalsAthleteName)) {
            localStorage.setItem(
              'aeropulse_intervals_athlete_name',
              String(data.intervalsAthleteName).trim()
            );
          }
          if (data.stravaAthleteWeightKg && Number(data.stravaAthleteWeightKg) > 30) {
            localStorage.setItem(
              'aeropulse_strava_athlete_weight_kg',
              String(data.stravaAthleteWeightKg)
            );
          }
          if (data.stravaAthleteFtp && Number(data.stravaAthleteFtp) > 80) {
            localStorage.setItem('aeropulse_strava_athlete_ftp', String(data.stravaAthleteFtp));
          }
          if (
            (data.stravaMeasurementPreference === 'mi' ||
              data.stravaMeasurementPreference === 'km') &&
            !localStorage.getItem('thresh_distance_unit_user_set')
          ) {
            setDistanceUnit(data.stravaMeasurementPreference);
          }
        } catch {
          // ignore
        }
      }
      const isClientStravaConnected = Boolean(notLoggedOut && data.stravaConnected);
      const isClientIntervalsConnected = Boolean(isClientStravaConnected && data.intervalsConnected);
      const isClientGarminConnected = Boolean(
        isClientStravaConnected &&
          (data.garminConnected ||
            localStorage.getItem('aeropulse_garmin_personal_api_key') ||
            localStorage.getItem('aeropulse_garmin_bearer_token'))
      );
      const resolvedStravaName =
        data.stravaAthleteName && !isGenericAthleteName(data.stravaAthleteName)
          ? String(data.stravaAthleteName).trim()
          : savedStravaName && !isGenericAthleteName(savedStravaName)
            ? savedStravaName
            : undefined;
      const resolvedGarminName =
        data.garminAthleteName && !isGenericAthleteName(data.garminAthleteName)
          ? String(data.garminAthleteName).trim()
          : undefined;
      const resolvedIntervalsName =
        data.intervalsAthleteName && !isGenericAthleteName(data.intervalsAthleteName)
          ? String(data.intervalsAthleteName).trim()
          : undefined;
      const bestRealName = resolvedStravaName || resolvedGarminName || resolvedIntervalsName;

      if (isClientStravaConnected) {
        const currentProf = athleteProfileRef.current;
        const needsNameUpdate = bestRealName && isGenericAthleteName(currentProf?.name);
        const needsCalibration = isUncalibratedDefaultProfile(currentProf);
        if (needsNameUpdate || needsCalibration || data.athleteProfile) {
          const baseProf = data.athleteProfile || currentProf;
          const mergedProf = buildCompleteAthleteProfile(
            {
              ...baseProf,
              ...(currentProf?.source === 'CUSTOM_OVERRIDE'
                ? {
                    source: 'CUSTOM_OVERRIDE' as const,
                    thresholdPaceSecsPerKm: currentProf.thresholdPaceSecsPerKm,
                    ftp: currentProf.ftp,
                    indoorFtp: currentProf.indoorFtp,
                  }
                : {}),
              name: bestRealName || data.athleteProfile?.name || currentProf?.name,
              weightKg:
                data.athleteProfile?.weightKg && data.athleteProfile.weightKg !== 70
                  ? data.athleteProfile.weightKg
                  : !needsCalibration && currentProf?.weightKg && currentProf.weightKg !== 70
                    ? currentProf.weightKg
                    : data.stravaAthleteWeightKg || baseProf?.weightKg,
              ftp:
                currentProf?.source === 'CUSTOM_OVERRIDE' && currentProf.ftp
                  ? currentProf.ftp
                  : data.athleteProfile?.ftp &&
                      data.athleteProfile.ftp !== 250 &&
                      data.athleteProfile.ftp !== 280 &&
                      data.athleteProfile.ftp !== 300
                    ? data.athleteProfile.ftp
                    : !needsCalibration &&
                        currentProf?.ftp &&
                        currentProf.ftp !== 250 &&
                        currentProf.ftp !== 280 &&
                        currentProf.ftp !== 300
                      ? currentProf.ftp
                      : data.stravaAthleteFtp || baseProf?.ftp,
            },
            wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
            activitiesRef.current
          );
          setAthleteProfile(mergedProf);
          athleteProfileRef.current = mergedProf;
        }
      }
      setConnectionStatus((prev) => ({
        ...prev,
        mode:
          isClientIntervalsConnected || isClientStravaConnected || isClientGarminConnected
            ? 'LIVE'
            : 'SANDBOX_CALIBRATION',
        garminConnected: isClientGarminConnected,
        garminAthleteName: isClientGarminConnected
          ? resolvedGarminName ||
            localStorage.getItem('aeropulse_garmin_athlete_name') ||
            prev.garminAthleteName
          : undefined,
        intervalsConnected: isClientIntervalsConnected,
        intervalsAthleteId: isClientIntervalsConnected ? data.intervalsAthleteId || '0' : '0',
        intervalsAthleteName: isClientIntervalsConnected
          ? resolvedIntervalsName || prev.intervalsAthleteName
          : undefined,
        intervalsSource: isClientIntervalsConnected ? data.intervalsSource || 'USER_INPUT' : 'NONE',
        stravaConfigured:
          typeof data.stravaConfigured === 'boolean'
            ? data.stravaConfigured
            : prev.stravaConfigured,
        stravaConnected: isClientStravaConnected,
        stravaClientId: data.stravaClientId || prev.stravaClientId,
        stravaAthleteId: isClientStravaConnected
          ? data.stravaAthleteId || prev.stravaAthleteId
          : undefined,
        stravaAthleteName: isClientStravaConnected
          ? bestRealName || prev.stravaAthleteName
          : undefined,
        stravaMeasurementPreference:
          data.stravaMeasurementPreference || prev.stravaMeasurementPreference,
        stravaGrantedScope: isClientStravaConnected
          ? data.stravaGrantedScope ?? prev.stravaGrantedScope
          : undefined,
        stravaSyncPolicy: isClientStravaConnected
          ? data.stravaSyncPolicy || prev.stravaSyncPolicy
          : undefined,
        stravaSource: isClientStravaConnected ? data.stravaSource || 'OAUTH' : 'NONE',
        hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        currentOriginCallbackUrl:
          data.callbackUrl || `${window.location.origin}/api/strava/callback`,
        lastSyncedAt: isClientStravaConnected
          ? data.lastSyncedAt || prev.lastSyncedAt
          : prev.lastSyncedAt,
        nextHourlySyncAt: isClientStravaConnected
          ? data.nextHourlySyncAt || prev.nextHourlySyncAt
          : prev.nextHourlySyncAt,
        autoSyncCronActive: true,
        athleteFtp: athleteProfileRef.current.ftp || prev.athleteFtp,
        athleteIndoorFtp: athleteProfileRef.current.indoorFtp || prev.athleteIndoorFtp,
        athleteRunFtp: athleteProfileRef.current.runFtp || prev.athleteRunFtp,
        athleteLthr: athleteProfileRef.current.lthr || prev.athleteLthr,
        athleteMaxHr: athleteProfileRef.current.maxHr || prev.athleteMaxHr,
        athleteProfile: athleteProfileRef.current || prev.athleteProfile,
        stravaActivitiesCount:
          isClientStravaConnected && data.stravaActivitiesCount && data.stravaActivitiesCount > 0
            ? data.stravaActivitiesCount
            : prev.stravaActivitiesCount,
        mapTileProvider: data.mapTileProvider || prev.mapTileProvider || 'OSM_KEYLESS',
        mapTileApiKeyConfigured: Boolean(data.mapTileApiKeyConfigured || data.mapTileApiKey),
        mapTileApiKey: data.mapTileApiKey || prev.mapTileApiKey,
      }));
      return data;
    } catch {
      return null;
    }
  }, [reconcileStoreOwnerAthleteId]);

  const syncLiveTelemetry = useCallback(
    async (fullHistory = false, explicitStravaWindow?: StravaSyncWindow) => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        const headers = getSavedIntervalsHeaders();
        const statusResp = await fetch(
          `/api/config/status?origin=${encodeURIComponent(window.location.origin)}`,
          { credentials: 'include', headers }
        );
        const statusData = statusResp.ok ? await statusResp.json() : {};
        if (statusData.stravaTokens) {
          saveRotatedStravaTokensToStorage(statusData.stravaTokens);
        }

        // Refresh headers in case status check rotated the Strava token
        const activeHeaders = getSavedIntervalsHeaders();
        const hasVirtualCyclingArchive =
          activitiesRef.current.filter(
            (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR'
          ).length >= 50;
        const hasPersistedArchive =
          !fullHistory && activitiesRef.current.length >= 50 && hasVirtualCyclingArchive;
        const deltaOldestDate = new Date(Date.now() - 60 * 86400 * 1000)
          .toISOString()
          .slice(0, 10);

        let mergedActivities: UnifiedActivity[] | null = null;
        let nextWellnessDays = wellnessDaysRef.current;
        let nextPlannedEvents = plannedEventsRef.current;
        let nextGearItems = gearItemsRef.current;
        let nextRedactedCount = redactedStravaCountRef.current;
        let earliestDate: string | undefined;

        if (statusData.intervalsConnected) {
          const oldestParam = hasPersistedArchive ? deltaOldestDate : '2010-01-01';
          const intResp = await fetch(`/api/intervals/sync?oldest=${oldestParam}`, {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (intResp.ok) {
            const intData = await intResp.json();
            if (Array.isArray(intData.wellnessDays) && intData.wellnessDays.length > 0) {
              nextWellnessDays = mergeWellnessDaysNonDestructive(
                wellnessDaysRef.current,
                intData.wellnessDays
              );
              setWellnessDays(nextWellnessDays);
            }
            if (typeof intData.redactedStravaCount === 'number') {
              nextRedactedCount = Math.max(nextRedactedCount, intData.redactedStravaCount);
              setRedactedStravaCount(nextRedactedCount);
            }
            if (Array.isArray(intData.plannedEvents) && intData.plannedEvents.length > 0) {
              nextPlannedEvents = intData.plannedEvents;
              setPlannedEvents(nextPlannedEvents);
            }
            if (Array.isArray(intData.activities)) {
              mergedActivities = intData.activities;
              earliestDate = intData.earliestActivityDate || undefined;
            }
            if (intData.athleteProfile) {
              if (
                intData.athleteProfile.name &&
                !isGenericAthleteName(intData.athleteProfile.name)
              ) {
                try {
                  localStorage.setItem(
                    'aeropulse_intervals_athlete_name',
                    String(intData.athleteProfile.name).trim()
                  );
                } catch {
                  // ignore
                }
              }
              const latestW =
                nextWellnessDays.length > 0
                  ? nextWellnessDays[nextWellnessDays.length - 1]
                  : undefined;
              const completeProf = buildCompleteAthleteProfile(
                intData.athleteProfile,
                latestW,
                mergedActivities || activitiesRef.current
              );
              setAthleteProfile(completeProf);
              athleteProfileRef.current = completeProf;
              if (
                Array.isArray(intData.athleteProfile.gearItems) &&
                intData.athleteProfile.gearItems.length > 0
              ) {
                nextGearItems = intData.athleteProfile.gearItems;
                setGearItems(nextGearItems);
              }
            }
          }
        }

        if (statusData.garminConnected) {
          const garminResp = await fetch('/api/garmin/sync', {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (garminResp.ok) {
            const garminData = await garminResp.json();
            if (Array.isArray(garminData.wellnessDays) && garminData.wellnessDays.length > 0) {
              nextWellnessDays = mergeWellnessDaysNonDestructive(
                nextWellnessDays,
                garminData.wellnessDays
              );
              setWellnessDays(nextWellnessDays);
              wellnessDaysRef.current = nextWellnessDays;
            }
            if (Array.isArray(garminData.activities) && garminData.activities.length > 0) {
              const garminActs = garminData.activities.map((a: UnifiedActivity) =>
                reclassifyActivityEnvironment(a)
              );
              mergedActivities = mergedActivities
                ? mergeActivitiesNonDestructive(mergedActivities, garminActs)
                : garminActs;
            }
            if (garminData.athleteProfile) {
              if (
                garminData.athleteProfile.name &&
                !isGenericAthleteName(garminData.athleteProfile.name)
              ) {
                try {
                  localStorage.setItem(
                    'aeropulse_garmin_athlete_name',
                    String(garminData.athleteProfile.name).trim()
                  );
                } catch {
                  // ignore
                }
              }
              const latestW =
                nextWellnessDays.length > 0
                  ? nextWellnessDays[nextWellnessDays.length - 1]
                  : undefined;
              const completeProf = buildCompleteAthleteProfile(
                garminData.athleteProfile,
                latestW,
                mergedActivities || activitiesRef.current
              );
              setAthleteProfile(completeProf);
              athleteProfileRef.current = completeProf;
            }
          }
        }

        const savedWindow = statusData.stravaSyncPolicy?.window as StravaSyncWindow | undefined;
        const targetStravaWindow: StravaSyncWindow =
          explicitStravaWindow || (fullHistory ? 'all' : savedWindow || '90d');
        const grantedScopeStr = String(statusData.stravaGrantedScope || '');
        const stravaMissingActivityScope =
          Boolean(grantedScopeStr) && !grantedScopeStr.includes('activity:read');

        if (
          statusData.stravaConnected &&
          targetStravaWindow !== 'none' &&
          !stravaMissingActivityScope
        ) {
          const hasPersistedVirtualCycling = activitiesRef.current.some(
            (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR'
          );
          const useDelta =
            !fullHistory &&
            !explicitStravaWindow &&
            hasPersistedArchive &&
            hasPersistedVirtualCycling;
          const syncQs = new URLSearchParams({ window: targetStravaWindow });
          if (useDelta) {
            syncQs.set('deltaOnly', 'true');
          } else if (fullHistory || targetStravaWindow === 'all') {
            syncQs.set('full', 'true');
          }
          const stravaResp = await fetch(`/api/strava/sync?${syncQs.toString()}`, {
            credentials: 'include',
            headers: activeHeaders,
          });
          if (stravaResp.ok) {
            const stravaData = await stravaResp.json();
            if (stravaData.missingActivityScope) {
              setConnectionStatus((prev) => ({
                ...prev,
                stravaGrantedScope: 'read',
              }));
            }
            if (stravaData.stravaTokens) {
              saveRotatedStravaTokensToStorage({
                ...stravaData.stravaTokens,
                athleteId: stravaData.athleteId,
                athleteName: stravaData.athleteName,
              });
            } else if (stravaData.athleteName || stravaData.athleteId) {
              saveRotatedStravaTokensToStorage({
                athleteId: stravaData.athleteId,
                athleteName: stravaData.athleteName,
              });
            }
            if (stravaData.athleteProfile) {
              if (!statusData.intervalsConnected && !statusData.garminConnected) {
                const currentProf = athleteProfileRef.current;
                const latestW =
                  nextWellnessDays.length > 0
                    ? nextWellnessDays[nextWellnessDays.length - 1]
                    : undefined;
                const completeProf = buildCompleteAthleteProfile(
                  {
                    ...stravaData.athleteProfile,
                    ...(currentProf?.source === 'CUSTOM_OVERRIDE'
                      ? {
                          source: 'CUSTOM_OVERRIDE' as const,
                          thresholdPaceSecsPerKm: currentProf.thresholdPaceSecsPerKm,
                          ftp: currentProf.ftp,
                          indoorFtp: currentProf.indoorFtp,
                        }
                      : {}),
                  },
                  latestW,
                  stravaData.activities || activitiesRef.current
                );
                setAthleteProfile(completeProf);
                athleteProfileRef.current = completeProf;
                if (
                  Array.isArray(stravaData.gearItems) &&
                  stravaData.gearItems.length > 0 &&
                  statusData.stravaSyncPolicy?.importProfileAndGear !== false
                ) {
                  nextGearItems = stravaData.gearItems;
                  setGearItems(nextGearItems);
                }
              } else {
                // Preserve real Garmin / Intervals biometrics (weight, RHR, LTHR, Max HR, HR zones) while taking Strava gear & FTP fallback if needed
                const currentProf = athleteProfileRef.current;
                const currentUncalibrated = isUncalibratedDefaultProfile(currentProf);
                const mergedRawProfile = {
                  ...stravaData.athleteProfile,
                  ...(currentUncalibrated ? {} : currentProf),
                  name:
                    !isGenericAthleteName(currentProf.name)
                      ? currentProf.name
                      : !isGenericAthleteName(stravaData.athleteProfile.name)
                        ? stravaData.athleteProfile.name
                        : currentProf.name,
                  weightKg:
                    !currentUncalibrated &&
                    currentProf.weightKg &&
                    currentProf.weightKg !== 70 &&
                    currentProf.weightKg !== 71.5
                      ? currentProf.weightKg
                      : stravaData.athleteProfile.weightKg &&
                          stravaData.athleteProfile.weightKg !== 70
                        ? stravaData.athleteProfile.weightKg
                        : currentProf.weightKg,
                  ftp:
                    !currentUncalibrated &&
                    currentProf.ftp &&
                    currentProf.ftp !== 250 &&
                    currentProf.ftp !== 280 &&
                    currentProf.ftp !== 300
                      ? currentProf.ftp
                      : stravaData.athleteProfile.ftp &&
                          stravaData.athleteProfile.ftp !== 250 &&
                          stravaData.athleteProfile.ftp !== 280
                        ? stravaData.athleteProfile.ftp
                        : currentProf.ftp,
                  restingHr:
                    !currentUncalibrated &&
                    currentProf.restingHr &&
                    currentProf.restingHr !== 46 &&
                    currentProf.restingHr !== 50
                      ? currentProf.restingHr
                      : stravaData.athleteProfile.restingHr || currentProf.restingHr,
                  lthr:
                    !currentUncalibrated &&
                    currentProf.lthr &&
                    currentProf.lthr !== 163 &&
                    currentProf.lthr !== 174
                      ? currentProf.lthr
                      : stravaData.athleteProfile.lthr || currentProf.lthr,
                  maxHr:
                    !currentUncalibrated &&
                    currentProf.maxHr &&
                    currentProf.maxHr !== 182 &&
                    currentProf.maxHr !== 192
                      ? currentProf.maxHr
                      : stravaData.athleteProfile.maxHr || currentProf.maxHr,
                  hrZones:
                    !currentUncalibrated &&
                    Array.isArray(currentProf.hrZones) &&
                    currentProf.hrZones.length >= 5
                      ? currentProf.hrZones
                      : stravaData.athleteProfile.hrZones,
                  runHrZones:
                    !currentUncalibrated &&
                    Array.isArray(currentProf.runHrZones) &&
                    currentProf.runHrZones.length >= 5
                      ? currentProf.runHrZones
                      : stravaData.athleteProfile.runHrZones,
                };
                const latestW =
                  nextWellnessDays.length > 0
                    ? nextWellnessDays[nextWellnessDays.length - 1]
                    : undefined;
                const updatedProf = buildCompleteAthleteProfile(
                  mergedRawProfile,
                  latestW,
                  mergedActivities || activitiesRef.current
                );
                setAthleteProfile(updatedProf);
                athleteProfileRef.current = updatedProf;
                if (
                  Array.isArray(stravaData.gearItems) &&
                  stravaData.gearItems.length > 0 &&
                  nextGearItems.length === 0
                ) {
                  nextGearItems = stravaData.gearItems;
                  setGearItems(nextGearItems);
                }
              }
            }
            if (Array.isArray(stravaData.activities) && stravaData.activities.length > 0) {
              const toUnifiedFromStrava = (sa: any): UnifiedActivity =>
                reclassifyActivityEnvironment({
                  id: `strava-${sa.stravaId}`,
                  stravaId: String(sa.stravaId),
                  startDateLocal: sa.startDateLocal,
                  name: sa.name,
                  sportCategory: sa.sportCategory,
                  environment: sa.environment,
                  subType: sa.subType || (sa.environment === 'INDOOR' ? 'Smart Trainer' : 'Road'),
                  movingTimeSecs: sa.movingTimeSecs,
                  distanceMeters: sa.distanceMeters,
                  elevationGainMeters: sa.elevationGainMeters,
                  avgPower: sa.avgPower,
                  normalizedPower: sa.normalizedPower,
                  intensityFactor: sa.intensityFactor,
                  trainingLoad: sa.trainingLoad || 0,
                  avgHr: sa.avgHr || 0,
                  maxHr: sa.maxHr || 0,
                  avgCadence: sa.avgCadence,
                  avgPaceSecsPerKm: sa.avgPaceSecsPerKm,
                  gapPaceSecsPerKm: sa.avgPaceSecsPerKm,
                  aerobicDecouplingPct: 0,
                  efficiencyFactor: sa.efficiencyFactor || 0,
                  firstHalfEf: 0,
                  secondHalfEf: 0,
                  zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
                  gearName: sa.gearName,
                  stravaPrCount: sa.stravaPrCount || 0,
                  kudosCount: sa.kudosCount || 0,
                  commentCount: sa.commentCount || 0,
                  achievementCount: sa.achievementCount || 0,
                  athleteCount: sa.athleteCount || 1,
                  hasKudoed: Boolean(sa.hasKudoed),
                  kudoers: Array.isArray(sa.kudoers) ? sa.kudoers : [],
                  comments: Array.isArray(sa.comments) ? sa.comments : [],
                  summaryPolyline: sa.summaryPolyline,
                  routeLatLngs: Array.isArray(sa.routeLatLngs) ? sa.routeLatLngs : undefined,
                  startLatLng: sa.startLatLng,
                  endLatLng: sa.endLatLng,
                  segmentEfforts: sa.segmentEfforts || [],
                  sourceBadges: ['Strava'],
                });

              if (!mergedActivities) {
                mergedActivities = stravaData.activities.map(toUnifiedFromStrava);
              } else {
                const byStravaId = new Map<string, any>();
                for (const sa of stravaData.activities) {
                  byStravaId.set(String(sa.stravaId), sa);
                }
                mergedActivities = mergedActivities.map((act) => {
                  let matched = act.stravaId ? byStravaId.get(String(act.stravaId)) : undefined;
                  if (!matched) {
                    const actNorm = String(act.startDateLocal || '').replace(/Z$/i, '');
                    const actTime = new Date(actNorm).getTime();
                    for (const [sid, sa] of byStravaId.entries()) {
                      const saNorm = String(sa.startDateLocal || '').replace(/Z$/i, '');
                      const saTime = new Date(saNorm).getTime();
                      const timeDiffSecs = Math.abs(actTime - saTime) / 1000;
                      const sameDate = actNorm.slice(0, 10) === saNorm.slice(0, 10);
                      const distDiffRatio =
                        act.distanceMeters > 500 && sa.distanceMeters > 500
                          ? Math.abs(act.distanceMeters - sa.distanceMeters) /
                            Math.max(act.distanceMeters, sa.distanceMeters)
                          : 1;
                      if (
                        sa.sportCategory === act.sportCategory &&
                        (timeDiffSecs <= 300 || (sameDate && distDiffRatio <= 0.03))
                      ) {
                        matched = sa;
                        byStravaId.delete(sid);
                        break;
                      }
                    }
                  } else if (act.stravaId) {
                    byStravaId.delete(String(act.stravaId));
                  }

                  if (matched) {
                    const resolvedEnv =
                      matched.environment === 'INDOOR' || act.environment === 'INDOOR'
                        ? 'INDOOR'
                        : act.environment;
                    const resolvedSubType: UnifiedActivity['subType'] =
                      matched.subType === 'Virtual Cycling' || act.subType === 'Virtual Cycling'
                        ? 'Virtual Cycling'
                        : matched.subType === 'Smart Trainer' || act.subType === 'Smart Trainer'
                          ? 'Smart Trainer'
                          : matched.subType === 'Treadmill' || act.subType === 'Treadmill'
                            ? 'Treadmill'
                            : act.subType || matched.subType;

                    const isGenericStubName =
                      !act.name ||
                      act.id.startsWith('strava-') ||
                      /^Zwift\s+—\s+Virtual Cycling$/i.test(act.name.trim()) ||
                      /^Strava\s+Activity$/i.test(act.name.trim());

                    return reclassifyActivityEnvironment({
                      ...act,
                      name: isGenericStubName && matched.name ? matched.name : act.name,
                      environment: resolvedEnv,
                      subType: resolvedSubType,
                      stravaId: String(matched.stravaId || act.stravaId || ''),
                      trainingLoad:
                        act.trainingLoad && act.trainingLoad > 0
                          ? act.trainingLoad
                          : matched.trainingLoad || act.trainingLoad,
                      avgPower: act.avgPower ?? matched.avgPower,
                      normalizedPower: act.normalizedPower ?? matched.normalizedPower,
                      intensityFactor: act.intensityFactor ?? matched.intensityFactor,
                      variabilityIndex: act.variabilityIndex ?? matched.variabilityIndex,
                      avgHr: act.avgHr ?? matched.avgHr,
                      maxHr: act.maxHr ?? matched.maxHr,
                      gearName: matched.gearName || act.gearName,
                      stravaPrCount: matched.stravaPrCount ?? act.stravaPrCount,
                      kudosCount: matched.kudosCount ?? act.kudosCount,
                      commentCount: matched.commentCount ?? act.commentCount,
                      achievementCount: matched.achievementCount ?? act.achievementCount,
                      athleteCount: matched.athleteCount ?? act.athleteCount,
                      hasKudoed: matched.hasKudoed ?? act.hasKudoed,
                      kudoers:
                        Array.isArray(matched.kudoers) && matched.kudoers.length > 0
                          ? matched.kudoers
                          : act.kudoers,
                      comments:
                        Array.isArray(matched.comments) && matched.comments.length > 0
                          ? matched.comments
                          : act.comments,
                      summaryPolyline: matched.summaryPolyline || act.summaryPolyline,
                      routeLatLngs:
                        Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2
                          ? act.routeLatLngs
                          : Array.isArray(matched.routeLatLngs) && matched.routeLatLngs.length > 2
                            ? matched.routeLatLngs
                            : act.routeLatLngs,
                      startLatLng: act.startLatLng || matched.startLatLng,
                      endLatLng: act.endLatLng || matched.endLatLng,
                      segmentEfforts:
                        Array.isArray(matched.segmentEfforts) && matched.segmentEfforts.length > 0
                          ? matched.segmentEfforts
                          : act.segmentEfforts,
                      sourceBadges: Array.from(new Set([...act.sourceBadges, 'Strava'])) as (
                        | 'Intervals.icu'
                        | 'Garmin'
                        | 'Strava'
                      )[],
                    });
                  }
                  return reclassifyActivityEnvironment(act);
                });

                const remainingStravaActivities = Array.from(byStravaId.values()).map(
                  toUnifiedFromStrava
                );
                mergedActivities = [...mergedActivities, ...remainingStravaActivities].sort(
                  (a, b) =>
                    new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
                );
              }
            }
          } else {
            const errJson = await stravaResp.json().catch(() => ({}));
            if (errJson?.error && !statusData.garminConnected && !statusData.intervalsConnected) {
              setSyncError(errJson.error);
            }
          }
        }

        if (mergedActivities !== null) {
          // Non-destructively merge with existing persisted archive so deployments/delta syncs never lose workouts, streams, or routes
          const combinedArchive = mergeActivitiesNonDestructive(
            activitiesRef.current,
            mergedActivities
          );
          setActivities(combinedArchive);
          activitiesRef.current = combinedArchive;

          if (!statusData.intervalsConnected && combinedArchive.length > 0) {
            const activityDerivedWellness = computeWellnessDaysFromActivities(combinedArchive);
            nextWellnessDays =
              nextWellnessDays.length > 0
                ? mergeWellnessDaysNonDestructive(activityDerivedWellness, nextWellnessDays)
                : activityDerivedWellness;
            setWellnessDays(nextWellnessDays);
            wellnessDaysRef.current = nextWellnessDays;
          }

          // Re-run profile calibration with the full merged activity archive
          const calibratedProf = buildCompleteAthleteProfile(
            athleteProfileRef.current,
            nextWellnessDays[nextWellnessDays.length - 1],
            combinedArchive
          );
          setAthleteProfile(calibratedProf);
          athleteProfileRef.current = calibratedProf;

          const oldestLoaded =
            combinedArchive.length > 0
              ? combinedArchive[combinedArchive.length - 1].startDateLocal.slice(0, 10)
              : earliestDate;
          const totalGarmin = combinedArchive.filter(
            (a) => a.sourceBadges.includes('Garmin') || a.sourceBadges.includes('Intervals.icu')
          ).length;
          const totalStrava = combinedArchive.filter(
            (a) => a.sourceBadges.includes('Strava') || Boolean(a.stravaId)
          ).length;

          setConnectionStatus((prev) => ({
            ...prev,
            totalActivitiesCount: combinedArchive.length,
            garminActivitiesCount: totalGarmin,
            stravaActivitiesCount: totalStrava,
            earliestActivityDate: oldestLoaded || prev.earliestActivityDate,
            lastSyncedAt: new Date().toISOString(),
          }));

          const savedTimestamp = await savePersistedTelemetrySnapshot({
            activities: combinedArchive,
            wellnessDays: nextWellnessDays,
            plannedEvents: nextPlannedEvents,
            gearItems: nextGearItems,
            athleteProfile: athleteProfileRef.current,
            redactedStravaCount: nextRedactedCount,
            earliestActivityDate: oldestLoaded,
          });
          if (savedTimestamp) setIdbSavedAt(savedTimestamp);
        }
        await fetchServerConfigStatus();
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Telemetry sync failed.');
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchServerConfigStatus]
  );

  const handledOAuthTokensRef = useRef<Set<string>>(new Set());

  const completeStravaAuthHandshake = useCallback(
    async (opts: {
      tokens?: any;
      sessionToken?: string;
      hasExistingSyncPolicy?: boolean;
    }) => {
      const { tokens, sessionToken, hasExistingSyncPolicy } = opts;
      const dedupeKey = String(
        tokens?.accessToken || tokens?.refreshToken || sessionToken || ''
      ).trim();
      if (dedupeKey) {
        if (handledOAuthTokensRef.current.has(dedupeKey)) return;
        handledOAuthTokensRef.current.add(dedupeKey);
      }

      if (tokens?.athleteId) {
        await reconcileStoreOwnerAthleteId(tokens.athleteId);
      }
      try {
        localStorage.removeItem('aeropulse_logged_out');
        if (sessionToken) {
          localStorage.setItem('aeropulse_session_token', String(sessionToken));
        }
      } catch {
        // ignore
      }
      if (tokens) {
        saveRotatedStravaTokensToStorage(tokens);
        const cleanName =
          tokens.athleteName && !isGenericAthleteName(tokens.athleteName)
            ? String(tokens.athleteName).trim()
            : undefined;
        const weightKg = Number(tokens.weightKg ?? tokens.athleteWeightKg ?? 0);
        const ftp = Number(tokens.ftp ?? tokens.athleteFtp ?? 0);
        const measurementPref: DistanceUnit | undefined =
          tokens.measurementPreference === 'km' || tokens.measurementPreference === 'meters'
            ? 'km'
            : tokens.measurementPreference === 'mi' || tokens.measurementPreference === 'feet'
              ? 'mi'
              : undefined;
        if (measurementPref) {
          try {
            if (!localStorage.getItem('thresh_distance_unit_user_set')) {
              setDistanceUnit(measurementPref);
            }
          } catch {
            setDistanceUnit(measurementPref);
          }
        }
        if (cleanName || weightKg > 30 || ftp > 50) {
          const updatedProf = buildCompleteAthleteProfile(
            {
              ...athleteProfileRef.current,
              ...(cleanName ? { name: cleanName } : {}),
              ...(weightKg > 30 ? { weightKg } : {}),
              ...(ftp > 50 ? { ftp, indoorFtp: ftp } : {}),
            },
            wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
            activitiesRef.current
          );
          setAthleteProfile(updatedProf);
          athleteProfileRef.current = updatedProf;
        }
        setConnectionStatus((prev) => ({
          ...prev,
          mode: 'LIVE',
          stravaConnected: true,
          stravaSource: 'OAUTH',
          stravaAthleteId: tokens.athleteId ? String(tokens.athleteId) : prev.stravaAthleteId,
          stravaAthleteName: cleanName || prev.stravaAthleteName,
          stravaMeasurementPreference: measurementPref || prev.stravaMeasurementPreference,
          stravaGrantedScope: tokens.grantedScope ?? prev.stravaGrantedScope,
        }));
      }

      setIsSessionLoggedOut(false);
      const statusData = await fetchServerConfigStatus();
      const alreadyHasPolicy = Boolean(
        hasExistingSyncPolicy ||
          statusData?.stravaSyncPolicy?.consentedAt ||
          hasEnteredWorkspaceRef.current
      );
      if (alreadyHasPolicy) {
        try {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } catch {
          // ignore
        }
        setHasEnteredWorkspace(true);
        hasEnteredWorkspaceRef.current = true;
        void syncLiveTelemetry(false);
      }
    },
    [fetchServerConfigStatus, reconcileStoreOwnerAthleteId, syncLiveTelemetry]
  );

  // Instant hydration from Browser IndexedDB on boot + background incremental delta sync
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (hasLocalClientCredentials()) {
        const cached = await loadPersistedTelemetrySnapshot();
        if (mounted && cached) {
          if (Array.isArray(cached.activities) && cached.activities.length > 0) {
            setActivities(cached.activities);
            activitiesRef.current = cached.activities;
          }
          if (Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0) {
            setWellnessDays(cached.wellnessDays);
            wellnessDaysRef.current = cached.wellnessDays;
          }
          if (Array.isArray(cached.plannedEvents) && cached.plannedEvents.length > 0) {
            setPlannedEvents(cached.plannedEvents);
            plannedEventsRef.current = cached.plannedEvents;
          }
          if (Array.isArray(cached.gearItems) && cached.gearItems.length > 0) {
            setGearItems(cached.gearItems);
            gearItemsRef.current = cached.gearItems;
          }
          if (cached.athleteProfile) {
            const latestW =
              Array.isArray(cached.wellnessDays) && cached.wellnessDays.length > 0
                ? cached.wellnessDays[cached.wellnessDays.length - 1]
                : undefined;
            const hydratedProf = buildCompleteAthleteProfile(
              cached.athleteProfile,
              latestW,
              cached.activities
            );
            setAthleteProfile(hydratedProf);
            athleteProfileRef.current = hydratedProf;
          }
          if (typeof cached.redactedStravaCount === 'number') {
            setRedactedStravaCount(cached.redactedStravaCount);
            redactedStravaCountRef.current = cached.redactedStravaCount;
          }
          setIdbSavedAt(cached.savedAt);

          const totalGarmin = cached.activities.filter(
            (a) => a.sourceBadges.includes('Garmin') || a.sourceBadges.includes('Intervals.icu')
          ).length;
          const totalStrava = cached.activities.filter(
            (a) => a.sourceBadges.includes('Strava') || Boolean(a.stravaId)
          ).length;
          const oldest =
            cached.earliestActivityDate ||
            (cached.activities.length > 0
              ? cached.activities[cached.activities.length - 1].startDateLocal.slice(0, 10)
              : undefined);

          setConnectionStatus((prev) => ({
            ...prev,
            totalActivitiesCount: cached.activities.length,
            garminActivitiesCount: totalGarmin,
            stravaActivitiesCount: totalStrava,
            earliestActivityDate: oldest || prev.earliestActivityDate,
            lastSyncedAt: cached.savedAt,
          }));
        }
      }
      idbHydratedRef.current = true;

      // Surface any OAuth redirect error from ?auth_error=... or exchange ?code=... if an older SW intercepted /auth/strava/callback
      let exchangedUrlCode = false;
      try {
        const params = new URLSearchParams(window.location.search);
        const urlAuthErr = params.get('auth_error');
        const urlCode = params.get('code');
        const urlOAuthMarker = params.get('oauth');
        if (urlAuthErr) {
          setSyncError(urlAuthErr);
          params.delete('auth_error');
          const cleanQuery = params.toString();
          const nextUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', nextUrl);
        } else if (urlCode) {
          params.delete('code');
          params.delete('scope');
          params.delete('state');
          const cleanQuery = params.toString();
          const nextUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', nextUrl);
          const exResp = await fetch('/api/strava/exchange-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
            body: JSON.stringify({ code: urlCode }),
          });
          const exData = await safeParseResponseJson(exResp);
          if (exResp.ok && (exData.accessToken || exData.refreshToken)) {
            await completeStravaAuthHandshake({
              tokens: {
                refreshToken: exData.refreshToken,
                accessToken: exData.accessToken,
                expiresAt: exData.expiresAt,
                clientId: exData.clientId,
                athleteId: exData.athleteId,
                athleteName: exData.athleteName,
                weightKg: exData.weightKg,
                ftp: exData.ftp,
                measurementPreference: exData.measurementPreference,
                grantedScope: exData.grantedScope,
              },
              sessionToken: exData.sessionToken,
              hasExistingSyncPolicy: exData.hasExistingSyncPolicy,
            });
            exchangedUrlCode = true;
          } else if (exData?.error) {
            setSyncError(exData.error);
          }
        } else if (urlOAuthMarker) {
          params.delete('oauth');
          const cleanQuery = params.toString();
          const nextUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', nextUrl);
        }
      } catch {
        // ignore URL parse issues
      }

      let justConnectedViaOAuth = false;
      try {
        justConnectedViaOAuth = localStorage.getItem('aeropulse_oauth_just_connected') === '1';
        if (justConnectedViaOAuth) {
          localStorage.removeItem('aeropulse_oauth_just_connected');
          const savedName = localStorage.getItem('aeropulse_strava_athlete_name')?.trim();
          const savedWeight = Number(localStorage.getItem('aeropulse_strava_athlete_weight_kg') || 0);
          const savedFtp = Number(localStorage.getItem('aeropulse_strava_athlete_ftp') || 0);
          if (savedName && !isGenericAthleteName(savedName)) {
            const nextProf = buildCompleteAthleteProfile(
              {
                ...athleteProfileRef.current,
                name: savedName,
                ...(savedWeight > 30 ? { weightKg: savedWeight } : {}),
                ...(savedFtp > 80 ? { ftp: savedFtp } : {}),
              },
              wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
              activitiesRef.current
            );
            setAthleteProfile(nextProf);
            athleteProfileRef.current = nextProf;
          }
        }
      } catch {
        // ignore storage errors
      }

      const statusData = await fetchServerConfigStatus();
      let isGatePassed = false;
      let notLoggedOut = true;
      try {
        notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
        isGatePassed = localStorage.getItem('aeropulse_auth_gate_passed') === '1' && notLoggedOut;
        // Returning Strava user whose server vault already has a consented sync policy:
        if (
          !isGatePassed &&
          notLoggedOut &&
          statusData?.stravaConnected &&
          statusData?.stravaSyncPolicy?.confirmedAt
        ) {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
          isGatePassed = true;
          if (mounted) {
            setIsSessionLoggedOut(false);
            setHasEnteredWorkspace(true);
            hasEnteredWorkspaceRef.current = true;
          }
        }
      } catch {
        isGatePassed = false;
      }
      if (
        mounted &&
        isGatePassed &&
        hasLocalClientCredentials() &&
        (justConnectedViaOAuth ||
          exchangedUrlCode ||
          statusData?.stravaConnected ||
          statusData?.garminConnected ||
          statusData?.intervalsConnected)
      ) {
        syncLiveTelemetry(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [completeStravaAuthHandshake, fetchServerConfigStatus, syncLiveTelemetry]);

  // Automatic Stale-While-Revalidate sync on Tab Focus / Visibility Change + 15-min active timer
  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut) return;

    let lastAutoSyncMs = Date.now();
    const MIN_REFOCUS_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes cooldown

    const triggerIfStale = () => {
      if (!hasLocalClientCredentials()) return;
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastAutoSyncMs >= MIN_REFOCUS_INTERVAL_MS) {
          lastAutoSyncMs = now;
          syncLiveTelemetry(false);
        }
      }
    };

    const intervalId = window.setInterval(() => {
      if (!hasLocalClientCredentials()) return;
      lastAutoSyncMs = Date.now();
      syncLiveTelemetry(false);
    }, 15 * 60 * 1000);

    document.addEventListener('visibilitychange', triggerIfStale);
    window.addEventListener('focus', triggerIfStale);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', triggerIfStale);
      window.removeEventListener('focus', triggerIfStale);
    };
  }, [hasEnteredWorkspace, isSessionLoggedOut, syncLiveTelemetry]);

  // Listen for OAuth popup completion via window.postMessage and BroadcastChannel
  useEffect(() => {
    const handledCodeKeys = new Set<string>();
    const processIncomingOAuthPayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'OAUTH_AUTH_SUCCESS') {
        void completeStravaAuthHandshake({
          tokens: payload.tokens,
          sessionToken: payload.sessionToken,
          hasExistingSyncPolicy: payload.hasExistingSyncPolicy,
        });
      } else if (payload.type === 'OAUTH_AUTH_CODE' && payload.code) {
        const codeStr = String(payload.code).trim();
        const dedupeKey = `code:${codeStr}`;
        if (!codeStr || handledCodeKeys.has(dedupeKey)) return;
        handledCodeKeys.add(dedupeKey);
        void (async () => {
          const exResp = await fetch('/api/strava/exchange-code', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
            body: JSON.stringify({ code: codeStr }),
          });
          const exData = await safeParseResponseJson(exResp);
          if (exResp.ok && (exData.accessToken || exData.refreshToken)) {
            await completeStravaAuthHandshake({
              tokens: {
                accessToken: exData.accessToken,
                refreshToken: exData.refreshToken,
                expiresAt: exData.expiresAt,
                clientId: exData.clientId,
                athleteId: exData.athleteId,
                athleteName: exData.athleteName,
                weightKg: exData.weightKg,
                ftp: exData.ftp,
                measurementPreference: exData.measurementPreference,
                grantedScope: exData.grantedScope,
              },
              sessionToken: exData.sessionToken,
              hasExistingSyncPolicy: exData.hasExistingSyncPolicy,
            });
          } else if (exData?.error) {
            setSyncError(exData.error);
          }
        })();
      } else if (payload.type === 'OAUTH_AUTH_ERROR' && payload.error) {
        setSyncError(String(payload.error));
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        origin !== window.location.origin &&
        origin !== DEV_APP_URL &&
        origin !== SHARED_APP_URL
      ) {
        return;
      }
      processIncomingOAuthPayload(event.data);
    };
    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('aeropulse_oauth');
      bc.onmessage = (ev) => {
        processIncomingOAuthPayload(ev.data);
      };
    } catch {
      // ignore if BroadcastChannel unsupported
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (bc) bc.close();
    };
  }, [completeStravaAuthHandshake]);

  const handleConnectIntervals = async (athleteId: string, apiKey: string) => {
    setSyncError(null);
    const resp = await fetch('/api/intervals/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ athleteId, apiKey }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Intervals.icu');
      throw new Error(data.error || 'Failed to connect Intervals.icu');
    }
    try {
      localStorage.setItem('aeropulse_intervals_api_key', apiKey.trim());
      localStorage.setItem(
        'aeropulse_intervals_athlete_id',
        (data.athleteId || athleteId || '0').trim()
      );
    } catch {
      // ignore
    }
    await syncLiveTelemetry(false);
  };

  const handleDisconnectIntervals = async () => {
    try {
      localStorage.removeItem('aeropulse_intervals_api_key');
      localStorage.removeItem('aeropulse_intervals_athlete_id');
      localStorage.removeItem('aeropulse_intervals_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/intervals/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleDisconnectGarmin = async () => {
    try {
      localStorage.removeItem('aeropulse_garmin_personal_api_key');
      localStorage.removeItem('aeropulse_garmin_bearer_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_token');
      localStorage.removeItem('aeropulse_garmin_oauth1_secret');
      localStorage.removeItem('aeropulse_garmin_athlete_name');
    } catch {
      // ignore
    }
    await fetch('/api/garmin/disconnect', {
      method: 'POST',
      credentials: 'include',
      headers: getSavedIntervalsHeaders(),
    }).catch(() => null);
    await fetchServerConfigStatus();
  };

  const handleUpdateStravaSyncPolicy = async (
    windowChoice: StravaSyncWindow,
    importProfileAndGear = true
  ): Promise<StravaSyncPolicy | null> => {
    setSyncError(null);
    const resp = await fetch('/api/strava/sync-policy', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ window: windowChoice, importProfileAndGear }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Could not update Strava sync preference.');
      return null;
    }
    if (data.stravaSyncPolicy) {
      setConnectionStatus((prev) => ({
        ...prev,
        stravaSyncPolicy: data.stravaSyncPolicy,
      }));
      if (windowChoice !== 'none') {
        void syncLiveTelemetry(windowChoice === 'all', windowChoice);
      }
      return data.stravaSyncPolicy as StravaSyncPolicy;
    }
    return null;
  };

  const handleClearPersistedArchive = async () => {
    await clearPersistedTelemetrySnapshot();
    setIdbSavedAt(null);
    activitiesRef.current = [];
    wellnessDaysRef.current = [];
    await syncLiveTelemetry(true);
  };

  const handleSaveStravaCredentials = async (clientId: string, clientSecret: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/credentials', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to save Strava credentials');
      return;
    }
    try {
      if (clientId.trim()) localStorage.setItem('aeropulse_strava_client_id', clientId.trim());
      if (clientSecret.trim())
        localStorage.setItem('aeropulse_strava_client_secret', clientSecret.trim());
    } catch {
      // ignore
    }
    await fetchServerConfigStatus();
  };

  const handleLaunchStravaOAuth = async (
    mode: 'cloud' | 'localhost' = 'cloud',
    joinContext?: StravaOAuthJoinContext,
    forcePrompt = false
  ) => {
    setSyncError(null);
    if (forcePrompt && !hasEnteredWorkspaceRef.current) {
      try {
        localStorage.removeItem('aeropulse_auth_gate_passed');
      } catch {
        // ignore
      }
    }
    const oauthState =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    // Open centered Strava OAuth popup synchronously inside the user click gesture on desktop
    // (falls back automatically to top-level navigation on mobile phones, installed PWAs, or if blocked).
    const isStandalonePwa =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any)?.standalone);
    const isMobileViewport =
      window.innerWidth < 680 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const shouldUsePopup = mode === 'localhost' || (!isStandalonePwa && !isMobileViewport);

    let popup: Window | null = null;
    if (shouldUsePopup) {
      const width = 600;
      const height = 740;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      popup = window.open(
        'about:blank',
        'strava_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (popup) {
        try {
          popup.document.open();
          popup.document.write(
            '<!doctype html><html><head><title>Connecting to Strava…</title></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0C1D14;color:#F8FAFC;font-family:system-ui,sans-serif;text-align:center;"><div style="padding:28px 32px;border-radius:16px;background:#111915;border:2px solid #25573A;"><div style="font-weight:700;font-size:16px;color:#FC4C02;margin-bottom:6px;">Connecting to Strava…</div><div style="font-size:13px;color:#CBD5E1;">Opening secure Strava authorization…</div></div></body></html>'
          );
          popup.document.close();
        } catch {
          // ignore cross-document write edge cases
        }
      }
    }

    try {
      const prompt =
        forcePrompt || (hasEnteredWorkspaceRef.current && !isSessionLoggedOut) ? 'force' : 'auto';
      const authQs = new URLSearchParams({
        origin: window.location.origin,
        mode,
        flow: popup && !popup.closed ? 'popup' : 'redirect',
        prompt,
        state: oauthState,
      });
      if (joinContext?.joinCode) authQs.set('joinCode', joinContext.joinCode);
      if (joinContext?.slug) authQs.set('slug', joinContext.slug);
      if (joinContext?.inviteToken) authQs.set('inviteToken', joinContext.inviteToken);

      const resp = await fetch(`/api/strava/auth/url?${authQs.toString()}`, {
        credentials: 'include',
        headers: getSavedIntervalsHeaders(),
      });
      const data = await safeParseResponseJson(resp);
      if (!resp.ok || !data?.url) {
        if (popup && !popup.closed) {
          try {
            popup.close();
          } catch {
            // ignore
          }
        }
        setSyncError(
          data?.error ||
            'Strava sign-in is temporarily unavailable on this server. Ask your administrator to configure STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.'
        );
        return;
      }

      const pollStateToken = String(data.state || oauthState);

      if (popup && !popup.closed) {
        popup.location.replace(data.url);
        popup.focus();

        // Poll /api/strava/auth/poll alongside postMessage & BroadcastChannel for cross-browser resilience
        if (mode === 'cloud') {
          let attempts = 0;
          const pollTimer = window.setInterval(async () => {
            attempts += 1;
            if (attempts > 90 || (popup && popup.closed && attempts > 3)) {
              window.clearInterval(pollTimer);
              return;
            }
            try {
              const pollResp = await fetch(
                `/api/strava/auth/poll?state=${encodeURIComponent(pollStateToken)}`,
                { credentials: 'include', headers: getSavedIntervalsHeaders() }
              );
              if (!pollResp.ok) return;
              const pollData = await pollResp.json();
              if (pollData?.completed && pollData.tokens) {
                window.clearInterval(pollTimer);
                try {
                  if (popup && !popup.closed) popup.close();
                } catch {
                  // ignore
                }
                await completeStravaAuthHandshake({
                  tokens: pollData.tokens,
                  sessionToken: pollData.sessionToken,
                  hasExistingSyncPolicy: pollData.hasExistingSyncPolicy,
                });
              }
            } catch {
              // ignore transient poll errors
            }
          }, 1200);
        }
        return;
      }

      // Fallback when on mobile, standalone PWA, or when popup opening was blocked
      window.location.assign(data.url);
    } catch (err) {
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          // ignore
        }
      }
      setSyncError(err instanceof Error ? err.message : 'Failed to start Strava OAuth sign-in.');
    }
  };

  const handleExchangeStravaCode = async (codeOrUrl: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/exchange-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ code: codeOrUrl }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to exchange Strava authorization code.');
      throw new Error(data.error || 'Failed to exchange Strava authorization code.');
    }
    await completeStravaAuthHandshake({
      tokens: {
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        clientId: data.clientId,
        athleteId: data.athleteId,
        athleteName: data.athleteName,
        weightKg: data.weightKg,
        ftp: data.ftp,
        measurementPreference: data.measurementPreference,
        grantedScope: data.grantedScope,
      },
      sessionToken: data.sessionToken,
      hasExistingSyncPolicy: data.hasExistingSyncPolicy,
    });
  };

  const handleSaveStravaDirectToken = async (refreshToken: string, accessToken?: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ refreshToken, accessToken }),
    });
    const data = await safeParseResponseJson(resp);
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Strava token.');
      throw new Error(data.error || 'Failed to connect Strava token.');
    }
    await completeStravaAuthHandshake({
      tokens: {
        refreshToken: data.refreshToken,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        clientId: data.clientId,
        athleteId: data.athleteId,
        athleteName: data.athleteName,
        weightKg: data.weightKg,
        ftp: data.ftp,
        measurementPreference: data.measurementPreference,
        grantedScope: data.grantedScope,
      },
      sessionToken: data.sessionToken,
      hasExistingSyncPolicy: data.hasExistingSyncPolicy,
    });
  };

  const handleSaveMapTileConfig = async (provider: MapTileProvider, apiKey: string) => {
    setSyncError(null);
    const cleanKey = apiKey.trim();
    try {
      localStorage.setItem('aeropulse_map_tile_provider', provider);
      if (cleanKey) {
        localStorage.setItem('aeropulse_map_tile_api_key', cleanKey);
      } else {
        localStorage.removeItem('aeropulse_map_tile_api_key');
      }
    } catch {
      // ignore
    }
    await fetch('/api/map/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ provider, apiKey: cleanKey }),
    });
    setConnectionStatus((prev) => ({
      ...prev,
      mapTileProvider: provider,
      mapTileApiKeyConfigured: Boolean(cleanKey),
      mapTileApiKey: cleanKey || undefined,
    }));
    window.dispatchEvent(new CustomEvent('aeropulse-map-config-updated'));
  };

  const handleSaveGeminiApiKey = async (apiKey: string) => {
    const cleanKey = apiKey.trim();
    try {
      if (cleanKey) {
        localStorage.setItem('aeropulse_gemini_api_key', cleanKey);
      } else {
        localStorage.removeItem('aeropulse_gemini_api_key');
      }
    } catch {
      // ignore
    }
    try {
      const resp = await fetch('/api/gemini/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({ apiKey: cleanKey }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setConnectionStatus((prev) => ({
          ...prev,
          hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        }));
        return;
      }
    } catch {
      // ignore
    }
    setConnectionStatus((prev) => ({
      ...prev,
      hasGeminiServerKey: Boolean(cleanKey),
    }));
  };

  const handleExportConnectionBundle = async (): Promise<{
    bundle: string;
    envText: string;
  } | null> => {
    try {
      const resp = await fetch('/api/config/export-bundle', {
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return { bundle: data.bundle, envText: data.envText };
    } catch {
      return null;
    }
  };

  const handleImportConnectionBundle = async (bundleOrEnv: string) => {
    setSyncError(null);
    const resp = await fetch('/api/config/import-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ bundle: bundleOrEnv }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to import Connection Bundle.');
      throw new Error(data.error || 'Failed to import Connection Bundle.');
    }
    const creds = data.credentials || {};
    try {
      if (creds.intervalsApiKey)
        localStorage.setItem('aeropulse_intervals_api_key', creds.intervalsApiKey);
      if (creds.intervalsAthleteId)
        localStorage.setItem('aeropulse_intervals_athlete_id', creds.intervalsAthleteId);
      if (creds.stravaClientId)
        localStorage.setItem('aeropulse_strava_client_id', creds.stravaClientId);
      if (creds.stravaClientSecret)
        localStorage.setItem('aeropulse_strava_client_secret', creds.stravaClientSecret);
      if (creds.stravaRefreshToken)
        localStorage.setItem('aeropulse_strava_refresh_token', creds.stravaRefreshToken);
      if (creds.stravaAccessToken)
        localStorage.setItem('aeropulse_strava_access_token', creds.stravaAccessToken);
      if (creds.mapTileApiKey)
        localStorage.setItem('aeropulse_map_tile_api_key', creds.mapTileApiKey);
      if (creds.mapTileProvider)
        localStorage.setItem('aeropulse_map_tile_provider', creds.mapTileProvider);
      if (creds.geminiApiKey)
        localStorage.setItem('aeropulse_gemini_api_key', creds.geminiApiKey);
      localStorage.removeItem('aeropulse_logged_out');
      localStorage.setItem('aeropulse_auth_gate_passed', '1');
      window.dispatchEvent(new CustomEvent('aeropulse-map-config-updated'));
    } catch {
      // ignore
    }
    setIsSessionLoggedOut(false);
    setHasEnteredWorkspace(true);
    await syncLiveTelemetry(true);
  };

  const [isScanningSegments, setIsScanningSegments] = useState(false);
  const [isHydratingRoutes, setIsHydratingRoutes] = useState(false);

  const reRankActivitiesSegments = useCallback((list: UnifiedActivity[]): UnifiedActivity[] => {
    const bySeg = new Map<string, { actIdx: number; effIdx: number; elapsedTimeSecs: number }[]>();
    list.forEach((act, actIdx) => {
      if (!Array.isArray(act.segmentEfforts)) return;
      act.segmentEfforts.forEach((eff, effIdx) => {
        if (!eff || !eff.segmentId || !(eff.elapsedTimeSecs > 0)) return;
        const sid = String(eff.segmentId);
        const arr = bySeg.get(sid) || [];
        arr.push({ actIdx, effIdx, elapsedTimeSecs: eff.elapsedTimeSecs });
        bySeg.set(sid, arr);
      });
    });

    const rankLookup = new Map<string, 1 | 2 | 3 | null>();
    for (const arr of bySeg.values()) {
      arr.sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
      arr.forEach((item, idx) => {
        const key = `${item.actIdx}:${item.effIdx}`;
        rankLookup.set(key, idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null);
      });
    }

    return list.map((act, actIdx) => {
      if (!Array.isArray(act.segmentEfforts) || act.segmentEfforts.length === 0) return act;
      const updatedEfforts = act.segmentEfforts.map((eff, effIdx) => ({
        ...eff,
        prRank: rankLookup.get(`${actIdx}:${effIdx}`) ?? eff.prRank ?? null,
      }));
      const prCount = updatedEfforts.filter((e) => e.prRank === 1).length;
      return {
        ...act,
        segmentEfforts: updatedEfforts,
        stravaPrCount: Math.max(act.stravaPrCount || 0, prCount),
      };
    });
  }, []);

  const handleScanMoreSegments = useCallback(async () => {
    setIsScanningSegments(true);
    try {
      const resp = await fetch('/api/segments/scan-more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      });
      if (resp.ok) {
        const data = await resp.json();
        const segMap = (data.segmentsByActivity || {}) as Record<string, any[]>;
        const routesMap = (data.routesByActivity || {}) as Record<string, [number, number][]>;
        setActivities((prev) => {
          const merged = prev.map((act) => {
            const key = act.intervalsId || act.id;
            const foundSegs = segMap[key] || segMap[act.id];
            const foundRoute = routesMap[key] || routesMap[act.id];
            return {
              ...act,
              segmentEfforts:
                Array.isArray(foundSegs) && foundSegs.length > 0 ? foundSegs : act.segmentEfforts,
              routeLatLngs:
                Array.isArray(foundRoute) && foundRoute.length > 2
                  ? foundRoute
                  : act.routeLatLngs,
            };
          });
          return reRankActivitiesSegments(merged);
        });
      }
    } catch {
      // ignore error
    } finally {
      setIsScanningSegments(false);
    }
  }, [reRankActivitiesSegments]);

  const handleHydrateMoreRoutes = useCallback(async () => {
    setIsHydratingRoutes(true);
    try {
      const uncachedOutdoorIds = activitiesRef.current
        .filter(
          (a) =>
            a.environment === 'OUTDOOR' &&
            a.distanceMeters > 500 &&
            (!Array.isArray(a.routeLatLngs) || a.routeLatLngs.length < 2) &&
            (!a.streams?.latlng || a.streams.latlng.length < 2) &&
            Boolean(a.intervalsId || a.id)
        )
        .slice(0, 32)
        .map((a) => String(a.intervalsId || a.id));

      const resp = await fetch('/api/activities/hydrate-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({ activityIds: uncachedOutdoorIds }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const routesMap = (data.routesByActivity || {}) as Record<string, [number, number][]>;
        setActivities((prev) =>
          prev.map((act) => {
            const key = act.intervalsId || act.id;
            const foundRoute = routesMap[key] || routesMap[act.id];
            if (Array.isArray(foundRoute) && foundRoute.length > 2) {
              return {
                ...act,
                routeLatLngs: foundRoute,
                startLatLng: foundRoute[0],
                endLatLng: foundRoute[foundRoute.length - 1],
              };
            }
            return act;
          })
        );
      }
    } catch {
      // ignore
    } finally {
      setIsHydratingRoutes(false);
    }
  }, []);

  const handleToggleActivityKudos = useCallback(async (activity: UnifiedActivity) => {
    const key = activity.stravaId || activity.intervalsId || activity.id;
    try {
      const resp = await fetch(`/api/activities/${encodeURIComponent(key)}/kudos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({ action: 'toggle_kudos' }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setActivities((prev) =>
          prev.map((a) => {
            if (a.id !== activity.id) return a;
            const updated: UnifiedActivity = {
              ...a,
              hasKudoed: Boolean(data.hasKudoed),
              kudosCount: typeof data.kudosCount === 'number' ? data.kudosCount : a.kudosCount,
              kudoers: Array.isArray(data.kudoers) ? data.kudoers : a.kudoers,
            };
            setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
            return updated;
          })
        );
      }
    } catch {
      // ignore
    }
  }, []);

  const handleAddActivityComment = useCallback(
    async (activity: UnifiedActivity, commentText: string, authorName?: string) => {
      if (!commentText.trim()) return;
      const key = activity.stravaId || activity.intervalsId || activity.id;
      try {
        const resp = await fetch(`/api/activities/${encodeURIComponent(key)}/kudos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
          body: JSON.stringify({
            action: 'add_comment',
            commentText: commentText.trim(),
            authorName: authorName || connectionStatus.stravaAthleteName || 'Athlete',
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setActivities((prev) =>
            prev.map((a) => {
              if (a.id !== activity.id) return a;
              const updated: UnifiedActivity = {
                ...a,
                comments: Array.isArray(data.comments) ? data.comments : a.comments,
                commentCount: Array.isArray(data.comments)
                  ? data.comments.length
                  : (a.commentCount || 0) + 1,
              };
              setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
              return updated;
            })
          );
        }
      } catch {
        // ignore
      }
    },
    [connectionStatus.stravaAthleteName]
  );

  // Load real streams + auto-detected intervals + Strava segment efforts + GPS route for any activity
  const loadStreamsForActivity = useCallback(
    async (activity: UnifiedActivity) => {
      // 1. Check Dexie.js activityStreams table first for high-frequency 1Hz stream cache
      const cachedDexieRecord = await getActivityStreamFromDexie(activity.id);
      const cachedDexieStream = cachedDexieRecord?.streams;
      if (
        cachedDexieStream &&
        Array.isArray(cachedDexieStream.time) &&
        cachedDexieStream.time.length >= 60 &&
        (!activity.streams || activity.streams.time.length < cachedDexieStream.time.length)
      ) {
        setActivities((prev) =>
          prev.map((a) => (a.id === activity.id ? { ...a, streams: cachedDexieStream } : a))
        );
        setSelectedActivity((curr) =>
          curr && curr.id === activity.id ? { ...curr, streams: cachedDexieStream } : curr
        );
      }

      if (
        activity.streams &&
        activity.streams.time.length >= 60 &&
        activity.segmentEfforts &&
        activity.segmentEfforts.length > 0 &&
        (activity.environment === 'INDOOR' ||
          (activity.streams.latlng && activity.streams.latlng.length > 2))
      ) {
        return;
      }
      const headers = getSavedIntervalsHeaders();
      try {
        if (connectionStatus.intervalsConnected && activity.intervalsId) {
          const resp = await fetch(
            `/api/intervals/activities/${encodeURIComponent(activity.intervalsId)}/streams`,
            { headers }
          );
          if (resp.ok) {
            const payload = await resp.json();
            const streams = payload.streams || payload;
            const intervals = Array.isArray(payload.intervals) ? payload.intervals : undefined;
            const segmentEfforts = Array.isArray(payload.segmentEfforts)
              ? payload.segmentEfforts
              : undefined;
            if (
              (streams && Array.isArray(streams.time) && streams.time.length > 0) ||
              (segmentEfforts && segmentEfforts.length > 0)
            ) {
              if (streams && Array.isArray(streams.time) && streams.time.length > 0) {
                void saveActivityStreamToDexie(activity.id, streams);
              }
              setActivities((prev) => {
                const updated = prev.map((a) =>
                  a.id === activity.id
                    ? {
                        ...a,
                        streams:
                          streams && Array.isArray(streams.time) && streams.time.length > 0
                            ? streams
                            : a.streams,
                        routeLatLngs:
                          streams && Array.isArray(streams.latlng) && streams.latlng.length > 2
                            ? streams.latlng
                            : a.routeLatLngs,
                        intervals: intervals || a.intervals,
                        segmentEfforts:
                          segmentEfforts && segmentEfforts.length > 0
                            ? segmentEfforts
                            : a.segmentEfforts,
                      }
                    : a
                );
                const ranked = reRankActivitiesSegments(updated);
                const latestAct = ranked.find((a) => a.id === activity.id);
                if (latestAct) {
                  setSelectedActivity((curr) =>
                    curr && curr.id === activity.id ? latestAct : curr
                  );
                }
                return ranked;
              });
              return;
            }
          }
        }

        if (connectionStatus.stravaConnected && activity.stravaId) {
          const resp = await fetch(
            `/api/strava/activities/${encodeURIComponent(activity.stravaId)}/streams`,
            { headers }
          );
          if (resp.ok) {
            const payload = await resp.json();
            const streams = payload.streams || payload;
            const segmentEfforts = Array.isArray(payload.segmentEfforts)
              ? payload.segmentEfforts
              : undefined;
            if (
              (streams && Array.isArray(streams.time) && streams.time.length > 0) ||
              (segmentEfforts && segmentEfforts.length > 0)
            ) {
              if (streams && Array.isArray(streams.time) && streams.time.length > 0) {
                void saveActivityStreamToDexie(activity.id, streams);
              }
              setActivities((prev) => {
                const updated = prev.map((a) =>
                  a.id === activity.id
                    ? {
                        ...a,
                        streams:
                          streams && Array.isArray(streams.time) && streams.time.length > 0
                            ? streams
                            : a.streams,
                        routeLatLngs:
                          streams && Array.isArray(streams.latlng) && streams.latlng.length > 2
                            ? streams.latlng
                            : a.routeLatLngs,
                        segmentEfforts:
                          segmentEfforts && segmentEfforts.length > 0
                            ? segmentEfforts
                            : a.segmentEfforts,
                      }
                    : a
                );
                const ranked = reRankActivitiesSegments(updated);
                const latestAct = ranked.find((a) => a.id === activity.id);
                if (latestAct) {
                  setSelectedActivity((curr) =>
                    curr && curr.id === activity.id ? latestAct : curr
                  );
                }
                return ranked;
              });
              return;
            }
          }
        }

        // 2. Offline / Sandbox fallback: upsample & compute 1Hz telemetry stream on the Web Worker thread
        if (!activity.streams || activity.streams.time.length < 60) {
          const { streams: workerStreams, analytics } =
            await upsampleAndAnalyzeActivityInWorker(activity);
          setActivities((prev) =>
            prev.map((a) =>
              a.id === activity.id
                ? {
                    ...a,
                    streams: workerStreams,
                    intervals:
                      a.intervals && a.intervals.length > 0 ? a.intervals : analytics.intervals,
                  }
                : a
            )
          );
          setSelectedActivity((curr) =>
            curr && curr.id === activity.id
              ? {
                  ...curr,
                  streams: workerStreams,
                  intervals:
                    curr.intervals && curr.intervals.length > 0
                      ? curr.intervals
                      : analytics.intervals,
                }
              : curr
          );
        }
      } catch {
        // Fallback handled in view if stream endpoint unavailable
      }
    },
    [connectionStatus.intervalsConnected, connectionStatus.stravaConnected, reRankActivitiesSegments]
  );

  // Load real streams + auto-detected intervals + Strava segments when selecting an activity
  const handleSelectActivity = async (activity: UnifiedActivity | null) => {
    setSelectedActivity(activity);
    if (activity) {
      await loadStreamsForActivity(activity);
      if (activity.stravaId) {
        try {
          const resp = await fetch(
            `/api/strava/activities/${encodeURIComponent(activity.stravaId)}/kudos`,
            { headers: getSavedIntervalsHeaders() }
          );
          if (resp.ok) {
            const kData = await resp.json();
            setActivities((prev) =>
              prev.map((a) => {
                if (a.id !== activity.id) return a;
                const updated: UnifiedActivity = {
                  ...a,
                  hasKudoed: kData.hasKudoed ?? a.hasKudoed,
                  kudosCount: Math.max(a.kudosCount || 0, (kData.kudoers || []).length),
                  kudoers:
                    Array.isArray(kData.kudoers) && kData.kudoers.length > 0
                      ? kData.kudoers
                      : a.kudoers,
                  comments:
                    Array.isArray(kData.comments) && kData.comments.length > 0
                      ? kData.comments
                      : a.comments,
                };
                setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
                return updated;
              })
            );
          }
        } catch {
          // ignore
        }
      }
    }
  };

  // Multi-Team Brand Resolution & Cloud Teammate Projection
  const activeTeam = useMemo(
    () =>
      (activeTeamId && myTeams.find((t) => t.brand.teamId === activeTeamId)) || null,
    [myTeams, activeTeamId]
  );

  const handleSelectActiveTeam = useCallback((nextId: string | null) => {
    setActiveTeamId(nextId);
    try {
      if (nextId) localStorage.setItem('thresh_active_team_id_v1', nextId);
      else localStorage.removeItem('thresh_active_team_id_v1');
    } catch {
      // ignore
    }
  }, []);

  const handleTeamsUpdated = useCallback(
    (nextTeams: TeamSummaryWithRole[], nextActiveId?: string) => {
      setMyTeams(nextTeams);
      try {
        localStorage.setItem('thresh_my_teams_v1', JSON.stringify(nextTeams));
      } catch {
        // ignore
      }
      if (nextActiveId !== undefined) {
        handleSelectActiveTeam(nextActiveId);
      } else if (!activeTeamId && nextTeams.length > 0) {
        handleSelectActiveTeam(nextTeams[0].brand.teamId);
      }
    },
    [activeTeamId, handleSelectActiveTeam]
  );

  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut) return;
    applyTeamBrandToDocument(activeTeam?.brand || null);
  }, [activeTeam, hasEnteredWorkspace, isSessionLoggedOut]);

  // Hydrate Multi-Team memberships from server & detect `/join/<slug>` for already-logged-in athletes
  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut) return;
    let cancelled = false;
    (async () => {
      try {
        const origin = encodeURIComponent(window.location.origin);
        const resp = await fetch(`/api/teams/mine?origin=${origin}`, {
          credentials: 'include',
          headers: getSavedIntervalsHeaders(),
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (typeof data.resendConfigured === 'boolean') {
          setResendConfigured(data.resendConfigured);
        }
        if (Array.isArray(data.teams)) {
          setMyTeams(data.teams);
          try {
            localStorage.setItem('thresh_my_teams_v1', JSON.stringify(data.teams));
          } catch {
            // ignore
          }
          if (!activeTeamId && data.teams.length > 0) {
            handleSelectActiveTeam(data.teams[0].brand.teamId);
          }
        }
      } catch {
        // offline fallback uses cached thresh_my_teams_v1
      }
    })();

    // Check if an already-signed-in user opened a second team's Magic Join URL
    const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
    const qs = new URLSearchParams(window.location.search);
    const codeOrSlug = pathMatch
      ? decodeURIComponent(pathMatch[1])
      : (qs.get('join') || '').trim();
    const token = qs.get('t') || qs.get('token') || undefined;
    if (codeOrSlug) {
      const previewQs = new URLSearchParams({ codeOrSlug });
      if (token) previewQs.set('t', token);
      fetch(`/api/teams/join-preview?${previewQs.toString()}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((prev) => {
          if (!cancelled && prev?.found && prev?.brand) {
            setPendingUrlJoinOffer({
              codeOrSlug,
              token,
              teamName: prev.brand.name,
              shortName: prev.brand.shortName || prev.brand.name,
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [hasEnteredWorkspace, isSessionLoggedOut]);

  const cloudTeamRosterAthletes = useMemo<ConnectedAthleteRecord[]>(() => {
    if (!activeTeam) return [];
    const isCoach =
      activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ASSISTANT_COACH';
    const todayIso = new Date().toISOString().slice(0, 10);

    return activeTeam.memberships
      .filter(
        (m) => m.status === 'ACTIVE' && m.membershipId !== activeTeam.myMembershipId
      )
      .map((m) => {
        const snap = m.liveSnapshot;
        const hideWeight = Boolean(
          activeTeam.brand.defaultSafeSportShield ||
            m.isMinorU18 ||
            snap?.safeSportHideWeight
        );
        const initials = m.invitedName
          .split(/\s+/)
          .filter(Boolean)
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || 'TM';
        const hasRealSummaryLoad = Boolean(
          snap && (snap.ctl > 0 || snap.atl > 0 || snap.acuteLoad7d > 0)
        );
        const fallbackWellness: UnifiedWellnessDay[] =
          snap?.wellnessDays && snap.wellnessDays.length > 0
            ? snap.wellnessDays
            : hasRealSummaryLoad && snap
              ? [
                  {
                    date: todayIso,
                    ctl: snap.ctl,
                    atl: snap.atl,
                    tsb: snap.tsb,
                    rampRate: 0,
                    dailyLoad: Math.round((snap.acuteLoad7d || 0) / 7),
                    restingHR: 0,
                    hrvRMSSD: 0,
                    hrvBaseline7d: 0,
                    hrvStatus: 'Balanced',
                    sleepSecs: 0,
                    sleepScore: 0,
                    weightKg: 0,
                    readinessStatus:
                      snap.readinessScore < 60
                        ? 'Strain'
                        : snap.readinessScore < 75
                          ? 'Caution'
                          : 'Optimal',
                  },
                ]
              : [];
        const prof = buildCompleteAthleteProfile({
          name: m.invitedName,
          ftp: snap?.ftpWatts || 250,
          thresholdPaceSecsPerKm: snap?.thresholdPaceSecsPerKm || 255,
          safeSportHideWeight: hideWeight,
        });

        const squadBroadcasts: PlannedWorkoutEvent[] = (
          activeTeam.broadcastWorkouts || []
        )
          .filter(
            (bw) =>
              bw.targetSquadGroup === 'ALL' ||
              bw.targetSquadGroup === m.squadGroup ||
              (Array.isArray(bw.targetMembershipIds) &&
                bw.targetMembershipIds.includes(m.membershipId))
          )
          .map((bw) => ({
            id: bw.broadcastId,
            date: bw.date,
            name: bw.name,
            sportCategory: bw.sportCategory,
            environmentPreference: 'FLEXIBLE',
            description: bw.description,
            plannedLoad: bw.plannedLoad,
            plannedDurationSecs: bw.plannedDurationSecs,
            targetZoneSummary: `${activeTeam.brand.shortName} Squad Session`,
            workoutSyntax: bw.workoutSyntax,
            source: 'USER',
          }));

        return {
          id: `team-mem-${m.membershipId}`,
          stravaAthleteId: m.stravaAthleteId || m.squadGroup.toUpperCase().slice(0, 8),
          inviteCode: activeTeam.brand.joinCode,
          name: m.invitedName,
          avatarInitials: initials,
          location: `${activeTeam.brand.shortName} · ${m.squadGroup}`,
          primarySport:
            activeTeam.brand.primarySport === 'Cycling' ? 'Cycling' : 'Running',
          role: isCoach ? 'COACH_EDIT' : 'FRIEND_VIEW',
          status: 'CONNECTED',
          connectedSince: (m.joinedAt || m.invitedAt).slice(0, 10),
          primaryGoalSummary: snap?.verdictLabel || `${m.squadGroup} Roster`,
          caraHours7d: snap?.caraHours7d,
          privacySettings: {
            sharePmcAndZones: m.sharingTier === 'LOAD_ONLY' ? 'COACHES_ONLY' : 'ALL_CONNECTIONS',
            shareWellnessAndHrv:
              m.sharingTier === 'LOAD_ONLY'
                ? 'PRIVATE'
                : isCoach
                  ? 'ALL_CONNECTIONS'
                  : 'COACHES_ONLY',
            shareGpsRoutes: m.sharingTier === 'FULL_STREAMS' ? 'COACHES_ONLY' : 'PRIVATE',
            stravaComplianceShield: m.sharingTier !== 'FULL_STREAMS',
            allowCoachCalendarEdits: true,
          },
          athleteProfile: prof,
          wellnessDays: fallbackWellness,
          activities: snap?.activities || [],
          plannedEvents: squadBroadcasts,
          targetGoals: [],
        };
      });
  }, [activeTeam]);

  const combinedRoster = useMemo(
    () => (myTeams.length > 0 ? cloudTeamRosterAthletes : connectedAthletes),
    [myTeams.length, cloudTeamRosterAthletes, connectedAthletes]
  );

  // Multi-Athlete Context Resolution & Privacy Shield Enforcement
  const activeConnectedAthlete = useMemo(
    () =>
      activeViewedAthleteId === 'SELF'
        ? null
        : combinedRoster.find((a) => a.id === activeViewedAthleteId) || null,
    [activeViewedAthleteId, combinedRoster]
  );

  // Calendar Planned Workout Creation & Deletion (syncs to Intervals.icu + local state + COACH_EDIT roster + Cloud Team Broadcast)
  const handleCreatePlannedEvent = async (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    replaceExistingDate?: boolean;
  }) => {
    if (activeConnectedAthlete) {
      if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
        triggerReadOnlyAlert(activeConnectedAthlete.name, 'schedule workouts');
        return;
      }
      if (activeConnectedAthlete.id.startsWith('team-mem-') && activeTeam) {
        const targetMemId = activeConnectedAthlete.id.replace(/^team-mem-/, '');
        try {
          const resp = await fetch(
            `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...getSavedIntervalsHeaders(),
              },
              body: JSON.stringify({
                origin: window.location.origin,
                targetSquadGroup: 'INDIVIDUAL',
                targetMembershipIds: [targetMemId],
                date: eventInput.date,
                name: eventInput.name,
                sportCategory:
                  eventInput.sportCategory === 'Cycling' ? 'Cycling' : 'Running',
                plannedDurationSecs: eventInput.plannedDurationSecs,
                plannedLoad: eventInput.plannedLoad,
                workoutSyntax: eventInput.workoutSyntax,
                description: eventInput.description,
              }),
            }
          );
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data.teams)) {
              handleTeamsUpdated(data.teams, activeTeam.brand.teamId);
            }
            return;
          }
        } catch {
          // fall through to local state if offline
        }
      }
      const coachEvt: PlannedWorkoutEvent = {
        id: `coach-evt-${Date.now()}`,
        date: eventInput.date,
        name: eventInput.name,
        sportCategory: eventInput.sportCategory,
        environmentPreference: eventInput.environmentPreference,
        description: eventInput.description,
        plannedLoad: eventInput.plannedLoad,
        plannedDurationSecs: eventInput.plannedDurationSecs,
        targetZoneSummary: 'Coach Prescribed Session',
        workoutSyntax: eventInput.workoutSyntax,
        source: 'USER',
      };
      setConnectedAthletes((prev) =>
        prev.map((a) => {
          if (a.id !== activeConnectedAthlete.id) return a;
          const base = eventInput.replaceExistingDate
            ? a.plannedEvents.filter(
                (e) =>
                  !(
                    e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                    e.sportCategory === eventInput.sportCategory
                  )
              )
            : a.plannedEvents;
          return {
            ...a,
            plannedEvents: [...base, coachEvt].sort((x, y) => x.date.localeCompare(y.date)),
          };
        })
      );
      return;
    }

    try {
      const resp = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getSavedIntervalsHeaders(),
        },
        body: JSON.stringify(eventInput),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.event) {
          setPlannedEvents((prev) => {
            const base = eventInput.replaceExistingDate
              ? prev.filter(
                  (e) =>
                    !(
                      e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                      e.sportCategory === eventInput.sportCategory
                    )
                )
              : prev;
            return [...base, data.event];
          });
          return;
        }
      }
    } catch {
      // Fallback to local state
    }
    setPlannedEvents((prev) => {
      const base = eventInput.replaceExistingDate
        ? prev.filter(
            (e) =>
              !(
                e.date.slice(0, 10) === eventInput.date.slice(0, 10) &&
                e.sportCategory === eventInput.sportCategory
              )
          )
        : prev;
      return [
        ...base,
        {
          id: `local-${Date.now()}`,
          date: eventInput.date,
          name: eventInput.name,
          sportCategory: eventInput.sportCategory,
          environmentPreference: eventInput.environmentPreference,
          description: eventInput.description,
          plannedLoad: eventInput.plannedLoad,
          plannedDurationSecs: eventInput.plannedDurationSecs,
          targetZoneSummary: 'Structured Workout',
          workoutSyntax: eventInput.workoutSyntax,
        },
      ];
    });
  };

  const handleBatchCreatePlannedEvents = async (
    items: Array<{
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      description: string;
      plannedLoad: number;
      plannedDurationSecs: number;
      targetZoneSummary?: string;
      workoutSyntax: string;
      replaceExistingDate?: boolean;
    }>
  ) => {
    const nowTs = Date.now();
    const createdEvents = items.map((item, idx) => ({
      id: `plan-block-${nowTs}-${idx}`,
      date: item.date,
      name: item.name,
      sportCategory: item.sportCategory,
      environmentPreference: item.environmentPreference,
      description: item.description,
      plannedLoad: item.plannedLoad,
      plannedDurationSecs: item.plannedDurationSecs,
      targetZoneSummary: item.targetZoneSummary || 'Structured Workout',
      workoutSyntax: item.workoutSyntax,
    }));

    if (activeConnectedAthlete) {
      if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
        triggerReadOnlyAlert(activeConnectedAthlete.name, 'generate multi-week training plans');
        return;
      }
      const targetDates = new Set(items.map((i) => `${i.date.slice(0, 10)}:${i.sportCategory}`));
      setConnectedAthletes((prev) =>
        prev.map((a) => {
          if (a.id !== activeConnectedAthlete.id) return a;
          const filtered = a.plannedEvents.filter(
            (e) => !targetDates.has(`${e.date.slice(0, 10)}:${e.sportCategory}`)
          );
          return {
            ...a,
            plannedEvents: [...filtered, ...createdEvents].sort((x, y) =>
              x.date.localeCompare(y.date)
            ),
          };
        })
      );
      return;
    }

    setPlannedEvents((prev) => {
      const targetDates = new Set(items.map((i) => `${i.date.slice(0, 10)}:${i.sportCategory}`));
      const filtered = prev.filter(
        (e) => !targetDates.has(`${e.date.slice(0, 10)}:${e.sportCategory}`)
      );
      return [...filtered, ...createdEvents].sort((a, b) => a.date.localeCompare(b.date));
    });
  };

  // Sync Athlete Profile & Sport Zones on demand from Intervals.icu & Garmin
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
        setConnectedAthletes((prev) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id ? { ...a, athleteProfile: updatedProfile } : a
          )
        );
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
    [activeConnectedAthlete, triggerReadOnlyAlert]
  );

  const handleDeletePlannedEvent = async (id: string) => {
    if (activeConnectedAthlete) {
      if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
        triggerReadOnlyAlert(activeConnectedAthlete.name, 'delete planned workouts');
        return;
      }
      setConnectedAthletes((prev) =>
        prev.map((a) =>
          a.id === activeConnectedAthlete.id
            ? { ...a, plannedEvents: a.plannedEvents.filter((e) => e.id !== id) }
            : a
        )
      );
      return;
    }

    setPlannedEvents((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getSavedIntervalsHeaders(),
      });
    } catch {
      // ignore
    }
  };

  // Import watchless Official FAT Race Results into activities archive & IndexedDB
  const handleImportOfficialRaces = useCallback(
    (importedRaces: UnifiedActivity[]) => {
      if (!importedRaces || importedRaces.length === 0) return;
      if (activeConnectedAthlete) {
        if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
          triggerReadOnlyAlert(activeConnectedAthlete.name, 'import official race results');
          return;
        }
        setConnectedAthletes((prev) =>
          prev.map((a) =>
            a.id === activeConnectedAthlete.id
              ? { ...a, activities: mergeActivitiesNonDestructive(a.activities, importedRaces) }
              : a
          )
        );
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
    [activeConnectedAthlete, triggerReadOnlyAlert]
  );

  // Build concise physiological + Garmin Sleep/HRV + mileage telemetry payload for Gemini AI Coach
  const telemetrySummaryForGemini = useMemo(() => {
    const today = wellnessDays[wellnessDays.length - 1];
    const runGoal =
      annualMileageGoals.find((g) => g.sportCategory === 'Running')?.targetDistanceMeters ||
      2414016;
    const bikeGoal =
      annualMileageGoals.find((g) => g.sportCategory === 'Cycling')?.targetDistanceMeters ||
      8046720;
    const runSummary = computeAnnualMileageSummary('Running', runGoal, activities, envFilter);
    const bikeSummary = computeAnnualMileageSummary('Cycling', bikeGoal, activities, envFilter);

    return {
      todayWellness: today,
      garminHealthSummary: today
        ? {
            trainingStatus: today.garminTrainingStatus,
            trainingStatusReason: today.trainingStatusReason,
            sleepHours: (today.sleepSecs / 3600).toFixed(1),
            sleepScore: today.sleepScore,
            sleepDebtHours7d: ((today.sleepDebt7dSecs || 0) / 3600).toFixed(1),
            hrvRMSSD: today.hrvRMSSD,
            hrvStatus: today.hrvStatus,
            hrvNormalCorridor: `${today.hrvNormalBandLow || 44}-${today.hrvNormalBandHigh || 62} ms`,
            restingHR: today.restingHR,
            rideEftp: today.rideEftp,
            runEftp: today.runEftp,
            ctl: today.ctl,
            atl: today.atl,
            tsb: today.tsb,
          }
        : undefined,
      activeEnvironmentFilter: envFilter,
      runningAnnualMileage: {
        ytdCombined: formatDistance(runSummary.combinedTotalMeters, distanceUnit, 1),
        ytdOutdoor: formatDistance(runSummary.outdoorMeters, distanceUnit, 1),
        ytdIndoorTreadmill: formatDistance(runSummary.indoorMeters, distanceUnit, 1),
        annualTarget: formatDistance(runSummary.targetMeters, distanceUnit, 0),
        deltaVsSchedule: formatDistance(runSummary.deltaVsScheduleMeters, distanceUnit, 1),
      },
      cyclingAnnualMileage: {
        ytdCombined: formatDistance(bikeSummary.combinedTotalMeters, distanceUnit, 1),
        ytdOutdoor: formatDistance(bikeSummary.outdoorMeters, distanceUnit, 1),
        ytdIndoorSmartTrainer: formatDistance(bikeSummary.indoorMeters, distanceUnit, 1),
        annualTarget: formatDistance(bikeSummary.targetMeters, distanceUnit, 0),
        deltaVsSchedule: formatDistance(bikeSummary.deltaVsScheduleMeters, distanceUnit, 1),
      },
      recentWorkouts: activities.slice(0, 10).map((a) => ({
        date: a.startDateLocal.slice(0, 10),
        name: a.name,
        sport: a.sportCategory,
        environment: a.environment,
        subType: a.subType,
        distance: formatDistance(a.distanceMeters, distanceUnit, 1),
        durationMins: Math.round(a.movingTimeSecs / 60),
        load: a.trainingLoad,
        decouplingPct: a.aerobicDecouplingPct,
        npWatts: a.normalizedPower,
        avgHr: a.avgHr,
      })),
      upcomingPlannedWorkouts: plannedEvents.slice(0, 8),
      targetGoals,
      athleteProfile: {
        weightKg: athleteProfile.weightKg,
        restingHr: athleteProfile.restingHr,
        ftp: athleteProfile.ftp,
        indoorFtp: athleteProfile.indoorFtp,
        lthr: athleteProfile.lthr,
        maxHr: athleteProfile.maxHr,
        runFtp: athleteProfile.runFtp,
        powerZones: athleteProfile.powerZones,
        hrZones: athleteProfile.hrZones,
      },
    };
  }, [
    wellnessDays,
    annualMileageGoals,
    activities,
    envFilter,
    distanceUnit,
    plannedEvents,
    targetGoals,
    athleteProfile,
  ]);

  // Privacy Shield Enforcement for Connected Athletes

  const shieldedConnectedTelemetry = useMemo(
    () => (activeConnectedAthlete ? applyAthletePrivacyShield(activeConnectedAthlete) : null),
    [activeConnectedAthlete]
  );

  const effectiveWellnessDays = useMemo(
    () => (shieldedConnectedTelemetry ? shieldedConnectedTelemetry.wellnessDays : wellnessDays),
    [shieldedConnectedTelemetry, wellnessDays]
  );

  const effectiveActivities = useMemo(
    () => (shieldedConnectedTelemetry ? shieldedConnectedTelemetry.activities : activities),
    [shieldedConnectedTelemetry, activities]
  );

  const effectivePlannedEvents = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.plannedEvents;
    if (!activeTeam || !Array.isArray(activeTeam.broadcastWorkouts)) return plannedEvents;
    const teamEvents: PlannedWorkoutEvent[] = activeTeam.broadcastWorkouts
      .filter(
        (bw) =>
          bw.targetSquadGroup === 'ALL' ||
          bw.targetSquadGroup === activeTeam.mySquadGroup ||
          (Boolean(activeTeam.myMembershipId) &&
            Array.isArray(bw.targetMembershipIds) &&
            bw.targetMembershipIds.includes(activeTeam.myMembershipId))
      )
      .map((bw) => ({
        id: bw.broadcastId,
        date: bw.date,
        name: bw.name,
        sportCategory: bw.sportCategory,
        environmentPreference: 'FLEXIBLE',
        description: bw.description,
        plannedLoad: bw.plannedLoad,
        plannedDurationSecs: bw.plannedDurationSecs,
        targetZoneSummary: `${activeTeam.brand.shortName} Squad Session`,
        workoutSyntax: bw.workoutSyntax,
        source: 'USER',
      }));
    const existingIds = new Set(plannedEvents.map((e) => e.id));
    return [
      ...plannedEvents,
      ...teamEvents.filter((te) => !existingIds.has(te.id)),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [activeConnectedAthlete, plannedEvents, activeTeam]);

  const effectiveAthleteProfile = useMemo(() => {
    if (activeConnectedAthlete) return activeConnectedAthlete.athleteProfile;
    if (activeTeam?.brand.defaultSafeSportShield && !athleteProfile.safeSportHideWeight) {
      return { ...athleteProfile, safeSportHideWeight: true };
    }
    return athleteProfile;
  }, [activeConnectedAthlete, athleteProfile, activeTeam]);

  const effectiveTargetGoals = useMemo(
    () => (activeConnectedAthlete ? activeConnectedAthlete.targetGoals : targetGoals),
    [activeConnectedAthlete, targetGoals]
  );

  const selfLatestWellness = wellnessDays[wellnessDays.length - 1] || undefined;
  const latestWellness = effectiveWellnessDays[effectiveWellnessDays.length - 1] || undefined;

  // Debounced Clean-Room readiness & 7d productivity sync across joined teams
  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut || myTeams.length === 0) return;
    if (activities.length === 0 && wellnessDays.length === 0) return;

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
      const hasWatch = Boolean(
        connectionStatus.garminConnected ||
          connectionStatus.intervalsConnected ||
          activities.length > 0
      );
      fetch('/api/teams/sync-snapshot', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getSavedIntervalsHeaders(),
        },
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
              (
                recent7dActs.reduce((acc, a) => acc + (a.movingTimeSecs || 0), 0) / 3600
              ).toFixed(1)
            ),
            ftpWatts: athleteProfile.ftp,
            thresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm,
            safeSportHideWeight: Boolean(athleteProfile.safeSportHideWeight),
            wellnessDays: wellnessDays.slice(-14),
            activities: activities.slice(0, 14),
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
    hasEnteredWorkspace,
    isSessionLoggedOut,
    myTeams.length,
    activities.length,
    wellnessDays.length,
    athleteProfile.name,
    athleteProfile.ftp,
    athleteProfile.thresholdPaceSecsPerKm,
    athleteProfile.safeSportHideWeight,
    selfPrivacySettings,
    connectionStatus.garminConnected,
    connectionStatus.intervalsConnected,
  ]);
  const latestCtl = latestWellness?.ctl ?? 0;
  const latestWeightKg = effectiveAthleteProfile.weightKg || latestWellness?.weightKg || 70.0;
  const athleteFtp =
    effectiveAthleteProfile.ftp || connectionStatus.athleteFtp || latestWellness?.rideEftp || 250;

  // Close Account & Settings Menu on outside click or Escape key
  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  const primaryAthleteDisplayName = useMemo(() => {
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
    athleteProfile.name,
    connectionStatus.stravaAthleteName,
    connectionStatus.garminAthleteName,
    connectionStatus.intervalsAthleteName,
  ]);

  const primaryAthleteInitials = useMemo(() => {
    const parts = primaryAthleteDisplayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    return primaryAthleteDisplayName.slice(0, 2).toUpperCase() || 'AT';
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
    setIsAccountMenuOpen(false);
    setIsSessionLoggedOut(true);
    setHasEnteredWorkspace(false);
    hasEnteredWorkspaceRef.current = false;
    handledOAuthTokensRef.current.clear();
    const activeHeaders = getSavedIntervalsHeaders();
    try {
      localStorage.setItem('aeropulse_logged_out', '1');
      localStorage.removeItem('aeropulse_auth_gate_passed');
      localStorage.removeItem('aeropulse_calibrated_v1');
      localStorage.removeItem('aeropulse_session_token');
      localStorage.removeItem('aeropulse_strava_access_token');
      localStorage.removeItem('aeropulse_strava_refresh_token');
      localStorage.removeItem('aeropulse_strava_expires_at');
      localStorage.removeItem('aeropulse_strava_athlete_id');
      localStorage.removeItem('aeropulse_strava_athlete_name');
      localStorage.removeItem('aeropulse_strava_athlete_weight_kg');
      localStorage.removeItem('aeropulse_strava_athlete_ftp');
      localStorage.removeItem('aeropulse_store_owner_athlete_id');
      localStorage.removeItem('thresh_my_teams_v1');
      localStorage.removeItem('thresh_active_team_id_v1');
      sessionStorage.removeItem('thresh_pending_team_join_v1');
      if (clearAllVaultKeys) {
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
    const defaultProf = buildCompleteAthleteProfile(null);
    setAthleteProfile(defaultProf);
    athleteProfileRef.current = defaultProf;
    setRedactedStravaCount(0);
    redactedStravaCountRef.current = 0;
    setConnectionStatus((prev) => ({
      ...prev,
      mode: 'SANDBOX_CALIBRATION',
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
    await clearPersistedTelemetrySnapshot();
    setIdbSavedAt(null);
    await fetchServerConfigStatus();
  }, [fetchServerConfigStatus]);

  const handleLogoutSession = useCallback(() => {
    void resetClientWorkspaceStateOnLogout(false);
  }, [resetClientWorkspaceStateOnLogout]);

  const handleLogoutAndClearData = useCallback(async () => {
    await resetClientWorkspaceStateOnLogout(true);
  }, [resetClientWorkspaceStateOnLogout]);

  const handleApproveAthleteRequest = useCallback(
    (athleteId: string, role: 'COACH_EDIT' | 'FRIEND_VIEW') => {
      setConnectedAthletes((prev) =>
        prev.map((a) => (a.id === athleteId ? { ...a, role, status: 'CONNECTED' } : a))
      );
    },
    []
  );

  const handleRemoveOrDeclineAthlete = useCallback(
    (athleteId: string) => {
      setConnectedAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      setActiveViewedAthleteId((curr) => (curr === athleteId ? 'SELF' : curr));
    },
    []
  );

  const handleToggleAthleteRole = useCallback((athleteId: string) => {
    setConnectedAthletes((prev) =>
      prev.map((a) =>
        a.id === athleteId
          ? { ...a, role: a.role === 'COACH_EDIT' ? 'FRIEND_VIEW' : 'COACH_EDIT' }
          : a
      )
    );
  }, []);

  const handleAddFollowByInviteOrName = useCallback(
    (query: string, role: 'COACH_EDIT' | 'FRIEND_VIEW', specialty: 'Running' | 'Cycling') => {
      const clean = query.trim();
      if (!clean) return;
      const newRecord = createConnectedAthleteRecord(clean, role, specialty);
      setConnectedAthletes((prev) => [newRecord, ...prev]);
    },
    []
  );

  const handlePushCoachWorkout = useCallback(
    (
      athleteId: string,
      workout: {
        date: string;
        name: string;
        sportCategory: 'Running' | 'Cycling';
        plannedDurationSecs: number;
        plannedLoad: number;
        workoutSyntax: string;
        description: string;
      }
    ) => {
      if (athleteId.startsWith('team-mem-') && activeTeam) {
        const targetMemId = athleteId.replace(/^team-mem-/, '');
        fetch(`/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getSavedIntervalsHeaders(),
          },
          body: JSON.stringify({
            origin: window.location.origin,
            targetSquadGroup: 'INDIVIDUAL',
            targetMembershipIds: [targetMemId],
            date: workout.date,
            name: workout.name,
            sportCategory: workout.sportCategory,
            plannedDurationSecs: workout.plannedDurationSecs,
            plannedLoad: workout.plannedLoad,
            workoutSyntax: workout.workoutSyntax,
            description: workout.description,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.teams && Array.isArray(data.teams)) {
              handleTeamsUpdated(data.teams, activeTeam.brand.teamId);
            }
          })
          .catch(() => {});
        return;
      }
      const newEvt: PlannedWorkoutEvent = {
        id: `coach-push-${Date.now()}`,
        date: workout.date,
        name: workout.name,
        sportCategory: workout.sportCategory,
        environmentPreference: 'FLEXIBLE',
        description: workout.description,
        plannedLoad: workout.plannedLoad,
        plannedDurationSecs: workout.plannedDurationSecs,
        targetZoneSummary: 'Coach Prescribed Session',
        workoutSyntax: workout.workoutSyntax,
        source: 'USER',
      };
      setConnectedAthletes((prev) =>
        prev.map((a) =>
          a.id === athleteId
            ? {
                ...a,
                plannedEvents: [...a.plannedEvents, newEvt].sort((x, y) =>
                  x.date.localeCompare(y.date)
                ),
              }
            : a
        )
      );
    },
    [activeTeam, handleTeamsUpdated]
  );

  const [coachDraftPrompt, setCoachDraftPrompt] = useState('');
  const chatAbortRef = useRef<AbortController | null>(null);

  const buildClientCoachFallback = useCallback(
    (userText: string): Omit<CoachChatMessage, 'id' | 'role' | 'timestamp'> => {
      const hasAnyTelemetry = Boolean(latestWellness || effectiveActivities.length > 0);
      const ctl = latestWellness?.ctl ?? 0;
      const atl = latestWellness?.atl ?? 0;
      const tsb = latestWellness?.tsb ?? Number((ctl - atl).toFixed(1));
      const hrv = latestWellness?.hrvRMSSD ?? 0;
      const hrvStatus = latestWellness?.hrvStatus || 'Not synced';
      const sleepScore = latestWellness?.sleepScore ?? 0;
      const sleepHours = latestWellness?.sleepSecs
        ? Number((latestWellness.sleepSecs / 3600).toFixed(1))
        : 0;
      const ftp = effectiveAthleteProfile?.ftp || 250;
      const isRecoveryNeeded =
        hasAnyTelemetry &&
        (tsb < -15 ||
          (sleepScore > 0 && sleepScore < 65) ||
          /unbalanced|low|poor/i.test(hrvStatus));
      const wantsRun = /run|track|pace|5k|10k|marathon|threshold run/i.test(userText);
      const todayIso = new Date().toISOString().slice(0, 10);
      const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const primaryWorkout: PlannedWorkoutEvent = isRecoveryNeeded
        ? {
            id: `ai-local-${Date.now()}-1`,
            date: todayIso,
            name: wantsRun
              ? 'Autonomic Recovery Aerobic Flush (Z1/Z2)'
              : 'Active Recovery Spin & Parasympathetic Reset',
            sportCategory: wantsRun ? 'Running' : 'Cycling',
            environmentPreference: 'FLEXIBLE',
            plannedDurationSecs: 2700,
            plannedLoad: 34,
            targetZoneSummary: 'Z1–Z2 Active Recovery',
            workoutSyntax: wantsRun
              ? 'Warmup\n- 10m Z1 Pace\n\nMain Set\n- 25m Z2 Easy Pace\n\nCooldown\n- 10m Z1 Jog'
              : 'Warmup\n- 10m 50% FTP\n\nMain Set\n- 25m 58% FTP 90rpm\n\nCooldown\n- 10m 48% FTP',
            description: hasAnyTelemetry
              ? `Adapted for TSB ${tsb >= 0 ? `+${tsb}` : tsb}${hrv > 0 ? ` and HRV ${hrv}ms (${hrvStatus})` : ''}.`
              : 'Baseline aerobic recovery session.',
          }
        : wantsRun
          ? {
              id: `ai-local-${Date.now()}-1`,
              date: todayIso,
              name: 'Cruise Threshold + Aerobic Economy',
              sportCategory: 'Running',
              environmentPreference: 'OUTDOOR',
              plannedDurationSecs: 3600,
              plannedLoad: 72,
              targetZoneSummary: 'Z4 Threshold Intervals',
              workoutSyntax:
                'Warmup\n- 15m Z2 Easy Pace\n\nMain Set 4x\n- 6m Z4 Threshold Pace\n- 2m Z1 Jog\n\nCooldown\n- 13m Z2 Easy Pace',
              description: hasAnyTelemetry
                ? `Prescribed for CTL ${ctl.toFixed(1)} and TSB ${tsb >= 0 ? `+${tsb}` : tsb}.`
                : 'Baseline threshold calibration session.',
            }
          : {
              id: `ai-local-${Date.now()}-1`,
              date: todayIso,
              name: `Sweet Spot & Threshold Progression (${Math.round(ftp * 0.9)}–${Math.round(ftp * 0.95)}W)`,
              sportCategory: 'Cycling',
              environmentPreference: 'INDOOR',
              plannedDurationSecs: 3600,
              plannedLoad: 76,
              targetZoneSummary: 'Z3/Z4 Sweet Spot',
              workoutSyntax:
                'Warmup\n- 12m 55-75% FTP\n\nMain Set 3x\n- 10m 92% FTP\n- 4m 60% FTP\n\nCooldown\n- 6m 50% FTP',
              description: hasAnyTelemetry
                ? `Calibrated to FTP ${ftp}W and CTL ${ctl.toFixed(1)}.`
                : `Baseline sweet-spot session calibrated to ${ftp}W.`,
            };

      const secondaryWorkout: PlannedWorkoutEvent = {
        id: `ai-local-${Date.now()}-2`,
        date: tomorrowIso,
        name: 'Aerobic Base Durability (Z2)',
        sportCategory: wantsRun ? 'Cycling' : 'Running',
        environmentPreference: 'FLEXIBLE',
        plannedDurationSecs: 3600,
        plannedLoad: 54,
        targetZoneSummary: 'Z2 Aerobic Endurance',
        workoutSyntax: wantsRun
          ? 'Warmup\n- 10m 55% FTP\n\nMain Set\n- 40m 68% FTP\n\nCooldown\n- 10m 50% FTP'
          : 'Warmup\n- 10m Z1-Z2 Pace\n\nMain Set\n- 40m Z2 Easy Pace\n\nCooldown\n- 10m Z1 Jog',
        description: 'Complementary aerobic session keeping <5% cardiac drift.',
      };

      if (!hasAnyTelemetry) {
        return {
          content: [
            'Awaiting your first synced workout archive to compute personalized CTL, ATL, and Form (TSB).',
            'Once your Strava activities finish syncing (or you connect Garmin Connect / Intervals.icu for overnight Sleep & HRV), I will tailor daily prescriptions directly to your training load. In the meantime, you can schedule either baseline session below.',
          ].join('\n\n'),
          citedMetrics: ['Awaiting Sync', `FTP ${ftp}W`],
          proposedWorkouts: [primaryWorkout, secondaryWorkout],
        };
      }

      const cited: string[] = [
        `CTL ${ctl.toFixed(1)}`,
        `TSB ${tsb >= 0 ? `+${tsb}` : tsb}`,
      ];
      if (hrv > 0) cited.push(`HRV ${hrv}ms (${hrvStatus})`);
      if (sleepHours > 0) cited.push(`Sleep ${sleepHours}h${sleepScore > 0 ? ` (${sleepScore})` : ''}`);
      cited.push(`FTP ${ftp}W`);

      return {
        content: [
          `Physiological Readiness Synthesis: CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · Form (TSB) ${tsb >= 0 ? `+${tsb}` : tsb}${hrv > 0 ? ` · HRV ${hrv} ms (${hrvStatus})` : ''}${sleepHours > 0 ? ` · Sleep ${sleepHours}h` : ''}.`,
          isRecoveryNeeded
            ? `Because your acute fatigue or recovery markers show strain (TSB ${tsb}${hrv > 0 ? `, HRV ${hrv} ms` : ''}), today should prioritize Z1/Z2 recovery (~34 TSS) so your 7-day load stabilizes without overreaching.`
            : `Your current load balance supports a targeted quality session today (~${primaryWorkout.plannedLoad} TSS) followed by a Z2 aerobic durability day tomorrow (~${secondaryWorkout.plannedLoad} TSS). Click "Schedule" on either card below to add it to your Training Calendar.`,
        ].join('\n\n'),
        citedMetrics: cited,
        proposedWorkouts: [primaryWorkout, secondaryWorkout],
      };
    },
    [latestWellness, effectiveActivities.length, effectiveAthleteProfile]
  );

  const handleCancelSendChat = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsSendingChat(false);
  }, []);

  const handleSendChatMessage = async (userText: string) => {
    const cleanText =
      userText.trim() ||
      'Analyze my Garmin Sleep, HRV, and CTL/TSB readiness and prescribe today’s optimal workout.';
    const userMsg: CoachChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSendingChat(true);

    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 6500);

    try {
      const resp = await fetch('/api/coach/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          message: cleanText,
          history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          telemetrySummary: telemetrySummaryForGemini,
        }),
      });
      window.clearTimeout(timeoutId);
      const data = await resp.json();
      const fallback = buildClientCoachFallback(cleanText);
      const assistantMsg: CoachChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: resp.ok && data.reply ? data.reply : fallback.content,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citedMetrics:
          Array.isArray(data.citedMetrics) && data.citedMetrics.length > 0
            ? data.citedMetrics
            : fallback.citedMetrics,
        proposedWorkouts:
          Array.isArray(data.proposedWorkouts) && data.proposedWorkouts.length > 0
            ? data.proposedWorkouts
            : fallback.proposedWorkouts,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      window.clearTimeout(timeoutId);
      const fallback = buildClientCoachFallback(cleanText);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-local-${Date.now()}`,
          role: 'assistant',
          content: fallback.content,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citedMetrics: fallback.citedMetrics,
          proposedWorkouts: fallback.proposedWorkouts,
        },
      ]);
    } finally {
      chatAbortRef.current = null;
      setIsSendingChat(false);
    }
  };

  const handleUpdateAnnualMileageGoal = (sport: 'Running' | 'Cycling', targetMeters: number) => {
    setAnnualMileageGoals((prev) =>
      prev.map((g) => (g.sportCategory === sport ? { ...g, targetDistanceMeters: targetMeters } : g))
    );
  };

  const handleAddTargetGoal = (newGoal: Omit<TargetGoal, 'id'>) => {
    if (activeConnectedAthlete) {
      if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
        triggerReadOnlyAlert(activeConnectedAthlete.name, 'add target race or power goals');
        return;
      }
      const created: TargetGoal = { ...newGoal, id: `goal-${Date.now()}` };
      setConnectedAthletes((prev) =>
        prev.map((a) =>
          a.id === activeConnectedAthlete.id
            ? { ...a, targetGoals: [created, ...a.targetGoals] }
            : a
        )
      );
      return;
    }
    setTargetGoals((prev) => [{ ...newGoal, id: `goal-${Date.now()}` }, ...prev]);
  };

  const handleDeleteTargetGoal = (id: string) => {
    if (activeConnectedAthlete) {
      if (activeConnectedAthlete.role === 'FRIEND_VIEW') {
        triggerReadOnlyAlert(activeConnectedAthlete.name, 'delete target goals');
        return;
      }
      setConnectedAthletes((prev) =>
        prev.map((a) =>
          a.id === activeConnectedAthlete.id
            ? { ...a, targetGoals: a.targetGoals.filter((g) => g.id !== id) }
            : a
        )
      );
      return;
    }
    setTargetGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleOpenCoachWithPrompt = (prompt: string) => {
    if (prompt.trim()) {
      setCoachDraftPrompt(prompt.trim());
    }
    setIsCoachDrawerOpen(true);
  };

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
        ...(customFtp ? { ftp: customFtp, indoorFtp: customFtp } : {}),
        ...(hasSeedOverride ? { thresholdPaceSecsPerKm } : {}),
        safeSportHideWeight: Boolean(
          payload.safeSportHideWeight || athleteProfileRef.current.safeSportHideWeight
        ),
      },
      wellnessDaysRef.current[wellnessDaysRef.current.length - 1],
      activitiesRef.current
    );

    setDistanceUnit(payload.distanceUnit);
    try {
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
    } else if (payload.entryTarget === 'CREATE_TEAM') {
      setActiveTab('fitness');
      setRosterInitialTab('TEAMS_BRANDING');
      setIsRosterModalOpen(true);
    } else {
      setActiveTab('fitness');
    }
  };

  if (isSessionLoggedOut || !hasEnteredWorkspace || !hasLocalClientCredentials()) {
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <StravaAuthGate
          status={connectionStatus}
          onLaunchStravaOAuth={async (mode = 'cloud', joinContext, forcePrompt) => {
            await handleLaunchStravaOAuth(mode, joinContext, forcePrompt);
          }}
          onSaveStravaCredentials={handleSaveStravaCredentials}
          onSaveStravaDirectToken={handleSaveStravaDirectToken}
          onExchangeStravaCode={async (codeOrUrl) => {
            await handleExchangeStravaCode(codeOrUrl);
          }}
          onConnectIntervals={handleConnectIntervals}
          onSyncNow={syncLiveTelemetry}
          onCompleteCalibrationEntry={handleCompleteCalibrationEntry}
          onDisconnectCredentials={handleLogoutAndClearData}
          isSyncing={isSyncing}
          errorMessage={syncError}
          isDark={isDark}
          onToggleDark={() => setIsDark((d) => !d)}
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
        <OfflineIndicator />

        {/* Simplified Global Header Bar (Responsive Mobile & Desktop) */}
        <div className="sticky top-[max(0.5rem,env(safe-area-inset-top,0px))] z-40 ap-container pt-2">
          <header className="rounded-2xl liquid-glass-header px-3 sm:px-5 py-2">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {/* 1. Brand Wordmark (Co-Branded when Team Active) + Multi-Team Switcher + Telemetry Sync Pill */}
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <a
                  href="#fitness"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab('fitness');
                  }}
                  className="flex items-center whitespace-nowrap shrink-0"
                >
                  <AeroPulseLogo size="sm" teamBrand={activeTeam?.brand || null} />
                </a>

                {myTeams.length > 0 ? (
                  <div className="hidden sm:inline-flex items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          activeTeam?.brand.primaryHex || 'var(--ap-thresh-vermilion)',
                      }}
                    />
                    <select
                      value={activeTeamId || ''}
                      onChange={(e) =>
                        handleSelectActiveTeam(e.target.value ? e.target.value : null)
                      }
                      aria-label="Switch Active Team Workspace"
                      className="bg-transparent text-[11px] font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer max-w-[115px] truncate"
                    >
                      {myTeams.map((t) => (
                        <option
                          key={t.brand.teamId}
                          value={t.brand.teamId}
                          className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                        >
                          {t.brand.shortName || t.brand.name}
                        </option>
                      ))}
                      <option
                        value=""
                        className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white"
                      >
                        Personal Mode
                      </option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setRosterInitialTab('TEAMS_BRANDING');
                        setIsRosterModalOpen(true);
                      }}
                      className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white dark:bg-[#171E1B] text-slate-700 dark:text-slate-200 hover:opacity-85 cursor-pointer"
                      title="Manage Team Branding, Bulk CSV Invites & Roster"
                    >
                      Manage
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRosterInitialTab('TEAMS_BRANDING');
                      setIsRosterModalOpen(true);
                    }}
                    className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-xl liquid-capsule-track text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    title="Create or Join a High School, Collegiate, or Club Team"
                  >
                    <Users className="w-3 h-3 ap-text-brand" />
                    <span>+ Team</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => syncLiveTelemetry(true)}
                  disabled={isSyncing}
                  className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl liquid-capsule-track text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  title="Sync connected telemetry sources in the background"
                >
                  <RefreshCw
                    weight="bold"
                    className={`w-3 h-3 ap-text-brand ${isSyncing ? 'animate-spin' : ''}`}
                  />
                  <span className="ap-text-brand font-semibold">
                    {isSyncing
                      ? 'Syncing...'
                      : `CTL ${latestWellness ? latestWellness.ctl.toFixed(0) : '—'}`}
                  </span>
                </button>

                {(envFilter !== 'COMBINED' || selectedSport !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setEnvFilter('COMBINED');
                      setSelectedSport('ALL');
                    }}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl ap-status-caution text-[11px] font-mono font-semibold transition-colors whitespace-nowrap cursor-pointer"
                    title="Active viewport filter — click to reset to All Sports & Environments"
                  >
                    <span>
                      Filter:{' '}
                      {[
                        envFilter === 'INDOOR'
                          ? 'Indoor'
                          : envFilter === 'OUTDOOR'
                            ? 'Outdoor'
                            : null,
                        selectedSport !== 'ALL' ? selectedSport : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>

              {/* 2. Center: 4 Primary Workspaces (Today | Plan | Activities | Progress) */}
              <nav className="hidden md:flex items-center gap-1.5 px-1.5 py-1">
                {(
                  [
                    {
                      id: 'fitness',
                      label: 'Today',
                      icon: HeartPulse,
                      match: ['fitness'],
                    },
                    {
                      id: 'calendar',
                      label: 'Plan',
                      icon: Calendar,
                      match: ['calendar'],
                    },
                    {
                      id: 'activities',
                      label: 'Activities',
                      icon: Activity,
                      match: ['activities'],
                    },
                    {
                      id: 'totals',
                      label: 'Progress',
                      icon: Target,
                      match: ['totals', 'curves', 'trends', 'charts'],
                    },
                  ] as const
                ).map((item) => {
                  const NavIcon = item.icon;
                  const isActive = (item.match as readonly string[]).includes(activeTab);
                  return (
                    <a
                      key={item.id}
                      href={`#${item.id === 'totals' ? lastLabTabRef.current : item.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveTab(item.id === 'totals' ? lastLabTabRef.current : item.id);
                      }}
                      className={`min-h-[36px] inline-flex items-center px-3.5 py-1 text-xs transition-all whitespace-nowrap shrink-0 ap-track-tab ${
                        isActive ? 'ap-nav-volt-active' : 'ap-track-tab-idle'
                      }`}
                    >
                      <span className="ap-track-tab-inner">
                        <NavIcon
                          className="w-3.5 h-3.5"
                          weight={isActive ? 'fill' : 'duotone'}
                        />
                        <span>{item.label}</span>
                      </span>
                    </a>
                  );
                })}
              </nav>

              {/* Right: Athlete Switcher (Team Mode) + Data Sources + AI Coach + Theme + Account */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                {/* Athlete Context Switcher — shown only when part of a team or viewing a teammate */}
                {(myTeams.length > 0 || activeViewedAthleteId !== 'SELF') && (
                  <div className="hidden sm:flex items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1 border border-emerald-800/25 dark:border-emerald-700/40 min-w-0">
                    <Users className="w-3.5 h-3.5 ap-text-brand shrink-0" weight="duotone" />
                    <select
                      value={activeViewedAthleteId}
                      onChange={(e) => {
                        setActiveViewedAthleteId(e.target.value);
                        setSelectedActivity(null);
                      }}
                      aria-label="Switch Active Athlete Profile"
                      className="bg-transparent text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-0.5 max-w-[130px] truncate"
                    >
                      <option value="SELF" className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                        {primaryAthleteDisplayName} (You)
                      </option>
                      {combinedRoster
                        .filter((a) => a.status === 'CONNECTED')
                        .map((a) => (
                          <option key={a.id} value={a.id} className="bg-white dark:bg-[#121715] text-slate-900 dark:text-white">
                            {a.name} ({a.role === 'COACH_EDIT' ? 'Coach' : 'Teammate'})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Direct Data Sources Pill Button */}
                <button
                  type="button"
                  onClick={() => setIsDataSourcesOpen(true)}
                  className="hidden sm:inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-slate-700 dark:text-slate-200 transition-all whitespace-nowrap cursor-pointer"
                  title="Connect Strava, Garmin Connect, Intervals.icu, or upload .FIT workouts"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      anySourceConnected ? 'bg-emerald-500' : 'bg-[#FC4C02]'
                    }`}
                  />
                  <span className="hidden lg:inline">
                    {anySourceConnected ? 'Sources' : 'Connect'}
                  </span>
                  <Database className="w-3.5 h-3.5 lg:hidden text-emerald-600 dark:text-emerald-400" />
                </button>

                {/* AI Coach Primary Action Button */}
                <button
                  type="button"
                  onClick={() => setIsCoachDrawerOpen(true)}
                  className="ap-btn-primary !min-h-[34px] !py-1 !px-2.5 sm:!px-3.5 !rounded-xl text-xs whitespace-nowrap cursor-pointer"
                >
                  <Bot className="w-3.5 h-3.5" weight="fill" />
                  <span className="hidden sm:inline">AI Coach</span>
                </button>

                {/* 1-Click Theme Toggle */}
                <button
                  type="button"
                  onClick={() => setIsDark((prev) => !prev)}
                  className="min-h-[34px] w-[34px] inline-flex items-center justify-center rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
                  title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {isDark ? (
                    <Sun className="w-3.5 h-3.5 text-[#C8FF00]" weight="fill" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-[#1D3828]" weight="fill" />
                  )}
                </button>

                {/* Unified Account, Preferences & Logout Menu */}
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                    className="min-h-[34px] inline-flex items-center gap-1.5 sm:gap-2 pl-1.5 pr-2 sm:pr-2.5 py-1 rounded-xl liquid-glass-subtle hover:border-[#28573B] dark:hover:border-[#2E6B47] text-xs font-semibold text-slate-800 dark:text-slate-100 transition-all cursor-pointer"
                    aria-expanded={isAccountMenuOpen}
                    aria-haspopup="menu"
                    title="Account, Profile Zones, Data Sources, Guide & Log Out"
                  >
                    <span className="w-6 h-6 rounded-lg bg-[#1D3828] text-[#C8FF00] border border-[#28573B] font-mono text-[11px] font-bold flex items-center justify-center shadow-xs">
                      {primaryAthleteInitials}
                    </span>
                    <span className="hidden xl:inline max-w-[90px] truncate">
                      {primaryAthleteDisplayName}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        isAccountMenuOpen ? 'rotate-180 ap-text-brand' : ''
                      }`}
                    />
                  </button>

                  {isAccountMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[82vh] overflow-y-auto rounded-2xl bg-white/95 dark:bg-[#0D1310]/95 backdrop-blur-xl border-2 border-[#28573B] dark:border-[#25573A] shadow-2xl p-3 space-y-3 z-50 text-xs"
                    >
                      {/* Account Identity & Connection Summary */}
                      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-slate-200/80 dark:border-white/10">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#1D3828] text-[#C8FF00] border border-[#28573B] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                            {primaryAthleteInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white truncate">
                              {primaryAthleteDisplayName}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="truncate">
                                {effectiveActivities.length.toLocaleString()} workouts synced
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            syncLiveTelemetry(true);
                            setIsAccountMenuOpen(false);
                          }}
                          disabled={isSyncing}
                          className="px-2.5 py-1.5 rounded-xl bg-[#FC4C02]/15 hover:bg-[#FC4C02]/25 text-[#FC4C02] font-mono text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                          title="Initiate a full Strava history sync in the background"
                        >
                          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                          <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
                        </button>
                      </div>

                      {/* Section 1: Athlete & Coaching Settings */}
                      <div className="space-y-1">
                        <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          Athlete &amp; Connections
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsDataSourcesOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>Data Sources (Strava, Garmin &amp; Intervals)</span>
                          </span>
                          <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                            {anySourceConnected ? 'Active ●' : 'Connect'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsProfileModalOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Sliders className="w-4 h-4 ap-text-brand" />
                            <span>Profile, FTP &amp; Sport Zones</span>
                          </span>
                          <span className="font-mono text-[11px] font-bold ap-text-brand bg-emerald-500/10 px-2 py-0.5 rounded-md">
                            {effectiveAthleteProfile.ftp}W
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRosterInitialTab('TEAMS_BRANDING');
                            setIsRosterModalOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>Teams, Bulk Invites &amp; Roster</span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {myTeams.length > 0
                              ? `${myTeams.length} team${myTeams.length === 1 ? '' : 's'}`
                              : 'Manage'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowMetricsGuide(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <HelpCircle className="w-4 h-4 text-amber-500" />
                            <span>User Guide &amp; Metrics Glossary</span>
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            Help
                          </span>
                        </button>
                      </div>

                      {/* Section 2: Quick Display Preferences (Units, Modality, Theme) */}
                      <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-white/10">
                        <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          Display Preferences
                        </div>

                        {/* Modality Filter */}
                        <div className="flex items-center justify-between px-2">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">
                            Environment
                          </span>
                          <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[11px]">
                            {(
                              [
                                { id: 'COMBINED', label: 'All' },
                                { id: 'OUTDOOR', label: 'Outdoor' },
                                { id: 'INDOOR', label: 'Indoor' },
                              ] as const
                            ).map((env) => (
                              <button
                                key={env.id}
                                type="button"
                                onClick={() => setEnvFilter(env.id)}
                                className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                                  envFilter === env.id
                                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {env.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Distance Units & Theme Row */}
                        <div className="flex items-center justify-between px-2">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">
                            Units &amp; Theme
                          </span>
                          <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track font-mono text-[11px]">
                              {(['mi', 'km'] as const).map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => {
                                    setDistanceUnit(u);
                                    try {
                                      localStorage.setItem('thresh_distance_unit_user_set', '1');
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                                    distanceUnit === u
                                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              onClick={() => setIsDark(!isDark)}
                              className="px-2.5 py-1 rounded-lg liquid-capsule-track text-slate-700 dark:text-slate-200 flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                            >
                              {isDark ? (
                                <>
                                  <Sun className="w-3.5 h-3.5 text-amber-400" weight="fill" />
                                  <span>Dark</span>
                                </>
                              ) : (
                                <>
                                  <Moon className="w-3.5 h-3.5 text-slate-700" weight="fill" />
                                  <span>Light</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="px-2 pt-0.5">
                          <PWAInstallButton variant="compact" />
                        </div>
                      </div>

                      {/* Section 3: Session & Logout Controls */}
                      <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1">
                        <button
                          type="button"
                          onClick={handleLogoutSession}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 font-semibold transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-2">
                            <LogOut className="w-4 h-4" weight="bold" />
                            <span>Back to Welcome / Sign Out</span>
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={handleLogoutAndClearData}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-slate-500 dark:text-slate-400 hover:text-rose-400 text-[11px] transition-colors cursor-pointer"
                        >
                          <span>Disconnect All Credentials &amp; Reset</span>
                          <span className="font-mono text-[10px]">Reset</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </header>
        </div>

        {/* Main Content Viewport — Framed by Darker-Green Outer Surround & Content Border */}
        <div className="flex-1 ap-container py-3 sm:py-4 min-w-0">
          <div className="ap-content-stage p-3.5 sm:p-6 space-y-5 min-w-0">
            <main className="space-y-5 min-w-0">
        {/* Multi-Team Magic Join Offer Banner (when an already-signed-in athlete opens a 2nd team link) */}
        {pendingUrlJoinOffer && (
          <div className="rounded-2xl liquid-glass border-lime-600/35 dark:border-[#C8FF00]/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <span className="font-mono uppercase text-[10px] font-bold ap-text-brand block">
                MULTI-TEAM INVITATION DETECTED
              </span>
              <span className="font-bold text-slate-900 dark:text-white text-sm">
                Join {pendingUrlJoinOffer.teamName} and add it to your Team Switcher?
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const resp = await fetch('/api/teams/join-claim', {
                      method: 'POST',
                      credentials: 'include',
                      headers: {
                        'Content-Type': 'application/json',
                        ...getSavedIntervalsHeaders(),
                      },
                      body: JSON.stringify({
                        origin: window.location.origin,
                        codeOrSlug: pendingUrlJoinOffer.codeOrSlug,
                        inviteToken: pendingUrlJoinOffer.token,
                        athleteName: primaryAthleteDisplayName,
                      }),
                    });
                    const data = await resp.json();
                    if (resp.ok && data.teams) {
                      handleTeamsUpdated(data.teams, data.team?.brand?.teamId);
                    }
                  } finally {
                    setPendingUrlJoinOffer(null);
                    if (window.location.pathname.startsWith('/join/')) {
                      window.history.replaceState({}, '', '/');
                    }
                  }
                }}
                className="ap-btn-primary text-xs cursor-pointer"
              >
                Accept &amp; Join {pendingUrlJoinOffer.shortName}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingUrlJoinOffer(null);
                  if (window.location.pathname.startsWith('/join/')) {
                    window.history.replaceState({}, '', '/');
                  }
                }}
                className="ap-btn-secondary text-xs cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {/* Non-blocking Background Strava History Sync Progress Bar */}
        {isSyncing && (
          <div className="rounded-2xl liquid-glass border-[#FC4C02]/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#FC4C02]/15 border border-[#FC4C02]/40 flex items-center justify-center text-[#FC4C02] shrink-0">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
              <div className="text-xs min-w-0">
                <div className="font-bold text-slate-900 dark:text-white">
                  Syncing your selected training window in the background…
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  {activities.length > 0
                    ? `${activities.length.toLocaleString()} workouts loaded so far. You can explore THRESH while this finishes.`
                    : 'Importing workouts, routes, and gear mileage. You can explore THRESH while this finishes.'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsDataSourcesOpen(true)}
                className="min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#28573B] text-slate-800 dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-500" />
                <span>Sync Settings &amp; Optional Sources</span>
              </button>
            </div>
          </div>
        )}
        {/* Active Friend / Coached Athlete Context Banner */}
        {activeConnectedAthlete && (
          <div className="rounded-2xl liquid-glass border-sky-500/40 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-500/20 border border-sky-500/50 flex items-center justify-center font-mono font-bold text-sm text-sky-300">
                {activeConnectedAthlete.avatarInitials}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    Viewing {activeConnectedAthlete.name}
                  </span>
                  {activeConnectedAthlete.role === 'COACH_EDIT' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-orange-500/15 text-orange-400 border border-orange-500/40">
                      <CalendarPlus className="w-3 h-3" />
                      Coach Access (Calendar Edit Enabled)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-sky-500/15 text-sky-400 border border-sky-500/40">
                      <Eye className="w-3 h-3" />
                      Friend Access (Read-Only View)
                    </span>
                  )}
                  {(shieldedConnectedTelemetry?.redactedWellness ||
                    shieldedConnectedTelemetry?.redactedGpsRoutes) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-500/15 text-amber-400 border border-amber-500/40">
                      <Lock className="w-3 h-3" />
                      Privacy Shield Active (HRV/GPS Masked for Friends)
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-mono">
                  {activeConnectedAthlete.location} • Strava #{activeConnectedAthlete.stravaAthleteId} • Goal:{' '}
                  <span className="text-sky-400 font-semibold">
                    {activeConnectedAthlete.primaryGoalSummary}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsRosterModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-xs font-mono text-sky-300 flex items-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Manage Roster &amp; Coach Push</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveViewedAthleteId('SELF');
                  setSelectedActivity(null);
                }}
                className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-mono font-semibold transition-colors"
              >
                Return to My Profile
              </button>
            </div>
          </div>
        )}
        {readOnlyNotice && (
          <div className="rounded-2xl liquid-glass border-amber-500/50 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300 font-medium">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-500 shrink-0" />
              <span>{readOnlyNotice}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsRosterModalOpen(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-[11px] font-mono font-semibold"
              >
                Open Roster Roles
              </button>
              <button
                type="button"
                onClick={() => setReadOnlyNotice(null)}
                className="px-2 py-1 rounded-lg hover:bg-white/10 text-[11px] font-mono"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {redactedStravaCount > 0 &&
          !connectionStatus.stravaConnected &&
          !dismissedStravaBanner && (
            <div className="rounded-2xl liquid-glass border-amber-500/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-700 dark:text-slate-200">
                <span className="font-bold text-amber-700 dark:text-amber-400">
                  Unlock {redactedStravaCount.toLocaleString()} Strava workouts:
                </span>{' '}
                Connect Strava directly to load full GPS route maps, splits, and segment PRs.
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleLaunchStravaOAuth('cloud')}
                  className="min-h-[34px] px-3.5 py-1.5 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Connect Strava
                </button>
                <button
                  type="button"
                  onClick={() => setIsDataSourcesOpen(true)}
                  className="min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  Data Sources
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDismissedStravaBanner(true);
                    try {
                      localStorage.setItem('aeropulse_dismiss_strava_banner', '1');
                    } catch {
                      // ignore
                    }
                  }}
                  className="min-h-[34px] px-2 py-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                  title="Dismiss notice"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

        {!anySourceConnected &&
          activities.length === 0 &&
          !isSyncing &&
          !dismissedQuickConnectBanner && (
            <div className="rounded-2xl liquid-glass border-[#28573B]/35 dark:border-[#25573A] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-700 dark:text-slate-200 max-w-xl">
                <span className="font-bold ap-text-brand">Connect your training data:</span>{' '}
                Sign in with Strava for automatic run &amp; ride sync, or connect Garmin Connect / Intervals.icu for daily HRV &amp; sleep readiness.
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleLaunchStravaOAuth('cloud')}
                  className="min-h-[34px] px-3.5 py-1.5 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Connect Strava
                </button>
                <button
                  type="button"
                  onClick={() => setIsDataSourcesOpen(true)}
                  className="min-h-[34px] px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#28573B] text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  Garmin / Intervals.icu
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedQuickConnectBanner(true)}
                  className="min-h-[34px] px-2 py-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

        <Suspense fallback={<ViewLoadingSkeleton />}>
          {activeTab === 'calendar' && (
            <CalendarView
              activities={effectiveActivities}
              wellnessDays={effectiveWellnessDays}
              plannedEvents={effectivePlannedEvents}
              targetGoals={effectiveTargetGoals}
              envFilter={envFilter}
              selectedSport={selectedSport}
              onSelectSport={setSelectedSport}
              distanceUnit={distanceUnit}
              athleteFtp={athleteFtp}
              athleteProfile={effectiveAthleteProfile}
              onSelectActivity={(act) => {
                handleSelectActivity(act);
                setActiveTab('activities');
              }}
              onCreatePlannedEvent={async (evt) => {
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
              }}
              onDeletePlannedEvent={handleDeletePlannedEvent}
              onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
              onOpenTodayWorkout={() => setActiveTab('fitness')}
              onOpenAthleteProfileModal={() => setIsProfileModalOpen(true)}
              onOpenGoalsArchitect={() => setActiveTab('totals')}
              onOpenOfficialRaceModal={() => setIsOfficialRaceModalOpen(true)}
              onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            />
          )}

          {/* Contextual Sub-Switcher for Progress Workspace */}
          {(activeTab === 'totals' ||
            activeTab === 'curves' ||
            activeTab === 'trends' ||
            activeTab === 'charts') && (
            <div className="rounded-2xl liquid-glass p-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-1 p-1 rounded-xl liquid-capsule-track">
                  {(
                    [
                      {
                        id: 'totals',
                        label: 'Goals & Totals',
                        icon: Target,
                      },
                      {
                        id: 'curves',
                        label: 'Power & Pace Curves',
                        icon: BarChart3,
                      },
                      {
                        id: 'trends',
                        label: 'Physiology Trends',
                        icon: TrendingUp,
                      },
                      {
                        id: 'charts',
                        label: 'Custom Lab',
                        icon: LineChart,
                      },
                    ] as const
                  ).map((sub) => {
                    const SubIcon = sub.icon;
                    const isSubActive = activeTab === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setActiveTab(sub.id)}
                        className={`min-h-[40px] flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-all ${
                          isSubActive
                            ? 'ap-nav-volt-active'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                        }`}
                      >
                        <SubIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'fitness' && (
            <FitnessHealthView
              wellnessDays={effectiveWellnessDays}
              plannedEvents={effectivePlannedEvents}
              activities={effectiveActivities}
              athleteProfile={effectiveAthleteProfile}
              distanceUnit={distanceUnit}
              selfName={primaryAthleteDisplayName}
              selfProfile={athleteProfile}
              selfWellnessDays={wellnessDays}
              connectedAthletes={connectedAthletes}
              onOpenRosterModal={() => setIsRosterModalOpen(true)}
              onSelectActivity={(act) => {
                handleSelectActivity(act);
                setActiveTab('activities');
              }}
              onSyncMorphedToCalendar={handleCreatePlannedEvent}
              onOpenAthleteProfileModal={() => setIsProfileModalOpen(true)}
              onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            />
          )}

          {activeTab === 'trends' && (
            <PhysiologicalTrendsView
              wellnessDays={effectiveWellnessDays}
              activities={effectiveActivities}
              athleteWeightKg={latestWeightKg}
              distanceUnit={distanceUnit}
              onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            />
          )}

          {activeTab === 'charts' && (
            <CustomChartsView
              activities={effectiveActivities}
              wellnessDays={effectiveWellnessDays}
              distanceUnit={distanceUnit}
              onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            />
          )}

          {activeTab === 'activities' && (
            <ActivitiesView
              activities={effectiveActivities}
              plannedEvents={effectivePlannedEvents}
              selectedSport={selectedSport}
              onSelectSport={setSelectedSport}
              envFilter={envFilter}
              onSelectEnvFilter={setEnvFilter}
              distanceUnit={distanceUnit}
              selectedActivity={selectedActivity}
              onSelectActivity={handleSelectActivity}
              onLoadActivityStreams={loadStreamsForActivity}
              onScanMoreSegments={handleScanMoreSegments}
              isScanningSegments={isScanningSegments}
              onHydrateMoreRoutes={handleHydrateMoreRoutes}
              isHydratingRoutes={isHydratingRoutes}
              onToggleKudos={handleToggleActivityKudos}
              onAddComment={handleAddActivityComment}
              onOpenOfficialRaceModal={() => setIsOfficialRaceModalOpen(true)}
              onImportParsedActivity={(newAct) => {
                setActivities((prev) => mergeActivitiesNonDestructive(prev, [newAct]));
              }}
              onImportParsedActivities={(newActs) => {
                setActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
              }}
              athleteWeightKg={latestWeightKg}
              athleteProfile={effectiveAthleteProfile}
            />
          )}

          {activeTab === 'curves' && (
            <PhysiologyView
              curves={INITIAL_POWER_PACE_CURVES}
              benchmarkSegments={benchmarkSegments}
              activities={effectiveActivities}
              wellnessDays={effectiveWellnessDays}
              envFilter={envFilter}
              distanceUnit={distanceUnit}
              athleteWeightKg={latestWeightKg}
              athleteProfile={effectiveAthleteProfile}
              onScanMoreSegments={handleScanMoreSegments}
              isScanningSegments={isScanningSegments}
              onSelectActivity={(act) => {
                handleSelectActivity(act);
                setActiveTab('activities');
              }}
              onOpenActivitiesSegments={() => setActiveTab('activities')}
            />
          )}

          {activeTab === 'totals' && (
            <GoalsView
              annualMileageGoals={annualMileageGoals}
              onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
              targetGoals={effectiveTargetGoals}
              onAddTargetGoal={handleAddTargetGoal}
              onDeleteTargetGoal={handleDeleteTargetGoal}
              activities={effectiveActivities}
              wellnessDays={effectiveWellnessDays}
              plannedEvents={effectivePlannedEvents}
              gearItems={gearItems}
              envFilter={envFilter}
              onSelectEnvFilter={setEnvFilter}
              distanceUnit={distanceUnit}
              currentCtl={latestCtl}
              athleteProfile={effectiveAthleteProfile}
              onBatchCreatePlannedEvents={handleBatchCreatePlannedEvents}
              onSaveProfileOverride={handleSaveProfileOverride}
              onSelectActivity={(act) => {
                handleSelectActivity(act);
                setActiveTab('activities');
              }}
              onSwitchToCalendar={() => setActiveTab('calendar')}
              onOpenOfficialRaceModal={() => setIsOfficialRaceModalOpen(true)}
              onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
            />
          )}
            </Suspense>
            </main>

            {/* Subtle THRESH Branded Footer inside Content Stage */}
            <footer className="pt-5 border-t border-emerald-900/15 dark:border-[#244331] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-3">
                <AeroPulseLogo size="sm" />
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500">·</span>
                <span className="hidden sm:inline font-mono text-[11px]">
                  Run &amp; Ride Threshold Telemetry
                </span>
              </div>
              <div className="flex items-center gap-4 font-medium">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(true)}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Zones &amp; FTP ({effectiveAthleteProfile.ftp}W)
                </button>
                <button
                  type="button"
                  onClick={() => setIsDataSourcesOpen(true)}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Data Sources
                </button>
                <button
                  type="button"
                  onClick={() => setShowMetricsGuide(true)}
                  className="hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Guide
                </button>
              </div>
            </footer>
          </div>
        </div>

      {/* Mobile Bottom Tab Bar (< md) — 4 Primary Workspaces (Today | Plan | Activities | Progress) */}
      <nav className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header grid grid-cols-4 items-center min-h-[58px] px-1.5 py-1 ap-mobile-dock">
        {(
          [
            {
              id: 'fitness',
              label: 'Today',
              icon: HeartPulse,
              match: ['fitness'],
            },
            { id: 'calendar', label: 'Plan', icon: Calendar, match: ['calendar'] },
            { id: 'activities', label: 'Activities', icon: Activity, match: ['activities'] },
            {
              id: 'totals',
              label: 'Progress',
              icon: Target,
              match: ['totals', 'curves', 'trends', 'charts'],
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = (tab.match as readonly string[]).includes(activeTab);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id === 'totals' ? lastLabTabRef.current : tab.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? 'ap-nav-volt-active'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'duotone'} />
              <span className="text-[11px] tracking-tight mt-0.5 whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Lazy-Loaded Drawers & Modals (chunks fetched on-demand only when opened) */}
      {isCoachDrawerOpen && (
        <Suspense fallback={null}>
          <AICoachDrawer
            isOpen={isCoachDrawerOpen}
            onClose={() => setIsCoachDrawerOpen(false)}
            activeViewName={activeTab}
            latestWellness={latestWellness}
            chatMessages={chatMessages}
            onSendChatMessage={handleSendChatMessage}
            isSendingChat={isSendingChat}
            onCancelSend={handleCancelSendChat}
            initialDraftPrompt={coachDraftPrompt}
            onClearDraftPrompt={() => setCoachDraftPrompt('')}
            hasGeminiKey={Boolean(connectionStatus.hasGeminiServerKey)}
            onSaveGeminiApiKey={handleSaveGeminiApiKey}
            onScheduleProposedWorkout={async (workout) => {
              await handleCreatePlannedEvent({
                date: workout.date,
                name: workout.name,
                sportCategory: workout.sportCategory,
                environmentPreference: workout.environmentPreference || 'FLEXIBLE',
                plannedDurationSecs: workout.plannedDurationSecs || 3600,
                plannedLoad: workout.plannedLoad || 65,
                workoutSyntax: workout.workoutSyntax || '',
                description: workout.description || '',
              });
            }}
          />
        </Suspense>
      )}

      {isProfileModalOpen && (
        <Suspense fallback={null}>
          <AthleteProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            athleteProfile={effectiveAthleteProfile}
            latestWellness={latestWellness}
            distanceUnit={distanceUnit}
            intervalsConnected={connectionStatus.intervalsConnected}
            isSyncingProfile={isSyncingProfile}
            onSyncProfileFromRemote={handleSyncProfileFromRemote}
            onSaveProfileOverride={handleSaveProfileOverride}
          />
        </Suspense>
      )}

      {isDataSourcesOpen && (
        <Suspense fallback={null}>
          <DataSourcesModal
            isOpen={isDataSourcesOpen}
            onClose={() => setIsDataSourcesOpen(false)}
            status={connectionStatus}
            onConnectIntervals={handleConnectIntervals}
            onDisconnectIntervals={handleDisconnectIntervals}
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
            errorMessage={syncError}
            idbSavedAt={idbSavedAt}
            persistedWorkoutCount={activities.length}
            onRebuildPersistedArchive={handleClearPersistedArchive}
            existingActivities={effectiveActivities}
            onImportBatchActivities={(newActs) => {
              setActivities((prev) => mergeActivitiesNonDestructive(prev, newActs));
            }}
          />
        </Suspense>
      )}

      {isOfficialRaceModalOpen && (
        <Suspense fallback={null}>
          <OfficialRaceModal
            isOpen={isOfficialRaceModalOpen}
            onClose={() => setIsOfficialRaceModalOpen(false)}
            athleteProfile={effectiveAthleteProfile}
            distanceUnit={distanceUnit}
            existingOfficialRaces={effectiveActivities.filter((a) => Boolean(a.officialRaceData))}
            onImportOfficialRaces={handleImportOfficialRaces}
            onSaveProfileOverride={handleSaveProfileOverride}
          />
        </Suspense>
      )}

      {isRosterModalOpen && (
        <Suspense fallback={null}>
          <AthleteRosterModal
            isOpen={isRosterModalOpen}
            onClose={() => setIsRosterModalOpen(false)}
            selfName={primaryAthleteDisplayName}
            selfInviteCode={selfInviteCode}
            selfCtl={selfLatestWellness?.ctl ?? 0}
            selfAtl={selfLatestWellness?.atl ?? 0}
            selfTsb={selfLatestWellness?.tsb ?? 0}
            selfHrv={selfLatestWellness?.hrvRMSSD ?? 0}
            selfProfile={effectiveAthleteProfile}
            selfPrivacySettings={selfPrivacySettings}
            onUpdateSelfPrivacy={setSelfPrivacySettings}
            roster={combinedRoster}
            activeAthleteId={activeViewedAthleteId}
            onSelectAthleteViewport={(id) => {
              setActiveViewedAthleteId(id);
              setSelectedActivity(null);
            }}
            onApproveRequest={handleApproveAthleteRequest}
            onRemoveOrDeclineAthlete={handleRemoveOrDeclineAthlete}
            onToggleAthleteRole={handleToggleAthleteRole}
            onAddFollowByInviteOrName={handleAddFollowByInviteOrName}
            onPushCoachWorkout={handlePushCoachWorkout}
            distanceUnit={distanceUnit}
            myTeams={myTeams}
            activeTeamId={activeTeamId}
            resendConfigured={resendConfigured}
            initialTab={rosterInitialTab}
            onSelectActiveTeam={handleSelectActiveTeam}
            onTeamsUpdated={handleTeamsUpdated}
          />
        </Suspense>
      )}

      {showMetricsGuide && (
        <Suspense fallback={null}>
          <UserGuideModal
            isOpen={showMetricsGuide}
            onClose={() => setShowMetricsGuide(false)}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenDataSources={() => setIsDataSourcesOpen(true)}
            onOpenRosterModal={() => setIsRosterModalOpen(true)}
            onOpenProfileModal={() => setIsProfileModalOpen(true)}
            onOpenOfficialRaceModal={() => setIsOfficialRaceModalOpen(true)}
            onOpenAICoach={(prompt) => {
              if (prompt) {
                handleOpenCoachWithPrompt(prompt);
              } else {
                setIsCoachDrawerOpen(true);
              }
            }}
          />
        </Suspense>
      )}
      </div>
    </IconContext.Provider>
  );
}
