import {
  countPendingFieldOutboxEntries,
  loadFieldOutbox,
} from './fieldEventsOutbox';
import {
  countPendingStopwatchOutboxEntries,
  listDeadLetterStopwatchBatches,
  loadStopwatchOutbox,
} from './stopwatchTeamSync';
import { STORAGE_KEYS } from './storageKeys';
import type { ConnectionStatus } from '../types';

export interface SupportDiagnosticsConnectionSummary {
  wahooScope?: string;
  wahooCanPushWorkouts?: boolean;
  polarCanPushWorkouts?: boolean;
}

export interface BuildSupportDiagnosticsOptions {
  source?: string;
  restoreTab?: string;
  boundaryError?: unknown;
  componentStack?: string;
  persistedWorkoutCount?: number;
  idbSavedAt?: string | null;
  connectionStatus?: Partial<ConnectionStatus> & SupportDiagnosticsConnectionSummary;
  skipHealthProbe?: boolean;
  healthProbeTimeoutMs?: number;
}

export interface SupportDiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
  app: {
    version: string;
    buildTimestamp: string;
  };
  environment: {
    hostname: string;
    routePathname: string;
    online: boolean;
    viewport: {
      width: number;
      height: number;
      devicePixelRatio: number;
    } | null;
  };
  serviceWorker: {
    supported: boolean;
    registered: boolean;
    state: string | null;
    hasWaitingUpdate: boolean;
    scopePathname: string | null;
  };
  outboxes: {
    stopwatch: {
      pendingBatches: number;
      pendingEntries: number;
      deadLetterBatches: number;
      maxAttemptsSeen: number;
    };
    field: {
      pendingBatches: number;
      pendingEntries: number;
      maxAttemptsSeen: number;
    };
  };
  storage: {
    cloudStateDirty: boolean;
    localCachePresent: boolean;
    persistedWorkoutCount: number;
  };
  featureFlags: {
    plainLanguage: boolean;
    darkTheme: boolean;
    duskMode: boolean;
    sampleDemoActive: boolean;
    hasSessionHint: boolean;
    standalonePwa: boolean;
  };
  providers?: {
    vaultStorageBackend?: 'POSTGRES' | 'ENCRYPTED_FILE';
    stravaConnected: boolean;
    garminConnected: boolean;
    intervalsConnected: boolean;
    intervalsCanWriteCalendar: boolean;
    wahooConnected: boolean;
    wahooCanPushWorkouts: boolean;
    polarConnected: boolean;
    corosConnected: boolean;
    hasGeminiServerKey: boolean;
  };
  healthProbe: {
    attempted: boolean;
    ok: boolean | null;
    httpStatus?: number;
    latencyMs?: number;
    storageBackend?: string;
    databaseConfigured?: boolean;
    databaseHealthy?: boolean | null;
    reason?: string;
    error?: string;
  };
  boundaryError: {
    name: string;
    message: string;
    restoreTab?: string;
    stackPreview?: string;
  } | null;
}

