import type {
  MeetPriorityTier,
  OfficialRacePlatform,
  SpeedReservePhenotype,
  TrackSeedMarkInput,
  TrackSplitTimingContext,
  VerifiedRacePassport,
  WeeklyGitDiffDayChange,
} from '../types.ts';
import { computeOfficialRaceTrainingLoad, formatFatTime } from '../utils/officialRaceSynthesizer.ts';
import { generateVerifiedRacePassport } from './raceRubberBander.ts';
import { buildTrackSpeedReserveProfile } from './trackSpeedReserveEngine.ts';

export type TrackRelayEventType = '4x400m' | '4x800m' | 'DMR';

export interface RelayCandidateInput {
  id: string;
  name: string;
  thresholdPaceSecsPerKm: number;
  seedMarks?: TrackSeedMarkInput[];
  phenotype?: SpeedReservePhenotype;
  dPrimeMeters?: number;
  mssMps?: number;
}

export interface OptimizedRelayLeg {
  legNumber: 1 | 2 | 3 | 4;
  distanceMeters: 400 | 800 | 1200 | 1600;
  athleteId: string;
  athleteName: string;
  phenotype: SpeedReservePhenotype;
  splitContext: Extract<TrackSplitTimingContext, 'RELAY_LEADOFF' | 'RELAY_FLYING'>;
  predictedSplitSecs: number;
  displaySplit: string;
  rationale: string;
}

export interface RelayLineupOptimizationResult {
  relayEvent: TrackRelayEventType;
  totalPredictedSecs: number;
  displayTotalTime: string;
  legs: OptimizedRelayLeg[];
  alternateTotalSecs: number | null;
  gainOverDefaultSecs: number;
}

export interface MultiEventMeetDaySummary {
  eventCount: number;
  netRaceTssSum: number;
  compoundingMultiplier: number;
  compoundedRaceTss: number;
  sharedWarmupCooldownTss: number;
  totalMeetTss: number;
}

export interface NfhsHandToFatResult {
  rawHandSecs: number;
  ceilingTenthSecs: number;
  addendSecs: 0.14 | 0.24;
  fatEquivalentSecs: number;
  displayFatEquivalent: string;
  ruleLabel: string;
}

export interface SquadLeaderboardMarkInput {
  id: string;
  athleteId: string;
  athleteName: string;
  eventLabel: string;
  distanceMeters: number;
  rawTimeSecs: number;
  dateIso: string;
  meetName: string;
  timingMethod: 'FAT' | 'HAND';
  splitContext: TrackSplitTimingContext;
}

export interface SquadLeaderboardEntry extends SquadLeaderboardMarkInput {
  normalizedFatSecs: number;
  displayNormalizedTime: string;
  isOpenOrLeadoffEligible: boolean;
}

export interface SquadTopTimesBoard {
  eventLabel: string;
  openAndLeadoffMarks: SquadLeaderboardEntry[];
  flyingRelaySplits: SquadLeaderboardEntry[];
}

const RELAY_LEG_DISTANCES: Record<TrackRelayEventType, [400 | 800 | 1200 | 1600, 400 | 800 | 1200 | 1600, 400 | 800 | 1200 | 1600, 400 | 800 | 1200 | 1600]> = {
  '4x400m': [400, 400, 400, 400],
  '4x800m': [800, 800, 800, 800],
  DMR: [1200, 400, 800, 1600],
};

/**
 * Classifies an event title into a `MeetPriorityTier` when no explicit field is set.
 */
export function inferMeetPriorityTier(
  name: string,
  explicit?: MeetPriorityTier
): MeetPriorityTier | null {
  if (explicit) return explicit;
  const text = (name || '').toLowerCase();
  if (/\b(championship|state\s*meet|finals|sectionals|regionals|ncaa|cif)\b/.test(text)) {
    return 'CHAMPIONSHIP_A';
  }
  if (/\b(invite|invitational|carnival|classic|twilight|relays)\b/.test(text)) {
    return 'INVITATIONAL_B';
  }
  if (/\b(dual|tri-?meet|league\s*meet|time\s*trial)\b/.test(text)) {
    return 'DUAL_TRAINING_THROUGH';
  }
  return null;
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.round((b - a) / 86400000);
}

