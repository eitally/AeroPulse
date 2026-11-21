import type {
  CoachEventGroup,
  DistanceUnit,
  FieldEventCode,
  FieldTrialEntry,
  TeamWorkoutLibraryTemplate,
} from '../types';

export type FieldEventMode = 'HORIZONTAL' | 'VERTICAL' | 'THROW' | 'MULTI';

export interface FieldEventCatalogSpec {
  code: FieldEventCode;
  label: string;
  shortLabel: string;
  eventGroup: CoachEventGroup;
  mode: FieldEventMode;
  defaultImplementSpec?: string;
  implementPresets?: string[];
  barStepMeters?: number;
}

export const FIELD_EVENT_CATALOG: ReadonlyArray<FieldEventCatalogSpec> = [
  {
    code: 'LJ',
    label: 'Long Jump',
    shortLabel: 'LJ',
    eventGroup: 'JUMPS',
    mode: 'HORIZONTAL',
  },
  {
    code: 'TJ',
    label: 'Triple Jump',
    shortLabel: 'TJ',
    eventGroup: 'JUMPS',
    mode: 'HORIZONTAL',
  },
  {
    code: 'HJ',
    label: 'High Jump',
    shortLabel: 'HJ',
    eventGroup: 'JUMPS',
    mode: 'VERTICAL',
    barStepMeters: 0.0508, // 2 in
  },
  {
    code: 'PV',
    label: 'Pole Vault',
    shortLabel: 'PV',
    eventGroup: 'POLE_VAULT',
    mode: 'VERTICAL',
    barStepMeters: 0.1524, // 6 in
  },
  {
    code: 'SP',
    label: 'Shot Put',
    shortLabel: 'Shot Put',
    eventGroup: 'THROWS',
    mode: 'THROW',
    defaultImplementSpec: '12 lb (HS Boys) / 4 kg (HS Girls)',
    implementPresets: ['12 lb (HS Boys)', '4 kg (HS Girls / Women)', '16 lb (College Men)', '10 lb (Heavy Ball)'],
  },
  {
    code: 'DISCUS',
    label: 'Discus Throw',
    shortLabel: 'Discus',
    eventGroup: 'THROWS',
    mode: 'THROW',
    defaultImplementSpec: '1.6 kg (HS Boys) / 1.0 kg (HS Girls)',
    implementPresets: ['1.6 kg (HS Boys)', '1.0 kg (Girls / Women)', '2.0 kg (College Men)', '1.75 kg (Heavy)'],
  },
  {
    code: 'JAVELIN',
    label: 'Javelin Throw',
    shortLabel: 'Javelin',
    eventGroup: 'THROWS',
    mode: 'THROW',
    defaultImplementSpec: '800g (Boys/Men) / 600g (Girls/Women)',
    implementPresets: ['800g (Boys / Men)', '600g (Girls / Women)', '700g (Trainer)'],
  },
  {
    code: 'HAMMER',
    label: 'Hammer Throw',
    shortLabel: 'Hammer',
    eventGroup: 'THROWS',
    mode: 'THROW',
    defaultImplementSpec: '12 lb / 16 lb / 4 kg',
    implementPresets: ['12 lb (HS Boys)', '4 kg (Girls / Women)', '16 lb (College Men)'],
  },
  {
    code: 'PENT',
    label: 'Pentathlon',
    shortLabel: 'Pent',
    eventGroup: 'MULTI',
    mode: 'MULTI',
  },
  {
    code: 'HEPT',
    label: 'Heptathlon',
    shortLabel: 'Hept',
    eventGroup: 'MULTI',
    mode: 'MULTI',
  },
  {
    code: 'DEC',
    label: 'Decathlon',
    shortLabel: 'Dec',
    eventGroup: 'MULTI',
    mode: 'MULTI',
  },
];

export function getFieldEventSpec(code: FieldEventCode): FieldEventCatalogSpec {
  return FIELD_EVENT_CATALOG.find((c) => c.code === code) || FIELD_EVENT_CATALOG[0];
}

/**
 * Parses imperial (`21' 6.5"`, `21-06.5`, `14'6`, `52-4.25`) or metric (`6.57m`, `6.57`)
 * marks safely into meters (rounded to nearest 0.001m, clamped to 0.30m..110.0m).
 */
