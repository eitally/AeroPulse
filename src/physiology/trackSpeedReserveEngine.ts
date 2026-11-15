import type {
  SpeedReservePhenotype,
  TrackSeedMarkInput,
  TrackSpeedReserveProfile,
  TrackTargetEventGroup,
  TrackTrainingZoneCode,
  TrackSeasonPhase,
  TrackZoneSplitRow,
} from '../types.ts';

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

const round1 = (val: number): number => Number(val.toFixed(1));
const round2 = (val: number): number => Number(val.toFixed(2));
const round3 = (val: number): number => Number(val.toFixed(3));

/**
 * Daniels & Gilbert (1979) oxygen cost (ml/kg/min) at running velocity `vMpm` (meters/min).
 */
export function vo2AtVelocityMpm(vMpm: number): number {
  const safeV = Math.max(50, vMpm);
  return -4.60 + 0.182258 * safeV + 0.000104 * safeV * safeV;
}

/**
 * Daniels & Gilbert (1979) fractional %VO2max sustainable for race duration `tMins` (minutes).
 */
export function pctVo2MaxAtDurationMins(tMins: number): number {
  const t = Math.max(0.5, tMins);
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/**
 * Exact positive quadratic root solving Daniels VO2(v) = targetVo2 in meters/min.
 */
export function solveVelocityMpmForTargetVo2(targetVo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.60 + Math.max(8, targetVo2));
  const discriminant = Math.max(0, b * b - 4 * a * c);
  return (-b + Math.sqrt(discriminant)) / (2 * a);
}

/**
 * Solve un-clamped track pace (s/km) for a fraction of aerobic VDOT, bounded only by domain safety limits.
 */
export function solveTrackPaceSecsPerKmForPctVdot(
  vdotAer: number,
  pctVo2: number,
  clampRange: [number, number] = [95, 540]
): number {
  const safeVdot = clamp(vdotAer || 50, 20, 92);
  const vMpm = solveVelocityMpmForTargetVo2(safeVdot * pctVo2);
  const rawPaceSecsPerKm = 60000 / Math.max(80, vMpm);
  return round1(clamp(rawPaceSecsPerKm, clampRange[0], clampRange[1]));
}

/**
 * Compute raw Daniels VDOT from a single distance/duration performance mark.
 */
export function computeRawMarkVdot(distanceMeters: number, durationSecs: number): number {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSecs)) return 50;
  if (distanceMeters < 150 || durationSecs < 15) return 50;
  const tMins = Math.max(0.75, durationSecs / 60);
  const vMpm = distanceMeters / tMins;
  const raw = vo2AtVelocityMpm(vMpm) / Math.max(0.55, pctVo2MaxAtDurationMins(tMins));
  return round2(clamp(raw, 22, 92));
}

function buildSplitRow(
  code: TrackTrainingZoneCode,
  name: string,
  pctVdotAer: number,
  paceSecsPerKm: number
): TrackZoneSplitRow {
  const safePace = Math.max(95, paceSecsPerKm);
  const speedMps = 1000 / safePace;
  return {
    code,
    name,
    pctVdotAer: round3(pctVdotAer),
    paceSecsPerKm: round1(safePace),
    speedMps: round3(speedMps),
    splitsSecs: {
      m200: round1((safePace * 200) / 1000),
      m300: round1((safePace * 300) / 1000),
      m400: round1((safePace * 400) / 1000),
      m600: round1((safePace * 600) / 1000),
      m800: round1((safePace * 800) / 1000),
      m1000: round1(safePace),
      m1200: round1((safePace * 1200) / 1000),
      m1600: round1((safePace * 1600) / 1000),
    },
  };
}

/**
 * Deduplicate race/time-trial marks into 50m buckets (keeping the fastest per distance)
 * and fit OLS regression `d = CS * t + D'` across severe/heavy-domain marks (600m-5000m preferred).
 */