/**
 * Applies meet-aware micro-periodization diffs across a 7-day proposal (`Tue Dual + Sat Invite`
 * auto-morph and `CHAMPIONSHIP_A` 3-week taper) without crushing athlete freshness.
 */
export function applyMeetMicroPeriodizationToGitDiff(params: {
  dayChanges: WeeklyGitDiffDayChange[];
  plannedEvents: Array<{ date: string; name: string; meetPriorityTier?: MeetPriorityTier }>;
  todayIso: string;
}): {
  dayChanges: WeeklyGitDiffDayChange[];
  meetNote: string | null;
} {
  const { dayChanges, plannedEvents, todayIso } = params;

  let upcomingChampDays: number | null = null;
  const tierByDayIdx = new Map<number, MeetPriorityTier>();

  for (const ev of plannedEvents) {
    const tier = inferMeetPriorityTier(ev.name, ev.meetPriorityTier);
    if (!tier) continue;
    const d = (ev.date || '').slice(0, 10);
    const diff = daysBetweenIso(todayIso, d);
    if (tier === 'CHAMPIONSHIP_A' && diff >= 0 && diff <= 21) {
      upcomingChampDays =
        upcomingChampDays === null ? diff : Math.min(upcomingChampDays, diff);
    }
    const idx = dayChanges.findIndex((c) => c.date === d);
    if (idx >= 0) {
      tierByDayIdx.set(idx, tier);
    }
  }

  if (tierByDayIdx.size === 0 && upcomingChampDays === null) {
    return { dayChanges, meetNote: null };
  }

  let dualIdx: number | null = null;
  let weekendMeetIdx: number | null = null;

  for (const [idx, tier] of tierByDayIdx.entries()) {
    if (tier === 'DUAL_TRAINING_THROUGH' && dualIdx === null) {
      dualIdx = idx;
    } else if (
      (tier === 'INVITATIONAL_B' || tier === 'CHAMPIONSHIP_A') &&
      (weekendMeetIdx === null || idx > weekendMeetIdx)
    ) {
      weekendMeetIdx = idx;
    }
  }

  const next = dayChanges.map((d) => ({ ...d }));
  const notes: string[] = [];

  // 1. Double-meet week micro-periodization: e.g. Tue Dual + Sat Invitational
  if (dualIdx !== null && weekendMeetIdx !== null && weekendMeetIdx > dualIdx) {
    notes.push(
      `Meet-aware Tue Dual + Weekend Invitational micro-periodization active`
    );

    if (dualIdx - 1 >= 0 && !tierByDayIdx.has(dualIdx - 1)) {
      const target = next[dualIdx - 1];
      next[dualIdx - 1] = {
        ...target,
        changeType: 'MODIFIED',
        proposedTitle: 'Pre-Meet Shakeout + 4x150m Strides',
        proposedDurationMins: 32,
        proposedTss: 28,
        proposedWorkoutSyntax: 'Warmup\n- 22m 68% Pace\nMain Set\n- 4x 150m FR / 250m walk\n',
        reason: 'Protects dual-meet pop while keeping aerobic tension light.',
      };
    }

    const dualDay = next[dualIdx];
    next[dualIdx] = {
      ...dualDay,
      changeType: 'MODIFIED',
      proposedTitle: `${dualDay.originalTitle} + Optional 4x200m CV Top-Off`,
      reason:
        'Mid-week Dual treated as quality threshold/race stimulus rather than full taper.',
    };

    for (let k = dualIdx + 1; k < weekendMeetIdx; k++) {
      if (tierByDayIdx.has(k)) continue;
      const mid = next[k];
      const isRightAfterDual = k === dualIdx + 1;
      const isNightBefore = k === weekendMeetIdx - 1;
      if (isRightAfterDual || /vo2|interval|threshold|tempo/i.test(mid.originalTitle) || mid.originalTss >= 65) {
        next[k] = {
          ...mid,
          changeType: 'MODIFIED',
          proposedTitle: isNightBefore
            ? 'Pre-Invitational Shakeout + 4x150m Neuromuscular Strides'
            : 'Post-Dual Z1/Z2 Recovery Flush (Zero VO2 Overload)',
          proposedDurationMins: isNightBefore ? 30 : 40,
          proposedTss: isNightBefore ? 26 : 34,
          proposedWorkoutSyntax: isNightBefore
            ? 'Warmup\n- 20m 65% Pace\nMain Set\n- 4x 150m FR / 250m walk\n'
            : 'Main Set\n- 40m 68% Pace\n',
          reason:
            'Stripped mid-week high-glycolytic work between Dual Meet & Weekend Invitational so legs arrive fresh.',
        };
      }
    }
  }

  // 2. Championship A-Race 3-Week Progressive Volume Taper (-25% / -40% / -55%)
  if (upcomingChampDays !== null) {
    const scaleFactor =
      upcomingChampDays <= 7 ? 0.45 : upcomingChampDays <= 14 ? 0.6 : 0.75;
    const dropPct = Math.round((1 - scaleFactor) * 100);
    notes.push(
      `Championship A-Meet Taper (${upcomingChampDays}d out, -${dropPct}% volume w/ fast touches)`
    );

    for (let i = 0; i < next.length; i++) {
      if (tierByDayIdx.get(i) === 'CHAMPIONSHIP_A') continue;
      const day = next[i];
      if (day.originalTss >= 45 && day.changeType === 'UNCHANGED') {
        next[i] = {
          ...day,
          changeType: 'MODIFIED',
          proposedTitle: `${day.originalTitle} (Champ Taper -${dropPct}% Vol)`,
          proposedDurationMins: Math.max(25, Math.round(day.originalDurationMins * scaleFactor)),
          proposedTss: Math.max(22, Math.round(day.originalTss * scaleFactor)),
          reason: `Championship A-meet ${upcomingChampDays}d away: trims aerobic volume -${dropPct}% while retaining R/FR leg speed.`,
        };
      }
    }
  }

  return {
    dayChanges: next,
    meetNote: notes.length > 0 ? notes.join(' · ') : null,
  };
}

