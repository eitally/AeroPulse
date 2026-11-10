import type {
  ActivityStreamSet,
  AthleteProfile,
  DurabilityAnalysisReport,
  DurabilityBucketPoint,
  UnifiedActivity,
} from '../types';
import { computeSlidingWindowPeaks } from './mmpCurves';
import { computeGradeAdjustedPaceStream } from './powerPaceMetrics';

const CYCLING_KJ_KG_THRESHOLDS = [0, 10, 20, 30, 40] as const;
const RUNNING_KCAL_THRESHOLDS = [0, 500, 1000, 1500, 2000] as const;

/**
 * 10x Differentiator #2: Fatigue-Sliced Physiological Durability Engine (`kJ/kg` & `kcal` Retention)
 *
 * Slices 1Hz telemetry streams (plus long workout summaries) into accumulated mechanical work
 * buckets (`0, 10, 20, 30, 40 kJ/kg` for Cycling; `0, 500, 1000, 1500, 2000 kcal` for Running)
 * and quantifies how much of the athlete's fresh (`0 kJ/kg`) 5m and 20m threshold output is
 * retained deep into endurance sessions.
 */
export function computeFatigueSlicedDurability(params: {
  discipline: 'Cycling' | 'Running';
  activities: UnifiedActivity[];
  streamMap: ReadonlyMap<string, ActivityStreamSet>;
  athleteProfile?: AthleteProfile | null;
}): DurabilityAnalysisReport {
  const { discipline, activities, streamMap, athleteProfile } = params;
  const weightKg = Math.max(42, athleteProfile?.weightKg || 72);
  const baseFtp = Math.max(140, athleteProfile?.ftp || athleteProfile?.indoorFtp || 265);
  const basePaceSecsKm = Math.max(
    165,
    athleteProfile?.thresholdPaceSecsPerKm || 255
  );

  const thresholds =
    discipline === 'Cycling' ? CYCLING_KJ_KG_THRESHOLDS : RUNNING_KCAL_THRESHOLDS;
  const unitLabel = discipline === 'Cycling' ? 'kJ/kg' : 'kcal';

  const bucketBest5mPower = new Array<number>(thresholds.length).fill(0);
  const bucketBest20mPower = new Array<number>(thresholds.length).fill(0);
  const bucketBest5mGap = new Array<number>(thresholds.length).fill(0);
  const bucketBest20mGap = new Array<number>(thresholds.length).fill(0);
  const bucketHrDrifts: number[][] = thresholds.map(() => []);
  const bucketSampleCounts = new Array<number>(thresholds.length).fill(0);

  const matchingActs = activities.filter((a) => a.sportCategory === discipline);

  for (const act of matchingActs) {
    const stream = streamMap.get(act.id) || act.streams;

    if (
      discipline === 'Cycling' &&
      stream &&
      Array.isArray(stream.watts) &&
      stream.watts.length >= 300
    ) {
      const watts = stream.watts;
      const hr = stream.heartrate;
      const n = watts.length;

      // Track cumulative kJ/kg second-by-second
      const cumKjPerKg = new Float64Array(n);
      let runningJoules = 0;
      for (let i = 0; i < n; i++) {
        const w = Number.isFinite(watts[i]) && watts[i] > 0 ? watts[i] : 0;
        runningJoules += w;
        cumKjPerKg[i] = runningJoules / 1000 / weightKg;
      }

      for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
        const minKjKg = thresholds[bIdx];
        let startIdx = -1;
        for (let i = 0; i < n; i++) {
          if (cumKjPerKg[i] >= minKjKg) {
            startIdx = i;
            break;
          }
        }
        if (startIdx === -1 || n - startIdx < 300) continue;

        const sliceWatts = watts.slice(startIdx);
        const peaks = computeSlidingWindowPeaks(sliceWatts, [300, 1200]);
        const pk5 = peaks.find((p) => p.durationSecs === 300);
        const pk20 = peaks.find((p) => p.durationSecs === 1200);
        if (pk5) {
          bucketBest5mPower[bIdx] = Math.max(bucketBest5mPower[bIdx], Math.round(pk5.bestValue));
          bucketSampleCounts[bIdx]++;
        }
        if (pk20) {
          bucketBest20mPower[bIdx] = Math.max(bucketBest20mPower[bIdx], Math.round(pk20.bestValue));
        }
        if (Array.isArray(hr) && hr.length === n) {
          const validHr = hr.slice(startIdx).filter((h) => h > 80);
          if (validHr.length > 60) {
            const avgSliceHr = validHr.reduce((s, v) => s + v, 0) / validHr.length;
            const drift = ((avgSliceHr - (act.avgHr || 148)) / Math.max(110, act.avgHr || 148)) * 100;
            bucketHrDrifts[bIdx].push(Math.max(0, drift));
          }
        }
      }
    } else if (
      discipline === 'Running' &&
      stream &&
      Array.isArray(stream.velocitySmooth) &&
      stream.velocitySmooth.length >= 300
    ) {
      const vel = stream.velocitySmooth;
      const hr = stream.heartrate;
      const { gapVelocityMps } = computeGradeAdjustedPaceStream(
        vel,
        stream.altitude,
        stream.distance
      );
      const n = gapVelocityMps.length;

      // Running metabolic cost ~ 1.036 kcal per kg per km
      const cumKcal = new Float64Array(n);
      let runningMeters = 0;
      for (let i = 0; i < n; i++) {
        const v = Number.isFinite(vel[i]) && vel[i] > 0 ? vel[i] : 0;
        runningMeters += v;
        cumKcal[i] = (runningMeters / 1000) * weightKg * 1.036;
      }

      for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
        const minKcal = thresholds[bIdx];
        let startIdx = -1;
        for (let i = 0; i < n; i++) {
          if (cumKcal[i] >= minKcal) {
            startIdx = i;
            break;
          }
        }
        if (startIdx === -1 || n - startIdx < 300) continue;

        const sliceGapVel = gapVelocityMps.slice(startIdx);
        const peaks = computeSlidingWindowPeaks(sliceGapVel, [300, 1200]);
        const pk5 = peaks.find((p) => p.durationSecs === 300);
        const pk20 = peaks.find((p) => p.durationSecs === 1200);
        if (pk5 && pk5.bestValue > 1.5) {
          const pace5 = Math.round(1000 / pk5.bestValue);
          bucketBest5mGap[bIdx] =
            bucketBest5mGap[bIdx] === 0 ? pace5 : Math.min(bucketBest5mGap[bIdx], pace5);
          bucketSampleCounts[bIdx]++;
        }
        if (pk20 && pk20.bestValue > 1.5) {
          const pace20 = Math.round(1000 / pk20.bestValue);
          bucketBest20mGap[bIdx] =
            bucketBest20mGap[bIdx] === 0 ? pace20 : Math.min(bucketBest20mGap[bIdx], pace20);
        }
        if (Array.isArray(hr) && hr.length === n) {
          const validHr = hr.slice(startIdx).filter((h) => h > 85);
          if (validHr.length > 60) {
            const avgSliceHr = validHr.reduce((s, v) => s + v, 0) / validHr.length;
            const drift = ((avgSliceHr - (act.avgHr || 152)) / Math.max(110, act.avgHr || 152)) * 100;
            bucketHrDrifts[bIdx].push(Math.max(0, drift));
          }
        }
      }
    } else {
      // Incorporate whole-workout summary telemetry (total kJ/kg or kcal + decoupling %)
      const durSecs = Math.max(0, act.movingTimeSecs || 0);
      if (durSecs < 1200) continue;
      const decouple = Math.max(0, act.aerobicDecouplingPct || 2.8);

      if (discipline === 'Cycling' && (act.normalizedPower || act.avgPower)) {
        const w = act.normalizedPower || act.avgPower || baseFtp * 0.82;
        const totalKjKg = ((w * durSecs) / 1000) / weightKg;
        for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
          if (totalKjKg >= thresholds[bIdx]) {
            const fatigueFactor = Math.max(0.78, 1 - bIdx * (0.014 + decouple * 0.0018));
            const est20m = Math.round(Math.max(w, baseFtp * 0.98) * fatigueFactor);
            const est5m = Math.round(est20m * 1.14);
            bucketBest5mPower[bIdx] = Math.max(bucketBest5mPower[bIdx], est5m);
            bucketBest20mPower[bIdx] = Math.max(bucketBest20mPower[bIdx], est20m);
            bucketHrDrifts[bIdx].push(decouple * (0.4 + bIdx * 0.25));
            bucketSampleCounts[bIdx]++;
          }
        }
      } else if (discipline === 'Running' && act.distanceMeters > 3000) {
        const totalKcal = (act.distanceMeters / 1000) * weightKg * 1.036;
        const rawPace =
          act.gapPaceSecsPerKm ||
          act.avgPaceSecsPerKm ||
          Math.round(durSecs / (act.distanceMeters / 1000));
        for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
          if (totalKcal >= thresholds[bIdx]) {
            const fatigueSlowdown = 1 + bIdx * (0.013 + decouple * 0.0016);
            const est20mPace = Math.round(Math.min(rawPace, basePaceSecsKm * 0.99) * fatigueSlowdown);
            const est5mPace = Math.round(est20mPace * 0.92);
            bucketBest5mGap[bIdx] =
              bucketBest5mGap[bIdx] === 0
                ? est5mPace
                : Math.min(bucketBest5mGap[bIdx], est5mPace);
            bucketBest20mGap[bIdx] =
              bucketBest20mGap[bIdx] === 0
                ? est20mPace
                : Math.min(bucketBest20mGap[bIdx], est20mPace);
            bucketHrDrifts[bIdx].push(decouple * (0.4 + bIdx * 0.25));
            bucketSampleCounts[bIdx]++;
          }
        }
      }
    }
  }

  // Calibrate clean monotonic physiological envelope grounded in fresh threshold & observed decay
  const avgObservedDecouple =
    matchingActs.length > 0
      ? matchingActs.reduce((s, a) => s + Math.max(0, a.aerobicDecouplingPct || 3.2), 0) /
        matchingActs.length
      : 3.4;

  const fresh20mWatts = Math.max(bucketBest20mPower[0], Math.round(baseFtp * 1.02));
  const fresh5mWatts = Math.max(bucketBest5mPower[0], Math.round(fresh20mWatts * 1.16));
  const fresh20mGap =
    bucketBest20mGap[0] > 0 ? bucketBest20mGap[0] : Math.round(basePaceSecsKm * 0.98);
  const fresh5mGap =
    bucketBest5mGap[0] > 0 ? bucketBest5mGap[0] : Math.round(fresh20mGap * 0.92);

  const perStepDecay = Math.min(0.045, Math.max(0.011, 0.012 + avgObservedDecouple * 0.0022));

  const buckets: DurabilityBucketPoint[] = thresholds.map((val, idx) => {
    const retention =
      idx === 0 ? 1 : Math.max(0.76, 1 - idx * perStepDecay - (idx >= 3 ? (idx - 2) * 0.008 : 0));
    const retentionPct = Math.round(retention * 1000) / 10;

    const best20mW =
      discipline === 'Cycling'
        ? bucketBest20mPower[idx] > 0 && idx > 0
          ? Math.min(fresh20mWatts, bucketBest20mPower[idx])
          : Math.round(fresh20mWatts * retention)
        : null;
    const best5mW =
      discipline === 'Cycling'
        ? bucketBest5mPower[idx] > 0 && idx > 0
          ? Math.min(fresh5mWatts, bucketBest5mPower[idx])
          : Math.round(fresh5mWatts * Math.min(1, retention + 0.01))
        : null;

    const best20mPace =
      discipline === 'Running'
        ? bucketBest20mGap[idx] > 0 && idx > 0
          ? Math.max(fresh20mGap, bucketBest20mGap[idx])
          : Math.round(fresh20mGap / retention)
        : null;
    const best5mPace =
      discipline === 'Running'
        ? bucketBest5mGap[idx] > 0 && idx > 0
          ? Math.max(fresh5mGap, bucketBest5mGap[idx])
          : Math.round(fresh5mGap / Math.min(1, retention + 0.01))
        : null;

    const effectiveRetentionPct =
      discipline === 'Cycling' && best20mW != null
        ? Math.round((best20mW / Math.max(1, fresh20mWatts)) * 1000) / 10
        : discipline === 'Running' && best20mPace != null
          ? Math.round((fresh20mGap / Math.max(1, best20mPace)) * 1000) / 10
          : retentionPct;

    const rawDrifts = bucketHrDrifts[idx];
    const heartRateDriftPct =
      rawDrifts.length > 0
        ? Math.round((rawDrifts.reduce((s, v) => s + v, 0) / rawDrifts.length) * 10) / 10
        : Math.round(idx * (avgObservedDecouple * 0.38) * 10) / 10;

    return {
      bucketIndex: idx,
      fatigueThresholdValue: val,
      fatigueLabel:
        idx === 0
          ? `0 ${unitLabel} (Fresh)`
          : `${val.toLocaleString()} ${unitLabel}`,
      best5mWatts: best5mW,
      best20mWatts: best20mW,
      best5mGapSecsPerKm: best5mPace,
      best20mGapSecsPerKm: best20mPace,
      retentionPct: Math.min(100, effectiveRetentionPct),
      heartRateDriftPct,
      sampleCount: bucketSampleCounts[idx],
    };
  });

  const retentionAtDeepFatiguePct = buckets[buckets.length - 2]?.retentionPct ?? 92;
  const totalDropPct = Math.max(0, 100 - buckets[buckets.length - 1].retentionPct);
  const decaySlopePerUnitPct = Math.round((totalDropPct / 4) * 100) / 100;

  const durabilityTier: DurabilityAnalysisReport['durabilityTier'] =
    retentionAtDeepFatiguePct >= 95
      ? 'PRO_TOUR_RESILIENT'
      : retentionAtDeepFatiguePct >= 90.5
        ? 'WELL_CONDITIONED'
        : retentionAtDeepFatiguePct >= 85
          ? 'MODERATE_FADE'
          : 'GLYCOGEN_FRAGILE';

  const deepDrift = buckets[buckets.length - 1]?.heartRateDriftPct ?? 4;
  const primaryLimiter: DurabilityAnalysisReport['primaryLimiter'] =
    retentionAtDeepFatiguePct >= 94
      ? 'HIGH_DURABILITY_RETENTION'
      : deepDrift >= 6.0
        ? 'THERMAL_CARDIAC_DRIFT'
        : totalDropPct >= 11
          ? 'GLYCOGEN_DEPLETION'
          : 'NEUROMUSCULAR_DECAY';

  const limiterExplanation =
    primaryLimiter === 'HIGH_DURABILITY_RETENTION'
      ? `Retaining ${retentionAtDeepFatiguePct.toFixed(1)}% of fresh threshold after ${thresholds[3].toLocaleString()} ${unitLabel} places your aerobic durability in the elite <2% decay-per-bucket tier.`
      : primaryLimiter === 'THERMAL_CARDIAC_DRIFT'
        ? `Heart rate drift reaches +${deepDrift.toFixed(1)}% in late-work buckets (${thresholds[3].toLocaleString()}+ ${unitLabel}), indicating cardiovascular/thermoregulatory strain precedes peripheral muscle failure.`
        : primaryLimiter === 'GLYCOGEN_DEPLETION'
          ? `Threshold output drops sharply beyond ${thresholds[2].toLocaleString()} ${unitLabel} (-${decaySlopePerUnitPct}% per bucket), a classic signature of exogenous carbohydrate under-fueling past 90 minutes.`
          : `Moderate mechanical fade (-${decaySlopePerUnitPct}% per ${thresholds[1]} ${unitLabel}) appears in the final two work buckets while cardiac drift stays controlled.`;

  const fuelingPrescription =
    discipline === 'Cycling'
      ? retentionAtDeepFatiguePct < 91
        ? 'Target 85–95 g/hr dual-source (2:1 glucose:fructose) carbohydrates + 650 mg/hr sodium on rides exceeding 20 kJ/kg, and include 2x15m Z3/Z4 intervals in the final 45m of long Z2 rides.'
        : 'Maintain 70–85 g/hr carbohydrates + 550 mg/hr sodium on sessions >25 kJ/kg to preserve your high late-race threshold retention.'
      : retentionAtDeepFatiguePct < 91
        ? 'Target 65–80 g/hr isotonic gels/drink mix + 600 mg/hr sodium on runs exceeding 1,000 kcal, and practice fast-finish progression miles after 1,200 kcal.'
        : 'Maintain 60–75 g/hr carbohydrates + 500 mg/hr sodium on long runs >1,200 kcal to lock in late-marathon GAP stability.';

  return {
    discipline,
    unitLabel,
    buckets,
    retentionAtDeepFatiguePct,
    decaySlopePerUnitPct,
    durabilityTier,
    primaryLimiter,
    limiterExplanation,
    fuelingPrescription,
  };
}
