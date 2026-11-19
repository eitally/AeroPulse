import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import {
  getVaultStorageBackend,
  deleteTenantVault,
  buildClearVaultCookieHeader,
  buildClearUserCookieHeader,
} from '../tokenVault.ts';
import {
  appendSetCookieHeader,
  clearOAuthStateCookie,
  clearSessionCookie,
  deriveStravaSessionSid,
  isCanonicalAuthenticatedClaims,
  setSessionCookie,
} from '../securityUtils.ts';
import {
  isAuthenticatedRequest,
  getActiveGarminSession,
  getVerifiedSessionClaims,
  resolveSessionScopeKey,
  saveSessionCache,
  saveSessionCacheAsync,
  runtimeStore,
  scopedStoresInMemory,
  hydratedReqScopeMap,
  GARMIN_SESSION_DIR,
  getScopedSessionFilePath,
  type RuntimeSessionStore,
} from '../sessionContext.ts';
import {
  userOwnedSecretOnly,
  isServerOwnedSecret,
} from '../secretManager.ts';
import {
  buildServerAthleteProfile,
  isGenericName,
} from '../physiologyEngine.ts';
import { resolveCallbackUrl } from '../oauthHelpers.ts';
import { clearGarminSessionAsync } from '../garminConnectService.ts';
import {
  getEffectiveIntervalsConfig,
  getEffectiveIntervalsClientConfig,
  resolveIntervalsAthleteIdentity,
} from './intervalsRouter.ts';
import {
  getEffectiveStravaClientConfig,
  getStravaTokenRotationPayload,
  resolveStravaAthleteIdentity,
  stravaCallbackHandler,
} from './stravaRouter.ts';
import {
  getEffectiveWahooClientConfig,
  getEffectiveWahooTokens,
} from './wahooRouter.ts';
import {
  getEffectivePolarClientConfig,
  getEffectivePolarTokens,
} from './polarRouter.ts';
import { getEffectiveGeminiApiKey } from './coachRouter.ts';

export const configRouter = Router();

// Bootstrap or refresh an anonymous pre-auth session cookie (never permits caller-selected sub)
configRouter.post('/api/auth/session', (req: Request, res: Response) => {
  const existing = getVerifiedSessionClaims(req);
  if (existing && isCanonicalAuthenticatedClaims(existing)) {
    const refreshedToken = setSessionCookie(req, res, existing.sub, existing.sid, 'verified');
    res.json({ ok: true, sessionToken: refreshedToken, authLevel: 'verified' });
    return;
  }
  const anonSub = `anon_${crypto.randomBytes(8).toString('hex')}`;
  const sessionToken = setSessionCookie(req, res, anonSub, undefined, 'anon');
  res.json({ ok: true, sessionToken, authLevel: 'anon' });
});

