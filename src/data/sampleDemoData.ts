import type {
  ActivityStreamSet,
  AthleteProfile,
  CoachEventGroup,
  GuardianSafetyAlertRecord,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  TargetGoal,
  TeamBroadcastWorkout,
  TeamMembershipRecord,
  TeamMessageRecord,
  TeamMessagingPolicy,
  TeamSummaryWithRole,
  TeamWorkoutComment,
  TeamWorkoutLibraryTemplate,
  TrackSplitTimingContext,
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
  demoTeams: TeamSummaryWithRole[];
}

interface DemoCoachAthleteSpec {
  idNum: string;
  name: string;
  squadGroup: string;
  eventGroup: CoachEventGroup;
  gradYear: number;
  birthMonthYear: string;
  thresholdPaceSecsPerKm: number;
  raceEventLabel: string;
  raceDistanceMeters: number;
  fatTimeSecs: number;
  displayFatTime: string;
  vdot: number;
  ctl: number;
  atl: number;
  tsb: number;
  hrv: number;
  readiness: number;
  verdictLabel: string;
  rpe: number;
  painFlag?: boolean;
  painArea?: SessionCheckInRecord['painArea'];
  autoSwapped?: boolean;
  sorenessNote?: string;
}

const DEMO_COACH_ATHLETE_SPECS: DemoCoachAthleteSpec[] = [
  {
    idNum: '01',
    name: 'Lucas Alvarez',
    squadGroup: 'Varsity',
    eventGroup: 'DISTANCE',
    gradYear: 2026,
    birthMonthYear: '2008-03',
    thresholdPaceSecsPerKm: 208,
    raceEventLabel: '5000m',
    raceDistanceMeters: 5000,
    fatTimeSecs: 954.12,
    displayFatTime: '15:54.12',
    vdot: 65.4,
    ctl: 64,
    atl: 61,
    tsb: 3,
    hrv: 74,
    readiness: 88,
    verdictLabel: 'Prime Readiness',
    rpe: 6,
  },
  {
    idNum: '02',
    name: 'Maya Chen',
    squadGroup: 'Varsity',
    eventGroup: 'DISTANCE',
    gradYear: 2027,
    birthMonthYear: '2009-05',
    thresholdPaceSecsPerKm: 234,
    raceEventLabel: '5000m',
    raceDistanceMeters: 5000,
    fatTimeSecs: 1092.45,
    displayFatTime: '18:12.45',
    vdot: 56.1,
    ctl: 56,
    atl: 62,
    tsb: -6,
    hrv: 62,
    readiness: 54,
    verdictLabel: 'MODIFIED · Shin Pain',
    rpe: 7,
    painFlag: true,
    painArea: 'SHIN',
    autoSwapped: true,
    sorenessNote: 'Right medial shin tightness after track reps — swapped to Easy Spin.',
  },
  {
    idNum: '03',
    name: 'Ethan Patel',
    squadGroup: 'Varsity',
    eventGroup: 'MID_DISTANCE',
    gradYear: 2027,
    birthMonthYear: '2009-02',
    thresholdPaceSecsPerKm: 214,
    raceEventLabel: '1600m',
    raceDistanceMeters: 1600,
    fatTimeSecs: 274.8,
    displayFatTime: '4:34.80',
    vdot: 63.2,
    ctl: 48,
    atl: 69,
    tsb: -21,
    hrv: 59,
    readiness: 58,
    verdictLabel: 'Caution · ACWR 1.44',
    rpe: 9,
  },
  {
    idNum: '04',
    name: 'Sofia Rodriguez',
    squadGroup: 'Varsity',
    eventGroup: 'DISTANCE',
    gradYear: 2026,
    birthMonthYear: '2008-08',
    thresholdPaceSecsPerKm: 238,
    raceEventLabel: '5000m',
    raceDistanceMeters: 5000,
    fatTimeSecs: 1116.2,
    displayFatTime: '18:36.20',
    vdot: 54.8,
    ctl: 54,
    atl: 51,
    tsb: 3,
    hrv: 72,
    readiness: 85,
    verdictLabel: 'Prime Readiness',
    rpe: 6,
  },
  {
    idNum: '05',
    name: 'Nolan Brooks',
    squadGroup: 'Varsity',
    eventGroup: 'MID_DISTANCE',
    gradYear: 2026,
    birthMonthYear: '2008-11',
    thresholdPaceSecsPerKm: 212,
    raceEventLabel: '1600m',
    raceDistanceMeters: 1600,
    fatTimeSecs: 271.15,
    displayFatTime: '4:31.15',
    vdot: 64.1,
    ctl: 59,
    atl: 57,
    tsb: 2,
    hrv: 70,
    readiness: 83,
    verdictLabel: 'On Track',
    rpe: 6,
  },
  {
    idNum: '06',
    name: 'Kira Nakamura',
    squadGroup: 'Varsity',
    eventGroup: 'MID_DISTANCE',
    gradYear: 2028,
    birthMonthYear: '2010-01',
    thresholdPaceSecsPerKm: 242,
    raceEventLabel: '1600m',
    raceDistanceMeters: 1600,
    fatTimeSecs: 314.9,
    displayFatTime: '5:14.90',
    vdot: 54.0,
    ctl: 51,
    atl: 49,
    tsb: 2,
    hrv: 75,
    readiness: 86,
    verdictLabel: 'On Track',
    rpe: 5,
  },
  {
    idNum: '07',
    name: 'Mateo Flores',
    squadGroup: 'JV',
    eventGroup: 'HURDLES',
    gradYear: 2028,
    birthMonthYear: '2010-04',
    thresholdPaceSecsPerKm: 232,
    raceEventLabel: '5000m',
    raceDistanceMeters: 5000,
    fatTimeSecs: 1068.9,
    displayFatTime: '17:48.90',
    vdot: 57.5,
    ctl: 44,
    atl: 43,
    tsb: 1,
    hrv: 69,
    readiness: 81,
    verdictLabel: 'On Track',
    rpe: 5,
  },
  {
    idNum: '08',
    name: 'Hannah Kim',
    squadGroup: 'JV',
    eventGroup: 'JUMPS',
    gradYear: 2028,
    birthMonthYear: '2010-09',
    thresholdPaceSecsPerKm: 252,
    raceEventLabel: '1600m',
    raceDistanceMeters: 1600,
    fatTimeSecs: 332.1,
    displayFatTime: '5:32.10',
    vdot: 50.8,
    ctl: 41,
    atl: 40,
    tsb: 1,
    hrv: 73,
    readiness: 82,
    verdictLabel: 'On Track',
    rpe: 5,
  },
  {
    idNum: '09',
    name: 'Devon Carter',
    squadGroup: 'Varsity',
    eventGroup: 'SPRINTS',
    gradYear: 2027,
    birthMonthYear: '2009-07',
    thresholdPaceSecsPerKm: 226,
    raceEventLabel: '800m',
    raceDistanceMeters: 800,
    fatTimeSecs: 117.85,
    displayFatTime: '1:57.85',
    vdot: 60.4,
    ctl: 46,
    atl: 45,
    tsb: 1,
    hrv: 76,
    readiness: 84,
    verdictLabel: 'On Track',
    rpe: 6,
  },
  {
    idNum: '10',
    name: 'Chloe Okafor',
    squadGroup: 'Varsity',
    eventGroup: 'POLE_VAULT',
    gradYear: 2026,
    birthMonthYear: '2008-12',
    thresholdPaceSecsPerKm: 248,
    raceEventLabel: '800m',
    raceDistanceMeters: 800,
    fatTimeSecs: 138.6,
    displayFatTime: '2:18.60',
    vdot: 52.3,
    ctl: 45,
    atl: 44,
    tsb: 1,
    hrv: 74,
    readiness: 83,
    verdictLabel: 'On Track',
    rpe: 5,
  },
  {
    idNum: '11',
    name: 'Liam Gallagher',
    squadGroup: 'JV',
    eventGroup: 'THROWS',
    gradYear: 2029,
    birthMonthYear: '2011-02',
    thresholdPaceSecsPerKm: 256,
    raceEventLabel: '5000m',
    raceDistanceMeters: 5000,
    fatTimeSecs: 1162.4,
    displayFatTime: '19:22.40',
    vdot: 52.0,
    ctl: 38,
    atl: 36,
    tsb: 2,
    hrv: 77,
    readiness: 85,
    verdictLabel: 'On Track',
    rpe: 4,
  },
  {
    idNum: '12',
    name: 'Ava Washington',
    squadGroup: 'Return-to-Run',
    eventGroup: 'MID_DISTANCE',
    gradYear: 2028,
    birthMonthYear: '2010-06',
    thresholdPaceSecsPerKm: 268,
    raceEventLabel: '800m',
    raceDistanceMeters: 800,
    fatTimeSecs: 152.4,
    displayFatTime: '2:32.40',
    vdot: 47.6,
    ctl: 31,
    atl: 29,
    tsb: 2,
    hrv: 78,
    readiness: 80,
    verdictLabel: 'Return Build',
    rpe: 4,
  },
];

