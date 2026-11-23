import type {
  CoachEventGroup,
  DistanceUnit,
  ExternalTeamPlatform,
  FieldEventCode,
  FieldEventLogRecord,
  FieldTrialEntry,
  ParentConsentStatus,
  PublicTeamHubFieldPrItem,
  TeamOrgType,
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

export interface RaiseBarHeightResult {
  nextMeters: number;
  displayValue: string;
  totalInches?: number;
}

/**
 * Steps High Jump or Pole Vault bar height cleanly with zero cumulative floating-point drift.
 * Imperial uses exact integer inches (+2" HJ, +6" PV); Metric uses exact centimeters (+0.05m HJ, +0.15m PV).
 */
export function raiseBarHeight(params: {
  currentMeters?: number;
  eventCode: 'HJ' | 'PV';
  unit: 'mi' | 'km';
}): RaiseBarHeightResult {
  const isPv = params.eventCode === 'PV';
  const hasCurrent =
    typeof params.currentMeters === 'number' &&
    Number.isFinite(params.currentMeters) &&
    params.currentMeters > 0;

  if (params.unit === 'mi') {
    const stepInches = isPv ? 6 : 2;
    const baseInches = hasCurrent
      ? Math.round(params.currentMeters! / 0.0254)
      : isPv
        ? 144
        : 70;
    const nextInches = baseInches + stepInches;
    const nextMeters = Number((nextInches * 0.0254).toFixed(4));
    const feet = Math.floor(nextInches / 12);
    const inches = nextInches % 12;
    return {
      nextMeters,
      displayValue: `${feet}' ${inches}"`,
      totalInches: nextInches,
    };
  }

  const stepCm = isPv ? 15 : 5;
  const baseCm = hasCurrent
    ? Math.round(params.currentMeters! * 100)
    : isPv
      ? 365
      : 175;
  const nextCm = baseCm + stepCm;
  const nextMeters = Number((nextCm / 100).toFixed(2));
  return {
    nextMeters,
    displayValue: `${nextMeters.toFixed(2)}m`,
  };
}

export function formatBarHeightForUnit(meters: number, unit: DistanceUnit = 'mi'): string {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  if (unit === 'km') return `${meters.toFixed(2)}m`;
  const nearestInch = Math.round(meters / 0.0254);
  if (Math.abs(nearestInch * 0.0254 - meters) <= 0.004) {
    const feet = Math.floor(nearestInch / 12);
    const inches = nearestInch % 12;
    return `${feet}' ${inches}"`;
  }
  return formatFieldMarkImperial(meters);
}

export interface VerticalHeightGroupSummary {
  heightMeters: number;
  tokens: Array<'O' | 'X' | '-'>;
  summary: string;
}

export interface VerticalFlightEvaluation {
  bestClearedHeightMeters: number | null;
  missesAtClearingHeight: number | null;
  totalMisses: number;
  totalMissesAll: number;
  consecutiveMisses: number;
  isEliminated: boolean;
  isNoHeight: boolean;
  heightMarks: VerticalHeightGroupSummary[];
  verticalSeriesSummary: string;
}

/**
 * Evaluates a single athlete's vertical jump series under World Athletics / NFHS rules:
 * 3 consecutive MISSes eliminates the athlete (even across passed heights).
 * Countback misses exclude attempts at heights above the last cleared height.
 */
export function evaluateVerticalFlightAthlete(
  attempts: FieldTrialEntry[]
): VerticalFlightEvaluation {
  let bestClearedHeightMeters: number | null = null;
  let consecutiveMisses = 0;
  let isEliminated = false;
  const heightOrder: string[] = [];
  const heightBuckets = new Map<
    string,
    { heightMeters: number; tokens: Array<'O' | 'X' | '-'>; misses: number }
  >();
  const summaryTokens: string[] = [];
  let totalMissesAll = 0;

  for (const a of attempts || []) {
    const symbol: 'O' | 'X' | '-' =
      a.outcome === 'CLEAR' ? 'O' : a.outcome === 'MISS' ? 'X' : '-';
    const h = a.barHeightMeters ?? a.markMeters;
    summaryTokens.push(h ? `${h.toFixed(2)}:${symbol}` : symbol);

    if (typeof h === 'number' && Number.isFinite(h) && h > 0) {
      const hKey = h.toFixed(3);
      let bucket = heightBuckets.get(hKey);
      if (!bucket) {
        bucket = { heightMeters: Number(h.toFixed(3)), tokens: [], misses: 0 };
        heightBuckets.set(hKey, bucket);
        heightOrder.push(hKey);
      }
      bucket.tokens.push(symbol);
      if (symbol === 'X') {
        bucket.misses += 1;
      }
    }

    if (symbol === 'X') {
      totalMissesAll += 1;
    }

    if (isEliminated) {
      continue;
    }

    if (a.outcome === 'CLEAR') {
      consecutiveMisses = 0;
      if (typeof h === 'number' && Number.isFinite(h) && h > 0) {
        const rounded = Number(h.toFixed(3));
        if (bestClearedHeightMeters === null || rounded > bestClearedHeightMeters) {
          bestClearedHeightMeters = rounded;
        }
      }
    } else if (a.outcome === 'MISS') {
      consecutiveMisses += 1;
      if (consecutiveMisses >= 3) {
        isEliminated = true;
      }
    }
    // PASS ('-') neither clears nor resets the consecutive miss streak.
  }

  let missesAtClearingHeight: number | null = null;
  let totalMisses = 0;
  if (bestClearedHeightMeters !== null) {
    const clearKey = bestClearedHeightMeters.toFixed(3);
    missesAtClearingHeight = heightBuckets.get(clearKey)?.misses ?? 0;
    for (const bucket of heightBuckets.values()) {
      if (bucket.heightMeters <= bestClearedHeightMeters + 0.0005) {
        totalMisses += bucket.misses;
      }
    }
  } else {
    totalMisses = totalMissesAll;
  }

  const heightMarks: VerticalHeightGroupSummary[] = heightOrder.map((key) => {
    const b = heightBuckets.get(key)!;
    return {
      heightMeters: b.heightMeters,
      tokens: b.tokens,
      summary: b.tokens.join(''),
    };
  });

  return {
    bestClearedHeightMeters,
    missesAtClearingHeight,
    totalMisses,
    totalMissesAll,
    consecutiveMisses,
    isEliminated,
    isNoHeight: isEliminated && bestClearedHeightMeters === null,
    heightMarks,
    verticalSeriesSummary: summaryTokens.join(' '),
  };
}

export interface VerticalFlightAthleteInput {
  athleteId: string;
  membershipId?: string;
  athleteName: string;
  attempts: FieldTrialEntry[];
}

export interface VerticalFlightStanding extends VerticalFlightEvaluation {
  athleteId: string;
  membershipId?: string;
  athleteName: string;
  placeRank: number | null;
  isTied: boolean;
  needsJumpOff: boolean;
}

/**
 * Ranks a vertical flight using World Athletics / NFHS countback rules:
 * 1) Highest cleared bar -> 2) Fewest misses at clearing height -> 3) Fewest total misses up to clearing height.
 */
export function rankVerticalFlight(
  athletes: VerticalFlightAthleteInput[]
): VerticalFlightStanding[] {
  const evaluated = (athletes || []).map((ath) => {
    const ev = evaluateVerticalFlightAthlete(ath.attempts);
    return {
      athleteId: ath.athleteId,
      membershipId: ath.membershipId,
      athleteName: ath.athleteName,
      ...ev,
      isNoHeight: ev.isNoHeight || (ev.bestClearedHeightMeters === null && ev.totalMissesAll > 0),
    };
  });

  evaluated.sort((a, b) => {
    const aHas = a.bestClearedHeightMeters !== null;
    const bHas = b.bestClearedHeightMeters !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (!aHas && !bHas) return a.athleteName.localeCompare(b.athleteName);

    const hDiff = b.bestClearedHeightMeters! - a.bestClearedHeightMeters!;
    if (Math.abs(hDiff) > 0.0005) return hDiff;

    const mDiff = (a.missesAtClearingHeight ?? 0) - (b.missesAtClearingHeight ?? 0);
    if (mDiff !== 0) return mDiff;

    const tDiff = a.totalMisses - b.totalMisses;
    if (tDiff !== 0) return tDiff;

    return a.athleteName.localeCompare(b.athleteName);
  });

  const ranked = evaluated.map((item) => ({
    ...item,
    placeRank: null as number | null,
    isTied: false,
    needsJumpOff: false,
  }));

  let nextRank = 1;
  for (let i = 0; i < ranked.length; i += 1) {
    const cur = ranked[i];
    if (cur.bestClearedHeightMeters === null) {
      cur.placeRank = null;
      continue;
    }
    if (i > 0) {
      const prev = ranked[i - 1];
      const sameHeight =
        prev.bestClearedHeightMeters !== null &&
        Math.abs(prev.bestClearedHeightMeters - cur.bestClearedHeightMeters) <= 0.0005;
      const sameAtBar =
        (prev.missesAtClearingHeight ?? 0) === (cur.missesAtClearingHeight ?? 0);
      const sameTotal = prev.totalMisses === cur.totalMisses;
      if (sameHeight && sameAtBar && sameTotal) {
        cur.placeRank = prev.placeRank;
      } else {
        cur.placeRank = nextRank;
      }
    } else {
      cur.placeRank = nextRank;
    }
    nextRank += 1;
  }

  const rankCounts = new Map<number, number>();
  for (const r of ranked) {
    if (r.placeRank !== null) {
      rankCounts.set(r.placeRank, (rankCounts.get(r.placeRank) ?? 0) + 1);
    }
  }
  for (const r of ranked) {
    if (r.placeRank !== null) {
      const count = rankCounts.get(r.placeRank) ?? 1;
      r.isTied = count > 1;
      r.needsJumpOff = r.placeRank === 1 && count > 1;
    }
  }

  return ranked;
}

export interface FieldSeriesSummary {
  bestMarkMeters: number | null;
  bestWindLegalMeters: number | null;
  bestMarkWindMps?: number;
  isWindAidedBest: boolean;
  legalCount: number;
  foulOrMissCount: number;
  totalContacts: number;
  verticalSeriesSummary: string;
  estimatedLoadTss: number;
  isNoHeight?: boolean;
  missesAtClearingHeight?: number;
  totalVerticalMisses?: number;
  isEliminated?: boolean;
}

export function isWindReadingLegal(windMps?: number): boolean {
  return windMps === undefined || !Number.isFinite(windMps) || windMps <= 2.0;
}

export function summarizeFieldSeries(
  eventCode: FieldEventCode,
  attempts: FieldTrialEntry[],
  rpe?: number
): FieldSeriesSummary {
  const spec = getFieldEventSpec(eventCode);
  let bestMarkMeters: number | null = null;
  let bestWindLegalMeters: number | null = null;
  let bestMarkWindMps: number | undefined;
  let isWindAidedBest = false;
  let legalCount = 0;
  let foulOrMissCount = 0;
  const barSummaryTokens: string[] = [];

  for (const a of attempts) {
    if (a.outcome === 'FOUL' || a.outcome === 'MISS') {
      foulOrMissCount += 1;
    } else if (a.outcome === 'MARK' || a.outcome === 'CLEAR') {
      legalCount += 1;
      const candidateRaw =
        spec.mode === 'VERTICAL'
          ? (a.barHeightMeters ?? a.markMeters ?? 0)
          : (a.markMeters ?? a.barHeightMeters ?? 0);
      if (candidateRaw > 0) {
        const candidate = Number(candidateRaw.toFixed(3));
        const hasWind = typeof a.windMps === 'number' && Number.isFinite(a.windMps);
        const attemptWind = hasWind ? Number(a.windMps!.toFixed(2)) : undefined;
        const attemptWindAided = hasWind && a.windMps! > 2.0;

        if (bestMarkMeters === null || candidate > bestMarkMeters) {
          bestMarkMeters = candidate;
          bestMarkWindMps = attemptWind;
          isWindAidedBest = attemptWindAided;
        } else if (candidate === bestMarkMeters && isWindAidedBest && !attemptWindAided) {
          // Prefer a wind-legal tie over a wind-aided tie
          bestMarkWindMps = attemptWind;
          isWindAidedBest = false;
        }

        if (!attemptWindAided && (bestWindLegalMeters === null || candidate > bestWindLegalMeters)) {
          bestWindLegalMeters = candidate;
        }
      }
    }
    if (spec.mode === 'VERTICAL') {
      const symbol = a.outcome === 'CLEAR' ? 'O' : a.outcome === 'MISS' ? 'X' : '-';
      const h = a.barHeightMeters ?? a.markMeters;
      barSummaryTokens.push(h ? `${h.toFixed(2)}:${symbol}` : symbol);
    }
  }

  let verticalEval: VerticalFlightEvaluation | null = null;
  if (spec.mode === 'VERTICAL') {
    verticalEval = evaluateVerticalFlightAthlete(attempts);
    bestMarkMeters = verticalEval.bestClearedHeightMeters;
    bestWindLegalMeters = verticalEval.bestClearedHeightMeters;
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
    bestWindLegalMeters,
    ...(bestMarkWindMps !== undefined ? { bestMarkWindMps } : {}),
    isWindAidedBest,
    legalCount,
    foulOrMissCount,
    totalContacts,
    verticalSeriesSummary: barSummaryTokens.join(' '),
    estimatedLoadTss,
    ...(verticalEval
      ? {
          isNoHeight: verticalEval.isNoHeight,
          ...(verticalEval.missesAtClearingHeight !== null
            ? { missesAtClearingHeight: verticalEval.missesAtClearingHeight }
            : {}),
          totalVerticalMisses: verticalEval.totalMisses,
          isEliminated: verticalEval.isEliminated,
        }
      : {}),
  };
}

export interface HorizontalFlightAthleteInput {
  athleteId: string;
  membershipId?: string;
  athleteName: string;
  eventCode: FieldEventCode;
  attempts: FieldTrialEntry[];
}

export interface HorizontalFlightStanding {
  athleteId: string;
  membershipId?: string;
  athleteName: string;
  bestMarkMeters: number | null;
  bestWindLegalMeters: number | null;
  bestMarkWindMps?: number;
  isWindAidedBest: boolean;
  sortedMarksDesc: number[];
  placeRank: number | null;
  isNoMark: boolean;
  advancedToFinals: boolean;
}

function compareSortedMarksDesc(a: number[], b: number[]): number {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    const va = a[i] ?? -1;
    const vb = b[i] ?? -1;
    if (Math.abs(va - vb) > 0.0005) {
      return vb - va;
    }
  }
  return 0;
}

