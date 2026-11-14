import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VdotPodRosterInput } from '../physiology/scholasticEngine';

export const TRACKSIDE_STOPWATCH_STORAGE_KEY = 'thresh_trackside_stopwatch_v1';
const TRACKSIDE_SYNC_EVENT = 'thresh:trackside-stopwatch-sync';

export interface TracksideSplitTapEntry {
  runnerId: string;
  runnerName: string;
  timestampSecs: number;
}

export interface PersistedTracksideStopwatchState {
  isRunning: boolean;
  startedAtEpochMs: number | null;
  accumulatedMs: number;
  athleteLapTimestampsSecs: Record<string, number[]>;
  tapHistory: TracksideSplitTapEntry[];
  extraPodAthletes: VdotPodRosterInput[];
}

const DEFAULT_STOPWATCH_STATE: PersistedTracksideStopwatchState = {
  isRunning: false,
  startedAtEpochMs: null,
  accumulatedMs: 0,
  athleteLapTimestampsSecs: {},
  tapHistory: [],
  extraPodAthletes: [],
};

export function readPersistedTracksideStopwatch(): PersistedTracksideStopwatchState {
  if (typeof window === 'undefined') return DEFAULT_STOPWATCH_STATE;
  try {
    const raw = window.localStorage.getItem(TRACKSIDE_STOPWATCH_STORAGE_KEY);
    if (!raw) return DEFAULT_STOPWATCH_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedTracksideStopwatchState>;
    return {
      isRunning: Boolean(parsed.isRunning),
      startedAtEpochMs:
        typeof parsed.startedAtEpochMs === 'number' && Number.isFinite(parsed.startedAtEpochMs)
          ? parsed.startedAtEpochMs
          : null,
      accumulatedMs:
        typeof parsed.accumulatedMs === 'number' && Number.isFinite(parsed.accumulatedMs)
          ? Math.max(0, parsed.accumulatedMs)
          : 0,
      athleteLapTimestampsSecs:
        parsed.athleteLapTimestampsSecs && typeof parsed.athleteLapTimestampsSecs === 'object'
          ? parsed.athleteLapTimestampsSecs
          : {},
      tapHistory: Array.isArray(parsed.tapHistory) ? parsed.tapHistory : [],
      extraPodAthletes: Array.isArray(parsed.extraPodAthletes) ? parsed.extraPodAthletes : [],
    };
  } catch {
    return DEFAULT_STOPWATCH_STATE;
  }
}

function writePersistedTracksideStopwatch(next: PersistedTracksideStopwatchState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACKSIDE_STOPWATCH_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(TRACKSIDE_SYNC_EVENT));
  } catch {
    // ignore storage quota errors
  }
}

export function computeElapsedMs(
  state: Pick<PersistedTracksideStopwatchState, 'isRunning' | 'startedAtEpochMs' | 'accumulatedMs'>,
  nowEpochMs: number = Date.now()
): number {
  if (state.isRunning && state.startedAtEpochMs !== null) {
    return Math.max(0, state.accumulatedMs + Math.max(0, nowEpochMs - state.startedAtEpochMs));
  }
  return Math.max(0, state.accumulatedMs);
}

export function applyToggleStartPause(
  current: PersistedTracksideStopwatchState,
  nowEpochMs: number = Date.now()
): PersistedTracksideStopwatchState {
  return current.isRunning
    ? {
        ...current,
        isRunning: false,
        startedAtEpochMs: null,
        accumulatedMs: computeElapsedMs(current, nowEpochMs),
      }
    : {
        ...current,
        isRunning: true,
        startedAtEpochMs: nowEpochMs,
      };
}

export function applyResetStopwatch(
  current: PersistedTracksideStopwatchState
): PersistedTracksideStopwatchState {
  return {
    ...DEFAULT_STOPWATCH_STATE,
    extraPodAthletes: current.extraPodAthletes,
  };
}

export function applyTapRunnerSplit(
  current: PersistedTracksideStopwatchState,
  runnerId: string,
  runnerName: string,
  nowEpochMs: number = Date.now()
): { next: PersistedTracksideStopwatchState; currentElapsedSecs: number } {
  const activeState: PersistedTracksideStopwatchState =
    !current.isRunning && current.accumulatedMs === 0
      ? {
          ...current,
          isRunning: true,
          startedAtEpochMs: nowEpochMs,
        }
      : current;

  const currentElapsedSecs = Number(
    Math.max(0.01, computeElapsedMs(activeState, nowEpochMs) / 1000).toFixed(2)
  );
  const existingMarks = activeState.athleteLapTimestampsSecs[runnerId] || [];
  const next: PersistedTracksideStopwatchState = {
    ...activeState,
    athleteLapTimestampsSecs: {
      ...activeState.athleteLapTimestampsSecs,
      [runnerId]: [...existingMarks, currentElapsedSecs],
    },
    tapHistory: [
      ...activeState.tapHistory,
      {
        runnerId,
        runnerName,
        timestampSecs: currentElapsedSecs,
      },
    ],
  };
  return { next, currentElapsedSecs };
}

