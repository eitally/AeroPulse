import React, { useEffect, useRef, useState } from 'react';
import type { ConnectedAthleteRecord } from '../../types';
import {
  RACE_STOPWATCH_PRESETS,
  type RunnerSplitTelemetry,
} from '../../hooks/useTracksideStopwatch';
import {
  deriveThresholdPaceFromVdot,
  type VdotPodRosterInput,
} from '../../physiology/scholasticEngine';
import { countPendingStopwatchOutboxEntries } from '../../utils/stopwatchTeamSync';
import type {
  TracksideStopwatchLaunchPreset,
  WakeLockSentinelLike,
} from './tracksideStopwatchHelpers';

export interface UseTracksideLifecycleEffectsParams {
  activeTeamId: string | null;
  wakeLockEnabled: boolean;
  confirmReset: boolean;
  setConfirmReset: React.Dispatch<React.SetStateAction<boolean>>;
  copiedCsv: boolean;
  setCopiedCsv: React.Dispatch<React.SetStateAction<boolean>>;
  launchPreset: TracksideStopwatchLaunchPreset | null;
  connectedRoster: ConnectedAthleteRecord[];
  setSessionType: (next: 'WORKOUT' | 'RACE') => void;
  setRaceEventLabel: (label: string) => void;
  setSessionTitle: (title: string) => void;
  setExtraPodAthletes: React.Dispatch<React.SetStateAction<VdotPodRosterInput[]>>;
  setHipOrLaneByRunnerId: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setPinnedRunnerIds: React.Dispatch<React.SetStateAction<string[]>>;
  setOnlyOnTrack: React.Dispatch<React.SetStateAction<boolean>>;
  keyboardShortcutsEnabled: boolean;
  handleGunToggle: () => void;
  handleChuteTap: () => void;
  handleUndo: () => void;
  handleRunnerAction: (telemetry: RunnerSplitTelemetry) => void;
  filteredTelemetries: RunnerSplitTelemetry[];
  showChuteBar: boolean;
  setShowChuteBar: (show: boolean) => void;
  holdPauseTimerRef: React.MutableRefObject<number | null>;
  hudHoldPauseTimerRef: React.MutableRefObject<number | null>;
}

export function useTracksideLifecycleEffects(params: UseTracksideLifecycleEffectsParams) {
  const {
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
  } = params;

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(() =>
    countPendingStopwatchOutboxEntries(activeTeamId || undefined)
  );
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [wakeLockState, setWakeLockState] = useState<'ACTIVE' | 'IDLE' | 'UNSUPPORTED'>(() =>
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'IDLE' : 'UNSUPPORTED'
  );

  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const lastAppliedPresetRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (hudHoldPauseTimerRef.current !== null) {
        window.clearTimeout(hudHoldPauseTimerRef.current);
      }
    };
  }, [hudHoldPauseTimerRef]);

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

  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 3500);
    return () => window.clearTimeout(timer);
  }, [confirmReset, setConfirmReset]);

  useEffect(() => {
    if (!copiedCsv) return;
    const timer = window.setTimeout(() => setCopiedCsv(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copiedCsv, setCopiedCsv]);

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
  }, [holdPauseTimerRef]);

  useEffect(() => {
    if (!launchPreset) {
      lastAppliedPresetRef.current = '';
      return;
    }
    const serialized = JSON.stringify(launchPreset);
    if (!serialized || serialized === lastAppliedPresetRef.current) return;
    lastAppliedPresetRef.current = serialized;

    const codeNorm = (launchPreset.eventCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const matchedRacePreset = launchPreset.eventCode
      ? RACE_STOPWATCH_PRESETS.find((preset) => {
          const pNorm = preset.label.toUpperCase().replace(/[^A-Z0-9]/g, '');
          return pNorm === codeNorm || codeNorm.includes(pNorm) || pNorm.includes(codeNorm);
        })
      : undefined;

    if (launchPreset.sessionType === 'RACE' || matchedRacePreset) {
      setSessionType('RACE');
      if (matchedRacePreset) {
        setRaceEventLabel(matchedRacePreset.label);
      }
    }

    const titleParts = [
      launchPreset.meetTitle,
      launchPreset.eventCode,
      launchPreset.heatLabel,
    ].filter((part): part is string => Boolean(part && part.trim()));
    if (titleParts.length > 0) {
      setSessionTitle(titleParts.join(' · '));
    }

    if (launchPreset.runners && launchPreset.runners.length > 0) {
      const targetIds: string[] = [];
      const hipMap: Record<string, string> = {};
      const addedRunners: VdotPodRosterInput[] = [];

      launchPreset.runners.forEach((runner, idx) => {
        const cleanName = runner.athleteName.trim();
        if (!cleanName) return;
        const matchedRoster = connectedRoster.find(
          (c) =>
            (runner.membershipId &&
              (c.id === `team-mem-${runner.membershipId}` || c.id === runner.membershipId)) ||
            c.name.trim().toLowerCase() === cleanName.toLowerCase()
        );
        const resolvedId = matchedRoster
          ? matchedRoster.id
          : runner.membershipId
            ? `team-mem-${runner.membershipId}`
            : `walkon-preset-${idx}-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        targetIds.push(resolvedId);
        if (runner.hipOrLane && runner.hipOrLane.trim()) {
          hipMap[resolvedId] = runner.hipOrLane.trim();
        }
        if (!matchedRoster) {
          addedRunners.push({
            id: resolvedId,
            name: cleanName,
            vdotOverride: 50,
            thresholdPaceSecsPerKm: deriveThresholdPaceFromVdot(50),
          });
        }
      });

      if (addedRunners.length > 0) {
        setExtraPodAthletes((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const entry of addedRunners) {
            if (!seen.has(entry.id)) {
              merged.push(entry);
              seen.add(entry.id);
            }
          }
          return merged;
        });
      }
      if (targetIds.length > 0) {
        setHipOrLaneByRunnerId(hipMap);
        setPinnedRunnerIds(targetIds);
        setOnlyOnTrack(true);
      }
    }
  }, [
    launchPreset,
    connectedRoster,
    setSessionType,
    setRaceEventLabel,
    setSessionTitle,
    setExtraPodAthletes,
    setHipOrLaneByRunnerId,
    setPinnedRunnerIds,
    setOnlyOnTrack,
  ]);

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

  return {
    isMobileViewport,
    pendingOutboxCount,
    setPendingOutboxCount,
    isOnline,
    wakeLockState,
  };
}
