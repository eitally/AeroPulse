import type {
  AthleteSwimZone,
  DistanceUnit,
  TeamWorkoutLibraryCategory,
  UnifiedActivity,
} from '../types';

export const DEFAULT_SWIM_CSS_SECS_PER_100M = 110; // 1:50 /100m default CSS

const SWIM_ZONE_COLORS = ['#94A3B8', '#0D9488', '#D97706', '#EA580C', '#DC2626'] as const;

export function buildSwimPaceZones(cssSecsPer100m: number): AthleteSwimZone[] {
  const safeCss = Math.max(60, Math.min(240, Math.round(cssSecsPer100m || DEFAULT_SWIM_CSS_SECS_PER_100M)));
  const specs: Array<{
    zone: number;
    code: string;
    name: string;
    fastPct: number;
    slowPct: number;
  }> = [
    { zone: 1, code: 'Z1', name: 'Recovery & Drill', fastPct: 116, slowPct: 130 },
    { zone: 2, code: 'Z2', name: 'Aerobic Endurance', fastPct: 106, slowPct: 115 },
    { zone: 3, code: 'Z3', name: 'CSS Threshold', fastPct: 98, slowPct: 105 },
    { zone: 4, code: 'Z4', name: 'VO2max / Race Effort', fastPct: 92, slowPct: 97 },
    { zone: 5, code: 'Z5', name: 'Neuromuscular Sprint', fastPct: 82, slowPct: 91 },
  ];

  return specs.map((s, idx) => ({
    zone: s.zone,
    code: s.code,
    name: s.name,
    minPaceSecsPer100m: Math.round((safeCss * s.fastPct) / 100),
    maxPaceSecsPer100m: Math.round((safeCss * s.slowPct) / 100),
    minPctCss: s.fastPct,
    maxPctCss: s.slowPct,
    color: SWIM_ZONE_COLORS[idx] || '#DC2626',
  }));
}

/**
 * Estimates Critical Swim Speed (CSS, secs/100m) from sustained pool or open-water
 * swim logs (`>= 400m` and `>= 5m`). Returns `undefined` if no qualifying swim exists.
 */
export function deriveSwimCssFromActivities(
  activities?: readonly UnifiedActivity[] | null
): number | undefined {
  if (!Array.isArray(activities) || activities.length === 0) return undefined;

  let bestCssEstimate = 0;
  for (const act of activities) {
    if (!act || act.sportCategory !== 'Swimming') continue;
    const dist = Number(act.distanceMeters || 0);
    const dur = Number(act.movingTimeSecs || 0);
    if (dist < 400 || dur < 300) continue;

    const secsPer100m = (dur / dist) * 100;
    if (!Number.isFinite(secsPer100m) || secsPer100m < 55 || secsPer100m > 260) continue;

    // Longer continuous swims (>= 1000m) run ~3% slower than CSS; 400-999m time trials run ~2% faster.
    const estimatedCss = dist >= 1000 ? secsPer100m / 1.03 : secsPer100m / 0.98;
    const rounded = Math.max(68, Math.min(210, Math.round(estimatedCss)));
    if (bestCssEstimate === 0 || rounded < bestCssEstimate) {
      bestCssEstimate = rounded;
    }
  }

  return bestCssEstimate > 0 ? bestCssEstimate : undefined;
}

export function formatSwimClockInput(secsPer100m: number, unit: DistanceUnit): string {
  const safe = Math.max(55, Math.min(260, Number(secsPer100m) || DEFAULT_SWIM_CSS_SECS_PER_100M));
  const scaled = unit === 'mi' ? safe * 0.9144 : safe;
  let mins = Math.floor(scaled / 60);
  let secs = Math.round(scaled % 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatSwimPacePer100(secsPer100m: number, unit: DistanceUnit): string {
  const unitSuffix = unit === 'mi' ? '/100yd' : '/100m';
  return `${formatSwimClockInput(secsPer100m, unit)} ${unitSuffix}`;
}

export function parseSwimClockInput(raw: string, unit: DistanceUnit): number | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!parts) return null;
  const mins = Number(parts[1]);
  const secs = Number(parts[2]);
  const displaySecs = mins * 60 + secs;
  const canonicalSecs = unit === 'mi' ? displaySecs / 0.9144 : displaySecs;
  if (!Number.isFinite(canonicalSecs) || canonicalSecs < 60 || canonicalSecs > 240) {
    return null;
  }
  return Math.round(canonicalSecs);
}

export function formatSwimDistance(meters: number, unit: DistanceUnit): string {
  const safeMeters = Math.max(0, Math.round(Number(meters) || 0));
  if (unit === 'mi') {
    const yards = Math.round(safeMeters / 0.9144);
    return `${yards.toLocaleString('en-US')} yd`;
  }
  return `${safeMeters.toLocaleString('en-US')} m`;
}

export interface SwimClipboardBuildResult {
  workoutSyntax: string;
  description: string;
  plannedDurationSecs: number;
  plannedLoad: number;
  summaryLine: string;
}

