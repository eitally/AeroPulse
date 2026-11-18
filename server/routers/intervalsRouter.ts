import express, { type Request, type Response } from 'express';
import {
  requestContext,
  runtimeStore,
  getScopedRuntimeStore,
  bindRequestScopeKey,
  isAuthenticatedRequest,
  getVerifiedSessionClaims,
  decodeAndVerifyToken,
  setSessionCookie,
  issueOAuthStateToken,
  verifyOAuthStateToken,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  safeJsonForScript,
  escapeHtml,
  saveSessionCache,
  saveSessionCacheAsync,
  loadJsonFile,
  saveJsonFile,
  getScopedPlannedEventsFile,
  getActiveGarminSession,
  getGarminScopeKey,
  GARMIN_SESSION_DIR,
  ROUTES_BY_ACTIVITY_CACHE_FILE,
  SEGMENTS_BY_ACTIVITY_CACHE_FILE,
  STRAVA_KUDOS_CACHE_FILE,
} from '../sessionContext.ts';
import {
  buildServerAthleteProfile,
  parseWorkoutSyntaxToSteps,
  isGenericName,
} from '../physiologyEngine.ts';
import {
  ensureRequestSessionSid,
  renderThreshOAuthHtml,
  resolveIntervalsCallbackUrl,
} from '../oauthHelpers.ts';
import {
  loadAthleteCloudState,
  saveAthleteCloudState,
} from './athleteStateRouter.ts';
import {
  pushWorkoutToGarminConnect,
  saveGarminSession,
  fetchDirectGarminProfileAndWellness,
  normalizeGarminPersonalApiActivities,
} from '../garminConnectService.ts';
import { computeIntervalsSegmentEfforts } from './activitiesRouter.ts';
import { resolveStravaAthleteIdentity, ensureValidStravaAccessToken } from './stravaRouter.ts';
import { connectServiceToUser, disconnectServiceFromUser } from '../authService.ts';
import { extractStravaId, readStravaResponseJson } from '../stravaIdUtils.ts';
import { classifyMultiSportActivity } from '../../src/physiology/stravaLoadCalibration.ts';

export function getEffectiveIntervalsConfig(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return { apiKey: '', accessToken: '', athleteId: '0', scope: '' };
  }
  const allowEnvFallback = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  const headerKey = (activeReq?.headers['x-intervals-api-key'] as string | undefined) || '';
  const headerToken = (activeReq?.headers['x-intervals-access-token'] as string | undefined) || '';
  const headerAthlete = (activeReq?.headers['x-intervals-athlete-id'] as string | undefined) || '';
  const apiKey = (
    headerKey ||
    runtimeStore.intervalsApiKey ||
    (allowEnvFallback ? process.env.INTERVALS_API_KEY : '') ||
    ''
  ).trim();
  const accessToken = (
    headerToken ||
    runtimeStore.intervalsAccessToken ||
    ''
  ).trim();
  const athleteId =
    (
      headerAthlete ||
      runtimeStore.intervalsAthleteId ||
      (allowEnvFallback ? process.env.INTERVALS_ATHLETE_ID : '') ||
      '0'
    ).trim() || '0';
  const scope = runtimeStore.intervalsScope || '';
  return { apiKey, accessToken, athleteId, scope };
}

export function getIntervalsAuthHeader(config: { apiKey?: string; accessToken?: string }): string | null {
  if (config.accessToken) {
    return `Bearer ${config.accessToken}`;
  }
  if (config.apiKey) {
    return `Basic ${Buffer.from(`API_KEY:${config.apiKey}`).toString('base64')}`;
  }
  return null;
}

