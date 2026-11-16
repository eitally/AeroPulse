import { describe, expect, it } from 'vitest';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  STRAVA_LOAD_MODEL_VERSION,
  deriveObservedPhysiologyMetrics,
} from '../src/physiology/stravaLoadCalibration';
import { normalizeRawStravaActivity } from '../server/stravaSyncService';
import { buildServerAthleteProfile } from '../server/physiologyEngine';
import {
  buildCompleteAthleteProfile,
  computeWellnessDaysFromActivities,
  mergeActivitiesNonDestructive,
  overlayBiometricsOntoActivityWellness,
  recalibrateStravaActivityLoadClient,
  sanitizeStaleCollapsedProfile,
} from '../src/utils/telemetryStorage';
import { computeDualSportPmcSeries } from '../src/physiology/pmc';
import { evaluateRollingTrainingProductivity } from '../src/physiology/trainingProductivityEngine';
import type { UnifiedActivity, UnifiedWellnessDay } from '../src/types';

describe('Strava Physiological Load v2, Threshold Guard & Banister PMC Accuracy', () => {
  it('keeps thresholds intact and ATL low (< 15) across a light 2-week schedule with inflated Strava suffer_score & estimated watts', () => {
    const rawStravaActivities = [
      {
        id: 1001,
        name: 'Evening Walk to Bike Shop',
        sport_type: 'Walk',
        type: 'Walk',
        start_date_local: '2026-11-03T17:30:00Z',
        moving_time: 2700, // 45m
        elapsed_time: 2800,
        distance: 3600,
        average_heartrate: 102,
        max_heartrate: 118,
        suffer_score: 140,
      },
      {
        id: 1002,
        name: 'Casual Cruiser Spin',
        sport_type: 'Ride',
        type: 'Ride',
        start_date_local: '2026-11-06T10:00:00Z',
        moving_time: 2400, // 40m
        elapsed_time: 2500,
        distance: 14500,
        average_watts: 115, // Strava estimated speed/weight watts
        weighted_average_watts: 118,
        device_watts: false,
        average_heartrate: 120,
        max_heartrate: 138,
        suffer_score: 185,
      },
      {
        id: 1003,
        name: 'Easy Neighborhood Jog',
        sport_type: 'Run',
        type: 'Run',
        start_date_local: '2026-11-10T08:00:00Z',
        moving_time: 2100, // 35m @ ~10:00/mi
        elapsed_time: 2160,
        distance: 5630,
        average_heartrate: 128,
        max_heartrate: 141,
        suffer_score: 160,
      },
      {
        id: 1004,
        name: 'Sunday Trail Hike (No HR)',
        sport_type: 'Hike',
        type: 'Hike',
        start_date_local: '2026-11-14T11:00:00Z',
        moving_time: 3600, // 60m
        elapsed_time: 5400,
        distance: 4500,
        suffer_score: 135,
      },
    ];

    // 1. Threshold auto-calibration MUST NOT collapse to 109W FTP, 10:18/mi LT2, or 120 bpm LTHR
    const observed = deriveObservedPhysiologyMetrics(rawStravaActivities, 75);
    expect(observed.obsFtp).toBe(0);
    expect(observed.obsThresholdPace).toBe(0);
    expect(observed.obsBikeLthr).toBe(0);
    expect(observed.obsRunLthr).toBe(0);

    const serverProfile = buildServerAthleteProfile(
      { id: '999', name: 'Elliot Tally', weightKg: 75, source: 'STRAVA_OAUTH' },
      null,
      rawStravaActivities
    );
    expect(serverProfile.ftp).toBe(250);
    expect(serverProfile.lthr).toBe(163);
    expect(serverProfile.thresholdPaceSecsPerKm).toBe(255);

    const calibration = {
      calibratedFtp: serverProfile.ftp,
      calibratedBikeLthr: serverProfile.lthr,
      calibratedRunLthr: serverProfile.runLthr,
      calibratedThresholdPaceSecsPerKm: serverProfile.thresholdPaceSecsPerKm,
      restingHr: serverProfile.restingHr,
    };

    const normalized = rawStravaActivities.map((raw, idx) => ({
      id: `strava-${raw.id}`,
      ...normalizeRawStravaActivity(raw, calibration, { idx }),
      aerobicDecouplingPct: 0,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      sourceBadges: ['Strava'] as ('Strava')[],
    })) as UnifiedActivity[];

    // Walk named "Bike Shop" stays Strength (not misclassified as Cycling)
    expect(normalized[0].sportCategory).toBe('Strength');
    // Estimated watts ride has un-metered power cleared and reasonable HR TSS (not suffer_score 185)
    expect(normalized[1].deviceWatts).toBe(false);
    expect(normalized[1].avgPower).toBeUndefined();
    expect(normalized[1].normalizedPower).toBeUndefined();

    for (const act of normalized) {
      expect(act.loadModelVersion).toBe(STRAVA_LOAD_MODEL_VERSION);
      expect(act.trainingLoad).toBeGreaterThanOrEqual(6);
      expect(act.trainingLoad).toBeLessThanOrEqual(35);
    }

    const wellnessDays = computeWellnessDaysFromActivities(normalized, '2026-11-16');
    const latestDay = wellnessDays[wellnessDays.length - 1];
    expect(latestDay.atl).toBeLessThan(15);
    expect(latestDay.garminTrainingStatus).not.toBe('Overreaching');

    const productivity = evaluateRollingTrainingProductivity({
      activities: normalized,
      wellnessDays,
      athleteProfile: serverProfile as any,
      asOfDateIso: '2026-11-16',
    });
    expect(productivity.verdict).not.toBe('OVERREACHING');
    expect(productivity.atl).toBeLessThan(15);
  });

  it('keeps E-Bike loads low & excluded from Cycling threshold calibration, while scoring metered FTP rides & threshold runs accurately', () => {
    const rawEBike = {
      id: 2001,
      name: 'Morning E-Bike Commute',
      sport_type: 'EBikeRide',
      type: 'EBikeRide',
      start_date_local: '2026-11-12T08:30:00Z',
      moving_time: 3600,
      elapsed_time: 3600,
      distance: 28000,
      average_watts: 290,
      weighted_average_watts: 310,
      device_watts: true,
      average_heartrate: 106,
      max_heartrate: 122,
      suffer_score: 210,
    };

    const rawMeteredRide = {
      id: 2002,
      name: 'Zwift 60m Threshold Block',
      sport_type: 'VirtualRide',
      type: 'VirtualRide',
      start_date_local: '2026-11-14T17:00:00Z',
      moving_time: 3600,
      elapsed_time: 3600,
      distance: 40000,
      average_watts: 270,
      weighted_average_watts: 280,
      device_watts: true,
      average_heartrate: 162,
      max_heartrate: 180,
      suffer_score: 240,
    };

    const rawHardRun = {
      id: 2003,
      name: 'Track 5K Time Trial',
      sport_type: 'Run',
      type: 'Run',
      start_date_local: '2026-11-15T08:00:00Z',
      moving_time: 1250, // 20m50s (250 s/km = 4:10/km)
      elapsed_time: 1250,
      distance: 5000,
      average_heartrate: 168,
      max_heartrate: 184,
      suffer_score: 190,
    };

    // Only E-Bike -> never sets Cycling FTP
    expect(deriveObservedPhysiologyMetrics([rawEBike], 75).obsFtp).toBe(0);

    // Real metered ride + hard 5K run calibrate real thresholds accurately
    const obs = deriveObservedPhysiologyMetrics([rawEBike, rawMeteredRide, rawHardRun], 75);
    expect(obs.obsFtp).toBe(Math.round(280 * 0.95)); // 266W, not E-Bike 310W
    expect(obs.obsBikeLthr).toBeGreaterThanOrEqual(155);
    expect(obs.obsThresholdPace).toBe(Math.round(250 * 1.03)); // 258 s/km

    const calibration = {
      calibratedFtp: 280,
      calibratedBikeLthr: 163,
      calibratedRunLthr: 168,
      calibratedThresholdPaceSecsPerKm: 255,
      restingHr: 52,
    };

    const ebikeNorm = normalizeRawStravaActivity(rawEBike, calibration);
    expect(ebikeNorm.deviceWatts).toBe(false);
    expect(ebikeNorm.avgPower).toBeUndefined();
    expect(ebikeNorm.trainingLoad).toBeLessThanOrEqual(30);

    const meteredRideNorm = normalizeRawStravaActivity(rawMeteredRide, calibration);
    expect(meteredRideNorm.deviceWatts).toBe(true);
    expect(meteredRideNorm.avgPower).toBe(270);
    expect(meteredRideNorm.trainingLoad).toBe(100); // 1h at 280W == 280W FTP -> 100 TSS

    const hardRunNorm = normalizeRawStravaActivity(rawHardRun, calibration);
    expect(hardRunNorm.trainingLoad).toBeGreaterThanOrEqual(30);
    expect(hardRunNorm.trainingLoad).toBeLessThanOrEqual(45);
  });

  it('self-heals legacy v1 cached Strava loads, respects Intervals loads, and overlays Garmin biometrics without overwriting fresh PMC load', () => {
    const legacyPollutedRide: UnifiedActivity = {
      id: 'strava-555',
      stravaId: '555',
      startDateLocal: '2026-11-12T12:00:00',
      name: 'Easy Recovery Cruise',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 2400, // 40m
      distanceMeters: 15000,
      elevationGainMeters: 80,
      avgPower: 118, // un-metered v1 outdoor estimate (identical NP == AvgP)
      normalizedPower: 118,
      trainingLoad: 195, // inflated legacy suffer_score cached in IDB!
      avgHr: 115,
      maxHr: 132,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.03,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    };

    const sanitizedProfile = sanitizeStaleCollapsedProfile({
      ftp: 109,
      lthr: 120,
      runLthr: 124,
      thresholdPaceSecsPerKm: 520,
    });
    expect(sanitizedProfile?.ftp).toBeUndefined();
    expect(sanitizedProfile?.lthr).toBeUndefined();
    expect(sanitizedProfile?.thresholdPaceSecsPerKm).toBeUndefined();

    const healed = recalibrateStravaActivityLoadClient(legacyPollutedRide, sanitizedProfile);
    expect(healed.loadModelVersion).toBe(STRAVA_LOAD_MODEL_VERSION);
    expect(healed.deviceWatts).toBe(false);
    expect(healed.avgPower).toBeUndefined();
    expect(healed.trainingLoad).toBeLessThan(30);

    // Incoming v2 Strava re-sync overwrites legacy cached trainingLoad even when prev.trainingLoad > 0
    const mergedStrava = mergeActivitiesNonDestructive(
      [legacyPollutedRide],
      [
        {
          ...legacyPollutedRide,
          avgPower: undefined,
          normalizedPower: undefined,
          deviceWatts: false,
          trainingLoad: 18,
          loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
        },
      ]
    );
    expect(mergedStrava[0].trainingLoad).toBe(18);
    expect(mergedStrava[0].avgPower).toBeUndefined();

    // Authoritative Intervals.icu load stays intact when merged with Strava
    const intervalsRide: UnifiedActivity = {
      ...legacyPollutedRide,
      id: 'i-777',
      intervalsId: 'i-777',
      trainingLoad: 74,
      sourceBadges: ['Intervals.icu'],
    };
    const mergedIntervals = mergeActivitiesNonDestructive(
      [intervalsRide],
      [
        {
          ...legacyPollutedRide,
          id: 'strava-555',
          stravaId: '555',
          trainingLoad: 22,
          loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
        },
      ]
    );
    expect(mergedIntervals[0].trainingLoad).toBe(74);

    // overlayBiometricsOntoActivityWellness preserves HRV/Sleep/RHR while taking fresh CTL/ATL/TSB & dropping future dates
    const freshWellness = computeWellnessDaysFromActivities([healed], '2026-11-16');
    const cachedWithBiometrics: UnifiedWellnessDay[] = [
      {
        date: '2026-11-12',
        ctl: 72.5, // stale inflated values!
        atl: 118.4,
        tsb: -45.9,
        rampRate: 12.1,
        hrvRMSSD: 64,
        hrvBaseline7d: 61,
        restingHR: 48,
        sleepSecs: 28800,
        sleepScore: 86,
        weightKg: 74.2,
        readinessStatus: 'Strain',
        dailyLoad: 195,
      },
      {
        date: '2026-11-17', // future UTC date should be discarded
        ctl: 71.0,
        atl: 105.0,
        tsb: -34.0,
        rampRate: 9.0,
        hrvRMSSD: 55,
        hrvBaseline7d: 60,
        restingHR: 50,
        sleepSecs: 25200,
        sleepScore: 78,
        weightKg: 74.2,
        readinessStatus: 'Strain',
        dailyLoad: 0,
      },
    ];

    const overlaid = overlayBiometricsOntoActivityWellness(
      freshWellness,
      cachedWithBiometrics,
      '2026-11-16'
    );
    const nov12 = overlaid.find((w) => w.date === '2026-11-12')!;
    expect(nov12.dailyLoad).toBe(healed.trainingLoad);
    expect(nov12.atl).toBeLessThan(10);
    expect(nov12.hrvRMSSD).toBe(64);
    expect(nov12.restingHR).toBe(48);
    expect(nov12.sleepScore).toBe(86);
    expect(nov12.weightKg).toBe(74.2);
    expect(overlaid.some((w) => w.date === '2026-11-17')).toBe(false);
  });

  it('produces unique sequential dates across Fall-Back DST and consistent Banister EWMA decay across engines', () => {
    const act: UnifiedActivity = {
      id: 'strava-dst-1',
      stravaId: 'dst-1',
      startDateLocal: '2026-10-30T09:00:00',
      name: 'Tempo Ride',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3600,
      distanceMeters: 32000,
      elevationGainMeters: 200,
      deviceWatts: true,
      avgPower: 250,
      normalizedPower: 250,
      trainingLoad: 100,
      loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
      avgHr: 158,
      maxHr: 175,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.58,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    };

    const days = computeWellnessDaysFromActivities([act], '2026-11-04');
    const dstWindow = days.filter((d) => d.date >= '2026-10-29' && d.date <= '2026-11-04');
    expect(dstWindow.map((d) => d.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);

    const oct30 = dstWindow.find((d) => d.date === '2026-10-30')!;
    const expectedCtl = 100 * (1 - BANISTER_CTL_DECAY);
    const expectedAtl = 100 * (1 - BANISTER_ATL_DECAY);
    expect(oct30.ctl).toBeCloseTo(expectedCtl, 1);
    expect(oct30.atl).toBeCloseTo(expectedAtl, 1);

    const prof = buildCompleteAthleteProfile(null);
    const dual = computeDualSportPmcSeries([act], prof, 0);
    const dualOct30 = dual.find((d) => d.date === '2026-10-30')!;
    expect(dualOct30.systemicCtl).toBe(oct30.ctl);
    expect(dualOct30.systemicAtl).toBe(oct30.atl);
    expect(dualOct30.systemicTsb).toBe(oct30.tsb);

    // 14 rest days following a single 100 TSS effort must decay ATL down below 2.0
    const decaySeries = computeWellnessDaysFromActivities(
      [{ ...act, startDateLocal: '2026-11-02T09:00:00' }],
      '2026-11-16'
    );
    const nov02 = decaySeries.find((d) => d.date === '2026-11-02')!;
    const nov16 = decaySeries.find((d) => d.date === '2026-11-16')!;
    expect(nov02.atl).toBeCloseTo(100 * (1 - BANISTER_ATL_DECAY), 1);
    expect(nov16.atl).toBeLessThan(2.0);
  });
});
