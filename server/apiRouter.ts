import express, { Request, Response } from 'express';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';

export const apiRouter = express.Router();

const SESSION_CACHE_FILE = '/tmp/aeropulse-runtime-session.json';
const STRAVA_ARCHIVE_CACHE_FILE = '/tmp/aeropulse-strava-archive.json';
const PLANNED_EVENTS_CACHE_FILE = '/tmp/aeropulse-planned-events.json';

interface RuntimeSessionStore {
  intervalsApiKey: string;
  intervalsAthleteId: string;
  intervalsAthleteName: string;
  stravaClientId: string;
  stravaClientSecret: string;
  stravaAccessToken: string;
  stravaRefreshToken: string;
  stravaExpiresAt: number;
  stravaAthleteName: string;
  lastSyncedAt: string;
  nextHourlySyncAt: string;
  totalActivitiesCount: number;
  earliestActivityDate: string;
  garminActivitiesCount: number;
  stravaActivitiesCount: number;
  redactedStravaCount: number;
  athleteFtp: number;
  athleteIndoorFtp: number;
  athleteRunFtp: number;
  athleteLthr: number;
  athleteMaxHr: number;
  gearItems: {
    id: string;
    name: string;
    type: 'BIKE' | 'SHOE';
    distanceMeters: number;
    maxRecommendedMeters: number;
    primary: boolean;
  }[];
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    // ignore read error
  }
  return fallback;
}

function saveJsonFile(filePath: string, data: unknown) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // ignore write error
  }
}

const cachedSession = loadJsonFile<Partial<RuntimeSessionStore>>(SESSION_CACHE_FILE, {});

const runtimeStore: RuntimeSessionStore = {
  intervalsApiKey: cachedSession.intervalsApiKey || process.env.INTERVALS_API_KEY || '',
  intervalsAthleteId: cachedSession.intervalsAthleteId || process.env.INTERVALS_ATHLETE_ID || '0',
  intervalsAthleteName: cachedSession.intervalsAthleteName || '',
  stravaClientId: cachedSession.stravaClientId || process.env.STRAVA_CLIENT_ID || '',
  stravaClientSecret: cachedSession.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || '',
  stravaAccessToken: cachedSession.stravaAccessToken || '',
  stravaRefreshToken: cachedSession.stravaRefreshToken || '',
  stravaExpiresAt: cachedSession.stravaExpiresAt || 0,
  stravaAthleteName: cachedSession.stravaAthleteName || '',
  lastSyncedAt: cachedSession.lastSyncedAt || new Date().toISOString(),
  nextHourlySyncAt:
    cachedSession.nextHourlySyncAt || new Date(Date.now() + 3600 * 1000).toISOString(),
  totalActivitiesCount: cachedSession.totalActivitiesCount || 0,
  earliestActivityDate: cachedSession.earliestActivityDate || '',
  garminActivitiesCount: cachedSession.garminActivitiesCount || 0,
  stravaActivitiesCount: cachedSession.stravaActivitiesCount || 0,
  redactedStravaCount: cachedSession.redactedStravaCount || 0,
  athleteFtp: cachedSession.athleteFtp || 300,
  athleteIndoorFtp: cachedSession.athleteIndoorFtp || 300,
  athleteRunFtp: cachedSession.athleteRunFtp || 420,
  athleteLthr: cachedSession.athleteLthr || 163,
  athleteMaxHr: cachedSession.athleteMaxHr || 180,
  gearItems: cachedSession.gearItems || [],
};

function saveSessionCache() {
  saveJsonFile(SESSION_CACHE_FILE, runtimeStore);
}

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getEffectiveIntervalsConfig(req?: Request) {
  const headerKey = req?.headers['x-intervals-api-key'] as string | undefined;
  const headerAthlete = req?.headers['x-intervals-athlete-id'] as string | undefined;
  const apiKey = (
    headerKey ||
    runtimeStore.intervalsApiKey ||
    process.env.INTERVALS_API_KEY ||
    ''
  ).trim();
  const athleteId =
    (
      headerAthlete ||
      runtimeStore.intervalsAthleteId ||
      process.env.INTERVALS_ATHLETE_ID ||
      '0'
    ).trim() || '0';
  return { apiKey, athleteId };
}

