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
  | 'Official FAT';

export type OfficialTrackSurface =
  | 'OUTDOOR_400M'
  | 'INDOOR_BANKED_200M'
  | 'INDOOR_FLAT_200M'
  | 'XC_COURSE'
  | 'ROAD';

export type MeetPriorityTier = 'DUAL_TRAINING_THROUGH' | 'INVITATIONAL_B' | 'CHAMPIONSHIP_A';
export type TrackSplitTimingContext =
  | 'OPEN_FAT'
  | 'HAND_CONVERTED'
  | 'RELAY_LEADOFF'
  | 'RELAY_FLYING';

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
  | 'Official FAT';

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

export interface StructuredWorkoutStep {
  label: string;
  durationSecs?: number;
  duration: string;
  targetPctFtp?: number;
  targetZoneOrOutput: string;
}

export type WorkoutSessionSlot = 'SINGLE' | 'AM' | 'PM';

export type PracticeVenueCategory =
  | 'TRACK'
  | 'XC_COURSE'
  | 'ROAD_CAMPUS'
  | 'GYM_WEIGHTS'
  | 'POOL_CROSS'
  | 'OTHER';

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
  scheduledTime?: string; // HH:mm (24h), e.g. '15:45'
  sessionSlot?: WorkoutSessionSlot;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  meetingNotes?: string;
  workoutSyntax?: string;
  structuredSteps?: StructuredWorkoutStep[];
  trackSpec?: TrackWorkoutSpec;
  footwearClass?: TrackFootwearClass;
  spikedDistanceMeters?: number;
  trackFacility?: NcaaTrackFacilityType;
  meetPriorityTier?: MeetPriorityTier;
  source?: 'USER' | 'AI_COACH' | 'INTERVALS_ICU';
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
}