function buildDemoAthleteActivity(
  id: string,
  dateIso: string,
  name: string,
  distanceMeters: number,
  movingTimeSecs: number,
  trainingLoad: number,
  thresholdPaceSecsPerKm: number,
  officialRace?: {
    meetName: string;
    eventLabel: string;
    eventDistanceMeters: number;
    fatTimeSecs: number;
    displayFatTime: string;
    vdotScore: number;
    placeFinish?: string;
    timingMethod?: 'FAT' | 'HAND';
    splitContext?: TrackSplitTimingContext;
  }
): UnifiedActivity {
  const paceSecsPerKm = movingTimeSecs / Math.max(0.5, distanceMeters / 1000);
  const ratio = thresholdPaceSecsPerKm / Math.max(150, paceSecsPerKm);
  return {
    id,
    startDateLocal: `${dateIso}T15:30:00`,
    name,
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: officialRace ? 'Track' : 'Road',
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters: officialRace ? 0 : 48,
    intensityFactor: Number(ratio.toFixed(2)),
    variabilityIndex: 1.02,
    trainingLoad,
    avgHr: Math.round(148 + ratio * 18),
    maxHr: Math.round(176 + ratio * 12),
    avgCadence: 178,
    avgPaceSecsPerKm: Math.round(paceSecsPerKm),
    gapPaceSecsPerKm: Math.round(paceSecsPerKm),
    aerobicDecouplingPct: 2.1,
    efficiencyFactor: 1.82,
    firstHalfEf: 1.84,
    secondHalfEf: 1.8,
    calories: Math.round(trainingLoad * 9),
    deviceName: officialRace ? 'HY-TEK FAT Timing' : 'GPS Watch',
    zoneSecs: {
      hr: [120, Math.round(movingTimeSecs * 0.5), Math.round(movingTimeSecs * 0.35), Math.round(movingTimeSecs * 0.15), 0],
      pace: [100, Math.round(movingTimeSecs * 0.55), Math.round(movingTimeSecs * 0.3), Math.round(movingTimeSecs * 0.15), 0],
    },
    stravaPrCount: officialRace ? 1 : 0,
    segmentEfforts: [],
    ...(officialRace
      ? {
          officialRaceData: {
            platform: 'Athletic.net',
            meetName: officialRace.meetName,
            eventLabel: officialRace.eventLabel,
            eventDistanceMeters: officialRace.eventDistanceMeters,
            fatTimeSecs: officialRace.fatTimeSecs,
            displayFatTime: officialRace.displayFatTime,
            trackType: 'OUTDOOR_400M',
            placeFinish: officialRace.placeFinish,
            vdotScore: officialRace.vdotScore,
            lapSplitsSecs: [officialRace.fatTimeSecs],
            includeWarmupCooldown: true,
            ...(officialRace.timingMethod ? { timingMethod: officialRace.timingMethod } : {}),
            ...(officialRace.splitContext ? { splitContext: officialRace.splitContext } : {}),
          },
        }
      : {}),
    sourceBadges: officialRace ? ['Official FAT', 'Athletic.net'] : ['Garmin'],
  };
}