function getEffectiveStravaClientConfig(req?: Request) {
  const headerClientId = req?.headers['x-strava-client-id'] as string | undefined;
  const headerClientSecret = req?.headers['x-strava-client-secret'] as string | undefined;
  const clientId = (
    headerClientId ||
    runtimeStore.stravaClientId ||
    process.env.STRAVA_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (
    headerClientSecret ||
    runtimeStore.stravaClientSecret ||
    process.env.STRAVA_CLIENT_SECRET ||
    ''
  ).trim();
  return { clientId, clientSecret };
}

function resolveCallbackUrl(req: Request): string {
  const explicitOrigin = (req.query.origin as string | undefined)?.replace(/\/$/, '');
  if (explicitOrigin) {
    return `${explicitOrigin}/auth/strava/callback`;
  }
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/strava/callback`;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}/auth/strava/callback`;
}

// Parse Intervals.icu workout syntax into structured visual steps
export function parseWorkoutSyntaxToSteps(syntax: string, fallbackDurationSecs = 3600) {
  const lines = (syntax || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  if (lines.length === 0) {
    return [
      {
        label: 'Warmup',
        durationSecs: Math.round(fallbackDurationSecs * 0.2),
        duration: `${Math.round((fallbackDurationSecs * 0.2) / 60)}m`,
        targetPctFtp: 60,
        targetZoneOrOutput: '60% FTP · Z1-Z2',
      },
      {
        label: 'Main Set',
        durationSecs: Math.round(fallbackDurationSecs * 0.65),
        duration: `${Math.round((fallbackDurationSecs * 0.65) / 60)}m`,
        targetPctFtp: 88,
        targetZoneOrOutput: '85–92% FTP · Z3/Z4',
      },
      {
        label: 'Cooldown',
        durationSecs: Math.round(fallbackDurationSecs * 0.15),
        duration: `${Math.round((fallbackDurationSecs * 0.15) / 60)}m`,
        targetPctFtp: 55,
        targetZoneOrOutput: '55% FTP · Z1',
      },
    ];
  }

  return lines.map((line, idx) => {
    const clean = line.replace(/^-+\s*/, '');
    const minMatch = clean.match(/(\d+)\s*m/i);
    const secMatch = clean.match(/(\d+)\s*s/i);
    const pctMatch = clean.match(/(\d+)\s*%/);
    const wattsMatch = clean.match(/(\d+)\s*w/i);
    const mins = minMatch ? Number(minMatch[1]) : secMatch ? Math.max(1, Math.round(Number(secMatch[1]) / 60)) : 10;
    const secs = secMatch && !minMatch ? Number(secMatch[1]) : mins * 60;
    const pct = pctMatch ? Number(pctMatch[1]) : wattsMatch ? Math.round((Number(wattsMatch[1]) / 300) * 100) : 75;
    return {
      label: clean.split(/\d+[ms]/i)[0]?.trim() || `Step ${idx + 1}`,
      durationSecs: secs,
      duration: minMatch ? `${mins}m` : `${secs}s`,
      targetPctFtp: pct,
      targetZoneOrOutput: clean,
    };
  });
}

// ----------------------------------------------------------------------------
// 1. Configuration & Connection Status
// ----------------------------------------------------------------------------
apiRouter.get('/api/config/status', (req: Request, res: Response) => {
  const { apiKey: intervalsKey, athleteId } = getEffectiveIntervalsConfig(req);
  const { clientId: stravaClientId } = getEffectiveStravaClientConfig(req);
  const hasIntervalsEnv = Boolean(
    process.env.INTERVALS_API_KEY && process.env.INTERVALS_API_KEY.trim()
  );
  const hasStravaEnv = Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  const hasGeminiServerKey = Boolean(
    process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
      process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY'
  );

  res.json({
    intervalsConnected: Boolean(intervalsKey),
    intervalsAthleteId: athleteId,
    intervalsAthleteName: runtimeStore.intervalsAthleteName || undefined,
    intervalsSource: hasIntervalsEnv ? 'ENV' : intervalsKey ? 'USER_INPUT' : 'NONE',
    stravaConfigured: Boolean(stravaClientId),
    stravaClientId: stravaClientId || undefined,
    stravaConnected: Boolean(runtimeStore.stravaAccessToken),
    stravaAthleteName: runtimeStore.stravaAthleteName || undefined,
    stravaSource: runtimeStore.stravaAccessToken ? 'OAUTH' : hasStravaEnv ? 'ENV' : 'NONE',
    hasGeminiServerKey,
    lastSyncedAt: runtimeStore.lastSyncedAt,
    nextHourlySyncAt: runtimeStore.nextHourlySyncAt,
    autoSyncCronActive: true,
    totalActivitiesCount: runtimeStore.totalActivitiesCount,
    earliestActivityDate: runtimeStore.earliestActivityDate,
    garminActivitiesCount: runtimeStore.garminActivitiesCount,
    stravaActivitiesCount: runtimeStore.stravaActivitiesCount,
    redactedStravaCount: runtimeStore.redactedStravaCount,
    athleteFtp: runtimeStore.athleteFtp,
    athleteIndoorFtp: runtimeStore.athleteIndoorFtp,
    athleteRunFtp: runtimeStore.athleteRunFtp,
    athleteLthr: runtimeStore.athleteLthr,
    athleteMaxHr: runtimeStore.athleteMaxHr,
    gearItems: runtimeStore.gearItems,
    callbackUrl: resolveCallbackUrl(req),
  });
});

// ----------------------------------------------------------------------------
// 2. Intervals.icu Integration (All-Time History, Garmin Sleep/HRV/Training Status, Intervals)
// ----------------------------------------------------------------------------
apiRouter.post('/api/intervals/connect', async (req: Request, res: Response) => {
  try {
    const apiKey = (req.body?.apiKey || process.env.INTERVALS_API_KEY || '').trim();
    const athleteId = (req.body?.athleteId || process.env.INTERVALS_ATHLETE_ID || '0').trim() || '0';

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
      const errText = await profileResp.text();
      res.status(profileResp.status).json({
        error: `Intervals.icu authentication failed (${profileResp.status}). Verify your Athlete ID (use "0" for default) and API Key at https://intervals.icu/settings. Details: ${errText.slice(0, 140)}`,
      });
      return;
    }

    const profileData = (await profileResp.json()) as Record<string, any>;
    const resolvedId = profileData.id || athleteId;
    const resolvedName =
      profileData.name ||
      [profileData.firstname, profileData.lastname].filter(Boolean).join(' ') ||
      `Athlete ${resolvedId}`;

    runtimeStore.intervalsApiKey = apiKey;
    runtimeStore.intervalsAthleteId = resolvedId;
    runtimeStore.intervalsAthleteName = resolvedName;
    saveSessionCache();

    res.json({
      connected: true,
      athleteId: resolvedId,
      athleteName: resolvedName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect to Intervals.icu',
    });
  }
});

apiRouter.post('/api/intervals/disconnect', (_req: Request, res: Response) => {
  runtimeStore.intervalsApiKey = '';
  runtimeStore.intervalsAthleteName = '';
  saveSessionCache();
  res.json({ connected: false });
});

async function syncIntervalsAllHistory(apiKey: string, athleteId: string) {
  const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const now = new Date();
  const newest = now.toISOString().slice(0, 10);
  const futureEventsDate = new Date(now);
  futureEventsDate.setUTCDate(futureEventsDate.getUTCDate() + 90);
  const newestEvents = futureEventsDate.toISOString().slice(0, 10);
  const oldestEventsDate = new Date(now);
  oldestEventsDate.setUTCDate(oldestEventsDate.getUTCDate() - 180);
  const oldestEvents = oldestEventsDate.toISOString().slice(0, 10);

  // Fetch All-Time Activities (since 2010-01-01), All-Time Wellness (since 2018-01-01), Athlete Profile/Gear, and Calendar Events
  const [profileResp, wellnessResp, activitiesResp, eventsResp] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=2018-01-01&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=2010-01-01&newest=${newest}`,
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
  if (profileResp.ok) {
    const profile = (await profileResp.json()) as Record<string, any>;
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
  let lastValidWeight = 70.0;
  let lastValidVo2 = 50;
  let lastValidRhr = 49;

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

  // Normalize all-time Garmin / Intervals.icu Activities
  const seenStravaIds = new Set<string>();
  const activities = rawActivities
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
      let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' = 'Strength';
      if (
        /ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|trackride|cyclocross/i.test(
          rawType
        )
      ) {
        sportCategory = 'Cycling';
      } else if (/run|trailrun|virtualrun|treadmill/i.test(rawType)) {
        sportCategory = 'Running';
      } else if (/swim|openwater/i.test(rawType)) {
        sportCategory = 'Swimming';
      } else if (/triathlon|multisport|brick|transition/i.test(rawType)) {
        sportCategory = 'Multisport';
      } else {
        sportCategory = 'Strength';
      }

      const isIndoor =
        Boolean(a.trainer) ||
        /virtual|indoor|treadmill|zwift|trainer|spinning|gym|weight|hiit|workout|yoga|pool/i.test(
          rawType
        ) ||
        /virtual|indoor|treadmill|zwift|trainer|peloton|wahoo|rouvy/i.test(String(a.name || ''));

      let subType:
        | 'Road'
        | 'Trail'
        | 'Gravel'
        | 'Smart Trainer'
        | 'Treadmill'
        | 'Pool'
        | 'Open Water'
        | 'Gym' = 'Road';
      if (sportCategory === 'Cycling') {
        if (isIndoor) subType = 'Smart Trainer';
        else if (/gravel/i.test(rawType) || /gravel/i.test(String(a.name || ''))) subType = 'Gravel';
        else if (/mountain|mtb|trail/i.test(rawType)) subType = 'Trail';
        else subType = 'Road';
      } else if (sportCategory === 'Running') {
        if (isIndoor) subType = 'Treadmill';
        else if (/trail/i.test(rawType) || /trail/i.test(String(a.name || ''))) subType = 'Trail';
        else subType = 'Road';
      } else if (sportCategory === 'Swimming') {
        subType = /open/i.test(rawType) ? 'Open Water' : 'Pool';
      } else {
        subType = 'Gym';
      }

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
          : avgPaceSecsPerKm;

      const ef =
        a.icu_efficiency_factor != null
          ? Number(Number(a.icu_efficiency_factor).toFixed(2))
          : normalizedPower && avgHr > 0
            ? Number((Number(normalizedPower) / avgHr).toFixed(2))
            : 0;
      const decoupling = a.decoupling != null ? Number(Number(a.decoupling).toFixed(1)) : 0;

      // Resolve gear name if gear_id matches profile bikes/shoes
      let resolvedGearName = a.gear?.name || undefined;
      if (!resolvedGearName && a.gear_id && runtimeStore.gearItems.length > 0) {
        const foundGear = runtimeStore.gearItems.find((g) => g.id === String(a.gear_id));
        if (foundGear) resolvedGearName = foundGear.name;
      }

      return {
        id: String(a.id),
        intervalsId: String(a.id),
        stravaId: a.strava_id ? String(a.strava_id) : undefined,
        startDateLocal: String(a.start_date_local),
        name: String(a.name || rawType || sportCategory),
        sportCategory,
        environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
        subType,
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
        avgPower: avgPower ? Math.round(Number(avgPower)) : undefined,
        normalizedPower: normalizedPower ? Math.round(Number(normalizedPower)) : undefined,
        intensityFactor: a.icu_intensity
          ? Number((Number(a.icu_intensity) / 100).toFixed(2))
          : undefined,
        variabilityIndex: a.icu_variability_index
          ? Number(Number(a.icu_variability_index).toFixed(2))
          : undefined,
        trainingLoad: Math.round(Number(a.icu_training_load ?? 0)),
        avgHr: Math.round(avgHr),
        maxHr: Math.round(maxHr),
        avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm,
        aerobicDecouplingPct: decoupling,
        efficiencyFactor: ef,
        firstHalfEf: ef > 0 ? Number((ef * (1 + decoupling / 200)).toFixed(2)) : 0,
        secondHalfEf: ef > 0 ? Number((ef * (1 - decoupling / 200)).toFixed(2)) : 0,
        calories: a.calories ? Math.round(Number(a.calories)) : undefined,
        deviceName: a.device_name ? String(a.device_name) : undefined,
        zoneSecs: {
          hr: Array.isArray(a.icu_hr_zone_times)
            ? a.icu_hr_zone_times.slice(0, 7)
            : [0, 0, 0, 0, 0, 0, 0],
          power: Array.isArray(a.icu_zone_times)
            ? a.icu_zone_times
                .slice(0, 7)
                .map((z: any) => (typeof z === 'number' ? z : Number(z?.secs ?? 0)))
            : undefined,
        },
        gearName: resolvedGearName,
        stravaPrCount: Number(a.pr_count ?? 0),
        segmentEfforts: [],
        sourceBadges: (a.source === 'GARMIN_CONNECT'
          ? ['Intervals.icu', 'Garmin']
          : ['Intervals.icu']) as ('Intervals.icu' | 'Garmin' | 'Strava')[],
      };
    });

  // Merge user-created local planned workouts with Intervals.icu calendar events
  const localPlanned = loadJsonFile<any[]>(PLANNED_EVENTS_CACHE_FILE, []);
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

  runtimeStore.garminActivitiesCount = activities.length;
  runtimeStore.redactedStravaCount = redactedStravaCount;
  runtimeStore.totalActivitiesCount = activities.length + runtimeStore.stravaActivitiesCount;
  runtimeStore.earliestActivityDate =
    activities.length > 0
      ? activities[activities.length - 1].startDateLocal.slice(0, 10)
      : runtimeStore.earliestActivityDate;
  runtimeStore.lastSyncedAt = new Date().toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1000).toISOString();
  saveSessionCache();

  return {
    wellnessDays,
    activities,
    plannedEvents,
    redactedStravaCount,
    athleteProfile: {
      ftp: runtimeStore.athleteFtp,
      indoorFtp: runtimeStore.athleteIndoorFtp,
      runFtp: runtimeStore.athleteRunFtp,
      lthr: runtimeStore.athleteLthr,
      maxHr: runtimeStore.athleteMaxHr,
      gearItems: runtimeStore.gearItems,
    },
    syncedAt: runtimeStore.lastSyncedAt,
    nextHourlySyncAt: runtimeStore.nextHourlySyncAt,
  };
}

apiRouter.get('/api/intervals/sync', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }
    const payload = await syncIntervalsAllHistory(apiKey, athleteId);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Intervals.icu data',
    });
  }
});

// Fetch both second-by-second streams AND auto-detected Intervals.icu intervals / lap splits
apiRouter.get('/api/intervals/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const { apiKey } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const activityId = req.params.id;
    const [streamsResp, detailResp] = await Promise.all([
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=time,watts,heartrate,velocity_smooth,cadence,altitude`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      ),
    ]);

    const streamMap: Record<string, number[]> = {};
    if (streamsResp.ok) {
      const rawStreams = (await streamsResp.json()) as { type: string; data: number[] }[];
      if (Array.isArray(rawStreams)) {
        for (const s of rawStreams) {
          if (s && s.type && Array.isArray(s.data)) {
            const step = Math.max(1, Math.floor(s.data.length / 100));
            streamMap[s.type] = s.data.filter((_, idx) => idx % step === 0);
          }
        }
      }
    }

    let intervals: any[] = [];
    if (detailResp.ok) {
      const detailJson = (await detailResp.json()) as Record<string, any>;
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

    res.json({
      streams: {
        time: streamMap.time || [],
        watts: streamMap.watts,
        heartrate: streamMap.heartrate,
        velocitySmooth: streamMap.velocity_smooth,
        cadence: streamMap.cadence,
        altitude: streamMap.altitude,
      },
      intervals,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load activity streams and intervals',
    });
  }
});

