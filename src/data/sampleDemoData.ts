import type {
  ActivityStreamSet,
  AthleteProfile,
  PlannedWorkoutEvent,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import {
  buildHrZonesFromCeilings,
  buildPowerZonesFromCeilings,
} from '../utils/telemetryStorage';

function shiftDateIso(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays, 12, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function buildParkLoopRoute(
  centerLat: number,
  centerLng: number,
  radiusLat: number,
  radiusLng: number,
  points = 48
): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const harmonic = 1 + 0.08 * Math.sin(3 * theta);
    coords.push([
      Number((centerLat + Math.sin(theta) * radiusLat * harmonic).toFixed(5)),
      Number((centerLng + Math.cos(theta) * radiusLng * harmonic).toFixed(5)),
    ]);
  }
  return coords;
}

function buildSample1HzStream(opts: {
  durationSecs: number;
  sport: 'Running' | 'Cycling';
  baseWatts: number;
  intervalWatts: number;
  baseHr: number;
  intervalHr: number;
  baseSpeedMps: number;
  intervalSpeedMps: number;
  centerLat: number;
  centerLng: number;
}): ActivityStreamSet {
  const stepSecs = 5;
  const samples = Math.floor(opts.durationSecs / stepSecs);
  const time: number[] = [];
  const distance: number[] = [];
  const watts: number[] = [];
  const heartrate: number[] = [];
  const velocitySmooth: number[] = [];
  const cadence: number[] = [];
  const altitude: number[] = [];
  const latlng: [number, number][] = [];

  let distAcc = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i * stepSecs;
    const inWarmup = t < 600;
    const inCooldown = t > opts.durationSecs - 480;
    const cyclePos = (t - 600) % 420;
    const inRep = !inWarmup && !inCooldown && cyclePos >= 0 && cyclePos < 300;

    const w = inWarmup
      ? Math.round(opts.baseWatts * 0.85)
      : inCooldown
        ? Math.round(opts.baseWatts * 0.78)
        : inRep
          ? Math.round(opts.intervalWatts + 8 * Math.sin(i * 0.35))
          : Math.round(opts.baseWatts * 0.82);

    const hr = inWarmup
      ? Math.round(opts.baseHr - 12 + (t / 600) * 12)
      : inCooldown
        ? Math.round(opts.baseHr - 8)
        : inRep
          ? Math.round(opts.intervalHr + 3 * Math.sin(i * 0.2))
          : Math.round(opts.baseHr - 4);

    const spd = inWarmup
      ? Number((opts.baseSpeedMps * 0.9).toFixed(2))
      : inCooldown
        ? Number((opts.baseSpeedMps * 0.86).toFixed(2))
        : inRep
          ? Number((opts.intervalSpeedMps + 0.08 * Math.sin(i * 0.25)).toFixed(2))
          : Number((opts.baseSpeedMps * 0.88).toFixed(2));

    if (i > 0) {
      distAcc += spd * stepSecs;
    }

    const theta = (t / Math.max(1, opts.durationSecs)) * Math.PI * 4;
    time.push(t);
    distance.push(Math.round(distAcc));
    watts.push(w);
    heartrate.push(hr);
    velocitySmooth.push(spd);
    cadence.push(opts.sport === 'Running' ? (inRep ? 182 : 172) : inRep ? 94 : 86);
    altitude.push(Number((142 + 9 * Math.sin(theta)).toFixed(1)));
    latlng.push([
      Number((opts.centerLat + 0.009 * Math.sin(theta)).toFixed(5)),
      Number((opts.centerLng + 0.012 * Math.cos(theta)).toFixed(5)),
    ]);
  }

  return {
    time,
    distance,
    latlng,
    watts,
    heartrate,
    velocitySmooth,
    cadence,
    altitude,
  };
}

export interface SampleDemoDataset {
  athleteProfile: AthleteProfile;
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  targetGoals: TargetGoal[];
}

