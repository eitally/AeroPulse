import express, { Request, Response } from 'express';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';

export const apiRouter = express.Router();

const SESSION_CACHE_FILE = '/tmp/aeropulse-runtime-session.json';
const STRAVA_ARCHIVE_CACHE_FILE = '/tmp/aeropulse-strava-archive.json';
const PLANNED_EVENTS_CACHE_FILE = '/tmp/aeropulse-planned-events.json';
const SEGMENTS_BY_ACTIVITY_CACHE_FILE = '/tmp/aeropulse-segments-by-activity.json';
const ROUTES_BY_ACTIVITY_CACHE_FILE = '/tmp/aeropulse-routes-by-activity.json';
const STRAVA_KUDOS_CACHE_FILE = '/tmp/aeropulse-strava-kudos.json';

function decodeGooglePolyline(encoded: string): [number, number][] {
  if (!encoded || typeof encoded !== 'string') return [];
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
  return points;
}

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
  athleteProfile?: Record<string, any>;
  geminiApiKey?: string;
  mapTileApiKey: string;
  mapTileProvider: 'OSM_KEYLESS' | 'MAPBOX' | 'THUNDERFOREST';
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

const initialEnvMapKey = (
  process.env.MAPBOX_ACCESS_TOKEN ||
  process.env.VITE_MAPBOX_ACCESS_TOKEN ||
  process.env.THUNDERFOREST_API_KEY ||
  ''
).trim();

const initialEnvGeminiKey = [
  cachedSession.geminiApiKey,
  process.env.GEMINI_API_KEY,
  process.env.GOOGLE_API_KEY,
]
  .map((k) => (k || '').trim())
  .find((k) => k && k !== 'MY_GEMINI_API_KEY' && k !== 'YOUR_GEMINI_API_KEY') || '';

const runtimeStore: RuntimeSessionStore = {
  intervalsApiKey: cachedSession.intervalsApiKey || process.env.INTERVALS_API_KEY || '',
  intervalsAthleteId: cachedSession.intervalsAthleteId || process.env.INTERVALS_ATHLETE_ID || '0',
  intervalsAthleteName: cachedSession.intervalsAthleteName || '',
  stravaClientId: cachedSession.stravaClientId || process.env.STRAVA_CLIENT_ID || '',
  stravaClientSecret: cachedSession.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || '',
  stravaAccessToken: cachedSession.stravaAccessToken || process.env.STRAVA_ACCESS_TOKEN || '',
  stravaRefreshToken: cachedSession.stravaRefreshToken || process.env.STRAVA_REFRESH_TOKEN || '',
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
  athleteProfile: cachedSession.athleteProfile || undefined,
  geminiApiKey: initialEnvGeminiKey,
  mapTileApiKey: cachedSession.mapTileApiKey || initialEnvMapKey,
  mapTileProvider:
    cachedSession.mapTileProvider ||
    (initialEnvMapKey.startsWith('pk.')
      ? 'MAPBOX'
      : initialEnvMapKey
        ? 'THUNDERFOREST'
        : 'OSM_KEYLESS'),
  gearItems: cachedSession.gearItems || [],
};

const SERVER_ZONE_COLORS = [
  '#52B788',
  '#2A9D8F',
  '#EAB308',
  '#F97316',
  '#EF4444',
  '#9333EA',
  '#EC4899',
];

function buildServerAthleteProfile(
  rawProfile?: Record<string, any> | null,
  latestWellness?: Record<string, any> | null
) {
  const prev = runtimeStore.athleteProfile || {};
  const bikeSetting = Array.isArray(rawProfile?.sportSettings)
    ? rawProfile!.sportSettings.find(
        (s: any) =>
          Array.isArray(s.types) &&
          (s.types.includes('Ride') || s.types.includes('VirtualRide'))
      )
    : undefined;
  const runSetting = Array.isArray(rawProfile?.sportSettings)
    ? rawProfile!.sportSettings.find(
        (s: any) =>
          Array.isArray(s.types) &&
          (s.types.includes('Run') || s.types.includes('VirtualRun') || s.types.includes('TrailRun'))
      )
    : undefined;

  const ftp = Number(
    bikeSetting?.ftp ||
      rawProfile?.ftp ||
      prev.ftp ||
      runtimeStore.athleteFtp ||
      latestWellness?.rideEftp ||
      300
  );
  const indoorFtp = Number(
    bikeSetting?.indoor_ftp ||
      rawProfile?.indoorFtp ||
      prev.indoorFtp ||
      runtimeStore.athleteIndoorFtp ||
      ftp
  );
  const eFtp = Number(
    latestWellness?.rideEftp ||
      bikeSetting?.eFtp ||
      rawProfile?.eFtp ||
      prev.eFtp ||
      ftp
  );
  const wPrime = Number(
    bikeSetting?.w_prime ||
      latestWellness?.rideWPrime ||
      rawProfile?.wPrime ||
      prev.wPrime ||
      24500
  );
  const pMax = Number(
    bikeSetting?.p_max ||
      latestWellness?.ridePMax ||
      rawProfile?.pMax ||
      prev.pMax ||
      1180
  );
  const lthr = Number(
    bikeSetting?.lthr ||
      rawProfile?.lthr ||
      prev.lthr ||
      runtimeStore.athleteLthr ||
      163
  );
  const maxHr = Number(
    bikeSetting?.max_hr ||
      rawProfile?.maxHr ||
      prev.maxHr ||
      runtimeStore.athleteMaxHr ||
      182
  );
  const sweetSpotMinPct = Number(
    bikeSetting?.sweet_spot_min || rawProfile?.sweetSpotMinPct || prev.sweetSpotMinPct || 84
  );
  const sweetSpotMaxPct = Number(
    bikeSetting?.sweet_spot_max || rawProfile?.sweetSpotMaxPct || prev.sweetSpotMaxPct || 97
  );

  const weightKg = Number(
    latestWellness?.weightKg ||
      rawProfile?.icu_weight ||
      rawProfile?.weight ||
      rawProfile?.weightKg ||
      prev.weightKg ||
      70.0
  );
  const restingHr = Number(
    latestWellness?.restingHR ||
      rawProfile?.icu_resting_hr ||
      rawProfile?.restingHr ||
      prev.restingHr ||
      49
  );
  const vo2MaxCycling = Number(
    latestWellness?.vo2MaxCycling || rawProfile?.vo2MaxCycling || prev.vo2MaxCycling || 56
  );
  const vo2MaxRunning = Number(
    latestWellness?.vo2MaxRunning || rawProfile?.vo2MaxRunning || prev.vo2MaxRunning || 55
  );

  const runFtp = Number(
    runSetting?.ftp ||
      rawProfile?.runFtp ||
      prev.runFtp ||
      runtimeStore.athleteRunFtp ||
      latestWellness?.runEftp ||
      340
  );
  const runEFtp = Number(
    latestWellness?.runEftp || rawProfile?.runEFtp || prev.runEFtp || runFtp
  );
  const runLthr = Number(
    runSetting?.lthr || rawProfile?.runLthr || prev.runLthr || lthr + 4
  );
  const runMaxHr = Number(
    runSetting?.max_hr || rawProfile?.runMaxHr || prev.runMaxHr || maxHr + 3
  );
  // threshold_pace in Intervals.icu is m/s; convert to secs/km if < 15
  let thresholdPaceSecsPerKm = Number(
    rawProfile?.thresholdPaceSecsPerKm || prev.thresholdPaceSecsPerKm || 245
  );
  if (runSetting?.threshold_pace && Number(runSetting.threshold_pace) > 0) {
    const rawTp = Number(runSetting.threshold_pace);
    thresholdPaceSecsPerKm = rawTp < 15 ? Math.round(1000 / rawTp) : Math.round(rawTp);
  }

  // Power Zones (Z1..Z7)
  const rawPowerCeilings: number[] =
    Array.isArray(bikeSetting?.power_zones) && bikeSetting.power_zones.length >= 5
      ? bikeSetting.power_zones.map((v: any) => Number(v))
      : Array.isArray(prev.powerZones) && prev.powerZones.length >= 5
        ? prev.powerZones.map((z: any) => Number(z.maxPct))
        : [55, 75, 90, 105, 120, 150, 999];
  const rawPowerNames: string[] =
    Array.isArray(bikeSetting?.power_zone_names) && bikeSetting.power_zone_names.length >= 5
      ? bikeSetting.power_zone_names
      : [
          'Active Recovery',
          'Endurance',
          'Tempo',
          'Lactate Threshold',
          'VO2 Max',
          'Anaerobic Capacity',
          'Neuromuscular Power',
        ];

  const powerZones = rawPowerCeilings.slice(0, 7).map((ceilPct, i) => {
    const minPct = i === 0 ? 0 : rawPowerCeilings[i - 1] + 1;
    const maxPct = ceilPct >= 900 ? 250 : ceilPct;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawPowerNames[i] || `Zone ${i + 1}`,
      minPct,
      maxPct,
      minWatts: i === 0 ? 0 : Math.round((rawPowerCeilings[i - 1] / 100) * ftp) + 1,
      maxWatts: Math.round((maxPct / 100) * ftp),
      minIndoorWatts:
        i === 0 ? 0 : Math.round((rawPowerCeilings[i - 1] / 100) * indoorFtp) + 1,
      maxIndoorWatts: Math.round((maxPct / 100) * indoorFtp),
      color: SERVER_ZONE_COLORS[i] || '#9333EA',
    };
  });

  // Cycling HR Zones
  const defaultBikeHrCeilings = [
    Math.round(lthr * 0.81),
    Math.round(lthr * 0.89),
    Math.round(lthr * 0.93),
    Math.round(lthr * 0.99),
    Math.round(lthr * 1.02),
    Math.round(lthr * 1.06),
    maxHr,
  ];
  const rawHrCeilings: number[] =
    Array.isArray(bikeSetting?.hr_zones) && bikeSetting.hr_zones.length >= 5
      ? bikeSetting.hr_zones.map((v: any) => Number(v))
      : Array.isArray(prev.hrZones) && prev.hrZones.length >= 5
        ? prev.hrZones.map((z: any) => Number(z.maxBpm))
        : defaultBikeHrCeilings;
  const rawHrNames: string[] =
    Array.isArray(bikeSetting?.hr_zone_names) && bikeSetting.hr_zone_names.length >= 5
      ? bikeSetting.hr_zone_names
      : [
          'Z1 Recovery',
          'Z2 Aerobic Base',
          'Z3 Tempo',
          'Z4 Sub-Threshold',
          'Z5a Super-Threshold',
          'Z5b Aerobic Capacity',
          'Z5c Anaerobic',
        ];

  const hrZones = rawHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm = i === 0 ? 60 : rawHrCeilings[i - 1] + 1;
    const maxBpm = i === rawHrCeilings.length - 1 ? Math.max(ceilBpm, maxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawHrNames[i] || `HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: i === 0 ? 50 : Math.round((minBpm / Math.max(100, lthr)) * 100),
      maxPctLthr: Math.round((maxBpm / Math.max(100, lthr)) * 100),
      color: SERVER_ZONE_COLORS[i] || '#EF4444',
    };
  });

  // Running HR Zones
  const defaultRunHrCeilings = [
    Math.round(runLthr * 0.81),
    Math.round(runLthr * 0.89),
    Math.round(runLthr * 0.93),
    Math.round(runLthr * 0.99),
    Math.round(runLthr * 1.02),
    Math.round(runLthr * 1.06),
    runMaxHr,
  ];
  const rawRunHrCeilings: number[] =
    Array.isArray(runSetting?.hr_zones) && runSetting.hr_zones.length >= 5
      ? runSetting.hr_zones.map((v: any) => Number(v))
      : defaultRunHrCeilings;
  const rawRunHrNames: string[] =
    Array.isArray(runSetting?.hr_zone_names) && runSetting.hr_zone_names.length >= 5
      ? runSetting.hr_zone_names
      : rawHrNames;

  const runHrZones = rawRunHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm = i === 0 ? 60 : rawRunHrCeilings[i - 1] + 1;
    const maxBpm = i === rawRunHrCeilings.length - 1 ? Math.max(ceilBpm, runMaxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawRunHrNames[i] || `Run HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: i === 0 ? 50 : Math.round((minBpm / Math.max(100, runLthr)) * 100),
      maxPctLthr: Math.round((maxBpm / Math.max(100, runLthr)) * 100),
      color: SERVER_ZONE_COLORS[i] || '#EF4444',
    };
  });

  return {
    athleteId: String(
      rawProfile?.id || runtimeStore.intervalsAthleteId || prev.athleteId || '0'
    ),
    name:
      rawProfile?.name ||
      [rawProfile?.firstname, rawProfile?.lastname].filter(Boolean).join(' ') ||
      runtimeStore.intervalsAthleteName ||
      prev.name ||
      'Athlete',
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
    sweetSpotMinPct,
    sweetSpotMaxPct,
    runFtp: Math.round(runFtp),
    runEFtp: Math.round(runEFtp),
    runLthr: Math.round(runLthr),
    runMaxHr: Math.round(runMaxHr),
    thresholdPaceSecsPerKm: Math.round(thresholdPaceSecsPerKm),
    powerZones,
    hrZones,
    runHrZones,
    lastSyncedAt: new Date().toISOString(),
    source: rawProfile?.source || 'INTERVALS_GARMIN',
  };
}

