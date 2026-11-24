import type { TrackFootwearClass } from './telemetry.ts';

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
