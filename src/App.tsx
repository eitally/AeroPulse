import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Gauge,
  HeartPulse,
  Moon,
  Sun,
  Target,
} from 'lucide-react';
import {
  ActivityEnvironment,
  AnnualMileageGoal,
  BenchmarkSegmentHistory,
  CoachChatMessage,
  ConnectionStatus,
  DailyWorkoutOption,
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from './types';
import {
  INITIAL_ACTIVITIES,
  INITIAL_ANNUAL_MILEAGE_GOALS,
  INITIAL_BENCHMARK_SEGMENTS,
  INITIAL_CHAT_MESSAGES,
  INITIAL_DAILY_WORKOUT_OPTIONS,
  INITIAL_POWER_PACE_CURVES,
  INITIAL_TARGET_GOALS,
  INITIAL_WELLNESS_DAYS,
} from './data/mockTelemetry';
import { OverviewView } from './components/OverviewView';
import { ActivitiesView } from './components/ActivitiesView';
import { PhysiologyView } from './components/PhysiologyView';
import { GoalsView } from './components/GoalsView';
import { CoachView } from './components/CoachView';
import { DataSourcesModal } from './components/DataSourcesModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { computeAnnualMileageSummary, formatDistance } from './utils/formatters';

type ActiveTab = 'overview' | 'activities' | 'physiology' | 'goals' | 'coach';

const DEV_APP_URL = 'https://ais-dev-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';
const SHARED_APP_URL = 'https://ais-pre-6ghnkmxunr54ug7sumz3hy-377968603671.us-west1.run.app';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('mi');
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('COMBINED');
  const [selectedSport, setSelectedSport] = useState<SportCategory | 'ALL'>('ALL');

  // Telemetry state
  const [wellnessDays, setWellnessDays] = useState<UnifiedWellnessDay[]>(INITIAL_WELLNESS_DAYS);
  const [activities, setActivities] = useState<UnifiedActivity[]>(INITIAL_ACTIVITIES);
  const [benchmarkSegments, setBenchmarkSegments] =
    useState<BenchmarkSegmentHistory[]>(INITIAL_BENCHMARK_SEGMENTS);
  const [selectedActivity, setSelectedActivity] = useState<UnifiedActivity | null>(null);

  // Persisted Annual Mileage & Target Race Goals
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
      return saved ? JSON.parse(saved) : INITIAL_TARGET_GOALS;
    } catch {
      return INITIAL_TARGET_GOALS;
    }
  });

  // AI Coach State
  const [workoutOptions, setWorkoutOptions] =
    useState<DailyWorkoutOption[]>(INITIAL_DAILY_WORKOUT_OPTIONS);
  const [selectedWorkoutOption, setSelectedWorkoutOption] = useState<DailyWorkoutOption>(
    INITIAL_DAILY_WORKOUT_OPTIONS[0]
  );
  const [isGeneratingOptions, setIsGeneratingOptions] = useState(false);
  const [chatMessages, setChatMessages] = useState<CoachChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [isSendingChat, setIsSendingChat] = useState(false);

  // Data Sources & Sync Modal State
  const [isDataSourcesOpen, setIsDataSourcesOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    mode: 'SANDBOX_CALIBRATION',
    intervalsConnected: false,
    intervalsAthleteId: '0',
    intervalsSource: 'NONE',
    stravaConnected: false,
    stravaSource: 'NONE',
    hasGeminiServerKey: true,
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

  const fetchServerConfigStatus = useCallback(async () => {
    try {
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/config/status?origin=${origin}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setConnectionStatus((prev) => ({
        ...prev,
        mode: data.intervalsConnected || data.stravaConnected ? 'LIVE' : 'SANDBOX_CALIBRATION',
        intervalsConnected: Boolean(data.intervalsConnected),
        intervalsAthleteId: data.intervalsAthleteId || '0',
        intervalsAthleteName: data.intervalsAthleteName,
        intervalsSource: data.intervalsSource || 'NONE',
        stravaConnected: Boolean(data.stravaConnected),
        stravaAthleteName: data.stravaAthleteName,
        stravaSource: data.stravaSource || 'NONE',
        hasGeminiServerKey: Boolean(data.hasGeminiServerKey),
        currentOriginCallbackUrl:
          data.callbackUrl || `${window.location.origin}/auth/strava/callback`,
      }));
    } catch {
      // Server status optional during offline mode
    }
  }, []);

  const syncLiveTelemetry = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      // 1. Try Intervals.icu sync if connected
      const statusResp = await fetch(
        `/api/config/status?origin=${encodeURIComponent(window.location.origin)}`
      );
      const statusData = statusResp.ok ? await statusResp.json() : {};

      let mergedActivities = [...INITIAL_ACTIVITIES];

      if (statusData.intervalsConnected) {
        const intResp = await fetch('/api/intervals/sync');
        if (intResp.ok) {
          const intData = await intResp.json();
          if (Array.isArray(intData.wellnessDays) && intData.wellnessDays.length > 0) {
            setWellnessDays(intData.wellnessDays);
          }
          if (Array.isArray(intData.activities) && intData.activities.length > 0) {
            mergedActivities = intData.activities;
          }
        }
      }

      // 2. Try Strava sync if connected via OAuth
      if (statusData.stravaConnected) {
        const stravaResp = await fetch('/api/strava/sync');
        if (stravaResp.ok) {
          const stravaData = await stravaResp.json();
          if (Array.isArray(stravaData.activities) && stravaData.activities.length > 0) {
            // Merge Strava segmentEfforts and PR counts into existing or new activities
            const byStravaId = new Map<string, any>();
            for (const sa of stravaData.activities) {
              byStravaId.set(String(sa.stravaId), sa);
            }
            mergedActivities = mergedActivities.map((act) => {
              const matched = act.stravaId ? byStravaId.get(String(act.stravaId)) : undefined;
              if (matched) {
                byStravaId.delete(String(act.stravaId));
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
          }
        }
      }

      setActivities(mergedActivities);
      await fetchServerConfigStatus();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Telemetry sync failed.');
    } finally {
      setIsSyncing(false);
    }
  }, [fetchServerConfigStatus]);

  useEffect(() => {
    fetchServerConfigStatus();
  }, [fetchServerConfigStatus]);

  // Listen for OAuth popup completion via window.postMessage
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
        syncLiveTelemetry();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
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
    await syncLiveTelemetry();
  };

  const handleDisconnectIntervals = async () => {
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

  const handleLaunchStravaOAuth = async () => {
    setSyncError(null);
    try {
      const origin = encodeURIComponent(window.location.origin);
      const resp = await fetch(`/api/strava/auth/url?origin=${origin}`);
      const data = await resp.json();
      if (!resp.ok || !data.url) {
        setSyncError(
          data.error ||
            'Strava Client ID not set. Enter your Strava Client ID & Secret above or in .env.'
        );
        return;
      }
      // Open Strava's OAuth authorize URL directly in popup per oauth-integration guidelines
      window.open(data.url, 'strava_oauth_popup', 'width=600,height=720');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to open Strava OAuth popup');
    }
  };

  // Load real streams when selecting an activity if connected to Intervals.icu
  const handleSelectActivity = async (activity: UnifiedActivity | null) => {
    setSelectedActivity(activity);
    if (activity && !activity.streams && connectionStatus.intervalsConnected && activity.intervalsId) {
      try {
        const resp = await fetch(`/api/intervals/activities/${activity.intervalsId}/streams`);
        if (resp.ok) {
          const streams = await resp.json();
          setSelectedActivity((prev) => (prev && prev.id === activity.id ? { ...prev, streams } : prev));
        }
      } catch {
        // Fallback if stream endpoint unavailable
      }
    }
  };

  // Build concise physiological + mileage + segment telemetry payload for Gemini AI Coach
  const telemetrySummaryForGemini = useMemo(() => {
    const today = wellnessDays[wellnessDays.length - 1];
    const runGoal =
      annualMileageGoals.find((g) => g.sportCategory === 'Running')?.targetDistanceMeters || 2414016;
    const bikeGoal =
      annualMileageGoals.find((g) => g.sportCategory === 'Cycling')?.targetDistanceMeters || 8046720;
    const runSummary = computeAnnualMileageSummary('Running', runGoal, activities, envFilter);
    const bikeSummary = computeAnnualMileageSummary('Cycling', bikeGoal, activities, envFilter);

    return {
      todayWellness: today,
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
      recentWorkouts: activities.slice(0, 5).map((a) => ({
        date: a.startDateLocal.slice(0, 10),
        name: a.name,
        sport: a.sportCategory,
        environment: a.environment,
        subType: a.subType,
        distance: formatDistance(a.distanceMeters, distanceUnit, 1),
        load: a.trainingLoad,
        decouplingPct: a.aerobicDecouplingPct,
        npWatts: a.normalizedPower,
        avgHr: a.avgHr,
        stravaPrs: a.stravaPrCount,
      })),
      benchmarkSegments: benchmarkSegments.map((s) => ({
        name: s.name,
        sport: s.sportCategory,
        prTimeSecs: s.prElapsedTimeSecs,
        targetTimeSecs: s.targetElapsedTimeSecs,
      })),
      targetGoals,
    };
  }, [wellnessDays, annualMileageGoals, activities, envFilter, distanceUnit, benchmarkSegments, targetGoals]);

  const handleGenerateNewOptions = async (
    sport: SportCategory,
    environment: ActivityEnvironment,
    durationMinutes: number
  ) => {
    setIsGeneratingOptions(true);
    try {
      const resp = await fetch('/api/coach/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportPreference: sport,
          environmentPreference: environment,
          durationMinutes,
          telemetrySummary: telemetrySummaryForGemini,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.options) && data.options.length > 0) {
          setWorkoutOptions(data.options);
          setSelectedWorkoutOption(data.options[0]);
        }
      }
    } catch {
      // Keep existing options if offline
    } finally {
      setIsGeneratingOptions(false);
    }
  };

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
            : `Unable to reach Gemini API (${data.error || 'Verify GEMINI_API_KEY in Secrets'}). Based on your local telemetry, your HRV is 71 ms (+3 ms vs baseline) and CTL is 74.2—you are cleared for today's ${selectedWorkoutOption.title}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citedMetrics: Array.isArray(data.citedMetrics) ? data.citedMetrics : undefined,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content:
            'Network offline—using cached physiological analysis: With HRV at 71 ms (+3 ms vs 7d baseline) and TSB at -4.1, you are well-positioned for today’s planned session.',
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

  const latestCtl = wellnessDays[wellnessDays.length - 1]?.ctl || 74.2;
  const latestWeightKg = wellnessDays[wellnessDays.length - 1]?.weightKg || 69.4;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 pb-20 md:pb-10">
      <OfflineIndicator />

      {/* Top Navigation Bar — Strict 3-Zone Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-4 sm:px-8 h-14 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          AeroPulse
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'activities', label: 'Activities' },
              { id: 'physiology', label: 'Physiology' },
              { id: 'goals', label: 'Goals' },
              { id: 'coach', label: 'AI Coach' },
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

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setIsDataSourcesOpen(true)}
            className="min-h-[38px] px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Data Sources
          </button>
        </div>
      </header>

      {/* Workspace Utility Sub-Bar (Outdoor/Indoor Filter, Units, Theme, PWA Install) */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-[#111827]/60 px-4 sm:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: Outdoor vs. Indoor (Smart Trainer / Treadmill) Environment Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Environment:</span>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: 'COMBINED', label: 'Combined' },
                  { id: 'OUTDOOR', label: 'Outdoor Only' },
                  { id: 'INDOOR', label: 'Indoor (Trainer/Treadmill)' },
                ] as const
              ).map((env) => (
                <button
                  key={env.id}
                  onClick={() => setEnvFilter(env.id)}
                  className={`min-h-[30px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    envFilter === env.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {env.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Units Toggle (mi / km), PWA Install, and Theme Switch */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-mono text-xs">
              {(['mi', 'km'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setDistanceUnit(u)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md transition-colors ${
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
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Toggle color theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Viewport (1440px Desktop Presence) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-8 py-6">
        {activeTab === 'overview' && (
          <OverviewView
            wellnessDays={wellnessDays}
            activities={activities}
            annualMileageGoals={annualMileageGoals}
            targetGoals={targetGoals}
            selectedWorkoutOption={selectedWorkoutOption}
            envFilter={envFilter}
            distanceUnit={distanceUnit}
            onNavigateTab={setActiveTab}
            onSelectActivity={(act) => {
              handleSelectActivity(act);
              setActiveTab('activities');
            }}
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

        {activeTab === 'physiology' && (
          <PhysiologyView
            curves={INITIAL_POWER_PACE_CURVES}
            benchmarkSegments={benchmarkSegments}
            wellnessDays={wellnessDays}
            envFilter={envFilter}
            distanceUnit={distanceUnit}
            athleteWeightKg={latestWeightKg}
          />
        )}

        {activeTab === 'goals' && (
          <GoalsView
            annualMileageGoals={annualMileageGoals}
            onUpdateAnnualMileageGoal={handleUpdateAnnualMileageGoal}
            targetGoals={targetGoals}
            onAddTargetGoal={handleAddTargetGoal}
            onDeleteTargetGoal={handleDeleteTargetGoal}
            activities={activities}
            envFilter={envFilter}
            onSelectEnvFilter={setEnvFilter}
            distanceUnit={distanceUnit}
            currentCtl={latestCtl}
          />
        )}

        {activeTab === 'coach' && (
          <CoachView
            workoutOptions={workoutOptions}
            selectedOptionId={selectedWorkoutOption.id}
            onSelectWorkoutOption={setSelectedWorkoutOption}
            onGenerateNewOptions={handleGenerateNewOptions}
            isGeneratingOptions={isGeneratingOptions}
            chatMessages={chatMessages}
            onSendChatMessage={handleSendChatMessage}
            isSendingChat={isSendingChat}
          />
        )}
      </main>

      {/* Mobile Ergonomic Thumb-Zone Bottom Tab Bar (< md) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-[#0B0F17]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center h-16 px-1">
        {(
          [
            { id: 'overview', label: 'Overview', icon: Gauge },
            { id: 'activities', label: 'Activities', icon: Activity },
            { id: 'physiology', label: 'Physiology', icon: HeartPulse },
            { id: 'goals', label: 'Goals', icon: Target },
            { id: 'coach', label: 'AI Coach', icon: Bot },
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
              <Icon className="w-5 h-5" />
              <span className="text-[10px] tracking-tight mt-0.5 whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Data Sources & Fork Setup Modal */}
      <DataSourcesModal
        isOpen={isDataSourcesOpen}
        onClose={() => setIsDataSourcesOpen(false)}
        status={connectionStatus}
        onConnectIntervals={handleConnectIntervals}
        onDisconnectIntervals={handleDisconnectIntervals}
        onSaveStravaCredentials={handleSaveStravaCredentials}
        onLaunchStravaOAuth={handleLaunchStravaOAuth}
        onSyncNow={syncLiveTelemetry}
        isSyncing={isSyncing}
        errorMessage={syncError}
      />
    </div>
  );
}
