import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import {
  requestContext,
  runtimeStore,
  getScopedRuntimeStore,
  bindRequestScopeKey,
  isAuthenticatedRequest,
  getVerifiedSessionClaims,
  setSessionCookie,
  issueOAuthStateToken,
  verifyOAuthStateToken,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  getOAuthStateCookieNonce,
  safeJsonForScript,
  escapeHtml,
  saveSessionCache,
  saveSessionCacheAsync,
  loadJsonFile,
  saveJsonFile,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  deleteTenantVault,
  deriveStravaSessionSid,
  resolveSessionScopeKey,
  type RuntimeSessionStore,
} from '../sessionContext.ts';
import { isServerOwnedSecret } from '../secretManager.ts';
import {
  ensureRequestSession,
  ensureRequestSessionSid,
  renderThreshOAuthHtml,
  resolveStravaCallbackUrl,
  resolveValidatedStravaCallbackUrl,
} from '../oauthHelpers.ts';
import {
  appendSetCookieHeader,
  deriveUserSessionSid,
  isCanonicalAuthenticatedClaims,
  resolveSafeOrigin,
  resolveTrustedCorsOrigin,
  timingSafeStringEqual,
} from '../securityUtils.ts';
import { buildClearVaultCookieHeader } from '../tokenVault.ts';
import { buildServerAthleteProfile, isGenericName } from '../physiologyEngine.ts';
import { decodeGooglePolyline } from './activitiesRouter.ts';
import { migrateAnonymousTeamsToStravaSid } from '../teamService.ts';
import {
  connectServiceToUser,
  disconnectServiceFromUser,
  findOrCreateUser,
  getUserByProvider,
  linkProviderToUser,
} from '../authService.ts';
import { extractStravaId, readStravaResponseJson } from '../stravaIdUtils.ts';
import type {
  RawStravaActivity,
  RawStravaAthleteProfile,
  RawStravaCommentApi,
  RawStravaKudoerApi,
  RawStravaSegmentEffort,
  StravaCachedSocialEntry,
} from '../stravaSyncService.ts';
import type {
  StravaKudoer,
  StravaSegmentEffort,
} from '../../src/types.ts';

export interface StoredStravaSyncPolicy {
  window: '90d' | '180d' | '365d' | 'all' | 'none';
  importProfileAndGear: boolean;
  confirmedAt: string;
  grantedScope?: string;
}

export function getEffectiveStravaClientConfig(req?: Request) {
  const activeReq = req ?? requestContext.getStore();
  const allowEnvTokenFallback =
    process.env.ALLOW_DEV_ENV_CREDENTIALS === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    !process.env.VERCEL;
  const headerClientId = activeReq?.headers['x-strava-client-id'] as string | undefined;
  const headerClientSecret = activeReq?.headers['x-strava-client-secret'] as string | undefined;
  const headerRefreshToken = activeReq?.headers['x-strava-refresh-token'] as string | undefined;
  const headerAccessToken = activeReq?.headers['x-strava-access-token'] as string | undefined;
  const headerExpiresAt = Number(activeReq?.headers['x-strava-expires-at'] || 0);

  const envClientId = (process.env.STRAVA_CLIENT_ID || '').trim();
  const envClientSecret = (process.env.STRAVA_CLIENT_SECRET || '').trim();
  const cleanHeaderId = (headerClientId || '').trim();
  const cleanHeaderSecret = (headerClientSecret || '').trim();
  const cleanStoreId = (runtimeStore.stravaClientId || '').trim();
  const cleanStoreSecret = (runtimeStore.stravaClientSecret || '').trim();
  const hasByoHeaderPair = Boolean(cleanHeaderId && cleanHeaderSecret);
  const hasByoStorePair = Boolean(
    cleanStoreId && cleanStoreSecret && !isServerOwnedSecret(cleanStoreSecret)
  );

  // Only allow user-supplied clientId overrides when paired with a BYO clientSecret;
  // prevents a stale localStorage aeropulse_strava_client_id from overriding server STRAVA_CLIENT_ID.
  const clientId = hasByoHeaderPair
    ? cleanHeaderId
    : hasByoStorePair
      ? cleanStoreId
      : envClientId || cleanHeaderId || cleanStoreId;
  const clientSecret = hasByoHeaderPair
    ? cleanHeaderSecret
    : hasByoStorePair
      ? cleanStoreSecret
      : envClientSecret || cleanHeaderSecret || cleanStoreSecret;
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return {
      clientId,
      clientSecret,
      refreshToken: '',
      accessToken: '',
      expiresAt: 0,
    };
  }
  // Prefer server vault tokens whenever present & as fresh or fresher than legacy client headers
  // so rotated single-use Strava refresh tokens are never overwritten by stale client headers.
  const storeIsFresherOrPresent =
    Boolean(runtimeStore.stravaRefreshToken || runtimeStore.stravaAccessToken) &&
    (runtimeStore.stravaExpiresAt || 0) >= headerExpiresAt;

  const refreshToken = (
    (storeIsFresherOrPresent
      ? runtimeStore.stravaRefreshToken || headerRefreshToken
      : headerRefreshToken || runtimeStore.stravaRefreshToken) ||
    (allowEnvTokenFallback ? process.env.STRAVA_REFRESH_TOKEN : '') ||
    ''
  ).trim();
  const accessToken = (
    (storeIsFresherOrPresent
      ? runtimeStore.stravaAccessToken || headerAccessToken
      : headerAccessToken || runtimeStore.stravaAccessToken) ||
    (allowEnvTokenFallback ? process.env.STRAVA_ACCESS_TOKEN : '') ||
    ''
  ).trim();
  const expiresAt = Math.max(headerExpiresAt || 0, runtimeStore.stravaExpiresAt || 0);
  return { clientId, clientSecret, refreshToken, accessToken, expiresAt };
}

export interface CachedStravaIdentity {
  athleteId: string;
  athleteName: string;
  ftp?: number;
  weightKg?: number;
  measurementPreference?: 'mi' | 'km';
}

export const stravaIdentityByToken = new Map<string, CachedStravaIdentity>();

export function getStravaTokenRotationPayload(req?: Request) {
  if (req && !isAuthenticatedRequest(req)) {
    return undefined;
  }
  const { clientId, refreshToken, accessToken, expiresAt } =
    getEffectiveStravaClientConfig(req);
  if (!refreshToken && !accessToken) {
    return undefined;
  }
  const cached =
    (refreshToken ? stravaIdentityByToken.get(refreshToken) : undefined) ||
    (accessToken ? stravaIdentityByToken.get(accessToken) : undefined);
  return {
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
    expiresAt: expiresAt || undefined,
    clientId: clientId || undefined,
    athleteId: cached?.athleteId || undefined,
    athleteName: cached?.athleteName || undefined,
  };
}