/**
 * Computes compounded physiological TSS across multiple track events raced on the same meet day,
 * deduplicating shared warmup/cooldown load and applying `1 + 0.14 * (k - 1)` compounding.
 */
export function computeMultiEventMeetDayTss(
  events: Array<{
    eventLabel: string;
    distanceMeters: number;
    timeSecs: number;
    includeWarmupCooldown?: boolean;
  }>
): MultiEventMeetDaySummary {
  const valid = events.filter((e) => e.distanceMeters > 0 && e.timeSecs > 0);
  const k = valid.length;
  if (k === 0) {
    return {
      eventCount: 0,
      netRaceTssSum: 0,
      compoundingMultiplier: 1,
      compoundedRaceTss: 0,
      sharedWarmupCooldownTss: 0,
      totalMeetTss: 0,
    };
  }

  let netRaceTssSum = 0;
  let wantsWarmup = false;
  for (const ev of valid) {
    if (ev.includeWarmupCooldown !== false) wantsWarmup = true;
    netRaceTssSum += computeOfficialRaceTrainingLoad(ev.distanceMeters, ev.timeSecs, false);
  }

  const compoundingMultiplier = Number((1 + 0.14 * (k - 1)).toFixed(2));
  const compoundedRaceTss = Math.round(netRaceTssSum * compoundingMultiplier);
  const sharedWarmupCooldownTss = wantsWarmup ? 32 : 0;

  return {
    eventCount: k,
    netRaceTssSum,
    compoundingMultiplier,
    compoundedRaceTss,
    sharedWarmupCooldownTss,
    totalMeetTss: compoundedRaceTss + sharedWarmupCooldownTss,
  };
}