configRouter.get(['/api/config/status', '/api/auth/status'], async (req: Request, res: Response) => {
  const verifiedClaims = getVerifiedSessionClaims(req);
  const isVerifiedSession = isCanonicalAuthenticatedClaims(verifiedClaims);
  const isAuthed = isAuthenticatedRequest(req);
  const {
    apiKey: intervalsKey,
    accessToken: intervalsAccessToken,
    athleteId,
  } = getEffectiveIntervalsConfig(req);
  const {
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    refreshToken: stravaRefreshToken,
    accessToken: stravaAccessToken,
  } = getEffectiveStravaClientConfig(req);
  const {
    clientId: intervalsClientId,
    clientSecret: intervalsClientSecret,
  } = getEffectiveIntervalsClientConfig(req);
  if (intervalsKey && !runtimeStore.intervalsApiKey && !isServerOwnedSecret(intervalsKey)) {
    runtimeStore.intervalsApiKey = intervalsKey;
    runtimeStore.intervalsAthleteId = athleteId;
  }
  if (intervalsAccessToken && !runtimeStore.intervalsAccessToken) {
    runtimeStore.intervalsAccessToken = intervalsAccessToken;
    runtimeStore.intervalsAthleteId = athleteId;
  }
  if (stravaClientId && !runtimeStore.stravaClientId) {
    runtimeStore.stravaClientId = stravaClientId;
  }
  if (
    stravaClientSecret &&
    !runtimeStore.stravaClientSecret &&
    !isServerOwnedSecret(stravaClientSecret)
  ) {
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

  const hasStravaEnv = Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  const effectiveGeminiKey = getEffectiveGeminiApiKey(req);
  if (effectiveGeminiKey && !runtimeStore.geminiApiKey && !isServerOwnedSecret(effectiveGeminiKey)) {
    runtimeStore.geminiApiKey = effectiveGeminiKey;
  }
  const hasGeminiServerKey = Boolean(effectiveGeminiKey);
  const isIntervalsConnected = Boolean(intervalsKey || intervalsAccessToken);
  const isStravaConnected = Boolean(stravaAccessToken || stravaRefreshToken);

  const [stravaIdentity, intervalsIdentity] = await Promise.all([
    isStravaConnected ? resolveStravaAthleteIdentity(req) : Promise.resolve(null),
    isIntervalsConnected ? resolveIntervalsAthleteIdentity(req) : Promise.resolve(null),
  ]);

  const resolvedStravaAthleteId =
    stravaIdentity?.athleteId || runtimeStore.stravaAthleteId || undefined;
  const resolvedStravaName =
    stravaIdentity?.athleteName ||
    (!isGenericName(runtimeStore.stravaAthleteName) ? runtimeStore.stravaAthleteName : undefined);
  const resolvedMeasurementPref =
    stravaIdentity?.measurementPreference || runtimeStore.stravaMeasurementPreference || undefined;
  const resolvedIntervalsName =
    intervalsIdentity?.athleteName ||
    (!isGenericName(runtimeStore.intervalsAthleteName)
      ? runtimeStore.intervalsAthleteName
      : undefined);

  const activeGarminSession = getActiveGarminSession(req);
  const isGarminConnected = Boolean(
    activeGarminSession?.personalApiKey ||
      activeGarminSession?.oauth2AccessToken ||
      activeGarminSession?.oauth1Token
  );
  const resolvedGarminName =
    activeGarminSession?.fullName || activeGarminSession?.displayName || undefined;

  const { clientId: wahooClientId, clientSecret: wahooClientSecret } = getEffectiveWahooClientConfig(req);
  const { accessToken: wahooAccessToken, athleteId: wahooAthleteId, athleteName: wahooAthleteName } = getEffectiveWahooTokens(req);
  const isWahooConnected = Boolean(wahooAccessToken);

  const { clientId: polarClientId, clientSecret: polarClientSecret } = getEffectivePolarClientConfig(req);
  const { accessToken: polarAccessToken, athleteId: polarAthleteId, athleteName: polarAthleteName } = getEffectivePolarTokens(req);
  const isPolarConnected = Boolean(polarAccessToken);

  let sessionToken: string | undefined;
  if (
    (isVerifiedSession || Boolean(resolvedStravaAthleteId)) &&
    (isStravaConnected || isGarminConnected || isIntervalsConnected || isWahooConnected || isPolarConnected)
  ) {
    const existingClaims = verifiedClaims;
    const keepUserSub = Boolean(existingClaims?.sub?.startsWith('usr_'));
    const canonicalSid = keepUserSub
      ? existingClaims!.sid
      : resolvedStravaAthleteId
        ? deriveStravaSessionSid(resolvedStravaAthleteId)
        : existingClaims?.sid;
    sessionToken = setSessionCookie(
      req,
      res,
      keepUserSub
        ? existingClaims!.sub
        : resolvedStravaName || resolvedGarminName || resolvedIntervalsName || wahooAthleteName || polarAthleteName || 'athlete',
      canonicalSid,
      'verified'
    );
    await saveSessionCacheAsync(req, res, canonicalSid);
  }

  res.json({
    vaultStorageBackend: getVaultStorageBackend(),
    garminConnected: isGarminConnected,
    garminAthleteName: resolvedGarminName,
    intervalsConfigured: Boolean(intervalsClientId && intervalsClientSecret),
    intervalsConnected: isIntervalsConnected,
    intervalsAuthMethod: intervalsAccessToken ? 'OAUTH' : intervalsKey ? 'API_KEY' : 'NONE',
    intervalsAthleteId: isIntervalsConnected
      ? intervalsIdentity?.athleteId || athleteId || '0'
      : '0',
    intervalsAthleteName: resolvedIntervalsName,
    intervalsSource: intervalsAccessToken ? 'OAUTH' : isIntervalsConnected ? 'USER_INPUT' : 'NONE',
    wahooConfigured: Boolean(wahooClientId && wahooClientSecret),
    wahooConnected: isWahooConnected,
    wahooAthleteId: isWahooConnected ? wahooAthleteId : undefined,
    wahooAthleteName: isWahooConnected ? wahooAthleteName : undefined,
    polarConfigured: Boolean(polarClientId && polarClientSecret),
    polarConnected: isPolarConnected,
    polarAthleteId: isPolarConnected ? polarAthleteId : undefined,
    polarAthleteName: isPolarConnected ? polarAthleteName : undefined,
    stravaConfigured: Boolean(stravaClientId && stravaClientSecret),
    stravaClientId: stravaClientId || undefined,
    stravaConnected: isStravaConnected,
    stravaAthleteId: resolvedStravaAthleteId,
    stravaAthleteName: resolvedStravaName || resolvedGarminName || resolvedIntervalsName,
    stravaAthleteFtp: stravaIdentity?.ftp,
    stravaAthleteWeightKg: stravaIdentity?.weightKg,
    stravaMeasurementPreference: resolvedMeasurementPref,
    stravaGrantedScope: runtimeStore.stravaGrantedScope || undefined,
    stravaSyncPolicy: runtimeStore.stravaSyncPolicy || undefined,
    stravaSource: isStravaConnected ? 'OAUTH' : hasStravaEnv ? 'ENV' : 'NONE',
    hasGeminiServerKey,
    autoSyncCronActive: true,
    totalActivitiesCount: 0,
    earliestActivityDate: '',
    garminActivitiesCount: runtimeStore.garminActivitiesCount || 0,
    stravaActivitiesCount: runtimeStore.stravaActivitiesCount || 0,
    redactedStravaCount: runtimeStore.redactedStravaCount || 0,
    gearItems: runtimeStore.gearItems || [],
    athleteProfile: runtimeStore.athleteProfile || undefined,
    callbackUrl: resolveCallbackUrl(req),
    stravaTokens: isStravaConnected ? getStravaTokenRotationPayload(req) : undefined,
    sessionToken,
    mapTileProvider: effectiveMapProvider,
    mapTileApiKeyConfigured: Boolean(effectiveMapKey),
    mapTileApiKey: isVerifiedSession && effectiveMapKey ? effectiveMapKey : undefined,
  });
});

configRouter.post('/api/athlete/profile', (req: Request, res: Response) => {
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
  saveSessionCache(req);

  res.json({
    ok: true,
    athleteProfile: updated,
  });
});

// Save Mapbox / OpenStreetMap / Thunderforest Map Tile Provider & API Key
configRouter.post('/api/map/config', (req: Request, res: Response) => {
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

// Export & Import Connection Bundle for 1-Click Transfer to Deployed App / Vercel
configRouter.get('/api/config/export-bundle', (req: Request, res: Response) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: 'Valid authenticated session required to export credentials.' });
    return;
  }
  const effectiveIntervals = getEffectiveIntervalsConfig(req);
  const effectiveStrava = getEffectiveStravaClientConfig(req);
  // SEC-01: export only credentials the user supplied; never server env fallbacks.
  const intervalsApiKey = userOwnedSecretOnly(effectiveIntervals.apiKey);
  const intervalsAthleteId = intervalsApiKey ? effectiveIntervals.athleteId : '0';
  const stravaClientId = effectiveStrava.clientId;
  const stravaClientSecret = userOwnedSecretOnly(effectiveStrava.clientSecret);
  const stravaRefreshToken = userOwnedSecretOnly(effectiveStrava.refreshToken);
  const stravaAccessToken = userOwnedSecretOnly(effectiveStrava.accessToken);
  if (!intervalsApiKey && !stravaRefreshToken && !stravaAccessToken) {
    res.status(401).json({ error: 'Authentication required to export connection bundle.' });
    return;
  }
  const mapTileApiKey = userOwnedSecretOnly(
    (req.headers['x-map-tile-api-key'] as string | undefined) || runtimeStore.mapTileApiKey || ''
  );
  const mapTileProvider = runtimeStore.mapTileProvider || 'OSM_KEYLESS';
  const geminiApiKey = userOwnedSecretOnly(getEffectiveGeminiApiKey(req));

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
    ...(stravaClientSecret ? [`STRAVA_CLIENT_SECRET="${stravaClientSecret}"`] : []),
    `STRAVA_REFRESH_TOKEN="${stravaRefreshToken}"`,
    ...(mapTileApiKey ? [`MAPBOX_ACCESS_TOKEN="${mapTileApiKey}"`] : []),
  ].join('\n');

  res.json({
    bundle,
    envText: envLines,
    credentials: payload,
  });
});

