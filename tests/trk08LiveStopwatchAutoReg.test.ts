import { describe, expect, it } from 'vitest';
import {
  evaluateRunnerLiveAutoRegulation,
  evaluateSquadLiveAutoRegulation,
} from '../src/physiology/trackLiveAutoRegulationEngine';
import {
  applyConvertRemainingToCv,
  applyEndSessionStimulusAchieved,
  applyExtendWorkoutRestPlus30s,
  type PersistedTracksideStopwatchState,
} from '../src/hooks/useTracksideStopwatch';
import { synthesizeTracksideWorkoutActivity } from '../src/utils/stopwatchActivitySynthesizer';

const BASE_STATE: PersistedTracksideStopwatchState = {
  isRunning: true,
  startedAtEpochMs: 1_760_000_000_000,
  accumulatedMs: 0,
  athleteLapTimestampsSecs: { SELF: [65.0, 192.5, 323.0] },
  tapHistory: [],
  extraPodAthletes: [],
  sessionType: 'WORKOUT',
  workoutPresetId: '8x400',
  customWorkoutSpec: {
    repCount: 6,
    repDistanceMeters: 400,
    zoneCode: 'I',
    podIntensity: 'INTERVAL_VO2',
    targetSplitSecs: 65.0,
    restDurationSecs: 60,
    waveMode: 'MASS',
  },
  restDurationSecs: 60,
};

