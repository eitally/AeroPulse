import { describe, expect, it } from 'vitest';
import {
  evaluateRollingTrainingProductivity,
  evaluateSessionImpactReceipt,
  getLocalDateIso,
  partitionActivityLoadBuckets,
  shiftIsoDate,
} from '../src/physiology/trainingProductivityEngine';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';
import type { UnifiedActivity, UnifiedWellnessDay } from '../src/types';

function makeActivity(overrides: Partial<UnifiedActivity> & { id: string; startDateLocal: string }): UnifiedActivity {
  return {
    id: overrides.id,
    startDateLocal: overrides.startDateLocal,
    name: overrides.name || 'Morning Ride',
    sportCategory: overrides.sportCategory || 'Cycling',
    environment: overrides.environment || 'OUTDOOR',
    subType: overrides.subType || 'Road',
    movingTimeSecs: overrides.movingTimeSecs ?? 3600,
    distanceMeters: overrides.distanceMeters ?? 32000,
    elevationGainMeters: overrides.elevationGainMeters ?? 300,
    avgPower: overrides.avgPower ?? 215,
    normalizedPower: overrides.normalizedPower ?? 230,
    intensityFactor: overrides.intensityFactor ?? 0.76,
    variabilityIndex: overrides.variabilityIndex ?? 1.07,
    trainingLoad: overrides.trainingLoad ?? 65,
    avgHr: overrides.avgHr ?? 138,
    maxHr: overrides.maxHr ?? 162,
    aerobicDecouplingPct: overrides.aerobicDecouplingPct ?? 2.4,
    efficiencyFactor: overrides.efficiencyFactor ?? 1.67,
    firstHalfEf: overrides.firstHalfEf ?? 1.69,
    secondHalfEf: overrides.secondHalfEf ?? 1.65,
    zoneSecs: overrides.zoneSecs ?? {
      hr: [600, 2100, 600, 240, 60, 0, 0],
      power: [700, 2100, 500, 200, 60, 30, 10],
    },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

function makeWellness(overrides: Partial<UnifiedWellnessDay> & { date: string }): UnifiedWellnessDay {
  return {
    date: overrides.date,
    ctl: overrides.ctl ?? 55,
    atl: overrides.atl ?? 60,
    tsb: overrides.tsb ?? -5,
    rampRate: overrides.rampRate ?? 2.8,
    hrvRMSSD: overrides.hrvRMSSD ?? 68,
    hrvBaseline7d: overrides.hrvBaseline7d ?? 65,
    hrvNormalBandLow: overrides.hrvNormalBandLow ?? 57,
    hrvNormalBandHigh: overrides.hrvNormalBandHigh ?? 76,
    restingHR: overrides.restingHR ?? 49,
    sleepSecs: overrides.sleepSecs ?? 28000,
    sleepScore: overrides.sleepScore ?? 84,
    sleepQuality: 2,
    weightKg: overrides.weightKg ?? 90.8,
    readinessStatus: overrides.readinessStatus ?? 'Optimal',
    dailyLoad: overrides.dailyLoad ?? 60,
  };
}

describe('7-Day Rolling Training Productivity & Load Focus Engine', () => {
  const calibratedProfile = {
    ...buildCompleteAthleteProfile(null),
    ftp: 303,
    indoorFtp: 303,
    lthr: 153,
    maxHr: 175,
    restingHr: 49,
    weightKg: 90.8,
    source: 'INTERVALS_GARMIN' as const,
  };

  it('computes local YYYY-MM-DD dates without UTC evening rollover and shifts dates cleanly', () => {
    const localEvening = new Date(2026, 10, 10, 21, 15, 0); // Nov 10, 2026 9:15 PM local
    expect(getLocalDateIso(localEvening)).toBe('2026-11-10');
    expect(shiftIsoDate('2026-11-10', -6)).toBe('2026-11-04');
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('partitions 7-zone Power and Garmin 5-zone HR strain accurately into Low Aerobic, High Aerobic & Neuromuscular', () => {
    const polarizedWithSprints = makeActivity({
      id: 'act-1',
      startDateLocal: '2026-11-10T07:00:00',
      trainingLoad: 100,
      zoneSecs: {
        hr: [500, 2400, 300, 200, 200, 0, 0],
        power: [600, 2300, 300, 150, 120, 90, 40],
      },
    });

    const pwrSplit = partitionActivityLoadBuckets(polarizedWithSprints, calibratedProfile);
    expect(pwrSplit.zoneSource).toBe('POWER');
    expect(
      Math.round(
        pwrSplit.lowAerobicLoad + pwrSplit.highAerobicLoad + pwrSplit.neuromuscularLoad
      )
    ).toBe(100);
    expect(pwrSplit.lowAerobicLoad).toBeGreaterThan(55);
    expect(pwrSplit.neuromuscularLoad).toBeGreaterThan(12);

    // Garmin 5-zone HR-only run with hill sprints
    const hrOnlyRun = makeActivity({
      id: 'act-2',
      startDateLocal: '2026-11-10T08:00:00',
      name: 'Easy Run + 6x15s Hill Sprints',
      sportCategory: 'Running',
      trainingLoad: 60,
      zoneSecs: {
        hr: [400, 1900, 300, 100, 60, 0, 0],
      },
    });
    const hrSplit = partitionActivityLoadBuckets(hrOnlyRun, calibratedProfile);
    expect(hrSplit.zoneSource).toBe('HR');
    expect(hrSplit.neuromuscularLoad).toBeGreaterThanOrEqual(8);
  });

  it('identifies PRODUCTIVE status when 7d load sits inside optimal tunnel with balanced 3-system mix and rising EF', () => {
    const activities: UnifiedActivity[] = [
      // Prior 28d baseline ride for EF comparison
      makeActivity({
        id: 'base-1',
        startDateLocal: '2026-10-25T08:00:00',
        trainingLoad: 70,
        efficiencyFactor: 1.66,
      }),
      makeActivity({
        id: 'base-2',
        startDateLocal: '2026-10-29T08:00:00',
        trainingLoad: 75,
        efficiencyFactor: 1.68,
      }),
      // 7-day rolling block (~385 TSS vs 55*7 = 385 chronic weekly baseline)
      makeActivity({
        id: 'w-1',
        startDateLocal: '2026-11-04T07:30:00',
        name: 'Z2 Base Endurance',
        trainingLoad: 85,
        efficiencyFactor: 1.72,
        zoneSecs: { hr: [600, 3900, 300, 0, 0, 0, 0], power: [700, 3800, 300, 0, 0, 0, 0] },
      }),
      makeActivity({
        id: 'w-2',
        startDateLocal: '2026-11-06T07:30:00',
        name: 'Threshold + VO2 Openers',
        trainingLoad: 95,
        efficiencyFactor: 1.75,
        zoneSecs: { hr: [400, 1200, 900, 800, 300, 0, 0], power: [500, 1100, 900, 750, 220, 90, 40] },
      }),
      makeActivity({
        id: 'w-3',
        startDateLocal: '2026-11-08T08:00:00',
        name: 'Long Z2 Gravel Spin',
        trainingLoad: 125,
        efficiencyFactor: 1.73,
        zoneSecs: { hr: [900, 5400, 600, 120, 0, 0, 0], power: [1000, 5300, 600, 100, 20, 0, 0] },
      }),
      makeActivity({
        id: 'w-4',
        startDateLocal: '2026-11-10T07:00:00',
        name: 'Z2 Spin + Neuromuscular Sprints',
        trainingLoad: 75,
        efficiencyFactor: 1.74,
        zoneSecs: { hr: [500, 2500, 300, 120, 180, 0, 0], power: [600, 2400, 260, 100, 100, 90, 50] },
      }),
    ];

    const wellness: UnifiedWellnessDay[] = [
      makeWellness({ date: '2026-11-03', ctl: 52.2, atl: 55, tsb: -2.8 }),
      makeWellness({ date: '2026-11-10', ctl: 55.4, atl: 61, tsb: -5.6, hrvRMSSD: 70, hrvBaseline7d: 66 }),
    ];

    const summary = evaluateRollingTrainingProductivity({
      activities,
      wellnessDays: wellness,
      athleteProfile: calibratedProfile,
      asOfDateIso: '2026-11-10',
    });

    expect(summary.verdict).toBe('PRODUCTIVE');
    expect(summary.acuteLoad7d).toBe(380);
    expect(summary.loadTunnelStatus).toBe('OPTIMAL');
    expect(summary.ctlRamp7d).toBeCloseTo(3.2, 1);
    expect(summary.efDeltaPct).toBeGreaterThan(0);
    expect(summary.buckets[0].status).toBe('OPTIMAL');
  });

  it('flags POLARIZATION_DEFICIT when High Aerobic Z3-Z4 dominates 7d load and prescribes Low Aerobic Z2 rebalance', () => {
    const greyZoneWeek: UnifiedActivity[] = [
      makeActivity({
        id: 'gz-1',
        startDateLocal: '2026-11-05T17:00:00',
        name: 'Zwift Sweet Spot Group Ride',
        trainingLoad: 110,
        zoneSecs: { hr: [200, 500, 1800, 1100, 0, 0, 0], power: [200, 500, 1800, 1100, 0, 0, 0] },
      }),
      makeActivity({
        id: 'gz-2',
        startDateLocal: '2026-11-07T17:00:00',
        name: 'Tempo Hammerfest',
        trainingLoad: 115,
        zoneSecs: { hr: [200, 400, 1900, 1100, 0, 0, 0], power: [200, 400, 1900, 1100, 0, 0, 0] },
      }),
      makeActivity({
        id: 'gz-3',
        startDateLocal: '2026-11-09T09:00:00',
        name: 'Threshold Climb',
        trainingLoad: 120,
        zoneSecs: { hr: [300, 500, 1600, 1200, 0, 0, 0], power: [300, 500, 1600, 1200, 0, 0, 0] },
      }),
    ];

    const wellness = [
      makeWellness({ date: '2026-11-10', ctl: 50, atl: 56, tsb: -6, hrvRMSSD: 64, hrvBaseline7d: 65 }),
    ];

    const summary = evaluateRollingTrainingProductivity({
      activities: greyZoneWeek,
      wellnessDays: wellness,
      athleteProfile: calibratedProfile,
      asOfDateIso: '2026-11-10',
    });

    expect(summary.verdict).toBe('POLARIZATION_DEFICIT');
    expect(summary.buckets[1].sharePct).toBeGreaterThan(36);
    expect(summary.buckets[0].status).toBe('SHORTFALL');
    expect(['LOW_AEROBIC', 'NEUROMUSCULAR']).toContain(
      summary.gapPrescription.primaryDeficit
    );
  });

  it('computes Post-Workout Session Impact Receipt with Before -> After 7-day needle shift and 5-zone HR distribution', () => {
    const activities: UnifiedActivity[] = [
      makeActivity({
        id: 'd-1',
        startDateLocal: '2026-11-05T07:00:00',
        trainingLoad: 130,
        efficiencyFactor: 1.70,
        zoneSecs: { hr: [600, 4200, 600, 0, 0, 0, 0], power: [600, 4200, 600, 0, 0, 0, 0] },
      }),
      makeActivity({
        id: 'd-2',
        startDateLocal: '2026-11-07T07:00:00',
        trainingLoad: 125,
        efficiencyFactor: 1.71,
        zoneSecs: { hr: [500, 3600, 900, 400, 0, 0, 0], power: [500, 3600, 900, 400, 0, 0, 0] },
      }),
      // Today's workout closes Neuromuscular deficit and brings 7d load into optimal tunnel!
      makeActivity({
        id: 'today-1',
        startDateLocal: '2026-11-10T16:30:00',
        name: 'Evening VO2 & Sprint Openers',
        trainingLoad: 92,
        normalizedPower: 274,
        intensityFactor: 0.90,
        efficiencyFactor: 1.79,
        aerobicDecouplingPct: 2.1,
        zoneSecs: {
          hr: [400, 1500, 700, 600, 400, 0, 0],
          power: [450, 1450, 600, 500, 320, 180, 100],
        },
      }),
    ];

    const wellness = [
      makeWellness({ date: '2026-11-10', ctl: 50, atl: 55, tsb: -5 }),
    ];

    const receipt = evaluateSessionImpactReceipt({
      activities,
      wellnessDays: wellness,
      athleteProfile: calibratedProfile,
      todayIso: '2026-11-10',
    });

    expect(receipt).not.toBeNull();
    expect(receipt!.isTodaySession).toBe(true);
    expect(receipt!.totalLoad).toBe(92);
    expect(receipt!.acuteLoadAfter).toBe(receipt!.acuteLoadBefore + 92);
    expect(receipt!.addedNeuromuscularPts).toBeGreaterThan(20);
    expect(receipt!.efDeltaPct).toBeGreaterThan(3);
    expect(receipt!.hrZones5).toHaveLength(5);
    expect(receipt!.powerZones7).toHaveLength(7);
    expect(receipt!.recoveryHours).toBeGreaterThanOrEqual(16);
  });
});