export async function ensureValidStravaAccessToken(req?: Request, forceRefresh = false): Promise<string> {
  const { clientId, clientSecret, refreshToken, accessToken, expiresAt } =
    getEffectiveStravaClientConfig(req);
  if (!accessToken && !refreshToken) {
    return '';
  }
  if (clientId && !runtimeStore.stravaClientId) runtimeStore.stravaClientId = clientId;
  if (clientSecret && !runtimeStore.stravaClientSecret && !isServerOwnedSecret(clientSecret))
    runtimeStore.stravaClientSecret = clientSecret;

  let activeAccessToken = accessToken;
  let activeRefreshToken = refreshToken;
  let activeExpiresAt = expiresAt;

  const nowSecs = Math.floor(Date.now() / 1000);
  const isExpired = activeExpiresAt > 0 && nowSecs >= activeExpiresAt - 300;

  if ((!activeAccessToken || isExpired || forceRefresh) && activeRefreshToken) {
    if (!clientId || !clientSecret) {
      if (forceRefresh) return '';
      return activeAccessToken;
    }
    const candidateRefreshTokens: string[] = [];
    if (activeRefreshToken) candidateRefreshTokens.push(activeRefreshToken);
    if (runtimeStore.stravaRefreshToken && !candidateRefreshTokens.includes(runtimeStore.stravaRefreshToken)) {
      candidateRefreshTokens.push(runtimeStore.stravaRefreshToken);
    }
    const headerRefresh = req?.headers['x-strava-refresh-token'] as string | undefined;
    if (headerRefresh && !candidateRefreshTokens.includes(headerRefresh.trim())) {
      candidateRefreshTokens.push(headerRefresh.trim());
    }

    let refreshedSuccessfully = false;
    for (const candidateToken of candidateRefreshTokens) {
      try {
        const refreshResp = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: candidateToken,
          }),
        });
        if (refreshResp.ok) {
          const refreshed = await readStravaResponseJson<{
            access_token: string;
            refresh_token: string;
            expires_at: number;
            athlete?: {
              firstname?: string;
              lastname?: string;
              username?: string;
              id?: number | string;
              id_str?: string;
            };
          }>(refreshResp);
          const prevCached = stravaIdentityByToken.get(candidateToken);
          activeAccessToken = refreshed.access_token;
          activeRefreshToken = refreshed.refresh_token || candidateToken;
          activeExpiresAt = refreshed.expires_at;
          runtimeStore.stravaAccessToken = activeAccessToken;
          runtimeStore.stravaRefreshToken = activeRefreshToken;
          runtimeStore.stravaExpiresAt = activeExpiresAt;
          if (prevCached) {
            stravaIdentityByToken.set(activeRefreshToken, prevCached);
            stravaIdentityByToken.set(activeAccessToken, prevCached);
          }
          if (req) {
            req.headers['x-strava-access-token'] = activeAccessToken;
            req.headers['x-strava-refresh-token'] = activeRefreshToken;
            req.headers['x-strava-expires-at'] = String(activeExpiresAt);
          }
          if (refreshed.athlete) {
            const name =
              [refreshed.athlete.firstname, refreshed.athlete.lastname]
                .filter(Boolean)
                .join(' ')
                .trim() || String(refreshed.athlete.username || '').trim();
            if (name) {
              runtimeStore.stravaAthleteName = name;
              const entry: CachedStravaIdentity = {
                athleteId: extractStravaId(refreshed.athlete),
                athleteName: name,
              };
              stravaIdentityByToken.set(activeRefreshToken, entry);
              stravaIdentityByToken.set(activeAccessToken, entry);
            }
          }
          await saveSessionCacheAsync(req);
          refreshedSuccessfully = true;
          break;
        }
      } catch {
        // try next candidate refresh token
      }
    }

    if (forceRefresh && !refreshedSuccessfully) {
      return '';
    }
  } else if (forceRefresh) {
    return '';
  }
  return activeAccessToken;
}

export async function resolveStravaAthleteIdentity(req?: Request): Promise<CachedStravaIdentity | null> {
  const { refreshToken, accessToken } = getEffectiveStravaClientConfig(req);
  const cacheKey = refreshToken || accessToken;
  if (!cacheKey) return null;
  const cached = stravaIdentityByToken.get(cacheKey);
  if (cached && !isGenericName(cached.athleteName)) {
    return cached;
  }
  try {
    let validToken = await ensureValidStravaAccessToken(req, false);
    if (!validToken) return null;
    let resp = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    if (resp.status === 401 && refreshToken) {
      validToken = await ensureValidStravaAccessToken(req, true);
      if (validToken) {
        resp = await fetch('https://www.strava.com/api/v3/athlete', {
          headers: { Authorization: `Bearer ${validToken}` },
        });
      }
    }
    if (!resp.ok) return null;
    const rawAthlete = await readStravaResponseJson<RawStravaAthleteProfile>(resp);
    const athleteId = extractStravaId(rawAthlete);
    const fullName =
      [rawAthlete.firstname, rawAthlete.lastname].filter(Boolean).join(' ').trim() ||
      String(rawAthlete.username || '').trim();
    if (!fullName) return null;
    const ftp = Number(rawAthlete.ftp) > 80 ? Math.round(Number(rawAthlete.ftp)) : undefined;
    const weightKg = Number(rawAthlete.weight) > 30 ? Number(rawAthlete.weight) : undefined;
    const measurementPreference: 'mi' | 'km' | undefined =
      rawAthlete.measurement_preference === 'meters'
        ? 'km'
        : rawAthlete.measurement_preference === 'feet'
          ? 'mi'
          : undefined;
    const entry: CachedStravaIdentity = {
      athleteId,
      athleteName: fullName,
      ftp,
      weightKg,
      measurementPreference,
    };
    stravaIdentityByToken.set(cacheKey, entry);
    stravaIdentityByToken.set(validToken, entry);
    if (runtimeStore.stravaAccessToken === validToken) {
      if (!runtimeStore.stravaAthleteName || isGenericName(runtimeStore.stravaAthleteName)) {
        runtimeStore.stravaAthleteName = fullName;
      }
      if (!runtimeStore.stravaAthleteId) {
        runtimeStore.stravaAthleteId = athleteId;
      }
      if (measurementPreference && !runtimeStore.stravaMeasurementPreference) {
        runtimeStore.stravaMeasurementPreference = measurementPreference;
      }
      await saveSessionCacheAsync(req);
    }
    return entry;
  } catch {
    return null;
  }
}

export interface PendingStravaOAuthEntry {
  createdAt: number;
  nonce: string;
  sid?: string;
  athleteId?: string;
  athleteName?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  measurementPreference?: 'mi' | 'km';
  grantedScope?: string;
  weightKg?: number;
  ftp?: number;
  hasExistingSyncPolicy?: boolean;
}

export const pendingOAuthByState = new Map<string, PendingStravaOAuthEntry>();