export function applyUndoLastSplit(
  current: PersistedTracksideStopwatchState
): { next: PersistedTracksideStopwatchState; undone: TracksideSplitTapEntry | null } {
  if (current.tapHistory.length === 0) {
    return { next: current, undone: null };
  }
  const lastEntry = current.tapHistory[current.tapHistory.length - 1];
  const nextHistory = current.tapHistory.slice(0, -1);
  const prevMarks = current.athleteLapTimestampsSecs[lastEntry.runnerId] || [];
  const nextMarks = prevMarks.slice(0, -1);
  const nextMap = { ...current.athleteLapTimestampsSecs };
  if (nextMarks.length > 0) {
    nextMap[lastEntry.runnerId] = nextMarks;
  } else {
    delete nextMap[lastEntry.runnerId];
  }
  return {
    next: {
      ...current,
      athleteLapTimestampsSecs: nextMap,
      tapHistory: nextHistory,
    },
    undone: lastEntry,
  };
}

export function useTracksideStopwatch(tickIntervalMs: number = 50) {
  const [persisted, setPersisted] = useState<PersistedTracksideStopwatchState>(() =>
    readPersistedTracksideStopwatch()
  );
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromStorage = () => {
      setPersisted(readPersistedTracksideStopwatch());
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
    if (!persisted.isRunning) return;
    setNowEpochMs(Date.now());
    const id = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, tickIntervalMs);
    return () => window.clearInterval(id);
  }, [persisted.isRunning, tickIntervalMs]);

  const elapsedMs = computeElapsedMs(persisted, nowEpochMs);

  const totalSplitCount = useMemo(
    () =>
      Object.values(persisted.athleteLapTimestampsSecs).reduce(
        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
        0
      ),
    [persisted.athleteLapTimestampsSecs]
  );

  const hasActiveSession =
    persisted.isRunning || persisted.accumulatedMs > 0 || totalSplitCount > 0;

  const toggleStartPause = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    const now = Date.now();
    const next = applyToggleStartPause(current, now);
    setPersisted(next);
    setNowEpochMs(now);
    writePersistedTracksideStopwatch(next);
  }, []);

  const resetStopwatch = useCallback(() => {
    const current = readPersistedTracksideStopwatch();
    const next = applyResetStopwatch(current);
    setPersisted(next);
    setNowEpochMs(Date.now());
    writePersistedTracksideStopwatch(next);
  }, []);

  const tapRunnerSplit = useCallback((runnerId: string, runnerName: string) => {
    const current = readPersistedTracksideStopwatch();
    const now = Date.now();
    const { next, currentElapsedSecs } = applyTapRunnerSplit(current, runnerId, runnerName, now);
    setPersisted(next);
    setNowEpochMs(now);
    writePersistedTracksideStopwatch(next);
    return currentElapsedSecs;
  }, []);

  const undoLastSplit = useCallback((): TracksideSplitTapEntry | null => {
    const current = readPersistedTracksideStopwatch();
    const { next, undone } = applyUndoLastSplit(current);
    if (!undone) return null;
    setPersisted(next);
    writePersistedTracksideStopwatch(next);
    return undone;
  }, []);

  const setExtraPodAthletes = useCallback(
    (
      updater:
        | VdotPodRosterInput[]
        | ((prev: VdotPodRosterInput[]) => VdotPodRosterInput[])
    ) => {
      const current = readPersistedTracksideStopwatch();
      const resolved =
        typeof updater === 'function' ? updater(current.extraPodAthletes) : updater;
      const next: PersistedTracksideStopwatchState = {
        ...current,
        extraPodAthletes: resolved,
      };
      setPersisted(next);
      writePersistedTracksideStopwatch(next);
    },
    []
  );

  return {
    stopwatchRunning: persisted.isRunning,
    stopwatchElapsedMs: elapsedMs,
    athleteLapTimestampsSecs: persisted.athleteLapTimestampsSecs,
    tapHistory: persisted.tapHistory,
    extraPodAthletes: persisted.extraPodAthletes,
    totalSplitCount,
    hasActiveSession,
    toggleStartPause,
    resetStopwatch,
    tapRunnerSplit,
    undoLastSplit,
    setExtraPodAthletes,
  };
}
