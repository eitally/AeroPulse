/// <reference lib="webworker" />

import type {
  ActivityInterval,
  ActivityStreamSet,
  SportCategory,
  UnifiedActivity,
} from '../types';

export interface WorkerAthleteThresholds {
  ftp: number;
  indoorFtp?: number;
  lthr: number;
  maxHr: number;
  restingHr: number;
  weightKg: number;
  thresholdPaceSecsPerKm?: number;
}

export interface PeakWindowStat {
  durationSecs: number;
  label: string;
  peakWatts?: number;
  peakWattsPerKg?: number;
  peakPaceSecsPerKm?: number;
  peakHr?: number;
  startIndex: number;
  endIndex: number;
  startTimeSecs: number;
  endTimeSecs: number;
}

export interface ComputedStreamAnalytics {
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  intensityFactor?: number;
  variabilityIndex?: number;
  tss: number;
  trimpBanister: number;
  trimpEdwards: number;
  avgHr: number;
  maxHr: number;
  avgCadence?: number;
  avgPaceSecsPerKm?: number;
  gapPaceSecsPerKm?: number;
  efficiencyFactor: number;
  firstHalfEf: number;
  secondHalfEf: number;
  aerobicDecouplingPct: number;
  elevationGainMeters: number;
  distanceMeters: number;
  movingTimeSecs: number;
  zoneSecs: {
    hr: number[]; // 7 zones [Z1..Z7]
    power?: number[]; // 7 zones [Z1..Z7]
    pace?: number[]; // 7 zones [Z1..Z7]
  };
  intervals: ActivityInterval[];
  peakWindows: PeakWindowStat[];
}

export type ActivityWorkerRequest =
  | {
      id: string;
      type: 'COMPUTE_STREAM_ANALYTICS';
      payload: {
        streams: ActivityStreamSet;
        sportCategory: SportCategory;
        thresholds: WorkerAthleteThresholds;
        existingIntervals?: ActivityInterval[];
      };
    }
  | {
      id: string;
      type: 'PARSE_WORKOUT_FILE';
      payload: {
        fileName: string;
        fileText?: string;
        fileBuffer?: ArrayBuffer;
        sportCategory?: SportCategory;
        thresholds: WorkerAthleteThresholds;
      };
    }
  | {
      id: string;
      type: 'UPSAMPLE_TO_1HZ_STREAM';
      payload: {
        activity: UnifiedActivity;
        thresholds: WorkerAthleteThresholds;
      };
    };