configRouter.post('/api/config/import-bundle', (req: Request, res: Response) => {
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
        geminiApiKey: parsed.geminiApiKey,
        intervalsApiKey: parsed.intervalsApiKey,
        intervalsAthleteId: parsed.intervalsAthleteId || '0',
        stravaClientId: parsed.stravaClientId,
        stravaClientSecret: parsed.stravaClientSecret,
        stravaRefreshToken: parsed.stravaRefreshToken,
        stravaAccessToken: parsed.stravaAccessToken,
        mapTileProvider: parsed.mapTileProvider,
        mapTileApiKey: parsed.mapTileApiKey,
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

configRouter.get(['/api/index', '/api'], (req: Request, res: Response, next) => {
  if (req.query.code || (req.query.error && req.query.state !== undefined)) {
    void stravaCallbackHandler(req, res);
    return;
  }
  next();
});

configRouter.post('/api/auth/logout', async (req: Request, res: Response) => {
  try {
    const wasAuthenticated = isAuthenticatedRequest(req);
    const scopeKey = resolveSessionScopeKey(req);

    clearSessionCookie(res);
    clearOAuthStateCookie(res);
    appendSetCookieHeader(res, buildClearVaultCookieHeader());
    appendSetCookieHeader(res, buildClearUserCookieHeader());

    const clearCredentials = Boolean(req.body?.clearCredentials) && wasAuthenticated;
    if (clearCredentials) {
      runtimeStore.stravaAccessToken = '';
      runtimeStore.stravaRefreshToken = '';
      runtimeStore.stravaExpiresAt = 0;
      runtimeStore.stravaAthleteId = undefined;
      runtimeStore.stravaAthleteName = '';
      runtimeStore.stravaMeasurementPreference = undefined;
      runtimeStore.stravaGrantedScope = undefined;
      runtimeStore.stravaSyncPolicy = undefined;
      runtimeStore.intervalsApiKey = '';
      runtimeStore.intervalsAthleteId = '0';
      runtimeStore.intervalsAthleteName = '';
      if (scopeKey) {
        scopedStoresInMemory.delete(scopeKey);
        hydratedReqScopeMap.delete(req);
        await Promise.all([
          deleteTenantVault(`session_${scopeKey}`),
          clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey),
        ]);
        try {
          const sessionPath = getScopedSessionFilePath(scopeKey);
          if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
        } catch {
          // ignore unlink error
        }
      }
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