/**
 * Ranks horizontal jump and throw flights using World Athletics / NFHS tiebreaking:
 * best mark -> 2nd best -> 3rd best -> ...
 */
export function computeHorizontalFlightStandings(
  athletes: HorizontalFlightAthleteInput[]
): HorizontalFlightStanding[] {
  const prepared = (athletes || []).map((ath) => {
    const summary = summarizeFieldSeries(ath.eventCode, ath.attempts);
    const sortedMarksDesc = (ath.attempts || [])
      .filter((a) => a.outcome === 'MARK' && typeof a.markMeters === 'number' && a.markMeters > 0)
      .map((a) => Number(a.markMeters!.toFixed(3)))
      .sort((x, y) => y - x);

    return {
      athleteId: ath.athleteId,
      membershipId: ath.membershipId,
      athleteName: ath.athleteName,
      bestMarkMeters: summary.bestMarkMeters,
      bestWindLegalMeters: summary.bestWindLegalMeters,
      ...(summary.bestMarkWindMps !== undefined ? { bestMarkWindMps: summary.bestMarkWindMps } : {}),
      isWindAidedBest: summary.isWindAidedBest,
      sortedMarksDesc,
      placeRank: null as number | null,
      isNoMark: sortedMarksDesc.length === 0,
      advancedToFinals: false,
    };
  });

  prepared.sort((a, b) => {
    if (a.isNoMark !== b.isNoMark) return a.isNoMark ? 1 : -1;
    if (a.isNoMark && b.isNoMark) return a.athleteName.localeCompare(b.athleteName);
    const cmp = compareSortedMarksDesc(a.sortedMarksDesc, b.sortedMarksDesc);
    if (cmp !== 0) return cmp;
    return a.athleteName.localeCompare(b.athleteName);
  });

  let nextRank = 1;
  for (let i = 0; i < prepared.length; i += 1) {
    const cur = prepared[i];
    if (cur.isNoMark) {
      cur.placeRank = null;
      continue;
    }
    if (i > 0 && !prepared[i - 1].isNoMark) {
      const tied = compareSortedMarksDesc(prepared[i - 1].sortedMarksDesc, cur.sortedMarksDesc) === 0;
      cur.placeRank = tied ? prepared[i - 1].placeRank : nextRank;
    } else {
      cur.placeRank = nextRank;
    }
    nextRank += 1;
  }

  return prepared;
}