export function solveCriticalSpeedAndDPrimeOls(
  marks: TrackSeedMarkInput[]
): { csMps: number; dPrimeMeters: number; usedMarksCount: number } | null {
  const valid = marks.filter(
    (m) =>
      Number.isFinite(m.distanceMeters) &&
      Number.isFinite(m.durationSecs) &&
      m.distanceMeters >= 550 &&
      m.distanceMeters <= 10000 &&
      m.durationSecs >= 45
  );
  if (valid.length < 2) return null;

  const bestByBucket = new Map<number, TrackSeedMarkInput>();
  for (const m of valid) {
    const bucket = Math.round(m.distanceMeters / 50) * 50;
    const existing = bestByBucket.get(bucket);
    if (!existing || m.durationSecs < existing.durationSecs) {
      bestByBucket.set(bucket, m);
    }
  }

  const allDistinct = Array.from(bestByBucket.values()).sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );
  const trackSevere = allDistinct.filter(
    (m) => m.distanceMeters >= 600 && m.distanceMeters <= 5000
  );

  const pickPool = (pool: TrackSeedMarkInput[], minDistSpan: number, minTimeSpan: number) => {
    if (pool.length < 2) return false;
    const dSpan = pool[pool.length - 1].distanceMeters - pool[0].distanceMeters;
    const tSpan =
      Math.max(...pool.map((p) => p.durationSecs)) -
      Math.min(...pool.map((p) => p.durationSecs));
    return dSpan >= minDistSpan && tSpan >= minTimeSpan;
  };

  const chosen = pickPool(trackSevere, 600, 45)
    ? trackSevere
    : pickPool(allDistinct, 500, 35)
      ? allDistinct
      : null;
  if (!chosen) return null;

  const n = chosen.length;
  const meanT = chosen.reduce((acc, m) => acc + m.durationSecs, 0) / n;
  const meanD = chosen.reduce((acc, m) => acc + m.distanceMeters, 0) / n;

  let num = 0;
  let den = 0;
  for (const m of chosen) {
    const dt = m.durationSecs - meanT;
    const dd = m.distanceMeters - meanD;
    num += dt * dd;
    den += dt * dt;
  }
  if (den <= 1e-6) return null;

  const rawCs = num / den;
  const csMps = round3(clamp(rawCs, 2.5, 6.8));
  const rawDPrime = meanD - csMps * meanT;
  const dPrimeMeters = Math.round(clamp(rawDPrime, 110, 420));

  return { csMps, dPrimeMeters, usedMarksCount: n };
}

/**
 * Classify athlete Speed-Reserve phenotype from Speed Reserve Ratio (SRR = MSS / MAS) and D'.
 */
export function classifySpeedReservePhenotype(
  srr: number,
  dPrimeMeters: number,
  override?: SpeedReservePhenotype | 'AUTO'
): SpeedReservePhenotype {
  if (override && override !== 'AUTO') return override;
  if (srr >= 1.58 || dPrimeMeters > 235) return 'SPEED';
  if (srr < 1.48 || dPrimeMeters < 205) return 'ENDURANCE';
  return 'HYBRID';
}

export interface BuildSpeedReserveInput {
  marks?: TrackSeedMarkInput[];
  thresholdPaceSecsPerKm?: number;
  maxSprintSpeedMps?: number;
  flying30mSecs?: number;
  phenotypeOverride?: SpeedReservePhenotype | 'AUTO';
}

/**
 * Full 2-parameter Speed-Reserve (CS + D' & Sandford-Laursen ASR) + 7-zone Track Pace Solver.
 */
