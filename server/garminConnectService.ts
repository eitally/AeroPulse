import type { Request } from 'express';
import fs from 'fs';
import path from 'path';
import {
  deleteTenantVault,
  loadTenantVaultSync,
  saveTenantVaultAsync,
  saveTenantVaultSync,
} from './tokenVault.ts';
import {
  STRAVA_LOAD_MODEL_VERSION,
  classifyMultiSportActivity,
  computeStravaActivityLoadV2,
} from '../src/physiology/stravaLoadCalibration.ts';
import {
  normalizeActivityTimestamps,
  stripTimezoneSuffix,
} from '../src/utils/activityTimestamp.ts';
import { parseStructuredTrackWorkout } from '../src/utils/workoutParser.ts';
import type {
  ServerLatestWellnessInput,
  ServerRawProfileInput,
} from './physiologyEngine.ts';

export interface GarminWeightEntry {
  summaryDate?: string;
  calendarDate?: string;
  summaryWeight?: number;
  weight?: number;
  latestWeight?: { calendarDate?: string; weight?: number };
}

export interface GarminWeightRangeResponse {
  dailyWeightSummaries?: GarminWeightEntry[];
  dateWeightList?: GarminWeightEntry[];
}

export interface GarminHrZoneEntry {
  sport?: string;
  sportType?: string;
  lactateThresholdHeartRateUsed?: number;
  lactateThresholdHeartRate?: number;
  maxHeartRateUsed?: number;
  maxHeartRate?: number;
  restingHeartRateUsed?: number;
  restingHeartRate?: number;
  zone1Floor?: number;
  zone2Floor?: number;
  zone3Floor?: number;
  zone4Floor?: number;
  zone5Floor?: number;
}

export interface GarminHrZonesResponse extends GarminHrZoneEntry {
  heartRateZones?: GarminHrZoneEntry[];
}

export interface GarminUserDataSettings {
  weight?: number;
  lactateThresholdHeartRate?: number;
  maxHeartRate?: number;
  restingHeartRate?: number;
  ftp?: number;
  fullName?: string;
  displayName?: string;
  vo2MaxCycling?: number;
  vo2MaxRunning?: number;
  vo2Max?: number;
}

export interface GarminProfileSettingsResponse extends GarminUserDataSettings {
  id?: string | number;
  displayName?: string;
  userData?: GarminUserDataSettings;
}

export interface GarminFitnessAgeResponse {
  components?: { rhr?: { value?: number } };
}

export interface GarminSleepDto {
  calendarDate?: string;
  date?: string;
  sleepTimeSeconds?: number;
  durationInSeconds?: number;
  sleepScore?: number;
  sleepScores?: { overall?: { value?: number } };
  overallSleepScore?: { value?: number };
  deepSleepSeconds?: number;
  remSleepSeconds?: number;
  lightSleepSeconds?: number;
  awakeSleepSeconds?: number;
  avgOvernightHrv?: number;
  restingHeartRate?: number;
  dailySleepDTO?: GarminSleepDto;
}

export interface GarminSleepSummariesResponse {
  dailySleepDTOs?: GarminSleepDto[];
  sleepSummaries?: GarminSleepDto[];
  dailySleepDTO?: GarminSleepDto;
  restingHeartRate?: number;
  avgOvernightHrv?: number;
}

export interface GarminHrvDto {
  calendarDate?: string;
  date?: string;
  lastNightAvg?: number;
  weeklyAvg?: number;
  hrvValue?: number;
  status?: string;
  baseline?: { balancedLow?: number; balancedUpper?: number };
  hrvSummary?: GarminHrvDto;
}

export interface GarminHrvSummariesResponse {
  hrvSummaries?: GarminHrvDto[];
  hrvSummary?: GarminHrvDto;
}

export interface GarminDailySummaryItem {
  calendarDate?: string;
  date?: string;
  startTimeLocal?: string;
  restingHeartRate?: number;
  minHeartRate?: number;
  currentDayRestingHeartRate?: number;
  totalSteps?: number;
  bodyBatteryHighestValue?: number;
}

export interface GarminDailySummariesResponse {
  dailySummaries?: GarminDailySummaryItem[];
  summaries?: GarminDailySummaryItem[];
}

export interface GarminRawActivity {
  id?: string | number;
  activityId?: string | number;
  ownerId?: string | number;
  ownerFullName?: string;
  activityName?: string;
  name?: string;
  type?: string;
  activityType?: { typeKey?: string; parentTypeId?: string };
  startTimeLocal?: string;
  startTimeGMT?: string;
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  movingDuration?: number;
  duration?: number;
  elapsedDuration?: number;
  distance?: number;
  elevationGain?: number;
  avgPower?: number;
  normPower?: number;
  maxPower?: number;
  maxAvgPower_1?: number;
  max20MinPower?: number;
  maxAvgPower_1200?: number;
  fastestSplit_1000?: number;
  fastestSplit_1609?: number;
  fastestSplit_5000?: number;
  averageHR?: number;
  maxHR?: number;
  averageBikingCadenceInRevPerMinute?: number;
  averageRunningCadenceInStepsPerMinute?: number;
  activityTrainingLoad?: number;
  calories?: number;
  hrTimeInZone_1?: number;
  hrTimeInZone_2?: number;
  hrTimeInZone_3?: number;
  hrTimeInZone_4?: number;
  hrTimeInZone_5?: number;
  powerTimeInZone_1?: number;
  powerTimeInZone_2?: number;
  powerTimeInZone_3?: number;
  powerTimeInZone_4?: number;
  powerTimeInZone_5?: number;
  powerTimeInZone_6?: number;
  powerTimeInZone_7?: number;
}

export interface GarminActivitySearchResponse {
  activities?: GarminRawActivity[];
}

export interface GarminWellnessRow extends ServerLatestWellnessInput {
  id: string;
  weight?: number;
  steps?: number;
  bodyBatteryHigh?: number;
  sleepSecs?: number;
  sleepScore?: number;
  deepSleepSecs?: number;
  remSleepSecs?: number;
  lightSleepSecs?: number;
  awakeSecs?: number;
  hrv?: number;
  hrvBaseline7d?: number;
  hrvNormalLow?: number;
  hrvNormalHigh?: number;
  garminHrvStatus?: string;
  vo2max?: number;
}

export interface GarminSocialProfileResponse {
  profileId?: string | number;
  fullName?: string;
  displayName?: string;
  userName?: string;
}

export interface GarminPersonalInfoResponse {
  weight?: number;
  userInfo?: { fullName?: string };
  biometricProfile?: {
    weight?: number;
    functionalThresholdPower?: number;
    maxHeartRate?: number;
    restingHeartRate?: number;
  };
}

export interface GarminSessionStore {
  personalApiKey?: string; // Official Garmin Connect Personal API Key (GCDC_...)
  personalBearerToken?: string;
  personalBearerExpiresAt?: number; // unix seconds
  displayName?: string;
  fullName?: string;
  garminUserId?: string;
  garminAuthMethod?: 'OAUTH' | 'PERSONAL_KEY';
  garminOAuthAccessToken?: string;
  garminOAuthRefreshToken?: string;
  garminOAuthExpiresAt?: number; // unix seconds
  oauth2AccessToken?: string;
  oauth2RefreshToken?: string;
  oauth2ExpiresAt?: number; // unix seconds
  connectedAt?: string;
  lastSyncedAt?: string;
}

export interface GarminWorkoutStepSpec {
  label: string;
  durationSecs: number;
  distanceMeters?: number;
  targetPctFtp?: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetPaceSecsPerKm?: number;
  hrCeilingBpm?: number;
  stepType?: 'warmup' | 'interval' | 'recovery' | 'rest' | 'cooldown';
}

export interface GarminWorkoutPushInput {
  date: string; // YYYY-MM-DD
  name: string;
  sportCategory: 'Cycling' | 'Running' | string;
  description?: string;
  workoutSyntax?: string;
  ftpWatts?: number;
  lthrBpm?: number;
  thresholdPaceSecsPerKm?: number;
  steps?: GarminWorkoutStepSpec[];
}

export interface GarminWorkoutPushResult {
  pushed: boolean;
  workoutId?: string | number;
  scheduleId?: string | number;
  message: string;
}

