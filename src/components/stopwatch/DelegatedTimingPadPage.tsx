import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DelegatedSplitSubmissionEntry,
  DelegatedTimingRunner,
  DelegatedTimingSessionRecord,
  PublicDelegatedTimingPassPayload,
} from '../../types';
import {
  applyResetStopwatch,
  applySwapLastTwoSplits,
  applyTapRunnerSplit,
  applyToggleStartPause,
  applyUndoLastSplit,
  applyUndoRunnerLastSplit,
  computeElapsedMs,
  computeRaceStandings,
  computeRunnerSplitTelemetry,
  getRecentSwappableSplitPair,
  type PersistedTracksideStopwatchState,
  type RunnerSplitTelemetry,
} from '../../hooks/useTracksideStopwatch';
import { formatStopwatchClockMs } from '../../utils/stopwatchActivitySynthesizer';
import { generateQrCodeSvgMarkup } from '../../utils/qrCodeSvg';
import {
  cachePublicTimingPassLocally,
  encodeDelegatedSplitHandoffPayload,
  enqueueOfflineDelegatedSubmission,
  fetchPublicTimingPassApi,
  flushOfflineDelegatedSubmissions,
  loadOfflineDelegatedSubmissions,
  readCachedPublicTimingPass,
  submitDelegatedSplitsApi,
} from '../../utils/timingDelegationApi';
import { TeamLifecycleApiError } from '../../utils/teamLifecycleApi';
import { TracksideRunnerCardsAndMatrix } from './TracksideRunnerCardsAndMatrix';
import {
  ArrowCounterClockwise,
  ArrowsLeftRight,
  Check,
  CheckCircle2,
  Copy,
  Key,
  Lock,
  Pause,
  Play,
  Plus,
  Send,
  SpeakerHigh,
  SpeakerSlash,
  WifiSlash,
  X,
} from '../icons/PhosphorIcons';

const PAD_STATE_STORAGE_PREFIX = 'thresh_delegated_pad_v1:';
const HOLD_PAUSE_MS = 450;

interface ScopedWalkOnRunner {
  entryKey: string;
  displayName: string;
  hipOrLane?: string;
}

interface PersistedDelegatedPadData {
  stopwatch: PersistedTracksideStopwatchState;
  walkOns: ScopedWalkOnRunner[];
  capturedByName: string;
  clientSubmissionId: string;
}

