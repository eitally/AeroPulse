import React, { useEffect, useState } from 'react';
import { FlagCheckered, Timer } from './icons/PhosphorIcons';

const TRACKSIDE_STOPWATCH_STORAGE_KEY = 'thresh_trackside_stopwatch_v1';
const TRACKSIDE_SYNC_EVENT = 'thresh:trackside-stopwatch-sync';

interface TracksideLivePillSnapshot {
  isRunning: boolean;
  startedAtEpochMs: number | null;
  accumulatedMs: number;
  sessionType: 'WORKOUT' | 'RACE';
  totalSplitCount: number;
  chuteCount: number;
}

const DEFAULT_PILL_SNAPSHOT: TracksideLivePillSnapshot = {
  isRunning: false,
  startedAtEpochMs: null,
  accumulatedMs: 0,
  sessionType: 'WORKOUT',
  totalSplitCount: 0,
  chuteCount: 0,
};

function formatStopwatchMark(seconds: number, decimals: 1 | 2 = 1): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) {
    return `${safe.toFixed(decimals)}s`;
  }
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const remSecs = safe - hrs * 3600 - mins * 60;
  const secStr = remSecs.toFixed(decimals).padStart(decimals === 2 ? 5 : 4, '0');
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${secStr}`;
  }
  return `${mins}:${secStr}`;
}

function readTracksideLivePillSnapshot(): TracksideLivePillSnapshot {
  if (typeof window === 'undefined') return DEFAULT_PILL_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(TRACKSIDE_STOPWATCH_STORAGE_KEY);
    if (!raw) return DEFAULT_PILL_SNAPSHOT;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PILL_SNAPSHOT;

    const isRunning = Boolean(parsed.isRunning);
    const startedAtEpochMs =
      typeof parsed.startedAtEpochMs === 'number' && Number.isFinite(parsed.startedAtEpochMs)
        ? parsed.startedAtEpochMs
        : null;
    const accumulatedMs =
      typeof parsed.accumulatedMs === 'number' && Number.isFinite(parsed.accumulatedMs)
        ? Math.max(0, parsed.accumulatedMs)
        : 0;
    const sessionType: 'WORKOUT' | 'RACE' = parsed.sessionType === 'RACE' ? 'RACE' : 'WORKOUT';

    let totalSplitCount = 0;
    if (parsed.athleteLapTimestampsSecs && typeof parsed.athleteLapTimestampsSecs === 'object') {
      for (const arr of Object.values(parsed.athleteLapTimestampsSecs as Record<string, unknown>)) {
        if (Array.isArray(arr)) {
          totalSplitCount += arr.length;
        }
      }
    }
    const chuteCount = Array.isArray(parsed.chuteQueueSecs) ? parsed.chuteQueueSecs.length : 0;

    return {
      isRunning,
      startedAtEpochMs,
      accumulatedMs,
      sessionType,
      totalSplitCount,
      chuteCount,
    };
  } catch {
    return DEFAULT_PILL_SNAPSHOT;
  }
}

function useTracksideLivePillStatus(tickIntervalMs = 200) {
  const [snapshot, setSnapshot] = useState<TracksideLivePillSnapshot>(() =>
    readTracksideLivePillSnapshot()
  );
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromStorage = () => {
      setSnapshot(readTracksideLivePillSnapshot());
      setNowEpochMs(Date.now());
    };
    window.addEventListener(TRACKSIDE_SYNC_EVENT, syncFromStorage);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener(TRACKSIDE_SYNC_EVENT, syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.isRunning) return;
    setNowEpochMs(Date.now());
    const id = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, tickIntervalMs);
    return () => window.clearInterval(id);
  }, [snapshot.isRunning, tickIntervalMs]);

  const stopwatchElapsedMs =
    snapshot.isRunning && snapshot.startedAtEpochMs !== null
      ? Math.max(0, snapshot.accumulatedMs + Math.max(0, nowEpochMs - snapshot.startedAtEpochMs))
      : Math.max(0, snapshot.accumulatedMs);

  const hasActiveSession =
    snapshot.isRunning ||
    snapshot.accumulatedMs > 0 ||
    snapshot.totalSplitCount > 0 ||
    snapshot.chuteCount > 0;

  return {
    stopwatchRunning: snapshot.isRunning,
    stopwatchElapsedMs,
    totalSplitCount: snapshot.totalSplitCount,
    hasActiveSession,
    sessionType: snapshot.sessionType,
  };
}

interface TracksideLiveHeaderPillProps {
  onOpenTracksidePad: () => void;
  showIdleLauncher?: boolean;
}

export const TracksideLiveHeaderPill: React.FC<TracksideLiveHeaderPillProps> = React.memo(
  ({ onOpenTracksidePad, showIdleLauncher = false }) => {
    const {
      stopwatchRunning,
      stopwatchElapsedMs,
      totalSplitCount,
      hasActiveSession,
      sessionType,
    } = useTracksideLivePillStatus(200);

    if (!hasActiveSession && !showIdleLauncher) {
      return null;
    }

    if (!hasActiveSession) {
      return (
        <button
          type="button"
          onClick={onOpenTracksidePad}
          className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-capsule-track text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 hover:border-[#28573B] dark:hover:border-ap-volt/60 transition-colors whitespace-nowrap cursor-pointer"
          title="Open Trackside Stopwatch (0.01s Multi-Athlete Timing)"
        >
          <Timer className="w-4 h-4 ap-text-brand shrink-0" weight="bold" />
          <span>Stopwatch</span>
        </button>
      );
    }

    const ModeIcon = sessionType === 'RACE' ? FlagCheckered : Timer;

    return (
      <button
        type="button"
        onClick={onOpenTracksidePad}
        role="status"
        aria-live="off"
        aria-label={`Active Trackside ${sessionType} Stopwatch ${formatStopwatchMark(stopwatchElapsedMs / 1000, 1)}, ${totalSplitCount} splits recorded. Return to Stopwatch.`}
        className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-mono text-xs font-bold tabular-nums transition-all whitespace-nowrap cursor-pointer ${
          stopwatchRunning
            ? 'bg-ap-carbon text-ap-volt border-2 border-ap-frame shadow-sm hover:border-ap-volt/70'
            : 'ap-status-caution border border-amber-500/45'
        }`}
        title="Return to Trackside Stopwatch Workspace"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            stopwatchRunning ? 'bg-ap-volt animate-pulse' : 'bg-amber-500'
          }`}
          aria-hidden="true"
        />
        <ModeIcon className="w-3.5 h-3.5 shrink-0" weight="bold" />
        <span className="text-2xs uppercase opacity-90">{sessionType}</span>
        <span>{formatStopwatchMark(stopwatchElapsedMs / 1000, 1)}</span>
        {totalSplitCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-2xs">
            {totalSplitCount}
          </span>
        )}
      </button>
    );
  }
);

TracksideLiveHeaderPill.displayName = 'TracksideLiveHeaderPill';
