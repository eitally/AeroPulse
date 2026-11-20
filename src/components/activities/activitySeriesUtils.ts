import type { SportCategory, UnifiedActivity } from '../../types';

export interface NormalizedSeriesPoint {
  timeSecs: number;
  pct: number;
  power?: number;
  hr?: number;
  paceSecsPerKm?: number;
  cadence?: number;
}

export interface SegmentHistoryEffort {
  effortId: string;
  activityId: string;
  activityName: string;
  date: string;
  startDateLocal: string;
  elapsedTimeSecs: number;
  avgWatts?: number;
  avgPaceSecsPerKm?: number;
  avgHr?: number;
  prRank: 1 | 2 | 3 | null;
}

export interface SegmentHistorySummary {
  segmentId: string;
  name: string;
  sportCategory: SportCategory;
  distanceMeters: number;
  averageGradePct: number;
  prElapsedTimeSecs: number;
  efforts: SegmentHistoryEffort[];
}

/** Extracts normalized 1Hz/smoothed stream points from a recorded activity. */
export function extractActivitySeries(
  activity: UnifiedActivity,
  smoothWindow = 3
): { points: NormalizedSeriesPoint[]; isRealStream: boolean } {
  const streams = activity.streams;
  if (streams && Array.isArray(streams.time) && streams.time.length > 2) {
    const len = streams.time.length;
    const maxTime = Math.max(1, streams.time[len - 1] || activity.movingTimeSecs || 3600);
    const rawWatts = streams.watts;
    const rawVel = streams.velocitySmooth;
    const rawHr = streams.heartrate;
    const rawCad = streams.cadence;

    const smoothAt = (arr: number[] | undefined, idx: number): number | undefined => {
      if (!arr || arr[idx] === undefined) return undefined;
      if (smoothWindow <= 1) return Math.round(arr[idx]);
      let sum = 0;
      let count = 0;
      const half = Math.floor(smoothWindow / 2);
      for (let i = Math.max(0, idx - half); i <= Math.min(arr.length - 1, idx + half); i++) {
        if (arr[i] != null && !Number.isNaN(arr[i])) {
          sum += arr[i];
          count++;
        }
      }
      return count > 0 ? Math.round(sum / count) : Math.round(arr[idx]);
    };

    const points: NormalizedSeriesPoint[] = streams.time.map((t, idx) => {
      const w = smoothAt(rawWatts, idx);
      const hr = smoothAt(rawHr, idx);
      const cad = smoothAt(rawCad, idx);
      const vel = rawVel && rawVel[idx] != null ? rawVel[idx] : undefined;
      const eqWatts =
        w !== undefined
          ? w
          : vel !== undefined && vel > 0
            ? Math.round(vel * 78)
            : undefined;
      const paceSecs = vel !== undefined && vel > 0.4 ? Math.round(1000 / vel) : undefined;
      return {
        timeSecs: Math.round(t),
        pct: Math.min(100, Math.max(0, (t / maxTime) * 100)),
        power: eqWatts,
        hr,
        paceSecsPerKm: paceSecs,
        cadence: cad,
      };
    });

    return { points, isRealStream: true };
  }

  return { points: [], isRealStream: false };
}

/** Samples an aligned activity stream series at a target elapsed-second or % progress value. */
export function sampleSeriesAt(
  points: NormalizedSeriesPoint[],
  mode: 'TIME' | 'PERCENT',
  targetVal: number
): NormalizedSeriesPoint | null {
  if (points.length === 0) return null;
  const maxVal =
    mode === 'TIME' ? points[points.length - 1].timeSecs : points[points.length - 1].pct;
  if (mode === 'TIME' && targetVal > maxVal) {
    return null;
  }

  let best = points[0];
  let bestDist = Infinity;
  for (const pt of points) {
    const val = mode === 'TIME' ? pt.timeSecs : pt.pct;
    const d = Math.abs(val - targetVal);
    if (d < bestDist) {
      bestDist = d;
      best = pt;
    }
  }
  return best;
}
