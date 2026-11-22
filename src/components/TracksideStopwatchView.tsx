import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AthleteProfile,
  ConnectedAthleteRecord,
  NcaaTrackFacilityType,
  TeamSummaryWithRole,
  TrackEnvironmentConditions,
  TrackFootwearClass,
  TrackLaneNumber,
  TrackRepDistanceMeters,
  UnifiedActivity,
} from '../types';
import {
  computeRaceStandings,
  computeRunnerSplitTelemetry,
  DEFAULT_POD_WAVE_OFFSETS,
  RACE_STOPWATCH_PRESETS,
  WORKOUT_STOPWATCH_PRESETS,
  useTracksideStopwatch,
  type RunnerSplitTelemetry,
} from '../hooks/useTracksideStopwatch';
import {
  computeTeamVdotPacingPods,
  computeTrackEnvironmentSplitAdjustment,
  computeWorldAthleticsOvalLaneGeometry,
  deriveThresholdPaceFromVdot,
  formatTrackMark,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import {
  buildTracksideStopwatchCsv,
  formatLocalWallClockIso,
  formatStopwatchClockMs,
  synthesizeTracksideRaceActivity,
  synthesizeTracksideWorkoutActivity,
} from '../utils/stopwatchActivitySynthesizer';
import { formatFatTime } from '../utils/officialRaceSynthesizer';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';
import {
  evaluateSquadLiveAutoRegulation,
  type RunnerLiveAutoRegInput,
} from '../physiology/trackLiveAutoRegulationEngine';
import { TracksideAutoRegBanner } from './track/TracksideAutoRegBanner';
import { TracksideRunnerCardsAndMatrix } from './stopwatch/TracksideRunnerCardsAndMatrix';
import { TracksideWalkOnAndSaveBar } from './stopwatch/TracksideWalkOnAndSaveBar';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  countPendingStopwatchOutboxEntries,
  type StopwatchOutboxFlushResult,
  type StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import {
  ArrowCounterClockwise,
  BellRinging,
  Check,
  CheckCircle2,
  Copy,
  DownloadSimple,
  FlagCheckered,
  Lightning,
  Lock,
  Pause,
  Play,
  Plus,
  ShareNetwork,
  SpeakerHigh,
  SpeakerSlash,
  SquaresFour,
  Sun,
  Table,
  Timer,
  Trash,
  Trophy,
  Users,
  Waves,
  WifiSlash,
} from './icons/PhosphorIcons';

export interface SavedStopwatchEntry {
  runnerId: string;
  runnerName: string;
  activity: UnifiedActivity;
}

export interface TracksideStopwatchViewProps {
  selfName: string;
  selfProfile: AthleteProfile;
  roster: ConnectedAthleteRecord[];
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  onSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  onFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  onOpenActivitiesTab: () => void;
  postSaveActionLabel?: string;
  onOpenRosterModal: () => void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

const REST_OPTIONS_SECS = [0, 30, 45, 60, 90, 120, 180] as const;

export const TracksideStopwatchView: React.FC<TracksideStopwatchViewProps> = ({
  selfName,
  selfProfile,
  roster,
  myTeams,
  activeTeamId,
  onSaveStopwatchActivities,
  onFlushStopwatchOutbox,
  onOpenActivitiesTab,
  postSaveActionLabel = 'View in Activities',
  onOpenRosterModal,
}) => {
  const {
    stopwatchRunning,
    stopwatchElapsedMs,
    nowEpochMs,
    sessionStartedEpochMs,
    athleteLapTimestampsSecs,
    tapHistory,
    extraPodAthletes,
    totalSplitCount,
    hasActiveSession,
    sessionType,
    viewMode,
    showChuteBar,
    workoutPresetId,
    customWorkoutSpec,
    raceEventLabel,
    restDurationSecs,
    waveMode,
    podWaveOffsetsSecs,
    chuteQueueSecs,
    runnerLastTapEpochMs,
    sessionTitle,
    soundEnabled,
    wakeLockEnabled,
    trackLane,
    isStaggeredStart,
    trackFacility,
    airTempF,
    dewPointF,
    windSpeedMps,
    altitudeMeters,
    footwearClass,
    autoRegPivotHistory,
    endedEarlyStimulusRatio,
    dismissedAutoRegSignatures,
    toggleStartPause,
    resetStopwatch,
    tapRunnerSplit,
    recordChuteTap,
    assignChuteToRunner,
    clearChuteQueue,
    undoLastSplit,
    setExtraPodAthletes,
    setSessionType,
    setViewMode,
    setShowChuteBar,
    setWorkoutPresetId,
    setRaceEventLabel,
    setRestDurationSecs,
    setWaveMode,
    setPodWaveOffset,
    triggerPodWaveNow,
    setSessionTitle,
    setSoundEnabled,
    setWakeLockEnabled,
    setTrackLane,
    setIsStaggeredStart,
    setTrackFacility,
    setAirTempF,
    setDewPointF,
    setWindSpeedMps,
    setAltitudeMeters,
    setFootwearClass,
    extendWorkoutRestPlus30s,
    convertRemainingToCv,
    endSessionStimulusAchieved,
    dismissAutoRegCue,
  } = useTracksideStopwatch(50);

  const [showEnvPhysicsPanel, setShowEnvPhysicsPanel] = useState<boolean>(false);
  const [showToolsDrawer, setShowToolsDrawer] = useState<boolean>(false);
  const [mobileSetupExpanded, setMobileSetupExpanded] = useState<boolean>(false);
  const [lastTappedRunnerId, setLastTappedRunnerId] = useState<string | null>(null);
  const tapFlashTimerRef = useRef<number | null>(null);
  const lastRunnerTapMsRef = useRef<Map<string, number>>(new Map());
  const holdPauseTimerRef = useRef<number | null>(null);
  const holdPauseSucceededRef = useRef<boolean>(false);
  const [isHoldingPause, setIsHoldingPause] = useState<boolean>(false);
  const [customRepOverride, setCustomRepOverride] = useState<number | null>(null);
  const [customDistOverride, setCustomDistOverride] = useState<TrackRepDistanceMeters | null>(null);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEYS.STOPWATCH_SHORTCUTS) !== '0'
        : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    setCustomRepOverride(null);
    setCustomDistOverride(null);
  }, [workoutPresetId]);

  const activeTeam = useMemo(
    () => myTeams.find((t) => t.brand.teamId === activeTeamId) || myTeams[0] || null,
    [myTeams, activeTeamId]
  );
  const isCoachingTeam =
    activeTeam?.myRole === 'HEAD_COACH' || activeTeam?.myRole === 'ASSISTANT_COACH';

  const [includeSelfRunner, setIncludeSelfRunner] = useState<boolean>(!isCoachingTeam);
  const [selectedPodFilter, setSelectedPodFilter] = useState<string>('ALL');
  const [runnerSearchQuery, setRunnerSearchQuery] = useState<string>('');
  const [pinnedRunnerIds, setPinnedRunnerIds] = useState<string[]>([]);
  const [onlyOnTrack, setOnlyOnTrack] = useState<boolean>(false);
  const [showPinStrip, setShowPinStrip] = useState<boolean>(false);
  const [walkOnName, setWalkOnName] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);
  const [includeWarmupCooldown, setIncludeWarmupCooldown] = useState<boolean>(true);
  const [saveFeedbackMsg, setSaveFeedbackMsg] = useState<string | null>(null);
  const [saveFeedbackTone, setSaveFeedbackTone] = useState<'prime' | 'caution'>('prime');
  const [isSavingToThresh, setIsSavingToThresh] = useState<boolean>(false);
  const [isFlushingOutbox, setIsFlushingOutbox] = useState<boolean>(false);
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(() =>
    countPendingStopwatchOutboxEntries(activeTeamId || undefined)
  );
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [wakeLockState, setWakeLockState] = useState<'ACTIVE' | 'IDLE' | 'UNSUPPORTED'>(() =>
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'IDLE' : 'UNSUPPORTED'
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setIncludeSelfRunner(!isCoachingTeam);
  }, [isCoachingTeam]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshOutboxCount = () => {
      setPendingOutboxCount(countPendingStopwatchOutboxEntries(activeTeamId || undefined));
    };
    refreshOutboxCount();
    const handleOnline = () => {
      setIsOnline(true);
      refreshOutboxCount();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshOutboxCount();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('thresh:stopwatch-outbox-updated', refreshOutboxCount);
    window.addEventListener('storage', refreshOutboxCount);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('thresh:stopwatch-outbox-updated', refreshOutboxCount);
      window.removeEventListener('storage', refreshOutboxCount);
    };
  }, [activeTeamId]);

  const handleManualFlushOutbox = async () => {
    if (!onFlushStopwatchOutbox || isFlushingOutbox) return;
    setIsFlushingOutbox(true);
    try {
      const flushRes = await onFlushStopwatchOutbox();
      setPendingOutboxCount(countPendingStopwatchOutboxEntries(activeTeamId || undefined));
      if (flushRes.syncedEntries > 0 && flushRes.remainingEntries === 0) {
        setSaveFeedbackTone('prime');
        setSaveFeedbackMsg(
          `Synced ${flushRes.syncedEntries} pending athlete stopwatch ${flushRes.syncedEntries === 1 ? 'log' : 'logs'} to team cloud roster.`
        );
      } else if (flushRes.remainingEntries > 0) {
        setSaveFeedbackTone('caution');
        setSaveFeedbackMsg(
          `Pending Sync: ${flushRes.remainingEntries} athlete ${flushRes.remainingEntries === 1 ? 'log' : 'logs'} queued on device until connection restores.`
        );
      }
    } finally {
      setIsFlushingOutbox(false);
    }
  };

  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);

  useEffect(() => {
    if (!copiedCsv) return;
    const timer = window.setTimeout(() => setCopiedCsv(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copiedCsv]);

  // Screen Wake Lock API: keep display awake immediately while Stopwatch is active & recover after visibility changes
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockState('UNSUPPORTED');
      return;
    }
    let cancelled = false;
    let attachedSentinel: WakeLockSentinelLike | null = null;
    const handleSentinelRelease = () => {
      if (!cancelled) {
        wakeLockSentinelRef.current = null;
        setWakeLockState('IDLE');
      }
    };
    const detachSentinel = () => {
      if (attachedSentinel) {
        attachedSentinel.removeEventListener?.('release', handleSentinelRelease);
        attachedSentinel = null;
      }
    };

    const acquireLock = async () => {
      if (!wakeLockEnabled) {
        detachSentinel();
        if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
          await wakeLockSentinelRef.current.release().catch(() => {});
        }
        wakeLockSentinelRef.current = null;
        if (!cancelled) setWakeLockState('IDLE');
        return;
      }
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock) {
          const sentinel = await nav.wakeLock.request('screen');
          if (cancelled) {
            await sentinel.release().catch(() => {});
          } else {
            detachSentinel();
            sentinel.addEventListener?.('release', handleSentinelRelease);
            attachedSentinel = sentinel;
            wakeLockSentinelRef.current = sentinel;
            setWakeLockState('ACTIVE');
          }
        }
      } catch {
        if (!cancelled) setWakeLockState('IDLE');
      }
    };

    void acquireLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wakeLockEnabled) {
        void acquireLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      detachSentinel();
      if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
        void wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
    };
  }, [wakeLockEnabled]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const prevPad = document.documentElement.style.scrollPaddingBottom;
      document.documentElement.style.scrollPaddingBottom = '104px';
      return () => {
        document.documentElement.style.scrollPaddingBottom = prevPad;
        if (holdPauseTimerRef.current !== null) {
          window.clearTimeout(holdPauseTimerRef.current);
          holdPauseTimerRef.current = null;
        }
      };
    }
    return () => {
      if (holdPauseTimerRef.current !== null) {
        window.clearTimeout(holdPauseTimerRef.current);
        holdPauseTimerRef.current = null;
      }
    };
  }, []);

  const playFeedback = useCallback(
    (kind: 'GUN' | 'SPLIT' | 'CHUTE' | 'BELL') => {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(kind === 'BELL' ? [20, 40, 20] : 15);
        }
      } catch {
        // ignore vibration errors
      }
      if (!soundEnabled || typeof window === 'undefined') return;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) {
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          void ctx.resume();
        }
        const playTone = (freq: number, delaySec: number, durationSec: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + delaySec);
          gain.gain.setValueAtTime(0.3, ctx.currentTime + delaySec);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delaySec + durationSec);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + delaySec);
          osc.stop(ctx.currentTime + delaySec + durationSec);
        };
        if (kind === 'BELL') {
          playTone(1046, 0, 0.05);
          playTone(1318, 0.07, 0.06);
        } else if (kind === 'GUN') {
          playTone(1046, 0, 0.055);
        } else if (kind === 'CHUTE') {
          playTone(660, 0, 0.035);
        } else {
          playTone(880, 0, 0.035);
        }
      } catch {
        // ignore Web Audio restrictions
      }
    },
    [soundEnabled]
  );

  const customPlanPreset = useMemo(() => {
    if (!customWorkoutSpec) return null;
    return {
      id: 'custom-plan',
      label:
        sessionTitle ||
        `${customWorkoutSpec.repCount} x ${customWorkoutSpec.repDistanceMeters}m · ${customWorkoutSpec.zoneCode}`,
      repCount: customWorkoutSpec.repCount,
      repDistanceMeters: customWorkoutSpec.repDistanceMeters,
      intensity: customWorkoutSpec.podIntensity,
      defaultRestSecs: customWorkoutSpec.restDurationSecs,
    };
  }, [customWorkoutSpec, sessionTitle]);

  const baseWorkoutPreset = useMemo(
    () =>
      (workoutPresetId === 'custom-plan' && customPlanPreset ? customPlanPreset : null) ||
      WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === workoutPresetId) ||
      WORKOUT_STOPWATCH_PRESETS[0],
    [workoutPresetId, customPlanPreset]
  );

  const activeWorkoutPreset = useMemo(() => {
    const repCount = customRepOverride ?? baseWorkoutPreset.repCount;
    const repDistanceMeters = customDistOverride ?? baseWorkoutPreset.repDistanceMeters;
    const isOverridden =
      customRepOverride !== null || customDistOverride !== null;
    return {
      ...baseWorkoutPreset,
      repCount,
      repDistanceMeters,
      label: isOverridden
        ? `${repCount} x ${repDistanceMeters}m · Custom`
        : baseWorkoutPreset.label,
    };
  }, [baseWorkoutPreset, customRepOverride, customDistOverride]);

  const activeRacePreset = useMemo(
    () =>
      RACE_STOPWATCH_PRESETS.find((p) => p.label === raceEventLabel) ||
      RACE_STOPWATCH_PRESETS[3],
    [raceEventLabel]
  );

  const connectedRoster = useMemo(
    () => roster.filter((a) => a.status === 'CONNECTED'),
    [roster]
  );

  const rosterInputs = useMemo<VdotPodRosterInput[]>(() => {
    const showSelf =
      includeSelfRunner ||
      (connectedRoster.length === 0 && extraPodAthletes.length === 0) ||
      Boolean(athleteLapTimestampsSecs.SELF?.length);
    return [
      ...(showSelf
        ? [
            {
              id: 'SELF',
              name: selfName || 'Athlete',
              thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 240,
            },
          ]
        : []),
      ...connectedRoster.map((c) => ({
        id: c.id,
        name: c.name,
        thresholdPaceSecsPerKm: c.athleteProfile.thresholdPaceSecsPerKm || 245,
      })),
      ...extraPodAthletes,
    ];
  }, [
    includeSelfRunner,
    connectedRoster,
    extraPodAthletes,
    selfName,
    selfProfile.thresholdPaceSecsPerKm,
  ]);

  const environmentConditions = useMemo<TrackEnvironmentConditions>(
    () => ({
      lane: trackLane,
      isStaggeredStart,
      facility: trackFacility,
      ...(typeof airTempF === 'number' ? { airTempF } : {}),
      ...(typeof dewPointF === 'number' ? { dewPointF } : {}),
      windSpeedMps,
      altitudeMeters,
    }),
    [
      trackLane,
      isStaggeredStart,
      trackFacility,
      airTempF,
      dewPointF,
      windSpeedMps,
      altitudeMeters,
    ]
  );

  const vdotPods = useMemo(
    () =>
      computeTeamVdotPacingPods({
        roster: rosterInputs,
        intensity: activeWorkoutPreset.intensity,
        repCount: activeWorkoutPreset.repCount,
        repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
        recoveryLabel: restDurationSecs > 0 ? `${restDurationSecs}s rest` : 'Open rest',
        environment: environmentConditions,
      }),
    [rosterInputs, activeWorkoutPreset, restDurationSecs, environmentConditions]
  );

  const laneGeometry = useMemo(
    () => computeWorldAthleticsOvalLaneGeometry(trackLane),
    [trackLane]
  );

  const activeEnvAdjustment = useMemo(() => {
    const primaryPod = vdotPods[0];
    const baseSplit =
      customWorkoutSpec?.targetSplitSecs && customWorkoutSpec.targetSplitSecs > 0
        ? customWorkoutSpec.targetSplitSecs
        : primaryPod?.splitsSecs
          ? Number(
              ((primaryPod.targetPaceSecsPerKm / (primaryPod.environmentAdjustment?.combinedSplitMultiplier || 1) / 1000) * activeWorkoutPreset.repDistanceMeters).toFixed(1)
            )
          : 72;
    return computeTrackEnvironmentSplitAdjustment({
      baseTargetSplitSecs: baseSplit,
      repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
      baseRestDurationSecs: restDurationSecs,
      intensity: activeWorkoutPreset.intensity,
      zoneCode: customWorkoutSpec?.zoneCode,
      environment: environmentConditions,
      isIntervalSession: sessionType === 'WORKOUT',
    });
  }, [
    vdotPods,
    customWorkoutSpec,
    activeWorkoutPreset,
    restDurationSecs,
    environmentConditions,
    sessionType,
  ]);

  const runnerPodLookup = useMemo(() => {
    const map = new Map<string, { podKey: string; targetLapSecs: number }>();
    const hasCustomTargetSplit =
      workoutPresetId === 'custom-plan' &&
      typeof customWorkoutSpec?.targetSplitSecs === 'number' &&
      customWorkoutSpec.targetSplitSecs > 0;
    const directCustomSplitSecs = hasCustomTargetSplit
      ? computeTrackEnvironmentSplitAdjustment({
          baseTargetSplitSecs: customWorkoutSpec!.targetSplitSecs!,
          repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
          baseRestDurationSecs: restDurationSecs,
          zoneCode: customWorkoutSpec?.zoneCode,
          intensity: activeWorkoutPreset.intensity,
          environment: environmentConditions,
          isIntervalSession: true,
        }).adjustedTargetSplitSecs
      : null;

    for (const pod of vdotPods) {
      const podKey = pod.podName.split(' — ')[0] || pod.podName;
      const podSplitSecs =
        hasCustomTargetSplit && rosterInputs.length <= 1 && directCustomSplitSecs !== null
          ? directCustomSplitSecs
          : pod.targetRepSplitSecs ??
            Number(
              ((pod.targetPaceSecsPerKm / 1000) * activeWorkoutPreset.repDistanceMeters).toFixed(1)
            );
      for (const athlete of pod.athletes) {
        const athleteTarget =
          athlete.id === 'SELF' && directCustomSplitSecs !== null
            ? directCustomSplitSecs
            : podSplitSecs;
        map.set(athlete.id, { podKey, targetLapSecs: athleteTarget });
      }
    }
    return map;
  }, [
    vdotPods,
    activeWorkoutPreset.repDistanceMeters,
    activeWorkoutPreset.intensity,
    workoutPresetId,
    customWorkoutSpec,
    rosterInputs.length,
    restDurationSecs,
    environmentConditions,
  ]);

  const activePodKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of rosterInputs) {
      const key = runnerPodLookup.get(r.id)?.podKey || 'Pod A';
      if (!keys.includes(key)) keys.push(key);
    }
    return keys.length > 0 ? keys : ['Pod A'];
  }, [rosterInputs, runnerPodLookup]);

  const targetRaceLaps = sessionType === 'RACE' ? activeRacePreset.targetLaps : null;

  const runnerTelemetries = useMemo<RunnerSplitTelemetry[]>(() => {
    const rawList = rosterInputs.map((r) => {
      const podInfo = runnerPodLookup.get(r.id) || { podKey: 'Pod A', targetLapSecs: 75 };
      const waveOffset =
        podWaveOffsetsSecs[podInfo.podKey] ??
        DEFAULT_POD_WAVE_OFFSETS[podInfo.podKey] ??
        0;
      return computeRunnerSplitTelemetry({
        runnerId: r.id,
        runnerName: r.name,
        podKey: podInfo.podKey,
        rawTimestampsSecs: athleteLapTimestampsSecs[r.id] || [],
        waveMode,
        waveOffsetSecs: waveOffset,
        targetLapSecs:
          sessionType === 'WORKOUT' ? podInfo.targetLapSecs : null,
        targetRaceLaps,
        sessionType,
        restDurationSecs,
        lastTapEpochMs: runnerLastTapEpochMs[r.id],
        nowEpochMs,
      });
    });
    return sessionType === 'RACE' ? computeRaceStandings(rawList) : rawList;
  }, [
    rosterInputs,
    runnerPodLookup,
    podWaveOffsetsSecs,
    athleteLapTimestampsSecs,
    waveMode,
    targetRaceLaps,
    sessionType,
    restDurationSecs,
    runnerLastTapEpochMs,
    nowEpochMs,
  ]);

  const filteredTelemetries = useMemo(() => {
    const cleanQuery = runnerSearchQuery.trim().toLowerCase();
    return runnerTelemetries.filter((t) => {
      if (selectedPodFilter !== 'ALL' && t.podKey !== selectedPodFilter) return false;
      if (onlyOnTrack && pinnedRunnerIds.length > 0 && !pinnedRunnerIds.includes(t.runnerId)) {
        return false;
      }
      if (cleanQuery && !t.runnerName.toLowerCase().includes(cleanQuery)) return false;
      return true;
    });
  }, [runnerTelemetries, selectedPodFilter, runnerSearchQuery, onlyOnTrack, pinnedRunnerIds]);

  const maxColumnsInMatrix = useMemo(
    () => Math.max(1, ...filteredTelemetries.map((t) => t.lapSplitsSecs.length)),
    [filteredTelemetries]
  );

  const squadAutoRegSummary = useMemo(() => {
    if (sessionType !== 'WORKOUT') {
      return evaluateSquadLiveAutoRegulation([], dismissedAutoRegSignatures);
    }
    const rosterProfileById = new Map(roster.map((r) => [r.id, r.athleteProfile]));
    const inputs: RunnerLiveAutoRegInput[] = runnerTelemetries.map((t) => {
      const athProf = t.runnerId === 'SELF' ? selfProfile : rosterProfileById.get(t.runnerId);
      const podMeta = runnerPodLookup.get(t.runnerId);
      return {
        runnerId: t.runnerId,
        runnerName: t.runnerName,
        podKey: t.podKey,
        lapSplitsSecs: t.lapSplitsSecs,
        plannedRepCount: activeWorkoutPreset.repCount,
        repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
        restDurationSecs,
        thresholdPaceSecsPerKm: athProf?.thresholdPaceSecsPerKm || selfProfile.thresholdPaceSecsPerKm || 245,
        targetSplitSecs: podMeta?.targetLapSecs ?? null,
        intensity: activeWorkoutPreset.intensity,
        zoneCode: customWorkoutSpec?.zoneCode,
      };
    });
    return evaluateSquadLiveAutoRegulation(inputs, dismissedAutoRegSignatures);
  }, [
    sessionType,
    runnerTelemetries,
    roster,
    selfProfile,
    runnerPodLookup,
    activeWorkoutPreset,
    restDurationSecs,
    customWorkoutSpec?.zoneCode,
    dismissedAutoRegSignatures,
  ]);

  useEffect(() => {
    return () => {
      if (tapFlashTimerRef.current !== null) {
        window.clearTimeout(tapFlashTimerRef.current);
      }
    };
  }, []);

  const triggerRunnerTapFlash = useCallback((runnerId: string) => {
    setLastTappedRunnerId(runnerId);
    if (tapFlashTimerRef.current !== null) {
      window.clearTimeout(tapFlashTimerRef.current);
    }
    tapFlashTimerRef.current = window.setTimeout(() => {
      setLastTappedRunnerId((prev) => (prev === runnerId ? null : prev));
      tapFlashTimerRef.current = null;
    }, 350);
  }, []);

  const handleRunnerAction = useCallback(
    (telemetry: RunnerSplitTelemetry) => {
      if (telemetry.isFinishedLocked) {
        setLiveAnnouncement(
          `${telemetry.runnerName} is Finish-Locked at ${telemetry.lapCount} laps. Use Undo Last to unlock.`
        );
        return;
      }

      // 350ms per-runner anti-double-tap debounce prevents rain/thumb bounce from double-tapping Chute or splits
      const nowTapMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const prevTapMs = lastRunnerTapMsRef.current.get(telemetry.runnerId) ?? 0;
      if (nowTapMs - prevTapMs < 350) {
        return;
      }
      lastRunnerTapMsRef.current.set(telemetry.runnerId, nowTapMs);

      if (chuteQueueSecs.length > 0) {
        const assigned = assignChuteToRunner(telemetry.runnerId, telemetry.runnerName, {
          maxRaceLaps: targetRaceLaps,
        });
        if (assigned !== null) {
          triggerRunnerTapFlash(telemetry.runnerId);
          const nextLap = telemetry.lapCount + 1;
          const hitsBell =
            sessionType === 'RACE' &&
            targetRaceLaps !== null &&
            targetRaceLaps >= 2 &&
            nextLap === targetRaceLaps - 1;
          playFeedback(hitsBell ? 'BELL' : 'SPLIT');
          setLiveAnnouncement(
            `Assigned Chute mark ${formatTrackMark(assigned, 2)} to ${telemetry.runnerName} (Lap ${nextLap})`
          );
        }
        return;
      }

      const stamped = tapRunnerSplit(telemetry.runnerId, telemetry.runnerName, {
        maxRaceLaps: targetRaceLaps,
      });
      triggerRunnerTapFlash(telemetry.runnerId);
      const nextLap = telemetry.lapCount + 1;
      const hitsBell =
        sessionType === 'RACE' &&
        targetRaceLaps !== null &&
        targetRaceLaps >= 2 &&
        nextLap === targetRaceLaps - 1;
      playFeedback(hitsBell ? 'BELL' : 'SPLIT');
      setLiveAnnouncement(
        `${telemetry.runnerName} split ${nextLap} recorded at ${formatTrackMark(stamped, 2)}`
      );
    },
    [
      chuteQueueSecs.length,
      assignChuteToRunner,
      tapRunnerSplit,
      targetRaceLaps,
      sessionType,
      playFeedback,
      triggerRunnerTapFlash,
    ]
  );

  const handleChuteTap = useCallback(() => {
    const queued = recordChuteTap();
    playFeedback('CHUTE');
    setLiveAnnouncement(
      `Queued Chute mark #${chuteQueueSecs.length + 1} at ${formatTrackMark(queued, 2)}`
    );
  }, [recordChuteTap, chuteQueueSecs.length, playFeedback]);

  const handleGunToggle = useCallback(() => {
    if (!stopwatchRunning) {
      setMobileSetupExpanded(false);
    }
    toggleStartPause();
    playFeedback('GUN');
    setLiveAnnouncement(stopwatchRunning ? 'Stopwatch paused' : 'Stopwatch started');
  }, [toggleStartPause, playFeedback, stopwatchRunning]);

  const handleUndo = useCallback(() => {
    const undone = undoLastSplit();
    if (undone) {
      playFeedback('CHUTE');
      setLiveAnnouncement(
        `Undid ${undone.runnerName} mark at ${formatTrackMark(undone.timestampSecs, 2)}`
      );
    }
  }, [undoLastSplit, playFeedback]);

  // Trackside Physical Keyboard Accelerators (WCAG 2.1.4 user-toggleable): Space = Gun, 1–9 = Lane 1–9, C = Chute, Z = Undo
  useEffect(() => {
    if (!keyboardShortcutsEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
      if (e.code === 'Space' && target?.tagName !== 'BUTTON') {
        e.preventDefault();
        handleGunToggle();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (!showChuteBar) setShowChuteBar(true);
        handleChuteTap();
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const laneIdx = Number(e.key) - 1;
        const laneRunner = filteredTelemetries[laneIdx];
        if (laneRunner) {
          e.preventDefault();
          handleRunnerAction(laneRunner);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    keyboardShortcutsEnabled,
    handleGunToggle,
    handleChuteTap,
    handleUndo,
    handleRunnerAction,
    filteredTelemetries,
    showChuteBar,
    setShowChuteBar,
  ]);

  const handleAddWalkOn = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = walkOnName.trim();
    if (!cleanName) return;
    const numericVdot = 50;
    const walkOn: VdotPodRosterInput = {
      id: `walkon-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: cleanName,
      vdotOverride: numericVdot,
      thresholdPaceSecsPerKm: deriveThresholdPaceFromVdot(numericVdot),
    };
    setExtraPodAthletes((prev) => [...prev, walkOn]);
    setWalkOnName('');
    setSaveFeedbackMsg(null);
  };

  const handleRemoveWalkOn = (id: string) => {
    setExtraPodAthletes((prev) => prev.filter((a) => a.id !== id));
  };

  const buildCsvPayload = () =>
    buildTracksideStopwatchCsv({
      sessionType,
      sessionTitle,
      presetOrEventLabel:
        sessionType === 'RACE' ? activeRacePreset.label : activeWorkoutPreset.label,
      telemetries: runnerTelemetries,
    });

  const handleCopyCsv = async () => {
    const csv = buildCsvPayload();
    try {
      await navigator.clipboard.writeText(csv);
      setCopiedCsv(true);
      setLiveAnnouncement('Split sheet CSV copied to clipboard');
    } catch {
      // Fallback hidden textarea copy if clipboard permission restricted
      const ta = document.createElement('textarea');
      ta.value = csv;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedCsv(true);
    }
  };

  const handleDownloadCsv = () => {
    const csv = buildCsvPayload();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = getLocalDateIso();
    const slug = (sessionType === 'RACE' ? activeRacePreset.label : activeWorkoutPreset.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    link.href = url;
    link.download = `meetready-stopwatch-${sessionType.toLowerCase()}-${slug}-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLiveAnnouncement('Downloaded trackside splits CSV');
  };

  const handleShareStopwatchCard = () => {
    const timed = runnerTelemetries.filter((t) => t.lapCount > 0 && t.netTotalSecs !== null);
    if (timed.length === 0) return;
    const teamName = myTeams.find((tm) => tm.brand.teamId === activeTeamId)?.brand.name;
    const presetLabel =
      sessionType === 'RACE' ? activeRacePreset.label : activeWorkoutPreset.label;
    openShareWorkoutRoute({
      kind: 'STOPWATCH',
      version: 1,
      title: sessionTitle.trim() || `${presetLabel} Splits`,
      sport: 'Running',
      date: getLocalDateIso(),
      description: `${presetLabel} · ${timed.length} timed ${timed.length === 1 ? 'athlete' : 'athletes'}`,
      teamName,
      referenceThresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
      splits: timed.slice(0, 16).map((t) => ({
        label: `${t.runnerName} (${t.lapCount} ${t.lapCount === 1 ? 'lap' : 'laps'})`,
        lapTime: formatStopwatchClockMs((t.netTotalSecs ?? 0) * 1000),
        paceOrPower:
          t.lapSplitsSecs.length > 0
            ? `Last ${formatStopwatchClockMs(t.lapSplitsSecs[t.lapSplitsSecs.length - 1] * 1000)}`
            : undefined,
      })),
    });
  };

  const handleSaveToThresh = async () => {
    const timed = runnerTelemetries.filter((t) => t.lapCount > 0 && t.netTotalSecs !== null);
    if (timed.length === 0 || isSavingToThresh) return;

    const rosterById = new Map(roster.map((r) => [r.id, r]));
    const derivedStartMs =
      sessionStartedEpochMs ?? Math.max(0, Date.now() - Math.max(0, stopwatchElapsedMs));
    const startDateLocalIso = formatLocalWallClockIso(derivedStartMs);

    const entries: SavedStopwatchEntry[] = timed.map((t) => {
      const targetId = t.runnerId;
      const athleteProfileForTarget =
        targetId === 'SELF'
          ? selfProfile
          : rosterById.get(targetId)?.athleteProfile || selfProfile;
      const lthr = athleteProfileForTarget.lthr || 172;
      const maxHr = athleteProfileForTarget.maxHr || 194;
      const tPace = athleteProfileForTarget.thresholdPaceSecsPerKm || 240;

      const activity =
        sessionType === 'RACE'
          ? synthesizeTracksideRaceActivity({
              runnerId: t.runnerId,
              runnerName: t.runnerName,
              lthr,
              maxHr,
              sessionTitle,
              eventLabel: activeRacePreset.label,
              eventDistanceMeters: activeRacePreset.distanceMeters,
              lapSplitDistanceMeters: activeRacePreset.splitMeters,
              lapSplitsSecs: t.lapSplitsSecs,
              netTotalSecs: t.netTotalSecs ?? 0,
              placeFinish: t.placeLabel ? `${t.placeLabel} (Stopwatch)` : undefined,
              includeWarmupCooldown,
              startDateLocalIso,
              startDateUtcMs: derivedStartMs,
              lane: trackLane,
            })
          : synthesizeTracksideWorkoutActivity({
              runnerId: t.runnerId,
              runnerName: t.runnerName,
              thresholdPaceSecsPerKm: tPace,
              lthr,
              maxHr,
              sessionTitle,
              presetLabel: activeWorkoutPreset.label,
              repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
              restDurationSecs,
              lapSplitsSecs: t.lapSplitsSecs,
              startDateLocalIso,
              startDateUtcMs: derivedStartMs,
              lane: trackLane,
              footwearClass,
              trackFacility,
              stimulusCompletionRatio: endedEarlyStimulusRatio ?? undefined,
              autoRegPivotSummary:
                autoRegPivotHistory.length > 0
                  ? autoRegPivotHistory.map((p) => p.summary).join(' · ')
                  : undefined,
              multiSetSpec: customWorkoutSpec,
            });

      return {
        runnerId: targetId,
        runnerName: t.runnerName,
        activity,
      };
    });

    setIsSavingToThresh(true);
    try {
      const rawResult = await onSaveStopwatchActivities(entries);
      const saveResult: StopwatchSaveResult =
        typeof rawResult === 'number'
          ? {
              savedCount: rawResult,
              selfCount: rawResult,
              rosterCount: 0,
              teamCount: 0,
              walkOnCount: 0,
              pendingTeamCount: 0,
              skippedReadOnlyNames: [],
              syncStatus: 'LOCAL_ONLY',
            }
          : rawResult;

      setPendingOutboxCount(countPendingStopwatchOutboxEntries(activeTeamId || undefined));

      if (saveResult.savedCount === 0) {
        setSaveFeedbackTone('caution');
        setSaveFeedbackMsg(
          saveResult.skippedReadOnlyNames.length > 0
            ? `Skipped read-only teammate logs (${saveResult.skippedReadOnlyNames.join(', ')}).`
            : 'No writable athlete logs selected.'
        );
        return;
      }

      const parts: string[] = [];
      if (saveResult.syncStatus === 'PENDING_OFFLINE') {
        setSaveFeedbackTone('caution');
        parts.push(
          `Saved ${saveResult.savedCount} ${sessionType === 'RACE' ? 'Race' : 'Interval'} ${
            saveResult.savedCount === 1 ? 'Log' : 'Logs'
          } locally — Pending Sync (${saveResult.pendingTeamCount} team ${
            saveResult.pendingTeamCount === 1 ? 'entry' : 'entries'
          } queued until back online).`
        );
      } else {
        setSaveFeedbackTone('prime');
        parts.push(
          sessionType === 'RACE'
            ? `Saved ${saveResult.savedCount} Official Race ${saveResult.savedCount === 1 ? 'Mark' : 'Marks'} into MeetReady Activities.`
            : endedEarlyStimulusRatio !== null
              ? `Saved ${saveResult.savedCount} Interval Workout ${saveResult.savedCount === 1 ? 'Log' : 'Logs'} (${Math.round(endedEarlyStimulusRatio * 100)}% quality stimulus preserved) into MeetReady Activities.`
              : `Saved ${saveResult.savedCount} Interval Workout ${saveResult.savedCount === 1 ? 'Log' : 'Logs'} (rTSS computed) into MeetReady Activities.`
        );
      }

      if (saveResult.walkOnCount > 0) {
        parts.push(
          `${saveResult.walkOnCount} walk-on ${saveResult.walkOnCount === 1 ? 'entry' : 'entries'} saved to local Walk-On Archive (kept separate from your personal log).`
        );
      }
      if (saveResult.skippedReadOnlyNames.length > 0) {
        parts.push(`Skipped read-only: ${saveResult.skippedReadOnlyNames.join(', ')}.`);
      }

      setSaveFeedbackMsg(parts.join(' '));
    } finally {
      setIsSavingToThresh(false);
    }
  };

  const renderModeRadioGroup = (compact = false) => (
    <div
      role="radiogroup"
      aria-label="Session Mode"
      className="inline-flex items-center gap-1 p-0.5 sm:p-1 rounded-xl liquid-capsule-track shrink-0"
    >
      <button
        type="button"
        role="radio"
        aria-checked={sessionType === 'WORKOUT'}
        data-testid="stopwatch-mode-workout"
        onClick={() => {
          setSessionType('WORKOUT');
          setSaveFeedbackMsg(null);
        }}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 rounded-lg font-bold transition-all cursor-pointer ${
          compact ? 'px-2 text-2xs' : 'px-3.5 py-1.5 text-xs gap-1.5'
        } ${
          sessionType === 'WORKOUT'
            ? 'liquid-capsule-active'
            : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-chalk'
        }`}
      >
        <Timer className={compact ? 'w-3.5 h-3.5 ap-text-brand' : 'w-4 h-4 ap-text-brand'} weight="duotone" />
        <span>WORKOUT</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={sessionType === 'RACE'}
        data-testid="stopwatch-mode-race"
        onClick={() => {
          setSessionType('RACE');
          setSaveFeedbackMsg(null);
        }}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 rounded-lg font-bold transition-all cursor-pointer ${
          compact ? 'px-2 text-2xs' : 'px-3.5 py-1.5 text-xs gap-1.5'
        } ${
          sessionType === 'RACE'
            ? 'liquid-capsule-active'
            : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-chalk'
        }`}
      >
        <FlagCheckered
          className={compact ? 'w-3.5 h-3.5 text-[#D97706]' : 'w-4 h-4 text-[#D97706]'}
          weight="duotone"
        />
        <span>RACE</span>
      </button>
    </div>
  );

  const renderPresetSelect = (compact = false) =>
    sessionType === 'WORKOUT' ? (
      <select
        aria-label="Workout Preset"
        value={workoutPresetId}
        onChange={(e) => setWorkoutPresetId(e.target.value)}
        className={`min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset font-sans font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-[#56BA00] ${
          compact ? 'max-w-[168px] px-2 text-2xs shrink-0' : 'w-full px-3 text-xs'
        }`}
      >
        {customPlanPreset && (
          <option
            value="custom-plan"
            className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
          >
            Planned: {customPlanPreset.label}
          </option>
        )}
        {WORKOUT_STOPWATCH_PRESETS.map((p) => (
          <option
            key={p.id}
            value={p.id}
            className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
          >
            {p.label}
          </option>
        ))}
      </select>
    ) : (
      <select
        aria-label="Race Event Distance"
        value={raceEventLabel}
        onChange={(e) => setRaceEventLabel(e.target.value)}
        className={`min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset font-sans font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-[#56BA00] ${
          compact ? 'max-w-[155px] px-2 text-2xs shrink-0' : 'w-full px-3 text-xs'
        }`}
      >
        {RACE_STOPWATCH_PRESETS.map((evt) => (
          <option
            key={evt.label}
            value={evt.label}
            className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
          >
            {evt.label}
            {evt.targetLaps ? ` (${evt.targetLaps} x ${evt.splitMeters}m)` : ' (Open Laps)'}
          </option>
        ))}
      </select>
    );

  const recoverySelectNode = (
    <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
      <span>Auto Recovery Countdown</span>
      <select
        aria-label="Recovery Countdown"
        value={restDurationSecs}
        onChange={(e) => setRestDurationSecs(Number(e.target.value))}
        className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-[#56BA00]"
      >
        {REST_OPTIONS_SECS.map((sec) => (
          <option
            key={sec}
            value={sec}
            className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
          >
            {sec === 0 ? 'Off (Continuous)' : `${sec}s Recovery Timer`}
          </option>
        ))}
        {!REST_OPTIONS_SECS.includes(restDurationSecs as (typeof REST_OPTIONS_SECS)[number]) && (
          <option
            value={restDurationSecs}
            className="bg-white dark:bg-ap-carbon text-ap-ink dark:text-ap-chalk"
          >
            {restDurationSecs}s Recovery Timer (Auto-Reg)
          </option>
        )}
      </select>
    </label>
  );

  const sessionTitleInputNode = (
    <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
      <span>{sessionType === 'RACE' ? 'Meet / Heat Name' : 'Session Name'}</span>
      <input
        type="text"
        value={sessionTitle}
        onChange={(e) => setSessionTitle(e.target.value)}
        placeholder={
          sessionType === 'RACE' ? 'e.g. League Finals Heat 1' : 'e.g. Tuesday Track Intervals'
        }
        aria-label="Meet or Session Name"
        className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-sans text-ap-ink dark:text-ap-chalk placeholder:text-ap-muted dark:placeholder:text-ap-muted-dark focus:outline-none focus:ring-2 focus:ring-[#56BA00]"
      />
    </label>
  );

  const toggleKeyboardShortcuts = () => {
    setKeyboardShortcutsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEYS.STOPWATCH_SHORTCUTS, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const hardwareTogglesNode = (
    <div className="flex flex-col gap-1 text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark">
      <span>Trackside Hardware &amp; Keys</span>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          aria-pressed={wakeLockEnabled}
          onClick={() => setWakeLockEnabled(!wakeLockEnabled)}
          className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
            wakeLockEnabled
              ? wakeLockState === 'ACTIVE'
                ? 'ap-status-prime'
                : 'ap-status-info'
              : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
          }`}
          title="Keep mobile display awake while timing live track sessions"
        >
          <Sun className="w-3.5 h-3.5 shrink-0" weight="bold" />
          <span className="truncate">
            {wakeLockEnabled ? (wakeLockState === 'ACTIVE' ? 'Awake On' : 'Wake Ready') : 'Wake Off'}
          </span>
        </button>

        <button
          type="button"
          aria-pressed={soundEnabled}
          onClick={() => setSoundEnabled(!soundEnabled)}
          className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
            soundEnabled ? 'ap-status-info' : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
          }`}
          title="Play crisp Web Audio confirmation beep + vibration on splits"
        >
          {soundEnabled ? (
            <SpeakerHigh className="w-3.5 h-3.5 shrink-0" weight="bold" />
          ) : (
            <SpeakerSlash className="w-3.5 h-3.5 shrink-0" weight="bold" />
          )}
          <span>{soundEnabled ? 'Beep On' : 'Muted'}</span>
        </button>

        <button
          type="button"
          data-testid="stopwatch-shortcuts-toggle"
          aria-pressed={keyboardShortcutsEnabled}
          onClick={toggleKeyboardShortcuts}
          className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1 px-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
            keyboardShortcutsEnabled
              ? 'ap-status-info'
              : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
          }`}
          title="Enable or disable single-key shortcuts (Space, 1-9, C, Z)"
        >
          <span>{keyboardShortcutsEnabled ? 'Keys On' : 'Keys Off'}</span>
        </button>
      </div>
    </div>
  );

  const waveModeButtonsNode = (
    <div
      role="group"
      aria-label="Start Wave Mode"
      className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl liquid-capsule-track"
    >
      <button
        type="button"
        aria-pressed={waveMode === 'MASS'}
        onClick={() => setWaveMode('MASS')}
        className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
          waveMode === 'MASS'
            ? 'liquid-capsule-active'
            : 'text-ap-muted dark:text-ap-muted-dark'
        }`}
      >
        Mass Gun
      </button>
      <button
        type="button"
        data-testid="stopwatch-wave-toggle"
        aria-pressed={waveMode === 'POD_STAGGER'}
        onClick={() => {
          const nextMode = waveMode === 'POD_STAGGER' ? 'MASS' : 'POD_STAGGER';
          setWaveMode(nextMode);
          if (nextMode === 'POD_STAGGER') {
            for (const [podKey, defOffset] of Object.entries(DEFAULT_POD_WAVE_OFFSETS)) {
              setPodWaveOffset(podKey, defOffset);
            }
          }
        }}
        className={`min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
          waveMode === 'POD_STAGGER'
            ? 'liquid-capsule-active ap-status-caution font-bold'
            : 'text-ap-muted dark:text-ap-muted-dark'
        }`}
      >
        <Waves className="w-3.5 h-3.5" weight="bold" />
        <span>Pod +10s</span>
      </button>
      <button
        type="button"
        data-testid="stopwatch-wave-pursuit"
        aria-pressed={waveMode === 'PURSUIT'}
        onClick={() => {
          setWaveMode('PURSUIT');
          for (const pod of vdotPods) {
            const podKey = pod.podName.split(' — ')[0] || pod.podName;
            if (typeof pod.pursuitStaggerOffsetSecs === 'number') {
              setPodWaveOffset(podKey, pod.pursuitStaggerOffsetSecs);
            }
          }
        }}
        className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
          waveMode === 'PURSUIT'
            ? 'liquid-capsule-active ap-status-prime font-bold'
            : 'text-ap-muted dark:text-ap-muted-dark'
        }`}
        title="Offset faster pods so all pods finish each rep together"
      >
        Pursuit (Finish Together)
      </button>
    </div>
  );

  const resetButtonNode = !confirmReset ? (
    <button
      type="button"
      data-testid="stopwatch-reset-btn"
      onClick={() => {
        if (hasActiveSession) {
          setConfirmReset(true);
        } else {
          resetStopwatch();
        }
      }}
      disabled={!hasActiveSession}
      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl ap-card-inset text-xs font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
    >
      <Trash className="w-4 h-4" weight="bold" />
      <span>Reset</span>
    </button>
  ) : (
    <button
      type="button"
      data-testid="stopwatch-reset-confirm-btn"
      onClick={() => {
        resetStopwatch();
        setConfirmReset(false);
        setSaveFeedbackMsg(null);
      }}
      className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl ap-status-strained font-bold text-xs cursor-pointer"
    >
      <span>Confirm Clear Splits</span>
    </button>
  );

  const multiSetPlanStripNode =
    sessionType === 'WORKOUT' &&
    customWorkoutSpec?.sets &&
    customWorkoutSpec.sets.length > 1 ? (
      <div
        data-testid="stopwatch-multiset-plan-strip"
        className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-emerald-900/10 dark:border-white/10 text-2xs font-mono"
      >
        <span className="font-bold uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark mr-1">
          Multi-Set Plan:
        </span>
        {customWorkoutSpec.warmupDistanceMeters && (
          <span className="px-2 py-0.5 rounded bg-[#E9EFE9] dark:bg-ap-turf text-ap-ink dark:text-ap-chalk">
            WU {(customWorkoutSpec.warmupDistanceMeters / 1609.344).toFixed(1)}mi
          </span>
        )}
        {customWorkoutSpec.sets.map((s, idx) => (
          <span
            key={`sw-set-${idx}`}
            className="px-2 py-0.5 rounded bg-[#E3ECE5] dark:bg-ap-turf text-ap-cobalt dark:text-ap-volt font-semibold"
          >
            {s.repCount}×{s.repDistanceMeters}m
          </span>
        ))}
        {customWorkoutSpec.cooldownDistanceMeters && (
          <span className="px-2 py-0.5 rounded bg-[#E9EFE9] dark:bg-ap-turf text-ap-ink dark:text-ap-chalk">
            CD {(customWorkoutSpec.cooldownDistanceMeters / 1609.344).toFixed(1)}mi
          </span>
        )}
      </div>
    ) : null;

  const heatAbortBannerNode = activeEnvAdjustment.heatAbortTriggered ? (
    <div
      data-testid="stopwatch-heat-abort-banner"
      role="alert"
      className="rounded-xl ap-status-strained px-3 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
    >
      <span>{activeEnvAdjustment.advisoryNote}</span>
      <span className="font-mono text-2xs uppercase tracking-wider px-2 py-0.5 rounded bg-black/15">
        Heat + Humidity Alert (Hadley Index {Math.round(activeEnvAdjustment.hadleySumF ?? 0)})
      </span>
    </div>
  ) : null;

  const envPhysicsPanelNode = showEnvPhysicsPanel ? (
    <div
      data-testid="stopwatch-env-physics-panel"
      className="rounded-xl ap-card-inset p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-2xs font-mono font-bold uppercase tracking-wider text-ap-ink dark:text-ap-chalk">
            World Athletics Oval Lane, Environment &amp; Spike Physics
          </div>
          <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark mt-0.5">
            {activeEnvAdjustment.advisoryNote}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-lg ap-status-prime font-mono text-2xs font-bold tabular-nums">
            {laneGeometry.lapLengthMeters.toFixed(2)}m/lap · +
            {((activeEnvAdjustment.combinedSplitMultiplier - 1) * 100).toFixed(1)}%
          </span>
          {activeEnvAdjustment.altitudeRestMultiplier > 1 && (
            <span className="px-2 py-0.5 rounded-lg ap-status-info font-mono text-2xs font-bold tabular-nums">
              Rest {activeEnvAdjustment.adjustedRestDurationSecs}s (
              {activeEnvAdjustment.altitudeRestMultiplier.toFixed(2)}x)
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Oval Lane
          </span>
          <select
            data-testid="stopwatch-lane-select"
            value={trackLane}
            onChange={(e) => setTrackLane(Number(e.target.value) as TrackLaneNumber)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            {([1, 2, 3, 4, 5, 6, 7, 8] as TrackLaneNumber[]).map((ln) => {
              const g = computeWorldAthleticsOvalLaneGeometry(ln);
              return (
                <option key={ln} value={ln}>
                  L{ln} ({g.lapLengthMeters.toFixed(2)}m)
                </option>
              );
            })}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Track Facility
          </span>
          <select
            data-testid="stopwatch-facility-select"
            value={trackFacility}
            onChange={(e) => setTrackFacility(e.target.value as NcaaTrackFacilityType)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            <option value="OUTDOOR_400M">400m Outdoor</option>
            <option value="INDOOR_BANKED_200M">200m Banked</option>
            <option value="INDOOR_FLAT_200M">200m Flat (+Turn)</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Air Temp (°F)
          </span>
          <input
            data-testid="stopwatch-temp-input"
            type="number"
            min={15}
            max={120}
            placeholder="72"
            value={airTempF ?? ''}
            onChange={(e) =>
              setAirTempF(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Dew Point (°F)
          </span>
          <input
            data-testid="stopwatch-dew-input"
            type="number"
            min={10}
            max={90}
            placeholder="55"
            value={dewPointF ?? ''}
            onChange={(e) =>
              setDewPointF(e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Wind (m/s)
          </span>
          <input
            data-testid="stopwatch-wind-input"
            type="number"
            min={0}
            max={25}
            step={0.5}
            value={windSpeedMps}
            onChange={(e) => setWindSpeedMps(Number(e.target.value) || 0)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Altitude (m)
          </span>
          <input
            data-testid="stopwatch-altitude-input"
            type="number"
            min={0}
            max={4000}
            step={50}
            value={altitudeMeters}
            onChange={(e) => setAltitudeMeters(Number(e.target.value) || 0)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-ap-ink dark:text-ap-chalk"
          />
        </label>

        <label className="space-y-1 col-span-2 sm:col-span-2 lg:col-span-1">
          <span className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
            Footwear
          </span>
          <select
            data-testid="stopwatch-footwear-select"
            value={footwearClass}
            onChange={(e) => setFootwearClass(e.target.value as TrackFootwearClass)}
            className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk"
          >
            <option value="DAILY_TRAINER">Daily Trainer (1.0x)</option>
            <option value="LIGHTWEIGHT_FLAT_SUPER_TRAINER">Super Trainer / Flat (1.1x)</option>
            <option value="CARBON_ROAD_RACER">Carbon Road Racer (1.2x)</option>
            <option value="TRADITIONAL_TRACK_SPIKE">Track Spike (1.35x)</option>
            <option value="CARBON_SUPER_SPIKE">Carbon Super-Spike (1.52x)</option>
          </select>
        </label>
      </div>

      {trackLane > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            data-testid="stopwatch-stagger-toggle"
            aria-pressed={isStaggeredStart}
            onClick={() => setIsStaggeredStart(!isStaggeredStart)}
            className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-2xs font-mono font-semibold cursor-pointer ${
              isStaggeredStart
                ? 'ap-status-info font-bold'
                : 'ap-card text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            {isStaggeredStart
              ? 'Staggered Starts Active (Exact 400m Mark Eq)'
              : 'Non-Staggered Lane Distance (Scaling Lap Split)'}
          </button>
        </div>
      )}
    </div>
  ) : null;

  const waveOffsetsPanelNode =
    waveMode === 'POD_STAGGER' || waveMode === 'PURSUIT' ? (
      <div className="rounded-xl ap-card-inset p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
          <span className="font-bold uppercase tracking-wider">
            {waveMode === 'PURSUIT'
              ? 'Pursuit Stagger Offsets — Finish Together'
              : 'Staggered Pod Start Offsets'}
          </span>
          <span>Adjust (-5s / +5s) or tap Go Now</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {activePodKeys.map((podKey) => {
            const offset = podWaveOffsetsSecs[podKey] ?? DEFAULT_POD_WAVE_OFFSETS[podKey] ?? 0;
            return (
              <div
                key={podKey}
                className="rounded-xl bg-white dark:bg-ap-carbon border border-emerald-900/15 dark:border-ap-edge-dark px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-ap-ink dark:text-ap-chalk truncate">
                    {podKey}
                  </div>
                  <div className="text-2xs font-mono text-ap-cobalt dark:text-[#56BA00]">
                    +{offset.toFixed(1)}s offset
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPodWaveOffset(podKey, Math.max(0, offset - 5))}
                    aria-label={`Decrease ${podKey} offset by 5 seconds`}
                    className="min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg ap-card-inset font-mono text-2xs font-bold cursor-pointer"
                  >
                    -5s
                  </button>
                  <button
                    type="button"
                    onClick={() => setPodWaveOffset(podKey, offset + 5)}
                    aria-label={`Increase ${podKey} offset by 5 seconds`}
                    className="min-h-[44px] sm:min-h-[32px] min-w-[36px] px-2 rounded-lg ap-card-inset font-mono text-2xs font-bold cursor-pointer"
                  >
                    +5s
                  </button>
                  {stopwatchRunning && (
                    <button
                      type="button"
                      onClick={() => triggerPodWaveNow(podKey)}
                      className="min-h-[44px] sm:min-h-[32px] px-2 rounded-lg ap-status-info font-mono text-2xs font-bold cursor-pointer"
                      title={`Stamp ${podKey} start at current clock`}
                    >
                      Go Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const chuteQueueStripNode =
    chuteQueueSecs.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-2xs font-mono font-bold uppercase text-ap-cobalt dark:text-ap-volt">
          Finish Order Queue — Tap next runner in line:
        </span>
        {chuteQueueSecs.map((ts, idx) => (
          <span
            key={`${ts}-${idx}`}
            data-testid={`chute-pill-${idx}`}
            className={`px-2 py-0.5 rounded-lg font-mono text-xs font-bold tabular-nums ${
              idx === 0
                ? 'bg-[#0B120E] text-ap-volt border border-[#56BA00]'
                : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            #{idx + 1} · {formatTrackMark(ts, 2)}
          </span>
        ))}
        <button
          type="button"
          onClick={clearChuteQueue}
          className="min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg ap-card-inset text-2xs font-semibold text-ap-muted dark:text-ap-muted-dark cursor-pointer ml-auto"
        >
          Clear Queue
        </button>
      </div>
    ) : null;

  const hasCustomEnvOrLane =
    showEnvPhysicsPanel ||
    trackLane > 1 ||
    trackFacility !== 'OUTDOOR_400M' ||
    windSpeedMps >= 4 ||
    altitudeMeters >= 1000 ||
    activeEnvAdjustment.heatSlowdownPct > 0 ||
    footwearClass !== 'DAILY_TRAINER';

  const autoRegBannerNode =
    sessionType === 'WORKOUT' ? (
      <TracksideAutoRegBanner
        autoRegSummary={squadAutoRegSummary}
        pivotHistory={autoRegPivotHistory}
        endedEarlyStimulusRatio={endedEarlyStimulusRatio}
        isFloatingFocusMode={false}
        onExtendRest30s={() => {
          extendWorkoutRestPlus30s(30);
          playFeedback('BELL');
          setLiveAnnouncement('Extended recovery timer +30s across active workout.');
        }}
        onConvertRemainingToCv={() => {
          convertRemainingToCv();
          playFeedback('BELL');
          setLiveAnnouncement('Converted remaining reps to Critical Velocity (CV).');
        }}
        onEndSession85Stimulus={(repsCap) => {
          endSessionStimulusAchieved(repsCap);
          playFeedback('BELL');
          setLiveAnnouncement('Ended workout cleanly with 85% quality stimulus preserved.');
        }}
        onDismissCue={dismissAutoRegCue}
      />
    ) : null;

  return (
    <div className="space-y-3 pb-32 md:pb-6">
      <div className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* 1. Unified Trackside Top Header & Sticky Control Deck */}
      <div className="rounded-xl ap-card px-2.5 sm:px-3.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            type="button"
            data-testid="stopwatch-back-to-log-btn"
            onClick={onOpenActivitiesTab}
            aria-label="Back to Activities"
            className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center px-2 rounded-lg liquid-capsule-track text-xs font-mono font-bold text-ap-ink dark:text-ap-chalk cursor-pointer shrink-0"
          >
            ←
          </button>
          <h1 className="text-sm sm:text-base font-extrabold text-ap-ink dark:text-ap-chalk tracking-tight whitespace-nowrap shrink-0">
            Trackside Stopwatch
          </h1>
          {!isOnline ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-2xs font-bold ap-status-caution shrink-0">
              <WifiSlash className="w-3 h-3" weight="bold" />
              <span>Offline Safe ✓</span>
            </span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded-lg font-mono text-2xs font-semibold ap-card-inset text-ap-muted dark:text-ap-muted-dark shrink-0">
              <span className="md:hidden">Offline Safe ✓</span>
              <span className="hidden md:inline">Saved on Device (Offline Safe ✓)</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="stopwatch-header-beep-toggle"
            aria-pressed={soundEnabled}
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 px-2 rounded-lg text-2xs font-mono font-bold border cursor-pointer shrink-0 ${
              soundEnabled
                ? 'ap-status-info'
                : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            {soundEnabled ? (
              <SpeakerHigh className="w-3.5 h-3.5 shrink-0" weight="bold" />
            ) : (
              <SpeakerSlash className="w-3.5 h-3.5 shrink-0" weight="bold" />
            )}
            <span className="hidden sm:inline">{soundEnabled ? 'Beep ON' : 'Muted'}</span>
          </button>
          {renderModeRadioGroup(true)}
        </div>
      </div>

      <section className="sticky top-[60px] md:top-[64px] z-20 rounded-2xl ap-card p-2.5 sm:p-3.5 space-y-2.5">
        {/* HUD Row 1: Clock + Gun + Undo + Chute */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            data-testid="stopwatch-master-clock"
            className="rounded-xl bg-white dark:bg-[#0B120E] text-ap-obsidian dark:text-ap-volt border border-ap-frame/30 dark:border-ap-frame px-3.5 py-2 font-mono text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight shrink-0"
          >
            {formatStopwatchClockMs(stopwatchElapsedMs)}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            <button
              type="button"
              data-testid="stopwatch-gun-btn"
              onClick={handleGunToggle}
              className={
                stopwatchRunning
                  ? 'min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-status-caution font-bold text-xs cursor-pointer'
                  : 'ap-btn-primary min-h-[44px] px-3.5 text-xs cursor-pointer'
              }
            >
              {stopwatchRunning ? (
                <>
                  <Pause className="w-4 h-4" weight="fill" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" weight="fill" />
                  <span>{stopwatchElapsedMs > 0 ? 'Resume' : 'Start Gun'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="stopwatch-undo-btn"
              onClick={handleUndo}
              disabled={tapHistory.length === 0}
              className="min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-xl ap-card-inset text-xs font-semibold text-ap-ink dark:text-ap-chalk disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowCounterClockwise className="w-4 h-4" weight="bold" />
              <span>Undo</span>
            </button>

            {(showChuteBar || sessionType === 'RACE') && (
              <button
                type="button"
                data-testid="stopwatch-chute-tap"
                onClick={handleChuteTap}
                className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-xl bg-[#0B120E] text-ap-volt border border-ap-frame text-xs font-bold cursor-pointer"
              >
                <Lightning className="w-4 h-4 shrink-0" weight="fill" />
                <span>Chute</span>
                {chuteQueueSecs.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-ap-cobalt text-ap-volt font-mono text-2xs">
                    {chuteQueueSecs.length}
                  </span>
                )}
              </button>
            )}

            {(stopwatchRunning || stopwatchElapsedMs > 0) && (
              <button
                type="button"
                data-testid="stopwatch-mobile-setup-toggle"
                aria-expanded={mobileSetupExpanded}
                onClick={() => setMobileSetupExpanded((prev) => !prev)}
                className="md:hidden min-h-[44px] inline-flex items-center gap-1 px-2.5 rounded-xl ap-card-inset text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
              >
                <span>{mobileSetupExpanded ? 'Hide Setup' : 'Setup'}</span>
              </button>
            )}
          </div>
        </div>

        {chuteQueueStripNode}

        {/* HUD Row 2: Preset + Recovery + Pod Select + View Switcher + Env/Tools */}
        <div
          className={`${
            (!stopwatchRunning && stopwatchElapsedMs === 0) || mobileSetupExpanded
              ? 'flex'
              : 'hidden md:flex'
          } flex-wrap items-center gap-1.5 pt-2 border-t border-emerald-900/10 dark:border-white/10`}
        >
          <div className="min-w-[140px] flex-1 sm:flex-initial sm:w-52">
            {renderPresetSelect(false)}
          </div>

          {sessionType === 'WORKOUT' && (
            <div className="w-40 sm:w-48 shrink-0">
              {recoverySelectNode}
            </div>
          )}

          <select
            aria-label="Filter runners by pacing pod"
            value={selectedPodFilter}
            onChange={(e) => setSelectedPodFilter(e.target.value)}
            className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-2.5 text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
          >
            <option value="ALL">All ({runnerTelemetries.length})</option>
            {activePodKeys.map((podKey) => {
              const count = runnerTelemetries.filter((t) => t.podKey === podKey).length;
              return (
                <option key={podKey} value={podKey}>
                  {podKey} ({count})
                </option>
              );
            })}
          </select>

          <input
            type="search"
            aria-label="Find runner"
            value={runnerSearchQuery}
            onChange={(e) => setRunnerSearchQuery(e.target.value)}
            placeholder="Find runner..."
            className="min-h-[44px] sm:min-h-[38px] w-32 sm:w-40 rounded-xl ap-card-inset px-2.5 text-xs text-ap-ink dark:text-ap-chalk"
          />

          <div className="inline-flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-testid="stopwatch-on-track-toggle"
              aria-pressed={onlyOnTrack}
              onClick={() => {
                if (pinnedRunnerIds.length === 0) setShowPinStrip(true);
                else setOnlyOnTrack((prev) => !prev);
              }}
              className={`min-h-[44px] sm:min-h-[38px] px-2.5 rounded-xl text-2xs font-mono font-bold border cursor-pointer ${
                onlyOnTrack && pinnedRunnerIds.length > 0
                  ? 'liquid-capsule-active border-ap-frame/30 dark:border-ap-volt/50'
                  : 'ap-card-inset text-ap-ink dark:text-ap-chalk border-transparent'
              }`}
            >
              On Track{pinnedRunnerIds.length > 0 ? ` (${pinnedRunnerIds.length})` : ''}
            </button>
            <button
              type="button"
              aria-expanded={showPinStrip}
              onClick={() => setShowPinStrip((prev) => !prev)}
              className="min-h-[44px] sm:min-h-[38px] px-2 rounded-xl ap-card-inset text-2xs font-mono font-semibold text-ap-muted dark:text-ap-muted-dark cursor-pointer"
              title="Choose runners currently on the track"
            >
              {showPinStrip ? 'Hide Heat' : 'Pin Heat'}
            </button>
          </div>

          <div
            role="group"
            aria-label="Stopwatch Split Layout"
            className="inline-flex items-center gap-0.5 p-0.5 rounded-xl liquid-capsule-track shrink-0"
          >
            <button
              type="button"
              data-testid="stopwatch-view-cards"
              aria-pressed={viewMode === 'CARDS'}
              onClick={() => setViewMode('CARDS')}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-2xs font-semibold cursor-pointer ${
                viewMode === 'CARDS'
                  ? 'liquid-capsule-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <SquaresFour className="w-3.5 h-3.5" weight="duotone" />
              <span>Cards</span>
            </button>
            <button
              type="button"
              data-testid="stopwatch-view-matrix"
              aria-pressed={viewMode === 'MATRIX'}
              onClick={() => setViewMode('MATRIX')}
              className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 px-2.5 rounded-lg text-2xs font-semibold cursor-pointer ${
                viewMode === 'MATRIX'
                  ? 'liquid-capsule-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Table className="w-3.5 h-3.5" weight="duotone" />
              <span>Matrix</span>
            </button>
          </div>

          {sessionType === 'WORKOUT' && (
            <button
              type="button"
              data-testid="stopwatch-toggle-chute"
              aria-pressed={showChuteBar}
              onClick={() => setShowChuteBar(!showChuteBar)}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 px-2.5 rounded-xl text-2xs font-semibold border cursor-pointer shrink-0 ${
                showChuteBar
                  ? 'ap-status-info font-bold'
                  : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Lightning className="w-3.5 h-3.5" weight="bold" />
              <span>Chute</span>
            </button>
          )}

          <button
            type="button"
            data-testid="stopwatch-toggle-env-physics"
            aria-expanded={showEnvPhysicsPanel}
            onClick={() => setShowEnvPhysicsPanel((prev) => !prev)}
            className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1 px-2.5 rounded-xl text-2xs font-semibold border cursor-pointer shrink-0 ${
              hasCustomEnvOrLane
                ? 'ap-status-caution font-bold'
                : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
            }`}
          >
            <Waves className="w-3.5 h-3.5" weight="bold" />
            <span>
              {trackLane > 1
                ? `L${trackLane} (${laneGeometry.lapLengthMeters.toFixed(0)}m)`
                : 'Lane / Env'}
            </span>
          </button>

          <button
            type="button"
            data-testid="stopwatch-tools-btn"
            aria-expanded={showToolsDrawer}
            onClick={() => setShowToolsDrawer((prev) => !prev)}
            className={`min-h-[44px] sm:min-h-[38px] px-2.5 rounded-xl font-mono text-2xs font-semibold cursor-pointer shrink-0 ml-auto ${
              showToolsDrawer
                ? 'ap-status-info font-bold'
                : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
            }`}
          >
            Tools ▾
          </button>
        </div>

        {showToolsDrawer && (
          <div className="pt-2.5 space-y-3 border-t border-emerald-900/10 dark:border-white/10">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sessionTitleInputNode}
              {hardwareTogglesNode}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {waveModeButtonsNode}
              {resetButtonNode}
            </div>
            {waveOffsetsPanelNode}
          </div>
        )}

        {heatAbortBannerNode}
        {sessionType === 'WORKOUT' && (
          <div
            data-testid="stopwatch-rep-stepper"
            className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-900/10 dark:border-white/10"
          >
            <div className="inline-flex items-center gap-1.5">
              <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Reps
              </span>
              <button
                type="button"
                data-testid="stopwatch-rep-dec"
                aria-label="Decrease workout rep count"
                onClick={() =>
                  setCustomRepOverride(Math.max(1, activeWorkoutPreset.repCount - 1))
                }
                className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg ap-card-inset font-mono text-sm font-bold text-ap-ink dark:text-white cursor-pointer"
              >
                -
              </button>
              <span
                data-testid="stopwatch-rep-count"
                className="px-2 font-mono text-xs font-bold tabular-nums text-ap-ink dark:text-white"
              >
                {activeWorkoutPreset.repCount} reps
              </span>
              <button
                type="button"
                data-testid="stopwatch-rep-inc"
                aria-label="Increase workout rep count"
                onClick={() =>
                  setCustomRepOverride(Math.min(30, activeWorkoutPreset.repCount + 1))
                }
                className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] rounded-lg ap-card-inset font-mono text-sm font-bold text-ap-ink dark:text-white cursor-pointer"
              >
                +
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Quick rep distance">
              {([200, 400, 800, 1000, 1600] as const).map((dist) => {
                const isSelected = activeWorkoutPreset.repDistanceMeters === dist;
                return (
                  <button
                    key={dist}
                    type="button"
                    data-testid={`stopwatch-dist-${dist}`}
                    aria-pressed={isSelected}
                    onClick={() => setCustomDistOverride(dist)}
                    className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg font-mono text-2xs font-bold transition-colors cursor-pointer ${
                      isSelected
                        ? 'liquid-capsule-active text-ap-ink dark:text-white'
                        : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                    }`}
                  >
                    {dist}m
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {multiSetPlanStripNode}
        {envPhysicsPanelNode}
      </section>

      {showPinStrip && (
        <div
          data-testid="stopwatch-pin-strip"
          className="rounded-xl ap-card px-3 py-2 flex flex-wrap items-center gap-1.5 text-2xs"
        >
          <span className="font-mono font-bold uppercase text-ap-muted dark:text-ap-muted-dark mr-1">
            Heat / On Track:
          </span>
          {runnerTelemetries.map((t) => {
            const pinned = pinnedRunnerIds.includes(t.runnerId);
            return (
              <button
                key={t.runnerId}
                type="button"
                aria-pressed={pinned}
                onClick={() =>
                  setPinnedRunnerIds((prev) =>
                    prev.includes(t.runnerId)
                      ? prev.filter((id) => id !== t.runnerId)
                      : [...prev, t.runnerId]
                  )
                }
                className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg font-semibold cursor-pointer ${
                  pinned
                    ? 'liquid-capsule-active text-ap-ink dark:text-white'
                    : 'ap-card-inset text-ap-ink dark:text-ap-chalk'
                }`}
              >
                {t.runnerName}
              </button>
            );
          })}
          {pinnedRunnerIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPinnedRunnerIds([]);
                setOnlyOnTrack(false);
              }}
              className="min-h-[44px] sm:min-h-[34px] px-2 rounded-lg font-mono text-ap-muted dark:text-ap-muted-dark underline cursor-pointer"
            >
              Clear Heat
            </button>
          )}
        </div>
      )}

      {autoRegBannerNode}

      {/* 2. Unified Clean Runner Tap Area (4-Datum Cards OR Matrix) */}
      <TracksideRunnerCardsAndMatrix
        viewMode={viewMode}
        sessionType={sessionType}
        filteredTelemetries={filteredTelemetries}
        runnerPodLookup={runnerPodLookup}
        chuteQueueSecs={chuteQueueSecs}
        lastTappedRunnerId={lastTappedRunnerId}
        targetRaceLaps={targetRaceLaps}
        maxColumnsInMatrix={maxColumnsInMatrix}
        onRunnerAction={handleRunnerAction}
      />

      {/* 5. Walk-On Roster Deck & 1-Click MeetReady Save / CSV Export Footer */}
      <TracksideWalkOnAndSaveBar
        sessionType={sessionType}
        sessionTitle={sessionTitle}
        activeRacePreset={activeRacePreset}
        runnerTelemetries={runnerTelemetries}
        connectedRoster={connectedRoster}
        extraPodAthletes={extraPodAthletes}
        includeSelfRunner={includeSelfRunner}
        setIncludeSelfRunner={setIncludeSelfRunner}
        walkOnName={walkOnName}
        setWalkOnName={setWalkOnName}
        copiedCsv={copiedCsv}
        totalSplitCount={totalSplitCount}
        includeWarmupCooldown={includeWarmupCooldown}
        setIncludeWarmupCooldown={setIncludeWarmupCooldown}
        saveFeedbackMsg={saveFeedbackMsg}
        saveFeedbackTone={saveFeedbackTone}
        isSavingToThresh={isSavingToThresh}
        pendingOutboxCount={pendingOutboxCount}
        isOnline={isOnline}
        isFlushingOutbox={isFlushingOutbox}
        postSaveActionLabel={postSaveActionLabel}
        stopwatchRunning={stopwatchRunning}
        stopwatchElapsedMs={stopwatchElapsedMs}
        isHoldingPause={isHoldingPause}
        setIsHoldingPause={setIsHoldingPause}
        holdPauseTimerRef={holdPauseTimerRef}
        holdPauseSucceededRef={holdPauseSucceededRef}
        showChuteBar={showChuteBar}
        setShowChuteBar={setShowChuteBar}
        chuteQueueSecs={chuteQueueSecs}
        tapHistoryLength={tapHistory.length}
        onFlushStopwatchOutbox={onFlushStopwatchOutbox}
        onManualFlushOutbox={handleManualFlushOutbox}
        onAddWalkOn={handleAddWalkOn}
        onRemoveWalkOn={handleRemoveWalkOn}
        onCopyCsv={handleCopyCsv}
        onDownloadCsv={handleDownloadCsv}
        onShareStopwatchCard={handleShareStopwatchCard}
        onSaveToThresh={handleSaveToThresh}
        onOpenActivitiesTab={onOpenActivitiesTab}
        onOpenRosterModal={onOpenRosterModal}
        onGunToggle={handleGunToggle}
        onChuteTap={handleChuteTap}
        onUndo={handleUndo}
        setLiveAnnouncement={setLiveAnnouncement}
      />
    </div>
  );
};
