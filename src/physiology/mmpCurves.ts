import type {
  ActivityStreamSet,
  AthleteProfile,
  EmpiricalMmpModelSummary,
  EmpiricalMmpPoint,
  UnifiedActivity,
} from '../types';
import { computeGradeAdjustedPaceStream } from './powerPaceMetrics';

export const CANONICAL_MMP_DURATIONS: readonly { secs: number; label: string }[] = [
  { secs: 1, label: '1s' },
  { secs: 5, label: '5s' },
  { secs: 15, label: '15s' },
  { secs: 30, label: '30s' },
  { secs: 60, label: '1m' },
  { secs: 120, label: '2m' },
  { secs: 180, label: '3m' },
  { secs: 300, label: '5m' },
  { secs: 480, label: '8m' },
  { secs: 720, label: '12m' },
  { secs: 1200, label: '20m' },
  { secs: 1800, label: '30m' },
  { secs: 2700, label: '45m' },
  { secs: 3600, label: '60m' },
  { secs: 5400, label: '90m' },
  { secs: 7200, label: '2h' },
];

export interface SlidingWindowPeak {
  durationSecs: number;
  bestValue: number;
  startSecondOffset: number;
}

/**
 * O(N) prefix-sum sliding window peak finder for 1Hz telemetry arrays.
 */
export function computeSlidingWindowPeaks(
  stream: number[],
  durationsSecs: number[] = CANONICAL_MMP_DURATIONS.map((d) => d.secs)
): SlidingWindowPeak[] {
  const n = stream.length;
  if (n === 0) return [];

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = stream[i];
    prefix[i + 1] = prefix[i] + (Number.isFinite(v) && v > 0 ? v : 0);
  }

  const out: SlidingWindowPeak[] = [];
  for (const dur of durationsSecs) {
    if (dur <= 0 || dur > n) continue;
    let maxSum = -1;
    let bestStart = 0;
    for (let end = dur; end <= n; end++) {
      const sum = prefix[end] - prefix[end - dur];
      if (sum > maxSum) {
        maxSum = sum;
        bestStart = end - dur;
      }
    }
    const avg = maxSum / dur;
    if (avg > 0) {
      out.push({
        durationSecs: dur,
        bestValue: avg,
        startSecondOffset: bestStart,
      });
    }
  }
  return out;
}

/**
 * Fits a 3-parameter Critical Power model (CP, W', Pmax) via linear Work-Time regression
 * across aerobic/anaerobic test durations (180s to 1800s).
 */
export function fitCriticalPowerModel(
  samples: { durationSecs: number; watts: number }[]
): { cpWatts: number; wPrimeJoules: number; pMaxWatts: number } | null {
  const fitPoints = samples.filter(
    (s) => s.durationSecs >= 180 && s.durationSecs <= 2400 && s.watts > 40
  );
  if (fitPoints.length < 2) return null;

  let sumT = 0;
  let sumW = 0;
  let sumTT = 0;
  let sumTW = 0;
  const k = fitPoints.length;

  for (const pt of fitPoints) {
    const t = pt.durationSecs;
    const work = pt.watts * t;
    sumT += t;
    sumW += work;
    sumTT += t * t;
    sumTW += t * work;
  }

  const denom = k * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-6) return null;

  const rawCp = (k * sumTW - sumT * sumW) / denom;
  const rawWPrime = (sumW - rawCp * sumT) / k;

  const cpWatts = Math.max(80, Math.round(rawCp));
  const wPrimeJoules = Math.max(6000, Math.min(45000, Math.round(rawWPrime)));
  const sprintPeak = Math.max(
    ...samples.map((s) => s.watts),
    Math.round(cpWatts * 3.2)
  );
  const pMaxWatts = Math.max(cpWatts + 150, Math.round(sprintPeak));

  return { cpWatts, wPrimeJoules, pMaxWatts };
}

/**
 * Fits a 2-parameter Critical Speed model (CS in m/s, D' in meters) via Distance-Time regression
 * across running durations (180s to 1800s).
 */
