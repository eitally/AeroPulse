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
  computeStravaActivityLoadV2,
  isEBikeActivityText,
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

  const sportType = String(a.sport_type || a.type || '').trim();
  const actName = String(a.name || '');
  const isEBike = isEBikeActivityText(sportType, actName);
  const explicitNonCycleType =
    /walk|hike|yoga|golf|pilates|weighttraining|run|trailrun|virtualrun|swim|alpineski|backcountryski|nordicski|snowshoe|standuppaddling|kayak|canoeing|rowing|stretch|mobility|meditation|breathwork|surfing|sailing/i.test(
      sportType
    );

  let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' = 'Strength';
  if (
    !explicitNonCycleType &&
    (/ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|peloton|zwift/i.test(
      sportType + ' ' + actName
    ) ||
      isEBike)
  ) {
    sportCategory = 'Cycling';
  } else if (/run|trailrun|virtualrun|treadmill/i.test(sportType)) {
    sportCategory = 'Running';
  } else if (/swim|openwater/i.test(sportType)) {
    sportCategory = 'Swimming';
  } else {
    sportCategory = 'Strength';
  }

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
  const isStationaryZeroGpsCycling =
    sportCategory === 'Cycling' && !hasSummaryPolyline && !rawStartLatLng;

  const combinedStravaMeta = `${sportType} ${actName} ${a.device_name || ''} ${detail.device_name || ''}`;
  const isVirtualPlatform =
    isVirtualCyclingText(combinedStravaMeta) || Boolean(isWatopiaOrMakuriGps);

  const isIndoor =
    Boolean(a.trainer) ||
    Boolean(isVirtualPlatform) ||
    Boolean(isStationaryZeroGpsCycling) ||
    /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga/i.test(
      combinedStravaMeta
    );

  let subType:
    | 'Road'
    | 'Trail'
    | 'Gravel'
    | 'Virtual Cycling'
    | 'Smart Trainer'
    | 'Treadmill'
    | 'Pool'
    | 'Open Water'
    | 'Gym' = 'Road';
  if (sportCategory === 'Cycling') {
    if (isVirtualPlatform) subType = 'Virtual Cycling';
    else if (isIndoor) subType = 'Smart Trainer';
    else if (/gravel/i.test(combinedStravaMeta)) subType = 'Gravel';
    else if (/mountain|mtb|trail/i.test(combinedStravaMeta)) subType = 'Trail';
    else subType = 'Road';
  } else if (sportCategory === 'Running') {
    if (isIndoor) subType = 'Treadmill';
    else if (/trail/i.test(combinedStravaMeta)) subType = 'Trail';
    else subType = 'Road';
  } else if (sportCategory === 'Swimming') {
    subType = 'Pool';
  } else {
    subType = 'Gym';
  }

  const rawMoving = Number(a.moving_time || 0);
  const rawElapsed = Number(a.elapsed_time || 0);
  const movingTimeSecs = rawMoving > 0 ? rawMoving : Math.min(rawElapsed, 5400);
  const distanceMeters = Number(a.distance || 0);
  const elevationGainMeters = Math.round(Number(a.total_elevation_gain || 0));

  const hasRealDeviceWatts =
    !isEBike && (a.device_watts === true || (Boolean(isVirtualPlatform) && a.device_watts !== false));
  const avgPower =
    hasRealDeviceWatts && a.average_watts ? Math.round(Number(a.average_watts)) : undefined;
  const normalizedPower =
    hasRealDeviceWatts && a.weighted_average_watts
      ? Math.round(Number(a.weighted_average_watts))
      : avgPower;
  const avgHr = Math.round(Number(a.average_heartrate || 0));
  const maxHr = Math.round(Number(a.max_heartrate || 0));
  const avgPaceSecsPerKm =
    sportCategory === 'Running' && distanceMeters > 0 && movingTimeSecs > 0
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
    return {
      id: String(se.id),
      segmentId: String(se.segment?.id || se.id),
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
      activityId: String(a.id),
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
    stravaId: String(a.id),
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
  clientAfterEpoch = 0
) {
  let activeAccessToken = await ensureValidStravaAccessToken(req, false);

  if (!activeAccessToken) {
    throw new Error('Strava is not connected via OAuth yet.');
  }

  const validWindows = new Set(['90d', '180d', '365d', 'all', 'none']);
  const effectiveWindow = (
    explicitWindow && validWindows.has(explicitWindow)
      ? explicitWindow
      : forceFull
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
    windowDays > 0 ? Math.floor((Date.now() - windowDays * 86400 * 1000) / 1000) : 0;
  const effectiveAfterEpoch =
    !forceFull && deltaOnly && clientAfterEpoch > 0
      ? Math.max(afterEpoch, Math.floor(clientAfterEpoch))
      : afterEpoch;
  const afterQuery = effectiveAfterEpoch > 0 ? `&after=${effectiveAfterEpoch}` : '';

  let headers = { Authorization: `Bearer ${activeAccessToken}` };
  let rawActivitiesMap = new Map<string, Record<string, any>>();
  let scopedArchiveFile = '';

  // Probe page 1 first so if the token was stale after a Vercel cold start, we immediately refresh once and retry
  let firstPageResp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${afterQuery}`,
    { headers }
  );
  const { refreshToken: callerRefreshToken } = getEffectiveStravaClientConfig(req);
  if (firstPageResp.status === 401 && callerRefreshToken) {
    activeAccessToken = await ensureValidStravaAccessToken(req, true);
    headers = { Authorization: `Bearer ${activeAccessToken}` };
    firstPageResp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${afterQuery}`,
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
          stravaTokens: getStravaTokenRotationPayload(req),
        };
      }
      throw new Error(
        'Strava session expired or invalid. Reconnect Strava to refresh your session.'
      );
    }
  } else {
    const firstPageItems = (await firstPageResp.json()) as Record<string, any>[];
    if (Array.isArray(firstPageItems)) {
      const stravaAthleteId = String(
        firstPageItems[0]?.athlete?.id || runtimeStore.stravaAthleteId || ''
      ).replace(/[^0-9]/g, '');
      if (stravaAthleteId) {
        scopedArchiveFile = `/tmp/aeropulse-strava-archive-${stravaAthleteId}.json`;
        const cachedArchive = loadJsonFile<Record<string, any>[]>(scopedArchiveFile, []);
        for (const item of cachedArchive) {
          if (!item || !item.id) continue;
          if (afterEpoch > 0) {
            const itemEpoch = Math.floor(
              new Date(item.start_date || item.start_date_local || 0).getTime() / 1000
            );
            if (itemEpoch > 0 && itemEpoch < afterEpoch) continue;
          }
          rawActivitiesMap.set(String(item.id), item);
        }
      }
      const existingCachedCount = rawActivitiesMap.size;
      for (const item of firstPageItems) {
        if (item && item.id) rawActivitiesMap.set(String(item.id), item);
      }
      const shouldPaginateAll = forceFull || (!deltaOnly && existingCachedCount <= 200);
      // Guard Strava global 100 req / 15m quota: cap cold-start pagination and inspect X-RateLimit-Usage
      const isStravaRateLimited = (resp: globalThis.Response): boolean => {
        const usage = resp.headers.get('x-ratelimit-usage') || '';
        const shortWindow = Number(usage.split(',')[0] || 0);
        return shortWindow >= 80;
      };
      const maxPageToFetch = effectiveWindow === 'all' ? 10 : 3;
      if (
        shouldPaginateAll &&
        firstPageItems.length === 200 &&
        !isStravaRateLimited(firstPageResp)
      ) {
        for (let page = 2; page <= maxPageToFetch; page += 2) {
          const pages = page + 1 <= maxPageToFetch ? [page, page + 1] : [page];
          const batchResps = await Promise.all(
            pages.map((p) =>
              fetch(
                `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${p}${afterQuery}`,
                { headers }
              )
            )
          );
          let reachedEnd = false;
          for (const r of batchResps) {
            if (!r.ok || isStravaRateLimited(r)) {
              reachedEnd = true;
              break;
            }
            const pageItems = (await r.json()) as Record<string, any>[];
            if (!Array.isArray(pageItems) || pageItems.length === 0) {
              reachedEnd = true;
            } else {
              for (const item of pageItems) {
                if (item && item.id) rawActivitiesMap.set(String(item.id), item);
              }
              if (pageItems.length < 200) reachedEnd = true;
            }
          }
          if (reachedEnd) break;
        }
      }
    }
  }

  const activitiesList = Array.from(rawActivitiesMap.values()).sort(
    (a, b) =>
      new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  );
  if (activitiesList.length > 0 && scopedArchiveFile) {
    saveJsonFile(scopedArchiveFile, activitiesList);
  }

  const [starredResp, stravaProfileResp, stravaZonesResp] = await Promise.all([
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
      ? ((await starredResp.json()) as Record<string, any>[])
      : [];
  const stravaZonesData =
    stravaZonesResp && stravaZonesResp.ok
      ? ((await stravaZonesResp.json()) as Record<string, any>)
      : null;

  let stravaAthleteName = '';
  let stravaAthleteId = '';
  let stravaFtp: number | undefined;
  let stravaWeightKg: number | undefined;
  let stravaMeasurementPreference: 'mi' | 'km' | undefined;
  let stravaGearItems: any[] = [];
  if (stravaProfileResp && stravaProfileResp.ok) {
    const rawAthlete = (await stravaProfileResp.json()) as Record<string, any>;
    stravaAthleteId = String(rawAthlete.id || '');
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
            id: String(b.id),
            name: String(b.name || 'Road Bike'),
            type: 'BIKE' as const,
            distanceMeters: Number(b.distance || 0),
            maxRecommendedMeters: 8046720,
            primary: Boolean(b.primary),
          }))
        : [];
      const shoes = Array.isArray(rawAthlete.shoes)
        ? rawAthlete.shoes.map((s: any) => ({
            id: String(s.id),
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

  // Fetch detailed activity payloads for at most top 2 recent activities to conserve Strava quota
  const topIds = activitiesList.slice(0, 2).map((a) => a.id);
  const detailedPayloads = await Promise.all(
    topIds.map(async (id) => {
      const dResp = await fetch(
        `https://www.strava.com/api/v3/activities/${id}?include_all_efforts=true`,
        { headers }
      );
      return dResp.ok ? ((await dResp.json()) as Record<string, any>) : null;
    })
  );
  const detailById = new Map<number, Record<string, any>>();
  for (const d of detailedPayloads) {
    if (d && d.id) detailById.set(Number(d.id), d);
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

  const recentKudoCandidates = activitiesList
    .filter((a) => a && a.id && Number(a.kudos_count || 0) > 0 && !kudosCache[String(a.id)]?.kudoers)
    .slice(0, 2);

  if (recentKudoCandidates.length > 0) {
    await Promise.all(
      recentKudoCandidates.map(async (act) => {
        const sid = String(act.id);
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
            ? (((await kResp.json()) as any[]) || []).map((k: any) => ({
                firstname: String(k.firstname || 'Athlete'),
                lastname: String(k.lastname || ''),
                profileMedium: k.profile_medium || k.profile || undefined,
                city: k.city || undefined,
                state: k.state || undefined,
                country: k.country || undefined,
              }))
            : [];
          const comments = cResp.ok
            ? (((await cResp.json()) as any[]) || []).map((c: any, idx: number) => ({
                id: String(c.id || `sc-${sid}-${idx}`),
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
  const normalizedStravaActivities = activitiesList.map((a, idx) =>
    normalizeRawStravaActivity(
      a,
      {
        calibratedFtp,
        calibratedBikeLthr,
        calibratedRunLthr,
        calibratedThresholdPaceSecsPerKm,
        restingHr: calibratedRestingHr,
      },
      {
        detail: detailById.get(Number(a.id)) || a,
        idx,
        kudosCacheEntry: kudosCache[String(a.id)],
      }
    )
  );

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
    athleteProfile: importProfileAndGear
      ? {
          ...stravaAthleteProfile,
          gearItems: stravaGearItems,
        }
      : undefined,
    gearItems: stravaGearItems,
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