export function buildTrackSpeedReserveProfile(
  input: BuildSpeedReserveInput = {}
): TrackSpeedReserveProfile {
  const {
    marks = [],
    thresholdPaceSecsPerKm,
    maxSprintSpeedMps,
    flying30mSecs,
    phenotypeOverride = 'AUTO',
  } = input;

  const validMarks = marks
    .filter(
      (m) =>
        Number.isFinite(m.distanceMeters) &&
        Number.isFinite(m.durationSecs) &&
        m.distanceMeters >= 200 &&
        m.durationSecs >= 20
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const vdotRawBest =
    validMarks.length > 0
      ? Math.max(...validMarks.map((m) => computeRawMarkVdot(m.distanceMeters, m.durationSecs)))
      : thresholdPaceSecsPerKm && thresholdPaceSecsPerKm > 0
        ? round2(
            clamp(
              vo2AtVelocityMpm(60000 / clamp(thresholdPaceSecsPerKm, 130, 460)) / 0.88,
              22,
              90
            )
          )
        : 50;

  const ols = solveCriticalSpeedAndDPrimeOls(validMarks);

  let modelSource: TrackSpeedReserveProfile['modelSource'] = 'PROFILE_THRESHOLD_FALLBACK';
  let csMps = 3.85;
  let dPrimeMeters = 215;
  let vdotAer = 50;

  if (ols) {
    modelSource = 'MULTI_MARK_CS_DPRIME';
    csMps = ols.csMps;
    dPrimeMeters = ols.dPrimeMeters;
    // Anchor CS at t = 35 min (pctVo2max ≈ 0.9215) to avoid middle-distance anaerobic inflation
    vdotAer = round2(clamp(vo2AtVelocityMpm(csMps * 60) / 0.9215, 22, 90));
  } else if (validMarks.length > 0) {
    modelSource = 'SINGLE_MARK_SCALED';
    // Prefer longest mark >= 600m if multiple short marks exist (e.g. 400m + 1600m)
    const primary =
      [...validMarks].reverse().find((m) => m.distanceMeters >= 600) ??
      validMarks[validMarks.length - 1];
    const rawVdot = computeRawMarkVdot(primary.distanceMeters, primary.durationSecs);

    let alpha = 1.0;
    if (primary.distanceMeters <= 900) {
      alpha = 0.945;
    } else if (primary.distanceMeters <= 1650) {
      alpha =
        phenotypeOverride === 'SPEED'
          ? 0.96
          : phenotypeOverride === 'ENDURANCE'
            ? 0.99
            : 0.975;
    }

    vdotAer = round2(clamp(rawVdot * alpha, 22, 90));
    csMps = round3(clamp(solveVelocityMpmForTargetVo2(0.9215 * vdotAer) / 60, 2.5, 6.8));

    const dPrimePrior =
      phenotypeOverride === 'SPEED' ? 265 : phenotypeOverride === 'ENDURANCE' ? 180 : 215;
    if (primary.distanceMeters <= 1650) {
      const impliedD = clamp(primary.distanceMeters - csMps * primary.durationSecs, 140, 320);
      dPrimeMeters = Math.round(0.5 * dPrimePrior + 0.5 * impliedD);
    } else {
      dPrimeMeters = dPrimePrior;
    }
  } else {
    modelSource = 'PROFILE_THRESHOLD_FALLBACK';
    const safeThresh = clamp(thresholdPaceSecsPerKm || 255, 130, 460);
    vdotAer = round2(clamp(vo2AtVelocityMpm(60000 / safeThresh) / 0.88, 22, 90));
    csMps = round3(clamp(solveVelocityMpmForTargetVo2(0.9215 * vdotAer) / 60, 2.5, 6.8));
    dPrimeMeters =
      phenotypeOverride === 'SPEED' ? 260 : phenotypeOverride === 'ENDURANCE' ? 180 : 215;
  }

  // Sandford-Laursen Maximal Aerobic Speed (MAS) & Max Sprint Speed (MSS)
  const masMps = round3(solveVelocityMpmForTargetVo2(vdotAer) / 60);

  let mssMps: number;
  if (typeof maxSprintSpeedMps === 'number' && maxSprintSpeedMps >= 4.5) {
    mssMps = clamp(maxSprintSpeedMps, 4.5, 11.2);
  } else if (typeof flying30mSecs === 'number' && flying30mSecs >= 2.6 && flying30mSecs <= 8.0) {
    mssMps = clamp(30 / flying30mSecs, 4.5, 11.2);
  } else {
    // Estimate MSS from MAS + D' curvature + any <= 800m sprint/middle marks
    const mssFromDPrime = masMps * (1.26 + 0.00118 * dPrimeMeters);
    const mark400 = validMarks.find(
      (m) => m.distanceMeters >= 350 && m.distanceMeters <= 450
    );
    const mark800 = validMarks.find(
      (m) => m.distanceMeters >= 750 && m.distanceMeters <= 850
    );
    const est400 = mark400 ? (mark400.distanceMeters / mark400.durationSecs) * 1.11 : 0;
    const est800 = mark800 ? (mark800.distanceMeters / mark800.durationSecs) * 1.23 : 0;
    mssMps = clamp(Math.max(mssFromDPrime, est400, est800), 4.5, 11.2);
  }
  mssMps = round3(mssMps);

  const asrMps = round2(Math.max(1.2, mssMps - masMps));
  const srr = round3(mssMps / Math.max(2.0, masMps));
  const phenotype = classifySpeedReservePhenotype(srr, dPrimeMeters, phenotypeOverride);

  // Full 7-Zone Track Pace Engine
  const paceE = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.70, [175, 540]);
  const paceSubT = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.86, [140, 430]);
  const paceT = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.88, [140, 430]);
  const paceCv = round1(clamp(1000 / csMps, 135, 420));
  const paceI = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.98, [125, 390]);

  const t1550 = (1550 - dPrimeMeters) / csMps;
  const pace1550Hyperbolic = (Math.max(185, t1550) / 1550) * 1000;
  const rawPaceR =
    modelSource === 'PROFILE_THRESHOLD_FALLBACK'
      ? Math.min(paceI - 15, pace1550Hyperbolic)
      : Math.min(paceI - 6, pace1550Hyperbolic);
  const paceR = round1(clamp(rawPaceR, 110, 360));

  // FR uses 800m effective hyperbolic speed (80% D' utilization) vs MAS + 35% ASR
  const t800Eff = (800 - 0.80 * dPrimeMeters) / csMps;
  const v800Eff = 800 / Math.max(92, t800Eff);
  const vFr = Math.max(v800Eff, masMps + 0.35 * asrMps, 1000 / Math.max(105, paceR - 10));
  const paceFr = round1(clamp(1000 / vFr, 95, 330));

  const zones: Record<TrackTrainingZoneCode, TrackZoneSplitRow> = {
    E: buildSplitRow('E', 'Easy / Recovery', 0.70, paceE),
    SUB_T: buildSplitRow('SUB_T', 'Norwegian Sub-Threshold', 0.86, paceSubT),
    T: buildSplitRow('T', 'Lactate Threshold', 0.88, paceT),
    CV: buildSplitRow('CV', 'Critical Velocity (CS)', 0.9215, paceCv),
    I: buildSplitRow('I', 'VO2max Interval', 0.98, paceI),
    R: buildSplitRow('R', 'Mile / 1500m Repetition', 1.07, paceR),
    FR: buildSplitRow('FR', '800m / Fast Repetition', 1.18, paceFr),
  };

  return {
    modelSource,
    csMps,
    criticalPaceSecsPerKm: paceCv,
    dPrimeMeters,
    vdotAer,
    vdotRawBest,
    masMps,
    mssMps,
    asrMps,
    srr,
    phenotype,
    thresholdPaceSecsPerKm: paceT,
    zones,
  };
}

