import type {
  ActivityInterval,
  ActivityStreamSet,
  TrackLaneNumber,
  TrackRepDistanceMeters,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  UnifiedActivity,
  VdotPodIntensity,
} from '../types';
import {
  snapGpsStreamToStandardTrackOval,
  type OvalGpsSnapResult,
} from '../physiology/trackOvalGpsFusionEngine';

function formatMarkSeconds(seconds: number, decimals: 1 | 2 = 2): string {
  const safe = Math.max(0, seconds);
  if (safe < 60) {
    return `${safe.toFixed(decimals)}s`;
  }
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const remSecs = safe - hrs * 3600 - mins * 60;
  const secStr = remSecs.toFixed(decimals).padStart(decimals === 2 ? 5 : 4, '0');
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${secStr}`;
  }
  return `${mins}:${secStr}`;
}

export interface ExpandedStopwatchRep {
  setNumber: number;
  repInSet: number;
  repDistanceMeters: TrackRepDistanceMeters;
  restDurationSecs: number;
  zoneCode: TrackTrainingZoneCode;
  podIntensity: VdotPodIntensity;
  targetSplitSecs?: number;
}

/**
 * Unrolls a multi-set `TrackWorkoutSpec` into a linear per-rep list with intra-set and inter-set rest.
 */
export function expandTrackWorkoutSpecReps(
  spec?: TrackWorkoutSpec | null
): ExpandedStopwatchRep[] {
  if (!spec) return [];
  const sets =
    spec.sets && spec.sets.length > 0
      ? spec.sets
      : [
          {
            repCount: spec.repCount,
            repDistanceMeters: spec.repDistanceMeters,
            zoneCode: spec.zoneCode,
            podIntensity: spec.podIntensity,
            targetSplitSecs: spec.targetSplitSecs,
            restDurationSecs: spec.restDurationSecs,
          },
        ];

  const out: ExpandedStopwatchRep[] = [];
  sets.forEach((setSpec, setIdx) => {
    const count = Math.max(1, Math.round(setSpec.repCount));
    for (let r = 0; r < count; r++) {
      const isLastInSet = r === count - 1;
      const hasNextSet = setIdx < sets.length - 1;
      const restSecs =
        isLastInSet && hasNextSet && typeof setSpec.setRestAfterSecs === 'number'
          ? setSpec.setRestAfterSecs
          : setSpec.restDurationSecs;
      out.push({
        setNumber: setIdx + 1,
        repInSet: r + 1,
        repDistanceMeters: setSpec.repDistanceMeters,
        restDurationSecs: Math.max(0, Math.round(restSecs)),
        zoneCode: setSpec.zoneCode,
        podIntensity: setSpec.podIntensity,
        ...(typeof setSpec.targetSplitSecs === 'number'
          ? { targetSplitSecs: setSpec.targetSplitSecs }
          : {}),
      });
    }
  });
  return out;
}

export interface WatchStopwatchFusionResult {
  intervals: ActivityInterval[];
  fusedStreams: ActivityStreamSet;
  optimalLagSecs: number;
  correlationScore: number;
  ovalSnapSummary: OvalGpsSnapResult | null;
}

/**
 * Cross-correlates `#stopwatch` `0.01s` rep/rest edge templates onto a wearable `1Hz`
 * `velocitySmooth` / `cadence` / `heartrate` stream, applies Huber oval GPS snapping if
 * coordinates are present, and produces high-precision fused `WORK`/`RECOVERY` intervals.
 */
export function fuseWearableStreamWithStopwatchSplits(params: {
  wearableStreams: ActivityStreamSet;
  lapSplitsSecs: number[];
  repDistanceMeters: TrackRepDistanceMeters | number;
  restDurationSecs: number;
  lane?: TrackLaneNumber;
  wearableActivity?: Partial<UnifiedActivity>;
  thresholdPaceSecsPerKm?: number;
  multiSetSpec?: TrackWorkoutSpec | null;
}): WatchStopwatchFusionResult {
  const {
    wearableStreams,
    lapSplitsSecs,
    repDistanceMeters,
    restDurationSecs,
    lane = 1,
    thresholdPaceSecsPerKm = 245,
    multiSetSpec = null,
  } = params;

  const validSplits = (lapSplitsSecs || []).filter((s) => Number.isFinite(s) && s > 0);
  const expandedReps =
    multiSetSpec?.sets && multiSetSpec.sets.length > 0
      ? expandTrackWorkoutSpecReps(multiSetSpec)
      : [];
  const hasMultipleSets = (multiSetSpec?.sets?.length ?? 0) > 1;
  const time = wearableStreams.time || [];
  const ovalSnapSummary =
    wearableStreams.latlng && wearableStreams.latlng.length >= 12
      ? snapGpsStreamToStandardTrackOval(wearableStreams.latlng, { lane })
      : null;

  const fusedStreams: ActivityStreamSet = {
    ...wearableStreams,
    ...(ovalSnapSummary
      ? {
          latlng: ovalSnapSummary.snappedLatLng,
          snappedTrackDistance: ovalSnapSummary.distanceTrackMeters,
        }
      : {}),
  };

  if (time.length < 10 || validSplits.length === 0) {
    return {
      intervals: [],
      fusedStreams,
      optimalLagSecs: 0,
      correlationScore: 0,
      ovalSnapSummary,
    };
  }

  const rawSig =
    wearableStreams.velocitySmooth && wearableStreams.velocitySmooth.length === time.length
      ? wearableStreams.velocitySmooth
      : wearableStreams.cadence && wearableStreams.cadence.length === time.length
        ? wearableStreams.cadence
        : wearableStreams.heartrate && wearableStreams.heartrate.length === time.length
          ? wearableStreams.heartrate
          : null;

  const tStart = Math.round(time[0] ?? 0);
  const tEnd = Math.round(time[time.length - 1] ?? time.length - 1);
  const gridLen = Math.max(1, tEnd - tStart + 1);

  const signal1Hz = new Array<number>(gridLen).fill(0);
  if (rawSig) {
    let ptr = 0;
    for (let k = 0; k < gridLen; k++) {
      const targetT = tStart + k;
      while (ptr + 1 < time.length && time[ptr + 1] <= targetT) ptr++;
      signal1Hz[k] = Number(rawSig[ptr] ?? 0);
    }
  }

  // Build 1Hz binary work (+1.0) / recovery (-0.5) pattern template from stopwatch timings
  const template: number[] = [];
  const defaultRestInt = Math.max(0, Math.round(restDurationSecs));
  for (let i = 0; i < validSplits.length; i++) {
    const repInt = Math.max(1, Math.round(validSplits[i]));
    for (let s = 0; s < repInt; s++) template.push(1.0);
    const thisRestInt = Math.max(
      0,
      Math.round(expandedReps[i]?.restDurationSecs ?? defaultRestInt)
    );
    if (i < validSplits.length - 1 && thisRestInt > 0) {
      for (let s = 0; s < thisRestInt; s++) template.push(-0.5);
    }
  }

  let bestTau = 0;
  let bestCorr = 0;
  if (rawSig && template.length >= 4 && gridLen >= 10) {
    const winLen = Math.min(gridLen, template.length);
    let sumT = 0;
    for (let k = 0; k < winLen; k++) sumT += template[k];
    const meanT = sumT / winLen;
    let varT = 0;
    for (let k = 0; k < winLen; k++) {
      const d = template[k] - meanT;
      varT += d * d;
    }

    const maxTau = Math.max(0, gridLen - winLen);
    bestCorr = -Infinity;
    for (let tau = 0; tau <= maxTau; tau++) {
      let sumS = 0;
      for (let k = 0; k < winLen; k++) sumS += signal1Hz[tau + k];
      const meanS = sumS / winLen;

      let cov = 0;
      let varS = 0;
      for (let k = 0; k < winLen; k++) {
        const ds = signal1Hz[tau + k] - meanS;
        cov += (template[k] - meanT) * ds;
        varS += ds * ds;
      }
      const denom = Math.sqrt(Math.max(1e-9, varT * varS));
      const corr = cov / denom;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestTau = tau;
      }
    }
    if (!Number.isFinite(bestCorr) || bestCorr === -Infinity) {
      bestCorr = 0;
    }
  }

  const optimalLagSecs = tStart + bestTau;
  const repDist = Math.max(100, repDistanceMeters);
  const safeThreshPace = Math.max(115, Math.min(540, thresholdPaceSecsPerKm));

  const sliceMean = (
    arr: number[] | undefined,
    startSec: number,
    endSec: number,
    minValid = -Infinity
  ): number | undefined => {
    if (!arr || arr.length !== time.length) return undefined;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      if (t >= startSec - 0.5 && t <= endSec + 0.5) {
        const val = arr[i];
        if (typeof val === 'number' && Number.isFinite(val) && val > minValid) {
          sum += val;
          cnt++;
        }
      }
    }
    return cnt > 0 ? sum / cnt : undefined;
  };

  const sliceMax = (arr: number[] | undefined, startSec: number, endSec: number): number | undefined => {
    if (!arr || arr.length !== time.length) return undefined;
    let mx = -Infinity;
    for (let i = 0; i < time.length; i++) {
      const t = time[i];
      if (t >= startSec - 0.5 && t <= endSec + 0.5 && Number.isFinite(arr[i])) {
        mx = Math.max(mx, arr[i]);
      }
    }
    return mx > -Infinity ? mx : undefined;
  };

  const intervals: ActivityInterval[] = [];
  let cursor = optimalLagSecs;

  for (let idx = 0; idx < validSplits.length; idx++) {
    const planRep = expandedReps[idx];
    const thisRepDist = Math.max(100, planRep?.repDistanceMeters ?? repDist);
    const thisRestInt = Math.max(0, Math.round(planRep?.restDurationSecs ?? defaultRestInt));
    const lapSecs = Number(validSplits[idx].toFixed(2));
    const repStart = cursor;
    const repEnd = repStart + lapSecs;
    const paceSecsPerKm = Math.round((lapSecs / thisRepDist) * 1000);
    const speedMps = thisRepDist / Math.max(0.5, lapSecs);

    const avgHrRaw = sliceMean(wearableStreams.heartrate, repStart, repEnd, 40);
    const maxHrRaw = sliceMax(wearableStreams.heartrate, repStart, repEnd);
    const avgCadRaw = sliceMean(wearableStreams.cadence, repStart, repEnd, 20);
    const avgGctRaw = sliceMean(wearableStreams.groundContactTimeMs, repStart, repEnd, 80);

    const avgCadence = avgCadRaw !== undefined ? Math.round(avgCadRaw) : undefined;
    const spm = avgCadence ? (avgCadence < 120 ? avgCadence * 2 : avgCadence) : undefined;
    const strideLengthMeters = spm ? Number(((speedMps * 60) / spm).toFixed(3)) : undefined;
    const intensityRatio = safeThreshPace / Math.max(95, paceSecsPerKm);
    const repLabel =
      hasMultipleSets && planRep
        ? `Set ${planRep.setNumber} · Rep ${planRep.repInSet} (${thisRepDist}m): ${formatMarkSeconds(lapSecs, 2)}`
        : `Rep ${idx + 1} (${thisRepDist}m): ${formatMarkSeconds(lapSecs, 2)}`;

    intervals.push({
      id: `fused-rep-${idx + 1}`,
      type: 'WORK',
      label: repLabel,
      startTimeSecs: Math.round(repStart),
      durationSecs: lapSecs,
      distanceMeters: thisRepDist,
      avgPaceSecsPerKm: paceSecsPerKm,
      gapPaceSecsPerKm: paceSecsPerKm,
      ...(avgHrRaw !== undefined ? { avgHr: Math.round(avgHrRaw) } : {}),
      ...(maxHrRaw !== undefined ? { maxHr: Math.round(maxHrRaw) } : {}),
      ...(avgCadence !== undefined ? { avgCadence } : {}),
      ...(strideLengthMeters !== undefined ? { strideLengthMeters } : {}),
      ...(avgGctRaw !== undefined ? { avgGroundContactTimeMs: Math.round(avgGctRaw) } : {}),
      zone: intensityRatio >= 1.05 ? 5 : 4,
    });

    cursor = repEnd;

    if (thisRestInt > 0 && idx < validSplits.length - 1) {
      const recStart = cursor;
      const recEnd = recStart + thisRestInt;
      const recHr = sliceMean(wearableStreams.heartrate, recStart, recEnd, 40);
      const recCad = sliceMean(wearableStreams.cadence, recStart, recEnd, 20);
      const recVel = sliceMean(wearableStreams.velocitySmooth, recStart, recEnd, 0.2);

      intervals.push({
        id: `fused-rec-${idx + 1}`,
        type: 'RECOVERY',
        label: `Recovery (${thisRestInt}s)`,
        startTimeSecs: Math.round(recStart),
        durationSecs: thisRestInt,
        distanceMeters: recVel ? Math.round(recVel * thisRestInt) : 0,
        ...(recHr !== undefined ? { avgHr: Math.round(recHr) } : {}),
        ...(recCad !== undefined ? { avgCadence: Math.round(recCad) } : {}),
        zone: 1,
      });

      cursor = recEnd;
    }
  }

  return {
    intervals,
    fusedStreams,
    optimalLagSecs,
    correlationScore: Number(bestCorr.toFixed(3)),
    ovalSnapSummary,
  };
}
