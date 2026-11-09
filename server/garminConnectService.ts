import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface GarminSessionStore {
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

// Public Garmin Connect Mobile OAuth1 consumer credentials used by Garmin SSO mobile flow
// (Can also be overridden via GARMIN_CONSUMER_KEY / GARMIN_CONSUMER_SECRET env vars)
const DEFAULT_GARMIN_OAUTH_KEY =
  process.env.GARMIN_CONSUMER_KEY || 'fc3e99d2-118c-44b8-8ae3-03370dde24c0';
const DEFAULT_GARMIN_OAUTH_SECRET =
  process.env.GARMIN_CONSUMER_SECRET || 'E08WAR897WEy2knn7aFBrvegVAf0AFdWBBF';

const GARMIN_API_BASE = 'https://connectapi.garmin.com';
const GARMIN_USER_AGENT = 'com.garmin.android.apps.connectmobile';

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
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
 * Authenticates with Garmin Connect via SSO Email/Password or Direct OAuth2 Bearer Token
 */
export async function authenticateGarminConnect(params: {
  email?: string;
  password?: string;
  directBearerToken?: string;
  oauth1Token?: string;
  oauth1TokenSecret?: string;
}): Promise<GarminSessionStore> {
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

    // Verify token against Garmin userprofile endpoint
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
      'Please provide your Garmin Connect email & password, or paste a Garmin Bearer / OAuth token.'
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

  // Step 1: Fetch CSRF token & cookies from Garmin SSO
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

  // Step 2: Submit credentials to obtain Garmin SSO service ticket (ST-...)
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
    if (/MFA|verification code|two-step/i.test(loginHtml)) {
      throw new Error(
        'Garmin MFA is enabled on this account. Please use the "Direct Garmin Bearer Token" option below (copy the Authorization Bearer token from connect.garmin.com).'
      );
    }
    throw new Error(
      'Garmin SSO did not return a login ticket. Verify your Garmin email/password or paste a Direct Garmin Bearer Token.'
    );
  }

  const ticket = ticketMatch[1];

  // Step 3: Exchange Ticket for OAuth1 Preauthorized Token
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

  // Step 4: Exchange OAuth1 for OAuth2 Bearer Token
  await refreshGarminOAuth2Token(session);

  // Step 5: Resolve display name / full name
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
 * Pushes a structured workout directly to Garmin Connect and schedules it on the athlete's calendar
 * so it syncs wirelessly to their Garmin Fenix/Forerunner watch and Edge head unit.
 */
export async function pushWorkoutToGarminConnect(
  session: GarminSessionStore,
  input: GarminWorkoutPushInput
): Promise<GarminWorkoutPushResult> {
  const isRunning =
    String(input.sportCategory).toLowerCase().includes('run');
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

  // 1. Create the structured workout in Garmin Connect
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

  // 2. Schedule the workout onto the athlete's Garmin Connect Calendar for `input.date`
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
 * Fetches Athlete Profile, Biometrics (FTP, LTHR, Weight, VO2Max, RHR), and Recent Sleep/HRV
 * directly from Garmin Connect without Intervals.icu.
 */
export async function fetchDirectGarminProfileAndWellness(
  session: GarminSessionStore,
  daysToFetch = 14
): Promise<{
  rawProfile: Record<string, any>;
  wellnessRows: Record<string, any>[];
}> {
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

  // Garmin stores weight in grams in userSettings/biometricProfile
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

  // Fetch recent daily Sleep + HRV + RHR summaries for the last N days
  const today = new Date();
  const dateStrings: string[] = [];
  for (let i = Math.min(daysToFetch, 28) - 1; i >= 0; i--) {
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
        vo2max: vo2MaxCycling > 20 ? vo2MaxCycling : vo2MaxRunning > 20 ? vo2MaxRunning : undefined,
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
  return { rawProfile, wellnessRows };
}