export function fitCriticalSpeedModel(
  samples: { durationSecs: number; gapSecsPerKm: number }[]
): { csMps: number; dPrimeMeters: number; criticalPaceSecsPerKm: number } | null {
  const fitPoints = samples.filter(
    (s) => s.durationSecs >= 180 && s.durationSecs <= 2400 && s.gapSecsPerKm > 120
  );
  if (fitPoints.length < 2) return null;

  let sumT = 0;
  let sumD = 0;
  let sumTT = 0;
  let sumTD = 0;
  const k = fitPoints.length;

  for (const pt of fitPoints) {
    const t = pt.durationSecs;
    const speedMps = 1000 / pt.gapSecsPerKm;
    const dist = speedMps * t;
    sumT += t;
    sumD += dist;
    sumTT += t * t;
    sumTD += t * dist;
  }

  const denom = k * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-6) return null;

  const rawCs = (k * sumTD - sumT * sumD) / denom;
  const rawDPrime = (sumD - rawCs * sumT) / k;
  if (!(rawCs > 1.5 && rawCs < 8.0)) return null;

  const csMps = Math.round(rawCs * 1000) / 1000;
  const dPrimeMeters = Math.max(60, Math.min(600, Math.round(rawDPrime)));
  const criticalPaceSecsPerKm = Math.round((1000 / csMps) * 10) / 10;

  return { csMps, dPrimeMeters, criticalPaceSecsPerKm };
}

export function evaluateModeledMmpWatts(
  durationSecs: number,
  cpWatts: number,
  wPrimeJoules: number,
  pMaxWatts: number
): number {
  const denom = durationSecs + wPrimeJoules / Math.max(50, pMaxWatts - cpWatts);
  const raw = cpWatts + wPrimeJoules / Math.max(1, denom);
  // Subtle aerobic durability taper beyond 60m
  const enduranceDecay =
    durationSecs > 3600 ? Math.max(0.84, 1 - 0.045 * Math.log2(durationSecs / 3600)) : 1;
  return Math.round(raw * enduranceDecay);
}

export function evaluateModeledGapSecsPerKm(
  durationSecs: number,
  csMps: number,
  dPrimeMeters: number
): number {
  const maxSprintMps = csMps * 1.65;
  const denom = durationSecs + dPrimeMeters / Math.max(0.5, maxSprintMps - csMps);
  const rawSpeedMps = csMps + dPrimeMeters / Math.max(1, denom);
  const enduranceDecay =
    durationSecs > 3600 ? Math.max(0.86, 1 - 0.04 * Math.log2(durationSecs / 3600)) : 1;
  const effectiveSpeed = Math.max(1.2, rawSpeedMps * enduranceDecay);
  return Math.round((1000 / effectiveSpeed) * 10) / 10;
}

/**
 * Scans hydrated 1Hz streams + activity summary efforts to build a complete
 * empirical & modeled Power-Duration (MMP) and Running GAP-Duration summary.
 */