// ----------------------------------------------------------------------------
// 3. Training Calendar Planned Events API (Local + Sync to Intervals.icu / Garmin)
// ----------------------------------------------------------------------------
apiRouter.get('/api/calendar/events', (_req: Request, res: Response) => {
  const localPlanned = loadJsonFile<any[]>(PLANNED_EVENTS_CACHE_FILE, []);
  res.json({ events: localPlanned });
});

apiRouter.post('/api/calendar/events', async (req: Request, res: Response) => {
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
      source: body.source || 'USER',
    };

    const existing = loadJsonFile<any[]>(PLANNED_EVENTS_CACHE_FILE, []);
    const updated = [newEvent, ...existing];
    saveJsonFile(PLANNED_EVENTS_CACHE_FILE, updated);

    // Also push to Intervals.icu Calendar if connected and requested
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    let pushedToIntervals = false;
    if (apiKey && body.syncToIntervals !== false) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
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

    res.json({ event: newEvent, pushedToIntervals, events: updated });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to schedule workout event',
    });
  }
});

apiRouter.delete('/api/calendar/events/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const existing = loadJsonFile<any[]>(PLANNED_EVENTS_CACHE_FILE, []);
  const updated = existing.filter((e) => e.id !== id);
  saveJsonFile(PLANNED_EVENTS_CACHE_FILE, updated);
  res.json({ deleted: true, events: updated });
});