export interface GarminExecutableStepDto {
  type: 'ExecutableStepDTO';
  stepId: null;
  stepOrder: number;
  stepType: {
    stepTypeId: number;
    stepTypeKey: 'warmup' | 'cooldown' | 'interval' | 'rest';
    displayOrder: number;
  };
  childStepId: null;
  description: string;
  endCondition: {
    conditionTypeId: number;
    conditionTypeKey: 'time' | 'distance';
    displayOrder: number;
    displayable: boolean;
  };
  endConditionValue: number;
  preferredEndConditionUnit: null;
  endConditionCompare: null;
  targetType: {
    workoutTargetTypeId: number;
    workoutTargetTypeKey: 'power.zone' | 'pace.zone' | 'no.target';
    displayOrder: number;
  };
  targetValueOne: number | null;
  targetValueTwo: number | null;
  zoneNumber: null;
}

export interface GarminRepeatGroupDto {
  type: 'RepeatGroupDTO';
  stepOrder: number;
  numberOfIterations: number;
  smartRepeat: boolean;
  workoutSteps: GarminExecutableStepDto[];
}

export type GarminTrainingApiWorkoutStep = GarminExecutableStepDto | GarminRepeatGroupDto;

export interface GarminTrainingApiV2Payload {
  workoutName: string;
  description: string;
  sportType: {
    sportTypeId: number;
    sportTypeKey: 'running' | 'cycling';
    displayOrder: number;
  };
  subSportType: null;
  estimatedDurationInSecs: number;
  workoutSegments: [
    {
      segmentOrder: 1;
      sportType: {
        sportTypeId: number;
        sportTypeKey: 'running' | 'cycling';
        displayOrder: number;
      };
      workoutSteps: GarminTrainingApiWorkoutStep[];
    },
  ];
}

export class GarminPartnerOAuthError extends Error {
  public readonly requiresPartnerOAuth: boolean;
  public readonly setupRequired: boolean;

  constructor(message: string, opts: { requiresPartnerOAuth?: boolean; setupRequired?: boolean } = {}) {
    super(message);
    this.name = 'GarminPartnerOAuthError';
    this.requiresPartnerOAuth = opts.requiresPartnerOAuth ?? true;
    this.setupRequired = opts.setupRequired ?? false;
  }
}