export function buildEmpiricalMmpSummary(
  activities: UnifiedActivity[],
  streamMap: ReadonlyMap<string, ActivityStreamSet>,
  athleteProfile?: AthleteProfile | null
): EmpiricalMmpModelSummary {
  const durations = CANONICAL_MMP_DURATIONS.map((d) => d.secs);

  const bestPowerByDur = new Map<
    number,
    { watts: number; act: UnifiedActivity; startSec: number }
  >();
  const bestPaceByDur = new Map<
    number,
    { gapSecsPerKm: number; act: UnifiedActivity; startSec: number }
  >();

  let scannedPowerStreamsCount = 0;
  let scannedPaceStreamsCount = 0;

  for (const act of activities) {
    const bundle = streamMap.get(act.id) || act.streams;
    if (bundle) {
      if (
        act.sportCategory === 'Cycling' &&
        Array.isArray(bundle.watts) &&
        bundle.watts.some((w: number) => w > 0)
      ) {
        scannedPowerStreamsCount++;
        const peaks = computeSlidingWindowPeaks(bundle.watts, durations);
        for (const pk of peaks) {
          const watts = Math.round(pk.bestValue);
          const prev = bestPowerByDur.get(pk.durationSecs);
          if (!prev || watts > prev.watts) {
            bestPowerByDur.set(pk.durationSecs, {
              watts,
              act,
              startSec: pk.startSecondOffset,
            });
          }
        }
      }

      if (
        act.sportCategory === 'Running' &&
        Array.isArray(bundle.velocitySmooth) &&
        bundle.velocitySmooth.some((v: number) => v > 0.8)
      ) {
        scannedPaceStreamsCount++;
        const { gapVelocityMps } = computeGradeAdjustedPaceStream(
          bundle.velocitySmooth,
          bundle.altitude,
          bundle.distance
        );
        const peaks = computeSlidingWindowPeaks(gapVelocityMps, durations);
        for (const pk of peaks) {
          if (pk.bestValue < 1.2 || pk.bestValue > 10.5) continue;
          const gapSecsPerKm = Math.round((1000 / pk.bestValue) * 10) / 10;
          const prev = bestPaceByDur.get(pk.durationSecs);
          if (!prev || gapSecsPerKm < prev.gapSecsPerKm) {
            bestPaceByDur.set(pk.durationSecs, {
              gapSecsPerKm,
              act,
              startSec: pk.startSecondOffset,
            });
          }
        }
      }
    }

    // Also include whole-workout / segment average marks if stream isn't downloaded yet
    const actDur = Math.round(act.movingTimeSecs || 0);
    if (act.sportCategory === 'Cycling' && (act.normalizedPower || act.avgPower) && actDur > 0) {
      const w = Math.round(act.normalizedPower || act.avgPower || 0);
      for (const dur of durations) {
        if (dur <= actDur && dur >= actDur * 0.5) {
          const prev = bestPowerByDur.get(dur);
          if (!prev || w > prev.watts) {
            bestPowerByDur.set(dur, { watts: w, act, startSec: 0 });
          }
        }
      }
    }
    if (act.sportCategory === 'Running' && act.distanceMeters > 200 && actDur > 30) {
      const paceSecsPerKm = Math.round((actDur / (act.distanceMeters / 1000)) * 10) / 10;
      for (const dur of durations) {
        if (dur <= actDur && dur >= actDur * 0.5 && paceSecsPerKm > 110) {
          const prev = bestPaceByDur.get(dur);
          if (!prev || paceSecsPerKm < prev.gapSecsPerKm) {
            bestPaceByDur.set(dur, { gapSecsPerKm: paceSecsPerKm, act, startSec: 0 });
          }
        }
      }
    }
  }

  const powerFitSamples = Array.from(bestPowerByDur.entries()).map(([durationSecs, v]) => ({
    durationSecs,
    watts: v.watts,
  }));
  const fittedPower = fitCriticalPowerModel(powerFitSamples);

  const fallbackCp =
    fittedPower?.cpWatts ??
    (athleteProfile && athleteProfile.ftp > 0 ? athleteProfile.ftp : null);
  const fallbackWPrime =
    fittedPower?.wPrimeJoules ??
    (athleteProfile && athleteProfile.wPrime > 0
      ? athleteProfile.wPrime
      : fallbackCp
        ? 18000
        : null);
  const fallbackPMax =
    fittedPower?.pMaxWatts ??
    (athleteProfile && athleteProfile.pMax > 0
      ? athleteProfile.pMax
      : fallbackCp
        ? Math.round(fallbackCp * 3.4)
        : null);

  const paceFitSamples = Array.from(bestPaceByDur.entries()).map(([durationSecs, v]) => ({
    durationSecs,
    gapSecsPerKm: v.gapSecsPerKm,
  }));
  const fittedSpeed = fitCriticalSpeedModel(paceFitSamples);

  const fallbackCsMps =
    fittedSpeed?.csMps ??
    (athleteProfile && athleteProfile.thresholdPaceSecsPerKm > 0
      ? Math.round((1000 / athleteProfile.thresholdPaceSecsPerKm) * 1000) / 1000
      : null);
  const fallbackDPrime = fittedSpeed?.dPrimeMeters ?? (fallbackCsMps ? 210 : null);

  const points: EmpiricalMmpPoint[] = CANONICAL_MMP_DURATIONS.map(({ secs, label }) => {
    const empP = bestPowerByDur.get(secs);
    const empPace = bestPaceByDur.get(secs);

    const modeledWatts =
      fallbackCp && fallbackWPrime && fallbackPMax
        ? evaluateModeledMmpWatts(secs, fallbackCp, fallbackWPrime, fallbackPMax)
        : null;
    const modeledGapSecsPerKm =
      fallbackCsMps && fallbackDPrime
        ? evaluateModeledGapSecsPerKm(secs, fallbackCsMps, fallbackDPrime)
        : null;

    return {
      durationSecs: secs,
      label,
      bestWatts: empP ? empP.watts : null,
      modeledWatts,
      bestGapSecsPerKm: empPace ? empPace.gapSecsPerKm : null,
      modeledGapSecsPerKm,
      sourceActivityId: empP?.act.id,
      sourceActivityName: empP?.act.name,
      sourceActivityDate: empP?.act.startDateLocal.slice(0, 10),
      startSecondOffset: empP?.startSec,
      paceSourceActivityId: empPace?.act.id,
      paceSourceActivityName: empPace?.act.name,
      paceSourceActivityDate: empPace?.act.startDateLocal.slice(0, 10),
      paceStartSecondOffset: empPace?.startSec,
    };
  });

  return {
    points,
    scannedPowerStreamsCount,
    scannedPaceStreamsCount,
    criticalPowerWatts: fallbackCp,
    wPrimeJoules: fallbackWPrime,
    pMaxWatts: fallbackPMax,
    criticalSpeedMps: fallbackCsMps,
    dPrimeMeters: fallbackDPrime,
    criticalPaceSecsPerKm:
      fittedSpeed?.criticalPaceSecsPerKm ??
      (fallbackCsMps ? Math.round((1000 / fallbackCsMps) * 10) / 10 : null),
  };
}