export function getEffectiveIntervalsClientConfig(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = (activeReq?.headers['x-intervals-client-id'] as string | undefined) || '';
  const headerClientSecret = (activeReq?.headers['x-intervals-client-secret'] as string | undefined) || '';
  const clientId = (headerClientId || process.env.INTERVALS_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || process.env.INTERVALS_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

export interface CachedIntervalsIdentity {
  athleteId: string;
  athleteName: string;
  rawProfile?: Record<string, any>;
}

export const intervalsIdentityByKey = new Map<string, CachedIntervalsIdentity>();

export async function resolveIntervalsAthleteIdentity(req?: Request): Promise<CachedIntervalsIdentity | null> {
  const config = getEffectiveIntervalsConfig(req);
  const authHeader = getIntervalsAuthHeader(config);
  if (!authHeader) return null;
  const cacheKey = config.accessToken ? `tok_${config.accessToken.slice(-10)}` : `key_${config.apiKey}`;
  const cached = intervalsIdentityByKey.get(cacheKey);
  if (cached && !isGenericName(cached.athleteName)) {
    return cached;
  }
  try {
    const resp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(config.athleteId || '0')}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    );
    if (!resp.ok) return null;
    const rawProfile = (await resp.json()) as Record<string, any>;
    const resolvedId = String(rawProfile.id || config.athleteId || '0');
    const fullName =
      String(rawProfile.name || '').trim() ||
      [rawProfile.firstname, rawProfile.lastname].filter(Boolean).join(' ').trim() ||
      '';
    if (fullName && !isGenericName(fullName)) {
      runtimeStore.intervalsAthleteName = fullName;
      saveSessionCache();
    }
    const entry: CachedIntervalsIdentity = {
      athleteId: resolvedId,
      athleteName: fullName,
      rawProfile,
    };
    intervalsIdentityByKey.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function rankSegmentEffortsAcrossActivities(activities: any[]) {
  const bySegmentId = new Map<string, any[]>();
  for (const act of activities) {
    if (!Array.isArray(act.segmentEfforts)) continue;
    for (const eff of act.segmentEfforts) {
      if (!eff || !eff.segmentId || !(eff.elapsedTimeSecs > 0)) continue;
      const sid = String(eff.segmentId);
      const list = bySegmentId.get(sid) || [];
      list.push(eff);
      bySegmentId.set(sid, list);
    }
  }

  for (const list of bySegmentId.values()) {
    list.sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
    list.forEach((eff, idx) => {
      if (idx === 0) eff.prRank = 1;
      else if (idx === 1) eff.prRank = 2;
      else if (idx === 2) eff.prRank = 3;
      else eff.prRank = null;
    });
  }

  for (const act of activities) {
    if (Array.isArray(act.segmentEfforts) && act.segmentEfforts.length > 0) {
      const prCount = act.segmentEfforts.filter((e: any) => e.prRank === 1).length;
      if (prCount > (act.stravaPrCount || 0)) {
        act.stravaPrCount = prCount;
      }
    }
  }
}

export async function syncIntervalsAllHistory(
  configOrKey: { apiKey?: string; accessToken?: string; athleteId?: string } | string,
  maybeAthleteId = '0',
  oldestActivitiesDate = '2010-01-01'
) {
  let authHeader: string;
  let athleteId: string;
  if (typeof configOrKey === 'string') {
    authHeader = 'Basic ' + Buffer.from(`API_KEY:${configOrKey}`).toString('base64');
    athleteId = maybeAthleteId || '0';
  } else {
    const header = getIntervalsAuthHeader(configOrKey);
    if (!header) {
      throw new Error(
        'Intervals.icu authentication header could not be constructed (missing API key or access token).'
      );
    }
    authHeader = header;
    athleteId = configOrKey.athleteId || maybeAthleteId || '0';
  }
  const now = new Date();
  const newest = now.toISOString().slice(0, 10);
  const futureEventsDate = new Date(now);
  futureEventsDate.setUTCDate(futureEventsDate.getUTCDate() + 90);
  const newestEvents = futureEventsDate.toISOString().slice(0, 10);
  const oldestEventsDate = new Date(now);
  oldestEventsDate.setUTCDate(oldestEventsDate.getUTCDate() - 180);
  const oldestEvents = oldestEventsDate.toISOString().slice(0, 10);

  const safeOldestActs = /^\d{4}-\d{2}-\d{2}$/.test(oldestActivitiesDate)
    ? oldestActivitiesDate
    : '2010-01-01';
  const isDeltaSync = safeOldestActs > '2020-01-01';
  const oldestWellness = isDeltaSync ? '2024-01-01' : '2018-01-01';

  // Fetch Activities, Wellness, Athlete Profile/Gear, and Calendar Events
  const [profileResp, wellnessResp, activitiesResp, eventsResp] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldestWellness}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${safeOldestActs}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${oldestEvents}&newest=${newestEvents}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
  ]);

  if (!wellnessResp.ok || !activitiesResp.ok) {
    throw new Error(
      `Intervals.icu sync returned status wellness=${wellnessResp.status}, activities=${activitiesResp.status}`
    );
  }

  // Extract Athlete Profile, Sport Thresholds (FTP, LTHR, Max HR), and Real Bikes & Shoes
  let parsedRawProfile: Record<string, any> | null = null;
  if (profileResp.ok) {
    const profile = (await profileResp.json()) as Record<string, any>;
    parsedRawProfile = profile;
    runtimeStore.intervalsAthleteName =
      profile.name ||
      [profile.firstname, profile.lastname].filter(Boolean).join(' ') ||
      runtimeStore.intervalsAthleteName;

    if (Array.isArray(profile.sportSettings)) {
      const bikeSetting = profile.sportSettings.find(
        (s: any) => Array.isArray(s.types) && s.types.includes('Ride')
      );
      const runSetting = profile.sportSettings.find(
        (s: any) => Array.isArray(s.types) && s.types.includes('Run')
      );
      if (bikeSetting) {
        if (bikeSetting.ftp) runtimeStore.athleteFtp = Number(bikeSetting.ftp);
        if (bikeSetting.indoor_ftp) runtimeStore.athleteIndoorFtp = Number(bikeSetting.indoor_ftp);
        if (bikeSetting.lthr) runtimeStore.athleteLthr = Number(bikeSetting.lthr);
        if (bikeSetting.max_hr) runtimeStore.athleteMaxHr = Number(bikeSetting.max_hr);
      }
      if (runSetting && runSetting.ftp) {
        runtimeStore.athleteRunFtp = Number(runSetting.ftp);
      }
    }

    const bikes = Array.isArray(profile.bikes)
      ? profile.bikes.map((b: any) => ({
          id: String(b.id),
          name: String(b.name || 'Road Bike'),
          type: 'BIKE' as const,
          distanceMeters: Number(b.distance || 0),
          maxRecommendedMeters: 8046720, // 5,000 mi chain/service interval
          primary: Boolean(b.primary),
        }))
      : [];
    const shoes = Array.isArray(profile.shoes)
      ? profile.shoes.map((s: any) => ({
          id: String(s.id),
          name: String(s.name || 'Running Shoe'),
          type: 'SHOE' as const,
          distanceMeters: Number(s.distance || 0),
          maxRecommendedMeters: 724205, // 450 mi shoe retirement threshold
          primary: Boolean(s.primary),
        }))
      : [];
    if (bikes.length > 0 || shoes.length > 0) {
      runtimeStore.gearItems = [...bikes, ...shoes];
    }
  }

  const rawWellnessAll = (await wellnessResp.json()) as Record<string, any>[];
  const rawActivities = (await activitiesResp.json()) as Record<string, any>[];
  const rawEvents = eventsResp.ok ? ((await eventsResp.json()) as Record<string, any>[]) : [];

  // Filter out future empty wellness rows beyond today (or UTC tomorrow before morning sync)
  const rawWellness = rawWellnessAll.filter((w, i, a) => {
    const d = w?.id || w?.date;
    if (!d || d > newest) return false;
    if (i === a.length - 1 || d === newest) {
      const hasAnyTelemetry =
        w.sleepSecs != null || w.hrv != null || w.restingHR != null || w.steps != null;
      if (!hasAnyTelemetry && d >= newest) return false;
    }
    return true;
  });

  const redactedStravaCount = rawActivities.filter(
    (a) => a && a.source === 'STRAVA' && !a.type && a.moving_time == null
  ).length;

  // Normalize all-time Wellness + Garmin Sleep, HRV Corridor & 8-State Garmin Training Status
  let lastValidWeight =
    Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight || 0) > 30
      ? Number(Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight).toFixed(1))
      : 70.0;
  let lastValidVo2 = 50;
  let lastValidRhr =
    Number(parsedRawProfile?.icu_resting_hr || 0) > 25
      ? Math.round(Number(parsedRawProfile?.icu_resting_hr))
      : 49;

  const wellnessDays = rawWellness.map((w, idx, arr) => {
    const ctl = Number((w.ctl ?? 0).toFixed(1));
    const atl = Number((w.atl ?? 0).toFixed(1));
    const tsb = Number((ctl - atl).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1.0;
    const rampRate = Number((w.rampRate ?? 0).toFixed(1));

    const hrv = Math.round(w.hrv ?? w.hrvRMSSD ?? 0);
    // 7-day rolling HRV average
    const slice7 = arr
      .slice(Math.max(0, idx - 6), idx + 1)
      .map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0))
      .filter((v) => v > 0);
    const baseline7d =
      slice7.length > 0 ? slice7.reduce((a, b) => a + b, 0) / slice7.length : hrv;

    // 60-day normal baseline corridor (mean +/- 0.85 SD) matching Garmin HRV Status
    const slice60 = arr
      .slice(Math.max(0, idx - 59), idx + 1)
      .map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0))
      .filter((v) => v > 0);
    const mean60 =
      slice60.length > 0 ? slice60.reduce((a, b) => a + b, 0) / slice60.length : baseline7d || 52;
    const variance60 =
      slice60.length > 1
        ? slice60.reduce((acc, v) => acc + Math.pow(v - mean60, 2), 0) / slice60.length
        : 36;
    const sd60 = Math.max(4, Math.sqrt(variance60));
    const hrvNormalBandLow = Math.round(mean60 - 0.85 * sd60);
    const hrvNormalBandHigh = Math.round(mean60 + 0.85 * sd60);

    let hrvStatus: 'Balanced' | 'Unbalanced' | 'Low' = 'Balanced';
    const checkHrv = baseline7d || hrv;
    if (checkHrv > 0) {
      if (checkHrv < hrvNormalBandLow - 3 || (hrv > 0 && hrv < hrvNormalBandLow - 5)) {
        hrvStatus = 'Low';
      } else if (checkHrv < hrvNormalBandLow || checkHrv > hrvNormalBandHigh + 4) {
        hrvStatus = 'Unbalanced';
      }
    }

    if (w.restingHR && Number(w.restingHR) > 0) lastValidRhr = Math.round(Number(w.restingHR));
    if (w.weight && Number(w.weight) > 0) lastValidWeight = Number(Number(w.weight).toFixed(1));
    if (w.vo2max && Number(w.vo2max) > 0) lastValidVo2 = Number(w.vo2max);

    const sleepSecs = Number(w.sleepSecs ?? 0);
    const sleepScore = Number(
      w.sleepScore ?? (sleepSecs > 0 ? Math.min(98, Math.round((sleepSecs / 28800) * 85)) : 0)
    );
    const sleepQuality = w.sleepQuality != null ? Number(w.sleepQuality) : undefined;

    // 7-day rolling sleep debt vs 7.5h (27,000s) target
    const sleepSlice7 = arr
      .slice(Math.max(0, idx - 6), idx + 1)
      .map((item) => Number(item.sleepSecs ?? 0))
      .filter((s) => s > 0);
    const sleepDebt7dSecs =
      sleepSlice7.length > 0
        ? Math.max(
            0,
            Math.round(sleepSlice7.reduce((acc, s) => acc + Math.max(0, 27000 - s), 0))
          )
        : 0;

    // Extract eFTP & W' from sportInfo
    const rideSport = Array.isArray(w.sportInfo)
      ? w.sportInfo.find((s: any) => s.type === 'Ride')
      : undefined;
    const runSport = Array.isArray(w.sportInfo)
      ? w.sportInfo.find((s: any) => s.type === 'Run')
      : undefined;
    const rideEftp = rideSport?.eftp ? Math.round(Number(rideSport.eftp)) : undefined;
    const rideWPrime = rideSport?.wPrime ? Math.round(Number(rideSport.wPrime)) : undefined;
    const ridePMax = rideSport?.pMax ? Math.round(Number(rideSport.pMax)) : undefined;
    const runEftp = runSport?.eftp ? Math.round(Number(runSport.eftp)) : undefined;
    const runWPrime = runSport?.wPrime ? Math.round(Number(runSport.wPrime)) : undefined;
    const runPMax = runSport?.pMax ? Math.round(Number(runSport.pMax)) : undefined;

    // 28-day fitness / eFTP / VO2 trend for Garmin 8-State Training Status classification
    const prev28 = arr[Math.max(0, idx - 28)];
    const prevCtl = prev28 ? Number(prev28.ctl ?? ctl) : ctl;
    const ctlDelta28 = ctl - prevCtl;

    let garminTrainingStatus:
      | 'Peaking'
      | 'Productive'
      | 'Maintaining'
      | 'Recovery'
      | 'Unproductive'
      | 'Strained'
      | 'Overreaching'
      | 'Detraining' = 'Maintaining';
    let trainingStatusReason = 'Balanced acute-to-chronic workload and stable autonomic baseline.';

    if (loadRatio > 1.45 && (hrvStatus === 'Low' || tsb < -22)) {
      garminTrainingStatus = 'Overreaching';
      trainingStatusReason = `Very high acute load ratio (${loadRatio}x) with suppressed TSB (${tsb}) and HRV.`;
    } else if (hrvStatus === 'Low' && (sleepScore > 0 && sleepScore < 72 || tsb < -12)) {
      garminTrainingStatus = 'Strained';
      trainingStatusReason = `HRV (${hrv || Math.round(baseline7d)} ms) is below normal corridor (${hrvNormalBandLow}–${hrvNormalBandHigh} ms) with elevated fatigue.`;
    } else if (ctl > 45 && tsb >= 4 && tsb <= 20 && rampRate < 0 && hrvStatus === 'Balanced') {
      garminTrainingStatus = 'Peaking';
      trainingStatusReason = `High aerobic base (CTL ${ctl}) paired with fresh positive form (TSB +${tsb}) and balanced HRV.`;
    } else if (
      (rampRate >= 0.4 || ctlDelta28 >= 1.5 || (loadRatio >= 0.85 && loadRatio <= 1.3)) &&
      hrvStatus !== 'Low'
    ) {
      garminTrainingStatus = 'Productive';
      trainingStatusReason = `Optimal load ratio (${loadRatio}x) building aerobic fitness (CTL ${ctl}) with ${hrvStatus.toLowerCase()} HRV.`;
    } else if (loadRatio < 0.78 && tsb > 0 && ctlDelta28 >= -3) {
      garminTrainingStatus = 'Recovery';
      trainingStatusReason = `Reduced acute training load (${loadRatio}x) allowing supercompensation and freshness.`;
    } else if (rampRate < -3.5 && ctlDelta28 < -4 && loadRatio < 0.7) {
      garminTrainingStatus = 'Detraining';
      trainingStatusReason = `Sustained reduction in training load (Ramp ${rampRate}/wk) lowering chronic fitness.`;
    } else if (loadRatio > 1.15 && hrvStatus === 'Unbalanced') {
      garminTrainingStatus = 'Unproductive';
      trainingStatusReason = `High workload (${loadRatio}x) accompanied by unbalanced autonomic recovery.`;
    }

    let readinessStatus: 'Optimal' | 'Caution' | 'Strain' = 'Optimal';
    if (
      garminTrainingStatus === 'Strained' ||
      garminTrainingStatus === 'Overreaching' ||
      tsb < -18 ||
      hrvStatus === 'Low'
    ) {
      readinessStatus = 'Strain';
    } else if (
      garminTrainingStatus === 'Unproductive' ||
      tsb < -10 ||
      hrvStatus === 'Unbalanced' ||
      (sleepScore > 0 && sleepScore < 70)
    ) {
      readinessStatus = 'Caution';
    }

    return {
      date: w.id || w.date || newest,
      ctl,
      atl,
      tsb,
      loadRatio,
      rampRate,
      hrvRMSSD: hrv,
      hrvBaseline7d: Math.round(baseline7d),
      hrvNormalBandLow,
      hrvNormalBandHigh,
      hrvStatus,
      restingHR: w.restingHR ? Math.round(Number(w.restingHR)) : lastValidRhr,
      sleepSecs,
      sleepScore,
      sleepQuality,
      sleepDebt7dSecs,
      weightKg: w.weight ? Number(Number(w.weight).toFixed(1)) : lastValidWeight,
      vo2MaxCycling: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      vo2MaxRunning: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      spO2: w.spO2 ? Number(w.spO2) : undefined,
      respiration: w.respiration ? Number(w.respiration) : undefined,
      steps: w.steps != null ? Number(w.steps) : undefined,
      floorsClimbed: w.floorsClimbed != null ? Number(w.floorsClimbed) : undefined,
      soreness: w.soreness ?? undefined,
      rideEftp,
      rideWPrime,
      ridePMax,
      runEftp,
      runWPrime,
      runPMax,
      garminTrainingStatus,
      trainingStatusReason,
      readinessStatus,
      dailyLoad: Math.round(w.ctlLoad ?? w.atlLoad ?? 0),
    };
  });

  // Enrich & reconstruct Strava-originated Virtual Cycling / Trainer sessions from Strava cache or Intervals.icu daily wellness residual load
  const icuStravaAthleteId = String(parsedRawProfile?.strava_id || '').replace(/[^0-9]/g, '');
  const cachedStravaArchive = icuStravaAthleteId
    ? loadJsonFile<Record<string, any>[]>(
        `/tmp/aeropulse-strava-archive-${icuStravaAthleteId}.json`,
        []
      )
    : [];
  const stravaArchiveById = new Map<string, Record<string, any>>();
  for (const sa of cachedStravaArchive) {
    if (sa && sa.id) stravaArchiveById.set(String(sa.id), sa);
  }

  const garminStravaIds = new Set<string>();
  const knownGarminLoadByDate = new Map<string, number>();
  const stubsByDate = new Map<string, Record<string, any>[]>();

  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    const d = String(a.start_date_local).slice(0, 10);
    if (a.source !== 'STRAVA' && a.strava_id) {
      garminStravaIds.add(String(a.strava_id));
    }
    if (a.type || a.moving_time != null || a.elapsed_time != null) {
      knownGarminLoadByDate.set(
        d,
        (knownGarminLoadByDate.get(d) || 0) + Number(a.icu_training_load ?? 0)
      );
    } else if (a.source === 'STRAVA') {
      const list = stubsByDate.get(d) || [];
      list.push(a);
      stubsByDate.set(d, list);
    }
  }

  const enrichedRawActivities: Record<string, any>[] = [];
  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    if (a.source === 'STRAVA' && !a.type && a.moving_time == null && a.elapsed_time == null) {
      const sid = String(a.strava_id || a.id);
      if (garminStravaIds.has(sid)) continue;

      const cachedSa = stravaArchiveById.get(sid);
      if (cachedSa && (cachedSa.moving_time || cachedSa.elapsed_time)) {
        enrichedRawActivities.push({
          ...a,
          id: `strava-${sid}`,
          strava_id: sid,
          type: cachedSa.sport_type || cachedSa.type || 'Ride',
          name: cachedSa.name || 'Recorded Session',
          moving_time: cachedSa.moving_time || cachedSa.elapsed_time,
          elapsed_time: cachedSa.elapsed_time || cachedSa.moving_time,
          distance: cachedSa.distance ?? 0,
          total_elevation_gain: cachedSa.total_elevation_gain ?? 0,
          trainer: Boolean(cachedSa.trainer),
          average_watts: cachedSa.average_watts,
          icu_weighted_avg_watts: cachedSa.weighted_average_watts || cachedSa.average_watts,
          average_heartrate: cachedSa.average_heartrate,
          max_heartrate: cachedSa.max_heartrate,
          average_cadence: cachedSa.average_cadence,
          device_name: cachedSa.device_name || undefined,
        });
      }
      // Never synthesize fake Zwift workouts or fabricated watts/HR for redacted Intervals.icu stubs
      continue;
    }
    enrichedRawActivities.push(a);
  }

  // Normalize all-time Garmin / Intervals.icu / Reconstructed Virtual Cycling Activities
  const seenStravaIds = new Set<string>();
  const activities = enrichedRawActivities
    .filter((a) => {
      if (!a || !a.start_date_local) return false;
      if (!a.type && a.moving_time == null && a.elapsed_time == null) return false;
      if (a.source === 'STRAVA' && !a.name && a.moving_time == null) return false;
      const duration = Number(a.moving_time ?? a.elapsed_time ?? 0);
      if (duration <= 0) return false;
      if (a.strava_id) {
        const sid = String(a.strava_id);
        if (seenStravaIds.has(sid)) return false;
        seenStravaIds.add(sid);
      }
      return true;
    })
    .map((a) => {
      const rawType = String(a.type || '').trim();
      const rawSubType = String(a.sub_type || '').trim();
      const rawName = String(a.name || '').trim();
      const rawDevice = String(a.device_name || '').trim();
      const combinedMeta = `${rawType} ${rawSubType} ${rawName} ${rawDevice}`;

      const rawStartLatLng =
        Array.isArray(a.start_latlng) && a.start_latlng.length >= 2
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

      const hasNoLatLngStream =
        Array.isArray(a.stream_types) &&
        a.stream_types.length > 0 &&
        !a.stream_types.includes('latlng');

      const isVirtualPlatform =
        /virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
          combinedMeta
        ) || Boolean(isWatopiaOrMakuriGps);

      const classified = classifyMultiSportActivity(rawType || rawSubType, `${rawSubType} ${rawName}`, {
        trainer: Boolean(a.trainer) || isVirtualPlatform || /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga|pool/i.test(combinedMeta),
        hasGps: Boolean(rawStartLatLng) && !hasNoLatLngStream,
        isVirtualPlatform,
      });
      const sportCategory = classified.sportCategory;
      const isIndoor = classified.environment === 'INDOOR';
      const subType = classified.subType;

      const movingTimeSecs = Number(a.moving_time ?? a.elapsed_time ?? 0);
      const distanceMeters = Number(a.distance ?? 0);
      const avgPower = a.icu_average_watts ?? a.average_watts ?? undefined;
      const normalizedPower = a.icu_weighted_avg_watts ?? avgPower;
      const avgHr = Number(a.average_heartrate ?? 0);
      const maxHr = Number(a.max_heartrate ?? 0);
      const avgPaceSecsPerKm =
        sportCategory === 'Running' && distanceMeters > 0
          ? Math.round(movingTimeSecs / (distanceMeters / 1000))
          : undefined;
      const gapPaceSecsPerKm =
        sportCategory === 'Running' && a.gap && Number(a.gap) > 0
          ? Math.round(1000 / Number(a.gap))
          : undefined;

      const canUsePowerForIf =
        sportCategory === 'Cycling' ||
        (sportCategory === 'Running' && Number(runtimeStore.athleteRunFtp) > 0);
      const userFtp =
        sportCategory === 'Running'
          ? runtimeStore.athleteRunFtp || 350
          : runtimeStore.athleteFtp || 250;
      const rawIcuIf = Number(a.icu_intensity ?? 0);
      let trainingLoad = Math.round(Number(a.icu_training_load ?? 0));
      let intensityFactor: number | undefined =
        rawIcuIf > 0
          ? Number((rawIcuIf > 3 ? rawIcuIf / 100 : rawIcuIf).toFixed(2))
          : undefined;
      if (canUsePowerForIf && normalizedPower && movingTimeSecs > 0) {
        const ifVal = normalizedPower / userFtp;
        if (!intensityFactor) {
          intensityFactor = Number(ifVal.toFixed(2));
        }
        if (!trainingLoad) {
          trainingLoad = Math.round(
            ((movingTimeSecs * normalizedPower * ifVal) / (userFtp * 3600)) * 100
          );
        }
      } else if (avgHr > 0 && movingTimeSecs > 0) {
        const userLthr = runtimeStore.athleteLthr || 165;
        const hrRatio = Math.max(0.4, Math.min(1.25, avgHr / userLthr));
        if (!intensityFactor) {
          intensityFactor = Number(hrRatio.toFixed(2));
        }
        if (!trainingLoad) {
          trainingLoad = Math.round((movingTimeSecs / 3600) * Math.pow(hrRatio, 2) * 80);
        }
      } else if (!trainingLoad && movingTimeSecs > 0) {
        trainingLoad = Math.round((movingTimeSecs / 3600) * 45);
      }

      let efficiencyFactor = 0;
      if (sportCategory === 'Cycling' && normalizedPower && avgHr > 0) {
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

      const rawIntervals = Array.isArray(a.icu_intervals) ? a.icu_intervals : [];
      const intervals = rawIntervals.map((iv: any, idx: number) => {
        const dist = Number(iv.distance || 0);
        const dur = Number(iv.moving_time || iv.elapsed_time || 0);
        const avgSpeed = Number(iv.average_speed || 0);
        const gapSpeed = Number(iv.gap || avgSpeed);
        return {
          id: String(iv.id || `iv-${idx}`),
          type: iv.type === 'WORK' ? ('WORK' as const) : ('RECOVERY' as const),
          label:
            iv.label ||
            iv.group_id ||
            (iv.type === 'WORK' ? `Work Interval #${idx + 1}` : `Recovery #${idx + 1}`),
          startTimeSecs: Number(iv.start_time || 0),
          durationSecs: dur,
          distanceMeters: Math.round(dist),
          avgWatts: iv.average_watts ? Math.round(Number(iv.average_watts)) : undefined,
          weightedAvgWatts: iv.weighted_average_watts
            ? Math.round(Number(iv.weighted_average_watts))
            : undefined,
          intensityPct: iv.intensity ? Math.round(Number(iv.intensity)) : undefined,
          zone: iv.zone ? Number(iv.zone) : undefined,
          avgHr: iv.average_heartrate ? Math.round(Number(iv.average_heartrate)) : undefined,
          maxHr: iv.max_heartrate ? Math.round(Number(iv.max_heartrate)) : undefined,
          avgPaceSecsPerKm: avgSpeed > 0 ? Math.round(1000 / avgSpeed) : undefined,
          gapPaceSecsPerKm: gapSpeed > 0 ? Math.round(1000 / gapSpeed) : undefined,
          avgCadence: iv.average_cadence ? Math.round(Number(iv.average_cadence)) : undefined,
          decouplingPct:
            iv.decoupling != null ? Number(Number(iv.decoupling).toFixed(1)) : undefined,
          strideLengthMeters: iv.average_stride
            ? Number(Number(iv.average_stride).toFixed(2))
            : undefined,
        };
      });

      const hrZoneSecs = Array.isArray(a.icu_hr_zone_times)
        ? a.icu_hr_zone_times.slice(0, 7).map((v: any) => Math.max(0, Math.round(Number(v || 0))))
        : [0, 0, 0, 0, 0, 0, 0];
      const pwrZoneSecs = Array.isArray(a.icu_zone_times)
        ? a.icu_zone_times.slice(0, 7).map((v: any) => Math.max(0, Math.round(Number(v || 0))))
        : undefined;
      const intervalsSourceBadges = Array.from(
        new Set([
          'Intervals.icu',
          ...(a.source === 'GARMIN_CONNECT'
            ? ['Garmin']
            : a.source === 'STRAVA'
              ? ['Strava']
              : []),
        ])
      );

      return {
        id: String(a.id),
        intervalsId: String(a.id),
        intervalsActivityId: String(a.id),
        stravaId: a.strava_id ? String(a.strava_id) : undefined,
        garminActivityId: a.source === 'GARMIN_CONNECT' ? String(a.id) : undefined,
        source: a.source || 'INTERVALS_ICU',
        sourceBadges: intervalsSourceBadges,
        rawSportType: rawType || undefined,
        name: rawName || `${subType} ${sportCategory}`,
        startDateLocal: String(a.start_date_local || '').replace(/Z$/i, ''),
        sportCategory,
        environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
        subType,
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
        avgPower: avgPower ? Math.round(avgPower) : undefined,
        normalizedPower: normalizedPower ? Math.round(normalizedPower) : undefined,
        intensityFactor,
        trainingLoad,
        avgHr: avgHr > 0 ? Math.round(avgHr) : undefined,
        maxHr: maxHr > 0 ? Math.round(maxHr) : undefined,
        avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm,
        efficiencyFactor,
        aerobicDecouplingPct:
          a.decoupling != null ? Number(Number(a.decoupling).toFixed(1)) : undefined,
        variabilityIndex:
          normalizedPower && avgPower && avgPower > 0
            ? Number((normalizedPower / avgPower).toFixed(2))
            : undefined,
        zoneSecs: {
          hr: hrZoneSecs,
          ...(pwrZoneSecs ? { power: pwrZoneSecs } : {}),
        },
        gearName: a.gear?.name || undefined,
        deviceName: a.device_name ? String(a.device_name) : undefined,
        hasSegments: Boolean(a.has_segments),
        intervals,
      };
    });

  // Attach cached Strava segment efforts & GPS routes
  const segmentsCache = loadJsonFile<Record<string, any[]>>(SEGMENTS_BY_ACTIVITY_CACHE_FILE, {});
  const routesCache = loadJsonFile<Record<string, [number, number][]>>(
    ROUTES_BY_ACTIVITY_CACHE_FILE,
    {}
  );
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

  for (const act of activities as any[]) {
    if (Array.isArray(segmentsCache[act.id]) && segmentsCache[act.id].length > 0) {
      act.segmentEfforts = segmentsCache[act.id].map((eff) => ({ ...eff }));
    }
    const routePts = routesCache[act.id];
    if (Array.isArray(routePts) && routePts.length >= 2) {
      act.routeLatLngs = routePts;
      act.startLatLng = routePts[0];
      act.endLatLng = routePts[routePts.length - 1];
      const [firstLat, firstLng] = routePts[0];
      if (
        act.sportCategory === 'Cycling' &&
        firstLat >= -12.6 &&
        firstLat <= -9.8 &&
        firstLng >= 164.8 &&
        firstLng <= 168.0
      ) {
        act.environment = 'INDOOR';
        act.subType = 'Virtual Cycling';
      }
    }
    const kEntry = kudosCache[act.id] || (act.stravaId ? kudosCache[act.stravaId] : undefined);
    if (kEntry) {
      if (kEntry.kudosCount !== undefined) act.kudosCount = kEntry.kudosCount;
      if (kEntry.hasKudoed !== undefined) act.hasKudoed = kEntry.hasKudoed;
      if (Array.isArray(kEntry.kudoers)) act.kudoers = kEntry.kudoers;
      if (Array.isArray(kEntry.comments)) {
        act.comments = kEntry.comments;
        act.commentCount = kEntry.comments.length;
      }
    }
  }
  rankSegmentEffortsAcrossActivities(activities);

  // Merge user-created local planned workouts with Intervals.icu calendar events
  const cacheKey =
    typeof configOrKey === 'string'
      ? configOrKey
      : configOrKey.apiKey || configOrKey.accessToken || 'default';
  const scopedPlannedFile = getScopedPlannedEventsFile(undefined, cacheKey);
  const localPlanned = scopedPlannedFile ? loadJsonFile<any[]>(scopedPlannedFile, []) : [];
  const icuPlanned = rawEvents
    .filter((ev) => ev && ev.start_date_local)
    .map((ev) => {
      const dur = Number(ev.moving_time ?? 3600);
      const desc = String(ev.description || '');
      return {
        id: `icu-ev-${ev.id}`,
        date: String(ev.start_date_local).slice(0, 10),
        name: String(ev.name || 'Planned Workout'),
        sportCategory: (/run/i.test(String(ev.type || '')) ? 'Running' : 'Cycling') as
          | 'Running'
          | 'Cycling',
        environmentPreference: (/indoor|virtual|trainer/i.test(String(ev.type || '') + desc)
          ? 'INDOOR'
          : 'FLEXIBLE') as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE',
        description: desc || 'Structured workout synced from Intervals.icu calendar.',
        plannedLoad: Math.round(Number(ev.icu_training_load ?? 65)),
        plannedDurationSecs: dur,
        targetZoneSummary: 'Intervals.icu Calendar Event',
        workoutSyntax: desc,
        structuredSteps: parseWorkoutSyntaxToSteps(desc, dur),
        source: 'INTERVALS_ICU' as const,
      };
    });

  const plannedEvents = [...localPlanned, ...icuPlanned];

  const stravaLinkedCount = activities.filter((a) => Boolean(a.stravaId)).length;
  runtimeStore.garminActivitiesCount = activities.length;
  runtimeStore.redactedStravaCount = redactedStravaCount;
  if (runtimeStore.stravaActivitiesCount < stravaLinkedCount) {
    runtimeStore.stravaActivitiesCount = stravaLinkedCount;
  }
  runtimeStore.totalActivitiesCount = Math.max(
    activities.length,
    activities.length + Math.max(0, runtimeStore.stravaActivitiesCount - stravaLinkedCount)
  );
  runtimeStore.earliestActivityDate =
    activities.length > 0
      ? activities[activities.length - 1].startDateLocal.slice(0, 10)
      : runtimeStore.earliestActivityDate;
  const accumulatedWellnessSummary: Record<string, any> = {};
  for (const w of wellnessDays) {
    if (w.weightKg && w.weightKg > 30 && w.weightKg !== 70) {
      accumulatedWellnessSummary.weightKg = w.weightKg;
    }
    if (w.restingHR && w.restingHR > 25 && w.restingHR !== 49) {
      accumulatedWellnessSummary.restingHR = w.restingHR;
    }
    if (w.vo2MaxCycling && w.vo2MaxCycling > 25 && w.vo2MaxCycling !== 50) {
      accumulatedWellnessSummary.vo2MaxCycling = w.vo2MaxCycling;
    }
    if (w.vo2MaxRunning && w.vo2MaxRunning > 25 && w.vo2MaxRunning !== 50) {
      accumulatedWellnessSummary.vo2MaxRunning = w.vo2MaxRunning;
    }
    if (w.rideEftp && w.rideEftp > 60) accumulatedWellnessSummary.rideEftp = w.rideEftp;
    if (w.rideWPrime && w.rideWPrime > 5000) accumulatedWellnessSummary.rideWPrime = w.rideWPrime;
    if (w.ridePMax && w.ridePMax > 300) accumulatedWellnessSummary.ridePMax = w.ridePMax;
    if (w.runEftp && w.runEftp > 80) accumulatedWellnessSummary.runEftp = w.runEftp;
  }
  const fullProfile = buildServerAthleteProfile(
    parsedRawProfile,
    accumulatedWellnessSummary,
    activities
  );
  runtimeStore.athleteProfile = fullProfile;
  runtimeStore.lastSyncedAt = new Date().toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1000).toISOString();
  saveSessionCache();

  return {
    wellnessDays,
    activities,
    plannedEvents,
    redactedStravaCount,
    athleteProfile: {
      ...fullProfile,
      gearItems: runtimeStore.gearItems,
    },
    syncedAt: runtimeStore.lastSyncedAt,
    nextHourlySyncAt: runtimeStore.nextHourlySyncAt,
  };
}