export interface HorizontalFinalsCutResult {
  standings: HorizontalFlightStanding[];
  finalsOrder: HorizontalFlightStanding[];
}

/**
 * Cuts prelim horizontal standings to the top 8 or 9 qualifiers, marks `advancedToFinals: true`,
 * and returns `finalsOrder` in reverse prelim order for Rounds 4-6.
 */
export function advanceFlightToFinals(
  standings: HorizontalFlightStanding[],
  count: 8 | 9 | number = 8
): HorizontalFinalsCutResult {
  const cutoff = Math.max(1, Math.round(count));
  const updated = (standings || []).map((s) => ({
    ...s,
    advancedToFinals: s.placeRank !== null && s.placeRank <= cutoff,
  }));
  const finalsOrder = updated.filter((s) => s.advancedToFinals).slice().reverse();
  return {
    standings: updated,
    finalsOrder,
  };
}

export interface PublicSafeSportAthleteRef {
  membershipId: string;
  role: string;
  status: string;
  invitedName: string;
  squadGroup: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  graduationYear?: number;
  externalSource?: ExternalTeamPlatform;
  isMinorU18?: boolean;
  parentConsentStatus?: ParentConsentStatus;
}

export function formatPublicSafeSportDisplayName(params: {
  invitedName: string;
  externalSource?: ExternalTeamPlatform;
  isMinorU18?: boolean;
  parentConsentStatus?: ParentConsentStatus;
  orgType?: TeamOrgType;
}): string {
  const isProtectedMinor = Boolean(
    params.isMinorU18 || params.orgType === 'HIGH_SCHOOL'
  );
  const abbreviateUnconsentedMinor = Boolean(
    !params.externalSource &&
      isProtectedMinor &&
      params.parentConsentStatus !== 'ACKNOWLEDGED'
  );
  if (!abbreviateUnconsentedMinor) {
    return params.invitedName;
  }
  const parts = String(params.invitedName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0] || 'Athlete';
}

