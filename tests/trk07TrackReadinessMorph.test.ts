import { describe, expect, it } from 'vitest';
import {
  buildTrackReadinessMorphedPrescription,
  computeLnRmssdReadiness,
  type TrackReadinessMorphMode,
} from '../src/physiology/trackReadinessMorphEngine';
import { evaluateOrthopedicInterference } from '../src/physiology/orthopedicEngine';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { PlannedWorkoutEvent, UnifiedWellnessDay } from '../src/types';

function makeWellnessSeries(hrvValues: number[], lastTsb = -6, lastRhr = 48): UnifiedWellnessDay[] {
  return hrvValues.map((hrv, idx) => {
    const dayNum = idx + 1;
    const date = `2026-10-${String(Math.min(30, dayNum)).padStart(2, '0')}`;
    const isLast = idx === hrvValues.length - 1;
    return {
      date: idx >= 30 ? `2026-11-${String(idx - 29).padStart(2, '0')}` : date,
      ctl: 58,
      atl: isLast ? 58 - lastTsb : 58,
      tsb: isLast ? lastTsb : 0,
      rampRate: 2.1,
      dailyLoad: 65,
      restingHR: isLast ? lastRhr : 48,
      hrvRMSSD: hrv,
      hrvBaseline7d: 64,
      hrvNormalBandLow: 56,
      hrvNormalBandHigh: 72,
      hrvStatus: 'Balanced',
      sleepSecs: 28800,
      sleepScore: 84,
      readinessStatus: 'Optimal',
      weightKg: 60,
    };
  });
}

