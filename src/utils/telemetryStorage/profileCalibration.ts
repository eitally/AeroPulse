import type {
  AthleteHrZone,
  AthletePowerZone,
  AthleteProfile,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
  deriveObservedPhysiologyMetrics,
  isEBikeActivityText,
} from '../../physiology/stravaLoadCalibration';
import {
  DEFAULT_SWIM_CSS_SECS_PER_100M,
  buildSwimPaceZones,
  deriveSwimCssFromActivities,
} from '../../physiology/swimZones';
import { isGenericAthleteName } from './clientSessionStorage';

export const CURRENT_PMC_MODEL_VERSION = STRAVA_LOAD_MODEL_VERSION;

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

export interface LegacyActivityAliasFields {
  garminId?: string;
  garminActivityId?: string;
  intervalsActivityId?: string;
}

export function getActivityWithLegacyAliases(
  act: UnifiedActivity
): UnifiedActivity & LegacyActivityAliasFields {
  return act as UnifiedActivity & LegacyActivityAliasFields;
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

  const legacyAct = getActivityWithLegacyAliases(act);
  const isGarminSourced =
    act.id.startsWith('garmin-') ||
    Boolean(legacyAct.garminId || legacyAct.garminActivityId) ||
    Boolean(act.sourceBadges?.includes('Garmin'));
  const isStravaSourced =
    act.id.startsWith('strava-') ||
    Boolean(act.stravaId) ||
    Boolean(act.sourceBadges?.includes('Strava'));
  const hasAuthoritativeIntervals =
    Boolean(act.intervalsId || legacyAct.intervalsActivityId) ||
    Boolean(act.sourceBadges?.includes('Intervals.icu'));

  if (hasAuthoritativeIntervals && !isGarminSourced) return act;
  if (!isGarminSourced && !isStravaSourced) return act;

  const hasAnyGps =
    Boolean(act.summaryPolyline && act.summaryPolyline.length > 4) ||
    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
    (Array.isArray(act.startLatLng) && act.startLatLng.length === 2);

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
  activities?: UnifiedActivity[] | null,
  options?: { skipLocalStorageFallback?: boolean }
): AthleteProfile {
  const isLegacyHardcodedProfile = isUncalibratedDefaultProfile(partial);
  const allowLocalFallback = !options?.skipLocalStorageFallback;

  let storedWeight = 0;
  let storedFtp = 0;
  if (allowLocalFallback && typeof window !== 'undefined') {
    try {
      storedWeight = Number(window.localStorage.getItem('aeropulse_strava_athlete_weight_kg') || 0);
      storedFtp = Number(window.localStorage.getItem('aeropulse_strava_athlete_ftp') || 0);
    } catch {
      // Restricted WebView / private iframe localStorage access is optional
    }
  }

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

  let storedGarminName: string | undefined;
  let storedStravaName: string | undefined;
  let storedIntervalsName: string | undefined;
  let storedPrimarySportRaw: string | undefined;
  if (allowLocalFallback && typeof window !== 'undefined') {
    try {
      storedGarminName = window.localStorage.getItem('aeropulse_garmin_athlete_name')?.trim();
      storedStravaName = window.localStorage.getItem('aeropulse_strava_athlete_name')?.trim();
      storedIntervalsName = window.localStorage.getItem('aeropulse_intervals_athlete_name')?.trim();
      storedPrimarySportRaw = window.localStorage.getItem('thresh_primary_sport')?.trim();
    } catch {
      // Restricted WebView / private iframe localStorage access is optional
    }
  }
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

  const storedPrimarySport: AthleteProfile['primarySport'] =
    storedPrimarySportRaw === 'Running' ||
    storedPrimarySportRaw === 'Cycling' ||
    storedPrimarySportRaw === 'Swimming' ||
    storedPrimarySportRaw === 'Triathlon' ||
    storedPrimarySportRaw === 'Hybrid'
      ? storedPrimarySportRaw
      : undefined;
  const resolvedPrimarySport: AthleteProfile['primarySport'] =
    partial?.primarySport || storedPrimarySport;

  const derivedSwimCss = deriveSwimCssFromActivities(activities);
  const rawSwimCss = Number(partial?.swimCssSecsPer100m || 0);
  const resolvedSwimCss =
    partial?.source === 'CUSTOM_OVERRIDE' && rawSwimCss >= 60 && rawSwimCss <= 240
      ? Math.round(rawSwimCss)
      : derivedSwimCss ||
        (rawSwimCss >= 60 && rawSwimCss <= 240 && rawSwimCss !== DEFAULT_SWIM_CSS_SECS_PER_100M
          ? Math.round(rawSwimCss)
          : rawSwimCss >= 60 && rawSwimCss <= 240
            ? Math.round(rawSwimCss)
            : DEFAULT_SWIM_CSS_SECS_PER_100M);
  const swimZones =
    partial?.source === 'CUSTOM_OVERRIDE' &&
    Array.isArray(partial?.swimZones) &&
    partial.swimZones.length >= 4
      ? partial.swimZones
      : buildSwimPaceZones(resolvedSwimCss);

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
    swimCssSecsPer100m: resolvedSwimCss,
    swimZones,
    powerZones,
    hrZones,
    runHrZones,
    thresholdHistory: Array.isArray(partial?.thresholdHistory)
      ? partial.thresholdHistory
      : undefined,
    safeSportHideWeight: Boolean(partial?.safeSportHideWeight),
    ...(partial?.birthMonthYear ? { birthMonthYear: partial.birthMonthYear } : {}),
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
 * Checks whether a GPS coordinate pair falls inside known Virtual Cycling worlds.
 */
export function isVirtualWorldLatLng(latLng?: [number, number] | null): boolean {
  if (!Array.isArray(latLng) || latLng.length < 2) return false;
  const [lat, lng] = latLng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  if (lat >= -12.6 && lat <= -9.8 && lng >= 164.8 && lng <= 168.0) {
    return true;
  }
  return false;
}

/**
 * Normalizes and re-classifies any activity so Virtual Cycling and Smart Trainer sessions
 * are accurately tagged with environment: 'INDOOR' and subType.
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

export function inferPrimarySportFromActivities(
  activities: UnifiedActivity[]
): 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | undefined {
  if (!Array.isArray(activities) || activities.length === 0) return undefined;
  const recent = activities.slice(0, 28);
  const runCount = recent.filter((a) => a.sportCategory === 'Running').length;
  const bikeCount = recent.filter((a) => a.sportCategory === 'Cycling').length;
  const swimCount = recent.filter((a) => a.sportCategory === 'Swimming').length;
  if (swimCount >= 1 && bikeCount >= 1 && runCount >= 1) return 'Triathlon';
  if (swimCount > runCount && swimCount > bikeCount) return 'Swimming';
  if (runCount > bikeCount) return 'Running';
  if (bikeCount > runCount) return 'Cycling';
  const allRuns = activities.filter((a) => a.sportCategory === 'Running').length;
  const allBikes = activities.filter((a) => a.sportCategory === 'Cycling').length;
  const allSwims = activities.filter((a) => a.sportCategory === 'Swimming').length;
  if (allSwims >= 1 && allBikes >= 1 && allRuns >= 1) return 'Triathlon';
  if (allSwims > allRuns && allSwims > allBikes) return 'Swimming';
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