function saveSessionCache() {
  saveJsonFile(SESSION_CACHE_FILE, runtimeStore);
}

function getEffectiveGeminiApiKey(req?: Request): string {
  const headerKey = (req?.headers['x-gemini-api-key'] as string | undefined)?.trim();
  const bodyKey =
    typeof req?.body?.geminiApiKey === 'string' ? req.body.geminiApiKey.trim() : '';
  const candidates = [
    headerKey,
    bodyKey,
    runtimeStore.geminiApiKey,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ];
  for (const c of candidates) {
    const clean = (c || '').trim();
    if (clean && clean !== 'MY_GEMINI_API_KEY' && clean !== 'YOUR_GEMINI_API_KEY') {
      return clean;
    }
  }
  return '';
}

function getGeminiClient(req?: Request): GoogleGenAI | null {
  const apiKey = getEffectiveGeminiApiKey(req);
  if (!apiKey) return null;
  if (!runtimeStore.geminiApiKey) {
    runtimeStore.geminiApiKey = apiKey;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateGeminiContentWithFallback(
  ai: GoogleGenAI,
  params: { contents: string; config?: Record<string, any> }
) {
  const candidateModels = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.0-flash'];
  let lastError: unknown = null;
  for (const model of candidateModels) {
    try {
      return await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Gemini API request failed across candidate models.');
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
  const headerRefreshToken = req?.headers['x-strava-refresh-token'] as string | undefined;
  const headerAccessToken = req?.headers['x-strava-access-token'] as string | undefined;
  const headerExpiresAt = Number(req?.headers['x-strava-expires-at'] || 0);
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
  const refreshToken = (
    headerRefreshToken ||
    runtimeStore.stravaRefreshToken ||
    process.env.STRAVA_REFRESH_TOKEN ||
    ''
  ).trim();
  const accessToken = (
    headerAccessToken ||
    runtimeStore.stravaAccessToken ||
    process.env.STRAVA_ACCESS_TOKEN ||
    ''
  ).trim();
  const expiresAt =
    runtimeStore.stravaExpiresAt > 0
      ? runtimeStore.stravaExpiresAt
      : headerExpiresAt > 0
        ? headerExpiresAt
        : 0;
  return { clientId, clientSecret, refreshToken, accessToken, expiresAt };
}

function getStravaTokenRotationPayload() {
  if (!runtimeStore.stravaRefreshToken && !runtimeStore.stravaAccessToken) {
    return undefined;
  }
  return {
    accessToken: runtimeStore.stravaAccessToken || undefined,
    refreshToken: runtimeStore.stravaRefreshToken || undefined,
    expiresAt: runtimeStore.stravaExpiresAt || undefined,
    clientId: runtimeStore.stravaClientId || undefined,
    clientSecret: runtimeStore.stravaClientSecret || undefined,
    athleteName: runtimeStore.stravaAthleteName || undefined,
  };
}

async function ensureValidStravaAccessToken(req?: Request, forceRefresh = false): Promise<string> {
  const { clientId, clientSecret, refreshToken, accessToken, expiresAt } =
    getEffectiveStravaClientConfig(req);
  if (clientId && !runtimeStore.stravaClientId) runtimeStore.stravaClientId = clientId;
  if (clientSecret && !runtimeStore.stravaClientSecret)
    runtimeStore.stravaClientSecret = clientSecret;
  if (refreshToken && !runtimeStore.stravaRefreshToken)
    runtimeStore.stravaRefreshToken = refreshToken;
  if (accessToken && !runtimeStore.stravaAccessToken) runtimeStore.stravaAccessToken = accessToken;
  if (expiresAt > 0 && !runtimeStore.stravaExpiresAt) runtimeStore.stravaExpiresAt = expiresAt;

  const nowSecs = Math.floor(Date.now() / 1000);
  // Refresh if forced (e.g. after 401), missing access token, unknown expiry on Vercel cold start, or within 5 mins of expiry
  const needsRefresh =
    forceRefresh ||
    !runtimeStore.stravaAccessToken ||
    runtimeStore.stravaExpiresAt === 0 ||
    nowSecs >= runtimeStore.stravaExpiresAt - 300;

  if (needsRefresh && runtimeStore.stravaRefreshToken && clientId && clientSecret) {
    try {
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
          athlete?: { firstname?: string; lastname?: string };
        };
        runtimeStore.stravaAccessToken = refreshed.access_token;
        runtimeStore.stravaRefreshToken =
          refreshed.refresh_token || runtimeStore.stravaRefreshToken;
        runtimeStore.stravaExpiresAt = refreshed.expires_at;
        if (refreshed.athlete) {
          const name = [refreshed.athlete.firstname, refreshed.athlete.lastname]
            .filter(Boolean)
            .join(' ');
          if (name) runtimeStore.stravaAthleteName = name;
        }
        saveSessionCache();
      }
    } catch {
      // fallback to existing accessToken if network error
    }
  }
  return runtimeStore.stravaAccessToken;
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
  const {
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    refreshToken: stravaRefreshToken,
    accessToken: stravaAccessToken,
  } = getEffectiveStravaClientConfig(req);
  if (intervalsKey && !runtimeStore.intervalsApiKey) {
    runtimeStore.intervalsApiKey = intervalsKey;
    runtimeStore.intervalsAthleteId = athleteId;
  }
  if (stravaClientId && !runtimeStore.stravaClientId) {
    runtimeStore.stravaClientId = stravaClientId;
  }
  if (stravaClientSecret && !runtimeStore.stravaClientSecret) {
    runtimeStore.stravaClientSecret = stravaClientSecret;
  }
  if (stravaRefreshToken && !runtimeStore.stravaRefreshToken) {
    runtimeStore.stravaRefreshToken = stravaRefreshToken;
  }
  if (stravaAccessToken && !runtimeStore.stravaAccessToken) {
    runtimeStore.stravaAccessToken = stravaAccessToken;
  }

  const headerMapKey = (req.headers['x-map-tile-api-key'] as string | undefined)?.trim();
  const headerMapProvider = (req.headers['x-map-tile-provider'] as string | undefined)?.trim();
  if (headerMapKey && !runtimeStore.mapTileApiKey) {
    runtimeStore.mapTileApiKey = headerMapKey;
  }
  if (
    headerMapProvider &&
    (headerMapProvider === 'OSM_KEYLESS' ||
      headerMapProvider === 'MAPBOX' ||
      headerMapProvider === 'THUNDERFOREST')
  ) {
    runtimeStore.mapTileProvider = headerMapProvider;
  }

  const effectiveMapKey = (
    runtimeStore.mapTileApiKey ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.VITE_MAPBOX_ACCESS_TOKEN ||
    process.env.THUNDERFOREST_API_KEY ||
    ''
  ).trim();
  const effectiveMapProvider: 'OSM_KEYLESS' | 'MAPBOX' | 'THUNDERFOREST' =
    runtimeStore.mapTileProvider ||
    (effectiveMapKey.startsWith('pk.')
      ? 'MAPBOX'
      : effectiveMapKey
        ? 'THUNDERFOREST'
        : 'OSM_KEYLESS');

  const hasIntervalsEnv = Boolean(
    process.env.INTERVALS_API_KEY && process.env.INTERVALS_API_KEY.trim()
  );
  const hasStravaEnv = Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  const effectiveGeminiKey = getEffectiveGeminiApiKey(req);
  if (effectiveGeminiKey && !runtimeStore.geminiApiKey) {
    runtimeStore.geminiApiKey = effectiveGeminiKey;
  }
  const hasGeminiServerKey = Boolean(effectiveGeminiKey);
  const isStravaConnected = Boolean(stravaAccessToken || stravaRefreshToken);

  res.json({
    intervalsConnected: Boolean(intervalsKey),
    intervalsAthleteId: athleteId,
    intervalsAthleteName: runtimeStore.intervalsAthleteName || undefined,
    intervalsSource: hasIntervalsEnv ? 'ENV' : intervalsKey ? 'USER_INPUT' : 'NONE',
    stravaConfigured: Boolean(stravaClientId),
    stravaClientId: stravaClientId || undefined,
    stravaConnected: isStravaConnected,
    stravaAthleteName: runtimeStore.stravaAthleteName || undefined,
    stravaSource: isStravaConnected ? 'OAUTH' : hasStravaEnv ? 'ENV' : 'NONE',
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
    athleteProfile:
      runtimeStore.athleteProfile || buildServerAthleteProfile(null, null),
    gearItems: runtimeStore.gearItems,
    callbackUrl: resolveCallbackUrl(req),
    stravaTokens: getStravaTokenRotationPayload(),
    mapTileProvider: effectiveMapProvider,
    mapTileApiKeyConfigured: Boolean(effectiveMapKey),
    mapTileApiKey: effectiveMapKey || undefined,
  });
});

// Sync or Override Athlete Profile & Sport Zones from Intervals.icu & Garmin
apiRouter.post('/api/intervals/profile/sync', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      const fallbackProfile = buildServerAthleteProfile(req.body?.overrides || null, null);
      runtimeStore.athleteProfile = fallbackProfile;
      saveSessionCache();
      res.json({ ok: true, athleteProfile: fallbackProfile, mode: 'SANDBOX' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const todayStr = new Date().toISOString().slice(0, 10);
    const oldest14d = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);

    const [profileResp, wellnessResp] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      }),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest14d}&newest=${todayStr}`,
        {
          headers: { Authorization: authHeader, Accept: 'application/json' },
        }
      ),
    ]);

    if (!profileResp.ok) {
      res.status(profileResp.status).json({
        error: `Intervals.icu athlete profile request returned ${profileResp.status}.`,
      });
      return;
    }

    const rawProfile = (await profileResp.json()) as Record<string, any>;
    const rawWellnessList = wellnessResp.ok
      ? ((await wellnessResp.json()) as Record<string, any>[])
      : [];

    let latestWellnessSummary: Record<string, any> = {};
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

    const syncedProfile = buildServerAthleteProfile(rawProfile, latestWellnessSummary);
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    saveSessionCache();

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

apiRouter.post('/api/athlete/profile', (req: Request, res: Response) => {
  const incoming = (req.body?.athleteProfile || req.body || {}) as Record<string, any>;
  const updated = buildServerAthleteProfile(
    { ...incoming, source: 'CUSTOM_OVERRIDE' },
    null
  );
  runtimeStore.athleteFtp = updated.ftp;
  runtimeStore.athleteIndoorFtp = updated.indoorFtp;
  runtimeStore.athleteRunFtp = updated.runFtp;
  runtimeStore.athleteLthr = updated.lthr;
  runtimeStore.athleteMaxHr = updated.maxHr;
  runtimeStore.athleteProfile = updated;
  saveSessionCache();

  res.json({
    ok: true,
    athleteProfile: updated,
  });
});

// Save Mapbox / OpenStreetMap / Thunderforest Map Tile Provider & API Key
apiRouter.post('/api/map/config', (req: Request, res: Response) => {
  const rawProvider = String(req.body?.provider || 'OSM_KEYLESS')
    .trim()
    .toUpperCase();
  const rawApiKey = String(req.body?.apiKey || '').trim();
  const provider: 'OSM_KEYLESS' | 'MAPBOX' | 'THUNDERFOREST' =
    rawProvider === 'MAPBOX'
      ? 'MAPBOX'
      : rawProvider === 'THUNDERFOREST'
        ? 'THUNDERFOREST'
        : rawApiKey.startsWith('pk.')
          ? 'MAPBOX'
          : 'OSM_KEYLESS';

  runtimeStore.mapTileProvider = provider;
  runtimeStore.mapTileApiKey = rawApiKey;
  saveSessionCache();

  res.json({
    ok: true,
    mapTileProvider: runtimeStore.mapTileProvider,
    mapTileApiKeyConfigured: Boolean(runtimeStore.mapTileApiKey),
    mapTileApiKey: runtimeStore.mapTileApiKey || undefined,
  });
});

// Save Google Gemini API Key at Runtime (for AI Coach & Daily Workout Generator)
apiRouter.post('/api/gemini/config', (req: Request, res: Response) => {
  const rawApiKey = String(req.body?.apiKey || req.body?.geminiApiKey || '').trim();
  runtimeStore.geminiApiKey = rawApiKey;
  saveSessionCache();

  res.json({
    ok: true,
    hasGeminiServerKey: Boolean(runtimeStore.geminiApiKey),
  });
});

// Export & Import Connection Bundle for 1-Click Transfer to Deployed App / Vercel
apiRouter.get('/api/config/export-bundle', (req: Request, res: Response) => {
  const { apiKey: intervalsApiKey, athleteId: intervalsAthleteId } = getEffectiveIntervalsConfig(req);
  const {
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    refreshToken: stravaRefreshToken,
    accessToken: stravaAccessToken,
  } = getEffectiveStravaClientConfig(req);
  const mapTileApiKey = (
    (req.headers['x-map-tile-api-key'] as string | undefined) ||
    runtimeStore.mapTileApiKey ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    ''
  ).trim();
  const mapTileProvider = runtimeStore.mapTileProvider || 'OSM_KEYLESS';
  const geminiApiKey = getEffectiveGeminiApiKey(req);

  const payload = {
    v: 1,
    intervalsApiKey,
    intervalsAthleteId,
    intervalsAthleteName: runtimeStore.intervalsAthleteName,
    stravaClientId,
    stravaClientSecret,
    stravaRefreshToken,
    stravaAccessToken,
    stravaExpiresAt: runtimeStore.stravaExpiresAt,
    stravaAthleteName: runtimeStore.stravaAthleteName,
    mapTileProvider,
    mapTileApiKey,
    geminiApiKey: geminiApiKey || undefined,
  };

  const bundle = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const envLines = [
    ...(geminiApiKey ? [`GEMINI_API_KEY="${geminiApiKey}"`] : []),
    `INTERVALS_API_KEY="${intervalsApiKey}"`,
    `INTERVALS_ATHLETE_ID="${intervalsAthleteId || '0'}"`,
    `STRAVA_CLIENT_ID="${stravaClientId}"`,
    `STRAVA_CLIENT_SECRET="${stravaClientSecret}"`,
    `STRAVA_REFRESH_TOKEN="${stravaRefreshToken}"`,
    ...(mapTileApiKey ? [`MAPBOX_ACCESS_TOKEN="${mapTileApiKey}"`] : []),
  ].join('\n');

  res.json({
    bundle,
    envText: envLines,
    credentials: payload,
  });
});

apiRouter.post('/api/config/import-bundle', (req: Request, res: Response) => {
  try {
    const rawInput = String(req.body?.bundle || '').trim();
    if (!rawInput) {
      res.status(400).json({ error: 'Please paste a valid Connection Bundle or .env block.' });
      return;
    }

    let parsed: Partial<RuntimeSessionStore> = {};
    if (
      rawInput.includes('INTERVALS_API_KEY=') ||
      rawInput.includes('STRAVA_') ||
      rawInput.includes('MAPBOX_') ||
      rawInput.includes('GEMINI_API_KEY=')
    ) {
      // Parse .env key=value format
      const lines = rawInput.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        if (key === 'GEMINI_API_KEY' || key === 'GOOGLE_API_KEY') parsed.geminiApiKey = val;
        if (key === 'INTERVALS_API_KEY') parsed.intervalsApiKey = val;
        if (key === 'INTERVALS_ATHLETE_ID') parsed.intervalsAthleteId = val;
        if (key === 'STRAVA_CLIENT_ID') parsed.stravaClientId = val;
        if (key === 'STRAVA_CLIENT_SECRET') parsed.stravaClientSecret = val;
        if (key === 'STRAVA_REFRESH_TOKEN') parsed.stravaRefreshToken = val;
        if (key === 'STRAVA_ACCESS_TOKEN') parsed.stravaAccessToken = val;
        if (
          key === 'MAPBOX_ACCESS_TOKEN' ||
          key === 'VITE_MAPBOX_ACCESS_TOKEN' ||
          key === 'THUNDERFOREST_API_KEY'
        ) {
          parsed.mapTileApiKey = val;
          parsed.mapTileProvider = val.startsWith('pk.') ? 'MAPBOX' : 'THUNDERFOREST';
        }
      }
    } else {
      const jsonStr = rawInput.startsWith('{')
        ? rawInput
        : Buffer.from(rawInput, 'base64').toString('utf8');
      parsed = JSON.parse(jsonStr);
    }

    if (parsed.geminiApiKey) runtimeStore.geminiApiKey = String(parsed.geminiApiKey).trim();
    if (parsed.intervalsApiKey) runtimeStore.intervalsApiKey = parsed.intervalsApiKey.trim();
    if (parsed.intervalsAthleteId)
      runtimeStore.intervalsAthleteId = parsed.intervalsAthleteId.trim();
    if (parsed.intervalsAthleteName)
      runtimeStore.intervalsAthleteName = parsed.intervalsAthleteName;
    if (parsed.stravaClientId) runtimeStore.stravaClientId = String(parsed.stravaClientId).trim();
    if (parsed.stravaClientSecret)
      runtimeStore.stravaClientSecret = String(parsed.stravaClientSecret).trim();
    if (parsed.stravaRefreshToken)
      runtimeStore.stravaRefreshToken = String(parsed.stravaRefreshToken).trim();
    if (parsed.stravaAccessToken)
      runtimeStore.stravaAccessToken = String(parsed.stravaAccessToken).trim();
    if (parsed.stravaExpiresAt) runtimeStore.stravaExpiresAt = Number(parsed.stravaExpiresAt);
    if (parsed.stravaAthleteName) runtimeStore.stravaAthleteName = parsed.stravaAthleteName;
    if (parsed.mapTileApiKey !== undefined) {
      runtimeStore.mapTileApiKey = String(parsed.mapTileApiKey).trim();
    }
    if (parsed.mapTileProvider) {
      runtimeStore.mapTileProvider = parsed.mapTileProvider;
    }

    saveSessionCache();

    res.json({
      imported: true,
      credentials: {
        geminiApiKey: runtimeStore.geminiApiKey,
        intervalsApiKey: runtimeStore.intervalsApiKey,
        intervalsAthleteId: runtimeStore.intervalsAthleteId,
        stravaClientId: runtimeStore.stravaClientId,
        stravaClientSecret: runtimeStore.stravaClientSecret,
        stravaRefreshToken: runtimeStore.stravaRefreshToken,
        stravaAccessToken: runtimeStore.stravaAccessToken,
        mapTileProvider: runtimeStore.mapTileProvider,
        mapTileApiKey: runtimeStore.mapTileApiKey,
      },
    });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? `Invalid Connection Bundle format: ${err.message}`
          : 'Failed to parse Connection Bundle.',
    });
  }
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

async function syncIntervalsAllHistory(
  apiKey: string,
  athleteId: string,
  oldestActivitiesDate = '2010-01-01'
) {
  const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
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

  // Enrich & reconstruct Strava-originated Virtual Cycling / Trainer sessions from Strava cache or Intervals.icu daily wellness residual load
  const cachedStravaArchive = loadJsonFile<Record<string, any>[]>(STRAVA_ARCHIVE_CACHE_FILE, []);
  const stravaArchiveById = new Map<string, Record<string, any>>();
  for (const sa of cachedStravaArchive) {
    if (sa && sa.id) stravaArchiveById.set(String(sa.id), sa);
  }

  const wellnessByDateMap = new Map<string, (typeof wellnessDays)[number]>();
  for (const w of wellnessDays) {
    if (w && w.date) wellnessByDateMap.set(w.date, w);
  }

  const knownGarminLoadByDate = new Map<string, number>();
  const stubsByDate = new Map<string, Record<string, any>[]>();
  const garminStravaIds = new Set<string>();

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
      if (cachedSa) {
        enrichedRawActivities.push({
          ...a,
          id: `strava-${sid}`,
          strava_id: sid,
          type: cachedSa.sport_type || cachedSa.type || 'VirtualRide',
          name: cachedSa.name || 'Virtual Cycling (Zwift)',
          moving_time: cachedSa.moving_time || cachedSa.elapsed_time || 2700,
          elapsed_time: cachedSa.elapsed_time || cachedSa.moving_time || 2700,
          distance: cachedSa.distance || 24000,
          total_elevation_gain: cachedSa.total_elevation_gain ?? 180,
          trainer: cachedSa.trainer ?? true,
          average_watts: cachedSa.average_watts,
          icu_weighted_avg_watts: cachedSa.weighted_average_watts || cachedSa.average_watts,
          average_heartrate: cachedSa.average_heartrate,
          max_heartrate: cachedSa.max_heartrate,
          average_cadence: cachedSa.average_cadence,
          device_name: cachedSa.device_name || 'Zwift Virtual Cycling',
        });
        continue;
      }

      // Reconstruct Virtual Cycling (Zwift / Smart Trainer) telemetry from Intervals.icu daily wellness residual load & eFTP
      const d = String(a.start_date_local).slice(0, 10);
      const dayStubs = (stubsByDate.get(d) || [])
        .filter((s) => !garminStravaIds.has(String(s.strava_id || s.id)))
        .sort((x, y) => String(x.start_date_local).localeCompare(String(y.start_date_local)));
      const stubIdx = dayStubs.findIndex((s) => String(s.id) === String(a.id));

      const wDay = wellnessByDateMap.get(d);
      const totalDayLoad = wDay ? wDay.dailyLoad : 0;
      const garminLoad = knownGarminLoadByDate.get(d) || 0;
      const residualDayLoad = Math.max(0, totalDayLoad - garminLoad);
      const rideEftp = wDay?.rideEftp || runtimeStore.athleteFtp || 310;

      // Check if this stub is a short Zwift warmup immediately preceding a main event within 25 mins
      let isWarmupStub = false;
      let warmupGapSecs = 720;
      if (stubIdx >= 0 && stubIdx < dayStubs.length - 1) {
        const currMs = new Date(String(a.start_date_local)).getTime();
        const nextMs = new Date(String(dayStubs[stubIdx + 1].start_date_local)).getTime();
        const diffSecs = Math.round((nextMs - currMs) / 1000);
        if (diffSecs >= 180 && diffSecs <= 1800) {
          isWarmupStub = true;
          warmupGapSecs = Math.max(300, diffSecs - 45);
        }
      }

      let sessionLoad = 42;
      if (residualDayLoad > 0) {
        if (dayStubs.length === 1) {
          sessionLoad = residualDayLoad;
        } else if (isWarmupStub) {
          sessionLoad = Math.max(5, Math.min(14, Math.round(residualDayLoad * 0.18)));
        } else {
          const warmupCount = dayStubs.length - 1;
          const mainShare = Math.max(
            12,
            residualDayLoad - Math.round(residualDayLoad * 0.18) * Math.min(1, warmupCount)
          );
          const nonWarmupCount = Math.max(1, dayStubs.length - Math.min(1, warmupCount));
          sessionLoad = Math.max(12, Math.round(mainShare / nonWarmupCount));
        }
      } else {
        sessionLoad = isWarmupStub ? 9 : 46;
      }

      const ifEst = isWarmupStub
        ? 0.64
        : sessionLoad >= 80
          ? 0.88
          : sessionLoad >= 50
            ? 0.81
            : 0.75;
      const movingTimeSecs = isWarmupStub
        ? warmupGapSecs
        : Math.max(
            1200,
            Math.min(7200, Math.round((sessionLoad / (ifEst * ifEst * 100)) * 3600))
          );
      const npWatts = Math.round(rideEftp * ifEst);
      const avgWatts = Math.round(npWatts * (isWarmupStub ? 0.96 : 0.93));
      const speedMps = isWarmupStub ? 8.6 : 9.7; // ~31–35 km/h virtual cycling speed
      const distMeters = Math.round(movingTimeSecs * speedMps);
      const elevMeters = isWarmupStub ? 45 : Math.round((distMeters / 1000) * 8.5);
      const avgHrEst = Math.round(118 + ifEst * 42);
      const maxHrEst = Math.round(avgHrEst + (isWarmupStub ? 10 : 18));

      const sessionLabel = isWarmupStub
        ? 'Zwift — Virtual Cycling Warmup'
        : sessionLoad >= 75
          ? 'Zwift — Virtual Cycling Race / Threshold'
          : 'Zwift — Virtual Cycling Session';

      enrichedRawActivities.push({
        ...a,
        id: `strava-${sid}`,
        strava_id: sid,
        type: 'VirtualRide',
        sub_type: 'VIRTUAL_RIDE',
        name: sessionLabel,
        trainer: true,
        moving_time: movingTimeSecs,
        elapsed_time: movingTimeSecs,
        distance: distMeters,
        total_elevation_gain: elevMeters,
        average_watts: avgWatts,
        icu_average_watts: avgWatts,
        icu_weighted_avg_watts: npWatts,
        icu_intensity: Math.round(ifEst * 100),
        icu_training_load: sessionLoad,
        average_heartrate: avgHrEst,
        max_heartrate: maxHrEst,
        average_cadence: isWarmupStub ? 86 : 90,
        device_name: 'Zwift Virtual Cycling',
      });
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

      let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' = 'Strength';
      if (
        /ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|trackride|cyclocross|zwift|trainerroad|peloton|rouvy|mywhoosh|wahoo|kickr|tacx/i.test(
          combinedMeta
        )
      ) {
        sportCategory = 'Cycling';
      } else if (/run|trailrun|virtualrun|treadmill/i.test(combinedMeta)) {
        sportCategory = 'Running';
      } else if (/swim|openwater/i.test(combinedMeta)) {
        sportCategory = 'Swimming';
      } else if (/triathlon|multisport|brick|transition/i.test(combinedMeta)) {
        sportCategory = 'Multisport';
      } else {
        sportCategory = 'Strength';
      }

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

      const isZeroGpsStationaryRide =
        sportCategory === 'Cycling' &&
        !rawStartLatLng &&
        (hasNoLatLngStream || Number(a.total_elevation_gain ?? 0) === 0);

      const isVirtualPlatform =
        /virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
          combinedMeta
        ) || Boolean(isWatopiaOrMakuriGps);

      const isIndoor =
        Boolean(a.trainer) ||
        Boolean(isVirtualPlatform) ||
        Boolean(isZeroGpsStationaryRide) ||
        /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga|pool/i.test(
          combinedMeta
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
        else if (/gravel/i.test(combinedMeta)) subType = 'Gravel';
        else if (/mountain|mtb|trail/i.test(combinedMeta)) subType = 'Trail';
        else subType = 'Road';
      } else if (sportCategory === 'Running') {
        if (isIndoor) subType = 'Treadmill';
        else if (/trail/i.test(combinedMeta)) subType = 'Trail';
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
            ? a.icu_hr_zone_times
                .slice(0, 7)
                .map((z: any) => (typeof z === 'number' ? z : Number(z?.secs ?? 0)))
            : [0, 0, 0, 0, 0, 0, 0],
          power: Array.isArray(a.icu_zone_times)
            ? a.icu_zone_times
                .slice(0, 7)
                .map((z: any) => (typeof z === 'number' ? z : Number(z?.secs ?? 0)))
            : undefined,
        },
        gearName: resolvedGearName,
        stravaPrCount: Number(a.pr_count ?? 0),
        hasSegments: Boolean(a.has_segments),
        routeLatLngs: undefined as [number, number][] | undefined,
        startLatLng: undefined as [number, number] | undefined,
        endLatLng: undefined as [number, number] | undefined,
        kudosCount: undefined as number | undefined,
        commentCount: undefined as number | undefined,
        hasKudoed: undefined as boolean | undefined,
        kudoers: undefined as any[] | undefined,
        comments: undefined as any[] | undefined,
        segmentEfforts: [] as any[],
        sourceBadges: (a.source === 'GARMIN_CONNECT'
          ? ['Intervals.icu', 'Garmin']
          : a.strava_id
            ? ['Intervals.icu', 'Strava']
            : ['Intervals.icu']) as ('Intervals.icu' | 'Garmin' | 'Strava')[],
      };
    });

  // Hydrate Strava segment efforts + GPS route polylines from local cache + backfill top outdoor Rides & Runs
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

  const uncachedWithSegments = activities.filter(
    (act) =>
      act.hasSegments &&
      (act.sportCategory === 'Cycling' || act.sportCategory === 'Running') &&
      (!Array.isArray(segmentsCache[act.id]) || !Array.isArray(routesCache[act.id]))
  );

  // If fewer than 36 activities have cached segment efforts or fewer than 20 have GPS routes, automatically backfill
  if (
    (Object.keys(segmentsCache).length < 36 || Object.keys(routesCache).length < 20) &&
    uncachedWithSegments.length > 0
  ) {
    const perSportLimit = isDeltaSync ? 3 : 14;
    const cyclingCandidates = uncachedWithSegments
      .filter((a) => a.sportCategory === 'Cycling')
      .slice(0, perSportLimit);
    const runningCandidates = uncachedWithSegments
      .filter((a) => a.sportCategory === 'Running')
      .slice(0, perSportLimit);
    const batchToHydrate = [...cyclingCandidates, ...runningCandidates];

    for (let i = 0; i < batchToHydrate.length; i += 10) {
      const slice = batchToHydrate.slice(i, i + 10);
      await Promise.all(
        slice.map(async (act) => {
          try {
            const [segResp, stResp] = await Promise.all([
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(act.id)}/segments`,
                { headers: { Authorization: authHeader, Accept: 'application/json' } }
              ),
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(act.id)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,altitude`,
                { headers: { Authorization: authHeader, Accept: 'application/json' } }
              ),
            ]);
            if (segResp.ok && stResp.ok) {
              const rawSegs = (await segResp.json()) as any[];
              const rawStreams = (await stResp.json()) as {
                type: string;
                data: number[];
                data2?: number[];
              }[];
              const efforts = computeIntervalsSegmentEfforts(rawSegs, rawStreams, act);
              segmentsCache[act.id] = efforts;

              // Extract compact 160-point GPS route from latlng stream
              const latlngEntry = Array.isArray(rawStreams)
                ? rawStreams.find((s) => s && s.type === 'latlng')
                : undefined;
              if (
                latlngEntry &&
                Array.isArray(latlngEntry.data) &&
                Array.isArray(latlngEntry.data2) &&
                latlngEntry.data.length > 2
              ) {
                const step = Math.max(1, Math.floor(latlngEntry.data.length / 160));
                const compactPts: [number, number][] = [];
                for (let k = 0; k < latlngEntry.data.length; k += step) {
                  const lat = latlngEntry.data[k];
                  const lng = latlngEntry.data2[k];
                  if (
                    lat != null &&
                    lng != null &&
                    !Number.isNaN(lat) &&
                    !Number.isNaN(lng) &&
                    Math.abs(lat) > 0.01
                  ) {
                    compactPts.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
                  }
                }
                if (compactPts.length > 2) {
                  routesCache[act.id] = compactPts;
                }
              }
            } else {
              if (!Array.isArray(segmentsCache[act.id])) segmentsCache[act.id] = [];
            }
          } catch {
            // ignore transient segment/stream fetch error
          }
        })
      );
    }
    saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
  }

  for (const act of activities) {
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
  const latestWellnessRecord =
    wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : null;
  const fullProfile = buildServerAthleteProfile(parsedRawProfile, latestWellnessRecord);
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

function computeIntervalsSegmentEfforts(
  rawSegments: any[],
  rawStreams: { type: string; data: number[]; data2?: number[] }[],
  act: {
    id: string;
    name: string;
    startDateLocal: string;
    sportCategory: string;
    avgHr?: number;
  }
) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return [];
  const fullStreamMap: Record<string, number[]> = {};
  let latArr: number[] = [];
  let lngArr: number[] = [];
  if (Array.isArray(rawStreams)) {
    for (const s of rawStreams) {
      if (s && s.type && Array.isArray(s.data)) {
        fullStreamMap[s.type] = s.data;
        if (s.type === 'latlng' && Array.isArray(s.data2)) {
          latArr = s.data;
          lngArr = s.data2;
        }
      }
    }
  }
  const timeArr = fullStreamMap.time || [];
  const distArr = fullStreamMap.distance || [];
  const wattsArr = fullStreamMap.watts || [];
  const hrArr = fullStreamMap.heartrate || [];
  const altArr = fullStreamMap.altitude || [];

  const efforts: any[] = [];
  for (let idx = 0; idx < rawSegments.length; idx++) {
    const seg = rawSegments[idx];
    if (!seg || (!seg.segment_id && !seg.id)) continue;
    const sIdx = Math.max(0, Number(seg.start_index ?? 0));
    const eIdx = Math.max(sIdx, Number(seg.end_index ?? sIdx));

    const startTimeSecs =
      timeArr.length > sIdx && timeArr[sIdx] != null ? Math.round(timeArr[sIdx]) : sIdx;
    const endTimeSecs =
      timeArr.length > eIdx && timeArr[eIdx] != null ? Math.round(timeArr[eIdx]) : eIdx;

    const elapsedTimeSecs =
      timeArr.length > eIdx && timeArr[eIdx] != null && timeArr[sIdx] != null
        ? Math.max(1, Math.round(timeArr[eIdx] - timeArr[sIdx]))
        : Math.max(1, eIdx - sIdx);

    if (elapsedTimeSecs < 5) continue;

    let distanceMeters = 0;
    if (distArr.length > eIdx && distArr[eIdx] != null && distArr[sIdx] != null) {
      distanceMeters = Math.max(0, Math.round(distArr[eIdx] - distArr[sIdx]));
    }
    if (distanceMeters < 20) continue;

    let averageGradePct = 0;
    if (
      altArr.length > eIdx &&
      altArr[eIdx] != null &&
      altArr[sIdx] != null &&
      distanceMeters > 25
    ) {
      averageGradePct = Number(
        (((altArr[eIdx] - altArr[sIdx]) / distanceMeters) * 100).toFixed(1)
      );
    }

    let avgWatts: number | undefined;
    if (wattsArr.length > sIdx) {
      const sliceW = wattsArr
        .slice(sIdx, Math.min(wattsArr.length, eIdx + 1))
        .filter((v) => v != null && !Number.isNaN(v) && v >= 0);
      if (sliceW.length > 0) {
        const meanW = Math.round(sliceW.reduce((a, b) => a + b, 0) / sliceW.length);
        if (meanW > 0) avgWatts = meanW;
      }
    }

    let avgHr: number | undefined = act.avgHr && act.avgHr > 0 ? act.avgHr : undefined;
    if (hrArr.length > sIdx) {
      const sliceHr = hrArr
        .slice(sIdx, Math.min(hrArr.length, eIdx + 1))
        .filter((v) => v != null && !Number.isNaN(v) && v > 40);
      if (sliceHr.length > 0) {
        avgHr = Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length);
      }
    }

    let startLatLng: [number, number] | undefined;
    let endLatLng: [number, number] | undefined;
    let pathLatLngs: [number, number][] | undefined;
    if (latArr.length > eIdx && lngArr.length > eIdx) {
      const segStep = Math.max(1, Math.floor((eIdx - sIdx + 1) / 36));
      const pts: [number, number][] = [];
      for (let k = sIdx; k <= eIdx; k += segStep) {
        if (latArr[k] != null && lngArr[k] != null && Math.abs(latArr[k]) > 0.01) {
          pts.push([Number(latArr[k].toFixed(5)), Number(lngArr[k].toFixed(5))]);
        }
      }
      if (
        latArr[eIdx] != null &&
        lngArr[eIdx] != null &&
        Math.abs(latArr[eIdx]) > 0.01 &&
        pts.length > 0
      ) {
        pts.push([Number(latArr[eIdx].toFixed(5)), Number(lngArr[eIdx].toFixed(5))]);
      }
      if (pts.length >= 2) {
        pathLatLngs = pts;
        startLatLng = pts[0];
        endLatLng = pts[pts.length - 1];
      }
    }

    const sportCategory: 'Cycling' | 'Running' =
      act.sportCategory === 'Running' ? 'Running' : 'Cycling';
    const avgPaceSecsPerKm =
      sportCategory === 'Running' && distanceMeters > 0
        ? Math.round(elapsedTimeSecs / (distanceMeters / 1000))
        : undefined;

    efforts.push({
      id: `${act.id}-seg-${seg.id || seg.segment_id}-${idx}`,
      segmentId: String(seg.segment_id || seg.id),
      name: String(seg.name || 'Strava Segment').trim(),
      sportCategory,
      distanceMeters,
      averageGradePct,
      elapsedTimeSecs,
      movingTimeSecs: elapsedTimeSecs,
      avgWatts,
      avgPaceSecsPerKm,
      avgHr,
      prRank: null as 1 | 2 | 3 | null,
      komRank: null,
      starred: Boolean(seg.starred),
      startDateLocal: String(act.startDateLocal),
      activityId: String(act.id),
      activityName: String(act.name),
      startTimeSecs,
      endTimeSecs,
      startIndex: sIdx,
      endIndex: eIdx,
      startLatLng,
      endLatLng,
      pathLatLngs,
    });
  }
  return efforts;
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

apiRouter.get('/api/intervals/sync', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }
    const oldestParam = String(req.query.oldest || '2010-01-01').trim();
    const payload = await syncIntervalsAllHistory(apiKey, athleteId, oldestParam);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync Intervals.icu data',
    });
  }
});

// Scan additional batch of historical activities with Strava segments + GPS routes (on-demand deep backfill)
apiRouter.post('/api/segments/scan-more', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }
    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    const resolvedId = athleteId || '0';
    const todayStr = new Date().toISOString().slice(0, 10);
    const activitiesUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2015-01-01&newest=${todayStr}`;
    const actResp = await fetch(activitiesUrl, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!actResp.ok) {
      res.status(actResp.status).json({ error: 'Unable to fetch Intervals.icu activities list' });
      return;
    }
    const rawActivities = (await actResp.json()) as Record<string, any>[];
    const segmentsCache = loadJsonFile<Record<string, any[]>>(SEGMENTS_BY_ACTIVITY_CACHE_FILE, {});
    const routesCache = loadJsonFile<Record<string, [number, number][]>>(
      ROUTES_BY_ACTIVITY_CACHE_FILE,
      {}
    );

    const candidates = rawActivities
      .filter((a) => a && a.id && a.has_segments && !Array.isArray(segmentsCache[String(a.id)]))
      .slice(0, 30);

    let scannedCount = 0;
    for (let i = 0; i < candidates.length; i += 10) {
      const slice = candidates.slice(i, i + 10);
      await Promise.all(
        slice.map(async (rawAct) => {
          const actId = String(rawAct.id);
          const rawType = String(rawAct.type || '');
          const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType)
            ? 'Running'
            : 'Cycling';
          try {
            const [segResp, stResp] = await Promise.all([
              fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/segments`, {
                headers: { Authorization: authHeader, Accept: 'application/json' },
              }),
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,altitude`,
                { headers: { Authorization: authHeader, Accept: 'application/json' } }
              ),
            ]);
            if (segResp.ok && stResp.ok) {
              const rawSegs = (await segResp.json()) as any[];
              const rawStreams = (await stResp.json()) as {
                type: string;
                data: number[];
                data2?: number[];
              }[];
              segmentsCache[actId] = computeIntervalsSegmentEfforts(rawSegs, rawStreams, {
                id: actId,
                name: String(rawAct.name || rawType || sportCategory),
                startDateLocal: String(rawAct.start_date_local || ''),
                sportCategory,
                avgHr: rawAct.average_heartrate
                  ? Math.round(Number(rawAct.average_heartrate))
                  : undefined,
              });
              const latlngEntry = Array.isArray(rawStreams)
                ? rawStreams.find((s) => s && s.type === 'latlng')
                : undefined;
              if (
                latlngEntry &&
                Array.isArray(latlngEntry.data) &&
                Array.isArray(latlngEntry.data2) &&
                latlngEntry.data.length > 2
              ) {
                const step = Math.max(1, Math.floor(latlngEntry.data.length / 160));
                const compactPts: [number, number][] = [];
                for (let k = 0; k < latlngEntry.data.length; k += step) {
                  const lat = latlngEntry.data[k];
                  const lng = latlngEntry.data2[k];
                  if (lat != null && lng != null && Math.abs(lat) > 0.01) {
                    compactPts.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
                  }
                }
                if (compactPts.length > 2) routesCache[actId] = compactPts;
              }
              scannedCount += 1;
            } else {
              segmentsCache[actId] = [];
            }
          } catch {
            // ignore error on single activity
          }
        })
      );
    }
    saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);

    res.json({
      scannedCount,
      remainingUnscannedCount: Math.max(
        0,
        rawActivities.filter(
          (a) => a && a.has_segments && !Array.isArray(segmentsCache[String(a.id)])
        ).length
      ),
      totalCachedActivities: Object.keys(segmentsCache).length,
      segmentsByActivity: segmentsCache,
      routesByActivity: routesCache,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to scan additional segments',
    });
  }
});