export async function activateStravaCanonicalScope(
  req: Request,
  res: Response,
  opts: {
    athleteId?: string;
    athleteName: string;
    expectedSid?: string;
    expectedUserId?: string;
  }
): Promise<{
  canonicalSid: string;
  scopeKey: string;
  sessionToken: string;
  store: RuntimeSessionStore;
  linkedUserId?: string;
}> {
  const prevClaims = getVerifiedSessionClaims(req);
  const prevStore = getScopedRuntimeStore(req);
  const prevScopeKey = (prevClaims?.sid || opts.expectedSid || '').slice(0, 24);
  const explicitUserId = prevClaims?.sub?.startsWith('usr_')
    ? prevClaims.sub
    : opts.expectedUserId?.startsWith('usr_')
      ? opts.expectedUserId
      : undefined;

  let canonicalUserId: string | undefined = explicitUserId;
  if (!canonicalUserId && opts.athleteId) {
    const existingUser = await getUserByProvider('strava', opts.athleteId);
    if (existingUser && existingUser.authProviders.some((p) => p.provider !== 'strava')) {
      canonicalUserId = existingUser.id;
    }
  }

  let canonicalSid: string;
  let sessionSubject: string;
  if (canonicalUserId) {
    canonicalSid =
      (prevClaims?.sub === canonicalUserId ? prevClaims.sid : undefined) ||
      (opts.expectedUserId === canonicalUserId ? opts.expectedSid : undefined) ||
      deriveUserSessionSid(canonicalUserId);
    sessionSubject = canonicalUserId;
  } else {
    canonicalSid = opts.athleteId
      ? deriveStravaSessionSid(opts.athleteId)
      : prevClaims?.sid || opts.expectedSid || crypto.randomBytes(16).toString('hex');
    sessionSubject = !isGenericName(opts.athleteName) ? opts.athleteName : 'Strava Athlete';
  }

  if (opts.athleteId) {
    if (prevClaims?.sid && prevClaims.sid !== canonicalSid) {
      await migrateAnonymousTeamsToStravaSid({
        oldSid: prevClaims.sid,
        stravaSid: canonicalSid,
        athleteName: !isGenericName(opts.athleteName) ? opts.athleteName : undefined,
        stravaAthleteId: opts.athleteId,
      });
    }
    const legacyStravaSid = deriveStravaSessionSid(opts.athleteId);
    if (legacyStravaSid !== canonicalSid) {
      await migrateAnonymousTeamsToStravaSid({
        oldSid: legacyStravaSid,
        stravaSid: canonicalSid,
        athleteName: !isGenericName(opts.athleteName) ? opts.athleteName : undefined,
        stravaAthleteId: opts.athleteId,
      });
    }
  }

  const scopeKey = canonicalSid.slice(0, 24);
  await loadTenantVaultAsync(`session_${scopeKey}`, {});
  bindRequestScopeKey(req, canonicalSid);

  const sessionToken = setSessionCookie(req, res, sessionSubject, canonicalSid, 'verified');
  const store = getScopedRuntimeStore(req);

  // Preserve pre-OAuth credentials and previously linked Garmin/Intervals/Wahoo/Polar tokens
  if (!store.stravaClientId && prevStore.stravaClientId) {
    store.stravaClientId = prevStore.stravaClientId;
  }
  if (!store.stravaClientSecret && prevStore.stravaClientSecret) {
    store.stravaClientSecret = prevStore.stravaClientSecret;
  }
  if (!store.intervalsApiKey && prevStore.intervalsApiKey) {
    store.intervalsApiKey = prevStore.intervalsApiKey;
    store.intervalsAthleteId = prevStore.intervalsAthleteId || '0';
    store.intervalsAthleteName = prevStore.intervalsAthleteName || '';
  }
  if (!store.intervalsAccessToken && prevStore.intervalsAccessToken) {
    store.intervalsAccessToken = prevStore.intervalsAccessToken;
    store.intervalsScope = prevStore.intervalsScope;
    store.intervalsAthleteId = prevStore.intervalsAthleteId || store.intervalsAthleteId || '0';
    store.intervalsAthleteName = prevStore.intervalsAthleteName || store.intervalsAthleteName || '';
  }
  if (!store.wahooAccessToken && prevStore.wahooAccessToken) {
    store.wahooAccessToken = prevStore.wahooAccessToken;
    store.wahooRefreshToken = prevStore.wahooRefreshToken;
    store.wahooExpiresAt = prevStore.wahooExpiresAt;
    store.wahooScope = prevStore.wahooScope;
    store.wahooUserId = prevStore.wahooUserId;
    store.wahooAthleteName = prevStore.wahooAthleteName;
  }
  if (!store.polarAccessToken && prevStore.polarAccessToken) {
    store.polarAccessToken = prevStore.polarAccessToken;
    store.polarUserId = prevStore.polarUserId;
    store.polarAthleteName = prevStore.polarAthleteName;
    store.polarExpiresAt = prevStore.polarExpiresAt;
    store.polarScope = prevStore.polarScope;
  }
  if (!store.stravaSyncPolicy && prevStore.stravaSyncPolicy) {
    store.stravaSyncPolicy = prevStore.stravaSyncPolicy;
  }

  if (prevScopeKey && prevScopeKey !== scopeKey) {
    const existingGarmin = await loadTenantVaultAsync<Record<string, unknown> | null>(
      `garmin_${prevScopeKey}`,
      null
    );
    if (existingGarmin) {
      await saveTenantVaultAsync(`garmin_${scopeKey}`, existingGarmin);
    }
  }

  if (canonicalUserId && opts.athleteId) {
    try {
      const cleanName = !isGenericName(opts.athleteName) ? opts.athleteName : undefined;
      await linkProviderToUser(canonicalUserId, 'strava', opts.athleteId, { name: cleanName });
      await connectServiceToUser(canonicalUserId, 'strava', opts.athleteId, cleanName);
    } catch (err) {
      console.warn('[MeetReady Auth] Linking Strava to existing ThreshUser warning:', err);
    }
  }

  return { canonicalSid, scopeKey, sessionToken, store, linkedUserId: canonicalUserId };
}