// ----------------------------------------------------------------------------
// 4. Strava OAuth2 & All-Time Multi-Page Historical Activity Sync
// ----------------------------------------------------------------------------
apiRouter.post('/api/strava/credentials', (req: Request, res: Response) => {
  const clientId = (req.body?.clientId || '').trim();
  const clientSecret = (req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'Both Strava Client ID and Client Secret are required.' });
    return;
  }
  runtimeStore.stravaClientId = clientId;
  runtimeStore.stravaClientSecret = clientSecret;
  saveSessionCache();
  res.json({ saved: true, clientId });
});

apiRouter.get('/api/strava/auth/url', (req: Request, res: Response) => {
  const { clientId } = getEffectiveStravaClientConfig(req);
  if (!clientId) {
    res.status(400).json({
      error:
        'Strava Client ID is not configured yet. Enter your Strava Client ID & Secret in the Data Sources modal or set STRAVA_CLIENT_ID in your environment variables.',
    });
    return;
  }

  const mode = String(req.query.mode || 'cloud').toLowerCase();
  const redirectUri =
    mode === 'localhost' ? 'http://localhost/exchange_token' : resolveCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'force',
    scope: 'read,activity:read_all,profile:read_all',
  });

  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId });
});

async function exchangeStravaAuthCode(codeInput: string, req?: Request) {
  let code = codeInput.trim();
  // Allow user to paste either a full URL (http://localhost/exchange_token?state=&code=XYZ&scope=...) or raw code
  if (code.includes('code=')) {
    try {
      const urlObj = new URL(code.startsWith('http') ? code : `http://localhost/${code}`);
      const extracted = urlObj.searchParams.get('code');
      if (extracted) code = extracted.trim();
    } catch {
      const match = code.match(/[?&]code=([^&]+)/);
      if (match?.[1]) code = decodeURIComponent(match[1]).trim();
    }
  }

  if (!code) {
    throw new Error('Missing authorization code from Strava.');
  }

  const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
  if (!clientId || !clientSecret) {
    throw new Error(
      'Strava Client ID and Client Secret are required to exchange an authorization code.'
    );
  }

  const tokenResp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Strava token exchange failed: ${errText}`);
  }

  const tokenData = (await tokenResp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: { firstname?: string; lastname?: string };
  };

  runtimeStore.stravaAccessToken = tokenData.access_token;
  runtimeStore.stravaRefreshToken = tokenData.refresh_token;
  runtimeStore.stravaExpiresAt = tokenData.expires_at;
  runtimeStore.stravaAthleteName =
    [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ') ||
    'Strava Athlete';
  saveSessionCache();
  return tokenData;
}

apiRouter.post('/api/strava/exchange-code', async (req: Request, res: Response) => {
  try {
    const codeOrUrl = String(req.body?.code || req.body?.url || '').trim();
    const tokenData = await exchangeStravaAuthCode(codeOrUrl, req);
    res.json({
      connected: true,
      athleteName: runtimeStore.stravaAthleteName,
      expiresAt: tokenData.expires_at,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to exchange Strava authorization code',
    });
  }
});

apiRouter.post('/api/strava/token', async (req: Request, res: Response) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);

    if (!refreshToken && !accessToken) {
      res
        .status(400)
        .json({ error: 'Provide either a Strava Refresh Token or Access Token.' });
      return;
    }

    if (refreshToken && clientId && clientSecret) {
      const refreshResp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });
      if (refreshResp.ok) {
        const refreshed = (await refreshResp.json()) as {
          access_token: string;
          refresh_token: string;
          expires_at: number;
        };
        runtimeStore.stravaAccessToken = refreshed.access_token;
        runtimeStore.stravaRefreshToken = refreshed.refresh_token || refreshToken;
        runtimeStore.stravaExpiresAt = refreshed.expires_at;
      } else if (accessToken) {
        runtimeStore.stravaAccessToken = accessToken;
        runtimeStore.stravaRefreshToken = refreshToken;
        runtimeStore.stravaExpiresAt = Math.floor(Date.now() / 1000) + 21600;
      } else {
        const errText = await refreshResp.text();
        res.status(400).json({ error: `Strava token refresh failed: ${errText}` });
        return;
      }
    } else if (accessToken) {
      runtimeStore.stravaAccessToken = accessToken;
      if (refreshToken) runtimeStore.stravaRefreshToken = refreshToken;
      runtimeStore.stravaExpiresAt = Math.floor(Date.now() / 1000) + 21600;
    } else {
      res.status(400).json({
        error:
          'Save your Strava Client ID & Secret first to use a Refresh Token, or also provide an Access Token.',
      });
      return;
    }

    // Verify token against Strava athlete profile AND activity:read permission
    const [athleteResp, actCheckResp] = await Promise.all([
      fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` },
      }),
      fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1', {
        headers: { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` },
      }),
    ]);

    if (!actCheckResp.ok) {
      const errBody = await actCheckResp.text();
      if (errBody.includes('activity:read_permission')) {
        runtimeStore.stravaAccessToken = '';
        runtimeStore.stravaRefreshToken = '';
        saveSessionCache();
        res.status(400).json({
          error:
            "Strava's default API settings token only has profile 'read' scope (missing 'activity:read_all'). Use Method B ('1. Authorize with localhost Redirect' → click Authorize → paste the localhost URL) or Method A above to grant activity read permission.",
        });
        return;
      }
    }

    if (athleteResp.ok) {
      const athlete = (await athleteResp.json()) as { firstname?: string; lastname?: string };
      runtimeStore.stravaAthleteName =
        [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') || 'Strava Athlete';
    }
    saveSessionCache();
    res.json({
      connected: true,
      athleteName: runtimeStore.stravaAthleteName || 'Strava Athlete',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to verify Strava token',
    });
  }
});

const stravaCallbackHandler = async (req: Request, res: Response) => {
  try {
    const oauthErr = req.query.error as string | undefined;
    if (oauthErr) {
      res.status(400).send(`Strava authorization declined or failed: ${oauthErr}`);
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send('Missing authorization code from Strava.');
      return;
    }

    await exchangeStravaAuthCode(code, req);

    res.send(`
      <!doctype html>
      <html>
        <head><title>Strava Connected</title></head>
        <body style="font-family: system-ui, sans-serif; background: #0B0F17; color: #F8FAFC; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 24px;">
          <div style="background: #111827; border: 1px solid #1E293B; border-radius: 12px; padding: 28px; max-width: 420px;">
            <h2 style="margin: 0 0 8px; color: #10B981; font-size: 18px;">Strava Connected Successfully</h2>
            <p style="margin: 0 0 18px; color: #94A3B8; font-size: 13px; line-height: 1.5;">
              AeroPulse is now syncing your complete Strava history in the main application window. You can close this popup window.
            </p>
            <button onclick="window.close()" style="background: #FC4C02; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-weight: 600; font-size: 13px; cursor: pointer;">
              Close Popup Window
            </button>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'strava' }, '*');
              }
            } catch (e) {}
            try {
              var bc = new BroadcastChannel('aeropulse_oauth');
              bc.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'strava' });
            } catch (e) {}
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 600);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(
      `Strava callback error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

apiRouter.get(['/auth/strava/callback', '/auth/strava/callback/'], stravaCallbackHandler);

async function syncStravaAllHistory(req?: Request, forceFull = false) {
  if (!runtimeStore.stravaAccessToken) {
    throw new Error('Strava is not connected via OAuth yet.');
  }

  // Refresh token if expired
  const nowSecs = Math.floor(Date.now() / 1000);
  if (
    runtimeStore.stravaExpiresAt &&
    nowSecs >= runtimeStore.stravaExpiresAt - 60 &&
    runtimeStore.stravaRefreshToken
  ) {
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    const refreshResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: runtimeStore.stravaRefreshToken,
      }),
    });
    if (refreshResp.ok) {
      const refreshed = (await refreshResp.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      runtimeStore.stravaAccessToken = refreshed.access_token;
      runtimeStore.stravaRefreshToken = refreshed.refresh_token;
      runtimeStore.stravaExpiresAt = refreshed.expires_at;
      saveSessionCache();
    }
  }

  const headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
  const cachedArchive = loadJsonFile<Record<string, any>[]>(STRAVA_ARCHIVE_CACHE_FILE, []);

  let rawActivitiesMap = new Map<string, Record<string, any>>();
  for (const item of cachedArchive) {
    if (item && item.id) rawActivitiesMap.set(String(item.id), item);
  }

  if (cachedArchive.length === 0 || forceFull) {
    // All-time paginated backfill: fetch up to 30 pages (6,000 activities) in batches of 3 pages until empty
    for (let batchStart = 1; batchStart <= 30; batchStart += 3) {
      const pages = [batchStart, batchStart + 1, batchStart + 2];
      const batchResps = await Promise.all(
        pages.map((p) =>
          fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${p}`, {
            headers,
          })
        )
      );
      let reachedEnd = false;
      for (const r of batchResps) {
        if (!r.ok) {
          if (r.status === 401) {
            const errText = await r.text();
            if (errText.includes('activity:read_permission')) {
              runtimeStore.stravaAccessToken = '';
              runtimeStore.stravaRefreshToken = '';
              saveSessionCache();
              throw new Error(
                "Strava token is missing 'activity:read_all' permission. Please authorize via OAuth (Method A or Method B in Data Sources)."
              );
            }
          }
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
  } else {
    // Delta poll latest 200 activities for fast hourly cron updates
    const latestResp = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1',
      { headers }
    );
    if (latestResp.ok) {
      const latestItems = (await latestResp.json()) as Record<string, any>[];
      if (Array.isArray(latestItems)) {
        for (const item of latestItems) {
          if (item && item.id) rawActivitiesMap.set(String(item.id), item);
        }
      }
    }
  }

  const activitiesList = Array.from(rawActivitiesMap.values()).sort(
    (a, b) =>
      new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  );
  saveJsonFile(STRAVA_ARCHIVE_CACHE_FILE, activitiesList);

  const starredResp = await fetch('https://www.strava.com/api/v3/segments/starred?per_page=15', {
    headers,
  });
  const starredSegments = starredResp.ok
    ? ((await starredResp.json()) as Record<string, any>[])
    : [];

  // Fetch detailed activity payloads for the top 4 recent activities to extract segment_efforts
  const topIds = activitiesList.slice(0, 4).map((a) => a.id);
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

  const ftp = runtimeStore.athleteFtp || 300;
  const normalizedStravaActivities = activitiesList.map((a) => {
    const detail = detailById.get(Number(a.id)) || a;
    const sportType = String(a.sport_type || a.type || '').trim();
    const actName = String(a.name || '');

    let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' = 'Strength';
    if (
      /ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|peloton|zwift/i.test(
        sportType + ' ' + actName
      )
    ) {
      sportCategory = 'Cycling';
    } else if (/run|trailrun|virtualrun|treadmill/i.test(sportType)) {
      sportCategory = 'Running';
    } else if (/swim|openwater/i.test(sportType)) {
      sportCategory = 'Swimming';
    } else {
      sportCategory = 'Strength';
    }

    const isIndoor =
      Boolean(a.trainer) ||
      /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|trainerroad|gym|weight|hiit|workout|yoga/i.test(
        `${sportType} ${actName} ${a.device_name || ''}`
      );

    let subType:
      | 'Road'
      | 'Trail'
      | 'Gravel'
      | 'Smart Trainer'
      | 'Treadmill'
      | 'Pool'
      | 'Open Water'
      | 'Gym' = 'Road';
    if (sportCategory === 'Cycling') {
      if (isIndoor) subType = 'Smart Trainer';
      else if (/gravel/i.test(sportType + ' ' + actName)) subType = 'Gravel';
      else if (/mountain|mtb|trail/i.test(sportType + ' ' + actName)) subType = 'Trail';
      else subType = 'Road';
    } else if (sportCategory === 'Running') {
      if (isIndoor) subType = 'Treadmill';
      else if (/trail/i.test(sportType + ' ' + actName)) subType = 'Trail';
      else subType = 'Road';
    } else if (sportCategory === 'Swimming') {
      subType = 'Pool';
    } else {
      subType = 'Gym';
    }

    const movingTimeSecs = Number(a.moving_time || a.elapsed_time || 0);
    const distanceMeters = Number(a.distance || 0);
    const avgPower = a.average_watts ? Math.round(Number(a.average_watts)) : undefined;
    const normalizedPower = a.weighted_average_watts
      ? Math.round(Number(a.weighted_average_watts))
      : avgPower;
    const avgHr = Math.round(Number(a.average_heartrate || 0));
    const maxHr = Math.round(Number(a.max_heartrate || 0));

    let trainingLoad = Math.round(Number(a.suffer_score || 0));
    if (!trainingLoad && normalizedPower && movingTimeSecs > 0) {
      const ifVal = normalizedPower / ftp;
      trainingLoad = Math.round(((movingTimeSecs * normalizedPower * ifVal) / (ftp * 3600)) * 100);
    } else if (!trainingLoad && avgHr > 0 && movingTimeSecs > 0) {
      trainingLoad = Math.round(
        (movingTimeSecs / 3600) * Math.pow(avgHr / (runtimeStore.athleteLthr || 163), 2) * 65
      );
    }

    const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
    const segmentEfforts = rawEfforts.slice(0, 8).map((se: Record<string, any>) => ({
      id: String(se.id),
      segmentId: String(se.segment?.id || se.id),
      name: String(se.name || se.segment?.name || 'Segment'),
      sportCategory: sportCategory === 'Running' ? ('Running' as const) : ('Cycling' as const),
      distanceMeters: Math.round(Number(se.distance || se.segment?.distance || 0)),
      averageGradePct: Number(se.segment?.average_grade ?? 0),
      elapsedTimeSecs: Number(se.elapsed_time || 0),
      movingTimeSecs: Number(se.moving_time || se.elapsed_time || 0),
      avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : undefined,
      avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : undefined,
      prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
      komRank: typeof se.kom_rank === 'number' ? se.kom_rank : null,
      startDateLocal: String(se.start_date_local || a.start_date_local),
      activityId: String(a.id),
      activityName: String(a.name),
    }));

    return {
      stravaId: String(a.id),
      startDateLocal: String(a.start_date_local || '').replace(/Z$/i, ''),
      name: String(a.name || sportType || sportCategory),
      sportCategory,
      environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
      subType,
      distanceMeters,
      movingTimeSecs,
      elevationGainMeters: Math.round(Number(a.total_elevation_gain || 0)),
      avgPower,
      normalizedPower,
      intensityFactor: normalizedPower ? Number((normalizedPower / ftp).toFixed(2)) : undefined,
      trainingLoad,
      avgHr,
      maxHr,
      avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : undefined,
      avgPaceSecsPerKm:
        sportCategory === 'Running' && distanceMeters > 0
          ? Math.round(movingTimeSecs / (distanceMeters / 1000))
          : undefined,
      efficiencyFactor:
        normalizedPower && avgHr > 0 ? Number((normalizedPower / avgHr).toFixed(2)) : 0,
      gearName: detail.gear?.name || undefined,
      stravaPrCount: Number(a.pr_count || 0),
      kudosCount: Number(a.kudos_count || 0),
      segmentEfforts,
    };
  });

  runtimeStore.stravaActivitiesCount = normalizedStravaActivities.length;
  saveSessionCache();

  return {
    athleteName: runtimeStore.stravaAthleteName,
    activities: normalizedStravaActivities,
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

apiRouter.get('/api/strava/sync', async (req: Request, res: Response) => {
  try {
    const forceFull = req.query.full === 'true';
    const data = await syncStravaAllHistory(req, forceFull);
    res.json(data);
  } catch (error) {
    res.status(401).json({
      error:
        error instanceof Error ? error.message : 'Failed to sync Strava activities and segments',
    });
  }
});

// ----------------------------------------------------------------------------
// 5. Hourly Automated Background Poll Cron (/api/cron/hourly-sync + In-Process Timer)
// ----------------------------------------------------------------------------
async function executeHourlyBackgroundPoll() {
  const results: Record<string, any> = {
    triggeredAt: new Date().toISOString(),
    intervalsPolled: false,
    stravaPolled: false,
  };

  const { apiKey, athleteId } = getEffectiveIntervalsConfig();
  if (apiKey) {
    try {
      const intData = await syncIntervalsAllHistory(apiKey, athleteId);
      results.intervalsPolled = true;
      results.intervalsActivitiesCount = intData.activities.length;
      results.intervalsWellnessCount = intData.wellnessDays.length;
    } catch (e) {
      results.intervalsError = e instanceof Error ? e.message : 'Intervals poll error';
    }
  }

  if (runtimeStore.stravaAccessToken) {
    try {
      const stravaData = await syncStravaAllHistory(undefined, false);
      results.stravaPolled = true;
      results.stravaActivitiesCount = stravaData.activities.length;
    } catch (e) {
      results.stravaError = e instanceof Error ? e.message : 'Strava poll error';
    }
  }

  runtimeStore.lastSyncedAt = new Date().toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1000).toISOString();
  saveSessionCache();
  return results;
}