// Fetch second-by-second streams (including GPS latlng), auto-detected Intervals.icu intervals, AND Strava segments for an activity
apiRouter.get('/api/intervals/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const { apiKey } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: 'Intervals.icu API Key is not configured.' });
      return;
    }

    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
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
      accessToken: runtimeStore.stravaAccessToken,
      refreshToken: runtimeStore.stravaRefreshToken,
      clientId: runtimeStore.stravaClientId,
      clientSecret: runtimeStore.stravaClientSecret,
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
      accessToken: runtimeStore.stravaAccessToken,
      refreshToken: runtimeStore.stravaRefreshToken,
      clientId,
      clientSecret,
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

apiRouter.get(
  [
    '/auth/strava/callback',
    '/auth/strava/callback/',
    '/api/strava/callback',
    '/api/strava/callback/',
  ],
  stravaCallbackHandler
);

async function syncStravaAllHistory(req?: Request, forceFull = false, deltaOnly = false) {
  await ensureValidStravaAccessToken(req, false);

  if (!runtimeStore.stravaAccessToken) {
    throw new Error('Strava is not connected via OAuth yet.');
  }

  let headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
  const cachedArchive = loadJsonFile<Record<string, any>[]>(STRAVA_ARCHIVE_CACHE_FILE, []);

  let rawActivitiesMap = new Map<string, Record<string, any>>();
  for (const item of cachedArchive) {
    if (item && item.id) rawActivitiesMap.set(String(item.id), item);
  }

  // Probe page 1 first so if the token was stale after a Vercel cold start, we immediately refresh once and retry
  let firstPageResp = await fetch(
    'https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1',
    { headers }
  );
  if (firstPageResp.status === 401 && runtimeStore.stravaRefreshToken) {
    await ensureValidStravaAccessToken(req, true);
    headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
    firstPageResp = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1',
      { headers }
    );
  }

  if (!firstPageResp.ok) {
    if (firstPageResp.status === 401) {
      const errText = await firstPageResp.text();
      if (errText.includes('activity:read_permission')) {
        runtimeStore.stravaAccessToken = '';
        runtimeStore.stravaRefreshToken = '';
        saveSessionCache();
        throw new Error(
          "Strava token is missing 'activity:read_all' permission. Please authorize via OAuth (Method A or Method B in Data Sources)."
        );
      }
      throw new Error(
        'Strava session expired or invalid. Verify your Strava Client ID, Secret, and Refresh Token in Data Sources.'
      );
    }
  } else {
    const firstPageItems = (await firstPageResp.json()) as Record<string, any>[];
    if (Array.isArray(firstPageItems)) {
      for (const item of firstPageItems) {
        if (item && item.id) rawActivitiesMap.set(String(item.id), item);
      }
      const shouldPaginateAll = cachedArchive.length <= 200 || !deltaOnly || forceFull;
      if (shouldPaginateAll && firstPageItems.length === 200) {
        for (let batchStart = 2; batchStart <= 30; batchStart += 3) {
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
  if (activitiesList.length > 0) {
    saveJsonFile(STRAVA_ARCHIVE_CACHE_FILE, activitiesList);
  }

  const starredResp = firstPageResp.ok
    ? await fetch('https://www.strava.com/api/v3/segments/starred?per_page=15', {
        headers,
      })
    : null;
  const starredSegments =
    starredResp && starredResp.ok
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
    .slice(0, 8);

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
      /virtualride|virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
        combinedStravaMeta
      ) || Boolean(isWatopiaOrMakuriGps);

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
        avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : undefined,
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

    const cachedK = kudosCache[String(a.id)];

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
      kudosCount: cachedK?.kudosCount ?? Number(a.kudos_count || 0),
      commentCount: cachedK?.comments?.length ?? Number(a.comment_count || 0),
      achievementCount: Number(a.achievement_count || 0),
      athleteCount: Number(a.athlete_count || 1),
      hasKudoed: cachedK?.hasKudoed ?? Boolean(a.has_kudoed),
      kudoers: cachedK?.kudoers,
      comments: cachedK?.comments,
      summaryPolyline,
      routeLatLngs: decodedRoute && decodedRoute.length >= 2 ? decodedRoute : undefined,
      startLatLng,
      endLatLng,
      segmentEfforts,
    };
  });

  if (normalizedStravaActivities.length > 0) {
    runtimeStore.stravaActivitiesCount = normalizedStravaActivities.length;
  }
  saveSessionCache();

  return {
    athleteName: runtimeStore.stravaAthleteName,
    activities: normalizedStravaActivities,
    stravaTokens: getStravaTokenRotationPayload(),
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
    const deltaOnly = req.query.deltaOnly === 'true';
    const data = await syncStravaAllHistory(req, forceFull, deltaOnly);
    res.json(data);
  } catch (error) {
    res.status(401).json({
      error:
        error instanceof Error ? error.message : 'Failed to sync Strava activities and segments',
    });
  }
});

