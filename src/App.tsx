import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from './types';
import {
  INITIAL_ACTIVITIES,
  INITIAL_ANNUAL_MILEAGE_GOALS,
  INITIAL_CHAT_MESSAGES,
  INITIAL_PLANNED_EVENTS,
  INITIAL_POWER_PACE_CURVES,
  INITIAL_WELLNESS_DAYS,
} from './data/mockTelemetry';
import {
  DEFAULT_SELF_PRIVACY_SETTINGS,
  applyAthletePrivacyShield,
  buildInitialConnectedAthletes,
} from './data/athleteRosterData';
import { CalendarView } from './components/CalendarView';
import { FitnessHealthView } from './components/FitnessHealthView';
import { PhysiologicalTrendsView } from './components/PhysiologicalTrendsView';
import { CustomChartsView } from './components/CustomChartsView';
import { ActivitiesView } from './components/ActivitiesView';
import { PhysiologyView } from './components/PhysiologyView';
import { GoalsView } from './components/GoalsView';
import { AICoachDrawer } from './components/AICoachDrawer';
import { DataSourcesModal } from './components/DataSourcesModal';
import { AthleteProfileModal } from './components/AthleteProfileModal';
import { OfficialRaceModal } from './components/OfficialRaceModal';
import { StravaAuthGate } from './components/StravaAuthGate';
import { AthleteRosterModal } from './components/AthleteRosterModal';
import { AeroPulseLogo } from './components/AeroPulseLogo';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { UserGuideModal } from './components/UserGuideModal';
import { computeAnnualMileageSummary, formatDistance } from './utils/formatters';
import {
  buildCompleteAthleteProfile,
  clearPersistedTelemetrySnapshot,
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
  const [isDark, setIsDark] = useState<boolean>(true);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('COMBINED');
  const [selectedSport, setSelectedSport] = useState<SportCategory | 'ALL'>('ALL');

  // Telemetry state — hydrated from Browser IndexedDB on boot so deployments never wipe history
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
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);
  const [showMetricsGuide, setShowMetricsGuide] = useState<boolean>(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const [hasEnteredWorkspace, setHasEnteredWorkspace] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aeropulse_auth_gate_passed') === '1';
    } catch {
      return false;
    }
  });
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
  const [inlineStravaCode, setInlineStravaCode] = useState<string>('');
  const [inlineBundleInput, setInlineBundleInput] = useState<string>('');
  const [dismissedStravaBanner, setDismissedStravaBanner] = useState<boolean>(() => {
    try {
      return localStorage.getItem('aeropulse_dismiss_strava_banner') === '1';
    } catch {
      return false;
    }
  });

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

  // Automatically persist telemetry state changes (streams, routes, segments, kudos) to IndexedDB
  useEffect(() => {
    if (!idbHydratedRef.current) return;
    if (activities.length === 0 && wellnessDays.length === 0) return;
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

  const getSavedIntervalsHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    try {
      const apiKey = localStorage.getItem('aeropulse_intervals_api_key') || '';
      const athleteId = localStorage.getItem('aeropulse_intervals_athlete_id') || '0';
      if (apiKey) {
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
      if (stravaRefreshToken) headers['x-strava-refresh-token'] = stravaRefreshToken;
      if (stravaAccessToken) headers['x-strava-access-token'] = stravaAccessToken;
      if (stravaExpiresAt) headers['x-strava-expires-at'] = stravaExpiresAt;
      if (mapTileApiKey) headers['x-map-tile-api-key'] = mapTileApiKey;
      if (mapTileProvider) headers['x-map-tile-provider'] = mapTileProvider;
      if (geminiApiKey) headers['x-gemini-api-key'] = geminiApiKey;
    } catch {
      // ignore
    }
    return headers;
  };

  const fetchServerConfigStatus = useCallback(async () => {
    try {
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`, {
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.stravaTokens) {
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
      if (data.athleteProfile) {
        const mergedProf = buildCompleteAthleteProfile(
          data.athleteProfile,
          wellnessDaysRef.current[wellnessDaysRef.current.length - 1]
        );
        setAthleteProfile(mergedProf);
        athleteProfileRef.current = mergedProf;
      }
      setConnectionStatus((prev) => ({
        ...prev,
        mode: data.intervalsConnected || data.stravaConnected ? 'LIVE' : 'SANDBOX_CALIBRATION',
        intervalsConnected: Boolean(data.intervalsConnected),
        intervalsAthleteId: data.intervalsAthleteId || '0',
        intervalsAthleteName: data.intervalsAthleteName,
        intervalsSource: data.intervalsSource || 'NONE',
        stravaConnected: Boolean(data.stravaConnected),
        stravaClientId: data.stravaClientId || prev.stravaClientId,
        stravaAthleteName: data.stravaAthleteName,
        stravaSource: data.stravaSource || 'NONE',
        hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        currentOriginCallbackUrl:
          data.callbackUrl || `${window.location.origin}/api/strava/callback`,
        lastSyncedAt: data.lastSyncedAt || prev.lastSyncedAt,
        nextHourlySyncAt: data.nextHourlySyncAt || prev.nextHourlySyncAt,
        autoSyncCronActive: true,
        athleteFtp: data.athleteFtp || prev.athleteFtp,
        athleteIndoorFtp: data.athleteIndoorFtp || prev.athleteIndoorFtp,
        athleteRunFtp: data.athleteRunFtp || prev.athleteRunFtp,
        athleteLthr: data.athleteLthr || prev.athleteLthr,
        athleteMaxHr: data.athleteMaxHr || prev.athleteMaxHr,
        athleteProfile: data.athleteProfile || prev.athleteProfile,
        stravaActivitiesCount:
          data.stravaActivitiesCount && data.stravaActivitiesCount > 0
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
  }, []);

  const syncLiveTelemetry = useCallback(
    async (fullHistory = false) => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        const headers = getSavedIntervalsHeaders();
        const statusResp = await fetch(
          `/api/config/status?origin=${encodeURIComponent(window.location.origin)}`,
          { headers }
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
            if (intData.athleteProfile) {
              const latestW =
                nextWellnessDays.length > 0
                  ? nextWellnessDays[nextWellnessDays.length - 1]
                  : undefined;
              const completeProf = buildCompleteAthleteProfile(intData.athleteProfile, latestW);
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
            if (Array.isArray(intData.activities)) {
              mergedActivities = intData.activities;
              earliestDate = intData.earliestActivityDate || undefined;
            }
          }
        }

        if (statusData.stravaConnected) {
          const hasPersistedVirtualCycling = activitiesRef.current.some(
            (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR'
          );
          const queryParam =
            fullHistory || !hasPersistedArchive || !hasPersistedVirtualCycling
              ? '?full=true'
              : '?deltaOnly=true';
          const stravaResp = await fetch(`/api/strava/sync${queryParam}`, {
            headers: activeHeaders,
          });
          if (stravaResp.ok) {
            const stravaData = await stravaResp.json();
            if (stravaData.stravaTokens) {
              saveRotatedStravaTokensToStorage(stravaData.stravaTokens);
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

  // Instant hydration from Browser IndexedDB on boot + background incremental delta sync
  useEffect(() => {
    let mounted = true;
    (async () => {
      const cached = await loadPersistedTelemetrySnapshot();
      if (mounted && cached && (cached.activities.length > 0 || cached.wellnessDays.length > 0)) {
        setActivities(cached.activities);
        activitiesRef.current = cached.activities;
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
          const hydratedProf = buildCompleteAthleteProfile(cached.athleteProfile, latestW);
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
      idbHydratedRef.current = true;

      const statusData = await fetchServerConfigStatus();
      if (mounted && (statusData?.intervalsConnected || statusData?.stravaConnected)) {
        syncLiveTelemetry(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchServerConfigStatus, syncLiveTelemetry]);

  // Automatic Stale-While-Revalidate sync on Tab Focus / Visibility Change + 15-min active timer
  useEffect(() => {
    let lastAutoSyncMs = Date.now();
    const MIN_REFOCUS_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes cooldown

    const triggerIfStale = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastAutoSyncMs >= MIN_REFOCUS_INTERVAL_MS) {
          lastAutoSyncMs = now;
          syncLiveTelemetry(false);
        }
      }
    };

    const intervalId = window.setInterval(() => {
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
  }, [syncLiveTelemetry]);

  // Listen for OAuth popup completion via window.postMessage and BroadcastChannel
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.endsWith('.vercel.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsSessionLoggedOut(false);
        setHasEnteredWorkspace(true);
        try {
          localStorage.removeItem('aeropulse_logged_out');
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } catch {
          // ignore
        }
        syncLiveTelemetry(true);
      }
    };
    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('aeropulse_oauth');
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'OAUTH_AUTH_SUCCESS') {
          setIsSessionLoggedOut(false);
          setHasEnteredWorkspace(true);
          try {
            localStorage.removeItem('aeropulse_logged_out');
            localStorage.setItem('aeropulse_auth_gate_passed', '1');
          } catch {
            // ignore
          }
          syncLiveTelemetry(true);
        }
      };
    } catch {
      // ignore if BroadcastChannel unsupported
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (bc) bc.close();
    };
  }, [syncLiveTelemetry]);

  const handleConnectIntervals = async (athleteId: string, apiKey: string) => {
    setSyncError(null);
    const resp = await fetch('/api/intervals/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId, apiKey }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Intervals.icu');
      return;
    }
    try {
      localStorage.setItem('aeropulse_intervals_api_key', apiKey.trim());
      localStorage.setItem(
        'aeropulse_intervals_athlete_id',
        (data.athleteId || athleteId || '0').trim()
      );
      localStorage.removeItem('aeropulse_logged_out');
      localStorage.setItem('aeropulse_auth_gate_passed', '1');
    } catch {
      // ignore
    }
    setIsSessionLoggedOut(false);
    setHasEnteredWorkspace(true);
    await syncLiveTelemetry(true);
  };

  const handleDisconnectIntervals = async () => {
    try {
      localStorage.removeItem('aeropulse_intervals_api_key');
      localStorage.removeItem('aeropulse_intervals_athlete_id');
    } catch {
      // ignore
    }
    await fetch('/api/intervals/disconnect', { method: 'POST' });
    await clearPersistedTelemetrySnapshot();
    setIdbSavedAt(null);
    setWellnessDays([]);
    setActivities([]);
    activitiesRef.current = [];
    wellnessDaysRef.current = [];
    await fetchServerConfigStatus();
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    const data = await resp.json();
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

  const handleLaunchStravaOAuth = async (mode: 'cloud' | 'localhost' = 'cloud') => {
    setSyncError(null);

    // If we already have the clientId in state, construct the Strava OAuth URL synchronously
    // so window.open is called synchronously inside the click handler (zero popup blocker issues).
    let popup: Window | null = null;
    if (connectionStatus.stravaClientId) {
      const redirectUri =
        mode === 'localhost'
          ? 'http://localhost/exchange_token'
          : `${window.location.origin}/auth/strava/callback`;
      const params = new URLSearchParams({
        client_id: connectionStatus.stravaClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        approval_prompt: 'force',
        scope: 'read,activity:read_all,profile:read_all',
      });
      const directUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
      popup = window.open(directUrl, 'strava_oauth_popup', 'width=620,height=740');
    } else {
      try {
        const origin = encodeURIComponent(window.location.origin);
        const resp = await fetch(`/api/strava/auth/url?origin=${origin}&mode=${mode}`);
        const data = await resp.json();
        if (!resp.ok || !data.url) {
          setSyncError(
            data.error ||
              'Strava Client ID not set. Enter your Strava Client ID & Secret in Data Sources.'
          );
          if (hasEnteredWorkspace) {
            setIsDataSourcesOpen(true);
          }
          return;
        }
        popup = window.open(data.url, 'strava_oauth_popup', 'width=620,height=740');
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Failed to open Strava OAuth popup');
        return;
      }
    }

    // Poll /api/config/status every 2s for up to 2 minutes so even if strava.com severs window.opener,
    // the main window detects when /auth/strava/callback completes token exchange.
    let checks = 0;
    const pollTimer = window.setInterval(async () => {
      checks += 1;
      if (checks > 60) {
        window.clearInterval(pollTimer);
        return;
      }
      const st = await fetchServerConfigStatus();
      if (st?.stravaConnected) {
        window.clearInterval(pollTimer);
        try {
          if (popup && !popup.closed) popup.close();
        } catch {
          // ignore
        }
        setIsSessionLoggedOut(false);
        setHasEnteredWorkspace(true);
        try {
          localStorage.removeItem('aeropulse_logged_out');
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } catch {
          // ignore
        }
        syncLiveTelemetry(true);
      }
    }, 2000);
  };

  const handleExchangeStravaCode = async (codeOrUrl: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ code: codeOrUrl }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to exchange Strava authorization code.');
      throw new Error(data.error || 'Failed to exchange Strava authorization code.');
    }
    saveRotatedStravaTokensToStorage({
      refreshToken: data.refreshToken,
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    });
    await syncLiveTelemetry(true);
  };

  const handleSaveStravaDirectToken = async (refreshToken: string, accessToken?: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      body: JSON.stringify({ refreshToken, accessToken }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Strava token.');
      throw new Error(data.error || 'Failed to connect Strava token.');
    }
    saveRotatedStravaTokensToStorage({
      refreshToken: data.refreshToken,
      accessToken: data.accessToken,
      expiresAt: data.expiresAt,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    });
    await syncLiveTelemetry(true);
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
      window.dispatchEvent(new CustomEvent('aeropulse-map-config-updated'));
    } catch {
      // ignore
    }
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

  // Multi-Athlete Context Resolution & Privacy Shield Enforcement
  const activeConnectedAthlete = useMemo(
    () =>
      activeViewedAthleteId === 'SELF'
        ? null
        : connectedAthletes.find((a) => a.id === activeViewedAthleteId) || null,
    [activeViewedAthleteId, connectedAthletes]
  );

  // Calendar Planned Workout Creation & Deletion (syncs to Intervals.icu + local state + COACH_EDIT roster)
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
          const latestW =
            wellnessDaysRef.current.length > 0
              ? wellnessDaysRef.current[wellnessDaysRef.current.length - 1]
              : undefined;
          const synced = buildCompleteAthleteProfile(data.athleteProfile, latestW);
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

  const effectivePlannedEvents = useMemo(
    () => (activeConnectedAthlete ? activeConnectedAthlete.plannedEvents : plannedEvents),
    [activeConnectedAthlete, plannedEvents]
  );

  const effectiveAthleteProfile = useMemo(
    () => (activeConnectedAthlete ? activeConnectedAthlete.athleteProfile : athleteProfile),
    [activeConnectedAthlete, athleteProfile]
  );

  const effectiveTargetGoals = useMemo(
    () => (activeConnectedAthlete ? activeConnectedAthlete.targetGoals : targetGoals),
    [activeConnectedAthlete, targetGoals]
  );

  const selfLatestWellness = wellnessDays[wellnessDays.length - 1] || undefined;
  const latestWellness = effectiveWellnessDays[effectiveWellnessDays.length - 1] || undefined;
  const latestCtl = latestWellness?.ctl || 72.4;
  const latestWeightKg = effectiveAthleteProfile.weightKg || latestWellness?.weightKg || 70.0;
  const athleteFtp =
    effectiveAthleteProfile.ftp || connectionStatus.athleteFtp || latestWellness?.rideEftp || 300;

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
    const raw =
      athleteProfile.name ||
      connectionStatus.stravaAthleteName ||
      connectionStatus.intervalsAthleteName ||
      'Elliot';
    return raw === 'Primary Athlete' ? 'Elliot' : raw;
  }, [
    athleteProfile.name,
    connectionStatus.stravaAthleteName,
    connectionStatus.intervalsAthleteName,
  ]);

  const primaryAthleteInitials = useMemo(() => {
    const parts = primaryAthleteDisplayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }
    return primaryAthleteDisplayName.slice(0, 2).toUpperCase() || 'EL';
  }, [primaryAthleteDisplayName]);

  // Multi-athlete roster & session auth handlers
  const handleEnterSandbox = useCallback(() => {
    if (
      activitiesRef.current.length === 0 &&
      wellnessDaysRef.current.length === 0 &&
      !connectionStatus.stravaConnected &&
      !connectionStatus.intervalsConnected
    ) {
      setWellnessDays(INITIAL_WELLNESS_DAYS);
      wellnessDaysRef.current = INITIAL_WELLNESS_DAYS;
      setActivities(INITIAL_ACTIVITIES);
      activitiesRef.current = INITIAL_ACTIVITIES;
      setPlannedEvents(INITIAL_PLANNED_EVENTS);
      plannedEventsRef.current = INITIAL_PLANNED_EVENTS;
    }
    setIsSessionLoggedOut(false);
    setHasEnteredWorkspace(true);
    try {
      localStorage.removeItem('aeropulse_logged_out');
      localStorage.setItem('aeropulse_auth_gate_passed', '1');
    } catch {
      // ignore
    }
  }, [connectionStatus.intervalsConnected, connectionStatus.stravaConnected]);

  const handleCreateLocalAthleteProfile = useCallback(
    async (profileInput: {
      name: string;
      ftp: number;
      thresholdPaceSecsPerKm: number;
      weightKg: number;
      seedSampleTelemetry: boolean;
    }) => {
      setSyncError(null);
      const updatedProf = buildCompleteAthleteProfile(
        {
          ...athleteProfileRef.current,
          name: profileInput.name,
          ftp: profileInput.ftp,
          indoorFtp: Math.round(profileInput.ftp * 0.97),
          eFtp: profileInput.ftp,
          thresholdPaceSecsPerKm: profileInput.thresholdPaceSecsPerKm,
          weightKg: profileInput.weightKg,
          source: 'CUSTOM_OVERRIDE',
        },
        wellnessDaysRef.current[wellnessDaysRef.current.length - 1]
      );
      setAthleteProfile(updatedProf);
      athleteProfileRef.current = updatedProf;

      try {
        await fetch('/api/athlete/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athleteProfile: updatedProf }),
        });
      } catch {
        // non-fatal offline fallback
      }

      if (profileInput.seedSampleTelemetry) {
        if (activitiesRef.current.length === 0 && wellnessDaysRef.current.length === 0) {
          setWellnessDays(INITIAL_WELLNESS_DAYS);
          wellnessDaysRef.current = INITIAL_WELLNESS_DAYS;
          setActivities(INITIAL_ACTIVITIES);
          activitiesRef.current = INITIAL_ACTIVITIES;
          setPlannedEvents(INITIAL_PLANNED_EVENTS);
          plannedEventsRef.current = INITIAL_PLANNED_EVENTS;
        }
      } else {
        setWellnessDays([]);
        wellnessDaysRef.current = [];
        setActivities([]);
        activitiesRef.current = [];
        setPlannedEvents([]);
        plannedEventsRef.current = [];
      }

      setIsSessionLoggedOut(false);
      setHasEnteredWorkspace(true);
      try {
        localStorage.removeItem('aeropulse_logged_out');
        localStorage.setItem('aeropulse_auth_gate_passed', '1');
      } catch {
        // ignore
      }
    },
    []
  );

  const handleLogoutSession = useCallback(() => {
    setIsAccountMenuOpen(false);
    setIsSessionLoggedOut(true);
    setHasEnteredWorkspace(false);
    try {
      localStorage.setItem('aeropulse_logged_out', '1');
      localStorage.removeItem('aeropulse_auth_gate_passed');
    } catch {
      // ignore
    }
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCredentials: false }),
    }).catch(() => {});
  }, []);

  const handleLogoutAndClearData = useCallback(async () => {
    setIsAccountMenuOpen(false);
    setIsSessionLoggedOut(true);
    setHasEnteredWorkspace(false);
    try {
      localStorage.setItem('aeropulse_logged_out', '1');
      localStorage.removeItem('aeropulse_auth_gate_passed');
      localStorage.removeItem('aeropulse_intervals_api_key');
      localStorage.removeItem('aeropulse_intervals_athlete_id');
      localStorage.removeItem('aeropulse_strava_access_token');
      localStorage.removeItem('aeropulse_strava_refresh_token');
      localStorage.removeItem('aeropulse_strava_expires_at');
    } catch {
      // ignore
    }
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCredentials: true }),
      });
    } catch {
      // ignore
    }
    await clearPersistedTelemetrySnapshot();
    setIdbSavedAt(null);
    await fetchServerConfigStatus();
  }, [fetchServerConfigStatus]);

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
      const initials = clean
        .split(/\s+/)
        .map((w) => w[0]?.toUpperCase() || 'A')
        .join('')
        .slice(0, 2);
      const baseDefaults = buildInitialConnectedAthletes()[0];
      const newRecord: ConnectedAthleteRecord = {
        ...baseDefaults,
        id: `athlete-custom-${Date.now()}`,
        name: clean.startsWith('AP-') ? `Athlete (${clean})` : clean,
        avatarInitials: initials || 'AT',
        location: 'Connected via Invite Code',
        stravaAthleteId: String(Math.floor(4000000 + Math.random() * 5000000)),
        inviteCode: clean.startsWith('AP-')
          ? clean.toUpperCase()
          : `AP-${Math.floor(1000 + Math.random() * 8999)}-${(initials || 'ATH').toUpperCase()}`,
        role,
        status: 'CONNECTED',
        primarySport: specialty,
        primaryGoalSummary:
          specialty === 'Cycling' ? '340W Target FTP' : 'Sub-19:45 5K & Track PRs',
      };
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
    []
  );

  const handleSendChatMessage = async (userText: string) => {
    const userMsg: CoachChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSendingChat(true);

    try {
      const resp = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({
          message: userText,
          history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          telemetrySummary: telemetrySummaryForGemini,
        }),
      });
      const data = await resp.json();
      const assistantMsg: CoachChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content:
          resp.ok && data.reply
            ? data.reply
            : `Unable to reach Gemini API (${data.error || 'Verify GEMINI_API_KEY in Secrets'}). Based on your Garmin telemetry, your CTL is ${latestCtl.toFixed(1)} and HRV is ${latestWellness?.hrvRMSSD || 38} ms (${latestWellness?.hrvStatus || 'Balanced'}).`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citedMetrics: Array.isArray(data.citedMetrics) ? data.citedMetrics : undefined,
        proposedWorkouts: Array.isArray(data.proposedWorkouts) ? data.proposedWorkouts : undefined,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content:
            'Network offline—using cached physiological analysis: Your CTL and Garmin HRV Status are balanced for today’s planned session.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
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
    setIsCoachDrawerOpen(true);
    if (prompt.trim()) {
      handleSendChatMessage(prompt);
    }
  };

  if (
    isSessionLoggedOut ||
    (!hasEnteredWorkspace && !connectionStatus.stravaConnected && !connectionStatus.intervalsConnected)
  ) {
    return (
      <IconContext.Provider value={{ weight: 'duotone' }}>
        <StravaAuthGate
          status={connectionStatus}
          athleteName={primaryAthleteDisplayName}
          onLaunchStravaOAuth={async (mode = 'cloud') => {
            await handleLaunchStravaOAuth(mode);
          }}
          onExchangeStravaCode={async (codeOrUrl) => {
            await handleExchangeStravaCode(codeOrUrl);
            handleEnterSandbox();
          }}
          onSaveStravaCredentials={handleSaveStravaCredentials}
          onConnectIntervals={handleConnectIntervals}
          onCreateAthleteProfile={handleCreateLocalAthleteProfile}
          onEnterSandbox={handleEnterSandbox}
          onDisconnectCredentials={handleLogoutAndClearData}
          isSyncing={isSyncing}
          errorMessage={syncError}
        />
      </IconContext.Provider>
    );
  }

  return (
    <IconContext.Provider value={{ weight: 'duotone' }}>
      <div className="ap-shell text-slate-900 dark:text-slate-100">
        <OfflineIndicator />

        {/* Simplified 5-Element Global Header Bar (Responsive Mobile & Desktop) */}
        <div className="sticky top-2 z-40 ap-container pt-1">
          <header className="rounded-2xl liquid-glass-header px-3 sm:px-5 py-2">
            <div className="flex items-center justify-between gap-2 sm:gap-3">
              {/* 1. Brand Wordmark + Subtle Live Sync Pill */}
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <a
                  href="#fitness"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveTab('fitness');
                  }}
                  className="flex items-center whitespace-nowrap shrink-0"
                >
                  <AeroPulseLogo size="sm" />
                </a>

                <button
                  type="button"
                  onClick={() => syncLiveTelemetry(false)}
                  disabled={isSyncing}
                  className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl liquid-capsule-track text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                  title="Click to sync live telemetry now"
                >
                  <RefreshCw
                    weight="bold"
                    className={`w-3 h-3 ${isSyncing ? 'animate-spin text-sky-400' : 'text-emerald-500'}`}
                  />
                  <span className="text-sky-600 dark:text-sky-300 font-semibold">
                    CTL {latestWellness ? latestWellness.ctl.toFixed(0) : '—'}
                  </span>
                </button>
              </div>

              {/* 2. Center: 4 Primary Workspaces in a Recessed macOS Capsule Switcher */}
              <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
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
                      label: 'Calendar & Plan',
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
                      label: 'Lab & Goals',
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
                      className={`min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1 rounded-lg text-xs transition-all whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                      }`}
                    >
                      <NavIcon
                        className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600 dark:text-sky-400' : ''}`}
                        weight={isActive ? 'fill' : 'duotone'}
                      />
                      <span>{item.label}</span>
                    </a>
                  );
                })}
              </nav>

              {/* Right: 3. Athlete Switcher Pill + 4. AI Coach CTA + 5. Account & Settings Menu */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* 3. Athlete Context Switcher */}
                <div className="flex items-center gap-1 rounded-xl liquid-capsule-track px-2 py-1 border border-sky-500/20 min-w-0">
                  <Users className="w-3.5 h-3.5 text-sky-400 shrink-0" weight="duotone" />
                  <select
                    value={activeViewedAthleteId}
                    onChange={(e) => {
                      setActiveViewedAthleteId(e.target.value);
                      setSelectedActivity(null);
                    }}
                    aria-label="Switch Active Athlete Profile"
                    className="bg-transparent text-[11px] font-mono font-semibold text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer pr-1 max-w-[105px] sm:max-w-[155px] truncate"
                  >
                    <option value="SELF" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                      {primaryAthleteDisplayName} (You)
                    </option>
                    {connectedAthletes
                      .filter((a) => a.status === 'CONNECTED')
                      .map((a) => (
                        <option key={a.id} value={a.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                          {a.name} ({a.role === 'COACH_EDIT' ? 'Coach' : 'Friend'})
                        </option>
                      ))}
                  </select>
                </div>

                {/* 4. AI Coach Primary Action Button */}
                <button
                  type="button"
                  onClick={() => setIsCoachDrawerOpen(true)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 text-xs font-semibold text-white bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 rounded-xl shadow-xs transition-all whitespace-nowrap"
                >
                  <Bot className="w-3.5 h-3.5" weight="fill" />
                  <span className="hidden xs:inline">AI Coach</span>
                </button>

                {/* 4b. Interactive User Guide & Feature Tour Button */}
                <button
                  type="button"
                  onClick={() => setShowMetricsGuide(true)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-xl liquid-glass-subtle hover:border-blue-500/40 text-slate-700 dark:text-slate-200 transition-all whitespace-nowrap"
                  title="Open Interactive AeroPulse User Guide, Walkthrough & Physiology Glossary"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-blue-600 dark:text-sky-400" weight="duotone" />
                  <span className="hidden lg:inline">Guide</span>
                </button>

                {/* 5. Unified Account, Preferences & Logout Menu (Elliot ▾) */}
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                    className="min-h-[34px] inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-xl liquid-glass-subtle hover:border-blue-500/40 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-all"
                    aria-expanded={isAccountMenuOpen}
                    aria-haspopup="menu"
                    title="Account, Profile Zones, Data Sources, Preferences & Log Out"
                  >
                    <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-sky-400 text-white font-mono text-[11px] font-bold flex items-center justify-center shadow-xs">
                      {primaryAthleteInitials}
                    </span>
                    <span className="hidden sm:inline max-w-[90px] truncate">
                      {primaryAthleteDisplayName}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                        isAccountMenuOpen ? 'rotate-180 text-sky-400' : ''
                      }`}
                    />
                  </button>

                  {isAccountMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-80 rounded-2xl bg-white/95 dark:bg-[#0D131F]/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-700/80 shadow-2xl p-3 space-y-3 z-50 text-xs"
                    >
                      {/* Account Identity & Connection Summary */}
                      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-slate-200/80 dark:border-white/10">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-sky-400 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                            {primaryAthleteInitials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-white truncate">
                              {primaryAthleteDisplayName}
                            </div>
                            <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span className="truncate">
                                {effectiveActivities.length.toLocaleString()} workouts synced
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            syncLiveTelemetry(false);
                            setIsAccountMenuOpen(false);
                          }}
                          disabled={isSyncing}
                          className="px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-300 font-mono text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors"
                        >
                          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                          <span>Sync</span>
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
                            setIsProfileModalOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Sliders className="w-4 h-4 text-blue-500" />
                            <span>Profile, FTP &amp; Sport Zones</span>
                          </span>
                          <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-sky-300 bg-blue-500/10 px-2 py-0.5 rounded-md">
                            {effectiveAthleteProfile.ftp}W
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsRosterModalOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Users className="w-4 h-4 text-sky-500" />
                            <span>Friends &amp; Coaching Roster</span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {connectedAthletes.length} athletes
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsDataSourcesOpen(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <Database className="w-4 h-4 text-emerald-500" />
                            <span>Data Sources (Strava &amp; Intervals)</span>
                          </span>
                          <span className="font-mono text-[10px] text-emerald-500">
                            {connectionStatus.stravaConnected ? 'Strava ●' : 'Setup'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowMetricsGuide(true);
                            setIsAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <HelpCircle className="w-4 h-4 text-amber-500" />
                            <span>Interactive User Guide &amp; Glossary</span>
                          </span>
                          <span className="font-mono text-[10px] text-blue-600 dark:text-sky-400">
                            7 Chapters
                          </span>
                        </button>
                      </div>

                      {/* Section 2: Quick Display Preferences (Units, Modality, Theme) */}
                      <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-white/10">
                        <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          Display &amp; Filter Preferences
                        </div>

                        {/* Modality Filter */}
                        <div className="flex items-center justify-between px-2">
                          <span className="text-slate-600 dark:text-slate-300 font-medium">
                            Modality
                          </span>
                          <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[11px]">
                            {(
                              [
                                { id: 'COMBINED', label: 'All' },
                                { id: 'OUTDOOR', label: 'Outdoor' },
                                { id: 'INDOOR', label: 'Virtual' },
                              ] as const
                            ).map((env) => (
                              <button
                                key={env.id}
                                type="button"
                                onClick={() => setEnvFilter(env.id)}
                                className={`px-2 py-0.5 rounded-md transition-all ${
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
                                  onClick={() => setDistanceUnit(u)}
                                  className={`px-2 py-0.5 rounded-md transition-all ${
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
                              className="px-2.5 py-1 rounded-lg liquid-capsule-track text-slate-700 dark:text-slate-200 flex items-center gap-1 text-[11px] font-medium"
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
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 font-semibold transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <LogOut className="w-4 h-4" weight="bold" />
                            <span>Log Out ({primaryAthleteDisplayName})</span>
                          </span>
                          <span className="text-[10px] font-mono opacity-80">Lock Session</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleLogoutAndClearData}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-slate-500 dark:text-slate-400 hover:text-rose-400 text-[11px] transition-colors"
                        >
                          <span>Log Out &amp; Disconnect Credentials</span>
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

        {/* Main Content Viewport */}
        <main className="flex-1 ap-container py-4 sm:py-5 space-y-5 min-w-0">
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
            <div className="rounded-2xl liquid-glass border-amber-500/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed max-w-3xl">
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {redactedStravaCount.toLocaleString()} Historical Strava-Only Workouts Need{' '}
                    <code className="font-mono">activity:read_all</code> Permission:
                  </span>{' '}
                  Strava&apos;s default API settings token only grants profile <code className="font-mono">read</code> access. To load your Strava workouts without changing your Strava Callback Domain, click <strong>1. Authorize Strava (localhost)</strong>, click <strong>Authorize</strong> on Strava, then copy the <code className="font-mono">http://localhost/exchange_token?state=&amp;code=...</code> URL from the popup address bar and paste it into Step 2 below:
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleLaunchStravaOAuth('localhost')}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#FC4C02] hover:bg-[#E34402] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    1. Authorize Strava (localhost)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLaunchStravaOAuth('cloud')}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl border border-[#FC4C02]/50 text-[#FC4C02] hover:bg-[#FC4C02]/10 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    Cloud Callback Popup
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDataSourcesOpen(true)}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
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
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-medium transition-colors"
                    title="Dismiss banner"
                  >
                    Dismiss
                  </button>
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!inlineStravaCode.trim()) return;
                  try {
                    await handleExchangeStravaCode(inlineStravaCode.trim());
                    setInlineStravaCode('');
                  } catch {
                    // error displayed in syncError
                  }
                }}
                className="flex flex-wrap items-center gap-2 pt-1"
              >
                <input
                  type="text"
                  value={inlineStravaCode}
                  onChange={(e) => setInlineStravaCode(e.target.value)}
                  placeholder="2. Paste http://localhost/exchange_token?state=&code=... URL (or code) here after clicking Authorize"
                  className="flex-1 min-w-[260px] min-h-[36px] rounded-xl border border-amber-500/40 bg-white/80 dark:bg-slate-950/80 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={isSyncing || !inlineStravaCode.trim()}
                  className="min-h-[36px] px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {isSyncing ? 'Syncing...' : '2. Exchange Code & Sync Workouts'}
                </button>
              </form>
              {syncError && (
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {syncError}
                </div>
              )}
            </div>
          )}

        {!connectionStatus.intervalsConnected &&
          !connectionStatus.stravaConnected &&
          activities.length === 0 &&
          !isSyncing && (
            <div className="rounded-2xl liquid-glass border-blue-500/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed max-w-3xl">
                  <span className="font-bold text-blue-600 dark:text-blue-400">
                    Connect Your Live Telemetry or Paste Your 1-Click Connection Bundle:
                  </span>{' '}
                  This deployment has no credentials saved yet. In your local preview (where Intervals.icu &amp; Strava are connected), open <strong>Sources</strong> → click <strong>Copy 1-Click Connection Bundle</strong>, and paste it below to load all 4,264+ activities and Garmin health records immediately:
                </div>
                <button
                  type="button"
                  onClick={() => setIsDataSourcesOpen(true)}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                >
                  Open Data Sources Setup
                </button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!inlineBundleInput.trim()) return;
                  try {
                    await handleImportConnectionBundle(inlineBundleInput.trim());
                    setInlineBundleInput('');
                  } catch {
                    // error shown below
                  }
                }}
                className="flex flex-wrap items-center gap-2 pt-1"
              >
                <input
                  type="text"
                  value={inlineBundleInput}
                  onChange={(e) => setInlineBundleInput(e.target.value)}
                  placeholder="Paste 1-Click Connection Bundle or .env block from your local app here..."
                  className="flex-1 min-w-[260px] min-h-[36px] rounded-xl border border-blue-500/40 bg-white/80 dark:bg-slate-950/80 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={isSyncing || !inlineBundleInput.trim()}
                  className="min-h-[36px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Import Bundle &amp; Sync All History
                </button>
              </form>
              {syncError && (
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {syncError}
                </div>
              )}
            </div>
          )}

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

        {/* Contextual Recessed Liquid Glass Sub-Switcher for Lab & Goals Workspace */}
        {(activeTab === 'totals' ||
          activeTab === 'curves' ||
          activeTab === 'trends' ||
          activeTab === 'charts') && (
          <div className="rounded-2xl liquid-glass p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-1.5 p-1 rounded-xl liquid-capsule-track">
                {(
                  [
                    {
                      id: 'totals',
                      label: 'Goals & Race PRs',
                      sub: 'Targets, PRs & Volume',
                      icon: Target,
                    },
                    {
                      id: 'curves',
                      label: 'Power & Pace Curves',
                      sub: 'CP, W\' & Peak Outputs',
                      icon: BarChart3,
                    },
                    {
                      id: 'trends',
                      label: 'Aerobic Durability & Trends',
                      sub: 'VO2max, eFTP & Drift',
                      icon: TrendingUp,
                    },
                    {
                      id: 'charts',
                      label: 'Custom Correlation Lab',
                      sub: 'Compare Any 2 Metrics',
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
                          ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                      }`}
                    >
                      <SubIcon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{sub.label}</span>
                      <span className="hidden xl:inline text-[10px] opacity-65 font-normal truncate">
                        · {sub.sub}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowMetricsGuide((prev) => !prev)}
                className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 ${
                  showMetricsGuide
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/35'
                    : 'liquid-glass-subtle text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Toggle quick glossary for Fitness (CTL), Fatigue (ATL), Form (TSB), and Efficiency (EF)"
              >
                <span className="w-4 h-4 rounded-full bg-sky-500/20 text-sky-500 font-mono text-[11px] font-bold inline-flex items-center justify-center">
                  ?
                </span>
                <span className="hidden sm:inline">Metrics Guide</span>
              </button>
            </div>

            {/* Expandable Key Metrics Glossary Strip */}
            {showMetricsGuide && (
              <div className="px-3 py-2 rounded-xl bg-slate-900/5 dark:bg-slate-950/50 border border-slate-200/60 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    <strong className="font-mono text-[#0EA5E9]">Fitness (CTL):</strong> 42-day exponential training load
                  </span>
                  <span>·</span>
                  <span>
                    <strong className="font-mono text-[#8B5CF6]">Fatigue (ATL):</strong> 7-day acute training load
                  </span>
                  <span>·</span>
                  <span>
                    <strong className="font-mono text-emerald-500">Freshness / Form (TSB):</strong> Net Freshness (CTL − ATL)
                  </span>
                  <span>·</span>
                  <span>
                    <strong className="font-mono text-amber-500">Aerobic Efficiency (EF):</strong> Output ÷ Heart Rate
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Hover or click any <strong className="text-blue-500">(i)</strong> icon for Coach &amp; Physiologist benchmarks
                </span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'fitness' && (
          <FitnessHealthView
            wellnessDays={effectiveWellnessDays}
            plannedEvents={effectivePlannedEvents}
            activities={effectiveActivities}
            athleteProfile={effectiveAthleteProfile}
            distanceUnit={distanceUnit}
            selfName={athleteProfile.name || 'Primary Athlete'}
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
            athleteWeightKg={latestWeightKg}
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
      </main>

      {/* Mobile Bottom Tab Bar (< md) — 4 Primary Workspaces in Floating Liquid Glass */}
      <nav className="md:hidden fixed bottom-2 left-3 right-3 z-40 rounded-2xl liquid-glass-header grid grid-cols-4 items-center min-h-[58px] px-1.5 py-1 ap-mobile-dock">
        {(
          [
            {
              id: 'fitness',
              label: 'Today',
              icon: HeartPulse,
              match: ['fitness'],
            },
            { id: 'calendar', label: 'Calendar', icon: Calendar, match: ['calendar'] },
            { id: 'activities', label: 'Activities', icon: Activity, match: ['activities'] },
            {
              id: 'totals',
              label: 'Lab & Goals',
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
                  ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
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

      {/* Omnipresent Slide-Over AI Coach Drawer */}
      <AICoachDrawer
        isOpen={isCoachDrawerOpen}
        onClose={() => setIsCoachDrawerOpen(false)}
        activeViewName={activeTab}
        latestWellness={latestWellness}
        chatMessages={chatMessages}
        onSendChatMessage={handleSendChatMessage}
        isSendingChat={isSendingChat}
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

      {/* Authoritative Athlete Profile & Sport Zones Modal */}
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

      {/* Data Sources & Fork Setup Modal */}
      <DataSourcesModal
        isOpen={isDataSourcesOpen}
        onClose={() => setIsDataSourcesOpen(false)}
        status={connectionStatus}
        onConnectIntervals={handleConnectIntervals}
        onDisconnectIntervals={handleDisconnectIntervals}
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
      />

      {/* Official Race Results Importer (Athletic.net, TFRRS, MileSplit) & Watchless FAT Track Logger */}
      <OfficialRaceModal
        isOpen={isOfficialRaceModalOpen}
        onClose={() => setIsOfficialRaceModalOpen(false)}
        athleteProfile={effectiveAthleteProfile}
        distanceUnit={distanceUnit}
        existingOfficialRaces={effectiveActivities.filter((a) => Boolean(a.officialRaceData))}
        onImportOfficialRaces={handleImportOfficialRaces}
        onSaveProfileOverride={handleSaveProfileOverride}
      />

      {/* Multi-Athlete Friends, Team Leaderboard, Privacy Shield & Coach Hub Modal */}
      <AthleteRosterModal
        isOpen={isRosterModalOpen}
        onClose={() => setIsRosterModalOpen(false)}
        selfName={athleteProfile.name || 'Primary Athlete'}
        selfInviteCode="AP-8492-TALLY"
        selfCtl={selfLatestWellness?.ctl || 72.4}
        selfAtl={selfLatestWellness?.atl || 68.0}
        selfTsb={selfLatestWellness?.tsb || 4.4}
        selfHrv={selfLatestWellness?.hrvRMSSD || 58}
        selfProfile={athleteProfile}
        selfPrivacySettings={selfPrivacySettings}
        onUpdateSelfPrivacy={setSelfPrivacySettings}
        roster={connectedAthletes}
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
      />

      {/* Interactive Online User Guide, Feature Tour & Physiology Glossary Modal */}
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
      </div>
    </IconContext.Provider>
  );
}