const URL_WITH_QUERY_RE = /(https?:\/\/[^\s?#"'`]+)\?[^\s#"'`]*/gi;
const PATH_WITH_QUERY_RE = /(\/[A-Za-z0-9_./:-]*)\?[^\s#"'`]+/g;
const HASH_TOKEN_RE = /#[^\s"'`]*(?:access_token|refresh_token|id_token|token|code|secret|sig)=[^\s"'`]+/gi;
const SLUG_PATH_RE = /(\/(?:join|team)\/)[^/\s?#"'`]+/gi;
const BEARER_AUTH_RE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi;
const JWT_TOKEN_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g;
const SECRET_KV_RE = /\b(access_token|refresh_token|id_token|token|secret|password|apikey|api_key|session|authorization|cookie|set-cookie)\s*([:=])\s*(?!\[redacted-)[^\s,;'"}\]]+/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

/**
 * Redacts emails, Bearer/JWT/secret tokens, team/join slugs, and URL query strings
 * before any error message or stack line enters diagnostics output.
 */
export function redactDiagnosticString(raw: unknown, maxLen = 400): string {
  const str = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '');
  return str
    .replace(URL_WITH_QUERY_RE, '$1?[redacted-query]')
    .replace(PATH_WITH_QUERY_RE, '$1?[redacted-query]')
    .replace(HASH_TOKEN_RE, '#[redacted-hash]')
    .replace(SLUG_PATH_RE, '$1:slug')
    .replace(BEARER_AUTH_RE, '[redacted-auth]')
    .replace(JWT_TOKEN_RE, '[redacted-jwt]')
    .replace(SECRET_KV_RE, '$1$2[redacted-secret]')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizePathnameOnly(rawPath?: string): string {
  const base = String(rawPath || '/')
    .split('?')[0]
    .split('#')[0]
    .trim();
  const normalized = `/${base.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  if (/^\/join\/.+/i.test(normalized)) return '/join/:slug';
  if (/^\/team\/.+/i.test(normalized)) return '/team/:slug';
  return redactDiagnosticString(normalized, 120) || '/';
}

function safeReadLocalStorageFlag(key: string): boolean {
  const storage =
    typeof localStorage !== 'undefined'
      ? localStorage
      : typeof window !== 'undefined'
        ? window.localStorage
        : undefined;
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

async function readServiceWorkerMetadata(): Promise<SupportDiagnosticsSnapshot['serviceWorker']> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !navigator.serviceWorker ||
    typeof navigator.serviceWorker.getRegistration !== 'function'
  ) {
    return {
      supported: false,
      registered: false,
      state: null,
      hasWaitingUpdate: false,
      scopePathname: null,
    };
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      return {
        supported: true,
        registered: false,
        state: null,
        hasWaitingUpdate: false,
        scopePathname: null,
      };
    }

    const activeOrInstalling = reg.active || reg.waiting || reg.installing || null;
    let scopePathname: string | null = null;
    if (reg.scope) {
      try {
        scopePathname = sanitizePathnameOnly(new URL(reg.scope).pathname);
      } catch {
        scopePathname = '/';
      }
    }

    return {
      supported: true,
      registered: true,
      state: activeOrInstalling?.state ? String(activeOrInstalling.state) : null,
      hasWaitingUpdate: Boolean(reg.waiting),
      scopePathname,
    };
  } catch {
    return {
      supported: true,
      registered: false,
      state: 'unavailable',
      hasWaitingUpdate: false,
      scopePathname: null,
    };
  }
}

async function probeApiHealth(
  timeoutMs: number
): Promise<SupportDiagnosticsSnapshot['healthProbe']> {
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  if (!isOnline) {
    return { attempted: false, ok: null, reason: 'offline' };
  }
  if (typeof fetch !== 'function') {
    return { attempted: false, ok: null, reason: 'fetch_unavailable' };
  }

  const startedAt = Date.now();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout === 'function'
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const resp = await fetch('/api/health', {
      method: 'GET',
      credentials: 'omit',
      ...(controller ? { signal: controller.signal } : {}),
    });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const data = (await resp.json().catch(() => null)) as {
      ok?: unknown;
      storageBackend?: unknown;
      databaseConfigured?: unknown;
      databaseHealthy?: unknown;
    } | null;

    return {
      attempted: true,
      ok: Boolean(resp.ok && (data ? data.ok !== false : true)),
      httpStatus: resp.status,
      latencyMs,
      ...(typeof data?.storageBackend === 'string'
        ? { storageBackend: redactDiagnosticString(data.storageBackend, 32) }
        : {}),
      ...(typeof data?.databaseConfigured === 'boolean'
        ? { databaseConfigured: data.databaseConfigured }
        : {}),
      ...(typeof data?.databaseHealthy === 'boolean' || data?.databaseHealthy === null
        ? { databaseHealthy: data.databaseHealthy }
        : {}),
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      latencyMs: Math.max(0, Date.now() - startedAt),
      error: redactDiagnosticString(err, 160) || 'health_probe_failed',
    };
  } finally {
    if (timer !== null && typeof clearTimeout === 'function') {
      clearTimeout(timer);
    }
  }
}

function formatRedactedBoundaryError(
  opts?: BuildSupportDiagnosticsOptions
): SupportDiagnosticsSnapshot['boundaryError'] {
  if (!opts?.boundaryError) return null;
  const err = opts.boundaryError;
  const rawName =
    err instanceof Error && err.name
      ? err.name
      : typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          typeof (err as { name?: unknown }).name === 'string'
        ? (err as { name: string }).name
        : 'Error';
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'object' &&
          err !== null &&
          'message' in err &&
          typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);
  const rawStack =
    err instanceof Error && err.stack ? err.stack : opts.componentStack || '';

  return {
    name: redactDiagnosticString(rawName, 64) || 'Error',
    message: redactDiagnosticString(rawMessage, 320) || 'Unexpected error',
    ...(opts.restoreTab ? { restoreTab: redactDiagnosticString(opts.restoreTab, 40) } : {}),
    ...(rawStack
      ? {
          stackPreview: redactDiagnosticString(
            rawStack.split('\n').slice(0, 4).join(' | '),
            320
          ),
        }
      : {}),
  };
}

/**
 * Builds a zero-PII, redacted support diagnostics snapshot safe to attach to bug reports
 * or school IT tickets. Never includes tokens, cookies, emails, names, IDs, query params,
 * workouts, HRV/readiness notes, or GPS routes.
 */
export async function buildSupportDiagnosticsSnapshot(
  opts?: BuildSupportDiagnosticsOptions
): Promise<SupportDiagnosticsSnapshot> {
  const appVersion =
    typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : '2.1.0';
  const buildTimestamp =
    typeof __BUILD_TIMESTAMP__ !== 'undefined' ? String(__BUILD_TIMESTAMP__) : 'dev';

  const hasWindow = typeof window !== 'undefined';
  const hostname = hasWindow
    ? redactDiagnosticString(window.location?.hostname || 'localhost', 80) || 'localhost'
    : 'ssr';
  const routePathname = hasWindow
    ? sanitizePathnameOnly(window.location?.pathname)
    : '/';
  const online =
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const viewport =
    hasWindow && typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number'
      ? {
          width: Math.max(0, Math.round(window.innerWidth)),
          height: Math.max(0, Math.round(window.innerHeight)),
          devicePixelRatio: Number(window.devicePixelRatio || 1),
        }
      : null;

  const stopwatchBatches = loadStopwatchOutbox();
  const stopwatchDeadLetters = listDeadLetterStopwatchBatches();
  const fieldBatches = loadFieldOutbox();

  const [serviceWorker, healthProbe] = await Promise.all([
    readServiceWorkerMetadata(),
    opts?.skipHealthProbe
      ? Promise.resolve({ attempted: false, ok: null, reason: 'skipped' })
      : probeApiHealth(opts?.healthProbeTimeoutMs ?? 2500),
  ]);

  const status = opts?.connectionStatus;
  const wahooScopeTokens = String(status?.wahooScope || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const wahooCanPush = Boolean(
    status?.wahooCanPushWorkouts ||
      wahooScopeTokens.includes('workouts_write') ||
      wahooScopeTokens.includes('plans_write')
  );

  const standalonePwa =
    hasWindow && typeof window.matchMedia === 'function'
      ? Boolean(window.matchMedia('(display-mode: standalone)').matches)
      : false;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: redactDiagnosticString(opts?.source || 'manual', 64) || 'manual',
    app: {
      version: appVersion,
      buildTimestamp,
    },
    environment: {
      hostname,
      routePathname,
      online,
      viewport,
    },
    serviceWorker,
    outboxes: {
      stopwatch: {
        pendingBatches: stopwatchBatches.length,
        pendingEntries: countPendingStopwatchOutboxEntries(),
        deadLetterBatches: stopwatchDeadLetters.length,
        maxAttemptsSeen: stopwatchBatches.reduce(
          (max, b) => Math.max(max, Number(b.attempts || 0)),
          0
        ),
      },
      field: {
        pendingBatches: fieldBatches.length,
        pendingEntries: countPendingFieldOutboxEntries(),
        maxAttemptsSeen: fieldBatches.reduce(
          (max, b) => Math.max(max, Number(b.attempts || 0)),
          0
        ),
      },
    },
    storage: {
      cloudStateDirty: safeReadLocalStorageFlag(STORAGE_KEYS.CLOUD_STATE_DIRTY),
      localCachePresent: Boolean(opts?.idbSavedAt) || (opts?.persistedWorkoutCount ?? 0) > 0,
      persistedWorkoutCount: Math.max(0, Math.floor(opts?.persistedWorkoutCount ?? 0)),
    },
    featureFlags: {
      plainLanguage: safeReadLocalStorageFlag(STORAGE_KEYS.PLAIN_LANGUAGE),
      darkTheme: safeReadLocalStorageFlag(STORAGE_KEYS.THEME_DARK),
      duskMode: safeReadLocalStorageFlag(STORAGE_KEYS.DUSK_MODE),
      sampleDemoActive: safeReadLocalStorageFlag(STORAGE_KEYS.SAMPLE_DEMO_ACTIVE),
      hasSessionHint: safeReadLocalStorageFlag(STORAGE_KEYS.SESSION_ACTIVE_HINT),
      standalonePwa,
    },
    ...(status
      ? {
          providers: {
            ...(status.vaultStorageBackend
              ? { vaultStorageBackend: status.vaultStorageBackend }
              : {}),
            stravaConnected: Boolean(status.stravaConnected),
            garminConnected: Boolean(status.garminConnected),
            intervalsConnected: Boolean(status.intervalsConnected),
            intervalsCanWriteCalendar: Boolean(status.intervalsCanWriteCalendar),
            wahooConnected: Boolean(status.wahooConnected),
            wahooCanPushWorkouts: wahooCanPush,
            polarConnected: Boolean(status.polarConnected),
            corosConnected: Boolean(status.corosConnected),
            hasGeminiServerKey: Boolean(status.hasGeminiServerKey),
          },
        }
      : {}),
    healthProbe,
    boundaryError: formatRedactedBoundaryError(opts),
  };
}

/**
 * Generates and downloads a redacted JSON diagnostics bundle (`meetready-diagnostics-YYYY-MM-DD.json`).
 */
export async function downloadSupportDiagnosticsJson(
  opts?: BuildSupportDiagnosticsOptions
): Promise<{
  snapshot: SupportDiagnosticsSnapshot;
  downloaded: boolean;
  filename: string;
}> {
  const snapshot = await buildSupportDiagnosticsSnapshot(opts);
  const dateTag = snapshot.generatedAt.slice(0, 10);
  const filename = `meetready-diagnostics-${dateTag}.json`;

  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return { snapshot, downloaded: false, filename };
  }

  try {
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
    return { snapshot, downloaded: true, filename };
  } catch {
    return { snapshot, downloaded: false, filename };
  }
}
