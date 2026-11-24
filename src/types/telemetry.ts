import type {
  CoachEventGroup,
  NcaaTrackFacilityType,
  SafeSportPatternWatchReport,
  ScholasticDivision,
  TrackLaneNumber,
  TrackWorkoutSpec,
} from './scholastic.ts';
import type { TeamInviteStatus } from './team.ts';
import type {
  DelegatedHandSplitCaptureSummary,
  DelegatedTimingStation,
  MeetPriorityTier,
  TrackSplitTimingContext,
} from './timing.ts';
import type {
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  TargetGoal,
  WorkoutQuickLog,
} from './workouts.ts';

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
  avgGroundContactTimeMs?: number;
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
  groundContactTimeMs?: number[];
  snappedTrackDistance?: number[];
  altitude?: number[];
}

export type OfficialRacePlatform =
  | 'Athletic.net'
  | 'TFRRS'
  | 'MileSplit'
  | 'RunSignup'
  | 'Official FAT'
  | 'MeetReady Stopwatch';

export type OfficialTrackSurface =
  | 'OUTDOOR_400M'
  | 'INDOOR_BANKED_200M'
  | 'INDOOR_FLAT_200M'
  | 'XC_COURSE'
  | 'ROAD';

export interface OfficialRaceMetadata {
  platform: OfficialRacePlatform;
  meetName: string;
  eventLabel: string; // e.g. '800m', '1500m', '1600m', '1 Mile', '3200m', '5000m'
  eventDistanceMeters: number;
  fatTimeSecs: number; // float with 0.01s precision (e.g. 115.84 for 1:55.84)
  displayFatTime: string; // e.g. '1:55.84'
  trackType: OfficialTrackSurface;
  placeFinish?: string; // e.g. '1st (Final)'
  windReading?: string; // e.g. '+0.8 m/s'
  lapSplitDistanceMeters?: 60 | 100 | 200 | 400 | 1000;
  lapSplitsSecs: number[];
  vdotScore: number;
  includeWarmupCooldown: boolean;
  meetPriorityTier?: MeetPriorityTier;
  timingMethod?: 'FAT' | 'HAND';
  splitContext?: TrackSplitTimingContext;
  sourceUrl?: string;
  handTimedTotalSecs?: number;
  capturedByName?: string;
  timingStation?: DelegatedTimingStation;
  splitsEstimated?: boolean;
  handSplitCaptures?: DelegatedHandSplitCaptureSummary[];
}

export type ActivitySourceBadge =
  | 'Intervals.icu'
  | 'Garmin'
  | 'Strava'
  | 'Wahoo'
  | 'Polar'
  | 'COROS'
  | 'Athletic.net'
  | 'TFRRS'
  | 'MileSplit'
  | 'RunSignup'
  | 'Official FAT'
  | 'MeetReady Stopwatch'
  | 'Hand-Timed'
  | 'Delegated Hand-Timed'
  | 'Self-Logged';

export interface StopwatchFusionMetadata {
  stopwatchActivityId: string;
  lapSplitsSecs: number[];
  repDistanceMeters: number;
  restDurationSecs: number;
  lane?: TrackLaneNumber;
  thresholdPaceSecsPerKm?: number;
  multiSetSpec?: TrackWorkoutSpec;
  fusedWithWearableStreams?: boolean;
  optimalLagSecs?: number;
}

export type ActivitySubType =
  | 'Road'
  | 'Track'
  | 'Cross Country'
  | 'Trail'
  | 'Gravel'
  | 'Virtual Cycling'
  | 'Smart Trainer'
  | 'Treadmill'
  | 'Pool'
  | 'Open Water'
  | 'Gym'
  | 'Hiking'
  | 'Walking'
  | 'Rowing'
  | 'Elliptical'
  | 'Stair Stepper'
  | 'HIIT & Circuit'
  | 'Nordic Ski'
  | 'Alpine & Backcountry Ski'
  | 'Paddling & Water'
  | 'Yoga & Mobility'
  | 'Climbing'
  | 'Court & Field'
  | 'EBike';