describe('TRK-07: Track-First Readiness (30d Ln rMSSD) & Fixed-Lap Morph Engine', () => {
  const runnerProfile = buildCompleteAthleteProfile({
    name: 'Samira Ali',
    primarySport: 'Running',
    weightKg: 58,
    ftp: 230,
    thresholdPaceSecsPerKm: 215, // ~3:35/km LT2
  });

  it('computes 30d Ln rMSSD z-score and detects parasympathetic vagal saturation', () => {
    // Stable ~64ms baseline for 29 days, then sharp suppression (46ms)
    const strainedDays = makeWellnessSeries([...Array(29).fill(64), 46]);
    const strained = computeLnRmssdReadiness(strainedDays, 48);
    expect(strained.windowSampleDays).toBe(30);
    expect(strained.zScore30d).toBeLessThanOrEqual(-1.5);
    expect(strained.hrvState).toBe('strained');
    expect(strained.parasympatheticSaturation).toBe(false);

    // Hyper-vagal spike (+3.0 SD to 105ms) WITH elevated RHR (+4 bpm) & deep fatigue (TSB -21) -> Saturation!
    const saturatedDays = makeWellnessSeries([...Array(29).fill(64), 108], -21, 52);
    const saturated = computeLnRmssdReadiness(saturatedDays, 48);
    expect(saturated.zScore30d).toBeGreaterThan(1.5);
    expect(saturated.parasympatheticSaturation).toBe(true);
    expect(saturated.hrvState).toBe('caution');
    expect(saturated.hrvDetail).toMatch(/Vagal Saturation Watch/i);
  });

  it('morphs across all 5 track modes preserving fixed oval distances with ZERO % FTP or Watt leakage', () => {
    const orthoClear = evaluateOrthopedicInterference([], runnerProfile);
    const orthoLocked = evaluateOrthopedicInterference(
      [
        {
          id: 'super-1',
          startDateLocal: '2026-11-12T10:00:00Z',
          name: '400m Repeats',
          sportCategory: 'Running',
          environment: 'OUTDOOR',
          subType: 'Track',
          movingTimeSecs: 1800,
          distanceMeters: 6400,
          elevationGainMeters: 0,
          trainingLoad: 72,
          avgHr: 170,
          maxHr: 188,
          aerobicDecouplingPct: 1.5,
          efficiencyFactor: 1.55,
          firstHalfEf: 1.56,
          secondHalfEf: 1.54,
          zoneSecs: { hr: [0, 600, 400, 300, 300, 200, 0] },
          stravaPrCount: 0,
          segmentEfforts: [],
          sourceBadges: ['Garmin'],
          footwearClass: 'CARBON_SUPER_SPIKE',
          spikedDistanceMeters: 1600,
        },
      ],
      runnerProfile,
      [],
      '2026-11-12T18:00:00Z'
    );

    const planned800s: PlannedWorkoutEvent = {
      id: 'plan-6x800',
      date: '2026-11-13',
      name: '6 x 800m @ I VO2max',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: '6 x 800m @ 5K pace w/ 90s jog',
      plannedDurationSecs: 3000,
      plannedLoad: 78,
      targetZoneSummary: 'Z5 VO2max',
      trackSpec: {
        eventGroup: '1500_MILE',
        phase: 'SPECIFIC',
        zoneCode: 'I',
        podIntensity: 'INTERVAL_VO2',
        repCount: 6,
        repDistanceMeters: 800,
        targetSplitSecs: 158,
        restDurationSecs: 90,
        footwearClass: 'TRADITIONAL_TRACK_SPIKE',
      },
    };

    const modes: TrackReadinessMorphMode[] = [
      'BONE_STRESS_STOP',
      'RECOVERY_FLUSH',
      'CAUTION_PIVOT',
      'SUPERCOMPENSATION',
      'BALANCED',
    ];

    for (const mode of modes) {
      const rx = buildTrackReadinessMorphedPrescription({
        mode,
        baselineTitle: planned800s.name,
        baselineSyntax: 'Main Set 6x\n- 800m @ 2:38.0 (102% Pace)\n- 90s 58% Pace Recovery',
        plannedEvent: planned800s,
        athleteProfile: runnerProfile,
        distanceUnit: 'mi',
        orthopedicSummary: orthoClear,
      });

      expect(rx.preservesFixedLapDistance).toBe(true);
      expect(rx.repDistanceMeters).toBe(800);

      const combinedCopy = `${rx.title}\n${rx.badge}\n${rx.rationale}\n${rx.workoutSyntax}\n${rx.footwearRecommendation}`;
      expect(combinedCopy).not.toMatch(/%\s*FTP/i);
      expect(combinedCopy).not.toMatch(/\b\d+\s*W\b/);
    }

    // Specific behaviors verified per mode
    const boneStop = buildTrackReadinessMorphedPrescription({
      mode: 'BONE_STRESS_STOP',
      baselineTitle: planned800s.name,
      baselineSyntax: '',
      plannedEvent: planned800s,
      athleteProfile: runnerProfile,
      distanceUnit: 'mi',
      orthopedicSummary: orthoLocked,
    });
    expect(boneStop.title).toMatch(/Aqua Jog/i);
    expect(boneStop.spikedMetersPlanned).toBe(0);

    const flushLocked = buildTrackReadinessMorphedPrescription({
      mode: 'RECOVERY_FLUSH',
      baselineTitle: planned800s.name,
      baselineSyntax: '',
      plannedEvent: planned800s,
      athleteProfile: runnerProfile,
      distanceUnit: 'mi',
      orthopedicSummary: orthoLocked,
    });
    expect(flushLocked.title).toMatch(/Soft-Turf/i);
    expect(flushLocked.spikedMetersPlanned).toBe(0);

    const taperTrim = buildTrackReadinessMorphedPrescription({
      mode: 'CAUTION_PIVOT',
      baselineTitle: planned800s.name,
      baselineSyntax: '',
      plannedEvent: planned800s,
      athleteProfile: runnerProfile,
      distanceUnit: 'mi',
      orthopedicSummary: orthoClear,
      seasonPhase: 'PEAK_TAPER',
    });
    expect(taperTrim.repCount).toBe(4); // 6 * 0.67 -> 4 reps holding 800m distance
    expect(taperTrim.title).toMatch(/Volume Trim/i);

    const cvFloat = buildTrackReadinessMorphedPrescription({
      mode: 'CAUTION_PIVOT',
      baselineTitle: planned800s.name,
      baselineSyntax: '',
      plannedEvent: planned800s,
      athleteProfile: runnerProfile,
      distanceUnit: 'mi',
      orthopedicSummary: orthoLocked,
      seasonPhase: 'SPECIFIC',
    });
    expect(cvFloat.title).toMatch(/CV w\/ 60s Float/i);
    expect(cvFloat.spikedMetersPlanned).toBe(0); // 48h lock enforces 0m spikes
  });
});