export type ActivityWorkerResponse =
  | {
      id: string;
      ok: true;
      type: 'COMPUTE_STREAM_ANALYTICS';
      result: ComputedStreamAnalytics;
    }
  | {
      id: string;
      ok: true;
      type: 'PARSE_WORKOUT_FILE';
      result: {
        activity: UnifiedActivity;
        analytics: ComputedStreamAnalytics;
      };
    }
  | {
      id: string;
      ok: true;
      type: 'UPSAMPLE_TO_1HZ_STREAM';
      result: {
        streams: ActivityStreamSet;
        analytics: ComputedStreamAnalytics;
      };
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

/**
 * Calculates 30-second rolling average 4th-power Normalized Power (Coggan NP).
 */
export function computeNormalizedPower(time: number[], watts: number[]): number {
  if (!watts || watts.length === 0) return 0;
  if (watts.length < 10) {
    const sum = watts.reduce((a, b) => a + (b || 0), 0);
    return Math.round(sum / watts.length);
  }

  const rolling30s: number[] = [];
  let windowSum = 0;
  let left = 0;

  for (let right = 0; right < watts.length; right++) {
    const w = Math.max(0, Number(watts[right]) || 0);
    windowSum += w;

    const currentTime = time[right] ?? right;
    while (left < right && currentTime - (time[left] ?? left) > 30) {
      windowSum -= Math.max(0, Number(watts[left]) || 0);
      left++;
    }

    const count = right - left + 1;
    const elapsedWindow = currentTime - (time[left] ?? left);
    if (elapsedWindow >= 15 || right >= Math.min(15, watts.length - 1)) {
      rolling30s.push(windowSum / Math.max(1, count));
    }
  }

  if (rolling30s.length === 0) {
    const sum = watts.reduce((a, b) => a + (b || 0), 0);
    return Math.round(sum / watts.length);
  }

  let sumFourthPower = 0;
  for (let i = 0; i < rolling30s.length; i++) {
    const r = rolling30s[i];
    sumFourthPower += r * r * r * r;
  }

  return Math.round(Math.pow(sumFourthPower / rolling30s.length, 0.25));
}

/**
 * Calculates Banister exponential TRIMP and Edwards HR-zone TRIMP from a 1Hz HR stream.
 */
export function computeTrimpScores(
  time: number[],
  heartrate: number[],
  restingHr: number,
  maxHr: number,
  lthr: number
): { trimpBanister: number; trimpEdwards: number; hrZones7: number[] } {
  const hrZones7 = [0, 0, 0, 0, 0, 0, 0];
  if (!heartrate || heartrate.length === 0) {
    return { trimpBanister: 0, trimpEdwards: 0, hrZones7 };
  }

  const safeRest = Math.max(35, Math.min(80, restingHr || 48));
  const safeLthr = Math.max(125, lthr || 165);
  const safeMax = Math.max(safeLthr + 8, maxHr || 186);
  const hrReserve = Math.max(40, safeMax - safeRest);

  // 7-zone Friel/Intervals.icu ceilings
  const zCeilings = [
    Math.round(safeLthr * 0.81),
    Math.round(safeLthr * 0.89),
    Math.round(safeLthr * 0.93),
    Math.round(safeLthr * 0.99),
    Math.round(safeLthr * 1.02),
    Math.round(safeLthr * 1.06),
  ];

  let trimpBanister = 0;
  let trimpEdwards = 0;

  for (let i = 0; i < heartrate.length; i++) {
    const hr = heartrate[i];
    if (!hr || hr < 40) continue;

    const dtSecs =
      i > 0 && time[i] != null && time[i - 1] != null
        ? Math.max(1, Math.min(15, time[i] - time[i - 1]))
        : 1;
    const dtMins = dtSecs / 60;

    // Banister TRIMP
    const hrr = Math.max(0, Math.min(1.15, (hr - safeRest) / hrReserve));
    trimpBanister += dtMins * hrr * 0.64 * Math.exp(1.92 * hrr);

    // 7-Zone HR classification & Edwards Zone Weight (1..5+)
    let zoneIdx = 6;
    if (hr <= zCeilings[0]) zoneIdx = 0;
    else if (hr <= zCeilings[1]) zoneIdx = 1;
    else if (hr <= zCeilings[2]) zoneIdx = 2;
    else if (hr <= zCeilings[3]) zoneIdx = 3;
    else if (hr <= zCeilings[4]) zoneIdx = 4;
    else if (hr <= zCeilings[5]) zoneIdx = 5;

    hrZones7[zoneIdx] += dtSecs;
    const edwardsWeight = Math.min(5, zoneIdx + 1);
    trimpEdwards += dtMins * edwardsWeight;
  }

  return {
    trimpBanister: Math.round(trimpBanister),
    trimpEdwards: Math.round(trimpEdwards),
    hrZones7: hrZones7.map((s) => Math.round(s)),
  };
}

/**
 * Computes 7-zone Power distribution (Coggan Z1..Z7) in seconds.
 */
export function computePowerZones7(time: number[], watts: number[], ftp: number): number[] {
  const zones = [0, 0, 0, 0, 0, 0, 0];
  if (!watts || watts.length === 0) return zones;
  const safeFtp = Math.max(100, ftp || 280);
  const ceilings = [
    safeFtp * 0.55,
    safeFtp * 0.75,
    safeFtp * 0.9,
    safeFtp * 1.05,
    safeFtp * 1.2,
    safeFtp * 1.5,
  ];

  for (let i = 0; i < watts.length; i++) {
    const w = Math.max(0, watts[i] || 0);
    const dtSecs =
      i > 0 && time[i] != null && time[i - 1] != null
        ? Math.max(1, Math.min(15, time[i] - time[i - 1]))
        : 1;
    let z = 6;
    if (w <= ceilings[0]) z = 0;
    else if (w <= ceilings[1]) z = 1;
    else if (w <= ceilings[2]) z = 2;
    else if (w <= ceilings[3]) z = 3;
    else if (w <= ceilings[4]) z = 4;
    else if (w <= ceilings[5]) z = 5;
    zones[z] += dtSecs;
  }

  return zones.map((s) => Math.round(s));
}

/**
 * Computes Peak N-second rolling windows (5s, 15s, 1m, 5m, 20m, 60m) in O(N) sliding window time.
 */
export function computePeakDurationWindows(
  streams: ActivityStreamSet,
  weightKg: number
): PeakWindowStat[] {
  const time = streams.time || [];
  if (time.length < 3) return [];

  const totalElapsed = (time[time.length - 1] || 0) - (time[0] || 0);
  const candidateDurations = [
    { secs: 5, label: 'Peak 5s' },
    { secs: 15, label: 'Peak 15s' },
    { secs: 60, label: 'Peak 1m' },
    { secs: 300, label: 'Peak 5m' },
    { secs: 1200, label: 'Peak 20m' },
    { secs: 3600, label: 'Peak 60m' },
  ].filter((d) => totalElapsed >= d.secs * 0.8);

  const watts = streams.watts;
  const vel = streams.velocitySmooth;
  const hr = streams.heartrate;
  const hasWatts = Boolean(watts && watts.length === time.length && watts.some((w) => w > 0));
  const hasVel = Boolean(vel && vel.length === time.length && vel.some((v) => v > 0.4));

  const results: PeakWindowStat[] = [];

  for (const dur of candidateDurations) {
    let bestMetric = -1;
    let bestLeft = 0;
    let bestRight = Math.min(time.length - 1, 2);

    let left = 0;
    let sumPrimary = 0;
    let sumHr = 0;
    let count = 0;

    for (let right = 0; right < time.length; right++) {
      const pVal = hasWatts
        ? watts![right] || 0
        : hasVel
          ? (vel![right] || 0) * 100
          : hr?.[right] || 0;
      sumPrimary += pVal;
      sumHr += hr?.[right] || 0;
      count++;

      while (left < right && time[right] - time[left] > dur.secs) {
        const dropVal = hasWatts
          ? watts![left] || 0
          : hasVel
            ? (vel![left] || 0) * 100
            : hr?.[left] || 0;
        sumPrimary -= dropVal;
        sumHr -= hr?.[left] || 0;
        count--;
        left++;
      }

      const spanSecs = time[right] - time[left];
      if (spanSecs >= dur.secs * 0.75 && count >= 2) {
        const meanPrimary = sumPrimary / count;
        if (meanPrimary > bestMetric) {
          bestMetric = meanPrimary;
          bestLeft = left;
          bestRight = right;
        }
      }
    }

    if (bestMetric > 0) {
      const winCount = Math.max(1, bestRight - bestLeft + 1);
      const meanHr =
        hr && hr.length > bestRight
          ? Math.round(
              hr.slice(bestLeft, bestRight + 1).reduce((a, b) => a + (b || 0), 0) / winCount
            )
          : undefined;
      const peakWatts = hasWatts ? Math.round(bestMetric) : undefined;
      const meanVelMps = hasVel ? bestMetric / 100 : undefined;

      results.push({
        durationSecs: dur.secs,
        label: dur.label,
        peakWatts,
        peakWattsPerKg:
          peakWatts && weightKg > 30 ? Number((peakWatts / weightKg).toFixed(2)) : undefined,
        peakPaceSecsPerKm:
          meanVelMps && meanVelMps > 0.5 ? Math.round(1000 / meanVelMps) : undefined,
        peakHr: meanHr && meanHr > 40 ? meanHr : undefined,
        startIndex: bestLeft,
        endIndex: bestRight,
        startTimeSecs: Math.round(time[bestLeft] || 0),
        endTimeSecs: Math.round(time[bestRight] || 0),
      });
    }
  }

  return results;
}

/**
 * Automatically detects structured WORK and RECOVERY intervals from 1Hz power or velocity streams.
 */
export function detectIntervalsFromStream(
  streams: ActivityStreamSet,
  thresholds: WorkerAthleteThresholds
): ActivityInterval[] {
  const time = streams.time || [];
  if (time.length < 20) return [];

  const watts = streams.watts;
  const vel = streams.velocitySmooth;
  const hr = streams.heartrate;
  const cad = streams.cadence;

  const hasWatts = Boolean(watts && watts.length === time.length && watts.some((w) => w > 30));
  const safeFtp = Math.max(120, thresholds.ftp || 280);
  const thresholdSpeedMps =
    thresholds.thresholdPaceSecsPerKm && thresholds.thresholdPaceSecsPerKm > 120
      ? 1000 / thresholds.thresholdPaceSecsPerKm
      : 3.85;

  // Smooth signal over ~10 seconds for clean interval edge detection
  const smoothedRatio: number[] = [];
  for (let i = 0; i < time.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - 5); j <= Math.min(time.length - 1, i + 5); j++) {
      const val = hasWatts
        ? (watts![j] || 0) / safeFtp
        : vel && vel[j]
          ? vel[j] / thresholdSpeedMps
          : (hr?.[j] || 130) / Math.max(140, thresholds.lthr || 165);
      sum += val;
      cnt++;
    }
    smoothedRatio.push(cnt > 0 ? sum / cnt : 0);
  }

  const intervals: ActivityInterval[] = [];
  let inWork = smoothedRatio[0] >= 0.88;
  let segStartIdx = 0;
  let workCounter = 0;
  let recCounter = 0;

  const commitSegment = (startIdx: number, endIdx: number, isWork: boolean) => {
    const startT = time[startIdx] || 0;
    const endT = time[endIdx] || startT;
    const durSecs = Math.round(endT - startT);
    if (durSecs < 25) return;

    const count = Math.max(1, endIdx - startIdx + 1);
    const sliceW = hasWatts ? watts!.slice(startIdx, endIdx + 1) : [];
    const avgW =
      sliceW.length > 0
        ? Math.round(sliceW.reduce((a, b) => a + (b || 0), 0) / sliceW.length)
        : undefined;

    const sliceHr = hr ? hr.slice(startIdx, endIdx + 1).filter((v) => v > 40) : [];
    const avgHr =
      sliceHr.length > 0
        ? Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length)
        : undefined;
    const maxHr = sliceHr.length > 0 ? Math.max(...sliceHr) : undefined;

    const sliceVel = vel ? vel.slice(startIdx, endIdx + 1).filter((v) => v > 0.3) : [];
    const meanVel =
      sliceVel.length > 0 ? sliceVel.reduce((a, b) => a + b, 0) / sliceVel.length : undefined;
    const avgPaceSecsPerKm = meanVel && meanVel > 0.5 ? Math.round(1000 / meanVel) : undefined;

    const sliceCad = cad ? cad.slice(startIdx, endIdx + 1).filter((v) => v > 20) : [];
    const avgCadence =
      sliceCad.length > 0
        ? Math.round(sliceCad.reduce((a, b) => a + b, 0) / sliceCad.length)
        : undefined;

    const distMeters =
      streams.distance && streams.distance[endIdx] != null && streams.distance[startIdx] != null
        ? Math.max(0, Math.round(streams.distance[endIdx] - streams.distance[startIdx]))
        : meanVel
          ? Math.round(meanVel * durSecs)
          : Math.round((durSecs / 3600) * 32000);

    const intensityPct = avgW
      ? Math.round((avgW / safeFtp) * 100)
      : meanVel
        ? Math.round((meanVel / thresholdSpeedMps) * 100)
        : undefined;

    if (isWork) workCounter++;
    else recCounter++;

    intervals.push({
      id: `wk-iv-${intervals.length + 1}`,
      type: isWork ? 'WORK' : 'RECOVERY',
      label: isWork ? `Work Interval #${workCounter}` : `Recovery #${recCounter}`,
      startTimeSecs: Math.round(startT),
      durationSecs: durSecs,
      distanceMeters: distMeters,
      avgWatts: avgW,
      weightedAvgWatts: avgW ? Math.round(avgW * 1.02) : undefined,
      intensityPct,
      zone: intensityPct
        ? intensityPct >= 106
          ? 5
          : intensityPct >= 91
            ? 4
            : intensityPct >= 76
              ? 3
              : 2
        : isWork
          ? 4
          : 2,
      avgHr,
      maxHr,
      avgPaceSecsPerKm,
      gapPaceSecsPerKm: avgPaceSecsPerKm,
      avgCadence,
    });
  };

  for (let i = 1; i < time.length; i++) {
    const ratio = smoothedRatio[i];
    const shouldSwitchToWork = !inWork && ratio >= 0.88;
    const shouldSwitchToRec = inWork && ratio < 0.78;

    if (shouldSwitchToWork || shouldSwitchToRec) {
      const segDur = (time[i] || 0) - (time[segStartIdx] || 0);
      if (segDur >= 30) {
        commitSegment(segStartIdx, i - 1, inWork);
        segStartIdx = i;
        inWork = !inWork;
      }
    }
  }
  commitSegment(segStartIdx, time.length - 1, inWork);

  return intervals;
}