describe('TRK-08: Live #stopwatch Auto-Regulated Coaching Cues & Pivots', () => {
  it('flags HERO_PACE_BRAKE when opening reps exceed target speed by > 3.0%', () => {
    const res = evaluateRunnerLiveAutoRegulation({
      runnerId: 'SELF',
      runnerName: 'Alex Runner',
      podKey: 'Pod A',
      lapSplitsSecs: [61.2], // -5.8% faster than 65.0s target
      plannedRepCount: 6,
      repDistanceMeters: 400,
      restDurationSecs: 60,
      thresholdPaceSecsPerKm: 190,
      targetSplitSecs: 65.0,
      intensity: 'INTERVAL_VO2',
      zoneCode: 'I',
    });

    expect(res.cueType).toBe('HERO_PACE_BRAKE');
    expect(res.fadePct).toBeLessThan(-3);
    expect(res.dPrimeBalancePct).toBeLessThan(100);
  });

  it('triggers METABOLIC_DRIFT_REST (+2.5% to +4.5% fade) and extends rest by +30s', () => {
    const res = evaluateRunnerLiveAutoRegulation({
      runnerId: 'SELF',
      runnerName: 'Alex Runner',
      podKey: 'Pod A',
      lapSplitsSecs: [65.1, 67.2], // +3.4% fade on rep 2 only
      plannedRepCount: 8,
      repDistanceMeters: 400,
      restDurationSecs: 60,
      thresholdPaceSecsPerKm: 185,
      targetSplitSecs: 65.0,
      intensity: 'INTERVAL_VO2',
      zoneCode: 'I',
    });

    expect(res.cueType).toBe('METABOLIC_DRIFT_REST');
    expect(res.recommendedAction).toBe('EXTEND_REST_30S');

    const mutated = applyExtendWorkoutRestPlus30s(BASE_STATE, 30, 1_760_000_400_000);
    expect(mutated.restDurationSecs).toBe(90);
    expect(mutated.customWorkoutSpec?.restDurationSecs).toBe(90);
    expect(mutated.autoRegPivotHistory?.at(-1)?.action).toBe('EXTEND_REST_30S');

    const extendedAgain = applyExtendWorkoutRestPlus30s(
      { ...mutated, restDurationSecs: 180 },
      30
    );
    expect(extendedAgain.restDurationSecs).toBe(210);
  });

  it('triggers CV_CONVERSION_PIVOT on 2 consecutive >2.5% VO2 fades and mutates remaining workout to CV', () => {
    const res = evaluateRunnerLiveAutoRegulation({
      runnerId: 'SELF',
      runnerName: 'Alex Runner',
      podKey: 'Pod A',
      lapSplitsSecs: [65.2, 67.0, 67.3], // 2 consecutive >2.5% fades above 65.0s
      plannedRepCount: 8,
      repDistanceMeters: 400,
      restDurationSecs: 60,
      thresholdPaceSecsPerKm: 185,
      targetSplitSecs: 65.0,
      intensity: 'INTERVAL_VO2',
      zoneCode: 'I',
    });

    expect(res.cueType).toBe('CV_CONVERSION_PIVOT');
    expect(res.consecutiveFadeCount).toBe(2);
    expect(res.recommendedAction).toBe('CONVERT_REMAINING_TO_CV');

    const pivoted = applyConvertRemainingToCv(BASE_STATE, 1_760_000_420_000);
    expect(pivoted.workoutPresetId).toBe('custom-plan');
    expect(pivoted.customWorkoutSpec?.zoneCode).toBe('CV');
    expect(pivoted.customWorkoutSpec?.podIntensity).toBe('THRESHOLD_CV');
    expect(pivoted.customWorkoutSpec?.targetSplitSecs).toBeCloseTo(69.9, 1);
  });

  it('triggers NEURO_STOP_RULE on >4.5% fade or <15% D_bal past half-session and saves 85% stimulus ratio', () => {
    const res = evaluateRunnerLiveAutoRegulation({
      runnerId: 'SELF',
      runnerName: 'Alex Runner',
      podKey: 'Pod A',
      lapSplitsSecs: [65.0, 66.2, 68.4], // +5.2% fade on rep 3 of 6 (>= 50%)
      plannedRepCount: 6,
      repDistanceMeters: 400,
      restDurationSecs: 45,
      thresholdPaceSecsPerKm: 185,
      targetSplitSecs: 65.0,
      intensity: 'INTERVAL_VO2',
      zoneCode: 'I',
    });

    expect(res.cueType).toBe('NEURO_STOP_RULE');
    expect(res.recommendedAction).toBe('END_SESSION_85_STIMULUS');

    const stopped = applyEndSessionStimulusAchieved(BASE_STATE, 3, 1_760_000_500_000);
    expect(stopped.isRunning).toBe(false);
    expect(stopped.endedEarlyStimulusRatio).toBe(0.85);
    expect(stopped.customWorkoutSpec?.repCount).toBe(3);

    const savedAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'SELF',
      runnerName: 'Alex Runner',
      thresholdPaceSecsPerKm: 185,
      presetLabel: '6 x 400m · CV',
      repDistanceMeters: 400,
      restDurationSecs: 45,
      lapSplitsSecs: [65.0, 66.2, 68.4],
      stimulusCompletionRatio: stopped.endedEarlyStimulusRatio ?? undefined,
      autoRegPivotSummary: stopped.autoRegPivotHistory?.map((p) => p.summary).join(' · '),
    });

    expect(savedAct.stimulusCompletionRatio).toBe(0.85);
    expect(savedAct.autoRegPivotSummary).toContain('85% stimulus preserved');
  });

  it('prioritizes NEURO_STOP_RULE across squad alerts and respects dismissed signatures', () => {
    const summary = evaluateSquadLiveAutoRegulation([
      {
        runnerId: 'r1',
        runnerName: 'Runner One',
        podKey: 'Pod A',
        lapSplitsSecs: [62.0],
        plannedRepCount: 6,
        repDistanceMeters: 400,
        restDurationSecs: 60,
        thresholdPaceSecsPerKm: 185,
        targetSplitSecs: 65.0,
        intensity: 'INTERVAL_VO2',
      },
      {
        runnerId: 'r2',
        runnerName: 'Runner Two',
        podKey: 'Pod A',
        lapSplitsSecs: [65.0, 66.5, 68.5],
        plannedRepCount: 6,
        repDistanceMeters: 400,
        restDurationSecs: 45,
        thresholdPaceSecsPerKm: 185,
        targetSplitSecs: 65.0,
        intensity: 'INTERVAL_VO2',
      },
    ]);

    expect(summary.primaryAlert?.runnerId).toBe('r2');
    expect(summary.primaryAlert?.cueType).toBe('NEURO_STOP_RULE');

    const dismissedSummary = evaluateSquadLiveAutoRegulation(
      [
        {
          runnerId: 'r2',
          runnerName: 'Runner Two',
          podKey: 'Pod A',
          lapSplitsSecs: [65.0, 66.5, 68.5],
          plannedRepCount: 6,
          repDistanceMeters: 400,
          restDurationSecs: 45,
          thresholdPaceSecsPerKm: 185,
          targetSplitSecs: 65.0,
          intensity: 'INTERVAL_VO2',
        },
      ],
      [summary.primaryAlert!.signature]
    );
    expect(dismissedSummary.primaryAlert).toBeNull();
  });
});