export interface UnifiedActivity {
  id: string;
  intervalsId?: string;
  stravaId?: string;
  wahooId?: string;
  polarId?: string;
  corosId?: string;
  garminId?: string;
  startDateLocal: string; // Local wall-clock ISO string YYYY-MM-DDTHH:mm:ss (no trailing Z)
  startDateUtcMs?: number; // Canonical UTC epoch ms for timezone- & DST-safe dedup/fusion
  name: string;
  sportCategory: SportCategory;
  environment: ActivityEnvironment; // 'OUTDOOR' | 'INDOOR'
  subType: ActivitySubType;
  movingTimeSecs: number;
  distanceMeters: number;
  elevationGainMeters: number;
  avgPower?: number;
  normalizedPower?: number;
  deviceWatts?: boolean;
  rawSportType?: string;
  intensityFactor?: number;
  variabilityIndex?: number;
  trainingLoad: number; // TSS / icu_training_load
  loadModelVersion?: number;
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
  gearId?: string;
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
  officialRaceData?: OfficialRaceMetadata;
  quickLog?: WorkoutQuickLog;
  footwearClass?: TrackFootwearClass;
  spikedDistanceMeters?: number;
  trackFacility?: NcaaTrackFacilityType;
  stimulusCompletionRatio?: number;
  autoRegPivotSummary?: string;
  isCompetitionDay?: boolean;
  matchedStopwatchId?: string;
  stopwatchFusionMeta?: StopwatchFusionMetadata;
  sourceBadges: ActivitySourceBadge[];
}

export interface AthleteGearItem {
  id: string;
  name: string;
  type: 'BIKE' | 'SHOE';
  distanceMeters: number;
  maxRecommendedMeters: number;
  primary: boolean;
  brand?: string;
  footwearClass?: TrackFootwearClass;
  retired?: boolean;
  retiredAt?: string;
  purchaseDate?: string;
  notes?: string;
}

export type MapTileProvider = 'OSM_KEYLESS' | 'MAPBOX' | 'THUNDERFOREST';

export interface AthletePowerZone {
  zone: number; // 1..7
  code: string; // 'Z1'..'Z7'
  name: string;
  minPct: number;
  maxPct: number;
  minWatts: number;
  maxWatts: number;
  minIndoorWatts: number;
  maxIndoorWatts: number;
  color: string;
}

export interface AthleteHrZone {
  zone: number; // 1..7
  code: string; // 'Z1'..'Z7'
  name: string;
  minBpm: number;
  maxBpm: number;
  minPctLthr: number;
  maxPctLthr: number;
  color: string;
}

export interface AthleteSwimZone {
  zone: number; // 1..5
  code: string; // 'Z1'..'Z5'
  name: string;
  minPaceSecsPer100m: number;
  maxPaceSecsPer100m: number;
  minPctCss: number;
  maxPctCss: number;
  color: string;
}

export interface ThresholdHistoryEntry {
  id: string;
  effectiveDate: string; // YYYY-MM-DD
  ftp: number; // Outdoor Cycling FTP (W)
  indoorFtp?: number; // Indoor Cycling FTP (W)
  lthr: number; // Cycling LTHR (bpm)
  runLthr?: number; // Running LTHR (bpm)
  thresholdPaceSecsPerKm: number; // Running LT Pace (s/km)
  weightKg?: number;
  note?: string;
}

export interface AthleteProfile {
  athleteId: string;
  name: string;
  primarySport?: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
  weightKg: number;
  restingHr: number;
  vo2MaxCycling: number;
  vo2MaxRunning: number;
  // Cycling Thresholds
  ftp: number; // Outdoor FTP (W)
  indoorFtp: number; // Indoor / Virtual FTP (W)
  eFtp: number; // Estimated FTP (W)
  wPrime: number; // Anaerobic Work Capacity W' (J)
  pMax: number; // Max Sprint Power (W)
  lthr: number; // Cycling LTHR (bpm)
  maxHr: number; // Cycling Max HR (bpm)
  sweetSpotMinPct: number;
  sweetSpotMaxPct: number;
  // Running Thresholds
  runFtp: number; // Running Critical Power (W)
  runEFtp: number; // Running eFTP (W)
  runLthr: number; // Running LTHR (bpm)
  runMaxHr: number; // Running Max HR (bpm)
  thresholdPaceSecsPerKm: number; // Running Threshold Pace (s/km)
  // Swimming Critical Swim Speed (CSS)
  swimCssSecsPer100m?: number; // Seconds per 100m
  swimZones?: AthleteSwimZone[];
  // Authoritative Zone Tables
  powerZones: AthletePowerZone[];
  hrZones: AthleteHrZone[];
  runHrZones: AthleteHrZone[];
  // Effective-Dated Threshold Ledger (protects historical TSS when thresholds change)
  thresholdHistory?: ThresholdHistoryEntry[];
  // Safe-Sport / Scholastic & Collegiate Athlete Settings
  safeSportHideWeight?: boolean; // RED-S protection: masks weight (kg/lbs) & W/kg in UI
  birthMonthYear?: string; // Conservative 'YYYY-MM' month-year for U13 COPPA / U18 Safe-Sport / 18+ transitions
  academicDivision?: ScholasticDivision;
  competitionGender?: 'MEN' | 'WOMEN';
  ferritinNgMl?: number; // Optional serum ferritin lab tracking (ng/mL)
  // Sync Metadata
  lastSyncedAt: string;
  source: 'INTERVALS_GARMIN' | 'CUSTOM_OVERRIDE' | 'DEFAULT';
}

