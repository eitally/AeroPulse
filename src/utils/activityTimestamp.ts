/**
 * Timezone- and DST-safe canonical activity timestamp helpers (`RT-12`).
 * Pure TypeScript (zero DOM dependencies) shared across `src/` and `server/`.
 */

export interface ActivityTimestampSource {
  startDateLocal?: string | null;
  startDateUtc?: string | null;
  startDateUtcMs?: number;
  utcOffsetSecs?: number;
  timeZoneOffsetMins?: number;
  startLatLng?: [number, number];
  fallbackBrowserTz?: boolean;
}

export interface ActivityTimestampPair {
  startDateLocal: string;
  startDateUtcMs?: number;
}

const HAS_EXPLICIT_TZ_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const WALL_CLOCK_PARTS_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function pad2(n: number): string {
  return String(Math.trunc(n)).padStart(2, '0');
}

/**
 * Formats an epoch ms instant shifted by `offsetMinutes` into floating wall-clock `YYYY-MM-DDTHH:mm:ss` (no `Z`).
 */
export function formatWallClockIsoFromUtcMs(
  utcMs: number,
  offsetMinutes: number
): string {
  const safeOffsetMins = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const shifted = new Date(utcMs + safeOffsetMins * 60_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate()
  )}T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(
    shifted.getUTCSeconds()
  )}`;
}

/**
 * Formats a `Date` using the current JS runtime's local calendar/clock into floating `YYYY-MM-DDTHH:mm:ss`.
 */
export function formatLocalWallClockFromDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * Rough solar/hourly timezone offset fallback from GPS longitude when device/user offset is absent.
 */
export function estimateUtcOffsetMinutesFromLon(lonDeg: number): number {
  if (!Number.isFinite(lonDeg) || lonDeg < -180 || lonDeg > 180) return 0;
  const hours = Math.round(lonDeg / 15);
  return Math.max(-720, Math.min(840, hours * 60));
}

/**
 * Computes exact UTC offset in minutes (e.g. `-420` for PDT, `540` for JST) for an IANA timezone at `utcMs`.
 */
export function resolveIanaTimeZoneOffsetMinutes(
  utcMs: number,
  timeZone?: string | null
): number | undefined {
  if (!timeZone || typeof timeZone !== 'string' || !Number.isFinite(utcMs)) {
    return undefined;
  }
  const cleanTz = timeZone.trim();
  if (!cleanTz) return undefined;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: cleanTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const lookup: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        lookup[p.type] = Number(p.value);
      }
    }
    if (
      !Number.isFinite(lookup.year) ||
      !Number.isFinite(lookup.month) ||
      !Number.isFinite(lookup.day) ||
      !Number.isFinite(lookup.hour) ||
      !Number.isFinite(lookup.minute) ||
      !Number.isFinite(lookup.second)
    ) {
      return undefined;
    }
    const hourNorm = lookup.hour === 24 ? 0 : lookup.hour;
    const asUtcMs = Date.UTC(
      lookup.year,
      lookup.month - 1,
      lookup.day,
      hourNorm,
      lookup.minute,
      lookup.second
    );
    const truncatedUtcMs = Math.floor(utcMs / 1000) * 1000;
    const offsetMins = Math.round((asUtcMs - truncatedUtcMs) / 60_000);
    return Math.max(-720, Math.min(840, offsetMins));
  } catch {
    return undefined;
  }
}

/**
 * Parses an ISO string to epoch ms ONLY if it carries an explicit `Z` or `±HH:MM` timezone suffix.
 */
export function parseIsoWithExplicitOffsetToUtcMs(
  iso?: string | null
): number | null {
  if (typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (!trimmed || !HAS_EXPLICIT_TZ_SUFFIX_RE.test(trimmed)) return null;
  const normalized = trimmed.includes(' ') && !trimmed.includes('T')
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Strips fractional seconds and trailing `Z` or `±HH:MM` offset, returning floating `YYYY-MM-DDTHH:mm:ss`.
 */
export function stripTimezoneSuffix(iso: string): string {
  const trimmed = String(iso || '').trim().replace(' ', 'T');
  const match = trimmed.match(WALL_CLOCK_PARTS_RE);
  if (match) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  return trimmed
    .replace(/\.\d+(?=(Z|[+-]\d{2}:?\d{2})?$)/i, '')
    .replace(HAS_EXPLICIT_TZ_SUFFIX_RE, '');
}

function parseFloatingWallClockAsUtcMs(floatingIso: string): number | null {
  const match = stripTimezoneSuffix(floatingIso).match(WALL_CLOCK_PARTS_RE);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4] || 0);
  const mm = Number(match[5] || 0);
  const ss = Number(match[6] || 0);
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Number.isFinite(ms) ? ms : null;
}

function resolveExplicitOffsetMinutes(input: ActivityTimestampSource): number | undefined {
  if (typeof input.timeZoneOffsetMins === 'number' && Number.isFinite(input.timeZoneOffsetMins)) {
    return Math.max(-720, Math.min(840, Math.round(input.timeZoneOffsetMins)));
  }
  if (typeof input.utcOffsetSecs === 'number' && Number.isFinite(input.utcOffsetSecs)) {
    return Math.max(-720, Math.min(840, Math.round(input.utcOffsetSecs / 60)));
  }
  return undefined;
}

/**
 * Normalizes a provider's local/UTC timestamps into:
 * - `startDateLocal`: true recording wall-clock `YYYY-MM-DDTHH:mm:ss` (never ending in `Z`)
 * - `startDateUtcMs`: canonical UTC epoch milliseconds for timezone- and DST-safe deduplication
 */
export function normalizeActivityTimestamps(
  input: ActivityTimestampSource
): ActivityTimestampPair {
  const rawLocal = typeof input.startDateLocal === 'string' ? input.startDateLocal.trim() : '';
  const explicitOffsetMins = resolveExplicitOffsetMinutes(input);
  const validLatLng =
    Array.isArray(input.startLatLng) &&
    input.startLatLng.length >= 2 &&
    Number.isFinite(input.startLatLng[1]) &&
    Math.abs(input.startLatLng[0]) <= 90 &&
    Math.abs(input.startLatLng[1]) <= 180 &&
    (Math.abs(input.startLatLng[0]) > 0.01 || Math.abs(input.startLatLng[1]) > 0.01);

  const localHasNonUtcOffset = /[+-]\d{2}:?\d{2}$/.test(rawLocal);
  const localEndsWithZ = /Z$/i.test(rawLocal);

  let resolvedUtcMs: number | undefined =
    typeof input.startDateUtcMs === 'number' && Number.isFinite(input.startDateUtcMs) && input.startDateUtcMs > 0
      ? Math.round(input.startDateUtcMs)
      : undefined;

  if (resolvedUtcMs === undefined && input.startDateUtc) {
    const parsedUtc = parseIsoWithExplicitOffsetToUtcMs(
      HAS_EXPLICIT_TZ_SUFFIX_RE.test(input.startDateUtc.trim())
        ? input.startDateUtc
        : `${input.startDateUtc.trim().replace(' ', 'T')}Z`
    );
    if (parsedUtc !== null) resolvedUtcMs = parsedUtc;
  }

  if (resolvedUtcMs === undefined && rawLocal && HAS_EXPLICIT_TZ_SUFFIX_RE.test(rawLocal)) {
    const parsedLocalOffset = parseIsoWithExplicitOffsetToUtcMs(rawLocal);
    if (parsedLocalOffset !== null) resolvedUtcMs = parsedLocalOffset;
  }

  if (resolvedUtcMs === undefined && rawLocal && !localEndsWithZ) {
    const floatingUtcMs = parseFloatingWallClockAsUtcMs(rawLocal);
    if (floatingUtcMs !== null) {
      if (explicitOffsetMins !== undefined) {
        resolvedUtcMs = floatingUtcMs - explicitOffsetMins * 60_000;
      } else if (validLatLng) {
        resolvedUtcMs =
          floatingUtcMs - estimateUtcOffsetMinutesFromLon(input.startLatLng![1]) * 60_000;
      }
    }
  }

  let resolvedLocal = '';
  if (rawLocal && (localHasNonUtcOffset || (!localEndsWithZ && rawLocal.length >= 10))) {
    resolvedLocal = stripTimezoneSuffix(rawLocal);
  } else if (resolvedUtcMs !== undefined) {
    if (explicitOffsetMins !== undefined) {
      resolvedLocal = formatWallClockIsoFromUtcMs(resolvedUtcMs, explicitOffsetMins);
    } else if (validLatLng) {
      resolvedLocal = formatWallClockIsoFromUtcMs(
        resolvedUtcMs,
        estimateUtcOffsetMinutesFromLon(input.startLatLng![1])
      );
    } else if (input.fallbackBrowserTz) {
      resolvedLocal = formatLocalWallClockFromDate(new Date(resolvedUtcMs));
    } else {
      resolvedLocal = formatWallClockIsoFromUtcMs(resolvedUtcMs, 0);
    }
  } else if (rawLocal) {
    resolvedLocal = stripTimezoneSuffix(rawLocal);
  } else {
    const nowMs = Date.now();
    resolvedLocal = formatLocalWallClockFromDate(new Date(nowMs));
    if (resolvedUtcMs === undefined) resolvedUtcMs = nowMs;
  }

  return {
    startDateLocal: resolvedLocal,
    ...(resolvedUtcMs !== undefined ? { startDateUtcMs: resolvedUtcMs } : {}),
  };
}

/**
 * Resolves the canonical epoch ms for sorting and delta-sync comparisons.
 */
export function resolveActivityStartEpochMs(
  act: { startDateUtcMs?: number; startDateLocal?: string } | null | undefined
): number {
  if (!act) return 0;
  if (
    typeof act.startDateUtcMs === 'number' &&
    Number.isFinite(act.startDateUtcMs) &&
    act.startDateUtcMs > 0
  ) {
    return act.startDateUtcMs;
  }
  const parsed = act.startDateLocal ? Date.parse(act.startDateLocal) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveComparableUtcMs(act: {
  startDateUtcMs?: number;
  startDateLocal?: string;
}): number | null {
  if (
    typeof act.startDateUtcMs === 'number' &&
    Number.isFinite(act.startDateUtcMs) &&
    act.startDateUtcMs > 0
  ) {
    return act.startDateUtcMs;
  }
  return parseIsoWithExplicitOffsetToUtcMs(act.startDateLocal);
}

/**
 * Returns true if two activities started within `windowSecs` (default ±300s / 5 min) in UTC instant space,
 * avoiding timezone/DST and trailing-`Z` mismatches during multi-provider deduplication.
 */
export function areActivityTimestampsClose(
  a: { startDateUtcMs?: number; startDateLocal?: string },
  b: { startDateUtcMs?: number; startDateLocal?: string },
  windowSecs = 300
): boolean {
  const utcA = resolveComparableUtcMs(a);
  const utcB = resolveComparableUtcMs(b);
  if (utcA !== null && utcB !== null) {
    return Math.abs(utcA - utcB) / 1000 <= windowSecs;
  }
  if (!a.startDateLocal || !b.startDateLocal) return false;
  const parsedA = Date.parse(a.startDateLocal);
  const parsedB = Date.parse(b.startDateLocal);
  if (Number.isNaN(parsedA) || Number.isNaN(parsedB)) return false;
  return Math.abs(parsedA - parsedB) / 1000 <= windowSecs;
}

/**
 * Parses an optional timezone offset header/query value (`-720` to `840` mins).
 */
export function parseClientTzOffsetMins(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n < -720 || n > 840) return undefined;
  return Math.round(n);
}
