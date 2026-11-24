import type {
  AthleteProfile,
  DistanceUnit,
  MapTileProvider,
  StravaSyncPolicy,
} from '../../types';

export function isGenericAthleteName(name?: string | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'athlete' ||
    normalized === 'primary athlete' ||
    normalized === 'strava athlete' ||
    normalized === 'strava user'
  );
}

export interface RotatedStravaTokenPayload {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  athleteId?: string;
  athleteName?: string;
}

export interface StravaTokenHandshakePayload extends RotatedStravaTokenPayload {
  weightKg?: number;
  athleteWeightKg?: number;
  ftp?: number;
  athleteFtp?: number;
  measurementPreference?: string;
  grantedScope?: string;
}

export interface ServerConfigStatusResponse {
  mode?: 'LIVE' | 'SANDBOX_CALIBRATION';
  stravaConnected?: boolean;
  stravaConfigured?: boolean;
  stravaClientId?: string;
  stravaAthleteId?: string;
  stravaAthleteName?: string;
  stravaAthleteWeightKg?: number;
  stravaAthleteFtp?: number;
  stravaMeasurementPreference?: DistanceUnit;
  stravaGrantedScope?: string;
  stravaSyncPolicy?: StravaSyncPolicy & { consentedAt?: string };
  stravaSource?: 'OAUTH' | 'ENV' | 'NONE';
  stravaTokens?: RotatedStravaTokenPayload;
  intervalsConnected?: boolean;
  intervalsConfigured?: boolean;
  intervalsAuthMethod?: 'OAUTH' | 'API_KEY' | 'NONE';
  intervalsAthleteId?: string;
  intervalsAthleteName?: string;
  intervalsScope?: string;
  intervalsCanWriteCalendar?: boolean;
  intervalsSource?: 'ENV' | 'USER_INPUT' | 'OAUTH' | 'NONE';
  garminConfigured?: boolean;
  garminConnected?: boolean;
  garminAuthMethod?: 'OAUTH' | 'PERSONAL_KEY' | 'NONE';
  garminCanPushWorkouts?: boolean;
  garminAthleteName?: string;
  corosConfigured?: boolean;
  corosConnected?: boolean;
  corosCanPushWorkouts?: boolean;
  corosAthleteId?: string;
  corosAthleteName?: string;
  wahooConfigured?: boolean;
  wahooConnected?: boolean;
  wahooScope?: string;
  wahooCanPushWorkouts?: boolean;
  wahooAthleteId?: string;
  wahooAthleteName?: string;
  polarConfigured?: boolean;
  polarConnected?: boolean;
  polarCanPushWorkouts?: boolean;
  polarAthleteId?: string;
  polarAthleteName?: string;
  hasGeminiServerKey?: boolean;
  callbackUrl?: string;
  sessionToken?: string;
  lastSyncedAt?: string;
  nextHourlySyncAt?: string;
  stravaActivitiesCount?: number;
  athleteProfile?: Partial<AthleteProfile>;
  mapTileProvider?: MapTileProvider;
  mapTileApiKeyConfigured?: boolean;
  mapTileApiKey?: string;
}

export interface StravaExchangeResponse extends StravaTokenHandshakePayload {
  tokens?: StravaTokenHandshakePayload;
  sessionToken?: string;
  hasExistingSyncPolicy?: boolean;
}

export interface OAuthUrlResponse {
  url?: string;
  state?: string;
  sessionToken?: string;
}

export type ApiJsonResponse<T extends object = Record<string, unknown>> = T & {
  error?: string;
};

export interface StoredClientStravaSyncPolicy {
  window?: string;
  importProfileAndGear?: boolean;
  confirmedAt?: string;
  grantedScope?: string;
}

const STRAVA_SYNC_POLICY_STORAGE_KEY = 'aeropulse_strava_sync_policy';

export function isBrowserSessionLoggedOut(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('aeropulse_logged_out') === '1';
  } catch {
    return false;
  }
}

export function saveStravaSyncPolicyToStorage(policy?: StoredClientStravaSyncPolicy | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!policy) {
      localStorage.removeItem(STRAVA_SYNC_POLICY_STORAGE_KEY);
      return;
    }
    if (isBrowserSessionLoggedOut()) return;
    localStorage.setItem(STRAVA_SYNC_POLICY_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // ignore storage quota errors
  }
}

export function loadStravaSyncPolicyFromStorage(): StoredClientStravaSyncPolicy | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STRAVA_SYNC_POLICY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredClientStravaSyncPolicy;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function hasPendingTeamJoinInBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (/^\/join\/[^/?#]+/i.test(window.location.pathname)) {
      return true;
    }
    const params = new URLSearchParams(window.location.search);
    if ((params.get('join') || params.get('team') || '').trim()) {
      return true;
    }
    const saved = window.sessionStorage?.getItem('thresh_pending_team_join_v1');
    if (saved) {
      const parsed = JSON.parse(saved) as { codeOrSlug?: string };
      if (parsed?.codeOrSlug?.trim()) {
        return true;
      }
    }
  } catch {
    // ignore storage/URL parse errors
  }
  return false;
}