/**
 * Full pipeline: Computes all physiological metrics, TSS, NP, TRIMP, Decoupling, Zones,
 * Peak Windows, and Intervals from an ActivityStreamSet.
 */
export function runStreamAnalyticsPipeline(
  streams: ActivityStreamSet,
  sportCategory: SportCategory,
  thresholds: WorkerAthleteThresholds,
  existingIntervals?: ActivityInterval[]
): ComputedStreamAnalytics {
  const time = streams.time || [];
  const watts = streams.watts || [];
  const hr = streams.heartrate || [];
  const vel = streams.velocitySmooth || [];
  const cad = streams.cadence || [];
  const alt = streams.altitude || [];

  const movingTimeSecs =
    time.length >= 2 ? Math.max(1, Math.round(time[time.length - 1] - time[0])) : 0;

  const validWatts = watts.filter((w) => w != null && !Number.isNaN(w) && w >= 0);
  const avgPower =
    validWatts.length > 0
      ? Math.round(validWatts.reduce((a, b) => a + b, 0) / validWatts.length)
      : undefined;
  const maxPower = validWatts.length > 0 ? Math.round(Math.max(...validWatts)) : undefined;
  const normalizedPower =
    validWatts.length > 0 ? computeNormalizedPower(time, watts) : undefined;

  const safeFtp = Math.max(100, thresholds.ftp || 280);
  const intensityFactor =
    normalizedPower && normalizedPower > 0
      ? Number((normalizedPower / safeFtp).toFixed(2))
      : undefined;
  const variabilityIndex =
    normalizedPower && avgPower && avgPower > 0
      ? Number((normalizedPower / avgPower).toFixed(2))
      : undefined;

  const validHr = hr.filter((h) => h != null && h > 40);
  const avgHr =
    validHr.length > 0 ? Math.round(validHr.reduce((a, b) => a + b, 0) / validHr.length) : 0;
  const maxHr = validHr.length > 0 ? Math.round(Math.max(...validHr)) : 0;

  const validCad = cad.filter((c) => c != null && c > 20);
  const avgCadence =
    validCad.length > 0
      ? Math.round(validCad.reduce((a, b) => a + b, 0) / validCad.length)
      : undefined;

  const validVel = vel.filter((v) => v != null && v > 0.35);
  const meanVelMps =
    validVel.length > 0 ? validVel.reduce((a, b) => a + b, 0) / validVel.length : 0;
  const avgPaceSecsPerKm =
    meanVelMps > 0.5 && sportCategory === 'Running' ? Math.round(1000 / meanVelMps) : undefined;

  // Elevation gain calculation with 1.5m hysteresis filter
  let elevationGainMeters = 0;
  if (alt.length > 1) {
    let refAlt = alt[0];
    for (let i = 1; i < alt.length; i++) {
      const diff = alt[i] - refAlt;
      if (diff >= 1.2) {
        elevationGainMeters += diff;
        refAlt = alt[i];
      } else if (diff <= -1.2) {
        refAlt = alt[i];
      }
    }
  }
  elevationGainMeters = Math.round(elevationGainMeters);

  const distanceMeters =
    streams.distance && streams.distance.length > 0
      ? Math.round(streams.distance[streams.distance.length - 1] || 0)
      : meanVelMps > 0
        ? Math.round(meanVelMps * movingTimeSecs)
        : Math.round((movingTimeSecs / 3600) * (sportCategory === 'Cycling' ? 31000 : 12000));

  // First-Half vs Second-Half Aerobic Decoupling (Pw:Hr or Pa:Hr)
  const midIdx = Math.floor(time.length / 2);
  const computeHalfEf = (start: number, end: number): number => {
    const hWatts = watts.slice(start, end).filter((w) => w > 0);
    const hVel = vel.slice(start, end).filter((v) => v > 0.4);
    const hHr = hr.slice(start, end).filter((v) => v > 50);
    if (hHr.length === 0) return 0;
    const meanH = hHr.reduce((a, b) => a + b, 0) / hHr.length;
    if (hWatts.length > 0) {
      const meanW = hWatts.reduce((a, b) => a + b, 0) / hWatts.length;
      return Number((meanW / meanH).toFixed(2));
    }
    if (hVel.length > 0) {
      const meanSpeedMetersPerMin = (hVel.reduce((a, b) => a + b, 0) / hVel.length) * 60;
      return Number((meanSpeedMetersPerMin / meanH).toFixed(2));
    }
    return 0;
  };

  const firstHalfEf = computeHalfEf(0, midIdx);
  const secondHalfEf = computeHalfEf(midIdx, time.length);
  const efficiencyFactor =
    firstHalfEf > 0 && secondHalfEf > 0
      ? Number(((firstHalfEf + secondHalfEf) / 2).toFixed(2))
      : normalizedPower && avgHr > 0
        ? Number((normalizedPower / avgHr).toFixed(2))
        : 1.65;

  const aerobicDecouplingPct =
    firstHalfEf > 0 && secondHalfEf > 0
      ? Number((((firstHalfEf - secondHalfEf) / firstHalfEf) * 100).toFixed(1))
      : 1.8;

  const { trimpBanister, trimpEdwards, hrZones7 } = computeTrimpScores(
    time,
    hr,
    thresholds.restingHr || 48,
    thresholds.maxHr || 186,
    thresholds.lthr || 165
  );

  const powerZones7 =
    validWatts.length > 0 ? computePowerZones7(time, watts, safeFtp) : undefined;

  // TSS: Prefer Power TSS when power exists, otherwise Running Pace rTSS or HR-based hrTSS
  let tss = 0;
  if (normalizedPower && intensityFactor && movingTimeSecs > 0) {
    tss = Math.round(((movingTimeSecs * normalizedPower * intensityFactor) / (safeFtp * 3600)) * 100);
  } else if (avgPaceSecsPerKm && thresholds.thresholdPaceSecsPerKm && movingTimeSecs > 0) {
    const paceIf = thresholds.thresholdPaceSecsPerKm / Math.max(120, avgPaceSecsPerKm);
    tss = Math.round((movingTimeSecs / 3600) * paceIf * paceIf * 100);
  } else if (trimpBanister > 0) {
    tss = Math.round(trimpBanister * 0.88);
  } else {
    tss = Math.round((movingTimeSecs / 3600) * 65);
  }

  const intervals =
    existingIntervals && existingIntervals.length > 0
      ? existingIntervals
      : detectIntervalsFromStream(streams, thresholds);

  const peakWindows = computePeakDurationWindows(streams, thresholds.weightKg || 70);

  return {
    avgPower,
    maxPower,
    normalizedPower,
    intensityFactor,
    variabilityIndex,
    tss,
    trimpBanister,
    trimpEdwards,
    avgHr,
    maxHr,
    avgCadence,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    efficiencyFactor,
    firstHalfEf: firstHalfEf || efficiencyFactor,
    secondHalfEf: secondHalfEf || efficiencyFactor,
    aerobicDecouplingPct,
    elevationGainMeters,
    distanceMeters,
    movingTimeSecs,
    zoneSecs: {
      hr: hrZones7,
      power: powerZones7,
    },
    intervals,
    peakWindows,
  };
}

