import { useCallback, useEffect, useState } from 'react';
import type { SportCategory } from '../types.ts';
import { parseWorkoutSteps } from './workoutParser.ts';

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

export const PENDING_SHARED_WORKOUT_STORAGE_KEY = 'thresh_pending_shared_workout_v1';
const SHARE_ROUTE_EVENT = 'thresh:share-workout-route-change';

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

  const title = stripEmailAndControls(cleanSource.title || 'THRESH Structured Session', 90);
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
    (typeof window !== 'undefined' ? window.location.origin : 'https://thresh-dev.vercel.app')
  ).replace(/\/+$/, '');
  const encoded = encodeSharedWorkoutPayload(payload);
  return `${cleanOrigin}/share/workout?w=${encodeURIComponent(encoded)}`;
}

export function isShareWorkoutLocation(pathname: string): boolean {
  const clean = pathname.toLowerCase();
  return clean === '/share/workout' || clean.startsWith('/share/workout/');
}

export function readSharedWorkoutFromLocation(): SharedWorkoutPayload | null {
  if (typeof window === 'undefined') return null;
  if (!isShareWorkoutLocation(window.location.pathname)) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('w');
    if (encoded) {
      return decodeSharedWorkoutPayload(encoded);
    }
  } catch {
    // ignore malformed URLSearchParams
  }
  return null;
}

export function openShareWorkoutRoute(payload: SharedWorkoutPayload): void {
  if (typeof window === 'undefined') return;
  const encoded = encodeSharedWorkoutPayload(payload);
  window.history.pushState({ threshShare: true }, '', `/share/workout?w=${encodeURIComponent(encoded)}`);
  window.dispatchEvent(new CustomEvent(SHARE_ROUTE_EVENT));
}

export function exitShareWorkoutRoute(): void {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new CustomEvent(SHARE_ROUTE_EVENT));
}

export function useShareWorkoutRoute() {
  const [isShareRoute, setIsShareRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isShareWorkoutLocation(window.location.pathname);
  });
  const [sharedWorkout, setSharedWorkout] = useState<SharedWorkoutPayload | null>(() =>
    readSharedWorkoutFromLocation()
  );

  useEffect(() => {
    const sync = () => {
      setIsShareRoute(isShareWorkoutLocation(window.location.pathname));
      setSharedWorkout(readSharedWorkoutFromLocation());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(SHARE_ROUTE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(SHARE_ROUTE_EVENT, sync);
    };
  }, []);

  const openShareWorkout = useCallback((payload: SharedWorkoutPayload) => {
    openShareWorkoutRoute(payload);
  }, []);

  const closeShareWorkout = useCallback(() => {
    exitShareWorkoutRoute();
  }, []);

  return { isShareRoute, sharedWorkout, openShareWorkout, closeShareWorkout };
}

export function stashPendingSharedWorkout(payload: SharedWorkoutPayload): void {
  const clean = sanitizeSharedWorkoutPayload(payload);
  if (!clean || typeof window === 'undefined') return;
  const serialized = JSON.stringify(clean);
  try {
    window.localStorage.setItem(PENDING_SHARED_WORKOUT_STORAGE_KEY, serialized);
  } catch {
    // ignore storage quota errors
  }
  try {
    window.sessionStorage.setItem(PENDING_SHARED_WORKOUT_STORAGE_KEY, serialized);
  } catch {
    // ignore sessionStorage errors
  }
}

