import { describe, expect, it } from 'vitest';
import {
  RACE_STOPWATCH_PRESETS,
  applyAssignChuteToRunner,
  applyRecordChuteTap,
  applySetSessionType,
  applyTapRunnerSplit,
  applyTriggerPodWaveNow,
  applyUndoLastSplit,
  computeRaceStandings,
  computeRunnerSplitTelemetry,
  type PersistedTracksideStopwatchState,
} from '../src/hooks/useTracksideStopwatch';
import {
  buildTracksideStopwatchCsv,
  formatStopwatchClockMs,
  synthesizeTracksideRaceActivity,
  synthesizeTracksideWorkoutActivity,
} from '../src/utils/stopwatchActivitySynthesizer';

describe('Trackside Multi-Athlete Stopwatch v2 Engine & Synthesizers', () => {
  const initial: PersistedTracksideStopwatchState = {
    isRunning: false,
    startedAtEpochMs: null,
    accumulatedMs: 0,
    athleteLapTimestampsSecs: {},
    tapHistory: [],
    extraPodAthletes: [
      { id: 'ath-1', name: 'Jordan Miles', thresholdPaceSecsPerKm: 215 },
      { id: 'ath-2', name: 'Maya Chen', thresholdPaceSecsPerKm: 235 },
    ],
    sessionType: 'WORKOUT',
    viewMode: 'CARDS',
    showChuteBar: false,
    workoutPresetId: '8x400',
    raceEventLabel: '1600m',
    restDurationSecs: 60,
    waveMode: 'MASS',
    podWaveOffsetsSecs: { 'Pod A': 0, 'Pod B': 10 },
    chuteQueueSecs: [],
    runnerLastTapEpochMs: {},
    sessionTitle: '',
    soundEnabled: false,
    wakeLockEnabled: true,
  };

  it('flags WORKOUT vs RACE mode and auto-enables Chute Bar in RACE mode', () => {
    const raceState = applySetSessionType(initial, 'RACE');
    expect(raceState.sessionType).toBe('RACE');
    expect(raceState.showChuteBar).toBe(true);

    const workoutAgain = applySetSessionType(raceState, 'WORKOUT');
    expect(workoutAgain.sessionType).toBe('WORKOUT');
  });

  it('supports FIFO Chute Tap queue assignment and full Undo reversal back to queue / removal', () => {
    const t0 = 1_700_000_000_000;
    const c1 = applyRecordChuteTap(applySetSessionType(initial, 'RACE'), t0 + 62_140);
    expect(c1.next.isRunning).toBe(true);
    // Note: first call auto-started clock at t0 + 62_140 so elapsed is 0.01s; queue second mark +62.40s later
    const c2 = applyRecordChuteTap(c1.next, t0 + 62_140 + 62_400);
    expect(c2.next.chuteQueueSecs).toEqual([0.01, 62.4]);

    const assigned1 = applyAssignChuteToRunner(c2.next, 'ath-1', 'Jordan Miles', t0 + 63_000);
    expect(assigned1.assignedSecs).toBe(0.01);
    expect(assigned1.next.chuteQueueSecs).toEqual([62.4]);
    expect(assigned1.next.athleteLapTimestampsSecs['ath-1']).toEqual([0.01]);

    // Undo assignment returns 0.01s back to front of chuteQueueSecs cleanly
    const undoneAssign = applyUndoLastSplit(assigned1.next);
    expect(undoneAssign.undone?.kind).toBe('CHUTE_ASSIGN');
    expect(undoneAssign.next.athleteLapTimestampsSecs['ath-1']).toBeUndefined();
    expect(undoneAssign.next.chuteQueueSecs).toEqual([0.01, 62.4]);

    // Undo second chute queue pop
    const undoneQueue = applyUndoLastSplit(undoneAssign.next);
    expect(undoneQueue.undone?.kind).toBe('CHUTE_QUEUE');
    expect(undoneQueue.next.chuteQueueSecs).toEqual([0.01]);
  });

  it('subtracts Staggered Pod Wave offsets from cumulative & lap splits and stamps live Go Now offset', () => {
    const t0 = 1_700_000_200_000;
    const running = applySetSessionType(
      { ...initial, isRunning: true, startedAtEpochMs: t0, waveMode: 'POD_STAGGER' },
      'WORKOUT'
    );
    const waveTriggered = applyTriggerPodWaveNow(running, 'Pod B', t0 + 12_500);
    expect(waveTriggered.offsetSecs).toBe(12.5);
    expect(waveTriggered.next.podWaveOffsetsSecs?.['Pod B']).toBe(12.5);

    const tel = computeRunnerSplitTelemetry({
      runnerId: 'ath-2',
      runnerName: 'Maya Chen',
      podKey: 'Pod B',
      rawTimestampsSecs: [80.5, 149.0],
      waveMode: 'POD_STAGGER',
      waveOffsetSecs: 12.5,
      targetLapSecs: 68.0,
      targetRaceLaps: null,
      sessionType: 'WORKOUT',
      restDurationSecs: 60,
      lastTapEpochMs: t0 + 149_000,
      nowEpochMs: t0 + 169_000,
    });

    expect(tel.netCumulativeSecs).toEqual([68, 136.5]);
    expect(tel.lapSplitsSecs).toEqual([68, 68.5]);
    expect(tel.lastDeltaVsTargetSecs).toBe(0.5);
    expect(tel.restState.status).toBe('RESTING');
    expect(tel.restState.remainingRestSecs).toBe(40);

    // At +65s after tap, rest countdown transitions to GO_NOW (+5s overdue)
    const readyTel = computeRunnerSplitTelemetry({
      runnerId: 'ath-2',
      runnerName: 'Maya Chen',
      podKey: 'Pod B',
      rawTimestampsSecs: [80.5, 149.0],
      waveMode: 'POD_STAGGER',
      waveOffsetSecs: 12.5,
      targetLapSecs: 68.0,
      targetRaceLaps: null,
      sessionType: 'WORKOUT',
      restDurationSecs: 60,
      lastTapEpochMs: t0 + 149_000,
      nowEpochMs: t0 + 214_000,
    });
    expect(readyTel.restState.status).toBe('GO_NOW');
    expect(readyTel.restState.overdueSecs).toBe(5);
  });

  it('enforces Bell Lap, Finish Lock at race lap N, Undo unlock, and live standings in RACE mode', () => {
    const t0 = 1_700_000_300_000;
    const preset800 = RACE_STOPWATCH_PRESETS.find((p) => p.label === '800m')!;
    expect(preset800.targetLaps).toBe(2);

    let state = applySetSessionType({ ...initial, isRunning: true, startedAtEpochMs: t0 }, 'RACE');
    // Lap 1 for Jordan at 57.10s (Bell Lap!)
    state = applyTapRunnerSplit(state, 'ath-1', 'Jordan Miles', t0 + 57_100, {
      maxRaceLaps: preset800.targetLaps,
    }).next;
    // Lap 1 for Maya at 61.20s
    state = applyTapRunnerSplit(state, 'ath-2', 'Maya Chen', t0 + 61_200, {
      maxRaceLaps: preset800.targetLaps,
    }).next;

    const telBell = computeRunnerSplitTelemetry({
      runnerId: 'ath-1',
      runnerName: 'Jordan Miles',
      podKey: 'Pod A',
      rawTimestampsSecs: state.athleteLapTimestampsSecs['ath-1'] || [],
      targetLapSecs: null,
      targetRaceLaps: 2,
      sessionType: 'RACE',
      restDurationSecs: 0,
    });
    expect(telBell.isBellLap).toBe(true);
    expect(telBell.isFinishedLocked).toBe(false);

    // Lap 2 finish for Jordan at 1:55.84 -> triggers Finish Lock
    state = applyTapRunnerSplit(state, 'ath-1', 'Jordan Miles', t0 + 115_840, {
      maxRaceLaps: 2,
    }).next;

    // Extra accidental 3rd tap must be blocked by Finish Lock
    const blocked = applyTapRunnerSplit(state, 'ath-1', 'Jordan Miles', t0 + 120_000, {
      maxRaceLaps: 2,
    });
    expect(blocked.blockedByFinishLock).toBe(true);
    expect(blocked.next.athleteLapTimestampsSecs['ath-1']).toEqual([57.1, 115.84]);

    const ranked = computeRaceStandings([
      computeRunnerSplitTelemetry({
        runnerId: 'ath-2',
        runnerName: 'Maya Chen',
        podKey: 'Pod B',
        rawTimestampsSecs: state.athleteLapTimestampsSecs['ath-2'] || [],
        targetLapSecs: null,
        targetRaceLaps: 2,
        sessionType: 'RACE',
        restDurationSecs: 0,
      }),
      computeRunnerSplitTelemetry({
        runnerId: 'ath-1',
        runnerName: 'Jordan Miles',
        podKey: 'Pod A',
        rawTimestampsSecs: state.athleteLapTimestampsSecs['ath-1'] || [],
        targetLapSecs: null,
        targetRaceLaps: 2,
        sessionType: 'RACE',
        restDurationSecs: 0,
      }),
    ]);

    const jordanRanked = ranked.find((r) => r.runnerId === 'ath-1')!;
    const mayaRanked = ranked.find((r) => r.runnerId === 'ath-2')!;
    expect(jordanRanked.isFinishedLocked).toBe(true);
    expect(jordanRanked.placeLabel).toBe('1ST');
    expect(mayaRanked.placeLabel).toBe('2ND');

    // Undo cleanly unlocks Jordan's lap 2
    const unlocked = applyUndoLastSplit(state);
    expect(unlocked.next.athleteLapTimestampsSecs['ath-1']).toEqual([57.1]);
  });

  it('builds escaped CSV and synthesizes U18-compliant Workout & Official Race THRESH activities', () => {
    const csv = buildTracksideStopwatchCsv({
      sessionType: 'RACE',
      sessionTitle: 'Bay Area League Finals, Heat 1',
      presetOrEventLabel: '1600m',
      telemetries: [
        computeRunnerSplitTelemetry({
          runnerId: 'ath-1',
          runnerName: 'Jordan Miles',
          podKey: 'Pod A',
          rawTimestampsSecs: [63.1, 127.9, 193.1, 256.42],
          targetLapSecs: null,
          targetRaceLaps: 4,
          sessionType: 'RACE',
          restDurationSecs: 0,
        }),
      ],
    });
    expect(csv).toContain('"Bay Area League Finals, Heat 1"');
    expect(csv).toContain('63.10,64.80,65.20,63.32');
    expect(csv).toContain('4:16.42');

    expect(formatStopwatchClockMs(115_845)).toBe('01:55.84');

    const workoutAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'ath-1',
      runnerName: 'Jordan Miles',
      thresholdPaceSecsPerKm: 215,
      sessionTitle: 'Tuesday Track',
      presetLabel: '8 x 400m · VO2max',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: [68.2, 67.9, 68.4],
      dateIso: '2026-11-14',
    });
    expect(workoutAct.trainingLoad).toBeGreaterThan(20);
    expect(workoutAct.intervals?.length).toBe(5); // 3 WORK + 2 RECOVERY
    expect(workoutAct.avgPower).toBeUndefined();
    expect(workoutAct.stravaId).toBeUndefined();

    const raceAct = synthesizeTracksideRaceActivity({
      runnerId: 'ath-1',
      runnerName: 'Jordan Miles',
      sessionTitle: 'Stanford Cobb Twilight',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [63.1, 64.8, 65.2, 63.32],
      netTotalSecs: 256.42,
      placeFinish: '1ST',
      dateIso: '2026-11-14',
    });
    expect(raceAct.officialRaceData?.platform).toBe('MeetReady Stopwatch');
    expect(raceAct.officialRaceData?.timingMethod).toBe('HAND');
    expect(raceAct.officialRaceData?.includeWarmupCooldown).toBe(false);
    expect(raceAct.officialRaceData?.vdotScore).toBeGreaterThan(60);
    expect(raceAct.sourceBadges).toEqual(['Hand-Timed']);
    expect(raceAct.sourceBadges).not.toContain('Official FAT');
    expect(raceAct.stravaId).toBeUndefined();
  });
});