export interface AnnualMileageGoal {
  sportCategory: 'Running' | 'Cycling' | 'Swimming';
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

// ============================================================================
// HORIZON 2 & 3: COMPLIANCE, WEEKLY GIT-DIFF, DURABILITY, RACE SIM & PASSPORTS
// ============================================================================

export interface WorkoutQuickLog {
  rpe: number; // 1–10 Borg CR10
  feelRating: 'STRONG' | 'NORMAL' | 'HEAVY' | 'DEPLETED';
  carbsGramsPerHour?: number;
  sodiumMgPerHour?: number;
  hydrationMl?: number;
  gearId?: string;
  gearName?: string;
  footwearClass?: TrackFootwearClass;
  spikedDistanceMeters?: number;
  trackFacility?: NcaaTrackFacilityType;
  notes?: string;
  loggedAt: string;
}

export interface PlannedWorkoutCompliance {
  date: string;
  plannedEventId: string;
  plannedName: string;
  plannedSport: SportCategory;
  plannedDurationMins: number;
  plannedTss: number;
  matchedActivityId: string | null;
  matchedActivityName: string | null;
  actualDurationMins: number;
  actualTss: number;
  durationAdherencePct: number;
  loadAdherencePct: number;
  complianceScore: number; // 0–100
  status:
    | 'COMPLETED_ON_TARGET'
    | 'MODIFIED_COMPLETED'
    | 'PARTIAL'
    | 'MISSED'
    | 'UPCOMING';
  summaryLabel: string;
}

export interface WeeklyGitDiffDayChange {
  date: string;
  dayLabel: string;
  changeType: 'MODIFIED' | 'SWAPPED' | 'UNCHANGED';
  originalEventId?: string;
  originalTitle: string;
  originalSport: SportCategory;
  originalDurationMins: number;
  originalTss: number;
  proposedTitle: string;
  proposedSport: SportCategory;
  proposedDurationMins: number;
  proposedTss: number;
  proposedWorkoutSyntax?: string;
  reason: string;
}

export interface WeeklyGitDiffProposal {
  generatedAt: string;
  triggerReason: string;
  readinessVerdict: 'GREEN_PRIME' | 'AMBER_ADAPT' | 'RED_GUARDRAIL';
  netTssDelta: number;
  netCtlDelta: number;
  netTsbDelta: number;
  dayChanges: WeeklyGitDiffDayChange[];
}

export interface DurabilityBucketPoint {
  bucketIndex: number;
  fatigueThresholdValue: number; // e.g. 0, 10, 20, 30, 40 (kJ/kg) or 0, 500, 1000, 1500, 2000 (kcal)
  fatigueLabel: string; // e.g. "0 kJ/kg (Fresh)" or "1,000 kcal"
  best5mWatts: number | null;
  best20mWatts: number | null;
  best5mGapSecsPerKm: number | null;
  best20mGapSecsPerKm: number | null;
  retentionPct: number; // 100% at bucket 0 -> e.g. 94.2% at 30 kJ/kg
  heartRateDriftPct: number;
  sampleCount: number;
}

export interface DurabilityAnalysisReport {
  discipline: 'Cycling' | 'Running';
  unitLabel: 'kJ/kg' | 'kcal';
  buckets: DurabilityBucketPoint[];
  retentionAtDeepFatiguePct: number;
  decaySlopePerUnitPct: number;
  durabilityTier: 'PRO_TOUR_RESILIENT' | 'WELL_CONDITIONED' | 'MODERATE_FADE' | 'GLYCOGEN_FRAGILE';
  primaryLimiter:
    | 'HIGH_DURABILITY_RETENTION'
    | 'GLYCOGEN_DEPLETION'
    | 'THERMAL_CARDIAC_DRIFT'
    | 'NEUROMUSCULAR_DECAY';
  limiterExplanation: string;
  fuelingPrescription: string;
}

export interface RaceSimulationSegment {
  segmentIndex: number;
  segmentLabel: string; // e.g. "Km 0–10 (Opening Settling)"
  startKm: number;
  endKm: number;
  avgGradePct: number;
  accumulatedFatigueLabel: string;
  targetWatts: number | null;
  targetWkg: number | null;
  targetPaceSecsPerKm: number | null;
  targetGapSecsPerKm: number | null;
  segmentDurationSecs: number;
  carbsGramsTarget: number;
  sodiumMgTarget: number;
  fluidMlTarget: number;
  coachingCue: string;
}

export interface RaceFuelingPlan {
  carbsGramsPerHour: number;
  totalCarbsGrams: number;
  glucoseFructoseRatio: '2:1 Dual-Source' | '1:0.8 High-Oxidation' | 'Single-Source';
  sodiumMgPerHour: number;
  totalSodiumMg: number;
  fluidMlPerHour: number;
  totalFluidMl: number;
  gelEquivalentsCount: number;
  caffeineMgRecommendation: number;
}

export interface RaceSimulationReport {
  sport: 'Cycling' | 'Running';
  raceName: string;
  distanceKm: number;
  elevationGainMeters: number;
  ambientTempC: number;
  altitudeMeters: number;
  predictedFinishTimeSecs: number;
  averageTargetWatts: number | null;
  normalizedTargetWatts: number | null;
  averageTargetPaceSecsPerKm: number | null;
  thermalDeratingPct: number;
  altitudeDeratingPct: number;
  durabilityDeratingPct: number;
  fuelingPlan: RaceFuelingPlan;
  segments: RaceSimulationSegment[];
}

export interface RubberBandedSplit {
  splitIndex: number;
  splitLabel: string;
  certifiedDistanceMeters: number;
  rawGpsDistanceMeters: number;
  rawGpsSplitSecs: number;
  rubberBandedSplitSecs: number;
  certifiedPaceSecsPerKm: number;
  deltaSecs: number;
}

export interface VerifiedRacePassport {
  passportId: string;
  verificationHash: string;
  athleteName: string;
  meetOrRaceName: string;
  eventLabel: string;
  platform: OfficialRacePlatform;
  raceDate: string;
  certifiedDistanceMeters: number;
  rawGpsDistanceMeters: number;
  gpsDriftPct: number;
  officialChipOrFatSecs: number;
  displayOfficialTime: string;
  certifiedPaceSecsPerKm: number;
  vdotScore: number;
  equivalentMarathonSecs: number;
  splits: RubberBandedSplit[];
}

// ============================================================================
// HORIZON 4 (v2.3): HIGH SCHOOL & COLLEGIATE TEAM PACK
// ============================================================================

export type ScholasticDivision =
  | 'HS_VARSITY'
  | 'NCAA_D1'
  | 'NCAA_D2'
  | 'NCAA_D3'
  | 'CLUB_OPEN';

export type VdotPodIntensity =
  | 'EASY'
  | 'MARATHON'
  | 'SUB_THRESHOLD'
  | 'THRESHOLD_CV'
  | 'INTERVAL_VO2'
  | 'RACE_3200M'
  | 'REPETITION'
  | 'RACE_1600M'
  | 'RACE_800M'
  | 'RACE_400M';

export type CoachEventGroup =
  | 'DISTANCE'
  | 'MID_DISTANCE'
  | 'SPRINTS'
  | 'HURDLES'
  | 'JUMPS'
  | 'POLE_VAULT'
  | 'THROWS'
  | 'MULTI';

export type TrackRepDistanceMeters =
  | 10
  | 20
  | 30
  | 40
  | 50
  | 60
  | 80
  | 100
  | 110
  | 120
  | 150
  | 200
  | 300
  | 400
  | 500
  | 600
  | 800
  | 1000
  | 1200
  | 1600;
export type SpeedReservePhenotype = 'ENDURANCE' | 'HYBRID' | 'SPEED';
export type TrackTrainingZoneCode = 'E' | 'SUB_T' | 'T' | 'CV' | 'I' | 'R' | 'FR';
export type TrackSeasonPhase = 'BASE' | 'STRENGTH_CV' | 'SPECIFIC' | 'PEAK_TAPER';
export type TrackTargetEventGroup = '800M' | '1500_MILE' | '3000_3200M' | '5000M';

export interface TrackSeedMarkInput {
  distanceMeters: number;
  durationSecs: number;
  dateIso?: string;
  eventLabel?: string;
}

export interface TrackZoneSplitRow {
  code: TrackTrainingZoneCode;
  name: string;
  pctVdotAer: number;
  paceSecsPerKm: number;
  speedMps: number;
  splitsSecs: {
    m200: number;
    m300: number;
    m400: number;
    m600: number;
    m800: number;
    m1000: number;
    m1200: number;
    m1600: number;
  };
}

export interface TrackSpeedReserveProfile {
  modelSource: 'MULTI_MARK_CS_DPRIME' | 'SINGLE_MARK_SCALED' | 'PROFILE_THRESHOLD_FALLBACK';
  csMps: number;
  criticalPaceSecsPerKm: number;
  dPrimeMeters: number;
  vdotAer: number;
  vdotRawBest: number;
  masMps: number;
  mssMps: number;
  asrMps: number;
  srr: number;
  phenotype: SpeedReservePhenotype;
  thresholdPaceSecsPerKm: number;
  zones: Record<TrackTrainingZoneCode, TrackZoneSplitRow>;
}

export type TrackLaneNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface TrackEnvironmentConditions {
  lane?: TrackLaneNumber;
  isStaggeredStart?: boolean;
  facility?: NcaaTrackFacilityType;
  airTempF?: number;
  dewPointF?: number;
  windSpeedMps?: number;
  altitudeMeters?: number;
}

export interface TrackSplitEnvironmentAdjustment {
  lane: TrackLaneNumber;
  lapLengthMeters: number;
  halfLapLengthMeters: number;
  laneMultiplier: number;
  facilityMultiplier: number;
  hadleySumF: number | null;
  heatSlowdownPct: number;
  heatAbortTriggered: boolean;
  windNetSlowdownPct: number;
  windTolerancePlusMinusSecs: number;
  altitudeSlowdownPct: number;
  altitudeRestMultiplier: number;
  combinedSplitMultiplier: number;
  adjustedTargetSplitSecs: number;
  adjustedRestDurationSecs: number;
  summaryBadges: string[];
  advisoryNote: string;
}

export interface TrackSetSpec {
  repCount: number;
  repDistanceMeters: TrackRepDistanceMeters;
  zoneCode: TrackTrainingZoneCode;
  podIntensity: VdotPodIntensity;
  targetSplitSecs?: number;
  restDurationSecs: number;
  setRestAfterSecs?: number;
  recoveryCue?: string;
}

export interface TrackWorkoutSpec {
  repCount: number;
  repDistanceMeters: TrackRepDistanceMeters;
  zoneCode: TrackTrainingZoneCode;
  podIntensity: VdotPodIntensity;
  targetSplitSecs?: number;
  restDurationSecs: number;
  recoveryCue?: string;
  waveMode?: 'MASS' | 'POD_10S' | 'PURSUIT';
  eventGroup?: TrackTargetEventGroup;
  phase?: TrackSeasonPhase;
  footwearClass?: TrackFootwearClass;
  spikedDistanceMeters?: number;
  trackFacility?: NcaaTrackFacilityType;
  warmupDistanceMeters?: number;
  cooldownDistanceMeters?: number;
  sets?: TrackSetSpec[];
}

export interface VdotPodAthleteMember {
  id: string;
  name: string;
  vdot: number;
  thresholdPaceSecsPerKm: number;
  phenotype?: SpeedReservePhenotype;
}

export interface VdotTrainingPod {
  podId: string;
  podName: string;
  minVdot: number;
  maxVdot: number;
  centerVdot: number;
  athletes: VdotPodAthleteMember[];
  intensity: VdotPodIntensity;
  targetPaceSecsPerKm: number;
  targetRepSplitSecs?: number;
  pursuitStaggerOffsetSecs?: number;
  splitsSecs: {
    split200m: number;
    split300m?: number;
    split400m: number;
    split600m?: number;
    split800m: number;
    split1000m: number;
    split1200m?: number;
    split1600m: number;
  };
  workoutPrescriptionLine: string;
  workoutSyntax: string;
  environmentAdjustment?: TrackSplitEnvironmentAdjustment;
}

export type VdotPacingPod = VdotTrainingPod;

export type NcaaTrackFacilityType =
  | 'INDOOR_FLAT_200M'
  | 'INDOOR_BANKED_200M'
  | 'OUTDOOR_400M';

export type ScholasticTrackEventLabel =
  | '800m'
  | '1500m'
  | '1600m'
  | 'Mile'
  | '3000m'
  | '3200m'
  | '5000m'
  | '10000m';

export interface NcaaTrackConversionResult {
  eventLabel: ScholasticTrackEventLabel;
  gender: 'MEN' | 'WOMEN';
  rawTimeSecs: number;
  fromFacility: NcaaTrackFacilityType;
  toFacility: NcaaTrackFacilityType;
  altitudeFeet: number;
  facilityMultiplier: number;
  altitudeAllowanceSecs: number;
  convertedTimeSecs: number;
  displayRawTime: string;
  displayConvertedTime: string;
  deltaSecs: number;
  ncaaRuleSummary: string;
}

export interface RecruitingStandardComparison {
  tierId:
    | 'HS_STATE'
    | 'HS_NATIONALS'
    | 'NCAA_D3_RECRUIT'
    | 'NCAA_D2_SCHOLARSHIP'
    | 'NCAA_D1_WALK_ON'
    | 'NCAA_D1_SCHOLARSHIP';
  tierLabel: string;
  standardSecs: number;
  displayStandard: string;
  athleteConvertedSecs: number;
  gapSecs: number;
  achieved: boolean;
  progressPct: number;
}

export type CrossTrainingModality =
  | 'AQUA_JOGGING'
  | 'ALTER_G'
  | 'ELLIPTICAL'
  | 'ARC_TRAINER'
  | 'STATIONARY_BIKE';

export interface CrossTrainingEquivalence {
  modality: CrossTrainingModality;
  modalityLabel: string;
  durationMins: number;
  rpe: number;
  equivalentRunKm: number;
  equivalentRunMiles: number;
  estimatedSystemicTss: number;
  impactLoadSavedPct: number;
  caraCountableHours: number;
  coachingNote: string;
}

export type NcaaCaraSeasonSegment = 'IN_SEASON' | 'OUT_OF_SEASON';

export interface NcaaCaraWeeklyAudit {
  rolling7dCountableHours: number;
  weeklyCapHours: number;
  maxSingleDayHours: number;
  dailyCapHours: number;
  remainingWeeklyHours: number;
  competitionDaysCount?: number;
  seasonSegment?: NcaaCaraSeasonSegment;
  strengthHours?: number;
  meetingFilmHours?: number;
  varaHours?: number;
  daysOffCount?: number;
  requiredDaysOff?: number;
  daysOffCompliant?: boolean;
  outOfSeasonSkillCompliant?: boolean;
  compliant: boolean;
  statusLabel: string;
}

export interface StudentAthleteCheckIn {
  date: string;
  academicStress: 1 | 2 | 3 | 4 | 5;
  shinMetatarsalSoreness: 0 | 1 | 2 | 3;
  achillesTendonSoreness: 0 | 1 | 2 | 3;
  kneeGrowthPlateSoreness?: 0 | 1 | 2 | 3;
  heelApophysisSoreness?: 0 | 1 | 2 | 3;
  sleepHours: number;
  ferritinNgMl?: number;
  energyFeel: 'FRESH' | 'NORMAL' | 'FLAT';
}

export type SafeSportBiomarkerAlertRecipient =
  | 'ATHLETE_SELF'
  | 'PARENT_GUARDIAN_CC'
  | 'ATHLETIC_TRAINER_MEDICAL';

export interface SafeSportPatternSignal {
  signalId:
    | 'EASY_HR_DRIFT_ELEVATED'
    | 'CHRONOTROPIC_BLUNTING'
    | 'EFFICIENCY_FACTOR_DECAY'
    | 'HRR60_PARASYMPATHETIC_DROP'
    | 'SERUM_FERRITIN_LOW'
    | 'PHV_GROWTH_PLATE_SORENESS';
  severity: 'WATCH' | 'ACTION_REQUIRED';
  title: string;
  metricValue: string;
  baselineValue: string;
  deltaDisplay: string;
  guidance: string;
}

export interface SafeSportPatternWatchReport {
  evaluatedAtIso: string;
  windowRecentDays: 14;
  windowBaselineDays: 28 | 56;
  trafficLight: 'GREEN_CLEAR' | 'AMBER_WATCH' | 'RED_MEDICAL_REVIEW';
  zeroWeightCompliant: true;
  isMinorU18: boolean;
  deltaEasyHrBpm: number | null;
  chronotropicBluntingDetected: boolean;
  deltaEfficiencyFactorPct: number | null;
  deltaHrr60Bpm: number | null;
  ferritinStatus: 'UNKNOWN' | 'OPTIMAL' | 'SUBOPTIMAL_30_50' | 'DEPLETED_UNDER_30';
  phvGrowthPlateFlag: boolean;
  signals: SafeSportPatternSignal[];
  headline: string;
  athleteGuidance: string;
  medicalRoutingSummary: string;
  authorizedRecipients: SafeSportBiomarkerAlertRecipient[];
  coachSafeSummaryLabel: string;
}

export interface StudentAthleteGuardrailResult {
  status:
    | 'CLEARED_FULL_WORKOUT'
    | 'ACADEMIC_MODULATION'
    | 'IRON_DEPLETION_CAUTION'
    | 'BONE_STRESS_STOP';
  headline: string;
  recommendation: string;
  intensityScalePct: number;
  suggestCrossTrainingSwap: boolean;
  flags: string[];
}

// ============================================================================
// MULTI-TEAM BRANDING, BULK ROSTER INVITES (RESEND) & SAFEGUARDING
// ============================================================================

export type TeamOrgType =
  | 'HIGH_SCHOOL'
  | 'COLLEGIATE'
  | 'RUNNING_CLUB'
  | 'CYCLING_CLUB'
  | 'COACH_SQUAD';

export type TeamMemberRole =
  | 'HEAD_COACH'
  | 'ASSISTANT_COACH'
  | 'ORG_ADMIN'
  | 'ATHLETIC_TRAINER'
  | 'ATHLETE'
  | 'PARENT_FOLLOWER';

export type TeamWorkoutLibraryCategory =
  | 'TRACK'
  | 'XC_TEMPO'
  | 'ROAD'
  | 'CYCLING'
  | 'SWIMMING'
  | 'TRIATHLON'
  | 'RECOVERY';

export interface TeamWorkoutLibraryTemplate {
  id: string;
  name: string;
  category: TeamWorkoutLibraryCategory;
  sportCategory: SportCategory;
  workoutSyntax: string;
  description: string;
  plannedDurationSecs: number;
  plannedLoad: number;
  trackSpec?: TrackWorkoutSpec;
  createdByName: string;
  createdAt: string;
}

export interface TeamWorkoutComment {
  id: string;
  teamId: string;
  targetMembershipId: string;
  targetAthleteName?: string;
  activityId?: string;
  workoutDate: string;
  authorSid: string;
  authorName: string;
  authorRole: TeamMemberRole;
  body: string;
  guardianCcApplied: boolean;
  guardianVisible: boolean;
  createdAt: string;
}

export interface GuardianSafetyAlertRecord {
  id: string;
  teamId: string;
  targetMembershipId: string;
  athleteName: string;
  sourceCheckInId?: string;
  severity: 'CAUTION' | 'HIGH';
  category: 'PAIN_FLAG' | 'HIGH_STRAIN' | 'SAFE_SPORT_WATCH';
  summary: string;
  painLocation?: string;
  guardianEmailMasked?: string;
  deliveryStatus: 'SENT' | 'LOCAL_LOGGED' | 'NO_GUARDIAN_ON_FILE';
  createdAt: string;
}

export interface TeamAuditLogEntry {
  eventId: string;
  createdAt: string;
  teamId: string;
  actorSid: string;
  action: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

export type TeamInviteStatus =
  | 'INVITED'
  | 'OPENED'
  | 'ACTIVE'
  | 'INJURED'
  | 'OFF_SEASON'
  | 'ALUMNI'
  | 'REVOKED';

export type TeamPlanTier = 'SANDBOX' | 'FOUNDING_TEAM';

export type ExternalTeamPlatform = 'ATHLETIC_NET' | 'TFRRS' | 'HYTEK';

export interface TeamExternalSyncConfig {
  platform?: 'ATHLETIC_NET' | 'TFRRS';
  athleticNetSchoolId?: string;
  athleticNetSportSlug?: 'xc' | 'track-and-field-outdoor' | 'track-and-field-indoor';
  athleticNetUrl?: string;
  tfrrsTeamUrl?: string;
  tfrrsTeamCode?: string;
  teamFilterKeyword?: string;
  icsCalendarUrl?: string;
  enablePublicParentHub?: boolean;
  lastSyncedAt?: string;
}

export interface TeamBrandConfig {
  teamId: string;
  slug: string; // e.g. 'palo-alto-xc' -> /join/palo-alto-xc
  joinCode: string; // e.g. 'PAXC-26'
  name: string; // e.g. 'Palo Alto High Varsity XC'
  shortName: string; // e.g. 'PALY XC'
  mascotOrMotto?: string;
  orgType: TeamOrgType;
  primarySport: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
  logoDataUrl?: string; // Optional SVG/PNG/WebP crest data URL
  primaryHex: string; // e.g. '#1E5631'
  secondaryHex: string; // e.g. '#D97706'
  defaultSafeSportShield: boolean; // Auto-defaults to true for HIGH_SCHOOL
  enableParentGuardianCc: boolean; // Auto-defaults to true for HIGH_SCHOOL
  coachDisplayName: string;
  planTier?: TeamPlanTier;
  externalSync?: TeamExternalSyncConfig;
  createdAt: string;
}

export interface TeamAthleteLiveSnapshot {
  updatedAt: string;
  hasConnectedWatch: boolean;
  verdictLabel: string;
  readinessScore: number;
  ctl: number;
  atl: number;
  tsb: number;
  acuteLoad7d: number;
  lowAerobicPct: number;
  highAerobicPct: number;
  neuromuscularPct: number;
  caraHours7d: number;
  ftpWatts?: number;
  thresholdPaceSecsPerKm?: number;
  safeSportHideWeight: boolean;
  birthMonthYear?: string;
  sharingTier?: CoachDataSharingTier;
  privacySettings?: AthletePrivacySettings;
  wellnessDays?: UnifiedWellnessDay[];
  activities?: UnifiedActivity[];
  sessionCheckIns?: SessionCheckInRecord[];
  safeSportWatch?: {
    trafficLight: 'GREEN_CLEAR' | 'AMBER_WATCH' | 'RED_MEDICAL_REVIEW';
    coachSafeSummaryLabel: string;
    privateAlertForSelfAndParentOnly?: SafeSportPatternWatchReport;
  };
}

export type ParentConsentStatus = 'PENDING' | 'ACKNOWLEDGED' | 'NOT_REQUIRED';

export interface TeamMembershipRecord {
  membershipId: string;
  teamId: string;
  userSid?: string;
  stravaAthleteId?: string;
  sharingTier?: CoachDataSharingTier;
  role: TeamMemberRole;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  coachEventGroups?: CoachEventGroup[];
  coachSpecialtyTitle?: string;
  assignedAthleteMembershipIds?: string[];
  invitedName: string;
  invitedEmail?: string;
  invitedPhone?: string;
  parentGuardianEmail?: string;
  graduationYear?: number;
  birthYear?: number;
  birthMonthYear?: string;
  isMinorU18: boolean;
  parentConsentStatus?: ParentConsentStatus;
  parentConsentToken?: string;
  parentConsentAt?: string;
  seedMarkOrFtp?: string;
  externalSource?: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  status: TeamInviteStatus;
  emailDeliveryStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  magicJoinUrl?: string; // Populated for coaches so they can copy or share via free sms:/mailto:
  invitedAt: string;
  openedAt?: string;
  joinedAt?: string;
  leftAt?: string;
  graduatedAt?: string;
  liveSnapshot?: TeamAthleteLiveSnapshot;
  coachRecordedActivities?: UnifiedActivity[];
}

export interface TeamBroadcastWorkout {
  broadcastId: string;
  teamId: string;
  targetSquadGroup: string; // 'ALL' or specific squad like 'Varsity'
  targetEventGroups?: CoachEventGroup[]; // Optional Event Group filter ('SPRINTS', 'MID_DISTANCE', 'DISTANCE')
  targetMembershipIds?: string[]; // Optional subset of membershipIds (e.g. single athlete or VDOT pod)
  date: string;
  name: string;
  sportCategory: SportCategory;
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  scheduledTime?: string;
  sessionSlot?: WorkoutSessionSlot;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  meetingNotes?: string;
  trackSpec?: TrackWorkoutSpec;
  athleteOverrides?: Record<
    string,
    {
      name?: string;
      workoutSyntax: string;
      description?: string;
      plannedDurationSecs?: number;
      plannedLoad?: number;
      scheduledTime?: string;
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  >;
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  isOfficialMeet?: boolean;
  externalSource?: ExternalTeamPlatform;
  pushedByCoachName: string;
  createdAt: string;
}

export interface PublicTeamHubMeetItem {
  id: string;
  date: string;
  name: string;
  scheduledTime?: string;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  description?: string;
  externalSource?: ExternalTeamPlatform;
}

export interface PublicTeamHubAthleteResultItem {
  date: string;
  meetName: string;
  eventLabel: string;
  eventDistanceMeters: number;
  displayFatTime: string;
  fatTimeSecs: number;
  placeFinish?: string;
  vdotScore: number;
  platform: OfficialRacePlatform;
  trackType: OfficialTrackSurface;
  sourceUrl?: string;
}

export interface PublicTeamHubFieldPrItem {
  id: string;
  membershipId?: string;
  displayName: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  graduationYear?: number;
  squadGroup?: string;
  eventCode: FieldEventCode;
  eventLabel: string;
  bestMarkMeters?: number;
  displayMark: string;
  windMps?: number;
  isWindAided?: boolean;
  multiPoints?: number;
  meetName?: string;
  date: string;
}

export interface PublicTeamHubRosterEntry {
  membershipId: string;
  name: string;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  graduationYear?: number;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  seedMarkOrFtp?: string;
  externalSource?: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  officialResults: PublicTeamHubAthleteResultItem[];
  fieldPrs?: PublicTeamHubFieldPrItem[];
}

export interface PublicTeamHubPayload {
  found: boolean;
  error?: string;
  brand?: {
    teamId: string;
    slug: string;
    joinCode?: string;
    name: string;
    shortName: string;
    mascotOrMotto?: string;
    orgType: TeamOrgType;
    primarySport: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
    logoDataUrl?: string;
    primaryHex: string;
    secondaryHex: string;
    defaultSafeSportShield: boolean;
    coachDisplayName: string;
    externalSync?: TeamExternalSyncConfig;
  };
  upcomingMeets: PublicTeamHubMeetItem[];
  recentSchedule: PublicTeamHubMeetItem[];
  rosterLeaderboard: PublicTeamHubRosterEntry[];
  fieldLeaderboard?: PublicTeamHubFieldPrItem[];
  announcements?: Array<
    Pick<TeamAnnouncementRecord, 'id' | 'title' | 'body' | 'category' | 'createdAt'>
  >;
  stats: {
    athleteCount: number;
    meetCount: number;
    officialResultCount: number;
    fieldPrCount?: number;
  };
}

export interface MeetDayPacketEntryRecord {
  id: string;
  athleteName: string;
  membershipId?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  division?: string;
  graduationYear?: number;
  eventCode: string;
  seedMarkRaw: string;
  relayTeamCode?: string;
  relayLegOrder?: 1 | 2 | 3 | 4;
}

export interface MeetDayPacketRecord {
  packetId: string;
  meetTitle: string;
  meetDate: string;
  laneCount: number;
  flightSize: number;
  partitionByDivision: boolean;
  entries: MeetDayPacketEntryRecord[];
  updatedAt: string;
  updatedByName?: string;
}

export type TeamInjuryRtpStage = 'OUT' | 'MODIFIED' | 'LIMITED' | 'CLEARED';

export interface TeamInjuryCaseRecord {
  id: string;
  teamId: string;
  membershipId: string;
  athleteName: string;
  bodyRegion: NonNullable<SessionCheckInRecord['painArea']>;
  severity: 'LOW' | 'MODERATE' | 'HIGH';
  rtpStage: TeamInjuryRtpStage;
  restrictions: string;
  coachGuidance: string;
  privateClinicalNotes?: string;
  targetReturnDate?: string;
  createdAt: string;
  updatedAt: string;
  updatedBySid?: string;
  updatedByName?: string;
}

export type TeamBillingPlanCode =
  | 'FREE_FOUNDING'
  | 'HS_250'
  | 'COLLEGIATE_1200'
  | 'DISTRICT_2000';

export type TeamBillingStatus =
  | 'PILOT'
  | 'PO_ISSUED'
  | 'ACTIVE_PAID'
  | 'RENEWAL_DUE'
  | 'PAST_DUE';

export interface SchoolPoInvoiceRecord {
  invoiceNumber: string;
  planCode: TeamBillingPlanCode;
  amountUsd: number;
  schoolOrDistrictName: string;
  poNumber?: string;
  billingContactEmail: string;
  issuedAt: string;
  dueDate: string;
  status: 'ISSUED' | 'PAID' | 'VOID';
  paidAt?: string;
}

export interface TeamBillingSummary {
  planCode: TeamBillingPlanCode;
  status: TeamBillingStatus;
  stripeConfigured?: boolean;
  billingCycleEndIso?: string;
  poNumber?: string;
  schoolOrDistrictName?: string;
  billingContactEmail?: string;
  poInvoices?: SchoolPoInvoiceRecord[];
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  updatedAt?: string;
}

export interface TeamSummaryWithRole {
  brand: TeamBrandConfig;
  myRole: TeamMemberRole;
  mySquadGroup: string;
  myEventGroup?: CoachEventGroup;
  myCoachEventGroups?: CoachEventGroup[];
  myCoachSpecialtyTitle?: string;
  myAssignedAthleteMembershipIds?: string[];
  myMembershipId: string;
  totalInvited: number;
  openedCount: number;
  activeCount: number;
  watchConnectedCount: number;
  memberships: TeamMembershipRecord[];
  broadcastWorkouts: TeamBroadcastWorkout[];
  workoutLibrary?: TeamWorkoutLibraryTemplate[];
  workoutComments?: TeamWorkoutComment[];
  guardianSafetyAlerts?: GuardianSafetyAlertRecord[];
  attendanceByDate?: Record<string, Record<string, TeamAttendanceRecord>>;
  announcements?: TeamAnnouncementRecord[];
  fieldMarkLogs?: FieldEventLogRecord[];
  fieldMarkLogsTotalCount?: number;
  meetDayPackets?: MeetDayPacketRecord[];
  injuryCases?: TeamInjuryCaseRecord[];
  billing?: TeamBillingSummary;
  teamMessages?: TeamMessageRecord[];
  messagingPolicy?: TeamMessagingPolicy;
}

export interface TeamInvitePreviewPayload {
  found: boolean;
  brand?: TeamBrandConfig;
  membership?: {
    membershipId: string;
    invitedName: string;
    invitedEmail?: string;
    parentGuardianEmail?: string;
    squadGroup: string;
    role: TeamMemberRole;
    coachSpecialtyTitle?: string;
    isMinorU18: boolean;
    birthYear?: number;
    parentConsentStatus?: ParentConsentStatus;
    seedMarkOrFtp?: string;
  };
}

export type ActiveTab =
  | 'calendar'
  | 'fitness'
  | 'trends'
  | 'charts'
  | 'activities'
  | 'curves'
  | 'totals'
  | 'stopwatch'
  | 'coach';

export type CoachWorkspaceSubTab = 'CLIPBOARD' | 'TEAM_PLAN' | 'STOPWATCH' | 'ROSTER';

export interface SessionCheckInRecord {
  id: string;
  date: string; // YYYY-MM-DD
  plannedEventId?: string;
  workoutName?: string;
  rpe: number; // 1..10
  painFlag?: boolean;
  painArea?:
    | 'KNEE'
    | 'SHIN'
    | 'ACHILLES'
    | 'HAMSTRING'
    | 'HIP'
    | 'GROIN'
    | 'QUAD'
    | 'ANKLE'
    | 'FOOT'
    | 'BACK'
    | 'SHOULDER'
    | 'ELBOW'
    | 'OTHER';
  sorenessNote?: string;
  autoSwappedToRecovery?: boolean;
  legFeel?: 'FRESH' | 'NORMAL' | 'HEAVY';
  lifeStressFlag?: boolean;
  sleepTargetHours?: number;
  tomorrowLocked?: boolean;
  ritualSlot?: 'MORNING' | 'POST_SESSION' | 'TONIGHT';
  createdAt: string;
}

export interface AthleteCloudStateEnvelope {
  version: 1;
  updatedAt: string;
  plannedEvents: PlannedWorkoutEvent[];
  targetGoals: TargetGoal[];
  annualMileageGoals: AnnualMileageGoal[];
  athleteProfile?: Partial<AthleteProfile>;
  distanceUnit?: DistanceUnit;
  gearItems?: AthleteGearItem[];
  sessionCheckIns?: SessionCheckInRecord[];
  coachArchivedActivities?: UnifiedActivity[];
}

export type CoachComplexityTier = 'ESSENTIALS' | 'PRO';

export type FieldEventCode =
  | 'LJ'
  | 'TJ'
  | 'HJ'
  | 'PV'
  | 'SP'
  | 'DISCUS'
  | 'JAVELIN'
  | 'HAMMER'
  | 'PENT'
  | 'HEPT'
  | 'DEC';

export type FieldAttemptOutcome = 'MARK' | 'FOUL' | 'PASS' | 'CLEAR' | 'MISS';

export interface FieldTrialEntry {
  attemptNumber: number;
  outcome: FieldAttemptOutcome;
  markMeters?: number;
  barHeightMeters?: number;
  windMps?: number;
  round?: 'PRELIM' | 'FINAL';
  note?: string;
}

export interface FieldEventLogRecord {
  id: string;
  teamId?: string;
  membershipId?: string;
  athleteName: string;
  date: string;
  eventCode: FieldEventCode;
  eventGroup: CoachEventGroup;
  isCompetition: boolean;
  meetOrPracticeTitle: string;
  flightName?: string;
  implementSpec?: string;
  poleSpec?: string;
  approachSteps?: number;
  attempts: FieldTrialEntry[];
  bestMarkMeters?: number;
  bestWindLegalMeters?: number;
  bestMarkWindMps?: number;
  isWindAidedBest?: boolean;
  isNoHeight?: boolean;
  missesAtClearingHeight?: number;
  totalVerticalMisses?: number;
  placeRank?: number;
  advancedToFinals?: boolean;
  multiPoints?: number;
  rpe?: number;
  clientBatchId?: string;
  createdAt: string;
}

export type TeamAttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'EXCUSED'
  | 'ABSENT'
  | 'INJURED_MODIFIED';

export interface TeamAttendanceRecord {
  date: string;
  membershipId: string;
  status: TeamAttendanceStatus;
  note?: string;
  updatedAt: string;
  updatedBySid?: string;
}

export type TeamAnnouncementCategory =
  | 'WEATHER'
  | 'SCHEDULE_CHANGE'
  | 'MEET_LOGISTICS'
  | 'GENERAL';

export interface TeamAnnouncementRecord {
  id: string;
  teamId: string;
  title: string;
  body: string;
  category: TeamAnnouncementCategory;
  targetEventGroups?: CoachEventGroup[];
  publishToParentHub: boolean;
  authorName: string;
  createdAt: string;
}

export type TeamMessageChannelScope =
  | 'ALL_TEAM'
  | 'EVENT_GROUP'
  | 'COACHES_STAFF'
  | 'DIRECT_TRANSPARENT';

export interface TeamMessageRecord {
  id: string;
  teamId: string;
  channelId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  targetMembershipId?: string;
  targetAthleteName?: string;
  senderSid: string;
  senderMembershipId: string;
  senderName: string;
  senderRole: TeamMemberRole;
  body: string;
  createdAt: string;
  guardianCcApplied: boolean;
  guardianEmailNotified?: boolean;
  secondAdultVisible: boolean;
  sentDuringQuietHours?: boolean;
  isEmergencyOverride?: boolean;
  acknowledgedByMembershipIds?: string[];
  flaggedForAdminReview?: boolean;
  flaggedReason?: string;
}

export interface TeamMessagingPolicy {
  athleteRepliesEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  requireGuardianCcForMinors: boolean;
}

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface StoredWebPushSubscription {
  id: string;
  userSid: string;
  endpoint: string;
  keys: WebPushSubscriptionKeys;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  muteQuietHours?: boolean;
}

export interface PushDispatchPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  isEmergency?: boolean;
}