function createInitialPadData(defaultTimerName = ''): PersistedDelegatedPadData {
  return {
    stopwatch: {
      isRunning: false,
      startedAtEpochMs: null,
      sessionStartedEpochMs: null,
      accumulatedMs: 0,
      athleteLapTimestampsSecs: {},
      tapHistory: [],
      extraPodAthletes: [],
      sessionType: 'RACE',
      viewMode: 'CARDS',
      showChuteBar: false,
      soundEnabled: true,
      wakeLockEnabled: true,
    },
    walkOns: [],
    capturedByName: defaultTimerName,
    clientSubmissionId: `dsub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  };
}

function readPersistedPadData(
  scopeKey: string,
  defaultTimerName = ''
): PersistedDelegatedPadData {
  const fallback = createInitialPadData(defaultTimerName);
  if (typeof window === 'undefined' || !scopeKey) return fallback;
  try {
    const raw = window.localStorage.getItem(`${PAD_STATE_STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedDelegatedPadData>;
    if (!parsed || typeof parsed !== 'object' || !parsed.stopwatch) return fallback;
    return {
      stopwatch: {
        ...fallback.stopwatch,
        ...parsed.stopwatch,
        sessionType: 'RACE',
        athleteLapTimestampsSecs: parsed.stopwatch.athleteLapTimestampsSecs || {},
        tapHistory: Array.isArray(parsed.stopwatch.tapHistory) ? parsed.stopwatch.tapHistory : [],
      },
      walkOns: Array.isArray(parsed.walkOns) ? parsed.walkOns : [],
      capturedByName:
        typeof parsed.capturedByName === 'string' && parsed.capturedByName
          ? parsed.capturedByName
          : defaultTimerName,
      clientSubmissionId:
        typeof parsed.clientSubmissionId === 'string' && parsed.clientSubmissionId
          ? parsed.clientSubmissionId
          : fallback.clientSubmissionId,
    };
  } catch {
    return fallback;
  }
}

function writePersistedPadData(scopeKey: string, data: PersistedDelegatedPadData): void {
  if (typeof window === 'undefined' || !scopeKey) return;
  try {
    window.localStorage.setItem(`${PAD_STATE_STORAGE_PREFIX}${scopeKey}`, JSON.stringify(data));
  } catch {
    // ignore storage quota errors
  }
}

export interface DelegatedTimingPadPageProps {
  passCode?: string;
  assignmentSession?: DelegatedTimingSessionRecord;
  initialPassPayload?: PublicDelegatedTimingPassPayload;
  defaultTimerName?: string;
  onExit?: () => void;
  onSubmitted?: () => void;
  isSampleDemoMode?: boolean;
}

export const DelegatedTimingPadPage: React.FC<DelegatedTimingPadPageProps> = ({
  passCode,
  assignmentSession,
  initialPassPayload,
  defaultTimerName = '',
  onExit,
  onSubmitted,
  isSampleDemoMode = false,
}) => {
  const effectivePassCode = (
    assignmentSession?.passCode ||
    passCode ||
    initialPassPayload?.session?.passCode ||
    ''
  )
    .trim()
    .toUpperCase();

  const [passPayload, setPassPayload] = useState<PublicDelegatedTimingPassPayload | null>(() => {
    if (assignmentSession) {
      return {
        found: true,
        expiredOrRevoked: Boolean(assignmentSession.revokedAt),
        pinRequired: false,
        pinVerified: true,
        session: {
          sessionId: assignmentSession.sessionId,
          teamId: assignmentSession.teamId,
          passCode: assignmentSession.passCode,
          meetTitle: assignmentSession.meetTitle,
          meetDate: assignmentSession.meetDate,
          eventCode: assignmentSession.eventCode,
          eventLabel: assignmentSession.eventLabel,
          ...(assignmentSession.heatLabel ? { heatLabel: assignmentSession.heatLabel } : {}),
          stationType: assignmentSession.stationType,
          stationLabel: assignmentSession.stationLabel,
          splitPlanLabel: assignmentSession.splitPlanLabel,
          targetSplitMeters: assignmentSession.targetSplitMeters,
          targetLapCount: assignmentSession.targetLapCount,
          runners: assignmentSession.runners,
          expiresAt: assignmentSession.expiresAt,
        },
      };
    }
    if (initialPassPayload) return initialPassPayload;
    return effectivePassCode ? readCachedPublicTimingPass(effectivePassCode) : null;
  });

  const [isLoadingPass, setIsLoadingPass] = useState<boolean>(
    () => !assignmentSession && !initialPassPayload && Boolean(effectivePassCode)
  );
  const [pinInput, setPinInput] = useState<string>('');
  const [verifiedPin, setVerifiedPin] = useState<string>('');
  const [passErrorMsg, setPassErrorMsg] = useState<string | null>(null);

  const loadPass = useCallback(
    async (candidatePin?: string) => {
      if (!effectivePassCode || assignmentSession) return;
      setIsLoadingPass(true);
      setPassErrorMsg(null);
      try {
        const res = await fetchPublicTimingPassApi(effectivePassCode, candidatePin);
        if (res.httpStatus && res.httpStatus >= 500) {
          const cached = readCachedPublicTimingPass(effectivePassCode);
          if (cached) {
            setPassPayload(cached);
            setPassErrorMsg('Offline mode — loaded cached timing pass from device.');
            return;
          }
        }
        setPassPayload(res);
        if (res.found && res.session) {
          cachePublicTimingPassLocally(effectivePassCode, res);
          if (candidatePin) setVerifiedPin(candidatePin);
        } else if (res.error) {
          setPassErrorMsg(res.error);
        }
      } catch {
        const cached = readCachedPublicTimingPass(effectivePassCode);
        if (cached) {
          setPassPayload(cached);
          setPassErrorMsg('No signal — timing pass loaded from offline cache.');
        } else {
          setPassErrorMsg('Unable to reach server. Connect briefly to load this timing pass.');
        }
      } finally {
        setIsLoadingPass(false);
      }
    },
    [effectivePassCode, assignmentSession]
  );

  useEffect(() => {
    if (!assignmentSession && !initialPassPayload && effectivePassCode) {
      void loadPass();
    }
  }, [assignmentSession, initialPassPayload, effectivePassCode, loadPass]);

  const scopeKey = passPayload?.session?.sessionId || effectivePassCode || 'local';
  const [padData, setPadData] = useState<PersistedDelegatedPadData>(() =>
    readPersistedPadData(scopeKey, defaultTimerName)
  );
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());
  const [walkOnInput, setWalkOnInput] = useState<string>('');
  const [lastTappedRunnerId, setLastTappedRunnerId] = useState<string | null>(null);
  const [isHoldingPause, setIsHoldingPause] = useState<boolean>(false);
  const [showHandoffSheet, setShowHandoffSheet] = useState<boolean>(false);
  const [copiedHandoff, setCopiedHandoff] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStatus, setSubmitStatus] = useState<{
    tone: 'prime' | 'caution';
    message: string;
  } | null>(null);
  const [queuedCount, setQueuedCount] = useState<number>(() =>
    loadOfflineDelegatedSubmissions(effectivePassCode).length
  );
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const holdTimerRef = useRef<number | null>(null);
  const holdSucceededRef = useRef<boolean>(false);
  const lastTapMapRef = useRef<Map<string, number>>(new Map());
  const flashTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setPadData(readPersistedPadData(scopeKey, defaultTimerName));
    setQueuedCount(loadOfflineDelegatedSubmissions(effectivePassCode).length);
  }, [scopeKey, effectivePassCode, defaultTimerName]);

  const commitPadData = useCallback(
    (updater: (prev: PersistedDelegatedPadData) => PersistedDelegatedPadData) => {
      setPadData((prev) => {
        const next = updater(prev);
        writePersistedPadData(scopeKey, next);
        return next;
      });
    },
    [scopeKey]
  );

  const recentSwapPair = useMemo(
    () => getRecentSwappableSplitPair(padData.stopwatch.tapHistory, nowEpochMs, 4, 8000),
    [padData.stopwatch.tapHistory, nowEpochMs]
  );

  useEffect(() => {
    if (!padData.stopwatch.isRunning && !recentSwapPair) return;
    setNowEpochMs(Date.now());
    const interval = padData.stopwatch.isRunning ? 50 : 250;
    const id = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, interval);
    return () => window.clearInterval(id);
  }, [padData.stopwatch.isRunning, recentSwapPair]);

  useEffect(() => {
    const onOnline = () => {
      if (!effectivePassCode || isSampleDemoMode) return;
      void flushOfflineDelegatedSubmissions(effectivePassCode).then((res) => {
        setQueuedCount(res.remainingCount);
        if (res.flushedCount > 0) {
          setSubmitStatus({
            tone: 'prime',
            message: `Synced ${res.flushedCount} queued timing submission to coach.`,
          });
          onSubmitted?.();
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, [effectivePassCode, isSampleDemoMode, onSubmitted]);

  const playFeedback = useCallback(
    (kind: 'GUN' | 'SPLIT' | 'BELL') => {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(kind === 'BELL' ? [20, 35, 20] : 15);
        }
      } catch {
        // ignore vibration unsupported
      }
      if (!padData.stopwatch.soundEnabled || typeof window === 'undefined') return;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') void ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(
          kind === 'BELL' ? 1174 : kind === 'GUN' ? 1046 : 880,
          ctx.currentTime
        );
        gain.gain.setValueAtTime(0.28, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.055);
      } catch {
        // ignore Web Audio errors
      }
    },
    [padData.stopwatch.soundEnabled]
  );

  const session = passPayload?.session;
  const elapsedMs = computeElapsedMs(padData.stopwatch, nowEpochMs);

  const combinedRunners = useMemo<DelegatedTimingRunner[]>(() => {
    const base = session?.runners || [];
    const baseKeys = new Set(base.map((r) => r.entryKey));
    const walkOns = padData.walkOns.filter((w) => !baseKeys.has(w.entryKey));
    return [
      ...base.map((r) => ({ ...r, isWalkOn: Boolean(r.isWalkOn) })),
      ...walkOns.map((w) => ({
        entryKey: w.entryKey,
        displayName: w.displayName,
        ...(w.hipOrLane ? { hipOrLane: w.hipOrLane } : {}),
        isWalkOn: true,
      })),
    ];
  }, [session?.runners, padData.walkOns]);

  const runnerTelemetries = useMemo<RunnerSplitTelemetry[]>(() => {
    const targetLaps = session?.targetLapCount || null;
    const rawList = combinedRunners.map((r) =>
      computeRunnerSplitTelemetry({
        runnerId: r.entryKey,
        runnerName: r.displayName,
        podKey: session?.stationLabel || 'Trackside',
        ...(r.hipOrLane ? { hipOrLane: r.hipOrLane } : {}),
        rawTimestampsSecs: padData.stopwatch.athleteLapTimestampsSecs[r.entryKey] || [],
        targetLapSecs: r.targetSplitSecs ?? null,
        targetRaceLaps: targetLaps,
        sessionType: 'RACE',
        restDurationSecs: 0,
      })
    );
    return computeRaceStandings(rawList);
  }, [combinedRunners, session, padData.stopwatch.athleteLapTimestampsSecs]);

  const emptyPodLookup = useMemo(
    () => new Map<string, { podKey: string; targetLapSecs: number }>(),
    []
  );

  const timedEntries = useMemo<DelegatedSplitSubmissionEntry[]>(() => {
    const runnerByKey = new Map(combinedRunners.map((r) => [r.entryKey, r]));
    return runnerTelemetries
      .filter((t) => t.lapCount > 0 && t.netTotalSecs !== null)
      .map((t) => {
        const meta = runnerByKey.get(t.runnerId);
        return {
          entryKey: t.runnerId,
          ...(typeof meta?.membershipId === 'string' && meta.membershipId
            ? { membershipId: meta.membershipId }
            : {}),
          athleteName: t.runnerName,
          ...(t.hipOrLane ? { hipOrLane: t.hipOrLane } : {}),
          totalSecs: t.netTotalSecs ?? 0,
          lapSplitsSecs: t.lapSplitsSecs,
          rawLapTimestampsSecs: padData.stopwatch.athleteLapTimestampsSecs[t.runnerId] || [],
          ...(meta?.isWalkOn ? { isWalkOn: true } : {}),
        };
      });
  }, [combinedRunners, runnerTelemetries, padData.stopwatch.athleteLapTimestampsSecs]);

  const handoffCode = useMemo(() => {
    if (!session || timedEntries.length === 0) return '';
    return encodeDelegatedSplitHandoffPayload({
      version: 1,
      passCode: session.passCode,
      meetTitle: session.meetTitle,
      eventLabel: session.eventLabel,
      heatLabel: session.heatLabel,
      stationType: session.stationType,
      capturedByName: padData.capturedByName.trim() || defaultTimerName || 'Trackside Helper',
      clientSubmissionId: padData.clientSubmissionId,
      submittedAt: new Date().toISOString(),
      entries: timedEntries,
    });
  }, [session, timedEntries, padData.capturedByName, padData.clientSubmissionId, defaultTimerName]);

  const handoffQrSvg = useMemo(() => {
    if (!handoffCode || handoffCode.length > 106) return '';
    return generateQrCodeSvgMarkup(handoffCode, '#080A09', 184);
  }, [handoffCode]);

  const handleToggleGun = useCallback(() => {
    const now = Date.now();
    commitPadData((prev) => ({
      ...prev,
      stopwatch: applyToggleStartPause(prev.stopwatch, now),
    }));
    setNowEpochMs(now);
    playFeedback('GUN');
    setLiveAnnouncement(padData.stopwatch.isRunning ? 'Clock paused' : 'Start gun fired');
  }, [commitPadData, playFeedback, padData.stopwatch.isRunning]);

  const handleRunnerAction = useCallback(
    (telemetry: RunnerSplitTelemetry) => {
      if (telemetry.isFinishedLocked) {
        setLiveAnnouncement(
          `${telemetry.runnerName} finished at ${telemetry.lapCount} laps. Tap ↺ to undo.`
        );
        return;
      }
      const nowTap = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const prevTap = lastTapMapRef.current.get(telemetry.runnerId) ?? 0;
      if (nowTap - prevTap < 350) return;
      lastTapMapRef.current.set(telemetry.runnerId, nowTap);

      const now = Date.now();
      const targetLaps = session?.targetLapCount || null;
      commitPadData((prev) => {
        const res = applyTapRunnerSplit(prev.stopwatch, telemetry.runnerId, telemetry.runnerName, now, {
          maxRaceLaps: targetLaps,
        });
        return { ...prev, stopwatch: res.next };
      });
      setNowEpochMs(now);
      setLastTappedRunnerId(telemetry.runnerId);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        setLastTappedRunnerId((cur) => (cur === telemetry.runnerId ? null : cur));
      }, 350);

      const nextLap = telemetry.lapCount + 1;
      const isBell = targetLaps !== null && targetLaps >= 2 && nextLap === targetLaps - 1;
      playFeedback(isBell ? 'BELL' : 'SPLIT');
      setLiveAnnouncement(`${telemetry.runnerName} split ${nextLap} recorded`);
    },
    [commitPadData, playFeedback, session?.targetLapCount]
  );

  const handleUndoRunner = useCallback(
    (runnerId: string) => {
      commitPadData((prev) => {
        const res = applyUndoRunnerLastSplit(prev.stopwatch, runnerId);
        if (!res.undone) return prev;
        setLiveAnnouncement(`Undid split for ${res.undone.runnerName}`);
        return { ...prev, stopwatch: res.next };
      });
    },
    [commitPadData]
  );

  const handleUndoLast = useCallback(() => {
    commitPadData((prev) => {
      const res = applyUndoLastSplit(prev.stopwatch);
      if (!res.undone) return prev;
      setLiveAnnouncement(`Undid ${res.undone.runnerName}`);
      return { ...prev, stopwatch: res.next };
    });
  }, [commitPadData]);

  const handleSwapLastTwo = useCallback(() => {
    commitPadData((prev) => {
      const res = applySwapLastTwoSplits(prev.stopwatch);
      if (!res.swapped || !res.pair) return prev;
      setLiveAnnouncement(
        `Swapped last two splits: ${res.pair.firstRunnerName} and ${res.pair.secondRunnerName}`
      );
      return { ...prev, stopwatch: res.next };
    });
  }, [commitPadData]);

  const handleAddWalkOn = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = walkOnInput.trim().slice(0, 64);
    if (!cleanName) return;
    const entryKey = `walkon_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    commitPadData((prev) => ({
      ...prev,
      walkOns: [...prev.walkOns, { entryKey, displayName: cleanName }],
    }));
    setWalkOnInput('');
  };

  const handleSendSplits = async () => {
    if (!session || timedEntries.length === 0 || isSubmitting) return;
    const capturedByName =
      padData.capturedByName.trim() || defaultTimerName.trim() || 'Trackside Helper';
    const payload = {
      clientSubmissionId: padData.clientSubmissionId,
      capturedByName,
      ...(padData.stopwatch.sessionStartedEpochMs
        ? { gunStartEpochMs: padData.stopwatch.sessionStartedEpochMs }
        : {}),
      entries: timedEntries,
    };

    if (isSampleDemoMode) {
      enqueueOfflineDelegatedSubmission({
        clientSubmissionId: payload.clientSubmissionId,
        passCode: session.passCode,
        ...(verifiedPin ? { pin: verifiedPin } : {}),
        payload,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      });
      setSubmitStatus({
        tone: 'prime',
        message: `Staged ${timedEntries.length} runner splits locally in Demo Mode.`,
      });
      onSubmitted?.();
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitDelegatedSplitsApi(
        session.passCode,
        payload,
        verifiedPin || undefined
      );
      setSubmitStatus({
        tone: 'prime',
        message: res.deduplicated
          ? 'Already received by coach (duplicate prevented).'
          : `Sent ${timedEntries.length} runner splits to Coach review queue.`,
      });
      onSubmitted?.();
    } catch (err) {
      const status = err instanceof TeamLifecycleApiError ? err.status : 0;
      if (status === 403 || status === 410 || status === 404) {
        setSubmitStatus({
          tone: 'caution',
          message:
            err instanceof Error
              ? `${err.message} Use Hand Off via QR / Code below so splits are never lost.`
              : 'Pass closed. Use Hand Off via QR / Code below.',
        });
      } else {
        enqueueOfflineDelegatedSubmission({
          clientSubmissionId: payload.clientSubmissionId,
          passCode: session.passCode,
          ...(verifiedPin ? { pin: verifiedPin } : {}),
          payload,
          queuedAt: new Date().toISOString(),
          attempts: 1,
          lastError: err instanceof Error ? err.message : 'Offline',
        });
        setQueuedCount(loadOfflineDelegatedSubmissions(effectivePassCode).length);
        setSubmitStatus({
          tone: 'caution',
          message:
            'Saved offline on this device — will sync automatically when signal returns, or tap Hand Off via QR / Code.',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyHandoffCode = async () => {
    if (!handoffCode) return;
    try {
      await navigator.clipboard.writeText(handoffCode);
      setCopiedHandoff(true);
      window.setTimeout(() => setCopiedHandoff(false), 2200);
    } catch {
      setCopiedHandoff(false);
    }
  };

  // Loading / Invalid / Expired / PIN Gate States
  if (isLoadingPass && !session) {
    return (
      <div className="min-h-dvh bg-[#F6F3EC] dark:bg-[#121413] p-4 flex items-center justify-center">
        <div className="ap-card rounded-2xl p-6 max-w-sm w-full text-center space-y-2">
          <p className="text-sm font-bold text-ap-ink dark:text-ap-chalk">
            Loading MeetReady Timing Pass…
          </p>
          <p className="text-xs font-mono text-ap-muted dark:text-ap-muted-dark">
            Pass {effectivePassCode}
          </p>
        </div>
      </div>
    );
  }

  if (!passPayload || !passPayload.found) {
    return (
      <div className="min-h-dvh bg-[#F6F3EC] dark:bg-[#121413] p-4 flex items-center justify-center">
        <div className="ap-card rounded-2xl p-6 max-w-sm w-full space-y-3 text-center">
          <h1 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
            Timing Pass Not Found
          </h1>
          <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
            {passErrorMsg || 'Check the QR link with your meet coach.'}
          </p>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="ap-btn-secondary w-full min-h-[44px] cursor-pointer"
            >
              Back to MeetReady
            </button>
          )}
        </div>
      </div>
    );
  }

  if (passPayload.expiredOrRevoked) {
    return (
      <div className="min-h-dvh bg-[#F6F3EC] dark:bg-[#121413] p-4 flex items-center justify-center">
        <div className="ap-card rounded-2xl p-6 max-w-sm w-full space-y-3 text-center">
          <div className="mx-auto w-10 h-10 rounded-full ap-status-caution flex items-center justify-center">
            <Lock className="w-5 h-5" weight="bold" />
          </div>
          <h1 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
            Timing Pass Closed
          </h1>
          <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
            This timing pass has expired or was revoked by the coach.
          </p>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="ap-btn-secondary w-full min-h-[44px] cursor-pointer"
            >
              Return
            </button>
          )}
        </div>
      </div>
    );
  }

  if (passPayload.pinRequired && !passPayload.pinVerified) {
    return (
      <div className="min-h-dvh bg-[#F6F3EC] dark:bg-[#121413] p-4 flex items-center justify-center">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{4}$/.test(pinInput.trim())) {
              void loadPass(pinInput.trim());
            } else {
              setPassErrorMsg('Enter the 4-digit PIN from your coach.');
            }
          }}
          className="ap-card rounded-2xl p-5 max-w-sm w-full space-y-3"
        >
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 ap-text-brand" weight="bold" />
            <h1 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
              Enter 4-Digit Timing PIN
            </h1>
          </div>
          <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
            {passPayload.teamShortName ? `${passPayload.teamShortName} · ` : ''}
            Pass {effectivePassCode} is PIN-protected.
          </p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4-digit PIN"
            aria-label="4-Digit Timing Pass PIN"
            data-testid="delegated-pin-input"
            className="w-full min-h-[48px] rounded-xl ap-card-inset px-4 font-mono text-xl font-extrabold tracking-[0.35em] text-center text-ap-ink dark:text-ap-chalk"
          />
          {passErrorMsg && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{passErrorMsg}</p>
          )}
          <div className="flex items-center gap-2">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="ap-btn-secondary min-h-[44px] px-4 cursor-pointer"
              >
                Back
              </button>
            )}
            <button
              type="submit"
              data-testid="delegated-pin-submit"
              className="ap-btn-primary flex-1 min-h-[44px] cursor-pointer"
            >
              Unlock Timing Pad
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div
      data-testid="delegated-timing-pad-page"
      className="min-h-dvh bg-[#F6F3EC] dark:bg-[#121413] text-ap-ink dark:text-ap-chalk pb-32"
    >
      <div className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* Slim 44px Top Header */}
      <header className="sticky top-0 z-30 h-[44px] min-h-[44px] bg-[#121413] text-[#F6F3EC] border-b border-white/10 px-2 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="delegated-pad-back-btn"
          aria-label="Back"
          onClick={onExit}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-sm font-mono font-bold text-[#F6F3EC] cursor-pointer"
        >
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-xs font-extrabold truncate">
            {session.eventLabel}
            {session.heatLabel ? ` · ${session.heatLabel}` : ''} · {session.stationLabel}
          </div>
        </div>
        <button
          type="button"
          data-testid="delegated-pad-sound-toggle"
          aria-pressed={Boolean(padData.stopwatch.soundEnabled)}
          aria-label={padData.stopwatch.soundEnabled ? 'Mute Beep' : 'Enable Beep'}
          onClick={() =>
            commitPadData((prev) => ({
              ...prev,
              stopwatch: { ...prev.stopwatch, soundEnabled: !prev.stopwatch.soundEnabled },
            }))
          }
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#D8FF2A] cursor-pointer"
        >
          {padData.stopwatch.soundEnabled ? (
            <SpeakerHigh className="w-4 h-4" weight="bold" />
          ) : (
            <SpeakerSlash className="w-4 h-4 text-[#A39E93]" weight="bold" />
          )}
        </button>
      </header>

      <main className="max-w-xl mx-auto px-3 pt-3 space-y-3">
        {/* Giant Sunlight-Contrast Master Clock (NO top Pause button!) */}
        <section className="rounded-2xl bg-[#121413] text-[#D8FF2A] p-4 border border-[#121413] dark:border-white/15 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-2xs font-mono text-[#A39E93]">
            <span className="truncate">
              {session.meetTitle} · {session.splitPlanLabel}
            </span>
            <span className="shrink-0 uppercase font-bold text-[#F6F3EC]">
              {padData.stopwatch.isRunning
                ? 'LIVE'
                : elapsedMs > 0
                  ? 'PAUSED'
                  : 'READY'}
            </span>
          </div>
          <div
            data-testid="delegated-master-clock"
            className="font-mono text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight text-center py-1"
          >
            {formatStopwatchClockMs(elapsedMs)}
          </div>
        </section>

        {/* Contextual 8s Swap Last 2 Banner */}
        {recentSwapPair && (
          <button
            type="button"
            data-testid="delegated-swap-last-two-btn"
            onClick={handleSwapLastTwo}
            className="w-full min-h-[44px] rounded-xl ap-status-caution px-3 py-2 flex items-center justify-between gap-2 text-xs font-extrabold cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              <ArrowsLeftRight className="w-4 h-4 shrink-0" weight="bold" />
              <span className="truncate">
                ⇄ Swap Last 2 ({recentSwapPair.prev.runnerName} ↔ {recentSwapPair.last.runnerName})
              </span>
            </span>
            <span className="font-mono text-2xs shrink-0">
              {recentSwapPair.tapGapSecs.toFixed(2)}s gap
            </span>
          </button>
        )}

        {/* Full-Width Stacked Runner Cards (grid-cols-1 up to 5 runners) */}
        <TracksideRunnerCardsAndMatrix
          viewMode="CARDS"
          sessionType="RACE"
          filteredTelemetries={runnerTelemetries}
          runnerPodLookup={emptyPodLookup}
          chuteQueueSecs={[]}
          lastTappedRunnerId={lastTappedRunnerId}
          targetRaceLaps={session.targetLapCount}
          maxColumnsInMatrix={1}
          onRunnerAction={handleRunnerAction}
          onUndoRunnerLastSplit={handleUndoRunner}
          hidePodMeta={true}
        />

        {/* Walk-On Free-Text Adder ONLY (Zero Roster Directory) */}
        <form onSubmit={handleAddWalkOn} className="ap-card rounded-xl p-2.5 flex items-center gap-2">
          <input
            type="text"
            value={walkOnInput}
            onChange={(e) => setWalkOnInput(e.target.value)}
            placeholder="Add walk-on runner name…"
            aria-label="Add walk-on runner"
            data-testid="delegated-walkon-input"
            className="flex-1 min-h-[44px] rounded-xl ap-card-inset px-3 text-xs text-ap-ink dark:text-ap-chalk"
          />
          <button
            type="submit"
            data-testid="delegated-walkon-add-btn"
            className="ap-btn-secondary min-h-[44px] px-3 text-xs font-bold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            <span>Add</span>
          </button>
        </form>

        {/* Send / Hand Off / Offline Recovery Deck */}
        <section className="ap-card rounded-2xl p-3 space-y-2.5">
          <label className="block space-y-1">
            <span className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Your Name (Timer)
            </span>
            <input
              type="text"
              value={padData.capturedByName}
              onChange={(e) => {
                const val = e.target.value.slice(0, 64);
                commitPadData((prev) => ({ ...prev, capturedByName: val }));
              }}
              placeholder="e.g. Coach Taylor / Parent Volunteer"
              aria-label="Your Name"
              className="w-full min-h-[44px] rounded-xl ap-card-inset px-3 text-xs text-ap-ink dark:text-ap-chalk"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="delegated-send-splits-btn"
              disabled={timedEntries.length === 0 || isSubmitting}
              onClick={() => void handleSendSplits()}
              className="ap-btn-primary w-full min-h-[44px] text-xs cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4 shrink-0" weight="bold" />
              <span>
                {isSubmitting ? 'Sending…' : 'Send Splits to Coach & Teammates'}
              </span>
            </button>

            <button
              type="button"
              data-testid="delegated-handoff-qr-btn"
              disabled={timedEntries.length === 0}
              onClick={() => setShowHandoffSheet((prev) => !prev)}
              className="ap-btn-secondary w-full min-h-[44px] text-xs cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <span>Hand Off via QR / Code</span>
            </button>
          </div>

          {queuedCount > 0 && (
            <div className="rounded-xl ap-status-caution px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <WifiSlash className="w-4 h-4 shrink-0" weight="bold" />
                <span>{queuedCount} offline submission queued on device</span>
              </span>
              <button
                type="button"
                onClick={() =>
                  void flushOfflineDelegatedSubmissions(effectivePassCode).then((r) =>
                    setQueuedCount(r.remainingCount)
                  )
                }
                className="underline font-bold cursor-pointer min-h-[36px] px-1"
              >
                Retry
              </button>
            </div>
          )}

          {submitStatus && (
            <div
              role="status"
              data-testid="delegated-submit-status"
              className={`rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                submitStatus.tone === 'prime' ? 'ap-status-prime' : 'ap-status-caution'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" weight="bold" />
              <span>{submitStatus.message}</span>
            </div>
          )}

          {showHandoffSheet && handoffCode && (
            <div
              data-testid="delegated-handoff-sheet"
              className="rounded-xl ap-card-inset p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-ap-ink dark:text-ap-chalk">
                  Offline Stadium Dead-Zone Handoff
                </span>
                <button
                  type="button"
                  aria-label="Close handoff code"
                  onClick={() => setShowHandoffSheet(false)}
                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg ap-card cursor-pointer"
                >
                  <X className="w-4 h-4" weight="bold" />
                </button>
              </div>
              {handoffQrSvg ? (
                <div
                  className="bg-white p-2.5 rounded-xl inline-block border border-[#121413]/15"
                  dangerouslySetInnerHTML={{ __html: handoffQrSvg }}
                />
              ) : (
                <p className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  Payload exceeds single-QR density — copy or text the compact handoff code below
                  into Coach&apos;s Import Offline Split Code field.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={handoffCode}
                  aria-label="Offline split handoff code"
                  data-testid="delegated-handoff-code-input"
                  className="flex-1 min-h-[44px] rounded-xl bg-white dark:bg-[#121413] border border-[#121413]/20 dark:border-white/20 px-2.5 font-mono text-2xs"
                />
                <button
                  type="button"
                  onClick={() => void handleCopyHandoffCode()}
                  className="ap-btn-secondary min-h-[44px] px-3 text-xs cursor-pointer"
                >
                  {copiedHandoff ? (
                    <Check className="w-4 h-4" weight="bold" />
                  ) : (
                    <Copy className="w-4 h-4" weight="bold" />
                  )}
                  <span>{copiedHandoff ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {elapsedMs > 0 && !padData.stopwatch.isRunning && (
            <div className="flex justify-end pt-1">
              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="min-h-[44px] px-3 rounded-xl ap-card-inset text-xs font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                >
                  Reset Clock &amp; Splits
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    commitPadData((prev) => ({
                      ...prev,
                      stopwatch: applyResetStopwatch(prev.stopwatch),
                      clientSubmissionId: `dsub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    }));
                    setConfirmReset(false);
                    setSubmitStatus(null);
                  }}
                  className="min-h-[44px] px-3 rounded-xl ap-status-strained text-xs font-bold cursor-pointer"
                >
                  Confirm Reset Splits
                </button>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Fixed Bottom Thumb Bar */}
      <div
        data-testid="delegated-bottom-thumb-bar"
        role="region"
        aria-label="Pocket timing thumb controls"
        className="fixed bottom-2 left-3 right-3 z-40 max-w-xl mx-auto rounded-2xl liquid-glass-header px-2.5 py-2 grid grid-cols-3 gap-2"
      >
        <button
          type="button"
          data-testid="delegated-gun-btn"
          aria-label={
            padData.stopwatch.isRunning
              ? 'Hold 0.45 seconds to pause clock'
              : elapsedMs > 0
                ? 'Resume'
                : 'Start Gun'
          }
          onPointerDown={(e) => {
            if (!padData.stopwatch.isRunning) return;
            if (typeof e.button === 'number' && e.button !== 0) return;
            holdSucceededRef.current = false;
            setIsHoldingPause(true);
            if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = window.setTimeout(() => {
              holdTimerRef.current = null;
              holdSucceededRef.current = true;
              setIsHoldingPause(false);
              handleToggleGun();
            }, HOLD_PAUSE_MS);
          }}
          onPointerUp={() => {
            if (holdTimerRef.current !== null) {
              window.clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
            setIsHoldingPause(false);
            if (padData.stopwatch.isRunning && !holdSucceededRef.current) {
              setLiveAnnouncement('Hold 0.45s to Pause');
            }
          }}
          onPointerCancel={() => {
            if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
            setIsHoldingPause(false);
          }}
          onPointerLeave={() => {
            if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
            setIsHoldingPause(false);
          }}
          onClick={(e) => {
            if (!padData.stopwatch.isRunning) {
              handleToggleGun();
              return;
            }
            if (e.detail === 0) {
              handleToggleGun();
            }
          }}
          className={`col-span-2 min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl text-sm font-extrabold cursor-pointer select-none ${
            padData.stopwatch.isRunning ? 'ap-status-caution' : 'ap-btn-primary'
          }`}
        >
          {padData.stopwatch.isRunning ? (
            <>
              <Pause className="w-4 h-4 shrink-0" weight="fill" />
              <span>{isHoldingPause ? 'Pausing…' : 'Hold 0.45s to Pause'}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 shrink-0" weight="fill" />
              <span>{elapsedMs > 0 ? 'Resume' : 'Start Gun'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          data-testid="delegated-undo-btn"
          disabled={padData.stopwatch.tapHistory.length === 0}
          onClick={handleUndoLast}
          className="min-h-[52px] inline-flex items-center justify-center gap-1 rounded-xl ap-card-inset text-xs font-bold text-ap-ink dark:text-ap-chalk disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
        >
          <ArrowCounterClockwise className="w-4 h-4 shrink-0" weight="bold" />
          <span>Undo</span>
        </button>
      </div>
    </div>
  );
};
