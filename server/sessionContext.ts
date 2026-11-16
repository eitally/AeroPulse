import type { Request, Response } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import {
  type GarminSessionStore,
  getEnvGarminPersonalApiKey,
  loadGarminSession,
} from './garminConnectService.ts';
import {
  appendSetCookieHeader,
  getVerifiedSessionClaims,
  hasValidSessionToken,
  parseCookies,
} from './securityUtils.ts';
import {
  type CompactCookieVaultPayload,
  VAULT_COOKIE_NAME,
  buildEncryptedVaultCookieHeader,
  decryptJsonFromVault,
  loadTenantVaultSync,
  saveTenantVaultAsync,
  saveTenantVaultSync,
} from './tokenVault.ts';

export const requestContext = new AsyncLocalStorage<Request>();
export const explicitScopeKeyByReq = new WeakMap<Request, string>();

export const SEGMENTS_BY_ACTIVITY_CACHE_FILE = '/tmp/thresh-segments-by-activity.json';
export const ROUTES_BY_ACTIVITY_CACHE_FILE = '/tmp/thresh-routes-by-activity.json';
export const STRAVA_KUDOS_CACHE_FILE = '/tmp/thresh-strava-kudos.json';
export const GARMIN_SESSION_DIR = '/tmp/thresh-garmin';

export interface StoredStravaSyncPolicy {
  window: '90d' | '180d' | '365d' | 'all' | 'none';
  importProfileAndGear: boolean;
  confirmedAt: string;
  grantedScope?: string;
}

export interface RuntimeSessionStore {
  intervalsApiKey: string;
  intervalsAccessToken?: string;
  intervalsScope?: string;
  intervalsAthleteId: string;
  intervalsAthleteName: string;
  wahooClientId?: string;
  wahooClientSecret?: string;
  wahooAccessToken?: string;
  wahooRefreshToken?: string;
  wahooExpiresAt?: number;
  wahooScope?: string;
  wahooUserId?: string;
  wahooAthleteName?: string;
  polarClientId?: string;
  polarClientSecret?: string;
  polarAccessToken?: string;
  polarUserId?: string;
  polarAthleteName?: string;
  polarExpiresAt?: number;
  polarScope?: string;
  stravaClientId: string;
  stravaClientSecret: string;
  stravaAccessToken: string;
  stravaRefreshToken: string;
  stravaExpiresAt: number;
  stravaAthleteId?: string;
  stravaAthleteName: string;
  stravaMeasurementPreference?: 'mi' | 'km';
  stravaGrantedScope?: string;
  stravaSyncPolicy?: StoredStravaSyncPolicy;
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

export function hasExplicitCredentialHeader(req?: Request): boolean {
  if (!req) return false;
  return Boolean(
    String(req.headers['x-strava-refresh-token'] || '').trim() ||
      String(req.headers['x-strava-access-token'] || '').trim() ||
      String(req.headers['x-intervals-api-key'] || '').trim() ||
      String(req.headers['x-intervals-access-token'] || '').trim() ||
      String(req.headers['x-wahoo-access-token'] || '').trim() ||
      String(req.headers['x-polar-access-token'] || '').trim() ||
      String(req.headers['x-garmin-personal-api-key'] || '').trim() ||
      String(req.headers['x-garmin-bearer-token'] || '').trim() ||
      String(req.headers['x-garmin-oauth1-token'] || '').trim()
  );
}

export function isAuthenticatedRequest(req?: Request): boolean {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  return hasValidSessionToken(activeReq) || hasExplicitCredentialHeader(activeReq);
}

export function bindRequestScopeKey(req: Request | undefined, sid: string): string {
  const scopeKey = sid.slice(0, 24);
  if (req) {
    explicitScopeKeyByReq.set(req, scopeKey);
  }
  return scopeKey;
}

export function readCompactVaultFromCookie(req?: Request): CompactCookieVaultPayload | null {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[VAULT_COOKIE_NAME];
  if (!raw) return null;
  return decryptJsonFromVault<CompactCookieVaultPayload>(raw);
}

export function resolveSessionScopeKey(req?: Request): string | null {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return null;
  const bound = explicitScopeKeyByReq.get(activeReq);
  if (bound) return bound;
  const verified = getVerifiedSessionClaims(activeReq);
  if (verified?.sid) {
    return verified.sid.slice(0, 24);
  }
  const cookieVault = readCompactVaultFromCookie(activeReq);
  if (cookieVault?.sid) {
    return cookieVault.sid.slice(0, 24);
  }
  const rawCredential = (
    String(activeReq.headers['x-garmin-personal-api-key'] || '').trim() ||
    String(activeReq.headers['x-strava-refresh-token'] || '').trim() ||
    String(activeReq.headers['x-strava-access-token'] || '').trim() ||
    String(activeReq.headers['x-intervals-api-key'] || '').trim()
  ).trim();
  if (!rawCredential) return null;
  return crypto.createHash('sha256').update(rawCredential).digest('hex').slice(0, 24);
}

export function getGarminScopeKey(req?: Request): string {
  return resolveSessionScopeKey(req) || 'unauthenticated';
}

export function getActiveGarminSession(req?: Request): GarminSessionStore | null {
  const activeReq = req ?? requestContext.getStore();
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return null;
  }
  const scopeKey = resolveSessionScopeKey(activeReq);
  const stored = scopeKey ? loadGarminSession(GARMIN_SESSION_DIR, scopeKey) : null;
  const cookieVault = readCompactVaultFromCookie(activeReq);
  const cookiePersonalKey =
    cookieVault && (!scopeKey || cookieVault.sid?.slice(0, 24) === scopeKey)
      ? String(cookieVault.garminPersonalApiKey || '').trim()
      : '';
  const headerPersonalKey = activeReq
    ? String(activeReq.headers['x-garmin-personal-api-key'] || '').trim()
    : '';
  const headerBearer = activeReq
    ? String(activeReq.headers['x-garmin-bearer-token'] || '').trim()
    : '';
  const headerOauth1 = activeReq
    ? String(activeReq.headers['x-garmin-oauth1-token'] || '').trim()
    : '';
  const headerOauth1Secret = activeReq
    ? String(activeReq.headers['x-garmin-oauth1-secret'] || '').trim()
    : '';

