import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface GarminSessionStore {
  personalApiKey?: string; // Official Garmin Connect Personal API Key (GCDC_...)
  personalBearerToken?: string;
  personalBearerExpiresAt?: number; // unix seconds
  email?: string;
  displayName?: string;
  fullName?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
  oauth2AccessToken?: string;
  oauth2RefreshToken?: string;
  oauth2ExpiresAt?: number; // unix seconds
  connectedAt?: string;
  lastSyncedAt?: string;
}

export interface GarminWorkoutStepSpec {
  label: string;
  durationSecs: number;
  targetPctFtp?: number;
  targetWatts?: number;
  targetMinWatts?: number;
  targetMaxWatts?: number;
  hrCeilingBpm?: number;
  stepType?: 'warmup' | 'interval' | 'recovery' | 'cooldown';
}

export interface GarminWorkoutPushInput {
  date: string; // YYYY-MM-DD
  name: string;
  sportCategory: 'Cycling' | 'Running' | string;
  description?: string;
  ftpWatts?: number;
  lthrBpm?: number;
  steps: GarminWorkoutStepSpec[];
}

export interface GarminWorkoutPushResult {
  pushed: boolean;
  workoutId?: string | number;
  scheduleId?: string | number;
  message: string;
}

const DEFAULT_GARMIN_OAUTH_KEY =
  process.env.GARMIN_CONSUMER_KEY || 'fc3e99d2-118c-44b8-8ae3-03370dde24c0';
const DEFAULT_GARMIN_OAUTH_SECRET =
  process.env.GARMIN_CONSUMER_SECRET || 'E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF';

const GARMIN_API_BASE = 'https://connectapi.garmin.com';
const GARMIN_PERSONAL_API_BASE = 'https://personal.connectapi.garmin.com';
const GARMIN_USER_AGENT = 'com.garmin.android.apps.connectmobile';

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

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
    process.env.GARMIN_PERSONAL_API_KEY ||
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
export async function fetchGarminPersonalApiJson(
  endpointPath: string,
  session: GarminSessionStore
): Promise<any> {
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
  return text ? JSON.parse(text) : null;
}

/**
 * Generates an OAuth 1.0a Authorization header for Garmin Connect OAuth service calls
 */
function buildOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  token?: string,
  tokenSecret?: string,
  extraParams: Record<string, string> = {}
): string {
  const parsedUrl = new URL(url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...extraParams,
  };
  if (token) {
    oauthParams.oauth_token = token;
  }

  const allParams: Record<string, string> = { ...oauthParams };
  parsedUrl.searchParams.forEach((v, k) => {
    allParams[k] = v;
  });

  const sortedParamStr = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(sortedParamStr),
  ].join('&');

  const signingKey = `${percentEncode(consumerSecret)}&${
    tokenSecret ? percentEncode(tokenSecret) : ''
  }`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

export function getGarminSessionFilePath(dataDir: string, scopeKey: string): string {
  const safeScope = scopeKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataDir, `garmin_session_${safeScope}.json`);
}

export function loadGarminSession(dataDir: string, scopeKey: string): GarminSessionStore | null {
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as GarminSessionStore;
    }
  } catch {
    // ignore corrupt file
  }
  return null;
}

export function saveGarminSession(
  dataDir: string,
  scopeKey: string,
  session: GarminSessionStore
): void {
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  } catch {
    // ignore write errors
  }
}

