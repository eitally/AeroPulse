import { describe, expect, it } from 'vitest';
import {
  computeFatigueSlicedDurability,
  evaluateOrthopedicInterference,
  evaluatePlannedVsCompletedCompliance,
  generateVerifiedRacePassport,
  generateWeeklyTrainingGitDiff,
  simulateCoursePacingAndFueling,
} from '../src/physiology';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { ActivityStreamSet, PlannedWorkoutEvent, UnifiedActivity } from '../src/types';

describe('Horizon 2 & 3 Physiology Engines (10x #2, #3, #4, #6 & Compliance)', () => {
  const profile = buildCompleteAthleteProfile({
    name: 'Alex Rivera',
    weightKg: 70,
    ftp: 300,
    thresholdPaceSecsPerKm: 240,
  });

  it('evaluates Planned vs. Completed workout compliance and cross-modal swaps', () => {
    const planned: PlannedWorkoutEvent[] = [
      {
        id: 'plan-1',
        date: '2026-11-10',
        name: 'Threshold Run 4x2km',
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: '4x2km at LT2',
        plannedDurationSecs: 3600,
        plannedLoad: 75,
        targetZoneSummary: 'Z4 Threshold',
      },
    ];
    const completed: UnifiedActivity[] = [
      {
        id: 'act-1',
        startDateLocal: '2026-11-10T07:30:00',
        name: 'Morning Track Threshold',
        sportCategory: 'Running',
        environment: 'OUTDOOR',
        subType: 'Track',
        movingTimeSecs: 3540, // 59m
        distanceMeters: 14200,
        elevationGainMeters: 20,
        trainingLoad: 74,
        avgHr: 168,
        maxHr: 184,
        aerobicDecouplingPct: 2.1,
        efficiencyFactor: 1.52,
        firstHalfEf: 1.53,
        secondHalfEf: 1.5,
        zoneSecs: { hr: [120, 900, 900, 1400, 220, 0, 0] },
        stravaPrCount: 1,
        segmentEfforts: [],
        sourceBadges: ['Garmin'],
      },
    ];

    const res = evaluatePlannedVsCompletedCompliance(planned, completed, '2026-11-10');
    expect(res).toHaveLength(1);
    expect(res[0].status).toBe('COMPLETED_ON_TARGET');
    expect(res[0].complianceScore).toBeGreaterThanOrEqual(95);
  });

  it('10x #3: generates a Weekly Training Git-Diff that morphs today and shifts quality +48h when Impact ACWR spikes', () => {
    const highImpactRun: UnifiedActivity = {
      id: 'run-steep',
      startDateLocal: '2026-11-09T08:00:00',
      name: 'Downhill Mountain Trail 22K',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Trail',
      movingTimeSecs: 6000,
      distanceMeters: 22000,
      elevationGainMeters: 650,
      trainingLoad: 145,
      avgHr: 165,
      maxHr: 183,
      aerobicDecouplingPct: 4.5,
      efficiencyFactor: 1.35,
      firstHalfEf: 1.38,
      secondHalfEf: 1.32,
      zoneSecs: { hr: [0, 1800, 2200, 2000, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Garmin'],
    };

    const ortho = evaluateOrthopedicInterference(
      [highImpactRun],
      profile,
      [],
      '2026-11-10'
    );
    const diff = generateWeeklyTrainingGitDiff({
      plannedEvents: [
        {
          id: 'tue-run',
          date: '2026-11-10',
          name: 'VO2max Track Intervals',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          description: 'Track intervals',
          plannedDurationSecs: 3600,
          plannedLoad: 82,
          targetZoneSummary: 'Z5',
        },
      ],
      orthopedicSummary: ortho,
      todayIso: '2026-11-10',
    });

    expect(diff.readinessVerdict).toBe('RED_GUARDRAIL');
    expect(diff.dayChanges).toHaveLength(7);
    expect(diff.dayChanges[0].changeType).toBe('MODIFIED');
    expect(diff.dayChanges[0].proposedSport).toBe('Cycling');
    expect(diff.dayChanges[2].changeType).toBe('SWAPPED');
  });

  it('10x #2: slices 1Hz cycling telemetry into 0–40 kJ/kg durability buckets', () => {
    // 2 hours (7200s) at ~280W -> ~2016 kJ -> ~28.8 kJ/kg for a 70kg rider
    const n = 7200;
    const time = Array.from({ length: n }, (_, i) => i);
    const watts = Array.from({ length: n }, (_, i) => (i < 3600 ? 295 : 278));
    const heartrate = Array.from({ length: n }, (_, i) => (i < 3600 ? 154 : 161));
    const stream: ActivityStreamSet = { time, watts, heartrate };

    const ride: UnifiedActivity = {
      id: 'ride-dur-1',
      startDateLocal: '2026-11-08T09:00:00',
      name: '2hr Endurance + Late Threshold',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: n,
      distanceMeters: 74000,
      elevationGainMeters: 620,
      avgPower: 286,
      normalizedPower: 290,
      trainingLoad: 185,
      avgHr: 157,
      maxHr: 172,
      aerobicDecouplingPct: 3.1,
      efficiencyFactor: 1.85,
      firstHalfEf: 1.9,
      secondHalfEf: 1.8,
      zoneSecs: { hr: [0, 3600, 2400, 1200, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Garmin'],
    };

    const report = computeFatigueSlicedDurability({
      discipline: 'Cycling',
      activities: [ride],
      streamMap: new Map([[ride.id, stream]]),
      athleteProfile: profile,
    });

    expect(report.unitLabel).toBe('kJ/kg');
    expect(report.buckets).toHaveLength(5);
    expect(report.buckets[0].retentionPct).toBe(100);
    expect(report.retentionAtDeepFatiguePct).toBeGreaterThan(80);
    expect(report.fuelingPrescription.length).toBeGreaterThan(20);
  });

  it('10x #4: simulates course pacing caps and hourly carb/sodium fueling under heat and altitude', () => {
    const sim = simulateCoursePacingAndFueling({
      sport: 'Running',
      raceName: 'Mountain Half Marathon',
      distanceKm: 21.1,
      elevationGainMeters: 340,
      ambientTempC: 24,
      altitudeMeters: 1600,
      athleteProfile: profile,
    });

    expect(sim.segments).toHaveLength(5);
    expect(sim.thermalDeratingPct).toBeGreaterThan(0);
    expect(sim.altitudeDeratingPct).toBeGreaterThan(0);
    expect(sim.fuelingPlan.carbsGramsPerHour).toBeGreaterThanOrEqual(60);
    expect(sim.fuelingPlan.sodiumMgPerHour).toBeGreaterThan(600);
    expect(sim.predictedFinishTimeSecs).toBeGreaterThan(4500);
  });

  it('10x #6: rubber-bands GPS watch drift to certified course distance and issues a THV verification hash', () => {
    const passport = generateVerifiedRacePassport({
      athleteName: 'Alex Rivera',
      meetOrRaceName: 'Carlsbad 5000',
      eventLabel: '5000m',
      platform: 'RunSignup',
      raceDate: '2026-10-18',
      certifiedDistanceMeters: 5000,
      rawGpsDistanceMeters: 5095,
      officialChipOrFatSecs: 945.4,
    });

    expect(passport.verificationHash).toMatch(/^THV-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(passport.gpsDriftPct).toBeCloseTo(1.9, 1);
    expect(passport.vdotScore).toBeGreaterThan(60);
    expect(passport.splits).toHaveLength(5);
    expect(passport.splits[0].certifiedDistanceMeters).toBe(1000);
  });
});