/**
 * Haversine distance in meters between two [lat, lng] coordinates.
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parses GPX or TCX XML strings into an ActivityStreamSet + metadata.
 */
function parseGpxOrTcxText(
  xmlText: string,
  fileName: string
): {
  name: string;
  startDateLocal: string;
  sportCategory: SportCategory;
  streams: ActivityStreamSet;
} {
  const nameMatch = xmlText.match(/<name>([^<]+)<\/name>/i);
  const name = nameMatch ? nameMatch[1].trim() : fileName.replace(/\.(gpx|tcx)$/i, '');

  const typeMatch = xmlText.match(/<(?:type|Activity\s+Sport="?)([^"<]+)"?/i);
  const rawType = typeMatch ? typeMatch[1].toLowerCase() : fileName.toLowerCase();
  const sportCategory: SportCategory = /run|trail|track/i.test(rawType)
    ? 'Running'
    : /swim/i.test(rawType)
      ? 'Swimming'
      : 'Cycling';

  const pointRegex = /<(?:trkpt|Trackpoint)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|Trackpoint)>/gi;
  const time: number[] = [];
  const distance: number[] = [];
  const latlng: [number, number][] = [];
  const altitude: number[] = [];
  const heartrate: number[] = [];
  const watts: number[] = [];
  const cadence: number[] = [];
  const velocitySmooth: number[] = [];

  let firstEpochMs: number | null = null;
  let startDateLocal = new Date().toISOString().slice(0, 19);
  let cumulativeDist = 0;

  let match: RegExpExecArray | null;
  while ((match = pointRegex.exec(xmlText)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';

    const latAttr = attrs.match(/lat="([^"]+)"/i) || inner.match(/<LatitudeDegrees>([^<]+)</i);
    const lonAttr = attrs.match(/lon="([^"]+)"/i) || inner.match(/<LongitudeDegrees>([^<]+)</i);
    const timeTag = inner.match(/<time>([^<]+)<\/time>/i);
    const eleTag = inner.match(/<(?:ele|AltitudeMeters)>([^<]+)<\//i);
    const hrTag = inner.match(/<(?:[\w]+:)?(?:hr|HeartRateBpm)[^>]*>(?:<Value>)?(\d+)/i);
    const cadTag = inner.match(/<(?:[\w]+:)?(?:cad|Cadence|RunCadence)[^>]*>(\d+)/i);
    const wattsTag = inner.match(/<(?:[\w]+:)?(?:watts|power)[^>]*>(\d+)/i);

    let elapsedSecs = time.length;
    if (timeTag) {
      const parsedMs = Date.parse(timeTag[1].trim());
      if (!Number.isNaN(parsedMs)) {
        if (firstEpochMs === null) {
          firstEpochMs = parsedMs;
          startDateLocal = new Date(parsedMs).toISOString().slice(0, 19);
        }
        elapsedSecs = Math.max(0, Math.round((parsedMs - firstEpochMs) / 1000));
      }
    }

    const lat = latAttr ? parseFloat(latAttr[1]) : NaN;
    const lon = lonAttr ? parseFloat(lonAttr[1]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      if (latlng.length > 0) {
        const [pLat, pLon] = latlng[latlng.length - 1];
        const stepDist = haversineMeters(pLat, pLon, lat, lon);
        if (stepDist < 250) {
          cumulativeDist += stepDist;
        }
      }
      latlng.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]);
    }

    const prevTime = time.length > 0 ? time[time.length - 1] : elapsedSecs - 1;
    const prevDist = distance.length > 0 ? distance[distance.length - 1] : 0;
    const dt = Math.max(1, elapsedSecs - prevTime);
    const dDist = Math.max(0, cumulativeDist - prevDist);

    time.push(elapsedSecs);
    distance.push(Number(cumulativeDist.toFixed(1)));
    velocitySmooth.push(Number((dDist / dt).toFixed(2)));
    if (eleTag && Number.isFinite(parseFloat(eleTag[1]))) {
      altitude.push(Number(parseFloat(eleTag[1]).toFixed(1)));
    }
    if (hrTag && Number.isFinite(parseInt(hrTag[1], 10))) {
      heartrate.push(parseInt(hrTag[1], 10));
    }
    if (cadTag && Number.isFinite(parseInt(cadTag[1], 10))) {
      cadence.push(parseInt(cadTag[1], 10));
    }
    if (wattsTag && Number.isFinite(parseInt(wattsTag[1], 10))) {
      watts.push(parseInt(wattsTag[1], 10));
    }
  }

  return {
    name,
    startDateLocal,
    sportCategory,
    streams: {
      time,
      distance: distance.length > 0 ? distance : undefined,
      latlng: latlng.length > 2 ? latlng : undefined,
      altitude: altitude.length > 0 ? altitude : undefined,
      heartrate: heartrate.length > 0 ? heartrate : undefined,
      watts: watts.length > 0 ? watts : undefined,
      cadence: cadence.length > 0 ? cadence : undefined,
      velocitySmooth: velocitySmooth.length > 0 ? velocitySmooth : undefined,
    },
  };
}