export function clearGarminSession(dataDir: string, scopeKey: string): void {
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
 * Exchanges a Garmin OAuth1 token pair for a fresh OAuth2 Bearer token
 */
export async function refreshGarminOAuth2Token(
  session: GarminSessionStore
): Promise<GarminSessionStore> {
  if (!session.oauth1Token || !session.oauth1TokenSecret) {
    return session;
  }

  const exchangeUrl = `${GARMIN_API_BASE}/oauth-service/oauth/exchange/user/2.0`;
  const authHeader = buildOAuth1Header(
    'POST',
    exchangeUrl,
    DEFAULT_GARMIN_OAUTH_KEY,
    DEFAULT_GARMIN_OAUTH_SECRET,
    session.oauth1Token,
    session.oauth1TokenSecret
  );

  const resp = await fetch(exchangeUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'User-Agent': GARMIN_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!resp.ok) {
    throw new Error(`Garmin OAuth2 token refresh failed (${resp.status})`);
  }

  const data = (await resp.json()) as any;
  if (data?.access_token) {
    session.oauth2AccessToken = data.access_token;
    session.oauth2RefreshToken = data.refresh_token || session.oauth2RefreshToken;
    session.oauth2ExpiresAt =
      Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  }
  return session;
}

/**
 * Authenticates with Garmin Connect via:
 * 1. Official Garmin Personal API Key (GCDC_...)
 * 2. Direct OAuth2 Bearer Token / OAuth1 Token Pair
 * 3. Garmin SSO Email + Password
 */
export async function authenticateGarminConnect(params: {
  personalApiKey?: string;
  email?: string;
  password?: string;
  directBearerToken?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
}): Promise<GarminSessionStore> {
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
      connectedAt: new Date().toISOString(),
    };
    await obtainGarminPersonalApiBearerToken(session, true);
    const settings = await fetchGarminPersonalApiJson(
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

  // Path 1: Direct Bearer Token or OAuth1 Token Pair provided
  if (params.directBearerToken?.trim()) {
    const cleanToken = params.directBearerToken
      .trim()
      .replace(/^Bearer\s+/i, '');
    const session: GarminSessionStore = {
      email: params.email?.trim() || undefined,
      oauth2AccessToken: cleanToken,
      oauth1Token: params.oauth1Token?.trim() || undefined,
      oauth1TokenSecret: params.oauth1TokenSecret?.trim() || undefined,
      oauth2ExpiresAt: Math.floor(Date.now() / 1000) + 86400,
      connectedAt: new Date().toISOString(),
    };

    const profile = await fetchGarminJson(
      '/userprofile-service/socialProfile',
      session
    ).catch(() => null);
    if (profile) {
      session.displayName = profile.displayName || profile.userName;
      session.fullName = profile.fullName || profile.displayName;
    }
    return session;
  }

  if (params.oauth1Token?.trim() && params.oauth1TokenSecret?.trim()) {
    const session: GarminSessionStore = {
      email: params.email?.trim() || undefined,
      oauth1Token: params.oauth1Token.trim(),
      oauth1TokenSecret: params.oauth1TokenSecret.trim(),
      connectedAt: new Date().toISOString(),
    };
    await refreshGarminOAuth2Token(session);
    const profile = await fetchGarminJson(
      '/userprofile-service/socialProfile',
      session
    ).catch(() => null);
    if (profile) {
      session.displayName = profile.displayName || profile.userName;
      session.fullName = profile.fullName || profile.displayName;
    }
    return session;
  }

  // Path 2: Garmin SSO Email + Password Ticket Flow
  const email = (params.email || '').trim();
  const password = params.password || '';
  if (!email || !password) {
    throw new Error(
      'Please provide your Garmin Personal API Key (GCDC_...), or your Garmin email & password.'
    );
  }

  const ssoEmbedParams = new URLSearchParams({
    id: 'gauth-widget',
    embedWidget: 'true',
    gauthHost: 'https://sso.garmin.com/sso',
  });
  const ssoSignInParams = new URLSearchParams({
    id: 'gauth-widget',
    embedWidget: 'true',
    gauthHost: 'https://sso.garmin.com/sso/embed',
    service: 'https://sso.garmin.com/sso/embed',
    source: 'https://sso.garmin.com/sso/embed',
    redirectAfterAccountLoginUrl: 'https://sso.garmin.com/sso/embed',
    redirectAfterAccountCreationUrl: 'https://sso.garmin.com/sso/embed',
  });

  const embedResp = await fetch(
    `https://sso.garmin.com/sso/embed?${ssoEmbedParams.toString()}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      },
    }
  );
  const embedCookies = embedResp.headers.get('set-cookie') || '';

  const signinPageResp = await fetch(
    `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        Cookie: embedCookies,
        Referer: `https://sso.garmin.com/sso/embed?${ssoEmbedParams.toString()}`,
      },
    }
  );
  const signinHtml = await signinPageResp.text();
  const signinCookies = [
    embedCookies,
    signinPageResp.headers.get('set-cookie') || '',
  ]
    .filter(Boolean)
    .join('; ');

  const csrfMatch = signinHtml.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  const formBody = new URLSearchParams({
    username: email,
    password,
    embed: 'true',
    _csrf: csrfToken,
  });

  const loginResp = await fetch(
    `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        Cookie: signinCookies,
        Origin: 'https://sso.garmin.com',
        Referer: `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`,
      },
      body: formBody.toString(),
    }
  );

  const loginHtml = await loginResp.text();
  const ticketMatch = loginHtml.match(/ticket=([A-Za-z0-9-]+-[A-Za-z0-9.-]+)/);
  if (!ticketMatch) {
    throw new Error(
      'Garmin SSO requires MFA on this account. Please paste your Garmin Personal API Key (GCDC_...) instead.'
    );
  }

  const ticket = ticketMatch[1];
  const preauthUrl = `${GARMIN_API_BASE}/oauth-service/oauth/preauthorized?ticket=${encodeURIComponent(
    ticket
  )}&login-url=https://sso.garmin.com/sso/embed&accepts-mfa-tokens=true`;
  const oauth1Header = buildOAuth1Header(
    'GET',
    preauthUrl,
    DEFAULT_GARMIN_OAUTH_KEY,
    DEFAULT_GARMIN_OAUTH_SECRET
  );

  const preauthResp = await fetch(preauthUrl, {
    headers: {
      Authorization: oauth1Header,
      'User-Agent': GARMIN_USER_AGENT,
    },
  });

  if (!preauthResp.ok) {
    throw new Error(`Garmin OAuth1 exchange failed (${preauthResp.status})`);
  }

  const preauthQuery = new URLSearchParams(await preauthResp.text());
  const oauth1Token = preauthQuery.get('oauth_token') || '';
  const oauth1TokenSecret = preauthQuery.get('oauth_token_secret') || '';

  if (!oauth1Token || !oauth1TokenSecret) {
    throw new Error('Garmin OAuth1 response missing token pair.');
  }

  const session: GarminSessionStore = {
    email,
    oauth1Token,
    oauth1TokenSecret,
    connectedAt: new Date().toISOString(),
  };

  await refreshGarminOAuth2Token(session);

  const profile = await fetchGarminJson(
    '/userprofile-service/socialProfile',
    session
  ).catch(() => null);
  if (profile) {
    session.displayName = profile.displayName || profile.userName;
    session.fullName = profile.fullName || profile.displayName;
  }

  return session;
}

