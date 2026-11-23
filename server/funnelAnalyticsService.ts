import {
  getVaultStorageBackend,
  insertFunnelEventPostgresAsync,
  loadTenantVaultAsync,
  queryFunnelEventsPostgresAsync,
  saveTenantVaultAsync,
  withVaultLock,
  type FunnelEventDbRow,
} from './tokenVault.ts';

export const FUNNEL_EVENT_NAMES = [
  'landing_view',
  'demo_enter',
  'auth_complete',
  'team_created',
  'workout_published',
  'po_generated',
  'stripe_checkout_started',
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export const FUNNEL_ROLES = ['COACH', 'ATHLETE', 'ORG_ADMIN', 'UNKNOWN'] as const;
export type FunnelRole = (typeof FUNNEL_ROLES)[number];

export const FUNNEL_TIERS = [
  'FREE_FOUNDING',
  'HS_250',
  'COLLEGIATE_1200',
  'DISTRICT_2000',
  'HIGH_SCHOOL',
  'COLLEGIATE',
  'RUNNING_CLUB',
  'COACH_SQUAD',
  'DEMO_COACH',
  'DEMO_ATHLETE',
] as const;
export type FunnelTier = (typeof FUNNEL_TIERS)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(FUNNEL_EVENT_NAMES);
const ROLE_SET: ReadonlySet<string> = new Set(FUNNEL_ROLES);
const TIER_SET: ReadonlySet<string> = new Set(FUNNEL_TIERS);

export const FUNNEL_VAULT_KEY = 'funnel_events_v1';
export const MAX_VAULT_FUNNEL_EVENTS = 2000;

const EMAIL_IN_TEXT_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CONTROL_CHARS_RE = /[\r\n\t\x00-\x1f\x7f]+/g;
const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export interface SanitizedFunnelEventPayload {
  event_name: FunnelEventName;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  src?: string;
  referrer_host?: string;
  landing_path?: string;
  role: FunnelRole;
  tier?: FunnelTier;
}

export interface FunnelConversionRates {
  landingToDemoPct: number;
  landingToAuthPct: number;
  authToTeamPct: number;
  teamToWorkoutPct: number;
  teamToPoPct: number;
  teamToStripeCheckoutPct: number;
}

export interface FunnelDailyCount {
  date: string;
  total: number;
  byEvent: Record<FunnelEventName, number>;
}

export interface FunnelSummaryReport {
  windowDays: number;
  sinceIso: string;
  storageBackend: 'POSTGRES' | 'ENCRYPTED_FILE';
  totalEvents: number;
  byEvent: Record<FunnelEventName, number>;
  conversionRates: FunnelConversionRates;
  byUtmSource: Record<string, number>;
  byUtmMedium: Record<string, number>;
  byUtmCampaign: Record<string, number>;
  byReferrerHost: Record<string, number>;
  byRole: Record<string, number>;
  byTier: Record<string, number>;
  dailyCounts: FunnelDailyCount[];
}

export function isValidFunnelEventName(raw: unknown): raw is FunnelEventName {
  return typeof raw === 'string' && EVENT_NAME_SET.has(raw.trim());
}

function sanitizePlainTag(raw: unknown, maxLen = 64): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(EMAIL_IN_TEXT_RE, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned || undefined;
}

function sanitizeReferrerHost(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(CONTROL_CHARS_RE, '').trim();
  if (!trimmed) return undefined;
  if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('@')) {
    return undefined;
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`);
    const host = parsed.hostname.trim().toLowerCase().replace(/\.+$/, '').slice(0, 80);
    if (!host || !/^[a-z0-9.-]+$/.test(host) || IPV4_HOST_RE.test(host)) {
      return undefined;
    }
    return host;
  } catch {
    return undefined;
  }
}

function sanitizeLandingPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(CONTROL_CHARS_RE, '').trim();
  if (!trimmed) return undefined;

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return undefined;
    }
  } else {
    pathname = trimmed.split('?')[0].split('#')[0];
  }

  pathname = `/${pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const trimmedSlash = pathname.replace(/\/+$/, '');
    if (trimmedSlash) pathname = trimmedSlash;
  }

  if (/^\/join\/.+/i.test(pathname)) {
    return '/join/:slug';
  }
  if (/^\/team\/.+/i.test(pathname)) {
    return '/team/:slug';
  }

  const scrubbed = pathname.replace(EMAIL_IN_TEXT_RE, '[redacted]').slice(0, 80);
  return scrubbed || '/';
}

function sanitizeRole(raw: unknown): FunnelRole {
  if (typeof raw !== 'string') return 'UNKNOWN';
  const upper = raw.trim().toUpperCase();
  return ROLE_SET.has(upper) ? (upper as FunnelRole) : 'UNKNOWN';
}

function sanitizeTier(raw: unknown): FunnelTier | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.trim().toUpperCase();
  return TIER_SET.has(upper) ? (upper as FunnelTier) : undefined;
}