interface BestFieldPrCandidate {
  log: FieldEventLogRecord;
  bestMarkMeters?: number;
  windMps?: number;
  isWindAided: boolean;
  multiPoints?: number;
}

function extractFieldLogPrEvaluation(log: FieldEventLogRecord): {
  windLegalMeters?: number;
  windLegalWindMps?: number;
  overallMeters?: number;
  overallWindMps?: number;
  isWindAidedOverall: boolean;
  multiPoints?: number;
} {
  const spec = getFieldEventSpec(log.eventCode);
  if (spec.mode === 'MULTI') {
    const pts =
      typeof log.multiPoints === 'number' && Number.isFinite(log.multiPoints) && log.multiPoints > 0
        ? Math.round(log.multiPoints)
        : undefined;
    return { isWindAidedOverall: false, multiPoints: pts };
  }

  let windLegalMeters: number | undefined;
  let windLegalWindMps: number | undefined;
  let overallMeters: number | undefined;
  let overallWindMps: number | undefined;
  let isWindAidedOverall = false;

  if (Array.isArray(log.attempts) && log.attempts.length > 0) {
    for (const a of log.attempts) {
      if (a.outcome !== 'MARK' && a.outcome !== 'CLEAR') continue;
      const rawMark =
        spec.mode === 'VERTICAL'
          ? (a.barHeightMeters ?? a.markMeters ?? 0)
          : (a.markMeters ?? a.barHeightMeters ?? 0);
      if (!Number.isFinite(rawMark) || rawMark <= 0) continue;
      const roundedMark = Number(rawMark.toFixed(3));
      const hasWind = typeof a.windMps === 'number' && Number.isFinite(a.windMps);
      const windVal = hasWind ? Number(a.windMps!.toFixed(2)) : undefined;
      const windAided = hasWind && a.windMps! > 2.0;

      if (overallMeters === undefined || roundedMark > overallMeters) {
        overallMeters = roundedMark;
        overallWindMps = windVal;
        isWindAidedOverall = windAided;
      } else if (roundedMark === overallMeters && isWindAidedOverall && !windAided) {
        overallWindMps = windVal;
        isWindAidedOverall = false;
      }

      if (!windAided && (windLegalMeters === undefined || roundedMark > windLegalMeters)) {
        windLegalMeters = roundedMark;
        windLegalWindMps = windVal;
      }
    }
  }

  if (windLegalMeters === undefined && typeof log.bestWindLegalMeters === 'number' && log.bestWindLegalMeters > 0) {
    windLegalMeters = Number(log.bestWindLegalMeters.toFixed(3));
    if (!log.isWindAidedBest && typeof log.bestMarkWindMps === 'number') {
      windLegalWindMps = Number(log.bestMarkWindMps.toFixed(2));
    }
  }
  if (overallMeters === undefined && typeof log.bestMarkMeters === 'number' && log.bestMarkMeters > 0) {
    overallMeters = Number(log.bestMarkMeters.toFixed(3));
    overallWindMps =
      typeof log.bestMarkWindMps === 'number' ? Number(log.bestMarkWindMps.toFixed(2)) : undefined;
    isWindAidedOverall = Boolean(
      log.isWindAidedBest || (typeof log.bestMarkWindMps === 'number' && log.bestMarkWindMps > 2.0)
    );
    if (!isWindAidedOverall && windLegalMeters === undefined) {
      windLegalMeters = overallMeters;
      windLegalWindMps = overallWindMps;
    }
  }

  return {
    windLegalMeters,
    windLegalWindMps,
    overallMeters,
    overallWindMps,
    isWindAidedOverall,
  };
}