function predictRelayLegSplitSecs(
  candidate: RelayCandidateInput,
  distanceMeters: 400 | 800 | 1200 | 1600,
  legNumber: 1 | 2 | 3 | 4
): { splitSecs: number; phenotype: SpeedReservePhenotype; rationale: string } {
  const profile = buildTrackSpeedReserveProfile({
    marks: candidate.seedMarks,
    thresholdPaceSecsPerKm: candidate.thresholdPaceSecsPerKm || 240,
    maxSprintSpeedMps: candidate.mssMps,
    phenotypeOverride: candidate.phenotype,
  });
  const effectiveDPrime = candidate.dPrimeMeters ?? profile.dPrimeMeters;
  const effectiveMss = candidate.mssMps ?? profile.mssMps;
  const cs = Math.max(2.2, profile.csMps);

  let rawSplitSecs = 60;
  let rationale = '';

  if (distanceMeters === 400) {
    // 400m weights Peak Speed / ASR (~70%) and glycolytic D' reserve (~30%)
    const dFactor = 0.55;
    const hyper400Mps =
      400 / Math.max(40, (400 - Math.min(310, effectiveDPrime) * dFactor) / Math.max(2.4, cs * 1.15));
    const speedReserveVel = effectiveMss * 0.855;
    const blendedVel = 0.3 * hyper400Mps + 0.7 * speedReserveVel;
    const phenotypeBonus =
      profile.phenotype === 'SPEED' ? 0.98 : profile.phenotype === 'HYBRID' ? 1.0 : 1.025;
    rawSplitSecs = (400 / Math.max(3.8, blendedVel)) * phenotypeBonus;
    rationale = `ASR ${profile.asrMps.toFixed(2)} m/s (${profile.phenotype}) maximizes 400m speed reserve`;
  } else {
    // Above 800m, sustainable aerobic CS dominates while excess sprint D' decays quadratically
    const cappedDPrime =
      distanceMeters === 800
        ? Math.min(265, effectiveDPrime) * 0.85
        : distanceMeters === 1200
          ? Math.min(230, effectiveDPrime) * 0.85
          : Math.min(215, effectiveDPrime) * 0.85;
    const hyperSecs = Math.max(
      distanceMeters / 7.5,
      (distanceMeters - cappedDPrime) / cs
    );
    const phenotypeFactor =
      distanceMeters === 800
        ? profile.phenotype === 'SPEED'
          ? 0.992
          : 1.0
        : profile.phenotype === 'ENDURANCE'
          ? 0.985
          : profile.phenotype === 'HYBRID'
            ? 0.996
            : 1.03;
    rawSplitSecs = hyperSecs * phenotypeFactor;
    rationale = `CS ${cs.toFixed(2)} m/s + D' ${Math.round(effectiveDPrime)}m anchors ${distanceMeters}m strength`;
  }

  // Flying exchange saves block acceleration reaction time on legs 2-4
  const flyingAdvantage = legNumber === 1 ? 0 : distanceMeters === 400 ? 0.3 : 0.25;
  const splitSecs = Number(Math.max(42, rawSplitSecs - flyingAdvantage).toFixed(2));

  return { splitSecs, phenotype: profile.phenotype, rationale };
}

/**
 * Solves the optimal 4-leg permutation across a squad using each runner's `CS + D'` and `ASR`
 * phenotype (`SPEED` on 400m legs, `ENDURANCE` on 1200m/1600m anchor/opener) including flying handoffs.
 */
