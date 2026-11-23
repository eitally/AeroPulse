import type { SportCategory } from '../types.ts';

export type SharedWorkoutKind = 'WORKOUT' | 'STOPWATCH';

export interface SharedStopwatchSplitRow {
  label: string;
  lapTime: string;
  paceOrPower?: string;
  distanceMeters?: number;
  cumulativeTime?: string;
}

export interface SharedWorkoutPayload {
  kind: SharedWorkoutKind;
  version: 1;
  title: string;
  sport: SportCategory;
  date?: string;
  workoutSyntax?: string;
  plannedDurationSecs?: number;
  plannedLoad?: number;
  description?: string;
  authorLabel?: string;
  teamName?: string;
  defaultUnit?: 'mi' | 'km';
  referenceFtpWatts?: number;
  referenceThresholdPaceSecsPerKm?: number;
  splits?: SharedStopwatchSplitRow[];
}

export interface ComputedSharedStepPreview {
  index: number;
  label: string;
  stepKind: 'warmup' | 'work' | 'rest' | 'cooldown';
  durationSecs: number;
  durationLabel: string;
  intensityPct: number;
  prescribedTargetLabel: string;
  repSplitLabel?: string;
  colorHex: string;
}

export interface ComputedSharedWorkoutPreview {
  totalDurationSecs: number;
  estimatedLoad: number;
  steps: ComputedSharedStepPreview[];
}

const FORBIDDEN_RAW_TELEMETRY_KEYS = [
  'stravaId',
  'stravaActivityId',
  'activities',
  'streams',
  'rawTelemetry',
  'latlng',
  'heartrate',
  'wattsStream',
];

function stripEmailAndControls(input: unknown, maxLen: number): string {
  const s = String(input ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
  return s.slice(0, maxLen);
}

function normalizeSportCategory(val: unknown): SportCategory {
  if (
    val === 'Cycling' ||
    val === 'Running' ||
    val === 'Swimming' ||
    val === 'Strength' ||
    val === 'Multisport'
  ) {
    return val;
  }
  return 'Running';
}

/**
 * Enforces CMP-01 Clean-Room boundaries on share links and PNG cards:
 * only allow-listed first-party workout prescriptions and stopwatch splits survive.
 */
export function sanitizeSharedWorkoutPayload(raw: unknown): SharedWorkoutPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Drop explicitly forbidden raw telemetry keys even before field projection
  const cleanSource: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_RAW_TELEMETRY_KEYS.includes(k)) {
      cleanSource[k] = v;
    }
  }

  const title = stripEmailAndControls(cleanSource.title || 'MeetReady Structured Session', 90);
  if (!title) return null;

  const kind: SharedWorkoutKind = cleanSource.kind === 'STOPWATCH' ? 'STOPWATCH' : 'WORKOUT';
  const sport = normalizeSportCategory(cleanSource.sport);
  const dateRaw = typeof cleanSource.date === 'string' ? cleanSource.date.slice(0, 10) : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;

  const workoutSyntax =
    typeof cleanSource.workoutSyntax === 'string' && cleanSource.workoutSyntax.trim()
      ? cleanSource.workoutSyntax.trim().slice(0, 2500)
      : undefined;

  const description =
    typeof cleanSource.description === 'string' && cleanSource.description.trim()
      ? stripEmailAndControls(cleanSource.description, 280)
      : undefined;

  const authorLabel =
    typeof cleanSource.authorLabel === 'string' && cleanSource.authorLabel.trim()
      ? stripEmailAndControls(cleanSource.authorLabel, 48)
      : undefined;

  const teamName =
    typeof cleanSource.teamName === 'string' && cleanSource.teamName.trim()
      ? stripEmailAndControls(cleanSource.teamName, 60)
      : undefined;

  const plannedDurationSecs =
    typeof cleanSource.plannedDurationSecs === 'number' &&
    Number.isFinite(cleanSource.plannedDurationSecs) &&
    cleanSource.plannedDurationSecs > 0
      ? Math.round(Math.min(43200, cleanSource.plannedDurationSecs))
      : undefined;

  const plannedLoad =
    typeof cleanSource.plannedLoad === 'number' &&
    Number.isFinite(cleanSource.plannedLoad) &&
    cleanSource.plannedLoad >= 0
      ? Math.round(Math.min(1200, cleanSource.plannedLoad))
      : undefined;

  const defaultUnit: 'mi' | 'km' | undefined =
    cleanSource.defaultUnit === 'km' || cleanSource.defaultUnit === 'mi'
      ? cleanSource.defaultUnit
      : undefined;

  const referenceFtpWatts =
    typeof cleanSource.referenceFtpWatts === 'number' &&
    Number.isFinite(cleanSource.referenceFtpWatts)
      ? Math.round(Math.max(80, Math.min(600, cleanSource.referenceFtpWatts)))
      : undefined;

  const referenceThresholdPaceSecsPerKm =
    typeof cleanSource.referenceThresholdPaceSecsPerKm === 'number' &&
    Number.isFinite(cleanSource.referenceThresholdPaceSecsPerKm)
      ? Math.round(Math.max(120, Math.min(600, cleanSource.referenceThresholdPaceSecsPerKm)))
      : undefined;

  let splits: SharedStopwatchSplitRow[] | undefined;
  if (Array.isArray(cleanSource.splits) && cleanSource.splits.length > 0) {
    splits = cleanSource.splits
      .slice(0, 16)
      .filter((s) => s && typeof s === 'object')
      .map((s) => {
        const row = s as Record<string, unknown>;
        return {
          label: stripEmailAndControls(row.label || 'Split', 40),
          lapTime: stripEmailAndControls(row.lapTime || '0:00', 18),
          ...(row.paceOrPower
            ? { paceOrPower: stripEmailAndControls(row.paceOrPower, 28) }
            : {}),
          ...(typeof row.distanceMeters === 'number' && Number.isFinite(row.distanceMeters)
            ? { distanceMeters: Math.round(Math.max(10, Math.min(100000, row.distanceMeters))) }
            : {}),
          ...(row.cumulativeTime
            ? { cumulativeTime: stripEmailAndControls(row.cumulativeTime, 18) }
            : {}),
        };
      });
  }

  return {
    kind,
    version: 1,
    title,
    sport,
    ...(date ? { date } : {}),
    ...(workoutSyntax ? { workoutSyntax } : {}),
    ...(plannedDurationSecs ? { plannedDurationSecs } : {}),
    ...(plannedLoad !== undefined ? { plannedLoad } : {}),
    ...(description ? { description } : {}),
    ...(authorLabel ? { authorLabel } : {}),
    ...(teamName ? { teamName } : {}),
    ...(defaultUnit ? { defaultUnit } : {}),
    ...(referenceFtpWatts ? { referenceFtpWatts } : {}),
    ...(referenceThresholdPaceSecsPerKm ? { referenceThresholdPaceSecsPerKm } : {}),
    ...(splits && splits.length > 0 ? { splits } : {}),
  };
}

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUint8(token: string): Uint8Array {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((token.length + 3) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export function encodeSharedWorkoutPayload(payload: SharedWorkoutPayload): string {
  const sanitized = sanitizeSharedWorkoutPayload(payload);
  if (!sanitized) return '';
  const json = JSON.stringify(sanitized);
  const bytes = new TextEncoder().encode(json);
  return uint8ToBase64Url(bytes);
}

export function decodeSharedWorkoutPayload(token: string | null | undefined): SharedWorkoutPayload | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const clean = token.trim();
    if (!clean || clean.length > 12000) return null;
    const bytes = base64UrlToUint8(clean);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    return sanitizeSharedWorkoutPayload(parsed);
  } catch {
    return null;
  }
}

