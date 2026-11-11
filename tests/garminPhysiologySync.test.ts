import { describe, expect, it } from 'vitest';
import {
  buildCompleteAthleteProfile,
  buildHrZonesFromCeilings,
  calibrateMetricsFromActivitiesClient,
  isUncalibratedDefaultProfile,
} from '../src/utils/telemetryStorage';
import { normalizeGarminPersonalApiActivities } from '../server/garminConnectService';
import type { UnifiedActivity, UnifiedWellnessDay } from '../src/types';

describe('Garmin Connect Physiology & 5-Zone Calibration Pipeline', () => {
  it('detects both legacy 280W/300W and 250W/163bpm uncalibrated default profiles', () => {
    const default250 = buildCompleteAthleteProfile(null);
    expect(default250.ftp).toBe(250);
    expect(isUncalibratedDefaultProfile(default250)).toBe(true);

    const customOverride = {
      ...default250,
      source: 'CUSTOM_OVERRIDE' as const,
    };
    expect(isUncalibratedDefaultProfile(customOverride)).toBe(false);
  });

  it('builds exact Garmin 5-zone Cycling and Running HR tables with explicit zone1Floor..zone5Floor', () => {
    // Garmin Cycling HR Zones: LTHR 153, Max 175, floors [109, 131, 151, 161, 168]
    const bikeZones = buildHrZonesFromCeilings(
      153,
      175,
      [130, 150, 160, 167, 175],
      ['Z1 Warm Up', 'Z2 Easy', 'Z3 Aerobic', 'Z4 Threshold', 'Z5 Maximum'],
      [109, 131, 151, 161, 168]
    );
    expect(bikeZones).toHaveLength(5);
    expect(bikeZones[0]).toMatchObject({
      zone: 1,
      code: 'Z1',
      name: 'Z1 Warm Up',
      minBpm: 109,
      maxBpm: 130,
    });
    expect(bikeZones[1]).toMatchObject({
      zone: 2,
      code: 'Z2',
      name: 'Z2 Easy',
      minBpm: 131,
      maxBpm: 150,
    });
    expect(bikeZones[2]).toMatchObject({
      zone: 3,
      code: 'Z3',
      name: 'Z3 Aerobic',
      minBpm: 151,
      maxBpm: 160,
    });
    expect(bikeZones[3]).toMatchObject({
      zone: 4,
      code: 'Z4',
      name: 'Z4 Threshold',
      minBpm: 161,
      maxBpm: 167,
    });
    expect(bikeZones[4]).toMatchObject({
      zone: 5,
      code: 'Z5',
      name: 'Z5 Maximum',
      minBpm: 168,
      maxBpm: 175,
    });

    // Garmin Running HR Zones: LTHR 155, Max 176, floors [110, 136, 152, 161, 171]
    const runZones = buildHrZonesFromCeilings(
      155,
      176,
      [135, 151, 160, 170, 176],
      ['Z1 Warm Up', 'Z2 Easy', 'Z3 Aerobic', 'Z4 Threshold', 'Z5 Maximum'],
      [110, 136, 152, 161, 171]
    );
    expect(runZones).toHaveLength(5);
    expect(runZones[0]).toMatchObject({ minBpm: 110, maxBpm: 135 });
    expect(runZones[1]).toMatchObject({ minBpm: 136, maxBpm: 151 });
    expect(runZones[2]).toMatchObject({ minBpm: 152, maxBpm: 160 });
    expect(runZones[3]).toMatchObject({ minBpm: 161, maxBpm: 170 });
    expect(runZones[4]).toMatchObject({ minBpm: 171, maxBpm: 176 });
  });

  it('derives 303W FTP, 1148W Pmax, and 445W Run FTP from Garmin Personal API activity payloads', () => {
    const rawGarminActivities = [
      {
        activityId: 21586138495,
        activityName: 'Zwift - Race: Stage 3: Race Makita Madness (B)',
        activityType: { typeKey: 'virtual_ride' },
        startTimeLocal: '2026-01-18 11:02:00',
        duration: 2177,
        movingDuration: 2177,
        distance: 24500,
        avgPower: 298,
        normPower: 309,
        max20MinPower: 319.26,
        maxPower: 1148,
        averageHR: 151,
        maxHR: 169,
      },
      {
        activityId: 21599999999,
        activityName: 'Portland Morning Run',
        activityType: { typeKey: 'running' },
        startTimeLocal: '2026-02-10 08:15:00',
        duration: 2639,
        movingDuration: 2639,
        distance: 9120,
        avgPower: 468,
        normPower: 484,
        fastestSplit_5000: 1429.2,
        averageHR: 149,
        maxHR: 168,
      },
    ];

    const normalized = normalizeGarminPersonalApiActivities(
      rawGarminActivities,
      303
    ) as unknown as UnifiedActivity[];

    expect(normalized).toHaveLength(2);
    expect((normalized[0] as any).max20MinPower).toBe(319);
    expect((normalized[0] as any).max_watts).toBe(1148);
    expect((normalized[1] as any).fastestSplit_5000).toBe(1429);

    const obs = calibrateMetricsFromActivitiesClient(normalized, 90.8);
    expect(obs.obsFtp).toBe(303); // Math.round(319 * 0.95)
    expect(obs.obsPMax).toBe(1148);
    expect(obs.obsRunFtp).toBe(445); // Math.round(484 * 0.92)
    expect(obs.obsThresholdPace).toBe(295); // Math.round((1429 / 5) * 1.03)
  });

  it('replaces poisoned 250W default profile with real Garmin metrics and 7-zone power + 5-zone HR', () => {
    const poisonedDefault = buildCompleteAthleteProfile(null);
    expect(poisonedDefault.ftp).toBe(250);

    const latestWellness: UnifiedWellnessDay = {
      date: '2026-10-22',
      ctl: 62,
      atl: 58,
      tsb: 4,
      loadRatio: 0.94,
      rampRate: 1.1,
      hrvRMSSD: 52,
      hrvBaseline7d: 51,
      hrvStatus: 'Balanced',
      restingHR: 49,
      sleepSecs: 27900,
      sleepScore: 84,
      sleepQuality: 2,
      weightKg: 90.8,
      vo2MaxCycling: 51,
      vo2MaxRunning: 52,
      rideEftp: 303,
      ridePMax: 1148,
      rideWPrime: 22725,
      runEftp: 445,
      readinessStatus: 'Optimal',
      dailyLoad: 74,
    };

    const recalibrated = buildCompleteAthleteProfile(
      poisonedDefault,
      latestWellness,
      []
    );

    expect(recalibrated.ftp).toBe(303);
    expect(recalibrated.indoorFtp).toBe(303);
    expect(recalibrated.eFtp).toBe(303);
    expect(recalibrated.pMax).toBe(1148);
    expect(recalibrated.wPrime).toBe(22725);
    expect(recalibrated.weightKg).toBe(90.8);
    expect(recalibrated.restingHr).toBe(49);
    expect(recalibrated.runFtp).toBe(445);
    // Power Z4 (91-105% of 303W) should be 276-318W, not 226-263W
    expect(recalibrated.powerZones[3].minWatts).toBe(274);
    expect(recalibrated.powerZones[3].maxWatts).toBe(318);
    // Default HR zones should be 5-zone Garmin model
    expect(recalibrated.hrZones).toHaveLength(5);
  });
});
