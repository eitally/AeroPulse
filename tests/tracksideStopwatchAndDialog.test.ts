import { describe, expect, it } from 'vitest';
import {
  TRACKSIDE_STOPWATCH_STORAGE_KEY,
  applyResetStopwatch,
  applyTapRunnerSplit,
  applyToggleStartPause,
  applyUndoLastSplit,
  computeElapsedMs,
  readPersistedTracksideStopwatch,
  type PersistedTracksideStopwatchState,
} from '../src/hooks/useTracksideStopwatch';

describe('Persistent Trackside Split Stopwatch Engine (Phase 1 Hardening)', () => {
  const baseState: PersistedTracksideStopwatchState = {
    isRunning: false,
    startedAtEpochMs: null,
    accumulatedMs: 0,
    athleteLapTimestampsSecs: {},
    tapHistory: [],
    extraPodAthletes: [
      { id: 'ath-1', name: 'Jordan Miles', thresholdPaceSecsPerKm: 215 },
    ],
  };

  it('tracks wall-clock elapsed time across modal unmount/remount without interval drift', () => {
    const t0 = 1_700_000_000_000;
    const running = applyToggleStartPause(baseState, t0);
    expect(running.isRunning).toBe(true);
    expect(running.startedAtEpochMs).toBe(t0);

    // Simulate modal closed for 64.28s, then remounted at t0 + 64_280ms
    expect(computeElapsedMs(running, t0 + 64_280)).toBe(64_280);

    // Pause at 64.28s, wait 30s, resume for 12.15s
    const paused = applyToggleStartPause(running, t0 + 64_280);
    expect(paused.isRunning).toBe(false);
    expect(paused.accumulatedMs).toBe(64_280);
    expect(computeElapsedMs(paused, t0 + 94_280)).toBe(64_280);

    const resumed = applyToggleStartPause(paused, t0 + 94_280);
    expect(computeElapsedMs(resumed, t0 + 106_430)).toBe(76_430);
  });

  it('auto-starts on first runner split tap, records cumulative marks, and supports Undo Last + safe Reset', () => {
    const t0 = 1_700_000_100_000;
    // Tap while idle at 0.00 auto-starts the clock
    const tap1 = applyTapRunnerSplit(baseState, 'ath-1', 'Jordan Miles', t0);
    expect(tap1.next.isRunning).toBe(true);
    expect(tap1.currentElapsedSecs).toBe(0.01);
    expect(tap1.next.athleteLapTimestampsSecs['ath-1']).toEqual([0.01]);

    // Second lap for ath-1 at 68.42s, first lap for ath-2 at 70.15s
    const tap2 = applyTapRunnerSplit(tap1.next, 'ath-1', 'Jordan Miles', t0 + 68_420);
    const tap3 = applyTapRunnerSplit(tap2.next, 'ath-2', 'Elena Vance', t0 + 70_150);
    expect(tap3.next.athleteLapTimestampsSecs['ath-1']).toEqual([0.01, 68.42]);
    expect(tap3.next.athleteLapTimestampsSecs['ath-2']).toEqual([70.15]);
    expect(tap3.next.tapHistory).toHaveLength(3);

    // Undo last tap removes Elena's accidental split cleanly
    const afterUndo = applyUndoLastSplit(tap3.next);
    expect(afterUndo.undone?.runnerName).toBe('Elena Vance');
    expect(afterUndo.next.athleteLapTimestampsSecs['ath-2']).toBeUndefined();
    expect(afterUndo.next.athleteLapTimestampsSecs['ath-1']).toEqual([0.01, 68.42]);

    // Reset clears splits and timer while preserving custom trackside pod roster
    const afterReset = applyResetStopwatch(afterUndo.next);
    expect(afterReset.isRunning).toBe(false);
    expect(afterReset.accumulatedMs).toBe(0);
    expect(afterReset.tapHistory).toEqual([]);
    expect(afterReset.athleteLapTimestampsSecs).toEqual({});
    expect(afterReset.extraPodAthletes).toHaveLength(1);
    expect(afterReset.extraPodAthletes[0].name).toBe('Jordan Miles');
  });

  it('gracefully falls back when localStorage is unavailable or malformed', () => {
    const fallback = readPersistedTracksideStopwatch();
    expect(fallback.isRunning).toBe(false);
    expect(fallback.accumulatedMs).toBe(0);
    expect(TRACKSIDE_STOPWATCH_STORAGE_KEY).toBe('thresh_trackside_stopwatch_v1');
  });
});
