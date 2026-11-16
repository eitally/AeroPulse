import { describe, expect, it } from 'vitest';
import {
  computeTrackExecutionScore,
  computeTrackProgressionLevels,
  runBayesianTrackCalibrator,
} from '../src/physiology/trackProgressionAndKalmanEngine';
import type { UnifiedActivity, UnifiedWellnessDay } from '../src/types';

function makeTrackAct(
  id: string,
  date: string,
  splits: number[],
  restSecs: number,
  options?: {
    name?: string;
    distMeters?: number;
    stimulusRatio?: number;
    isRace?: boolean;
    wind?: string;
    load?: number;
  }
): UnifiedActivity {
  const repDist = options?.distMeters ?? 400;
  const intervals = splits.flatMap((dur, idx) => {
    const start = idx * (dur + restSecs);
    const work = {
      id: `${id}-w-${idx}`,
      type: 'WORK' as const,
      label: `Rep ${idx + 1}`,
      startTimeSecs: Math.round(start),
      durationSecs: dur,
      distanceMeters: repDist,
      avgPaceSecsPerKm: Math.round((dur / repDist) * 1000),
    };
    if (idx < splits.length - 1 && restSecs > 0) {
      return [
        work,
        {
          id: `${id}-r-${idx}`,
          type: 'RECOVERY' as const,
          label: `Recovery`,
          startTimeSecs: Math.round(start + dur),
          durationSecs: restSecs,
          distanceMeters: Math.round(restSecs * 1.8),
        },
      ];
    }
    return [work];
  });

  const totalWorkDur = splits.reduce((a, b) => a + b, 0);
  const totalDist = splits.length * repDist;

  return {
    id,
    startDateLocal: `${date}T15:30:00`,
    name: options?.name || `${splits.length}x${repDist}m Track Session`,
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: Math.round(totalWorkDur + Math.max(0, splits.length - 1) * restSecs),
    distanceMeters: totalDist,
    elevationGainMeters: 0,
    trainingLoad: options?.load ?? 72,
    avgHr: 170,
    maxHr: 192,
    avgPaceSecsPerKm: Math.round((totalWorkDur / Math.max(1, totalDist)) * 1000),
    aerobicDecouplingPct: 2.5,
    efficiencyFactor: 1.75,
    firstHalfEf: 1.78,
    secondHalfEf: 1.74,
    zoneSecs: { hr: [300, 300, 120, 240, 240, 60, 0] },
    stimulusCompletionRatio: options?.stimulusRatio,
    intervals: options?.isRace ? undefined : intervals,
    officialRaceData: options?.isRace
      ? {
          platform: 'Official FAT',
          meetName: 'Track Test Meet',
          eventLabel: `${repDist}m`,
          eventDistanceMeters: repDist,
          fatTimeSecs: totalWorkDur,
          displayFatTime: `${totalWorkDur.toFixed(2)}`,
          trackType: 'OUTDOOR_400M',
          lapSplitsSecs: splits,
          vdotScore: 68,
          includeWarmupCooldown: false,
          windReading: options?.wind,
        }
      : undefined,
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Official FAT'],
  };
}