export function buildSampleDemoCoachSquad(baseDateIso?: string): TeamSummaryWithRole {
  const todayIso = baseDateIso || getLocalDateIso();
  const teamId = 'demo_team_willow_glen_xc';

  const coachMember: TeamMembershipRecord = {
    membershipId: 'demo-mem-coach',
    teamId,
    role: 'HEAD_COACH',
    squadGroup: 'Coaching Staff',
    coachSpecialtyTitle: 'Head Coach',
    invitedName: 'Coach Morales',
    invitedEmail: 'morales@wghs-track.example.org',
    isMinorU18: false,
    status: 'ACTIVE',
    invitedAt: `${shiftDateIso(todayIso, -45)}T08:00:00Z`,
    joinedAt: `${shiftDateIso(todayIso, -45)}T08:05:00Z`,
  };

  const staffMembers: TeamMembershipRecord[] = [
    {
      membershipId: 'demo-mem-coach-dist',
      teamId,
      role: 'ASSISTANT_COACH',
      squadGroup: 'Coaching Staff',
      coachSpecialtyTitle: 'Distance Coach',
      coachEventGroups: ['DISTANCE', 'MID_DISTANCE'],
      invitedName: 'Coach Elena Alvarez',
      invitedEmail: 'alvarez@wghs-track.example.org',
      isMinorU18: false,
      status: 'ACTIVE',
      invitedAt: `${shiftDateIso(todayIso, -44)}T08:00:00Z`,
      joinedAt: `${shiftDateIso(todayIso, -44)}T09:15:00Z`,
    },
    {
      membershipId: 'demo-mem-coach-sp',
      teamId,
      role: 'ASSISTANT_COACH',
      squadGroup: 'Coaching Staff',
      coachSpecialtyTitle: 'Sprints & Hurdles Coach',
      coachEventGroups: ['SPRINTS', 'HURDLES'],
      invitedName: 'Coach Marcus Davis',
      invitedEmail: 'davis@wghs-track.example.org',
      isMinorU18: false,
      status: 'ACTIVE',
      invitedAt: `${shiftDateIso(todayIso, -43)}T08:00:00Z`,
      joinedAt: `${shiftDateIso(todayIso, -43)}T10:00:00Z`,
    },
    {
      membershipId: 'demo-mem-coach-jpv',
      teamId,
      role: 'ASSISTANT_COACH',
      squadGroup: 'Coaching Staff',
      coachSpecialtyTitle: 'Jumps & Pole Vault Coach',
      coachEventGroups: ['JUMPS', 'POLE_VAULT'],
      invitedName: 'Coach Priya Nguyen',
      invitedEmail: 'nguyen@wghs-track.example.org',
      isMinorU18: false,
      status: 'ACTIVE',
      invitedAt: `${shiftDateIso(todayIso, -42)}T08:00:00Z`,
      joinedAt: `${shiftDateIso(todayIso, -42)}T11:20:00Z`,
    },
    {
      membershipId: 'demo-mem-coach-thr',
      teamId,
      role: 'ASSISTANT_COACH',
      squadGroup: 'Coaching Staff',
      coachSpecialtyTitle: 'Throws Coach',
      coachEventGroups: ['THROWS'],
      invitedName: "Coach Sean O'Connor",
      invitedEmail: 'oconnor@wghs-track.example.org',
      isMinorU18: false,
      status: 'ACTIVE',
      invitedAt: `${shiftDateIso(todayIso, -41)}T08:00:00Z`,
      joinedAt: `${shiftDateIso(todayIso, -41)}T14:00:00Z`,
    },
  ];

  const athleteMembers: TeamMembershipRecord[] = DEMO_COACH_ATHLETE_SPECS.map((spec, idx) => {
    const membershipId = `demo-mem-ath-${spec.idNum}`;
    const raceActivity = buildDemoAthleteActivity(
      `demo-race-${spec.idNum}`,
      shiftDateIso(todayIso, -9),
      `Crystal Springs / Track Opener — ${spec.raceEventLabel}`,
      spec.raceDistanceMeters,
      Math.round(spec.fatTimeSecs),
      Math.max(35, Math.round(spec.fatTimeSecs / 12)),
      spec.thresholdPaceSecsPerKm,
      {
        meetName: 'BVAL Center Meet #1',
        eventLabel: spec.raceEventLabel,
        eventDistanceMeters: spec.raceDistanceMeters,
        fatTimeSecs: spec.fatTimeSecs,
        displayFatTime: spec.displayFatTime,
        vdotScore: spec.vdot,
        placeFinish: `#${idx + 1}`,
      }
    );

    const relayFlyingActivity =
      spec.idNum === '09'
        ? buildDemoAthleteActivity(
            `demo-relay-${spec.idNum}`,
            shiftDateIso(todayIso, -5),
            '4x400m Flying Relay Leg #2 (Hand→FAT)',
            400,
            51,
            32,
            spec.thresholdPaceSecsPerKm,
            {
              meetName: 'BVAL Center Meet #1',
              eventLabel: '400m',
              eventDistanceMeters: 400,
              fatTimeSecs: 51.42,
              displayFatTime: '51.42',
              vdotScore: spec.vdot,
              placeFinish: 'Leg #2',
              timingMethod: 'HAND',
              splitContext: 'RELAY_FLYING',
            }
          )
        : null;

    const recentActivities: UnifiedActivity[] = [
      buildDemoAthleteActivity(
        `demo-act-${spec.idNum}-1`,
        shiftDateIso(todayIso, -1),
        idx === 1 ? 'Easy Aerobic Spin (Safe-Sport Swap)' : 'Threshold Aerobic Run · 45m',
        8400,
        2450,
        idx === 2 ? 96 : 64,
        spec.thresholdPaceSecsPerKm
      ),
      buildDemoAthleteActivity(
        `demo-act-${spec.idNum}-3`,
        shiftDateIso(todayIso, -3),
        '4 × 800m CV + 4 × 200m Strides',
        9600,
        2820,
        idx === 2 ? 112 : 78,
        spec.thresholdPaceSecsPerKm
      ),
      buildDemoAthleteActivity(
        `demo-act-${spec.idNum}-5`,
        shiftDateIso(todayIso, -5),
        'Willow Glen Aerobic Loop',
        10200,
        2940,
        62,
        spec.thresholdPaceSecsPerKm
      ),
    ];

    const wellnessDays: UnifiedWellnessDay[] = [];
    for (let d = -6; d <= 0; d++) {
      const dateStr = shiftDateIso(todayIso, d);
      const dayShift = (6 + d) * 0.2;
      wellnessDays.push({
        date: dateStr,
        ctl: Number((spec.ctl - 0.6 + dayShift).toFixed(1)),
        atl: Number((spec.atl - 0.8 + dayShift * 1.2).toFixed(1)),
        tsb: Number((spec.tsb + (d === 0 ? 0 : 0.4)).toFixed(1)),
        loadRatio: Number((spec.atl / Math.max(1, spec.ctl)).toFixed(2)),
        rampRate: Number((spec.ctl * 0.04).toFixed(1)),
        hrvRMSSD: spec.hrv,
        hrvBaseline7d: spec.hrv + 2,
        hrvNormalBandLow: spec.hrv - 8,
        hrvNormalBandHigh: spec.hrv + 8,
        hrvStatus: spec.hrv < 63 ? 'Low' : 'Balanced',
        restingHR: 50 + (idx % 5),
        sleepSecs: 27600,
        sleepScore: spec.readiness,
        weightKg: 0,
        readinessStatus:
          spec.tsb < -18 ? 'Caution' : spec.painFlag ? 'Strain' : 'Optimal',
        dailyLoad: d === -1 ? (idx === 2 ? 96 : 64) : d === -3 ? 78 : 48,
      });
    }

    const sessionCheckIns: SessionCheckInRecord[] = [
      {
        id: `demo-ci-ath-${spec.idNum}-today`,
        date: todayIso,
        rpe: spec.rpe,
        painFlag: Boolean(spec.painFlag),
        ...(spec.painArea ? { painArea: spec.painArea } : {}),
        ...(spec.sorenessNote ? { sorenessNote: spec.sorenessNote } : {}),
        ...(spec.autoSwapped ? { autoSwappedToRecovery: true } : {}),
        legFeel: spec.tsb < -15 || spec.painFlag ? 'HEAVY' : 'FRESH',
        createdAt: `${todayIso}T07:35:00Z`,
      },
      {
        id: `demo-ci-ath-${spec.idNum}-yest`,
        date: shiftDateIso(todayIso, -2),
        rpe: Math.max(4, spec.rpe - 1),
        painFlag: false,
        legFeel: 'NORMAL',
        createdAt: `${shiftDateIso(todayIso, -2)}T17:15:00Z`,
      },
    ];

    return {
      membershipId,
      teamId,
      role: 'ATHLETE',
      squadGroup: spec.squadGroup,
      eventGroup: spec.eventGroup,
      invitedName: spec.name,
      invitedEmail: `${spec.name.toLowerCase().replace(/\s+/g, '.')}@wghs.example.org`,
      parentGuardianEmail: `guardian.${spec.name.toLowerCase().split(' ')[1]}@family.example.org`,
      graduationYear: spec.gradYear,
      birthMonthYear: spec.birthMonthYear,
      isMinorU18: true,
      parentConsentStatus: 'ACKNOWLEDGED',
      seedMarkOrFtp: `${spec.raceEventLabel} ${spec.displayFatTime}`,
      externalSource: 'ATHLETIC_NET',
      externalAthleteId: `anet-wg-${spec.idNum}`,
      status: 'ACTIVE',
      invitedAt: `${shiftDateIso(todayIso, -40)}T09:00:00Z`,
      joinedAt: `${shiftDateIso(todayIso, -38)}T16:10:00Z`,
      sharingTier: 'SUMMARY_ONLY',
      coachRecordedActivities: relayFlyingActivity
        ? [raceActivity, relayFlyingActivity]
        : [raceActivity],
      liveSnapshot: {
        updatedAt: `${todayIso}T08:00:00Z`,
        hasConnectedWatch: spec.idNum !== '12',
        verdictLabel: spec.verdictLabel,
        readinessScore: spec.readiness,
        ctl: spec.ctl,
        atl: spec.atl,
        tsb: spec.tsb,
        acuteLoad7d: Math.round(spec.atl * 6.2),
        lowAerobicPct: 76,
        highAerobicPct: 18,
        neuromuscularPct: 6,
        caraHours7d: Number((5.2 + (idx % 4) * 0.6).toFixed(1)),
        thresholdPaceSecsPerKm: spec.thresholdPaceSecsPerKm,
        safeSportHideWeight: true,
        birthMonthYear: spec.birthMonthYear,
        sharingTier: 'SUMMARY_ONLY',
        wellnessDays,
        activities: recentActivities,
        sessionCheckIns,
        safeSportWatch: {
          trafficLight: spec.painFlag
            ? 'RED_MEDICAL_REVIEW'
            : spec.tsb < -18
              ? 'AMBER_WATCH'
              : 'GREEN_CLEAR',
          coachSafeSummaryLabel: spec.painFlag
            ? 'Medical Check Recommended (Shin Pain)'
            : spec.tsb < -18
              ? 'Elevated Acute Strain (ACWR 1.44)'
              : 'Healthy Baseline',
        },
      },
    };
  });

  const broadcastWorkouts: TeamBroadcastWorkout[] = [
    {
      broadcastId: 'bw_demo_track_cv',
      teamId,
      targetSquadGroup: 'ALL',
      date: shiftDateIso(todayIso, 2),
      name: '4 × 1000m CV + 4 × 200m Strides',
      sportCategory: 'Running',
      plannedDurationSecs: 3300,
      plannedLoad: 74,
      workoutSyntax:
        'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 4x1000m at CV pace (90s jog)\n\nMain Set 2\n- 4x200m at mile pace (200m jog)\n\nCooldown\n- 1.5mi Z1 Cooldown',
      description: '2 mi WU · 4×1000m CV + 4×200m Strides · 1.5 mi CD',
      scheduledTime: '15:45',
      sessionSlot: 'SINGLE',
      locationName: 'Willow Glen Track',
      locationCategory: 'TRACK',
      pushedByCoachName: 'Coach Morales',
      createdAt: `${todayIso}T09:00:00Z`,
    },
    {
      broadcastId: 'bw_demo_meet_bval2',
      teamId,
      targetSquadGroup: 'ALL',
      date: shiftDateIso(todayIso, 6),
      name: 'BVAL League Center Meet #2 @ Montgomery Hill',
      sportCategory: 'Running',
      plannedDurationSecs: 3600,
      plannedLoad: 88,
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 1x4800m at CV pace (3m)',
      description: 'Bus departs Willow Glen HS main gate at 13:30.',
      scheduledTime: '15:30',
      locationName: 'Montgomery Hill Park',
      locationCategory: 'XC_COURSE',
      isOfficialMeet: true,
      externalSource: 'ATHLETIC_NET',
      pushedByCoachName: 'Coach Morales',
      createdAt: `${todayIso}T09:00:00Z`,
    },
    {
      broadcastId: 'bw_demo_meet_crystal',
      teamId,
      targetSquadGroup: 'ALL',
      date: shiftDateIso(todayIso, 14),
      name: 'Crystal Springs Invitational (2.95 mi XC)',
      sportCategory: 'Running',
      plannedDurationSecs: 3600,
      plannedLoad: 92,
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 1x4750m at 5K pace (3m)',
      description: 'Varsity & JV races at Hallmark Park / Crystal Springs course.',
      scheduledTime: '10:00',
      locationName: 'Crystal Springs XC Course, Belmont',
      locationCategory: 'XC_COURSE',
      isOfficialMeet: true,
      externalSource: 'ATHLETIC_NET',
      pushedByCoachName: 'Coach Morales',
      createdAt: `${todayIso}T09:00:00Z`,
    },
    {
      broadcastId: 'bw_demo_meet_ccs',
      teamId,
      targetSquadGroup: 'Varsity',
      date: shiftDateIso(todayIso, 28),
      name: 'CCS Section XC Championships',
      sportCategory: 'Running',
      plannedDurationSecs: 3900,
      plannedLoad: 95,
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 1x4800m at 5K pace (3m)',
      description: 'Toro Park 3.0 mi Championship Course.',
      scheduledTime: '11:15',
      locationName: 'Toro Park, Salinas',
      locationCategory: 'XC_COURSE',
      isOfficialMeet: true,
      externalSource: 'ATHLETIC_NET',
      pushedByCoachName: 'Coach Morales',
      createdAt: `${todayIso}T09:00:00Z`,
    },
  ];

  const workoutLibrary: TeamWorkoutLibraryTemplate[] = [
    {
      id: 'lib-demo-cv-800s',
      name: '5×800m CV + 4×200m R',
      category: 'TRACK',
      sportCategory: 'Running',
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 5x800m at CV pace (90s jog)\n\nMain Set 2\n- 4x200m at mile pace (200m jog)\n\nCooldown\n- 2mi Z1 Cooldown',
      description: 'Aerobic power + closing leg turnover for 1600m/5000m runners.',
      plannedDurationSecs: 3420,
      plannedLoad: 78,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -12)}T12:00:00Z`,
    },
    {
      id: 'lib-demo-subt-1000',
      name: '6×1000m Sub-T Track Ladder',
      category: 'TRACK',
      sportCategory: 'Running',
      workoutSyntax: 'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 6x1000m at Sub-T pace (60s jog)\n\nCooldown\n- 1.5mi Z1 Cooldown',
      description: 'Bakken-style controlled lactate ceiling with short 60s float.',
      plannedDurationSecs: 3600,
      plannedLoad: 76,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -10)}T12:00:00Z`,
    },
    {
      id: 'lib-demo-xc-hills',
      name: 'Montgomery Hill XC Tempo + 6×150m',
      category: 'XC_TEMPO',
      sportCategory: 'Running',
      workoutSyntax: 'Warmup\n- 1.5mi Z1 Warmup\n\nMain Set 1\n- 3x1600m at CV pace (90s jog)\n\nMain Set 2\n- 6x150m at mile pace (walk back)\n\nCooldown\n- 1.5mi Z1 Cooldown',
      description: 'Specific undulating XC strength before BVAL meets.',
      plannedDurationSecs: 3300,
      plannedLoad: 74,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -8)}T12:00:00Z`,
    },
    {
      id: 'lib-demo-road-prog',
      name: '40m Aerobic Progression Run',
      category: 'ROAD',
      sportCategory: 'Running',
      workoutSyntax: 'Warmup\n- 10m 68% Pace\n\nMain Set 1\n- 30m 84% Pace\n\nCooldown\n- 10m 66% Pace',
      description: 'Controlled midweek aerobic durability block.',
      plannedDurationSecs: 3000,
      plannedLoad: 64,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -6)}T12:00:00Z`,
    },
    {
      id: 'lib-demo-spin-flush',
      name: 'Zero-Impact Aerobic Spin Flush (45m)',
      category: 'CYCLING',
      sportCategory: 'Cycling',
      workoutSyntax: 'Warmup\n- 10m 55% FTP Warmup\n\nMain Set 1\n- 25m 68% FTP (95 rpm)\n\nCooldown\n- 10m 52% FTP Cooldown',
      description: 'Shin-safe cross-training load substitution.',
      plannedDurationSecs: 2700,
      plannedLoad: 42,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -5)}T12:00:00Z`,
    },
    {
      id: 'lib-demo-shakeout',
      name: 'Pre-Meet Shakeout + 4×100m Strides',
      category: 'RECOVERY',
      sportCategory: 'Running',
      workoutSyntax: 'Warmup\n- 1.5mi Z1 Warmup\n\nMain Set 1\n- 4x150m at mile pace (90s walk)\n\nCooldown\n- 1mi Z1 Cooldown',
      description: 'Neuromuscular prime 24h before Invitational racing.',
      plannedDurationSecs: 1800,
      plannedLoad: 32,
      createdByName: 'Coach Morales',
      createdAt: `${shiftDateIso(todayIso, -4)}T12:00:00Z`,
    },
  ];

  const workoutComments: TeamWorkoutComment[] = [
    {
      id: 'demo-comment-1',
      teamId,
      targetMembershipId: 'demo-mem-ath-02',
      targetAthleteName: 'Maya Chen',
      workoutDate: todayIso,
      authorSid: 'demo-mem-coach',
      authorName: 'Coach Morales',
      authorRole: 'HEAD_COACH',
      body: 'Saw the right medial shin soreness flag — keep today on the stationary bike spin (Z1/Z2) and check in with our Athletic Trainer after 6th period.',
      guardianCcApplied: true,
      guardianVisible: true,
      createdAt: `${todayIso}T08:10:00Z`,
    },
    {
      id: 'demo-comment-2',
      teamId,
      targetMembershipId: 'demo-mem-ath-01',
      targetAthleteName: 'Lucas Alvarez',
      workoutDate: shiftDateIso(todayIso, -1),
      authorSid: 'demo-mem-coach',
      authorName: 'Coach Morales',
      authorRole: 'HEAD_COACH',
      body: 'Strong even splits on the final 800m rep. Stay capped at CV pace on Thursday ahead of BVAL #2.',
      guardianCcApplied: true,
      guardianVisible: true,
      createdAt: `${shiftDateIso(todayIso, -1)}T18:20:00Z`,
    },
  ];

  const guardianSafetyAlerts: GuardianSafetyAlertRecord[] = [
    {
      id: 'demo-alert-maya-shin',
      teamId,
      targetMembershipId: 'demo-mem-ath-02',
      athleteName: 'Maya Chen',
      sourceCheckInId: 'demo-ci-ath-02-today',
      severity: 'HIGH',
      category: 'PAIN_FLAG',
      summary:
        'Maya Chen reported right medial shin pain (SHIN) and auto-swapped to Easy Aerobic Spin (Zero-Impact).',
      painLocation: 'SHIN',
      guardianEmailMasked: 'g***@family.example.org',
      deliveryStatus: 'SENT',
      createdAt: `${todayIso}T07:42:00Z`,
    },
  ];

  const teamMessages: TeamMessageRecord[] = [
    {
      id: 'demo-msg-all-1',
      teamId,
      channelId: 'team:all',
      channelScope: 'ALL_TEAM',
      senderSid: 'demo-coach-sid',
      senderMembershipId: 'demo-mem-coach',
      senderName: 'Coach Morales',
      senderRole: 'HEAD_COACH',
      body: 'Track practice starts 3:15 PM sharp today. Bring training flats AND spikes for curve exchanges.',
      createdAt: `${todayIso}T09:00:00Z`,
      guardianCcApplied: true,
      secondAdultVisible: true,
      acknowledgedByMembershipIds: ['demo-mem-ath-01', 'demo-mem-ath-02'],
    },
    {
      id: 'demo-msg-sprints-1',
      teamId,
      channelId: 'group:SPRINTS',
      channelScope: 'EVENT_GROUP',
      eventGroup: 'SPRINTS',
      senderSid: 'demo-coach-sid',
      senderMembershipId: 'demo-mem-coach',
      senderName: 'Coach Morales',
      senderRole: 'HEAD_COACH',
      body: 'Sprints & 4x100m crew: blind handoff tape marks at 18 steps in Lane 4 today.',
      createdAt: `${todayIso}T09:15:00Z`,
      guardianCcApplied: true,
      secondAdultVisible: true,
      acknowledgedByMembershipIds: ['demo-mem-coach'],
    },
    {
      id: 'demo-msg-staff-1',
      teamId,
      channelId: 'staff:only',
      channelScope: 'COACHES_STAFF',
      senderSid: 'demo-coach-sid',
      senderMembershipId: 'demo-mem-coach',
      senderName: 'Coach Morales',
      senderRole: 'HEAD_COACH',
      body: 'Staff note: Maya Chen flagged mild right shin tightness this morning; cap her on grass tempo today.',
      createdAt: `${todayIso}T09:20:00Z`,
      guardianCcApplied: false,
      secondAdultVisible: true,
      acknowledgedByMembershipIds: ['demo-mem-coach'],
    },
    {
      id: 'demo-msg-dm-1',
      teamId,
      channelId: 'dm:demo-mem-ath-02',
      channelScope: 'DIRECT_TRANSPARENT',
      targetMembershipId: 'demo-mem-ath-02',
      targetAthleteName: 'Maya Chen',
      senderSid: 'demo-coach-sid',
      senderMembershipId: 'demo-mem-coach',
      senderName: 'Coach Morales',
      senderRole: 'HEAD_COACH',
      body: 'Saw your shin soreness note — switch to pool/bike flush today. Guardian CC included.',
      createdAt: `${todayIso}T09:25:00Z`,
      guardianCcApplied: true,
      secondAdultVisible: true,
      acknowledgedByMembershipIds: ['demo-mem-coach'],
    },
  ];

  const messagingPolicy: TeamMessagingPolicy = {
    athleteRepliesEnabled: true,
    quietHoursStartHour: 21,
    quietHoursEndHour: 6,
    requireGuardianCcForMinors: true,
  };

  return {
    brand: {
      teamId,
      slug: 'willow-glen-high-school-xc',
      joinCode: 'WGHS26',
      name: 'Willow Glen High School XC',
      shortName: 'WGHS XC',
      mascotOrMotto: 'Rams XC & Track',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      primaryHex: '#1C5436',
      secondaryHex: '#C8FF00',
      defaultSafeSportShield: true,
      enableParentGuardianCc: true,
      coachDisplayName: 'Coach Morales',
      planTier: 'FOUNDING_TEAM',
      externalSync: {
        platform: 'ATHLETIC_NET',
        athleticNetSchoolId: '1073',
        athleticNetSportSlug: 'xc',
        athleticNetUrl: 'https://www.athletic.net/CrossCountry/School.aspx?SchoolID=1073',
        teamFilterKeyword: 'Willow Glen',
        enablePublicParentHub: true,
        lastSyncedAt: `${todayIso}T08:00:00Z`,
      },
      createdAt: `${shiftDateIso(todayIso, -45)}T08:00:00Z`,
    },
    myRole: 'HEAD_COACH',
    mySquadGroup: 'Coaching Staff',
    myCoachSpecialtyTitle: 'Head Coach',
    myMembershipId: 'demo-mem-coach',
    totalInvited: athleteMembers.length,
    openedCount: athleteMembers.length,
    activeCount: athleteMembers.length,
    watchConnectedCount: 11,
    memberships: [coachMember, ...staffMembers, ...athleteMembers],
    broadcastWorkouts,
    workoutLibrary,
    workoutComments,
    guardianSafetyAlerts,
    teamMessages,
    messagingPolicy,
  };
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
    demoTeams: [buildSampleDemoCoachSquad(todayIso)],
  };
}