export const intervalsCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();
  const stateToken = String(req.query.state || '').trim();

  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);

  if (error) {
    const errMsg = error === 'access_denied' ? 'Access was denied by the user on Intervals.icu.' : error;
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'intervals',
      error: `Intervals.icu connection failed: ${errMsg}`,
    });
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Intervals.icu Connection Error',
        heading: 'Intervals.icu Connection Could Not Complete',
        accentColor: '#FB7185',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
        ctaOnClick:
          "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`,
      })
    );
    return;
  }

  if (!code) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Missing Authorization Code',
        heading: 'Intervals.icu Authorization Code Missing',
        accentColor: '#FB7185',
        body: 'No authorization code was returned by Intervals.icu.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
      })
    );
    return;
  }

  if (!verifiedState) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Invalid OAuth State',
        heading: 'Security Verification Failed',
        accentColor: '#FB7185',
        body: 'OAuth state token was invalid or expired. Please re-initiate Intervals.icu connection.',
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
      })
    );
    return;
  }

  try {
    const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        'Intervals.icu OAuth client credentials (INTERVALS_CLIENT_ID / INTERVALS_CLIENT_SECRET) are not configured.'
      );
    }

    const tokenResp = await fetch('https://intervals.icu/api/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Intervals.icu token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }

    const tokenData = (await tokenResp.json()) as {
      token_type?: string;
      access_token?: string;
      scope?: string;
      id?: string | number;
      name?: string;
      firstname?: string;
      lastname?: string;
      athlete?: { id?: string | number; name?: string };
    };

    const accessToken = String(tokenData.access_token || '').trim();
    if (!accessToken) {
      throw new Error('Intervals.icu did not return a valid access token.');
    }

    const athleteId = String(tokenData.id || tokenData.athlete?.id || '0').trim();
    const athleteName = String(
      tokenData.name ||
        tokenData.athlete?.name ||
        [tokenData.firstname, tokenData.lastname].filter(Boolean).join(' ') ||
        `Athlete ${athleteId}`
    ).trim();

    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.intervalsAccessToken = accessToken;
    store.intervalsScope =
      tokenData.scope || 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ';
    store.intervalsAthleteId = athleteId;
    store.intervalsAthleteName = athleteName;

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await connectServiceToUser(callerClaims.sub, 'intervals', athleteId, athleteName);
    }

    const sessionToken = setSessionCookie(req, res, athleteName, sid);
    await saveSessionCacheAsync(req, res, sid);

    const oauthPayloadJson = safeJsonForScript({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'intervals',
      athleteId,
      athleteName,
      sessionToken,
      scope: tokenData.scope,
      returnUrl: '/?tab=settings',
    });

    res.type('html').send(
      renderThreshOAuthHtml({
        title: 'Intervals.icu Connected · THRESH',
        heading: `Intervals.icu Connected${athleteName && !isGenericName(athleteName) ? ` · ${escapeHtml(athleteName)}` : ''}`,
        accentColor: '#10B981',
        body: 'Your Intervals.icu account is now linked via OAuth 2.0. Structured workouts, wellness metrics, and training data are ready to sync.',
        ctaLabel: 'Continue to THRESH',
        ctaHref: '/?tab=settings',
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_intervals_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_intervals_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_intervals_connected', '1');
            localStorage.removeItem('aeropulse_intervals_api_key');
            localStorage.setItem('aeropulse_oauth_just_connected', '1');
          } catch (e) {}
          var hasOpener = false;
          try {
            if (window.opener && window.opener !== window) {
              hasOpener = true;
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
          var isPopupWindow = hasOpener || window.name === 'aeropulse_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/?tab=settings');
          }
        })();`,
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'intervals',
      error: `Intervals.icu connection failed: ${errMsg}`,
    });
    res.status(500).type('html').send(
      renderThreshOAuthHtml({
        title: 'Intervals.icu Connection Error',
        heading: 'Intervals.icu Connection Failed',
        accentColor: '#FB7185',
        body: escapeHtml(errMsg),
        ctaLabel: 'Return to THRESH',
        ctaHref: '/?tab=settings',
        ctaOnClick:
          "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`,
      })
    );
  }
};