export function buildShareWorkoutUrl(payload: SharedWorkoutPayload, origin?: string): string {
  const cleanOrigin = (
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://meetready.app')
  ).replace(/\/+$/, '');
  const encoded = encodeSharedWorkoutPayload(payload);
  return `${cleanOrigin}/share/workout?w=${encodeURIComponent(encoded)}`;
}

export function isShareWorkoutLocation(pathname: string): boolean {
  const clean = pathname.toLowerCase();
  return clean === '/share/workout' || clean.startsWith('/share/workout/');
}

export function formatMmSs(totalSecs: number): string {
  const safe = Math.max(0, Math.round(totalSecs));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSharedWorkoutOgSummary(payload: SharedWorkoutPayload): {
  title: string;
  description: string;
} {
  const kindLabel = payload.kind === 'STOPWATCH' ? 'Stopwatch Splits' : 'Structured Workout';
  const title = `${payload.title} — MeetReady ${kindLabel}`;
  const parts: string[] = [payload.sport];
  if (payload.teamName) {
    parts.push(payload.teamName);
  }
  if (payload.kind === 'STOPWATCH' && payload.splits && payload.splits.length > 0) {
    parts.push(`${payload.splits.length} ${payload.splits.length === 1 ? 'split' : 'splits'}`);
  } else if (payload.plannedDurationSecs) {
    parts.push(`${formatMmSs(payload.plannedDurationSecs)} planned`);
  }
  if (payload.description) {
    parts.push(payload.description);
  } else if (payload.workoutSyntax) {
    parts.push(payload.workoutSyntax.slice(0, 110));
  }
  const description = `${parts.join(' · ')} — Open and save to your training calendar on MeetReady.`.slice(
    0,
    220
  );
  return { title, description };
}
