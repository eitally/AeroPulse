import { buildFitStepsFromWorkoutSyntax, downloadGarminFitWorkoutFile, type FitWorkoutStepInput } from './fitWorkoutEncoder.ts';
import { parseWorkoutSteps } from './workoutParser.ts';
import type { SportCategory } from '../types.ts';

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
  <author>THRESH</author>
  <name>${escapeXml(opts.name || 'THRESH Workout')}</name>
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
DESCRIPTION = ${opts.name || 'THRESH Workout'} (Calibrated to ${safeFtp}W FTP)
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
      name: opts.name || 'THRESH Workout',
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

export async function pushWorkoutDirectToGarmin(
  opts: WorkoutExportOptions
): Promise<{ pushed: boolean; message: string }> {
  const dateIso = opts.dateIso || new Date().toISOString().slice(0, 10);
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
    const targetWatts = Math.max(50, Math.round((safeFtp * (s.intensityPct || 75)) / 100));
    const hrCeilingBpm = Math.min(205, Math.max(105, Math.round((safeLthr * (s.intensityPct || 75)) / 100)));
    return {
      label: s.label,
      durationSecs: Math.max(15, Math.round(s.durationSecs || s.durationMins * 60 || 60)),
      targetPctFtp: s.intensityPct || 75,
      targetWatts,
      targetMinWatts: Math.max(40, targetWatts - 10),
      targetMaxWatts: targetWatts + 10,
      hrCeilingBpm,
      stepType:
        s.stepKind === 'warmup'
          ? 'warmup'
          : s.stepKind === 'cooldown'
            ? 'cooldown'
            : s.stepKind === 'rest'
              ? 'recovery'
              : 'interval',
    };
  });

  try {
    const garminBearer =
      typeof localStorage !== 'undefined' ? localStorage.getItem('aeropulse_garmin_bearer_token') || '' : '';
    const garminOauth1 =
      typeof localStorage !== 'undefined' ? localStorage.getItem('aeropulse_garmin_oauth1_token') || '' : '';
    const garminSecret =
      typeof localStorage !== 'undefined' ? localStorage.getItem('aeropulse_garmin_oauth1_secret') || '' : '';

    const resp = await fetch('/api/garmin/workout/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(garminBearer ? { 'x-garmin-bearer-token': garminBearer } : {}),
        ...(garminOauth1 ? { 'x-garmin-oauth1-token': garminOauth1 } : {}),
        ...(garminSecret ? { 'x-garmin-oauth1-secret': garminSecret } : {}),
      },
      body: JSON.stringify({
        date: dateIso,
        name: opts.name,
        sportCategory: opts.sport,
        ftpWatts: opts.sport === 'Cycling' ? safeFtp : undefined,
        lthrBpm: safeLthr,
        description: opts.description || opts.workoutSyntax,
        steps: stepsPayload,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.pushed) {
      return {
        pushed: true,
        message: data.message || `Pushed "${opts.name}" directly to Garmin Connect (${dateIso}).`,
      };
    }
    return {
      pushed: false,
      message:
        data.error ||
        'Connect your Garmin account in Data Sources to push directly, or download .FIT instead.',
    };
  } catch {
    return {
      pushed: false,
      message: 'Network unavailable for Garmin push. Use .FIT download to transfer manually.',
    };
  }
}
