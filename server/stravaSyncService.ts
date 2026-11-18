import type { Request } from 'express';
import {
  runtimeStore,
  saveSessionCacheAsync,
  loadJsonFile,
  saveJsonFile,
  STRAVA_KUDOS_CACHE_FILE,
} from './sessionContext.ts';
import { buildServerAthleteProfile, isGenericName } from './physiologyEngine.ts';
import { decodeGooglePolyline } from './routers/activitiesRouter.ts';
import {
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
  isVirtualCyclingText,
} from '../src/physiology/stravaLoadCalibration.ts';

export { STRAVA_LOAD_MODEL_VERSION };
import {
  getEffectiveStravaClientConfig,
  ensureValidStravaAccessToken,
  resolveStravaAthleteIdentity,
  getStravaTokenRotationPayload,
  stravaIdentityByToken,
  type CachedStravaIdentity,
} from './routers/stravaRouter.ts';
import { extractStravaId, readStravaResponseJson } from './stravaIdUtils.ts';

export interface NormalizeStravaActivityCalibration {
  calibratedFtp: number;
  calibratedBikeLthr: number;
  calibratedRunLthr: number;
  calibratedThresholdPaceSecsPerKm: number;
  restingHr: number;
}

export function normalizeRawStravaActivity(
  a: Record<string, any>,
  calibration: NormalizeStravaActivityCalibration,
  options?: {
    detail?: Record<string, any>;
    idx?: number;
    kudosCacheEntry?: {
      kudosCount?: number;
      hasKudoed?: boolean;
      kudoers?: any[];
      comments?: any[];
    };
  }
) {
  const detail = options?.detail || a;
  const idx = options?.idx ?? 0;
  const cachedK = options?.kudosCacheEntry;
  const activityStravaId = extractStravaId(a) || extractStravaId(detail);

  const sportType = String(a.sport_type || a.type || '').trim();
  const actName = String(a.name || '');

  const rawStartLatLng: [number, number] | undefined =
    Array.isArray(a.start_latlng) && a.start_latlng.length === 2
      ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])]
      : undefined;
  const isWatopiaOrMakuriGps =
    rawStartLatLng &&
    Number.isFinite(rawStartLatLng[0]) &&
    Number.isFinite(rawStartLatLng[1]) &&
    rawStartLatLng[0] >= -12.6 &&
    rawStartLatLng[0] <= -9.8 &&
    rawStartLatLng[1] >= 164.8 &&
    rawStartLatLng[1] <= 168.0;

  const hasSummaryPolyline = Boolean(
    (detail.map?.summary_polyline || a.map?.summary_polyline || '').length > 4
  );
  const hasAnyGps = Boolean(hasSummaryPolyline || rawStartLatLng);

  const combinedStravaMeta = `${sportType} ${actName} ${a.device_name || ''} ${detail.device_name || ''}`;
  const isVirtualPlatform =
    isVirtualCyclingText(combinedStravaMeta) || Boolean(isWatopiaOrMakuriGps);

  const classified = classifyMultiSportActivity(sportType, actName, {
    trainer: Boolean(a.trainer),
    hasGps: hasAnyGps,
    isVirtualPlatform,
  });
  const sportCategory = classified.sportCategory;
  let subType = classified.subType;
  let environment = classified.environment;

  // Fallback check if combined device metadata reveals indoor virtual platform
  if (
    environment === 'OUTDOOR' &&
    (isVirtualPlatform ||
      /treadmill|trainer|zwift|peloton|wattbike|stages|erg mode|smart_trainer/i.test(
        combinedStravaMeta
      ))
  ) {
    environment = 'INDOOR';
    if (sportCategory === 'Cycling' && subType !== 'EBike') {
      subType = isVirtualPlatform ? 'Virtual Cycling' : 'Smart Trainer';
    } else if (sportCategory === 'Running') {
      subType = 'Treadmill';
    }
  }
  const isEBike = subType === 'EBike';
  const isIndoor = environment === 'INDOOR';

  const rawMoving = Number(a.moving_time || 0);
  const rawElapsed = Number(a.elapsed_time || 0);
  const movingTimeSecs = rawMoving > 0 ? rawMoving : Math.min(rawElapsed, 5400);
  const distanceMeters = Number(a.distance || 0);
  const elevationGainMeters = Math.round(Number(a.total_elevation_gain || 0));

  const supportsMeteredWatts =
    !isEBike &&
    (sportCategory === 'Cycling' ||
      subType === 'Rowing' ||
      subType === 'Nordic Ski' ||
      sportCategory === 'Running');
  const hasRealDeviceWatts =
    supportsMeteredWatts &&
    (a.device_watts === true || (Boolean(isVirtualPlatform) && a.device_watts !== false));
  const avgPower =
    hasRealDeviceWatts && a.average_watts ? Math.round(Number(a.average_watts)) : undefined;
  const normalizedPower =
    hasRealDeviceWatts && a.weighted_average_watts
      ? Math.round(Number(a.weighted_average_watts))
      : avgPower;
  const avgHr = Math.round(Number(a.average_heartrate || 0));
  const maxHr = Math.round(Number(a.max_heartrate || 0));
  const supportsPaceDisplay =
    sportCategory === 'Running' ||
    sportCategory === 'Swimming' ||
    subType === 'Hiking' ||
    subType === 'Walking' ||
    subType === 'Rowing' ||
    subType === 'Nordic Ski';
  const avgPaceSecsPerKm =
    supportsPaceDisplay && distanceMeters > 0 && movingTimeSecs > 0
      ? Math.round(movingTimeSecs / (distanceMeters / 1000))
      : undefined;

  const loadResult = computeStravaActivityLoadV2({
    sportCategory,
    rawSportType: sportType,
    name: actName,
    environment: isIndoor ? 'INDOOR' : 'OUTDOOR',
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters,
    normalizedPower,
    avgPower,
    hasRealDeviceWatts,
    avgHr,
    maxHr,
    avgPaceSecsPerKm,
    sufferScore: Number(a.suffer_score || 0),
    calibratedFtp: calibration.calibratedFtp,
    calibratedBikeLthr: calibration.calibratedBikeLthr,
    calibratedRunLthr: calibration.calibratedRunLthr,
    calibratedThresholdPaceSecsPerKm: calibration.calibratedThresholdPaceSecsPerKm,
    restingHr: calibration.restingHr,
  });

  let efficiencyFactor = 0;
  if (hasRealDeviceWatts && normalizedPower && avgHr > 0) {
    efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
  } else if (
    sportCategory === 'Running' &&
    distanceMeters > 0 &&
    movingTimeSecs > 0 &&
    avgHr > 0
  ) {
    const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
    efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
  }

  const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
  const segmentEfforts = rawEfforts.slice(0, 40).map((se: Record<string, any>) => {
    const dist = Math.round(Number(se.distance || se.segment?.distance || 0));
    const elTime = Number(se.elapsed_time || 0);
    const effortId = extractStravaId(se);
    const segId = extractStravaId(se.segment) || effortId;
    return {
      id: effortId,
      segmentId: segId,
      name: String(se.name || se.segment?.name || 'Segment'),
      sportCategory: sportCategory === 'Running' ? ('Running' as const) : ('Cycling' as const),
      distanceMeters: dist,
      averageGradePct: Number(se.segment?.average_grade ?? 0),
      elapsedTimeSecs: elTime,
      movingTimeSecs: Number(se.moving_time || elTime),
      avgWatts:
        hasRealDeviceWatts && se.average_watts ? Math.round(Number(se.average_watts)) : undefined,
      avgPaceSecsPerKm:
        sportCategory === 'Running' && dist > 0 && elTime > 0
          ? Math.round(elTime / (dist / 1000))
          : undefined,
      avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : undefined,
      prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
      komRank: typeof se.kom_rank === 'number' ? se.kom_rank : null,
      startDateLocal: String(se.start_date_local || a.start_date_local),
      activityId: activityStravaId,
      activityName: String(a.name),
      startIndex: typeof se.start_index === 'number' ? se.start_index : undefined,
      endIndex: typeof se.end_index === 'number' ? se.end_index : undefined,
    };
  });

  const summaryPolyline: string | undefined =
    detail.map?.summary_polyline || a.map?.summary_polyline || undefined;
  const decodedRoute = summaryPolyline ? decodeGooglePolyline(summaryPolyline) : undefined;
  const startLatLng: [number, number] | undefined =
    Array.isArray(a.start_latlng) && a.start_latlng.length === 2
      ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])]
      : decodedRoute && decodedRoute.length > 0
        ? decodedRoute[0]
        : undefined;
  const endLatLng: [number, number] | undefined =
    Array.isArray(a.end_latlng) && a.end_latlng.length === 2
      ? [Number(a.end_latlng[0]), Number(a.end_latlng[1])]
      : decodedRoute && decodedRoute.length > 0
        ? decodedRoute[decodedRoute.length - 1]
        : undefined;

  return {
    stravaId: activityStravaId,
    startDateLocal: String(a.start_date_local || '').replace(/Z$/i, ''),
    name: String(a.name || sportType || sportCategory),
    sportCategory,
    rawSportType: sportType || undefined,
    environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
    subType,
    distanceMeters,
    movingTimeSecs,
    elevationGainMeters,
    avgPower,
    normalizedPower,
    deviceWatts: hasRealDeviceWatts,
    intensityFactor: loadResult.intensityFactor,
    trainingLoad: loadResult.trainingLoad,
    loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
    avgHr,
    maxHr,
    avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
    avgPaceSecsPerKm,
    efficiencyFactor,
    gearName: detail.gear?.name || undefined,
    stravaPrCount: Number(a.pr_count || 0),
    kudosCount: cachedK?.kudosCount ?? Number(a.kudos_count || 0),
    commentCount: cachedK?.comments?.length ?? Number(a.comment_count || 0),
    achievementCount: Number(a.achievement_count || 0),
    athleteCount: Number(a.athlete_count || 1),
    hasKudoed: cachedK?.hasKudoed ?? Boolean(a.has_kudoed),
    kudoers: cachedK?.kudoers,
    comments: cachedK?.comments,
    summaryPolyline,
    routeLatLngs:
      idx < 25 && decodedRoute && decodedRoute.length >= 2 ? decodedRoute : undefined,
    startLatLng,
    endLatLng,
    segmentEfforts,
  };
}

