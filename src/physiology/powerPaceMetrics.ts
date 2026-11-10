/**
 * @thresh/physiology — Canonical Power, Pace, GAP, TSS & VDOT Mathematics
 * Pure TypeScript, zero DOM/browser dependencies.
 */

export function computeNormalizedPower(wattsStream?: number[]): number | null {
  if (!Array.isArray(wattsStream) || wattsStream.length < 30) {
    if (Array.isArray(wattsStream) && wattsStream.length > 0) {
      const valid = wattsStream.filter((w) => Number.isFinite(w) && w >= 0);
      if (valid.length === 0) return null;
      return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    }
    return null;
  }

  const clean = wattsStream.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const windowSize = 30;
  let windowSum = 0;
  for (let i = 0; i < windowSize; i++) {
    windowSum += clean[i];
  }

  let fourthPowerSum = Math.pow(windowSum / windowSize, 4);
  let count = 1;

  for (let i = windowSize; i < clean.length; i++) {
    windowSum += clean[i] - clean[i - windowSize];
    const rollingAvg = windowSum / windowSize;
    fourthPowerSum += Math.pow(rollingAvg, 4);
    count++;
  }

  const np = Math.pow(fourthPowerSum / count, 0.25);
  return Number.isFinite(np) && np > 0 ? Math.round(np) : null;
}

export function computeIntensityFactor(effortWatts: number, ftpWatts: number): number {
  if (!(effortWatts > 0) || !(ftpWatts > 0)) return 0;
  return Math.round((effortWatts / ftpWatts) * 1000) / 1000;
}

export function computeCyclingTss(
  durationSecs: number,
  npOrAvgWatts: number,
  ftpWatts: number
): number {
  if (!(durationSecs > 0) || !(npOrAvgWatts > 0) || !(ftpWatts > 0)) return 0;
  const intensityFactor = npOrAvgWatts / ftpWatts;
  const tss = ((durationSecs * npOrAvgWatts * intensityFactor) / (ftpWatts * 3600)) * 100;
  return Math.round(tss * 10) / 10;
}

/**
 * Minetti et al. (2002) metabolic energy cost of running on slopes relative to flat ground.
 * @param gradeFraction Rise over run (e.g. 0.05 for +5% grade, -0.05 for -5% grade)
 */
export function computeMinettiCostMultiplier(gradeFraction: number): number {
  if (!Number.isFinite(gradeFraction)) return 1;
  const g = Math.max(-0.35, Math.min(0.35, gradeFraction));
  const cost =
    155.4 * Math.pow(g, 5) -
    30.4 * Math.pow(g, 4) -
    43.3 * Math.pow(g, 3) +
    46.3 * Math.pow(g, 2) +
    19.5 * g +
    3.6;
  return Math.max(0.55, Math.min(3.4, cost / 3.6));
}

/**
 * Computes per-second Grade-Adjusted Pace (GAP) velocity (m/s) and session average GAP (s/km).
 */
export function computeGradeAdjustedPaceStream(
  velocityMps?: number[],
  altitudeMeters?: number[],
  distanceMeters?: number[]
): { gapVelocityMps: number[]; avgGapSecsPerKm: number | null } {
  if (!Array.isArray(velocityMps) || velocityMps.length === 0) {
    return { gapVelocityMps: [], avgGapSecsPerKm: null };
  }

  const n = velocityMps.length;
  const hasAlt = Array.isArray(altitudeMeters) && altitudeMeters.length === n;
  const hasDist = Array.isArray(distanceMeters) && distanceMeters.length === n;
  const gapVelocityMps = new Array<number>(n);

  let movingGapSum = 0;
  let movingSamples = 0;

  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(velocityMps[i]) && velocityMps[i] > 0 ? velocityMps[i] : 0;
    if (v < 0.5) {
      gapVelocityMps[i] = 0;
      continue;
    }

    let grade = 0;
    if (hasAlt) {
      const lookback = Math.max(0, i - 5);
      const lookahead = Math.min(n - 1, i + 5);
      const dAlt = (altitudeMeters![lookahead] ?? 0) - (altitudeMeters![lookback] ?? 0);
      let dHoriz = 0;
      if (hasDist) {
        dHoriz = (distanceMeters![lookahead] ?? 0) - (distanceMeters![lookback] ?? 0);
      } else {
        for (let k = lookback + 1; k <= lookahead; k++) {
          dHoriz += Math.max(0, velocityMps[k] || 0);
        }
      }
      if (dHoriz >= 6) {
        grade = dAlt / dHoriz;
      }
    }

    const mult = computeMinettiCostMultiplier(grade);
    const gapV = v * mult;
    gapVelocityMps[i] = gapV;
    movingGapSum += gapV;
    movingSamples++;
  }

  if (movingSamples === 0 || movingGapSum <= 0) {
    return { gapVelocityMps, avgGapSecsPerKm: null };
  }

  const meanGapV = movingGapSum / movingSamples;
  const avgGapSecsPerKm = meanGapV > 0.5 ? Math.round((1000 / meanGapV) * 10) / 10 : null;
  return { gapVelocityMps, avgGapSecsPerKm };
}

export function computeRunningTss(
  durationSecs: number,
  gapSecsPerKm: number,
  thresholdPaceSecsPerKm: number
): number {
  if (!(durationSecs > 0) || !(gapSecsPerKm > 0) || !(thresholdPaceSecsPerKm > 0)) return 0;
  const intensityFactor = thresholdPaceSecsPerKm / gapSecsPerKm;
  const rtss = (durationSecs / 3600) * Math.pow(intensityFactor, 2) * 100;
  return Math.round(rtss * 10) / 10;
}

/**
 * Daniels & Gilbert VDOT oxygen-uptake kinetic estimator from race distance (m) and time (s).
 */
export function estimateVdotFromRace(distanceMeters: number, durationSecs: number): number {
  if (!(distanceMeters >= 400) || !(durationSecs > 45)) return 0;
  const durationMins = durationSecs / 60;
  const velocityMetersPerMin = distanceMeters / durationMins;
  const vo2 =
    -4.6 +
    0.182258 * velocityMetersPerMin +
    0.000104 * velocityMetersPerMin * velocityMetersPerMin;
  const pctMax =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * durationMins) +
    0.2989558 * Math.exp(-0.1932605 * durationMins);
  if (!(pctMax > 0.2) || !(vo2 > 5)) return 0;
  return Math.round((vo2 / pctMax) * 10) / 10;
}
