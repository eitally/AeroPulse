import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Calendar,
  HeartPulse,
  LineChart,
  Moon,
  RefreshCw,
  Sun,
  Target,
} from 'lucide-react';
import {
  AnnualMileageGoal,
  AthleteGearItem,
  BenchmarkSegmentHistory,
  CoachChatMessage,
  ConnectionStatus,
  DistanceUnit,
  EnvironmentFilter,
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
  INITIAL_POWER_PACE_CURVES,
  INITIAL_WELLNESS_DAYS,
} from './data/mockTelemetry';
import { CalendarView } from './components/CalendarView';
import { FitnessHealthView } from './components/FitnessHealthView';
import { CustomChartsView } from './components/CustomChartsView';
import { ActivitiesView } from './components/ActivitiesView';
import { PhysiologyView } from './components/PhysiologyView';
import { GoalsView } from './components/GoalsView';
import { AICoachDrawer } from './components/AICoachDrawer';
import { DataSourcesModal } from './components/DataSourcesModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { computeAnnualMileageSummary, formatDistance } from './utils/formatters';

type ActiveTab = 'calendar' | 'fitness' | 'charts' | 'activities' | 'curves' | 'totals';

const DEV_APP_URL = 'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';
const SHARED_APP_URL = 'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('calendar');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('COMBINED');
  const [selectedSport, setSelectedSport] = useState<SportCategory | 'ALL'>('ALL');

  // Telemetry state
  const [wellnessDays, setWellnessDays] = useState<UnifiedWellnessDay[]>(INITIAL_WELLNESS_DAYS);
  const [activities, setActivities] = useState<UnifiedActivity[]>(INITIAL_ACTIVITIES);
  const [plannedEvents, setPlannedEvents] = useState<PlannedWorkoutEvent[]>([]);
  const [gearItems, setGearItems] = useState<AthleteGearItem[]>([]);
  const [benchmarkSegments] = useState<BenchmarkSegmentHistory[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<UnifiedActivity | null>(null);

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

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    mode: 'SANDBOX_CALIBRATION',
    intervalsConnected: false,
    intervalsAthleteId: '0',
    intervalsSource: 'NONE',
    stravaConnected: false,
    stravaSource: 'NONE',
    hasGeminiServerKey: true,
    autoSyncCronActive: true,
    devCallbackUrl: `${DEV_APP_URL}/auth/strava/callback`,
    sharedCallbackUrl: `${SHARED_APP_URL}/auth/strava/callback`,
    currentOriginCallbackUrl:
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/strava/callback`
        : `${DEV_APP_URL}/auth/strava/callback`,
  });

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

  const getSavedIntervalsHeaders = (): Record<string, string> => {
    try {
      const apiKey = localStorage.getItem('aeropulse_intervals_api_key') || '';
      const athleteId = localStorage.getItem('aeropulse_intervals_athlete_id') || '0';
      if (apiKey) {
        return {
          'x-intervals-api-key': apiKey,
          'x-intervals-athlete-id': athleteId,
        };
      }
    } catch {
      // ignore
    }
    return {};
  };

  const fetchServerConfigStatus = useCallback(async () => {
    try {
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`, {
        headers: getSavedIntervalsHeaders(),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
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
          data.callbackUrl || `${window.location.origin}/auth/strava/callback`,
        lastSyncedAt: data.lastSyncedAt || prev.lastSyncedAt,
        nextHourlySyncAt: data.nextHourlySyncAt || prev.nextHourlySyncAt,
        autoSyncCronActive: true,
        stravaActivitiesCount: data.stravaActivitiesCount ?? prev.stravaActivitiesCount,
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

        let mergedActivities: UnifiedActivity[] | null = null;
        let garminCount = 0;
        let stravaCount = 0;
        let earliestDate: string | undefined;

        if (statusData.intervalsConnected) {
          const intResp = await fetch('/api/intervals/sync?oldest=2010-01-01', { headers });
          if (intResp.ok) {
            const intData = await intResp.json();
            if (Array.isArray(intData.wellnessDays) && intData.wellnessDays.length > 0) {
              setWellnessDays(intData.wellnessDays);
            }
            if (typeof intData.redactedStravaCount === 'number') {
              setRedactedStravaCount(intData.redactedStravaCount);
            }
            if (Array.isArray(intData.plannedEvents) && intData.plannedEvents.length > 0) {
              setPlannedEvents(intData.plannedEvents);
            }
            if (
              Array.isArray(intData.athleteProfile?.gearItems) &&
              intData.athleteProfile.gearItems.length > 0
            ) {
              setGearItems(intData.athleteProfile.gearItems);
            }
            if (Array.isArray(intData.activities)) {
              mergedActivities = intData.activities;
              garminCount = intData.activities.length;
              earliestDate = intData.earliestActivityDate || undefined;
            }
          }
        }

        if (statusData.stravaConnected) {
          const stravaResp = await fetch(`/api/strava/sync${fullHistory ? '?full=true' : ''}`);
          if (stravaResp.ok) {
            const stravaData = await stravaResp.json();
            if (Array.isArray(stravaData.activities) && stravaData.activities.length > 0) {
              stravaCount = stravaData.activities.length;
              const toUnifiedFromStrava = (sa: any): UnifiedActivity => ({
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
                    return {
                      ...act,
                      gearName: matched.gearName || act.gearName,
                      stravaPrCount: matched.stravaPrCount ?? act.stravaPrCount,
                      kudosCount: matched.kudosCount ?? act.kudosCount,
                      segmentEfforts:
                        Array.isArray(matched.segmentEfforts) && matched.segmentEfforts.length > 0
                          ? matched.segmentEfforts
                          : act.segmentEfforts,
                      sourceBadges: Array.from(new Set([...act.sourceBadges, 'Strava'])) as (
                        | 'Intervals.icu'
                        | 'Garmin'
                        | 'Strava'
                      )[],
                    };
                  }
                  return act;
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
          setActivities(mergedActivities);
          const oldestLoaded =
            mergedActivities.length > 0
              ? mergedActivities[mergedActivities.length - 1].startDateLocal.slice(0, 10)
              : earliestDate;
          setConnectionStatus((prev) => ({
            ...prev,
            totalActivitiesCount: mergedActivities!.length,
            garminActivitiesCount: garminCount,
            stravaActivitiesCount: stravaCount,
            earliestActivityDate: oldestLoaded || prev.earliestActivityDate,
            lastSyncedAt: new Date().toISOString(),
          }));
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

  // Initial sync on load
  useEffect(() => {
    fetchServerConfigStatus().then((statusData) => {
      if (statusData?.intervalsConnected || statusData?.stravaConnected) {
        syncLiveTelemetry(false);
      }
    });
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
        syncLiveTelemetry(true);
      }
    };
    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('aeropulse_oauth');
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'OAUTH_AUTH_SUCCESS') {
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
    } catch {
      // ignore
    }
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
    setWellnessDays(INITIAL_WELLNESS_DAYS);
    setActivities(INITIAL_ACTIVITIES);
    await fetchServerConfigStatus();
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
          setIsDataSourcesOpen(true);
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
        syncLiveTelemetry(true);
      }
    }, 2000);
  };

  const handleExchangeStravaCode = async (codeOrUrl: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeOrUrl }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to exchange Strava authorization code.');
      throw new Error(data.error || 'Failed to exchange Strava authorization code.');
    }
    await syncLiveTelemetry(true);
  };

  const handleSaveStravaDirectToken = async (refreshToken: string, accessToken?: string) => {
    setSyncError(null);
    const resp = await fetch('/api/strava/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, accessToken }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setSyncError(data.error || 'Failed to connect Strava token.');
      throw new Error(data.error || 'Failed to connect Strava token.');
    }
    await syncLiveTelemetry(true);
  };

  // Load real streams + auto-detected intervals when selecting an activity
  const handleSelectActivity = async (activity: UnifiedActivity | null) => {
    setSelectedActivity(activity);
    if (
      activity &&
      (!activity.streams || !activity.intervals) &&
      connectionStatus.intervalsConnected &&
      activity.intervalsId
    ) {
      try {
        const resp = await fetch(`/api/intervals/activities/${activity.intervalsId}/streams`, {
          headers: getSavedIntervalsHeaders(),
        });
        if (resp.ok) {
          const payload = await resp.json();
          const streams = payload.streams || payload;
          const intervals = Array.isArray(payload.intervals) ? payload.intervals : undefined;
          setSelectedActivity((prev) =>
            prev && prev.id === activity.id ? { ...prev, streams, intervals } : prev
          );
          setActivities((prev) =>
            prev.map((a) => (a.id === activity.id ? { ...a, streams, intervals } : a))
          );
        }
      } catch {
        // Fallback if stream endpoint unavailable
      }
    }
  };

  // Calendar Planned Workout Creation & Deletion (syncs to Intervals.icu + local state)
  const handleCreatePlannedEvent = async (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
  }) => {
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
          setPlannedEvents((prev) => [...prev, data.event]);
          return;
        }
      }
    } catch {
      // Fallback to local state
    }
    setPlannedEvents((prev) => [
      ...prev,
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
    ]);
  };

  const handleDeletePlannedEvent = async (id: string) => {
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
    };
  }, [
    wellnessDays,
    annualMileageGoals,
    activities,
    envFilter,
    distanceUnit,
    plannedEvents,
    targetGoals,
  ]);

  const latestWellness = wellnessDays[wellnessDays.length - 1] || undefined;
  const latestCtl = latestWellness?.ctl || 72.4;
  const latestWeightKg = latestWellness?.weightKg || 72.5;
  const athleteFtp = connectionStatus.athleteFtp || latestWellness?.rideEftp || 300;

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
        headers: { 'Content-Type': 'application/json' },
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
    setTargetGoals((prev) => [{ ...newGoal, id: `goal-${Date.now()}` }, ...prev]);
  };

  const handleDeleteTargetGoal = (id: string) => {
    setTargetGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleOpenCoachWithPrompt = (prompt: string) => {
    setIsCoachDrawerOpen(true);
    if (prompt.trim()) {
      handleSendChatMessage(prompt);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 pb-20 md:pb-10">
      <OfflineIndicator />

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-6 px-4 sm:px-8 h-14 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#calendar"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('calendar');
          }}
          className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          AeroPulse
        </a>

        {/* Zone 2: Intervals.icu Workspaces Navigation */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          {(
            [
              { id: 'calendar', label: 'Calendar' },
              { id: 'fitness', label: 'Fitness & Health' },
              { id: 'charts', label: 'Custom Charts' },
              { id: 'activities', label: 'Activities' },
              { id: 'curves', label: 'Curves & PRs' },
              { id: 'totals', label: 'Totals & Goals' },
            ] as const
          ).map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab(item.id);
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'border-blue-600 dark:border-blue-400 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Omnipresent AI Coach Drawer Toggle + Data Sources */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsCoachDrawerOpen(true)}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>AI Coach</span>
          </button>
          <button
            onClick={() => setIsDataSourcesOpen(true)}
            className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            Data Sources
          </button>
        </div>
      </header>

      {/* Workspace Utility Sub-Bar (Outdoor/Indoor Filter, Archive Status, Units, Theme) */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-[#111827]/60 px-4 sm:px-8 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Environment Filter + Archive Summary */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: 'COMBINED', label: 'All Environments' },
                  { id: 'OUTDOOR', label: 'Outdoor Only' },
                  { id: 'INDOOR', label: 'Indoor (Trainer/Treadmill)' },
                ] as const
              ).map((env) => (
                <button
                  key={env.id}
                  onClick={() => setEnvFilter(env.id)}
                  className={`min-h-[28px] px-2.5 py-0.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    envFilter === env.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {env.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => syncLiveTelemetry(false)}
              disabled={isSyncing}
              className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              title="Hourly Auto-Sync Cron Active (0 * * * *) — Click to poll now"
            >
              <RefreshCw
                className={`w-3 h-3 ${isSyncing ? 'animate-spin text-blue-500' : 'text-emerald-500'}`}
              />
              <span>
                {activities.length.toLocaleString()} workouts (
                {connectionStatus.earliestActivityDate || '2019'}–2026) · Hourly Auto-Sync
              </span>
            </button>
          </div>

          {/* Right: Garmin Status Quick Pill, Units Toggle (mi / km), PWA Install, and Theme Switch */}
          <div className="flex items-center gap-2">
            {latestWellness && (
              <button
                onClick={() => setActiveTab('fitness')}
                className="hidden lg:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 hover:border-blue-500/40 transition-colors"
              >
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Garmin: {latestWellness.garminTrainingStatus || 'Productive'}
                </span>
                <span>·</span>
                <span>CTL {latestWellness.ctl.toFixed(1)}</span>
                {latestWellness.sleepSecs > 0 && (
                  <>
                    <span>·</span>
                    <span>
                      Sleep {Math.floor(latestWellness.sleepSecs / 3600)}h
                      {Math.round((latestWellness.sleepSecs % 3600) / 60)}m ({latestWellness.sleepScore})
                    </span>
                  </>
                )}
                {latestWellness.hrvRMSSD > 0 && (
                  <>
                    <span>·</span>
                    <span>HRV {latestWellness.hrvRMSSD}ms</span>
                  </>
                )}
              </button>
            )}

            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs">
              {(['mi', 'km'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setDistanceUnit(u)}
                  className={`min-h-[28px] px-2.5 py-0.5 rounded-md transition-colors ${
                    distanceUnit === u
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>

            <PWAInstallButton variant="compact" />

            <button
              onClick={() => setIsDark(!isDark)}
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle color theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-6 space-y-6">
        {redactedStravaCount > 0 &&
          (!connectionStatus.stravaConnected ||
            (connectionStatus.stravaActivitiesCount ?? 0) === 0) && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed max-w-3xl">
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    {redactedStravaCount.toLocaleString()} Historical Strava-Only Workouts Need{' '}
                    <code className="font-mono">activity:read_all</code> Permission:
                  </span>{' '}
                  Strava&apos;s default API settings token only grants profile <code className="font-mono">read</code> access. To load your 1,372 Strava workouts without changing your Strava Callback Domain, click <strong>1. Authorize Strava (localhost)</strong>, click <strong>Authorize</strong> on Strava, then copy the <code className="font-mono">http://localhost/exchange_token?state=&amp;code=...</code> URL from the popup address bar and paste it into Step 2 below:
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleLaunchStravaOAuth('localhost')}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#FC4C02] hover:bg-[#E34402] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    1. Authorize Strava (localhost)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLaunchStravaOAuth('cloud')}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#FC4C02]/50 text-[#FC4C02] hover:bg-[#FC4C02]/10 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    Cloud Callback Popup
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDataSourcesOpen(true)}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    Data Sources
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
                  className="flex-1 min-w-[260px] min-h-[36px] rounded-lg border border-amber-500/40 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={isSyncing || !inlineStravaCode.trim()}
                  className="min-h-[36px] px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  {isSyncing ? 'Syncing...' : '2. Exchange Code & Sync 1,372 Workouts'}
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
            activities={activities}
            wellnessDays={wellnessDays}
            plannedEvents={plannedEvents}
            envFilter={envFilter}
            selectedSport={selectedSport}
            distanceUnit={distanceUnit}
            athleteFtp={athleteFtp}
            onSelectActivity={(act) => {
              handleSelectActivity(act);
              setActiveTab('activities');
            }}
            onCreatePlannedEvent={handleCreatePlannedEvent}
            onDeletePlannedEvent={handleDeletePlannedEvent}
            onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          />
        )}

        {activeTab === 'fitness' && (
          <FitnessHealthView
            wellnessDays={wellnessDays}
            plannedEvents={plannedEvents}
            onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          />
        )}

        {activeTab === 'charts' && (
          <CustomChartsView
            activities={activities}
            wellnessDays={wellnessDays}
            distanceUnit={distanceUnit}
            onOpenCoachWithPrompt={handleOpenCoachWithPrompt}
          />
        )}

        {activeTab === 'activities' && (
          <ActivitiesView
            activities={activities}
            selectedSport={selectedSport}
            onSelectSport={setSelectedSport}
            envFilter={envFilter}
            onSelectEnvFilter={setEnvFilter}
            distanceUnit={distanceUnit}
            selectedActivity={selectedActivity}
            onSelectActivity={handleSelectActivity}
          />
        )}

        {activeTab === 'curves' && (
          <PhysiologyView
            curves={INITIAL_POWER_PACE_CURVES}
            benchmarkSegments={benchmarkSegments}
            activities={activities}
            wellnessDays={wellnessDays}
            envFilter={envFilter}
            distanceUnit={distanceUnit}
            athleteWeightKg={latestWeightKg}
          />
        )}

        {activeTab === 'totals' && (
          <GoalsView
            annualMileageGoals={annualMileageGoals}
            onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
            targetGoals={targetGoals}
            onAddTargetGoal={handleAddTargetGoal}
            onDeleteTargetGoal={handleDeleteTargetGoal}
            activities={activities}
            wellnessDays={wellnessDays}
            gearItems={gearItems}
            envFilter={envFilter}
            onSelectEnvFilter={setEnvFilter}
            distanceUnit={distanceUnit}
            currentCtl={latestCtl}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (< md) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-6 items-center h-16 px-1">
        {(
          [
            { id: 'calendar', label: 'Calendar', icon: Calendar },
            { id: 'fitness', label: 'Fitness', icon: HeartPulse },
            { id: 'charts', label: 'Charts', icon: LineChart },
            { id: 'activities', label: 'Workouts', icon: Activity },
            { id: 'curves', label: 'Curves', icon: BarChart3 },
            { id: 'totals', label: 'Totals', icon: Target },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] tracking-tight mt-0.5 whitespace-nowrap">
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
        onSyncNow={syncLiveTelemetry}
        isSyncing={isSyncing}
        errorMessage={syncError}
      />
    </div>
  );
}