export function getEffectiveGarminClientConfig(req?: Request): {
  clientId: string;
  clientSecret: string;
} {
  const headerClientId = String(req?.headers['x-garmin-client-id'] || '').trim();
  const headerClientSecret = String(req?.headers['x-garmin-client-secret'] || '').trim();
  const clientId = (headerClientId || process.env.GARMIN_CLIENT_ID || '').trim();
  const clientSecret = (headerClientSecret || process.env.GARMIN_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

const GARMIN_PERSONAL_API_BASE = 'https://personal.connectapi.garmin.com';
const GARMIN_PARTNER_OAUTH_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
const GARMIN_PARTNER_API_BASE = 'https://apis.garmin.com';
const GARMIN_5_ZONE_HR_NAMES = [
  'Z1 Warm Up',
  'Z2 Easy',
  'Z3 Aerobic',
  'Z4 Threshold',
  'Z5 Maximum',
];

function parseJwtExp(jwtToken: string): number | undefined {
  try {
    const parts = jwtToken.split('.');
    if (parts.length < 2) return undefined;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp === 'number' && payload.exp > 0) {
      return payload.exp;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Exchanges a Garmin Connect Personal API Key (GCDC_...) for a 24-hour OAuth2 Bearer Token
 * via POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
 */
export async function obtainGarminPersonalApiBearerToken(
  session: GarminSessionStore,
  forceRefresh = false
): Promise<string> {
  const apiKey = (
    session.personalApiKey ||
    getEnvGarminPersonalApiKey() ||
    ''
  ).trim();
  if (!apiKey) {
    throw new Error('No Garmin Personal API Key (GCDC_...) configured.');
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  if (
    !forceRefresh &&
    session.personalBearerToken &&
    session.personalBearerExpiresAt &&
    session.personalBearerExpiresAt - 3600 > nowSecs
  ) {
    return session.personalBearerToken;
  }

  const tokenUrl = `${GARMIN_PERSONAL_API_BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Garmin Personal API key token exchange failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }

  const rawBody = (await resp.text()).trim();
  let accessToken = '';
  let expiresAt = nowSecs + 86400;

  if (rawBody.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawBody);
      accessToken = String(
        parsed.access_token || parsed.accessToken || parsed.token || ''
      ).trim();
      if (parsed.expires_at) {
        expiresAt = Number(parsed.expires_at);
      } else if (parsed.expires_in) {
        expiresAt = nowSecs + Number(parsed.expires_in);
      }
    } catch {
      accessToken = rawBody.replace(/^"|"$/g, '');
    }
  } else {
    accessToken = rawBody.replace(/^"|"$/g, '');
  }

  if (!accessToken) {
    throw new Error('Garmin Personal API token endpoint returned an empty token.');
  }

  const jwtExp = parseJwtExp(accessToken);
  if (jwtExp) {
    expiresAt = jwtExp;
  }

  session.personalApiKey = apiKey;
  session.personalBearerToken = accessToken;
  session.personalBearerExpiresAt = expiresAt;
  return accessToken;
}

/**
 * Performs an authenticated GET request against https://personal.connectapi.garmin.com
 * using a Garmin Personal API Key (GCDC_...).
 */
export async function fetchGarminPersonalApiJson<T = Record<string, unknown>>(
  endpointPath: string,
  session: GarminSessionStore
): Promise<T | null> {
  let token = await obtainGarminPersonalApiBearerToken(session, false);
  const url = endpointPath.startsWith('http')
    ? endpointPath
    : `${GARMIN_PERSONAL_API_BASE}${endpointPath}`;

  const doGet = async (bearer: string, acceptHeader = 'application/json') =>
    fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: acceptHeader,
      },
    });

  let resp = await doGet(token, 'application/json');
  if (resp.status === 406) {
    resp = await doGet(token, '*/*');
  }
  if (resp.status === 401) {
    token = await obtainGarminPersonalApiBearerToken(session, true);
    resp = await doGet(token, 'application/json');
    if (resp.status === 406) {
      resp = await doGet(token, '*/*');
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Garmin Personal API GET ${endpointPath} failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }

  const text = await resp.text();
  return text ? (JSON.parse(text) as T) : null;
}

export function getGarminSessionFilePath(dataDir: string, scopeKey: string): string {
  const safeScope = scopeKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataDir, `garmin_session_${safeScope}.json`);
}

export function loadGarminSession(dataDir: string, scopeKey: string): GarminSessionStore | null {
  const vaultTenantKey = `garmin_${scopeKey}`;
  const fromVault = loadTenantVaultSync<GarminSessionStore | null>(vaultTenantKey, null);
  if (fromVault) return fromVault;

  // One-time migration from legacy plaintext file if present, then shred plaintext file
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as GarminSessionStore;
      saveTenantVaultSync(vaultTenantKey, parsed);
      fs.unlinkSync(filePath);
      return parsed;
    }
  } catch {
    // ignore corrupt file
  }
  return null;
}

export function saveGarminSession(
  _dataDir: string,
  scopeKey: string,
  session: GarminSessionStore
): void {
  saveTenantVaultSync(`garmin_${scopeKey}`, session);
}

export async function saveGarminSessionAsync(
  _dataDir: string,
  scopeKey: string,
  session: GarminSessionStore
): Promise<void> {
  await saveTenantVaultAsync(`garmin_${scopeKey}`, session);
}

export function clearGarminSession(dataDir: string, scopeKey: string): void {
  void deleteTenantVault(`garmin_${scopeKey}`);
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

export async function clearGarminSessionAsync(dataDir: string, scopeKey: string): Promise<void> {
  await deleteTenantVault(`garmin_${scopeKey}`);
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

/**
 * Refreshes an Official Garmin Health/Training Partner OAuth 2.0 Bearer token.
 */
export async function refreshGarminPartnerOAuthToken(
  session: GarminSessionStore,
  req?: Request
): Promise<GarminSessionStore> {
  if (!session.garminOAuthRefreshToken) {
    return session;
  }
  const { clientId, clientSecret } = getEffectiveGarminClientConfig(req);
  if (!clientId || !clientSecret) {
    return session;
  }

  const resp = await fetch(GARMIN_PARTNER_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.garminOAuthRefreshToken,
    }).toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Garmin Partner OAuth token refresh failed (${resp.status}): ${errText.slice(0, 160)}`);
  }

  const data = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (data?.access_token) {
    session.garminOAuthAccessToken = data.access_token;
    session.garminOAuthRefreshToken = data.refresh_token || session.garminOAuthRefreshToken;
    session.garminOAuthExpiresAt =
      Math.floor(Date.now() / 1000) + Number(data.expires_in || 86400);
  }
  return session;
}

/**
 * Authenticates with Garmin Connect via:
 * 1. Official Garmin Personal API Key (GCDC_...)
 * 2. Official Garmin Partner OAuth 2.0 PKCE Bearer Token
 * Note: Legacy non-MFA SSO email/password scraping has been permanently removed.
 */
export async function authenticateGarminConnect(params: {
  personalApiKey?: string;
  email?: string;
  password?: string;
  directBearerToken?: string;
}): Promise<GarminSessionStore> {
  if (params.email?.trim() || params.password) {
    throw new Error(
      'Garmin password login has been removed. Connect via Official Garmin Partner OAuth, a read-only GCDC Personal API Key, or .FIT workout import.'
    );
  }

  // Path 0: Official Garmin Connect Personal API Key (GCDC_...)
  const rawPersonalKey = (
    params.personalApiKey ||
    (params.directBearerToken?.trim().startsWith('GCDC_')
      ? params.directBearerToken
      : '') ||
    ''
  ).trim();

  if (rawPersonalKey) {
    const session: GarminSessionStore = {
      personalApiKey: rawPersonalKey,
      garminAuthMethod: 'PERSONAL_KEY',
      connectedAt: new Date().toISOString(),
    };
    await obtainGarminPersonalApiBearerToken(session, true);
    const settings = await fetchGarminPersonalApiJson<GarminProfileSettingsResponse>(
      '/userprofile-service/userprofile/settings',
      session
    ).catch(() => null);
    if (settings) {
      const displayName =
        settings.displayName ||
        settings.userData?.displayName ||
        settings.fullName ||
        'Garmin Athlete';
      session.displayName = displayName;
      session.fullName = settings.fullName || displayName;
    }
    return session;
  }

  // Path 1: Official Garmin Partner OAuth 2.0 Bearer Token
  if (params.directBearerToken?.trim()) {
    const cleanToken = params.directBearerToken
      .trim()
      .replace(/^Bearer\s+/i, '');
    return {
      garminOAuthAccessToken: cleanToken,
      garminAuthMethod: 'OAUTH',
      garminOAuthExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      connectedAt: new Date().toISOString(),
    };
  }

  throw new Error(
    'Please connect via Official Garmin Partner OAuth or provide a valid Garmin Personal API Key (GCDC_...).'
  );
}

/**
 * Performs an authenticated GET/POST request against https://apis.garmin.com using Official Partner OAuth 2.0.
 */
export async function fetchGarminPartnerApiJson<T = Record<string, unknown>>(
  endpointPath: string,
  session: GarminSessionStore,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; req?: Request } = {}
): Promise<T> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    (!session.garminOAuthAccessToken ||
      (session.garminOAuthExpiresAt && session.garminOAuthExpiresAt - 120 < nowSec)) &&
    session.garminOAuthRefreshToken
  ) {
    await refreshGarminPartnerOAuthToken(session, options.req);
  }

  if (!session.garminOAuthAccessToken) {
    throw new GarminPartnerOAuthError('No active Garmin Partner OAuth2 access token available.');
  }

  const url = endpointPath.startsWith('http')
    ? endpointPath
    : `${GARMIN_PARTNER_API_BASE}${endpointPath}`;

  const doRequest = async (token: string) =>
    fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let resp = await doRequest(session.garminOAuthAccessToken);

  if (resp.status === 401 && session.garminOAuthRefreshToken) {
    await refreshGarminPartnerOAuthToken(session, options.req);
    if (session.garminOAuthAccessToken) {
      resp = await doRequest(session.garminOAuthAccessToken);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Garmin Partner API ${options.method || 'GET'} ${endpointPath} failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }

  const text = await resp.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const STEP_TYPE_ID_MAP: Record<'warmup' | 'cooldown' | 'interval' | 'rest', number> = {
  warmup: 1,
  cooldown: 2,
  interval: 3,
  rest: 4,
};

function toGarminExecutableStepDto(opts: {
  stepOrder: number;
  label: string;
  durationSecs: number;
  distanceMeters?: number;
  isRunning: boolean;
  stepKind: 'warmup' | 'cooldown' | 'interval' | 'rest';
  targetPctFtp?: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  targetPaceSecsPerKm?: number;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  hrCeilingBpm?: number;
}): GarminExecutableStepDto {
  const {
    stepOrder,
    label,
    durationSecs,
    distanceMeters,
    isRunning,
    stepKind,
    targetPctFtp = 75,
    targetWatts,
    targetMinWatts,
    targetMaxWatts,
    targetPaceSecsPerKm,
    ftpWatts,
    thresholdPaceSecsPerKm,
    hrCeilingBpm,
  } = opts;
  const stepTypeId = STEP_TYPE_ID_MAP[stepKind] || 3;
  const hasDistance = typeof distanceMeters === 'number' && distanceMeters > 0;
  const safeDurationSecs = Math.max(5, Math.round(durationSecs || 60));

  let targetType: GarminExecutableStepDto['targetType'];
  let targetValueOne: number | null = null;
  let targetValueTwo: number | null = null;

  if (stepKind === 'rest') {
    targetType = {
      workoutTargetTypeId: 1,
      workoutTargetTypeKey: 'no.target',
      displayOrder: 1,
    };
  } else if (isRunning) {
    const resolvedPace =
      targetPaceSecsPerKm && targetPaceSecsPerKm > 60
        ? targetPaceSecsPerKm
        : Math.round(thresholdPaceSecsPerKm / Math.max(0.4, targetPctFtp / 100));
    targetType = {
      workoutTargetTypeId: 6,
      workoutTargetTypeKey: 'pace.zone',
      displayOrder: 6,
    };
    targetValueOne = Number((1000 / (resolvedPace * 1.02)).toFixed(2));
    targetValueTwo = Number((1000 / (resolvedPace * 0.98)).toFixed(2));
  } else {
    const centerWatts =
      Number(targetWatts) > 0
        ? Math.round(Number(targetWatts))
        : Math.round((targetPctFtp / 100) * ftpWatts);
    targetType = {
      workoutTargetTypeId: 2,
      workoutTargetTypeKey: 'power.zone',
      displayOrder: 2,
    };
    targetValueOne =
      Number(targetMinWatts) > 0
        ? Math.round(Number(targetMinWatts))
        : Math.max(40, Math.round(centerWatts * 0.96));
    targetValueTwo =
      Number(targetMaxWatts) > 0
        ? Math.round(Number(targetMaxWatts))
        : Math.round(centerWatts * 1.04);
  }

  return {
    type: 'ExecutableStepDTO',
    stepId: null,
    stepOrder,
    stepType: {
      stepTypeId,
      stepTypeKey: stepKind,
      displayOrder: stepTypeId,
    },
    childStepId: null,
    description: `${label}${hrCeilingBpm ? ` (HR <= ${hrCeilingBpm} bpm)` : ''}`,
    endCondition: {
      conditionTypeId: hasDistance ? 3 : 2,
      conditionTypeKey: hasDistance ? 'distance' : 'time',
      displayOrder: hasDistance ? 3 : 2,
      displayable: true,
    },
    endConditionValue: hasDistance ? Math.round(distanceMeters) : safeDurationSecs,
    preferredEndConditionUnit: null,
    endConditionCompare: null,
    targetType,
    targetValueOne,
    targetValueTwo,
    zoneNumber: null,
  };
}

/**
 * Builds an Official Garmin Training API v2 Workout Payload, reusing `parseStructuredTrackWorkout`
 * to preserve `RepeatGroupDTO` blocks, track distances, warmups, cooldowns, and pace/power targets.
 */
export function buildGarminTrainingApiV2Payload(
  input: GarminWorkoutPushInput
): GarminTrainingApiV2Payload {
  const isRunning = String(input.sportCategory).toLowerCase().includes('run');
  const sportType: GarminTrainingApiV2Payload['sportType'] = isRunning
    ? { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 }
    : { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 };

  const activeFtp = Math.max(100, Number(input.ftpWatts || 250));
  const thresholdPace = Math.max(95, Number(input.thresholdPaceSecsPerKm || 245));
  const syntax = String(input.workoutSyntax || '').trim();
  const astNodes = syntax ? parseStructuredTrackWorkout(syntax, thresholdPace) : [];

  let estimatedDurationInSecs = 0;
  let workoutSteps: GarminTrainingApiWorkoutStep[] = [];

  if (astNodes.length > 0) {
    const mapAstKind = (kind?: string): 'warmup' | 'cooldown' | 'interval' | 'rest' => {
      if (kind === 'warmup') return 'warmup';
      if (kind === 'cooldown') return 'cooldown';
      if (kind === 'rest') return 'rest';
      return 'interval';
    };

    workoutSteps = astNodes.map((node, idx) => {
      if (node.type === 'step') {
        const s = node.step;
        const pct = Math.max(40, Math.min(180, s.intensityPct || 75));
        const durSecs = Math.max(5, Math.round(s.durationSecs || s.durationMins * 60 || 60));
        estimatedDurationInSecs += durSecs;
        return toGarminExecutableStepDto({
          stepOrder: idx + 1,
          label: s.label,
          durationSecs: durSecs,
          distanceMeters: s.distanceMeters,
          isRunning,
          stepKind: mapAstKind(s.stepKind),
          targetPctFtp: pct,
          targetPaceSecsPerKm: s.targetPaceSecsPerKm,
          ftpWatts: activeFtp,
          thresholdPaceSecsPerKm: thresholdPace,
        });
      }

      const innerSteps = node.steps.map((inner, innerIdx) => {
        const pct = Math.max(40, Math.min(180, inner.intensityPct || 75));
        const durSecs = Math.max(5, Math.round(inner.durationSecs || inner.durationMins * 60 || 60));
        estimatedDurationInSecs += durSecs * node.repeatCount;
        return toGarminExecutableStepDto({
          stepOrder: innerIdx + 1,
          label: inner.label,
          durationSecs: durSecs,
          distanceMeters: inner.distanceMeters,
          isRunning,
          stepKind: mapAstKind(inner.stepKind),
          targetPctFtp: pct,
          targetPaceSecsPerKm: inner.targetPaceSecsPerKm,
          ftpWatts: activeFtp,
          thresholdPaceSecsPerKm: thresholdPace,
        });
      });

      return {
        type: 'RepeatGroupDTO',
        stepOrder: idx + 1,
        numberOfIterations: node.repeatCount,
        smartRepeat: false,
        workoutSteps: innerSteps,
      };
    });
  } else {
    const rawSteps = Array.isArray(input.steps) && input.steps.length > 0
      ? input.steps
      : [{ label: input.name || 'Main Set', durationSecs: 1800, targetPctFtp: 75, stepType: 'interval' as const }];
    const totalSteps = rawSteps.length;

    workoutSteps = rawSteps.map((s, idx) => {
      const pct = Number(s.targetPctFtp || 70);
      let stepKind: 'warmup' | 'cooldown' | 'interval' | 'rest' = 'interval';
      if (s.stepType === 'warmup') stepKind = 'warmup';
      else if (s.stepType === 'cooldown') stepKind = 'cooldown';
      else if (s.stepType === 'recovery' || s.stepType === 'rest') stepKind = 'rest';
      else if (!s.stepType) {
        if (idx === 0 && totalSteps > 1) stepKind = 'warmup';
        else if (idx === totalSteps - 1 && totalSteps > 1) stepKind = 'cooldown';
        else if (pct <= 60 || /recov|easy|rest/i.test(s.label)) stepKind = 'rest';
      }
      const durSecs = Math.max(5, Math.round(s.durationSecs || 60));
      estimatedDurationInSecs += durSecs;
      return toGarminExecutableStepDto({
        stepOrder: idx + 1,
        label: s.label,
        durationSecs: durSecs,
        distanceMeters: s.distanceMeters,
        isRunning,
        stepKind,
        targetPctFtp: pct,
        targetWatts: s.targetWatts,
        targetMinWatts: s.targetMinWatts,
        targetMaxWatts: s.targetMaxWatts,
        targetPaceSecsPerKm: s.targetPaceSecsPerKm,
        ftpWatts: activeFtp,
        thresholdPaceSecsPerKm: thresholdPace,
        hrCeilingBpm: s.hrCeilingBpm,
      });
    });
  }

  return {
    workoutName: input.name.slice(0, 64),
    description: (input.description || 'Prescribed by MeetReady Readiness Engine').slice(0, 512),
    sportType,
    subSportType: null,
    estimatedDurationInSecs,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType,
        workoutSteps,
      },
    ],
  };
}