export function optimizeTrackRelayLineup(params: {
  relayEvent: TrackRelayEventType;
  candidates: RelayCandidateInput[];
}): RelayLineupOptimizationResult {
  const legDistances = RELAY_LEG_DISTANCES[params.relayEvent];
  const poolInput = params.candidates.slice();

  if (poolInput.length === 0) {
    return {
      relayEvent: params.relayEvent,
      totalPredictedSecs: 0,
      displayTotalTime: '0:00.00',
      legs: [],
      alternateTotalSecs: null,
      gainOverDefaultSecs: 0,
    };
  }

  // Pad if <4 athletes provided for solo/small group simulation, otherwise select top <= 8 specialists
  const effectivePool =
    poolInput.length >= 4
      ? [...poolInput]
          .sort((a, b) => a.thresholdPaceSecsPerKm - b.thresholdPaceSecsPerKm)
          .slice(0, 8)
      : Array.from({ length: 4 }, (_, i) => poolInput[i % poolInput.length]);

  const n = effectivePool.length;
  const scoreMatrix: Array<Array<{ splitSecs: number; phenotype: SpeedReservePhenotype; rationale: string }>> =
    effectivePool.map((cand) =>
      legDistances.map((dist, legIdx) =>
        predictRelayLegSplitSecs(cand, dist, (legIdx + 1) as 1 | 2 | 3 | 4)
      )
    );

  let bestTotal = Infinity;
  let secondBestTotal = Infinity;
  let bestIndices: [number, number, number, number] = [0, 1 % n, 2 % n, 3 % n];

  const uniqueMode = poolInput.length >= 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (uniqueMode && j === i) continue;
      for (let k = 0; k < n; k++) {
        if (uniqueMode && (k === i || k === j)) continue;
        for (let m = 0; m < n; m++) {
          if (uniqueMode && (m === i || m === j || m === k)) continue;
          const total =
            scoreMatrix[i][0].splitSecs +
            scoreMatrix[j][1].splitSecs +
            scoreMatrix[k][2].splitSecs +
            scoreMatrix[m][3].splitSecs;
          if (total < bestTotal) {
            secondBestTotal = bestTotal;
            bestTotal = total;
            bestIndices = [i, j, k, m];
          } else if (total < secondBestTotal && total > bestTotal + 0.01) {
            secondBestTotal = total;
          }
        }
      }
    }
  }

  const naiveTotal =
    scoreMatrix[0][0].splitSecs +
    scoreMatrix[Math.min(1, n - 1)][1].splitSecs +
    scoreMatrix[Math.min(2, n - 1)][2].splitSecs +
    scoreMatrix[Math.min(3, n - 1)][3].splitSecs;

  const legs: OptimizedRelayLeg[] = bestIndices.map((candIdx, legIdx) => {
    const legNum = (legIdx + 1) as 1 | 2 | 3 | 4;
    const cand = effectivePool[candIdx];
    const pred = scoreMatrix[candIdx][legIdx];
    const dist = legDistances[legIdx];
    return {
      legNumber: legNum,
      distanceMeters: dist,
      athleteId: cand.id,
      athleteName: cand.name,
      phenotype: pred.phenotype,
      splitContext: legNum === 1 ? 'RELAY_LEADOFF' : 'RELAY_FLYING',
      predictedSplitSecs: pred.splitSecs,
      displaySplit: formatFatTime(pred.splitSecs),
      rationale: `${legNum === 1 ? 'Leadoff Block' : 'Flying Exchange'} · ${pred.rationale}`,
    };
  });

  const roundedBest = Number(bestTotal.toFixed(2));
  return {
    relayEvent: params.relayEvent,
    totalPredictedSecs: roundedBest,
    displayTotalTime: formatFatTime(roundedBest),
    legs,
    alternateTotalSecs: Number.isFinite(secondBestTotal)
      ? Number(secondBestTotal.toFixed(2))
      : null,
    gainOverDefaultSecs: Number(Math.max(0, naiveTotal - roundedBest).toFixed(2)),
  };
}

/**
 * NFHS Hand-to-FAT standardization:
 * rounds hand stopwatch timing UP to the higher tenth, then adds `+0.24s` (<400m or strict NFHS all-events)
 * or `+0.14s` (>=400m tiered rule).
 */
export function convertHandTimeToNfhsFat(
  rawHandSecs: number,
  distanceMeters: number,
  ruleMode: 'TIERED_024_014' | 'NFHS_ALL_024' = 'TIERED_024_014'
): NfhsHandToFatResult {
  const safeRaw = Math.max(1, rawHandSecs || 0);
  const ceilingTenthSecs = Number((Math.ceil((safeRaw - 1e-9) * 10) / 10).toFixed(1));
  const addendSecs: 0.14 | 0.24 =
    distanceMeters < 400 || ruleMode === 'NFHS_ALL_024' ? 0.24 : 0.14;
  const fatEquivalentSecs = Number((ceilingTenthSecs + addendSecs).toFixed(2));

  return {
    rawHandSecs: Number(safeRaw.toFixed(2)),
    ceilingTenthSecs,
    addendSecs,
    fatEquivalentSecs,
    displayFatEquivalent: formatFatTime(fatEquivalentSecs),
    ruleLabel: `Ceiling Tenth (${ceilingTenthSecs.toFixed(1)}h) + ${addendSecs.toFixed(2)}s -> ${formatFatTime(fatEquivalentSecs)}`,
  };
}

