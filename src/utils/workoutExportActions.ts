import { buildFitStepsFromWorkoutSyntax, downloadGarminFitWorkoutFile, type FitWorkoutStepInput } from './fitWorkoutEncoder.ts';
import { parseWorkoutSteps } from './workoutParser.ts';
import type { SportCategory } from '../types.ts';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration.ts';

export interface WorkoutExportOptions {
  name: string;
  sport: SportCategory;
  workoutSyntax: string;
  description?: string;
  ftpWatts?: number;
  lthrBpm?: number;
  thresholdPaceSecsPerKm?: number;
  dateIso?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'thresh-workout'
  );
}

function triggerTextFileDownload(content: string, filename: string, mimeType: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildZwoWorkoutXml(opts: WorkoutExportOptions): string {
  const thresholdPace = Math.max(95, opts.thresholdPaceSecsPerKm || 250);
  const parsed = parseWorkoutSteps(opts.workoutSyntax, thresholdPace);
  const steps =
    parsed.length > 0
      ? parsed
      : [
          {
            label: opts.name || 'Main Set',
            durationSecs: 1800,
            durationMins: 30,
            intensityPct: 75,
            stepKind: 'work' as const,
          },
        ];

  const xmlSteps = steps
    .map((s) => {
      const durSecs = Math.max(15, Math.round(s.durationSecs || s.durationMins * 60 || 60));
      const powerDec = Math.max(0.35, Math.min(2.5, (s.intensityPct || 75) / 100));
      if (s.stepKind === 'warmup') {
        const low = Math.max(0.4, Number((powerDec - 0.1).toFixed(2)));
        const high = Math.max(low + 0.05, Number(powerDec.toFixed(2)));
        return `    <Warmup Duration="${durSecs}" PowerLow="${low.toFixed(2)}" PowerHigh="${high.toFixed(2)}" />`;
      }
      if (s.stepKind === 'cooldown') {
        const high = Math.max(0.45, Number(powerDec.toFixed(2)));
        const low = Math.max(0.35, Number((high - 0.12).toFixed(2)));
        return `    <Cooldown Duration="${durSecs}" PowerLow="${low.toFixed(2)}" PowerHigh="${high.toFixed(2)}" />`;
      }
      return `    <SteadyState Duration="${durSecs}" Power="${powerDec.toFixed(2)}" />`;
    })
    .join('\n');

  const sportType = opts.sport === 'Cycling' ? 'bike' : 'run';
  const desc = (opts.description || opts.workoutSyntax || opts.name).slice(0, 400);

  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>MeetReady</author>
  <name>${escapeXml(opts.name || 'MeetReady Workout')}</name>
  <description>${escapeXml(desc)}</description>
  <sportType>${sportType}</sportType>
  <workout>
${xmlSteps}
  </workout>
</workout_file>`;
}

export function buildErgWorkoutText(opts: WorkoutExportOptions): string {
  const safeFtp = Math.max(80, Math.round(opts.ftpWatts || 250));
  const thresholdPace = Math.max(95, opts.thresholdPaceSecsPerKm || 250);
  const parsed = parseWorkoutSteps(opts.workoutSyntax, thresholdPace);
  const steps =
    parsed.length > 0
      ? parsed
      : [
          {
            label: opts.name || 'Steady',
            durationSecs: 1800,
            durationMins: 30,
            intensityPct: 75,
          },
        ];

  let elapsedMins = 0;
  const dataLines: string[] = [];
  for (const s of steps) {
    const mins = Math.max(0.25, (s.durationSecs || s.durationMins * 60 || 60) / 60);
    const watts = Math.max(50, Math.round((safeFtp * (s.intensityPct || 75)) / 100));
    dataLines.push(`${elapsedMins.toFixed(2)}\t${watts}`);
    elapsedMins += mins;
    dataLines.push(`${elapsedMins.toFixed(2)}\t${watts}`);
  }

  const filePrefix = opts.dateIso ? `${opts.dateIso}-` : '';
  const slug = sanitizeSlug(opts.name);

  return `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = ${opts.name || 'MeetReady Workout'} (Calibrated to ${safeFtp}W FTP)
FILE NAME = ${filePrefix}${slug}.erg
FTP = ${safeFtp}
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
${dataLines.join('\n')}
[END COURSE DATA]`;
}

export function exportWorkoutAsFit(
  opts: WorkoutExportOptions & { explicitSteps?: FitWorkoutStepInput[] }
): number {
  const fitSport: 'Running' | 'Cycling' = opts.sport === 'Cycling' ? 'Cycling' : 'Running';
  const steps =
    opts.explicitSteps && opts.explicitSteps.length > 0
      ? opts.explicitSteps
      : buildFitStepsFromWorkoutSyntax(opts.workoutSyntax, {
          sport: fitSport,
          ftpWatts: opts.ftpWatts,
          lthrBpm: opts.lthrBpm,
          thresholdPaceSecsPerKm: opts.thresholdPaceSecsPerKm,
        });

  downloadGarminFitWorkoutFile(
    {
      name: opts.name || 'MeetReady Workout',
      sport: fitSport,
      steps:
        steps.length > 0
          ? steps
          : [
              {
                label: 'Main Set',
                durationSecs: 1800,
                durationType: 'time',
                targetType: 'open',
                intensity: 'active',
              },
            ],
    },
    opts.dateIso
  );

  return steps.length;
}

export function exportWorkoutAsZwo(opts: WorkoutExportOptions): void {
  const xml = buildZwoWorkoutXml(opts);
  const filePrefix = opts.dateIso ? `${opts.dateIso}-` : '';
  const filename = `${filePrefix}${sanitizeSlug(opts.name)}.zwo`;
  triggerTextFileDownload(xml, filename, 'application/xml;charset=utf-8');
}

export function exportWorkoutAsErg(opts: WorkoutExportOptions): void {
  const erg = buildErgWorkoutText(opts);
  const filePrefix = opts.dateIso ? `${opts.dateIso}-` : '';
  const filename = `${filePrefix}${sanitizeSlug(opts.name)}.erg`;
  triggerTextFileDownload(erg, filename, 'text/plain;charset=utf-8');
}

export interface WearablePushResult {
  pushed: boolean;
  message: string;
  partialSuccess?: boolean;
  requiresPartnerOAuth?: boolean;
  setupRequired?: boolean;
  needsScopeUpgrade?: boolean;
  connectRequired?: boolean;
}

export type WearablePushTarget = 'garmin' | 'wahoo' | 'coros' | 'intervals';

function buildNormalizedStepsPayload(opts: WorkoutExportOptions) {
  const safeFtp = Math.max(80, Math.round(opts.ftpWatts || 250));
  const safeLthr = Math.max(110, Math.round(opts.lthrBpm || 170));
  const thresholdPace = Math.max(95, opts.thresholdPaceSecsPerKm || 250);
  const parsed = parseWorkoutSteps(opts.workoutSyntax, thresholdPace);

  const stepsPayload = (
    parsed.length > 0
      ? parsed
      : [
          {
            label: opts.name || 'Main Set',
            durationSecs: 1800,
            durationMins: 30,
            intensityPct: 75,
            stepKind: 'work' as const,
          },
        ]
  ).map((s) => {
    const pct = s.intensityPct || 75;
    const targetWatts = Math.max(50, Math.round((safeFtp * pct) / 100));
    const hrCeilingBpm = Math.min(205, Math.max(105, Math.round((safeLthr * pct) / 100)));
    const durationSecs = Math.max(15, Math.round(s.durationSecs || s.durationMins * 60 || 60));
    return {
      label: s.label,
      durationSecs,
      ...('distanceMeters' in s && typeof s.distanceMeters === 'number'
        ? { distanceMeters: s.distanceMeters }
        : {}),
      ...('targetPaceSecsPerKm' in s && typeof s.targetPaceSecsPerKm === 'number'
        ? { targetPaceSecsPerKm: s.targetPaceSecsPerKm }
        : {}),
      targetPctFtp: pct,
      targetWatts,
      targetMinWatts: Math.max(40, targetWatts - 10),
      targetMaxWatts: targetWatts + 10,
      hrCeilingBpm,
      stepType:
        s.stepKind === 'warmup'
          ? ('warmup' as const)
          : s.stepKind === 'cooldown'
            ? ('cooldown' as const)
            : s.stepKind === 'rest'
              ? ('recovery' as const)
              : ('interval' as const),
    };
  });

  const plannedDurationSecs = stepsPayload.reduce((acc, st) => acc + st.durationSecs, 0);
  return { safeFtp, safeLthr, thresholdPace, stepsPayload, plannedDurationSecs };
}

function getNonSessionIntervalsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    if (typeof localStorage === 'undefined') return headers;
    if (localStorage.getItem('aeropulse_logged_out') === '1') return headers;
    const apiKey = (localStorage.getItem('aeropulse_intervals_api_key') || '').trim();
    const athleteId = (localStorage.getItem('aeropulse_intervals_athlete_id') || '0').trim();
    if (apiKey) {
      headers['x-intervals-api-key'] = apiKey.replace(/[\r\n]/g, '');
      headers['x-intervals-athlete-id'] = (athleteId || '0').replace(/[\r\n]/g, '');
    }
  } catch {
    // ignore storage errors
  }
  return headers;
}

async function postWearableWorkoutPush(params: {
  endpoint: string;
  opts: WorkoutExportOptions;
  extraHeaders?: Record<string, string>;
  includePlannedDuration?: boolean;
  successFallback: (dateIso: string) => string;
  errorFallback: string;
  networkFallback: string;
}): Promise<WearablePushResult> {
  const { endpoint, opts, extraHeaders, includePlannedDuration, successFallback, errorFallback, networkFallback } =
    params;
  const dateIso = opts.dateIso || getLocalDateIso();
  const { safeFtp, safeLthr, thresholdPace, stepsPayload, plannedDurationSecs } =
    buildNormalizedStepsPayload(opts);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({
        date: dateIso,
        name: opts.name,
        sportCategory: opts.sport,
        ftpWatts: opts.sport === 'Cycling' ? safeFtp : undefined,
        lthrBpm: safeLthr,
        thresholdPaceSecsPerKm: thresholdPace,
        ...(includePlannedDuration ? { plannedDurationSecs } : {}),
        workoutSyntax: opts.workoutSyntax,
        description: opts.description || opts.workoutSyntax,
        steps: stepsPayload,
      }),
    });
    const data = (await resp.json().catch(() => ({}))) as Partial<WearablePushResult> & {
      error?: string;
    };
    if (resp.ok && data.pushed) {
      return {
        pushed: true,
        ...(data.partialSuccess ? { partialSuccess: true } : {}),
        message: data.message || successFallback(dateIso),
      };
    }
    return {
      pushed: false,
      requiresPartnerOAuth: Boolean(data.requiresPartnerOAuth),
      setupRequired: Boolean(data.setupRequired),
      needsScopeUpgrade: Boolean(data.needsScopeUpgrade),
      connectRequired: Boolean(data.connectRequired),
      message: data.error || errorFallback,
    };
  } catch {
    return {
      pushed: false,
      message: networkFallback,
    };
  }
}

export async function pushWorkoutDirectToGarmin(
  opts: WorkoutExportOptions
): Promise<WearablePushResult> {
  return postWearableWorkoutPush({
    endpoint: '/api/garmin/workout/push',
    opts,
    successFallback: (dateIso) => `Pushed "${opts.name}" directly to Garmin Connect (${dateIso}).`,
    errorFallback:
      'Connect Official Garmin Partner OAuth in Data Sources to push directly, or download .FIT instead.',
    networkFallback: 'Network unavailable for Garmin push. Use .FIT download to transfer manually.',
  });
}

export async function pushWorkoutToWahoo(
  opts: WorkoutExportOptions
): Promise<WearablePushResult> {
  return postWearableWorkoutPush({
    endpoint: '/api/wahoo/workouts/push',
    opts,
    successFallback: (dateIso) =>
      `Pushed "${opts.name}" directly to Wahoo Cloud / ELEMNT (${dateIso}).`,
    errorFallback:
      'Connect Wahoo with workout write permissions in Data Sources (or use Intervals.icu Cross-Watch Bridge / .FIT download).',
    networkFallback: 'Network unavailable for Wahoo push. Use .FIT download to transfer manually.',
  });
}

export async function pushWorkoutToCoros(
  opts: WorkoutExportOptions
): Promise<WearablePushResult> {
  return postWearableWorkoutPush({
    endpoint: '/api/coros/workout/push',
    opts,
    successFallback: (dateIso) => `Pushed "${opts.name}" directly to COROS Calendar (${dateIso}).`,
    errorFallback:
      'Connect COROS in Data Sources (or use Intervals.icu Cross-Watch Bridge / .FIT download).',
    networkFallback: 'Network unavailable for COROS push. Use .FIT download to transfer manually.',
  });
}

export async function pushWorkoutToIntervalsBridge(
  opts: WorkoutExportOptions
): Promise<WearablePushResult> {
  return postWearableWorkoutPush({
    endpoint: '/api/intervals/workout/push',
    opts,
    extraHeaders: getNonSessionIntervalsHeaders(),
    includePlannedDuration: true,
    successFallback: (dateIso) =>
      `Pushed "${opts.name}" to Intervals.icu Calendar (${dateIso}) for Garmin / COROS / Suunto / Wahoo sync.`,
    errorFallback:
      'Connect Intervals.icu with CALENDAR:WRITE in Data Sources to push workouts to your watch.',
    networkFallback: 'Network unavailable for Intervals.icu bridge push. Use .FIT download instead.',
  });
}

export async function pushWorkoutToWearable(
  target: WearablePushTarget,
  opts: WorkoutExportOptions
): Promise<WearablePushResult> {
  if (target === 'garmin') return pushWorkoutDirectToGarmin(opts);
  if (target === 'wahoo') return pushWorkoutToWahoo(opts);
  if (target === 'coros') return pushWorkoutToCoros(opts);
  return pushWorkoutToIntervalsBridge(opts);
}