export const intervalsRouter = express.Router();

intervalsRouter.post('/api/intervals/profile/sync', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(config);
    const athleteId = config.athleteId || '0';
    const stravaIdentity = await resolveStravaAthleteIdentity(req);
    const garminSession = getActiveGarminSession(req);

    if (!intervalsAuth) {
      // Check Direct Garmin Connect + Live Strava OAuth profile + /athlete/zones + cached Strava activities
      const [garminDirect, validStravaToken] = await Promise.all([
        garminSession
          ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null)
          : Promise.resolve(null),
        ensureValidStravaAccessToken(req, false),
      ]);

      if (validStravaToken || garminDirect) {
        let sAth: Record<string, any> = {};
        let sZones: Record<string, any> | null = null;
        if (validStravaToken) {
          const sHeaders = { Authorization: `Bearer ${validStravaToken}` };
          const [sAthResp, sZonesResp] = await Promise.all([
            fetch('https://www.strava.com/api/v3/athlete', { headers: sHeaders }),
            fetch('https://www.strava.com/api/v3/athlete/zones', { headers: sHeaders }),
          ]);
          sAth = sAthResp.ok ? await readStravaResponseJson<Record<string, any>>(sAthResp) : {};
          sZones = sZonesResp.ok ? await readStravaResponseJson<Record<string, any>>(sZonesResp) : null;
        }
        const sId = (extractStravaId(sAth) || stravaIdentity?.athleteId || '').replace(/[^0-9]/g, '');
        const sActs = sId
          ? loadJsonFile<Record<string, any>[]>(`/tmp/aeropulse-strava-archive-${sId}.json`, [])
          : [];
        const sName =
          garminDirect?.rawProfile?.name ||
          [sAth.firstname, sAth.lastname].filter(Boolean).join(' ').trim() ||
          String(sAth.username || '').trim() ||
          stravaIdentity?.athleteName ||
          'Athlete';

        const latestGarminW =
          garminDirect?.wellnessRows && garminDirect.wellnessRows.length > 0
            ? {
                ...garminDirect.wellnessRows[garminDirect.wellnessRows.length - 1],
                weightKg: garminDirect.rawProfile?.weight,
                restingHR: garminDirect.rawProfile?.icu_resting_hr,
              }
            : {
                weightKg: garminDirect?.rawProfile?.weight,
                restingHR: garminDirect?.rawProfile?.icu_resting_hr,
              };

        const normalizedGarminActs = garminDirect?.activities
          ? normalizeGarminPersonalApiActivities(
              garminDirect.activities,
              garminDirect.rawProfile?.ftp || 250
            )
          : [];

        const directSyncedProfile = buildServerAthleteProfile(
          {
            ...(garminDirect?.rawProfile || {}),
            id: sId || garminDirect?.rawProfile?.id || '0',
            name: sName,
            ftp:
              garminDirect?.rawProfile?.sportSettings?.[0]?.ftp ??
              garminDirect?.rawProfile?.ftp ??
              (Number(sAth.ftp) > 80 ? Math.round(Number(sAth.ftp)) : undefined),
            weightKg:
              garminDirect?.rawProfile?.weight ??
              (Number(sAth.weight) > 30 ? Number(sAth.weight) : undefined),
            stravaZones: sZones,
            source: garminDirect ? 'INTERVALS_GARMIN' : 'STRAVA_OAUTH',
          },
          latestGarminW,
          [...normalizedGarminActs, ...sActs]
        );
        runtimeStore.athleteProfile = directSyncedProfile;
        runtimeStore.athleteFtp = directSyncedProfile.ftp;
        runtimeStore.athleteIndoorFtp = directSyncedProfile.indoorFtp;
        runtimeStore.athleteRunFtp = directSyncedProfile.runFtp;
        runtimeStore.athleteLthr = directSyncedProfile.lthr;
        runtimeStore.athleteMaxHr = directSyncedProfile.maxHr;
        saveSessionCache(req);
        res.json({ ok: true, athleteProfile: directSyncedProfile, mode: 'LIVE' });
        return;
      }

      const fallbackProfile = buildServerAthleteProfile(req.body?.overrides || null, null);
      res.json({ ok: true, athleteProfile: fallbackProfile, mode: 'SANDBOX' });
      return;
    }

    const authHeader = intervalsAuth;
    const todayStr = new Date().toISOString().slice(0, 10);
    const oldest60d = new Date(Date.now() - 60 * 86400 * 1000).toISOString().slice(0, 10);

    const [profileResp, wellnessResp, actsResp, garminDirect] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest60d}&newest=${todayStr}`,
        {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        }
      ),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest60d}&newest=${todayStr}`,
        {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        }
      ),
      garminSession
        ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!profileResp.ok && !garminDirect) {
      res.status(profileResp.status).json({
        error: `Intervals.icu athlete profile request returned ${profileResp.status}.`,
      });
      return;
    }

    const rawProfile = profileResp.ok
      ? ((await profileResp.json()) as Record<string, any>)
      : {};
    const rawWellnessList = wellnessResp.ok
      ? ((await wellnessResp.json()) as Record<string, any>[])
      : [];
    const rawActsList = actsResp.ok
      ? ((await actsResp.json()) as Record<string, any>[])
      : [];

    const latestWellnessSummary: Record<string, any> = {};
    for (const w of rawWellnessList) {
      if (w.weight && Number(w.weight) > 25) latestWellnessSummary.weightKg = Number(w.weight);
      if (w.restingHR && Number(w.restingHR) > 25)
        latestWellnessSummary.restingHR = Number(w.restingHR);
      if (w.vo2max && Number(w.vo2max) > 20) {
        latestWellnessSummary.vo2MaxCycling = Number(w.vo2max);
        latestWellnessSummary.vo2MaxRunning = Number(w.vo2max);
      }
      if (Array.isArray(w.sportInfo)) {
        const rideInfo = w.sportInfo.find((s: any) => s.type === 'Ride');
        const runInfo = w.sportInfo.find((s: any) => s.type === 'Run');
        if (rideInfo?.eftp) latestWellnessSummary.rideEftp = Math.round(Number(rideInfo.eftp));
        if (rideInfo?.wPrime) latestWellnessSummary.rideWPrime = Math.round(Number(rideInfo.wPrime));
        if (rideInfo?.pMax) latestWellnessSummary.ridePMax = Math.round(Number(rideInfo.pMax));
        if (runInfo?.eftp) latestWellnessSummary.runEftp = Math.round(Number(runInfo.eftp));
      }
    }

    if (garminDirect?.rawProfile?.weight) {
      latestWellnessSummary.weightKg = garminDirect.rawProfile.weight;
    }
    if (garminDirect?.rawProfile?.icu_resting_hr) {
      latestWellnessSummary.restingHR = garminDirect.rawProfile.icu_resting_hr;
    }

    const garminActs = garminDirect?.activities
      ? normalizeGarminPersonalApiActivities(
          garminDirect.activities,
          garminDirect.rawProfile?.ftp || 250
        )
      : [];

    const mergedRawProfile = {
      ...rawProfile,
      ...(garminDirect?.rawProfile || {}),
      name:
        garminDirect?.rawProfile?.name ||
        rawProfile.name ||
        [rawProfile.firstname, rawProfile.lastname].filter(Boolean).join(' ') ||
        stravaIdentity?.athleteName,
      weight:
        garminDirect?.rawProfile?.weight ||
        rawProfile.icu_weight ||
        rawProfile.weight ||
        stravaIdentity?.weightKg,
      ftp:
        garminDirect?.rawProfile?.ftp ||
        rawProfile.ftp ||
        stravaIdentity?.ftp,
      sportSettings:
        Array.isArray(garminDirect?.rawProfile?.sportSettings) &&
        garminDirect!.rawProfile!.sportSettings.length > 0
          ? garminDirect!.rawProfile!.sportSettings
          : rawProfile.sportSettings,
    };

    const syncedProfile = buildServerAthleteProfile(
      mergedRawProfile,
      latestWellnessSummary,
      [...garminActs, ...rawActsList]
    );
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    saveSessionCache(req);

    res.json({
      ok: true,
      athleteProfile: syncedProfile,
      mode: 'LIVE',
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to sync Athlete Profile & Zones.',
    });
  }
});