export async function syncStravaAllHistory(
  req?: Request,
  forceFull = false,
  deltaOnly = false,
  explicitWindow?: string,
  clientAfterEpoch = 0,
  beforeEpoch = 0
) {
  let activeAccessToken = await ensureValidStravaAccessToken(req, false);

  if (!activeAccessToken) {
    throw new Error('Strava is not connected via OAuth yet.');
  }

  const validWindows = new Set(['90d', '180d', '365d', 'all', 'none']);
  const effectiveWindow = (
    explicitWindow && validWindows.has(explicitWindow)
      ? explicitWindow
      : forceFull || beforeEpoch > 0
        ? 'all'
        : runtimeStore.stravaSyncPolicy?.window || '90d'
  ) as '90d' | '180d' | '365d' | 'all' | 'none';
  const importProfileAndGear = runtimeStore.stravaSyncPolicy?.importProfileAndGear !== false;

  // Identity-only mode: respect user choice NOT to pull Strava workout history
  if (effectiveWindow === 'none') {
    const identity = await resolveStravaAthleteIdentity(req);
    return {
      athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || undefined,
      athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || undefined,
      gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
      activities: [],
      starredSegments: [],
      syncPaused: true,
      syncWindow: 'none' as const,
      hasMoreHistory: false,
      nextBeforeEpoch: null,
      rateLimitPaused: false,
      stravaTokens: getStravaTokenRotationPayload(req),
    };
  }

  // Pre-check OAuth scope when user signed in with Strava but unchecked 'View data about your activities'
  const grantedScope = String(runtimeStore.stravaGrantedScope || '').trim();
  if (grantedScope && !grantedScope.includes('activity:read')) {
    const identity = await resolveStravaAthleteIdentity(req);
    return {
      athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || undefined,
      athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || undefined,
      gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
      activities: [],
      starredSegments: [],
      missingActivityScope: true,
      hasMoreHistory: false,
      nextBeforeEpoch: null,
      rateLimitPaused: false,
      stravaTokens: getStravaTokenRotationPayload(req),
    };
  }

  const windowDays =
    effectiveWindow === '90d'
      ? 90
      : effectiveWindow === '180d'
        ? 180
        : effectiveWindow === '365d'
          ? 365
          : 0;
  const afterEpoch =
    windowDays > 0 && beforeEpoch === 0
      ? Math.floor((Date.now() - windowDays * 86400 * 1000) / 1000)
      : 0;
  const effectiveAfterEpoch =
    !forceFull && beforeEpoch === 0 && deltaOnly && clientAfterEpoch > 0
      ? Math.max(afterEpoch, Math.floor(clientAfterEpoch))
      : afterEpoch;
  const afterQuery = effectiveAfterEpoch > 0 ? `&after=${effectiveAfterEpoch}` : '';
  const beforeQuery = beforeEpoch > 0 ? `&before=${Math.floor(beforeEpoch)}` : '';
  const cursorQuery = `${afterQuery}${beforeQuery}`;

  let headers = { Authorization: `Bearer ${activeAccessToken}` };
  let rawActivitiesMap = new Map<string, Record<string, any>>();
  const fetchedThisCallMap = new Map<string, Record<string, any>>();
  let scopedArchiveFile = '';
  let rateLimitPaused = false;
  let reachedNaturalEnd = false;
  let oldestFetchedEpoch = 0;

  const trackFetchedItem = (item: Record<string, any>) => {
    const itemId = extractStravaId(item);
    if (!item || !itemId) return;
    rawActivitiesMap.set(itemId, item);
    fetchedThisCallMap.set(itemId, item);
    const epoch = Math.floor(new Date(item.start_date || item.start_date_local || 0).getTime() / 1000);
    if (Number.isFinite(epoch) && epoch > 0 && (oldestFetchedEpoch === 0 || epoch < oldestFetchedEpoch)) {
      oldestFetchedEpoch = epoch;
    }
  };

  // Probe page 1 first so if the token was stale after a Vercel cold start, we immediately refresh once and retry
  let firstPageResp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${cursorQuery}`,
    { headers }
  );
  const { refreshToken: callerRefreshToken } = getEffectiveStravaClientConfig(req);
  if (firstPageResp.status === 401 && callerRefreshToken) {
    activeAccessToken = await ensureValidStravaAccessToken(req, true);
    headers = { Authorization: `Bearer ${activeAccessToken}` };
    firstPageResp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${cursorQuery}`,
      { headers }
    );
  }

  if (!firstPageResp.ok) {
    if (firstPageResp.status === 401 || firstPageResp.status === 403) {
      const errText = await firstPageResp.text();
      if (errText.includes('activity:read_permission')) {
        // Keep Strava identity tokens intact — user signed in with Strava but unchecked activity read scope
        runtimeStore.stravaGrantedScope = 'read';
        await saveSessionCacheAsync(req);
        const identity = await resolveStravaAthleteIdentity(req);
        return {
          athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || undefined,
          athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || undefined,
          gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
          activities: [],
          starredSegments: [],
          missingActivityScope: true,
          hasMoreHistory: false,
          nextBeforeEpoch: null,
          rateLimitPaused: false,
          stravaTokens: getStravaTokenRotationPayload(req),
        };
      }
      throw new Error(
        'Strava session expired or invalid. Reconnect Strava to refresh your session.'
      );
    }
  } else {
    const firstPageItems = await readStravaResponseJson<Record<string, any>[]>(firstPageResp);
    if (Array.isArray(firstPageItems)) {
      const stravaAthleteId = (
        extractStravaId(firstPageItems[0]?.athlete) ||
        runtimeStore.stravaAthleteId ||
        ''
      ).replace(/[^0-9]/g, '');
      if (stravaAthleteId) {
        scopedArchiveFile = `/tmp/aeropulse-strava-archive-${stravaAthleteId}.json`;
        const cachedArchive = loadJsonFile<Record<string, any>[]>(scopedArchiveFile, []);
        for (const item of cachedArchive) {
          const itemId = extractStravaId(item);
          if (!item || !itemId) continue;
          if (afterEpoch > 0 && beforeEpoch === 0) {
            const itemEpoch = Math.floor(
              new Date(item.start_date || item.start_date_local || 0).getTime() / 1000
            );
            if (itemEpoch > 0 && itemEpoch < afterEpoch) continue;
          }
          rawActivitiesMap.set(itemId, item);
        }
      }
      for (const item of firstPageItems) {
        trackFetchedItem(item);
      }
      if (firstPageItems.length < 200) {
        reachedNaturalEnd = true;
      }

      const shouldPaginateAll = forceFull || beforeEpoch > 0 || !deltaOnly;
      // Guard Strava 15m/daily rate limits using response headers while allowing multi-thousand archive pulls
      const isStravaRateLimited = (resp: globalThis.Response): boolean => {
        const usage = resp.headers.get('x-ratelimit-usage') || '';
        const limit = resp.headers.get('x-ratelimit-limit') || '';
        const [shortUsage = 0, dailyUsage = 0] = usage.split(',').map(Number);
        const [shortLimit = 100, dailyLimit = 1000] = limit.split(',').map((n) => Number(n) || 0);
        const effectiveShortCap = shortLimit > 0 ? Math.max(40, shortLimit - 15) : 85;
        const effectiveDailyCap = dailyLimit > 0 ? Math.max(200, dailyLimit - 25) : 975;
        return shortUsage >= effectiveShortCap || dailyUsage >= effectiveDailyCap;
      };
      if (isStravaRateLimited(firstPageResp)) {
        rateLimitPaused = true;
      }

      const maxPageToFetch =
        effectiveWindow === 'all'
          ? 20
          : effectiveWindow === '365d'
            ? 8
            : effectiveWindow === '180d'
              ? 5
              : 3;

      if (shouldPaginateAll && !reachedNaturalEnd && !rateLimitPaused) {
        for (let page = 2; page <= maxPageToFetch; page += 2) {
          const pages = page + 1 <= maxPageToFetch ? [page, page + 1] : [page];
          const batchResps = await Promise.all(
            pages.map((p) =>
              fetch(
                `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${p}${cursorQuery}`,
                { headers }
              )
            )
          );
          let stopLoop = false;
          for (const r of batchResps) {
            if (!r.ok) {
              if (r.status === 429) rateLimitPaused = true;
              stopLoop = true;
              break;
            }
            const pageItems = await readStravaResponseJson<Record<string, any>[]>(r);
            if (!Array.isArray(pageItems) || pageItems.length === 0) {
              reachedNaturalEnd = true;
              stopLoop = true;
              break;
            }
            for (const item of pageItems) {
              trackFetchedItem(item);
            }
            if (pageItems.length < 200) {
              reachedNaturalEnd = true;
              stopLoop = true;
              break;
            }
            if (isStravaRateLimited(r)) {
              rateLimitPaused = true;
              stopLoop = true;
              break;
            }
          }
          if (stopLoop) break;
        }
      }
    }
  }

  const allArchiveList = Array.from(rawActivitiesMap.values()).sort(
    (a, b) =>
      new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  );
  if (allArchiveList.length > 0 && scopedArchiveFile) {
    saveJsonFile(scopedArchiveFile, allArchiveList);
  }
  const activitiesList =
    beforeEpoch > 0
      ? Array.from(fetchedThisCallMap.values()).sort(
          (a, b) =>
            new Date(b.start_date_local || 0).getTime() -
            new Date(a.start_date_local || 0).getTime()
        )
      : allArchiveList;

  const hasMoreHistory =
    !deltaOnly &&
    effectiveWindow === 'all' &&
    !reachedNaturalEnd &&
    oldestFetchedEpoch > 0 &&
    (fetchedThisCallMap.size >= 200 || rateLimitPaused);
  const nextBeforeEpoch = hasMoreHistory ? oldestFetchedEpoch + 1 : null;

  const isCursorContinuation = beforeEpoch > 0;
  const [starredResp, stravaProfileResp, stravaZonesResp] = isCursorContinuation
    ? [null, null, null]
    : await Promise.all([
        firstPageResp.ok
          ? fetch('https://www.strava.com/api/v3/segments/starred?per_page=15', { headers })
          : Promise.resolve(null),
        fetch('https://www.strava.com/api/v3/athlete', { headers }),
        importProfileAndGear
          ? fetch('https://www.strava.com/api/v3/athlete/zones', { headers })
          : Promise.resolve(null),
      ]);
  const starredSegments =
    starredResp && starredResp.ok
      ? await readStravaResponseJson<Record<string, any>[]>(starredResp)
      : [];
  const stravaZonesData =
    stravaZonesResp && stravaZonesResp.ok
      ? await readStravaResponseJson<Record<string, any>>(stravaZonesResp)
      : null;

  let stravaAthleteName = '';
  let stravaAthleteId = '';
  let stravaFtp: number | undefined;
  let stravaWeightKg: number | undefined;
  let stravaMeasurementPreference: 'mi' | 'km' | undefined;
  let stravaGearItems: any[] = [];
  if (stravaProfileResp && stravaProfileResp.ok) {
    const rawAthlete = await readStravaResponseJson<Record<string, any>>(stravaProfileResp);
    stravaAthleteId = extractStravaId(rawAthlete);
    stravaAthleteName =
      [rawAthlete.firstname, rawAthlete.lastname].filter(Boolean).join(' ').trim() ||
      String(rawAthlete.username || '').trim();
    if (importProfileAndGear) {
      if (Number(rawAthlete.ftp) > 80) stravaFtp = Math.round(Number(rawAthlete.ftp));
      if (Number(rawAthlete.weight) > 30) stravaWeightKg = Number(rawAthlete.weight);
    }
    if (rawAthlete.measurement_preference === 'meters') stravaMeasurementPreference = 'km';
    else if (rawAthlete.measurement_preference === 'feet') stravaMeasurementPreference = 'mi';

    if (stravaAthleteName && !isGenericName(stravaAthleteName)) {
      runtimeStore.stravaAthleteId = stravaAthleteId || runtimeStore.stravaAthleteId;
      runtimeStore.stravaAthleteName = stravaAthleteName;
      if (stravaMeasurementPreference) {
        runtimeStore.stravaMeasurementPreference = stravaMeasurementPreference;
      }
      const { refreshToken, accessToken } = getEffectiveStravaClientConfig(req);
      const entry: CachedStravaIdentity = {
        athleteId: stravaAthleteId,
        athleteName: stravaAthleteName,
        ftp: stravaFtp,
        weightKg: stravaWeightKg,
        measurementPreference: stravaMeasurementPreference,
      };
      if (refreshToken) stravaIdentityByToken.set(refreshToken, entry);
      if (accessToken) stravaIdentityByToken.set(accessToken, entry);
      stravaIdentityByToken.set(activeAccessToken, entry);
      await saveSessionCacheAsync(req);
    }
    if (importProfileAndGear) {
      const bikes = Array.isArray(rawAthlete.bikes)
        ? rawAthlete.bikes.map((b: any) => ({
            id: extractStravaId(b),
            name: String(b.name || 'Road Bike'),
            type: 'BIKE' as const,
            distanceMeters: Number(b.distance || 0),
            maxRecommendedMeters: 8046720,
            primary: Boolean(b.primary),
          }))
        : [];
      const shoes = Array.isArray(rawAthlete.shoes)
        ? rawAthlete.shoes.map((s: any) => ({
            id: extractStravaId(s),
            name: String(s.name || 'Running Shoe'),
            type: 'SHOE' as const,
            distanceMeters: Number(s.distance || 0),
            maxRecommendedMeters: 724205,
            primary: Boolean(s.primary),
          }))
        : [];
      stravaGearItems = [...bikes, ...shoes];
      runtimeStore.gearItems = stravaGearItems;
    }
  }

  // Pass 1: Derive athlete's actual cycling & running thresholds BEFORE computing workout TSS / EF
  const prelimAthleteProfile = buildServerAthleteProfile(
    {
      id: stravaAthleteId || runtimeStore.stravaAthleteId || '0',
      name: stravaAthleteName || runtimeStore.stravaAthleteName || undefined,
      ftp: stravaFtp,
      weightKg: stravaWeightKg,
      stravaZones: stravaZonesData,
      source: 'STRAVA_OAUTH',
    },
    null,
    activitiesList
  );
  const calibratedFtp = Math.max(120, prelimAthleteProfile.ftp || stravaFtp || 250);
  const calibratedBikeLthr = Math.max(135, prelimAthleteProfile.lthr || 163);
  const calibratedRunLthr = Math.max(140, prelimAthleteProfile.runLthr || 168);
  const calibratedThresholdPaceSecsPerKm = Math.max(
    155,
    prelimAthleteProfile.thresholdPaceSecsPerKm || 255
  );
  const calibratedRestingHr = Math.max(38, Math.min(78, prelimAthleteProfile.restingHr || 54));

  // Fetch detailed activity payloads for at most top 2 recent activities to conserve Strava quota (skip on cursor backfill passes)
  const topIds = isCursorContinuation
    ? []
    : activitiesList
        .slice(0, 2)
        .map((a) => extractStravaId(a))
        .filter(Boolean);
  const detailedPayloads =
    topIds.length > 0
      ? await Promise.all(
          topIds.map(async (id) => {
            const dResp = await fetch(
              `https://www.strava.com/api/v3/activities/${encodeURIComponent(id)}?include_all_efforts=true`,
              { headers }
            );
            return dResp.ok ? await readStravaResponseJson<Record<string, any>>(dResp) : null;
          })
        )
      : [];
  const detailById = new Map<string, Record<string, any>>();
  for (const d of detailedPayloads) {
    const did = extractStravaId(d);
    if (d && did) detailById.set(did, d);
  }

  // Hydrate Strava kudoers for top recent activities with kudos_count > 0
  const kudosCache = loadJsonFile<
    Record<
      string,
      {
        kudosCount?: number;
        hasKudoed?: boolean;
        kudoers?: any[];
        comments?: any[];
      }
    >
  >(STRAVA_KUDOS_CACHE_FILE, {});

  const recentKudoCandidates = isCursorContinuation
    ? []
    : activitiesList
        .filter((a) => {
          const aid = extractStravaId(a);
          return Boolean(aid && Number(a.kudos_count || 0) > 0 && !kudosCache[aid]?.kudoers);
        })
        .slice(0, 2);

  if (recentKudoCandidates.length > 0) {
    await Promise.all(
      recentKudoCandidates.map(async (act) => {
        const sid = extractStravaId(act);
        try {
          const [kResp, cResp] = await Promise.all([
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/kudos?per_page=50`, {
              headers,
            }),
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/comments?per_page=30`, {
              headers,
            }),
          ]);
          const kudoers = kResp.ok
            ? ((await readStravaResponseJson<any[]>(kResp)) || []).map((k: any) => ({
                firstname: String(k.firstname || 'Athlete'),
                lastname: String(k.lastname || ''),
                profileMedium: k.profile_medium || k.profile || undefined,
                city: k.city || undefined,
                state: k.state || undefined,
                country: k.country || undefined,
              }))
            : [];
          const comments = cResp.ok
            ? ((await readStravaResponseJson<any[]>(cResp)) || []).map((c: any, idx: number) => ({
                id: extractStravaId(c) || `sc-${sid}-${idx}`,
                text: String(c.text || ''),
                createdAt: String(c.created_at || act.start_date_local || ''),
                athleteName:
                  [c.athlete?.firstname, c.athlete?.lastname].filter(Boolean).join(' ') ||
                  'Strava Athlete',
                avatarUrl: c.athlete?.profile_medium || undefined,
              }))
            : [];
          kudosCache[sid] = {
            ...kudosCache[sid],
            kudosCount: Math.max(Number(act.kudos_count || 0), kudoers.length),
            kudoers,
            comments: [...(kudosCache[sid]?.comments || []), ...comments],
          };
        } catch {
          // ignore transient kudos fetch error
        }
      })
    );
    saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);
  }

  // Pass 2: Normalize workouts using calibrated athlete FTP, sport-specific LTHR, and physiological v2 load
  const normalizedStravaActivities = activitiesList.map((a, idx) => {
    const aid = extractStravaId(a);
    return normalizeRawStravaActivity(
      a,
      {
        calibratedFtp,
        calibratedBikeLthr,
        calibratedRunLthr,
        calibratedThresholdPaceSecsPerKm,
        restingHr: calibratedRestingHr,
      },
      {
        detail: detailById.get(aid) || a,
        idx,
        kudosCacheEntry: kudosCache[aid],
      }
    );
  });

  const stravaAthleteProfile = buildServerAthleteProfile(
    {
      id: stravaAthleteId || runtimeStore.stravaAthleteId || '0',
      name: stravaAthleteName || runtimeStore.stravaAthleteName || undefined,
      ftp: stravaFtp,
      weightKg: stravaWeightKg,
      stravaZones: stravaZonesData,
      source: 'STRAVA_OAUTH',
    },
    null,
    normalizedStravaActivities
  );

  return {
    athleteId: stravaAthleteId || runtimeStore.stravaAthleteId || undefined,
    athleteName: stravaAthleteProfile.name !== 'Athlete' ? stravaAthleteProfile.name : undefined,
    measurementPreference:
      stravaMeasurementPreference || runtimeStore.stravaMeasurementPreference || undefined,
    syncWindow: effectiveWindow,
    hasMoreHistory,
    nextBeforeEpoch,
    rateLimitPaused,
    athleteProfile:
      !isCursorContinuation && importProfileAndGear
        ? {
            ...stravaAthleteProfile,
            gearItems: stravaGearItems,
          }
        : undefined,
    gearItems: isCursorContinuation ? [] : stravaGearItems,
    activities: normalizedStravaActivities,
    stravaTokens: getStravaTokenRotationPayload(req),
    starredSegments: starredSegments.map((s) => ({
      segmentId: String(s.id),
      name: String(s.name),
      sportCategory: /run/i.test(String(s.activity_type || '')) ? 'Running' : 'Cycling',
      distanceMeters: Math.round(Number(s.distance || 0)),
      averageGradePct: Number(s.average_grade || 0),
      location: [s.city, s.state].filter(Boolean).join(', ') || 'Starred Segment',
      prElapsedTimeSecs: Number(s.athlete_pr_effort?.elapsed_time || 0),
    })),
  };
}