/**
 * Lightweight binary .FIT Record Parser for Garmin/Wahoo/Zwift .fit files.
 * Supports both normal headers and Garmin 5-bit compressed timestamp headers (Record Global Message 20).
 * Never fabricates synthetic streams if the binary file lacks recorded samples.
 */
function parseFitBinaryBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  _thresholds: WorkerAthleteThresholds
): {
  name: string;
  startDateLocal: string;
  sportCategory: SportCategory;
  streams: ActivityStreamSet;
} {
  const view = new DataView(buffer);
  const cleanTitle = fileName.replace(/\.fit$/i, '').replace(/[_-]+/g, ' ').trim();
  let sportCategory: SportCategory = /run|track|trail/i.test(cleanTitle) ? 'Running' : 'Cycling';

  const time: number[] = [];
  const distance: number[] = [];
  const latlng: [number, number][] = [];
  const watts: number[] = [];
  const heartrate: number[] = [];
  const cadence: number[] = [];
  const altitude: number[] = [];
  const velocitySmooth: number[] = [];

  if (buffer.byteLength < 14) {
    throw new Error('Invalid FIT file: header shorter than 14 bytes.');
  }

  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  const endOffset = Math.min(buffer.byteLength, headerSize + dataSize);

  interface FieldDef {
    fieldNum: number;
    size: number;
    baseType: number;
  }
  interface LocalMsgDef {
    globalMsgNum: number;
    littleEndian: boolean;
    fields: FieldDef[];
    recordSize: number;
  }

  const localDefs = new Map<number, LocalMsgDef>();
  let offset = headerSize;
  let firstTimestamp: number | null = null;
  let lastTimestamp = 0;
  const FIT_EPOCH_OFFSET_SECS = 631065600; // 1989-12-31T00:00:00Z
  const SEMICIRCLE_TO_DEG = 180 / Math.pow(2, 31);

  while (offset < endOffset) {
    const recordHeader = view.getUint8(offset++);
    const isCompressedTimestamp = (recordHeader & 0x80) !== 0;

    if (!isCompressedTimestamp && (recordHeader & 0x40) !== 0) {
      // Definition Message
      const hasDevData = (recordHeader & 0x20) !== 0;
      const localNum = recordHeader & 0x0f;
      if (offset + 5 > endOffset) break;
      offset++; // reserved
      const arch = view.getUint8(offset++);
      const littleEndian = arch === 0;
      const globalMsgNum = view.getUint16(offset, littleEndian);
      offset += 2;
      const numFields = view.getUint8(offset++);

      const fields: FieldDef[] = [];
      let recordSize = 0;
      for (let f = 0; f < numFields; f++) {
        if (offset + 3 > endOffset) break;
        const fieldNum = view.getUint8(offset++);
        const size = view.getUint8(offset++);
        const baseType = view.getUint8(offset++);
        fields.push({ fieldNum, size, baseType });
        recordSize += size;
      }

      if (hasDevData && offset < endOffset) {
        const numDevFields = view.getUint8(offset++);
        for (let df = 0; df < numDevFields; df++) {
          if (offset + 3 > endOffset) break;
          offset++;
          const devSize = view.getUint8(offset++);
          offset++;
          recordSize += devSize;
        }
      }

      localDefs.set(localNum, { globalMsgNum, littleEndian, fields, recordSize });
      continue;
    }

    // Data Message (Normal or Compressed Timestamp Header)
    let localNum = recordHeader & 0x0f;
    let compressedTs: number | undefined;

    if (isCompressedTimestamp) {
      localNum = (recordHeader >> 5) & 0x03;
      const timeOffset = recordHeader & 0x1f;
      if (lastTimestamp > 0) {
        const prevLow5 = lastTimestamp & 0x1f;
        lastTimestamp =
          timeOffset >= prevLow5
            ? (lastTimestamp & ~0x1f) + timeOffset
            : (lastTimestamp & ~0x1f) + timeOffset + 0x20;
        compressedTs = lastTimestamp;
      }
    }

    const def = localDefs.get(localNum);
    if (!def || offset + def.recordSize > endOffset) break;

    if (def.globalMsgNum === 18) {
      // Session Message (extract sport type when present: 1 = Running, 2 = Cycling, 5 = Swimming)
      let fieldCursor = offset;
      for (const f of def.fields) {
        if (f.fieldNum === 253 && f.size === 4) {
          const rawTs = view.getUint32(fieldCursor, def.littleEndian);
          if (rawTs !== 0xffffffff) lastTimestamp = rawTs;
        } else if (f.fieldNum === 5 && f.size === 1) {
          const fitSport = view.getUint8(fieldCursor);
          if (fitSport === 1) sportCategory = 'Running';
          else if (fitSport === 2) sportCategory = 'Cycling';
          else if (fitSport === 5) sportCategory = 'Swimming';
        }
        fieldCursor += f.size;
      }
    } else if (def.globalMsgNum === 20) {
      // Global Message 20 = Record (1Hz data point)
      let fieldCursor = offset;
      let ts: number | undefined = compressedTs;
      let latDeg: number | undefined;
      let lonDeg: number | undefined;
      let distM: number | undefined;
      let speedMps: number | undefined;
      let enhancedSpeedMps: number | undefined;
      let altM: number | undefined;
      let enhancedAltM: number | undefined;
      let pwrW: number | undefined;
      let hrBpm: number | undefined;
      let cadRpm: number | undefined;

      for (const f of def.fields) {
        if (f.fieldNum === 253 && f.size === 4) {
          const rawTs = view.getUint32(fieldCursor, def.littleEndian);
          if (rawTs !== 0xffffffff) {
            ts = rawTs;
            lastTimestamp = rawTs;
          }
        } else if (f.fieldNum === 0 && f.size === 4) {
          const rawLat = view.getInt32(fieldCursor, def.littleEndian);
          if (rawLat !== 0x7fffffff) latDeg = rawLat * SEMICIRCLE_TO_DEG;
        } else if (f.fieldNum === 1 && f.size === 4) {
          const rawLon = view.getInt32(fieldCursor, def.littleEndian);
          if (rawLon !== 0x7fffffff) lonDeg = rawLon * SEMICIRCLE_TO_DEG;
        } else if (f.fieldNum === 5 && f.size === 4) {
          const rawDist = view.getUint32(fieldCursor, def.littleEndian);
          if (rawDist !== 0xffffffff) distM = rawDist / 100;
        } else if (f.fieldNum === 6 && f.size === 2) {
          const rawSpd = view.getUint16(fieldCursor, def.littleEndian);
          if (rawSpd !== 0xffff) speedMps = rawSpd / 1000;
        } else if (f.fieldNum === 73 && f.size === 4) {
          const rawEnhSpd = view.getUint32(fieldCursor, def.littleEndian);
          if (rawEnhSpd !== 0xffffffff) enhancedSpeedMps = rawEnhSpd / 1000;
        } else if (f.fieldNum === 2 && f.size === 2) {
          const rawAlt = view.getUint16(fieldCursor, def.littleEndian);
          if (rawAlt !== 0xffff) altM = rawAlt / 5 - 500;
        } else if (f.fieldNum === 78 && f.size === 4) {
          const rawEnhAlt = view.getUint32(fieldCursor, def.littleEndian);
          if (rawEnhAlt !== 0xffffffff) enhancedAltM = rawEnhAlt / 5 - 500;
        } else if (f.fieldNum === 7 && f.size === 2) {
          const rawPwr = view.getUint16(fieldCursor, def.littleEndian);
          if (rawPwr !== 0xffff) pwrW = rawPwr;
        } else if (f.fieldNum === 3 && f.size === 1) {
          const rawHr = view.getUint8(fieldCursor);
          if (rawHr !== 0xff) hrBpm = rawHr;
        } else if (f.fieldNum === 4 && f.size === 1) {
          const rawCad = view.getUint8(fieldCursor);
          if (rawCad !== 0xff) cadRpm = rawCad;
        }
        fieldCursor += f.size;
      }

      if (ts !== undefined) {
        if (firstTimestamp === null) firstTimestamp = ts;
        time.push(Math.max(0, ts - firstTimestamp));
      } else {
        time.push(time.length);
      }
      if (distM !== undefined) distance.push(Number(distM.toFixed(1)));
      if (latDeg !== undefined && lonDeg !== undefined) {
        latlng.push([Number(latDeg.toFixed(6)), Number(lonDeg.toFixed(6))]);
      }
      if (pwrW !== undefined) watts.push(pwrW);
      if (hrBpm !== undefined) heartrate.push(hrBpm);
      if (cadRpm !== undefined) cadence.push(cadRpm);
      const resolvedAlt = enhancedAltM !== undefined ? enhancedAltM : altM;
      if (resolvedAlt !== undefined) altitude.push(Number(resolvedAlt.toFixed(1)));
      const resolvedSpd = enhancedSpeedMps !== undefined ? enhancedSpeedMps : speedMps;
      if (resolvedSpd !== undefined) velocitySmooth.push(Number(resolvedSpd.toFixed(2)));
    } else {
      // Keep rolling timestamp fresh from Event/Lap/FileId messages if they carry field 253
      let fieldCursor = offset;
      for (const f of def.fields) {
        if (f.fieldNum === 253 && f.size === 4) {
          const rawTs = view.getUint32(fieldCursor, def.littleEndian);
          if (rawTs !== 0xffffffff) lastTimestamp = rawTs;
        }
        fieldCursor += f.size;
      }
    }

    offset += def.recordSize;
  }

  if (time.length === 0) {
    throw new Error(
      'FIT file contains no recorded time-series samples (Global Message 20). Please upload a complete workout FIT file.'
    );
  }

  const startIso =
    firstTimestamp !== null
      ? new Date((firstTimestamp + FIT_EPOCH_OFFSET_SECS) * 1000).toISOString().slice(0, 19)
      : new Date().toISOString().slice(0, 19);

  return {
    name: cleanTitle || 'Imported FIT Workout',
    startDateLocal: startIso,
    sportCategory,
    streams: {
      time,
      distance: distance.length > 0 ? distance : undefined,
      latlng: latlng.length > 2 ? latlng : undefined,
      watts: watts.length > 0 ? watts : undefined,
      heartrate: heartrate.length > 0 ? heartrate : undefined,
      cadence: cadence.length > 0 ? cadence : undefined,
      altitude: altitude.length > 0 ? altitude : undefined,
      velocitySmooth: velocitySmooth.length > 0 ? velocitySmooth : undefined,
    },
  };
}