  if (
    stored &&
    (stored.personalApiKey || stored.oauth2AccessToken || stored.oauth1Token)
  ) {
    if (headerPersonalKey && !stored.personalApiKey) {
      stored.personalApiKey = headerPersonalKey;
    }
    return stored;
  }
  if (cookiePersonalKey || headerPersonalKey || headerBearer || (headerOauth1 && headerOauth1Secret)) {
    return {
      personalApiKey: cookiePersonalKey || headerPersonalKey || undefined,
      oauth2AccessToken: headerBearer || undefined,
      oauth1Token: headerOauth1 || undefined,
      oauth1TokenSecret: headerOauth1Secret || undefined,
    };
  }
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const fallbackPersonalKey = getEnvGarminPersonalApiKey();
    if (fallbackPersonalKey) {
      const envGarminName = (process.env.GARMIN_ATHLETE_NAME || '').trim();
      return {
        personalApiKey: fallbackPersonalKey,
        ...(envGarminName ? { fullName: envGarminName } : {}),
      };
    }
  }
  return null;
}

export function getScopedPlannedEventsFile(req?: Request, explicitApiKey?: string): string | null {
  const scopeKey = explicitApiKey
    ? crypto.createHash('sha256').update(explicitApiKey.trim()).digest('hex').slice(0, 24)
    : resolveSessionScopeKey(req);
  if (!scopeKey) return null;
  return `/tmp/thresh-planned-events-${scopeKey}.json`;
}

export function loadJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    // ignore read error
  }
  return fallback;
}

export function saveJsonFile(filePath: string, data: unknown) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore write error
  }
}

export const initialEnvMapKey = (
  process.env.MAPBOX_ACCESS_TOKEN ||
  process.env.VITE_MAPBOX_ACCESS_TOKEN ||
  process.env.THUNDERFOREST_API_KEY ||
  ''
).trim();

