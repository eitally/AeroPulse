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
} from '../../sessionContext.ts';
import {
  isGenericName,
  type ServerRawProfileInput,
  type ServerRawSportSetting,
} from '../../physiologyEngine.ts';
import type {
  ActivityInterval,
  StravaActivityComment,
  StravaKudoer,
  StravaSegmentEffort,
} from '../../../src/types.ts';
import {
  ensureRequestSessionSid,
  renderThreshOAuthHtml,
  resolveIntervalsCallbackUrl,
} from '../../oauthHelpers.ts';
import { connectServiceToUser, disconnectServiceFromUser } from '../../authService.ts';
import { getOAuthStateCookieNonce, timingSafeStringEqual } from '../../securityUtils.ts';

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

export interface RawIntervalsGear {
  id?: string | number;
  name?: string;
  distance?: number;
  primary?: boolean;
}

export interface RawIntervalsAthleteProfile extends ServerRawProfileInput {
  strava_id?: string | number;
  bikes?: RawIntervalsGear[];
  shoes?: RawIntervalsGear[];
  sportSettings?: ServerRawSportSetting[];
}

export interface RawIntervalsSportInfoEntry {
  type?: string;
  eftp?: number;
  wPrime?: number;
  pMax?: number;
}

export interface RawIntervalsWellnessRow {
  [key: string]: unknown;
  id?: string;
  date?: string;
  weight?: number;
  restingHR?: number;
  vo2max?: number;
  hrv?: number;
  hrvRMSSD?: number;
  hrvBaseline7d?: number;
  hrvNormalBandLow?: number;
  hrvNormalBandHigh?: number;
  rampRate?: number;
  sleepSecs?: number;
  sleepQuality?: string | number;
  sleepScore?: number;
  steps?: number;
  ctl?: number;
  atl?: number;
  ctlLoad?: number;
  atlLoad?: number;
  sportInfo?: RawIntervalsSportInfoEntry[];
}

export interface RawIntervalsInterval {
  id?: string | number;
  type?: string;
  label?: string;
  group_id?: string;
  start_time?: number;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  average_speed?: number;
  gap?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  intensity?: number;
  zone?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  decoupling?: number;
  average_stride?: number;
}

export interface RawIntervalsActivity {
  [key: string]: unknown;
  id?: string | number;
  strava_id?: string | number;
  source?: string;
  type?: string;
  sub_type?: string;
  name?: string;
  device_name?: string;
  trainer?: boolean;
  start_date?: string;
  start_date_local?: string;
  start_latlng?: number[];
  latlng?: number[];
  stream_types?: string[];
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  total_elevation_gain?: number;
  icu_average_watts?: number;
  average_watts?: number;
  icu_weighted_avg_watts?: number;
  icu_intensity?: number;
  icu_training_load?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  gap?: number;
  decoupling?: number;
  gear?: { name?: string };
  has_segments?: boolean;
  icu_hr_zone_times?: number[];
  icu_zone_times?: number[];
  icu_intervals?: RawIntervalsInterval[];
}

export interface RawIntervalsPlannedEvent {
  id?: string | number;
  start_date_local?: string;
  name?: string;
  type?: string;
  description?: string;
  moving_time?: number;
  icu_training_load?: number;
}

export interface NormalizedIntervalsSyncActivity {
  id: string;
  intervalsId: string;
  intervalsActivityId: string;
  stravaId?: string;
  garminActivityId?: string;
  source: string;
  sourceBadges: string[];
  rawSportType?: string;
  name: string;
  startDateLocal: string;
  startDateUtcMs?: number;
  sportCategory: string;
  environment: 'OUTDOOR' | 'INDOOR';
  subType: string;
  movingTimeSecs: number;
  distanceMeters: number;
  elevationGainMeters: number;
  avgPower?: number;
  normalizedPower?: number;
  intensityFactor?: number;
  trainingLoad: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPaceSecsPerKm?: number;
  gapPaceSecsPerKm?: number;
  efficiencyFactor: number;
  aerobicDecouplingPct?: number;
  variabilityIndex?: number;
  zoneSecs: { hr: number[]; power?: number[] };
  gearName?: string;
  deviceName?: string;
  hasSegments: boolean;
  intervals: ActivityInterval[];
  segmentEfforts?: StravaSegmentEffort[];
  stravaPrCount?: number;
  routeLatLngs?: [number, number][];
  startLatLng?: [number, number];
  endLatLng?: [number, number];
  kudosCount?: number;
  hasKudoed?: boolean;
  kudoers?: StravaKudoer[];
  comments?: StravaActivityComment[];
  commentCount?: number;
}

