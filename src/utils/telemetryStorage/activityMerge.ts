import type {
  ActivityInterval,
  ActivitySourceBadge,
  ActivityStreamSet,
  OfficialRaceMetadata,
  StopwatchFusionMetadata,
  UnifiedActivity,
} from '../../types';
import {
  areActivityTimestampsClose,
  resolveActivityStartEpochMs,
  stripTimezoneSuffix,
} from '../activityTimestamp';
import { fuseWearableStreamWithStopwatchSplits } from '../stopwatchWearableFusion';
import {
  CURRENT_PMC_MODEL_VERSION,
  reclassifyActivityEnvironment,
} from './profileCalibration';

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

const WARMUP_COOLDOWN_EASY_NAME_RE =
  /warm\s*-?\s*up|cool\s*-?\s*down|shakeout|jog|easy/i;

const WEARABLE_ORIGIN_BADGES = new Set<ActivitySourceBadge>([
  'Garmin',
  'Strava',
  'Intervals.icu',
  'Wahoo',
  'Polar',
  'COROS',
]);

export function isSelfReportedPlaceholderActivity(
  act: UnifiedActivity | null | undefined
): boolean {
  if (!act || !act.id) return false;
  if (act.id.startsWith('self-logged-')) return true;
  const badges = act.sourceBadges || [];
  return (
    badges.includes('Self-Logged') &&
    !act.stravaId &&
    !act.intervalsId &&
    !act.wahooId &&
    !act.polarId &&
    !badges.some((b) => WEARABLE_ORIGIN_BADGES.has(b))
  );
}

export function hasWearableDeviceProvenance(
  act: UnifiedActivity | null | undefined
): boolean {
  if (!act || !act.id) return false;
  if (isSelfReportedPlaceholderActivity(act)) return false;
  if (
    act.stravaId ||
    act.intervalsId ||
    (act as { intervalsActivityId?: string }).intervalsActivityId ||
    act.wahooId ||
    act.polarId
  ) {
    return true;
  }
  return (act.sourceBadges || []).some((b) => WEARABLE_ORIGIN_BADGES.has(b));
}

export function isOfficialFatRaceActivity(
  act: UnifiedActivity | null | undefined
): boolean {
  if (!act || !act.officialRaceData) return false;
  if (isSyntheticStopwatchActivity(act)) return false;
  if (act.id?.startsWith('stopwatch-race-')) return false;
  if (act.officialRaceData.platform === 'MeetReady Stopwatch') return false;
  if (act.officialRaceData.timingMethod === 'HAND') return false;
  if (
    (act.matchedStopwatchId || act.stopwatchFusionMeta?.stopwatchActivityId) &&
    act.officialRaceData.timingMethod !== 'FAT' &&
    act.officialRaceData.platform === 'Official FAT'
  ) {
    return false;
  }
  return true;
}

function isStopwatchSideForWearableFusion(
  act: UnifiedActivity | null | undefined
): boolean {
  if (!act) return false;
  if (isSyntheticStopwatchActivity(act)) return true;
  if (hasWearableDeviceProvenance(act)) return false;
  return Boolean(act.matchedStopwatchId || act.stopwatchFusionMeta?.stopwatchActivityId);
}

function isStopwatchRaceCandidateForFatMatch(
  act: UnifiedActivity | null | undefined
): boolean {
  if (!act || !act.officialRaceData) return false;
  return Boolean(
    act.id?.startsWith('stopwatch-race-') ||
      act.officialRaceData.platform === 'MeetReady Stopwatch' ||
      act.officialRaceData.timingMethod === 'HAND' ||
      isSyntheticStopwatchActivity(act) ||
      act.matchedStopwatchId ||
      act.stopwatchFusionMeta?.stopwatchActivityId
  );
}

function hasConfirmedWearableSpeedStream(act: UnifiedActivity): boolean {
  const vel = act.streams?.velocitySmooth;
  return Boolean(Array.isArray(vel) && vel.length >= 10 && vel.some((v) => v > 0));
}