/**
 * Strictly allowlists and sanitizes incoming funnel telemetry payloads.
 * Drops all PII/session/identity fields (`email`, `name`, `userId`, `sid`, `teamId`, `ip`, `userAgent`).
 */
export function sanitizeFunnelEventInput(
  rawInput: Record<string, unknown>
): SanitizedFunnelEventPayload | null {
  const candidateEvent = rawInput.event ?? rawInput.eventName ?? rawInput.event_name;
  if (!isValidFunnelEventName(candidateEvent)) {
    return null;
  }
  const eventName = candidateEvent.trim() as FunnelEventName;

  const utm_source = sanitizePlainTag(rawInput.utm_source, 64);
  const utm_medium = sanitizePlainTag(rawInput.utm_medium, 64);
  const utm_campaign = sanitizePlainTag(rawInput.utm_campaign, 64);
  const utm_content = sanitizePlainTag(rawInput.utm_content, 64);
  const src = sanitizePlainTag(rawInput.src, 64);
  const referrer_host = sanitizeReferrerHost(rawInput.referrer_host ?? rawInput.referrerHost);
  const landing_path = sanitizeLandingPath(rawInput.landing_path ?? rawInput.landingPath);
  const role = sanitizeRole(rawInput.role);
  const tier = sanitizeTier(rawInput.tier);

  return {
    event_name: eventName,
    ...(utm_source ? { utm_source } : {}),
    ...(utm_medium ? { utm_medium } : {}),
    ...(utm_campaign ? { utm_campaign } : {}),
    ...(utm_content ? { utm_content } : {}),
    ...(src ? { src } : {}),
    ...(referrer_host ? { referrer_host } : {}),
    ...(landing_path ? { landing_path } : {}),
    role,
    ...(tier ? { tier } : {}),
  };
}

export async function recordFunnelEventAsync(
  rawInput: Record<string, unknown>
): Promise<{
  ok: boolean;
  status?: number;
  recorded?: boolean;
  storageBackend?: 'POSTGRES' | 'ENCRYPTED_FILE';
  event?: SanitizedFunnelEventPayload;
  error?: string;
}> {
  const sanitized = sanitizeFunnelEventInput(rawInput);
  if (!sanitized) {
    return { ok: false, status: 400, error: 'Invalid or unsupported funnel event.' };
  }

  const dbRow: Omit<FunnelEventDbRow, 'created_at'> = {
    event_name: sanitized.event_name,
    utm_source: sanitized.utm_source ?? null,
    utm_medium: sanitized.utm_medium ?? null,
    utm_campaign: sanitized.utm_campaign ?? null,
    utm_content: sanitized.utm_content ?? null,
    src: sanitized.src ?? null,
    referrer_host: sanitized.referrer_host ?? null,
    landing_path: sanitized.landing_path ?? null,
    role: sanitized.role,
    tier: sanitized.tier ?? null,
  };

  const insertedPg = await insertFunnelEventPostgresAsync(dbRow);
  if (insertedPg === true) {
    return {
      ok: true,
      recorded: true,
      storageBackend: 'POSTGRES',
      event: sanitized,
    };
  }

  const vaultRow: FunnelEventDbRow = {
    ...dbRow,
    created_at: new Date().toISOString(),
  };

  await withVaultLock(FUNNEL_VAULT_KEY, async () => {
    const existing = await loadTenantVaultAsync<FunnelEventDbRow[]>(FUNNEL_VAULT_KEY, []);
    const next = [...existing, vaultRow].slice(-MAX_VAULT_FUNNEL_EVENTS);
    await saveTenantVaultAsync(FUNNEL_VAULT_KEY, next);
  });

  return {
    ok: true,
    recorded: true,
    storageBackend: getVaultStorageBackend(),
    event: sanitized,
  };
}

