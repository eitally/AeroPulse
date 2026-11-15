import { describe, expect, it } from 'vitest';
import {
  M_SHOE_MULTIPLIERS,
  evaluateOrthopedicInterference,
  resolveActivityFootwearClass,
  resolveActivitySpikedMeters,
  resolveTrackCurveMultiplier,
} from '../src/physiology/orthopedicEngine';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { PlannedWorkoutEvent, UnifiedActivity } from '../src/types';

function makeTrackRun(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: `run-${Math.random().toString(36).slice(2, 7)}`,
    startDateLocal: '2026-11-12T15:00:00Z',
    name: 'Track Repeats 6x400m',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 2400,
    distanceMeters: 8000,
    elevationGainMeters: 10,
    trainingLoad: 70,
    avgHr: 162,
    maxHr: 184,
    aerobicDecouplingPct: 2.0,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.51,
    secondHalfEf: 1.49,
    zoneSecs: { hr: [100, 900, 600, 400, 300, 100, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
    ...overrides,
  };
}

describe('TRK-06: Carbon Super-Spike & Lower-Leg Exposure Guardrail', () => {
  const baseProfile = buildCompleteAthleteProfile({
    name: 'Noah Patel',
    weightKg: 62,
    ftp: 260,
    thresholdPaceSecsPerKm: 225,
  });

  it('assigns exact M_shoe multipliers, M_curve multipliers, and extracts WORK spiked meters', () => {
    expect(M_SHOE_MULTIPLIERS.DAILY_TRAINER).toBe(1.0);
    expect(M_SHOE_MULTIPLIERS.LIGHTWEIGHT_FLAT_SUPER_TRAINER).toBe(1.1);
    expect(M_SHOE_MULTIPLIERS.CARBON_ROAD_RACER).toBe(1.2);
    expect(M_SHOE_MULTIPLIERS.TRADITIONAL_TRACK_SPIKE).toBe(1.35);
    expect(M_SHOE_MULTIPLIERS.CARBON_SUPER_SPIKE).toBe(1.52);

    const dragonflyRun = makeTrackRun({ gearName: 'Nike ZoomX Dragonfly 2' });
    const indoorFlatRun = makeTrackRun({
      environment: 'INDOOR',
      trackFacility: 'INDOOR_FLAT_200M',
      footwearClass: 'CARBON_SUPER_SPIKE',
      intervals: [
        { id: 'w1', label: 'Rep 1', type: 'WORK', startTimeSecs: 600, durationSecs: 60, distanceMeters: 400, avgHr: 175 },
        { id: 'r1', label: 'Rec 1', type: 'RECOVERY', startTimeSecs: 660, durationSecs: 120, distanceMeters: 200, avgHr: 140 },
        { id: 'w2', label: 'Rep 2', type: 'WORK', startTimeSecs: 780, durationSecs: 60, distanceMeters: 400, avgHr: 178 },
        { id: 'r2', label: 'Rec 2', type: 'RECOVERY', startTimeSecs: 840, durationSecs: 120, distanceMeters: 200, avgHr: 142 },
      ],
    });
    const roadRun = makeTrackRun({
      subType: 'Road',
      name: 'Morning Neighborhood Aerobic Run',
      gearName: 'Pegasus 41',
    });

    expect(resolveActivityFootwearClass(dragonflyRun)).toBe('CARBON_SUPER_SPIKE');
    expect(resolveActivityFootwearClass(roadRun)).toBe('DAILY_TRAINER');
    expect(resolveTrackCurveMultiplier(dragonflyRun)).toBe(1.06);
    expect(resolveTrackCurveMultiplier(indoorFlatRun)).toBe(1.16);
    expect(resolveTrackCurveMultiplier(roadRun)).toBe(1.0);
    expect(resolveActivitySpikedMeters(indoorFlatRun, 'CARBON_SUPER_SPIKE')).toBe(800);
    expect(resolveActivitySpikedMeters(roadRun, 'DAILY_TRAINER')).toBe(0);
  });

  it('enforces cohort weekly spiked caps (U18 <= 2000m / 1600m super-spike) and 48h trainer-only lock with timely release', () => {
    const hsProfile = buildCompleteAthleteProfile({
      ...baseProfile,
      safeSportHideWeight: true,
      academicDivision: undefined,
    });
    const ncaaD1Profile = buildCompleteAthleteProfile({
      ...baseProfile,
      safeSportHideWeight: false,
      academicDivision: 'NCAA_D1',
    });

    // Super-spike session 24h prior to reference time -> 48h lock MUST be active
    const recentSuperSpike = makeTrackRun({
      startDateLocal: '2026-11-11T15:00:00Z',
      footwearClass: 'CARBON_SUPER_SPIKE',
      spikedDistanceMeters: 1800,
    });

    const plannedSpikeToday: PlannedWorkoutEvent[] = [
      {
        id: 'plan-spike',
        date: '2026-11-12',
        name: '8x200m R in Spikes',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: 'Fast 200m repeats',
        plannedDurationSecs: 2400,
        plannedLoad: 68,
        targetZoneSummary: 'Z5 R Spikes',
        footwearClass: 'CARBON_SUPER_SPIKE',
      },
    ];

    const hsSummaryAt24h = evaluateOrthopedicInterference(
      [recentSuperSpike],
      hsProfile,
      plannedSpikeToday,
      '2026-11-12T15:00:00Z',
      { isMinorU18: true }
    );

    expect(hsSummaryAt24h.spikedMetersWeeklyCap).toBe(2000);
    expect(hsSummaryAt24h.superSpikeWeeklyCap).toBe(1600);
    expect(hsSummaryAt24h.spikedMeters7d).toBe(1800);
    expect(hsSummaryAt24h.superSpikeMeters7d).toBe(1800);
    expect(hsSummaryAt24h.hoursSinceLastSuperSpike).toBeCloseTo(24.0, 1);
    expect(hsSummaryAt24h.trainerOnly48hLockActive).toBe(true);
    expect(hsSummaryAt24h.spikeGuardrailStatus).toBe('TRAINER_ONLY_48H_LOCK');
    expect(hsSummaryAt24h.riskTier).toBe('HIGH_IMPACT_GUARDRAIL');

    // Same session evaluated 52h later -> 48h lock releases, yet >1600m U18 super-spike cap still warns!
    const hsSummaryAt52h = evaluateOrthopedicInterference(
      [recentSuperSpike],
      hsProfile,
      [],
      '2026-11-13T19:00:00Z',
      { isMinorU18: true, lowerLegSoreness: 0 }
    );
    expect(hsSummaryAt52h.hoursSinceLastSuperSpike).toBeCloseTo(52.0, 1);
    expect(hsSummaryAt52h.trainerOnly48hLockActive).toBe(false);
    expect(hsSummaryAt52h.spikeGuardrailStatus).toBe('SPIKE_CAP_WARNING');

    // Re-trigger via lowerLegSoreness >= 1 even without recent super-spike
    const sorenessLock = evaluateOrthopedicInterference(
      [],
      ncaaD1Profile,
      [],
      '2026-11-15T12:00:00Z',
      { lowerLegSoreness: 1 }
    );
    expect(sorenessLock.spikedMetersWeeklyCap).toBe(4400);
    expect(sorenessLock.superSpikeWeeklyCap).toBe(3600);
    expect(sorenessLock.trainerOnly48hLockActive).toBe(true);
    expect(sorenessLock.spikeGuardrailStatus).toBe('TRAINER_ONLY_48H_LOCK');
  });
});