function resolveActivityIntervalEpochSecs(
  act: UnifiedActivity,
  useRaceWindowOnly: boolean,
  preferUtcMs: boolean
): { startSecs: number; endSecs: number } | null {
  let startMs: number | null = null;
  if (preferUtcMs && typeof act.startDateUtcMs === 'number' && act.startDateUtcMs > 0) {
    startMs = act.startDateUtcMs;
  } else if (act.startDateLocal) {
    const cleanIso = stripTimezoneSuffix(act.startDateLocal);
    const parsed = new Date(cleanIso).getTime();
    if (Number.isFinite(parsed)) startMs = parsed;
  }
  if (startMs === null) return null;

  const raceSecs = useRaceWindowOnly
    ? act.officialRaceData?.handTimedTotalSecs || act.officialRaceData?.fatTimeSecs
    : undefined;
  const durationSecs = Math.max(30, raceSecs || act.movingTimeSecs || 0);
  const startSecs = startMs / 1000;
  return { startSecs, endSecs: startSecs + durationSecs };
}

function isDefaultWatchlessStartIso(startDateLocal: string | undefined): boolean {
  if (!startDateLocal) return true;
  const clean = stripTimezoneSuffix(startDateLocal);
  return /T(00:00:00|09:00:00|10:30:00|12:00:00)$/.test(clean);
}