export function buildReturnOnboardingUrl(
  verifiedState: ReturnType<typeof verifyOAuthStateToken>,
  extraParams: Record<string, string> = {}
): string {
  const basePath = verifiedState?.slug
    ? `/join/${encodeURIComponent(verifiedState.slug)}`
    : '/';
  const params = new URLSearchParams();
  if (verifiedState?.joinCode && !verifiedState?.slug) {
    params.set('join', verifiedState.joinCode);
  }
  if (verifiedState?.inviteToken) {
    params.set('t', verifiedState.inviteToken);
  }
  for (const [k, v] of Object.entries(extraParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function exchangeStravaAuthCode(codeInput: string, req?: Request) {
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

  const tokenData = await readStravaResponseJson<{
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: {
      id?: number | string;
      id_str?: string;
      username?: string;
      firstname?: string;
      lastname?: string;
      weight?: number;
      ftp?: number;
      measurement_preference?: string;
    };
  }>(tokenResp);

  return tokenData;
}

function buildStravaCallbackScript(opts: {
  serializedPayload: string;
  preScript?: string;
  redirectOnNonPopup?: boolean;
}): string {
  return `(function(){
    var payload = ${opts.serializedPayload};
    ${opts.preScript || ''}
    var hasOpener = false;
    try {
      if (window.opener && window.opener !== window) {
        hasOpener = true;
        window.opener.postMessage(payload, window.location.origin);
        if (payload.openerOrigin && payload.openerOrigin !== window.location.origin) {
          window.opener.postMessage(payload, payload.openerOrigin);
        }
      }
    } catch (e) {}
    ${
      opts.redirectOnNonPopup
        ? `if (hasOpener && payload.openerOrigin === 'https://aeropulse-eta.vercel.app' && window.location.origin !== 'https://aeropulse-eta.vercel.app') {
      try { window.opener.location.href = window.location.origin + (payload.returnUrl || '/'); } catch (e) {}
    }`
        : ''
    }
    try {
      var bc = new BroadcastChannel('aeropulse_oauth');
      bc.postMessage(payload);
    } catch (e) {}
    try {
      localStorage.setItem('aeropulse_oauth_result_v1', JSON.stringify({ ts: Date.now(), payload: payload }));
    } catch (e) {}
    var isPopupWindow = Boolean(payload.isPopupFlow) || hasOpener || window.name === 'strava_oauth_popup';
    if (isPopupWindow) {
      setTimeout(function() { try { window.close(); } catch (e) {} }, 250);
    }${
      opts.redirectOnNonPopup
        ? ` else {
      window.location.replace(payload.returnUrl || '/');
    }`
        : ''
    }
  })();`;
}

export const stravaCallbackHandler = async (req: Request, res: Response) => {
  const oauthState = String(req.query.state || '').trim();
  const verifiedState = oauthState ? verifyOAuthStateToken(oauthState) : null;
  const isPopupFlow = verifiedState?.flow === 'popup';
  const trustedOpenerOrigin = resolveTrustedCorsOrigin(verifiedState?.origin) || undefined;

  try {
    const oauthErr = req.query.error as string | undefined;
    if (oauthErr) {
      clearOAuthStateCookie(res);
      const isCancelled = oauthErr === 'access_denied';
      const friendlyErr = isCancelled
        ? 'Strava sign-in was cancelled. Ready whenever you want to continue.'
        : `Strava authorization failed: ${oauthErr}`;
      const returnHref = buildReturnOnboardingUrl(verifiedState, {
        auth_error: friendlyErr,
      });
      const cancelJson = safeJsonForScript({
        type: 'OAUTH_AUTH_ERROR',
        provider: 'strava',
        cancelled: isCancelled,
        error: friendlyErr,
        isPopupFlow,
        openerOrigin: trustedOpenerOrigin,
      });
      res
        .status(isCancelled ? 200 : 400)
        .type('html')
        .send(
          renderThreshOAuthHtml({
            title: isCancelled ? 'Strava Sign-In Cancelled' : 'Strava Authorization Error',
            heading: isCancelled ? 'Strava Sign-In Cancelled' : 'Strava Authorization Declined',
            accentColor: isCancelled ? '#FBBF24' : '#FB7185',
            body: escapeHtml(friendlyErr),
            ctaLabel: 'Return to MeetReady',
            ctaHref: returnHref,
            ctaOnClick:
              "if (window.opener || window.name === 'strava_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
            scriptBody: buildStravaCallbackScript({ serializedPayload: cancelJson }),
          })
        );
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      clearOAuthStateCookie(res);
      res
        .status(400)
        .type('html')
        .send(
          renderThreshOAuthHtml({
            title: 'Strava Connection Incomplete',
            heading: 'Missing Strava Code',
            accentColor: '#FB7185',
            body: 'No authorization code was returned by Strava. Please try connecting again.',
            ctaLabel: 'Return to MeetReady',
            ctaHref: buildReturnOnboardingUrl(verifiedState),
          })
        );
      return;
    }

    const cookieNonce = getOAuthStateCookieNonce(req);
    const scopeParam = String(req.query.scope || '').trim();

    if (
      !verifiedState ||
      !cookieNonce ||
      !timingSafeStringEqual(cookieNonce, verifiedState.nonce)
    ) {
      clearOAuthStateCookie(res);
      res
        .status(400)
        .type('html')
        .send(
          renderThreshOAuthHtml({
            title: 'Security Verification Failed',
            heading: 'Invalid OAuth State',
            accentColor: '#FB7185',
            body: !verifiedState
              ? 'The security verification token has expired or is invalid. Please return and initiate connection again.'
              : 'The browser OAuth state cookie is missing or does not match. Please return and initiate connection again.',
            ctaLabel: 'Return to MeetReady',
            ctaHref: '/',
          })
        );
      return;
    }

    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        'Strava Client ID and Secret are missing on this server. Configure them in Vercel or local .env.'
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

    const tokenData = await readStravaResponseJson<{
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: {
        id?: number | string;
        id_str?: string;
        username?: string;
        firstname?: string;
        lastname?: string;
        weight?: number;
        ftp?: number;
        measurement_preference?: string;
      };
    }>(tokenResp);

    let athleteName =
      [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ').trim() ||
      tokenData.athlete?.username?.trim() ||
      '';
    let athleteId = extractStravaId(tokenData.athlete) || undefined;
    let weightKg =
      typeof tokenData.athlete?.weight === 'number' && tokenData.athlete.weight > 30
        ? Number(tokenData.athlete.weight.toFixed(1))
        : undefined;
    let ftp =
      typeof tokenData.athlete?.ftp === 'number' && tokenData.athlete.ftp > 80
        ? Math.round(tokenData.athlete.ftp)
        : undefined;
    let measurementPreference: 'mi' | 'km' | undefined =
      tokenData.athlete?.measurement_preference === 'meters'
        ? 'km'
        : tokenData.athlete?.measurement_preference === 'feet'
          ? 'mi'
          : undefined;

    // Fetch /api/v3/athlete if full profile fields (name, weight, FTP, or unit pref) were not populated
    if (
      !athleteName ||
      isGenericName(athleteName) ||
      !weightKg ||
      !ftp ||
      !measurementPreference
    ) {
      try {
        const athResp = await fetch('https://www.strava.com/api/v3/athlete', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (athResp.ok) {
          const rawAth = await readStravaResponseJson<RawStravaAthleteProfile>(athResp);
          const enrichedName =
            [rawAth.firstname, rawAth.lastname].filter(Boolean).join(' ').trim() ||
            String(rawAth.username || '').trim();
          if (enrichedName && (!athleteName || isGenericName(athleteName))) {
            athleteName = enrichedName;
          }
          const fetchedAthId = extractStravaId(rawAth);
          if (!athleteId && fetchedAthId) athleteId = fetchedAthId;
          if (!weightKg && Number(rawAth.weight) > 30) {
            weightKg = Number(Number(rawAth.weight).toFixed(1));
          }
          if (!ftp && Number(rawAth.ftp) > 80) {
            ftp = Math.round(Number(rawAth.ftp));
          }
          if (!measurementPreference) {
            if (rawAth.measurement_preference === 'meters') measurementPreference = 'km';
            else if (rawAth.measurement_preference === 'feet') measurementPreference = 'mi';
          }
        }
      } catch {
        // Non-fatal, use tokenData fields
      }
    }

    if (!athleteName) athleteName = 'Strava Athlete';

    // Canonical athlete session activation & scope binding
    const { canonicalSid, sessionToken, store, linkedUserId } =
      await activateStravaCanonicalScope(req, res, {
        athleteId,
        athleteName,
        expectedSid: verifiedState?.sid,
        expectedUserId: verifiedState?.userId,
      });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);

    store.stravaAccessToken = tokenData.access_token;
    store.stravaRefreshToken = tokenData.refresh_token;
    store.stravaExpiresAt = tokenData.expires_at;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (scopeParam) store.stravaGrantedScope = scopeParam;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;

    // Cache identity by token so background sync & webhook lookups find it instantly
    if (athleteId) {
      const identityEntry: CachedStravaIdentity = {
        athleteId,
        athleteName,
        ftp,
        weightKg,
        measurementPreference,
      };
      stravaIdentityByToken.set(tokenData.access_token, identityEntry);
      stravaIdentityByToken.set(tokenData.refresh_token, identityEntry);
    }

    // AUTH-01: Auto-link/migrate into unified MeetReady accounts directory if not already linked to canonical usr_
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser('strava', athleteId, {
          name: !isGenericName(athleteName) ? athleteName : undefined,
        });
      } catch (err) {
        console.warn('[MeetReady Auth] Auto-migration of Strava athlete to MeetReady accounts skipped:', err);
      }
    }

    await saveSessionCacheAsync(req, res, canonicalSid);

    const pendingPayload: PendingStravaOAuthEntry = {
      createdAt: Date.now(),
      nonce: verifiedState.nonce,
      sid: canonicalSid,
      athleteId,
      athleteName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      clientId,
      measurementPreference,
      grantedScope: scopeParam,
      weightKg,
      ftp,
      hasExistingSyncPolicy,
    };
    pendingOAuthByState.set(verifiedState.nonce, pendingPayload);
    if (verifiedState?.nonce) {
      await saveTenantVaultAsync(`oauth_poll_${verifiedState.nonce}`, pendingPayload);
    }

    clearOAuthStateCookie(res);

    const hasPendingTeamJoin = Boolean(verifiedState?.slug || verifiedState?.joinCode);
    const onboardingUrl = buildReturnOnboardingUrl(verifiedState, {
      oauth: 'strava_connected',
      oauth_just_connected: '1',
      ...(athleteId ? { strava_athlete_id: athleteId } : {}),
      ...(athleteName && !isGenericName(athleteName) ? { strava_athlete_name: athleteName } : {}),
    });
    const returnUrl = !hasPendingTeamJoin ? '/#fitness' : onboardingUrl;

    const oauthSuccessPayload = safeJsonForScript({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'strava',
      athleteId,
      athleteName,
      sessionToken,
      hasExistingSyncPolicy,
      hasPendingTeamJoin,
      measurementPreference,
      grantedScope: scopeParam,
      returnUrl,
      isPopupFlow,
      openerOrigin: trustedOpenerOrigin,
      tokens: {
        expiresAt: tokenData.expires_at,
        clientId,
        athleteId,
        athleteName,
        weightKg,
        ftp,
        measurementPreference,
        grantedScope: scopeParam,
      },
    });

    const successHydrationScript = `try {
      if (payload.sessionToken) localStorage.setItem('aeropulse_session_token', payload.sessionToken);
      if (payload.tokens) {
        var prevAthleteId = localStorage.getItem('aeropulse_strava_athlete_id');
        if (prevAthleteId && payload.tokens.athleteId && String(payload.tokens.athleteId) !== prevAthleteId) {
          localStorage.removeItem('aeropulse_strava_athlete_name');
          localStorage.removeItem('aeropulse_auth_gate_passed');
          localStorage.removeItem('aeropulse_strava_sync_policy');
        }
        if (payload.tokens.expiresAt) localStorage.setItem('aeropulse_strava_expires_at', String(payload.tokens.expiresAt));
        if (payload.tokens.clientId) localStorage.setItem('aeropulse_strava_client_id', payload.tokens.clientId);
        if (payload.tokens.athleteId) localStorage.setItem('aeropulse_strava_athlete_id', String(payload.tokens.athleteId));
        if (payload.tokens.athleteName) localStorage.setItem('aeropulse_strava_athlete_name', payload.tokens.athleteName);
        if (payload.tokens.weightKg) localStorage.setItem('aeropulse_strava_athlete_weight_kg', String(payload.tokens.weightKg));
        if (payload.tokens.ftp) localStorage.setItem('aeropulse_strava_athlete_ftp', String(payload.tokens.ftp));
        if (payload.tokens.measurementPreference) localStorage.setItem('aeropulse_strava_measurement_pref', payload.tokens.measurementPreference);
        if (payload.tokens.grantedScope) localStorage.setItem('aeropulse_strava_granted_scope', payload.tokens.grantedScope);
        localStorage.removeItem('aeropulse_logged_out');
        var sameAthlete = !prevAthleteId || !payload.tokens.athleteId || String(payload.tokens.athleteId) === prevAthleteId;
        var hasLocalSyncPolicy = false;
        try { hasLocalSyncPolicy = Boolean(localStorage.getItem('aeropulse_strava_sync_policy')); } catch (e) {}
        if (!payload.hasPendingTeamJoin) {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
          if (!sameAthlete || !hasLocalSyncPolicy) {
            try {
              var granted = payload.tokens.grantedScope ? String(payload.tokens.grantedScope) : '';
              var hasActivityScope = !granted || granted.indexOf('activity:read') !== -1;
              localStorage.setItem('aeropulse_strava_sync_policy', JSON.stringify({
                window: hasActivityScope ? '90d' : 'none',
                importProfileAndGear: true,
                confirmedAt: new Date().toISOString(),
                grantedScope: granted || undefined
              }));
            } catch (e) {}
          }
        } else if (payload.hasExistingSyncPolicy || (sameAthlete && hasLocalSyncPolicy)) {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } else if (!sameAthlete) {
          localStorage.removeItem('aeropulse_auth_gate_passed');
        }
      } else {
        if (payload.athleteId) localStorage.setItem('aeropulse_strava_athlete_id', String(payload.athleteId));
        if (payload.athleteName) localStorage.setItem('aeropulse_strava_athlete_name', payload.athleteName);
        localStorage.removeItem('aeropulse_logged_out');
      }
      localStorage.setItem('aeropulse_oauth_just_connected', '1');
    } catch (e) {}`;

    res
      .status(200)
      .type('html')
      .send(
        renderThreshOAuthHtml({
          title: 'Strava Connected · MeetReady',
          heading: `Strava Connected${athleteName && !isGenericName(athleteName) ? ` · ${escapeHtml(athleteName)}` : ''}`,
          accentColor: '#10B981',
          body: !hasPendingTeamJoin
            ? 'Strava connected! Opening your MeetReady training workspace…'
            : 'Your Strava account is linked. Return to MeetReady to complete your team roster setup.',
          ctaLabel: 'Continue to MeetReady',
          ctaHref: returnUrl,
          scriptBody: buildStravaCallbackScript({
            serializedPayload: oauthSuccessPayload,
            preScript: successHydrationScript,
            redirectOnNonPopup: true,
          }),
        })
      );
  } catch (error) {
    clearOAuthStateCookie(res);
    const friendlyErr =
      error instanceof Error ? error.message : 'Unknown Strava OAuth authorization failure';
    const errJson = safeJsonForScript({
      type: 'OAUTH_AUTH_ERROR',
      provider: 'strava',
      error: friendlyErr,
      isPopupFlow,
      openerOrigin: trustedOpenerOrigin,
    });
    res
      .status(500)
      .type('html')
      .send(
        renderThreshOAuthHtml({
          title: 'Strava Connection Error',
          heading: 'Strava Connection Failed',
          accentColor: '#FB7185',
          body: escapeHtml(friendlyErr),
          ctaLabel: 'Return to MeetReady',
          ctaHref: buildReturnOnboardingUrl(verifiedState, { auth_error: friendlyErr }),
          ctaOnClick:
            "if (window.opener || window.name === 'strava_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
          scriptBody: buildStravaCallbackScript({ serializedPayload: errJson }),
        })
      );
  }
};

import { syncStravaAllHistory } from '../stravaSyncService.ts';
export { syncStravaAllHistory };

export const stravaRouter = express.Router();

stravaRouter.post('/api/strava/credentials', async (req: Request, res: Response) => {
  const clientId = (req.body?.clientId || '').trim();
  const clientSecret = (req.body?.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'Both Strava Client ID and Client Secret are required.' });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  runtimeStore.stravaClientId = clientId;
  runtimeStore.stravaClientSecret = clientSecret;
  await saveSessionCacheAsync(req, res, sid);
  res.json({ saved: true, clientId });
});

async function buildStravaAuthorizeRequest(req: Request, res: Response, clientId: string) {
  const { sid, sessionToken } = ensureRequestSession(req, res);
  const mode = String(req.query.mode || 'cloud').toLowerCase();
  const flow = String(req.query.flow || 'redirect').toLowerCase() === 'popup' ? 'popup' : 'redirect';
  const prompt = String(req.query.prompt || 'auto').toLowerCase() === 'force' ? 'force' : 'auto';
  const callerOrigin = resolveSafeOrigin(req.query.origin as string | undefined) || undefined;
  const clientNonce = String(req.query.state || '').trim();
  const joinCode = String(req.query.joinCode || req.query.join || '').trim().slice(0, 32) || undefined;
  const slug = String(req.query.slug || '').trim().slice(0, 64) || undefined;
  const inviteToken =
    String(req.query.inviteToken || req.query.t || '').trim().slice(0, 96) || undefined;

  const callerClaims = getVerifiedSessionClaims(req);
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || undefined,
    sid,
    flow,
    mode,
    origin: callerOrigin,
    joinCode,
    slug,
    inviteToken,
    userId: callerClaims?.sub?.startsWith('usr_') ? callerClaims.sub : undefined,
  });
  setOAuthStateCookie(req, res, nonce);

  const redirectUri =
    mode === 'localhost'
      ? 'http://localhost/exchange_token'
      : await resolveValidatedStravaCallbackUrl(req, clientId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: prompt,
    scope: 'read,activity:read_all,profile:read_all',
    state: stateToken,
  });

  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  return { authUrl, redirectUri, stateToken, sessionToken };
}