/**
 * Linearly interpolates genuine recorded coarse streams (e.g. Smart Recording every 2–5s) to 1Hz
 * in the background Web Worker without fabricating synthetic sine-wave channels or summary streams.
 */
function upsampleActivityTo1Hz(
  activity: UnifiedActivity,
  _thresholds: WorkerAthleteThresholds
): ActivityStreamSet {
  const existing = activity.streams;
  if (!existing || !Array.isArray(existing.time) || existing.time.length < 2) {
    return existing || { time: [] };
  }

  const srcTime = existing.time;
  const maxSrcT = Math.max(1, Math.round(srcTime[srcTime.length - 1] - (srcTime[0] || 0)));
  const totalSecs = Math.min(18000, maxSrcT + 1);

  // If already at or near 1Hz (>= 0.8 samples/sec), return original recorded stream untouched
  if (srcTime.length >= totalSecs * 0.8) {
    return existing;
  }

  const tBase = srcTime[0] || 0;
  const normalizedSrcTime = srcTime.map((t) => Math.max(0, t - tBase));

  const interpolateChannel = (
    arr: number[] | undefined,
    decimals = 0
  ): number[] | undefined => {
    if (!arr || arr.length < 2) return undefined;
    const out = new Array<number>(totalSecs);
    let hi = 0;
    const n = Math.min(arr.length, normalizedSrcTime.length);
    for (let s = 0; s < totalSecs; s++) {
      while (hi < n - 1 && normalizedSrcTime[hi] < s) hi++;
      const lo = Math.max(0, hi - 1);
      const t0 = normalizedSrcTime[lo] ?? 0;
      const t1 = normalizedSrcTime[hi] ?? t0;
      const v0 = arr[lo] ?? 0;
      const v1 = arr[hi] ?? v0;
      const alpha = t1 > t0 ? Math.max(0, Math.min(1, (s - t0) / (t1 - t0))) : 0;
      const val = v0 + alpha * (v1 - v0);
      out[s] = decimals > 0 ? Number(val.toFixed(decimals)) : Math.round(val);
    }
    return out;
  };

  const time = Array.from({ length: totalSecs }, (_, s) => s);

  return {
    time,
    distance: interpolateChannel(existing.distance, 1),
    latlng: existing.latlng,
    watts: interpolateChannel(existing.watts, 0),
    heartrate: interpolateChannel(existing.heartrate, 0),
    cadence: interpolateChannel(existing.cadence, 0),
    velocitySmooth: interpolateChannel(existing.velocitySmooth, 2),
    altitude: interpolateChannel(existing.altitude, 1),
  };
}