intervalsRouter.get(['/api/intervals/auth/url', '/api/auth/intervals/url'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error:
        'Intervals.icu OAuth is not configured on this server yet. Please set INTERVALS_CLIENT_ID and INTERVALS_CLIENT_SECRET in your Vercel Environment Variables (or local .env).',
    });
    return;
  }

  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || 'cloud').toLowerCase();
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const clientNonce = String(req.query.state || '').trim();

  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || undefined,
    sid,
    flow,
    mode,
  });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolveIntervalsCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ',
    state: stateToken,
  });

  const authUrl = `https://intervals.icu/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});

intervalsRouter.get(['/api/intervals/auth/login', '/api/auth/intervals/login'], (req: Request, res: Response) => {
  const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      'Intervals.icu OAuth is not configured on this server yet (missing INTERVALS_CLIENT_ID or INTERVALS_CLIENT_SECRET).'
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: 'cloud' });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri = resolveIntervalsCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ',
    state: stateToken,
  });
  res.redirect(302, `https://intervals.icu/oauth/authorize?${params.toString()}`);
});

intervalsRouter.get(
  [
    '/auth/intervals/callback',
    '/auth/intervals/callback/',
    '/api/intervals/callback',
    '/api/intervals/callback/',
    '/api/auth/intervals/callback',
    '/api/auth/intervals/callback/',
  ],
  intervalsCallbackHandler
);