stravaRouter.get(
  ['/api/strava/auth/url', '/api/auth/strava/url'],
  async (req: Request, res: Response) => {
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      res.status(400).json({
        error:
          'Strava OAuth is not configured on this server yet. Please set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in your Vercel Environment Variables (or local .env).',
      });
      return;
    }

    const { authUrl, redirectUri, stateToken, sessionToken } = await buildStravaAuthorizeRequest(
      req,
      res,
      clientId
    );
    res.json({ url: authUrl, redirectUri, clientId, state: stateToken, sessionToken });
  }
);

stravaRouter.get(
  ['/api/strava/auth/login', '/api/auth/strava/login'],
  async (req: Request, res: Response) => {
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      const msg = encodeURIComponent(
        'Strava OAuth is not configured on this server yet (missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET).'
      );
      res.redirect(302, `/?auth_error=${msg}`);
      return;
    }

    const { authUrl } = await buildStravaAuthorizeRequest(req, res, clientId);
    res.redirect(302, authUrl);
  }
);

stravaRouter.get('/api/strava/auth/poll', async (req: Request, res: Response) => {
  const state = String(req.query.state || '').trim();
  const verifiedState = verifyOAuthStateToken(state);
  const rawNonce = /^[a-f0-9_-]{12,64}$/i.test(state) ? state : '';
  const lookupNonce = verifiedState?.nonce || rawNonce;
  if (!lookupNonce) {
    res.json({ completed: false });
    return;
  }

  const now = Date.now();
  for (const [k, v] of pendingOAuthByState.entries()) {
    if (now - v.createdAt > 180 * 1000) {
      pendingOAuthByState.delete(k);
    }
  }

  let found: PendingStravaOAuthEntry | null | undefined = pendingOAuthByState.get(lookupNonce);
  if (!found) {
    found = await loadTenantVaultAsync<PendingStravaOAuthEntry | null>(
      `oauth_poll_${lookupNonce}`,
      null
    );
  }
  if (!found || now - found.createdAt > 180 * 1000) {
    res.json({ completed: false });
    return;
  }

  const callerClaims = getVerifiedSessionClaims(req);
  const cookieNonce = getOAuthStateCookieNonce(req);
  const canonicalSidForFound = found.athleteId
    ? deriveStravaSessionSid(found.athleteId)
    : undefined;
  const cookieMatchesVerified = Boolean(
    cookieNonce &&
      ((verifiedState?.nonce && timingSafeStringEqual(cookieNonce, verifiedState.nonce)) ||
        (lookupNonce && timingSafeStringEqual(cookieNonce, lookupNonce)))
  );
  const callerMatchesSid = Boolean(
    callerClaims?.sid &&
      ((verifiedState?.sid && callerClaims.sid === verifiedState.sid) ||
        (found.sid && callerClaims.sid === found.sid) ||
        (canonicalSidForFound && callerClaims.sid === canonicalSidForFound))
  );
  const authorizedCaller = cookieMatchesVerified || callerMatchesSid;
  if (!authorizedCaller) {
    res.json({ completed: false });
    return;
  }

  pendingOAuthByState.delete(lookupNonce);
  await deleteTenantVault(`oauth_poll_${lookupNonce}`);
  clearOAuthStateCookie(res);

  const { canonicalSid, sessionToken, store } = await activateStravaCanonicalScope(req, res, {
    athleteId: found.athleteId,
    athleteName: found.athleteName || 'Strava Athlete',
  });
  if (found.accessToken) store.stravaAccessToken = found.accessToken;
  if (found.refreshToken) store.stravaRefreshToken = found.refreshToken;
  if (found.expiresAt) store.stravaExpiresAt = found.expiresAt;
  if (found.clientId) store.stravaClientId = found.clientId;
  if (found.athleteId) store.stravaAthleteId = found.athleteId;
  if (found.athleteName && !isGenericName(found.athleteName)) {
    store.stravaAthleteName = found.athleteName;
  }
  if (found.measurementPreference) {
    store.stravaMeasurementPreference = found.measurementPreference;
  }
  if (found.grantedScope) {
    store.stravaGrantedScope = found.grantedScope;
  }
  await saveSessionCacheAsync(req, res, canonicalSid);

  res.json({
    completed: true,
    hasExistingSyncPolicy: Boolean(
      found.hasExistingSyncPolicy || store.stravaSyncPolicy?.confirmedAt
    ),
    sessionToken,
    athleteId: found.athleteId,
    athleteName: found.athleteName,
    measurementPreference: found.measurementPreference,
    grantedScope: found.grantedScope,
    tokens: {
      expiresAt: found.expiresAt,
      clientId: found.clientId,
      athleteId: found.athleteId,
      athleteName: found.athleteName,
      weightKg: found.weightKg,
      ftp: found.ftp,
      measurementPreference: found.measurementPreference,
      grantedScope: found.grantedScope,
    },
  });
});

