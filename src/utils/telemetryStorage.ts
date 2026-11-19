import {
  ActivityInterval,
  ActivitySourceBadge,
  ActivityStreamSet,
  AthleteGearItem,
  AthleteHrZone,
  AthletePowerZone,
  AthleteProfile,
  PlannedWorkoutEvent,
  StopwatchFusionMetadata,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { fuseWearableStreamWithStopwatchSplits } from './stopwatchActivitySynthesizer';
import {
  areActivityTimestampsClose,
  resolveActivityStartEpochMs,
  stripTimezoneSuffix,
} from './activityTimestamp';
import {
  bulkUpsertActivitiesToDexie,
  db,
  getStoreMetadata,
  hydrateUnifiedActivity,
  saveStoreMetadata,
} from '../db/workoutStore';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
  deriveObservedPhysiologyMetrics,
  getLocalDateIso,
  isEBikeActivityText,
  shiftIsoDate,
} from '../physiology/stravaLoadCalibration';

export const CURRENT_PMC_MODEL_VERSION = STRAVA_LOAD_MODEL_VERSION;

const IDB_NAME = 'aeropulse_telemetry_db';
const IDB_VERSION = 1;
const IDB_STORE = 'telemetry_snapshots';
const SNAPSHOT_KEY = 'primary_archive_v1';

export interface PersistedTelemetrySnapshot {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  gearItems: AthleteGearItem[];
  athleteProfile?: AthleteProfile;
  redactedStravaCount: number;
  earliestActivityDate?: string;
  pmcModelVersion?: number;
  ownerAthleteId?: string;
  savedAt: string;
}

const ZONE_COLORS_7 = [
  '#94A3B8', // Z1 Recovery
  '#0D9488', // Z2 Aerobic Base
  '#D97706', // Z3 Tempo
  '#EA580C', // Z4 Threshold
  '#DC2626', // Z5 VO2max
  '#7C3AED', // Z6 Anaerobic
  '#BE185D', // Z7 Neuromuscular
];

const DEFAULT_POWER_ZONE_NAMES = [
  'Active Recovery',
  'Endurance',
  'Tempo',
  'Lactate Threshold',
  'VO2 Max',
  'Anaerobic Capacity',
  'Neuromuscular Power',
];

const DEFAULT_HR_ZONE_NAMES = [
  'Z1 Recovery',
  'Z2 Aerobic Base',
  'Z3 Tempo',
  'Z4 Sub-Threshold',
  'Z5a Super-Threshold',
  'Z5b Aerobic Capacity',
  'Z5c Anaerobic',
];

const GARMIN_5_ZONE_HR_NAMES = [
  'Z1 Warm Up',
  'Z2 Easy',
  'Z3 Aerobic',
  'Z4 Threshold',
  'Z5 Maximum',
];

export function buildPowerZonesFromCeilings(
  ftp: number,
  indoorFtp: number,
  ceilingsPct?: number[],
  names?: string[]
): AthletePowerZone[] {
  const safeFtp = Math.max(100, Math.round(ftp || 300));
  const safeIndoorFtp = Math.max(100, Math.round(indoorFtp || safeFtp));
  const rawCeilings =
    Array.isArray(ceilingsPct) && ceilingsPct.length >= 6
      ? ceilingsPct
      : [55, 75, 90, 105, 120, 150, 999];

  const zones: AthletePowerZone[] = [];
  for (let i = 0; i < Math.min(7, rawCeilings.length); i++) {
    const minPct = i === 0 ? 0 : rawCeilings[i - 1] + 1;
    const maxPct = rawCeilings[i] >= 900 ? 250 : rawCeilings[i];
    const minWatts = i === 0 ? 0 : Math.round((rawCeilings[i - 1] / 100) * safeFtp) + 1;
    const maxWatts = Math.round((maxPct / 100) * safeFtp);
    const minIndoorWatts =
      i === 0 ? 0 : Math.round((rawCeilings[i - 1] / 100) * safeIndoorFtp) + 1;
    const maxIndoorWatts = Math.round((maxPct / 100) * safeIndoorFtp);

    zones.push({
      zone: i + 1,
      code: `Z${i + 1}`,
      name: (names && names[i]) || DEFAULT_POWER_ZONE_NAMES[i] || `Zone ${i + 1}`,
      minPct,
      maxPct,
      minWatts,
      maxWatts,
      minIndoorWatts,
      maxIndoorWatts,
      color: ZONE_COLORS_7[i] || '#9333EA',
    });
  }
  return zones;
}

