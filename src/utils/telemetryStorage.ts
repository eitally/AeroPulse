import {
  AthleteGearItem,
  AthleteHrZone,
  AthletePowerZone,
  AthleteProfile,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  bulkUpsertActivitiesToDexie,
  db,
  getStoreMetadata,
  hydrateUnifiedActivity,
  saveStoreMetadata,
} from '../db/workoutStore';

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
  savedAt: string;
}

const ZONE_COLORS_7 = [
  '#52B788', // Z1 Recovery
  '#2A9D8F', // Z2 Endurance
  '#EAB308', // Z3 Tempo
  '#F97316', // Z4 Threshold
  '#EF4444', // Z5 VO2max
  '#9333EA', // Z6 Anaerobic
  '#EC4899', // Z7 Neuromuscular
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
  names?: string[]
): AthleteHrZone[] {
  const safeLthr = Math.max(120, Math.round(lthr || 163));
  const safeMaxHr = Math.max(safeLthr + 8, Math.round(maxHr || 182));

  // Intervals.icu / Friel 7-zone HR defaults if raw ceilings are not provided
  const defaultCeilings = [
    Math.round(safeLthr * 0.81),
    Math.round(safeLthr * 0.89),
    Math.round(safeLthr * 0.93),
    Math.round(safeLthr * 0.99),
    Math.round(safeLthr * 1.02),
    Math.round(safeLthr * 1.06),
    safeMaxHr,
  ];

  const rawCeilings =
    Array.isArray(ceilingsBpm) && ceilingsBpm.length >= 5
      ? ceilingsBpm.map((v) => Number(v))
      : defaultCeilings;

  const zones: AthleteHrZone[] = [];
  for (let i = 0; i < rawCeilings.length && i < 7; i++) {
    const minBpm = i === 0 ? 60 : rawCeilings[i - 1] + 1;
    const maxBpm =
      i === rawCeilings.length - 1 ? Math.max(rawCeilings[i], safeMaxHr) : rawCeilings[i];
    const minPctLthr = i === 0 ? 50 : Math.round((minBpm / safeLthr) * 100);
    const maxPctLthr = Math.round((maxBpm / safeLthr) * 100);

    zones.push({
      zone: i + 1,
      code: `Z${i + 1}`,
      name: (names && names[i]) || DEFAULT_HR_ZONE_NAMES[i] || `HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr,
      maxPctLthr,
      color: ZONE_COLORS_7[i] || '#EF4444',
    });
  }
  return zones;
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
  let maxBikeWatts20m = 0;
  let maxBikePeakWatts = 0;
  let maxBikeHr = 0;
  let maxBikeSustainedHr = 0;
  let maxRunHr = 0;
  let maxRunSustainedHr = 0;
  let bestRunPaceSecsPerKm = 0;

  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (!a) continue;
      const isBike = a.sportCategory === 'Cycling';
      const isRun = a.sportCategory === 'Running';
      const dur = Number(a.movingTimeSecs || 0);
      const dist = Number(a.distanceMeters || 0);
      const np = Number(a.normalizedPower || a.avgPower || 0);
      const avgHr = Number(a.avgHr || 0);
      const peakHr = Number(a.maxHr || 0);

      if (isBike) {
        if (dur >= 1200 && np >= 80 && np <= 600 && np > maxBikeWatts20m) {
          maxBikeWatts20m = np;
        }
        if (np > 0 && np * 2.3 > maxBikePeakWatts) {
          maxBikePeakWatts = Math.round(np * 2.3);
        }
        if (peakHr >= 130 && peakHr <= 225 && peakHr > maxBikeHr) {
          maxBikeHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 120 && avgHr <= 210 && avgHr > maxBikeSustainedHr) {
          maxBikeSustainedHr = avgHr;
        }
      } else if (isRun) {
        if (peakHr >= 130 && peakHr <= 225 && peakHr > maxRunHr) {
          maxRunHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 120 && avgHr <= 210 && avgHr > maxRunSustainedHr) {
          maxRunSustainedHr = avgHr;
        }
        const pace =
          Number(a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 0) ||
          (dist >= 3000 && dur >= 900 ? Math.round(dur / (dist / 1000)) : 0);
        if (dur >= 1200 && dist >= 3000 && pace >= 165 && pace <= 600) {
          if (bestRunPaceSecsPerKm === 0 || pace < bestRunPaceSecsPerKm) {
            bestRunPaceSecsPerKm = pace;
          }
        }
      }
    }
  }

  const anyMaxHr = Math.max(maxBikeHr, maxRunHr);
  const obsBikeMaxHr = maxBikeHr || anyMaxHr || 0;
  const obsBikeLthr =
    maxBikeSustainedHr >= 130
      ? Math.min(obsBikeMaxHr ? obsBikeMaxHr - 6 : 200, Math.round(maxBikeSustainedHr * 0.98))
      : obsBikeMaxHr
        ? Math.round(obsBikeMaxHr * 0.9)
        : 0;
  const obsRunMaxHr = maxRunHr || obsBikeMaxHr || 0;
  const obsRunLthr =
    maxRunSustainedHr >= 135
      ? Math.min(obsRunMaxHr ? obsRunMaxHr - 5 : 205, Math.round(maxRunSustainedHr * 0.98))
      : obsRunMaxHr
        ? Math.round(obsRunMaxHr * 0.91)
        : obsBikeLthr
          ? obsBikeLthr + 4
          : 0;
  const obsFtp = maxBikeWatts20m >= 90 ? Math.round(maxBikeWatts20m * 0.95) : 0;
  const obsPMax =
    maxBikePeakWatts >= 400
      ? Math.round(maxBikePeakWatts)
      : obsFtp > 0
        ? Math.round(obsFtp * 3.6)
        : 0;
  const obsWPrime = obsFtp > 0 ? Math.round(obsFtp * 75) : 0;
  const obsThresholdPace =
    bestRunPaceSecsPerKm > 0 ? Math.round(bestRunPaceSecsPerKm * 1.03) : 0;
  const safeW = weightKg > 30 ? weightKg : 70;
  const obsRunFtp =
    obsThresholdPace > 0 ? Math.round(safeW * (1000 / obsThresholdPace) * 0.98) : 0;
  const obsVo2Bike =
    obsFtp > 0 && safeW > 30
      ? Math.max(32, Math.min(88, Math.round(10.8 * (obsFtp / safeW) + 7)))
      : 0;
  const obsVo2Run =
    obsThresholdPace > 0
      ? Math.max(
          32,
          Math.min(88, Math.round((1000 / obsThresholdPace) * 60 * 0.2 + 3.5))
        )
      : obsVo2Bike;

  return {
    obsFtp,
    obsPMax,
    obsWPrime,
    obsBikeMaxHr,
    obsBikeLthr,
    obsRunMaxHr,
    obsRunLthr,
    obsThresholdPace,
    obsRunFtp,
    obsVo2Bike,
    obsVo2Run,
  };
}

export function buildCompleteAthleteProfile(
  partial?: Partial<AthleteProfile> | null,
  latestWellness?: UnifiedWellnessDay,
  activities?: UnifiedActivity[] | null
): AthleteProfile {
  // Detect if `partial` was saved with the old hardcoded synthetic defaults
  const isLegacyHardcodedProfile =
    partial?.source !== 'CUSTOM_OVERRIDE' &&
    ((partial?.wPrime === 24500 && partial?.pMax === 1180) ||
      (partial?.lthr === 163 &&
        partial?.maxHr === 182 &&
        partial?.vo2MaxCycling === 56 &&
        partial?.restingHr === 49));

  const storedWeight =
    typeof window !== 'undefined'
      ? Number(window.localStorage.getItem('aeropulse_strava_athlete_weight_kg') || 0)
      : 0;
  const storedFtp =
    typeof window !== 'undefined'
      ? Number(window.localStorage.getItem('aeropulse_strava_athlete_ftp') || 0)
      : 0;

  const weightKg = Number(
    (partial?.weightKg && partial.weightKg !== 70 ? partial.weightKg : 0) ||
      (storedWeight > 30 ? storedWeight : 0) ||
      (latestWellness?.weightKg && latestWellness.weightKg !== 70 ? latestWellness.weightKg : 0) ||
      partial?.weightKg ||
      latestWellness?.weightKg ||
      70.0
  );

  const obs = calibrateMetricsFromActivitiesClient(activities, weightKg);

  const rawFtp = isLegacyHardcodedProfile && (partial?.ftp === 280 || partial?.ftp === 300)
    ? storedFtp || latestWellness?.rideEftp || obs.obsFtp || partial?.ftp
    : partial?.ftp;

  const ftp = Number(rawFtp || storedFtp || latestWellness?.rideEftp || obs.obsFtp || 250);
  const indoorFtp = Number(
    (!isLegacyHardcodedProfile && partial?.indoorFtp) || ftp
  );
  const eFtp = Number(
    latestWellness?.rideEftp ||
      (!isLegacyHardcodedProfile && partial?.eFtp) ||
      obs.obsFtp ||
      ftp
  );
  const wPrime = Number(
    latestWellness?.rideWPrime ||
      (!isLegacyHardcodedProfile && partial?.wPrime) ||
      obs.obsWPrime ||
      Math.round(ftp * 75)
  );
  const pMax = Number(
    latestWellness?.ridePMax ||
      (!isLegacyHardcodedProfile && partial?.pMax) ||
      obs.obsPMax ||
      Math.round(ftp * 3.6)
  );
  const lthr = Number(
    (!isLegacyHardcodedProfile && partial?.lthr) ||
      obs.obsBikeLthr ||
      partial?.lthr ||
      163
  );
  const maxHr = Number(
    (!isLegacyHardcodedProfile && partial?.maxHr) ||
      obs.obsBikeMaxHr ||
      partial?.maxHr ||
      Math.max(lthr + 15, 182)
  );
  const restingHr = Number(
    (latestWellness?.restingHR && latestWellness.restingHR > 25 ? latestWellness.restingHR : 0) ||
      (!isLegacyHardcodedProfile && partial?.restingHr) ||
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
    (!isLegacyHardcodedProfile && partial?.thresholdPaceSecsPerKm) ||
      obs.obsThresholdPace ||
      partial?.thresholdPaceSecsPerKm ||
      255
  );
  const runFtp = Number(
    latestWellness?.runEftp ||
      (!isLegacyHardcodedProfile && partial?.runFtp) ||
      obs.obsRunFtp ||
      Math.round(weightKg * (1000 / Math.max(160, thresholdPaceSecsPerKm)) * 0.98)
  );
  const runEFtp = Number(
    latestWellness?.runEftp ||
      (!isLegacyHardcodedProfile && partial?.runEFtp) ||
      runFtp
  );
  const runLthr = Number(
    (!isLegacyHardcodedProfile && partial?.runLthr) ||
      obs.obsRunLthr ||
      Math.min(maxHr - 4, lthr + 4)
  );
  const runMaxHr = Number(
    (!isLegacyHardcodedProfile && partial?.runMaxHr) ||
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

  const hrZones =
    !isLegacyHardcodedProfile && Array.isArray(partial?.hrZones) && partial!.hrZones!.length >= 5
      ? partial!.hrZones!
      : buildHrZonesFromCeilings(lthr, maxHr);

  const runHrZones =
    !isLegacyHardcodedProfile &&
    Array.isArray(partial?.runHrZones) &&
    partial!.runHrZones!.length >= 5
      ? partial!.runHrZones!
      : buildHrZonesFromCeilings(runLthr, runMaxHr);

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
      : storedStravaName && !isGenericAthleteName(storedStravaName)
        ? storedStravaName
        : storedIntervalsName && !isGenericAthleteName(storedIntervalsName)
          ? storedIntervalsName
          : 'Athlete';

  return {
    athleteId: partial?.athleteId || '0',
    name: resolvedName,
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
    thresholdPaceSecsPerKm: Math.round(thresholdPaceSecsPerKm),
    powerZones,
    hrZones,
    runHrZones,
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

async function loadLegacyTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    const idb = await openTelemetryDb();
    return await new Promise<PersistedTelemetrySnapshot | null>((resolve, reject) => {
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
  } catch {
    return null;
  }
}

export async function loadPersistedTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    const [storedActivities, storedStreams, wellnessDays, plannedEvents, gearItems, snapshotMeta] =
      await Promise.all([
        db.activities.orderBy('start_date').reverse().toArray(),
        db.activityStreams.toArray(),
        db.wellnessDays.orderBy('date').toArray(),
        db.plannedEvents.orderBy('date').toArray(),
        db.gearItems.toArray(),
        getStoreMetadata<{
          athleteProfile?: AthleteProfile;
          redactedStravaCount?: number;
          earliestActivityDate?: string;
          savedAt?: string;
        }>('snapshot_meta'),
      ]);

    const realStoredActivities = storedActivities.filter((rec) => !/^act-\d+$/.test(rec.id));
    if (realStoredActivities.length > 0) {
      const streamByActId = new Map(storedStreams.map((s) => [s.activityId, s]));
      const hydratedActivities = realStoredActivities.map((rec) =>
        reclassifyActivityEnvironment(hydrateUnifiedActivity(rec, streamByActId.get(rec.id)))
      );
      return {
        activities: hydratedActivities,
        wellnessDays,
        plannedEvents,
        gearItems,
        athleteProfile: snapshotMeta?.athleteProfile,
        redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
        earliestActivityDate:
          snapshotMeta?.earliestActivityDate ||
          hydratedActivities[hydratedActivities.length - 1]?.startDateLocal?.slice(0, 10),
        savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
      };
    }

    // Check legacy raw IndexedDB snapshot and migrate into Dexie relational store
    const legacy = await loadLegacyTelemetrySnapshot();
    if (legacy) {
      const realLegacyActivities = legacy.activities.filter((rec) => !/^act-\d+$/.test(rec.id));
      if (realLegacyActivities.length > 0) {
        const cleanedLegacy = { ...legacy, activities: realLegacyActivities };
        await savePersistedTelemetrySnapshot(cleanedLegacy);
        return cleanedLegacy;
      }
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
        if (Array.isArray(snapshot.wellnessDays) && snapshot.wellnessDays.length > 0) {
          await db.wellnessDays.bulkPut(snapshot.wellnessDays);
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
        await saveStoreMetadata('snapshot_meta', {
          athleteProfile: snapshot.athleteProfile,
          redactedStravaCount: snapshot.redactedStravaCount || 0,
          earliestActivityDate: snapshot.earliestActivityDate,
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
  try {
    const idb = await openTelemetryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Merges incoming synced activities with existing persisted activities without losing
 * previously hydrated streams, GPS route polylines, Strava segment efforts, kudos, comments,
 * or Indoor / Virtual Cycling / Smart Trainer classification.
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

  for (const rawAct of existing) {
    if (!rawAct || !rawAct.id) continue;
    const act = reclassifyActivityEnvironment(rawAct);
    byId.set(act.id, act);
    if (act.stravaId) stravaIdToPrimaryId.set(String(act.stravaId), act.id);
    if (act.intervalsId) intervalsIdToPrimaryId.set(String(act.intervalsId), act.id);
  }

  for (const rawInc of incoming) {
    if (!rawInc || !rawInc.id) continue;
    const inc = reclassifyActivityEnvironment(rawInc);
    const matchedKey =
      (byId.has(inc.id) ? inc.id : undefined) ||
      (inc.intervalsId ? intervalsIdToPrimaryId.get(String(inc.intervalsId)) : undefined) ||
      (inc.stravaId ? stravaIdToPrimaryId.get(String(inc.stravaId)) : undefined);

    if (!matchedKey) {
      byId.set(inc.id, inc);
      if (inc.stravaId) stravaIdToPrimaryId.set(String(inc.stravaId), inc.id);
      if (inc.intervalsId) intervalsIdToPrimaryId.set(String(inc.intervalsId), inc.id);
      continue;
    }

    const prev = byId.get(matchedKey)!;
    // Prefer whichever record has an Intervals.icu ID as the primary ID
    const canonicalId = prev.intervalsId ? prev.id : inc.intervalsId ? inc.id : prev.id;

    const mergedBadges = Array.from(
      new Set([...(prev.sourceBadges || []), ...(inc.sourceBadges || [])])
    ) as ('Intervals.icu' | 'Garmin' | 'Strava')[];

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
            : inc.subType || prev.subType;

    const mergedRaw: UnifiedActivity = {
      ...prev,
      ...inc,
      id: canonicalId,
      intervalsId: inc.intervalsId || prev.intervalsId,
      stravaId: inc.stravaId || prev.stravaId,
      environment: resolvedEnv,
      subType: resolvedSubType,
      gearName: inc.gearName || prev.gearName,
      deviceName: inc.deviceName || prev.deviceName,
      avgPower: inc.avgPower ?? prev.avgPower,
      normalizedPower: inc.normalizedPower ?? prev.normalizedPower,
      intensityFactor: inc.intensityFactor ?? prev.intensityFactor,
      trainingLoad: inc.trainingLoad || prev.trainingLoad,
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
      streams:
        inc.streams && Array.isArray(inc.streams.time) && inc.streams.time.length > 0
          ? inc.streams
          : prev.streams,
      intervals:
        Array.isArray(inc.intervals) && inc.intervals.length > 0
          ? inc.intervals
          : prev.intervals,
      segmentEfforts:
        Array.isArray(inc.segmentEfforts) && inc.segmentEfforts.length > 0
          ? inc.segmentEfforts
          : prev.segmentEfforts,
      sourceBadges: mergedBadges,
    };

    const merged = reclassifyActivityEnvironment(mergedRaw);

    if (canonicalId !== matchedKey) {
      byId.delete(matchedKey);
    }
    byId.set(canonicalId, merged);
    if (merged.stravaId) stravaIdToPrimaryId.set(String(merged.stravaId), canonicalId);
    if (merged.intervalsId) intervalsIdToPrimaryId.set(String(merged.intervalsId), canonicalId);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
  );
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

export function computeWellnessDaysFromActivities(
  activities: UnifiedActivity[]
): UnifiedWellnessDay[] {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  const loadByDate = new Map<string, number>();
  let minTime = Date.now() - 180 * 86400 * 1000;
  for (const act of activities) {
    if (!act || !act.startDateLocal) continue;
    const d = act.startDateLocal.slice(0, 10);
    const t = new Date(`${d}T00:00:00`).getTime();
    if (Number.isFinite(t) && t < minTime) {
      minTime = t;
    }
    loadByDate.set(d, (loadByDate.get(d) || 0) + Math.max(0, Number(act.trainingLoad || 0)));
  }

  const todayMs = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  // Cap lookback to 365 days so PMC chart is fast and accurate
  const startMs = Math.max(minTime, todayMs - 365 * 86400 * 1000);
  const days: UnifiedWellnessDay[] = [];
  let ctl = 0;
  let atl = 0;

  for (let ms = startMs; ms <= todayMs; ms += 86400 * 1000) {
    const dateStr = new Date(ms).toISOString().slice(0, 10);
    const dailyLoad = Math.round(loadByDate.get(dateStr) || 0);
    const prevCtl = ctl;
    const prevAtl = atl;
    ctl = ctl + (dailyLoad - ctl) / 42;
    atl = atl + (dailyLoad - atl) / 7;
    const tsb = prevCtl - prevAtl;
    const ctl7DaysAgo = days.length >= 7 ? days[days.length - 7].ctl : 0;
    const rampRate = Number((ctl - ctl7DaysAgo).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;

    let garminTrainingStatus: UnifiedWellnessDay['garminTrainingStatus'] = 'Maintaining';
    if (rampRate > 6 || tsb < -25) garminTrainingStatus = 'Overreaching';
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
  clientSecret?: string;
  athleteId?: string;
  athleteName?: string;
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
    if (tokens.clientSecret) {
      localStorage.setItem('aeropulse_strava_client_secret', tokens.clientSecret.trim());
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