stravaRouter.post('/api/strava/exchange-code', async (req: Request, res: Response) => {
  try {
    const codeOrUrl = String(req.body?.code || req.body?.url || '').trim();
    const tokenData = await exchangeStravaAuthCode(codeOrUrl, req);
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    const athleteName =
      [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(' ').trim() ||
      tokenData.athlete?.username?.trim() ||
      'Strava Athlete';
    const athleteId = extractStravaId(tokenData.athlete) || undefined;
    const weightKg =
      typeof tokenData.athlete?.weight === 'number' && tokenData.athlete.weight > 30
        ? Number(tokenData.athlete.weight.toFixed(1))
        : undefined;
    const ftp =
      typeof tokenData.athlete?.ftp === 'number' && tokenData.athlete.ftp > 80
        ? Math.round(tokenData.athlete.ftp)
        : undefined;
    const measurementPreference: 'mi' | 'km' | undefined =
      tokenData.athlete?.measurement_preference === 'meters'
        ? 'km'
        : tokenData.athlete?.measurement_preference === 'feet'
          ? 'mi'
          : undefined;

    const { canonicalSid, sessionToken, store, linkedUserId } =
      await activateStravaCanonicalScope(req, res, {
        athleteId,
        athleteName,
      });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);

    store.stravaAccessToken = tokenData.access_token;
    store.stravaRefreshToken = tokenData.refresh_token;
    store.stravaExpiresAt = tokenData.expires_at;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;

    // AUTH-01: Auto-link/migrate into unified MeetReady accounts directory if not already linked to canonical usr_
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser('strava', athleteId, {
          name: !isGenericName(athleteName) ? athleteName : undefined,
        });
      } catch (err) {
        console.warn('[MeetReady Auth] Auto-migration of Strava athlete to MeetReady accounts skipped:', err);
      }
    }
    await saveSessionCacheAsync(req, res, canonicalSid);

    res.json({
      connected: true,
      hasExistingSyncPolicy,
      sessionToken,
      athleteId,
      athleteName,
      weightKg,
      ftp,
      measurementPreference,
      expiresAt: tokenData.expires_at,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      clientId: clientId || undefined,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to exchange Strava authorization code',
    });
  }
});