apiRouter.get('/api/strava/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    await ensureValidStravaAccessToken(req, false);

    if (!runtimeStore.stravaAccessToken) {
      res.status(401).json({ error: 'Strava is not connected.' });
      return;
    }

    const activityId = req.params.id;
    const headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
    const [streamsResp, detailResp, kudosResp] = await Promise.all([
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/streams?keys=time,distance,latlng,watts,heartrate,velocity_smooth,cadence,altitude&key_by_type=true`,
        { headers }
      ),
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}?include_all_efforts=true`,
        { headers }
      ),
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/kudos?per_page=50`,
        { headers }
      ),
    ]);

    if (!streamsResp.ok && !detailResp.ok) {
      res.status(streamsResp.status).json({ error: 'Unable to load Strava streams for activity.' });
      return;
    }

    const raw = streamsResp.ok
      ? ((await streamsResp.json()) as Record<string, { data?: any[] }>)
      : {};
    const timeData = Array.isArray(raw?.time?.data) ? (raw.time.data as number[]) : [];
    const step = Math.max(1, Math.floor(timeData.length / 500));
    const downsample = (arr?: number[]) =>
      Array.isArray(arr) ? arr.filter((_, idx) => idx % step === 0) : undefined;

    const rawLatLng = Array.isArray(raw?.latlng?.data) ? (raw.latlng.data as [number, number][]) : undefined;
    const downsampledLatLng = rawLatLng
      ? rawLatLng
          .filter((_, idx) => idx % step === 0)
          .filter((pt) => Array.isArray(pt) && pt.length === 2 && Math.abs(pt[0]) > 0.01)
          .map((pt): [number, number] => [Number(Number(pt[0]).toFixed(5)), Number(Number(pt[1]).toFixed(5))])
      : undefined;

    let segmentEfforts: any[] = [];
    if (detailResp.ok) {
      const detail = (await detailResp.json()) as Record<string, any>;
      const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
      const sportType = String(detail.sport_type || detail.type || '');
      const sportCat = /run|trailrun|virtualrun|treadmill/i.test(sportType)
        ? ('Running' as const)
        : ('Cycling' as const);
      segmentEfforts = rawEfforts.slice(0, 40).map((se: Record<string, any>) => {
        const dist = Math.round(Number(se.distance || se.segment?.distance || 0));
        const elTime = Number(se.elapsed_time || 0);
        const sIdx = typeof se.start_index === 'number' ? se.start_index : undefined;
        const eIdx = typeof se.end_index === 'number' ? se.end_index : undefined;
        let pathLatLngs: [number, number][] | undefined;
        if (rawLatLng && sIdx !== undefined && eIdx !== undefined && rawLatLng.length > eIdx) {
          const segStep = Math.max(1, Math.floor((eIdx - sIdx + 1) / 36));
          const pts: [number, number][] = [];
          for (let k = sIdx; k <= eIdx; k += segStep) {
            const p = rawLatLng[k];
            if (Array.isArray(p) && p.length === 2 && Math.abs(p[0]) > 0.01) {
              pts.push([Number(Number(p[0]).toFixed(5)), Number(Number(p[1]).toFixed(5))]);
            }
          }
          if (pts.length >= 2) pathLatLngs = pts;
        }
        return {
          id: String(se.id),
          segmentId: String(se.segment?.id || se.id),
          name: String(se.name || se.segment?.name || 'Segment'),
          sportCategory: sportCat,
          distanceMeters: dist,
          averageGradePct: Number(se.segment?.average_grade ?? 0),
          elapsedTimeSecs: elTime,
          movingTimeSecs: Number(se.moving_time || elTime),
          avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : undefined,
          avgPaceSecsPerKm:
            sportCat === 'Running' && dist > 0 && elTime > 0
              ? Math.round(elTime / (dist / 1000))
              : undefined,
          avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : undefined,
          prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
          komRank: typeof se.kom_rank === 'number' ? se.kom_rank : null,
          startDateLocal: String(se.start_date_local || detail.start_date_local || ''),
          activityId: String(detail.id || activityId),
          activityName: String(detail.name || ''),
          startIndex: sIdx,
          endIndex: eIdx,
          startLatLng: pathLatLngs?.[0],
          endLatLng: pathLatLngs?.[pathLatLngs.length - 1],
          pathLatLngs,
        };
      });
    }

    let kudoers: any[] | undefined;
    if (kudosResp.ok) {
      const rawKudos = (await kudosResp.json()) as any[];
      if (Array.isArray(rawKudos)) {
        kudoers = rawKudos.map((k: any) => ({
          firstname: String(k.firstname || 'Athlete'),
          lastname: String(k.lastname || ''),
          profileMedium: k.profile_medium || k.profile || undefined,
          city: k.city || undefined,
          state: k.state || undefined,
          country: k.country || undefined,
        }));
      }
    }

    res.json({
      streams: {
        time: downsample(raw?.time?.data as number[]) || [],
        distance: downsample(raw?.distance?.data as number[]),
        latlng: downsampledLatLng,
        watts: downsample(raw?.watts?.data as number[]),
        heartrate: downsample(raw?.heartrate?.data as number[]),
        velocitySmooth: downsample(raw?.velocity_smooth?.data as number[]),
        cadence: downsample(raw?.cadence?.data as number[]),
        altitude: downsample(raw?.altitude?.data as number[]),
      },
      segmentEfforts,
      kudoers,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Strava activity streams',
    });
  }
});

// Fetch Strava Kudoers & Comments for a specific activity (live Strava API + cached/local social notes)
apiRouter.get('/api/strava/activities/:id/kudos', async (req: Request, res: Response) => {
  try {
    const activityId = String(req.params.id);
    const stravaId = String(req.query.stravaId || activityId).replace(/^strava-/, '');
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

    const { clientId, clientSecret, refreshToken, accessToken } = getEffectiveStravaClientConfig(req);
    if (accessToken && !runtimeStore.stravaAccessToken) runtimeStore.stravaAccessToken = accessToken;
    if (refreshToken && !runtimeStore.stravaRefreshToken) runtimeStore.stravaRefreshToken = refreshToken;

    const nowSecs = Math.floor(Date.now() / 1000);
    if (
      (!runtimeStore.stravaAccessToken ||
        (runtimeStore.stravaExpiresAt > 0 && nowSecs >= runtimeStore.stravaExpiresAt - 60)) &&
      runtimeStore.stravaRefreshToken &&
      clientId &&
      clientSecret
    ) {
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
        runtimeStore.stravaRefreshToken = refreshed.refresh_token || runtimeStore.stravaRefreshToken;
        runtimeStore.stravaExpiresAt = refreshed.expires_at;
        saveSessionCache();
      }
    }

    if (runtimeStore.stravaAccessToken && /^\d+$/.test(stravaId)) {
      const headers = { Authorization: `Bearer ${runtimeStore.stravaAccessToken}` };
      const [kResp, cResp] = await Promise.all([
        fetch(
          `https://www.strava.com/api/v3/activities/${encodeURIComponent(stravaId)}/kudos?per_page=100`,
          { headers }
        ),
        fetch(
          `https://www.strava.com/api/v3/activities/${encodeURIComponent(stravaId)}/comments?per_page=50`,
          { headers }
        ),
      ]);

      if (kResp.ok) {
        const rawKudos = (await kResp.json()) as any[];
        const kudoers = Array.isArray(rawKudos)
          ? rawKudos.map((k: any) => ({
              firstname: String(k.firstname || 'Athlete'),
              lastname: String(k.lastname || ''),
              profileMedium: k.profile_medium || k.profile || undefined,
              city: k.city || undefined,
              state: k.state || undefined,
              country: k.country || undefined,
            }))
          : [];
        const existing = kudosCache[activityId] || kudosCache[stravaId] || {};
        let mergedComments = existing.comments || [];
        if (cResp.ok) {
          const rawComments = (await cResp.json()) as any[];
          if (Array.isArray(rawComments)) {
            const remoteComments = rawComments.map((c: any, idx: number) => ({
              id: String(c.id || `sc-${stravaId}-${idx}`),
              text: String(c.text || ''),
              createdAt: String(c.created_at || new Date().toISOString()),
              athleteName:
                [c.athlete?.firstname, c.athlete?.lastname].filter(Boolean).join(' ') ||
                'Strava Athlete',
              avatarUrl: c.athlete?.profile_medium || undefined,
            }));
            const seenIds = new Set(mergedComments.map((mc: any) => mc.id));
            mergedComments = [
              ...mergedComments,
              ...remoteComments.filter((rc) => !seenIds.has(rc.id)),
            ];
          }
        }
        const updatedEntry = {
          ...existing,
          kudosCount: Math.max(existing.kudosCount || 0, kudoers.length + (existing.hasKudoed ? 1 : 0)),
          kudoers,
          comments: mergedComments,
        };
        kudosCache[activityId] = updatedEntry;
        kudosCache[stravaId] = updatedEntry;
        saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);
      }
    }

    const entry = kudosCache[activityId] || kudosCache[stravaId] || {};
    res.json({
      kudosCount: entry.kudosCount || 0,
      hasKudoed: Boolean(entry.hasKudoed),
      kudoers: entry.kudoers || [],
      comments: entry.comments || [],
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Strava kudos',
    });
  }
});