export type StravaSyncWindow = '90d' | '180d' | '365d' | 'all' | 'none';

export interface StravaSyncPolicy {
  window: StravaSyncWindow;
  importProfileAndGear: boolean;
  confirmedAt: string;
  grantedScope?: string;
}

export interface ThreshUserAuthProvider {
  provider: 'google' | 'magic_link' | 'passkey' | 'strava' | 'dev_mock';
  providerId: string;
  email?: string;
  name?: string;
  linkedAt: string;
}

export interface ThreshPasskeySummary {
  id: string;
  createdAt: string;
  counter: number;
}

export interface ThreshConnectedService {
  service: 'strava' | 'garmin' | 'intervals' | 'wahoo' | 'polar' | 'coros';
  connectedAt: string;
  status: 'CONNECTED' | 'DISCONNECTED';
  athleteId?: string;
  athleteName?: string;
}

export interface ThreshUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  birthMonthYear?: string;
  role: 'athlete' | 'coach' | 'admin';
  createdAt: string;
  updatedAt: string;
  authProviders: ThreshUserAuthProvider[];
  passkeys?: ThreshPasskeySummary[];
  connectedServices: ThreshConnectedService[];
}

export type CoachDataSharingTier = 'SUMMARY_ONLY' | 'FULL_STREAMS' | 'LOAD_ONLY';

export interface ConnectionStatus {
  mode: 'LIVE' | 'SANDBOX_CALIBRATION';
  vaultStorageBackend?: 'POSTGRES' | 'ENCRYPTED_FILE';
  currentUser?: ThreshUser | null;
  garminConfigured?: boolean;
  garminConnected?: boolean;
  garminAuthMethod?: 'OAUTH' | 'PERSONAL_KEY' | 'NONE';
  garminCanPushWorkouts?: boolean;
  garminAthleteName?: string;
  intervalsConfigured?: boolean;
  intervalsConnected: boolean;
  intervalsAuthMethod?: 'OAUTH' | 'API_KEY' | 'NONE';
  intervalsScope?: string;
  intervalsCanWriteCalendar?: boolean;
  intervalsAthleteId: string;
  intervalsAthleteName?: string;
  intervalsSource: 'ENV' | 'USER_INPUT' | 'OAUTH' | 'NONE';
  wahooConfigured?: boolean;
  wahooConnected?: boolean;
  wahooAthleteId?: string;
  wahooAthleteName?: string;
  polarConfigured?: boolean;
  polarConnected?: boolean;
  polarAthleteId?: string;
  polarAthleteName?: string;
  corosConfigured?: boolean;
  corosConnected?: boolean;
  corosAthleteId?: string;
  corosAthleteName?: string;
  stravaConfigured?: boolean;
  stravaConnected: boolean;
  stravaClientId?: string;
  stravaAthleteId?: string;
  stravaAthleteName?: string;
  stravaMeasurementPreference?: DistanceUnit;
  stravaGrantedScope?: string;
  stravaSyncPolicy?: StravaSyncPolicy;
  stravaSource: 'OAUTH' | 'ENV' | 'NONE';
  hasGeminiServerKey: boolean;
  mapTileProvider?: MapTileProvider;
  mapTileApiKeyConfigured?: boolean;
  mapTileApiKey?: string;
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
  athleteProfile?: AthleteProfile;
  gearItems?: AthleteGearItem[];
  devCallbackUrl: string;
  sharedCallbackUrl: string;
  currentOriginCallbackUrl: string;
}

export type AthleteConnectionRole = 'SELF' | 'COACH_EDIT' | 'FRIEND_VIEW';

export type PrivacyVisibilityTier = 'ALL_CONNECTIONS' | 'COACHES_ONLY' | 'PRIVATE';

export interface AthletePrivacySettings {
  shareWellnessAndHrv: PrivacyVisibilityTier;
  sharePmcAndZones: PrivacyVisibilityTier;
  shareGpsRoutes: PrivacyVisibilityTier;
  stravaComplianceShield: boolean; // Auto-redacts raw Strava-only GPS routes for non-owners while allowing derived fitness & official FAT marks
  allowCoachCalendarEdits: boolean;
}