function createEmptyEventCounts(): Record<FunnelEventName, number> {
  return {
    landing_view: 0,
    demo_enter: 0,
    auth_complete: 0,
    team_created: 0,
    workout_published: 0,
    po_generated: 0,
    stripe_checkout_started: 0,
  };
}

function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function incrementDimension(map: Record<string, number>, rawValue: string | null | undefined): void {
  const clean = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!clean) return;
  map[clean] = (map[clean] || 0) + 1;
}

export async function getFunnelSummaryAsync(opts?: {
  windowDays?: number;
}): Promise<FunnelSummaryReport> {
  const parsedDays = Number(opts?.windowDays);
  const windowDays =
    Number.isFinite(parsedDays) && parsedDays > 0
      ? Math.max(1, Math.min(365, Math.floor(parsedDays)))
      : 30;

  const sinceMs = Date.now() - windowDays * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();

  let storageBackend: 'POSTGRES' | 'ENCRYPTED_FILE' = getVaultStorageBackend();
  let rows = await queryFunnelEventsPostgresAsync(sinceIso, 25000);
  if (rows !== null) {
    storageBackend = 'POSTGRES';
  } else {
    const allVaultRows = await loadTenantVaultAsync<FunnelEventDbRow[]>(FUNNEL_VAULT_KEY, []);
    rows = allVaultRows.filter((row) => {
      if (!row?.created_at) return false;
      const ts = Date.parse(String(row.created_at));
      return Number.isFinite(ts) && ts >= sinceMs;
    });
  }

  const byEvent = createEmptyEventCounts();
  const byUtmSource: Record<string, number> = {};
  const byUtmMedium: Record<string, number> = {};
  const byUtmCampaign: Record<string, number> = {};
  const byReferrerHost: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const dailyMap = new Map<string, FunnelDailyCount>();

  let totalEvents = 0;

  for (const row of rows) {
    if (!row || !isValidFunnelEventName(row.event_name)) continue;
    const eventName = row.event_name;
    totalEvents += 1;
    byEvent[eventName] += 1;

    incrementDimension(byUtmSource, row.utm_source);
    incrementDimension(byUtmMedium, row.utm_medium);
    incrementDimension(byUtmCampaign, row.utm_campaign);
    incrementDimension(byReferrerHost, row.referrer_host);
    incrementDimension(byRole, row.role || 'UNKNOWN');
    incrementDimension(byTier, row.tier);

    const parsedDate = row.created_at ? new Date(String(row.created_at)) : null;
    const dateKey =
      parsedDate && Number.isFinite(parsedDate.getTime())
        ? parsedDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    let bucket = dailyMap.get(dateKey);
    if (!bucket) {
      bucket = {
        date: dateKey,
        total: 0,
        byEvent: createEmptyEventCounts(),
      };
      dailyMap.set(dateKey, bucket);
    }
    bucket.total += 1;
    bucket.byEvent[eventName] += 1;
  }

  const dailyCounts = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return {
    windowDays,
    sinceIso,
    storageBackend,
    totalEvents,
    byEvent,
    conversionRates: {
      landingToDemoPct: pct(byEvent.demo_enter, byEvent.landing_view),
      landingToAuthPct: pct(byEvent.auth_complete, byEvent.landing_view),
      authToTeamPct: pct(byEvent.team_created, byEvent.auth_complete),
      teamToWorkoutPct: pct(byEvent.workout_published, byEvent.team_created),
      teamToPoPct: pct(byEvent.po_generated, byEvent.team_created),
      teamToStripeCheckoutPct: pct(byEvent.stripe_checkout_started, byEvent.team_created),
    },
    byUtmSource,
    byUtmMedium,
    byUtmCampaign,
    byReferrerHost,
    byRole,
    byTier,
    dailyCounts,
  };
}