stravaRouter.post('/api/strava/token', async (req: Request, res: Response) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    const allowIdentityOnly = Boolean(req.body?.allowIdentityOnly);
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);

    if (!refreshToken && !accessToken) {
      res
        .status(400)
        .json({ error: 'Provide either a Strava Refresh Token or Access Token.' });
      return;
    }

    let resolvedAccessToken = accessToken;
    let resolvedRefreshToken = refreshToken;
    let resolvedExpiresAt = Math.floor(Date.now() / 1000) + 21600;

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
        const refreshed = await readStravaResponseJson<{
          access_token: string;
          refresh_token: string;
          expires_at: number;
        }>(refreshResp);
        resolvedAccessToken = refreshed.access_token;
        resolvedRefreshToken = refreshed.refresh_token || refreshToken;
        resolvedExpiresAt = refreshed.expires_at;
      } else if (!accessToken) {
        const errText = await refreshResp.text();
        res.status(400).json({ error: `Strava token refresh failed: ${errText}` });
        return;
      }
    } else if (!accessToken) {
      res.status(400).json({
        error:
          'Save your Strava Client ID & Secret first to use a Refresh Token, or also provide an Access Token.',
      });
      return;
    }

    // Verify token against Strava athlete profile AND activity:read permission
    const [athleteResp, actCheckResp] = await Promise.all([
      fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: `Bearer ${resolvedAccessToken}` },
      }),
      fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1', {
        headers: { Authorization: `Bearer ${resolvedAccessToken}` },
      }),
    ]);

    let grantedScope = 'read,activity:read_all,profile:read_all';
    if (!actCheckResp.ok) {
      const errBody = await actCheckResp.text();
      if (errBody.includes('activity:read_permission')) {
        if (!allowIdentityOnly) {
          res.status(400).json({
            error:
              "Strava's default API settings token only has profile 'read' scope (missing 'activity:read_all'). Please sign in via Strava OAuth to grant activity read permission.",
          });
          return;
        }
        grantedScope = 'read';
      }
    }

    let athleteName = 'Strava Athlete';
    let athleteId: string | undefined;
    let weightKg: number | undefined;
    let ftp: number | undefined;
    let measurementPreference: 'mi' | 'km' | undefined;
    if (athleteResp.ok) {
      const athlete = await readStravaResponseJson<{
        id?: number | string;
        id_str?: string;
        username?: string;
        firstname?: string;
        lastname?: string;
        weight?: number;
        ftp?: number;
        measurement_preference?: string;
      }>(athleteResp);
      athleteName =
        [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').trim() ||
        athlete.username?.trim() ||
        'Strava Athlete';
      const fetchedAthId = extractStravaId(athlete);
      if (fetchedAthId) athleteId = fetchedAthId;
      if (typeof athlete.weight === 'number' && athlete.weight > 30) {
        weightKg = Number(athlete.weight.toFixed(1));
      }
      if (typeof athlete.ftp === 'number' && athlete.ftp > 80) {
        ftp = Math.round(athlete.ftp);
      }
      if (athlete.measurement_preference === 'meters') measurementPreference = 'km';
      else if (athlete.measurement_preference === 'feet') measurementPreference = 'mi';
    }

    const { canonicalSid, sessionToken, store, linkedUserId } =
      await activateStravaCanonicalScope(req, res, {
        athleteId,
        athleteName,
      });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);

    store.stravaAccessToken = resolvedAccessToken;
    store.stravaRefreshToken = resolvedRefreshToken;
    store.stravaExpiresAt = resolvedExpiresAt;
    store.stravaGrantedScope = grantedScope;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;

    // AUTH-01: Auto-link/migrate into unified MeetReady accounts directory if not already linked to canonical usr_
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser('strava', athleteId, {
          name: !isGenericName(athleteName) ? athleteName : undefined,
        });
      } catch (err) {
        console.warn('[MeetReady Auth] Auto-migration of Strava athlete to MeetReady accounts skipped:', err);
      }
    }
    await saveSessionCacheAsync(req, res, canonicalSid);

    res.json({
      connected: true,
      hasExistingSyncPolicy,
      sessionToken,
      athleteId,
      athleteName,
      weightKg,
      ftp,
      measurementPreference,
      grantedScope,
      accessToken: resolvedAccessToken,
      refreshToken: resolvedRefreshToken,
      expiresAt: resolvedExpiresAt,
      clientId: clientId || undefined,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to verify Strava token',
    });
  }
});

stravaRouter.post('/api/strava/sync-policy', async (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Sign in with Strava first to set your sync preference.' });
    return;
  }
  const rawWindow = String(req.body?.window || '90d').trim();
  const validWindows = new Set(['90d', '180d', '365d', 'all', 'none']);
  const windowVal = (validWindows.has(rawWindow) ? rawWindow : '90d') as
    | '90d'
    | '180d'
    | '365d'
    | 'all'
    | 'none';
  const importProfileAndGear =
    typeof req.body?.importProfileAndGear === 'boolean'
      ? req.body.importProfileAndGear
      : typeof req.body?.includeGearAndProfile === 'boolean'
        ? req.body.includeGearAndProfile
        : true;

  const policy: StoredStravaSyncPolicy = {
    window: windowVal,
    importProfileAndGear,
    confirmedAt: new Date().toISOString(),
    grantedScope: runtimeStore.stravaGrantedScope || undefined,
  };
  runtimeStore.stravaSyncPolicy = policy;
  await saveSessionCacheAsync(req, res);
  res.json({ ok: true, stravaSyncPolicy: policy });
});