/**
 * Pushes a structured workout to Garmin Connect Calendar via Official Garmin Training API v2
 * (requires Official Partner OAuth 2.0 PKCE `garminOAuthAccessToken`; GCDC_ personal keys are read-only).
 */
export async function pushWorkoutToGarminConnect(
  session: GarminSessionStore,
  input: GarminWorkoutPushInput,
  req?: Request
): Promise<GarminWorkoutPushResult> {
  const { clientId, clientSecret } = getEffectiveGarminClientConfig(req);
  const partnerKeysConfigured = Boolean(clientId && clientSecret);

  if (!session.garminOAuthAccessToken && !session.garminOAuthRefreshToken) {
    if (session.personalApiKey) {
      throw new GarminPartnerOAuthError(
        partnerKeysConfigured
          ? 'Garmin Personal API keys (GCDC_...) are read-only per Garmin policy. Connect Official Garmin Partner OAuth in Data Sources (or click "Download .FIT" / Intervals.icu Cross-Watch Bridge) to push workouts to your watch.'
          : 'Garmin Personal API keys (GCDC_...) are read-only and Official Garmin Partner OAuth credentials (GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET) are pending. Use Download .FIT or Intervals.icu Cross-Watch Bridge in the meantime.',
        { requiresPartnerOAuth: true, setupRequired: !partnerKeysConfigured }
      );
    }
    throw new GarminPartnerOAuthError(
      partnerKeysConfigured
        ? 'Connect Official Garmin Partner OAuth in Data Sources to push workouts directly to your Garmin watch.'
        : 'Garmin Partner OAuth credentials (GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET) are pending. Use Download .FIT or Intervals.icu Cross-Watch Bridge to transfer this workout.',
      { requiresPartnerOAuth: true, setupRequired: !partnerKeysConfigured }
    );
  }

  const workoutPayload = buildGarminTrainingApiV2Payload(input);

  const createdWorkout = await fetchGarminPartnerApiJson<{
    workoutId?: string | number;
    id?: string | number;
  }>('/training-api/workout/v2', session, {
    method: 'POST',
    body: workoutPayload,
    req,
  });

  const workoutId = createdWorkout?.workoutId ?? createdWorkout?.id;
  if (!workoutId) {
    throw new Error('Garmin Training API v2 did not return a workoutId.');
  }

  const scheduled = await fetchGarminPartnerApiJson<{
    workoutScheduleId?: string | number;
    scheduleId?: string | number;
  }>('/training-api/schedule/', session, {
    method: 'POST',
    body: {
      workoutId,
      date: input.date.slice(0, 10),
    },
    req,
  });

  return {
    pushed: true,
    workoutId,
    scheduleId: scheduled?.workoutScheduleId ?? scheduled?.scheduleId ?? workoutId,
    message: `Pushed "${input.name}" directly to Garmin Connect Calendar (${input.date.slice(0, 10)}) via Official Training API v2.`,
  };
}