/**
 * Deterministic in-memory sample dataset for unauthenticated visitors exploring THRESH
 * before connecting Strava. Explicitly labeled as illustrative sample data and never
 * persisted to localStorage, IndexedDB, or server vaults.
 */
export function buildSampleDemoDataset(anchorDateIso?: string): SampleDemoDataset {
  const todayIso = anchorDateIso || getLocalDateIso();
  const ftp = 285;
  const indoorFtp = 278;
  const lthr = 171;
  const maxHr = 191;
  const runLthr = 175;
  const runMaxHr = 194;
  const thresholdPaceSecsPerKm = 228; // 3:48/km (~6:07/mi)

  const athleteProfile: AthleteProfile = {
    athleteId: 'sample-demo-athlete',
    name: 'Sample Athlete (Demo)',
    primarySport: 'Running',
    weightKg: 66.5,
    restingHr: 48,
    vo2MaxCycling: 61,
    vo2MaxRunning: 63,
    ftp,
    indoorFtp,
    eFtp: 288,
    wPrime: 21400,
    pMax: 1040,
    lthr,
    maxHr,
    sweetSpotMinPct: 84,
    sweetSpotMaxPct: 97,
    runFtp: 296,
    runEFtp: 298,
    runLthr,
    runMaxHr,
    thresholdPaceSecsPerKm,
    powerZones: buildPowerZonesFromCeilings(ftp, indoorFtp),
    hrZones: buildHrZonesFromCeilings(lthr, maxHr),
    runHrZones: buildHrZonesFromCeilings(runLthr, runMaxHr),
    lastSyncedAt: `${todayIso}T06:30:00.000Z`,
    source: 'CUSTOM_OVERRIDE',
  };

  const rawTemplates: Array<{
    offsetDays: number;
    idSuffix: string;
    name: string;
    sport: 'Running' | 'Cycling';
    subType: UnifiedActivity['subType'];
    environment: 'OUTDOOR' | 'INDOOR';
    movingTimeSecs: number;
    distanceMeters: number;
    elevationGainMeters: number;
    trainingLoad: number;
    avgHr: number;
    maxHr: number;
    avgPower?: number;
    normalizedPower?: number;
    avgPaceSecsPerKm?: number;
    gapPaceSecsPerKm?: number;
    decouplingPct: number;
    ef: number;
    zoneHr: number[];
    zonePowerOrPace: number[];
    withStreams?: boolean;
    official5k?: boolean;
  }> = [
    {
      offsetDays: -1,
      idSuffix: 'run-easy-50',
      name: 'Morning Aerobic Base Loop',
      sport: 'Running',
      subType: 'Road',
      environment: 'OUTDOOR',
      movingTimeSecs: 3060,
      distanceMeters: 10800,
      elevationGainMeters: 84,
      trainingLoad: 58,
      avgHr: 146,
      maxHr: 161,
      avgPower: 242,
      normalizedPower: 248,
      avgPaceSecsPerKm: 283,
      gapPaceSecsPerKm: 277,
      decouplingPct: 2.4,
      ef: 1.48,
      zoneHr: [420, 2160, 420, 60, 0, 0, 0],
      zonePowerOrPace: [360, 2220, 420, 60, 0, 0, 0],
      withStreams: true,
    },
    {
      offsetDays: -3,
      idSuffix: 'run-lt2-cruise',
      name: '5 x 1600m Cruise Threshold @ LT2',
      sport: 'Running',
      subType: 'Track',
      environment: 'OUTDOOR',
      movingTimeSecs: 3720,
      distanceMeters: 14600,
      elevationGainMeters: 18,
      trainingLoad: 92,
      avgHr: 166,
      maxHr: 182,
      avgPower: 284,
      normalizedPower: 295,
      avgPaceSecsPerKm: 255,
      gapPaceSecsPerKm: 254,
      decouplingPct: 2.9,
      ef: 1.54,
      zoneHr: [480, 960, 660, 1380, 240, 0, 0],
      zonePowerOrPace: [480, 900, 600, 1500, 240, 0, 0],
      withStreams: true,
    },
    {
      offsetDays: -4,
      idSuffix: 'ride-z2-spin',
      name: 'High-Cadence Cross-Modal Recovery Ride',
      sport: 'Cycling',
      subType: 'Road',
      environment: 'OUTDOOR',
      movingTimeSecs: 4200,
      distanceMeters: 36800,
      elevationGainMeters: 265,
      trainingLoad: 54,
      avgHr: 134,
      maxHr: 151,
      avgPower: 188,
      normalizedPower: 196,
      decouplingPct: 1.8,
      ef: 1.46,
      zoneHr: [900, 2940, 360, 0, 0, 0, 0],
      zonePowerOrPace: [780, 3000, 420, 0, 0, 0, 0],
    },
    {
      offsetDays: -6,
      idSuffix: 'run-long-progression',
      name: 'Sunday Progressive Endurance Long Run',
      sport: 'Running',
      subType: 'Road',
      environment: 'OUTDOOR',
      movingTimeSecs: 5400,
      distanceMeters: 20200,
      elevationGainMeters: 192,
      trainingLoad: 112,
      avgHr: 154,
      maxHr: 174,
      avgPower: 258,
      normalizedPower: 266,
      avgPaceSecsPerKm: 267,
      gapPaceSecsPerKm: 261,
      decouplingPct: 3.3,
      ef: 1.5,
      zoneHr: [540, 3120, 1320, 420, 0, 0, 0],
      zonePowerOrPace: [480, 3060, 1380, 480, 0, 0, 0],
    },
    {
      offsetDays: -8,
      idSuffix: 'ride-sst-blocks',
      name: '3 x 12m Sweet Spot Gravel Tempo',
      sport: 'Cycling',
      subType: 'Gravel',
      environment: 'OUTDOOR',
      movingTimeSecs: 4800,
      distanceMeters: 42400,
      elevationGainMeters: 410,
      trainingLoad: 88,
      avgHr: 156,
      maxHr: 173,
      avgPower: 228,
      normalizedPower: 244,
      decouplingPct: 2.7,
      ef: 1.56,
      zoneHr: [600, 1680, 1800, 720, 0, 0, 0],
      zonePowerOrPace: [540, 1620, 1860, 780, 0, 0, 0],
    },
    {
      offsetDays: -10,
      idSuffix: 'run-vo2-400s',
      name: '10 x 400m Track Economy + 200m Float',
      sport: 'Running',
      subType: 'Track',
      environment: 'OUTDOOR',
      movingTimeSecs: 3180,
      distanceMeters: 11800,
      elevationGainMeters: 12,
      trainingLoad: 84,
      avgHr: 163,
      maxHr: 188,
      avgPower: 278,
      normalizedPower: 298,
      avgPaceSecsPerKm: 269,
      gapPaceSecsPerKm: 269,
      decouplingPct: 3.1,
      ef: 1.52,
      zoneHr: [600, 1080, 420, 480, 480, 120, 0],
      zonePowerOrPace: [540, 1080, 360, 420, 540, 240, 0],
    },
    {
      offsetDays: -13,
      idSuffix: 'run-fat-5000m',
      name: ' Twilight Track 5000m Opener (Official FAT)',
      sport: 'Running',
      subType: 'Track',
      environment: 'OUTDOOR',
      movingTimeSecs: 1008,
      distanceMeters: 5000,
      elevationGainMeters: 0,
      trainingLoad: 76,
      avgHr: 181,
      maxHr: 192,
      avgPower: 322,
      normalizedPower: 326,
      avgPaceSecsPerKm: 202,
      gapPaceSecsPerKm: 202,
      decouplingPct: 1.9,
      ef: 1.64,
      zoneHr: [60, 60, 120, 300, 408, 60, 0],
      zonePowerOrPace: [0, 0, 60, 300, 528, 120, 0],
      official5k: true,
    },
    {
      offsetDays: -16,
      idSuffix: 'run-z2-9km',
      name: 'Pre-Meet Shakeout + 4 x 20s Strides',
      sport: 'Running',
      subType: 'Road',
      environment: 'OUTDOOR',
      movingTimeSecs: 2580,
      distanceMeters: 9100,
      elevationGainMeters: 62,
      trainingLoad: 49,
      avgHr: 144,
      maxHr: 168,
      avgPaceSecsPerKm: 284,
      gapPaceSecsPerKm: 279,
      decouplingPct: 2.1,
      ef: 1.49,
      zoneHr: [480, 1860, 180, 0, 60, 0, 0],
      zonePowerOrPace: [420, 1860, 180, 0, 60, 60, 0],
    },
    {
      offsetDays: -20,
      idSuffix: 'run-long-18km',
      name: 'Rolling Ridge Aerobic Long Run',
      sport: 'Running',
      subType: 'Trail',
      environment: 'OUTDOOR',
      movingTimeSecs: 4980,
      distanceMeters: 18400,
      elevationGainMeters: 248,
      trainingLoad: 104,
      avgHr: 153,
      maxHr: 171,
      avgPaceSecsPerKm: 271,
      gapPaceSecsPerKm: 262,
      decouplingPct: 3.6,
      ef: 1.49,
      zoneHr: [540, 2940, 1200, 300, 0, 0, 0],
      zonePowerOrPace: [480, 2940, 1260, 300, 0, 0, 0],
    },
    {
      offsetDays: -24,
      idSuffix: 'ride-endurance-50km',
      name: 'Weekend Aerobic Endurance Ride',
      sport: 'Cycling',
      subType: 'Road',
      environment: 'OUTDOOR',
      movingTimeSecs: 5400,
      distanceMeters: 48500,
      elevationGainMeters: 520,
      trainingLoad: 78,
      avgHr: 141,
      maxHr: 164,
      avgPower: 204,
      normalizedPower: 216,
      decouplingPct: 2.5,
      ef: 1.53,
      zoneHr: [720, 3660, 840, 180, 0, 0, 0],
      zonePowerOrPace: [660, 3600, 900, 240, 0, 0, 0],
    },
  ];

  const loopCoords = buildParkLoopRoute(37.4275, -122.1697, 0.011, 0.014);

  const activities: UnifiedActivity[] = rawTemplates.map((tpl) => {
    const dateIso = shiftDateIso(todayIso, tpl.offsetDays);
    const streams = tpl.withStreams
      ? buildSample1HzStream({
          durationSecs: tpl.movingTimeSecs,
          sport: tpl.sport,
          baseWatts: tpl.avgPower || 240,
          intervalWatts: tpl.normalizedPower ? tpl.normalizedPower + 18 : 285,
          baseHr: tpl.avgHr,
          intervalHr: Math.min(tpl.maxHr - 3, tpl.avgHr + 14),
          baseSpeedMps: tpl.sport === 'Running' ? 3.55 : 8.9,
          intervalSpeedMps: tpl.sport === 'Running' ? 4.35 : 10.4,
          centerLat: 37.4275,
          centerLng: -122.1697,
        })
      : undefined;

    return {
      id: `sample-demo-${tpl.idSuffix}`,
      startDateLocal: `${dateIso}T07:15:00`,
      name: tpl.name.trim(),
      sportCategory: tpl.sport,
      environment: tpl.environment,
      subType: tpl.subType,
      movingTimeSecs: tpl.movingTimeSecs,
      distanceMeters: tpl.distanceMeters,
      elevationGainMeters: tpl.elevationGainMeters,
      avgPower: tpl.avgPower,
      normalizedPower: tpl.normalizedPower,
      intensityFactor: tpl.normalizedPower
        ? Number((tpl.normalizedPower / (tpl.sport === 'Running' ? 296 : ftp)).toFixed(2))
        : 0.79,
      variabilityIndex:
        tpl.avgPower && tpl.normalizedPower
          ? Number((tpl.normalizedPower / tpl.avgPower).toFixed(2))
          : 1.03,
      trainingLoad: tpl.trainingLoad,
      avgHr: tpl.avgHr,
      maxHr: tpl.maxHr,
      avgCadence: tpl.sport === 'Running' ? 176 : 90,
      avgPaceSecsPerKm: tpl.avgPaceSecsPerKm,
      gapPaceSecsPerKm: tpl.gapPaceSecsPerKm,
      aerobicDecouplingPct: tpl.decouplingPct,
      efficiencyFactor: tpl.ef,
      firstHalfEf: Number((tpl.ef * 1.01).toFixed(2)),
      secondHalfEf: Number((tpl.ef * (1 - tpl.decouplingPct / 100)).toFixed(2)),
      calories: Math.round(tpl.trainingLoad * 9.4),
      deviceName: 'Sample Telemetry Recorder',
      zoneSecs: {
        hr: tpl.zoneHr,
        ...(tpl.sport === 'Cycling' || tpl.avgPower ? { power: tpl.zonePowerOrPace } : {}),
        ...(tpl.sport === 'Running' ? { pace: tpl.zonePowerOrPace } : {}),
      },
      stravaPrCount: tpl.official5k ? 2 : 0,
      routeLatLngs: loopCoords,
      startLatLng: loopCoords[0],
      endLatLng: loopCoords[loopCoords.length - 1],
      segmentEfforts: [],
      ...(streams ? { streams } : {}),
      ...(tpl.official5k
        ? {
            officialRaceData: {
              platform: 'Official FAT',
              meetName: 'Sample Spring Track Opener (Demo)',
              eventLabel: '5000m',
              eventDistanceMeters: 5000,
              fatTimeSecs: 1008.42,
              displayFatTime: '16:48.42',
              trackType: 'OUTDOOR_400M',
              placeFinish: 'Sample Mark',
              lapSplitDistanceMeters: 1000,
              lapSplitsSecs: [201.4, 202.8, 203.1, 202.2, 198.92],
              vdotScore: 61.2,
              includeWarmupCooldown: true,
            },
          }
        : {}),
      sourceBadges: tpl.official5k ? ['Official FAT'] : ['Garmin'],
    };
  });

  const loadByDate = new Map<string, number>();
  for (const act of activities) {
    const d = act.startDateLocal.slice(0, 10);
    loadByDate.set(d, (loadByDate.get(d) || 0) + act.trainingLoad);
  }

  let ctl = 45.0;
  let atl = 47.0;
  const wellnessDays: UnifiedWellnessDay[] = [];
  for (let offset = -44; offset <= 0; offset++) {
    const dateIso = shiftDateIso(todayIso, offset);
    const fallbackLoad =
      offset < -24
        ? offset % 7 === 0
          ? 0
          : offset % 3 === 0
            ? 74
            : 52
        : 0;
    const dailyLoad = loadByDate.get(dateIso) ?? fallbackLoad;
    ctl = ctl + (dailyLoad - ctl) / 42;
    atl = atl + (dailyLoad - atl) / 7;
    const tsb = ctl - atl;
    const prev7Ctl = wellnessDays.length >= 7 ? wellnessDays[wellnessDays.length - 7].ctl : 45.0;
    const hrvBase = 71;
    const hrvVal = Math.round(hrvBase + 4 * Math.sin(offset * 0.55) - (dailyLoad > 85 ? 3 : 0));
    const sleepScore = Math.round(82 + 5 * Math.cos(offset * 0.45));

    wellnessDays.push({
      date: dateIso,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number(tsb.toFixed(1)),
      loadRatio: Number((atl / Math.max(1, ctl)).toFixed(2)),
      rampRate: Number((ctl - prev7Ctl).toFixed(1)),
      hrvRMSSD: hrvVal,
      hrvBaseline7d: hrvBase,
      hrvNormalBandLow: 63,
      hrvNormalBandHigh: 79,
      hrvStatus: 'Balanced',
      restingHR: Math.round(48 + (dailyLoad > 85 ? 2 : 0)),
      sleepSecs: Math.round((7.6 + 0.35 * Math.cos(offset * 0.5)) * 3600),
      sleepScore,
      weightKg: 66.5,
      vo2MaxCycling: 61,
      vo2MaxRunning: 63,
      rideEftp: 288,
      rideWPrime: 21400,
      ridePMax: 1040,
      runEftp: 298,
      garminTrainingStatus: 'Productive',
      readinessStatus: tsb < -22 ? 'Caution' : 'Optimal',
      dailyLoad,
    });
  }

  const plannedEvents: PlannedWorkoutEvent[] = [
    {
      id: 'sample-plan-today',
      date: todayIso,
      name: '4 x 6m Threshold Tempo + 2m Float',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Controlled LT2 progression calibrated to 3:48/km (~6:07/mi) threshold pace.',
      plannedLoad: 78,
      plannedDurationSecs: 3300,
      targetZoneSummary: 'Z4 Lactate Threshold',
      workoutSyntax:
        'Warmup\n- 12m 68% Pace\n\nMain Set 4x\n- 6m 98% Pace\n- 2m 70% Pace\n\nCooldown\n- 10m 65% Pace',
      source: 'USER',
    },
    {
      id: 'sample-plan-plus-1',
      date: shiftDateIso(todayIso, 1),
      name: 'Easy Aerobic Recovery Spin (Zero-Impact)',
      sportCategory: 'Cycling',
      environmentPreference: 'OUTDOOR',
      description: 'Low-torque Z1/Z2 capillary flush keeping cardiac drift under 3.5%.',
      plannedLoad: 44,
      plannedDurationSecs: 3600,
      targetZoneSummary: 'Z2 Aerobic Base',
      workoutSyntax: 'Warmup\n- 10m 55% FTP\n\nMain Set\n- 40m 66% FTP\n\nCooldown\n- 10m 50% FTP',
      source: 'USER',
    },
    {
      id: 'sample-plan-plus-3',
      date: shiftDateIso(todayIso, 3),
      name: '6 x 800m VO2max Track Repeats',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Daniels I-pace track session with equal 400m jog recovery.',
      plannedLoad: 86,
      plannedDurationSecs: 3600,
      targetZoneSummary: 'Z5 Aerobic Capacity',
      workoutSyntax:
        'Warmup\n- 15m 68% Pace\n\nMain Set 6x\n- 3m 106% Pace\n- 2m 62% Pace\n\nCooldown\n- 15m 64% Pace',
      source: 'USER',
    },
    {
      id: 'sample-plan-plus-5',
      date: shiftDateIso(todayIso, 5),
      name: 'Progressive Endurance Long Run (90m)',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Steady Z2 aerobic volume finishing final 15 minutes at Z3 marathon effort.',
      plannedLoad: 108,
      plannedDurationSecs: 5400,
      targetZoneSummary: 'Z2–Z3 Endurance',
      workoutSyntax:
        'Warmup\n- 15m 68% Pace\n\nMain Set\n- 60m 76% Pace\n- 15m 86% Pace',
      source: 'USER',
    },
  ];

  const targetGoals: TargetGoal[] = [
    {
      id: 'sample-goal-5k',
      title: 'Championship 5000m Track Target',
      type: 'RACE_EVENT',
      sportCategory: 'Running',
      targetDate: shiftDateIso(todayIso, 35),
      priority: 'A-Race',
      targetCtl: 58,
      currentValue: 61.2,
      targetValue: 63.0,
      unit: 'VDOT',
      notes: 'Illustrative sample season peak target (16:20 5000m equivalent).',
    },
    {
      id: 'sample-goal-ftp',
      title: 'Cross-Modal Cycling Threshold Base',
      type: 'PERFORMANCE_METRIC',
      sportCategory: 'Cycling',
      targetDate: shiftDateIso(todayIso, 60),
      priority: 'Milestone',
      targetCtl: 56,
      currentValue: 285,
      targetValue: 300,
      unit: 'W',
      notes: 'Zero-impact aerobic volume support block.',
    },
  ];

  return {
    athleteProfile,
    activities,
    wellnessDays,
    plannedEvents,
    targetGoals,
  };
}