export const initialEnvGeminiKey = [
  process.env.GEMINI_API_KEY,
  process.env.GOOGLE_API_KEY,
  process.env.GOOGLE_GENERATIVE_AI_API_KEY,
]
  .map((k) =>
    (k || '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .trim()
  )
  .find((k) => k && k !== 'MY_GEMINI_API_KEY' && k !== 'YOUR_GEMINI_API_KEY') || '';

export function createDefaultRuntimeSessionStore(seed: Partial<RuntimeSessionStore> = {}): RuntimeSessionStore {
  return {
    intervalsApiKey: seed.intervalsApiKey || '',
    intervalsAccessToken: seed.intervalsAccessToken || '',
    intervalsScope: seed.intervalsScope || '',
    intervalsAthleteId: seed.intervalsAthleteId || '0',
    intervalsAthleteName: seed.intervalsAthleteName || '',
    wahooClientId: seed.wahooClientId || process.env.WAHOO_CLIENT_ID || '',
    wahooClientSecret: seed.wahooClientSecret || process.env.WAHOO_CLIENT_SECRET || '',
    wahooAccessToken: seed.wahooAccessToken || '',
    wahooRefreshToken: seed.wahooRefreshToken || '',
    wahooExpiresAt: seed.wahooExpiresAt || 0,
    wahooScope: seed.wahooScope || '',
    wahooUserId: seed.wahooUserId || '',
    wahooAthleteName: seed.wahooAthleteName || '',
    polarClientId: seed.polarClientId || process.env.POLAR_CLIENT_ID || '',
    polarClientSecret: seed.polarClientSecret || process.env.POLAR_CLIENT_SECRET || '',
    polarAccessToken: seed.polarAccessToken || '',
    polarUserId: seed.polarUserId || '',
    polarAthleteName: seed.polarAthleteName || '',
    polarExpiresAt: seed.polarExpiresAt || 0,
    polarScope: seed.polarScope || '',
    stravaClientId: seed.stravaClientId || process.env.STRAVA_CLIENT_ID || '',
    stravaClientSecret: seed.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || '',
    stravaAccessToken: seed.stravaAccessToken || '',
    stravaRefreshToken: seed.stravaRefreshToken || '',
    stravaExpiresAt: seed.stravaExpiresAt || 0,
    stravaAthleteId: seed.stravaAthleteId || undefined,
    stravaAthleteName: seed.stravaAthleteName || '',
    stravaMeasurementPreference: seed.stravaMeasurementPreference || undefined,
    stravaGrantedScope: seed.stravaGrantedScope || undefined,
    stravaSyncPolicy: seed.stravaSyncPolicy || undefined,
    lastSyncedAt: seed.lastSyncedAt || new Date().toISOString(),
    nextHourlySyncAt:
      seed.nextHourlySyncAt || new Date(Date.now() + 3600 * 1000).toISOString(),
    totalActivitiesCount: seed.totalActivitiesCount || 0,
    earliestActivityDate: seed.earliestActivityDate || '',
    garminActivitiesCount: seed.garminActivitiesCount || 0,
    stravaActivitiesCount: seed.stravaActivitiesCount || 0,
    redactedStravaCount: seed.redactedStravaCount || 0,
    athleteFtp: seed.athleteFtp || 250,
    athleteIndoorFtp: seed.athleteIndoorFtp || 250,
    athleteRunFtp: seed.athleteRunFtp || 300,
    athleteLthr: seed.athleteLthr || 165,
    athleteMaxHr: seed.athleteMaxHr || 185,
    athleteProfile: seed.athleteProfile || undefined,
    geminiApiKey: seed.geminiApiKey || '',
    mapTileApiKey: seed.mapTileApiKey || initialEnvMapKey,
    mapTileProvider:
      seed.mapTileProvider ||
      (initialEnvMapKey.startsWith('pk.')
        ? 'MAPBOX'
        : initialEnvMapKey
          ? 'THUNDERFOREST'
          : 'OSM_KEYLESS'),
    gearItems: seed.gearItems || [],
  };
}

export const scopedStoresInMemory = new Map<string, RuntimeSessionStore>();
export const hydratedReqScopeMap = new WeakMap<Request, Map<string, RuntimeSessionStore>>();
export const ephemeralStoresByReq = new WeakMap<Request, RuntimeSessionStore>();

export function getScopedSessionFilePath(scopeKey: string): string {
  return `/tmp/thresh-session-${scopeKey}.json`;
}

export function getScopedRuntimeStore(req?: Request): RuntimeSessionStore {
  const activeReq = req ?? requestContext.getStore();
  const scopeKey = resolveSessionScopeKey(activeReq);
  if (scopeKey) {
    if (activeReq) {
      const perReq = hydratedReqScopeMap.get(activeReq);
      const reqCached = perReq?.get(scopeKey);
      if (reqCached) return reqCached;
    } else {
      const memExisting = scopedStoresInMemory.get(scopeKey);
      if (memExisting) return memExisting;
    }

    let loaded = loadTenantVaultSync<Partial<RuntimeSessionStore>>(`session_${scopeKey}`, {});
    const legacyPath = getScopedSessionFilePath(scopeKey);
    if (Object.keys(loaded).length === 0 && fs.existsSync(legacyPath)) {
      loaded = loadJsonFile<Partial<RuntimeSessionStore>>(legacyPath, {});
      saveTenantVaultSync(`session_${scopeKey}`, loaded);
      try {
        fs.unlinkSync(legacyPath);
      } catch {
        // ignore
      }
    }

    const cookieVault = readCompactVaultFromCookie(activeReq);
    if (cookieVault && cookieVault.sid?.slice(0, 24) === scopeKey) {
      loaded = {
        ...cookieVault,
        ...loaded,
        stravaAccessToken: loaded.stravaAccessToken || cookieVault.stravaAccessToken || '',
        stravaRefreshToken: loaded.stravaRefreshToken || cookieVault.stravaRefreshToken || '',
        stravaExpiresAt:
          (loaded.stravaExpiresAt || 0) >= (cookieVault.stravaExpiresAt || 0)
            ? loaded.stravaExpiresAt
            : cookieVault.stravaExpiresAt,
        stravaAthleteId: loaded.stravaAthleteId || cookieVault.stravaAthleteId,
        stravaAthleteName: loaded.stravaAthleteName || cookieVault.stravaAthleteName || '',
        stravaMeasurementPreference:
          loaded.stravaMeasurementPreference || cookieVault.stravaMeasurementPreference,
        stravaGrantedScope: loaded.stravaGrantedScope || cookieVault.stravaGrantedScope,
        stravaSyncPolicy: loaded.stravaSyncPolicy || cookieVault.stravaSyncPolicy,
        intervalsApiKey: loaded.intervalsApiKey || cookieVault.intervalsApiKey || '',
        intervalsAccessToken:
          loaded.intervalsAccessToken || cookieVault.intervalsAccessToken || '',
        intervalsScope: loaded.intervalsScope || cookieVault.intervalsScope || '',
        intervalsAthleteId: loaded.intervalsAthleteId || cookieVault.intervalsAthleteId || '0',
        intervalsAthleteName:
          loaded.intervalsAthleteName || cookieVault.intervalsAthleteName || '',
        wahooAccessToken: loaded.wahooAccessToken || cookieVault.wahooAccessToken || '',
        wahooRefreshToken: loaded.wahooRefreshToken || cookieVault.wahooRefreshToken || '',
        wahooExpiresAt: loaded.wahooExpiresAt || cookieVault.wahooExpiresAt || 0,
        wahooScope: loaded.wahooScope || cookieVault.wahooScope || '',
        wahooUserId: loaded.wahooUserId || cookieVault.wahooUserId || '',
        wahooAthleteName: loaded.wahooAthleteName || cookieVault.wahooAthleteName || '',
        polarAccessToken: loaded.polarAccessToken || cookieVault.polarAccessToken || '',
        polarUserId: loaded.polarUserId || cookieVault.polarUserId || '',
        polarAthleteName: loaded.polarAthleteName || cookieVault.polarAthleteName || '',
        polarExpiresAt: loaded.polarExpiresAt || cookieVault.polarExpiresAt || 0,
        polarScope: loaded.polarScope || cookieVault.polarScope || '',
      };
    }

    const hydrated = createDefaultRuntimeSessionStore(loaded);
    scopedStoresInMemory.set(scopeKey, hydrated);
    if (activeReq) {
      let map = hydratedReqScopeMap.get(activeReq);
      if (!map) {
        map = new Map();
        hydratedReqScopeMap.set(activeReq, map);
      }
      map.set(scopeKey, hydrated);
    }
    return hydrated;
  }
  if (activeReq) {
    let eph = ephemeralStoresByReq.get(activeReq);
    if (!eph) {
      eph = createDefaultRuntimeSessionStore();
      ephemeralStoresByReq.set(activeReq, eph);
    }
    return eph;
  }
  return createDefaultRuntimeSessionStore();
}

export const runtimeStore: RuntimeSessionStore = new Proxy({} as RuntimeSessionStore, {
  get(_target, prop: keyof RuntimeSessionStore) {
    return getScopedRuntimeStore()[prop];
  },
  set(_target, prop: keyof RuntimeSessionStore, value: any) {
    (getScopedRuntimeStore() as Record<string, any>)[prop] = value;
    return true;
  },
});

export function emitEncryptedVaultCookieIfPossible(
  req: Request | undefined,
  res: Response | undefined,
  scopeKey: string,
  store: RuntimeSessionStore
) {
  if (!res || res.headersSent) return;
  const activeReq = req ?? requestContext.getStore();
  const isSecure = Boolean(
    activeReq &&
      (activeReq.secure ||
        String(activeReq.headers['x-forwarded-proto'] || '').toLowerCase() === 'https')
  );
  const garminSess = loadGarminSession(GARMIN_SESSION_DIR, scopeKey);
  const compact: CompactCookieVaultPayload = {
    sid: scopeKey,
    stravaAccessToken: store.stravaAccessToken || undefined,
    stravaRefreshToken: store.stravaRefreshToken || undefined,
    stravaExpiresAt: store.stravaExpiresAt || undefined,
    stravaAthleteId: store.stravaAthleteId || undefined,
    stravaAthleteName: store.stravaAthleteName || undefined,
    stravaClientId: store.stravaClientId || undefined,
    stravaMeasurementPreference: store.stravaMeasurementPreference || undefined,
    stravaGrantedScope: store.stravaGrantedScope || undefined,
    stravaSyncPolicy: store.stravaSyncPolicy || undefined,
    intervalsApiKey: store.intervalsApiKey || undefined,
    intervalsAccessToken: store.intervalsAccessToken || undefined,
    intervalsScope: store.intervalsScope || undefined,
    intervalsAthleteId:
      store.intervalsAthleteId && store.intervalsAthleteId !== '0'
        ? store.intervalsAthleteId
        : undefined,
    intervalsAthleteName: store.intervalsAthleteName || undefined,
    wahooAccessToken: store.wahooAccessToken || undefined,
    wahooRefreshToken: store.wahooRefreshToken || undefined,
    wahooExpiresAt: store.wahooExpiresAt || undefined,
    wahooScope: store.wahooScope || undefined,
    wahooUserId: store.wahooUserId || undefined,
    wahooAthleteName: store.wahooAthleteName || undefined,
    polarAccessToken: store.polarAccessToken || undefined,
    polarUserId: store.polarUserId || undefined,
    polarAthleteName: store.polarAthleteName || undefined,
    polarExpiresAt: store.polarExpiresAt || undefined,
    polarScope: store.polarScope || undefined,
    garminPersonalApiKey: garminSess?.personalApiKey || undefined,
  };
  const header = buildEncryptedVaultCookieHeader(compact, isSecure);
  if (header) {
    appendSetCookieHeader(res, header);
  }
}

export function saveSessionCache(req?: Request, res?: Response) {
  const scopeKey = resolveSessionScopeKey(req);
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(req);
  scopedStoresInMemory.set(scopeKey, store);
  saveTenantVaultSync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(req, res, scopeKey, store);
}

export async function saveSessionCacheAsync(
  req?: Request,
  res?: Response,
  explicitSid?: string
): Promise<void> {
  const activeReq = req ?? requestContext.getStore();
  const scopeKey = explicitSid
    ? bindRequestScopeKey(activeReq, explicitSid)
    : resolveSessionScopeKey(activeReq);
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(activeReq);
  scopedStoresInMemory.set(scopeKey, store);
  await saveTenantVaultAsync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(activeReq, res, scopeKey, store);
}

// Security & vault utilities re-exported for convenience across domain sub-routers
export {
  getVerifiedSessionClaims,
  decodeAndVerifyToken,
  setSessionCookie,
  issueOAuthStateToken,
  verifyOAuthStateToken,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  getOAuthStateCookieNonce,
  safeJsonForScript,
  escapeHtml,
  deriveStravaSessionSid,
} from './securityUtils.ts';

export {
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  deleteTenantVault,
} from './tokenVault.ts';