intervalsRouter.post('/api/intervals/connect', async (req: Request, res: Response) => {
  try {
    const apiKey = String(req.body?.apiKey || '').trim();
    const athleteId = String(req.body?.athleteId || '0').trim() || '0';

    if (!apiKey) {
      res.status(400).json({ error: 'Please provide a valid Intervals.icu Personal API Key.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const profileResp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    );

    if (!profileResp.ok) {
      res.status(profileResp.status).json({
        error: `Intervals.icu authentication failed (${profileResp.status}). Verify your Athlete ID and Personal API Key.`,
      });
      return;
    }

    const profileData = (await profileResp.json()) as Record<string, any>;
    const resolvedId = profileData.id || athleteId;
    const resolvedName =
      profileData.name ||
      [profileData.firstname, profileData.lastname].filter(Boolean).join(' ') ||
      `Athlete ${resolvedId}`;

    const sessionToken = setSessionCookie(req, res, resolvedName);
    const createdClaims = decodeAndVerifyToken(sessionToken);
    if (createdClaims?.sid) {
      bindRequestScopeKey(req, createdClaims.sid);
    }
    runtimeStore.intervalsApiKey = apiKey;
    runtimeStore.intervalsAthleteId = resolvedId;
    runtimeStore.intervalsAthleteName = resolvedName;

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await connectServiceToUser(callerClaims.sub, 'intervals', resolvedId, resolvedName);
    }

    await saveSessionCacheAsync(req, res, createdClaims?.sid);

    res.json({
      connected: true,
      sessionToken,
      athleteId: resolvedId,
      athleteName: resolvedName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect to Intervals.icu',
    });
  }
});

intervalsRouter.post('/api/intervals/disconnect', async (req: Request, res: Response) => {
  runtimeStore.intervalsApiKey = '';
  runtimeStore.intervalsAccessToken = '';
  runtimeStore.intervalsScope = '';
  runtimeStore.intervalsAthleteName = '';

  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
    await disconnectServiceFromUser(callerClaims.sub, 'intervals');
  }

  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});

intervalsRouter.get('/api/intervals/sync', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res
        .status(401)
        .json({ error: 'Intervals.icu is not connected (OAuth access token or API Key required).' });
      return;
    }
    const oldestParam = String(req.query.oldest || '2010-01-01').trim();
    const payload = await syncIntervalsAllHistory(config, config.athleteId, oldestParam);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Intervals.icu data',
    });
  }
});

