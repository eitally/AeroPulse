import { describe, expect, it } from 'vitest';
import {
  buildEmpiricalMmpSummary,
  computeCyclingTss,
  computeDualSportPmcSeries,
  computeGradeAdjustedPaceStream,
  computeHistoricalActivityLoad,
  computeMinettiCostMultiplier,
  computeNormalizedPower,
  computeRunningTss,
  computeSlidingWindowPeaks,
  estimateVdotFromRace,
  evaluateOrthopedicInterference,
  fitCriticalPowerModel,
  generatePostWorkoutDebrief,
  resolveThresholdsAtDate,
} from '../src/physiology';
import type {
  ActivityStreamSet,
  AthleteProfile,
  PlannedWorkoutEvent,
  UnifiedActivity,
} from '../src/types';

function makeTestActivity(overrides: Partial<UnifiedActivity> & Pick<UnifiedActivity, 'id' | 'name' | 'sportCategory' | 'startDateLocal'>): UnifiedActivity {
  return {
    environment: 'OUTDOOR',
    subType: 'Road',
    movingTimeSecs: 3600,
    distanceMeters: 10000,
    elevationGainMeters: 100,
    trainingLoad: 60,
    avgHr: 150,
    maxHr: 175,
    aerobicDecouplingPct: 2.5,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.52,
    secondHalfEf: 1.48,
    zoneSecs: { hr: [600, 1800, 600, 600, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
    ...overrides,
  };
}

function makeBaseProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    athleteId: 'test-ath',
    name: 'Test Athlete',
    weightKg: 70,
    restingHr: 48,
    vo2MaxCycling: 62,
    vo2MaxRunning: 60,
    ftp: 300,
    indoorFtp: 290,
    eFtp: 300,
    wPrime: 20000,
    pMax: 1050,
    lthr: 172,
    maxHr: 192,
    sweetSpotMinPct: 88,
    sweetSpotMaxPct: 94,
    runFtp: 310,
    runEFtp: 310,
    runLthr: 176,
    runMaxHr: 194,
    thresholdPaceSecsPerKm: 240, // 4:00/km
    powerZones: [],
    hrZones: [],
    runHrZones: [],
    lastSyncedAt: '2026-11-10T00:00:00Z',
    source: 'CUSTOM_OVERRIDE',
    ...overrides,
  };
}

