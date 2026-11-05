import {
  AnnualMileageGoal,
  BenchmarkSegmentHistory,
  CoachChatMessage,
  DailyWorkoutOption,
  PlannedWorkoutEvent,
  PowerPaceCurvePoint,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';

// Generate 90 days of realistic physiological wellness & PMC load leading up to 2026-11-05
function generateWellnessDays(): UnifiedWellnessDay[] {
  const days: UnifiedWellnessDay[] = [];
  const baseDate = new Date('2026-11-05T12:00:00Z');
  let ctl = 64.0;
  let atl = 68.0;

  for (let i = 89; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setUTCDate(baseDate.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay(); // 0 = Sun, 6 = Sat

    // Deterministic pseudo-random wave based on index
    const wave = Math.sin(i * 0.35);
    const micro = Math.cos(i * 1.13);

    // Higher load on weekends and Tue/Thu
    let dailyLoad = 55;
    if (dayOfWeek === 6) dailyLoad = Math.round(135 + wave * 25);
    else if (dayOfWeek === 0) dailyLoad = Math.round(110 + micro * 20);
    else if (dayOfWeek === 2 || dayOfWeek === 4) dailyLoad = Math.round(88 + wave * 15);
    else if (dayOfWeek === 1) dailyLoad = Math.round(25 + Math.abs(micro) * 15); // recovery Mon
    else dailyLoad = Math.round(64 + micro * 14);

    // Override recent 3 days for realistic narrative
    if (i === 2) dailyLoad = 128; // Hard Tue threshold session
    if (i === 1) dailyLoad = 62; // Wed aerobic run
    if (i === 0) dailyLoad = 0; // Today morning readiness before workout

    ctl = ctl + (dailyLoad - ctl) / 42;
    atl = atl + (dailyLoad - atl) / 7;
    const tsb = Number((ctl - atl).toFixed(1));

    const hrvBaseline7d = Math.round(68 + Math.sin(i * 0.12) * 3);
    let hrvRMSSD = Math.round(hrvBaseline7d - (atl - ctl) * 0.32 + micro * 4);
    if (i === 0) hrvRMSSD = 71; // Today's morning Garmin HRV: 71ms vs 68ms baseline

    const restingHR = Math.round(46 + (atl - ctl) * 0.14 - micro * 1.5);
    const sleepSecs = Math.round((7.4 + micro * 0.65) * 3600);
    const sleepScore = Math.min(96, Math.max(64, Math.round(82 + micro * 8 - (atl - ctl) * 0.2)));

    let readinessStatus: 'Optimal' | 'Caution' | 'Strain' = 'Optimal';
    if (tsb < -18 || hrvRMSSD < hrvBaseline7d - 7 || sleepScore < 70) {
      readinessStatus = 'Strain';
    } else if (tsb < -10 || hrvRMSSD < hrvBaseline7d - 3) {
      readinessStatus = 'Caution';
    }

    const prev7Ctl = days.length >= 7 ? days[days.length - 7].ctl : ctl - 1.2;
    const rampRate = Number((ctl - prev7Ctl).toFixed(1));

    days.push({
      date: dateStr,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb,
      rampRate,
      hrvRMSSD,
      hrvBaseline7d,
      restingHR: i === 0 ? 45 : restingHR,
      sleepSecs: i === 0 ? 28200 : sleepSecs, // 7h 50m today
      sleepScore: i === 0 ? 87 : sleepScore,
      weightKg: Number((69.4 - (89 - i) * 0.008).toFixed(1)),
      vo2MaxCycling: 64,
      vo2MaxRunning: 61,
      soreness: tsb < -12 ? 3 : 1,
      readinessStatus: i === 0 ? 'Optimal' : readinessStatus,
      dailyLoad,
    });
  }

  return days;
}

function buildCyclingStream(durationMinutes: number, baseWatts: number, baseHr: number, isIndoor: boolean) {
  const points = 60;
  const stepSecs = Math.round((durationMinutes * 60) / points);
  const time: number[] = [];
  const watts: number[] = [];
  const heartrate: number[] = [];
  const cadence: number[] = [];
  const altitude: number[] = [];

  for (let i = 0; i < points; i++) {
    time.push(i * stepSecs);
    const phase = i / points;
    const isInterval = (phase > 0.2 && phase < 0.38) || (phase > 0.48 && phase < 0.66) || (phase > 0.74 && phase < 0.86);
    const w = isInterval
      ? Math.round(baseWatts * 1.22 + Math.sin(i * 0.9) * 14)
      : Math.round(baseWatts * 0.82 + Math.cos(i * 0.7) * 12);
    watts.push(w);
    // Simulate slight cardiac drift in second half
    const drift = Math.round(phase * 5);
    heartrate.push(Math.round(baseHr + (isInterval ? 18 : -8) + drift + Math.sin(i * 0.5) * 3));
    cadence.push(Math.round(isIndoor ? 91 + (isInterval ? 4 : -2) : 88 + Math.sin(i) * 5));
    altitude.push(isIndoor ? Math.round(120 + phase * 180) : Math.round(85 + Math.sin(phase * Math.PI * 2) * 210 + phase * 140));
  }
  return { time, watts, heartrate, cadence, altitude };
}

function buildRunningStream(durationMinutes: number, baseSpeedMs: number, baseHr: number, isIndoor: boolean) {
  const points = 60;
  const stepSecs = Math.round((durationMinutes * 60) / points);
  const time: number[] = [];
  const velocitySmooth: number[] = [];
  const heartrate: number[] = [];
  const cadence: number[] = [];
  const altitude: number[] = [];

  for (let i = 0; i < points; i++) {
    time.push(i * stepSecs);
    const phase = i / points;
    const isTempo = phase > 0.25 && phase < 0.78;
    const v = isTempo
      ? Number((baseSpeedMs * 1.09 + Math.sin(i * 0.6) * 0.08).toFixed(2))
      : Number((baseSpeedMs * 0.92 + Math.cos(i * 0.5) * 0.06).toFixed(2));
    velocitySmooth.push(v);
    const drift = Math.round(phase * 4);
    heartrate.push(Math.round(baseHr + (isTempo ? 14 : -9) + drift + Math.sin(i * 0.4) * 2));
    cadence.push(Math.round(178 + (isTempo ? 6 : -2)));
    altitude.push(isIndoor ? 45 : Math.round(60 + Math.sin(phase * Math.PI * 3) * 48));
  }
  return { time, velocitySmooth, heartrate, cadence, altitude };
}

export const INITIAL_WELLNESS_DAYS: UnifiedWellnessDay[] = generateWellnessDays();

export const INITIAL_ACTIVITIES: UnifiedActivity[] = [
  {
    id: 'act-101',
    intervalsId: 'i4920184',
    stravaId: '1284920192',
    startDateLocal: '2026-11-04T07:15:00',
    name: 'Skyline Ridge Threshold & Tempo Progression',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Trail',
    movingTimeSecs: 4380, // 1h 13m
    distanceMeters: 16400, // 16.4 km / 10.19 mi
    elevationGainMeters: 315,
    avgPower: 294,
    normalizedPower: 308,
    intensityFactor: 0.89,
    trainingLoad: 96,
    avgHr: 158,
    maxHr: 179,
    avgCadence: 180,
    avgPaceSecsPerKm: 267, // 4:27 /km
    gapPaceSecsPerKm: 251, // 4:11 /km
    aerobicDecouplingPct: 2.1,
    efficiencyFactor: 1.95,
    firstHalfEf: 1.97,
    secondHalfEf: 1.93,
    zoneSecs: {
      hr: [180, 1140, 1420, 1280, 360, 0, 0],
      pace: [210, 980, 1390, 1340, 340, 120, 0],
    },
    gearName: 'Nike Vaporfly 3 (312 km)',
    stravaPrCount: 2,
    kudosCount: 28,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [
      {
        id: 'se-1',
        segmentId: 'seg-skyline-crest',
        name: 'Skyline Fire Road Climb',
        sportCategory: 'Running',
        distanceMeters: 2450,
        averageGradePct: 5.4,
        elapsedTimeSecs: 642,
        movingTimeSecs: 642,
        avgPaceSecsPerKm: 262,
        avgHr: 171,
        prRank: 1,
        komRank: 8,
        startDateLocal: '2026-11-04T07:38:00',
        activityId: 'act-101',
        activityName: 'Skyline Ridge Threshold & Tempo Progression',
      },
      {
        id: 'se-2',
        segmentId: 'seg-redwood-descent',
        name: 'Redwood Singletrack Flow',
        sportCategory: 'Running',
        distanceMeters: 1850,
        averageGradePct: -3.8,
        elapsedTimeSecs: 418,
        movingTimeSecs: 418,
        avgPaceSecsPerKm: 226,
        avgHr: 154,
        prRank: 2,
        komRank: null,
        startDateLocal: '2026-11-04T08:02:00',
        activityId: 'act-101',
        activityName: 'Skyline Ridge Threshold & Tempo Progression',
      },
    ],
    streams: buildRunningStream(73, 3.74, 158, false),
  },
  {
    id: 'act-102',
    intervalsId: 'i4918821',
    stravaId: '1284100482',
    startDateLocal: '2026-11-03T17:30:00',
    name: 'ERG 4x10m @ 102% FTP Over-Unders (Smart Trainer)',
    sportCategory: 'Cycling',
    environment: 'INDOOR',
    subType: 'Smart Trainer',
    movingTimeSecs: 4500, // 1h 15m
    distanceMeters: 44800,
    elevationGainMeters: 420,
    avgPower: 252,
    normalizedPower: 279,
    intensityFactor: 0.93,
    variabilityIndex: 1.11,
    trainingLoad: 108,
    avgHr: 156,
    maxHr: 176,
    avgCadence: 93,
    aerobicDecouplingPct: 1.4,
    efficiencyFactor: 1.79,
    firstHalfEf: 1.80,
    secondHalfEf: 1.78,
    zoneSecs: {
      hr: [360, 1260, 900, 1620, 360, 0, 0],
      power: [540, 1140, 480, 1860, 480, 0, 0],
    },
    gearName: 'Canyon Aeroad CFR + Wahoo KICKR v6',
    stravaPrCount: 1,
    kudosCount: 19,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [
      {
        id: 'se-3',
        segmentId: 'seg-zwift-epic-kom',
        name: 'Watopia Epic KOM Forward (Virtual)',
        sportCategory: 'Cycling',
        distanceMeters: 9400,
        averageGradePct: 4.0,
        elapsedTimeSecs: 1315,
        movingTimeSecs: 1315,
        avgWatts: 292,
        avgWattsPerKg: 4.21,
        avgHr: 168,
        prRank: 1,
        komRank: null,
        startDateLocal: '2026-11-03T17:52:00',
        activityId: 'act-102',
        activityName: 'ERG 4x10m @ 102% FTP Over-Unders (Smart Trainer)',
      },
    ],
    streams: buildCyclingStream(75, 255, 156, true),
  },
  {
    id: 'act-103',
    intervalsId: 'i4912049',
    stravaId: '1283201190',
    startDateLocal: '2026-11-01T08:00:00',
    name: 'Coast Highway & Old La Honda Endurance Climb',
    sportCategory: 'Cycling',
    environment: 'OUTDOOR',
    subType: 'Road',
    movingTimeSecs: 11880, // 3h 18m
    distanceMeters: 104600, // 104.6 km / 65.0 mi
    elevationGainMeters: 1480,
    avgPower: 224,
    normalizedPower: 251,
    intensityFactor: 0.84,
    variabilityIndex: 1.12,
    trainingLoad: 232,
    avgHr: 147,
    maxHr: 175,
    avgCadence: 87,
    aerobicDecouplingPct: 3.2,
    efficiencyFactor: 1.71,
    firstHalfEf: 1.74,
    secondHalfEf: 1.68,
    zoneSecs: {
      hr: [1120, 5840, 2920, 1640, 360, 0, 0],
      power: [1480, 5420, 2560, 1780, 460, 180, 0],
    },
    gearName: 'Specialized Tarmac SL8 (4,820 km)',
    stravaPrCount: 3,
    kudosCount: 44,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [
      {
        id: 'se-4',
        segmentId: 'seg-old-la-honda',
        name: 'Old La Honda (Bridge to Mailboxes)',
        sportCategory: 'Cycling',
        distanceMeters: 5340,
        averageGradePct: 7.3,
        elapsedTimeSecs: 1068, // 17:48
        movingTimeSecs: 1068,
        avgWatts: 306,
        avgWattsPerKg: 4.41,
        avgHr: 171,
        prRank: 1,
        komRank: 14,
        startDateLocal: '2026-11-01T09:12:00',
        activityId: 'act-103',
        activityName: 'Coast Highway & Old La Honda Endurance Climb',
      },
      {
        id: 'se-5',
        segmentId: 'seg-tunitas-creek',
        name: 'Tunitas Creek Lower Grind',
        sportCategory: 'Cycling',
        distanceMeters: 4800,
        averageGradePct: 6.1,
        elapsedTimeSecs: 912,
        movingTimeSecs: 912,
        avgWatts: 288,
        avgWattsPerKg: 4.15,
        avgHr: 165,
        prRank: 2,
        komRank: null,
        startDateLocal: '2026-11-01T10:25:00',
        activityId: 'act-103',
        activityName: 'Coast Highway & Old La Honda Endurance Climb',
      },
    ],
    streams: buildCyclingStream(198, 228, 147, false),
  },
  {
    id: 'act-104',
    intervalsId: 'i4909310',
    stravaId: '1282491021',
    startDateLocal: '2026-10-30T18:10:00',
    name: 'Treadmill Incline Cruise Intervals (5x1.6km @ 2%)',
    sportCategory: 'Running',
    environment: 'INDOOR',
    subType: 'Treadmill',
    movingTimeSecs: 3420, // 57m
    distanceMeters: 13200, // 13.2 km
    elevationGainMeters: 195,
    avgPower: 282,
    normalizedPower: 291,
    intensityFactor: 0.86,
    trainingLoad: 74,
    avgHr: 152,
    maxHr: 171,
    avgCadence: 182,
    avgPaceSecsPerKm: 259, // 4:19 /km
    gapPaceSecsPerKm: 249,
    aerobicDecouplingPct: 1.8,
    efficiencyFactor: 1.91,
    firstHalfEf: 1.93,
    secondHalfEf: 1.89,
    zoneSecs: {
      hr: [320, 1180, 920, 880, 120, 0, 0],
      pace: [300, 1120, 860, 980, 160, 0, 0],
    },
    gearName: 'Woodway 4Front + Stryd Duo',
    stravaPrCount: 0,
    kudosCount: 15,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [],
    streams: buildRunningStream(57, 3.86, 152, true),
  },
  {
    id: 'act-105',
    intervalsId: 'i4905118',
    stravaId: '1281882014',
    startDateLocal: '2026-10-28T06:45:00',
    name: 'Bayfront Aerobic Progression Run',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Road',
    movingTimeSecs: 3960, // 1h 06m
    distanceMeters: 15100, // 15.1 km
    elevationGainMeters: 62,
    avgPower: 276,
    normalizedPower: 281,
    intensityFactor: 0.82,
    trainingLoad: 78,
    avgHr: 146,
    maxHr: 163,
    avgCadence: 179,
    avgPaceSecsPerKm: 262, // 4:22 /km
    gapPaceSecsPerKm: 260,
    aerobicDecouplingPct: 1.2,
    efficiencyFactor: 1.92,
    firstHalfEf: 1.93,
    secondHalfEf: 1.91,
    zoneSecs: {
      hr: [420, 2240, 1080, 220, 0, 0, 0],
      pace: [380, 2180, 1160, 240, 0, 0, 0],
    },
    gearName: 'ASICS Superblast 2 (418 km)',
    stravaPrCount: 1,
    kudosCount: 23,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [
      {
        id: 'se-6',
        segmentId: 'seg-bayfront-5k',
        name: 'Bayfront Mile 3-6 Tempo Strip',
        sportCategory: 'Running',
        distanceMeters: 5000,
        averageGradePct: 0.2,
        elapsedTimeSecs: 1235, // 20:35
        movingTimeSecs: 1235,
        avgPaceSecsPerKm: 247,
        avgHr: 155,
        prRank: 3,
        komRank: null,
        startDateLocal: '2026-10-28T07:10:00',
        activityId: 'act-105',
        activityName: 'Bayfront Aerobic Progression Run',
      },
    ],
    streams: buildRunningStream(66, 3.81, 146, false),
  },
  {
    id: 'act-106',
    intervalsId: 'i4901204',
    stravaId: '1280991240',
    startDateLocal: '2026-10-26T17:15:00',
    name: 'Zwift Zone 2 Aerobic Durability Spin',
    sportCategory: 'Cycling',
    environment: 'INDOOR',
    subType: 'Smart Trainer',
    movingTimeSecs: 5400, // 1h 30m
    distanceMeters: 51200,
    elevationGainMeters: 310,
    avgPower: 208,
    normalizedPower: 212,
    intensityFactor: 0.71,
    variabilityIndex: 1.02,
    trainingLoad: 76,
    avgHr: 134,
    maxHr: 145,
    avgCadence: 90,
    aerobicDecouplingPct: 0.9,
    efficiencyFactor: 1.58,
    firstHalfEf: 1.59,
    secondHalfEf: 1.57,
    zoneSecs: {
      hr: [900, 4200, 300, 0, 0, 0, 0],
      power: [720, 4440, 240, 0, 0, 0, 0],
    },
    gearName: 'Canyon Aeroad CFR + Wahoo KICKR v6',
    stravaPrCount: 0,
    kudosCount: 16,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [],
    streams: buildCyclingStream(90, 208, 134, true),
  },
  {
    id: 'act-107',
    intervalsId: 'i4898440',
    stravaId: '1279884110',
    startDateLocal: '2026-10-25T07:30:00',
    name: 'Masters Threshold Swim — 12x100m on 1:30 + Pull',
    sportCategory: 'Swimming',
    environment: 'INDOOR',
    subType: 'Pool',
    movingTimeSecs: 3120,
    distanceMeters: 3200,
    elevationGainMeters: 0,
    trainingLoad: 58,
    avgHr: 141,
    maxHr: 162,
    aerobicDecouplingPct: 1.5,
    efficiencyFactor: 1.42,
    firstHalfEf: 1.43,
    secondHalfEf: 1.41,
    zoneSecs: {
      hr: [480, 1320, 960, 360, 0, 0, 0],
    },
    gearName: '25m Indoor Pool · Garmin HRM-Pro Plus',
    stravaPrCount: 0,
    kudosCount: 14,
    sourceBadges: ['Intervals.icu', 'Garmin', 'Strava'],
    segmentEfforts: [],
  },
  {
    id: 'act-108',
    intervalsId: 'i4895210',
    stravaId: '1279110394',
    startDateLocal: '2026-10-23T16:30:00',
    name: 'Posterior Chain & Single-Leg Force Conditioning',
    sportCategory: 'Strength',
    environment: 'INDOOR',
    subType: 'Gym',
    movingTimeSecs: 3300,
    distanceMeters: 0,
    elevationGainMeters: 0,
    trainingLoad: 42,
    avgHr: 122,
    maxHr: 151,
    aerobicDecouplingPct: 0.4,
    efficiencyFactor: 1.15,
    firstHalfEf: 1.15,
    secondHalfEf: 1.15,
    zoneSecs: {
      hr: [1620, 1260, 420, 0, 0, 0, 0],
    },
    gearName: 'Olympic Rack & Trap Bar',
    stravaPrCount: 0,
    kudosCount: 11,
    sourceBadges: ['Intervals.icu', 'Garmin'],
    segmentEfforts: [],
  },
];

export const INITIAL_BENCHMARK_SEGMENTS: BenchmarkSegmentHistory[] = [
  {
    segmentId: 'seg-old-la-honda',
    name: 'Old La Honda (Bridge to Mailboxes)',
    sportCategory: 'Cycling',
    distanceMeters: 5340,
    averageGradePct: 7.3,
    location: 'Woodside, CA · Outdoor Climb',
    prElapsedTimeSecs: 1068, // 17:48
    targetElapsedTimeSecs: 1020, // 17:00 goal
    efforts: [
      { date: '2026-06-14', elapsedTimeSecs: 1142, avgWatts: 284, avgHr: 173, prRank: null },
      { date: '2026-08-02', elapsedTimeSecs: 1110, avgWatts: 293, avgHr: 172, prRank: 3 },
      { date: '2026-09-19', elapsedTimeSecs: 1089, avgWatts: 299, avgHr: 170, prRank: 2 },
      { date: '2026-11-01', elapsedTimeSecs: 1068, avgWatts: 306, avgHr: 171, prRank: 1 },
    ],
  },
  {
    segmentId: 'seg-skyline-crest',
    name: 'Skyline Fire Road Climb',
    sportCategory: 'Running',
    distanceMeters: 2450,
    averageGradePct: 5.4,
    location: 'Oakland Hills · Trail Climb',
    prElapsedTimeSecs: 642, // 10:42
    targetElapsedTimeSecs: 615, // 10:15 goal
    efforts: [
      { date: '2026-07-11', elapsedTimeSecs: 688, avgPaceSecsPerKm: 281, avgHr: 174, prRank: null },
      { date: '2026-08-29', elapsedTimeSecs: 669, avgPaceSecsPerKm: 273, avgHr: 172, prRank: 3 },
      { date: '2026-10-03', elapsedTimeSecs: 655, avgPaceSecsPerKm: 267, avgHr: 171, prRank: 2 },
      { date: '2026-11-04', elapsedTimeSecs: 642, avgPaceSecsPerKm: 262, avgHr: 171, prRank: 1 },
    ],
  },
  {
    segmentId: 'seg-zwift-epic-kom',
    name: 'Watopia Epic KOM Forward (Virtual)',
    sportCategory: 'Cycling',
    distanceMeters: 9400,
    averageGradePct: 4.0,
    location: 'Indoor Smart Trainer · Virtual Climb',
    prElapsedTimeSecs: 1315, // 21:55
    targetElapsedTimeSecs: 1260, // 21:00 goal
    efforts: [
      { date: '2026-07-22', elapsedTimeSecs: 1378, avgWatts: 276, avgHr: 169, prRank: 3 },
      { date: '2026-09-09', elapsedTimeSecs: 1344, avgWatts: 284, avgHr: 168, prRank: 2 },
      { date: '2026-11-03', elapsedTimeSecs: 1315, avgWatts: 292, avgHr: 168, prRank: 1 },
    ],
  },
  {
    segmentId: 'seg-bayfront-5k',
    name: 'Bayfront Mile 3-6 Tempo Strip',
    sportCategory: 'Running',
    distanceMeters: 5000,
    averageGradePct: 0.2,
    location: 'Bay Trail · Flat Road 5K',
    prElapsedTimeSecs: 1218, // 20:18
    targetElapsedTimeSecs: 1170, // 19:30 goal
    efforts: [
      { date: '2026-06-28', elapsedTimeSecs: 1255, avgPaceSecsPerKm: 251, avgHr: 158, prRank: null },
      { date: '2026-08-18', elapsedTimeSecs: 1218, avgPaceSecsPerKm: 243, avgHr: 159, prRank: 1 },
      { date: '2026-09-25', elapsedTimeSecs: 1226, avgPaceSecsPerKm: 245, avgHr: 156, prRank: 2 },
      { date: '2026-10-28', elapsedTimeSecs: 1235, avgPaceSecsPerKm: 247, avgHr: 155, prRank: 3 },
    ],
  },
];

// Historical YTD Totals (prior to the recent activities list) so annual mileage progress is realistic for Nov 5, 2026 (day 309 of 365 = 84.66% of year)
export const HISTORICAL_YTD_BASE_METERS = {
  Running: {
    outdoorMeters: 1620000, // ~1,006.6 mi outdoor
    indoorMeters: 445000, // ~276.5 mi treadmill
  },
  Cycling: {
    outdoorMeters: 4890000, // ~3,038.5 mi outdoor road/gravel
    indoorMeters: 2180000, // ~1,354.6 mi smart trainer
  },
};

export const INITIAL_ANNUAL_MILEAGE_GOALS: AnnualMileageGoal[] = [
  {
    sportCategory: 'Running',
    year: 2026,
    targetDistanceMeters: 2414016, // 1,500 miles (2,414 km)
  },
  {
    sportCategory: 'Cycling',
    year: 2026,
    targetDistanceMeters: 8046720, // 5,000 miles (8,046.7 km)
  },
];

export const INITIAL_TARGET_GOALS: TargetGoal[] = [
  {
    id: 'goal-1',
    title: 'Marin Headlands 50K & Marathon Block',
    type: 'RACE_EVENT',
    sportCategory: 'Running',
    targetDate: '2026-12-13',
    priority: 'A-Race',
    targetCtl: 84,
    currentValue: 74.2,
    targetValue: 84,
    unit: 'CTL',
    notes: 'Focus on <2.5% Pa:Hr decoupling on 2.5h trail runs and sustainedclimbing efficiency.',
  },
  {
    id: 'goal-2',
    title: 'Santa Cruz Mountains Gran Fondo',
    type: 'RACE_EVENT',
    sportCategory: 'Cycling',
    targetDate: '2027-03-21',
    priority: 'B-Race',
    targetCtl: 88,
    currentValue: 74.2,
    targetValue: 88,
    unit: 'CTL',
    notes: 'Build 20-minute critical power to 325W (4.68 W/kg) and sub-17:00 Old La Honda climb.',
  },
  {
    id: 'goal-3',
    title: 'Cycling Functional Threshold Power (FTP)',
    type: 'PERFORMANCE_METRIC',
    sportCategory: 'Cycling',
    targetDate: '2026-12-31',
    priority: 'Milestone',
    currentValue: 300,
    targetValue: 315,
    unit: 'W',
    notes: 'Currently at 4.32 W/kg (300W @ 69.4kg); targeting 4.54 W/kg.',
  },
  {
    id: 'goal-4',
    title: 'Lactate Threshold Run Pace',
    type: 'PERFORMANCE_METRIC',
    sportCategory: 'Running',
    targetDate: '2026-12-31',
    priority: 'Milestone',
    currentValue: 242, // 4:02 /km
    targetValue: 232, // 3:52 /km
    unit: 'sec/km',
    notes: 'Measured via 30-min field test and Intervals.icu critical pace model.',
  },
];

export const INITIAL_PLANNED_EVENTS: PlannedWorkoutEvent[] = [
  {
    id: 'ev-today',
    date: '2026-11-05',
    name: 'Sweet Spot 3x12m @ 90-93% FTP or Tempo Run',
    sportCategory: 'Cycling',
    environmentPreference: 'FLEXIBLE',
    description: '15m progressive warmup, 3x12m @ 270-280W (4m easy spin recovery), 10m cooldown.',
    plannedLoad: 84,
    plannedDurationSecs: 4500, // 75m
    targetZoneSummary: 'Z3/Z4 Sweet Spot (270–280W · HR 156–166 bpm)',
  },
  {
    id: 'ev-tomorrow',
    date: '2026-11-06',
    name: 'Aerobic Zone 2 Run + 6x20s Hill Strides',
    sportCategory: 'Running',
    environmentPreference: 'OUTDOOR',
    description: 'Easy conversational Zone 2 aerobic run with 6 neuromuscular hill strides at the finish.',
    plannedLoad: 62,
    plannedDurationSecs: 3600, // 60m
    targetZoneSummary: 'Z2 Aerobic (4:45–5:00/km · HR 136–146 bpm)',
  },
];

export const INITIAL_POWER_PACE_CURVES: PowerPaceCurvePoint[] = [
  {
    durationLabel: '5s',
    durationSecs: 5,
    cyclingOutdoorWatts: 1085,
    cyclingIndoorWatts: 990,
    cyclingSeasonBestWatts: 1110,
    runningOutdoorPaceSecsKm: 162, // 2:42 /km
    runningIndoorPaceSecsKm: 170,
    runningSeasonBestPaceSecsKm: 160,
  },
  {
    durationLabel: '1m',
    durationSecs: 60,
    cyclingOutdoorWatts: 545,
    cyclingIndoorWatts: 520,
    cyclingSeasonBestWatts: 560,
    runningOutdoorPaceSecsKm: 192, // 3:12 /km
    runningIndoorPaceSecsKm: 198,
    runningSeasonBestPaceSecsKm: 190,
  },
  {
    durationLabel: '5m',
    durationSecs: 300,
    cyclingOutdoorWatts: 368,
    cyclingIndoorWatts: 358,
    cyclingSeasonBestWatts: 374,
    runningOutdoorPaceSecsKm: 218, // 3:38 /km
    runningIndoorPaceSecsKm: 222,
    runningSeasonBestPaceSecsKm: 216,
  },
  {
    durationLabel: '20m',
    durationSecs: 1200,
    cyclingOutdoorWatts: 314,
    cyclingIndoorWatts: 306,
    cyclingSeasonBestWatts: 318,
    runningOutdoorPaceSecsKm: 239, // 3:59 /km
    runningIndoorPaceSecsKm: 243,
    runningSeasonBestPaceSecsKm: 238,
  },
  {
    durationLabel: '60m',
    durationSecs: 3600,
    cyclingOutdoorWatts: 291,
    cyclingIndoorWatts: 284,
    cyclingSeasonBestWatts: 296,
    runningOutdoorPaceSecsKm: 251, // 4:11 /km
    runningIndoorPaceSecsKm: 255,
    runningSeasonBestPaceSecsKm: 249,
  },
];

export const INITIAL_DAILY_WORKOUT_OPTIONS: DailyWorkoutOption[] = [
  {
    id: 'opt-1',
    tier: 'OPTIMAL',
    tierLabel: 'Option A · Optimal Progression',
    title: 'Sweet Spot 3×12m @ 92% FTP + Cadence Drills',
    sportCategory: 'Cycling',
    environment: 'INDOOR',
    durationMinutes: 75,
    estimatedLoad: 86,
    summary: 'Execute your scheduled Sweet Spot progression to push CTL toward your 84 CTL race goal.',
    physiologicalWhy:
      'Your morning HRV (71 ms) is +3 ms above your 7-day rolling baseline (68 ms), Resting HR is suppressed at 45 bpm, and Sleep Score reached 87/100. Your autonomic nervous system is primed to absorb sub-threshold work.',
    structuredSteps: [
      { label: 'Progressive Warmup', duration: '15 min', targetZoneOrOutput: '165W -> 225W (Z1–Z2 · 90 rpm)' },
      { label: 'Main Set: 3×12 min Sweet Spot', duration: '36 min work / 12 min rest', targetZoneOrOutput: '275–282W (92% FTP · HR 158–166 bpm) / 4m @ 150W' },
      { label: 'Aerobic Flush Cooldown', duration: '12 min', targetZoneOrOutput: '155W decreasing to 130W (Z1)' },
    ],
  },
  {
    id: 'opt-2',
    tier: 'MODULATED',
    tierLabel: 'Option B · Modulated Aerobic Durability',
    title: 'Aerobic Zone 2 Endurance + 4×3m Tempo Caps',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    durationMinutes: 65,
    estimatedLoad: 68,
    summary: 'High-economy outdoor road run advancing your 1,500 mi annual running target with controlled cardiac strain.',
    physiologicalWhy:
      'Following yesterday’s 16.4 km Skyline Ridge trail threshold session (96 load, 2.1% Pa:Hr decoupling), shifting today to mostly Z2 aerobic volume protects lower-leg muscular recovery while adding 13.5 km toward your annual running goal.',
    structuredSteps: [
      { label: 'Easy Aerobic Settling', duration: '20 min', targetZoneOrOutput: '4:50–5:00/km (HR 134–143 bpm)' },
      { label: '4×3 min Controlled Marathon Tempo', duration: '12 min work / 8 min float', targetZoneOrOutput: '4:15/km on 2m float @ 4:55/km' },
      { label: 'Steady Z2 Finish', duration: '25 min', targetZoneOrOutput: '4:48/km checking <2% HR drift' },
    ],
  },
  {
    id: 'opt-3',
    tier: 'RECOVERY',
    tierLabel: 'Option C · Active Parasympathetic Recovery',
    title: 'Zone 1 High-Cadence Recovery Spin & Hip Mobility',
    sportCategory: 'Cycling',
    environment: 'INDOOR',
    durationMinutes: 45,
    estimatedLoad: 32,
    summary: 'Low-torque parasympathetic flush on the smart trainer followed by 15 minutes of thoracic and hip mobility.',
    physiologicalWhy:
      'Select this option if subjective leg soreness feels elevated from back-to-back threshold days. Keeps TSB trending positively toward +2 for your weekend long block.',
    structuredSteps: [
      { label: 'Small-Ring Spin', duration: '35 min', targetZoneOrOutput: '145–165W (50–55% FTP · HR <128 bpm · 95 rpm)' },
      { label: 'Cooldown & Off-Bike Mobility', duration: '10 min', targetZoneOrOutput: '90/90 hip switches, couch stretch & ankle dorsiflexion' },
    ],
  },
];

export const INITIAL_CHAT_MESSAGES: CoachChatMessage[] = [
  {
    id: 'msg-welcome',
    role: 'assistant',
    content:
      "Good morning! Your Garmin-synced HRV via Intervals.icu is **71 ms** (+3 ms vs. your 7-day baseline of 68 ms), Resting HR is **45 bpm**, and last night's sleep scored **87/100** (7h 50m). Your current Fitness (**CTL**) is **74.2** with Form (**TSB**) at **-4.1**.\n\nYou're **+38.4 miles ahead** of your 1,500 mi annual running pace (78% Outdoor / 22% Treadmill) and **+112 miles ahead** of your 5,000 mi cycling target (69% Outdoor / 31% Smart Trainer). Ask me anything about your physiology, Strava segment progression, or how to tailor today's workout!",
    timestamp: '07:30 AM',
    citedMetrics: ['HRV 71 ms (+3 ms)', 'RHR 45 bpm', 'CTL 74.2 · TSB -4.1', 'Skyline Climb PR #1 (10:42)'],
  },
];