// Fetch second-by-second streams (including GPS latlng), auto-detected Intervals.icu intervals, AND Strava Segment efforts
intervalsRouter.get('/api/intervals/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res
        .status(401)
        .json({ error: 'Intervals.icu is not connected (OAuth access token or API Key required).' });
      return;
    }

    const activityId = req.params.id;
    const [streamsResp, detailResp, segmentsResp] = await Promise.all([
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,cadence,altitude`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/segments`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
    ]);

    const streamMap: Record<string, number[]> = {};
    let downsampledLatLng: [number, number][] | undefined;
    let rawStreamsList: { type: string; data: number[]; data2?: number[] }[] = [];
    if (streamsResp.ok) {
      const rawStreams = (await streamsResp.json()) as {
        type: string;
        data: number[];
        data2?: number[];
      }[];
      if (Array.isArray(rawStreams)) {
        rawStreamsList = rawStreams;
        const timeEntry = rawStreams.find((s) => s && s.type === 'time' && Array.isArray(s.data));
        const baseLen = timeEntry?.data?.length || rawStreams[0]?.data?.length || 1;
        const step = Math.max(1, Math.floor(baseLen / 500));

        for (const s of rawStreams) {
          if (!s || !s.type || !Array.isArray(s.data)) continue;
          if (s.type === 'latlng' && Array.isArray(s.data2)) {
            const latArr = s.data;
            const lngArr = s.data2;
            const paired: [number, number][] = [];
            for (let idx = 0; idx < latArr.length; idx += step) {
              const lat = latArr[idx];
              const lng = lngArr[idx];
              if (
                lat != null &&
                lng != null &&
                !Number.isNaN(lat) &&
                !Number.isNaN(lng) &&
                Math.abs(lat) > 0.01
              ) {
                paired.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
              } else if (paired.length > 0) {
                paired.push(paired[paired.length - 1]);
              }
            }
            if (paired.length > 2) {
              downsampledLatLng = paired;
              const routesCache = loadJsonFile<Record<string, [number, number][]>>(
                ROUTES_BY_ACTIVITY_CACHE_FILE,
                {}
              );
              const compactStep = Math.max(1, Math.floor(paired.length / 160));
              routesCache[String(activityId)] = paired.filter((_, i) => i % compactStep === 0);
              saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
            }
          } else {
            streamMap[s.type] = s.data.filter((_, idx) => idx % step === 0);
          }
        }
      }
    }

    let intervals: any[] = [];
    let detailJson: Record<string, any> = {};
    if (detailResp.ok) {
      detailJson = (await detailResp.json()) as Record<string, any>;
      if (Array.isArray(detailJson.icu_intervals)) {
        intervals = detailJson.icu_intervals.map((iv: any, idx: number) => {
          const dist = Number(iv.distance || 0);
          const dur = Number(iv.moving_time || iv.elapsed_time || 0);
          const avgSpeed = Number(iv.average_speed || 0);
          const gapSpeed = Number(iv.gap || avgSpeed);
          return {
            id: String(iv.id || `iv-${idx}`),
            type: iv.type === 'WORK' ? 'WORK' : 'RECOVERY',
            label:
              iv.label ||
              iv.group_id ||
              (iv.type === 'WORK' ? `Work Interval #${idx + 1}` : `Recovery #${idx + 1}`),
            startTimeSecs: Number(iv.start_time || 0),
            durationSecs: dur,
            distanceMeters: Math.round(dist),
            avgWatts: iv.average_watts ? Math.round(Number(iv.average_watts)) : undefined,
            weightedAvgWatts: iv.weighted_average_watts
              ? Math.round(Number(iv.weighted_average_watts))
              : undefined,
            intensityPct: iv.intensity ? Math.round(Number(iv.intensity)) : undefined,
            zone: iv.zone ? Number(iv.zone) : undefined,
            avgHr: iv.average_heartrate ? Math.round(Number(iv.average_heartrate)) : undefined,
            maxHr: iv.max_heartrate ? Math.round(Number(iv.max_heartrate)) : undefined,
            avgPaceSecsPerKm: avgSpeed > 0 ? Math.round(1000 / avgSpeed) : undefined,
            gapPaceSecsPerKm: gapSpeed > 0 ? Math.round(1000 / gapSpeed) : undefined,
            avgCadence: iv.average_cadence ? Math.round(Number(iv.average_cadence)) : undefined,
            decouplingPct:
              iv.decoupling != null ? Number(Number(iv.decoupling).toFixed(1)) : undefined,
            strideLengthMeters: iv.average_stride
              ? Number(Number(iv.average_stride).toFixed(2))
              : undefined,
          };
        });
      }
    }

    let segmentEfforts: any[] = [];
    if (segmentsResp.ok) {
      const rawSegments = (await segmentsResp.json()) as any[];
      const rawType = String(detailJson.type || '');
      const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType)
        ? 'Running'
        : 'Cycling';
      segmentEfforts = computeIntervalsSegmentEfforts(rawSegments, rawStreamsList, {
        id: String(activityId),
        name: String(detailJson.name || rawType || sportCategory),
        startDateLocal: String(detailJson.start_date_local || ''),
        sportCategory,
        avgHr: detailJson.average_heartrate
          ? Math.round(Number(detailJson.average_heartrate))
          : undefined,
      });
      if (segmentEfforts.length > 0) {
        const segmentsCache = loadJsonFile<Record<string, any[]>>(
          SEGMENTS_BY_ACTIVITY_CACHE_FILE,
          {}
        );
        segmentsCache[String(activityId)] = segmentEfforts;
        saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
      }
    }

    res.json({
      streams: {
        time: streamMap.time || [],
        distance: streamMap.distance,
        latlng: downsampledLatLng,
        watts: streamMap.watts,
        heartrate: streamMap.heartrate,
        velocitySmooth: streamMap.velocity_smooth,
        cadence: streamMap.cadence,
        altitude: streamMap.altitude,
      },
      intervals,
      segmentEfforts,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load activity streams and intervals',
    });
  }
});