export interface ConnectedAthleteRecord {
  id: string;
  name: string;
  avatarInitials: string;
  location: string;
  stravaAthleteId: string;
  inviteCode: string;
  role: 'COACH_EDIT' | 'FRIEND_VIEW';
  status: 'CONNECTED' | 'PENDING_INCOMING' | 'PENDING_OUTGOING';
  primaryGoalSummary: string;
  primarySport: SportCategory;
  eventGroup?: CoachEventGroup;
  teamMemberStatus?: TeamInviteStatus;
  isMinorU18?: boolean;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  athleteProfile: AthleteProfile;
  privacySettings: AthletePrivacySettings;
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  targetGoals: TargetGoal[];
  caraHours7d?: number;
  sessionCheckIns?: SessionCheckInRecord[];
}

export interface DualSportPmcPoint {
  date: string;
  systemicLoad: number;
  systemicCtl: number;
  systemicAtl: number;
  systemicTsb: number;
  cyclingLoad: number;
  cyclingCtl: number;
  cyclingAtl: number;
  cyclingTsb: number;
  runningLoad: number;
  runningCtl: number;
  runningAtl: number;
  runningTsb: number;
}

export interface EmpiricalMmpPoint {
  durationSecs: number;
  label: string;
  bestWatts: number | null;
  modeledWatts: number | null;
  bestGapSecsPerKm: number | null;
  modeledGapSecsPerKm: number | null;
  sourceActivityId?: string;
  sourceActivityName?: string;
  sourceActivityDate?: string;
  startSecondOffset?: number;
  paceSourceActivityId?: string;
  paceSourceActivityName?: string;
  paceSourceActivityDate?: string;
  paceStartSecondOffset?: number;
}

export interface EmpiricalMmpModelSummary {
  points: EmpiricalMmpPoint[];
  scannedPowerStreamsCount: number;
  scannedPaceStreamsCount: number;
  criticalPowerWatts: number | null;
  wPrimeJoules: number | null;
  pMaxWatts: number | null;
  criticalSpeedMps: number | null;
  dPrimeMeters: number | null;
  criticalPaceSecsPerKm: number | null;
}

export type TrackFootwearClass =
  | 'DAILY_TRAINER'
  | 'LIGHTWEIGHT_FLAT_SUPER_TRAINER'
  | 'CARBON_ROAD_RACER'
  | 'TRADITIONAL_TRACK_SPIKE'
  | 'CARBON_SUPER_SPIKE';

export interface OrthopedicLoadSummary {
  centralAutonomicLoad7d: number;
  eccentricImpactLoad7d: number;
  concentricTorqueLoad7d: number;
  impactAcwr: number;
  torqueAcwr: number;
  centralAcwr: number;
  riskTier: 'OPTIMAL' | 'ELEVATED_IMPACT' | 'HIGH_IMPACT_GUARDRAIL';
  guardrailHeadline: string;
  guardrailRecommendation: string;
  canMorphTodayRunToBike: boolean;
  suggestedBikeDurationMins: number;
  suggestedBikeTss: number;
  suggestedBikeWorkoutSyntax: string;
  spikedMeters7d: number;
  superSpikeMeters7d: number;
  spikedMeters72h: number;
  spikedMetersWeeklyCap: number;
  superSpikeWeeklyCap: number;
  spikeRatio72h: number;
  spikeAcwr: number;
  hoursSinceLastSuperSpike: number | null;
  trainerOnly48hLockActive: boolean;
  trainerOnlyLockReason: string | null;
  spikeGuardrailStatus: 'CLEAR' | 'SPIKE_CAP_WARNING' | 'TRAINER_ONLY_48H_LOCK';
}

export interface PostWorkoutDebriefInsight {
  id: string;
  badge: string;
  severity: 'PRIME' | 'CAUTION' | 'STRAINED' | 'INFO';
  title: string;
  detail: string;
  windowStartSec: number;
  windowEndSec: number;
  timestampLabel: string;
}

export interface PostWorkoutDebriefReport {
  activityId: string;
  headline: string;
  executionScore: number;
  normalizedPowerWatts: number | null;
  gradeAdjustedPaceSecsPerKm: number | null;
  aerobicDecouplingPct: number | null;
  wPrimeMinPct: number | null;
  bestHrr60Bpm: number | null;
  anchoredHrr60MeanBpm?: number | null;
  strideLengthFadePct?: number | null;
  cadenceFadePct?: number | null;
  fadePrimaryDriver?: 'STRIDE_LENGTH_LOSS' | 'CADENCE_DROP' | 'EVEN_MECHANICS' | null;
  insights: PostWorkoutDebriefInsight[];
}

export type { SafeSportPatternWatchReport };
