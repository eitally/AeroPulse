export type SportCategory = 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport';

export type ActivityEnvironment = 'OUTDOOR' | 'INDOOR';

export type EnvironmentFilter = 'COMBINED' | 'OUTDOOR' | 'INDOOR';

export type DistanceUnit = 'mi' | 'km';

export type GarminTrainingStatus =
  | 'Peaking'
  | 'Productive'
  | 'Maintaining'
  | 'Recovery'
  | 'Unproductive'
  | 'Strained'
  | 'Overreaching'
  | 'Detraining';

export type GarminHrvStatus = 'Balanced' | 'Unbalanced' | 'Low';

export interface UnifiedWellnessDay {
  date: string; // YYYY-MM-DD
  ctl: number; // Chronic Training Load (Fitness)
  atl: number; // Acute Training Load (Fatigue)
  tsb: number; // Training Stress Balance (Form = CTL - ATL)
  loadRatio?: number; // ATL / CTL (Acute-to-Chronic Workload Ratio)
  rampRate: number; // Weekly CTL change
  hrvRMSSD: number; // ms
  hrvBaseline7d: number; // ms
  hrvNormalBandLow?: number; // 60d normal corridor low (ms)
  hrvNormalBandHigh?: number; // 60d normal corridor high (ms)
  hrvStatus?: GarminHrvStatus; // Garmin HRV status
  restingHR: number; // bpm
  sleepSecs: number;
  sleepScore: number; // 0-100
  sleepQuality?: number; // 1=Great, 2=Good, 3=Fair, 4=Poor
  sleepDebt7dSecs?: number; // Rolling 7d sleep debt vs 8h target
  weightKg: number;
  vo2MaxCycling?: number;
  vo2MaxRunning?: number;
  spO2?: number;
  respiration?: number;
  steps?: number;
  floorsClimbed?: number;
  soreness?: number; // 1-4
  rideEftp?: number; // Estimated Cycling FTP from Intervals.icu sportInfo
  rideWPrime?: number; // Cycling W' (J)
  ridePMax?: number; // Cycling Pmax (W)
  runEftp?: number; // Estimated Running FTP (W)
  runWPrime?: number; // Running W' (J)
  runPMax?: number; // Running Pmax (W)
  garminTrainingStatus?: GarminTrainingStatus;
  trainingStatusReason?: string;
  readinessStatus: 'Optimal' | 'Caution' | 'Strain';
  dailyLoad: number;
}

export interface ActivityInterval {
  id: string;
  type: 'WORK' | 'RECOVERY';
  label: string;
  startTimeSecs: number;
  durationSecs: number;
  distanceMeters: number;
  avgWatts?: number;
  weightedAvgWatts?: number;
  intensityPct?: number;
  zone?: number;
  avgHr?: number;
  maxHr?: number;
  avgPaceSecsPerKm?: number;
  gapPaceSecsPerKm?: number;
  avgCadence?: number;
  decouplingPct?: number;
  strideLengthMeters?: number;
}