// Training Calendar Planned Events API (Vault + Local + Sync to Intervals.icu / Garmin)
intervalsRouter.get('/api/calendar/events', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (cloud && cloud.plannedEvents.length > 0) {
    res.json({ events: cloud.plannedEvents });
    return;
  }
  if (!scopedFile) {
    res.json({ events: [] });
    return;
  }
  const localPlanned = loadJsonFile<any[]>(scopedFile, []);
  res.json({ events: localPlanned });
});

intervalsRouter.post('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const name = String(body.name || 'Structured Workout');
    const sportCategory = body.sportCategory || 'Cycling';
    const environmentPreference = body.environmentPreference || 'FLEXIBLE';
    const plannedDurationSecs = Number(body.plannedDurationSecs || 3600);
    const plannedLoad = Number(body.plannedLoad || 65);
    const workoutSyntax = String(
      body.workoutSyntax ||
        body.description ||
        `- 10m 60% FTP\n- ${Math.max(15, Math.round(plannedDurationSecs / 60) - 20)}m 85% FTP\n- 10m 55% FTP`
    );

    const newEvent = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      name,
      sportCategory,
      environmentPreference,
      description: String(body.description || workoutSyntax),
      plannedLoad,
      plannedDurationSecs,
      targetZoneSummary: String(body.targetZoneSummary || `${plannedLoad} TSS Planned`),
      workoutSyntax,
      structuredSteps:
        Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0
          ? body.structuredSteps
          : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs),
      ...(body.trackSpec && typeof body.trackSpec === 'object' ? { trackSpec: body.trackSpec } : {}),
      ...(body.planBlockId ? { planBlockId: String(body.planBlockId) } : {}),
      ...(body.planBlockName ? { planBlockName: String(body.planBlockName) } : {}),
      ...(typeof body.planWeekNum === 'number' ? { planWeekNum: body.planWeekNum } : {}),
      source: body.source || 'USER',
    };

    const scopedFile = getScopedPlannedEventsFile(req);
    const cloud = await loadAthleteCloudState(req);
    const existingLocal = scopedFile ? loadJsonFile<any[]>(scopedFile, []) : [];
    const existing =
      cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
    const updated = [newEvent, ...existing];
    if (scopedFile) {
      saveJsonFile(scopedFile, updated);
    }
    await saveAthleteCloudState(req, { plannedEvents: updated });

    // Also push to Intervals.icu Calendar if connected and requested
    const intervalsConfig = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(intervalsConfig);
    let pushedToIntervals = false;
    if (intervalsAuth && body.syncToIntervals !== false) {
      try {
        const authHeader = intervalsAuth;
        const athleteId = intervalsConfig.athleteId || '0';
        const icuType =
          sportCategory === 'Running'
            ? 'Run'
            : environmentPreference === 'INDOOR'
              ? 'VirtualRide'
              : 'Ride';
        const icuResp = await fetch(
          `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              category: 'WORKOUT',
              start_date_local: `${date}T08:00:00`,
              name,
              type: icuType,
              description: workoutSyntax,
              moving_time: plannedDurationSecs,
              icu_training_load: plannedLoad,
            }),
          }
        );
        pushedToIntervals = icuResp.ok;
      } catch {
        // Non-fatal if user API key is read-only
      }
    }

    // Also push directly to Garmin Connect Calendar if Direct Garmin is connected
    let pushedToGarmin = false;
    let garminWorkoutId: string | number | undefined;
    const garminSession = getActiveGarminSession(req);
    if (garminSession && body.syncToGarmin !== false) {
      try {
        const garminSteps = (newEvent.structuredSteps || []).map((st: any) => ({
          label: st.label || 'Interval',
          durationSecs: Number(st.durationSecs || 600),
          targetPctFtp: Number(st.targetPctFtp || 75),
        }));
        const garminRes = await pushWorkoutToGarminConnect(garminSession, {
          date,
          name,
          sportCategory,
          description: newEvent.description,
          ftpWatts: Number(body.ftpWatts || runtimeStore.athleteProfile?.ftp || 250),
          lthrBpm: Number(body.lthrBpm || runtimeStore.athleteProfile?.lthr || 165),
          steps: garminSteps,
        });
        pushedToGarmin = garminRes.pushed;
        garminWorkoutId = garminRes.workoutId;
        saveGarminSession(GARMIN_SESSION_DIR, getGarminScopeKey(req), garminSession);
      } catch {
        // Non-fatal if Garmin token expired
      }
    }

    res.json({
      event: newEvent,
      pushedToGarmin,
      garminWorkoutId,
      pushedToIntervals,
      events: updated,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to schedule workout event',
    });
  }
});

intervalsRouter.put('/api/calendar/events/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const body = req.body || {};
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  const nextSyntax = typeof body.workoutSyntax === 'string' ? body.workoutSyntax : undefined;
  const nextDurationSecs =
    typeof body.plannedDurationSecs === 'number' ? body.plannedDurationSecs : 3600;
  if (!scopedFile && !cloud) {
    res.json({ updated: true, event: { id, ...body } });
    return;
  }
  const existingLocal = scopedFile ? loadJsonFile<any[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const idx = existing.findIndex((e) => e.id === id);
  const patched = {
    ...(idx >= 0 ? existing[idx] : {}),
    ...body,
    id,
    ...(nextSyntax
      ? {
          structuredSteps:
            Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0
              ? body.structuredSteps
              : parseWorkoutSyntaxToSteps(nextSyntax, nextDurationSecs),
        }
      : {}),
  };
  const updated =
    idx >= 0 ? existing.map((e, i) => (i === idx ? patched : e)) : [patched, ...existing];
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ updated: true, event: patched, events: updated });
});

intervalsRouter.delete('/api/calendar/blocks/:blockId', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const blockId = req.params.blockId;
  const existingLocal = scopedFile ? loadJsonFile<any[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.planBlockId !== blockId);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});

intervalsRouter.delete('/api/calendar/events/:id', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const id = req.params.id;
  const existingLocal = scopedFile ? loadJsonFile<any[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.id !== id);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});
