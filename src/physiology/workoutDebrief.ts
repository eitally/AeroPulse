import type {
  ActivityStreamSet,
  AthleteProfile,
  PostWorkoutDebriefInsight,
  PostWorkoutDebriefReport,
  UnifiedActivity,
} from '../types.ts';
import {
  computeGradeAdjustedPaceStream,
  computeNormalizedPower,
} from './powerPaceMetrics.ts';
import { resolveThresholdsAtDate } from './pmc.ts';

function formatClockOffset(sec: number): string {
  const clean = Math.max(0, Math.round(sec));
  const h = Math.floor(clean / 3600);
  const m = Math.floor((clean % 3600) / 60);
  const s = clean % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPaceMmSs(secsPerKm: number): string {
  const mins = Math.floor(secsPerKm / 60);
  const secs = Math.round(secsPerKm % 60);
  return secs === 60
    ? `${mins + 1}:00/km`
    : `${mins}:${String(secs).padStart(2, '0')}/km`;
}

/**
 * 10x Differentiator #5: Deterministic 30-Second Post-Workout Coach Debrief
 *
 * Performs a 1Hz signal-processing pass over power/pace/HR/cadence streams:
 *  1. Skiba differential W' (or D') anaerobic reserve depletion nadir
 *  2. Rolling 5-minute Aerobic Decoupling (Pw:Hr / Pa:Hr) drift onset timestamp
 *  3. Inter-rep HRR60 autonomic recovery rate or late-session mechanical fade
 *
 * Every insight includes `[windowStartSec, windowEndSec]` so clicking it zooms
 * `UPlotStreamChart` straight to the exact 90-second telemetry window!
 */
export function generatePostWorkoutDebrief(
  activity: UnifiedActivity,
  streams: ActivityStreamSet | null | undefined,
  profile: AthleteProfile
): PostWorkoutDebriefReport | null {
  if (!streams || !Array.isArray(streams.time) || streams.time.length < 120) {
    return null;
  }

  const n = streams.time.length;
  const totalDurationSec = streams.time[n - 1] || n;
  const thresholds = resolveThresholdsAtDate(
    profile,
    (activity.startDateLocal || '').slice(0, 10)
  );

  const watts = streams.watts;
  const hr = streams.heartrate;
  const vel = streams.velocitySmooth;
  const hasWatts = Array.isArray(watts) && watts.length === n && watts.some((w) => w > 20);
  const hasVel = Array.isArray(vel) && vel.length === n && vel.some((v) => v > 0.8);
  const hasHr = Array.isArray(hr) && hr.length === n && hr.some((h) => h > 60);

  if (!hasWatts && !hasVel) return null;

  const npWatts = hasWatts ? computeNormalizedPower(watts) : null;
  const gapResult = hasVel
    ? computeGradeAdjustedPaceStream(vel, streams.altitude, streams.distance)
    : { gapVelocityMps: [], avgGapSecsPerKm: null };

  const insights: PostWorkoutDebriefInsight[] = [];

  // --------------------------------------------------------------------------
  // Pass 1: Skiba Differential W' / D' Anaerobic Match Burn Detector
  // --------------------------------------------------------------------------
  let wPrimeMinPct: number | null = null;
  if (hasWatts) {
    const cp =
      activity.environment === 'INDOOR' ? thresholds.indoorFtp : thresholds.ftp;
    const wCap = profile.wPrime > 4000 ? profile.wPrime : 18_000;
    let wBal = wCap;
    let minWBal = wCap;
    let nadirIdx = 0;

    for (let i = 1; i < n; i++) {
      const dt = Math.max(1, (streams.time[i] ?? i) - (streams.time[i - 1] ?? i - 1));
      const p = watts![i] || 0;
      if (p > cp) {
        wBal = Math.max(0, wBal - (p - cp) * dt);
      } else {
        const dcp = Math.max(5, cp - p);
        const tau = 546 * Math.exp(-0.01 * dcp) + 316;
        wBal = Math.min(wCap, wBal + (wCap - wBal) * (1 - Math.exp(-dt / tau)));
      }
      if (wBal < minWBal) {
        minWBal = wBal;
        nadirIdx = i;
      }
    }

    wPrimeMinPct = Math.round((minWBal / wCap) * 100);
    const nadirTimeSec = streams.time[nadirIdx] ?? nadirIdx;
    const winStart = Math.max(0, nadirTimeSec - 60);
    const winEnd = Math.min(totalDurationSec, nadirTimeSec + 45);
    const burnedKj = ((wCap - minWBal) / 1000).toFixed(1);

    insights.push({
      id: 'w-prime-nadir',
      badge: `W' Min ${wPrimeMinPct}%`,
      severity: wPrimeMinPct < 25 ? 'STRAINED' : wPrimeMinPct < 55 ? 'CAUTION' : 'PRIME',
      title:
        wPrimeMinPct < 25
          ? `Deep Anaerobic Match Burn (-${burnedKj} kJ above ${cp}W)`
          : wPrimeMinPct < 60
            ? `Controlled Supra-Threshold Surge (-${burnedKj} kJ W')`
            : `Sub-Threshold Aerobic Discipline (${wPrimeMinPct}% W' Reserve Kept)`,
      detail:
        wPrimeMinPct < 60
          ? `Anaerobic reserve dipped to ${wPrimeMinPct}% at ${formatClockOffset(nadirTimeSec)} before reconstituting.`
          : `Zero costly supra-threshold spikes above ${cp}W; anaerobic reserve stayed above ${wPrimeMinPct}% throughout.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}–${formatClockOffset(winEnd)}`,
    });
  } else if (hasVel && gapResult.gapVelocityMps.length === n) {
    const csMps = 1000 / Math.max(150, thresholds.thresholdPaceSecsPerKm);
    const dCap = 220; // meters D'
    let dBal = dCap;
    let minDBal = dCap;
    let nadirIdx = 0;

    for (let i = 1; i < n; i++) {
      const dt = Math.max(1, (streams.time[i] ?? i) - (streams.time[i - 1] ?? i - 1));
      const v = gapResult.gapVelocityMps[i] || 0;
      if (v > csMps) {
        dBal = Math.max(0, dBal - (v - csMps) * dt);
      } else {
        dBal = Math.min(dCap, dBal + (dCap - dBal) * (1 - Math.exp(-dt / 180)));
      }
      if (dBal < minDBal) {
        minDBal = dBal;
        nadirIdx = i;
      }
    }

    wPrimeMinPct = Math.round((minDBal / dCap) * 100);
    const nadirTimeSec = streams.time[nadirIdx] ?? nadirIdx;
    const winStart = Math.max(0, nadirTimeSec - 60);
    const winEnd = Math.min(totalDurationSec, nadirTimeSec + 45);

    insights.push({
      id: 'd-prime-nadir',
      badge: `D' Min ${wPrimeMinPct}%`,
      severity: wPrimeMinPct < 25 ? 'STRAINED' : wPrimeMinPct < 60 ? 'CAUTION' : 'PRIME',
      title:
        wPrimeMinPct < 55
          ? `Peak Supra-Threshold Pace Surge (${wPrimeMinPct}% D' Floor)`
          : `Controlled Threshold Pacing (${wPrimeMinPct}% D' Intact)`,
      detail: `Session average GAP ${gapResult.avgGapSecsPerKm ? formatPaceMmSs(gapResult.avgGapSecsPerKm) : '—'}; deepest speed-reserve draw hit at ${formatClockOffset(nadirTimeSec)}.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}–${formatClockOffset(winEnd)}`,
    });
  }

  // --------------------------------------------------------------------------
  // Pass 2: Cardiac Drift / Aerobic Decoupling Onset Detector (Pw:Hr / Pa:Hr)
  // --------------------------------------------------------------------------
  let aerobicDecouplingPct: number | null = null;
  if (hasHr && n >= 600) {
    // Exclude first 5m warmup from decoupling baseline
    const startIdx = Math.min(300, Math.floor(n * 0.12));
    const midIdx = startIdx + Math.floor((n - startIdx) / 2);

    const calcEf = (from: number, to: number): number | null => {
      let outSum = 0;
      let hrSum = 0;
      let valid = 0;
      for (let i = from; i < to; i++) {
        const h = hr![i] || 0;
        const output = hasWatts ? watts![i] || 0 : (gapResult.gapVelocityMps[i] || 0) * 60;
        if (h > 85 && output > 25) {
          outSum += output;
          hrSum += h;
          valid++;
        }
      }
      if (valid < 60 || hrSum <= 0) return null;
      return outSum / hrSum;
    };

    const ef1 = calcEf(startIdx, midIdx);
    const ef2 = calcEf(midIdx, n);
    if (ef1 && ef2 && ef1 > 0) {
      aerobicDecouplingPct = Math.round(((ef1 - ef2) / ef1) * 1000) / 10;

      // Pinpoint exact 5-minute window where rolling EF first drops >5% below baseline
      let driftIdx = midIdx;
      const winLen = 300;
      for (let i = startIdx + winLen; i <= n - winLen; i += 30) {
        const winEf = calcEf(i, i + winLen);
        if (winEf && (ef1 - winEf) / ef1 >= 0.05) {
          driftIdx = i;
          break;
        }
      }

      const driftTimeSec = streams.time[driftIdx] ?? driftIdx;
      const winStart = Math.max(0, driftTimeSec - 30);
      const winEnd = Math.min(totalDurationSec, driftTimeSec + 120);

      insights.push({
        id: 'cardiac-decoupling',
        badge: `Drift ${aerobicDecouplingPct > 0 ? '+' : ''}${aerobicDecouplingPct.toFixed(1)}%`,
        severity:
          aerobicDecouplingPct <= 5.0
            ? 'PRIME'
            : aerobicDecouplingPct <= 8.5
              ? 'CAUTION'
              : 'STRAINED',
        title:
          aerobicDecouplingPct <= 5.0
            ? `Strong Aerobic Durability (${aerobicDecouplingPct.toFixed(1)}% Pw:Hr Drift)`
            : `Cardiac Decoupling Onset at ${formatClockOffset(driftTimeSec)} (+${aerobicDecouplingPct.toFixed(1)}%)`,
        detail:
          aerobicDecouplingPct <= 5.0
            ? `Output-to-HR efficiency stayed locked (<5% ceiling) across the second half.`
            : `Efficiency factor dropped >5% starting around ${formatClockOffset(driftTimeSec)}—review hydration, cooling, or carbohydrate intake.`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}–${formatClockOffset(winEnd)}`,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Pass 3: Inter-Rep HRR60 Autonomic Recovery OR Final-Quarter Output Retention
  // --------------------------------------------------------------------------
  let bestHrr60Bpm: number | null = null;
  if (hasHr && n >= 240) {
    const lthr = activity.sportCategory === 'Running' ? thresholds.runLthr : thresholds.lthr;
    let maxDrop = 0;
    let bestDropIdx = -1;

    for (let i = 60; i < n - 65; i++) {
      const peakHr = hr![i] || 0;
      if (peakHr >= lthr * 0.92) {
        const after60 = hr![i + 60] || peakHr;
        const drop = peakHr - after60;
        if (drop > maxDrop && drop <= 75) {
          maxDrop = drop;
          bestDropIdx = i;
        }
      }
    }

    if (maxDrop >= 14 && bestDropIdx >= 0) {
      bestHrr60Bpm = Math.round(maxDrop);
      const dropTimeSec = streams.time[bestDropIdx] ?? bestDropIdx;
      const winStart = Math.max(0, dropTimeSec - 15);
      const winEnd = Math.min(totalDurationSec, dropTimeSec + 75);

      insights.push({
        id: 'hrr60-recovery',
        badge: `HRR60 -${bestHrr60Bpm} bpm`,
        severity: bestHrr60Bpm >= 28 ? 'PRIME' : bestHrr60Bpm >= 18 ? 'INFO' : 'CAUTION',
        title: `Fast Parasympathetic Rebound (-${bestHrr60Bpm} bpm in 60s)`,
        detail: `Following peak effort at ${formatClockOffset(dropTimeSec)} (${Math.round(hr![bestDropIdx])} bpm), heart rate recovered ${bestHrr60Bpm} bpm in 60 seconds.`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}–${formatClockOffset(winEnd)}`,
      });
    }
  }

  // Fallback 3rd insight: Final-quarter mechanical/output retention
  if (insights.length < 3) {
    const qLen = Math.max(30, Math.floor(n / 4));
    const avgSlice = (from: number, to: number) => {
      let s = 0;
      let c = 0;
      for (let i = from; i < to; i++) {
        const v = hasWatts ? watts![i] || 0 : (gapResult.gapVelocityMps[i] || 0) * 60;
        if (v > 10) {
          s += v;
          c++;
        }
      }
      return c > 0 ? s / c : 0;
    };
    const q1 = avgSlice(0, qLen);
    const q4 = avgSlice(n - qLen, n);
    const deltaPct = q1 > 0 ? Math.round(((q4 - q1) / q1) * 1000) / 10 : 0;
    const winStart = Math.max(0, totalDurationSec - Math.min(180, qLen));
    const winEnd = totalDurationSec;

    insights.push({
      id: 'closing-split',
      badge: `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% Finish`,
      severity: deltaPct >= -3 ? 'PRIME' : deltaPct >= -8 ? 'CAUTION' : 'STRAINED',
      title:
        deltaPct >= 1
          ? `Negative-Split Closing Quarter (+${deltaPct.toFixed(1)}%)`
          : deltaPct >= -4
            ? `Even-Paced Final Quarter (${deltaPct.toFixed(1)}%)`
            : `Late-Session Output Fade (${deltaPct.toFixed(1)}%)`,
      detail: `Final quarter output compared against opening quarter across the closing ${Math.round((winEnd - winStart) / 60)}m window.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}–${formatClockOffset(winEnd)}`,
    });
  }

  // Compute deterministic execution score (0-100) from decoupling + finish discipline
  let executionScore = 88;
  if (aerobicDecouplingPct !== null) {
    if (aerobicDecouplingPct <= 3.5) executionScore += 6;
    else if (aerobicDecouplingPct > 7.5) executionScore -= 10;
  }
  if (bestHrr60Bpm !== null && bestHrr60Bpm >= 25) executionScore += 4;
  executionScore = Math.max(55, Math.min(99, executionScore));

  const headline = hasWatts
    ? `NP ${npWatts ?? '—'}W · ${aerobicDecouplingPct !== null ? `${aerobicDecouplingPct.toFixed(1)}% Pw:Hr Drift` : `${Math.round(totalDurationSec / 60)}m 1Hz Signal Pass`}`
    : `GAP ${gapResult.avgGapSecsPerKm ? formatPaceMmSs(gapResult.avgGapSecsPerKm) : '—'} · ${aerobicDecouplingPct !== null ? `${aerobicDecouplingPct.toFixed(1)}% Pa:Hr Drift` : `${Math.round(totalDurationSec / 60)}m 1Hz Signal Pass`}`;

  return {
    activityId: activity.id,
    headline,
    executionScore,
    normalizedPowerWatts: npWatts,
    gradeAdjustedPaceSecsPerKm: gapResult.avgGapSecsPerKm,
    aerobicDecouplingPct,
    wPrimeMinPct,
    bestHrr60Bpm,
    insights: insights.slice(0, 3),
  };
}