/**
 * Helper to perform authenticated GET/POST requests against connectapi.garmin.com
 */
export async function fetchGarminJson(
  endpointPath: string,
  session: GarminSessionStore,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: any } = {}
): Promise<any> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    (!session.oauth2AccessToken ||
      (session.oauth2ExpiresAt && session.oauth2ExpiresAt - 120 < nowSec)) &&
    session.oauth1Token &&
    session.oauth1TokenSecret
  ) {
    await refreshGarminOAuth2Token(session);
  }

  if (!session.oauth2AccessToken) {
    throw new Error('No active Garmin Connect OAuth2 token available.');
  }

  const url = endpointPath.startsWith('http')
    ? endpointPath
    : `${GARMIN_API_BASE}${endpointPath}`;

  const doRequest = async (token: string) =>
    fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'DI-Backend': 'connectapi.garmin.com',
        'User-Agent': GARMIN_USER_AGENT,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let resp = await doRequest(session.oauth2AccessToken);

  if (resp.status === 401 && session.oauth1Token && session.oauth1TokenSecret) {
    await refreshGarminOAuth2Token(session);
    if (session.oauth2AccessToken) {
      resp = await doRequest(session.oauth2AccessToken);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(
      `Garmin Connect API ${options.method || 'GET'} ${endpointPath} failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }

  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Pushes a structured workout to Garmin Connect (requires OAuth2/Web Bearer session since
 * Garmin's Personal API GCDC_ key is strictly read-only per Garmin's specification).
 */
export async function pushWorkoutToGarminConnect(
  session: GarminSessionStore,
  input: GarminWorkoutPushInput
): Promise<GarminWorkoutPushResult> {
  if (!session.oauth2AccessToken && !session.oauth1Token) {
    throw new Error(
      'Garmin Personal API keys (GCDC_...) are read-only per Garmin policy. To send this workout to your Garmin watch or Edge head unit, click "Export Garmin .FIT" (or keep Intervals.icu Garmin workout upload enabled).'
    );
  }

  const isRunning = String(input.sportCategory).toLowerCase().includes('run');
  const sportType = isRunning
    ? { sportTypeId: 1, sportTypeKey: 'running', displayOrder: 1 }
    : { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 };

  const activeFtp = Math.max(100, Number(input.ftpWatts || 250));
  const totalSteps = input.steps.length;

  const executableSteps = input.steps.map((s, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === totalSteps - 1 && totalSteps > 1;
    const pct = Number(s.targetPctFtp || 70);

    let stepTypeKey: 'warmup' | 'interval' | 'recovery' | 'cooldown' =
      s.stepType || 'interval';
    if (!s.stepType) {
      if (isFirst) stepTypeKey = 'warmup';
      else if (isLast) stepTypeKey = 'cooldown';
      else if (pct <= 60 || /recov|easy|rest/i.test(s.label))
        stepTypeKey = 'recovery';
      else stepTypeKey = 'interval';
    }

    const stepTypeIdMap: Record<string, number> = {
      warmup: 1,
      cooldown: 2,
      interval: 3,
      recovery: 4,
    };

    const centerWatts =
      Number(s.targetWatts) > 0
        ? Math.round(Number(s.targetWatts))
        : Math.round((pct / 100) * activeFtp);
    const lowWatts =
      Number(s.targetMinWatts) > 0
        ? Math.round(Number(s.targetMinWatts))
        : Math.max(40, centerWatts - 10);
    const highWatts =
      Number(s.targetMaxWatts) > 0
        ? Math.round(Number(s.targetMaxWatts))
        : centerWatts + 10;

    return {
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: idx + 1,
      stepType: {
        stepTypeId: stepTypeIdMap[stepTypeKey] || 3,
        stepTypeKey,
        displayOrder: stepTypeIdMap[stepTypeKey] || 3,
      },
      childStepId: null,
      description: `${s.label}${s.hrCeilingBpm ? ` (HR <= ${s.hrCeilingBpm} bpm)` : ''}`,
      endCondition: {
        conditionTypeId: 2,
        conditionTypeKey: 'time',
        displayOrder: 2,
        displayable: true,
      },
      endConditionValue: Math.max(30, Math.round(s.durationSecs)),
      preferredEndConditionUnit: null,
      endConditionCompare: null,
      targetType: {
        workoutTargetTypeId: 2,
        workoutTargetTypeKey: 'power.zone',
        displayOrder: 2,
      },
      targetValueOne: lowWatts,
      targetValueTwo: highWatts,
      zoneNumber: null,
    };
  });

  const estimatedDurationInSecs = executableSteps.reduce(
    (acc, s) => acc + s.endConditionValue,
    0
  );

  const workoutPayload = {
    sportType,
    subSportType: null,
    workoutName: input.name.slice(0, 64),
    description: (input.description || 'Prescribed by Thresh Readiness Engine').slice(
      0,
      512
    ),
    estimatedDurationInSecs,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType,
        workoutSteps: executableSteps,
      },
    ],
  };

  const createdWorkout = await fetchGarminJson(
    '/workout-service/workout',
    session,
    {
      method: 'POST',
      body: workoutPayload,
    }
  );

  const workoutId = createdWorkout?.workoutId;
  if (!workoutId) {
    throw new Error('Garmin Connect did not return a workoutId.');
  }

  const scheduled = await fetchGarminJson(
    `/workout-service/schedule/${encodeURIComponent(String(workoutId))}`,
    session,
    {
      method: 'POST',
      body: { date: input.date.slice(0, 10) },
    }
  );

  return {
    pushed: true,
    workoutId,
    scheduleId: scheduled?.workoutScheduleId || workoutId,
    message: `Pushed "${input.name}" directly to Garmin Connect Calendar (${input.date.slice(0, 10)}) — ready to sync to your Garmin watch & Edge head unit.`,
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
  rawProfile: Record<string, any>;
  wellnessRows: Record<string, any>[];
  activities: Record<string, any>[];
}> {
  const endDate = new Date().toISOString().slice(0, 10);
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
      fetchGarminPersonalApiJson(
        '/userprofile-service/userprofile/settings',
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        '/biometric-service/heartRateZones/v2',
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/weight-service/weight/range/${weightStart180d}/${endDate}?includeAll=true`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/fitnessage-service/fitnessage/v2/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/hrv-service/hrv/daily/${startDate}/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/usersummary-service/v2/dailysummaries?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/activitylist-service/activities/search/activities?start=0&limit=100`,
        session
      ).catch(() => null),
    ]);

    const userData = profileSettings?.userData || profileSettings || {};

    // Extract weight from weight-service (180d window) or profileSettings (Garmin uses grams)
    let weightKg: number | undefined;
    const weightList =
      weightRangeData?.dailyWeightSummaries ||
      weightRangeData?.dateWeightList ||
      (Array.isArray(weightRangeData) ? weightRangeData : []);
    if (Array.isArray(weightList) && weightList.length > 0) {
      for (let i = weightList.length - 1; i >= 0; i--) {
        const wItem = weightList[i];
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
    const zonesArray = Array.isArray(hrZonesData)
      ? hrZonesData
      : Array.isArray(hrZonesData?.heartRateZones)
        ? hrZonesData.heartRateZones
        : hrZonesData
          ? [hrZonesData]
          : [];

    const cyclingZoneObj =
      zonesArray.find((z: any) =>
        /cycling|bike|ride/i.test(String(z?.sport || z?.sportType || ''))
      ) ||
      zonesArray.find((z: any) =>
        /default/i.test(String(z?.sport || z?.sportType || ''))
      ) ||
      zonesArray[0] ||
      {};
    const runningZoneObj =
      zonesArray.find((z: any) =>
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

    const bikeHrCeilings: number[] = [];
    if (
      cyclingZoneObj.zone1Floor &&
      cyclingZoneObj.zone2Floor &&
      cyclingZoneObj.zone3Floor &&
      cyclingZoneObj.zone4Floor &&
      cyclingZoneObj.zone5Floor
    ) {
      bikeHrCeilings.push(
        Number(cyclingZoneObj.zone2Floor) - 1,
        Number(cyclingZoneObj.zone3Floor) - 1,
        Number(cyclingZoneObj.zone4Floor) - 1,
        Number(cyclingZoneObj.zone5Floor) - 1,
        bikeMaxHr > 140 ? bikeMaxHr : Number(cyclingZoneObj.zone5Floor) + 15
      );
    }

    const runHrCeilings: number[] = [];
    if (
      runningZoneObj.zone1Floor &&
      runningZoneObj.zone2Floor &&
      runningZoneObj.zone3Floor &&
      runningZoneObj.zone4Floor &&
      runningZoneObj.zone5Floor
    ) {
      runHrCeilings.push(
        Number(runningZoneObj.zone2Floor) - 1,
        Number(runningZoneObj.zone3Floor) - 1,
        Number(runningZoneObj.zone4Floor) - 1,
        Number(runningZoneObj.zone5Floor) - 1,
        runMaxHr > 140 ? runMaxHr : Number(runningZoneObj.zone5Floor) + 15
      );
    }

    // Build daily wellness map by YYYY-MM-DD from sleepSummaries, hrvSummaries, dailySummaries
    const wellnessByDate = new Map<string, Record<string, any>>();
    const ensureDay = (d: string) => {
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

    const dailyList = Array.isArray(dailySummaries)
      ? dailySummaries
      : Array.isArray(dailySummaries?.dailySummaries)
        ? dailySummaries.dailySummaries
        : Array.isArray(dailySummaries?.summaries)
          ? dailySummaries.summaries
          : [];
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

    const sleepList = Array.isArray(sleepSummaries)
      ? sleepSummaries
      : Array.isArray(sleepSummaries?.dailySleepDTOs)
        ? sleepSummaries.dailySleepDTOs
        : Array.isArray(sleepSummaries?.sleepSummaries)
          ? sleepSummaries.sleepSummaries
          : [];
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

    const hrvList = Array.isArray(hrvSummaries)
      ? hrvSummaries
      : Array.isArray(hrvSummaries?.hrvSummaries)
        ? hrvSummaries.hrvSummaries
        : [];
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
        row.hrvNormalLow = Number(hDto.baseline.balancedLow);
      }
      if (Number(hDto?.baseline?.balancedUpper) > 0) {
        row.hrvNormalHigh = Number(hDto.baseline.balancedUpper);
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

    const rawActivitiesList = Array.isArray(activitiesData)
      ? activitiesData
      : Array.isArray(activitiesData?.activities)
        ? activitiesData.activities
        : [];

    const activityOwnerFullName = rawActivitiesList.find(
      (a: any) =>
        a?.ownerFullName &&
        typeof a.ownerFullName === 'string' &&
        a.ownerFullName.trim().length > 1
    )?.ownerFullName;
    const activityOwnerId = rawActivitiesList.find((a: any) => a?.ownerId)?.ownerId;

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

    const rawProfile: Record<string, any> = {
      id: activityOwnerId || profileSettings?.id || 'garmin-personal-api',
      name: resolvedFullName,
      weight: weightKg,
      icu_resting_hr: latestRhr,
      sportSettings: [
        {
          types: ['Ride', 'VirtualRide'],
          ftp: Number(userData.ftp) > 60 ? Number(userData.ftp) : undefined,
          lthr:
            bikeLthr > 110
              ? bikeLthr
              : bikeMaxHr > 140
                ? Math.round(bikeMaxHr * 0.89)
                : undefined,
          max_hr: bikeMaxHr > 130 ? bikeMaxHr : undefined,
          hr_zones: bikeHrCeilings.length >= 5 ? bikeHrCeilings : undefined,
        },
        {
          types: ['Run', 'VirtualRun'],
          lthr:
            runLthr > 110
              ? runLthr
              : runMaxHr > 140
                ? Math.round(runMaxHr * 0.9)
                : undefined,
          max_hr: runMaxHr > 130 ? runMaxHr : undefined,
          hr_zones: runHrCeilings.length >= 5 ? runHrCeilings : undefined,
        },
      ],
    };

    session.lastSyncedAt = new Date().toISOString();
    return { rawProfile, wellnessRows, activities: rawActivitiesList };
  }

  // ---------------------------------------------------------------------------
  // Path B: Legacy OAuth2 / Web Bearer Session
  // ---------------------------------------------------------------------------
  const [socialProfile, personalInfo, userSettings, latestFtp, latestLthr] =
    await Promise.all([
      fetchGarminJson('/userprofile-service/socialProfile', session).catch(
        () => null
      ),
      fetchGarminJson(
        '/userprofile-service/userprofile/personal-information',
        session
      ).catch(() => null),
      fetchGarminJson(
        '/userprofile-service/userprofile/user-settings',
        session
      ).catch(() => null),
      fetchGarminJson(
        '/biometric-service/biometric/powerToWeight/latest',
        session
      ).catch(() => null),
      fetchGarminJson(
        '/biometric-service/biometric/lactateThreshold/latest',
        session
      ).catch(() => null),
    ]);

  const userData = userSettings?.userData || {};
  const bioInfo = personalInfo?.biometricProfile || {};

  const rawWeightGrams = Number(
    userData.weight ?? bioInfo.weight ?? personalInfo?.weight ?? 0
  );
  const weightKg =
    rawWeightGrams > 1000
      ? Number((rawWeightGrams / 1000).toFixed(1))
      : rawWeightGrams >= 35 && rawWeightGrams <= 180
        ? Number(rawWeightGrams.toFixed(1))
        : undefined;

  const ftp = Number(
    latestFtp?.functionalThresholdPower ??
      userData.ftp ??
      bioInfo.functionalThresholdPower ??
      0
  );
  const lthrBpm = Number(
    latestLthr?.heartRate ??
      latestLthr?.lactateThresholdHeartRate ??
      userData.lactateThresholdHeartRate ??
      0
  );
  const maxHr = Number(userData.maxHeartRate ?? bioInfo.maxHeartRate ?? 0);
  const restingHr = Number(
    userData.restingHeartRate ?? bioInfo.restingHeartRate ?? 0
  );
  const vo2MaxCycling = Number(
    userData.vo2MaxCycling ?? userData.vo2Max ?? 0
  );
  const vo2MaxRunning = Number(
    userData.vo2MaxRunning ?? userData.vo2Max ?? 0
  );

  const name =
    socialProfile?.fullName ||
    personalInfo?.userInfo?.fullName ||
    socialProfile?.displayName ||
    session.fullName ||
    session.displayName;

  if (name) {
    session.fullName = name;
    session.displayName = socialProfile?.displayName || name;
  }

  const today = new Date();
  const dateStrings: string[] = [];
  for (let i = Math.min(daysToFetch, 14) - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400 * 1000);
    dateStrings.push(d.toISOString().slice(0, 10));
  }

  const wellnessRows: Record<string, any>[] = [];
  for (const dateStr of dateStrings) {
    const [sleepData, hrvData] = await Promise.all([
      fetchGarminJson(
        `/wellness-service/wellness/dailySleepData?date=${dateStr}&nonSleepBufferMinutes=60`,
        session
      ).catch(() => null),
      fetchGarminJson(`/hrv-service/hrv/${dateStr}`, session).catch(() => null),
    ]);

    const sleepDto = sleepData?.dailySleepDTO;
    const hrvSummary = hrvData?.hrvSummary;

    if (sleepDto || hrvSummary) {
      wellnessRows.push({
        id: dateStr,
        weight: weightKg,
        restingHR:
          sleepData?.restingHeartRate ??
          sleepDto?.restingHeartRate ??
          (restingHr > 30 ? restingHr : undefined),
        hrv:
          hrvSummary?.lastNightAvg ??
          sleepData?.avgOvernightHrv ??
          undefined,
        sleepSecs: sleepDto?.sleepTimeSeconds ?? undefined,
        sleepScore:
          sleepDto?.sleepScores?.overall?.value ??
          sleepDto?.overallSleepScore?.value ??
          undefined,
        vo2max:
          vo2MaxCycling > 20
            ? vo2MaxCycling
            : vo2MaxRunning > 20
              ? vo2MaxRunning
              : undefined,
      });
    }
  }

  const rawProfile: Record<string, any> = {
    id: socialProfile?.profileId || session.email || 'garmin-direct',
    name,
    weight: weightKg,
    icu_resting_hr: restingHr > 30 ? restingHr : undefined,
    vo2max: vo2MaxCycling > 20 ? vo2MaxCycling : undefined,
    sportSettings: [
      {
        types: ['Ride', 'VirtualRide'],
        ftp: ftp > 60 ? ftp : undefined,
        lthr: lthrBpm > 110 ? lthrBpm : undefined,
        max_hr: maxHr > 130 ? maxHr : undefined,
      },
      {
        types: ['Run', 'VirtualRun'],
        lthr: lthrBpm > 110 ? lthrBpm : undefined,
        max_hr: maxHr > 130 ? maxHr : undefined,
      },
    ],
  };

  session.lastSyncedAt = new Date().toISOString();
  return { rawProfile, wellnessRows, activities: [] };
}

export const DEFAULT_GARMIN_PERSONAL_API_KEY =
  'GCDC_3be8ca10-eb29-489f-8fe2-3af08ef95766.5ac0d701-08fa-40ce-b132-0f635bfcc455.EnKLpYLMB3o9M18nEsqBjUEPd7vAS/SJMVW3r+DzAz0.3482173667';

export function normalizeGarminPersonalApiActivities(
  rawActivities: Record<string, any>[],
  ftpWatts = 250
): Record<string, any>[] {
  if (!Array.isArray(rawActivities)) return [];
  const activeFtp = Math.max(100, Number(ftpWatts || 250));

  return rawActivities
    .filter((a) => a && (a.activityId || a.id))
    .map((a) => {
      const id = String(a.activityId || a.id);
      const typeKey = String(
        a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ''
      ).toLowerCase();
      const name = String(a.activityName || a.name || typeKey || 'Garmin Activity');
      const combined = `${typeKey} ${name}`.toLowerCase();

      let sportCategory: 'Cycling' | 'Running' | 'Swimming' | 'Strength' | 'Multisport' =
        'Strength';
      if (
        /cycling|ride|biking|virtual_ride|indoor_cycling|road_biking|gravel|mountain_biking|zwift|peloton|spin/i.test(
          combined
        )
      ) {
        sportCategory = 'Cycling';
      } else if (/running|run|treadmill|trail_running|track_running|virtual_run/i.test(combined)) {
        sportCategory = 'Running';
      } else if (/swimming|swim|lap_swimming|open_water/i.test(combined)) {
        sportCategory = 'Swimming';
      } else if (/multi_sport|triathlon|duathlon/i.test(combined)) {
        sportCategory = 'Multisport';
      }

      const startLat = Number(a.startLatitude ?? 0);
      const startLng = Number(a.startLongitude ?? 0);
      const isWatopiaOrMakuri =
        startLat >= -12.6 && startLat <= -9.8 && startLng >= 164.8 && startLng <= 168.0;
      const isVirtualPlatform =
        isWatopiaOrMakuri ||
        /virtual_ride|virtual|zwift|watopia|makuri|rouvy|mywhoosh|trainerroad/i.test(combined);
      const isIndoor =
        isVirtualPlatform ||
        /indoor|treadmill|virtual|trainer|spin|peloton|gym|strength|yoga/i.test(combined) ||
        (sportCategory === 'Cycling' && !startLat && !startLng);

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
        else if (/gravel/i.test(combined)) subType = 'Gravel';
        else if (/mountain|mtb|trail/i.test(combined)) subType = 'Trail';
        else subType = 'Road';
      } else if (sportCategory === 'Running') {
        if (isIndoor) subType = 'Treadmill';
        else if (/trail/i.test(combined)) subType = 'Trail';
        else subType = 'Road';
      } else if (sportCategory === 'Swimming') {
        subType = /open_water/i.test(combined) ? 'Open Water' : 'Pool';
      } else {
        subType = 'Gym';
      }

      const movingTimeSecs = Math.round(
        Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0)
      );
      const distanceMeters = Math.round(Number(a.distance ?? 0));
      const elevationGainMeters = Math.round(Number(a.elevationGain ?? 0));
      const avgPower =
        Number(a.avgPower) > 0 ? Math.round(Number(a.avgPower)) : undefined;
      const normalizedPower =
        Number(a.normPower) > 0
          ? Math.round(Number(a.normPower))
          : avgPower;
      const maxPower =
        Number(a.maxPower) > 0 ? Math.round(Number(a.maxPower)) : undefined;
      const max20MinPower =
        Number(a.max20MinPower) > 0
          ? Math.round(Number(a.max20MinPower))
          : undefined;
      const avgHr = Math.round(Number(a.averageHR ?? 0));
      const maxHr = Math.round(Number(a.maxHR ?? 0));
      const avgCadence =
        Number(a.averageBikingCadenceInRevPerMinute) > 0
          ? Math.round(Number(a.averageBikingCadenceInRevPerMinute))
          : Number(a.averageRunningCadenceInStepsPerMinute) > 0
            ? Math.round(Number(a.averageRunningCadenceInStepsPerMinute))
            : undefined;

      const intensityFactor =
        normalizedPower && activeFtp > 0
          ? Number((normalizedPower / activeFtp).toFixed(2))
          : undefined;

      let trainingLoad = Math.round(Number(a.activityTrainingLoad ?? 0));
      if (!trainingLoad && normalizedPower && movingTimeSecs > 0) {
        const ifVal = normalizedPower / activeFtp;
        trainingLoad = Math.round(
          ((movingTimeSecs * normalizedPower * ifVal) / (activeFtp * 3600)) * 100
        );
      } else if (!trainingLoad && avgHr > 0 && movingTimeSecs > 0) {
        trainingLoad = Math.round((movingTimeSecs / 3600) * Math.pow(avgHr / 153, 2) * 65);
      }

      const avgPaceSecsPerKm =
        sportCategory === 'Running' && distanceMeters > 0
          ? Math.round(movingTimeSecs / (distanceMeters / 1000))
          : undefined;
      const efficiencyFactor =
        normalizedPower && avgHr > 0 ? Number((normalizedPower / avgHr).toFixed(2)) : 0;

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

      const startDateLocal = String(a.startTimeLocal || a.startTimeGMT || '')
        .trim()
        .replace(' ', 'T');

      const startLatLng: [number, number] | undefined =
        Math.abs(startLat) > 0.01 && Math.abs(startLng) > 0.01
          ? [Number(startLat.toFixed(5)), Number(startLng.toFixed(5))]
          : undefined;
      const endLat = Number(a.endLatitude ?? 0);
      const endLng = Number(a.endLongitude ?? 0);
      const endLatLng: [number, number] | undefined =
        Math.abs(endLat) > 0.01 && Math.abs(endLng) > 0.01
          ? [Number(endLat.toFixed(5)), Number(endLng.toFixed(5))]
          : undefined;

      return {
        id: `garmin-${id}`,
        garminId: id,
        startDateLocal,
        name,
        sportCategory,
        environment: isIndoor ? ('INDOOR' as const) : ('OUTDOOR' as const),
        subType,
        movingTimeSecs,
        distanceMeters,
        elevationGainMeters,
        avgPower,
        normalizedPower,
        max_watts: maxPower,
        max20MinPower,
        intensityFactor,
        trainingLoad,
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