/**
 * Builds a squad Top-Times leaderboard strictly separating `OPEN_FAT` / `HAND_CONVERTED` /
 * `RELAY_LEADOFF` official marks from `RELAY_FLYING` relay legs.
 */
export function buildSquadTopTimesBoard(
  entries: SquadLeaderboardMarkInput[],
  eventFilterLabel?: string
): SquadTopTimesBoard {
  const filtered = eventFilterLabel
    ? entries.filter((e) => e.eventLabel === eventFilterLabel)
    : entries;

  const normalized: SquadLeaderboardEntry[] = filtered.map((e) => {
    const fatSecs =
      e.timingMethod === 'HAND'
        ? convertHandTimeToNfhsFat(e.rawTimeSecs, e.distanceMeters).fatEquivalentSecs
        : Number(e.rawTimeSecs.toFixed(2));
    return {
      ...e,
      normalizedFatSecs: fatSecs,
      displayNormalizedTime:
        e.timingMethod === 'HAND' ? `${formatFatTime(fatSecs)}c` : formatFatTime(fatSecs),
      isOpenOrLeadoffEligible: e.splitContext !== 'RELAY_FLYING',
    };
  });

  const byFastest = (a: SquadLeaderboardEntry, b: SquadLeaderboardEntry) =>
    a.normalizedFatSecs - b.normalizedFatSecs;

  return {
    eventLabel: eventFilterLabel || filtered[0]?.eventLabel || 'Track Event',
    openAndLeadoffMarks: normalized
      .filter((e) => e.isOpenOrLeadoffEligible)
      .sort(byFastest),
    flyingRelaySplits: normalized
      .filter((e) => !e.isOpenOrLeadoffEligible)
      .sort(byFastest),
  };
}

/**
 * Batch-mints `VerifiedRacePassport` objects (`THV-XXXX-XXXX` hashes) directly from `#stopwatch`
 * timed `RACE` finishers, with optional NFHS `Hand -> FAT` standardization.
 */
export function batchGenerateStopwatchRacePassports(params: {
  sessionTitle: string;
  eventLabel: string;
  eventDistanceMeters: number;
  raceDateIso?: string;
  platform?: OfficialRacePlatform;
  isHandTimed?: boolean;
  finishers: Array<{
    runnerName: string;
    netTotalSecs: number;
    lapSplitsSecs: number[];
  }>;
}): VerifiedRacePassport[] {
  const {
    sessionTitle,
    eventLabel,
    eventDistanceMeters,
    raceDateIso = new Date().toISOString().slice(0, 10),
    platform = 'Official FAT',
    isHandTimed = false,
    finishers,
  } = params;

  const certDist = Math.max(200, eventDistanceMeters || 1600);
  const meetName = sessionTitle?.trim() || 'Trackside Timed Championship';

  return finishers
    .filter((f) => Number.isFinite(f.netTotalSecs) && f.netTotalSecs > 0)
    .map((f) => {
      const normalizedTotalSecs = isHandTimed
        ? convertHandTimeToNfhsFat(f.netTotalSecs, certDist).fatEquivalentSecs
        : Number(f.netTotalSecs.toFixed(2));
      const passport = generateVerifiedRacePassport({
        athleteName: f.runnerName,
        meetOrRaceName: meetName,
        eventLabel: isHandTimed ? `${eventLabel} (NFHS Hand->FAT)` : eventLabel,
        platform,
        raceDate: raceDateIso,
        certifiedDistanceMeters: certDist,
        rawGpsDistanceMeters: Math.round(certDist * 1.028), // Typical watch oval drift without snapping
        officialChipOrFatSecs: normalizedTotalSecs,
        officialSplitsSecs:
          f.lapSplitsSecs.length > 0 ? f.lapSplitsSecs : undefined,
      });
      return passport;
    });
}