export function parseFieldMarkToMeters(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;

  // Explicit feet-inches patterns: 21' 6.5", 21'6", 21-06.5, 21-6.5
  const ftIn = s.match(
    /^(\d{1,3})\s*(?:'|ft|-)\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:"|in)?$/i
  );
  if (ftIn) {
    const feet = Number(ftIn[1]);
    const inches = Number(ftIn[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches) || inches >= 12) return null;
    const meters = (feet * 12 + inches) * 0.0254;
    return meters >= 0.3 && meters <= 110 ? Number(meters.toFixed(3)) : null;
  }

  // Feet only (e.g. "15ft" or "15'")
  const ftOnly = s.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*(?:'|ft)$/i);
  if (ftOnly) {
    const meters = Number(ftOnly[1]) * 0.3048;
    return meters >= 0.3 && meters <= 110 ? Number(meters.toFixed(3)) : null;
  }

  // Metric (e.g. "6.57m" or "6.57")
  const metricMatch = s.match(/^(\d{1,3}(?:\.\d{1,3})?)\s*m?$/i);
  if (metricMatch) {
    const meters = Number(metricMatch[1]);
    return meters >= 0.3 && meters <= 110 ? Number(meters.toFixed(3)) : null;
  }

  return null;
}

export function formatFieldMarkImperial(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  const totalInches = meters / 0.0254;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round((totalInches - feet * 12) * 4) / 4; // quarter-inch precision
  if (inches >= 12) {
    feet += 1;
    inches = 0;
  }
  const inchStr = Number.isInteger(inches)
    ? String(inches)
    : inches.toFixed(2).replace(/0$/, '');
  return `${feet}' ${inchStr}"`;
}

export function formatFieldMark(meters: number, unit: DistanceUnit = 'mi'): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return unit === 'km' ? `${meters.toFixed(2)}m` : formatFieldMarkImperial(meters);
}

export function formatFieldMarkDual(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return `${formatFieldMarkImperial(meters)} (${meters.toFixed(2)}m)`;
}

export interface FieldSeriesSummary {
  bestMarkMeters: number | null;
  legalCount: number;
  foulOrMissCount: number;
  totalContacts: number;
  verticalSeriesSummary: string;
  estimatedLoadTss: number;
}

export function summarizeFieldSeries(
  eventCode: FieldEventCode,
  attempts: FieldTrialEntry[],
  rpe?: number
): FieldSeriesSummary {
  const spec = getFieldEventSpec(eventCode);
  let bestMarkMeters: number | null = null;
  let legalCount = 0;
  let foulOrMissCount = 0;
  const barSummaryTokens: string[] = [];

  for (const a of attempts) {
    if (a.outcome === 'FOUL' || a.outcome === 'MISS') {
      foulOrMissCount += 1;
    } else if (a.outcome === 'MARK' || a.outcome === 'CLEAR') {
      legalCount += 1;
      const candidate =
        spec.mode === 'VERTICAL'
          ? (a.barHeightMeters ?? a.markMeters ?? 0)
          : (a.markMeters ?? a.barHeightMeters ?? 0);
      if (candidate > 0 && (bestMarkMeters === null || candidate > bestMarkMeters)) {
        bestMarkMeters = Number(candidate.toFixed(3));
      }
    }
    if (spec.mode === 'VERTICAL') {
      const symbol = a.outcome === 'CLEAR' ? 'O' : a.outcome === 'MISS' ? 'X' : '-';
      const h = a.barHeightMeters ?? a.markMeters;
      barSummaryTokens.push(h ? `${h.toFixed(2)}:${symbol}` : symbol);
    }
  }

  const totalContacts = attempts.filter((a) => a.outcome !== 'PASS').length;
  const basePerContact =
    spec.mode === 'HORIZONTAL'
      ? 4.2
      : spec.mode === 'VERTICAL'
        ? 3.8
        : spec.mode === 'THROW'
          ? 2.2
          : 5.0;
  const effectiveRpe = Number.isFinite(rpe) && (rpe ?? 0) > 0 ? Number(rpe) : 6.5;
  const estimatedLoadTss = Math.max(
    18,
    Math.min(115, Math.round(14 + totalContacts * basePerContact * (0.75 + effectiveRpe * 0.05)))
  );

  return {
    bestMarkMeters,
    legalCount,
    foulOrMissCount,
    totalContacts,
    verticalSeriesSummary: barSummaryTokens.join(' '),
    estimatedLoadTss,
  };
}

interface ScoringCoeff {
  type: 'TRACK' | 'FIELD_CM' | 'FIELD_M';
  a: number;
  b: number;
  c: number;
}

const DECATHLON_MEN_COEFFS: Record<string, ScoringCoeff> = {
  '100m': { type: 'TRACK', a: 25.4347, b: 18, c: 1.81 },
  LJ: { type: 'FIELD_CM', a: 0.14354, b: 220, c: 1.4 },
  SP: { type: 'FIELD_M', a: 51.39, b: 1.5, c: 1.05 },
  HJ: { type: 'FIELD_CM', a: 0.8465, b: 75, c: 1.42 },
  '400m': { type: 'TRACK', a: 1.53775, b: 82, c: 1.81 },
  '110mH': { type: 'TRACK', a: 5.74352, b: 28.5, c: 1.92 },
  DISCUS: { type: 'FIELD_M', a: 12.91, b: 4, c: 1.1 },
  PV: { type: 'FIELD_CM', a: 0.2797, b: 100, c: 1.35 },
  JAVELIN: { type: 'FIELD_M', a: 10.14, b: 7, c: 1.08 },
  '1500m': { type: 'TRACK', a: 0.03768, b: 480, c: 1.85 },
};

const HEPTATHLON_WOMEN_COEFFS: Record<string, ScoringCoeff> = {
  '100mH': { type: 'TRACK', a: 9.23076, b: 26.7, c: 1.835 },
  HJ: { type: 'FIELD_CM', a: 1.84523, b: 75, c: 1.348 },
  SP: { type: 'FIELD_M', a: 56.0211, b: 1.5, c: 1.05 },
  '200m': { type: 'TRACK', a: 4.99087, b: 42.5, c: 1.81 },
  LJ: { type: 'FIELD_CM', a: 0.188807, b: 210, c: 1.41 },
  JAVELIN: { type: 'FIELD_M', a: 15.9803, b: 3.8, c: 1.04 },
  '800m': { type: 'TRACK', a: 0.11193, b: 254, c: 1.88 },
};

const PENTATHLON_WOMEN_COEFFS: Record<string, ScoringCoeff> = {
  '60mH': { type: 'TRACK', a: 20.0479, b: 17, c: 1.835 },
  HJ: HEPTATHLON_WOMEN_COEFFS.HJ,
  SP: HEPTATHLON_WOMEN_COEFFS.SP,
  LJ: HEPTATHLON_WOMEN_COEFFS.LJ,
  '800m': HEPTATHLON_WOMEN_COEFFS['800m'],
};

const PENTATHLON_MEN_COEFFS: Record<string, ScoringCoeff> = {
  LJ: DECATHLON_MEN_COEFFS.LJ,
  JAVELIN: DECATHLON_MEN_COEFFS.JAVELIN,
  '200m': { type: 'TRACK', a: 5.8425, b: 38, c: 1.81 },
  DISCUS: DECATHLON_MEN_COEFFS.DISCUS,
  '1500m': DECATHLON_MEN_COEFFS['1500m'],
};

/**
 * Computes World Athletics Combined Events points for Pentathlon / Heptathlon / Decathlon.
 * Pass track events in seconds and field marks in meters.
 */
export function computeMultiEventScore(
  event: 'PENT' | 'HEPT' | 'DEC',
  gender: 'M' | 'F',
  marks: Partial<Record<string, number>>
): { totalPoints: number; breakdown: Record<string, number> } {
  const table =
    event === 'DEC'
      ? DECATHLON_MEN_COEFFS
      : event === 'HEPT'
        ? HEPTATHLON_WOMEN_COEFFS
        : gender === 'M'
          ? PENTATHLON_MEN_COEFFS
          : PENTATHLON_WOMEN_COEFFS;

  const breakdown: Record<string, number> = {};
  let totalPoints = 0;
  for (const [discipline, spec] of Object.entries(table)) {
    const val = marks[discipline];
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
      breakdown[discipline] = 0;
      continue;
    }
    let pts = 0;
    if (spec.type === 'TRACK') {
      const diff = spec.b - val;
      pts = diff > 0 ? Math.floor(spec.a * Math.pow(diff, spec.c)) : 0;
    } else {
      const scaled = spec.type === 'FIELD_CM' ? val * 100 : val;
      const diff = scaled - spec.b;
      pts = diff > 0 ? Math.floor(spec.a * Math.pow(diff, spec.c)) : 0;
    }
    breakdown[discipline] = pts;
    totalPoints += pts;
  }
  return { totalPoints, breakdown };
}

