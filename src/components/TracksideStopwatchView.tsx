import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AthleteProfile,
  ConnectedAthleteRecord,
  NcaaTrackFacilityType,
  TeamSummaryWithRole,
  TrackEnvironmentConditions,
  TrackFootwearClass,
  TrackLaneNumber,
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
  estimateVdotFromThresholdPace,
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
import {
  evaluateSquadLiveAutoRegulation,
  type RunnerLiveAutoRegInput,
} from '../physiology/trackLiveAutoRegulationEngine';
import { TracksideAutoRegBanner } from './track/TracksideAutoRegBanner';
import { TracksideMeetPassportPanel } from './track/TracksideMeetPassportPanel';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
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
  onSaveStopwatchActivities: (entries: SavedStopwatchEntry[]) => number;
  onOpenActivitiesTab: () => void;
  onOpenRosterModal: () => void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

const REST_OPTIONS_SECS = [0, 30, 45, 60, 90, 120, 180] as const;

export const TracksideStopwatchView: React.FC<TracksideStopwatchViewProps> = ({
  selfName,
  selfProfile,
  roster,
  myTeams,
  activeTeamId,
  onSaveStopwatchActivities,
  onOpenActivitiesTab,
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

  const activeTeam = useMemo(
    () => myTeams.find((t) => t.brand.teamId === activeTeamId) || myTeams[0] || null,
    [myTeams, activeTeamId]
  );
  const isCoachingTeam =
    activeTeam?.myRole === 'HEAD_COACH' || activeTeam?.myRole === 'ASSISTANT_COACH';

  const [includeSelfRunner, setIncludeSelfRunner] = useState<boolean>(!isCoachingTeam);
  const [selectedPodFilter, setSelectedPodFilter] = useState<string>('ALL');
  const [walkOnName, setWalkOnName] = useState<string>('');
  const [walkOnVdot, setWalkOnVdot] = useState<string>('56.0');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);
  const [includeWarmupCooldown, setIncludeWarmupCooldown] = useState<boolean>(true);
  const [saveFeedbackMsg, setSaveFeedbackMsg] = useState<string | null>(null);
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
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  // Screen Wake Lock API while timer is active
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockState('UNSUPPORTED');
      return;
    }
    let cancelled = false;
    const acquireLock = async () => {
      if (!wakeLockEnabled || !stopwatchRunning) {
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
      if (document.visibilityState === 'visible' && wakeLockEnabled && stopwatchRunning) {
        void acquireLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
        void wakeLockSentinelRef.current.release().catch(() => {});
        wakeLockSentinelRef.current = null;
      }
    };
  }, [wakeLockEnabled, stopwatchRunning]);

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
          gain.gain.setValueAtTime(0.08, ctx.currentTime + delaySec);
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

  const activeWorkoutPreset = useMemo(
    () =>
      (workoutPresetId === 'custom-plan' && customPlanPreset ? customPlanPreset : null) ||
      WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === workoutPresetId) ||
      WORKOUT_STOPWATCH_PRESETS[0],
    [workoutPresetId, customPlanPreset]
  );

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
      includeSelfRunner || (connectedRoster.length === 0 && extraPodAthletes.length === 0);
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
    const useDirectCustomTarget =
      workoutPresetId === 'custom-plan' &&
      typeof customWorkoutSpec?.targetSplitSecs === 'number' &&
      customWorkoutSpec.targetSplitSecs > 0 &&
      rosterInputs.length <= 1;

    for (const pod of vdotPods) {
      const podKey = pod.podName.split(' — ')[0] || pod.podName;
      const splitSecs = useDirectCustomTarget
        ? computeTrackEnvironmentSplitAdjustment({
            baseTargetSplitSecs: customWorkoutSpec!.targetSplitSecs!,
            repDistanceMeters: activeWorkoutPreset.repDistanceMeters,
            baseRestDurationSecs: restDurationSecs,
            zoneCode: customWorkoutSpec?.zoneCode,
            intensity: activeWorkoutPreset.intensity,
            environment: environmentConditions,
            isIntervalSession: true,
          }).adjustedTargetSplitSecs
        : pod.targetRepSplitSecs ??
          Number(
            ((pod.targetPaceSecsPerKm / 1000) * activeWorkoutPreset.repDistanceMeters).toFixed(1)
          );
      for (const athlete of pod.athletes) {
        map.set(athlete.id, { podKey, targetLapSecs: splitSecs });
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

  const filteredTelemetries = useMemo(
    () =>
      selectedPodFilter === 'ALL'
        ? runnerTelemetries
        : runnerTelemetries.filter((t) => t.podKey === selectedPodFilter),
    [runnerTelemetries, selectedPodFilter]
  );

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

  const handleRunnerAction = useCallback(
    (telemetry: RunnerSplitTelemetry) => {
      if (telemetry.isFinishedLocked) {
        setLiveAnnouncement(
          `${telemetry.runnerName} is Finish-Locked at ${telemetry.lapCount} laps. Use Undo Last to unlock.`
        );
        return;
      }
      if (chuteQueueSecs.length > 0) {
        const assigned = assignChuteToRunner(telemetry.runnerId, telemetry.runnerName, {
          maxRaceLaps: targetRaceLaps,
        });
        if (assigned !== null) {
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

  // Trackside Physical Keyboard Accelerators: Space = Gun, 1–9 = Visible Lane 1–9, C = Chute Tap, Z = Undo
  useEffect(() => {
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
    const numericVdot = Math.max(30, Math.min(84, Number(walkOnVdot) || 56));
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
    const dateStamp = new Date().toISOString().slice(0, 10);
    const slug = (sessionType === 'RACE' ? activeRacePreset.label : activeWorkoutPreset.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    link.href = url;
    link.download = `thresh-stopwatch-${sessionType.toLowerCase()}-${slug}-${dateStamp}.csv`;
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
      date: new Date().toISOString().slice(0, 10),
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

  const handleSaveToThresh = () => {
    const timed = runnerTelemetries.filter((t) => t.lapCount > 0 && t.netTotalSecs !== null);
    if (timed.length === 0) return;

    const rosterById = new Map(roster.map((r) => [r.id, r]));
    const writableDirect: RunnerSplitTelemetry[] = [];
    const fallbackToSelf: RunnerSplitTelemetry[] = [];

    for (const t of timed) {
      if (t.runnerId === 'SELF') {
        writableDirect.push(t);
      } else {
        const match = rosterById.get(t.runnerId);
        if (match?.role === 'COACH_EDIT') {
          writableDirect.push(t);
        } else if (!match) {
          // Walk-on athletes can be archived under Coach / Self log when SELF has no separate entry
          fallbackToSelf.push(t);
        }
      }
    }

    const targets =
      writableDirect.length > 0
        ? writableDirect
        : fallbackToSelf.map((t) => ({ ...t, saveTargetId: 'SELF' }));

    const derivedStartMs =
      sessionStartedEpochMs ?? Math.max(0, Date.now() - Math.max(0, stopwatchElapsedMs));
    const startDateLocalIso = formatLocalWallClockIso(derivedStartMs);

    const entries: SavedStopwatchEntry[] = targets.map((t) => {
      const targetId = 'saveTargetId' in t ? String(t.saveTargetId) : t.runnerId;
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

    const savedCount = onSaveStopwatchActivities(entries);
    setSaveFeedbackMsg(
      savedCount > 0
        ? sessionType === 'RACE'
          ? `Saved ${savedCount} Official Race ${savedCount === 1 ? 'Mark' : 'Marks'} into THRESH Activities.`
          : endedEarlyStimulusRatio !== null
            ? `Saved ${savedCount} Interval Workout ${savedCount === 1 ? 'Log' : 'Logs'} (${Math.round(endedEarlyStimulusRatio * 100)}% quality stimulus preserved) into THRESH Activities.`
            : `Saved ${savedCount} Interval Workout ${savedCount === 1 ? 'Log' : 'Logs'} (rTSS computed) into THRESH Activities.`
        : 'No writable athlete logs selected.'
    );
  };

  return (
    <div className="space-y-4">
      <div className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* 1. Top Session Control Deck & Prominent WORKOUT / RACE Flag */}
      <section className="ap-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <button
              type="button"
              data-testid="stopwatch-back-to-log-btn"
              onClick={onOpenActivitiesTab}
              className="min-h-[44px] sm:min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg liquid-capsule-track text-2xs font-mono font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white cursor-pointer"
            >
              <span>← Back</span>
            </button>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Trackside Stopwatch
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-lg font-mono text-2xs font-bold uppercase ${
                stopwatchRunning ? 'ap-status-prime' : 'ap-status-info'
              }`}
            >
              {stopwatchRunning ? 'Live Timing · 0.01s' : 'Ready · 0.01s FAT Precision'}
            </span>
            {!isOnline ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg font-mono text-2xs font-bold ap-status-caution">
                <WifiSlash className="w-3.5 h-3.5" weight="bold" />
                <span>Offline · Local Storage Active</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-lg font-mono text-2xs font-semibold ap-card-inset text-slate-700 dark:text-slate-300">
                Saved on Device (Offline Ready)
              </span>
            )}
          </div>

          {/* Prominent Session Mode Flag Button (WORKOUT vs RACE) */}
          <div
            role="radiogroup"
            aria-label="Session Mode"
            className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
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
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                sessionType === 'WORKOUT'
                  ? 'liquid-capsule-active'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Timer className="w-4 h-4 ap-text-brand" weight="duotone" />
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
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                sessionType === 'RACE'
                  ? 'liquid-capsule-active'
                  : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FlagCheckered className="w-4 h-4 text-amber-600 dark:text-amber-400" weight="duotone" />
              <span>RACE</span>
            </button>
          </div>
        </div>

        {/* Context Row: Presets, Rest/Meet Title, Wake Lock & Audio Beep */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 pt-2 border-t border-emerald-900/10 dark:border-white/10">
          {sessionType === 'WORKOUT' ? (
            <>
              <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                <span>Workout Preset</span>
                <select
                  aria-label="Workout Preset"
                  value={workoutPresetId}
                  onChange={(e) => setWorkoutPresetId(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-sans font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
                >
                  {customPlanPreset && (
                    <option
                      value="custom-plan"
                      className="bg-white dark:bg-[#101B15] text-slate-900 dark:text-white"
                    >
                      Planned: {customPlanPreset.label}
                    </option>
                  )}
                  {WORKOUT_STOPWATCH_PRESETS.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      className="bg-white dark:bg-[#101B15] text-slate-900 dark:text-white"
                    >
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                <span>Auto Recovery Countdown</span>
                <select
                  aria-label="Recovery Countdown"
                  value={restDurationSecs}
                  onChange={(e) => setRestDurationSecs(Number(e.target.value))}
                  className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-mono font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
                >
                  {REST_OPTIONS_SECS.map((sec) => (
                    <option
                      key={sec}
                      value={sec}
                      className="bg-white dark:bg-[#101B15] text-slate-900 dark:text-white"
                    >
                      {sec === 0 ? 'Off (Continuous)' : `${sec}s Recovery Timer`}
                    </option>
                  ))}
                  {!REST_OPTIONS_SECS.includes(restDurationSecs as (typeof REST_OPTIONS_SECS)[number]) && (
                    <option
                      value={restDurationSecs}
                      className="bg-white dark:bg-[#101B15] text-slate-900 dark:text-white"
                    >
                      {restDurationSecs}s Recovery Timer (Auto-Reg)
                    </option>
                  )}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                <span>Race Event &amp; Finish Lock</span>
                <select
                  aria-label="Race Event Distance"
                  value={raceEventLabel}
                  onChange={(e) => setRaceEventLabel(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-sans font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
                >
                  {RACE_STOPWATCH_PRESETS.map((evt) => (
                    <option
                      key={evt.label}
                      value={evt.label}
                      className="bg-white dark:bg-[#101B15] text-slate-900 dark:text-white"
                    >
                      {evt.label}
                      {evt.targetLaps
                        ? ` (${evt.targetLaps} x ${evt.splitMeters}m)`
                        : ' (Open Laps)'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                <span>Race Lap Rules</span>
                <div className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
                  <BellRinging className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" weight="duotone" />
                  <span className="truncate">
                    {activeRacePreset.targetLaps
                      ? `Bell Lap ${Math.max(1, activeRacePreset.targetLaps - 1)} · Lock @ Lap ${activeRacePreset.targetLaps}`
                      : 'Unlimited open split taps'}
                  </span>
                </div>
              </div>
            </>
          )}

          <label className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
            <span>{sessionType === 'RACE' ? 'Meet / Heat Name' : 'Session Name'}</span>
            <input
              type="text"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder={
                sessionType === 'RACE'
                  ? 'e.g. League Finals Heat 1'
                  : 'e.g. Tuesday Track Intervals'
              }
              aria-label="Meet or Session Name"
              className="min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs font-sans text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
            />
          </label>

          {/* Hardware Field Toggles: Screen Wake Lock + Audio Beep */}
          <div className="flex flex-col gap-1 text-2xs font-mono font-semibold text-slate-700 dark:text-slate-300">
            <span>Trackside Hardware</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={wakeLockEnabled}
                onClick={() => setWakeLockEnabled(!wakeLockEnabled)}
                className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  wakeLockEnabled
                    ? wakeLockState === 'ACTIVE'
                      ? 'ap-status-prime'
                      : 'ap-status-info'
                    : 'ap-card-inset text-slate-700 dark:text-slate-300'
                }`}
                title="Keep mobile display awake while timing live track sessions"
              >
                <Sun className="w-3.5 h-3.5 shrink-0" weight="bold" />
                <span className="truncate">
                  {wakeLockEnabled
                    ? wakeLockState === 'ACTIVE'
                      ? 'Awake On'
                      : 'Wake Ready'
                    : 'Wake Off'}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={soundEnabled}
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  soundEnabled
                    ? 'ap-status-info'
                    : 'ap-card-inset text-slate-700 dark:text-slate-300'
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
            </div>
          </div>
        </div>

        {sessionType === 'WORKOUT' &&
          customWorkoutSpec?.sets &&
          customWorkoutSpec.sets.length > 1 && (
            <div
              data-testid="stopwatch-multiset-plan-strip"
              className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-stone-200/70 dark:border-[#244331] text-2xs font-mono"
            >
              <span className="font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mr-1">
                Multi-Set Plan:
              </span>
              {customWorkoutSpec.warmupDistanceMeters && (
                <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-[#15231B] text-slate-700 dark:text-slate-300">
                  WU {(customWorkoutSpec.warmupDistanceMeters / 1609.344).toFixed(1)}mi
                </span>
              )}
              {customWorkoutSpec.sets.map((s, idx) => (
                <span
                  key={`sw-set-${idx}`}
                  className="px-2 py-0.5 rounded bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] font-semibold"
                >
                  {s.repCount}×{s.repDistanceMeters}m
                </span>
              ))}
              {customWorkoutSpec.cooldownDistanceMeters && (
                <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-[#15231B] text-slate-700 dark:text-slate-300">
                  CD {(customWorkoutSpec.cooldownDistanceMeters / 1609.344).toFixed(1)}mi
                </span>
              )}
            </div>
          )}
      </section>

      {/* 2. Master Clock, Gun Controls, Wave Mode & View Switcher */}
      <section className="ap-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div
              data-testid="stopwatch-master-clock"
              className="rounded-2xl bg-[#101B15] text-[#C8FF00] border-2 border-[#2B5B3F] px-5 py-3 font-mono text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight shadow-sm"
            >
              {formatStopwatchClockMs(stopwatchElapsedMs)}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="stopwatch-gun-btn"
                onClick={handleGunToggle}
                className={
                  stopwatchRunning
                    ? 'min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl ap-status-caution font-bold text-xs cursor-pointer transition-all'
                    : 'ap-btn-primary cursor-pointer'
                }
              >
                {stopwatchRunning ? (
                  <>
                    <Pause className="w-4 h-4" weight="fill" />
                    <span>Pause Gun</span>
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
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
              >
                <ArrowCounterClockwise className="w-4 h-4" weight="bold" />
                <span>Undo Last</span>
              </button>

              {!confirmReset ? (
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
              )}
            </div>
          </div>

          {/* Right Toolbar: Cards | Matrix Switcher, Pack Chute Toggle, Wave Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Stopwatch Split Layout"
              className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
            >
              <button
                type="button"
                data-testid="stopwatch-view-cards"
                aria-pressed={viewMode === 'CARDS'}
                onClick={() => setViewMode('CARDS')}
                className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                  viewMode === 'CARDS'
                    ? 'liquid-capsule-active'
                    : 'text-slate-700 dark:text-slate-300'
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
                className={`min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                  viewMode === 'MATRIX'
                    ? 'liquid-capsule-active'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <Table className="w-3.5 h-3.5" weight="duotone" />
                <span>Matrix</span>
              </button>
            </div>

            <button
              type="button"
              data-testid="stopwatch-toggle-chute"
              aria-pressed={showChuteBar}
              onClick={() => setShowChuteBar(!showChuteBar)}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                showChuteBar
                  ? 'ap-status-info font-bold'
                  : 'ap-card-inset text-slate-700 dark:text-slate-200'
              }`}
            >
              <Lightning className="w-3.5 h-3.5" weight="bold" />
              <span>Chute Bar</span>
              {chuteQueueSecs.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#101B15] text-[#C8FF00] font-mono text-2xs">
                  {chuteQueueSecs.length}
                </span>
              )}
            </button>

            <div
              role="group"
              aria-label="Start Wave Mode"
              className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
            >
              <button
                type="button"
                aria-pressed={waveMode === 'MASS'}
                onClick={() => setWaveMode('MASS')}
                className={`min-h-[40px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  waveMode === 'MASS'
                    ? 'liquid-capsule-active'
                    : 'text-slate-700 dark:text-slate-300'
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
                className={`min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  waveMode === 'POD_STAGGER'
                    ? 'liquid-capsule-active ap-status-caution font-bold'
                    : 'text-slate-700 dark:text-slate-300'
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
                className={`min-h-[40px] sm:min-h-[34px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  waveMode === 'PURSUIT'
                    ? 'liquid-capsule-active ap-status-prime font-bold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
                title="Offset faster pods so all pods finish each rep together"
              >
                Pursuit (Finish Together)
              </button>
            </div>

            <button
              type="button"
              data-testid="stopwatch-toggle-env-physics"
              aria-expanded={showEnvPhysicsPanel}
              onClick={() => setShowEnvPhysicsPanel((prev) => !prev)}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 rounded-xl text-xs font-semibold border cursor-pointer ${
                showEnvPhysicsPanel ||
                trackLane > 1 ||
                trackFacility !== 'OUTDOOR_400M' ||
                windSpeedMps >= 4 ||
                altitudeMeters >= 1000 ||
                activeEnvAdjustment.heatSlowdownPct > 0 ||
                footwearClass !== 'DAILY_TRAINER'
                  ? 'ap-status-caution font-bold'
                  : 'ap-card-inset text-slate-700 dark:text-slate-200'
              }`}
            >
              <Waves className="w-3.5 h-3.5" weight="bold" />
              <span>
                {trackLane > 1
                  ? `Lane ${trackLane} (${laneGeometry.lapLengthMeters.toFixed(0)}m)`
                  : 'Lane, Env & Spikes'}
              </span>
            </button>
          </div>
        </div>

        {/* Heat Abort Warning Banner (Mark Hadley T_air + T_dew > 180) */}
        {activeEnvAdjustment.heatAbortTriggered && (
          <div
            data-testid="stopwatch-heat-abort-banner"
            role="alert"
            className="rounded-xl ap-status-strained px-3.5 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
          >
            <span>{activeEnvAdjustment.advisoryNote}</span>
            <span className="font-mono text-2xs uppercase tracking-wider px-2 py-0.5 rounded bg-black/15">
              Heat + Humidity Alert (Hadley Index {Math.round(activeEnvAdjustment.hadleySumF ?? 0)})
            </span>
          </div>
        )}

        {/* Collapsible Lane (2-8), Weather, Altitude, Facility & Spike Footwear Physics Bar */}
        {showEnvPhysicsPanel && (
          <div
            data-testid="stopwatch-env-physics-panel"
            className="rounded-xl ap-card-inset p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-2xs font-mono font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                  World Athletics Oval Lane, Environment & Spike Exposure Physics
                </div>
                <div className="text-2xs font-mono text-slate-600 dark:text-slate-300 mt-0.5">
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
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
                  Oval Lane
                </span>
                <select
                  data-testid="stopwatch-lane-select"
                  value={trackLane}
                  onChange={(e) => setTrackLane(Number(e.target.value) as TrackLaneNumber)}
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-slate-900 dark:text-white"
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
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
                  Track Facility
                </span>
                <select
                  data-testid="stopwatch-facility-select"
                  value={trackFacility}
                  onChange={(e) => setTrackFacility(e.target.value as NcaaTrackFacilityType)}
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-slate-900 dark:text-white"
                >
                  <option value="OUTDOOR_400M">400m Outdoor</option>
                  <option value="INDOOR_BANKED_200M">200m Banked</option>
                  <option value="INDOOR_FLAT_200M">200m Flat (+Turn)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
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
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
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
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
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
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1">
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
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
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </label>

              <label className="space-y-1 col-span-2 sm:col-span-2 lg:col-span-1">
                <span className="block text-2xs font-mono uppercase text-slate-600 dark:text-slate-300">
                  Footwear
                </span>
                <select
                  data-testid="stopwatch-footwear-select"
                  value={footwearClass}
                  onChange={(e) => setFootwearClass(e.target.value as TrackFootwearClass)}
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card px-2.5 text-xs font-mono font-semibold text-slate-900 dark:text-white"
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
                      : 'ap-card text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {isStaggeredStart
                    ? 'Staggered Starts Active (Exact 400m Mark Eq)'
                    : 'Non-Staggered Lane Distance (Scaling Lap Split)'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Staggered Pod Wave Controls Strip (when Pod Waves or Pursuit active) */}
        {(waveMode === 'POD_STAGGER' || waveMode === 'PURSUIT') && (
          <div className="rounded-xl ap-card-inset p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-700 dark:text-slate-300">
              <span className="font-bold uppercase tracking-wider">
                {waveMode === 'PURSUIT'
                  ? 'Pursuit Stagger Offsets — Finish Together (Automatically Subtracted From Net Splits)'
                  : 'Staggered Pod Start Offsets (Automatically Subtracted From Net Splits)'}
              </span>
              <span>Adjust offsets (-5s / +5s) or tap Go Now mid-session</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {activePodKeys.map((podKey) => {
                const offset =
                  podWaveOffsetsSecs[podKey] ?? DEFAULT_POD_WAVE_OFFSETS[podKey] ?? 0;
                return (
                  <div
                    key={podKey}
                    className="rounded-xl bg-white dark:bg-[#101B15] border border-emerald-900/15 dark:border-[#244331] px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {podKey}
                      </div>
                      <div className="text-2xs font-mono text-emerald-700 dark:text-emerald-400">
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
        )}

        {sessionType === 'WORKOUT' && (
          <TracksideAutoRegBanner
            autoRegSummary={squadAutoRegSummary}
            pivotHistory={autoRegPivotHistory}
            endedEarlyStimulusRatio={endedEarlyStimulusRatio}
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
        )}
      </section>

      {/* 3. Blind-Tap Pack / Chute Queue Bar (F1) */}
      {showChuteBar && (
        <section className="ap-card rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              data-testid="stopwatch-chute-tap"
              onClick={handleChuteTap}
              className={
                stopwatchRunning
                  ? 'ap-btn-primary w-full sm:flex-1 min-h-[58px] text-sm cursor-pointer'
                  : 'w-full sm:flex-1 min-h-[58px] inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#1D3828] hover:bg-[#163022] text-white dark:bg-[#183122] dark:text-[#C8FF00] border-2 border-[#2B5B3F] text-sm font-bold cursor-pointer'
              }
            >
              <Lightning className="w-5 h-5 shrink-0" weight="fill" />
              <span>Chute Tap — Queue Pack Timestamp (Key: C)</span>
              {chuteQueueSecs.length > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-[#080A09] text-[#C8FF00] font-mono text-xs">
                  {chuteQueueSecs.length} Queued
                </span>
              )}
            </button>

            {chuteQueueSecs.length > 0 && (
              <button
                type="button"
                onClick={clearChuteQueue}
                className="min-h-[44px] px-3.5 py-2 rounded-xl ap-card-inset text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer shrink-0"
              >
                Clear Queue
              </button>
            )}
          </div>

          {chuteQueueSecs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs font-mono font-bold uppercase text-emerald-800 dark:text-emerald-300">
                Finish Order Queue — Tap next runner in line:
              </span>
              {chuteQueueSecs.map((ts, idx) => (
                <span
                  key={`${ts}-${idx}`}
                  data-testid={`chute-pill-${idx}`}
                  className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold tabular-nums ${
                    idx === 0
                      ? 'bg-[#1D3828] text-[#C8FF00] border border-[#65A30D]'
                      : 'ap-card-inset text-slate-700 dark:text-slate-200'
                  }`}
                >
                  #{idx + 1} · {formatTrackMark(ts, 2)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-2xs font-mono text-slate-600 dark:text-slate-300">
              Tap Chute Tap rapidly as a pack crosses the line, then tap runners in finish order to assign queued marks without losing a tenth.
            </p>
          )}
        </section>
      )}

      {/* 4. Pod Filter Strip + Unified Hybrid Runner Area (Cards OR Matrix) */}
      <section className="space-y-3">
        <div className="ap-card rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedPodFilter('ALL')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-mono font-semibold cursor-pointer ${
                selectedPodFilter === 'ALL'
                  ? 'liquid-capsule-active'
                  : 'ap-card-inset text-slate-700 dark:text-slate-300'
              }`}
            >
              All Runners ({runnerTelemetries.length})
            </button>
            {activePodKeys.map((podKey) => {
              const count = runnerTelemetries.filter((t) => t.podKey === podKey).length;
              return (
                <button
                  key={podKey}
                  type="button"
                  onClick={() => setSelectedPodFilter(podKey)}
                  className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-mono font-semibold cursor-pointer ${
                    selectedPodFilter === podKey
                      ? 'liquid-capsule-active'
                      : 'ap-card-inset text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {podKey} ({count})
                </button>
              );
            })}
          </div>

          <div className="hidden md:block text-2xs font-mono text-slate-700 dark:text-slate-300">
            Keys: Space Gun · 1–9 Split Lane · C Chute · Z Undo
          </div>
        </div>

        {viewMode === 'CARDS' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredTelemetries.map((telemetry, idx) => {
              const podMeta = runnerPodLookup.get(telemetry.runnerId);
              const nextChuteTs = chuteQueueSecs[0];

              return (
                <button
                  key={telemetry.runnerId}
                  type="button"
                  data-testid={`runner-card-${idx}`}
                  onClick={() => handleRunnerAction(telemetry)}
                  className={`min-h-[96px] w-full text-left rounded-2xl p-3.5 transition-all cursor-pointer flex flex-col justify-between gap-2.5 border ${
                    telemetry.isFinishedLocked
                      ? 'ap-card border-emerald-600/45 bg-emerald-50/70 dark:bg-[#13261C]'
                      : telemetry.isBellLap
                        ? 'ap-card border-amber-500/60 ring-1 ring-amber-400/50'
                        : 'ap-card hover:border-[#28573B] dark:hover:border-[#C8FF00]/60 active:scale-[0.99]'
                  }`}
                >
                  {/* Top Row: Lane + Athlete + Status Badge */}
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="ap-lane-badge shrink-0">
                        <span className="ap-lane-badge-inner">
                          {idx < 9 ? `L${idx + 1}` : `#${idx + 1}`}
                        </span>
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {telemetry.runnerName}
                        </div>
                        <div className="text-2xs font-mono text-slate-600 dark:text-slate-300 truncate">
                          {telemetry.podKey}
                          {telemetry.effectiveOffsetSecs > 0
                            ? ` · Wave +${telemetry.effectiveOffsetSecs.toFixed(1)}s`
                            : ''}
                          {sessionType === 'WORKOUT' && podMeta
                            ? ` · Target ${formatTrackMark(podMeta.targetLapSecs, 1)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {/* Dynamic Right Badge */}
                    <div className="shrink-0 flex items-center gap-1">
                      {nextChuteTs !== undefined && !telemetry.isFinishedLocked ? (
                        <span className="px-2 py-0.5 rounded-lg bg-[#1D3828] text-[#C8FF00] font-mono text-2xs font-bold">
                          Assign {formatTrackMark(nextChuteTs, 2)}
                        </span>
                      ) : sessionType === 'RACE' ? (
                        <div className="flex items-center gap-1">
                          {telemetry.placeLabel && (
                            <span className="px-2 py-0.5 rounded-lg ap-status-info font-mono text-2xs font-bold">
                              {telemetry.placeLabel}
                            </span>
                          )}
                          {telemetry.isFinishedLocked ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ap-status-prime font-mono text-2xs font-bold">
                              <Lock className="w-3 h-3" weight="bold" />
                              <span>Finished</span>
                            </span>
                          ) : telemetry.isBellLap ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ap-status-caution font-mono text-2xs font-bold">
                              <BellRinging className="w-3 h-3" weight="bold" />
                              <span>Bell Lap</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg ap-card-inset font-mono text-2xs font-semibold text-slate-700 dark:text-slate-300">
                              Lap {telemetry.lapCount}
                              {targetRaceLaps ? `/${targetRaceLaps}` : ''}
                            </span>
                          )}
                        </div>
                      ) : telemetry.restState.status === 'RESTING' ? (
                        <span className="px-2 py-0.5 rounded-lg ap-status-caution font-mono text-2xs font-bold tabular-nums">
                          Rest {telemetry.restState.remainingRestSecs}s
                        </span>
                      ) : telemetry.restState.status === 'GO_NOW' ? (
                        <span className="px-2 py-0.5 rounded-lg ap-status-prime font-mono text-2xs font-bold tabular-nums">
                          GO (+{telemetry.restState.overdueSecs}s)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg ap-card-inset font-mono text-2xs font-semibold text-slate-700 dark:text-slate-300">
                          {telemetry.lapCount} {telemetry.lapCount === 1 ? 'Lap' : 'Laps'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle Telemetry Readout */}
                  <div className="flex items-baseline justify-between gap-3 w-full pt-1 border-t border-emerald-900/10 dark:border-white/10">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-lg sm:text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">
                        {telemetry.lastLapSecs !== null
                          ? formatTrackMark(telemetry.lastLapSecs, 2)
                          : 'Tap Split'}
                      </span>
                      {telemetry.lastDeltaVsTargetSecs !== null && (
                        <span
                          className={`font-mono text-2xs font-bold tabular-nums px-1.5 py-0.5 rounded ${
                            telemetry.lastDeltaVsTargetSecs <= 0.5
                              ? 'ap-status-prime'
                              : 'ap-status-caution'
                          }`}
                        >
                          {telemetry.lastDeltaVsTargetSecs >= 0 ? '+' : ''}
                          {telemetry.lastDeltaVsTargetSecs.toFixed(2)}s
                        </span>
                      )}
                    </div>

                    <div className="text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                      <span className="text-2xs uppercase text-slate-500 dark:text-slate-400 mr-1">
                        Net
                      </span>
                      <span className="font-bold">
                        {telemetry.netTotalSecs !== null
                          ? formatFatTime(telemetry.netTotalSecs)
                          : '--:--.--'}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Recent Splits Trail & Live D'/Fade Strip */}
                  {telemetry.lapSplitsSecs.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-1.5 w-full">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {telemetry.lapSplitsSecs.slice(-4).map((lapSecs, lapIdx, arr) => {
                          const globalLapNum =
                            telemetry.lapSplitsSecs.length - arr.length + lapIdx + 1;
                          return (
                            <span
                              key={`trail-${globalLapNum}`}
                              className="px-1.5 py-0.5 rounded ap-card-inset font-mono text-2xs tabular-nums text-slate-700 dark:text-slate-200"
                            >
                              L{globalLapNum} {formatTrackMark(lapSecs, 2)}
                            </span>
                          );
                        })}
                      </div>
                      {sessionType === 'WORKOUT' && squadAutoRegSummary.byRunnerId[telemetry.runnerId] && (
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono text-2xs font-bold tabular-nums ${
                            squadAutoRegSummary.byRunnerId[telemetry.runnerId].cueType === 'NEURO_STOP_RULE'
                              ? 'ap-status-strained'
                              : squadAutoRegSummary.byRunnerId[telemetry.runnerId].cueType !== 'NONE'
                                ? 'ap-status-caution'
                                : 'ap-card-inset text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          D&apos; {squadAutoRegSummary.byRunnerId[telemetry.runnerId].dPrimeBalancePct}%
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* Matrix Clipboard Table View */
          <div className="ap-card rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table
                data-testid="stopwatch-matrix-table"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-emerald-900/15 dark:border-white/10 bg-[#E9EFE9] dark:bg-[#15231B] font-mono text-2xs uppercase text-slate-700 dark:text-slate-300">
                    <th className="py-2.5 px-3 sticky left-0 bg-[#E9EFE9] dark:bg-[#15231B] z-10">
                      Athlete &amp; Split Action
                    </th>
                    <th className="py-2.5 px-2.5">Pod</th>
                    <th className="py-2.5 px-2.5">
                      {sessionType === 'RACE' ? 'Status' : 'Recovery'}
                    </th>
                    {Array.from({ length: maxColumnsInMatrix }, (_, i) => (
                      <th key={`col-${i + 1}`} className="py-2.5 px-2.5 text-right">
                        L{i + 1}
                      </th>
                    ))}
                    <th className="py-2.5 px-2.5 text-right">Best</th>
                    <th className="py-2.5 px-2.5 text-right">Avg</th>
                    <th className="py-2.5 px-3 text-right">Net Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-900/10 dark:divide-white/10">
                  {filteredTelemetries.map((telemetry, idx) => (
                    <tr
                      key={`row-${telemetry.runnerId}`}
                      className="hover:bg-[#E9EFE9]/50 dark:hover:bg-[#15231B]/60"
                    >
                      <td className="py-2 px-3 sticky left-0 bg-white dark:bg-[#101B15] z-10">
                        <button
                          type="button"
                          data-testid={`matrix-split-btn-${idx}`}
                          onClick={() => handleRunnerAction(telemetry)}
                          className="min-h-[44px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ap-card-inset hover:border-[#28573B] dark:hover:border-[#C8FF00]/60 font-semibold text-slate-900 dark:text-white cursor-pointer"
                        >
                          <span className="font-mono text-2xs ap-text-brand font-bold">
                            L{idx + 1}
                          </span>
                          <span className="truncate max-w-[140px]">
                            {telemetry.runnerName}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#1D3828] text-[#C8FF00] font-mono text-2xs font-bold">
                            {telemetry.isFinishedLocked
                              ? 'Locked'
                              : chuteQueueSecs.length > 0
                                ? 'Assign #1'
                                : '+Split'}
                          </span>
                        </button>
                      </td>
                      <td className="py-2 px-2.5 font-mono text-2xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {telemetry.podKey}
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        {sessionType === 'RACE' ? (
                          <span className="font-mono text-2xs font-bold text-slate-800 dark:text-slate-200">
                            {telemetry.placeLabel || '—'}{' '}
                            {telemetry.isFinishedLocked
                              ? '· Fin'
                              : telemetry.isBellLap
                                ? '· Bell'
                                : ''}
                          </span>
                        ) : telemetry.restState.status === 'RESTING' ? (
                          <span className="px-2 py-0.5 rounded ap-status-caution font-mono text-2xs font-bold">
                            {telemetry.restState.remainingRestSecs}s
                          </span>
                        ) : telemetry.restState.status === 'GO_NOW' ? (
                          <span className="px-2 py-0.5 rounded ap-status-prime font-mono text-2xs font-bold">
                            GO
                          </span>
                        ) : (
                          <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                            —
                          </span>
                        )}
                      </td>
                      {Array.from({ length: maxColumnsInMatrix }, (_, lapIdx) => {
                        const splitVal = telemetry.lapSplitsSecs[lapIdx];
                        const isBest =
                          splitVal !== undefined &&
                          telemetry.bestLapSecs !== null &&
                          Math.abs(splitVal - telemetry.bestLapSecs) < 0.005;
                        return (
                          <td
                            key={`cell-${telemetry.runnerId}-${lapIdx}`}
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                              isBest
                                ? 'font-bold text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {splitVal !== undefined ? formatTrackMark(splitVal, 2) : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2 px-2.5 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {telemetry.bestLapSecs !== null
                          ? formatTrackMark(telemetry.bestLapSecs, 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {telemetry.avgLapSecs !== null
                          ? formatTrackMark(telemetry.avgLapSecs, 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                        {telemetry.netTotalSecs !== null
                          ? formatFatTime(telemetry.netTotalSecs)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 5. Walk-On Roster Deck & 1-Click THRESH Save / CSV Export Footer */}
      <section className="ap-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Quick Walk-On Runner Adder */}
          <form onSubmit={handleAddWalkOn} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={walkOnName}
              onChange={(e) => setWalkOnName(e.target.value)}
              placeholder="Add walk-on runner name..."
              aria-label="Walk-On Runner Name"
              className="w-56 sm:w-60 min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
            />
            <input
              type="number"
              step="0.5"
              min="30"
              max="84"
              value={walkOnVdot}
              onChange={(e) => setWalkOnVdot(e.target.value)}
              aria-label="Walk-On Runner VDOT"
              className="w-20 min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-2.5 font-mono text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#84CC16]"
            />
            <button
              type="submit"
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset hover:border-[#28573B] text-xs font-semibold text-slate-900 dark:text-white cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 ap-text-brand" weight="bold" />
              <span>Add Runner</span>
            </button>

            <button
              type="button"
              onClick={onOpenRosterModal}
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 rounded-xl ap-card-inset text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 ap-text-brand" weight="duotone" />
              <span>Manage Squad</span>
            </button>
          </form>

          {/* Include Self Toggle + Walk-on chips */}
          <div className="flex flex-wrap items-center gap-2">
            {(connectedRoster.length > 0 || extraPodAthletes.length > 0) && (
              <label className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-2 px-3 rounded-xl ap-card-inset text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSelfRunner}
                  onChange={(e) => setIncludeSelfRunner(e.target.checked)}
                  className="accent-[#65A30D]"
                />
                <span>Include Myself</span>
              </label>
            )}

            {extraPodAthletes.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-mono text-slate-700 dark:text-slate-200"
              >
                <span>
                  {w.name} (VDOT{' '}
                  {w.vdotOverride || estimateVdotFromThresholdPace(w.thresholdPaceSecsPerKm)})
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveWalkOn(w.id)}
                  aria-label={`Remove ${w.name}`}
                  className="text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Bottom Export & 1-Click Save Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-emerald-900/10 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="stopwatch-copy-csv"
              onClick={handleCopyCsv}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              {copiedCsv ? (
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" weight="bold" />
              ) : (
                <Copy className="w-4 h-4" weight="duotone" />
              )}
              <span>{copiedCsv ? 'Copied CSV' : 'Copy CSV'}</span>
            </button>

            <button
              type="button"
              data-testid="stopwatch-export-csv"
              onClick={handleDownloadCsv}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <DownloadSimple className="w-4 h-4 ap-text-brand" weight="bold" />
              <span>Export .CSV</span>
            </button>

            <button
              type="button"
              data-testid="stopwatch-share-card"
              onClick={handleShareStopwatchCard}
              disabled={totalSplitCount === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl ap-card-inset text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <ShareNetwork className="w-4 h-4 ap-text-brand" weight="bold" />
              <span>Share PNG Card</span>
            </button>

            {sessionType === 'RACE' && (
              <label className="min-h-[44px] inline-flex items-center gap-2 px-3 rounded-xl ap-card-inset text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWarmupCooldown}
                  onChange={(e) => setIncludeWarmupCooldown(e.target.checked)}
                  className="accent-[#65A30D]"
                />
                <span>Include Warmup/Cooldown</span>
              </label>
            )}
          </div>

          <button
            type="button"
            data-testid="stopwatch-save-thresh"
            onClick={handleSaveToThresh}
            disabled={totalSplitCount === 0}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1D3828] hover:bg-[#163022] text-white dark:bg-[#183122] dark:hover:bg-[#21422E] dark:text-[#C8FF00] border border-[#2B5B3F] text-xs font-bold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed transition-colors"
          >
            {sessionType === 'RACE' ? (
              <Trophy className="w-4 h-4 shrink-0" weight="duotone" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" weight="duotone" />
            )}
            <span>
              {sessionType === 'RACE'
                ? 'Save Official Race Marks to THRESH'
                : 'Save Workout Splits to THRESH'}
            </span>
          </button>
        </div>

        {sessionType === 'RACE' && (
          <TracksideMeetPassportPanel
            sessionTitle={sessionTitle}
            eventLabel={activeRacePreset.label}
            eventDistanceMeters={activeRacePreset.distanceMeters}
            finishers={runnerTelemetries
              .filter((t) => t.lapCount > 0 && t.netTotalSecs !== null)
              .map((t) => ({
                runnerId: t.runnerId,
                runnerName: t.runnerName,
                netTotalSecs: t.netTotalSecs ?? 0,
                lapSplitsSecs: t.lapSplitsSecs,
              }))}
          />
        )}

        {saveFeedbackMsg && (
          <div
            role="status"
            className="rounded-xl ap-status-prime px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold"
          >
            <span>{saveFeedbackMsg}</span>
            <button
              type="button"
              onClick={onOpenActivitiesTab}
              className="underline font-bold cursor-pointer"
            >
              View in Activities
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