apiRouter.get('/api/cron/hourly-sync', async (_req: Request, res: Response) => {
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Hourly sync cron failed',
    });
  }
});

// Start in-process hourly background polling timer (every 60 minutes)
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  executeHourlyBackgroundPoll().catch(() => {
    // ignore background errors
  });
}, HOURLY_INTERVAL_MS);

// ----------------------------------------------------------------------------
// 6. Gemini AI Coach — Daily Options, Multi-Turn Chat & Direct Calendar Program Generator
// ----------------------------------------------------------------------------
apiRouter.post('/api/coach/options', async (req: Request, res: Response) => {
  try {
    const {
      sportPreference = 'Cycling',
      environmentPreference = 'INDOOR',
      durationMinutes = 60,
      telemetrySummary,
    } = req.body || {};

    const ai = getGeminiClient();
    const prompt = `
You are an elite endurance sports physiologist and multi-sport coach.
Generate 3 distinct, actionable daily workout options for today based on the athlete's live Garmin health, sleep, HRV status, Training Status, and Intervals.icu/Strava telemetry:
- Preferred Sport for Today: ${sportPreference}
- Preferred Environment: ${environmentPreference} (e.g., OUTDOOR road/trail vs INDOOR Smart Trainer/Treadmill)
- Available Duration: ${durationMinutes} minutes
- Athlete Telemetry Context: ${JSON.stringify(telemetrySummary || {})}

Return an array of 3 workout options in JSON matching the schema:
1. Tier "OPTIMAL" (Option A · Optimal Progression — pushes toward race/FTP/pace goals when readiness permits)
2. Tier "MODULATED" (Option B · Modulated Aerobic Durability — steady Zone 2 / controlled tempo advancing mileage with low autonomic cost)
3. Tier "RECOVERY" (Option C · Active Parasympathetic Recovery — low-strain Zone 1 spin/jog + mobility)
Include Intervals.icu workoutSyntax (e.g., "- 10m 60% FTP\\n- 30m 85% FTP\\n- 10m 55% FTP") for each option.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'Always cite exact numbers from the athlete telemetry (Garmin Sleep Score, Sleep Duration, HRV in ms vs 7d/60d baseline corridor, Garmin Training Status, Resting HR, CTL/ATL/TSB, eFTP, and annual mileage progress). Keep workout intervals crisp and practical.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              tier: { type: Type.STRING },
              tierLabel: { type: Type.STRING },
              title: { type: Type.STRING },
              sportCategory: { type: Type.STRING },
              environment: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              estimatedLoad: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              physiologicalWhy: { type: Type.STRING },
              workoutSyntax: { type: Type.STRING },
              structuredSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    targetZoneOrOutput: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      },
    });

    const jsonText = (response.text ?? '[]').trim();
    const parsed = JSON.parse(jsonText);
    res.json({ options: parsed });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to generate daily workout options with Gemini.',
    });
  }
});

apiRouter.post('/api/coach/chat', async (req: Request, res: Response) => {
  try {
    const { message, history = [], telemetrySummary } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    const ai = getGeminiClient();
    const conversationContext = Array.isArray(history)
      ? history
          .slice(-8)
          .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n')
      : '';

    const todayStr = new Date().toISOString().slice(0, 10);

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `
TODAY'S DATE: ${todayStr}

ATHLETE COMPLETE GARMIN HEALTH, SLEEP, TRAINING STATUS & ALL-TIME TELEMETRY SNAPSHOT:
${JSON.stringify(telemetrySummary || {}, null, 2)}

RECENT CONVERSATION:
${conversationContext}

ATHLETE QUESTION OR PROGRAM REQUEST:
${message}
`,
      config: {
        systemInstruction: `You are AeroPulse AI Coach, an elite exercise physiologist and cycling/running training program designer integrated directly into an Intervals.icu-style analytics platform.
1. Ground every answer in the athlete's real metrics: Garmin Sleep Score & Duration, 7d Sleep Debt, Garmin HRV Status (Balanced/Unbalanced/Low) & rMSSD (ms) vs normal corridor, 8-state Garmin Training Status, Resting HR, CTL/ATL/TSB, Load Ratio (ACWR), Cycling eFTP (~310W) / FTP (300W), Running eFTP (~456W) / Threshold Pace, and historical workouts.
2. Whenever the user asks about today's workout, tomorrow's session, or a multi-day / weekly cycling or running training plan, ALWAYS populate "proposedWorkouts" with 1 to 7 concrete, ready-to-schedule workouts (with exact YYYY-MM-DD dates starting from ${todayStr}, sportCategory "Cycling" or "Running", environmentPreference "OUTDOOR" or "INDOOR", plannedDurationSecs, plannedLoad, and Intervals.icu workoutSyntax lines starting with "- ").`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description:
                'Clear, quantitative markdown coaching response referencing the athlete’s exact sleep, HRV, Training Status, CTL/ATL/TSB, and power/pace zones.',
            },
            citedMetrics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                '3 to 5 short metric badges cited in the analysis (e.g., "Sleep 7h 19m (Score 75)", "HRV 38 ms", "CTL 72.4 / TSB +14.7", "Cycling eFTP 310W").',
            },
            proposedWorkouts: {
              type: Type.ARRAY,
              description:
                '1 to 7 structured workouts that the athlete can schedule onto their Training Calendar with 1 click.',
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: 'YYYY-MM-DD date for the workout' },
                  name: { type: Type.STRING, description: 'Concise workout title' },
                  sportCategory: { type: Type.STRING, description: 'Cycling or Running' },
                  environmentPreference: {
                    type: Type.STRING,
                    description: 'OUTDOOR, INDOOR, or FLEXIBLE',
                  },
                  plannedDurationSecs: {
                    type: Type.INTEGER,
                    description: 'Total duration in seconds (e.g. 3600 for 60m)',
                  },
                  plannedLoad: {
                    type: Type.INTEGER,
                    description: 'Estimated TSS training load',
                  },
                  workoutSyntax: {
                    type: Type.STRING,
                    description:
                      'Intervals.icu step syntax, each step on a new line starting with "- " (e.g. "- 10m 60% FTP\\n- 4x 5m 105% FTP\\n- 10m 55% FTP")',
                  },
                  description: {
                    type: Type.STRING,
                    description: '1-sentence coaching rationale for this session',
                  },
                },
              },
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    const proposedWorkouts = Array.isArray(parsed.proposedWorkouts)
      ? parsed.proposedWorkouts.map((pw: any, i: number) => {
          const dur = Number(pw.plannedDurationSecs || 3600);
          const syntax = String(pw.workoutSyntax || '- 15m 65% FTP\n- 30m 85% FTP\n- 15m 55% FTP');
          return {
            id: `ai-prop-${Date.now()}-${i}`,
            date: String(pw.date || todayStr).slice(0, 10),
            name: String(pw.name || 'AI Prescribed Session'),
            sportCategory: /run/i.test(String(pw.sportCategory || '')) ? 'Running' : 'Cycling',
            environmentPreference: /indoor/i.test(String(pw.environmentPreference || ''))
              ? 'INDOOR'
              : /outdoor/i.test(String(pw.environmentPreference || ''))
                ? 'OUTDOOR'
                : 'FLEXIBLE',
            description: String(pw.description || syntax),
            plannedLoad: Number(pw.plannedLoad || 65),
            plannedDurationSecs: dur,
            targetZoneSummary: `${pw.plannedLoad || 65} TSS · AI Coach Prescription`,
            workoutSyntax: syntax,
            structuredSteps: parseWorkoutSyntaxToSteps(syntax, dur),
            source: 'AI_COACH' as const,
          };
        })
      : [];

    res.json({
      reply: parsed.reply || 'Here is my analysis based on your physiological profile.',
      citedMetrics: Array.isArray(parsed.citedMetrics) ? parsed.citedMetrics : [],
      proposedWorkouts,
    });
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to generate coaching response from Gemini.',
    });
  }
});