export interface StravaKudoer {
  id?: string;
  name?: string;
  avatarInitials?: string;
  location?: string;
  firstname?: string;
  lastname?: string;
  profileMedium?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface StravaActivityComment {
  id: string;
  text: string;
  createdAt: string;
  athleteName?: string;
  authorName?: string;
  avatarUrl?: string;
}

export interface StravaSegmentEffort {
  id: string;
  segmentId: string;
  name: string;
  sportCategory: 'Cycling' | 'Running';
  distanceMeters: number;
  averageGradePct: number;
  elapsedTimeSecs: number;
  movingTimeSecs: number;
  avgWatts?: number;
  avgWattsPerKg?: number;
  avgPaceSecsPerKm?: number;
  avgHr?: number;
  prRank: 1 | 2 | 3 | null;
  komRank: number | null;
  startDateLocal: string;
  activityId: string;
  activityName: string;
  startTimeSecs?: number;
  endTimeSecs?: number;
  startIndex?: number;
  endIndex?: number;
  startLatLng?: [number, number];
  endLatLng?: [number, number];
  pathLatLngs?: [number, number][];
}

export interface BenchmarkSegmentHistory {
  segmentId: string;
  name: string;
  sportCategory: 'Cycling' | 'Running';
  distanceMeters: number;
  averageGradePct: number;
  location: string;
  prElapsedTimeSecs: number;
  targetElapsedTimeSecs?: number;
  efforts: {
    date: string;
    elapsedTimeSecs: number;
    avgWatts?: number;
    avgPaceSecsPerKm?: number;
    avgHr: number;
    prRank: 1 | 2 | 3 | null;
  }[];
}

export interface ActivityStreamSet {
  time: number[]; // seconds elapsed
  distance?: number[]; // meters elapsed
  latlng?: [number, number][]; // [lat, lng] GPS coordinates aligned with time[]
  watts?: number[];
  heartrate?: number[];
  velocitySmooth?: number[]; // m/s
  cadence?: number[];
  altitude?: number[];
}

export interface UnifiedActivity {
  id: string;
  intervalsId?: string;
  stravaId?: string;
  startDateLocal: string; // ISO string
  name: string;
  sportCategory: SportCategory;
  environment: ActivityEnvironment; // 'OUTDOOR' | 'INDOOR'
  subType: 'Road' | 'Trail' | 'Gravel' | 'Smart Trainer' | 'Treadmill' | 'Pool' | 'Open Water' | 'Gym';
  movingTimeSecs: number;
  distanceMeters: number;
  elevationGainMeters: number;
  avgPower?: number;
  normalizedPower?: number;
  intensityFactor?: number;
  variabilityIndex?: number;
  trainingLoad: number; // TSS / icu_training_load
  avgHr: number;
  maxHr: number;
  avgCadence?: number;
  avgPaceSecsPerKm?: number;
  gapPaceSecsPerKm?: number; // Grade Adjusted Pace
  aerobicDecouplingPct: number; // Pw:Hr or Pa:Hr %
  efficiencyFactor: number; // NP/HR or Speed/HR
  firstHalfEf: number;
  secondHalfEf: number;
  calories?: number;
  deviceName?: string;
  zoneSecs: {
    hr: number[]; // 7 zones [Z1..Z7]
    power?: number[]; // 7 zones [Z1..Z7]
    pace?: number[]; // 7 zones [Z1..Z7]
  };
  gearName?: string;
  stravaPrCount: number;
  kudosCount?: number;
  commentCount?: number;
  achievementCount?: number;
  athleteCount?: number;
  hasKudoed?: boolean;
  kudoers?: StravaKudoer[];
  comments?: StravaActivityComment[];
  summaryPolyline?: string;
  routeLatLngs?: [number, number][];
  startLatLng?: [number, number];
  endLatLng?: [number, number];
  segmentEfforts: StravaSegmentEffort[];
  intervals?: ActivityInterval[];
  streams?: ActivityStreamSet;
  sourceBadges: ('Intervals.icu' | 'Garmin' | 'Strava')[];
}

export interface StructuredWorkoutStep {
  label: string;
  durationSecs?: number;
  duration: string;
  targetPctFtp?: number;
  targetZoneOrOutput: string;
}

export interface PlannedWorkoutEvent {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  description: string;
  plannedLoad: number;
  plannedDurationSecs: number;
  targetZoneSummary: string;
  workoutSyntax?: string;
  structuredSteps?: StructuredWorkoutStep[];
  source?: 'USER' | 'AI_COACH' | 'INTERVALS_ICU';
}

export interface AnnualMileageGoal {
  sportCategory: 'Running' | 'Cycling';
  year: number;
  targetDistanceMeters: number;
}

export interface TargetGoal {
  id: string;
  title: string;
  type: 'RACE_EVENT' | 'PERFORMANCE_METRIC' | 'SEGMENT_TARGET';
  sportCategory: SportCategory;
  targetDate: string; // YYYY-MM-DD
  priority: 'A-Race' | 'B-Race' | 'Milestone';
  targetCtl?: number;
  currentValue: number;
  targetValue: number;
  unit: string;
  notes: string;
}

export interface DailyWorkoutOption {
  id: string;
  tier: 'OPTIMAL' | 'MODULATED' | 'RECOVERY';
  tierLabel: string;
  title: string;
  sportCategory: SportCategory;
  environment: ActivityEnvironment;
  durationMinutes: number;
  estimatedLoad: number;
  summary: string;
  physiologicalWhy: string;
  workoutSyntax?: string;
  structuredSteps: StructuredWorkoutStep[];
}

export interface CoachChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citedMetrics?: string[];
  proposedWorkouts?: PlannedWorkoutEvent[];
}

