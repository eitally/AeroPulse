import {
  AthletePrivacySettings,
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';
import { synthesizeOfficialRaceActivity } from '../utils/officialRaceSynthesizer';

export const DEFAULT_SELF_PRIVACY_SETTINGS: AthletePrivacySettings = {
  shareWellnessAndHrv: 'COACHES_ONLY',
  sharePmcAndZones: 'ALL_CONNECTIONS',
  shareGpsRoutes: 'COACHES_ONLY',
  stravaComplianceShield: true,
  allowCoachCalendarEdits: true,
};

function buildWellnessSeriesForAthlete(
  seedCtl: number,
  seedAtl: number,
  seedHrv: number,
  restingHr: number,
  weightKg: number,
  rideEftp: number,
  runEftp: number,
  vo2MaxCycling: number,
  vo2MaxRunning: number
): UnifiedWellnessDay[] {
  const days: UnifiedWellnessDay[] = [];
  const baseDate = new Date(Date.UTC(2026, 10, 6)); // 2026-11-06
  let ctl = seedCtl - 6;
  let atl = seedAtl - 4;

  for (let i = 41; i >= 0; i--) {
    const dt = new Date(baseDate.getTime() - i * 86400 * 1000);
    const dateStr = dt.toISOString().slice(0, 10);
    const wave = Math.sin(i * 0.45);
    const dailyLoad = i % 7 === 1 ? 0 : Math.round(52 + wave * 28 + (i % 3 === 0 ? 24 : 0));
    ctl = Number((ctl + (dailyLoad - ctl) / 42).toFixed(1));
    atl = Number((atl + (dailyLoad - atl) / 7).toFixed(1));
    const tsb = Number((ctl - atl).toFixed(1));
    const hrv = Math.round(seedHrv + Math.cos(i * 0.5) * 4);
    const sleepScore = Math.min(96, Math.max(68, Math.round(82 + Math.sin(i * 0.6) * 8)));

    days.push({
      date: dateStr,
      ctl,
      atl,
      tsb,
      loadRatio: Number((atl / Math.max(20, ctl)).toFixed(2)),
      rampRate: Number(((ctl - (seedCtl - 6)) / 6).toFixed(1)),
      hrvRMSSD: hrv,
      hrvBaseline7d: seedHrv,
      hrvNormalBandLow: seedHrv - 7,
      hrvNormalBandHigh: seedHrv + 9,
      hrvStatus: hrv >= seedHrv - 4 ? 'Balanced' : 'Unbalanced',
      restingHR: restingHr + (hrv < seedHrv - 3 ? 2 : 0),
      sleepSecs: Math.round((7.2 + Math.sin(i * 0.4) * 0.6) * 3600),
      sleepScore,
      sleepQuality: sleepScore >= 82 ? 1 : 2,
      sleepDebt7dSecs: 1800,
      weightKg,
      vo2MaxCycling,
      vo2MaxRunning,
      rideEftp,
      runEftp,
      garminTrainingStatus: tsb >= 4 ? 'Peaking' : tsb >= -12 ? 'Productive' : 'Strained',
      trainingStatusReason:
        tsb >= 4
          ? 'High aerobic fitness with positive freshness (+TSB) and balanced nocturnal HRV.'
          : 'Progressive threshold & VO2max load well-absorbed within HRV corridor.',
      readinessStatus: hrv >= seedHrv - 4 && tsb >= -18 ? 'Optimal' : 'Caution',
      dailyLoad,
    });
  }
  return days;
}

export function buildInitialConnectedAthletes(): ConnectedAthleteRecord[] {
  // 1. Maya Lin — Coached Sub-20:00 5K & Track 1500m/800m Specialist (COACH_EDIT)
  const mayaProfile = buildCompleteAthleteProfile({
    athleteId: 'strava-4918204',
    name: 'Maya Lin',
    weightKg: 56.5,
    restingHr: 44,
    vo2MaxCycling: 58,
    vo2MaxRunning: 64,
    ftp: 245,
    indoorFtp: 240,
    eFtp: 248,
    lthr: 174,
    maxHr: 194,
    runFtp: 295,
    runEFtp: 298,
    runLthr: 176,
    runMaxHr: 196,
    thresholdPaceSecsPerKm: 232, // 3:52/km (~6:13/mi)
    source: 'INTERVALS_GARMIN',
    lastSyncedAt: '2026-11-06T08:15:00Z',
  });

  const mayaOfficial800 = synthesizeOfficialRaceActivity(
    {
      id: 'maya-fat-800',
      date: '2026-11-01',
      meetName: 'Bay Area Track Club Twilight',
      eventLabel: '800m',
      eventDistanceMeters: 800,
      fatTimeSecs: 128.44,
      displayFatTime: '2:08.44',
      platform: 'TFRRS',
      trackType: 'OUTDOOR_400M',
      placeFinish: '1st (Collegiate Open)',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [62.84, 65.60],
      includeWarmupCooldown: true,
    },
    176,
    196
  );

  const mayaOfficial1500 = synthesizeOfficialRaceActivity(
    {
      id: 'maya-fat-1500',
      date: '2026-10-24',
      meetName: 'Stanford Cobb Track Invitational',
      eventLabel: '1500m',
      eventDistanceMeters: 1500,
      fatTimeSecs: 261.18,
      displayFatTime: '4:21.18',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      placeFinish: '2nd (Final)',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [49.8, 69.9, 71.2, 70.28],
      includeWarmupCooldown: true,
    },
    176,
    196
  );

  const mayaActivities: UnifiedActivity[] = [
    {
      id: 'maya-act-1',
      startDateLocal: '2026-11-06T07:15:00',
      name: 'Track 6x800m Cruise VO2max + 4x200m Strides',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Track',
      movingTimeSecs: 3420,
      distanceMeters: 12400,
      elevationGainMeters: 18,
      trainingLoad: 82,
      avgHr: 168,
      maxHr: 189,
      avgCadence: 188,
      avgPaceSecsPerKm: 238,
      gapPaceSecsPerKm: 237,
      aerobicDecouplingPct: 1.8,
      efficiencyFactor: 1.49,
      firstHalfEf: 1.5,
      secondHalfEf: 1.48,
      deviceName: 'Garmin Forerunner 965',
      zoneSecs: {
        hr: [420, 1200, 480, 620, 520, 180, 0],
        pace: [420, 1200, 480, 620, 520, 180, 0],
      },
      stravaPrCount: 2,
      kudosCount: 18,
      routeLatLngs: [
        [37.4346, -122.1615],
        [37.4358, -122.1632],
        [37.4342, -122.1645],
        [37.4346, -122.1615],
      ],
      segmentEfforts: [],
      sourceBadges: ['Garmin', 'Intervals.icu', 'Strava'],
    },
    {
      id: 'maya-act-2',
      startDateLocal: '2026-11-04T06:45:00',
      name: ' Baylands Aerobic Base Progression Run',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3900,
      distanceMeters: 14800,
      elevationGainMeters: 42,
      trainingLoad: 68,
      avgHr: 151,
      maxHr: 168,
      avgCadence: 182,
      avgPaceSecsPerKm: 263,
      gapPaceSecsPerKm: 261,
      aerobicDecouplingPct: 2.1,
      efficiencyFactor: 1.48,
      firstHalfEf: 1.49,
      secondHalfEf: 1.46,
      deviceName: 'Garmin Forerunner 965',
      zoneSecs: {
        hr: [360, 2940, 600, 0, 0, 0, 0],
        pace: [360, 2940, 600, 0, 0, 0, 0],
      },
      stravaPrCount: 0,
      kudosCount: 14,
      routeLatLngs: [
        [37.4512, -122.1125],
        [37.4601, -122.1045],
        [37.4565, -122.0985],
      ],
      segmentEfforts: [],
      sourceBadges: ['Garmin', 'Intervals.icu'],
    },
    mayaOfficial800,
    mayaOfficial1500,
  ];

  const mayaPlanned: PlannedWorkoutEvent[] = [
    {
      id: 'maya-plan-1',
      date: '2026-11-07',
      name: '5x1000m Sub-20 5K Specific Threshold (3:52/km)',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Execute 5x1km at 3:52/km with 90s jog recovery. Focus on relaxed shoulders.',
      plannedLoad: 78,
      plannedDurationSecs: 3600,
      targetZoneSummary: 'Z4/Z5 Threshold + VO2max',
      workoutSyntax: `- 15m 70% Pace Warmup\n- 5x 4m 102% Pace (90s 65% Pace Recovery)\n- 10m 68% Pace Cooldown`,
      source: 'AI_COACH',
    },
    {
      id: 'maya-plan-2',
      date: '2026-11-08',
      name: '90m Sunday Aerobic Long Run (Z2)',
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: 'Keep heart rate strictly below 156 bpm (<3% Pa:Hr decoupling).',
      plannedLoad: 92,
      plannedDurationSecs: 5400,
      targetZoneSummary: 'Z2 Aerobic Endurance',
      workoutSyntax: `- 15m 72% Pace Warmup\n- 65m 78% Pace Z2 Endurance\n- 10m 70% Pace Cooldown`,
      source: 'USER',
    },
  ];

  const mayaGoals: TargetGoal[] = [
    {
      id: 'maya-goal-1',
      title: 'Sub-18:45 5K & 4:18 1500m Track Peak',
      type: 'RACE_EVENT',
      sportCategory: 'Running',
      targetDate: '2026-12-12',
      priority: 'A-Race',
      targetCtl: 74,
      currentValue: 68.4,
      targetValue: 74,
      unit: 'CTL',
      notes: 'Coached block targeting NCAA / Club Track Qualifier.',
    },
  ];

  // 2. Lucas Vance — Coached 350W FTP Cyclist (COACH_EDIT)
  const lucasProfile = buildCompleteAthleteProfile({
    athleteId: 'strava-8821930',
    name: 'Lucas Vance',
    weightKg: 74.0,
    restingHr: 46,
    vo2MaxCycling: 66,
    vo2MaxRunning: 56,
    ftp: 334,
    indoorFtp: 326,
    eFtp: 338,
    lthr: 169,
    maxHr: 188,
    runFtp: 310,
    runEFtp: 312,
    runLthr: 173,
    runMaxHr: 190,
    thresholdPaceSecsPerKm: 248,
    source: 'INTERVALS_GARMIN',
    lastSyncedAt: '2026-11-06T07:50:00Z',
  });

  const lucasActivities: UnifiedActivity[] = [
    {
      id: 'lucas-act-1',
      startDateLocal: '2026-11-06T06:30:00',
      name: 'Kings Mountain 3x12m Over-Unders (330W / 355W)',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 5400,
      distanceMeters: 48500,
      elevationGainMeters: 920,
      avgPower: 278,
      normalizedPower: 312,
      intensityFactor: 0.93,
      variabilityIndex: 1.12,
      trainingLoad: 128,
      avgHr: 158,
      maxHr: 182,
      avgCadence: 91,
      aerobicDecouplingPct: 2.2,
      efficiencyFactor: 1.97,
      firstHalfEf: 1.99,
      secondHalfEf: 1.95,
      deviceName: 'Garmin Edge 1040 Solar',
      zoneSecs: {
        hr: [600, 1800, 900, 1400, 580, 120, 0],
        power: [600, 1650, 850, 1500, 620, 180, 0],
      },
      stravaPrCount: 3,
      kudosCount: 27,
      routeLatLngs: [
        [37.4285, -122.2512],
        [37.4412, -122.2845],
        [37.452, -122.301],
      ],
      segmentEfforts: [],
      sourceBadges: ['Garmin', 'Intervals.icu', 'Strava'],
    },
    {
      id: 'lucas-act-2',
      startDateLocal: '2026-11-04T17:15:00',
      name: 'Zwift - Watopia Flat Route Z2 Durability Spin',
      sportCategory: 'Cycling',
      environment: 'INDOOR',
      subType: 'Virtual Cycling',
      movingTimeSecs: 4200,
      distanceMeters: 41200,
      elevationGainMeters: 240,
      avgPower: 228,
      normalizedPower: 234,
      intensityFactor: 0.72,
      variabilityIndex: 1.03,
      trainingLoad: 61,
      avgHr: 136,
      maxHr: 148,
      avgCadence: 93,
      aerobicDecouplingPct: 1.4,
      efficiencyFactor: 1.72,
      firstHalfEf: 1.73,
      secondHalfEf: 1.71,
      deviceName: 'Wahoo KICKR v6',
      zoneSecs: {
        hr: [420, 3480, 300, 0, 0, 0, 0],
        power: [360, 3540, 300, 0, 0, 0, 0],
      },
      stravaPrCount: 0,
      kudosCount: 16,
      segmentEfforts: [],
      sourceBadges: ['Intervals.icu', 'Strava'],
    },
  ];

  const lucasPlanned: PlannedWorkoutEvent[] = [
    {
      id: 'lucas-plan-1',
      date: '2026-11-07',
      name: '4x8m VO2max / Threshold Bridge Toward 350W FTP',
      sportCategory: 'Cycling',
      environmentPreference: 'FLEXIBLE',
      description: 'Hold 348–355W on each 8m effort with 4m @ 180W recovery.',
      plannedLoad: 96,
      plannedDurationSecs: 4500,
      targetZoneSummary: 'Z4/Z5 Threshold Bridge',
      workoutSyntax: `- 15m 60% FTP Warmup\n- 4x 8m 104% FTP (4m 55% FTP Recovery)\n- 12m 55% FTP Cooldown`,
      source: 'AI_COACH',
    },
  ];

  const lucasGoals: TargetGoal[] = [
    {
      id: 'lucas-goal-1',
      title: '350W Outdoor FTP (4.73 W/kg) & Pescadero Road Race',
      type: 'PERFORMANCE_METRIC',
      sportCategory: 'Cycling',
      targetDate: '2027-01-18',
      priority: 'A-Race',
      targetCtl: 92,
      currentValue: 334,
      targetValue: 350,
      unit: 'W',
      notes: '16W remaining to hit 350W FTP milestone.',
    },
  ];

  // 3. Elena Rostova — Friend / Training Partner (FRIEND_VIEW with Privacy Shield enabled on GPS & HRV)
  const elenaProfile = buildCompleteAthleteProfile({
    athleteId: 'strava-6610294',
    name: 'Elena Rostova',
    weightKg: 61.0,
    restingHr: 48,
    vo2MaxCycling: 54,
    vo2MaxRunning: 59,
    ftp: 230,
    indoorFtp: 225,
    eFtp: 232,
    lthr: 171,
    maxHr: 190,
    runFtp: 280,
    runEFtp: 284,
    runLthr: 173,
    runMaxHr: 191,
    thresholdPaceSecsPerKm: 249, // 4:09/km
    source: 'INTERVALS_GARMIN',
    lastSyncedAt: '2026-11-06T09:00:00Z',
  });

  const elenaActivities: UnifiedActivity[] = [
    {
      id: 'elena-act-1',
      startDateLocal: '2026-11-05T07:30:00',
      name: 'Golden Gate Park 3x2 Mile Half-Marathon Tempo',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 4140,
      distanceMeters: 16200,
      elevationGainMeters: 95,
      trainingLoad: 88,
      avgHr: 166,
      maxHr: 179,
      avgCadence: 180,
      avgPaceSecsPerKm: 255,
      gapPaceSecsPerKm: 251,
      aerobicDecouplingPct: 2.4,
      efficiencyFactor: 1.42,
      firstHalfEf: 1.44,
      secondHalfEf: 1.4,
      deviceName: 'COROS PACE 3',
      zoneSecs: {
        hr: [480, 1260, 1500, 900, 0, 0, 0],
        pace: [480, 1260, 1500, 900, 0, 0, 0],
      },
      stravaPrCount: 1,
      kudosCount: 22,
      routeLatLngs: [
        [37.7694, -122.4862],
        [37.7705, -122.4612],
      ],
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    },
  ];

  // 4. Devon Brooks — Pending Incoming Follow/Coach Request
  const devonProfile = buildCompleteAthleteProfile({
    athleteId: 'strava-9910442',
    name: 'Devon Brooks',
    weightKg: 66.0,
    restingHr: 45,
    vo2MaxCycling: 56,
    vo2MaxRunning: 67,
    ftp: 275,
    indoorFtp: 270,
    eFtp: 278,
    lthr: 175,
    maxHr: 196,
    runFtp: 340,
    runEFtp: 344,
    runLthr: 178,
    runMaxHr: 198,
    thresholdPaceSecsPerKm: 218, // 3:38/km
    source: 'INTERVALS_GARMIN',
    lastSyncedAt: '2026-11-06T06:00:00Z',
  });

  const devonOfficial1600 = synthesizeOfficialRaceActivity(
    {
      id: 'devon-fat-1600',
      date: '2026-10-31',
      meetName: 'West Coast Mile Night',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      fatTimeSecs: 251.64,
      displayFatTime: '4:11.64',
      platform: 'Athletic.net',
      trackType: 'OUTDOOR_400M',
      placeFinish: '1st (Championship Heat)',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [61.8, 63.9, 64.2, 61.74],
      includeWarmupCooldown: true,
    },
    178,
    198
  );

  return [
    {
      id: 'athlete-maya-lin',
      name: 'Maya Lin',
      avatarInitials: 'ML',
      location: 'Palo Alto, CA',
      stravaAthleteId: '4918204',
      inviteCode: 'AP-3104-MAYA',
      role: 'COACH_EDIT',
      status: 'CONNECTED',
      primaryGoalSummary: 'Sub-18:45 5K & 4:18 1500m Track',
      primarySport: 'Running',
      athleteProfile: mayaProfile,
      privacySettings: {
        shareWellnessAndHrv: 'ALL_CONNECTIONS',
        sharePmcAndZones: 'ALL_CONNECTIONS',
        shareGpsRoutes: 'COACHES_ONLY',
        stravaComplianceShield: true,
        allowCoachCalendarEdits: true,
      },
      wellnessDays: buildWellnessSeriesForAthlete(68.4, 62.1, 61, 44, 56.5, 248, 298, 58, 64),
      activities: mayaActivities,
      plannedEvents: mayaPlanned,
      targetGoals: mayaGoals,
    },
    {
      id: 'athlete-lucas-vance',
      name: 'Lucas Vance',
      avatarInitials: 'LV',
      location: 'Menlo Park, CA',
      stravaAthleteId: '8821930',
      inviteCode: 'AP-7721-LUCAS',
      role: 'COACH_EDIT',
      status: 'CONNECTED',
      primaryGoalSummary: '350W Outdoor FTP (4.73 W/kg)',
      primarySport: 'Cycling',
      athleteProfile: lucasProfile,
      privacySettings: {
        shareWellnessAndHrv: 'COACHES_ONLY',
        sharePmcAndZones: 'ALL_CONNECTIONS',
        shareGpsRoutes: 'ALL_CONNECTIONS',
        stravaComplianceShield: true,
        allowCoachCalendarEdits: true,
      },
      wellnessDays: buildWellnessSeriesForAthlete(86.2, 79.4, 54, 46, 74.0, 338, 312, 66, 56),
      activities: lucasActivities,
      plannedEvents: lucasPlanned,
      targetGoals: lucasGoals,
    },
    {
      id: 'athlete-elena-rostova',
      name: 'Elena Rostova',
      avatarInitials: 'ER',
      location: 'San Francisco, CA',
      stravaAthleteId: '6610294',
      inviteCode: 'AP-4490-ELENA',
      role: 'FRIEND_VIEW',
      status: 'CONNECTED',
      primaryGoalSummary: '1:28:00 Half Marathon in 10 Weeks',
      primarySport: 'Running',
      athleteProfile: elenaProfile,
      privacySettings: {
        shareWellnessAndHrv: 'COACHES_ONLY', // Friend view will redact raw morning HRV/RHR!
        sharePmcAndZones: 'ALL_CONNECTIONS',
        shareGpsRoutes: 'COACHES_ONLY', // Friend view will redact GPS polylines!
        stravaComplianceShield: true,
        allowCoachCalendarEdits: false,
      },
      wellnessDays: buildWellnessSeriesForAthlete(61.5, 66.8, 57, 48, 61.0, 232, 284, 54, 59),
      activities: elenaActivities,
      plannedEvents: [
        {
          id: 'elena-plan-1',
          date: '2026-11-07',
          name: '16km Progressive Half-Marathon Tempo',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          description: 'Middle 10km at 4:10/km goal half-marathon pace.',
          plannedLoad: 84,
          plannedDurationSecs: 4200,
          targetZoneSummary: 'Z3/Z4 Tempo Progression',
          workoutSyntax: `- 15m 72% Pace Warmup\n- 40m 94% Pace HM Tempo\n- 15m 70% Pace Cooldown`,
          source: 'USER',
        },
      ],
      targetGoals: [
        {
          id: 'elena-goal-1',
          title: '1:28:00 Half Marathon',
          type: 'RACE_EVENT',
          sportCategory: 'Running',
          targetDate: '2027-01-24',
          priority: 'A-Race',
          targetCtl: 70,
          currentValue: 61.5,
          targetValue: 70,
          unit: 'CTL',
          notes: 'Winter Half Marathon A-Race.',
        },
      ],
    },
    {
      id: 'athlete-devon-brooks',
      name: 'Devon Brooks',
      avatarInitials: 'DB',
      location: 'Berkeley, CA',
      stravaAthleteId: '9910442',
      inviteCode: 'AP-5520-DEVON',
      role: 'COACH_EDIT',
      status: 'PENDING_INCOMING',
      primaryGoalSummary: '4:08 1600m & 1:52 800m Track',
      primarySport: 'Running',
      athleteProfile: devonProfile,
      privacySettings: {
        shareWellnessAndHrv: 'ALL_CONNECTIONS',
        sharePmcAndZones: 'ALL_CONNECTIONS',
        shareGpsRoutes: 'ALL_CONNECTIONS',
        stravaComplianceShield: true,
        allowCoachCalendarEdits: true,
      },
      wellnessDays: buildWellnessSeriesForAthlete(74.0, 68.5, 65, 45, 66.0, 278, 344, 56, 67),
      activities: [devonOfficial1600],
      plannedEvents: [],
      targetGoals: [
        {
          id: 'devon-goal-1',
          title: 'Sub-4:10 1600m & Sub-1:53 800m',
          type: 'RACE_EVENT',
          sportCategory: 'Running',
          targetDate: '2027-03-15',
          priority: 'A-Race',
          targetCtl: 78,
          currentValue: 74,
          targetValue: 78,
          unit: 'CTL',
          notes: 'Track season middle-distance peak.',
        },
      ],
    },
  ];
}

/**
 * Applies the athlete's granular Privacy Settings & Strava API Compliance Shield
 * based on whether the viewer has 'COACH_EDIT' or 'FRIEND_VIEW' access.
 */
export function applyAthletePrivacyShield(record: ConnectedAthleteRecord): {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  redactedWellness: boolean;
  redactedGpsRoutes: boolean;
} {
  const isCoach = record.role === 'COACH_EDIT';
  const p = record.privacySettings;

  const allowWellness =
    p.shareWellnessAndHrv === 'ALL_CONNECTIONS' ||
    (p.shareWellnessAndHrv === 'COACHES_ONLY' && isCoach);

  const allowGps =
    p.shareGpsRoutes === 'ALL_CONNECTIONS' ||
    (p.shareGpsRoutes === 'COACHES_ONLY' && isCoach);

  const filteredWellness = record.wellnessDays.map((w) => {
    if (allowWellness) return w;
    return {
      ...w,
      hrvRMSSD: 0,
      restingHR: 0,
      sleepScore: 0,
      sleepSecs: 0,
    };
  });

  const filteredActivities = record.activities.map((a) => {
    const isStravaOnly =
      a.sourceBadges.length === 1 && a.sourceBadges[0] === 'Strava';
    const shouldRedactRoute = !allowGps || (p.stravaComplianceShield && isStravaOnly && !isCoach);
    if (!shouldRedactRoute) return a;
    return {
      ...a,
      routeLatLngs: undefined,
      summaryPolyline: undefined,
      streams: a.streams
        ? {
            ...a.streams,
            latlng: undefined,
          }
        : undefined,
    };
  });

  return {
    wellnessDays: filteredWellness,
    activities: filteredActivities,
    redactedWellness: !allowWellness,
    redactedGpsRoutes: !allowGps,
  };
}