/**
 * Builds SafeSport-clean public Field Event PRs and team leaderboard from competition-only logs.
 * Excludes practice sessions, unlinked walk-on strings, RPE, pole specs, notes, and PII.
 */
export function buildPublicFieldLeaderboardFromLogs(params: {
  orgType?: TeamOrgType;
  memberships: PublicSafeSportAthleteRef[];
  fieldLogs: FieldEventLogRecord[];
}): {
  fieldPrsByMembershipId: Map<string, PublicTeamHubFieldPrItem[]>;
  fieldLeaderboard: PublicTeamHubFieldPrItem[];
} {
  const athleteByMemId = new Map<
    string,
    { mem: PublicSafeSportAthleteRef; displayName: string }
  >();
  for (const m of params.memberships || []) {
    if (m.status === 'REVOKED' || m.role !== 'ATHLETE') continue;
    athleteByMemId.set(m.membershipId, {
      mem: m,
      displayName: formatPublicSafeSportDisplayName({
        invitedName: m.invitedName,
        externalSource: m.externalSource,
        isMinorU18: m.isMinorU18,
        parentConsentStatus: m.parentConsentStatus,
        orgType: params.orgType,
      }),
    });
  }

  const bestLegalByKey = new Map<string, BestFieldPrCandidate>();
  const bestAidedByKey = new Map<string, BestFieldPrCandidate>();

  for (const log of params.fieldLogs || []) {
    if (!log || log.isCompetition !== true) continue;
    if (!log.membershipId || !athleteByMemId.has(log.membershipId)) continue;

    const evalRes = extractFieldLogPrEvaluation(log);
    const key = `${log.membershipId}|${log.eventCode}`;
    const spec = getFieldEventSpec(log.eventCode);

    if (spec.mode === 'MULTI') {
      if (!evalRes.multiPoints) continue;
      const existing = bestLegalByKey.get(key);
      if (!existing || (existing.multiPoints ?? 0) < evalRes.multiPoints) {
        bestLegalByKey.set(key, {
          log,
          multiPoints: evalRes.multiPoints,
          isWindAided: false,
        });
      }
      continue;
    }

    if (evalRes.windLegalMeters !== undefined && evalRes.windLegalMeters > 0) {
      const existing = bestLegalByKey.get(key);
      if (!existing || (existing.bestMarkMeters ?? 0) < evalRes.windLegalMeters) {
        bestLegalByKey.set(key, {
          log,
          bestMarkMeters: evalRes.windLegalMeters,
          windMps: evalRes.windLegalWindMps,
          isWindAided: false,
        });
      }
    } else if (evalRes.overallMeters !== undefined && evalRes.overallMeters > 0) {
      const existing = bestAidedByKey.get(key);
      if (!existing || (existing.bestMarkMeters ?? 0) < evalRes.overallMeters) {
        bestAidedByKey.set(key, {
          log,
          bestMarkMeters: evalRes.overallMeters,
          windMps: evalRes.overallWindMps,
          isWindAided: evalRes.isWindAidedOverall,
        });
      }
    }
  }

  const allKeys = new Set<string>([...bestLegalByKey.keys(), ...bestAidedByKey.keys()]);
  const eventOrder = new Map<FieldEventCode, number>(
    FIELD_EVENT_CATALOG.map((spec, idx) => [spec.code, idx])
  );
  const fieldPrsByMembershipId = new Map<string, PublicTeamHubFieldPrItem[]>();
  const fieldLeaderboard: PublicTeamHubFieldPrItem[] = [];

  for (const key of allKeys) {
    const chosen = bestLegalByKey.get(key) || bestAidedByKey.get(key);
    if (!chosen || !chosen.log.membershipId) continue;
    const athRef = athleteByMemId.get(chosen.log.membershipId);
    if (!athRef) continue;

    const spec = getFieldEventSpec(chosen.log.eventCode);
    const displayMark =
      spec.mode === 'MULTI' && typeof chosen.multiPoints === 'number'
        ? `${chosen.multiPoints.toLocaleString()} pts`
        : typeof chosen.bestMarkMeters === 'number'
          ? formatFieldMarkDual(chosen.bestMarkMeters)
          : '';
    if (!displayMark) continue;

    const item: PublicTeamHubFieldPrItem = {
      id: chosen.log.id,
      membershipId: athRef.mem.membershipId,
      displayName: athRef.displayName,
      ...(athRef.mem.genderDivision ? { genderDivision: athRef.mem.genderDivision } : {}),
      ...(athRef.mem.graduationYear ? { graduationYear: athRef.mem.graduationYear } : {}),
      ...(athRef.mem.squadGroup ? { squadGroup: athRef.mem.squadGroup } : {}),
      eventCode: chosen.log.eventCode,
      eventLabel: spec.label,
      ...(typeof chosen.bestMarkMeters === 'number' ? { bestMarkMeters: chosen.bestMarkMeters } : {}),
      displayMark,
      ...(typeof chosen.windMps === 'number' ? { windMps: chosen.windMps } : {}),
      ...(chosen.isWindAided ? { isWindAided: true } : {}),
      ...(typeof chosen.multiPoints === 'number' ? { multiPoints: chosen.multiPoints } : {}),
      ...(chosen.log.meetOrPracticeTitle ? { meetName: chosen.log.meetOrPracticeTitle } : {}),
      date: chosen.log.date,
    };

    fieldLeaderboard.push(item);
    const list = fieldPrsByMembershipId.get(athRef.mem.membershipId) || [];
    list.push(item);
    fieldPrsByMembershipId.set(athRef.mem.membershipId, list);
  }

  const sortPrs = (a: PublicTeamHubFieldPrItem, b: PublicTeamHubFieldPrItem): number => {
    const orderDiff = (eventOrder.get(a.eventCode) ?? 99) - (eventOrder.get(b.eventCode) ?? 99);
    if (orderDiff !== 0) return orderDiff;
    const scoreA = a.multiPoints ?? a.bestMarkMeters ?? 0;
    const scoreB = b.multiPoints ?? b.bestMarkMeters ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.displayName.localeCompare(b.displayName);
  };

  fieldLeaderboard.sort(sortPrs);
  for (const list of fieldPrsByMembershipId.values()) {
    list.sort(sortPrs);
  }

  return { fieldPrsByMembershipId, fieldLeaderboard };
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
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
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
];