export interface PowerPaceCurvePoint {
  durationLabel: string;
  durationSecs: number;
  cyclingOutdoorWatts: number;
  cyclingIndoorWatts: number;
  cyclingSeasonBestWatts: number;
  runningOutdoorPaceSecsKm: number; // seconds per km
  runningIndoorPaceSecsKm: number;
  runningSeasonBestPaceSecsKm: number;
}

export type ChartMetricKey =
  | 'ctl'
  | 'atl'
  | 'tsb'
  | 'loadRatio'
  | 'dailyLoad'
  | 'rampRate'
  | 'hrvRMSSD'
  | 'restingHR'
  | 'sleepScore'
  | 'sleepHours'
  | 'vo2MaxCycling'
  | 'rideEftp'
  | 'runEftp'
  | 'steps'
  | 'weightKg'
  | 'activityDistanceKm'
  | 'activityDurationMins'
  | 'activityLoad'
  | 'avgPower'
  | 'normalizedPower'
  | 'avgHr'
  | 'maxHr'
  | 'efficiencyFactor'
  | 'aerobicDecouplingPct'
  | 'avgPaceMinKm'
  | 'avgCadence'
  | 'elevationGainMeters';

export interface CustomChartConfig {
  id: string;
  title: string;
  chartType: 'TIME_SERIES' | 'SCATTER';
  primaryMetric: ChartMetricKey;
  secondaryMetric: ChartMetricKey | 'NONE';
  aggregation: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  rollingWindowDays: 1 | 7 | 14 | 28 | 42 | 90;
  sportFilter: SportCategory | 'ALL';
  environmentFilter: EnvironmentFilter;
  dateRangePreset: '30D' | '90D' | '6M' | '1Y' | '2Y' | 'ALL' | 'CUSTOM';
  customStartDate?: string;
  customEndDate?: string;
}

export interface AthleteGearItem {
  id: string;
  name: string;
  type: 'BIKE' | 'SHOE';
  distanceMeters: number;
  maxRecommendedMeters: number;
  primary: boolean;
}

export interface ConnectionStatus {
  mode: 'LIVE' | 'SANDBOX_CALIBRATION';
  intervalsConnected: boolean;
  intervalsAthleteId: string;
  intervalsAthleteName?: string;
  intervalsSource: 'ENV' | 'USER_INPUT' | 'NONE';
  stravaConnected: boolean;
  stravaClientId?: string;
  stravaAthleteName?: string;
  stravaSource: 'OAUTH' | 'ENV' | 'NONE';
  hasGeminiServerKey: boolean;
  lastSyncedAt?: string;
  nextHourlySyncAt?: string;
  autoSyncCronActive?: boolean;
  totalActivitiesCount?: number;
  earliestActivityDate?: string;
  garminActivitiesCount?: number;
  stravaActivitiesCount?: number;
  redactedStravaCount?: number;
  athleteFtp?: number;
  athleteIndoorFtp?: number;
  athleteRunFtp?: number;
  athleteLthr?: number;
  athleteMaxHr?: number;
  gearItems?: AthleteGearItem[];
  devCallbackUrl: string;
  sharedCallbackUrl: string;
  currentOriginCallbackUrl: string;
}