export interface CachedIntervalsIdentity {
  athleteId: string;
  athleteName: string;
  rawProfile?: RawIntervalsAthleteProfile;
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
    const rawProfile = (await resp.json()) as RawIntervalsAthleteProfile;
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


export const intervalsCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || '').trim();
  const error = String(req.query.error || '').trim();
  const stateToken = String(req.query.state || '').trim();

  const cookieNonce = getOAuthStateCookieNonce(req);
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
        ctaLabel: 'Return to MeetReady',
        ctaHref: '/#fitness?openDataSources=1',
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
        ctaLabel: 'Return to MeetReady',
        ctaHref: '/#fitness?openDataSources=1',
      })
    );
    return;
  }

  if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
    res.status(400).type('html').send(
      renderThreshOAuthHtml({
        title: 'Invalid OAuth State',
        heading: 'Security Verification Failed',
        accentColor: '#FB7185',
        body: !verifiedState
          ? 'OAuth state token was invalid or expired. Please re-initiate Intervals.icu connection.'
          : 'Browser OAuth verification cookie was missing or did not match. Please re-initiate Intervals.icu connection.',
        ctaLabel: 'Return to MeetReady',
        ctaHref: '/#fitness?openDataSources=1',
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
      tokenData.scope || 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE';
    store.intervalsAthleteId = athleteId;
    store.intervalsAthleteName = athleteName;

    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith('usr_')) {
      await connectServiceToUser(callerClaims.sub, 'intervals', athleteId, athleteName);
    }

    setSessionCookie(req, res, athleteName, sid, 'verified');
    await saveSessionCacheAsync(req, res, sid);

    const oauthPayloadJson = safeJsonForScript({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'intervals',
      athleteId,
      athleteName,
      scope: store.intervalsScope,
      returnUrl: '/#fitness?openDataSources=1',
    });

    res.type('html').send(
      renderThreshOAuthHtml({
        title: 'Intervals.icu Connected · MeetReady',
        heading: `Intervals.icu Connected${athleteName && !isGenericName(athleteName) ? ` · ${escapeHtml(athleteName)}` : ''}`,
        accentColor: '#10B981',
        body: 'Your Intervals.icu account is now linked via OAuth 2.0. Structured workouts, wellness metrics, and cross-watch calendar push are ready.',
        ctaLabel: 'Continue to MeetReady',
        ctaHref: '/#fitness?openDataSources=1',
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            localStorage.setItem('thresh_session_active_hint', '1');
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
            window.location.replace(payload.returnUrl || '/#fitness?openDataSources=1');
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
        ctaLabel: 'Return to MeetReady',
        ctaHref: '/#fitness?openDataSources=1',
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


export const intervalsAuthRouter = express.Router();


intervalsAuthRouter.get(['/api/intervals/auth/url', '/api/auth/intervals/url'], (req: Request, res: Response) => {
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
    scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE',
    state: stateToken,
  });

  const authUrl = `https://intervals.icu/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});

intervalsAuthRouter.get(['/api/intervals/auth/login', '/api/auth/intervals/login'], (req: Request, res: Response) => {
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
    scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE',
    state: stateToken,
  });
  res.redirect(302, `https://intervals.icu/oauth/authorize?${params.toString()}`);
});

intervalsAuthRouter.get(
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

intervalsAuthRouter.post('/api/intervals/connect', async (req: Request, res: Response) => {
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

    const profileData = (await profileResp.json()) as RawIntervalsAthleteProfile;
    const resolvedId = String(profileData.id || athleteId);
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
      athleteId: resolvedId,
      athleteName: resolvedName,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect to Intervals.icu',
    });
  }
});

intervalsAuthRouter.post('/api/intervals/disconnect', async (req: Request, res: Response) => {
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