/**
 * Fetches Athlete Profile, Heart Rate Zones, Weight, Sleep Score, Overnight HRV, Resting HR,
 * and Activities directly from Garmin Connect (via Official Garmin Personal API GCDC_ key
 * or OAuth2 session) without Intervals.icu!
 */
export async function fetchDirectGarminProfileAndWellness(
  session: GarminSessionStore,
  daysToFetch = 28
): Promise<{
  rawProfile: ServerRawProfileInput;
  wellnessRows: GarminWellnessRow[];
  activities: GarminRawActivity[];
}> {
  const endDate = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
  const startDate = new Date(
    Date.now() - Math.min(daysToFetch, 30) * 86400 * 1000
  )
    .toISOString()
    .slice(0, 10);
  const weightStart180d = new Date(Date.now() - 180 * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  // ---------------------------------------------------------------------------
  // Path A: Official Garmin Connect Personal API (https://personal.connectapi.garmin.com)
  // ---------------------------------------------------------------------------
  if (session.personalApiKey || process.env.GARMIN_PERSONAL_API_KEY) {
    const [
      profileSettings,
      hrZonesData,
      weightRangeData,
      fitnessAgeData,
      sleepSummaries,
      hrvSummaries,
      dailySummaries,
      activitiesData,
    ] = await Promise.all([
      fetchGarminPersonalApiJson<GarminProfileSettingsResponse>(
        '/userprofile-service/userprofile/settings',
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminHrZonesResponse | GarminHrZoneEntry[]>(
        '/biometric-service/heartRateZones/v2',
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminWeightRangeResponse | GarminWeightEntry[]>(
        `/weight-service/weight/range/${weightStart180d}/${endDate}?includeAll=true`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminFitnessAgeResponse>(
        `/fitnessage-service/fitnessage/v2/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminSleepSummariesResponse | GarminSleepDto[]>(
        `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminHrvSummariesResponse | GarminHrvDto[]>(
        `/hrv-service/hrv/daily/${startDate}/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminDailySummariesResponse | GarminDailySummaryItem[]>(
        `/usersummary-service/v2/dailysummaries?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson<GarminActivitySearchResponse | GarminRawActivity[]>(
        `/activitylist-service/activities/search/activities?start=0&limit=100`,
        session
      ).catch(() => null),
    ]);

    const userData: GarminUserDataSettings =
      profileSettings?.userData || profileSettings || {};

    // Extract weight from weight-service (180d window) or profileSettings (Garmin uses grams)
    // Note: Garmin /weight-service/weight/range returns dailyWeightSummaries NEWEST-FIRST (index 0 is latest).
    // Sort explicitly by date descending so we always pick the most recent scale weigh-in.
    let weightKg: number | undefined;
    const weightList: GarminWeightEntry[] = Array.isArray(weightRangeData)
      ? weightRangeData
      : weightRangeData?.dailyWeightSummaries ||
        weightRangeData?.dateWeightList ||
        [];
    if (Array.isArray(weightList) && weightList.length > 0) {
      const sortedWeights = [...weightList].sort((a, b) => {
        const dA = String(
          a?.summaryDate || a?.calendarDate || a?.latestWeight?.calendarDate || ''
        );
        const dB = String(
          b?.summaryDate || b?.calendarDate || b?.latestWeight?.calendarDate || ''
        );
        return dB.localeCompare(dA);
      });
      for (let i = 0; i < sortedWeights.length; i++) {
        const wItem = sortedWeights[i];
        const rawW = Number(
          wItem?.latestWeight?.weight ??
            wItem?.summaryWeight ??
            wItem?.weight ??
            0
        );
        if (rawW > 1000) {
          weightKg = Number((rawW / 1000).toFixed(1));
          break;
        } else if (rawW >= 35 && rawW <= 180) {
          weightKg = Number(rawW.toFixed(1));
          break;
        }
      }
    }
    if (!weightKg) {
      const rawProfileWeight = Number(userData.weight ?? 0);
      if (rawProfileWeight > 1000) {
        weightKg = Number((rawProfileWeight / 1000).toFixed(1));
      } else if (rawProfileWeight >= 35 && rawProfileWeight <= 180) {
        weightKg = Number(rawProfileWeight.toFixed(1));
      }
    }

    // Extract Heart Rate Zones, LTHR, Max HR, Resting HR from /biometric-service/heartRateZones/v2
    const zonesArray: GarminHrZoneEntry[] = Array.isArray(hrZonesData)
      ? hrZonesData
      : Array.isArray(hrZonesData?.heartRateZones)
        ? hrZonesData.heartRateZones
        : hrZonesData
          ? [hrZonesData]
          : [];

    const cyclingZoneObj: GarminHrZoneEntry =
      zonesArray.find((z) =>
        /cycling|bike|ride/i.test(String(z?.sport || z?.sportType || ''))
      ) ||
      zonesArray.find((z) =>
        /default/i.test(String(z?.sport || z?.sportType || ''))
      ) ||
      zonesArray[0] ||
      {};
    const runningZoneObj: GarminHrZoneEntry =
      zonesArray.find((z) =>
        /running|run/i.test(String(z?.sport || z?.sportType || ''))
      ) ||
      cyclingZoneObj ||
      {};

    const bikeLthr = Number(
      cyclingZoneObj.lactateThresholdHeartRateUsed ??
        cyclingZoneObj.lactateThresholdHeartRate ??
        userData.lactateThresholdHeartRate ??
        0
    );
    const bikeMaxHr = Number(
      cyclingZoneObj.maxHeartRateUsed ??
        cyclingZoneObj.maxHeartRate ??
        userData.maxHeartRate ??
        0
    );
    const runLthr = Number(
      runningZoneObj.lactateThresholdHeartRateUsed ??
        runningZoneObj.lactateThresholdHeartRate ??
        bikeLthr ??
        0
    );
    const runMaxHr = Number(
      runningZoneObj.maxHeartRateUsed ??
        runningZoneObj.maxHeartRate ??
        bikeMaxHr ??
        0
    );
    const fitnessAgeRhr = Number(fitnessAgeData?.components?.rhr?.value ?? 0);
    const restingHrFromZones = Number(
      (fitnessAgeRhr >= 30 ? fitnessAgeRhr : 0) ||
        cyclingZoneObj.restingHeartRateUsed ||
        cyclingZoneObj.restingHeartRate ||
        userData.restingHeartRate ||
        0
    );

    const bikeHrFloors: number[] = [];
    const bikeHrCeilings: number[] = [];
    if (
      cyclingZoneObj.zone1Floor &&
      cyclingZoneObj.zone2Floor &&
      cyclingZoneObj.zone3Floor &&
      cyclingZoneObj.zone4Floor &&
      cyclingZoneObj.zone5Floor
    ) {
      bikeHrFloors.push(
        Number(cyclingZoneObj.zone1Floor),
        Number(cyclingZoneObj.zone2Floor),
        Number(cyclingZoneObj.zone3Floor),
        Number(cyclingZoneObj.zone4Floor),
        Number(cyclingZoneObj.zone5Floor)
      );
      bikeHrCeilings.push(
        Number(cyclingZoneObj.zone2Floor) - 1,
        Number(cyclingZoneObj.zone3Floor) - 1,
        Number(cyclingZoneObj.zone4Floor) - 1,
        Number(cyclingZoneObj.zone5Floor) - 1,
        bikeMaxHr > 140 ? bikeMaxHr : Number(cyclingZoneObj.zone5Floor) + 15
      );
    }

    const runHrFloors: number[] = [];
    const runHrCeilings: number[] = [];
    if (
      runningZoneObj.zone1Floor &&
      runningZoneObj.zone2Floor &&
      runningZoneObj.zone3Floor &&
      runningZoneObj.zone4Floor &&
      runningZoneObj.zone5Floor
    ) {
      runHrFloors.push(
        Number(runningZoneObj.zone1Floor),
        Number(runningZoneObj.zone2Floor),
        Number(runningZoneObj.zone3Floor),
        Number(runningZoneObj.zone4Floor),
        Number(runningZoneObj.zone5Floor)
      );
      runHrCeilings.push(
        Number(runningZoneObj.zone2Floor) - 1,
        Number(runningZoneObj.zone3Floor) - 1,
        Number(runningZoneObj.zone4Floor) - 1,
        Number(runningZoneObj.zone5Floor) - 1,
        runMaxHr > 140 ? runMaxHr : Number(runningZoneObj.zone5Floor) + 15
      );
    }

    // Build daily wellness map by YYYY-MM-DD from sleepSummaries, hrvSummaries, dailySummaries
    const wellnessByDate = new Map<string, GarminWellnessRow>();
    const ensureDay = (d?: string) => {
      const dateStr = String(d || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
      if (!wellnessByDate.has(dateStr)) {
        wellnessByDate.set(dateStr, {
          id: dateStr,
          weight: weightKg,
        });
      }
      return wellnessByDate.get(dateStr)!;
    };

    const dailyList: GarminDailySummaryItem[] = Array.isArray(dailySummaries)
      ? dailySummaries
      : dailySummaries?.dailySummaries ||
        dailySummaries?.summaries ||
        [];
    for (const ds of dailyList) {
      const row = ensureDay(ds?.calendarDate || ds?.date || ds?.startTimeLocal);
      if (!row) continue;
      const rhr = Number(
        ds?.restingHeartRate ?? ds?.minHeartRate ?? ds?.currentDayRestingHeartRate ?? 0
      );
      if (rhr >= 30 && rhr <= 110) row.restingHR = rhr;
      if (Number(ds?.totalSteps) > 0) row.steps = Number(ds.totalSteps);
      if (Number(ds?.bodyBatteryHighestValue) > 0) {
        row.bodyBatteryHigh = Number(ds.bodyBatteryHighestValue);
      }
    }

    const sleepList: GarminSleepDto[] = Array.isArray(sleepSummaries)
      ? sleepSummaries
      : sleepSummaries?.dailySleepDTOs ||
        sleepSummaries?.sleepSummaries ||
        [];
    for (const sl of sleepList) {
      const dto = sl?.dailySleepDTO || sl;
      const row = ensureDay(dto?.calendarDate || dto?.date);
      if (!row) continue;
      const sleepSecs = Number(
        dto?.sleepTimeSeconds ?? dto?.durationInSeconds ?? 0
      );
      if (sleepSecs > 0) row.sleepSecs = sleepSecs;
      const score = Number(
        dto?.sleepScores?.overall?.value ??
          dto?.overallSleepScore?.value ??
          dto?.sleepScore ??
          0
      );
      if (score > 0) {
        row.sleepScore = score;
      } else if (sleepSecs > 0) {
        const deepPct =
          sleepSecs > 0 ? Number(dto?.deepSleepSeconds || 0) / sleepSecs : 0.18;
        const remPct =
          sleepSecs > 0 ? Number(dto?.remSleepSeconds || 0) / sleepSecs : 0.2;
        const durRatio = Math.min(1.05, sleepSecs / (7.8 * 3600));
        row.sleepScore = Math.max(
          45,
          Math.min(
            98,
            Math.round(durRatio * 68 + Math.min(0.25, deepPct) * 65 + Math.min(0.25, remPct) * 65)
          )
        );
      }
      if (Number(dto?.deepSleepSeconds) >= 0)
        row.deepSleepSecs = Number(dto.deepSleepSeconds);
      if (Number(dto?.remSleepSeconds) >= 0)
        row.remSleepSecs = Number(dto.remSleepSeconds);
      if (Number(dto?.lightSleepSeconds) >= 0)
        row.lightSleepSecs = Number(dto.lightSleepSeconds);
      if (Number(dto?.awakeSleepSeconds) >= 0)
        row.awakeSecs = Number(dto.awakeSleepSeconds);
      if (Number(dto?.avgOvernightHrv) > 0)
        row.hrv = Number(dto.avgOvernightHrv);
      if (Number(dto?.restingHeartRate) >= 30 && !row.restingHR)
        row.restingHR = Number(dto.restingHeartRate);
    }

    const hrvList: GarminHrvDto[] = Array.isArray(hrvSummaries)
      ? hrvSummaries
      : hrvSummaries?.hrvSummaries || [];
    for (const h of hrvList) {
      const hDto = h?.hrvSummary || h;
      const row = ensureDay(hDto?.calendarDate || hDto?.date);
      if (!row) continue;
      const hrvVal = Number(
        hDto?.lastNightAvg ?? hDto?.weeklyAvg ?? hDto?.hrvValue ?? 0
      );
      if (hrvVal > 0) row.hrv = hrvVal;
      if (Number(hDto?.weeklyAvg) > 0) {
        row.hrvBaseline7d = Number(hDto.weeklyAvg);
      }
      if (Number(hDto?.baseline?.balancedLow) > 0) {
        row.hrvNormalLow = Number(hDto?.baseline?.balancedLow);
      }
      if (Number(hDto?.baseline?.balancedUpper) > 0) {
        row.hrvNormalHigh = Number(hDto?.baseline?.balancedUpper);
      }
      if (hDto?.status) row.garminHrvStatus = String(hDto.status);
    }

    const wellnessRows = Array.from(wellnessByDate.values()).sort((a, b) =>
      String(a.id).localeCompare(String(b.id))
    );

    const latestRhr =
      (restingHrFromZones >= 30 ? restingHrFromZones : undefined) ||
      wellnessRows
        .slice()
        .reverse()
        .find((w) => Number(w.restingHR) >= 30)?.restingHR;

    const rawActivitiesList: GarminRawActivity[] = Array.isArray(activitiesData)
      ? activitiesData
      : Array.isArray(activitiesData?.activities)
        ? activitiesData.activities
        : [];

    const activityOwnerFullName = rawActivitiesList.find(
      (a) =>
        a?.ownerFullName &&
        typeof a.ownerFullName === 'string' &&
        a.ownerFullName.trim().length > 1
    )?.ownerFullName;
    const activityOwnerId = rawActivitiesList.find((a) => a?.ownerId)?.ownerId;

    const resolvedFullName =
      activityOwnerFullName ||
      profileSettings?.fullName ||
      userData?.fullName ||
      session.fullName ||
      profileSettings?.displayName ||
      session.displayName;

    if (resolvedFullName) {
      session.fullName = resolvedFullName;
    }

    // Derive Cycling FTP, Pmax, Running Power FTP & Threshold Pace from Garmin activities when not in /userprofile/settings
    let maxBike20mPower = 0;
    let maxBikePeakPower = 0;
    let maxRunSustainedPower = 0;
    let bestRun5kSecs = 0;
    for (const a of rawActivitiesList) {
      if (!a) continue;
      const typeKey = String(
        a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ''
      ).toLowerCase();
      const actName = String(a.activityName || a.name || '').toLowerCase();
      const combined = `${typeKey} ${actName}`;
      const isBike =
        /cycling|ride|biking|virtual_ride|indoor_cycling|road_biking|gravel|mountain_biking|zwift|peloton|spin/i.test(
          combined
        );
      const isRun = /running|run|treadmill|trail_running|track_running|virtual_run/i.test(combined);
      const dur = Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0);

      if (isBike) {
        const p20 = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
        const avgP = Number(a.avgPower ?? 0);
        const np = Number(a.normPower ?? a.avgPower ?? 0);
        const sustainedW =
          avgP > 0 && np > avgP * 1.08 ? Math.round(avgP * 1.05) : np;
        const peakP = Number(a.maxPower ?? a.maxAvgPower_1 ?? 0);
        if (p20 >= 80 && p20 <= 600) {
          if (p20 > maxBike20mPower) maxBike20mPower = p20;
        } else if (
          dur >= 1200 &&
          sustainedW >= 80 &&
          sustainedW <= 600 &&
          sustainedW > maxBike20mPower
        ) {
          maxBike20mPower = sustainedW;
        }
        if (peakP >= 250 && peakP <= 2500 && peakP > maxBikePeakPower) {
          maxBikePeakPower = peakP;
        }
      } else if (isRun) {
        const runNp = Number(a.normPower ?? a.avgPower ?? 0);
        if (dur >= 1200 && runNp >= 120 && runNp <= 650 && runNp > maxRunSustainedPower) {
          maxRunSustainedPower = runNp;
        }
        const split5k = Number(a.fastestSplit_5000 ?? 0);
        const dist = Number(a.distance ?? 0);
        if (split5k >= 780 && split5k <= 2700) {
          if (bestRun5kSecs === 0 || split5k < bestRun5kSecs) {
            bestRun5kSecs = split5k;
          }
        } else if (dist >= 4500 && dur >= 900) {
          const equiv5k = (dur / dist) * 5000;
          if (equiv5k >= 780 && equiv5k <= 2700 && (bestRun5kSecs === 0 || equiv5k < bestRun5kSecs)) {
            bestRun5kSecs = equiv5k;
          }
        }
      }
    }

    const derivedBikeFtp =
      Number(userData.ftp) > 60
        ? Math.round(Number(userData.ftp))
        : maxBike20mPower >= 90
          ? Math.round(maxBike20mPower * 0.95)
          : undefined;
    const derivedBikePMax =
      maxBikePeakPower >= 350 ? Math.round(maxBikePeakPower) : undefined;
    const derivedBikeWPrime =
      derivedBikeFtp && derivedBikeFtp > 60 ? Math.round(derivedBikeFtp * 75) : undefined;
    const derivedRunThresholdPace =
      bestRun5kSecs > 0 ? Math.round((bestRun5kSecs / 5) * 1.03) : undefined;
    const derivedRunFtp =
      maxRunSustainedPower >= 140
        ? Math.round(maxRunSustainedPower * 0.92)
        : undefined;

    const rawProfile: ServerRawProfileInput = {
      id: activityOwnerId || profileSettings?.id || 'garmin-personal-api',
      name: resolvedFullName,
      weight: weightKg,
      icu_resting_hr: latestRhr,
      ftp: derivedBikeFtp,
      eFtp: derivedBikeFtp,
      pMax: derivedBikePMax,
      wPrime: derivedBikeWPrime,
      runFtp: derivedRunFtp,
      thresholdPaceSecsPerKm: derivedRunThresholdPace,
      sportSettings: [
        {
          types: ['Ride', 'VirtualRide'],
          ftp: derivedBikeFtp,
          eftp: derivedBikeFtp,
          p_max: derivedBikePMax,
          w_prime: derivedBikeWPrime,
          lthr:
            bikeLthr > 110
              ? bikeLthr
              : bikeMaxHr > 140
                ? Math.round(bikeMaxHr * 0.89)
                : undefined,
          max_hr: bikeMaxHr > 130 ? bikeMaxHr : undefined,
          hr_zones: bikeHrCeilings.length >= 5 ? bikeHrCeilings : undefined,
          hr_zone_floors: bikeHrFloors.length >= 5 ? bikeHrFloors : undefined,
          hr_zone_names: bikeHrCeilings.length === 5 ? GARMIN_5_ZONE_HR_NAMES : undefined,
        },
        {
          types: ['Run', 'VirtualRun'],
          ftp: derivedRunFtp,
          eftp: derivedRunFtp,
          threshold_pace: derivedRunThresholdPace,
          lthr:
            runLthr > 110
              ? runLthr
              : runMaxHr > 140
                ? Math.round(runMaxHr * 0.9)
                : undefined,
          max_hr: runMaxHr > 130 ? runMaxHr : undefined,
          hr_zones: runHrCeilings.length >= 5 ? runHrCeilings : undefined,
          hr_zone_floors: runHrFloors.length >= 5 ? runHrFloors : undefined,
          hr_zone_names: runHrCeilings.length === 5 ? GARMIN_5_ZONE_HR_NAMES : undefined,
        },
      ],
    };

    session.lastSyncedAt = new Date().toISOString();
    return { rawProfile, wellnessRows, activities: rawActivitiesList };
  }

  // ---------------------------------------------------------------------------
  // Path B: Official Garmin Partner OAuth 2.0 Session (Health API REST Pull)
  // ---------------------------------------------------------------------------
  const nowSec = Math.floor(Date.now() / 1000);
  const startEpochSec = nowSec - Math.min(daysToFetch, 30) * 86400;
  const [userIdInfo, dailiesData, sleepsData, hrvData, actsData] = await Promise.all([
    fetchGarminPartnerApiJson<{ userId?: string }>('/wellness-api/rest/user/id', session).catch(
      () => null
    ),
    fetchGarminPartnerApiJson<GarminDailySummaryItem[]>(
      `/wellness-api/rest/dailies?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${nowSec}`,
      session
    ).catch(() => null),
    fetchGarminPartnerApiJson<GarminSleepDto[]>(
      `/wellness-api/rest/sleeps?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${nowSec}`,
      session
    ).catch(() => null),
    fetchGarminPartnerApiJson<GarminHrvDto[]>(
      `/wellness-api/rest/hrv?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${nowSec}`,
      session
    ).catch(() => null),
    fetchGarminPartnerApiJson<GarminRawActivity[]>(
      `/wellness-api/rest/activities?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${nowSec}`,
      session
    ).catch(() => null),
  ]);

  if (userIdInfo?.userId) {
    session.garminUserId = String(userIdInfo.userId);
  }
  const wellnessMap = new Map<string, GarminWellnessRow>();
  const ensurePartnerDay = (d?: string): GarminWellnessRow | null => {
    const dateStr = String(d || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    if (!wellnessMap.has(dateStr)) wellnessMap.set(dateStr, { id: dateStr });
    return wellnessMap.get(dateStr)!;
  };
  for (const d of Array.isArray(dailiesData) ? dailiesData : []) {
    const row = ensurePartnerDay(d?.calendarDate || d?.date || d?.startTimeLocal);
    if (!row) continue;
    const rhr = Number(d?.restingHeartRate ?? d?.minHeartRate ?? 0);
    if (rhr >= 30 && rhr <= 110) row.restingHR = rhr;
    if (Number(d?.totalSteps) > 0) row.steps = Number(d.totalSteps);
  }
  for (const s of Array.isArray(sleepsData) ? sleepsData : []) {
    const row = ensurePartnerDay(s?.calendarDate || s?.date);
    if (!row) continue;
    const dur = Number(s?.durationInSeconds ?? s?.sleepTimeSeconds ?? 0);
    if (dur > 0) row.sleepSecs = dur;
    const score = Number(s?.overallSleepScore?.value ?? s?.sleepScores?.overall?.value ?? s?.sleepScore ?? 0);
    if (score > 0) row.sleepScore = score;
  }
  for (const h of Array.isArray(hrvData) ? hrvData : []) {
    const row = ensurePartnerDay(h?.calendarDate || h?.date);
    if (!row) continue;
    const hrvVal = Number(h?.lastNightAvg ?? h?.weeklyAvg ?? h?.hrvValue ?? 0);
    if (hrvVal > 0) row.hrv = hrvVal;
    if (Number(h?.weeklyAvg) > 0) row.hrvBaseline7d = Number(h.weeklyAvg);
    if (h?.status) row.garminHrvStatus = String(h.status);
  }

  const wellnessRows = Array.from(wellnessMap.values()).sort((a, b) =>
    String(a.id).localeCompare(String(b.id))
  );
  const rawProfile: ServerRawProfileInput = {
    id: session.garminUserId || 'garmin-partner-oauth',
    name: session.fullName || session.displayName || 'Garmin Athlete',
    icu_resting_hr: wellnessRows[wellnessRows.length - 1]?.restingHR,
    sportSettings: [
      { types: ['Ride', 'VirtualRide'] },
      { types: ['Run', 'VirtualRun'] },
    ],
  };

  session.lastSyncedAt = new Date().toISOString();
  return {
    rawProfile,
    wellnessRows,
    activities: Array.isArray(actsData) ? actsData : [],
  };
}

export function getEnvGarminPersonalApiKey(): string {
  if (process.env.ALLOW_DEV_ENV_CREDENTIALS !== 'true') {
    return '';
  }
  return String(process.env.GARMIN_PERSONAL_API_KEY || '').trim();
}


export function normalizeGarminPersonalApiActivities(
  rawActivities: GarminRawActivity[],
  ftpWatts = 250,
  calibrationOpts?: {
    lthr?: number;
    runLthr?: number;
    thresholdPaceSecsPerKm?: number;
    restingHr?: number;
  }
) {
  if (!Array.isArray(rawActivities)) return [];
  const activeFtp = Math.max(120, Number(ftpWatts || 250));

  return rawActivities
    .filter((a) => a && (a.activityId || a.id))
    .map((a) => {
      const id = String(a.activityId || a.id);
      const typeKey = String(
        a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ''
      ).toLowerCase();
      const name = String(a.activityName || a.name || typeKey || 'Garmin Activity');
      const combined = `${typeKey} ${name}`.toLowerCase();
      const startLat = Number(a.startLatitude ?? 0);
      const startLng = Number(a.startLongitude ?? 0);
      const hasGps = Boolean((startLat || startLng) && !(startLat === 0 && startLng === 0));
      const isWatopiaOrMakuri =
        startLat >= -12.6 && startLat <= -9.8 && startLng >= 164.8 && startLng <= 168.0;
      const isVirtualPlatform =
        isWatopiaOrMakuri ||
        /virtual_ride|virtual|zwift|watopia|makuri|rouvy|mywhoosh|trainerroad/i.test(combined);
      const classified = classifyMultiSportActivity(typeKey, name, {
        trainer: isVirtualPlatform || /indoor|treadmill|virtual|trainer|spin|peloton|gym|strength|yoga/i.test(combined),
        hasGps,
        isVirtualPlatform,
      });
      const sportCategory = classified.sportCategory;
      const isEBike = classified.subType === 'EBike';
      const isIndoor = classified.environment === 'INDOOR';
      const subType = classified.subType;

      const movingTimeSecs = Math.round(
        Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0)
      );
      const distanceMeters = Math.round(Number(a.distance ?? 0));
      const elevationGainMeters = Math.round(Number(a.elevationGain ?? 0));
      const rawAvgPower =
        Number(a.avgPower) > 0 ? Math.round(Number(a.avgPower)) : undefined;
      const rawNormalizedPower =
        Number(a.normPower) > 0
          ? Math.round(Number(a.normPower))
          : rawAvgPower;
      const avgPower = isEBike ? undefined : rawAvgPower;
      const normalizedPower = isEBike ? undefined : rawNormalizedPower;
      const rawMaxPower = Number(a.maxPower ?? a.maxAvgPower_1 ?? 0);
      const maxPower = !isEBike && rawMaxPower > 0 ? Math.round(rawMaxPower) : undefined;
      const rawMax20m = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
      const max20MinPower = !isEBike && rawMax20m > 0 ? Math.round(rawMax20m) : undefined;
      const fastestSplit1000 =
        Number(a.fastestSplit_1000) > 0 ? Math.round(Number(a.fastestSplit_1000)) : undefined;
      const fastestSplit1609 =
        Number(a.fastestSplit_1609) > 0 ? Math.round(Number(a.fastestSplit_1609)) : undefined;
      const fastestSplit5000 =
        Number(a.fastestSplit_5000) > 0 ? Math.round(Number(a.fastestSplit_5000)) : undefined;
      const avgHr = Math.round(Number(a.averageHR ?? 0));
      const maxHr = Math.round(Number(a.maxHR ?? 0));
      const avgCadence =
        Number(a.averageBikingCadenceInRevPerMinute) > 0
          ? Math.round(Number(a.averageBikingCadenceInRevPerMinute))
          : Number(a.averageRunningCadenceInStepsPerMinute) > 0
            ? Math.round(Number(a.averageRunningCadenceInStepsPerMinute))
            : undefined;

      const avgPaceSecsPerKm =
        sportCategory === 'Running' && distanceMeters > 0 && movingTimeSecs > 0
          ? Math.round(movingTimeSecs / (distanceMeters / 1000))
          : undefined;

      const hasRealCyclingWatts =
        !isEBike && sportCategory === 'Cycling' && Boolean(normalizedPower && normalizedPower > 0);
      const loadResult = computeStravaActivityLoadV2({
        sportCategory,
        rawSportType: typeKey || undefined,
        name,
        environment: isIndoor ? 'INDOOR' : 'OUTDOOR',
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters,
        normalizedPower,
        avgPower,
        hasRealDeviceWatts: hasRealCyclingWatts,
        avgHr,
        maxHr,
        avgPaceSecsPerKm,
        calibratedFtp: activeFtp,
        calibratedBikeLthr: calibrationOpts?.lthr || 163,
        calibratedRunLthr: calibrationOpts?.runLthr || 168,
        calibratedThresholdPaceSecsPerKm: calibrationOpts?.thresholdPaceSecsPerKm || 255,
        restingHr: calibrationOpts?.restingHr || 52,
      });

      const intensityFactor = loadResult.intensityFactor;
      const trainingLoad = loadResult.trainingLoad;

      let efficiencyFactor = 0;
      if (hasRealCyclingWatts && normalizedPower && avgHr > 0) {
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

      const hrZones = [
        Math.round(Number(a.hrTimeInZone_1 ?? 0)),
        Math.round(Number(a.hrTimeInZone_2 ?? 0)),
        Math.round(Number(a.hrTimeInZone_3 ?? 0)),
        Math.round(Number(a.hrTimeInZone_4 ?? 0)),
        Math.round(Number(a.hrTimeInZone_5 ?? 0)),
        0,
        0,
      ];
      const powerZones = [
        Math.round(Number(a.powerTimeInZone_1 ?? 0)),
        Math.round(Number(a.powerTimeInZone_2 ?? 0)),
        Math.round(Number(a.powerTimeInZone_3 ?? 0)),
        Math.round(Number(a.powerTimeInZone_4 ?? 0)),
        Math.round(Number(a.powerTimeInZone_5 ?? 0)),
        Math.round(Number(a.powerTimeInZone_6 ?? 0)),
        Math.round(Number(a.powerTimeInZone_7 ?? 0)),
      ];
      const hasPowerZones = powerZones.some((s) => s > 0);

      const startLatLng: [number, number] | undefined =
        Math.abs(startLat) > 0.01 && Math.abs(startLng) > 0.01
          ? [Number(startLat.toFixed(5)), Number(startLng.toFixed(5))]
          : undefined;
      const garminTimestamps = normalizeActivityTimestamps({
        startDateLocal: a.startTimeLocal
          ? stripTimezoneSuffix(String(a.startTimeLocal).trim().replace(' ', 'T'))
          : undefined,
        startDateUtc: a.startTimeGMT
          ? String(a.startTimeGMT).trim().replace(' ', 'T')
          : undefined,
        startLatLng,
        fallbackBrowserTz: true,
      });
      const endLat = Number(a.endLatitude ?? 0);
      const endLng = Number(a.endLongitude ?? 0);
      const endLatLng: [number, number] | undefined =
        Math.abs(endLat) > 0.01 && Math.abs(endLng) > 0.01
          ? [Number(endLat.toFixed(5)), Number(endLng.toFixed(5))]
          : undefined;

      return {
        id: `garmin-${id}`,
        garminId: id,
        startDateLocal: garminTimestamps.startDateLocal,
        ...(garminTimestamps.startDateUtcMs !== undefined
          ? { startDateUtcMs: garminTimestamps.startDateUtcMs }
          : {}),
        name,
        sportCategory,
        rawSportType: typeKey || undefined,
        environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
        subType,
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters,
        avgPower,
        normalizedPower,
        deviceWatts: sportCategory === 'Cycling' ? hasRealCyclingWatts : undefined,
        max_watts: maxPower,
        max20MinPower,
        fastestSplit_1000: fastestSplit1000,
        fastestSplit_1609: fastestSplit1609,
        fastestSplit_5000: fastestSplit5000,
        intensityFactor,
        trainingLoad,
        loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
        avgHr,
        maxHr,
        avgCadence,
        avgPaceSecsPerKm,
        gapPaceSecsPerKm: avgPaceSecsPerKm,
        aerobicDecouplingPct: 0,
        efficiencyFactor,
        firstHalfEf: 0,
        secondHalfEf: 0,
        calories: a.calories ? Math.round(Number(a.calories)) : undefined,
        zoneSecs: {
          hr: hrZones,
          power: hasPowerZones ? powerZones : undefined,
        },
        startLatLng,
        endLatLng,
        segmentEfforts: [],
        sourceBadges: ['Garmin'] as ('Intervals.icu' | 'Garmin' | 'Strava')[],
      };
    });
}