function normalizeStopwatchSourceBadges(
  badges: ActivitySourceBadge[] | undefined,
  treatOfficialFatAsHandTimed: boolean
): ActivitySourceBadge[] {
  const list = badges || [];
  return list.map((b) =>
    treatOfficialFatAsHandTimed && b === 'Official FAT'
      ? ('Hand-Timed' as ActivitySourceBadge)
      : b
  );
}

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
  if (String(act.deviceName || '').includes('Trackside Stopwatch')) {
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

export function isStopwatchWearableSameSessionMatch(
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

  if (isSelfReportedPlaceholderActivity(a) || isSelfReportedPlaceholderActivity(b)) {
    return false;
  }

  const aIsSw = isStopwatchSideForWearableFusion(a);
  const bIsSw = isStopwatchSideForWearableFusion(b);
  if (aIsSw === bIsSw) return false;
  if (a.sportCategory !== 'Running' || b.sportCategory !== 'Running') return false;

  const stopwatchAct = aIsSw ? a : b;
  const wearableAct = aIsSw ? b : a;
  if (!hasWearableDeviceProvenance(wearableAct)) return false;

  const isRaceStopwatch =
    stopwatchAct.id.startsWith('stopwatch-race-') || Boolean(stopwatchAct.officialRaceData);

  const bothHaveUtc =
    typeof stopwatchAct.startDateUtcMs === 'number' &&
    stopwatchAct.startDateUtcMs > 0 &&
    typeof wearableAct.startDateUtcMs === 'number' &&
    wearableAct.startDateUtcMs > 0;

  if (!bothHaveUtc) {
    if (!a.startDateLocal || !b.startDateLocal) return false;
    if (String(a.startDateLocal).slice(0, 10) !== String(b.startDateLocal).slice(0, 10)) {
      return false;
    }
  }

  const swInterval = resolveActivityIntervalEpochSecs(stopwatchAct, isRaceStopwatch, bothHaveUtc);
  const watchInterval = resolveActivityIntervalEpochSecs(wearableAct, false, bothHaveUtc);
  if (!swInterval || !watchInterval) return false;

  const overlaps =
    watchInterval.startSecs <= swInterval.endSecs + 60 &&
    watchInterval.endSecs >= swInterval.startSecs - 60;
  if (!overlaps) return false;

  if (isRaceStopwatch) {
    if (WARMUP_COOLDOWN_EASY_NAME_RE.test(wearableAct.name || '')) {
      return false;
    }

    const raceTimeSecs =
      stopwatchAct.officialRaceData?.handTimedTotalSecs ||
      stopwatchAct.officialRaceData?.fatTimeSecs ||
      stopwatchAct.movingTimeSecs ||
      0;
    const raceDistMeters =
      stopwatchAct.officialRaceData?.eventDistanceMeters || stopwatchAct.distanceMeters || 0;
    const hasConfirmedSpeed = hasConfirmedWearableSpeedStream(wearableAct);

    if (!hasConfirmedSpeed && raceTimeSecs > 0 && wearableAct.movingTimeSecs > raceTimeSecs * 2.5) {
      return false;
    }
    if (raceDistMeters > 0 && wearableAct.distanceMeters > raceDistMeters * 2.0) {
      return false;
    }
    if (
      !hasConfirmedSpeed &&
      raceTimeSecs > 0 &&
      raceDistMeters > 0 &&
      wearableAct.distanceMeters > 0 &&
      wearableAct.movingTimeSecs > 0
    ) {
      const racePaceSecsKm = (raceTimeSecs / raceDistMeters) * 1000;
      const watchPaceSecsKm =
        wearableAct.avgPaceSecsPerKm && wearableAct.avgPaceSecsPerKm > 0
          ? wearableAct.avgPaceSecsPerKm
          : (wearableAct.movingTimeSecs / wearableAct.distanceMeters) * 1000;
      if (racePaceSecsKm > 0 && Math.abs(watchPaceSecsKm - racePaceSecsKm) / racePaceSecsKm > 0.2) {
        return false;
      }
    }
  }

  return true;
}

function isFatStopwatchPairMatch(a: UnifiedActivity, b: UnifiedActivity): boolean {
  if (!a.officialRaceData || !b.officialRaceData) return false;
  const dateA = a.startDateLocal?.slice(0, 10);
  const dateB = b.startDateLocal?.slice(0, 10);
  if (!dateA || !dateB || dateA !== dateB) return false;

  const distA = a.officialRaceData.eventDistanceMeters || a.distanceMeters || 0;
  const distB = b.officialRaceData.eventDistanceMeters || b.distanceMeters || 0;
  if (distA <= 0 || distB <= 0) return false;
  if (Math.abs(distA - distB) / Math.max(distA, distB) > 0.02) return false;

  const aIsFat = isOfficialFatRaceActivity(a);
  const bIsFat = isOfficialFatRaceActivity(b);
  const aIsSw = isStopwatchRaceCandidateForFatMatch(a);
  const bIsSw = isStopwatchRaceCandidateForFatMatch(b);

  if (aIsFat && bIsFat) {
    const fatA = a.officialRaceData.fatTimeSecs || 0;
    const fatB = b.officialRaceData.fatTimeSecs || 0;
    if (fatA <= 0 || fatB <= 0) return false;
    if (Math.abs(fatA - fatB) >= 0.05) return false;
    return (
      a.officialRaceData.platform === b.officialRaceData.platform ||
      Boolean(a.matchedStopwatchId || b.matchedStopwatchId)
    );
  }

  if ((aIsFat && bIsSw && !bIsFat) || (bIsFat && aIsSw && !aIsFat)) {
    const fatSide = aIsFat ? a : b;
    const swSide = aIsFat ? b : a;
    const fatTime = fatSide.officialRaceData?.fatTimeSecs || 0;
    const swTime =
      swSide.officialRaceData?.handTimedTotalSecs ??
      swSide.officialRaceData?.fatTimeSecs ??
      swSide.movingTimeSecs ??
      0;
    if (fatTime <= 0 || swTime <= 0) return false;
    return Math.abs(fatTime - swTime) <= Math.max(3.5, fatTime * 0.02);
  }

  return false;
}

function mergeFatAndStopwatchRaceActivity(
  primary: UnifiedActivity,
  secondary: UnifiedActivity
): UnifiedActivity {
  const pickOrder = (() => {
    const pIsFat = isOfficialFatRaceActivity(primary);
    const sIsFat = isOfficialFatRaceActivity(secondary);
    if (pIsFat && !sIsFat) return { fatAct: primary, swAct: secondary };
    if (sIsFat && !pIsFat) return { fatAct: secondary, swAct: primary };
    const pHasRich = Boolean(
      primary.matchedStopwatchId ||
        primary.stopwatchFusionMeta ||
        hasWearableDeviceProvenance(primary) ||
        (primary.officialRaceData?.lapSplitsSecs?.length && !primary.officialRaceData?.splitsEstimated)
    );
    return pHasRich ? { fatAct: secondary, swAct: primary } : { fatAct: primary, swAct: secondary };
  })();

  const { fatAct, swAct } = pickOrder;
  const watchSide = hasWearableDeviceProvenance(swAct)
    ? swAct
    : hasWearableDeviceProvenance(fatAct)
      ? fatAct
      : undefined;

  const fatRace = fatAct.officialRaceData!;
  const swRace = swAct.officialRaceData;

  const swHasRealSplits = Boolean(
    swRace &&
      Array.isArray(swRace.lapSplitsSecs) &&
      swRace.lapSplitsSecs.length > 0 &&
      !swRace.splitsEstimated
  );
  const fatHasRealSplits = Boolean(
    Array.isArray(fatRace.lapSplitsSecs) &&
      fatRace.lapSplitsSecs.length > 0 &&
      !fatRace.splitsEstimated
  );

  const resolvedSplits = swHasRealSplits
    ? swRace!.lapSplitsSecs
    : fatHasRealSplits
      ? fatRace.lapSplitsSecs
      : fatRace.lapSplitsSecs.length > 0
        ? fatRace.lapSplitsSecs
        : swRace?.lapSplitsSecs || [];

  const resolvedSplitsEstimated = swHasRealSplits
    ? false
    : fatHasRealSplits
      ? false
      : Boolean(fatRace.splitsEstimated ?? swRace?.splitsEstimated ?? resolvedSplits.length === 0);

  const resolvedHandTimedTotal =
    swRace?.handTimedTotalSecs ??
    fatRace.handTimedTotalSecs ??
    ((swAct.id.startsWith('stopwatch-race-') ||
      swRace?.platform === 'MeetReady Stopwatch' ||
      swRace?.timingMethod === 'HAND' ||
      isSyntheticStopwatchActivity(swAct)) &&
    swRace?.fatTimeSecs &&
    swRace.fatTimeSecs > 0
      ? swRace.fatTimeSecs
      : undefined);

  const resolvedCapturedBy = swRace?.capturedByName || fatRace.capturedByName;
  const resolvedTimingStation = swRace?.timingStation || fatRace.timingStation;
  const resolvedHandCaptures =
    swRace?.handSplitCaptures && swRace.handSplitCaptures.length > 0
      ? swRace.handSplitCaptures
      : fatRace.handSplitCaptures;

  const resolvedOfficialRaceData: OfficialRaceMetadata = {
    ...(swRace || {}),
    ...fatRace,
    platform:
      fatRace.platform !== 'MeetReady Stopwatch'
        ? fatRace.platform
        : swRace?.platform || 'Official FAT',
    timingMethod: 'FAT',
    placeFinish: fatRace.placeFinish ?? swRace?.placeFinish,
    sourceUrl: fatRace.sourceUrl || swRace?.sourceUrl,
    vdotScore: fatRace.vdotScore ?? swRace?.vdotScore ?? 0,
    lapSplitDistanceMeters:
      swHasRealSplits && swRace?.lapSplitDistanceMeters
        ? swRace.lapSplitDistanceMeters
        : fatRace.lapSplitDistanceMeters,
    lapSplitsSecs: resolvedSplits,
    splitsEstimated: resolvedSplitsEstimated,
    ...(resolvedHandTimedTotal !== undefined
      ? { handTimedTotalSecs: resolvedHandTimedTotal }
      : {}),
    ...(resolvedCapturedBy ? { capturedByName: resolvedCapturedBy } : {}),
    ...(resolvedTimingStation ? { timingStation: resolvedTimingStation } : {}),
    ...(resolvedHandCaptures ? { handSplitCaptures: resolvedHandCaptures } : {}),
  };

  const normalizedSwBadges = normalizeStopwatchSourceBadges(
    swAct.sourceBadges,
    !isOfficialFatRaceActivity(swAct)
  );
  const mergedBadges = Array.from(
    new Set([...(fatAct.sourceBadges || []), ...normalizedSwBadges])
  ).filter((b) => b !== 'Self-Logged') as ActivitySourceBadge[];

  const resolvedStopwatchId =
    swAct.matchedStopwatchId ||
    swAct.stopwatchFusionMeta?.stopwatchActivityId ||
    (isStopwatchRaceCandidateForFatMatch(swAct) && swAct.id.startsWith('stopwatch-race-')
      ? swAct.id
      : fatAct.matchedStopwatchId || fatAct.stopwatchFusionMeta?.stopwatchActivityId);

  const baseFusion = swAct.stopwatchFusionMeta || fatAct.stopwatchFusionMeta;
  const resolvedFusionMeta = baseFusion
    ? {
        ...(fatAct.stopwatchFusionMeta || {}),
        ...(swAct.stopwatchFusionMeta || {}),
        repDistanceMeters:
          swAct.stopwatchFusionMeta?.repDistanceMeters ??
          fatAct.stopwatchFusionMeta?.repDistanceMeters ??
          resolvedOfficialRaceData.lapSplitDistanceMeters ??
          400,
        restDurationSecs:
          swAct.stopwatchFusionMeta?.restDurationSecs ??
          fatAct.stopwatchFusionMeta?.restDurationSecs ??
          0,
        stopwatchActivityId:
          resolvedStopwatchId ||
          baseFusion.stopwatchActivityId ||
          swAct.id,
        lapSplitsSecs:
          resolvedSplits.length > 0 ? resolvedSplits : baseFusion.lapSplitsSecs || [],
      }
    : undefined;

  const canonicalId = watchSide ? watchSide.id : fatAct.id;
  const startDateLocal = stripTimezoneSuffix(
    watchSide?.startDateLocal ||
      (!isDefaultWatchlessStartIso(swAct.startDateLocal)
        ? swAct.startDateLocal
        : fatAct.startDateLocal)
  );
  const startDateUtcMs =
    watchSide?.startDateUtcMs ??
    (!isDefaultWatchlessStartIso(swAct.startDateLocal)
      ? swAct.startDateUtcMs
      : fatAct.startDateUtcMs);

  const metricsSource = watchSide || fatAct;

  return {
    ...swAct,
    ...fatAct,
    ...(watchSide ? watchSide : {}),
    id: canonicalId,
    name: fatAct.name,
    startDateLocal,
    ...(startDateUtcMs !== undefined ? { startDateUtcMs } : {}),
    movingTimeSecs: metricsSource.movingTimeSecs,
    distanceMeters: metricsSource.distanceMeters,
    trainingLoad: metricsSource.trainingLoad || swAct.trainingLoad || fatAct.trainingLoad,
    avgHr: watchSide?.avgHr || swAct.avgHr || fatAct.avgHr,
    maxHr: watchSide?.maxHr || swAct.maxHr || fatAct.maxHr,
    zoneSecs:
      watchSide?.zoneSecs?.hr?.some((v) => v > 0)
        ? watchSide.zoneSecs
        : fatAct.zoneSecs,
    streams: watchSide?.streams || swAct.streams || fatAct.streams,
    routeLatLngs: watchSide?.routeLatLngs || swAct.routeLatLngs || fatAct.routeLatLngs,
    intervals: watchSide?.intervals?.length
      ? watchSide.intervals
      : swHasRealSplits && swAct.intervals?.length
        ? swAct.intervals
        : fatAct.intervals,
    stravaId: watchSide?.stravaId || swAct.stravaId || fatAct.stravaId,
    intervalsId:
      watchSide?.intervalsId ||
      swAct.intervalsId ||
      fatAct.intervalsId ||
      (watchSide as { intervalsActivityId?: string } | undefined)?.intervalsActivityId,
    wahooId: watchSide?.wahooId || swAct.wahooId || fatAct.wahooId,
    polarId: watchSide?.polarId || swAct.polarId || fatAct.polarId,
    stravaPrCount: Math.max(fatAct.stravaPrCount || 0, swAct.stravaPrCount || 0),
    footwearClass: swAct.footwearClass ?? fatAct.footwearClass,
    spikedDistanceMeters: swAct.spikedDistanceMeters ?? fatAct.spikedDistanceMeters,
    trackFacility: swAct.trackFacility ?? fatAct.trackFacility,
    matchedStopwatchId: resolvedStopwatchId,
    ...(resolvedFusionMeta ? { stopwatchFusionMeta: resolvedFusionMeta } : {}),
    officialRaceData: resolvedOfficialRaceData,
    sourceBadges: mergedBadges,
  };
}

function isSelfReportedPlaceholderMatch(a: UnifiedActivity, b: UnifiedActivity): boolean {
  const aIsSelf = isSelfReportedPlaceholderActivity(a);
  const bIsSelf = isSelfReportedPlaceholderActivity(b);
  if (aIsSelf === bIsSelf) return false;
  const selfAct = aIsSelf ? a : b;
  const otherAct = aIsSelf ? b : a;
  if (!hasWearableDeviceProvenance(otherAct)) return false;
  if (otherAct.sportCategory !== 'Running') return false;
  if (isSyntheticStopwatchActivity(otherAct)) return false;
  if (selfAct.sportCategory && selfAct.sportCategory !== 'Running') return false;
  const selfDate = selfAct.startDateLocal?.slice(0, 10);
  const watchDate = otherAct.startDateLocal?.slice(0, 10);
  return Boolean(selfDate && watchDate && selfDate === watchDate);
}

function mergeSelfReportedWithWearable(
  a: UnifiedActivity,
  b: UnifiedActivity
): UnifiedActivity {
  const aIsSelf = isSelfReportedPlaceholderActivity(a);
  const selfAct = aIsSelf ? a : b;
  const watchAct = aIsSelf ? b : a;
  const badges = Array.from(
    new Set([...(watchAct.sourceBadges || []), ...(selfAct.sourceBadges || [])])
  ).filter((badge) => badge !== 'Self-Logged') as ActivitySourceBadge[];

  return {
    ...watchAct,
    quickLog: watchAct.quickLog ?? selfAct.quickLog,
    footwearClass: watchAct.footwearClass ?? selfAct.footwearClass,
    trackFacility: watchAct.trackFacility ?? selfAct.trackFacility,
    isCompetitionDay: watchAct.isCompetitionDay ?? selfAct.isCompetitionDay,
    sourceBadges: badges,
  };
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
  const swIsOfficialFat = isOfficialFatRaceActivity(stopwatchAct);
  const normalizedStopwatchBadges = normalizeStopwatchSourceBadges(
    stopwatchAct.sourceBadges,
    !swIsOfficialFat
  );
  const mergedBadges = Array.from(
    new Set([...(wearableAct.sourceBadges || []), ...normalizedStopwatchBadges])
  ) as ActivitySourceBadge[];

  const baseDevice = (wearableAct.deviceName || '').trim();
  const deviceName = baseDevice
    ? /\bStopwatch$/i.test(baseDevice)
      ? baseDevice
      : `${baseDevice} + MeetReady Stopwatch`
    : 'Watch + MeetReady Stopwatch';

  const watchName = (wearableAct.name || '').trim();
  const resolvedName =
    swIsOfficialFat || !watchName || GENERIC_WATCH_RUN_NAME_RE.test(watchName)
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

  const resolvedStopwatchId =
    stopwatchAct.matchedStopwatchId ||
    stopwatchAct.stopwatchFusionMeta?.stopwatchActivityId ||
    stopwatchAct.id;

  const resolvedOfficialRaceData =
    !swIsOfficialFat && (stopwatchAct.officialRaceData ?? wearableAct.officialRaceData)
      ? {
          ...(stopwatchAct.officialRaceData ?? wearableAct.officialRaceData)!,
          timingMethod: 'HAND' as const,
          handTimedTotalSecs:
            (stopwatchAct.officialRaceData ?? wearableAct.officialRaceData)!.handTimedTotalSecs ??
            (stopwatchAct.officialRaceData ?? wearableAct.officialRaceData)!.fatTimeSecs,
        }
      : stopwatchAct.officialRaceData ?? wearableAct.officialRaceData;

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
    stravaPrCount: Math.max(wearableAct.stravaPrCount || 0, stopwatchAct.stravaPrCount || 0),
    officialRaceData: resolvedOfficialRaceData,
    matchedStopwatchId: resolvedStopwatchId,
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
 * streams, GPS polylines, segment efforts, or Indoor / Virtual Cycling classification,
 * while deduplicating multi-source activities and reconciling FAT + Stopwatch + Watch layers.
 */
export function mergeActivitiesNonDestructive(
  existing: UnifiedActivity[],
  incoming: UnifiedActivity[]
): UnifiedActivity[] {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  if (safeExisting.length === 0 && safeIncoming.length <= 1) {
    return safeIncoming.map(reclassifyActivityEnvironment);
  }
  if (safeIncoming.length === 0 && safeExisting.length <= 1) {
    return safeExisting.map(reclassifyActivityEnvironment);
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

  for (const rawAct of safeExisting) {
    if (!rawAct || !rawAct.id) continue;
    const act = reclassifyActivityEnvironment(rawAct);
    byId.set(act.id, act);
    indexPrimaryAct(act, act.id);
  }

  const commitPrimaryWithCrossLayerSweep = (initialMerged: UnifiedActivity, replacedKey?: string) => {
    let current = reclassifyActivityEnvironment(initialMerged);
    if (replacedKey && replacedKey !== current.id) {
      byId.delete(replacedKey);
    }

    for (const [candidateKey, candidate] of Array.from(byId.entries())) {
      if (candidateKey === current.id) continue;
      if (isSelfReportedPlaceholderMatch(current, candidate)) {
        const upgraded = reclassifyActivityEnvironment(
          mergeSelfReportedWithWearable(current, candidate)
        );
        if (current.id !== upgraded.id) byId.delete(current.id);
        byId.delete(candidateKey);
        current = upgraded;
        continue;
      }
      if (isFatStopwatchPairMatch(current, candidate)) {
        const reconciled = reclassifyActivityEnvironment(
          mergeFatAndStopwatchRaceActivity(current, candidate)
        );
        if (current.id !== reconciled.id) byId.delete(current.id);
        byId.delete(candidateKey);
        current = reconciled;
        continue;
      }
      if (isStopwatchWearableSameSessionMatch(current, candidate)) {
        const candidateIsSw = isStopwatchSideForWearableFusion(candidate);
        const wearableAct = candidateIsSw ? current : candidate;
        const swAct = candidateIsSw ? candidate : current;
        if (hasWearableDeviceProvenance(wearableAct)) {
          const fused = reclassifyActivityEnvironment(
            mergeStopwatchAndWearableActivity(wearableAct, swAct)
          );
          if (current.id !== fused.id) byId.delete(current.id);
          byId.delete(candidateKey);
          current = fused;
        }
      }
    }

    byId.set(current.id, current);
    indexPrimaryAct(current, current.id);
  };

  for (const rawInc of safeIncoming) {
    if (!rawInc || !rawInc.id) continue;
    const inc = reclassifyActivityEnvironment(rawInc);

    let proximityMatchKey: string | undefined;
    const incIntervalsId =
      inc.intervalsId || (inc as { intervalsActivityId?: string }).intervalsActivityId;
    for (const existingAct of byId.values()) {
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
      if (isSelfReportedPlaceholderMatch(existingAct, inc)) {
        proximityMatchKey = existingAct.id;
        break;
      }
      if (isFatStopwatchPairMatch(existingAct, inc)) {
        proximityMatchKey = existingAct.id;
        break;
      }
      if (isStopwatchWearableSameSessionMatch(existingAct, inc)) {
        proximityMatchKey = existingAct.id;
        break;
      }
      const eitherIsWatchlessOfficialOrSelf =
        isSelfReportedPlaceholderActivity(existingAct) ||
        isSelfReportedPlaceholderActivity(inc) ||
        (isOfficialFatRaceActivity(existingAct) && !hasWearableDeviceProvenance(existingAct)) ||
        (isOfficialFatRaceActivity(inc) && !hasWearableDeviceProvenance(inc));
      if (eitherIsWatchlessOfficialOrSelf) {
        continue;
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
      commitPrimaryWithCrossLayerSweep(inc);
      continue;
    }

    const prev = byId.get(matchedKey)!;
    if (isSelfReportedPlaceholderMatch(prev, inc)) {
      commitPrimaryWithCrossLayerSweep(mergeSelfReportedWithWearable(prev, inc), matchedKey);
      continue;
    }

    if (isFatStopwatchPairMatch(prev, inc)) {
      commitPrimaryWithCrossLayerSweep(mergeFatAndStopwatchRaceActivity(prev, inc), matchedKey);
      continue;
    }

    const prevIsStopwatch = isStopwatchSideForWearableFusion(prev);
    const incIsStopwatch = isStopwatchSideForWearableFusion(inc);

    if (prevIsStopwatch !== incIsStopwatch) {
      const wearableAct = prevIsStopwatch ? inc : prev;
      const stopwatchAct = prevIsStopwatch ? prev : inc;
      if (hasWearableDeviceProvenance(wearableAct)) {
        commitPrimaryWithCrossLayerSweep(
          mergeStopwatchAndWearableActivity(wearableAct, stopwatchAct),
          matchedKey
        );
        continue;
      }
    }

    const prevIntId = prev.intervalsId || (prev as { intervalsActivityId?: string }).intervalsActivityId;
    const canonicalId = prevIntId ? prev.id : incIntervalId ? inc.id : prev.id;

    const mergedBadges = Array.from(
      new Set([...(prev.sourceBadges || []), ...(inc.sourceBadges || [])])
    ) as ActivitySourceBadge[];

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
      name: isOfficialFatRaceActivity(prev)
        ? prev.name
        : isOfficialFatRaceActivity(inc)
          ? inc.name
          : inc.name || prev.name,
      officialRaceData: isOfficialFatRaceActivity(prev)
        ? prev.officialRaceData
        : inc.officialRaceData ?? prev.officialRaceData,
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
        (/Stopwatch$/i.test(prev.deviceName || '') ||
          (prev.deviceName || '').includes('Trackside Stopwatch')) &&
        !/Stopwatch$/i.test(inc.deviceName || '') &&
        !(inc.deviceName || '').includes('Trackside Stopwatch')
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

    commitPrimaryWithCrossLayerSweep(hydratedMerged, matchedKey);
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