stravaRouter.post('/api/strava/disconnect', async (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  if (!isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const cleanAthleteId = String(runtimeStore.stravaAthleteId || '').replace(/[^0-9a-zA-Z_-]/g, '');
  const accessToken = await ensureValidStravaAccessToken(req, false).catch(() => '');
  if (accessToken) {
    await fetch(
      `https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(accessToken)}`,
      { method: 'POST', signal: AbortSignal.timeout(4000) }
    ).catch(() => undefined);
  }
  if (claims?.sub?.startsWith('usr_')) {
    await disconnectServiceFromUser(claims.sub, 'strava').catch(() => undefined);
  }
  if (cleanAthleteId) {
    try {
      const archivePath = `/tmp/aeropulse-strava-archive-${cleanAthleteId}.json`;
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    } catch {
      // ignore archive unlink errors
    }
  }
  runtimeStore.stravaAccessToken = '';
  runtimeStore.stravaRefreshToken = '';
  runtimeStore.stravaExpiresAt = 0;
  runtimeStore.stravaAthleteId = undefined;
  runtimeStore.stravaAthleteName = '';
  runtimeStore.stravaMeasurementPreference = undefined;
  runtimeStore.stravaGrantedScope = undefined;
  runtimeStore.stravaSyncPolicy = undefined;
  runtimeStore.stravaClientId = '';
  runtimeStore.stravaClientSecret = '';
  await saveSessionCacheAsync(req, res);
  appendSetCookieHeader(res, buildClearVaultCookieHeader());
  res.json({ ok: true, disconnected: 'strava' });
});

stravaRouter.get(
  [
    '/auth/strava/callback',
    '/auth/strava/callback/',
    '/api/strava/callback',
    '/api/strava/callback/',
    '/api/auth/strava/callback',
    '/api/auth/strava/callback/',
  ],
  stravaCallbackHandler
);

stravaRouter.get('/api/strava/sync', async (req: Request, res: Response) => {
  try {
    const forceFull = req.query.full === 'true';
    const deltaOnly = req.query.deltaOnly === 'true';
    const explicitWindow = typeof req.query.window === 'string' ? req.query.window.trim() : undefined;
    const afterEpochParam = Number(req.query.afterEpoch || 0);
    const beforeEpochParam = Number(req.query.beforeEpoch || 0);
    const data = await syncStravaAllHistory(
      req,
      forceFull,
      deltaOnly,
      explicitWindow,
      Number.isFinite(afterEpochParam) && afterEpochParam > 0 ? afterEpochParam : 0,
      Number.isFinite(beforeEpochParam) && beforeEpochParam > 0 ? beforeEpochParam : 0
    );
    await saveSessionCacheAsync(req, res);
    res.json(data);
  } catch (error) {
    res.status(401).json({
      error:
        error instanceof Error ? error.message : 'Failed to sync Strava activities and segments',
    });
  }
});

stravaRouter.get('/api/strava/activities/:id/streams', async (req: Request, res: Response) => {
  try {
    const activeAccessToken = await ensureValidStravaAccessToken(req, false);

    if (!activeAccessToken) {
      res.status(401).json({ error: 'Strava is not connected.' });
      return;
    }

    const activityId = req.params.id;
    const headers = { Authorization: `Bearer ${activeAccessToken}` };
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

    interface RawStravaStreamBucket {
      data?: Array<number | [number, number]>;
    }
    const raw = streamsResp.ok
      ? await readStravaResponseJson<Record<string, RawStravaStreamBucket>>(streamsResp)
      : {};
    const timeData = Array.isArray(raw?.time?.data) ? (raw.time.data as number[]) : [];
    const step = Math.max(1, Math.floor(timeData.length / 500));
    const downsample = (arr?: Array<number | [number, number]>) =>
      Array.isArray(arr) ? (arr as number[]).filter((_, idx) => idx % step === 0) : undefined;

    const rawLatLng = Array.isArray(raw?.latlng?.data) ? (raw.latlng.data as [number, number][]) : undefined;
    const downsampledLatLng = rawLatLng
      ? rawLatLng
          .filter((_, idx) => idx % step === 0)
          .filter((pt) => Array.isArray(pt) && pt.length === 2 && Math.abs(pt[0]) > 0.01)
          .map((pt): [number, number] => [Number(Number(pt[0]).toFixed(5)), Number(Number(pt[1]).toFixed(5))])
      : undefined;

    let segmentEfforts: StravaSegmentEffort[] = [];
    if (detailResp.ok) {
      const detail = await readStravaResponseJson<RawStravaActivity>(detailResp);
      const resolvedActivityId = extractStravaId(detail) || activityId;
      const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
      const sportType = String(detail.sport_type || detail.type || '');
      const sportCat = /run|trailrun|virtualrun|treadmill/i.test(sportType)
        ? ('Running' as const)
        : ('Cycling' as const);
      segmentEfforts = rawEfforts.slice(0, 40).map((se: RawStravaSegmentEffort) => {
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
        const effortId = extractStravaId(se as Record<string, unknown>);
        return {
          id: effortId,
          segmentId: extractStravaId(se.segment as Record<string, unknown>) || effortId,
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
          activityId: resolvedActivityId,
          activityName: String(detail.name || ''),
          startIndex: sIdx,
          endIndex: eIdx,
          startLatLng: pathLatLngs?.[0],
          endLatLng: pathLatLngs?.[pathLatLngs.length - 1],
          pathLatLngs,
        };
      });
    }

    let kudoers: StravaKudoer[] | undefined;
    if (kudosResp.ok) {
      const rawKudos = await readStravaResponseJson<RawStravaKudoerApi[]>(kudosResp);
      if (Array.isArray(rawKudos)) {
        kudoers = rawKudos.map((k) => ({
          firstname: String(k.firstname || 'Athlete'),
          lastname: String(k.lastname || ''),
          profileMedium: k.profile_medium || k.profile || undefined,
          city: k.city || undefined,
          state: k.state || undefined,
          country: k.country || undefined,
        }));
      }
    }

    await saveSessionCacheAsync(req, res);
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
      stravaTokens: getStravaTokenRotationPayload(req),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Strava activity streams',
    });
  }
});

// Fetch Strava Kudoers & Comments for a specific activity (live Strava API + cached/local social notes)
stravaRouter.get('/api/strava/activities/:id/kudos', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const scopedKudosFile = `/tmp/thresh-strava-kudos-${scopeKey}.json`;
    const activityId = String(req.params.id);
    const stravaId = String(req.query.stravaId || activityId).replace(/^strava-/, '');
    const kudosCache = loadJsonFile<Record<string, StravaCachedSocialEntry>>(scopedKudosFile, {});

    const activeAccessToken = await ensureValidStravaAccessToken(req, false);

    if (activeAccessToken && /^\d+$/.test(stravaId)) {
      const headers = { Authorization: `Bearer ${activeAccessToken}` };
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
        const rawKudos = await readStravaResponseJson<RawStravaKudoerApi[]>(kResp);
        const kudoers = Array.isArray(rawKudos)
          ? rawKudos.map((k) => ({
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
          const rawComments = await readStravaResponseJson<RawStravaCommentApi[]>(cResp);
          if (Array.isArray(rawComments)) {
            const remoteComments = rawComments.map((c, idx: number) => ({
              id: extractStravaId(c as Record<string, unknown>) || `sc-${stravaId}-${idx}`,
              text: String(c.text || ''),
              createdAt: String(c.created_at || new Date().toISOString()),
              athleteName:
                [c.athlete?.firstname, c.athlete?.lastname].filter(Boolean).join(' ') ||
                'Strava Athlete',
              avatarUrl: c.athlete?.profile_medium || undefined,
            }));
            const seenIds = new Set(mergedComments.map((mc) => mc.id));
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
        saveJsonFile(scopedKudosFile, kudosCache);
      }
    }

    const entry = kudosCache[activityId] || kudosCache[stravaId] || {};
    await saveSessionCacheAsync(req, res);
    res.json({
      kudosCount: entry.kudosCount || 0,
      hasKudoed: Boolean(entry.hasKudoed),
      kudoers: entry.kudoers || [],
      comments: entry.comments || [],
      stravaTokens: getStravaTokenRotationPayload(req),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Strava kudos',
    });
  }
});

// Toggle Kudos or add a Club / Coaching Comment on an activity
stravaRouter.post('/api/activities/:id/kudos', (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const scopedKudosFile = `/tmp/thresh-strava-kudos-${scopeKey}.json`;
    const activityId = String(req.params.id);
    const { action = 'toggle_kudos', commentText, athleteName } = req.body || {};
    const kudosCache = loadJsonFile<Record<string, StravaCachedSocialEntry>>(scopedKudosFile, {});

    const current = kudosCache[activityId] || {
      kudosCount: Number(req.body?.currentKudosCount || 0),
      hasKudoed: false,
      kudoers: [],
      comments: [],
    };

    const resolvedName = req.body?.authorName || athleteName || 'MeetReady Athlete';
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
            city: 'MeetReady Club',
          });
        }
      } else {
        const idx = existingKudoers.findIndex((k) => k.firstname === first && k.lastname === last);
        if (idx >= 0) existingKudoers.splice(idx, 1);
      }
      current.kudoers = existingKudoers;
    }

    kudosCache[activityId] = current;
    saveJsonFile(scopedKudosFile, kudosCache);

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