/**
 * Norwegian broken short-rep (400m) Sub-Threshold pace (~89.5% VDOT_aer).
 */
export function solveShortSubThresholdPaceSecsPerKm(
  profile: TrackSpeedReserveProfile
): number {
  return solveTrackPaceSecsPerKmForPctVdot(profile.vdotAer, 0.895, [135, 420]);
}

export function defaultMetersForTrackEvent(eventGroup: TrackTargetEventGroup): number {
  switch (eventGroup) {
    case '800M':
      return 800;
    case '1500_MILE':
      return 1609.34;
    case '3000_3200M':
      return 3200;
    case '5000M':
    default:
      return 5000;
  }
}

export interface BlendedWeekZonesResult {
  zones: Record<TrackTrainingZoneCode, TrackZoneSplitRow>;
  deltaMaxPct: number;
  rawGoalGapPct: number;
  ambitiousGoalWarning: boolean;
  appliedWeights: {
    wAer: number;
    wI: number;
    wSpec: number;
  };
}

/**
 * 16-Week Safe Date-Pace to Goal-Pace Blending:
 * - Aerobic/Threshold zones (E, SUB_T, T, CV) are strictly locked to Date Pace (w_aer = 0.00).
 * - VO2max (I) blends up to w_I <= 0.35 in Weeks 9-16.
 * - Specific/Neuromuscular (R, FR) blends by phase toward capped Goal Pace (+deltaMax).
 */
