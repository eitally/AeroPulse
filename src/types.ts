export type SportCategory = 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport';

export type ActivityEnvironment = 'OUTDOOR' | 'INDOOR';

export type EnvironmentFilter = 'COMBINED' | 'OUTDOOR' | 'INDOOR';

export type DistanceUnit = 'mi' | 'km';

export interface UnifiedWellnessDay {
  date: string; // YYYY-MM-DD
  ctl: number; // Chronic Training Load (Fitness)
  atl: number; // Acute Training Load (Fatigue)
  tsb: number; // Training Stress Balance (Form = CTL - ATL)
  rampRate: number; // Weekly CTL change
  hrvRMSSD: number; // ms
  hrvBaseline7d: number; // ms
  restingHR: number; // bpm
  sleepSecs: number;
  sleepScore: number; // 0-100
  weightKg: number;
  vo2MaxCycling?: number;
  vo2MaxRunning?: number;
  soreness?: number; // 1-4
  readinessStatus: 'Optimal' | 'Caution' | 'Strain';
  dailyLoad: number;
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
  zoneSecs: {
    hr: number[]; // 7 zones [Z1..Z7]
    power?: number[]; // 7 zones [Z1..Z7]
    pace?: number[]; // 7 zones [Z1..Z7]
  };
  gearName?: string;
  stravaPrCount: number;
  kudosCount?: number;
  segmentEfforts: StravaSegmentEffort[];
  streams?: ActivityStreamSet;
  sourceBadges: ('Intervals.icu' | 'Garmin' | 'Strava')[];
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
  structuredSteps: {
    label: string;
    duration: string;
    targetZoneOrOutput: string;
  }[];
}

export interface CoachChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citedMetrics?: string[];
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

export interface ConnectionStatus {
  mode: 'LIVE' | 'SANDBOX_CALIBRATION';
  intervalsConnected: boolean;
  intervalsAthleteId: string;
  intervalsAthleteName?: string;
  intervalsSource: 'ENV' | 'USER_INPUT' | 'NONE';
  stravaConnected: boolean;
  stravaAthleteName?: string;
  stravaSource: 'OAUTH' | 'ENV' | 'NONE';
  hasGeminiServerKey: boolean;
  lastSyncedAt?: string;
  devCallbackUrl: string;
  sharedCallbackUrl: string;
  currentOriginCallbackUrl: string;
}