export function saveRotatedStravaTokensToStorage(tokens?: RotatedStravaTokenPayload | null) {
  if (!tokens) return;
  if (isBrowserSessionLoggedOut()) return;
  try {
    if (tokens.refreshToken) {
      localStorage.setItem('aeropulse_strava_refresh_token', tokens.refreshToken.trim());
    }
    if (tokens.accessToken) {
      localStorage.setItem('aeropulse_strava_access_token', tokens.accessToken.trim());
    }
    if (tokens.expiresAt && tokens.expiresAt > 0) {
      localStorage.setItem('aeropulse_strava_expires_at', String(tokens.expiresAt));
    }
    if (tokens.clientId) {
      localStorage.setItem('aeropulse_strava_client_id', tokens.clientId.trim());
    }
    if (tokens.athleteId) {
      localStorage.setItem('aeropulse_strava_athlete_id', String(tokens.athleteId).trim());
    }
    if (tokens.athleteName && !isGenericAthleteName(tokens.athleteName)) {
      localStorage.setItem('aeropulse_strava_athlete_name', tokens.athleteName.trim());
    }
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Strips whitespace and non-ASCII / control characters so HTTP fetch() headers never throw TypeError.
 */
export function sanitizeHttpHeaderValue(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let out = '';
  const trimmed = raw.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      out += trimmed[i];
    }
  }
  return out;
}

/**
 * Decodes an encoded Google/Strava polyline string (1e5 precision) into [lat, lng] pairs.
 */
export function decodeGooglePolylineClient(encoded?: string): [number, number][] | undefined {
  if (!encoded || typeof encoded !== 'string') return undefined;
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
  return points.length >= 2 ? points : undefined;
}

export function getSavedIntervalsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const setClean = (key: string, val?: string | null) => {
    const clean = sanitizeHttpHeaderValue(val);
    if (clean) headers[key] = clean;
  };
  try {
    const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
    const apiKey = localStorage.getItem('aeropulse_intervals_api_key') || '';
    const athleteId = localStorage.getItem('aeropulse_intervals_athlete_id') || '0';
    if (apiKey && notLoggedOut) {
      setClean('x-intervals-api-key', apiKey);
      headers['x-intervals-athlete-id'] = sanitizeHttpHeaderValue(athleteId) || '0';
    }
    const stravaClientId = localStorage.getItem('aeropulse_strava_client_id') || '';
    const stravaClientSecret = localStorage.getItem('aeropulse_strava_client_secret') || '';
    const stravaRefreshToken = localStorage.getItem('aeropulse_strava_refresh_token') || '';
    const stravaAccessToken = localStorage.getItem('aeropulse_strava_access_token') || '';
    const stravaExpiresAt = localStorage.getItem('aeropulse_strava_expires_at') || '';
    const mapTileApiKey = localStorage.getItem('aeropulse_map_tile_api_key') || '';
    const mapTileProvider = localStorage.getItem('aeropulse_map_tile_provider') || '';
    const geminiApiKey = localStorage.getItem('aeropulse_gemini_api_key') || '';
    if (stravaClientId && notLoggedOut) setClean('x-strava-client-id', stravaClientId);
    if (stravaClientSecret && notLoggedOut) setClean('x-strava-client-secret', stravaClientSecret);
    if (stravaRefreshToken && notLoggedOut) setClean('x-strava-refresh-token', stravaRefreshToken);
    if (stravaAccessToken && notLoggedOut) setClean('x-strava-access-token', stravaAccessToken);
    if (stravaExpiresAt && notLoggedOut) setClean('x-strava-expires-at', stravaExpiresAt);
    if (notLoggedOut) {
      const savedPolicy = loadStravaSyncPolicyFromStorage();
      if (savedPolicy?.window) {
        setClean('x-strava-sync-window', savedPolicy.window);
        headers['x-strava-import-gear'] = savedPolicy.importProfileAndGear === false ? '0' : '1';
      }
    }
    if (mapTileApiKey && notLoggedOut) setClean('x-map-tile-api-key', mapTileApiKey);
    if (mapTileProvider && notLoggedOut) setClean('x-map-tile-provider', mapTileProvider);
    if (geminiApiKey && notLoggedOut) setClean('x-gemini-api-key', geminiApiKey);
    const garminPersonalKey = localStorage.getItem('aeropulse_garmin_personal_api_key');
    const garminBearer = localStorage.getItem('aeropulse_garmin_bearer_token');
    const garminOauth1 = localStorage.getItem('aeropulse_garmin_oauth1_token');
    const garminSecret = localStorage.getItem('aeropulse_garmin_oauth1_secret');
    if (garminPersonalKey && notLoggedOut) setClean('x-garmin-personal-api-key', garminPersonalKey);
    if (garminBearer && notLoggedOut) setClean('x-garmin-bearer-token', garminBearer);
    if (garminOauth1 && notLoggedOut) setClean('x-garmin-oauth1-token', garminOauth1);
    if (garminSecret && notLoggedOut) setClean('x-garmin-oauth1-secret', garminSecret);
  } catch {
    // ignore
  }
  return headers;
}

export async function safeParseResponseJson<T extends object = Record<string, unknown>>(
  resp: Response
): Promise<ApiJsonResponse<T>> {
  const text = await resp.text();
  try {
    return JSON.parse(text) as ApiJsonResponse<T>;
  } catch {
    const isHtml = /<!doctype html/i.test(text) || /<html/i.test(text);
    const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    return {
      error: `Server returned non-JSON (${resp.status} ${resp.statusText})${
        isHtml ? ' HTML error page' : ''
      }${snippet ? `: ${snippet}` : ''}`,
    } as ApiJsonResponse<T>;
  }
}