export function blendTrackZonesForWeek(params: {
  dateProfile: TrackSpeedReserveProfile;
  targetEvent?: TrackTargetEventGroup;
  goalTimeSecs?: number;
  weekNum: number;
  totalWeeks: number;
  phase: TrackSeasonPhase;
}): BlendedWeekZonesResult {
  const { dateProfile, targetEvent = '1500_MILE', goalTimeSecs, weekNum, totalWeeks, phase } = params;
  const deltaMax = round3(clamp(0.060 - 0.00045 * dateProfile.vdotAer, 0.020, 0.050));

  if (!goalTimeSecs || !Number.isFinite(goalTimeSecs) || goalTimeSecs <= 0) {
    return {
      zones: dateProfile.zones,
      deltaMaxPct: round1(deltaMax * 100),
      rawGoalGapPct: 0,
      ambitiousGoalWarning: false,
      appliedWeights: { wAer: 0, wI: 0, wSpec: 0 },
    };
  }

  const eventMeters = defaultMetersForTrackEvent(targetEvent);
  const goalProfile = buildTrackSpeedReserveProfile({
    marks: [{ distanceMeters: eventMeters, durationSecs: goalTimeSecs }],
    phenotypeOverride: dateProfile.phenotype,
  });

  // Measure gap against the event's key anchor zone (FR for 800, R for Mile, CS/CV for 3k/5k)
  const anchorZone: TrackTrainingZoneCode =
    targetEvent === '800M'
      ? 'FR'
      : targetEvent === '1500_MILE'
        ? 'R'
        : 'CV';
  const dateAnchorSpeed = dateProfile.zones[anchorZone].speedMps;
  const goalAnchorSpeed = goalProfile.zones[anchorZone].speedMps;
  const rawGoalGap = Math.max(0, (goalAnchorSpeed - dateAnchorSpeed) / Math.max(1.5, dateAnchorSpeed));
  const ambitiousGoalWarning = rawGoalGap > deltaMax;

  const progress = clamp((weekNum - 1) / Math.max(1, totalWeeks - 1), 0, 1);
  const wAer = 0; // Always train aerobic systems on today's verified Date Pace
  const wI = progress <= 0.5 ? 0 : round3(((progress - 0.5) / 0.5) * 0.35);

  let wSpec = 0;
  if (phase === 'BASE') {
    wSpec = 0;
  } else if (phase === 'STRENGTH_CV') {
    wSpec = 0.15;
  } else if (phase === 'SPECIFIC') {
    wSpec = 0.55;
  } else if (phase === 'PEAK_TAPER') {
    wSpec = weekNum >= totalWeeks ? 1.0 : 0.85;
  }

  const blendZone = (code: TrackTrainingZoneCode, weight: number): TrackZoneSplitRow => {
    const dateRow = dateProfile.zones[code];
    if (weight <= 0) return dateRow;
    const goalRow = goalProfile.zones[code];
    // Never slow a faster date zone down toward an easier goal, and cap improvement at deltaMax
    const maxSafeSpeed = dateRow.speedMps * (1 + deltaMax);
    const cappedGoalSpeed = clamp(goalRow.speedMps, dateRow.speedMps, maxSafeSpeed);
    const blendedSpeed = (1 - weight) * dateRow.speedMps + weight * cappedGoalSpeed;
    const blendedPace = 1000 / Math.max(1.0, blendedSpeed);
    return buildSplitRow(code, dateRow.name, dateRow.pctVdotAer, blendedPace);
  };

  const zones: Record<TrackTrainingZoneCode, TrackZoneSplitRow> = {
    E: dateProfile.zones.E,
    SUB_T: dateProfile.zones.SUB_T,
    T: dateProfile.zones.T,
    CV: dateProfile.zones.CV,
    I: blendZone('I', wI),
    R: blendZone('R', wSpec),
    FR: blendZone('FR', wSpec),
  };

  return {
    zones,
    deltaMaxPct: round1(deltaMax * 100),
    rawGoalGapPct: round1(rawGoalGap * 100),
    ambitiousGoalWarning,
    appliedWeights: { wAer, wI, wSpec },
  };
}