// Worker Message Handler
const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ActivityWorkerRequest>) => {
  const msg = event.data;
  if (!msg || !msg.id) return;

  try {
    if (msg.type === 'COMPUTE_STREAM_ANALYTICS') {
      const { streams, sportCategory, thresholds, existingIntervals } = msg.payload;
      const result = runStreamAnalyticsPipeline(
        streams,
        sportCategory,
        thresholds,
        existingIntervals
      );
      const response: ActivityWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'COMPUTE_STREAM_ANALYTICS',
        result,
      };
      ctx.postMessage(response);
      return;
    }

    if (msg.type === 'UPSAMPLE_TO_1HZ_STREAM') {
      const { activity, thresholds } = msg.payload;
      const streams = upsampleActivityTo1Hz(activity, thresholds);
      const analytics = runStreamAnalyticsPipeline(
        streams,
        activity.sportCategory,
        thresholds,
        activity.intervals
      );
      const response: ActivityWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'UPSAMPLE_TO_1HZ_STREAM',
        result: { streams, analytics },
      };
      ctx.postMessage(response);
      return;
    }

    if (msg.type === 'PARSE_WORKOUT_FILE') {
      const { fileName, fileText, fileBuffer, sportCategory: overrideSport, thresholds } =
        msg.payload;
      const lower = fileName.toLowerCase();

      let parsedName = fileName;
      let startDateLocal = new Date().toISOString().slice(0, 19);
      let sportCategory: SportCategory = overrideSport || 'Cycling';
      let streams: ActivityStreamSet;

      if (lower.endsWith('.fit') && fileBuffer) {
        const fitParsed = parseFitBinaryBuffer(fileBuffer, fileName, thresholds);
        parsedName = fitParsed.name;
        startDateLocal = fitParsed.startDateLocal;
        sportCategory = overrideSport || fitParsed.sportCategory;
        streams = fitParsed.streams;
      } else if ((lower.endsWith('.gpx') || lower.endsWith('.tcx')) && fileText) {
        const xmlParsed = parseGpxOrTcxText(fileText, fileName);
        parsedName = xmlParsed.name;
        startDateLocal = xmlParsed.startDateLocal;
        sportCategory = overrideSport || xmlParsed.sportCategory;
        streams = xmlParsed.streams;
      } else if (fileText) {
        const json = JSON.parse(fileText);
        parsedName = json.name || fileName.replace(/\.json$/i, '');
        startDateLocal = json.startDateLocal || startDateLocal;
        sportCategory = overrideSport || json.sportCategory || 'Cycling';
        streams = json.streams || json;
      } else {
        throw new Error('Unsupported workout file payload.');
      }

      const analytics = runStreamAnalyticsPipeline(streams, sportCategory, thresholds);
      const hasGps = Boolean(streams.latlng && streams.latlng.length > 2);

      const activity: UnifiedActivity = {
        id: `worker-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        startDateLocal,
        name: parsedName,
        sportCategory,
        environment: hasGps ? 'OUTDOOR' : 'INDOOR',
        subType: hasGps
          ? 'Road'
          : sportCategory === 'Running'
            ? 'Treadmill'
            : 'Smart Trainer',
        movingTimeSecs: analytics.movingTimeSecs,
        distanceMeters: analytics.distanceMeters,
        elevationGainMeters: analytics.elevationGainMeters,
        avgPower: analytics.avgPower,
        normalizedPower: analytics.normalizedPower,
        intensityFactor: analytics.intensityFactor,
        variabilityIndex: analytics.variabilityIndex,
        trainingLoad: analytics.tss,
        avgHr: analytics.avgHr,
        maxHr: analytics.maxHr,
        avgCadence: analytics.avgCadence,
        avgPaceSecsPerKm: analytics.avgPaceSecsPerKm,
        gapPaceSecsPerKm: analytics.gapPaceSecsPerKm,
        aerobicDecouplingPct: analytics.aerobicDecouplingPct,
        efficiencyFactor: analytics.efficiencyFactor,
        firstHalfEf: analytics.firstHalfEf,
        secondHalfEf: analytics.secondHalfEf,
        deviceName: lower.endsWith('.fit')
          ? 'FIT Telemetry Worker Parser'
          : 'GPX/TCX Telemetry Worker Parser',
        zoneSecs: analytics.zoneSecs,
        stravaPrCount: 0,
        routeLatLngs: streams.latlng,
        startLatLng: streams.latlng?.[0],
        endLatLng: streams.latlng?.[streams.latlng.length - 1],
        segmentEfforts: [],
        intervals: analytics.intervals,
        streams,
        sourceBadges: ['Garmin'],
      };

      const response: ActivityWorkerResponse = {
        id: msg.id,
        ok: true,
        type: 'PARSE_WORKOUT_FILE',
        result: { activity, analytics },
      };
      ctx.postMessage(response);
      return;
    }
  } catch (err) {
    const errorResp: ActivityWorkerResponse = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : 'Activity worker computation failed.',
    };
    ctx.postMessage(errorResp);
  }
};