export function buildHrZonesFromCeilings(
  lthr: number,
  maxHr: number,
  ceilingsBpm?: number[],
  names?: string[],
  floorsBpm?: number[]
): AthleteHrZone[] {
  const safeLthr = Math.max(120, Math.round(lthr || 153));
  const safeMaxHr = Math.max(safeLthr + 8, Math.round(maxHr || 175));

  // Garmin 5-Zone Lactate Threshold defaults if raw ceilings are not provided
  const defaultGarmin5Ceilings = [
    Math.round(safeLthr * 0.85),
    Math.round(safeLthr * 0.98),
    Math.round(safeLthr * 1.045),
    Math.round(safeLthr * 1.0915),
    safeMaxHr,
  ];

  const rawCeilings =
    Array.isArray(ceilingsBpm) && ceilingsBpm.length >= 5
      ? ceilingsBpm.map((v) => Number(v))
      : defaultGarmin5Ceilings;

  const isFiveZoneGarmin = rawCeilings.length === 5;
  const fallbackNames = isFiveZoneGarmin ? GARMIN_5_ZONE_HR_NAMES : DEFAULT_HR_ZONE_NAMES;

  const zones: AthleteHrZone[] = [];
  for (let i = 0; i < rawCeilings.length && i < 7; i++) {
    const explicitFloor =
      Array.isArray(floorsBpm) && floorsBpm[i] && Number(floorsBpm[i]) > 40
        ? Math.round(Number(floorsBpm[i]))
        : undefined;
    const minBpm =
      explicitFloor !== undefined
        ? explicitFloor
        : i === 0
          ? isFiveZoneGarmin
            ? Math.round(safeLthr * 0.712)
            : 60
          : rawCeilings[i - 1] + 1;
    const maxBpm =
      i === rawCeilings.length - 1 ? Math.max(rawCeilings[i], safeMaxHr) : rawCeilings[i];
    const minPctLthr = Math.round((minBpm / safeLthr) * 100);
    const maxPctLthr = Math.round((maxBpm / safeLthr) * 100);

    zones.push({
      zone: i + 1,
      code: `Z${i + 1}`,
      name: (names && names[i]) || fallbackNames[i] || `HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr,
      maxPctLthr,
      color: ZONE_COLORS_7[i] || '#EF4444',
    });
  }
  return zones;
}

export function isUncalibratedDefaultProfile(
  partial?: Partial<AthleteProfile> | null
): boolean {
  if (!partial) return true;
  if (partial.source === 'CUSTOM_OVERRIDE') return false;
  return Boolean(
    (partial.wPrime === 24500 && partial.pMax === 1180) ||
      (partial.wPrime === 18750 && partial.pMax === 900) ||
      (partial.ftp === 250 &&
        (partial.lthr === 163 || partial.lthr === 165) &&
        (partial.maxHr === 182 || partial.maxHr === 185)) ||
      (partial.lthr === 163 &&
        partial.maxHr === 182 &&
        (partial.vo2MaxCycling === 56 ||
          partial.restingHr === 49 ||
          partial.restingHr === 50))
  );
}

export function isGenericAthleteName(name?: string | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'athlete' ||
    normalized === 'primary athlete' ||
    normalized === 'strava athlete' ||
    normalized === 'strava user'
  );
}

export function calibrateMetricsFromActivitiesClient(
  activities?: UnifiedActivity[] | null,
  weightKg = 70
) {
  return deriveObservedPhysiologyMetrics(activities, weightKg);
}

/**
 * Clears falsely collapsed thresholds persisted under legacy v1 calibration when
 * only casual / un-metered sessions were present (unless user set CUSTOM_OVERRIDE).
 */
export function sanitizeStaleCollapsedProfile(
  profile?: Partial<AthleteProfile> | null
): Partial<AthleteProfile> | undefined {
  if (!profile) return undefined;
  if (profile.source === 'CUSTOM_OVERRIDE') return profile;
  const next = { ...profile };
  if (typeof next.ftp === 'number' && next.ftp > 0 && next.ftp < 140) {
    delete next.ftp;
    delete next.indoorFtp;
    delete next.eFtp;
    delete next.wPrime;
    delete next.pMax;
    delete next.powerZones;
  }
  if (typeof next.lthr === 'number' && next.lthr > 0 && next.lthr < 145) {
    delete next.lthr;
    delete next.hrZones;
  }
  if (typeof next.runLthr === 'number' && next.runLthr > 0 && next.runLthr < 148) {
    delete next.runLthr;
    delete next.runHrZones;
  }
  if (
    typeof next.thresholdPaceSecsPerKm === 'number' &&
    next.thresholdPaceSecsPerKm > 430
  ) {
    delete next.thresholdPaceSecsPerKm;
    delete next.runFtp;
    delete next.runEFtp;
  }
  return next;
}

/**
 * Re-normalizes pure Strava and Garmin Personal API activities on client boot/hydration
 * using the v3 physiological load model so legacy Strava `suffer_score` spikes and
 * Garmin EPOC / Running-Watts-vs-Bike-FTP distortions self-heal immediately.
 */
export function recalibrateStravaActivityLoadClient(
  act: UnifiedActivity,
  profile?: Partial<AthleteProfile> | null
): UnifiedActivity {
  if (!act || act.officialRaceData) return act;
  if ((act.loadModelVersion || 0) >= CURRENT_PMC_MODEL_VERSION) return act;

  if (act.quickLog?.rpe && act.movingTimeSecs > 0) {
    const hrs = act.movingTimeSecs / 3600;
    const rpeIf = Math.max(0.4, Math.min(1.18, 0.32 + act.quickLog.rpe * 0.082));
    const rpeLoad = Math.round(hrs * 100 * rpeIf * rpeIf);
    const resolvedLoad = Math.max(act.trainingLoad || 0, rpeLoad);
    return {
      ...act,
      trainingLoad: resolvedLoad,
      intensityFactor: act.intensityFactor || Number(rpeIf.toFixed(2)),
      loadModelVersion: CURRENT_PMC_MODEL_VERSION,
    };
  }

  const isGarminSourced =
    act.id.startsWith('garmin-') ||
    Boolean((act as any).garminId || (act as any).garminActivityId) ||
    Boolean(act.sourceBadges?.includes('Garmin'));
  const isStravaSourced =
    act.id.startsWith('strava-') ||
    Boolean(act.stravaId) ||
    Boolean(act.sourceBadges?.includes('Strava'));
  const hasAuthoritativeIntervals =
    Boolean(act.intervalsId || (act as any).intervalsActivityId) ||
    Boolean(act.sourceBadges?.includes('Intervals.icu'));

  // Intervals.icu-only sessions without Garmin EPOC pollution keep their Intervals load
  if (hasAuthoritativeIntervals && !isGarminSourced) return act;
  if (!isGarminSourced && !isStravaSourced) return act;

  const hasAnyGps =
    Boolean(act.summaryPolyline && act.summaryPolyline.length > 4) ||
    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
    (Array.isArray(act.startLatLng) && act.startLatLng.length === 2);

  // Re-classify legacy coerced 'Strength' / 'Gym' records (hikes, rows, elliptical, yoga, HIIT) when rawSportType exists
  const reclassified = act.rawSportType
    ? classifyMultiSportActivity(act.rawSportType, act.name, {
        trainer: act.environment === 'INDOOR',
        hasGps: hasAnyGps,
        isVirtualPlatform: act.subType === 'Virtual Cycling',
      })
    : null;
  const resolvedSportCategory = reclassified ? reclassified.sportCategory : act.sportCategory;
  const resolvedSubType = reclassified ? reclassified.subType : act.subType;
  const resolvedEnvironment = reclassified ? reclassified.environment : act.environment;

  const isEBike = resolvedSubType === 'EBike' || isEBikeActivityText(act.rawSportType, act.name);
  // Treat legacy Strava outdoor rides without deviceWatts metadata and identical NP/AvgP as un-metered
  const hasLegacyEstimatedWatts =
    !isGarminSourced &&
    resolvedSportCategory === 'Cycling' &&
    act.deviceWatts === undefined &&
    resolvedEnvironment !== 'INDOOR' &&
    (act.normalizedPower || 0) === (act.avgPower || 0);
  const hasRealCyclingWatts =
    !isEBike &&
    resolvedSportCategory === 'Cycling' &&
    act.deviceWatts !== false &&
    !hasLegacyEstimatedWatts &&
    (act.normalizedPower || act.avgPower || 0) > 0;
  const hasRealErgOrRunWatts =
    !isEBike &&
    (resolvedSportCategory === 'Running' ||
      resolvedSubType === 'Rowing' ||
      resolvedSubType === 'Nordic Ski') &&
    act.deviceWatts === true &&
    (act.normalizedPower || act.avgPower || 0) > 0;

  // Preserve Running/Rowing/Ski power fields while stripping un-metered Strava/Garmin cycling estimates
  const nextAvgPower =
    resolvedSportCategory === 'Cycling'
      ? hasRealCyclingWatts
        ? act.avgPower
        : undefined
      : isEBike
        ? undefined
        : act.avgPower;
  const nextNp =
    resolvedSportCategory === 'Cycling'
      ? hasRealCyclingWatts
        ? act.normalizedPower
        : undefined
      : isEBike
        ? undefined
        : act.normalizedPower;

  const safeProfile = sanitizeStaleCollapsedProfile(profile);
  const loadResult = computeStravaActivityLoadV2({
    sportCategory: resolvedSportCategory,
    rawSportType: act.rawSportType,
    name: act.name,
    environment: resolvedEnvironment,
    movingTimeSecs: act.movingTimeSecs,
    distanceMeters: act.distanceMeters,
    elevationGainMeters: act.elevationGainMeters,
    normalizedPower: nextNp,
    avgPower: nextAvgPower,
    hasRealDeviceWatts: hasRealCyclingWatts || hasRealErgOrRunWatts,
    avgHr: act.avgHr,
    maxHr: act.maxHr,
    avgPaceSecsPerKm: act.avgPaceSecsPerKm,
    calibratedFtp: Math.max(120, Number(safeProfile?.ftp || 250)),
    calibratedBikeLthr: Math.max(135, Number(safeProfile?.lthr || 163)),
    calibratedRunLthr: Math.max(140, Number(safeProfile?.runLthr || 168)),
    calibratedThresholdPaceSecsPerKm: Math.max(
      155,
      Number(safeProfile?.thresholdPaceSecsPerKm || 255)
    ),
    restingHr: Math.max(38, Math.min(78, Number(safeProfile?.restingHr || 54))),
  });

  let nextEf = act.efficiencyFactor;
  if (!hasRealCyclingWatts && resolvedSportCategory === 'Cycling') {
    nextEf = 0;
  } else if (
    resolvedSportCategory === 'Running' &&
    (act.efficiencyFactor || 0) > 2.5 &&
    act.distanceMeters > 0 &&
    act.movingTimeSecs > 0 &&
    act.avgHr > 0
  ) {
    nextEf = Number(((act.distanceMeters / (act.movingTimeSecs / 60)) / act.avgHr).toFixed(2));
  }

  return {
    ...act,
    sportCategory: resolvedSportCategory,
    subType: resolvedSubType,
    environment: resolvedEnvironment,
    avgPower: nextAvgPower,
    normalizedPower: nextNp,
    deviceWatts: resolvedSportCategory === 'Cycling' ? hasRealCyclingWatts : act.deviceWatts,
    intensityFactor: loadResult.intensityFactor,
    trainingLoad: loadResult.trainingLoad,
    loadModelVersion: CURRENT_PMC_MODEL_VERSION,
    efficiencyFactor: nextEf,
  };
}

export const recalibrateActivityLoadClient = recalibrateStravaActivityLoadClient;

export function buildCompleteAthleteProfile(
  partial?: Partial<AthleteProfile> | null,
  latestWellness?: UnifiedWellnessDay,
  activities?: UnifiedActivity[] | null
): AthleteProfile {
  // Detect if `partial` was saved with any of the hardcoded synthetic defaults (250W, 280W, or 300W)
  const isLegacyHardcodedProfile = isUncalibratedDefaultProfile(partial);

  const storedWeight =
    typeof window !== 'undefined'
      ? Number(window.localStorage.getItem('aeropulse_strava_athlete_weight_kg') || 0)
      : 0;
  const storedFtp =
    typeof window !== 'undefined'
      ? Number(window.localStorage.getItem('aeropulse_strava_athlete_ftp') || 0)
      : 0;

  const weightKg = Number(
    (!isLegacyHardcodedProfile && partial?.weightKg && partial.weightKg !== 70
      ? partial.weightKg
      : 0) ||
      (latestWellness?.weightKg && latestWellness.weightKg !== 70 ? latestWellness.weightKg : 0) ||
      (storedWeight > 30 ? storedWeight : 0) ||
      partial?.weightKg ||
      latestWellness?.weightKg ||
      70.0
  );

  const obs = calibrateMetricsFromActivitiesClient(activities, weightKg);

  const isDefaultFtpPlaceholder =
    partial?.source !== 'CUSTOM_OVERRIDE' &&
    (isLegacyHardcodedProfile ||
      partial?.ftp === 250 ||
      partial?.ftp === 280 ||
      partial?.ftp === 300);

  const rawFtp = isDefaultFtpPlaceholder
    ? latestWellness?.rideEftp || obs.obsFtp || storedFtp || partial?.ftp
    : partial?.ftp;

  const ftp = Number(rawFtp || latestWellness?.rideEftp || obs.obsFtp || storedFtp || 250);
  const indoorFtp = Number(
    (!isDefaultFtpPlaceholder && partial?.indoorFtp) || ftp
  );
  const eFtp = Number(
    latestWellness?.rideEftp ||
      (!isDefaultFtpPlaceholder && partial?.eFtp) ||
      obs.obsFtp ||
      ftp
  );
  const wPrime = Number(
    latestWellness?.rideWPrime ||
      (!isDefaultFtpPlaceholder && partial?.wPrime && partial.wPrime !== 18750
        ? partial.wPrime
        : 0) ||
      obs.obsWPrime ||
      Math.round(ftp * 75)
  );
  const pMax = Number(
    latestWellness?.ridePMax ||
      (!isDefaultFtpPlaceholder && partial?.pMax && partial.pMax !== 900
        ? partial.pMax
        : 0) ||
      obs.obsPMax ||
      Math.round(ftp * 3.6)
  );
  const lthr = Number(
    (!isLegacyHardcodedProfile && partial?.lthr && partial.lthr !== 163 ? partial.lthr : 0) ||
      obs.obsBikeLthr ||
      partial?.lthr ||
      153
  );
  const maxHr = Number(
    (!isLegacyHardcodedProfile && partial?.maxHr && partial.maxHr !== 182 ? partial.maxHr : 0) ||
      obs.obsBikeMaxHr ||
      partial?.maxHr ||
      Math.max(lthr + 15, 175)
  );
  const restingHr = Number(
    (latestWellness?.restingHR && latestWellness.restingHR > 25 ? latestWellness.restingHR : 0) ||
      (!isLegacyHardcodedProfile && partial?.restingHr && partial.restingHr !== 50
        ? partial.restingHr
        : 0) ||
      partial?.restingHr ||
      50
  );
  const vo2MaxCycling = Number(
    (latestWellness?.vo2MaxCycling && latestWellness.vo2MaxCycling !== 50
      ? latestWellness.vo2MaxCycling
      : 0) ||
      (!isLegacyHardcodedProfile && partial?.vo2MaxCycling) ||
      obs.obsVo2Bike ||
      Math.max(35, Math.min(85, Math.round(10.8 * (ftp / weightKg) + 7)))
  );
  const vo2MaxRunning = Number(
    (latestWellness?.vo2MaxRunning && latestWellness.vo2MaxRunning !== 50
      ? latestWellness.vo2MaxRunning
      : 0) ||
      (!isLegacyHardcodedProfile && partial?.vo2MaxRunning) ||
      obs.obsVo2Run ||
      vo2MaxCycling
  );

  const thresholdPaceSecsPerKm = Number(
    (!isLegacyHardcodedProfile &&
    partial?.thresholdPaceSecsPerKm &&
    partial.thresholdPaceSecsPerKm !== 255
      ? partial.thresholdPaceSecsPerKm
      : 0) ||
      obs.obsThresholdPace ||
      partial?.thresholdPaceSecsPerKm ||
      255
  );
  const runFtp = Number(
    latestWellness?.runEftp ||
      (!isLegacyHardcodedProfile && partial?.runFtp && partial.runFtp !== 269
        ? partial.runFtp
        : 0) ||
      obs.obsRunFtp ||
      Math.round(weightKg * (1000 / Math.max(160, thresholdPaceSecsPerKm)) * 0.98)
  );
  const runEFtp = Number(
    latestWellness?.runEftp ||
      (!isLegacyHardcodedProfile && partial?.runEFtp && partial.runEFtp !== 269
        ? partial.runEFtp
        : 0) ||
      runFtp
  );
  const runLthr = Number(
    (!isLegacyHardcodedProfile && partial?.runLthr && partial.runLthr !== 167
      ? partial.runLthr
      : 0) ||
      obs.obsRunLthr ||
      Math.min(maxHr - 4, lthr + 2)
  );
  const runMaxHr = Number(
    (!isLegacyHardcodedProfile && partial?.runMaxHr && partial.runMaxHr !== 182
      ? partial.runMaxHr
      : 0) ||
      obs.obsRunMaxHr ||
      Math.max(runLthr + 12, maxHr)
  );

  const powerZones =
    !isLegacyHardcodedProfile &&
    Array.isArray(partial?.powerZones) &&
    partial!.powerZones!.length >= 5
      ? partial!.powerZones!.map((pz, idx) => ({
          ...pz,
          minWatts:
            idx === 0
              ? 0
              : Math.round(((partial!.powerZones![idx - 1]?.maxPct || pz.minPct) / 100) * ftp) + 1,
          maxWatts: Math.round((pz.maxPct / 100) * ftp),
          minIndoorWatts:
            idx === 0
              ? 0
              : Math.round(
                  ((partial!.powerZones![idx - 1]?.maxPct || pz.minPct) / 100) * indoorFtp
                ) + 1,
          maxIndoorWatts: Math.round((pz.maxPct / 100) * indoorFtp),
        }))
      : buildPowerZonesFromCeilings(ftp, indoorFtp);

  const hasStale7ZoneDefaultHr =
    partial?.source !== 'CUSTOM_OVERRIDE' &&
    Array.isArray(partial?.hrZones) &&
    partial!.hrZones!.length === 7 &&
    partial!.hrZones![0]?.minBpm === 60 &&
    partial!.hrZones![0]?.maxBpm === 132;

  const hrZones =
    !isLegacyHardcodedProfile &&
    !hasStale7ZoneDefaultHr &&
    Array.isArray(partial?.hrZones) &&
    partial!.hrZones!.length >= 5
      ? partial!.hrZones!
      : buildHrZonesFromCeilings(lthr, maxHr);

  const hasStale7ZoneDefaultRunHr =
    partial?.source !== 'CUSTOM_OVERRIDE' &&
    Array.isArray(partial?.runHrZones) &&
    partial!.runHrZones!.length === 7 &&
    partial!.runHrZones![0]?.minBpm === 60 &&
    partial!.runHrZones![0]?.maxBpm === 135;

  const runHrZones =
    !isLegacyHardcodedProfile &&
    !hasStale7ZoneDefaultRunHr &&
    Array.isArray(partial?.runHrZones) &&
    partial!.runHrZones!.length >= 5
      ? partial!.runHrZones!
      : buildHrZonesFromCeilings(runLthr, runMaxHr);

  const storedGarminName =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('aeropulse_garmin_athlete_name')?.trim()
      : undefined;
  const storedStravaName =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('aeropulse_strava_athlete_name')?.trim()
      : undefined;
  const storedIntervalsName =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('aeropulse_intervals_athlete_name')?.trim()
      : undefined;
  const resolvedName =
    partial?.name && !isGenericAthleteName(partial.name)
      ? partial.name.trim()
      : storedGarminName && !isGenericAthleteName(storedGarminName)
        ? storedGarminName
        : storedStravaName && !isGenericAthleteName(storedStravaName)
          ? storedStravaName
          : storedIntervalsName && !isGenericAthleteName(storedIntervalsName)
            ? storedIntervalsName
            : 'Athlete';

  const storedPrimarySportRaw =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('thresh_primary_sport')?.trim()
      : undefined;
  const storedPrimarySport: AthleteProfile['primarySport'] =
    storedPrimarySportRaw === 'Running' ||
    storedPrimarySportRaw === 'Cycling' ||
    storedPrimarySportRaw === 'Hybrid'
      ? storedPrimarySportRaw
      : undefined;
  const resolvedPrimarySport: AthleteProfile['primarySport'] =
    partial?.primarySport || storedPrimarySport;

  return {
    athleteId: partial?.athleteId || '0',
    name: resolvedName,
    ...(resolvedPrimarySport ? { primarySport: resolvedPrimarySport } : {}),
    weightKg: Number(weightKg.toFixed(1)),
    restingHr: Math.round(restingHr),
    vo2MaxCycling: Math.round(vo2MaxCycling),
    vo2MaxRunning: Math.round(vo2MaxRunning),
    ftp: Math.round(ftp),
    indoorFtp: Math.round(indoorFtp),
    eFtp: Math.round(eFtp),
    wPrime: Math.round(wPrime),
    pMax: Math.round(pMax),
    lthr: Math.round(lthr),
    maxHr: Math.round(maxHr),
    sweetSpotMinPct: partial?.sweetSpotMinPct || 84,
    sweetSpotMaxPct: partial?.sweetSpotMaxPct || 97,
    runFtp: Math.round(runFtp),
    runEFtp: Math.round(runEFtp),
    runLthr: Math.round(runLthr),
    runMaxHr: Math.round(runMaxHr),
    thresholdPaceSecsPerKm: Number(thresholdPaceSecsPerKm.toFixed(1)),
    powerZones,
    hrZones,
    runHrZones,
    thresholdHistory: Array.isArray(partial?.thresholdHistory)
      ? partial.thresholdHistory
      : undefined,
    safeSportHideWeight: Boolean(partial?.safeSportHideWeight),
    academicDivision: partial?.academicDivision,
    competitionGender: partial?.competitionGender,
    ferritinNgMl:
      typeof partial?.ferritinNgMl === 'number' && partial.ferritinNgMl > 0
        ? Number(partial.ferritinNgMl.toFixed(1))
        : undefined,
    lastSyncedAt: partial?.lastSyncedAt || new Date().toISOString(),
    source: partial?.source || 'INTERVALS_GARMIN',
  };
}

const VIRTUAL_PLATFORM_REGEX =
  /\b(zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|titan'?s grove| fuego flats|epic kom|radio tower|innsbruckring|richmond uci|sand and sequoias|temples and towers|sleepless city|wandering flats|mech isle|fine and sandy|sugar cookie|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt|wahoo rgt|virtual ride|virtual cycling|pacer group|robopacer|tour de zwift|zrl|zwift racing|ttt)\b/i;

const SMART_TRAINER_REGEX =
  /\b(trainerroad|trainer road|wahoo systm|sufferfest|peloton|kickr|tacx|neo 2t|elite direto|elite suito|sarais|h3|wattbike|stages bike|concept2|bikeerg|zwift ride|zwift hub|smart trainer|indoor cycling|indoor ride|indoor bike|stationary bike|erg mode|ramp test|spinbike|spinning|garmin indoor)\b/i;

/**
 * Checks whether a GPS coordinate pair falls inside known Virtual Cycling worlds
 * (e.g. Zwift Watopia, Makuri Islands, France, and Paris located in Solomon / Santa Cruz Islands).
 */
export function isVirtualWorldLatLng(latLng?: [number, number] | null): boolean {
  if (!Array.isArray(latLng) || latLng.length < 2) return false;
  const [lat, lng] = latLng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  // Watopia, Makuri Islands, Virtual France & Virtual Paris (Temotu / Santa Cruz Islands, Solomon Islands)
  if (lat >= -12.6 && lat <= -9.8 && lng >= 164.8 && lng <= 168.0) {
    return true;
  }
  return false;
}

/**
 * Normalizes and re-classifies any activity so Virtual Cycling (Zwift, Rouvy, MyWhoosh, VirtualRide)
 * and Smart Trainer sessions (TrainerRoad, Peloton, Wahoo, KICKR, Tacx, zero-GPS indoor rides)
 * are accurately tagged with environment: 'INDOOR' and subType: 'Virtual Cycling' | 'Smart Trainer'.
 */
export function reclassifyActivityEnvironment(act: UnifiedActivity): UnifiedActivity {
  if (!act) return act;

  const combinedText = `${act.name || ''} ${act.deviceName || ''} ${act.gearName || ''} ${act.subType || ''}`;
  const isVirtualText = VIRTUAL_PLATFORM_REGEX.test(combinedText);
  const isTrainerText = SMART_TRAINER_REGEX.test(combinedText);

  const sampleLatLng =
    act.startLatLng ||
    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 0 ? act.routeLatLngs[0] : undefined) ||
    (act.streams?.latlng && act.streams.latlng.length > 0 ? act.streams.latlng[0] : undefined);

  const hasVirtualWorldGps = isVirtualWorldLatLng(sampleLatLng);

  const hasAnyGps =
    Boolean(act.summaryPolyline && act.summaryPolyline.length > 4) ||
    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
    (Array.isArray(act.startLatLng) && act.startLatLng.length === 2) ||
    (Array.isArray(act.streams?.latlng) && act.streams!.latlng!.length > 2);

  if (act.sportCategory === 'Cycling') {
    if (act.subType === 'EBike') return act;
    const isStationaryZeroGpsRide =
      !hasAnyGps &&
      (act.elevationGainMeters === 0 || (act.avgPower || 0) > 0 || act.movingTimeSecs > 300);

    if (
      act.environment === 'INDOOR' ||
      isVirtualText ||
      isTrainerText ||
      hasVirtualWorldGps ||
      isStationaryZeroGpsRide
    ) {
      const nextSubType: UnifiedActivity['subType'] =
        isVirtualText || hasVirtualWorldGps || act.subType === 'Virtual Cycling'
          ? 'Virtual Cycling'
          : 'Smart Trainer';

      if (act.environment === 'INDOOR' && act.subType === nextSubType) {
        return act;
      }
      return {
        ...act,
        environment: 'INDOOR',
        subType: nextSubType,
      };
    }
  } else if (act.sportCategory === 'Running') {
    const isTreadmillText = /\b(treadmill|indoor run|zwift run|woodway|peloton tread|track indoor)\b/i.test(
      combinedText
    );
    const isExplicitTrackOrXc =
      act.subType === 'Track' ||
      act.subType === 'Cross Country' ||
      Boolean(act.trackFacility) ||
      Boolean(act.stopwatchFusionMeta) ||
      Boolean(act.matchedStopwatchId) ||
      Boolean(act.officialRaceData) ||
      act.id.startsWith('stopwatch-');
    if (isExplicitTrackOrXc && !isTreadmillText) {
      return act;
    }
    const isZeroGpsRun = !hasAnyGps && act.elevationGainMeters === 0 && act.movingTimeSecs > 180;
    if (act.environment === 'INDOOR' || isTreadmillText || isZeroGpsRun) {
      if (act.environment === 'INDOOR' && act.subType === 'Treadmill') return act;
      return {
        ...act,
        environment: 'INDOOR',
        subType: 'Treadmill',
      };
    }
  }

  return act;
}

function openTelemetryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

function purgeLegacyTelemetryDb(): void {
  try {
    if (typeof window !== 'undefined' && window.indexedDB) {
      window.indexedDB.deleteDatabase(IDB_NAME);
    }
  } catch {
    // ignore
  }
}

async function loadLegacyTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    if ('databases' in window.indexedDB && typeof window.indexedDB.databases === 'function') {
      const dbs = await window.indexedDB.databases();
      if (!dbs.some((d) => d.name === IDB_NAME)) {
        return null;
      }
    }
    const idb = await openTelemetryDb();
    const result = await new Promise<PersistedTelemetrySnapshot | null>((resolve, reject) => {
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        resolve(null);
        return;
      }
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(SNAPSHOT_KEY);
      getReq.onsuccess = () => {
        const val = getReq.result as PersistedTelemetrySnapshot | undefined;
        if (val && Array.isArray(val.activities)) {
          resolve({
            ...val,
            activities: val.activities.map(reclassifyActivityEnvironment),
          });
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
    idb.close();
    return result;
  } catch {
    return null;
  }
}

export async function loadPersistedTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    // Deliberately omit `db.activityStreams.toArray()` on boot so 1Hz telemetry streams stay
    // lazily decoupled in IndexedDB until an individual activity is inspected.
    const [storedActivities, wellnessDays, plannedEvents, gearItems, snapshotMeta] =
      await Promise.all([
        db.activities.orderBy('start_date').reverse().toArray(),
        db.wellnessDays.orderBy('date').toArray(),
        db.plannedEvents.orderBy('date').toArray(),
        db.gearItems.toArray(),
        getStoreMetadata<{
          athleteProfile?: AthleteProfile;
          redactedStravaCount?: number;
          earliestActivityDate?: string;
          pmcModelVersion?: number;
          ownerAthleteId?: string;
          savedAt?: string;
        }>('snapshot_meta'),
      ]);

    const realStoredActivities = storedActivities.filter((rec) => !/^act-\d+$/.test(rec.id));
    if (realStoredActivities.length > 0) {
      purgeLegacyTelemetryDb();
      const hydratedActivities = deduplicateActivitiesArchive(
        realStoredActivities.map((rec) =>
          reclassifyActivityEnvironment(hydrateUnifiedActivity(rec))
        )
      );
      const hasIntervals = hydratedActivities.some(
        (a) =>
          Boolean(a.intervalsId || (a as any).intervalsActivityId) ||
          a.sourceBadges?.includes('Intervals.icu')
      );
      const storedVersion = Number(snapshotMeta?.pmcModelVersion || 0);
      const todayIso = getLocalDateIso();
      if (storedVersion < CURRENT_PMC_MODEL_VERSION) {
        const sanitizedProfile = sanitizeStaleCollapsedProfile(snapshotMeta?.athleteProfile) as
          | AthleteProfile
          | undefined;
        const recalibratedActs = hydratedActivities.map((act) =>
          recalibrateStravaActivityLoadClient(act, sanitizedProfile)
        );
        const recomputedWellness = repairAndRecomputeWellnessDays(
          wellnessDays,
          recalibratedActs,
          todayIso,
          { forceFullRecomputeIfNoCliff: !hasIntervals }
        );
        return {
          activities: recalibratedActs,
          wellnessDays: recomputedWellness,
          plannedEvents,
          gearItems,
          athleteProfile: sanitizedProfile,
          redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
          earliestActivityDate:
            snapshotMeta?.earliestActivityDate ||
            recalibratedActs[recalibratedActs.length - 1]?.startDateLocal?.slice(0, 10),
          pmcModelVersion: storedVersion || 1,
          ownerAthleteId: snapshotMeta?.ownerAthleteId,
          savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
        };
      }
      const repairedWellness = repairAndRecomputeWellnessDays(
        wellnessDays,
        hydratedActivities,
        todayIso,
        { profile: snapshotMeta?.athleteProfile }
      );
      return {
        activities: hydratedActivities,
        wellnessDays: repairedWellness,
        plannedEvents,
        gearItems,
        athleteProfile: snapshotMeta?.athleteProfile,
        redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
        earliestActivityDate:
          snapshotMeta?.earliestActivityDate ||
          hydratedActivities[hydratedActivities.length - 1]?.startDateLocal?.slice(0, 10),
        pmcModelVersion: storedVersion || CURRENT_PMC_MODEL_VERSION,
        ownerAthleteId: snapshotMeta?.ownerAthleteId,
        savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
      };
    }

    // Migrate legacy raw IndexedDB snapshot once if present, then permanently delete `aeropulse_telemetry_db`
    const legacy = await loadLegacyTelemetrySnapshot();
    if (legacy) {
      const realLegacyActivities = legacy.activities.filter((rec) => !/^act-\d+$/.test(rec.id));
      if (realLegacyActivities.length > 0) {
        const cleanedLegacy = { ...legacy, activities: realLegacyActivities };
        await savePersistedTelemetrySnapshot(cleanedLegacy);
        purgeLegacyTelemetryDb();
        // Return summary-only activities in memory after persisting streams to Dexie
        return {
          ...cleanedLegacy,
          activities: realLegacyActivities.map(({ streams: _s, ...summary }) => summary),
        };
      }
      purgeLegacyTelemetryDb();
    }

    return null;
  } catch {
    return null;
  }
}

export async function savePersistedTelemetrySnapshot(
  snapshot: Omit<PersistedTelemetrySnapshot, 'savedAt'> & { savedAt?: string }
): Promise<string | null> {
  try {
    const savedAt = snapshot.savedAt || new Date().toISOString();
    const normalizedActivities = Array.isArray(snapshot.activities)
      ? snapshot.activities.map(reclassifyActivityEnvironment)
      : [];

    await bulkUpsertActivitiesToDexie(normalizedActivities);

    await db.transaction(
      'rw',
      db.wellnessDays,
      db.plannedEvents,
      db.gearItems,
      db.metadata,
      async () => {
        if (Array.isArray(snapshot.wellnessDays)) {
          await db.wellnessDays.clear();
          if (snapshot.wellnessDays.length > 0) {
            await db.wellnessDays.bulkPut(snapshot.wellnessDays);
          }
        }
        if (Array.isArray(snapshot.plannedEvents)) {
          await db.plannedEvents.clear();
          if (snapshot.plannedEvents.length > 0) {
            await db.plannedEvents.bulkPut(snapshot.plannedEvents);
          }
        }
        if (Array.isArray(snapshot.gearItems) && snapshot.gearItems.length > 0) {
          await db.gearItems.bulkPut(snapshot.gearItems);
        }
        let ownerAthleteId = snapshot.ownerAthleteId;
        if (!ownerAthleteId && typeof localStorage !== 'undefined') {
          try {
            ownerAthleteId =
              localStorage.getItem('aeropulse_store_owner_athlete_id') ||
              localStorage.getItem('aeropulse_strava_athlete_id') ||
              undefined;
          } catch {
            ownerAthleteId = undefined;
          }
        }
        await saveStoreMetadata('snapshot_meta', {
          athleteProfile: snapshot.athleteProfile,
          redactedStravaCount: snapshot.redactedStravaCount || 0,
          earliestActivityDate: snapshot.earliestActivityDate,
          pmcModelVersion: snapshot.pmcModelVersion ?? CURRENT_PMC_MODEL_VERSION,
          ownerAthleteId,
          savedAt,
        });
      }
    );

    return savedAt;
  } catch {
    return null;
  }
}

export async function clearPersistedTelemetrySnapshot(): Promise<void> {
  try {
    await db.transaction(
      'rw',
      [db.activities, db.activityStreams, db.wellnessDays, db.plannedEvents, db.gearItems, db.metadata],
      async () => {
        await Promise.all([
          db.activities.clear(),
          db.activityStreams.clear(),
          db.wellnessDays.clear(),
          db.plannedEvents.clear(),
          db.gearItems.clear(),
          db.metadata.clear(),
        ]);
      }
    );
  } catch {
    // ignore
  }
  purgeLegacyTelemetryDb();
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      await window.caches.delete('aeropulse-telemetry-api-swr');
    }
  } catch {
    // ignore
  }
}

/**
 * Finds an existing activity that matches a candidate activity within a time proximity window (default ±300s / 5 min)
 * and matching sport category to prevent duplicate ingestion across Strava, Garmin, Wahoo, Polar, and Intervals.icu.
 */
export function findMatchingActivityByProximity(
  candidate: { startDateLocal?: string; startDateUtcMs?: number; sportCategory?: string },
  existing: UnifiedActivity[],
  windowSecs = 300
): UnifiedActivity | undefined {
  if (!candidate.startDateLocal && !(candidate.startDateUtcMs && candidate.startDateUtcMs > 0)) {
    return undefined;
  }

  for (const act of existing) {
    if (candidate.sportCategory && act.sportCategory !== candidate.sportCategory) continue;
    if (areActivityTimestampsClose(candidate, act, windowSecs)) {
      return act;
    }
  }
  return undefined;
}

const GENERIC_WATCH_RUN_NAME_RE =
  /^(morning|lunch|afternoon|evening|night|indoor|outdoor|track|treadmill)?\s*(track\s*)?(run|running|workout)$/i;

/**
 * Returns true if an activity originated directly from the local Trackside Stopwatch (`#stopwatch`)
 * rather than a hardware watch or cloud wearable sync (Strava, Intervals.icu, Wahoo, Polar, Garmin .FIT).
 */
export function isSyntheticStopwatchActivity(act: UnifiedActivity | null | undefined): boolean {
  if (!act || !act.id) return false;
  if (
    act.stravaId ||
    act.intervalsId ||
    (act as { intervalsActivityId?: string }).intervalsActivityId ||
    act.wahooId ||
    act.polarId ||
    (act.matchedStopwatchId && act.matchedStopwatchId !== act.id)
  ) {
    return false;
  }
  if (act.id.startsWith('stopwatch-workout-') || act.id.startsWith('stopwatch-race-')) {
    return true;
  }
  if (String(act.deviceName || '').startsWith('THRESH Trackside Stopwatch')) {
    return true;
  }
  return Boolean(
    act.stopwatchFusionMeta &&
      act.stopwatchFusionMeta.stopwatchActivityId &&
      act.stopwatchFusionMeta.stopwatchActivityId === act.id
  );
}

function deriveStopwatchFusionMetaFallback(
  stopwatchAct: UnifiedActivity
): StopwatchFusionMetadata | undefined {
  if (stopwatchAct.stopwatchFusionMeta) {
    return stopwatchAct.stopwatchFusionMeta;
  }
  const workIntervals = (stopwatchAct.intervals || []).filter(
    (iv) => iv.type === 'WORK' && Number.isFinite(iv.durationSecs) && iv.durationSecs > 0
  );
  if (workIntervals.length > 0) {
    const recInterval = (stopwatchAct.intervals || []).find(
      (iv) => iv.type === 'RECOVERY' && Number.isFinite(iv.durationSecs) && iv.durationSecs >= 0
    );
    return {
      stopwatchActivityId: stopwatchAct.id,
      lapSplitsSecs: workIntervals.map((iv) => Number(iv.durationSecs.toFixed(2))),
      repDistanceMeters: Math.max(100, workIntervals[0]?.distanceMeters || 400),
      restDurationSecs: recInterval ? Math.round(recInterval.durationSecs) : 60,
      fusedWithWearableStreams: false,
    };
  }
  if (
    stopwatchAct.officialRaceData &&
    Array.isArray(stopwatchAct.officialRaceData.lapSplitsSecs) &&
    stopwatchAct.officialRaceData.lapSplitsSecs.length > 0
  ) {
    return {
      stopwatchActivityId: stopwatchAct.id,
      lapSplitsSecs: stopwatchAct.officialRaceData.lapSplitsSecs,
      repDistanceMeters: stopwatchAct.officialRaceData.lapSplitDistanceMeters || 400,
      restDurationSecs: 0,
      fusedWithWearableStreams: false,
    };
  }
  return undefined;
}

/**
 * Fuses `0.01s` `#stopwatch` lap timings & lane metadata onto a wearable's `1Hz` stream set,
 * recovering warm-up offset lag, Huber-snapping oval GPS, and annotating each rep with watch biometrics.
 */
export function applyStopwatchStreamFusionToActivity(
  activity: UnifiedActivity,
  wearableStreams: ActivityStreamSet,
  fallbackMeta?: StopwatchFusionMetadata
): UnifiedActivity {
  const meta = activity.stopwatchFusionMeta || fallbackMeta;
  if (
    !meta ||
    !Array.isArray(meta.lapSplitsSecs) ||
    meta.lapSplitsSecs.length === 0 ||
    !wearableStreams ||
    !Array.isArray(wearableStreams.time) ||
    wearableStreams.time.length < 10
  ) {
    return {
      ...activity,
      streams: wearableStreams,
    };
  }

  const fusion = fuseWearableStreamWithStopwatchSplits({
    wearableStreams,
    lapSplitsSecs: meta.lapSplitsSecs,
    repDistanceMeters: meta.repDistanceMeters,
    restDurationSecs: meta.restDurationSecs,
    lane: meta.lane ?? 1,
    wearableActivity: activity,
    thresholdPaceSecsPerKm: meta.thresholdPaceSecsPerKm,
    multiSetSpec: meta.multiSetSpec ?? null,
  });

  const snappedRoute =
    fusion.ovalSnapSummary && fusion.ovalSnapSummary.snappedLatLng.length > 2
      ? fusion.ovalSnapSummary.snappedLatLng
      : fusion.fusedStreams.latlng && fusion.fusedStreams.latlng.length > 2
        ? fusion.fusedStreams.latlng
        : activity.routeLatLngs;

  return {
    ...activity,
    streams: fusion.fusedStreams,
    routeLatLngs: snappedRoute,
    intervals: fusion.intervals.length > 0 ? fusion.intervals : activity.intervals,
    stopwatchFusionMeta: {
      ...meta,
      fusedWithWearableStreams: true,
      optimalLagSecs: fusion.optimalLagSecs,
    },
  };
}

function isStopwatchWearableSameSessionMatch(
  a: UnifiedActivity,
  b: UnifiedActivity
): boolean {
  if (
    a.matchedStopwatchId === b.id ||
    b.matchedStopwatchId === a.id ||
    a.stopwatchFusionMeta?.stopwatchActivityId === b.id ||
    b.stopwatchFusionMeta?.stopwatchActivityId === a.id
  ) {
    return true;
  }

  const aIsSw = isSyntheticStopwatchActivity(a);
  const bIsSw = isSyntheticStopwatchActivity(b);
  if (aIsSw === bIsSw) return false;
  if (a.sportCategory !== 'Running' || b.sportCategory !== 'Running') return false;
  const stopwatchAct = aIsSw ? a : b;
  const wearableAct = aIsSw ? b : a;
  if (
    typeof stopwatchAct.startDateUtcMs === 'number' &&
    stopwatchAct.startDateUtcMs > 0 &&
    typeof wearableAct.startDateUtcMs === 'number' &&
    wearableAct.startDateUtcMs > 0
  ) {
    const deltaSecs = (stopwatchAct.startDateUtcMs - wearableAct.startDateUtcMs) / 1000;
    return deltaSecs >= -2700 && deltaSecs <= 7200;
  }

  if (!a.startDateLocal || !b.startDateLocal) return false;

  // Must share the same local calendar date so overnight activities never collide when UTC ms is unavailable
  if (String(a.startDateLocal).slice(0, 10) !== String(b.startDateLocal).slice(0, 10)) {
    return false;
  }

  const swMs = new Date(stopwatchAct.startDateLocal).getTime();
  const watchMs = new Date(wearableAct.startDateLocal).getTime();
  if (Number.isNaN(swMs) || Number.isNaN(watchMs)) return false;

  // Athletes commonly start their watch 10-60 min before Rep 1 for warm-up + drills;
  // allow watch starts up to 120 min earlier or 45 min later while keeping AM/PM 2-a-days separate.
  const deltaSecs = (swMs - watchMs) / 1000;
  return deltaSecs >= -2700 && deltaSecs <= 7200;
}

function stripEstimatedHrFromUnfusedStopwatchIntervals(
  intervals: ActivityInterval[] | undefined
): ActivityInterval[] | undefined {
  if (!Array.isArray(intervals) || intervals.length === 0) return intervals;
  return intervals.map((iv) => {
    const rest: ActivityInterval = { ...iv };
    delete rest.avgHr;
    delete rest.maxHr;
    delete rest.avgCadence;
    return rest;
  });
}

function mergeStopwatchAndWearableActivity(
  wearableAct: UnifiedActivity,
  stopwatchAct: UnifiedActivity
): UnifiedActivity {
  const mergedBadges = Array.from(
    new Set([...(wearableAct.sourceBadges || []), ...(stopwatchAct.sourceBadges || [])])
  ) as ActivitySourceBadge[];

  const baseDevice = (wearableAct.deviceName || '').trim();
  const deviceName = baseDevice
    ? baseDevice.includes('THRESH Stopwatch')
      ? baseDevice
      : `${baseDevice} + THRESH Stopwatch`
    : 'Watch + THRESH Stopwatch';

  const watchName = (wearableAct.name || '').trim();
  const resolvedName =
    !watchName || GENERIC_WATCH_RUN_NAME_RE.test(watchName)
      ? stopwatchAct.name
      : wearableAct.name;

  const fusionMeta = deriveStopwatchFusionMetaFallback(stopwatchAct);
  const alreadyFused = Boolean(
    (wearableAct.matchedStopwatchId === stopwatchAct.id ||
      wearableAct.stopwatchFusionMeta?.stopwatchActivityId === stopwatchAct.id) &&
      wearableAct.stopwatchFusionMeta?.fusedWithWearableStreams &&
      Array.isArray(wearableAct.intervals) &&
      wearableAct.intervals.length > 0
  );

  const hasSpikedWork =
    stopwatchAct.footwearClass === 'CARBON_SUPER_SPIKE' ||
    stopwatchAct.footwearClass === 'TRADITIONAL_TRACK_SPIKE';

  const baseMerged: UnifiedActivity = {
    ...stopwatchAct,
    ...wearableAct,
    id: wearableAct.id,
    name: resolvedName,
    subType: stopwatchAct.subType || wearableAct.subType || 'Track',
    environment: wearableAct.environment || stopwatchAct.environment,
    deviceName,
    footwearClass: stopwatchAct.footwearClass ?? wearableAct.footwearClass,
    spikedDistanceMeters:
      typeof stopwatchAct.spikedDistanceMeters === 'number' &&
      (hasSpikedWork || stopwatchAct.spikedDistanceMeters > 0)
        ? stopwatchAct.spikedDistanceMeters
        : wearableAct.spikedDistanceMeters,
    trackFacility: stopwatchAct.trackFacility ?? wearableAct.trackFacility,
    stimulusCompletionRatio:
      stopwatchAct.stimulusCompletionRatio ?? wearableAct.stimulusCompletionRatio,
    autoRegPivotSummary:
      stopwatchAct.autoRegPivotSummary ?? wearableAct.autoRegPivotSummary,
    officialRaceData: stopwatchAct.officialRaceData ?? wearableAct.officialRaceData,
    matchedStopwatchId: stopwatchAct.id,
    sourceBadges: mergedBadges,
  };

  if (alreadyFused) {
    return {
      ...baseMerged,
      streams: wearableAct.streams,
      routeLatLngs: wearableAct.routeLatLngs,
      intervals: wearableAct.intervals,
      stopwatchFusionMeta: wearableAct.stopwatchFusionMeta,
    };
  }

  if (
    fusionMeta &&
    wearableAct.streams &&
    Array.isArray(wearableAct.streams.time) &&
    wearableAct.streams.time.length >= 10
  ) {
    return applyStopwatchStreamFusionToActivity(
      { ...baseMerged, stopwatchFusionMeta: fusionMeta },
      wearableAct.streams,
      fusionMeta
    );
  }

  return {
    ...baseMerged,
    // Keep only real hardware streams on the wearable record so lazy stream hydration still fetches them
    streams: wearableAct.streams,
    stopwatchFusionMeta: fusionMeta ?? wearableAct.stopwatchFusionMeta,
    intervals:
      stopwatchAct.intervals && stopwatchAct.intervals.length > 0
        ? wearableAct.avgHr > 0
          ? stripEstimatedHrFromUnfusedStopwatchIntervals(stopwatchAct.intervals)
          : stopwatchAct.intervals
        : wearableAct.intervals,
  };
}

/**
 * Merges incoming synced activities with existing persisted activities without losing
 * previously hydrated streams, GPS route polylines, Strava segment efforts, kudos, comments,
 * or Indoor / Virtual Cycling / Smart Trainer classification.
 *
 * Automatically deduplicates multi-source activities (Strava, Garmin, Wahoo, Intervals.icu)
 * recorded within ±5 minutes (300 seconds) and fuses coach `#stopwatch` `0.01s` splits with
 * athlete wearable runs across warm-up offsets so Training Load (TSS) is never double-counted.
 */
export function mergeActivitiesNonDestructive(
  existing: UnifiedActivity[],
  incoming: UnifiedActivity[]
): UnifiedActivity[] {
  if (!Array.isArray(existing) || existing.length === 0) {
    return (incoming || []).map(reclassifyActivityEnvironment);
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return existing.map(reclassifyActivityEnvironment);
  }

  const byId = new Map<string, UnifiedActivity>();
  const stravaIdToPrimaryId = new Map<string, string>();
  const intervalsIdToPrimaryId = new Map<string, string>();
  const wahooIdToPrimaryId = new Map<string, string>();
  const polarIdToPrimaryId = new Map<string, string>();
  const matchedStopwatchIdToPrimaryId = new Map<string, string>();

  const indexPrimaryAct = (act: UnifiedActivity, primaryId: string) => {
    if (act.stravaId) stravaIdToPrimaryId.set(String(act.stravaId), primaryId);
    const actIntId = act.intervalsId || (act as { intervalsActivityId?: string }).intervalsActivityId;
    if (actIntId) intervalsIdToPrimaryId.set(String(actIntId), primaryId);
    if (act.wahooId) wahooIdToPrimaryId.set(String(act.wahooId), primaryId);
    if (act.polarId) polarIdToPrimaryId.set(String(act.polarId), primaryId);
    const swId = act.matchedStopwatchId || act.stopwatchFusionMeta?.stopwatchActivityId;
    if (swId && swId !== primaryId) {
      matchedStopwatchIdToPrimaryId.set(swId, primaryId);
    }
  };

  for (const rawAct of existing) {
    if (!rawAct || !rawAct.id) continue;
    const act = reclassifyActivityEnvironment(rawAct);
    byId.set(act.id, act);
    indexPrimaryAct(act, act.id);
  }

  for (const rawInc of incoming) {
    if (!rawInc || !rawInc.id) continue;
    const inc = reclassifyActivityEnvironment(rawInc);

    let proximityMatchKey: string | undefined;
    const incIntervalsId =
      inc.intervalsId || (inc as { intervalsActivityId?: string }).intervalsActivityId;
    for (const existingAct of byId.values()) {
      // Never proximity-merge two distinct records from the same remote provider (e.g., warmup + main lift/race)
      const exIntervalsId =
        existingAct.intervalsId || (existingAct as { intervalsActivityId?: string }).intervalsActivityId;
      if (
        (existingAct.stravaId && inc.stravaId && String(existingAct.stravaId) !== String(inc.stravaId)) ||
        (exIntervalsId && incIntervalsId && String(exIntervalsId) !== String(incIntervalsId)) ||
        (existingAct.wahooId && inc.wahooId && String(existingAct.wahooId) !== String(inc.wahooId)) ||
        (existingAct.polarId && inc.polarId && String(existingAct.polarId) !== String(inc.polarId))
      ) {
        continue;
      }
      if (isStopwatchWearableSameSessionMatch(existingAct, inc)) {
        proximityMatchKey = existingAct.id;
        break;
      }
      const sameSport = existingAct.sportCategory === inc.sportCategory;
      const sameDurationClose =
        Math.abs((existingAct.movingTimeSecs || 0) - (inc.movingTimeSecs || 0)) <= 180;
      const hasMiscSportOverlap =
        existingAct.sportCategory === 'Strength' ||
        inc.sportCategory === 'Strength' ||
        existingAct.sportCategory === 'Multisport' ||
        inc.sportCategory === 'Multisport';
      if (
        (sameSport && areActivityTimestampsClose(existingAct, inc, 300)) ||
        (hasMiscSportOverlap && sameDurationClose && areActivityTimestampsClose(existingAct, inc, 120))
      ) {
        proximityMatchKey = existingAct.id;
        break;
      }
    }

    const incIntervalId = inc.intervalsId || (inc as { intervalsActivityId?: string }).intervalsActivityId;
    const incLinkedSwId =
      inc.matchedStopwatchId ||
      (inc.stopwatchFusionMeta?.stopwatchActivityId &&
      inc.stopwatchFusionMeta.stopwatchActivityId !== inc.id
        ? inc.stopwatchFusionMeta.stopwatchActivityId
        : undefined);
    const matchedKey =
      (byId.has(inc.id) ? inc.id : undefined) ||
      (incIntervalId ? intervalsIdToPrimaryId.get(String(incIntervalId)) : undefined) ||
      (inc.stravaId ? stravaIdToPrimaryId.get(String(inc.stravaId)) : undefined) ||
      (inc.wahooId ? wahooIdToPrimaryId.get(String(inc.wahooId)) : undefined) ||
      (inc.polarId ? polarIdToPrimaryId.get(String(inc.polarId)) : undefined) ||
      matchedStopwatchIdToPrimaryId.get(inc.id) ||
      (incLinkedSwId && byId.has(incLinkedSwId) ? incLinkedSwId : undefined) ||
      (incLinkedSwId ? matchedStopwatchIdToPrimaryId.get(incLinkedSwId) : undefined) ||
      proximityMatchKey;

    if (!matchedKey) {
      byId.set(inc.id, inc);
      indexPrimaryAct(inc, inc.id);
      continue;
    }

    const prev = byId.get(matchedKey)!;
    const prevIsStopwatch = isSyntheticStopwatchActivity(prev);
    const incIsStopwatch = isSyntheticStopwatchActivity(inc);

    if (prevIsStopwatch !== incIsStopwatch) {
      const wearableAct = prevIsStopwatch ? inc : prev;
      const stopwatchAct = prevIsStopwatch ? prev : inc;
      const merged = reclassifyActivityEnvironment(
        mergeStopwatchAndWearableActivity(wearableAct, stopwatchAct)
      );
      if (merged.id !== matchedKey) {
        byId.delete(matchedKey);
      }
      byId.set(merged.id, merged);
      indexPrimaryAct(merged, merged.id);
      continue;
    }

    // Prefer whichever record has an Intervals.icu ID or Strava ID as primary ID
    const prevIntId = prev.intervalsId || (prev as { intervalsActivityId?: string }).intervalsActivityId;
    const canonicalId = prevIntId ? prev.id : incIntervalId ? inc.id : prev.id;

    const mergedBadges = Array.from(
      new Set([...(prev.sourceBadges || []), ...(inc.sourceBadges || [])])
    ) as ActivitySourceBadge[];

    // If either source classified the session as INDOOR (VirtualRide / Smart Trainer / Treadmill), promote INDOOR!
    const resolvedEnv =
      prev.environment === 'INDOOR' || inc.environment === 'INDOOR' ? 'INDOOR' : inc.environment;
    const resolvedSubType: UnifiedActivity['subType'] =
      prev.subType === 'Virtual Cycling' || inc.subType === 'Virtual Cycling'
        ? 'Virtual Cycling'
        : prev.subType === 'Smart Trainer' || inc.subType === 'Smart Trainer'
          ? 'Smart Trainer'
          : prev.subType === 'Treadmill' || inc.subType === 'Treadmill'
            ? 'Treadmill'
            : prev.subType === 'Track' || inc.subType === 'Track'
              ? 'Track'
              : inc.subType || prev.subType;

    const prevHasIntervals =
      Boolean(prevIntId) || Boolean(prev.sourceBadges?.includes('Intervals.icu'));
    const incHasIntervals =
      Boolean(incIntervalId) || Boolean(inc.sourceBadges?.includes('Intervals.icu'));
    const prevIsGarminPollutedLegacy =
      Boolean(prev.sourceBadges?.includes('Garmin')) &&
      (prev.loadModelVersion || 0) < CURRENT_PMC_MODEL_VERSION;
    const keepPrevIntervalsLoad =
      prevHasIntervals && !incHasIntervals && !prevIsGarminPollutedLegacy;
    const isIncomingV3 = inc.loadModelVersion === CURRENT_PMC_MODEL_VERSION;
    const clearStalePower =
      inc.deviceWatts === false && !prevHasIntervals && !incHasIntervals;

    const preservePrevStopwatchSplits = Boolean(
      (prev.matchedStopwatchId || prev.stopwatchFusionMeta) && !inc.stopwatchFusionMeta
    );
    const resolvedStreams =
      inc.streams && Array.isArray(inc.streams.time) && inc.streams.time.length > 0
        ? inc.streams
        : prev.streams;
    const resolvedFusionMeta =
      inc.stopwatchFusionMeta?.fusedWithWearableStreams
        ? inc.stopwatchFusionMeta
        : prev.stopwatchFusionMeta?.fusedWithWearableStreams
          ? prev.stopwatchFusionMeta
          : inc.stopwatchFusionMeta || prev.stopwatchFusionMeta;

    const prevLocalClean =
      prev.startDateLocal && !/Z$/i.test(prev.startDateLocal) ? prev.startDateLocal : '';
    const incLocalClean =
      inc.startDateLocal && !/Z$/i.test(inc.startDateLocal) ? inc.startDateLocal : '';
    const resolvedStartDateLocal = stripTimezoneSuffix(
      incLocalClean || prevLocalClean || inc.startDateLocal || prev.startDateLocal
    );

    const mergedRaw: UnifiedActivity = {
      ...prev,
      ...inc,
      id: canonicalId,
      startDateLocal: resolvedStartDateLocal,
      ...(inc.startDateUtcMs !== undefined || prev.startDateUtcMs !== undefined
        ? { startDateUtcMs: inc.startDateUtcMs ?? prev.startDateUtcMs }
        : {}),
      intervalsId: incIntervalId || prevIntId,
      stravaId: inc.stravaId || prev.stravaId,
      wahooId: inc.wahooId || prev.wahooId,
      polarId: inc.polarId || prev.polarId,
      matchedStopwatchId: inc.matchedStopwatchId || prev.matchedStopwatchId,
      stopwatchFusionMeta: resolvedFusionMeta,
      environment: resolvedEnv,
      subType: resolvedSubType,
      gearName: inc.gearName || prev.gearName,
      deviceName:
        prev.deviceName?.includes('THRESH Stopwatch') && !inc.deviceName?.includes('THRESH Stopwatch')
          ? prev.deviceName
          : inc.deviceName || prev.deviceName,
      deviceWatts: inc.deviceWatts ?? prev.deviceWatts,
      rawSportType: inc.rawSportType || prev.rawSportType,
      loadModelVersion: inc.loadModelVersion ?? prev.loadModelVersion,
      avgPower: clearStalePower ? undefined : inc.avgPower ?? prev.avgPower,
      normalizedPower: clearStalePower ? undefined : inc.normalizedPower ?? prev.normalizedPower,
      intensityFactor: keepPrevIntervalsLoad
        ? prev.intensityFactor ?? inc.intensityFactor
        : isIncomingV3
          ? inc.intensityFactor
          : inc.intensityFactor ?? prev.intensityFactor,
      trainingLoad: keepPrevIntervalsLoad
        ? prev.trainingLoad && prev.trainingLoad > 0
          ? prev.trainingLoad
          : inc.trainingLoad || prev.trainingLoad
        : isIncomingV3 && typeof inc.trainingLoad === 'number'
          ? inc.trainingLoad
          : inc.trainingLoad || prev.trainingLoad,
      avgHr: inc.avgHr || prev.avgHr,
      maxHr: inc.maxHr || prev.maxHr,
      efficiencyFactor: inc.efficiencyFactor || prev.efficiencyFactor,
      aerobicDecouplingPct: inc.aerobicDecouplingPct || prev.aerobicDecouplingPct,
      firstHalfEf: inc.firstHalfEf || prev.firstHalfEf,
      secondHalfEf: inc.secondHalfEf || prev.secondHalfEf,
      zoneSecs:
        inc.zoneSecs?.hr?.some((s) => s > 0) || !prev.zoneSecs?.hr?.some((s) => s > 0)
          ? inc.zoneSecs
          : prev.zoneSecs,
      footwearClass:
        preservePrevStopwatchSplits
          ? prev.footwearClass ?? inc.footwearClass
          : inc.footwearClass ?? prev.footwearClass,
      spikedDistanceMeters:
        preservePrevStopwatchSplits
          ? prev.spikedDistanceMeters ?? inc.spikedDistanceMeters
          : inc.spikedDistanceMeters ?? prev.spikedDistanceMeters,
      trackFacility:
        preservePrevStopwatchSplits
          ? prev.trackFacility ?? inc.trackFacility
          : inc.trackFacility ?? prev.trackFacility,
      stravaPrCount: Math.max(prev.stravaPrCount || 0, inc.stravaPrCount || 0),
      kudosCount: Math.max(prev.kudosCount || 0, inc.kudosCount || 0),
      commentCount: Math.max(prev.commentCount || 0, inc.commentCount || 0),
      achievementCount: Math.max(prev.achievementCount || 0, inc.achievementCount || 0),
      hasKudoed: inc.hasKudoed ?? prev.hasKudoed,
      kudoers:
        Array.isArray(inc.kudoers) && inc.kudoers.length > 0 ? inc.kudoers : prev.kudoers,
      comments:
        Array.isArray(inc.comments) && inc.comments.length > 0 ? inc.comments : prev.comments,
      summaryPolyline: inc.summaryPolyline || prev.summaryPolyline,
      routeLatLngs:
        Array.isArray(inc.routeLatLngs) && inc.routeLatLngs.length > 2
          ? inc.routeLatLngs
          : prev.routeLatLngs,
      startLatLng: inc.startLatLng || prev.startLatLng,
      endLatLng: inc.endLatLng || prev.endLatLng,
      streams: resolvedStreams,
      intervals: preservePrevStopwatchSplits
        ? prev.intervals
        : Array.isArray(inc.intervals) && inc.intervals.length > 0
          ? inc.intervals
          : prev.intervals,
      segmentEfforts:
        Array.isArray(inc.segmentEfforts) && inc.segmentEfforts.length > 0
          ? inc.segmentEfforts
          : prev.segmentEfforts,
      sourceBadges: mergedBadges,
    };

    const hydratedMerged =
      resolvedFusionMeta &&
      !resolvedFusionMeta.fusedWithWearableStreams &&
      resolvedStreams &&
      Array.isArray(resolvedStreams.time) &&
      resolvedStreams.time.length >= 10
        ? applyStopwatchStreamFusionToActivity(mergedRaw, resolvedStreams, resolvedFusionMeta)
        : mergedRaw;

    const merged = reclassifyActivityEnvironment(hydratedMerged);

    if (canonicalId !== matchedKey) {
      byId.delete(matchedKey);
    }
    byId.set(canonicalId, merged);
    indexPrimaryAct(merged, canonicalId);
  }

  return Array.from(byId.values()).sort(
    (a, b) => resolveActivityStartEpochMs(b) - resolveActivityStartEpochMs(a)
  );
}

/**
 * Deduplicates an existing archive (e.g. Strava + Garmin + Wahoo overlapping uploads).
 */
export function deduplicateActivitiesArchive(
  activities: UnifiedActivity[]
): UnifiedActivity[] {
  if (!Array.isArray(activities) || activities.length <= 1) {
    return Array.isArray(activities) ? activities.map(reclassifyActivityEnvironment) : [];
  }
  return mergeActivitiesNonDestructive([activities[0]], activities.slice(1));
}

export function mergeWellnessDaysNonDestructive(
  existing: UnifiedWellnessDay[],
  incoming: UnifiedWellnessDay[]
): UnifiedWellnessDay[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;

  const byDate = new Map<string, UnifiedWellnessDay>();
  for (const w of existing) {
    if (w && w.date) byDate.set(w.date, w);
  }
  for (const w of incoming) {
    if (w && w.date) byDate.set(w.date, w);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Uses activity-derived Banister CTL/ATL/TSB/dailyLoad as the authoritative spine
 * while preserving non-zero hardware biometrics (HRV, RHR, sleep, weight, VO2)
 * from any existing or Garmin wellness history without ever overwriting PMC load.
 */
export function overlayBiometricsOntoActivityWellness(
  activityDerived: UnifiedWellnessDay[],
  biometricSource: UnifiedWellnessDay[],
  asOfDateIso: string = getLocalDateIso()
): UnifiedWellnessDay[] {
  if (!Array.isArray(activityDerived) || activityDerived.length === 0) {
    return Array.isArray(biometricSource)
      ? biometricSource.filter((w) => w && w.date && w.date.slice(0, 10) <= asOfDateIso)
      : [];
  }
  if (!Array.isArray(biometricSource) || biometricSource.length === 0) {
    return activityDerived;
  }

  const bioByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of biometricSource) {
    if (!w || !w.date) continue;
    const d = w.date.slice(0, 10);
    if (d <= asOfDateIso) {
      bioByDate.set(d, w);
    }
  }

  const firstActDate = activityDerived[0].date.slice(0, 10);
  const priorBiometricDays: UnifiedWellnessDay[] = [];
  for (const [d, w] of bioByDate.entries()) {
    if (d < firstActDate) {
      priorBiometricDays.push(w);
    }
  }

  const overlaid = activityDerived.map((actDay) => {
    const bio = bioByDate.get(actDay.date.slice(0, 10));
    if (!bio) return actDay;
    return {
      ...actDay,
      hrvRMSSD: bio.hrvRMSSD > 0 ? bio.hrvRMSSD : actDay.hrvRMSSD,
      hrvBaseline7d: bio.hrvBaseline7d > 0 ? bio.hrvBaseline7d : actDay.hrvBaseline7d,
      hrvNormalBandLow:
        bio.hrvNormalBandLow && bio.hrvNormalBandLow > 0
          ? bio.hrvNormalBandLow
          : actDay.hrvNormalBandLow,
      hrvNormalBandHigh:
        bio.hrvNormalBandHigh && bio.hrvNormalBandHigh > 0
          ? bio.hrvNormalBandHigh
          : actDay.hrvNormalBandHigh,
      hrvStatus: bio.hrvStatus || actDay.hrvStatus,
      restingHR: bio.restingHR > 0 ? bio.restingHR : actDay.restingHR,
      sleepSecs: bio.sleepSecs > 0 ? bio.sleepSecs : actDay.sleepSecs,
      sleepScore: bio.sleepScore > 0 ? bio.sleepScore : actDay.sleepScore,
      sleepQuality: bio.sleepQuality ?? actDay.sleepQuality,
      sleepDebt7dSecs: bio.sleepDebt7dSecs ?? actDay.sleepDebt7dSecs,
      weightKg:
        bio.weightKg > 30 && bio.weightKg !== 70 ? bio.weightKg : actDay.weightKg,
      vo2MaxCycling: bio.vo2MaxCycling || actDay.vo2MaxCycling,
      vo2MaxRunning: bio.vo2MaxRunning || actDay.vo2MaxRunning,
      spO2: bio.spO2 ?? actDay.spO2,
      respiration: bio.respiration ?? actDay.respiration,
      steps: bio.steps ?? actDay.steps,
      floorsClimbed: bio.floorsClimbed ?? actDay.floorsClimbed,
      soreness: bio.soreness ?? actDay.soreness,
      rideEftp: bio.rideEftp || actDay.rideEftp,
      rideWPrime: bio.rideWPrime || actDay.rideWPrime,
      ridePMax: bio.ridePMax || actDay.ridePMax,
      runEftp: bio.runEftp || actDay.runEftp,
      runWPrime: bio.runWPrime || actDay.runWPrime,
      runPMax: bio.runPMax || actDay.runPMax,
    };
  });

  return [...priorBiometricDays, ...overlaid].sort((a, b) => a.date.localeCompare(b.date));
}

function buildBanisterWellnessDayRow(params: {
  dateStr: string;
  dailyLoad: number;
  ctl: number;
  atl: number;
  ctl7DaysAgo: number;
  reason: string;
}): UnifiedWellnessDay {
  const { dateStr, dailyLoad, ctl, atl, ctl7DaysAgo, reason } = params;
  const tsb = ctl - atl;
  const rampRate = Number((ctl - ctl7DaysAgo).toFixed(1));
  const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;

  let garminTrainingStatus: UnifiedWellnessDay['garminTrainingStatus'] = 'Maintaining';
  if ((rampRate > 6 && atl >= 28) || tsb < -25) garminTrainingStatus = 'Overreaching';
  else if (rampRate >= 1.5 && tsb >= -22) garminTrainingStatus = 'Productive';
  else if (tsb > 10 && ctl > 35) garminTrainingStatus = 'Peaking';
  else if (rampRate < -2) garminTrainingStatus = 'Recovery';

  const readinessScore = Math.max(
    25,
    Math.min(96, Math.round(75 + Math.max(-25, Math.min(15, tsb)) * 0.7))
  );

  return {
    date: dateStr,
    ctl: Number(ctl.toFixed(1)),
    atl: Number(atl.toFixed(1)),
    tsb: Number(tsb.toFixed(1)),
    loadRatio,
    rampRate,
    hrvRMSSD: 0,
    hrvBaseline7d: 0,
    hrvNormalBandLow: 0,
    hrvNormalBandHigh: 0,
    restingHR: 0,
    sleepSecs: 0,
    sleepScore: 0,
    weightKg: 70,
    readinessStatus:
      readinessScore >= 80 ? 'Optimal' : readinessScore >= 60 ? 'Caution' : 'Strain',
    garminTrainingStatus,
    trainingStatusReason: reason,
    dailyLoad,
  };
}

function buildLoadByDateMap(activities: UnifiedActivity[]): Map<string, number> {
  const loadByDate = new Map<string, number>();
  for (const act of activities) {
    if (!act || !act.startDateLocal) continue;
    const d = act.startDateLocal.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      loadByDate.set(
        d,
        (loadByDate.get(d) || 0) + Math.max(0, Number(act.trainingLoad || 0))
      );
    }
  }
  return loadByDate;
}

/**
 * Repairs any cold-start Banister CTL cliff discontinuity (e.g. Garmin 28-day window reset
 * dropping CTL 68 -> ~3 on day 1 of the window) and rolls wellness days through today
 * using recalibrated v3 activity loads while preserving all hardware biometrics & eFTP.
 */
export function repairAndRecomputeWellnessDays(
  existingWellness: UnifiedWellnessDay[],
  activities: UnifiedActivity[],
  asOfDateIso: string = getLocalDateIso(),
  options?: { forceFullRecomputeIfNoCliff?: boolean; profile?: Partial<AthleteProfile> | null }
): UnifiedWellnessDay[] {
  const todayIso = (asOfDateIso || getLocalDateIso()).slice(0, 10);
  const calibratedActivities = activities.map((act) =>
    recalibrateStravaActivityLoadClient(act, options?.profile)
  );
  const filteredExisting = Array.isArray(existingWellness)
    ? [...existingWellness]
        .filter((w) => w && w.date && w.date.slice(0, 10) <= todayIso)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  if (filteredExisting.length === 0) {
    return computeWellnessDaysFromActivities(calibratedActivities, todayIso);
  }

  let cliffIdx = -1;
  for (let i = 1; i < filteredExisting.length; i++) {
    const prev = filteredExisting[i - 1];
    const curr = filteredExisting[i];
    if (prev.ctl >= 15 && curr.ctl < prev.ctl * 0.65) {
      cliffIdx = i;
      break;
    }
  }

  if (cliffIdx > 0) {
    const loadByDate = buildLoadByDateMap(calibratedActivities);

    const prefix = filteredExisting.slice(0, cliffIdx);
    const anchor = prefix[prefix.length - 1];
    const anchorDate = anchor.date.slice(0, 10);
    let ctl = anchor.ctl;
    let atl = anchor.atl;
    const repaired: UnifiedWellnessDay[] = [...prefix];

    for (
      let dateStr = shiftIsoDate(anchorDate, 1);
      dateStr <= todayIso;
      dateStr = shiftIsoDate(dateStr, 1)
    ) {
      const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
      ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl7DaysAgo =
        repaired.length >= 7 ? repaired[repaired.length - 7].ctl : anchor.ctl;
      repaired.push(
        buildBanisterWellnessDayRow({
          dateStr,
          dailyLoad,
          ctl,
          atl,
          ctl7DaysAgo,
          reason: 'Continuously propagated Banister load from verified prior baseline.',
        })
      );
    }

    return overlayBiometricsOntoActivityWellness(repaired, filteredExisting, todayIso);
  }

  const firstExisting = filteredExisting[0];
  const lastExisting = filteredExisting[filteredExisting.length - 1];
  const firstExistingDate = firstExisting.date.slice(0, 10);
  const lastExistingDate = lastExisting.date.slice(0, 10);

  const hasEarlierActivityHistory =
    firstExisting.ctl < 10 &&
    calibratedActivities.some(
      (a) => a.startDateLocal && a.startDateLocal.slice(0, 10) < firstExistingDate
    );

  if (options?.forceFullRecomputeIfNoCliff || hasEarlierActivityHistory) {
    const computed = computeWellnessDaysFromActivities(calibratedActivities, todayIso);
    return computed.length > 0
      ? overlayBiometricsOntoActivityWellness(computed, filteredExisting, todayIso)
      : filteredExisting;
  }

  if (lastExistingDate < todayIso) {
    const loadByDate = buildLoadByDateMap(calibratedActivities);
    const rolled: UnifiedWellnessDay[] = [...filteredExisting];
    let ctl = lastExisting.ctl;
    let atl = lastExisting.atl;
    for (
      let dateStr = shiftIsoDate(lastExistingDate, 1);
      dateStr <= todayIso;
      dateStr = shiftIsoDate(dateStr, 1)
    ) {
      const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
      ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl7DaysAgo =
        rolled.length >= 7 ? rolled[rolled.length - 7].ctl : lastExisting.ctl;
      rolled.push(
        buildBanisterWellnessDayRow({
          dateStr,
          dailyLoad,
          ctl,
          atl,
          ctl7DaysAgo,
          reason: 'Rolled forward Banister load through today.',
        })
      );
    }
    return overlayBiometricsOntoActivityWellness(rolled, filteredExisting, todayIso);
  }

  return filteredExisting;
}

export function computeWellnessDaysFromActivities(
  activities: UnifiedActivity[],
  asOfDateIso?: string
): UnifiedWellnessDay[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const todayIso = (asOfDateIso || getLocalDateIso()).slice(0, 10);
  const lookbackDefaultIso = shiftIsoDate(todayIso, -180);
  const lookbackHardCapIso = shiftIsoDate(todayIso, -365);

  const loadByDate = new Map<string, number>();
  let earliestActIso = lookbackDefaultIso;
  for (const act of activities) {
    if (!act || !act.startDateLocal) continue;
    const d = act.startDateLocal.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d < earliestActIso) {
      earliestActIso = d;
    }
    loadByDate.set(d, (loadByDate.get(d) || 0) + Math.max(0, Number(act.trainingLoad || 0)));
  }

  // Cap lookback to 365 days so PMC warmup is fast and accurate without DST drift
  const startIso = earliestActIso < lookbackHardCapIso ? lookbackHardCapIso : earliestActIso;
  const days: UnifiedWellnessDay[] = [];
  let ctl = 0;
  let atl = 0;

  for (let dateStr = startIso; dateStr <= todayIso; dateStr = shiftIsoDate(dateStr, 1)) {
    const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
    ctl = ctl * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
    atl = atl * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
    const tsb = ctl - atl;
    const ctl7DaysAgo = days.length >= 7 ? days[days.length - 7].ctl : 0;
    const rampRate = Number((ctl - ctl7DaysAgo).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;

    let garminTrainingStatus: UnifiedWellnessDay['garminTrainingStatus'] = 'Maintaining';
    if ((rampRate > 6 && atl >= 28) || tsb < -25) garminTrainingStatus = 'Overreaching';
    else if (rampRate >= 1.5 && tsb >= -22) garminTrainingStatus = 'Productive';
    else if (tsb > 10 && ctl > 35) garminTrainingStatus = 'Peaking';
    else if (rampRate < -2) garminTrainingStatus = 'Recovery';

    const readinessScore = Math.max(
      25,
      Math.min(96, Math.round(75 + Math.max(-25, Math.min(15, tsb)) * 0.7))
    );

    days.push({
      date: dateStr,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number(tsb.toFixed(1)),
      loadRatio,
      rampRate,
      hrvRMSSD: 0,
      hrvBaseline7d: 0,
      hrvNormalBandLow: 0,
      hrvNormalBandHigh: 0,
      restingHR: 0,
      sleepSecs: 0,
      sleepScore: 0,
      weightKg: 70,
      readinessStatus:
        readinessScore >= 80 ? 'Optimal' : readinessScore >= 60 ? 'Caution' : 'Strain',
      garminTrainingStatus,
      trainingStatusReason: 'Computed from Strava training load history.',
      dailyLoad,
    });
  }

  return days;
}

export interface RotatedStravaTokenPayload {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  athleteId?: string;
  athleteName?: string;
}

export interface StoredClientStravaSyncPolicy {
  window?: string;
  importProfileAndGear?: boolean;
  confirmedAt?: string;
  grantedScope?: string;
}

const STRAVA_SYNC_POLICY_STORAGE_KEY = 'aeropulse_strava_sync_policy';

export function saveStravaSyncPolicyToStorage(policy?: StoredClientStravaSyncPolicy | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!policy) {
      localStorage.removeItem(STRAVA_SYNC_POLICY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(STRAVA_SYNC_POLICY_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // ignore storage quota errors
  }
}

export function loadStravaSyncPolicyFromStorage(): StoredClientStravaSyncPolicy | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STRAVA_SYNC_POLICY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredClientStravaSyncPolicy;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function hasPendingTeamJoinInBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (/^\/join\/[^/?#]+/i.test(window.location.pathname)) {
      return true;
    }
    const params = new URLSearchParams(window.location.search);
    if ((params.get('join') || params.get('team') || '').trim()) {
      return true;
    }
    const saved = window.sessionStorage?.getItem('thresh_pending_team_join_v1');
    if (saved) {
      const parsed = JSON.parse(saved) as { codeOrSlug?: string };
      if (parsed?.codeOrSlug?.trim()) {
        return true;
      }
    }
  } catch {
    // ignore storage/URL parse errors
  }
  return false;
}

export function saveRotatedStravaTokensToStorage(tokens?: RotatedStravaTokenPayload | null) {
  if (!tokens) return;
  try {
    if (tokens.refreshToken) {
      localStorage.setItem('aeropulse_strava_refresh_token', tokens.refreshToken.trim());
    }
    if (tokens.accessToken) {
      localStorage.setItem('aeropulse_strava_access_token', tokens.accessToken.trim());
    }
    if (tokens.expiresAt && tokens.expiresAt > 0) {
      localStorage.setItem('aeropulse_strava_expires_at', String(tokens.expiresAt));
    }
    if (tokens.clientId) {
      localStorage.setItem('aeropulse_strava_client_id', tokens.clientId.trim());
    }
    if (tokens.athleteId) {
      localStorage.setItem('aeropulse_strava_athlete_id', String(tokens.athleteId).trim());
    }
    if (tokens.athleteName && !isGenericAthleteName(tokens.athleteName)) {
      localStorage.setItem('aeropulse_strava_athlete_name', tokens.athleteName.trim());
    }
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Strips whitespace and non-ASCII / control characters so HTTP fetch() headers never throw TypeError.
 */
export function sanitizeHttpHeaderValue(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let out = '';
  const trimmed = raw.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      out += trimmed[i];
    }
  }
  return out;
}

/**
 * Decodes an encoded Google/Strava polyline string (1e5 precision) into [lat, lng] pairs.
 */
export function decodeGooglePolylineClient(encoded?: string): [number, number][] | undefined {
  if (!encoded || typeof encoded !== 'string') return undefined;
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([Number((lat / 1e5).toFixed(5)), Number((lng / 1e5).toFixed(5))]);
  }
  return points.length >= 2 ? points : undefined;
}

export function getSavedIntervalsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const setClean = (key: string, val?: string | null) => {
    const clean = sanitizeHttpHeaderValue(val);
    if (clean) headers[key] = clean;
  };
  try {
    const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
    const sessionToken = localStorage.getItem('aeropulse_session_token') || '';
    if (sessionToken && notLoggedOut) {
      setClean('x-session-token', sessionToken);
    }
    const apiKey = localStorage.getItem('aeropulse_intervals_api_key') || '';
    const athleteId = localStorage.getItem('aeropulse_intervals_athlete_id') || '0';
    if (apiKey && notLoggedOut) {
      setClean('x-intervals-api-key', apiKey);
      headers['x-intervals-athlete-id'] = sanitizeHttpHeaderValue(athleteId) || '0';
    }
    const stravaClientId = localStorage.getItem('aeropulse_strava_client_id') || '';
    const stravaClientSecret = localStorage.getItem('aeropulse_strava_client_secret') || '';
    const stravaRefreshToken = localStorage.getItem('aeropulse_strava_refresh_token') || '';
    const stravaAccessToken = localStorage.getItem('aeropulse_strava_access_token') || '';
    const stravaExpiresAt = localStorage.getItem('aeropulse_strava_expires_at') || '';
    const mapTileApiKey = localStorage.getItem('aeropulse_map_tile_api_key') || '';
    const mapTileProvider = localStorage.getItem('aeropulse_map_tile_provider') || '';
    const geminiApiKey = localStorage.getItem('aeropulse_gemini_api_key') || '';
    if (stravaClientId && notLoggedOut) setClean('x-strava-client-id', stravaClientId);
    if (stravaClientSecret && notLoggedOut) setClean('x-strava-client-secret', stravaClientSecret);
    if (stravaRefreshToken && notLoggedOut) setClean('x-strava-refresh-token', stravaRefreshToken);
    if (stravaAccessToken && notLoggedOut) setClean('x-strava-access-token', stravaAccessToken);
    if (stravaExpiresAt && notLoggedOut) setClean('x-strava-expires-at', stravaExpiresAt);
    if (notLoggedOut) {
      const savedPolicy = loadStravaSyncPolicyFromStorage();
      if (savedPolicy?.window) {
        setClean('x-strava-sync-window', savedPolicy.window);
        headers['x-strava-import-gear'] = savedPolicy.importProfileAndGear === false ? '0' : '1';
      }
    }
    if (mapTileApiKey && notLoggedOut) setClean('x-map-tile-api-key', mapTileApiKey);
    if (mapTileProvider && notLoggedOut) setClean('x-map-tile-provider', mapTileProvider);
    if (geminiApiKey && notLoggedOut) setClean('x-gemini-api-key', geminiApiKey);
    const garminPersonalKey = localStorage.getItem('aeropulse_garmin_personal_api_key');
    const garminBearer = localStorage.getItem('aeropulse_garmin_bearer_token');
    const garminOauth1 = localStorage.getItem('aeropulse_garmin_oauth1_token');
    const garminSecret = localStorage.getItem('aeropulse_garmin_oauth1_secret');
    if (garminPersonalKey && notLoggedOut) setClean('x-garmin-personal-api-key', garminPersonalKey);
    if (garminBearer && notLoggedOut) setClean('x-garmin-bearer-token', garminBearer);
    if (garminOauth1 && notLoggedOut) setClean('x-garmin-oauth1-token', garminOauth1);
    if (garminSecret && notLoggedOut) setClean('x-garmin-oauth1-secret', garminSecret);
  } catch {
    // ignore
  }
  return headers;
}

export async function safeParseResponseJson(resp: Response): Promise<any> {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    const isHtml = /<!doctype html/i.test(text) || /<html/i.test(text);
    const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    return {
      error: `Server returned non-JSON (${resp.status} ${resp.statusText})${
        isHtml ? ' HTML error page' : ''
      }${snippet ? `: ${snippet}` : ''}`,
    };
  }
}

export function inferPrimarySportFromActivities(
  activities: UnifiedActivity[]
): 'Running' | 'Cycling' | undefined {
  if (!Array.isArray(activities) || activities.length === 0) return undefined;
  const recent = activities.slice(0, 28);
  const runCount = recent.filter((a) => a.sportCategory === 'Running').length;
  const bikeCount = recent.filter((a) => a.sportCategory === 'Cycling').length;
  if (runCount > bikeCount) return 'Running';
  if (bikeCount > runCount) return 'Cycling';
  const allRuns = activities.filter((a) => a.sportCategory === 'Running').length;
  const allBikes = activities.filter((a) => a.sportCategory === 'Cycling').length;
  if (allRuns > allBikes) return 'Running';
  if (allBikes > allRuns) return 'Cycling';
  return undefined;
}

export function reRankActivitiesSegments(list: UnifiedActivity[]): UnifiedActivity[] {
  const bySeg = new Map<string, { actIdx: number; effIdx: number; elapsedTimeSecs: number }[]>();
  list.forEach((act, actIdx) => {
    if (!Array.isArray(act.segmentEfforts)) return;
    act.segmentEfforts.forEach((eff, effIdx) => {
      if (!eff || !eff.segmentId || !(eff.elapsedTimeSecs > 0)) return;
      const sid = String(eff.segmentId);
      const arr = bySeg.get(sid) || [];
      arr.push({ actIdx, effIdx, elapsedTimeSecs: eff.elapsedTimeSecs });
      bySeg.set(sid, arr);
    });
  });

  const rankLookup = new Map<string, 1 | 2 | 3 | null>();
  for (const arr of bySeg.values()) {
    arr.sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
    arr.forEach((item, idx) => {
      const key = `${item.actIdx}:${item.effIdx}`;
      rankLookup.set(key, idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null);
    });
  }

  return list.map((act, actIdx) => {
    if (!Array.isArray(act.segmentEfforts) || act.segmentEfforts.length === 0) return act;
    const updatedEfforts = act.segmentEfforts.map((eff, effIdx) => ({
      ...eff,
      prRank: rankLookup.get(`${actIdx}:${effIdx}`) ?? eff.prRank ?? null,
    }));
    const prCount = updatedEfforts.filter((e) => e.prRank === 1).length;
    return {
      ...act,
      segmentEfforts: updatedEfforts,
      stravaPrCount: Math.max(act.stravaPrCount || 0, prCount),
    };
  });
}