export function peekPendingSharedWorkout(): SharedWorkoutPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.sessionStorage.getItem(PENDING_SHARED_WORKOUT_STORAGE_KEY) ||
      window.localStorage.getItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSharedWorkoutPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearPendingSharedWorkout(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function consumePendingSharedWorkout(): SharedWorkoutPayload | null {
  const found = peekPendingSharedWorkout();
  clearPendingSharedWorkout();
  return found;
}

export function formatMmSs(totalSecs: number): string {
  const safe = Math.max(0, Math.round(totalSecs));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function computeSharedWorkoutPreview(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): ComputedSharedWorkoutPreview {
  const safeFtp = Math.max(80, Math.min(600, Math.round(opts.ftpWatts || 260)));
  const safeThresholdPaceKm = Math.max(
    130,
    Math.min(540, Math.round(opts.thresholdPaceSecsPerKm || 245))
  );
  const parsed = opts.payload.workoutSyntax
    ? parseWorkoutSteps(opts.payload.workoutSyntax, safeThresholdPaceKm)
    : [];

  const stepsRaw =
    parsed.length > 0
      ? parsed
      : [
          {
            label: opts.payload.title || 'Main Session',
            durationMins: Math.round((opts.payload.plannedDurationSecs || 2700) / 60),
            durationSecs: opts.payload.plannedDurationSecs || 2700,
            intensityPct: 80,
            zone: 3 as const,
            zoneCode: 'Z3' as const,
            zoneColor: '#D97706',
            stepKind: 'work' as const,
          },
        ];

  let totalDurationSecs = 0;
  let weightedLoadSum = 0;

  const steps: ComputedSharedStepPreview[] = stepsRaw.map((st, idx) => {
    const durSecs = Math.max(15, Math.round(st.durationSecs || st.durationMins * 60 || 300));
    totalDurationSecs += durSecs;
    const pct = Math.max(40, Math.min(200, Math.round(st.intensityPct || 75)));
    weightedLoadSum += (durSecs / 3600) * Math.pow(pct / 100, 2) * 100;

    const durationLabel =
      'distanceMeters' in st && typeof st.distanceMeters === 'number' && st.distanceMeters >= 100
        ? `${Math.round(st.distanceMeters)}m`
        : durSecs >= 60
          ? `${Math.round(durSecs / 60)}m`
          : `${durSecs}s`;

    let prescribedTargetLabel = `${pct}% Effort`;
    let repSplitLabel: string | undefined;

    if (opts.payload.sport === 'Cycling') {
      const watts = Math.round((safeFtp * pct) / 100);
      prescribedTargetLabel = `${watts} W (${pct}% FTP)`;
    } else if (opts.payload.sport === 'Running') {
      const pacePerKm =
        'targetPaceSecsPerKm' in st && typeof st.targetPaceSecsPerKm === 'number'
          ? st.targetPaceSecsPerKm
          : Math.round(safeThresholdPaceKm * (100 / Math.max(45, pct)));
      const unitPace = opts.unit === 'mi' ? pacePerKm * 1.609344 : pacePerKm;
      prescribedTargetLabel = `${formatMmSs(unitPace)}/${opts.unit}`;
      if ('distanceMeters' in st && typeof st.distanceMeters === 'number' && st.distanceMeters >= 100) {
        const repSecs = (pacePerKm / 1000) * st.distanceMeters;
        repSplitLabel = `${formatMmSs(repSecs)} / ${Math.round(st.distanceMeters)}m`;
      }
    }

    return {
      index: idx + 1,
      label: st.label || `Step ${idx + 1}`,
      stepKind: st.stepKind || 'work',
      durationSecs: durSecs,
      durationLabel,
      intensityPct: pct,
      prescribedTargetLabel,
      ...(repSplitLabel ? { repSplitLabel } : {}),
      colorHex: st.zoneColor || '#1C5436',
    };
  });

  return {
    totalDurationSecs,
    estimatedLoad: opts.payload.plannedLoad ?? Math.max(12, Math.round(weightedLoadSum)),
    steps,
  };
}

export function sharedWorkoutToPlannedEventInput(
  payload: SharedWorkoutPayload,
  opts: {
    ftpWatts: number;
    thresholdPaceSecsPerKm: number;
    unit?: 'mi' | 'km';
    dateIso?: string;
  }
) {
  const preview = computeSharedWorkoutPreview({
    payload,
    ftpWatts: opts.ftpWatts,
    thresholdPaceSecsPerKm: opts.thresholdPaceSecsPerKm,
    unit: opts.unit || payload.defaultUnit || 'mi',
  });
  const date =
    opts.dateIso ||
    payload.date ||
    new Date().toISOString().slice(0, 10);

  return {
    date,
    name: payload.title,
    sportCategory: payload.sport,
    environmentPreference: 'FLEXIBLE' as const,
    plannedDurationSecs: payload.plannedDurationSecs || preview.totalDurationSecs || 3600,
    plannedLoad: payload.plannedLoad ?? preview.estimatedLoad,
    workoutSyntax:
      payload.workoutSyntax ||
      `- 10m 62% Effort Warmup\n- ${Math.max(15, Math.round((payload.plannedDurationSecs || 2700) / 60) - 20)}m 85% Effort Main Set\n- 10m 55% Effort Cooldown`,
    description:
      payload.description ||
      (payload.teamName ? `Shared from ${payload.teamName} on THRESH` : 'Imported from THRESH Share Link'),
    replaceExistingDate: false,
  };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * Generates a 1080x1350 Clean-Room portrait PNG workout or #stopwatch split card
 * containing exclusively first-party prescription/stopwatch data (CMP-01 safe).
 */
export async function renderShareCardPngBlob(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { payload, ftpWatts, thresholdPaceSecsPerKm, unit } = opts;
  const preview = computeSharedWorkoutPreview({
    payload,
    ftpWatts,
    thresholdPaceSecsPerKm,
    unit,
  });

  // 1. Carbon Charcoal Editorial Canvas + Crisp Atmospheric Emerald Glow
  ctx.fillStyle = '#090E0B';
  ctx.fillRect(0, 0, 1080, 1350);

  const grad = ctx.createRadialGradient(880, 160, 40, 880, 160, 620);
  grad.addColorStop(0, 'rgba(28, 84, 54, 0.42)');
  grad.addColorStop(1, 'rgba(9, 14, 11, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Subtle 1px inner border
  ctx.strokeStyle = 'rgba(200, 255, 0, 0.16)';
  ctx.lineWidth = 2;
  drawRoundedRectPath(ctx, 44, 44, 992, 1262, 32);
  ctx.stroke();

  // 2. Top Header: THRESH Wordmark + Category/Hashtag Pill
  ctx.fillStyle = '#1C5436';
  drawRoundedRectPath(ctx, 84, 88, 174, 48, 24);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 22px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('THRESH', 124, 112);

  const badgeText =
    payload.kind === 'STOPWATCH'
      ? '#STOPWATCH SPLITS'
      : `${payload.sport.toUpperCase()} PRESCRIPTION`;
  ctx.fillStyle = 'rgba(200, 255, 0, 0.12)';
  drawRoundedRectPath(ctx, 730, 88, 266, 48, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 255, 0, 0.4)';
  ctx.lineWidth = 1.5;
  drawRoundedRectPath(ctx, 730, 88, 266, 48, 24);
  ctx.stroke();
  ctx.fillStyle = '#C8FF00';
  ctx.font = '700 18px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(badgeText, 756, 112);

  // 3. Title + Subheader
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '800 54px system-ui, -apple-system, sans-serif';
  const titleLines = wrapLines(ctx, payload.title, 912);
  let y = 176;
  for (const line of titleLines) {
    ctx.fillText(line, 84, y);
    y += 64;
  }

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 24px system-ui, -apple-system, sans-serif';
  const subParts = [
    payload.teamName || 'First-Party Session Prescription',
    payload.date || new Date().toISOString().slice(0, 10),
    payload.authorLabel ? `By ${payload.authorLabel}` : null,
  ].filter(Boolean);
  ctx.fillText(subParts.join('  ·  '), 84, y + 10);
  y += 62;

  // 4. Three Summary Metric Boxes
  const boxW = 290;
  const gap = 21;
  const durationMins = Math.max(1, Math.round(preview.totalDurationSecs / 60));
  const summaryStats =
    payload.kind === 'STOPWATCH' && payload.splits
      ? [
          { label: 'REPS LOGGED', value: `${payload.splits.length}` },
          { label: 'FIRST MARK', value: payload.splits[0]?.lapTime || '--:--' },
          { label: 'ANCHOR PACE', value: payload.splits[0]?.paceOrPower || `-${unit}` },
        ]
      : [
          { label: 'DURATION', value: `${durationMins} min` },
          { label: 'TARGET LOAD', value: `${preview.estimatedLoad} TSS` },
          {
            label: payload.sport === 'Cycling' ? 'ANCHOR FTP' : 'THRESHOLD',
            value:
              payload.sport === 'Cycling'
                ? `${Math.round(ftpWatts)} W`
                : `${formatMmSs(
                    unit === 'mi' ? thresholdPaceSecsPerKm * 1.609344 : thresholdPaceSecsPerKm
                  )}/${unit}`,
          },
        ];

  summaryStats.forEach((stat, idx) => {
    const bx = 84 + idx * (boxW + gap);
    ctx.fillStyle = '#111A15';
    drawRoundedRectPath(ctx, bx, y, boxW, 128, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '700 17px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(stat.label, bx + 24, y + 24);

    ctx.fillStyle = idx === 2 ? '#C8FF00' : '#FFFFFF';
    ctx.font = '800 38px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(stat.value, bx + 24, y + 60);
  });

  y += 164;

  // 5. Interval Visual Bars or Split Table
  if (payload.kind === 'STOPWATCH' && payload.splits && payload.splits.length > 0) {
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 20px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText('TRACKSIDE STOPWATCH SPLITS', 84, y);
    y += 40;

    const visibleSplits = payload.splits.slice(0, 9);
    visibleSplits.forEach((row, idx) => {
      const ry = y + idx * 72;
      ctx.fillStyle = idx % 2 === 0 ? '#111A15' : '#0D1410';
      drawRoundedRectPath(ctx, 84, ry, 912, 60, 14);
      ctx.fill();

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '600 23px system-ui, -apple-system, sans-serif';
      ctx.fillText(row.label.slice(0, 32), 110, ry + 16);

      ctx.fillStyle = '#C8FF00';
      ctx.font = '700 24px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(row.lapTime, 620, ry + 16);

      if (row.paceOrPower) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = '500 20px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText(row.paceOrPower, 790, ry + 18);
      }
    });
  } else {
    // Visual zone bar chart
    ctx.fillStyle = '#111A15';
    drawRoundedRectPath(ctx, 84, y, 912, 168, 22);
    ctx.fill();

    const totalSecs = Math.max(60, preview.totalDurationSecs);
    let barX = 112;
    const usableW = 856;
    const baseLineY = y + 142;

    for (const st of preview.steps) {
      const segW = Math.max(8, (st.durationSecs / totalSecs) * usableW - 3);
      const heightRatio = Math.max(0.24, Math.min(1, st.intensityPct / 135));
      const barH = Math.round(heightRatio * 108);
      ctx.fillStyle = st.colorHex || '#1C5436';
      drawRoundedRectPath(ctx, barX, baseLineY - barH, segW, barH, 6);
      ctx.fill();
      barX += segW + 3;
      if (barX > 965) break;
    }

    y += 200;
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 19px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText('STRUCTURED INTERVAL BREAKDOWN', 84, y);
    y += 38;

    const rows = preview.steps.slice(0, 7);
    rows.forEach((st, idx) => {
      const ry = y + idx * 68;
      ctx.fillStyle = idx % 2 === 0 ? '#111A15' : '#0D1410';
      drawRoundedRectPath(ctx, 84, ry, 912, 56, 14);
      ctx.fill();

      ctx.fillStyle = st.colorHex || '#1C5436';
      drawRoundedRectPath(ctx, 102, ry + 14, 10, 28, 5);
      ctx.fill();

      ctx.fillStyle = '#F1F5F9';
      ctx.font = '600 22px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${st.durationLabel} · ${st.label}`.slice(0, 38), 130, ry + 14);

      ctx.fillStyle = '#C8FF00';
      ctx.font = '700 22px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(st.prescribedTargetLabel, 690, ry + 15);
    });
  }

  // 6. Clean Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(84, 1218, 912, 2);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 20px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText('FIRST-PARTY CLEAN-ROOM WORKOUT  ·  THRESH.RUN/SHARE', 84, 1244);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function downloadShareCardPng(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): Promise<boolean> {
  const blob = await renderShareCardPngBlob(opts);
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const slug =
    opts.payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'thresh-card';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `thresh-${opts.payload.kind === 'STOPWATCH' ? 'stopwatch-' : ''}${slug}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