// Toggle Kudos or add a Club / Coaching Comment on an activity
apiRouter.post('/api/activities/:id/kudos', (req: Request, res: Response) => {
  try {
    const activityId = String(req.params.id);
    const { action = 'toggle_kudos', commentText, athleteName } = req.body || {};
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

    const current = kudosCache[activityId] || {
      kudosCount: Number(req.body?.currentKudosCount || 0),
      hasKudoed: false,
      kudoers: [],
      comments: [],
    };

    const resolvedName =
      req.body?.authorName ||
      athleteName ||
      runtimeStore.stravaAthleteName ||
      runtimeStore.intervalsAthleteName ||
      'AeroPulse Athlete';
    const [first, ...rest] = String(resolvedName).trim().split(' ');
    const last = rest.join(' ') || '';

    if (
      (action === 'comment' || action === 'add_comment') &&
      commentText &&
      String(commentText).trim()
    ) {
      const newComment = {
        id: `comment-${Date.now()}`,
        text: String(commentText).trim(),
        createdAt: new Date().toISOString(),
        athleteName: resolvedName,
        authorName: resolvedName,
      };
      current.comments = [...(current.comments || []), newComment];
    } else {
      const nextKudoed = !current.hasKudoed;
      current.hasKudoed = nextKudoed;
      const baseCount = Math.max(0, Number(current.kudosCount || 0));
      current.kudosCount = nextKudoed ? baseCount + 1 : Math.max(0, baseCount - 1);
      const existingKudoers = Array.isArray(current.kudoers) ? [...current.kudoers] : [];
      if (nextKudoed) {
        if (!existingKudoers.some((k) => k.firstname === first && k.lastname === last)) {
          existingKudoers.unshift({
            firstname: first,
            lastname: last,
            city: 'AeroPulse Club',
          });
        }
      } else {
        const idx = existingKudoers.findIndex((k) => k.firstname === first && k.lastname === last);
        if (idx >= 0) existingKudoers.splice(idx, 1);
      }
      current.kudoers = existingKudoers;
    }

    kudosCache[activityId] = current;
    saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);

    res.json({
      activityId,
      kudosCount: current.kudosCount || 0,
      hasKudoed: Boolean(current.hasKudoed),
      kudoers: current.kudoers || [],
      comments: current.comments || [],
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update activity kudos',
    });
  }
});