export function buildSwimClipboardWorkout(opts: {
  sets: Array<{
    repCount: number;
    repDistanceMeters: number;
    restLabel: string;
    durationMins?: number;
    measureMode?: 'DISTANCE_M' | 'TIME_MINS';
  }>;
  cssSecsPer100m?: number;
  distanceUnit?: DistanceUnit;
  includeWarmup?: boolean;
  includeCooldown?: boolean;
}): SwimClipboardBuildResult {
  const safeCss = Math.max(60, Math.min(220, opts.cssSecsPer100m || DEFAULT_SWIM_CSS_SECS_PER_100M));
  const unit: DistanceUnit = opts.distanceUnit === 'mi' ? 'mi' : 'km';
  const cssLabel = formatSwimPacePer100(safeCss, unit);
  const easyLabel = formatSwimPacePer100(Math.round(safeCss * 1.16), unit);

  const lines: string[] = [];
  let totalMeters = 0;

  if (opts.includeWarmup !== false) {
    const wuLabel = unit === 'mi' ? '400yd' : '400m';
    totalMeters += unit === 'mi' ? 366 : 400;
    lines.push(`Warmup\n- ${wuLabel} Easy Choice + 4x50 Drill @ ${easyLabel}`);
  }

  opts.sets.forEach((s, idx) => {
    const reps = Math.max(1, s.repCount || 1);
    const distMeters =
      s.measureMode === 'TIME_MINS'
        ? Math.max(100, Math.round(((s.durationMins || 5) * 60 * 100) / safeCss))
        : Math.max(50, Math.min(1500, s.repDistanceMeters || 100));
    const displayDist = unit === 'mi' ? `${Math.round(distMeters / 25) * 25}yd` : `${distMeters}m`;
    totalMeters += reps * (unit === 'mi' ? Math.round((Math.round(distMeters / 25) * 25) * 0.9144) : distMeters);
    lines.push(
      `Main Set ${idx + 1}\n- ${reps}x${displayDist} @ ${cssLabel} (${s.restLabel || '15s wall rest'})`
    );
  });

  if (opts.includeCooldown !== false) {
    const cdLabel = unit === 'mi' ? '200yd' : '200m';
    totalMeters += unit === 'mi' ? 183 : 200;
    lines.push(`Cooldown\n- ${cdLabel} Z1 Easy Swim Down`);
  }

  const workSwimSecs = Math.round((totalMeters / 100) * safeCss * 1.12);
  const plannedDurationSecs = Math.max(1200, workSwimSecs);
  const plannedLoad = Math.max(25, Math.min(125, Math.round((plannedDurationSecs / 3600) * 68)));

  return {
    workoutSyntax: lines.join('\n\n'),
    description: `Pool CSS threshold session calibrated at ${cssLabel} (${formatSwimDistance(totalMeters, unit)} total).`,
    plannedDurationSecs,
    plannedLoad,
    summaryLine: `${formatSwimDistance(totalMeters, unit)} @ ${cssLabel}`,
  };
}

export function buildTriBrickClipboardWorkout(opts: {
  bikeMins: number;
  runMins: number;
  ftpWatts?: number;
  thresholdPaceSecsPerKm?: number;
  includeWarmup?: boolean;
  includeCooldown?: boolean;
}): SwimClipboardBuildResult {
  const bikeMins = Math.max(20, Math.min(180, opts.bikeMins || 45));
  const runMins = Math.max(10, Math.min(90, opts.runMins || 20));
  const lines: string[] = [];

  if (opts.includeWarmup !== false) {
    lines.push('Warmup\n- 15m 58% FTP Bike Progressive Warmup');
  }
  lines.push(
    `Main Set 1 (Bike -> T2 Brick)\n- ${bikeMins}m 88% FTP Tempo/Race Effort`,
    `Main Set 2 (Run Off-Bike)\n- 2m T2 Shoe Change Transition\n- ${runMins}m 90% Pace Steady Off-Bike Run`
  );
  if (opts.includeCooldown !== false) {
    lines.push('Cooldown\n- 8m 62% Pace Easy Jog Cooldown');
  }

  const totalMins = (opts.includeWarmup !== false ? 15 : 0) + bikeMins + 2 + runMins + (opts.includeCooldown !== false ? 8 : 0);
  const plannedDurationSecs = totalMins * 60;
  const plannedLoad = Math.max(40, Math.min(210, Math.round((totalMins / 60) * 82)));

  return {
    workoutSyntax: lines.join('\n\n'),
    description: `Triathlon T2 Brick: ${bikeMins}m Aero Bike at 88% FTP straight into ${runMins}m Off-Bike Run.`,
    plannedDurationSecs,
    plannedLoad,
    summaryLine: `${bikeMins}m Bike + ${runMins}m T2 Brick`,
  };
}

export interface BuiltinSwimTriTemplate {
  id: string;
  name: string;
  category: TeamWorkoutLibraryCategory;
  sportCategory: 'Swimming' | 'Multisport';
  workoutSyntax: string;
  description: string;
  plannedDurationSecs: number;
  plannedLoad: number;
  createdByName: string;
  createdAt: string;
  isBuiltin: true;
}

export const SWIM_TRI_CLIPBOARD_TEMPLATES: BuiltinSwimTriTemplate[] = [
  {
    id: 'builtin-swim-css-10x100',
    name: '10×100m CSS Threshold Pool Set',
    category: 'SWIMMING',
    sportCategory: 'Swimming',
    workoutSyntax:
      'Warmup\n- 400m Easy Choice + 4x50 Drill\n\nMain Set 1\n- 10x100m @ CSS Threshold (15s rest)\n\nCooldown\n- 200m Z1 Swim Down',
    description: 'Canonical CSS pace pool session with disciplined 15s turnaround rest.',
    plannedDurationSecs: 2700,
    plannedLoad: 54,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-tri-olympic-brick',
    name: 'Olympic Race-Pace Bike → Run Brick',
    category: 'TRIATHLON',
    sportCategory: 'Multisport',
    workoutSyntax:
      'Warmup\n- 15m 58% FTP Bike Warmup\n\nMain Set 1\n- 45m 88% FTP Aero Race Tempo\n\nMain Set 2\n- 2m T2 Transition\n- 20m 90% Pace Run Off-Bike\n\nCooldown\n- 8m 60% Pace Easy Cooldown',
    description: 'Triathlon T2 neuromuscular adaptation transferring from sustained aero cadence to stride turnover.',
    plannedDurationSecs: 5400,
    plannedLoad: 118,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
];
