import type { NcaaTrackFacilityType, TrackWorkoutSpec } from './scholastic.ts';
import type {
  ActivityEnvironment,
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  OfficialRacePlatform,
  SportCategory,
  TrackFootwearClass,
  UnifiedActivity,
} from './telemetry.ts';
import type { MeetPriorityTier } from './timing.ts';

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

export type CoachWorkspaceSubTab = 'CLIPBOARD' | 'WORKOUTS' | 'TEAM_PLAN' | 'STOPWATCH' | 'ROSTER';

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