// Hydrate GPS route polylines from Intervals.icu /map for a batch of outdoor workouts
apiRouter.post('/api/activities/hydrate-routes', async (req: Request, res: Response) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    const routesCache = loadJsonFile<Record<string, [number, number][]>>(
      ROUTES_BY_ACTIVITY_CACHE_FILE,
      {}
    );
    if (!apiKey) {
      res.json({ routesByActivity: routesCache });
      return;
    }
    const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    let activityIds: string[] = Array.isArray(req.body?.activityIds)
      ? req.body.activityIds.map(String).slice(0, 32)
      : [];

    if (activityIds.length === 0) {
      const resolvedId = athleteId || '0';
      const todayStr = new Date().toISOString().slice(0, 10);
      const actResp = await fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2018-01-01&newest=${todayStr}`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      );
      if (actResp.ok) {
        const rawActs = (await actResp.json()) as Record<string, any>[];
        activityIds = rawActs
          .filter(
            (a) =>
              a &&
              a.id &&
              !a.trainer &&
              Number(a.distance || 0) > 1000 &&
              !Array.isArray(routesCache[String(a.id)])
          )
          .slice(0, 32)
          .map((a) => String(a.id));
      }
    }

    const toFetch = activityIds.filter((id) => id && !Array.isArray(routesCache[id]));
    for (let i = 0; i < toFetch.length; i += 8) {
      const slice = toFetch.slice(i, i + 8);
      await Promise.all(
        slice.map(async (actId) => {
          try {
            const mapResp = await fetch(
              `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/map`,
              { headers: { Authorization: authHeader, Accept: 'application/json' } }
            );
            if (mapResp.ok) {
              const mapJson = (await mapResp.json()) as { latlngs?: [number, number][] };
              if (Array.isArray(mapJson.latlngs) && mapJson.latlngs.length > 2) {
                const rawPts = mapJson.latlngs.filter(
                  (p) =>
                    Array.isArray(p) &&
                    p.length === 2 &&
                    p[0] != null &&
                    p[1] != null &&
                    Math.abs(p[0]) > 0.01
                );
                const step = Math.max(1, Math.floor(rawPts.length / 180));
                const compactPts = rawPts
                  .filter((_, idx) => idx % step === 0)
                  .map((p): [number, number] => [
                    Number(Number(p[0]).toFixed(5)),
                    Number(Number(p[1]).toFixed(5)),
                  ]);
                if (compactPts.length >= 2) {
                  routesCache[actId] = compactPts;
                }
              }
            }
          } catch {
            // ignore single map error
          }
        })
      );
    }
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
    res.json({ routesByActivity: routesCache });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to hydrate GPS routes',
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

apiRouter.all('/api/cron/hourly-sync', async (_req: Request, res: Response) => {
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Background sync failed',
    });
  }
});

// Real-Time Webhook Receiver for Intervals.icu (ACTIVITY_UPLOADED, WELLNESS_UPDATED, etc.)
apiRouter.post('/api/webhooks/intervals', async (req: Request, res: Response) => {
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: 'intervals-webhook',
      eventsReceived: Array.isArray(req.body?.events) ? req.body.events.length : 1,
      ...summary,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Intervals webhook sync failed',
    });
  }
});

// Real-Time Push Webhook Verification & Receiver for Strava
apiRouter.get('/api/webhooks/strava', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && challenge) {
    res.json({ 'hub.challenge': challenge });
    return;
  }
  res.json({ ok: true, status: 'Strava webhook endpoint ready' });
});

apiRouter.post('/api/webhooks/strava', async (req: Request, res: Response) => {
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: 'strava-webhook',
      aspectType: req.body?.aspect_type,
      objectId: req.body?.object_id,
      ...summary,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Strava webhook sync failed',
    });
  }
});

// Start in-process hourly background polling timer (every 60 minutes on persistent Node runtimes)
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  executeHourlyBackgroundPoll().catch(() => {
    // ignore background errors
  });
}, HOURLY_INTERVAL_MS);

// ----------------------------------------------------------------------------
// 6. Gemini AI Coach — Daily Options, Multi-Turn Chat & Direct Calendar Program Generator
// ----------------------------------------------------------------------------
function buildDeterministicDailyWorkoutOptions(
  sportPreference: string,
  environmentPreference: string,
  durationMinutes: number,
  telemetrySummary: Record<string, any> = {}
) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const ctl = Number(w.ctl || 72.0).toFixed(1);
  const tsb = Number(w.tsb ?? 0).toFixed(1);
  const hrv = Math.round(Number(w.hrvRMSSD || 44));
  const hrvStatus = String(w.hrvStatus || 'Balanced');
  const sleepScore = Math.round(Number(w.sleepScore || 82));
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 300));
  const isRun = /run/i.test(sportPreference);
  const dur = Math.max(30, Math.round(Number(durationMinutes) || 60));
  const mainMins = Math.max(15, dur - 25);

  return [
    {
      id: `opt-det-1-${Date.now()}`,
      tier: 'OPTIMAL',
      tierLabel: 'Option A · Optimal Progression',
      title: isRun
        ? `Threshold Cruise Intervals (4×${Math.max(4, Math.round(mainMins / 5))}m @ LT2 Pace)`
        : `Sweet Spot & Threshold Progression (3×${Math.max(8, Math.round(mainMins / 3.5))}m @ 92% FTP)`,
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: environmentPreference,
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 1.15),
      summary: `Advances chronic fitness (CTL ${ctl}) toward your target block while respecting current TSB (${tsb}).`,
      physiologicalWhy: `Calibrated for CTL ${ctl}, morning HRV ${hrv} ms (${hrvStatus}), and Sleep Score ${sleepScore}. Sustains sub-threshold metabolic stimulus around ~${Math.round(ftp * 0.92)}W.`,
      workoutSyntax: isRun
        ? `- 15m 70% Pace\n- 4x ${Math.max(4, Math.round(mainMins / 5))}m 98% Pace\n- 10m 68% Pace`
        : `- 15m 62% FTP\n- ${Math.max(20, mainMins)}m 91% FTP\n- 10m 55% FTP`,
      structuredSteps: [
        { label: 'Progressive Warmup', duration: '15m', targetZoneOrOutput: 'Z1–Z2 Aerobic Ramp' },
        {
          label: 'Main Threshold / Sweet Spot Block',
          duration: `${mainMins}m`,
          targetZoneOrOutput: isRun ? '96–99% Threshold Pace (Z4)' : `${Math.round(ftp * 0.9)}–${Math.round(ftp * 0.94)}W (90–94% FTP)`,
        },
        { label: 'Cooldown Flush', duration: '10m', targetZoneOrOutput: 'Z1 Easy Recovery' },
      ],
    },
    {
      id: `opt-det-2-${Date.now()}`,
      tier: 'MODULATED',
      tierLabel: 'Option B · Modulated Aerobic Durability',
      title: isRun
        ? `Zone 2 Aerobic Base Run + 4×20s Neuromuscular Strides`
        : `Endurance Zone 2 Aerobic Efficiency (${Math.round(ftp * 0.68)}–${Math.round(ftp * 0.74)}W)`,
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: environmentPreference,
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 0.78),
      summary: `Builds mitochondrial density and low-decoupling aerobic durability with controlled autonomic strain.`,
      physiologicalWhy: `Ideal when HRV is ${hrv} ms (${hrvStatus}) and TSB is ${tsb}—accumulates high-quality aerobic volume without deepening sympathetic fatigue.`,
      workoutSyntax: `- 10m 58% FTP\n- ${Math.max(20, dur - 20)}m 70% FTP\n- 10m 55% FTP`,
      structuredSteps: [
        { label: 'Easy Settling', duration: '10m', targetZoneOrOutput: '58–62% FTP (Z1/Z2)' },
        {
          label: 'Steady Aerobic Cruise',
          duration: `${Math.max(20, dur - 20)}m`,
          targetZoneOrOutput: `${Math.round(ftp * 0.68)}–${Math.round(ftp * 0.74)}W (68–74% FTP · Z2)`,
        },
        { label: 'Cooldown', duration: '10m', targetZoneOrOutput: '55% FTP (Z1)' },
      ],
    },
    {
      id: `opt-det-3-${Date.now()}`,
      tier: 'RECOVERY',
      tierLabel: 'Option C · Active Parasympathetic Recovery',
      title: isRun
        ? 'Zone 1 Recovery Shakeout & Mobility Flow'
        : `Zone 1 Parasympathetic Recovery Spin (${Math.round(ftp * 0.52)}W · 95 rpm)`,
      sportCategory: isRun ? 'Running' : 'Cycling',
      environment: 'INDOOR',
      durationMinutes: Math.min(45, dur),
      estimatedLoad: 28,
      summary: 'Promotes parasympathetic rebound and elevates HRV toward your 7-day baseline.',
      physiologicalWhy: `With HRV at ${hrv} ms (${hrvStatus}), keeping intensity strictly in Zone 1 accelerates autonomic restoration ahead of your next key workout.`,
      workoutSyntax: `- 10m 50% FTP\n- 25m 55% FTP\n- 10m 48% FTP`,
      structuredSteps: [
        { label: 'Easy Spin / Shakeout', duration: '35m', targetZoneOrOutput: '50–55% FTP · HR < 68% Max' },
        { label: 'Mobility & Cooldown', duration: '10m', targetZoneOrOutput: 'Z1 Flush' },
      ],
    },
  ];
}

function buildDeterministicCoachChatResponse(
  message: string,
  telemetrySummary: Record<string, any> = {},
  todayStr: string
) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const ctl = Number(w.ctl || 72.0).toFixed(1);
  const atl = Number(w.atl || 68.0).toFixed(1);
  const tsb = Number(w.tsb ?? (Number(ctl) - Number(atl))).toFixed(1);
  const hrv = Math.round(Number(w.hrvRMSSD || 40));
  const hrvBaseline = Math.round(Number(w.hrvBaseline7d || 44));
  const hrvStatus = String(w.hrvStatus || (hrv < hrvBaseline - 3 ? 'Unbalanced' : 'Balanced'));
  const sleepHours = w.sleepSecs ? (Number(w.sleepSecs) / 3600).toFixed(1) : '7.4';
  const sleepScore = Math.round(Number(w.sleepScore || 80));
  const statusLabel = String(w.garminTrainingStatus || 'Maintaining');
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 300));
  const lthr = Math.round(Number(t.lthr || runtimeStore.athleteLthr || 165));

  const addDays = (base: string, offset: number) => {
    const d = new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const isSuppressed = hrvStatus === 'Unbalanced' || hrvStatus === 'Low' || Number(tsb) < -12;
  const wantsRunOnly = /\brun(ning)?\b/i.test(message) && !/\bcycl(e|ing)|bike|ride|trainer\b/i.test(message);
  const wantsMultiDay = /\b(week|5-day|schedule|plan|block|days)\b/i.test(message);

  const rawProposals = wantsMultiDay
    ? [
        {
          date: todayStr,
          name: isSuppressed
            ? 'Modulated Zone 2 Aerobic Base (HRV-Adjusted)'
            : 'Sweet Spot 3×12m @ 90% FTP Progression',
          sportCategory: wantsRunOnly ? 'Running' : 'Cycling',
          environmentPreference: 'INDOOR',
          plannedDurationSecs: 3600,
          plannedLoad: isSuppressed ? 52 : 78,
          workoutSyntax: isSuppressed
            ? '- 10m 55% FTP\n- 40m 68% FTP\n- 10m 52% FTP'
            : '- 12m 62% FTP\n- 36m 90% FTP\n- 12m 55% FTP',
          description: isSuppressed
            ? `Modulated Z2 session protecting autonomic recovery while HRV is ${hrv} ms (${hrvStatus}).`
            : `Builds sub-threshold muscular endurance around ${Math.round(ftp * 0.9)}W.`,
        },
        {
          date: addDays(todayStr, 1),
          name: 'Aerobic Zone 2 Road Run + Neuromuscular Strides',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          plannedDurationSecs: 3300,
          plannedLoad: 58,
          workoutSyntax: '- 10m 68% Pace\n- 35m 78% Pace\n- 10m 65% Pace',
          description: 'Steady aerobic running economy session with <3% cardiac drift target.',
        },
        {
          date: addDays(todayStr, 2),
          name: 'Active Parasympathetic Recovery Spin & Mobility',
          sportCategory: 'Cycling',
          environmentPreference: 'INDOOR',
          plannedDurationSecs: 2700,
          plannedLoad: 28,
          workoutSyntax: '- 10m 50% FTP\n- 25m 55% FTP\n- 10m 48% FTP',
          description: 'Low-torque parasympathetic recovery flush to restore HRV into your balanced corridor.',
        },
        {
          date: addDays(todayStr, 3),
          name: wantsRunOnly
            ? 'Lactate Threshold Cruise Intervals (4×6m @ LT2)'
            : `Over-Under Lactate Clearance (3×10m @ ${Math.round(ftp * 0.95)}W)`,
          sportCategory: wantsRunOnly ? 'Running' : 'Cycling',
          environmentPreference: wantsRunOnly ? 'OUTDOOR' : 'INDOOR',
          plannedDurationSecs: 4200,
          plannedLoad: 86,
          workoutSyntax: '- 15m 62% FTP\n- 30m 95% FTP\n- 25m 65% FTP',
          description: 'Key mid-week threshold stimulus once autonomic readiness rebounds.',
        },
        {
          date: addDays(todayStr, 4),
          name: 'Long Endurance Aerobic Base Progression',
          sportCategory: wantsRunOnly ? 'Running' : 'Cycling',
          environmentPreference: 'OUTDOOR',
          plannedDurationSecs: 5400,
          plannedLoad: 98,
          workoutSyntax: '- 15m 60% FTP\n- 65m 73% FTP\n- 10m 55% FTP',
          description: 'Extended Zone 2 mitochondrial durability session.',
        },
      ]
    : [
        {
          date: todayStr,
          name: isSuppressed
            ? `HRV-Modulated Zone 2 Endurance (${Math.round(ftp * 0.68)}W)`
            : `Indoor Threshold & Sweet Spot (${Math.round(ftp * 0.91)}W)`,
          sportCategory: wantsRunOnly ? 'Running' : 'Cycling',
          environmentPreference: 'INDOOR',
          plannedDurationSecs: 3600,
          plannedLoad: isSuppressed ? 50 : 76,
          workoutSyntax: isSuppressed
            ? '- 10m 55% FTP\n- 40m 68% FTP\n- 10m 52% FTP'
            : '- 12m 62% FTP\n- 36m 91% FTP\n- 12m 55% FTP',
          description: isSuppressed
            ? `Caps intensity in Zone 2 while HRV (${hrv} ms) is ${hrvStatus}.`
            : `Targets 91% FTP (~${Math.round(ftp * 0.91)}W) with HR capped below ${lthr} bpm.`,
        },
        {
          date: addDays(todayStr, 1),
          name: 'Aerobic Base Run + 6×20s Strides',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          plannedDurationSecs: 3300,
          plannedLoad: 56,
          workoutSyntax: '- 10m 68% Pace\n- 35m 78% Pace\n- 10m 65% Pace',
          description: 'Complementary aerobic run advancing weekly volume with low autonomic strain.',
        },
      ];

  const proposedWorkouts = rawProposals.map((pw, i) => ({
    id: `ai-prop-${Date.now()}-${i}`,
    date: pw.date,
    name: pw.name,
    sportCategory: pw.sportCategory as 'Cycling' | 'Running',
    environmentPreference: pw.environmentPreference as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE',
    description: pw.description,
    plannedLoad: pw.plannedLoad,
    plannedDurationSecs: pw.plannedDurationSecs,
    targetZoneSummary: `${pw.plannedLoad} TSS · AeroPulse Physiology Engine`,
    workoutSyntax: pw.workoutSyntax,
    structuredSteps: parseWorkoutSyntaxToSteps(pw.workoutSyntax, pw.plannedDurationSecs),
    source: 'AI_COACH' as const,
  }));

  const readinessAnalysis = isSuppressed
    ? `Your overnight **HRV is ${hrv} ms (${hrvStatus})** alongside a **CTL of ${ctl}** and **TSB of ${tsb}** (${statusLabel}). Because your autonomic nervous system shows mild suppression relative to your **${hrvBaseline} ms** baseline, today's optimal physiological move is to **modulate high-glycolytic VO2/Anaerobic stress** and focus on **Zone 2 Aerobic Base (${Math.round(ftp * 0.65)}–${Math.round(ftp * 0.73)}W, HR < ${Math.round(lthr * 0.85)} bpm)** for the next 24–36 hours before hitting your key threshold session.`
    : `Your morning **HRV is ${hrv} ms (${hrvStatus})**, **Sleep Score is ${sleepScore}/100 (${sleepHours}h)**, and **Fitness (CTL) stands at ${ctl}** with **Form (TSB) at ${tsb}** (${statusLabel}). Your autonomic baseline is well-positioned to absorb a structured **Sweet Spot / Lactate Threshold progression (~${Math.round(ftp * 0.9)}–${Math.round(ftp * 0.95)}W, LTHR ${lthr} bpm)** today.`;

  const reply = `${readinessAnalysis}\n\nI have generated **${proposedWorkouts.length} structured workouts** below tailored to your **${ftp}W FTP** and current readiness—click **Schedule** on any card to push it directly to your Training Calendar.\n\n*(Note: Running on AeroPulse's built-in Physiology Engine. To enable live generative Gemini LLM responses, click **API Key** in the top-right of this drawer and paste a free key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) or set \`GEMINI_API_KEY\` in your environment variables.)*`;

  return {
    reply,
    citedMetrics: [
      `CTL ${ctl} · TSB ${tsb}`,
      `HRV ${hrv} ms (${hrvStatus})`,
      `Sleep ${sleepHours}h (Score ${sleepScore})`,
      `FTP ${ftp}W · LTHR ${lthr} bpm`,
    ],
    proposedWorkouts,
    engine: 'LOCAL_PHYSIOLOGY_ENGINE',
  };
}

apiRouter.post('/api/coach/options', async (req: Request, res: Response) => {
  const {
    sportPreference = 'Cycling',
    environmentPreference = 'INDOOR',
    durationMinutes = 60,
    telemetrySummary,
  } = req.body || {};

  try {
    const ai = getGeminiClient(req);
    if (!ai) {
      res.json({
        options: buildDeterministicDailyWorkoutOptions(
          sportPreference,
          environmentPreference,
          durationMinutes,
          telemetrySummary
        ),
        engine: 'LOCAL_PHYSIOLOGY_ENGINE',
      });
      return;
    }

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

    const response = await generateGeminiContentWithFallback(ai, {
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
    res.json({ options: parsed, engine: 'GEMINI_LIVE' });
  } catch {
    res.json({
      options: buildDeterministicDailyWorkoutOptions(
        sportPreference,
        environmentPreference,
        durationMinutes,
        telemetrySummary
      ),
      engine: 'LOCAL_PHYSIOLOGY_ENGINE',
    });
  }
});

apiRouter.post('/api/coach/chat', async (req: Request, res: Response) => {
  const { message, history = [], telemetrySummary } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Message is required.' });
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    const ai = getGeminiClient(req);
    if (!ai) {
      res.json(buildDeterministicCoachChatResponse(message, telemetrySummary, todayStr));
      return;
    }

    const conversationContext = Array.isArray(history)
      ? history
          .slice(-8)
          .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n')
      : '';

    const response = await generateGeminiContentWithFallback(ai, {
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
      engine: 'GEMINI_LIVE',
    });
  } catch {
    res.json(buildDeterministicCoachChatResponse(message, telemetrySummary, todayStr));
  }
});

// Parse Official Race Results from Athletic.net, TFRRS, MileSplit, or RunSignup URL / Raw Text
apiRouter.post('/races/parse', async (req: Request, res: Response) => {
  try {
    const { url, rawText } = req.body as { url?: string; rawText?: string };
    let fetchedTextSnippet = '';
    let fetchNote = '';

    if (url && typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);
        const remoteResp = await fetch(url.trim(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (remoteResp.ok) {
          const html = await remoteResp.text();
          fetchedTextSnippet = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<\/?(tr|p|div|li|br|h1|h2|h3|h4|table)[^>]*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .slice(0, 18000);
        } else {
          fetchNote = `Remote site returned HTTP ${remoteResp.status} (anti-bot protection); parsed provided text.`;
        }
      } catch {
        fetchNote =
          'Remote platform throttled direct crawler access; parsed pasted results text.';
      }
    }

    const combinedInput = [
      url ? `SOURCE URL: ${url}` : '',
      rawText ? `USER PASTED RESULTS:\n${rawText}` : '',
      fetchedTextSnippet ? `FETCHED PAGE CONTENT:\n${fetchedTextSnippet}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!combinedInput.trim()) {
      res.status(400).json({ error: 'Provide an Athletic.net / TFRRS / MileSplit URL or pasted race results text.' });
      return;
    }

    const ai = getGeminiClient(req);
    if (ai) {
      try {
        const response = await generateGeminiContentWithFallback(ai, {
          contents: `Extract all official track & field, cross country, or road race results from the following input (from Athletic.net, TFRRS, MileSplit, RunSignup, or meet result tables).
Convert every race into structured JSON with exact FAT time in seconds (to 0.01s precision, e.g. "1:56.38" -> 116.38, "4:16.42" -> 256.42), eventLabel ("400m", "800m", "1500m", "1600m", "1 Mile", "3000m", "3200m", "5000m", "10000m", "XC 5K", "Road 5K", "Half Marathon"), eventDistanceMeters, date (YYYY-MM-DD), meetName, placeFinish, platform ("Athletic.net", "TFRRS", "MileSplit", "RunSignup", or "Official FAT"), trackType ("OUTDOOR_400M", "INDOOR_BANKED_200M", "INDOOR_FLAT_200M", "XC_COURSE", or "ROAD"), and lapSplitsSecs (array of lap split times in seconds if present).

INPUT:
${combinedInput}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                races: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING, description: 'YYYY-MM-DD' },
                      meetName: { type: Type.STRING },
                      eventLabel: { type: Type.STRING, description: 'e.g. 800m, 1500m, 1600m, 3200m, XC 5K' },
                      eventDistanceMeters: { type: Type.NUMBER },
                      displayFatTime: { type: Type.STRING, description: 'e.g. 1:56.38 or 4:16.42' },
                      fatTimeSecs: { type: Type.NUMBER, description: 'Total seconds with decimals, e.g. 116.38' },
                      platform: { type: Type.STRING, description: 'Athletic.net, TFRRS, MileSplit, RunSignup, or Official FAT' },
                      trackType: { type: Type.STRING, description: 'OUTDOOR_400M, INDOOR_BANKED_200M, INDOOR_FLAT_200M, XC_COURSE, or ROAD' },
                      placeFinish: { type: Type.STRING },
                      windReading: { type: Type.STRING },
                      lapSplitsSecs: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        const parsedJson = JSON.parse((response.text ?? '{}').trim());
        if (Array.isArray(parsedJson.races) && parsedJson.races.length > 0) {
          res.json({
            races: parsedJson.races,
            fetchNote,
            source: 'GEMINI_STRUCTURED',
          });
          return;
        }
      } catch {
        // Fall through to deterministic response so the client parser handles it cleanly
      }
    }

    res.json({
      races: [],
      fetchNote:
        fetchNote ||
        'Used fast local deterministic parser for Athletic.net / TFRRS / MileSplit table rows.',
      source: 'CLIENT_DETERMINISTIC',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to parse official race results.',
    });
  }
});

// Log out active session and optionally clear runtime Strava / Intervals.icu credentials
apiRouter.post('/api/auth/logout', (req: Request, res: Response) => {
  try {
    const clearCredentials = Boolean(req.body?.clearCredentials);
    if (clearCredentials) {
      runtimeStore.stravaAccessToken = '';
      runtimeStore.stravaRefreshToken = '';
      runtimeStore.stravaExpiresAt = 0;
      runtimeStore.stravaAthleteName = '';
      runtimeStore.intervalsApiKey = '';
      runtimeStore.intervalsAthleteId = '0';
      runtimeStore.intervalsAthleteName = '';
      saveJsonFile(SESSION_CACHE_FILE, runtimeStore);
    }
    res.json({
      ok: true,
      clearedCredentials: clearCredentials,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to log out session.',
    });
  }
});


