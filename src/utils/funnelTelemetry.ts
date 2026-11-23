import { getStoredCoachAttribution } from './attribution';

export type FunnelEventName =
  | 'landing_view'
  | 'demo_enter'
  | 'auth_complete'
  | 'team_created'
  | 'workout_published'
  | 'po_generated'
  | 'stripe_checkout_started';

export type FunnelEventRole = 'COACH' | 'ATHLETE' | 'ORG_ADMIN' | 'UNKNOWN';

export type FunnelEventTier =
  | 'FREE_FOUNDING'
  | 'HS_250'
  | 'COLLEGIATE_1200'
  | 'DISTRICT_2000'
  | 'HIGH_SCHOOL'
  | 'COLLEGIATE'
  | 'RUNNING_CLUB'
  | 'COACH_SQUAD'
  | 'DEMO_COACH'
  | 'DEMO_ATHLETE';

export interface EmitFunnelEventOptions {
  role?: FunnelEventRole;
  tier?: FunnelEventTier;
  isMinorUser?: boolean;
  dedupeSessionKey?: string;
  useBeacon?: boolean;
}

const DEDUPE_STORAGE_PREFIX = 'meetready_funnel_dedupe_v1:';

function normalizeTelemetryPathname(rawPath?: string): string {
  const base = String(rawPath || '/')
    .split('?')[0]
    .split('#')[0]
    .trim();
  const normalized = `/${base.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  if (/^\/join\/.+/i.test(normalized)) return '/join/:slug';
  if (/^\/team\/.+/i.test(normalized)) return '/team/:slug';
  return normalized.slice(0, 80) || '/';
}

/**
 * Emits a first-party, zero-cookie, COPPA/FERPA-safe funnel conversion counter.
 * Excluded unconditionally for minor/student accounts (`isMinorUser: true`), SSR, and duplicate session keys.
 */
export function emitFunnelEvent(
  event: FunnelEventName,
  opts?: EmitFunnelEventOptions
): boolean {
  if (typeof window === 'undefined') return false;
  if (opts?.isMinorUser) return false;

  if (opts?.dedupeSessionKey) {
    const storageKey = `${DEDUPE_STORAGE_PREFIX}${opts.dedupeSessionKey}`;
    try {
      if (window.sessionStorage.getItem(storageKey) === '1') {
        return false;
      }
      window.sessionStorage.setItem(storageKey, '1');
    } catch {
      // Ignore storage errors (private mode / quota) and continue without crashing
    }
  }

  try {
    const attr = getStoredCoachAttribution();
    const landingPath = normalizeTelemetryPathname(
      attr?.landing_path || window.location.pathname
    );

    const payload: Record<string, string | undefined> = {
      event,
      role: opts?.role || 'UNKNOWN',
      tier: opts?.tier,
      utm_source: attr?.utm_source?.slice(0, 64),
      utm_medium: attr?.utm_medium?.slice(0, 64),
      utm_campaign: attr?.utm_campaign?.slice(0, 64),
      utm_content: attr?.utm_content?.slice(0, 64),
      src: attr?.src?.slice(0, 64),
      referrerHost: attr?.referrerHost?.slice(0, 80),
      landing_path: landingPath,
    };

    const bodyJson = JSON.stringify(payload);

    if (
      opts?.useBeacon &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      typeof Blob !== 'undefined'
    ) {
      const sent = navigator.sendBeacon(
        '/api/analytics/event',
        new Blob([bodyJson], { type: 'application/json' })
      );
      if (sent) return true;
    }

    if (typeof fetch === 'function') {
      void fetch('/api/analytics/event', {
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: bodyJson,
      }).catch(() => undefined);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