/**
 * Parses a clock string or race mark (e.g. "4:05", "4:05 Mile", "1:54 800m", "16:20 5K")
 * into distanceMeters & durationSecs, defaulting bare clocks to `defaultDistanceMeters`.
 */
export function parseTrackMarkClockInput(
  rawInput: string,
  defaultDistanceMeters = 1609.34
): TrackSeedMarkInput | null {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;

  const clockMatch = raw.match(/(\d{1,2}):(\d{2}(?:\.\d+)?)/);
  let durationSecs = 0;
  if (clockMatch) {
    durationSecs = Number(clockMatch[1]) * 60 + Number(clockMatch[2]);
  } else {
    const secMatch = raw.match(/^(\d{2,3}(?:\.\d+)?)\s*s?$/i);
    if (secMatch) durationSecs = Number(secMatch[1]);
  }
  if (!Number.isFinite(durationSecs) || durationSecs < 18) return null;

  const lower = raw.toLowerCase();
  let distanceMeters = defaultDistanceMeters;
  let eventLabel = `${Math.round(defaultDistanceMeters)}m`;

  if (/\b400\s*m?\b/.test(lower)) {
    distanceMeters = 400;
    eventLabel = '400m';
  } else if (/\b800\s*m?\b/.test(lower)) {
    distanceMeters = 800;
    eventLabel = '800m';
  } else if (/\b1500\s*m?\b/.test(lower)) {
    distanceMeters = 1500;
    eventLabel = '1500m';
  } else if (/\b1600\s*m?\b/.test(lower)) {
    distanceMeters = 1600;
    eventLabel = '1600m';
  } else if (/\bmile\b|\b1\s*mi\b/.test(lower)) {
    distanceMeters = 1609.34;
    eventLabel = '1 Mile';
  } else if (/\b3000\s*m?\b|\b3k\b/.test(lower)) {
    distanceMeters = 3000;
    eventLabel = '3000m';
  } else if (/\b3200\s*m?\b|\b2\s*mi\b/.test(lower)) {
    distanceMeters = 3200;
    eventLabel = '3200m';
  } else if (/\b5000\s*m?\b|\b5k\b/.test(lower)) {
    distanceMeters = 5000;
    eventLabel = '5000m';
  }

  return { distanceMeters, durationSecs, eventLabel };
}