describe('TRK-10: 5-Axis Track Progression, 4-Pillar Execution Score & Bayesian Calibrator', () => {
  it('flags Workout Hero pacing [56, 58, 60, 62, 64] at ~71.4 while disciplined [60.4..59.5] scores >=95', () => {
    const hero = computeTrackExecutionScore({
      workSplitsSecs: [56, 58, 60, 62, 64],
      targetSplitSecs: 60.0,
      plannedRestSecs: 60,
      actualRestSecs: 60,
      aerobicDecouplingPct: 2.5,
    });
    expect(hero.workoutHeroFlag).toBe(true);
    expect(hero.verdictLabel).toBe('Workout Hero Flag');
    expect(hero.totalScore).toBeGreaterThan(69);
    expect(hero.totalScore).toBeLessThan(74);

    const disciplined = computeTrackExecutionScore({
      workSplitsSecs: [60.4, 60.1, 60.0, 59.8, 59.5],
      targetSplitSecs: 60.0,
      plannedRestSecs: 60,
      actualRestSecs: 60,
      aerobicDecouplingPct: 1.8,
    });
    expect(disciplined.workoutHeroFlag).toBe(false);
    expect(disciplined.totalScore).toBeGreaterThanOrEqual(95);
  });

  it('applies 1.8x rest-cheating penalty and prevents inflating progression levels', () => {
    const cheatedScore = computeTrackExecutionScore({
      workSplitsSecs: [60, 60, 60, 60],
      targetSplitSecs: 60,
      plannedRestSecs: 60,
      actualRestSecs: 75, // +25% excess rest -> 100 - 1.8*25 = 55
    });
    expect(cheatedScore.restFidelityScore).toBe(55);
    expect(cheatedScore.restCheatingFlag).toBe(true);

    const honestSummary = computeTrackProgressionLevels({
      activities: [
        makeTrackAct('honest-1', '2026-11-01', [60, 60, 60, 60, 60], 60, {
          name: '5x400m VO2max',
        }),
      ],
      referenceDateIso: '2026-11-05',
      athleteProfile: { thresholdPaceSecsPerKm: 190 },
      plannedRestByActivityId: { 'honest-1': 60 },
    });

    const cheatSummary = computeTrackProgressionLevels({
      activities: [
        makeTrackAct('cheat-1', '2026-11-01', [60, 60, 60, 60, 60], 110, {
          name: '5x400m VO2max',
        }),
      ],
      referenceDateIso: '2026-11-05',
      athleteProfile: { thresholdPaceSecsPerKm: 190 },
      plannedRestByActivityId: { 'cheat-1': 60 },
    });

    expect(cheatSummary.restCheatPenaltyCount).toBeGreaterThan(0);
    const honestVo2 = honestSummary.axes.find((a) => a.axisId === 'VO2MAX_AEROBIC_POWER')!;
    const cheatVo2 = cheatSummary.axes.find((a) => a.axisId === 'VO2MAX_AEROBIC_POWER')!;
    expect(honestVo2.level).toBeGreaterThan(cheatVo2.level);
  });

  it('enforces 14d exponential decay onset, preserves 0.85 stimulus credit, and guards HRV fluke days', () => {
    const lowHrvDay: UnifiedWellnessDay = {
      date: '2026-10-08',
      ctl: 60,
      atl: 65,
      tsb: -5,
      rampRate: 2,
      hrvRMSSD: 41,
      hrvBaseline7d: 74,
      hrvStatus: 'Low',
      restingHR: 54,
      sleepSecs: 21600,
      sleepScore: 55,
      weightKg: 64,
      readinessStatus: 'Strain',
      dailyLoad: 70,
    };

    const summary = computeTrackProgressionLevels({
      activities: [
        makeTrackAct('a1', '2026-10-01', [74, 74, 74, 74], 45, {
          name: '4x400m CV Cruise',
          stimulusRatio: 0.85,
        }),
        makeTrackAct('a2', '2026-10-08', [66, 68, 72, 76], 110, {
          name: 'VO2max Intervals on Strain Day',
        }),
      ],
      wellnessDays: [lowHrvDay],
      referenceDateIso: '2026-11-15', // >35 days later -> clear >14d decay
      athleteProfile: { thresholdPaceSecsPerKm: 205 },
      plannedRestByActivityId: { a1: 45, a2: 60 },
    });

    expect(summary.axes).toHaveLength(5);
    expect(summary.partialCreditCount).toBe(1);
    expect(summary.flukeProtectedCount).toBeGreaterThan(0);
    const cvAxis = summary.axes.find((a) => a.axisId === 'SUB_THRESHOLD_CV')!;
    expect(cvAxis.decayedSincePeak).toBeGreaterThan(0.1);
  });

  it('quarantines <180s sprints, >+2.0 m/s wind-aided marks, and rest-cheated reps unless confirmed', () => {
    const acts: UnifiedActivity[] = [
      // Sprint <180s
      makeTrackAct('sprint-1', '2026-11-01', [51.4], 0, {
        name: '400m Open Race',
        distMeters: 400,
        isRace: true,
      }),
      // Wind-aided > +2.0 m/s
      makeTrackAct('wind-1', '2026-11-03', [60.0, 60.0, 60.0, 60.0], 0, {
        name: '1600m Wind-Aided',
        distMeters: 1600,
        isRace: true,
        wind: '+3.1 m/s',
      }),
      // Rest cheated interval session (120s rest vs 60s plan)
      makeTrackAct('cheat-1', '2026-11-05', [62, 62, 62, 62, 62], 120, {
        name: '5x400m Fast w/ Extra Rest',
      }),
      // Unverified +10% workout jump without race stamp
      makeTrackAct('jump-1', '2026-11-08', [58, 58, 58, 58, 58], 60, {
        name: '5x400m Unverified Outlier',
      }),
    ];

    const quarantinedResult = runBayesianTrackCalibrator({
      activities: acts,
      priorThresholdPaceSecsPerKm: 225, // ~4.44 m/s -> ~4.77 m/s CS
      plannedRestByActivityId: { 'cheat-1': 60, 'jump-1': 60 },
    });

    expect(quarantinedResult.quarantinedCount).toBe(4);
    expect(quarantinedResult.acceptedCount).toBe(0);
    expect(quarantinedResult.posteriorCsMps).toBe(quarantinedResult.priorCsMps);
    expect(quarantinedResult.auditLog.map((e) => e.reasonCode)).toEqual([
      'SUB_180S_SPRINT_REP',
      'WIND_AIDED_OVER_2MPS',
      'REST_CHEATED_WORKOUT',
      'UNVERIFIED_OUTLIER_JUMP',
    ]);

    // Confirming override on `jump-1` moves the Kalman posterior CS upward
    const overrideResult = runBayesianTrackCalibrator({
      activities: acts,
      priorThresholdPaceSecsPerKm: 225,
      confirmedQuarantineIds: ['jump-1'],
      plannedRestByActivityId: { 'cheat-1': 60, 'jump-1': 60 },
    });
    expect(overrideResult.overrideCount).toBe(1);
    expect(overrideResult.posteriorCsMps).toBeGreaterThan(overrideResult.priorCsMps);
  });
});