describe('@thresh/physiology — Power, GAP, VDOT, MMP, PMC, Orthopedic & Debrief Engines', () => {
  it('computes Coggan Normalized Power (NP) and TSS accurately', () => {
    const steady300 = Array.from({ length: 3600 }, () => 300);
    expect(computeNormalizedPower(steady300)).toBe(300);
    expect(computeCyclingTss(3600, 300, 300)).toBe(100);

    // Variable intervals (alternating 200W and 400W every 60s) must yield NP > average 300W
    const variable = Array.from({ length: 1200 }, (_, i) =>
      Math.floor(i / 60) % 2 === 0 ? 200 : 400
    );
    const np = computeNormalizedPower(variable)!;
    expect(np).toBeGreaterThan(315);
    expect(np).toBeLessThan(355);
  });

  it('computes Minetti Grade-Adjusted Pace (GAP) and VDOT accurately', () => {
    expect(computeMinettiCostMultiplier(0)).toBeCloseTo(1.0, 3);
    expect(computeMinettiCostMultiplier(0.08)).toBeGreaterThan(1.45); // +8% climb costs >45% more energy
    expect(computeMinettiCostMultiplier(-0.05)).toBeLessThan(0.9); // gentle -5% descent reduces cost

    // 4.0 m/s (4:10/km) up an +8% climb should yield faster equivalent flat GAP (< 3:00/km)
    const n = 300;
    const vel = Array.from({ length: n }, () => 4.0);
    const dist = Array.from({ length: n }, (_, i) => i * 4.0);
    const alt = Array.from({ length: n }, (_, i) => i * 4.0 * 0.08);
    const gap = computeGradeAdjustedPaceStream(vel, alt, dist);
    expect(gap.avgGapSecsPerKm).not.toBeNull();
    expect(gap.avgGapSecsPerKm!).toBeLessThan(180);

    expect(computeRunningTss(3600, 240, 240)).toBe(100);
    // 5000m in 18:00 (1080s) is ~56.3 VDOT
    const vdot = estimateVdotFromRace(5000, 1080);
    expect(vdot).toBeGreaterThan(54);
    expect(vdot).toBeLessThan(59);
  });

  it('computes sliding-window 1Hz MMP peaks and fits 3-parameter CP / W-prime model', () => {
    // Construct synthetic 25-minute test stream from known CP=280W, W'=18000J
    const stream = Array.from({ length: 1500 }, (_, i) => {
      if (i < 180) return 380; // 3m @ 380W (280 + 18000/180)
      if (i < 600) return 220;
      return 300;
    });
    const peaks = computeSlidingWindowPeaks(stream, [5, 60, 180, 1200]);
    expect(peaks.find((p) => p.durationSecs === 180)?.bestValue).toBeCloseTo(380, 0);

    const cpFit = fitCriticalPowerModel([
      { durationSecs: 180, watts: 380 },
      { durationSecs: 720, watts: 305 },
      { durationSecs: 1200, watts: 295 },
    ]);
    expect(cpFit).not.toBeNull();
    expect(cpFit!.cpWatts).toBeCloseTo(280, -1);
    expect(cpFit!.wPrimeJoules).toBeGreaterThan(16500);
    expect(cpFit!.wPrimeJoules).toBeLessThan(19500);

    const act = makeTestActivity({
      id: 'ride-1',
      name: '20m CP Test',
      sportCategory: 'Cycling',
      startDateLocal: '2026-11-08T08:00:00',
      movingTimeSecs: 1500,
      distanceMeters: 16000,
      elevationGainMeters: 150,
      trainingLoad: 52,
    });
    const streamMap = new Map<string, ActivityStreamSet>([
      ['ride-1', { time: stream.map((_, i) => i), watts: stream }],
    ]);
    const summary = buildEmpiricalMmpSummary([act], streamMap, makeBaseProfile());
    expect(summary.scannedPowerStreamsCount).toBe(1);
    expect(summary.points.find((p) => p.durationSecs === 180)?.bestWatts).toBe(380);
    expect(summary.points.find((p) => p.durationSecs === 180)?.sourceActivityId).toBe('ride-1');
  });

  it('preserves historical TSS via effective-dated threshold history & separates Cycling/Running CTL', () => {
    const profile = makeBaseProfile({
      ftp: 320, // Current November FTP
      thresholdHistory: [
        {
          id: 'th-may',
          effectiveDate: '2026-05-01',
          ftp: 250,
          indoorFtp: 245,
          lthr: 170,
          thresholdPaceSecsPerKm: 260,
        },
        {
          id: 'th-nov',
          effectiveDate: '2026-11-01',
          ftp: 320,
          indoorFtp: 310,
          lthr: 173,
          thresholdPaceSecsPerKm: 235,
        },
      ],
    });

    expect(resolveThresholdsAtDate(profile, '2026-06-15').ftp).toBe(250);
    expect(resolveThresholdsAtDate(profile, '2026-11-05').ftp).toBe(320);

    const mayRide = makeTestActivity({
      id: 'may-ride',
      name: 'May 1hr @ 250W',
      sportCategory: 'Cycling',
      startDateLocal: '2026-06-15T07:00:00',
      movingTimeSecs: 3600,
      distanceMeters: 36000,
      elevationGainMeters: 200,
      normalizedPower: 250,
      trainingLoad: 60,
    });
    // 1 hour at 250W when FTP was 250W MUST be 100 TSS (not ~61 TSS from 320W!)
    expect(computeHistoricalActivityLoad(mayRide, profile)).toBe(100);

    const novRun = makeTestActivity({
      id: 'nov-run',
      name: 'Nov 10K Threshold Run',
      sportCategory: 'Running',
      startDateLocal: '2026-11-09T07:00:00',
      movingTimeSecs: 2350,
      distanceMeters: 10000,
      elevationGainMeters: 20,
      trainingLoad: 65,
    });

    const pmc = computeDualSportPmcSeries([mayRide, novRun], profile, 30);
    const latest = pmc[pmc.length - 1];
    expect(latest.runningCtl).toBeGreaterThan(0);
    expect(latest.systemicCtl).toBeGreaterThanOrEqual(latest.runningCtl);
  });

  it('triggers 3-Channel Orthopedic Guardrail when acute running impact spikes', () => {
    const profile = makeBaseProfile();
    // 5 heavy fast runs in the last 5 days with zero prior running baseline
    const acuteRuns: UnifiedActivity[] = [0, 1, 2, 3, 4].map((offset) =>
      makeTestActivity({
        id: `run-${offset}`,
        name: 'Hard Tempo Run',
        sportCategory: 'Running',
        startDateLocal: `2026-11-0${5 + offset}T07:00:00`,
        movingTimeSecs: 3200,
        distanceMeters: 13500,
        elevationGainMeters: 180,
        trainingLoad: 85,
      })
    );

    const plannedToday: PlannedWorkoutEvent = {
      id: 'plan-1',
      date: '2026-11-10',
      name: 'Scheduled Track Intervals',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      plannedDurationSecs: 3000,
      plannedLoad: 72,
      description: 'Track threshold session',
      targetZoneSummary: 'Z4 Threshold',
      workoutSyntax: '5x1km @ Z4',
    };

    const ortho = evaluateOrthopedicInterference(
      acuteRuns,
      profile,
      [plannedToday],
      '2026-11-10'
    );

    expect(ortho.impactAcwr).toBeGreaterThan(1.32);
    expect(ortho.riskTier).toBe('HIGH_IMPACT_GUARDRAIL');
    expect(ortho.canMorphTodayRunToBike).toBe(true);
    expect(ortho.suggestedBikeWorkoutSyntax).toContain('Main Set');
  });

  it('generates deterministic 30-second 1Hz Post-Workout Debrief with clickable zoom windows', () => {
    const profile = makeBaseProfile({ ftp: 300, wPrime: 18000, lthr: 170 });
    const n = 1200; // 20 mins
    const time = Array.from({ length: n }, (_, i) => i);
    // Surge at t=400..520 (420W -> burns 14.4kJ of 18kJ W'!) + HR rising in second half + recovery drop at t=520..580
    const watts = time.map((t) => (t >= 400 && t <= 520 ? 420 : 210));
    const heartrate = time.map((t) => {
      if (t >= 400 && t <= 520) return 182;
      if (t > 520 && t <= 590) return Math.round(182 - ((t - 520) / 70) * 32); // 32 bpm HRR60 drop!
      return t > 650 ? 158 : 142; // cardiac drift in second half
    });

    const act = makeTestActivity({
      id: 'debrief-ride',
      name: 'VO2 Surge Session',
      sportCategory: 'Cycling',
      startDateLocal: '2026-11-10T07:30:00',
      movingTimeSecs: n,
      distanceMeters: 12000,
      elevationGainMeters: 120,
      trainingLoad: 48,
    });

    const debrief = generatePostWorkoutDebrief(act, { time, watts, heartrate }, profile);
    expect(debrief).not.toBeNull();
    expect(debrief!.insights).toHaveLength(3);
    expect(debrief!.wPrimeMinPct).toBeLessThan(30);
    expect(debrief!.bestHrr60Bpm).toBeGreaterThanOrEqual(25);
    for (const ins of debrief!.insights) {
      expect(ins.windowEndSec).toBeGreaterThan(ins.windowStartSec);
    }
  });
});