export const ALL_TF_PRACTICE_TEMPLATES: Array<
  TeamWorkoutLibraryTemplate & { isBuiltin: boolean; targetEventGroup: CoachEventGroup }
> = [
  {
    id: 'builtin-sprint-fly30',
    name: '6×30m Fly Speed + Wickets',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'SPRINTS',
    workoutSyntax:
      'Warmup\n- 15m Dynamic Sprint Mobility + 4x30m Wickets\n\nMain Set 1\n- 6x30m @ 98% MaxV (4m walk recovery)\n\nCooldown\n- 10m Barefoot Grass Walk + Core',
    description: 'Pure top-end velocity session with full CNS recovery (4 min between flys).',
    plannedDurationSecs: 3000,
    plannedLoad: 58,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-sprint-blocks60',
    name: '4×60m Block Accel + 2×150m SE',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'SPRINTS',
    workoutSyntax:
      'Warmup\n- 15m Sprint Drills + 3x20m Falling Starts\n\nMain Set 1\n- 4x60m @ 95% Blocks (5m rest)\n\nMain Set 2\n- 2x150m @ 92% Speed End. (8m rest)\n\nCooldown\n- 8m Strides & Mobility',
    description: 'Drive-phase acceleration from blocks paired with race-speed 150m mechanics.',
    plannedDurationSecs: 3300,
    plannedLoad: 68,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-hurdle-rhythm',
    name: '6×5-Hurdle 3-Step Rhythm',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'HURDLES',
    workoutSyntax:
      'Warmup\n- 15m Hip Mobility + Lead/Trail Walkovers\n\nMain Set 1\n- 6x60m @ 92% 5-Hurdle Touchdowns (4m rest)\n\nMain Set 2\n- 3x300m @ 88% Hurdle Pattern (6m rest)\n\nCooldown\n- 10m Cool Jog & Band Work',
    description: 'Crisp 3-step lead-leg clearance + 300mH/400mH stride-pattern efficiency.',
    plannedDurationSecs: 3300,
    plannedLoad: 70,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-jumps-approach',
    name: 'LJ/TJ Approach Checks + 6 Jumps',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'JUMPS',
    workoutSyntax:
      'Warmup\n- 15m Skip Series + 4x30m Penultimate Pop-Ups\n\nMain Set 1\n- 6x40m Full-Approach Runway Jumps (4m rest)\n\nMain Set 2\n- 4x40m Single-Leg Bounds & Box Hops (2m rest)\n\nCooldown\n- 10m Ankle/Achilles Mobility',
    description: 'Board accuracy, penultimate lowering, and elastic takeoff contacts capped to protect shins.',
    plannedDurationSecs: 3300,
    plannedLoad: 62,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-pv-short-run',
    name: 'PV 6-Step Plant + Swing Vaults',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'POLE_VAULT',
    workoutSyntax:
      'Warmup\n- 15m Pole Runs + Slide Box Plants\n\nMain Set 1\n- 8x30m 6-Step Approach Vaults (3m rest)\n\nMain Set 2\n- 3x8 High-Bar Bubkas + Core Rings\n\nCooldown\n- 10m Shoulder & Thoracic Mobility',
    description: 'High-plant rhythm and top-arm pressure from controlled 6-step approach.',
    plannedDurationSecs: 3600,
    plannedLoad: 60,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-throws-tech',
    name: 'Shot / Discus: 15 Stands + 12 Full',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'THROWS',
    workoutSyntax:
      'Warmup\n- 15m Band Shoulders + Med-Ball Hip Slams\n\nMain Set 1\n- 15m Power Position Standing Throws (2m rest)\n\nMain Set 2\n- 25m Full Glide/Spin Ring Throws x12 (2m rest)\n\nCooldown\n- 10m Rotator Cuff & Posterior Chain Reset',
    description: '27 total high-quality implement throws balancing block timing and shoulder load.',
    plannedDurationSecs: 3600,
    plannedLoad: 56,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-multi-combo',
    name: 'Multi-Event Combined Tech Day',
    category: 'TRACK',
    sportCategory: 'Running',
    targetEventGroup: 'MULTI',
    workoutSyntax:
      'Warmup\n- 12m Hurdle Hip Mobility\n\nMain Set 1\n- 4x60m Hurdle Rhythm Starts (3m rest)\n\nMain Set 2\n- 6x30m LJ/HJ Approach Marks + Med-Ball Throws\n\nCooldown\n- 8m Aerobic Flush & Core',
    description: 'Low-impact dual-discipline tech block sequencing hurdles before jump runway marks.',
    plannedDurationSecs: 3600,
    plannedLoad: 64,
    createdByName: 'THRESH Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
];
