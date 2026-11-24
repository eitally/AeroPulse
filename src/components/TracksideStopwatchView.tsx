import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CoachEventGroup,
  TrackRepDistanceMeters,
} from '../types';
import {
  useTracksideStopwatch,
  type RunnerSplitTelemetry,
} from '../hooks/useTracksideStopwatch';
import {
  deriveThresholdPaceFromVdot,
  formatTrackMark,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import {
  buildTracksideStopwatchCsv,
  formatStopwatchClockMs,
} from '../utils/stopwatchActivitySynthesizer';
import { TracksideAutoRegBanner } from './track/TracksideAutoRegBanner';
import { TracksideRunnerCardsAndMatrix } from './stopwatch/TracksideRunnerCardsAndMatrix';
import {
  TracksideRelayBatonPanel,
  buildRelayCsvTelemetries,
} from './stopwatch/TracksideRelayBatonPanel';
import { TracksideWalkOnAndSaveBar } from './stopwatch/TracksideWalkOnAndSaveBar';
import {
  TracksideEnvPhysicsPanel,
  TracksideMultiSetStrip,
  TracksidePinHeatStrip,
  TracksideToolsPanel,
} from './stopwatch/TracksideEnvAndWavePanels';
import {
  TracksideHeaderBar,
  TracksideRecentSwapStrip,
  TracksideSetupFilterControls,
  TracksideWorkoutRepControls,
} from './stopwatch/TracksideHudSetupControls';
import {
  buildStopwatchSaveEntries,
  copyStopwatchCsvToClipboard,
  downloadStopwatchCsvFile,
  playTracksideFeedbackAudio,
  resolveStopwatchSaveFeedback,
  shareTracksideStopwatchCard,
  type SavedStopwatchEntry,
  type StopwatchSaveResultExtended,
  type TracksideStopwatchLaunchPreset,
  type TracksideStopwatchViewProps,
} from './stopwatch/tracksideStopwatchHelpers';
import { useTracksideTelemetryModel } from './stopwatch/useTracksideTelemetryModel';
import { useTracksideLifecycleEffects } from './stopwatch/useTracksideLifecycleEffects';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
  countPendingStopwatchOutboxEntries,
  type StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';
import {
  ArrowCounterClockwise,
  Lightning,
  Pause,
  Play,
  SquaresFour,
  Table,
} from './icons/PhosphorIcons';

export {
  resolveStopwatchSaveFeedback,
  type SavedStopwatchEntry,
  type StopwatchSaveResultExtended,
  type TracksideStopwatchLaunchPreset,
  type TracksideStopwatchViewProps,
};

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
  onOpenDelegateTiming,
  pendingTimingCount = 0,
  launchPreset = null,
  complexityTier = 'ESSENTIALS',
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
    relayQuartets,
    relayBatonTimestampsSecs,
    repStartTimestampsSecs,
    toggleStartPause,
    resetStopwatch,
    tapRunnerSplit,
    recordChuteTap,
    assignChuteToRunner,
    clearChuteQueue,
    undoLastSplit,
    undoRunnerLastSplit,
    swapLastTwoSplits,
    startNextRepForPod,
    startNextRepAll,
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
    tapRelayBatonHandoff,
    setRelayQuartetConfig,
    addRelayQuartet,
    removeRelayQuartet,
  } = useTracksideStopwatch(50);

  const [showEnvPhysicsPanel, setShowEnvPhysicsPanel] = useState<boolean>(false);
  useEffect(() => {
    if (complexityTier === 'ESSENTIALS') {
      setShowEnvPhysicsPanel(false);
    }
  }, [complexityTier]);

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
  const [selectedEventGroupFilter, setSelectedEventGroupFilter] = useState<'ALL' | CoachEventGroup>('ALL');
  const [showInjuredAthletes, setShowInjuredAthletes] = useState<boolean>(false);
  const [runnerSearchQuery, setRunnerSearchQuery] = useState<string>('');
  const [pinnedRunnerIds, setPinnedRunnerIds] = useState<string[]>([]);
  const [hipOrLaneByRunnerId, setHipOrLaneByRunnerId] = useState<Record<string, string>>({});
  const [onlyOnTrack, setOnlyOnTrack] = useState<boolean>(false);
  const [showPinStrip, setShowPinStrip] = useState<boolean>(false);
  const [walkOnName, setWalkOnName] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [copiedCsv, setCopiedCsv] = useState<boolean>(false);
  const [includeWarmupCooldown, setIncludeWarmupCooldown] = useState<boolean>(false);
  const hudHoldPauseTimerRef = useRef<number | null>(null);
  const hudHoldPauseSucceededRef = useRef<boolean>(false);
  const [isHoldingHudPause, setIsHoldingHudPause] = useState<boolean>(false);
  const [saveFeedbackMsg, setSaveFeedbackMsg] = useState<string | null>(null);
  const [saveFeedbackTone, setSaveFeedbackTone] = useState<'prime' | 'caution'>('prime');
  const [isSavingToThresh, setIsSavingToThresh] = useState<boolean>(false);
  const [isFlushingOutbox, setIsFlushingOutbox] = useState<boolean>(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setIncludeSelfRunner(!isCoachingTeam);
  }, [isCoachingTeam]);

  useEffect(() => {
    return () => {
      if (tapFlashTimerRef.current !== null) {
        window.clearTimeout(tapFlashTimerRef.current);
      }
    };
  }, []);

  const playFeedback = useCallback(
    (kind: 'GUN' | 'SPLIT' | 'CHUTE' | 'BELL') => {
      playTracksideFeedbackAudio(kind, soundEnabled, audioCtxRef);
    },
    [soundEnabled]
  );

  const {
    customPlanPreset,
    activeWorkoutPreset,
    activeRacePreset,
    connectedRoster,
    rosterInputs,
    vdotPods,
    laneGeometry,
    activeEnvAdjustment,
    runnerPodLookup,
    activePodKeys,
    injuredAthleteCount,
    hasAssignedEventGroups,
    targetRaceLaps,
    runnerTelemetries,
    recentSwapPair,
    podsAwaitingNextRep,
    filteredTelemetries,
    maxColumnsInMatrix,
    squadAutoRegSummary,
    isRelayMode,
    relayTelemetries,
    hasCustomEnvOrLane,
  } = useTracksideTelemetryModel({
    selfName,
    selfProfile,
    roster,
    activeTeam,
    isCoachingTeam,
    sessionType,
    sessionTitle,
    workoutPresetId,
    customWorkoutSpec,
    raceEventLabel,
    restDurationSecs,
    customRepOverride,
    customDistOverride,
    includeSelfRunner,
    extraPodAthletes,
    athleteLapTimestampsSecs,
    repStartTimestampsSecs,
    hipOrLaneByRunnerId,
    waveMode,
    podWaveOffsetsSecs,
    runnerLastTapEpochMs,
    nowEpochMs,
    stopwatchRunning,
    tapHistory,
    selectedPodFilter,
    selectedEventGroupFilter,
    showInjuredAthletes,
    runnerSearchQuery,
    onlyOnTrack,
    pinnedRunnerIds,
    dismissedAutoRegSignatures,
    trackLane,
    isStaggeredStart,
    trackFacility,
    airTempF,
    dewPointF,
    windSpeedMps,
    altitudeMeters,
    footwearClass,
    showEnvPhysicsPanel,
    relayQuartets,
    relayBatonTimestampsSecs,
  });

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

  const {
    isMobileViewport,
    pendingOutboxCount,
    setPendingOutboxCount,
    isOnline,
    wakeLockState,
  } = useTracksideLifecycleEffects({
    activeTeamId,
    wakeLockEnabled,
    confirmReset,
    setConfirmReset,
    copiedCsv,
    setCopiedCsv,
    launchPreset,
    connectedRoster,
    setSessionType,
    setRaceEventLabel,
    setSessionTitle,
    setExtraPodAthletes,
    setHipOrLaneByRunnerId,
    setPinnedRunnerIds,
    setOnlyOnTrack,
    keyboardShortcutsEnabled,
    handleGunToggle,
    handleChuteTap,
    handleUndo,
    handleRunnerAction,
    filteredTelemetries,
    showChuteBar,
    setShowChuteBar,
    holdPauseTimerRef,
    hudHoldPauseTimerRef,
  });

  const handleStartHudHoldPause = useCallback(() => {
    if (!stopwatchRunning || !isMobileViewport || isHoldingHudPause) return;
    hudHoldPauseSucceededRef.current = false;
    setIsHoldingHudPause(true);
    hudHoldPauseTimerRef.current = window.setTimeout(() => {
      hudHoldPauseTimerRef.current = null;
      hudHoldPauseSucceededRef.current = true;
      setIsHoldingHudPause(false);
      handleGunToggle();
    }, 450);
  }, [stopwatchRunning, isMobileViewport, isHoldingHudPause, handleGunToggle]);

  const cancelHudHoldPause = useCallback(() => {
    if (hudHoldPauseTimerRef.current !== null) {
      window.clearTimeout(hudHoldPauseTimerRef.current);
      hudHoldPauseTimerRef.current = null;
    }
    setIsHoldingHudPause(false);
  }, []);

  const handleUndoRunnerLastSplit = useCallback(
    (runnerId: string) => {
      const undone = undoRunnerLastSplit(runnerId);
      if (undone) {
        playFeedback('CHUTE');
        setLiveAnnouncement(
          `Undid ${undone.runnerName} mark at ${formatTrackMark(undone.timestampSecs, 2)}`
        );
      }
    },
    [undoRunnerLastSplit, playFeedback]
  );

  const handleSwapLastTwo = useCallback(() => {
    const result = swapLastTwoSplits();
    if (result.swapped && result.pair) {
      playFeedback('SPLIT');
      setLiveAnnouncement(
        `Swapped last two finishes: ${result.pair.firstRunnerName} and ${result.pair.secondRunnerName}`
      );
    }
  }, [swapLastTwoSplits, playFeedback]);

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
      telemetries: isRelayMode
        ? buildRelayCsvTelemetries(relayTelemetries)
        : runnerTelemetries,
    });

  const handleCopyCsv = async () => {
    await copyStopwatchCsvToClipboard(buildCsvPayload());
    setCopiedCsv(true);
    setLiveAnnouncement('Split sheet CSV copied to clipboard');
  };

  const handleDownloadCsv = () => {
    const slugSource = sessionType === 'RACE' ? activeRacePreset.label : activeWorkoutPreset.id;
    downloadStopwatchCsvFile(buildCsvPayload(), sessionType, slugSource);
    setLiveAnnouncement('Downloaded trackside splits CSV');
  };

  const handleShareStopwatchCard = () => {
    shareTracksideStopwatchCard({
      isRelayMode,
      relayTelemetries,
      runnerTelemetries,
      myTeams,
      activeTeamId,
      sessionType,
      activeRacePreset,
      activeWorkoutPreset,
      sessionTitle,
      selfProfile,
    });
  };

  const handleSaveToThresh = async () => {
    if (isSavingToThresh) return;
    const entries = buildStopwatchSaveEntries({
      isRelayMode,
      relayTelemetries,
      runnerTelemetries,
      roster,
      sessionStartedEpochMs,
      stopwatchElapsedMs,
      activeRacePreset,
      activeWorkoutPreset,
      selfProfile,
      sessionTitle,
      includeWarmupCooldown,
      trackLane,
      sessionType,
      restDurationSecs,
      footwearClass,
      trackFacility,
      endedEarlyStimulusRatio,
      autoRegPivotHistory,
      customWorkoutSpec,
    });
    if (!entries) return;

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

      const feedback = resolveStopwatchSaveFeedback(
        saveResult as StopwatchSaveResultExtended,
        sessionType,
        endedEarlyStimulusRatio
      );
      setSaveFeedbackTone(feedback.tone);
      setSaveFeedbackMsg(feedback.message);
    } catch (err) {
      setSaveFeedbackTone('caution');
      setSaveFeedbackMsg(
        err instanceof Error
          ? err.message
          : 'Failed to sync stopwatch splits. Your local marks remain safely saved on device.'
      );
    } finally {
      setIsSavingToThresh(false);
    }
  };

  return (
    <div className="space-y-3 pb-32 md:pb-6">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* 1. Unified Trackside Top Header & Sticky Control Deck */}
      <TracksideHeaderBar
        onOpenActivitiesTab={onOpenActivitiesTab}
        isOnline={isOnline}
        onOpenDelegateTiming={onOpenDelegateTiming}
        pendingTimingCount={pendingTimingCount}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        sessionType={sessionType}
        setSessionType={setSessionType}
        onClearFeedback={() => setSaveFeedbackMsg(null)}
      />

      <section
        className={`relative ${showToolsDrawer ? '' : 'md:sticky md:top-[60px]'} z-20 rounded-xl ap-card ap-card-clay-top p-2.5 sm:p-4 space-y-2 sm:space-y-3`}
      >
        {/* HUD Row 1: Track Asphalt Clock Housing + Starter Volt Gun + Undo + Chute */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            data-testid="stopwatch-master-clock"
            className="rounded-xl bg-[#121413] text-[#D8FF2A] border border-[#121413] dark:border-white/20 px-3 sm:px-5 py-1.5 sm:py-2 font-mono text-xl sm:text-3xl font-extrabold tabular-nums tracking-tight shrink-0"
          >
            {formatStopwatchClockMs(stopwatchElapsedMs)}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 justify-end">
            {(!isMobileViewport || (!stopwatchRunning && stopwatchElapsedMs === 0)) && (
              <>
                <button
                  type="button"
                  data-testid="stopwatch-gun-btn"
                  onPointerDown={() => {
                    if (stopwatchRunning && isMobileViewport) {
                      handleStartHudHoldPause();
                    }
                  }}
                  onPointerUp={cancelHudHoldPause}
                  onPointerLeave={cancelHudHoldPause}
                  onPointerCancel={cancelHudHoldPause}
                  onClick={(e) => {
                    if (stopwatchRunning && isMobileViewport && e.detail > 0) {
                      e.preventDefault();
                      return;
                    }
                    if (hudHoldPauseSucceededRef.current) {
                      hudHoldPauseSucceededRef.current = false;
                      return;
                    }
                    handleGunToggle();
                  }}
                  className={
                    stopwatchRunning
                      ? 'min-h-[44px] inline-flex items-center gap-1.5 px-3 sm:px-4 rounded-xl ap-status-caution font-bold text-xs cursor-pointer select-none'
                      : 'ap-btn-primary min-h-[44px] px-3 sm:px-4 text-xs cursor-pointer'
                  }
                >
                  {stopwatchRunning ? (
                    <>
                      <Pause className="w-4 h-4" weight="fill" />
                      <span>
                        {isMobileViewport
                          ? isHoldingHudPause
                            ? 'Hold to Pause...'
                            : 'Hold to Pause'
                          : 'Pause'}
                      </span>
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
                  className="min-h-[44px] inline-flex items-center gap-1 px-3 rounded-xl ap-btn-secondary text-xs font-semibold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ArrowCounterClockwise className="w-4 h-4" weight="bold" />
                  <span>Undo</span>
                </button>

                {(showChuteBar || sessionType === 'RACE') && (
                  <button
                    type="button"
                    data-testid="stopwatch-chute-tap"
                    onClick={handleChuteTap}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-xl bg-[#121413] hover:bg-[#242826] text-[#F6F3EC] dark:text-[#D8FF2A] border border-[#121413] dark:border-white/25 text-xs font-bold cursor-pointer transition-colors"
                  >
                    <Lightning className="w-4 h-4 shrink-0" weight="fill" />
                    <span>Chute</span>
                    {chuteQueueSecs.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-ap-clay text-[#F6F3EC] font-mono text-2xs">
                        {chuteQueueSecs.length}
                      </span>
                    )}
                  </button>
                )}
              </>
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

        {chuteQueueSecs.length > 0 && (
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
                    ? 'bg-[#121413] text-ap-volt border border-ap-clay dark:border-ap-volt'
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
        )}

        {/* HUD Row 2: Preset + Recovery + Pod Select + View Switcher + Env/Tools */}
        <div
          className={`${
            (!stopwatchRunning && stopwatchElapsedMs === 0) || mobileSetupExpanded
              ? 'flex'
              : 'hidden md:flex'
          } flex-wrap items-center gap-1.5 pt-2 border-t border-ap-frame/15 dark:border-white/10`}
        >
          <TracksideSetupFilterControls
            sessionType={sessionType}
            workoutPresetId={workoutPresetId}
            setWorkoutPresetId={setWorkoutPresetId}
            raceEventLabel={raceEventLabel}
            setRaceEventLabel={setRaceEventLabel}
            customPlanPreset={customPlanPreset}
            restDurationSecs={restDurationSecs}
            setRestDurationSecs={setRestDurationSecs}
            selectedPodFilter={selectedPodFilter}
            setSelectedPodFilter={setSelectedPodFilter}
            runnerTelemetries={runnerTelemetries}
            activePodKeys={activePodKeys}
            hasAssignedEventGroups={hasAssignedEventGroups}
            isCoachingTeam={isCoachingTeam}
            selectedEventGroupFilter={selectedEventGroupFilter}
            setSelectedEventGroupFilter={setSelectedEventGroupFilter}
            injuredAthleteCount={injuredAthleteCount}
            showInjuredAthletes={showInjuredAthletes}
            setShowInjuredAthletes={setShowInjuredAthletes}
            runnerSearchQuery={runnerSearchQuery}
            setRunnerSearchQuery={setRunnerSearchQuery}
            onlyOnTrack={onlyOnTrack}
            setOnlyOnTrack={setOnlyOnTrack}
            pinnedRunnerIds={pinnedRunnerIds}
            showPinStrip={showPinStrip}
            setShowPinStrip={setShowPinStrip}
            showChuteBar={showChuteBar}
            setShowChuteBar={setShowChuteBar}
            showEnvPhysicsPanel={showEnvPhysicsPanel}
            setShowEnvPhysicsPanel={setShowEnvPhysicsPanel}
            hasCustomEnvOrLane={hasCustomEnvOrLane}
            trackLane={trackLane}
            lapLengthMeters={laneGeometry.lapLengthMeters}
          />
        </div>

        {/* Always-Visible Compact View Switcher & Tools Bar (accessible on 390px while clock is running) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-ap-frame/15 dark:border-white/10">
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
          <TracksideToolsPanel
            sessionType={sessionType}
            sessionTitle={sessionTitle}
            setSessionTitle={setSessionTitle}
            wakeLockEnabled={wakeLockEnabled}
            setWakeLockEnabled={setWakeLockEnabled}
            wakeLockState={wakeLockState}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
            keyboardShortcutsEnabled={keyboardShortcutsEnabled}
            setKeyboardShortcutsEnabled={setKeyboardShortcutsEnabled}
            waveMode={waveMode}
            setWaveMode={setWaveMode}
            vdotPods={vdotPods}
            activePodKeys={activePodKeys}
            podWaveOffsetsSecs={podWaveOffsetsSecs}
            stopwatchRunning={stopwatchRunning}
            setPodWaveOffset={setPodWaveOffset}
            triggerPodWaveNow={triggerPodWaveNow}
            hasActiveSession={hasActiveSession}
            confirmReset={confirmReset}
            setConfirmReset={setConfirmReset}
            onResetStopwatch={resetStopwatch}
            onClearFeedback={() => setSaveFeedbackMsg(null)}
          />
        )}

        {activeEnvAdjustment.heatAbortTriggered && (
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
        )}

        {sessionType === 'WORKOUT' &&
          (!stopwatchRunning || (restDurationSecs > 0 && podsAwaitingNextRep.length > 0)) && (
          <TracksideWorkoutRepControls
            stopwatchRunning={stopwatchRunning}
            restDurationSecs={restDurationSecs}
            podsAwaitingNextRep={podsAwaitingNextRep}
            repCount={activeWorkoutPreset.repCount}
            repDistanceMeters={activeWorkoutPreset.repDistanceMeters}
            setCustomRepOverride={setCustomRepOverride}
            setCustomDistOverride={setCustomDistOverride}
            startNextRepAll={startNextRepAll}
            startNextRepForPod={startNextRepForPod}
            playFeedback={playFeedback}
            setLiveAnnouncement={setLiveAnnouncement}
          />
        )}

        <TracksideMultiSetStrip
          sessionType={sessionType}
          customWorkoutSpec={customWorkoutSpec}
        />
        <TracksideEnvPhysicsPanel
          showEnvPhysicsPanel={showEnvPhysicsPanel}
          trackLane={trackLane}
          setTrackLane={setTrackLane}
          trackFacility={trackFacility}
          setTrackFacility={setTrackFacility}
          airTempF={airTempF}
          setAirTempF={setAirTempF}
          dewPointF={dewPointF}
          setDewPointF={setDewPointF}
          windSpeedMps={windSpeedMps}
          setWindSpeedMps={setWindSpeedMps}
          altitudeMeters={altitudeMeters}
          setAltitudeMeters={setAltitudeMeters}
          footwearClass={footwearClass}
          setFootwearClass={setFootwearClass}
          isStaggeredStart={isStaggeredStart}
          setIsStaggeredStart={setIsStaggeredStart}
          laneGeometry={laneGeometry}
          activeEnvAdjustment={activeEnvAdjustment}
        />
      </section>

      <TracksidePinHeatStrip
        showPinStrip={showPinStrip}
        runnerTelemetries={runnerTelemetries}
        pinnedRunnerIds={pinnedRunnerIds}
        onTogglePinnedRunner={(runnerId) => {
          const exists = pinnedRunnerIds.includes(runnerId);
          const next = exists
            ? pinnedRunnerIds.filter((id) => id !== runnerId)
            : [...pinnedRunnerIds, runnerId];
          setPinnedRunnerIds(next);
          setOnlyOnTrack(next.length > 0);
        }}
        onClearPinnedRunners={() => {
          setPinnedRunnerIds([]);
          setOnlyOnTrack(false);
        }}
      />

      {sessionType === 'WORKOUT' && (
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
      )}

      {recentSwapPair && !isRelayMode && (
        <TracksideRecentSwapStrip
          tapGapSecs={recentSwapPair.tapGapSecs}
          prevRunnerName={recentSwapPair.prev.runnerName}
          lastRunnerName={recentSwapPair.last.runnerName}
          onSwapLastTwo={handleSwapLastTwo}
        />
      )}

      {/* 2. Unified Clean Runner Tap Area (Relay Baton Panel OR 4-Datum Cards / Matrix) */}
      {isRelayMode ? (
        <TracksideRelayBatonPanel
          activeRacePreset={activeRacePreset}
          quartets={relayQuartets}
          relayTelemetries={relayTelemetries}
          rosterInputs={rosterInputs}
          stopwatchRunning={stopwatchRunning}
          onTapBatonHandoff={(qId) => {
            const res = tapRelayBatonHandoff(qId);
            if (!res.blockedByFinishLock) {
              playFeedback(res.legNumber === 4 ? 'BELL' : 'SPLIT');
              setLiveAnnouncement(
                `Relay handoff leg ${res.legNumber} recorded at ${formatTrackMark(res.handoffSecs, 2)}`
              );
            }
          }}
          onUpdateQuartet={setRelayQuartetConfig}
          onAddQuartet={addRelayQuartet}
          onRemoveQuartet={removeRelayQuartet}
        />
      ) : (
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
          onUndoRunnerLastSplit={handleUndoRunnerLastSplit}
        />
      )}

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
