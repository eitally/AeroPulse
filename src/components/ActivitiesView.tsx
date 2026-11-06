import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  MapPin,
  MessageSquare,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  Trophy,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  DistanceUnit,
  EnvironmentFilter,
  SportCategory,
  UnifiedActivity,
} from '../types';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatStopwatch,
} from '../utils/formatters';
import { InteractiveRouteMap } from './InteractiveRouteMap';

interface ActivitiesViewProps {
  activities: UnifiedActivity[];
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  selectedActivity: UnifiedActivity | null;
  onSelectActivity: (activity: UnifiedActivity | null) => void;
  onLoadActivityStreams?: (activity: UnifiedActivity) => Promise<void>;
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments?: boolean;
  onHydrateMoreRoutes?: () => Promise<void>;
  isHydratingRoutes?: boolean;
  onToggleKudos?: (activity: UnifiedActivity) => Promise<void>;
  onAddComment?: (activity: UnifiedActivity, commentText: string) => Promise<void>;
  athleteWeightKg?: number;
}

interface NormalizedSeriesPoint {
  timeSecs: number;
  pct: number;
  power?: number;
  hr?: number;
  paceSecsPerKm?: number;
  cadence?: number;
}

// Build a 100-sample series from an activity's real stream (or deterministic physiological curve if stream is still loading/unrecorded)
function extractActivitySeries(
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

  // Fallback curve derived from real activity summary metrics (NP/Avg Power, Avg/Max HR, Decoupling, Duration)
  // when an older or non-streamed activity does not return second-by-second FIT streams
  const totalSecs = Math.max(300, activity.movingTimeSecs || 3600);
  const sampleCount = 80;
  const basePower =
    activity.avgPower ||
    activity.normalizedPower ||
    (activity.avgPaceSecsPerKm && activity.avgPaceSecsPerKm > 0
      ? Math.round((1000 / activity.avgPaceSecsPerKm) * 78)
      : 0);
  const baseHr = activity.avgHr || 0;
  const maxHr = activity.maxHr || (baseHr > 0 ? baseHr + 18 : 0);
  const driftFactor = (activity.aerobicDecouplingPct || 2) / 100;
  const seed = activity.id
    .split('')
    .reduce((acc, ch, idx) => acc + ch.charCodeAt(0) * (idx + 1), 0);

  const points: NormalizedSeriesPoint[] = Array.from({ length: sampleCount }, (_, i) => {
    const frac = i / (sampleCount - 1);
    const timeSecs = Math.round(frac * totalSecs);
    // Warmup & cooldown taper + interval wave
    const warmupFactor = frac < 0.08 ? 0.72 + (frac / 0.08) * 0.28 : frac > 0.92 ? 0.78 : 1.0;
    const wave1 = Math.sin(frac * Math.PI * 8 + (seed % 7)) * 0.09;
    const wave2 = Math.cos(frac * Math.PI * 18 + (seed % 13)) * 0.05;
    const powerVal =
      basePower > 0
        ? Math.max(40, Math.round(basePower * warmupFactor * (1 + wave1 + wave2)))
        : undefined;

    const hrWarmup = frac < 0.1 ? 0.78 + (frac / 0.1) * 0.22 : 1.0;
    const hrDrift = 1 + (frac - 0.5) * driftFactor;
    const hrWave = Math.sin(frac * Math.PI * 8 + (seed % 7) - 0.35) * 0.045;
    const hrRaw = baseHr > 0 ? Math.round(baseHr * hrWarmup * hrDrift * (1 + hrWave)) : undefined;
    const hrVal =
      hrRaw !== undefined && maxHr > 0 ? Math.min(maxHr, Math.max(85, hrRaw)) : hrRaw;

    return {
      timeSecs,
      pct: Number((frac * 100).toFixed(1)),
      power: powerVal,
      hr: hrVal,
      paceSecsPerKm: activity.avgPaceSecsPerKm,
      cadence: activity.avgCadence,
    };
  });

  return { points, isRealStream: false };
}

// Interpolate a series at a given X position (either elapsed seconds or 0-100% progress)
function sampleSeriesAt(
  points: NormalizedSeriesPoint[],
  mode: 'TIME' | 'PERCENT',
  targetVal: number
): NormalizedSeriesPoint | null {
  if (points.length === 0) return null;
  const maxVal =
    mode === 'TIME' ? points[points.length - 1].timeSecs : points[points.length - 1].pct;
  if (mode === 'TIME' && targetVal > maxVal) {
    return null; // Workout already finished before this elapsed second
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

export const ActivitiesView: React.FC<ActivitiesViewProps> = ({
  activities,
  selectedSport,
  onSelectSport,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  selectedActivity,
  onSelectActivity,
  onLoadActivityStreams,
  onScanMoreSegments,
  isScanningSegments = false,
  onHydrateMoreRoutes,
  isHydratingRoutes = false,
  onToggleKudos,
  onAddComment,
  athleteWeightKg = 72.5,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);
  const [streamHoverIndex, setStreamHoverIndex] = useState<number | null>(null);
  const [streamZoomRange, setStreamZoomRange] = useState<[number, number] | null>(null);
  const [streamBrushStartIdx, setStreamBrushStartIdx] = useState<number | null>(null);
  const [streamBrushEndIdx, setStreamBrushEndIdx] = useState<number | null>(null);
  const [hrZoneHoverIdx, setHrZoneHoverIdx] = useState<number | null>(null);
  const [modalSelectedSegmentId, setModalSelectedSegmentId] = useState<string | null>(null);
  const [modalSegmentHoverIdx, setModalSegmentHoverIdx] = useState<number | null>(null);

  // Strava Kudos Feed & Interactive Map Explorer State
  const [isKudosMapOpen, setIsKudosMapOpen] = useState<boolean>(true);
  const [kudosFeedFilter, setKudosFeedFilter] = useState<
    'ALL' | 'WITH_KUDOS' | 'PR_HUNTS' | 'WITH_GPS'
  >('ALL');
  const [hoveredRouteActivityId, setHoveredRouteActivityId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [modalCommentInput, setModalCommentInput] = useState<string>('');

  // Split-View Comparison Mode State
  const [isSplitCompareOpen, setIsSplitCompareOpen] = useState<boolean>(false);
  const [compareIdA, setCompareIdA] = useState<string | null>(null);
  const [compareIdB, setCompareIdB] = useState<string | null>(null);
  const [compareXMode, setCompareXMode] = useState<'PERCENT' | 'TIME'>('PERCENT');
  const [smoothStreams, setSmoothStreams] = useState<boolean>(true);
  const [compareHoverStep, setCompareHoverStep] = useState<number | null>(null);

  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    for (const a of activities) {
      const y = a.startDateLocal.slice(0, 4);
      if (/^\d{4}$/.test(y)) yrs.add(y);
    }
    return Array.from(yrs).sort((a, b) => b.localeCompare(a));
  }, [activities]);

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (selectedSport !== 'ALL' && act.sportCategory !== selectedSport) return false;
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) return false;
      if (yearFilter !== 'ALL' && !act.startDateLocal.startsWith(yearFilter)) return false;
      if (
        searchQuery.trim() &&
        !act.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !act.subType.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(act.gearName || '').toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [activities, selectedSport, envFilter, yearFilter, searchQuery]);

  // Resolve Workout A & Workout B from activities list (so updated streams automatically propagate)
  const compareActivityA = useMemo(
    () => activities.find((a) => a.id === compareIdA) || null,
    [activities, compareIdA]
  );
  const compareActivityB = useMemo(
    () => activities.find((a) => a.id === compareIdB) || null,
    [activities, compareIdB]
  );

  // When entering Split-View Mode with empty slots, pre-populate Workout A and a matched repeat Workout B
  const handleToggleSplitView = () => {
    if (!isSplitCompareOpen) {
      setIsSplitCompareOpen(true);
      const sourcePool = filteredActivities.length >= 2 ? filteredActivities : activities;
      if (!compareIdA && sourcePool.length > 0) {
        const first = sourcePool[0];
        setCompareIdA(first.id);
        if (onLoadActivityStreams) onLoadActivityStreams(first);
        if (!compareIdB && sourcePool.length > 1) {
          // Find a repeat workout of the same sport and similar distance/duration
          const matchedRepeat =
            sourcePool.find(
              (cand) =>
                cand.id !== first.id &&
                cand.sportCategory === first.sportCategory &&
                cand.environment === first.environment &&
                (first.distanceMeters > 1000
                  ? Math.abs(cand.distanceMeters - first.distanceMeters) / first.distanceMeters <=
                    0.25
                  : Math.abs(cand.movingTimeSecs - first.movingTimeSecs) /
                      Math.max(60, first.movingTimeSecs) <=
                    0.3)
            ) || sourcePool.find((cand) => cand.id !== first.id);
          if (matchedRepeat) {
            setCompareIdB(matchedRepeat.id);
            if (onLoadActivityStreams) onLoadActivityStreams(matchedRepeat);
          }
        }
      }
    } else {
      setIsSplitCompareOpen(false);
    }
  };

  // Automatically load streams whenever Workout A or Workout B changes
  useEffect(() => {
    if (isSplitCompareOpen && compareActivityA && onLoadActivityStreams) {
      onLoadActivityStreams(compareActivityA);
    }
  }, [isSplitCompareOpen, compareActivityA, onLoadActivityStreams]);

  useEffect(() => {
    if (isSplitCompareOpen && compareActivityB && onLoadActivityStreams) {
      onLoadActivityStreams(compareActivityB);
    }
  }, [isSplitCompareOpen, compareActivityB, onLoadActivityStreams]);

  const handleAssignToCompareSlot = (act: UnifiedActivity, slot?: 'A' | 'B') => {
    if (onLoadActivityStreams) {
      onLoadActivityStreams(act);
    }
    if (slot === 'A') {
      setCompareIdA(act.id);
      setIsSplitCompareOpen(true);
      return;
    }
    if (slot === 'B') {
      setCompareIdB(act.id);
      setIsSplitCompareOpen(true);
      return;
    }
    if (!compareIdA || compareIdA === act.id) {
      setCompareIdA(act.id);
    } else if (!compareIdB || compareIdB === act.id) {
      setCompareIdB(act.id);
    } else {
      setCompareIdB(act.id);
    }
    setIsSplitCompareOpen(true);
  };

  const handleAutoMatchRepeatForA = () => {
    if (!compareActivityA) return;
    const targetDist = compareActivityA.distanceMeters;
    const targetDur = compareActivityA.movingTimeSecs;
    const match = activities.find((a) => {
      if (a.id === compareActivityA.id) return false;
      if (a.sportCategory !== compareActivityA.sportCategory) return false;
      if (targetDist > 1000) {
        return Math.abs(a.distanceMeters - targetDist) / targetDist <= 0.2;
      }
      return Math.abs(a.movingTimeSecs - targetDur) / Math.max(60, targetDur) <= 0.25;
    });
    if (match) {
      setCompareIdB(match.id);
      if (onLoadActivityStreams) onLoadActivityStreams(match);
    }
  };

  // Aggregate summary of currently filtered workouts
  const summaryStats = useMemo(() => {
    const totalLoad = filteredActivities.reduce((acc, a) => acc + a.trainingLoad, 0);
    const totalDistanceMeters = filteredActivities.reduce((acc, a) => acc + a.distanceMeters, 0);
    const totalDurationSecs = filteredActivities.reduce((acc, a) => acc + a.movingTimeSecs, 0);
    const totalElevation = filteredActivities.reduce((acc, a) => acc + a.elevationGainMeters, 0);
    const withEf = filteredActivities.filter((a) => a.efficiencyFactor > 0);
    const avgEf =
      withEf.length > 0
        ? (withEf.reduce((acc, a) => acc + a.efficiencyFactor, 0) / withEf.length).toFixed(2)
        : '—';
    return { totalLoad, totalDistanceMeters, totalDurationSecs, totalElevation, avgEf };
  }, [filteredActivities]);

  // Automatically find Similar Historical Workouts (Repeats) for the selected activity
  const similarHistoricalWorkouts = useMemo(() => {
    if (!selectedActivity) return [];
    const targetDist = selectedActivity.distanceMeters;
    const targetDur = selectedActivity.movingTimeSecs;
    return activities
      .filter((a) => {
        if (a.id === selectedActivity.id) return false;
        if (a.sportCategory !== selectedActivity.sportCategory) return false;
        if (a.environment !== selectedActivity.environment) return false;
        if (targetDist > 1000) {
          return Math.abs(a.distanceMeters - targetDist) / targetDist <= 0.15;
        }
        return Math.abs(a.movingTimeSecs - targetDur) / Math.max(60, targetDur) <= 0.2;
      })
      .slice(0, 8);
  }, [selectedActivity, activities]);

  // Index all Strava Segment Efforts across the athlete's archive by segmentId
  const segmentHistoryBySegmentId = useMemo(() => {
    const map = new Map<
      string,
      {
        segmentId: string;
        name: string;
        sportCategory: 'Cycling' | 'Running';
        distanceMeters: number;
        averageGradePct: number;
        prElapsedTimeSecs: number;
        efforts: {
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
        }[];
      }
    >();

    for (const act of activities) {
      if (!Array.isArray(act.segmentEfforts) || act.segmentEfforts.length === 0) continue;
      for (const eff of act.segmentEfforts) {
        if (!eff || !(eff.elapsedTimeSecs > 0)) continue;
        const sid = String(eff.segmentId || eff.name);
        const existing = map.get(sid);
        const entry = {
          effortId: eff.id,
          activityId: act.id,
          activityName: act.name,
          date: (eff.startDateLocal || act.startDateLocal).slice(0, 10),
          startDateLocal: eff.startDateLocal || act.startDateLocal,
          elapsedTimeSecs: eff.elapsedTimeSecs,
          avgWatts: eff.avgWatts,
          avgPaceSecsPerKm:
            eff.avgPaceSecsPerKm ||
            (act.sportCategory === 'Running' && eff.distanceMeters > 0
              ? Math.round(eff.elapsedTimeSecs / (eff.distanceMeters / 1000))
              : undefined),
          avgHr: eff.avgHr || (act.avgHr > 0 ? act.avgHr : undefined),
          prRank: eff.prRank,
        };
        if (!existing) {
          map.set(sid, {
            segmentId: sid,
            name: eff.name,
            sportCategory: act.sportCategory === 'Running' ? 'Running' : 'Cycling',
            distanceMeters: eff.distanceMeters,
            averageGradePct: eff.averageGradePct,
            prElapsedTimeSecs: eff.elapsedTimeSecs,
            efforts: [entry],
          });
        } else {
          existing.efforts.push(entry);
          if (eff.elapsedTimeSecs < existing.prElapsedTimeSecs) {
            existing.prElapsedTimeSecs = eff.elapsedTimeSecs;
          }
          if (eff.averageGradePct && !existing.averageGradePct) {
            existing.averageGradePct = eff.averageGradePct;
          }
        }
      }
    }

    for (const seg of map.values()) {
      // Rank fastest 3 efforts
      const bySpeed = [...seg.efforts].sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
      bySpeed.forEach((e, idx) => {
        e.prRank = idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null;
      });
      // Sort chronologically by date ascending for time-series progression chart
      seg.efforts.sort(
        (a, b) => new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
      );
    }

    return map;
  }, [activities]);

  // Whenever selectedActivity changes or its segmentEfforts load, auto-select the most-repeated segment on this activity
  useEffect(() => {
    if (!selectedActivity?.segmentEfforts || selectedActivity.segmentEfforts.length === 0) {
      setModalSelectedSegmentId(null);
      return;
    }
    const repeatedOnAct = selectedActivity.segmentEfforts
      .map((eff) => segmentHistoryBySegmentId.get(String(eff.segmentId || eff.name)))
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.efforts.length >= 2))
      .sort((a, b) => b.efforts.length - a.efforts.length);

    if (repeatedOnAct.length > 0) {
      setModalSelectedSegmentId((prev) =>
        prev && repeatedOnAct.some((r) => r.segmentId === prev)
          ? prev
          : repeatedOnAct[0].segmentId
      );
    } else {
      setModalSelectedSegmentId(null);
    }
    setModalSegmentHoverIdx(null);
  }, [selectedActivity?.id, selectedActivity?.segmentEfforts, segmentHistoryBySegmentId]);

  // Reset stream zoom range and brush state when switching selectedActivity
  useEffect(() => {
    setStreamZoomRange(null);
    setStreamBrushStartIdx(null);
    setStreamBrushEndIdx(null);
    setStreamHoverIndex(null);
  }, [selectedActivity?.id]);

  // Helper to zoom stream chart to a specific elapsed time window [startSecs, endSecs]
  const zoomStreamToTimeWindow = (startSecs: number, endSecs: number) => {
    const timeArr = selectedActivity?.streams?.time;
    if (!timeArr || timeArr.length < 2) return;
    let sIdx = 0;
    let eIdx = timeArr.length - 1;
    for (let i = 0; i < timeArr.length; i++) {
      if (timeArr[i] <= startSecs) sIdx = i;
      if (timeArr[i] <= endSecs) eIdx = i;
    }
    if (eIdx - sIdx < 3) {
      eIdx = Math.min(timeArr.length - 1, sIdx + 4);
      sIdx = Math.max(0, eIdx - 4);
    }
    setStreamZoomRange([sIdx, eIdx]);
    setStreamBrushStartIdx(null);
    setStreamBrushEndIdx(null);
  };

  // Helper to locate Peak N-second window in the stream and zoom directly to it
  const zoomStreamToPeakDuration = (windowSecs: number) => {
    const streams = selectedActivity?.streams;
    if (!streams || !streams.time || streams.time.length < 4) return;
    const timeArr = streams.time;
    const valArr =
      streams.watts && streams.watts.length > 0
        ? streams.watts
        : streams.velocitySmooth && streams.velocitySmooth.length > 0
          ? streams.velocitySmooth.map((v) => v * 80)
          : streams.heartrate || [];
    if (valArr.length === 0) return;

    let bestStart = 0;
    let bestEnd = Math.min(timeArr.length - 1, 6);
    let bestMean = -1;

    for (let i = 0; i < timeArr.length; i++) {
      const targetEndSecs = timeArr[i] + windowSecs;
      let j = i;
      let sum = 0;
      let count = 0;
      while (j < timeArr.length && timeArr[j] <= targetEndSecs) {
        if (valArr[j] != null && !Number.isNaN(valArr[j])) {
          sum += valArr[j];
          count++;
        }
        j++;
      }
      if (j - 1 > i && count >= 2 && timeArr[j - 1] - timeArr[i] >= windowSecs * 0.65) {
        const mean = sum / count;
        if (mean > bestMean) {
          bestMean = mean;
          bestStart = i;
          bestEnd = j - 1;
        }
      }
    }

    // Add a small 15% context pad around the peak effort so the lead-in and recovery are visible
    const span = Math.max(4, bestEnd - bestStart);
    const pad = Math.max(2, Math.round(span * 0.15));
    const paddedStart = Math.max(0, bestStart - pad);
    const paddedEnd = Math.min(timeArr.length - 1, bestEnd + pad);
    setStreamZoomRange([paddedStart, paddedEnd]);
    setStreamBrushStartIdx(null);
    setStreamBrushEndIdx(null);
  };

  // Compute aligned 100-step overlaid comparison data for Workout A and Workout B
  const overlaidComparisonData = useMemo(() => {
    if (!compareActivityA || !compareActivityB) return null;
    const win = smoothStreams ? 5 : 1;
    const seriesA = extractActivitySeries(compareActivityA, win);
    const seriesB = extractActivitySeries(compareActivityB, win);

    const maxDurationSecs = Math.max(
      compareActivityA.movingTimeSecs || 1,
      compareActivityB.movingTimeSecs || 1,
      seriesA.points[seriesA.points.length - 1]?.timeSecs || 1,
      seriesB.points[seriesB.points.length - 1]?.timeSecs || 1
    );

    const stepsCount = 100;
    const alignedSteps = Array.from({ length: stepsCount }, (_, idx) => {
      const frac = idx / (stepsCount - 1);
      const xVal = compareXMode === 'PERCENT' ? frac * 100 : Math.round(frac * maxDurationSecs);
      const ptA = sampleSeriesAt(seriesA.points, compareXMode, xVal);
      const ptB = sampleSeriesAt(seriesB.points, compareXMode, xVal);
      return {
        stepIndex: idx,
        frac,
        xLabel:
          compareXMode === 'PERCENT'
            ? `${Math.round(frac * 100)}%`
            : formatStopwatch(Math.round(frac * maxDurationSecs)),
        timeSecsA: ptA?.timeSecs,
        timeSecsB: ptB?.timeSecs,
        powerA: ptA?.power,
        powerB: ptB?.power,
        hrA: ptA?.hr,
        hrB: ptB?.hr,
        cadenceA: ptA?.cadence,
        cadenceB: ptB?.cadence,
      };
    });

    const allPowers = alignedSteps
      .flatMap((s) => [s.powerA, s.powerB])
      .filter((v): v is number => v !== undefined && v > 0);
    const maxPower = Math.max(320, ...allPowers, 100);

    const allHrs = alignedSteps
      .flatMap((s) => [s.hrA, s.hrB])
      .filter((v): v is number => v !== undefined && v > 0);
    const minHr = allHrs.length > 0 ? Math.max(60, Math.min(...allHrs) - 10) : 85;
    const maxHr = allHrs.length > 0 ? Math.max(175, Math.max(...allHrs) + 8) : 195;

    return {
      alignedSteps,
      maxDurationSecs,
      maxPower,
      minHr,
      maxHr,
      isRealStreamA: seriesA.isRealStream,
      isRealStreamB: seriesB.isRealStream,
    };
  }, [compareActivityA, compareActivityB, compareXMode, smoothStreams]);

  return (
    <div className="space-y-6">
      {/* Filter & All-Time Archive Summary Header Card */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              All-Time Activity Explorer, Split-View Workout Comparator &amp; Interval Splits
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Browse all {activities.length.toLocaleString()} historical workouts, inspect auto-detected intervals, or launch Split-View Mode to overlay power &amp; heart rate streams from any two workouts
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Strava Kudos Feed & Interactive Map Toggle Button */}
            <button
              type="button"
              onClick={() => setIsKudosMapOpen((prev) => !prev)}
              className={`min-h-[38px] inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                isKudosMapOpen
                  ? 'bg-[#FC4C02] text-white shadow-xs'
                  : 'border border-[#FC4C02]/40 bg-[#FC4C02]/10 text-[#FC4C02] hover:bg-[#FC4C02]/20'
              }`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>
                {isKudosMapOpen
                  ? 'Hide Strava Kudos & Route Map'
                  : 'Strava Kudos Feed & Route Map'}
              </span>
            </button>

            {/* Split-View Compare Mode Toggle Button */}
            <button
              type="button"
              onClick={handleToggleSplitView}
              className={`min-h-[38px] inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                isSplitCompareOpen
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'border border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
              }`}
            >
              <Columns2 className="w-4 h-4" />
              <span>
                {isSplitCompareOpen
                  ? 'Exit Split-View Comparison'
                  : 'Split-View Compare (2 Workouts)'}
              </span>
            </button>

            {/* Year Selector */}
            <select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setVisibleLimit(60);
              }}
              className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Years ({activities.length})</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y} Season
                </option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search workout, track, bike, shoe..."
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-9 pr-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Sport + Outdoor/Indoor Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(['ALL', 'Cycling', 'Running', 'Swimming', 'Strength'] as const).map((sport) => (
              <button
                key={sport}
                onClick={() => onSelectSport(sport)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  selectedSport === sport
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {sport === 'ALL' ? 'All Sports' : sport}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'COMBINED', label: 'Combined (All)' },
                { id: 'OUTDOOR', label: 'Outdoor Only' },
                { id: 'INDOOR', label: 'Indoor (Trainer / Treadmill)' },
              ] as const
            ).map((env) => (
              <button
                key={env.id}
                onClick={() => onSelectEnvFilter(env.id)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  envFilter === env.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtered Rollup Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs font-mono tabular-nums">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Matched Workouts</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {filteredActivities.length.toLocaleString()}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Total Distance</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatDistance(summaryStats.totalDistanceMeters, distanceUnit, 1)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Moving Duration</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100">
              {formatDuration(summaryStats.totalDurationSecs)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Cumulative Load</span>
            <span className="text-base font-bold text-blue-600 dark:text-blue-400">
              {summaryStats.totalLoad.toLocaleString()} TSS
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
            <span className="text-slate-500 block font-sans">Avg Efficiency (EF)</span>
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
              {summaryStats.avgEf}
            </span>
          </div>
        </div>
      </section>

      {/* ==========================================================================
          STRAVA KUDOS FEED & INTERACTIVE GPS ROUTE MAP EXPLORER
         ========================================================================== */}
      {isKudosMapOpen && (
        <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
          {(() => {
            const totalKudosEarned = filteredActivities.reduce(
              (acc, a) => acc + (a.kudosCount || 0),
              0
            );
            const totalPrAchievements = filteredActivities.reduce(
              (acc, a) => acc + (a.stravaPrCount || 0),
              0
            );
            const mappedActivitiesCount = filteredActivities.filter(
              (a) =>
                (Array.isArray(a.routeLatLngs) && a.routeLatLngs.length > 2) ||
                (a.streams?.latlng && a.streams.latlng.length > 2)
            ).length;

            const feedActivities = filteredActivities
              .filter((act) => {
                if (kudosFeedFilter === 'WITH_KUDOS') {
                  return (act.kudosCount || 0) > 0 || Boolean(act.hasKudoed);
                }
                if (kudosFeedFilter === 'PR_HUNTS') {
                  return (
                    (act.stravaPrCount || 0) > 0 ||
                    Boolean(
                      act.segmentEfforts &&
                        act.segmentEfforts.some(
                          (e) => e.prRank === 1 || e.prRank === 2 || e.prRank === 3
                        )
                    )
                  );
                }
                if (kudosFeedFilter === 'WITH_GPS') {
                  return (
                    (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                    Boolean(act.streams?.latlng && act.streams.latlng.length > 2) ||
                    act.environment === 'OUTDOOR'
                  );
                }
                return true;
              })
              .slice(0, 18);

            return (
              <>
                {/* Top Header & Kudos Rollup Strip */}
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#FC4C02] text-white">
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </span>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        Strava Kudos Feed &amp; Interactive GPS Route Map Explorer
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Explore outdoor GPS tracks on the interactive map, inspect Strava Kudos &amp; segment PR crowns, give kudos, or click any route to launch the full telemetry &amp; route scrubber
                    </p>
                  </div>

                  {/* Kudos & Route Rollup Pills + Feed Filter */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
                      <span className="text-[#FC4C02] font-bold">
                        👍 {totalKudosEarned.toLocaleString()} Kudos
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        🏆 {totalPrAchievements.toLocaleString()} PRs
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">|</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        🗺️ {mappedActivitiesCount} GPS Routes
                      </span>
                    </div>

                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                      {(
                        [
                          { id: 'ALL', label: 'All Recent' },
                          { id: 'WITH_KUDOS', label: 'Most Kudoed' },
                          { id: 'PR_HUNTS', label: 'Segment PRs' },
                          { id: 'WITH_GPS', label: 'Outdoor GPS' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setKudosFeedFilter(tab.id)}
                          className={`min-h-[28px] px-2.5 py-0.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                            kudosFeedFilter === tab.id
                              ? 'bg-[#FC4C02] text-white'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 12-Column Split: Left 7 Cols Interactive Multi-Route Map, Right 5 Cols Strava Kudos Feed */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left 7 Columns: Interactive Multi-Workout GPS Route Map */}
                  <div className="lg:col-span-7 space-y-2">
                    <InteractiveRouteMap
                      mode="MULTI"
                      activities={filteredActivities}
                      distanceUnit={distanceUnit}
                      highlightedActivityId={hoveredRouteActivityId}
                      onHoverActivity={setHoveredRouteActivityId}
                      onSelectActivity={(act) => {
                        onSelectActivity(act);
                        setStreamHoverIndex(null);
                      }}
                      heightClass="h-[460px] sm:h-[540px]"
                    />
                    {onHydrateMoreRoutes && (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-xs text-slate-500">
                          Want more historical outdoor routes plotted on the map?
                        </span>
                        <button
                          type="button"
                          onClick={onHydrateMoreRoutes}
                          disabled={isHydratingRoutes}
                          className="min-h-[30px] px-3 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors whitespace-nowrap"
                        >
                          {isHydratingRoutes
                            ? 'Loading +40 GPS Tracks...'
                            : 'Load +40 More Historical GPS Routes'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right 5 Columns: Strava Kudos & Activity Social Feed */}
                  <div className="lg:col-span-5 space-y-3 max-h-[580px] overflow-y-auto pr-1">
                    {feedActivities.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                        No workouts match the selected Kudos Feed filter. Switch back to &quot;All Recent&quot; to browse all workouts.
                      </div>
                    ) : (
                      feedActivities.map((act) => {
                        const hasGps =
                          (Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                          Boolean(act.streams?.latlng && act.streams.latlng.length > 2);
                        const isHovered = hoveredRouteActivityId === act.id;
                        const kudoers = act.kudoers || [];
                        const comments = act.comments || [];
                        const kudosTotal = Math.max(act.kudosCount || 0, kudoers.length);
                        const topSegments = (act.segmentEfforts || []).slice(0, 3);
                        const commentDraft = commentDrafts[act.id] || '';

                        return (
                          <div
                            key={act.id}
                            onMouseEnter={() => setHoveredRouteActivityId(act.id)}
                            onMouseLeave={() =>
                              setHoveredRouteActivityId((curr) => (curr === act.id ? null : curr))
                            }
                            className={`rounded-xl border p-4 space-y-3 transition-all ${
                              isHovered
                                ? 'border-[#FC4C02] bg-[#FC4C02]/5 shadow-md'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {/* Card Header: Sport Badge, Workout Name, Date, Strava External Link */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-500">
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-sans font-bold text-[10px] uppercase ${
                                      act.sportCategory === 'Running'
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                        : 'bg-[#FC4C02]/15 text-[#FC4C02]'
                                    }`}
                                  >
                                    {act.sportCategory}
                                  </span>
                                  <span>{act.startDateLocal.slice(0, 10)}</span>
                                  <span>·</span>
                                  <span>{act.gearName || act.subType}</span>
                                  {hasGps && (
                                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      <MapPin className="w-3 h-3" />
                                      GPS
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="text-left text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-[#FC4C02] dark:hover:text-[#FC4C02] transition-colors mt-0.5 line-clamp-1"
                                >
                                  {act.name}
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {act.stravaId && (
                                  <a
                                    href={`https://www.strava.com/activities/${encodeURIComponent(
                                      act.stravaId
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#FC4C02]/40 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 text-[11px] font-semibold text-[#FC4C02] transition-colors whitespace-nowrap"
                                    title="Open activity on Strava.com"
                                  >
                                    <span>Strava</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onSelectActivity(act)}
                                  className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                                >
                                  Inspect Map &amp; Streams
                                </button>
                              </div>
                            </div>

                            {/* Key Workout Telemetry Strip */}
                            <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-800">
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">Distance</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : 'Indoor'}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">Duration</div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  {formatDuration(act.movingTimeSecs)}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">
                                  {act.sportCategory === 'Running' ? 'Avg Pace' : 'NP / Watts'}
                                </div>
                                <div className="font-bold text-blue-600 dark:text-blue-400">
                                  {act.sportCategory === 'Running' && act.avgPaceSecsPerKm
                                    ? formatPace(act.avgPaceSecsPerKm, distanceUnit)
                                    : act.normalizedPower
                                      ? `${act.normalizedPower}W`
                                      : act.avgPower
                                        ? `${act.avgPower}W`
                                        : `${act.trainingLoad} TSS`}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-sans text-slate-500">
                                  Elev / HR
                                </div>
                                <div className="font-bold text-slate-900 dark:text-slate-100">
                                  +{act.elevationGainMeters}m
                                  {act.avgHr > 0 ? ` · ${act.avgHr}bpm` : ''}
                                </div>
                              </div>
                            </div>

                            {/* Strava Segment PR Trophy Case (if segments or PRs exist) */}
                            {(act.stravaPrCount > 0 || topSegments.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {act.stravaPrCount > 0 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[11px] font-bold">
                                    <Trophy className="w-3 h-3" />
                                    {act.stravaPrCount} Strava PR{act.stravaPrCount > 1 ? 's' : ''}
                                  </span>
                                )}
                                {topSegments.map((seg) => (
                                  <button
                                    key={seg.id}
                                    type="button"
                                    onClick={() => onSelectActivity(act)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-blue-500/15 text-[11px] font-mono text-slate-700 dark:text-slate-300 transition-colors"
                                  >
                                    {seg.prRank === 1 && (
                                      <span className="text-amber-500 font-bold">👑</span>
                                    )}
                                    <span className="truncate max-w-[130px] font-sans font-medium">
                                      {seg.name}
                                    </span>
                                    <span className="text-slate-500">
                                      {formatStopwatch(seg.elapsedTimeSecs)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Kudos Action Bar & Kudoer Avatar Pills */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onToggleKudos && onToggleKudos(act)}
                                  className={`min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                    act.hasKudoed
                                      ? 'bg-[#FC4C02] text-white shadow-xs'
                                      : 'border border-[#FC4C02]/40 bg-[#FC4C02]/10 text-[#FC4C02] hover:bg-[#FC4C02]/20'
                                  }`}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                  <span>
                                    {act.hasKudoed ? 'Kudoed' : 'Give Kudos'} ({kudosTotal})
                                  </span>
                                </button>

                                {/* Kudoer Avatar Initials Pills */}
                                {kudoers.slice(0, 4).map((k, kIdx) => {
                                  const dispName =
                                    k.name ||
                                    `${k.firstname || ''} ${k.lastname || ''}`.trim() ||
                                    'Athlete';
                                  const dispInitials =
                                    k.avatarInitials ||
                                    dispName
                                      .split(' ')
                                      .map((p) => p[0] || '')
                                      .join('')
                                      .slice(0, 2)
                                      .toUpperCase();
                                  const dispLoc =
                                    k.location || [k.city, k.state].filter(Boolean).join(', ');
                                  return (
                                    <span
                                      key={k.id || `${dispName}-${kIdx}`}
                                      title={`${dispName}${dispLoc ? ` (${dispLoc})` : ''}`}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                                    >
                                      <span className="w-4 h-4 rounded-full bg-[#FC4C02]/20 text-[#FC4C02] font-mono text-[9px] font-bold flex items-center justify-center">
                                        {dispInitials}
                                      </span>
                                      <span className="truncate max-w-[90px]">{dispName}</span>
                                    </span>
                                  );
                                })}
                              </div>

                              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                                <MessageSquare className="w-3 h-3" />
                                {comments.length} {comments.length === 1 ? 'note' : 'notes'}
                              </span>
                            </div>

                            {/* Activity Comments / Coaching Notes + Inline Quick Note Input */}
                            {comments.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {comments.slice(-2).map((c) => (
                                  <div
                                    key={c.id}
                                    className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 px-2.5 py-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                                      <span className="font-bold text-slate-800 dark:text-slate-200">
                                        {c.authorName || c.athleteName || 'Athlete'}
                                      </span>
                                      <span className="font-mono">
                                        {c.createdAt.slice(0, 10)}
                                      </span>
                                    </div>
                                    <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                                      {c.text}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {onAddComment && (
                              <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!commentDraft.trim()) return;
                                  const text = commentDraft.trim();
                                  setCommentDrafts((prev) => ({ ...prev, [act.id]: '' }));
                                  await onAddComment(act, text);
                                }}
                                className="flex items-center gap-1.5 pt-1"
                              >
                                <input
                                  type="text"
                                  value={commentDraft}
                                  onChange={(e) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [act.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Add workout note or Strava club comment..."
                                  className="flex-1 min-h-[30px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100"
                                />
                                <button
                                  type="submit"
                                  disabled={!commentDraft.trim()}
                                  className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-[#FC4C02] disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1"
                                >
                                  <Send className="w-3 h-3" />
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* ==========================================================================
          SPLIT-VIEW SIDE-BY-SIDE WORKOUT COMPARISON WORKSPACE
         ========================================================================== */}
      {isSplitCompareOpen && (
        <section className="rounded-xl bg-white dark:bg-[#111827] border-2 border-blue-500/40 shadow-lg p-5 space-y-6">
          {/* Top Bar: Title, Alignment Controls, Smoothing Toggle & Close */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Columns2 className="w-4 h-4 text-blue-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Split-View Workout Comparator — Overlaid Power &amp; Heart Rate Telemetry
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Select any two workouts from the dropdowns below or click the <strong>A</strong> / <strong>B</strong> buttons on any row in the activity table below
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* X-Axis Alignment Mode */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setCompareXMode('PERCENT')}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    compareXMode === 'PERCENT'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Align by % Completion (0–100%)
                </button>
                <button
                  type="button"
                  onClick={() => setCompareXMode('TIME')}
                  className={`min-h-[30px] px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    compareXMode === 'TIME'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Align by Elapsed Time (mm:ss)
                </button>
              </div>

              {/* Rolling Smoothing Toggle */}
              <button
                type="button"
                onClick={() => setSmoothStreams((prev) => !prev)}
                className={`min-h-[34px] px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                  smoothStreams
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {smoothStreams ? 'Smoothed Rolling Trace' : 'Raw 1s Stream'}
              </button>

              <button
                type="button"
                onClick={() => setIsSplitCompareOpen(false)}
                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Close Split-View
              </button>
            </div>
          </div>

          {/* Side-by-Side Workout A & Workout B Selector Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Workout A Card (Blue) */}
            <div className="lg:col-span-5 rounded-xl bg-blue-500/5 border border-blue-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  Workout A (Baseline · Blue)
                </span>
                {compareActivityA && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityA.startDateLocal.slice(0, 10)} · {compareActivityA.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdA || ''}
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'A');
                }}
                className="w-full min-h-[38px] rounded-lg border border-blue-500/30 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout A...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityA ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.distanceMeters > 0
                        ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDuration(compareActivityA.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                      {compareActivityA.normalizedPower
                        ? `NP ${compareActivityA.normalizedPower}W`
                        : compareActivityA.avgPaceSecsPerKm
                          ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityA.trainingLoad} TSS`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg {compareActivityA.avgPower ? `${compareActivityA.avgPower}W` : '—'} · EF{' '}
                      {compareActivityA.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.avgHr > 0 ? `${compareActivityA.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Max {compareActivityA.maxHr || '—'} · Drift{' '}
                      {compareActivityA.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a workout above or click <strong>A</strong> on any row in the table.
                </div>
              )}
            </div>

            {/* Center Swap & Auto-Match Repeat Controls */}
            <div className="lg:col-span-2 flex flex-row lg:flex-col items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const temp = compareIdA;
                  setCompareIdA(compareIdB);
                  setCompareIdB(temp);
                }}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                <span>Swap A ↔ B</span>
              </button>
              <button
                type="button"
                onClick={handleAutoMatchRepeatForA}
                disabled={!compareActivityA}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors"
                title="Automatically find a similar distance/duration repeat workout for Slot B"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Match Repeat</span>
              </button>
            </div>

            {/* Workout B Card (Amber) */}
            <div className="lg:col-span-5 rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                  Workout B (Comparison · Amber)
                </span>
                {compareActivityB && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityB.startDateLocal.slice(0, 10)} · {compareActivityB.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdB || ''}
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'B');
                }}
                className="w-full min-h-[38px] rounded-lg border border-amber-500/30 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout B...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityB ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.distanceMeters > 0
                        ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDuration(compareActivityB.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {compareActivityB.normalizedPower
                        ? `NP ${compareActivityB.normalizedPower}W`
                        : compareActivityB.avgPaceSecsPerKm
                          ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityB.trainingLoad} TSS`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Avg {compareActivityB.avgPower ? `${compareActivityB.avgPower}W` : '—'} · EF{' '}
                      {compareActivityB.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.avgHr > 0 ? `${compareActivityB.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Max {compareActivityB.maxHr || '—'} · Drift{' '}
                      {compareActivityB.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a second workout above or click <strong>B</strong> on any row in the table.
                </div>
              )}
            </div>
          </div>

          {/* Overlaid Power & Heart Rate Charts + Head-to-Head Delta Analysis */}
          {compareActivityA && compareActivityB && overlaidComparisonData && (
            <div className="space-y-5">
              {/* 1. OVERLAID POWER / OUTPUT COMPARISON CHART */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Power / Output Profile —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} ({compareActivityA.startDateLocal.slice(0, 10)})
                      </span>{' '}
                      vs{' '}
                      <span className="text-amber-600 dark:text-amber-400">
                        B: {compareActivityB.name} ({compareActivityB.startDateLocal.slice(0, 10)})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Power / Equivalent Output (Watts) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Power */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerA}W`
                          : '—'}
                      </span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        B:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerB}W`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].powerB !==
                          undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB!}
                            W
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg:{' '}
                        {compareActivityA.avgPower || compareActivityA.normalizedPower || '—'}W
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                        <span className="w-3 h-0.5 bg-amber-500 inline-block" />B Avg:{' '}
                        {compareActivityB.avgPower || compareActivityB.normalizedPower || '—'}W
                      </span>
                    </div>
                  )}
                </div>

                <svg
                  viewBox="0 0 860 205"
                  className="w-full h-52 select-none"
                  onMouseLeave={() => setCompareHoverStep(null)}
                >
                  {(() => {
                    const { alignedSteps, maxPower } = overlaidComparisonData;
                    const len = alignedSteps.length;
                    const chartLeft = 62;
                    const chartRight = 830;
                    const chartW = chartRight - chartLeft;
                    const chartTop = 16;
                    const chartBottom = 156;
                    const chartH = chartBottom - chartTop;

                    const pointsA = alignedSteps
                      .filter((s) => s.powerA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerA! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsB = alignedSteps
                      .filter((s) => s.powerB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerB! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        <text
                          x={16}
                          y={86}
                          transform="rotate(-90 16 86)"
                          textAnchor="middle"
                          className="fill-blue-500 text-xs font-sans font-bold"
                        >
                          Power / Output (Watts)
                        </text>

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const wVal = Math.round(f * maxPower);
                          return (
                            <g key={idx}>
                              <line
                                x1={chartLeft}
                                y1={y}
                                x2={chartRight}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={chartLeft - 8}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                              >
                                {wVal}W
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Power Trace (Amber) */}
                        {pointsB && (
                          <polyline
                            fill="none"
                            stroke="#F59E0B"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsB}
                          />
                        )}

                        {/* Workout A Power Trace (Blue) */}
                        {pointsA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={174}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={196}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Normalized Workout Progress (% of Total Duration)'
                            : 'Elapsed Workout Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.powerA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerA / maxPower) * chartH)
                                )
                              : null;
                          const yB =
                            s.powerB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerB / maxPower) * chartH)
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F59E0B"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* 2. OVERLAID HEART RATE COMPARISON CHART (Synchronized Crosshair) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Heart Rate Response —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} (Avg {compareActivityA.avgHr || '—'} bpm)
                      </span>{' '}
                      vs{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        B: {compareActivityB.name} (Avg {compareActivityB.avgHr || '—'} bpm)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Heart Rate (bpm) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Heart Rate */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrA} bpm`
                          : '—'}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-bold">
                        B HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrB} bpm`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].hrB! <=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB! >
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB!}{' '}
                            bpm
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg/Max:{' '}
                        {compareActivityA.avgHr || '—'}/{compareActivityA.maxHr || '—'} bpm
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold">
                        <span className="w-3 h-0.5 bg-rose-500 inline-block" />B Avg/Max:{' '}
                        {compareActivityB.avgHr || '—'}/{compareActivityB.maxHr || '—'} bpm
                      </span>
                    </div>
                  )}
                </div>

                <svg
                  viewBox="0 0 860 205"
                  className="w-full h-52 select-none"
                  onMouseLeave={() => setCompareHoverStep(null)}
                >
                  {(() => {
                    const { alignedSteps, minHr, maxHr } = overlaidComparisonData;
                    const len = alignedSteps.length;
                    const chartLeft = 62;
                    const chartRight = 830;
                    const chartW = chartRight - chartLeft;
                    const chartTop = 16;
                    const chartBottom = 156;
                    const chartH = chartBottom - chartTop;
                    const hrSpan = Math.max(20, maxHr - minHr);

                    const pointsHrA = alignedSteps
                      .filter((s) => s.hrA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrA! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsHrB = alignedSteps
                      .filter((s) => s.hrB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrB! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        <text
                          x={16}
                          y={86}
                          transform="rotate(-90 16 86)"
                          textAnchor="middle"
                          className="fill-rose-500 text-xs font-sans font-bold"
                        >
                          Heart Rate (bpm)
                        </text>

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const hrVal = Math.round(minHr + f * hrSpan);
                          return (
                            <g key={idx}>
                              <line
                                x1={chartLeft}
                                y1={y}
                                x2={chartRight}
                                y2={y}
                                stroke="currentColor"
                                className="text-slate-200 dark:text-slate-800"
                                strokeDasharray="3 3"
                              />
                              <text
                                x={chartLeft - 8}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                              >
                                {hrVal}
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Heart Rate Trace (Rose/Red) */}
                        {pointsHrB && (
                          <polyline
                            fill="none"
                            stroke="#F43F5E"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsHrB}
                          />
                        )}

                        {/* Workout A Heart Rate Trace (Blue) */}
                        {pointsHrA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsHrA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={174}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={196}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Normalized Workout Progress (% of Total Duration)'
                            : 'Elapsed Workout Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.hrA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrA - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          const yB =
                            s.hrB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrB - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F43F5E"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>

              {/* 3. SIDE-BY-SIDE METRIC DELTA TABLE & DUAL HEART RATE ZONE COMPARISON */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left: Head-to-Head Physiological Metrics Table */}
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Head-to-Head Physiological Telemetry Deltas (A vs B)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Δ = Workout A − Workout B
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-sans text-slate-500">
                          <th className="py-2 pr-3">Metric</th>
                          <th className="py-2 px-3 text-right text-blue-600 dark:text-blue-400">
                            Workout A ({compareActivityA.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 px-3 text-right text-amber-600 dark:text-amber-400">
                            Workout B ({compareActivityB.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 pl-3 text-right">Delta (A − B)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {(() => {
                          const npA = compareActivityA.normalizedPower || compareActivityA.avgPower || 0;
                          const npB = compareActivityB.normalizedPower || compareActivityB.avgPower || 0;
                          const efA = compareActivityA.efficiencyFactor || 0;
                          const efB = compareActivityB.efficiencyFactor || 0;
                          const hrA = compareActivityA.avgHr || 0;
                          const hrB = compareActivityB.avgHr || 0;
                          const driftA = compareActivityA.aerobicDecouplingPct || 0;
                          const driftB = compareActivityB.aerobicDecouplingPct || 0;

                          const rows = [
                            {
                              label: 'Distance',
                              valA:
                                compareActivityA.distanceMeters > 0
                                  ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                                  : '—',
                              valB:
                                compareActivityB.distanceMeters > 0
                                  ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                                  : '—',
                              delta:
                                compareActivityA.distanceMeters > 0 &&
                                compareActivityB.distanceMeters > 0
                                  ? `${compareActivityA.distanceMeters >= compareActivityB.distanceMeters ? '+' : '-'}${formatDistance(
                                      Math.abs(
                                        compareActivityA.distanceMeters -
                                          compareActivityB.distanceMeters
                                      ),
                                      distanceUnit,
                                      2
                                    )}`
                                  : '—',
                              good: true,
                            },
                            {
                              label: 'Moving Duration',
                              valA: formatDuration(compareActivityA.movingTimeSecs),
                              valB: formatDuration(compareActivityB.movingTimeSecs),
                              delta: `${compareActivityA.movingTimeSecs >= compareActivityB.movingTimeSecs ? '+' : '-'}${formatDuration(
                                Math.abs(
                                  compareActivityA.movingTimeSecs - compareActivityB.movingTimeSecs
                                )
                              )}`,
                              good: true,
                            },
                            {
                              label: 'Normalized / Avg Power',
                              valA: npA > 0 ? `${npA}W` : '—',
                              valB: npB > 0 ? `${npB}W` : '—',
                              delta:
                                npA > 0 && npB > 0
                                  ? `${npA - npB >= 0 ? '+' : ''}${npA - npB}W`
                                  : '—',
                              good: npA >= npB,
                            },
                            {
                              label: 'Average Pace',
                              valA: compareActivityA.avgPaceSecsPerKm
                                ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              valB: compareActivityB.avgPaceSecsPerKm
                                ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              delta:
                                compareActivityA.avgPaceSecsPerKm &&
                                compareActivityB.avgPaceSecsPerKm
                                  ? `${compareActivityA.avgPaceSecsPerKm - compareActivityB.avgPaceSecsPerKm <= 0 ? '' : '+'}${compareActivityA.avgPaceSecsPerKm - compareActivityB.avgPaceSecsPerKm}s/km`
                                  : '—',
                              good:
                                (compareActivityA.avgPaceSecsPerKm || 0) <=
                                (compareActivityB.avgPaceSecsPerKm || 0),
                            },
                            {
                              label: 'Average Heart Rate',
                              valA: hrA > 0 ? `${hrA} bpm` : '—',
                              valB: hrB > 0 ? `${hrB} bpm` : '—',
                              delta:
                                hrA > 0 && hrB > 0
                                  ? `${hrA - hrB >= 0 ? '+' : ''}${hrA - hrB} bpm`
                                  : '—',
                              good: hrA <= hrB,
                            },
                            {
                              label: 'Efficiency Factor (EF)',
                              valA: efA > 0 ? efA.toFixed(2) : '—',
                              valB: efB > 0 ? efB.toFixed(2) : '—',
                              delta:
                                efA > 0 && efB > 0
                                  ? `${efA - efB >= 0 ? '+' : ''}${(efA - efB).toFixed(2)}`
                                  : '—',
                              good: efA >= efB,
                            },
                            {
                              label: 'Aerobic Decoupling (Drift)',
                              valA: `${driftA}%`,
                              valB: `${driftB}%`,
                              delta: `${driftA - driftB >= 0 ? '+' : ''}${(driftA - driftB).toFixed(1)}%`,
                              good: driftA <= driftB,
                            },
                            {
                              label: 'Training Load (TSS)',
                              valA: `${compareActivityA.trainingLoad} TSS`,
                              valB: `${compareActivityB.trainingLoad} TSS`,
                              delta: `${compareActivityA.trainingLoad - compareActivityB.trainingLoad >= 0 ? '+' : ''}${compareActivityA.trainingLoad - compareActivityB.trainingLoad} TSS`,
                              good: true,
                            },
                          ];

                          return rows.map((r, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-3 font-sans font-medium text-slate-700 dark:text-slate-300">
                                {r.label}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valA}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valB}
                              </td>
                              <td
                                className={`py-2 pl-3 text-right font-bold ${
                                  r.delta === '—'
                                    ? 'text-slate-400'
                                    : r.good
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {r.delta}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right: Side-by-Side Time in Heart Rate Zones (Workout A vs Workout B) */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Side-by-Side HR Zone Distribution (Z1–Z6)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Blue: A · Amber: B
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {['Z1 Rec', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2max', 'Z6 Anaerobic'].map(
                      (zLabel, idx) => {
                        const totA = Math.max(
                          1,
                          compareActivityA.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const totB = Math.max(
                          1,
                          compareActivityB.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const secsA = compareActivityA.zoneSecs.hr[idx] || 0;
                        const secsB = compareActivityB.zoneSecs.hr[idx] || 0;
                        const pctA = Math.round((secsA / totA) * 100);
                        const pctB = Math.round((secsB / totB) * 100);

                        return (
                          <div key={idx} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between font-mono">
                              <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">
                                {zLabel}
                              </span>
                              <span className="tabular-nums">
                                <strong className="text-blue-600 dark:text-blue-400">
                                  A: {Math.round(secsA / 60)}m ({pctA}%)
                                </strong>
                                {' · '}
                                <strong className="text-amber-600 dark:text-amber-400">
                                  B: {Math.round(secsB / 60)}m ({pctB}%)
                                </strong>
                              </span>
                            </div>
                            <div className="space-y-1">
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctA}%` }}
                                  className="h-full bg-blue-500"
                                />
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctB}%` }}
                                  className="h-full bg-amber-500"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                    <div className="text-center text-[11px] font-semibold text-slate-500 pt-1">
                      Y-Axis: Physiological HR Zone · X-Axis: Share of Workout Time (0% – 100%)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* High-Density Activity Table */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 overflow-hidden">
        {filteredActivities.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No workouts match your current Sport ({selectedSport}), Year ({yearFilter}), and Environment ({envFilter}) filters.
            </p>
            <button
              onClick={() => {
                onSelectSport('ALL');
                onSelectEnvFilter('COMBINED');
                setYearFilter('ALL');
                setSearchQuery('');
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              Reset All Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Date &amp; Session</th>
                  <th className="py-3 px-3">Sport &amp; Environment</th>
                  <th className="py-3 px-3 text-right">Distance / Time</th>
                  <th className="py-3 px-3 text-right">Output (NP / Pace)</th>
                  <th className="py-3 px-3 text-right">HR &amp; Decoupling</th>
                  <th className="py-3 px-3 text-right">Load (TSS)</th>
                  <th className="py-3 px-3 text-center">Split Compare</th>
                  <th className="py-3 px-4 text-right">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredActivities.slice(0, visibleLimit).map((act) => {
                  const isSelected = selectedActivity?.id === act.id;
                  const isCompareA = compareIdA === act.id;
                  const isCompareB = compareIdB === act.id;
                  return (
                    <tr
                      key={act.id}
                      onClick={() => {
                        onSelectActivity(act);
                        setStreamHoverIndex(null);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : isCompareA
                            ? 'bg-blue-500/5'
                            : isCompareB
                              ? 'bg-amber-500/5'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {act.name}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 font-mono text-xs flex flex-wrap items-center gap-1.5">
                          <span>
                            {act.startDateLocal.slice(0, 10)} · {act.gearName || act.deviceName || act.subType}
                          </span>
                          {act.segmentEfforts && act.segmentEfforts.length > 0 && (
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              · {act.segmentEfforts.length} segments
                            </span>
                          )}
                          {act.stravaPrCount > 0 && (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                              · {act.stravaPrCount} PR{act.stravaPrCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {(act.kudosCount || 0) > 0 && (
                            <span className="text-[#FC4C02] font-bold">
                              · 👍 {act.kudosCount}
                            </span>
                          )}
                          {((Array.isArray(act.routeLatLngs) && act.routeLatLngs.length > 2) ||
                            (act.streams?.latlng && act.streams.latlng.length > 2)) && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              · 🗺️ GPS
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">
                        <div className="font-medium text-sm text-slate-900 dark:text-slate-100">{act.sportCategory}</div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {act.environment === 'INDOOR'
                            ? `Indoor · ${act.subType}`
                            : `Outdoor · ${act.subType}`}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {act.distanceMeters > 0
                            ? formatDistance(act.distanceMeters, distanceUnit, 1)
                            : '—'}
                        </div>
                        <div className="text-slate-500 text-xs">
                          {formatDuration(act.movingTimeSecs)} · +{act.elevationGainMeters}m
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {act.sportCategory === 'Running' && act.avgPaceSecsPerKm ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatPace(act.avgPaceSecsPerKm, distanceUnit)}
                            </div>
                            <div className="text-slate-500 text-xs">
                              {act.normalizedPower
                                ? `${act.normalizedPower}W`
                                : `GAP ${formatPace(act.gapPaceSecsPerKm, distanceUnit)}`}
                            </div>
                          </>
                        ) : act.normalizedPower ? (
                          <>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              NP {act.normalizedPower}W
                            </div>
                            <div className="text-slate-500 text-xs">
                              Avg {act.avgPower}W · IF {act.intensityFactor?.toFixed(2) || '—'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <div className="text-slate-900 dark:text-slate-100">
                          {act.avgHr > 0 ? `${act.avgHr} / ${act.maxHr} bpm` : '—'}
                        </div>
                        {act.efficiencyFactor > 0 && (
                          <div className="text-emerald-600 dark:text-emerald-400 text-xs">
                            EF {act.efficiencyFactor} · Drift {act.aerobicDecouplingPct}%
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-blue-600 dark:text-blue-400">
                        {act.trainingLoad}
                      </td>
                      <td
                        className="py-3 px-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleAssignToCompareSlot(act, 'A')}
                            title="Set as Workout A in Split-View Comparison"
                            className={`min-h-[28px] min-w-[28px] px-2 py-0.5 rounded text-xs font-mono font-bold transition-colors ${
                              isCompareA
                                ? 'bg-blue-600 text-white'
                                : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-500 hover:text-blue-500'
                            }`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAssignToCompareSlot(act, 'B')}
                            title="Set as Workout B in Split-View Comparison"
                            className={`min-h-[28px] min-w-[28px] px-2 py-0.5 rounded text-xs font-mono font-bold transition-colors ${
                              isCompareB
                                ? 'bg-amber-500 text-white'
                                : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-amber-500 hover:text-amber-500'
                            }`}
                          >
                            B
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-500">
                        {act.sourceBadges.join(' + ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredActivities.length > visibleLimit && (
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-center">
                <button
                  onClick={() => setVisibleLimit((prev) => prev + 100)}
                  className="min-h-[38px] px-5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors"
                >
                  Load More Workouts ({visibleLimit} of {filteredActivities.length.toLocaleString()} shown)
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Deep Activity Stream, Auto-Detected Intervals & Similar Workout Inspector Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-6">
          <div className="w-full max-w-5xl max-h-[90vh] rounded-t-3xl sm:rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto">
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3" />

            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedActivity.sportCategory} ·{' '}
                  {selectedActivity.environment === 'INDOOR'
                    ? `Indoor (${selectedActivity.subType})`
                    : `Outdoor (${selectedActivity.subType})`}{' '}
                  · {selectedActivity.startDateLocal.replace('T', ' ').slice(0, 16)} ·{' '}
                  {selectedActivity.deviceName || selectedActivity.sourceBadges.join(' + ')}
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {selectedActivity.name}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleAssignToCompareSlot(selectedActivity, 'A');
                    if (similarHistoricalWorkouts.length > 0 && !compareIdB) {
                      handleAssignToCompareSlot(similarHistoricalWorkouts[0], 'B');
                    }
                    onSelectActivity(null);
                  }}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span>Open in Split-View Compare</span>
                </button>
                <button
                  onClick={() => onSelectActivity(null)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Close inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Top Physiological & Aerobic Decoupling Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Distance &amp; Moving Time</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.distanceMeters > 0
                      ? formatDistance(selectedActivity.distanceMeters, distanceUnit, 2)
                      : 'Indoor Session'}{' '}
                    · {formatDuration(selectedActivity.movingTimeSecs)}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Elevation +{selectedActivity.elevationGainMeters} m
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Primary Output</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.sportCategory === 'Running' && selectedActivity.avgPaceSecsPerKm
                      ? `${formatPace(selectedActivity.avgPaceSecsPerKm, distanceUnit)} (GAP ${formatPace(selectedActivity.gapPaceSecsPerKm, distanceUnit)})`
                      : selectedActivity.normalizedPower
                        ? `NP ${selectedActivity.normalizedPower}W (Avg ${selectedActivity.avgPower}W)`
                        : `Load ${selectedActivity.trainingLoad} TSS`}
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Training Load: {selectedActivity.trainingLoad} TSS · IF{' '}
                    {selectedActivity.intensityFactor || '—'}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Aerobic Decoupling &amp; Efficiency</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-1 ${
                      selectedActivity.aerobicDecouplingPct <= 3.5
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    EF {selectedActivity.efficiencyFactor || '—'} · Drift{' '}
                    {selectedActivity.aerobicDecouplingPct}%
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    1st Half EF {selectedActivity.firstHalfEf} → 2nd Half EF{' '}
                    {selectedActivity.secondHalfEf}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Heart Rate &amp; Cadence</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.avgHr} bpm avg · {selectedActivity.maxHr} max
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Cadence: {selectedActivity.avgCadence || '—'}{' '}
                    {selectedActivity.sportCategory === 'Running' ? 'spm' : 'rpm'}
                  </div>
                </div>
              </div>

              {/* Strava Kudos, Club Kudoers & Workout Comments Bar inside Activity Details Modal */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleKudos && onToggleKudos(selectedActivity)}
                      className={`min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedActivity.hasKudoed
                          ? 'bg-[#FC4C02] text-white shadow-xs'
                          : 'border border-[#FC4C02]/40 bg-[#FC4C02]/10 text-[#FC4C02] hover:bg-[#FC4C02]/20'
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>
                        {selectedActivity.hasKudoed ? 'Kudoed on AeroPulse / Strava' : 'Give Kudos'}{' '}
                        (
                        {Math.max(
                          selectedActivity.kudosCount || 0,
                          (selectedActivity.kudoers || []).length
                        )}
                        )
                      </span>
                    </button>

                    {(selectedActivity.kudoers || []).map((k, kIdx) => {
                      const dispName =
                        k.name ||
                        `${k.firstname || ''} ${k.lastname || ''}`.trim() ||
                        'Athlete';
                      const dispInitials =
                        k.avatarInitials ||
                        dispName
                          .split(' ')
                          .map((p) => p[0] || '')
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();
                      return (
                        <span
                          key={k.id || `${dispName}-${kIdx}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          <span className="w-4 h-4 rounded-full bg-[#FC4C02]/20 text-[#FC4C02] font-mono text-[10px] font-bold flex items-center justify-center">
                            {dispInitials}
                          </span>
                          <span>{dispName}</span>
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedActivity.stravaPrCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-bold font-mono">
                        <Trophy className="w-3.5 h-3.5" />
                        {selectedActivity.stravaPrCount} PR
                        {selectedActivity.stravaPrCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {selectedActivity.stravaId && (
                      <a
                        href={`https://www.strava.com/activities/${encodeURIComponent(
                          selectedActivity.stravaId
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FC4C02]/40 bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 text-xs font-semibold text-[#FC4C02] transition-colors"
                      >
                        <span>View on Strava</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Existing Comments + Add Comment Form */}
                {(selectedActivity.comments || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {(selectedActivity.comments || []).map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {c.authorName || c.athleteName || 'Athlete'}
                          </span>
                          <span className="font-mono">{c.createdAt.slice(0, 10)}</span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 mt-0.5">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {onAddComment && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!modalCommentInput.trim()) return;
                      const text = modalCommentInput.trim();
                      setModalCommentInput('');
                      await onAddComment(selectedActivity, text);
                    }}
                    className="flex items-center gap-2 pt-1"
                  >
                    <input
                      type="text"
                      value={modalCommentInput}
                      onChange={(e) => setModalCommentInput(e.target.value)}
                      placeholder="Add a coaching note or Strava comment to this workout..."
                      className="flex-1 min-h-[34px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={!modalCommentInput.trim()}
                      className="min-h-[34px] px-3.5 py-1.5 rounded-lg bg-[#FC4C02] hover:bg-[#E34402] disabled:opacity-40 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Post Note</span>
                    </button>
                  </form>
                )}
              </div>

              {/* Synchronized Interactive GPS Route Map (Outdoor Workouts or Workouts with GPS Coordinates) */}
              {(selectedActivity.environment === 'OUTDOOR' ||
                (Array.isArray(selectedActivity.routeLatLngs) &&
                  selectedActivity.routeLatLngs.length > 2) ||
                Boolean(
                  selectedActivity.streams?.latlng && selectedActivity.streams.latlng.length > 2
                )) && (
                <InteractiveRouteMap
                  mode="SINGLE"
                  activity={selectedActivity}
                  distanceUnit={distanceUnit}
                  activeStreamIndex={streamHoverIndex}
                  onHoverStreamIndex={setStreamHoverIndex}
                  zoomStreamRange={streamZoomRange}
                  selectedSegmentId={modalSelectedSegmentId}
                  onSelectSegmentId={(segId: string) => {
                    setModalSelectedSegmentId(segId);
                    setModalSegmentHoverIdx(null);
                  }}
                  heightClass="h-[340px] sm:h-[400px]"
                />
              )}

              {/* Interactive Zoomable Time-Series Stream Scrubber with Drag-to-Zoom Brush, Interval Presets & Mini-Map */}
              {selectedActivity.streams && selectedActivity.streams.time.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  {(() => {
                    const fullTimeArr = selectedActivity.streams!.time;
                    const totalLen = fullTimeArr.length;
                    const fullHrArr = selectedActivity.streams!.heartrate || [];
                    const fullWattsArr = selectedActivity.streams!.watts;
                    const fullVelArr = selectedActivity.streams!.velocitySmooth;
                    const fullCadArr = selectedActivity.streams!.cadence;
                    const fullPrimaryArr =
                      fullWattsArr || (fullVelArr || []).map((v) => v * 80);

                    const zStart = streamZoomRange
                      ? Math.max(0, Math.min(totalLen - 2, streamZoomRange[0]))
                      : 0;
                    const zEnd = streamZoomRange
                      ? Math.max(zStart + 1, Math.min(totalLen - 1, streamZoomRange[1]))
                      : totalLen - 1;
                    const isZoomed = zStart > 0 || zEnd < totalLen - 1;
                    const visibleCount = Math.max(2, zEnd - zStart + 1);

                    // Active selection or zoomed window metrics
                    const hasActiveBrush =
                      streamBrushStartIdx !== null &&
                      streamBrushEndIdx !== null &&
                      Math.abs(streamBrushEndIdx - streamBrushStartIdx) >= 2;
                    const metricStartIdx = hasActiveBrush
                      ? Math.min(streamBrushStartIdx!, streamBrushEndIdx!)
                      : zStart;
                    const metricEndIdx = hasActiveBrush
                      ? Math.max(streamBrushStartIdx!, streamBrushEndIdx!)
                      : zEnd;

                    const winStartSecs = fullTimeArr[metricStartIdx] || 0;
                    const winEndSecs = fullTimeArr[metricEndIdx] || selectedActivity.movingTimeSecs;
                    const winDurationSecs = Math.max(1, winEndSecs - winStartSecs);

                    const sliceWatts = fullWattsArr
                      ? fullWattsArr
                          .slice(metricStartIdx, metricEndIdx + 1)
                          .filter((v) => v != null && v >= 0)
                      : [];
                    const winAvgWatts =
                      sliceWatts.length > 0
                        ? Math.round(sliceWatts.reduce((a, b) => a + b, 0) / sliceWatts.length)
                        : undefined;
                    const winMaxWatts =
                      sliceWatts.length > 0 ? Math.round(Math.max(...sliceWatts)) : undefined;

                    const sliceVel = fullVelArr
                      ? fullVelArr
                          .slice(metricStartIdx, metricEndIdx + 1)
                          .filter((v) => v != null && v > 0.3)
                      : [];
                    const winAvgPaceSecsKm =
                      sliceVel.length > 0
                        ? Math.round(
                            1000 / (sliceVel.reduce((a, b) => a + b, 0) / sliceVel.length)
                          )
                        : undefined;

                    const sliceHr = fullHrArr
                      .slice(metricStartIdx, metricEndIdx + 1)
                      .filter((v) => v != null && v > 40);
                    const winAvgHr =
                      sliceHr.length > 0
                        ? Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length)
                        : undefined;
                    const winMaxHr =
                      sliceHr.length > 0 ? Math.round(Math.max(...sliceHr)) : undefined;

                    const sliceCad = fullCadArr
                      ? fullCadArr
                          .slice(metricStartIdx, metricEndIdx + 1)
                          .filter((v) => v != null && v > 20)
                      : [];
                    const winAvgCad =
                      sliceCad.length > 0
                        ? Math.round(sliceCad.reduce((a, b) => a + b, 0) / sliceCad.length)
                        : undefined;

                    const handleZoomInBtn = () => {
                      const span = zEnd - zStart;
                      if (span <= 6) return;
                      const center =
                        streamHoverIndex !== null &&
                        streamHoverIndex >= zStart &&
                        streamHoverIndex <= zEnd
                          ? streamHoverIndex
                          : Math.round((zStart + zEnd) / 2);
                      const newHalf = Math.max(3, Math.floor(span * 0.3));
                      let ns = Math.max(0, center - newHalf);
                      let ne = Math.min(totalLen - 1, center + newHalf);
                      if (ne - ns < 6) {
                        ne = Math.min(totalLen - 1, ns + 6);
                      }
                      setStreamZoomRange([ns, ne]);
                    };

                    const handleZoomOutBtn = () => {
                      if (!isZoomed) return;
                      const span = zEnd - zStart;
                      const center = Math.round((zStart + zEnd) / 2);
                      const newHalf = Math.ceil(span * 0.85);
                      const ns = Math.max(0, center - newHalf);
                      const ne = Math.min(totalLen - 1, center + newHalf);
                      if (ns === 0 && ne === totalLen - 1) {
                        setStreamZoomRange(null);
                      } else {
                        setStreamZoomRange([ns, ne]);
                      }
                    };

                    const handlePanBtn = (dir: -1 | 1) => {
                      if (!isZoomed) return;
                      const span = zEnd - zStart;
                      const shift = Math.max(2, Math.round(span * 0.35)) * dir;
                      let ns = zStart + shift;
                      let ne = zEnd + shift;
                      if (ns < 0) {
                        ns = 0;
                        ne = Math.min(totalLen - 1, span);
                      }
                      if (ne > totalLen - 1) {
                        ne = totalLen - 1;
                        ns = Math.max(0, ne - span);
                      }
                      setStreamZoomRange([ns, ne]);
                    };

                    const commitBrushZoom = () => {
                      if (
                        streamBrushStartIdx !== null &&
                        streamBrushEndIdx !== null &&
                        Math.abs(streamBrushEndIdx - streamBrushStartIdx) >= 2
                      ) {
                        const ns = Math.max(
                          0,
                          Math.min(streamBrushStartIdx, streamBrushEndIdx)
                        );
                        const ne = Math.min(
                          totalLen - 1,
                          Math.max(streamBrushStartIdx, streamBrushEndIdx)
                        );
                        setStreamZoomRange([ns, ne]);
                      }
                      setStreamBrushStartIdx(null);
                      setStreamBrushEndIdx(null);
                    };

                    const workIntervals = (selectedActivity.intervals || []).filter(
                      (iv) => iv.type === 'WORK' && iv.durationSecs >= 15
                    );

                    return (
                      <>
                        {/* Top Toolbar: Title, Zoom Controls & Live Hover Readout */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              Second-by-Second Telemetry Stream (Power/Pace · Blue &amp; Heart Rate · Red)
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Click and drag across any section of the chart to zoom in, or use the quick-zoom presets &amp; toolbar below
                            </p>
                          </div>

                          {/* Zoom & Pan Control Buttons */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleZoomInBtn}
                              title="Zoom In (2x)"
                              className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                            >
                              <ZoomIn className="w-3.5 h-3.5 text-blue-500" />
                              <span>Zoom In</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleZoomOutBtn}
                              disabled={!isZoomed}
                              title="Zoom Out"
                              className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                            >
                              <ZoomOut className="w-3.5 h-3.5 text-slate-500" />
                              <span>Zoom Out</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePanBtn(-1)}
                              disabled={!isZoomed || zStart === 0}
                              title="Pan Earlier in Workout"
                              className="min-h-[30px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePanBtn(1)}
                              disabled={!isZoomed || zEnd >= totalLen - 1}
                              title="Pan Later in Workout"
                              className="min-h-[30px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            {isZoomed && (
                              <button
                                type="button"
                                onClick={() => setStreamZoomRange(null)}
                                className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset (100%)</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Quick-Zoom Section Presets (Full Workout, Peak 1m/5m/20m, 1st/2nd Half, Work Intervals) */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[11px] font-semibold text-slate-500 mr-1">
                            Quick Zoom:
                          </span>
                          <button
                            type="button"
                            onClick={() => setStreamZoomRange(null)}
                            className={`min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border transition-colors ${
                              !isZoomed
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            Full Workout
                          </button>
                          <button
                            type="button"
                            onClick={() => zoomStreamToPeakDuration(60)}
                            className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            Peak 1m
                          </button>
                          <button
                            type="button"
                            onClick={() => zoomStreamToPeakDuration(300)}
                            className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            Peak 5m
                          </button>
                          {selectedActivity.movingTimeSecs >= 1500 && (
                            <button
                              type="button"
                              onClick={() => zoomStreamToPeakDuration(1200)}
                              className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            >
                              Peak 20m
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setStreamZoomRange([0, Math.max(2, Math.floor(totalLen / 2))])
                            }
                            className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            1st Half
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setStreamZoomRange([
                                Math.floor(totalLen / 2),
                                totalLen - 1,
                              ])
                            }
                            className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-500/50 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            2nd Half
                          </button>
                          {workIntervals.slice(0, 6).map((iv, idx) => (
                            <button
                              key={iv.id}
                              type="button"
                              onClick={() =>
                                zoomStreamToTimeWindow(
                                  Math.max(0, iv.startTimeSecs - 15),
                                  iv.startTimeSecs + iv.durationSecs + 15
                                )
                              }
                              className="min-h-[26px] px-2.5 py-0.5 rounded-md text-xs font-mono font-medium border border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/15 transition-colors"
                            >
                              Int #{idx + 1} ({formatStopwatch(iv.durationSecs)}
                              {iv.avgWatts ? ` · ${iv.avgWatts}W` : ''})
                            </button>
                          ))}
                        </div>

                        {/* Live Zoomed / Brushed Section Summary + Instantaneous Hover Readout */}
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-mono tabular-nums">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-sans font-bold text-slate-800 dark:text-slate-200">
                              {hasActiveBrush
                                ? 'Selecting Window:'
                                : isZoomed
                                  ? 'Zoomed Section:'
                                  : 'Full Workout Window:'}
                            </span>
                            <span className="text-slate-700 dark:text-slate-300 font-semibold">
                              {formatStopwatch(winStartSecs)} – {formatStopwatch(winEndSecs)} (
                              {formatStopwatch(winDurationSecs)})
                            </span>
                            {winAvgWatts !== undefined && (
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                Avg {winAvgWatts}W ({(winAvgWatts / athleteWeightKg).toFixed(2)}{' '}
                                W/kg) · Peak {winMaxWatts}W
                              </span>
                            )}
                            {winAvgPaceSecsKm !== undefined && !winAvgWatts && (
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                Avg Pace: {formatPace(winAvgPaceSecsKm, distanceUnit)}
                              </span>
                            )}
                            {winAvgHr !== undefined && (
                              <span className="text-red-500 font-bold">
                                Avg HR {winAvgHr} bpm · Max {winMaxHr} bpm
                              </span>
                            )}
                            {winAvgCad !== undefined && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                Avg Cadence {winAvgCad}
                              </span>
                            )}
                          </div>

                          {streamHoverIndex !== null && fullTimeArr[streamHoverIndex] !== undefined && (
                            <div className="flex flex-wrap items-center gap-2.5 border-l border-slate-300 dark:border-slate-700 pl-3">
                              <span className="text-slate-500 font-semibold">
                                Cursor @ {formatStopwatch(fullTimeArr[streamHoverIndex] || 0)}:
                              </span>
                              {fullWattsArr && fullWattsArr[streamHoverIndex] !== undefined && (
                                <span className="text-blue-500 font-bold">
                                  {fullWattsArr[streamHoverIndex]}W
                                </span>
                              )}
                              {fullVelArr &&
                                !fullWattsArr &&
                                fullVelArr[streamHoverIndex] !== undefined && (
                                  <span className="text-blue-500 font-bold">
                                    {formatPace(
                                      1000 / Math.max(1, fullVelArr[streamHoverIndex]),
                                      distanceUnit
                                    )}
                                  </span>
                                )}
                              {fullHrArr && fullHrArr[streamHoverIndex] !== undefined && (
                                <span className="text-red-500 font-bold">
                                  {fullHrArr[streamHoverIndex]} bpm
                                </span>
                              )}
                              {fullCadArr && fullCadArr[streamHoverIndex] !== undefined && (
                                <span className="text-emerald-500 font-semibold">
                                  {fullCadArr[streamHoverIndex]} rpm/spm
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Main Zoomable Power & Heart Rate SVG Chart */}
                        <svg
                          viewBox="0 0 840 198"
                          className="w-full h-52 select-none"
                          onMouseLeave={() => {
                            setStreamHoverIndex(null);
                            if (streamBrushStartIdx !== null) {
                              commitBrushZoom();
                            }
                          }}
                          onMouseUp={commitBrushZoom}
                        >
                          {(() => {
                            const chartLeft = 58;
                            const chartRight = 774;
                            const chartW = chartRight - chartLeft;
                            const chartTop = 14;
                            const chartBottom = 150;
                            const chartH = chartBottom - chartTop;

                            const visiblePrimary = fullPrimaryArr.slice(zStart, zEnd + 1);
                            const maxPrimary = Math.max(300, ...visiblePrimary, 100);

                            const visibleHrs = fullHrArr
                              .slice(zStart, zEnd + 1)
                              .filter((h) => h > 40);
                            const minHrScale =
                              visibleHrs.length > 0
                                ? Math.max(60, Math.min(...visibleHrs) - 10)
                                : 90;
                            const maxHrScale =
                              visibleHrs.length > 0
                                ? Math.max(minHrScale + 30, Math.max(...visibleHrs) + 8)
                                : 195;
                            const hrSpan = Math.max(25, maxHrScale - minHrScale);

                            const xForGlobalIdx = (gIdx: number) =>
                              chartLeft + ((gIdx - zStart) / Math.max(1, visibleCount - 1)) * chartW;

                            const hrPoints: string[] = [];
                            for (let gIdx = zStart; gIdx <= zEnd; gIdx++) {
                              const hr = fullHrArr[gIdx];
                              if (hr != null && hr > 40) {
                                const x = xForGlobalIdx(gIdx);
                                const y = chartBottom - ((hr - minHrScale) / hrSpan) * chartH;
                                hrPoints.push(
                                  `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`
                                );
                              }
                            }

                            const primaryPoints: string[] = [];
                            for (let gIdx = zStart; gIdx <= zEnd; gIdx++) {
                              const val = fullPrimaryArr[gIdx];
                              if (val != null && !Number.isNaN(val)) {
                                const x = xForGlobalIdx(gIdx);
                                const y = chartBottom - (val / maxPrimary) * chartH;
                                primaryPoints.push(
                                  `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`
                                );
                              }
                            }

                            const startElapsedSecs = fullTimeArr[zStart] || 0;
                            const endElapsedSecs =
                              fullTimeArr[zEnd] || selectedActivity.movingTimeSecs;

                            const brushMinIdx =
                              streamBrushStartIdx !== null && streamBrushEndIdx !== null
                                ? Math.max(
                                    zStart,
                                    Math.min(streamBrushStartIdx, streamBrushEndIdx)
                                  )
                                : null;
                            const brushMaxIdx =
                              streamBrushStartIdx !== null && streamBrushEndIdx !== null
                                ? Math.min(
                                    zEnd,
                                    Math.max(streamBrushStartIdx, streamBrushEndIdx)
                                  )
                                : null;

                            return (
                              <>
                                {/* Left Y-Axis Title */}
                                <text
                                  x={14}
                                  y={82}
                                  transform="rotate(-90 14 82)"
                                  textAnchor="middle"
                                  className="fill-blue-500 text-[11px] font-sans font-bold"
                                >
                                  {fullWattsArr ? 'Power (Watts)' : 'Velocity / Output'}
                                </text>

                                {/* Right Y-Axis Title */}
                                <text
                                  x={826}
                                  y={82}
                                  transform="rotate(90 826 82)"
                                  textAnchor="middle"
                                  className="fill-red-500 text-[11px] font-sans font-bold"
                                >
                                  Heart Rate (bpm)
                                </text>

                                {[0, 0.33, 0.66, 1].map((f, idx) => {
                                  const y = chartBottom - f * chartH;
                                  const pVal = Math.round(f * maxPrimary);
                                  const hrVal = Math.round(minHrScale + f * hrSpan);
                                  return (
                                    <g key={idx}>
                                      <line
                                        x1={chartLeft}
                                        y1={y}
                                        x2={chartRight}
                                        y2={y}
                                        stroke="currentColor"
                                        className="text-slate-200 dark:text-slate-800"
                                        strokeDasharray="3 3"
                                      />
                                      <text
                                        x={52}
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-blue-500 text-[11px] font-mono"
                                      >
                                        {pVal}W
                                      </text>
                                      <text
                                        x={780}
                                        y={y + 4}
                                        className="fill-red-500 text-[11px] font-mono"
                                      >
                                        {hrVal}
                                      </text>
                                    </g>
                                  );
                                })}

                                {/* Active Drag-to-Zoom Brush Highlight Box */}
                                {brushMinIdx !== null &&
                                  brushMaxIdx !== null &&
                                  brushMaxIdx > brushMinIdx && (
                                    <g>
                                      <rect
                                        x={xForGlobalIdx(brushMinIdx)}
                                        y={chartTop}
                                        width={Math.max(
                                          2,
                                          xForGlobalIdx(brushMaxIdx) - xForGlobalIdx(brushMinIdx)
                                        )}
                                        height={chartH}
                                        fill="#3B82F6"
                                        fillOpacity="0.18"
                                        stroke="#2563EB"
                                        strokeWidth="1.5"
                                        strokeDasharray="4 2"
                                      />
                                    </g>
                                  )}

                                <polyline
                                  fill="none"
                                  stroke="#3B82F6"
                                  strokeWidth="2"
                                  points={primaryPoints.join(' ')}
                                />
                                <polyline
                                  fill="none"
                                  stroke="#EF4444"
                                  strokeWidth="1.8"
                                  points={hrPoints.join(' ')}
                                />

                                {/* X-Axis Elapsed Time Ticks & Label */}
                                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                                  const x = chartLeft + f * chartW;
                                  const tSecs = Math.round(
                                    startElapsedSecs + f * (endElapsedSecs - startElapsedSecs)
                                  );
                                  return (
                                    <text
                                      key={idx}
                                      x={x}
                                      y={168}
                                      textAnchor="middle"
                                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                                    >
                                      {formatStopwatch(tSecs)}
                                    </text>
                                  );
                                })}
                                <text
                                  x={416}
                                  y={189}
                                  textAnchor="middle"
                                  className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                                >
                                  Elapsed Workout Time (mm:ss · Drag Horizontally on Chart to Zoom In)
                                </text>

                                {/* Interactive Hit Columns for Hover Crosshair + Drag-to-Zoom Brush */}
                                {Array.from({ length: visibleCount }, (_, localIdx) => {
                                  const gIdx = zStart + localIdx;
                                  const x = xForGlobalIdx(gIdx);
                                  const colW = chartW / Math.max(1, visibleCount);
                                  return (
                                    <g key={gIdx}>
                                      {streamHoverIndex === gIdx && (
                                        <line
                                          x1={x}
                                          y1={chartTop}
                                          x2={x}
                                          y2={chartBottom}
                                          stroke="#3B82F6"
                                          strokeWidth="1.5"
                                          strokeDasharray="3 2"
                                        />
                                      )}
                                      <rect
                                        x={x - colW / 2}
                                        y={0}
                                        width={Math.max(2, colW)}
                                        height={175}
                                        fill="transparent"
                                        className="cursor-crosshair"
                                        onMouseDown={() => {
                                          setStreamBrushStartIdx(gIdx);
                                          setStreamBrushEndIdx(gIdx);
                                        }}
                                        onMouseEnter={() => {
                                          setStreamHoverIndex(gIdx);
                                          if (streamBrushStartIdx !== null) {
                                            setStreamBrushEndIdx(gIdx);
                                          }
                                        }}
                                        onMouseMove={() => {
                                          setStreamHoverIndex(gIdx);
                                          if (streamBrushStartIdx !== null) {
                                            setStreamBrushEndIdx(gIdx);
                                          }
                                        }}
                                      />
                                    </g>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </svg>

                        {/* Full-Workout Overview Mini-Map Navigator Bar */}
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                            <span>
                              Full Workout Overview Navigator (Click anywhere on mini-map to jump zoomed window)
                            </span>
                            <span>
                              Viewing {Math.round((zStart / Math.max(1, totalLen - 1)) * 100)}% –{' '}
                              {Math.round((zEnd / Math.max(1, totalLen - 1)) * 100)}% of workout
                            </span>
                          </div>
                          <svg
                            viewBox="0 0 840 38"
                            className="w-full h-9 rounded-lg bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 cursor-pointer select-none"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const clickFrac = Math.max(
                                0,
                                Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                              );
                              const targetCenterIdx = Math.round(clickFrac * (totalLen - 1));
                              const currentSpan = isZoomed
                                ? zEnd - zStart
                                : Math.max(8, Math.round(totalLen * 0.25));
                              const half = Math.floor(currentSpan / 2);
                              let ns = Math.max(0, targetCenterIdx - half);
                              let ne = Math.min(totalLen - 1, ns + currentSpan);
                              if (ne >= totalLen - 1) {
                                ne = totalLen - 1;
                                ns = Math.max(0, ne - currentSpan);
                              }
                              setStreamZoomRange([ns, ne]);
                            }}
                          >
                            {(() => {
                              const maxAllP = Math.max(300, ...fullPrimaryArr, 100);
                              const miniPts = fullPrimaryArr
                                .map((v, idx) => {
                                  const x = (idx / Math.max(1, totalLen - 1)) * 840;
                                  const y = 34 - ((v || 0) / maxAllP) * 28;
                                  return `${x},${Math.max(4, Math.min(34, y))}`;
                                })
                                .join(' ');

                              const winLeftX = (zStart / Math.max(1, totalLen - 1)) * 840;
                              const winRightX = (zEnd / Math.max(1, totalLen - 1)) * 840;

                              return (
                                <>
                                  <polyline
                                    fill="none"
                                    stroke="#3B82F6"
                                    strokeWidth="1.25"
                                    strokeOpacity="0.65"
                                    points={miniPts}
                                  />
                                  <rect
                                    x={winLeftX}
                                    y={1}
                                    width={Math.max(8, winRightX - winLeftX)}
                                    height={36}
                                    rx={4}
                                    fill="#3B82F6"
                                    fillOpacity="0.22"
                                    stroke="#2563EB"
                                    strokeWidth="1.5"
                                  />
                                </>
                              );
                            })()}
                          </svg>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Heart Rate Zone Distribution Summary Chart (Interactive SVG Histogram + Stacked Polarization + Zone Breakdown) */}
              {(() => {
                const rawHrZones = Array.isArray(selectedActivity.zoneSecs?.hr)
                  ? selectedActivity.zoneSecs.hr
                  : [0, 0, 0, 0, 0, 0, 0];

                // Fold Z7 into Z6 so we have 6 canonical physiological HR zones (Z1..Z6)
                let sixZones = [
                  Number(rawHrZones[0] || 0),
                  Number(rawHrZones[1] || 0),
                  Number(rawHrZones[2] || 0),
                  Number(rawHrZones[3] || 0),
                  Number(rawHrZones[4] || 0),
                  Number(rawHrZones[5] || 0) + Number(rawHrZones[6] || 0),
                ];

                let zoneSourceLabel = 'Intervals.icu / Garmin FIT HR Zones';
                const rawSum = sixZones.reduce((a, b) => a + b, 0);

                // Fallback 1: Compute exact time in each HR zone from second-by-second heartrate stream if rawHrZones is empty
                if (
                  rawSum <= 0 &&
                  selectedActivity.streams?.heartrate &&
                  selectedActivity.streams.heartrate.length > 1
                ) {
                  const hrArr = selectedActivity.streams.heartrate;
                  const tArr = selectedActivity.streams.time;
                  const computed = [0, 0, 0, 0, 0, 0];
                  for (let i = 0; i < hrArr.length; i++) {
                    const hr = hrArr[i];
                    if (!hr || hr <= 40) continue;
                    const dt =
                      i > 0 && tArr[i] != null && tArr[i - 1] != null
                        ? Math.max(1, Math.min(30, tArr[i] - tArr[i - 1]))
                        : Math.max(
                            1,
                            Math.round((selectedActivity.movingTimeSecs || 3600) / hrArr.length)
                          );
                    if (hr < 132) computed[0] += dt;
                    else if (hr < 146) computed[1] += dt;
                    else if (hr < 156) computed[2] += dt;
                    else if (hr < 164) computed[3] += dt;
                    else if (hr < 171) computed[4] += dt;
                    else computed[5] += dt;
                  }
                  if (computed.reduce((a, b) => a + b, 0) > 0) {
                    sixZones = computed;
                    zoneSourceLabel = 'Computed from Second-by-Second HR Stream';
                  }
                }

                // Fallback 2: Estimate from Avg HR, Max HR & Moving Time if activity has HR but no zone array yet
                if (
                  sixZones.reduce((a, b) => a + b, 0) <= 0 &&
                  selectedActivity.avgHr > 0 &&
                  selectedActivity.movingTimeSecs > 0
                ) {
                  const avg = selectedActivity.avgHr;
                  const max = Math.max(avg + 8, selectedActivity.maxHr || avg + 15);
                  const mids = [120, 139, 151, 160, 167, 175];
                  const weights = mids.map((m) => {
                    if (m > max + 4) return 0.01;
                    const diff = Math.abs(m - avg);
                    return Math.exp(-(diff * diff) / (2 * 11 * 11));
                  });
                  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
                  sixZones = weights.map((w) =>
                    Math.round((w / wSum) * selectedActivity.movingTimeSecs)
                  );
                  zoneSourceLabel = 'Estimated from Workout Avg / Max HR';
                }

                const totalZoneSecs = Math.max(
                  1,
                  sixZones.reduce((a, b) => a + b, 0)
                );

                const zoneMeta = [
                  {
                    zone: 'Z1',
                    name: 'Z1 Active Recovery',
                    shortLabel: 'Z1 Recovery',
                    bpmRange: '< 132 bpm',
                    pctLthr: '< 81% LTHR',
                    effect: 'Parasympathetic recovery & capillary perfusion',
                    colorHex: '#64748B',
                    barClass: 'bg-slate-500',
                    textClass: 'text-slate-600 dark:text-slate-300',
                  },
                  {
                    zone: 'Z2',
                    name: 'Z2 Aerobic Endurance',
                    shortLabel: 'Z2 Endurance',
                    bpmRange: '132–145 bpm',
                    pctLthr: '81–89% LTHR',
                    effect: 'Mitochondrial density & fat oxidation base',
                    colorHex: '#3B82F6',
                    barClass: 'bg-blue-500',
                    textClass: 'text-blue-600 dark:text-blue-400',
                  },
                  {
                    zone: 'Z3',
                    name: 'Z3 Tempo / Sweet Spot',
                    shortLabel: 'Z3 Tempo',
                    bpmRange: '146–155 bpm',
                    pctLthr: '90–95% LTHR',
                    effect: 'Muscular endurance & glycogen economy',
                    colorHex: '#10B981',
                    barClass: 'bg-emerald-500',
                    textClass: 'text-emerald-600 dark:text-emerald-400',
                  },
                  {
                    zone: 'Z4',
                    name: 'Z4 Lactate Threshold',
                    shortLabel: 'Z4 Threshold',
                    bpmRange: '156–163 bpm',
                    pctLthr: '96–100% LTHR',
                    effect: 'Lactate clearance & sustainable race pace',
                    colorHex: '#F59E0B',
                    barClass: 'bg-amber-500',
                    textClass: 'text-amber-600 dark:text-amber-400',
                  },
                  {
                    zone: 'Z5',
                    name: 'Z5 VO2max Ceiling',
                    shortLabel: 'Z5 VO2max',
                    bpmRange: '164–170 bpm',
                    pctLthr: '101–104% LTHR',
                    effect: 'Maximal stroke volume & central O2 uptake',
                    colorHex: '#F97316',
                    barClass: 'bg-orange-500',
                    textClass: 'text-orange-600 dark:text-orange-400',
                  },
                  {
                    zone: 'Z6',
                    name: 'Z6 Anaerobic Capacity',
                    shortLabel: 'Z6 Anaerobic',
                    bpmRange: '171+ bpm',
                    pctLthr: '> 104% LTHR',
                    effect: 'Glycolytic power & peak neuromuscular recruitment',
                    colorHex: '#EF4444',
                    barClass: 'bg-red-500',
                    textClass: 'text-red-600 dark:text-red-400',
                  },
                ].map((m, idx) => {
                  const secs = sixZones[idx] || 0;
                  const pct = Number(((secs / totalZoneSecs) * 100).toFixed(1));
                  return {
                    ...m,
                    secs,
                    mins: Number((secs / 60).toFixed(1)),
                    pct,
                  };
                });

                const maxZoneSecs = Math.max(60, ...zoneMeta.map((z) => z.secs));
                const dominantZone = [...zoneMeta].sort((a, b) => b.secs - a.secs)[0];
                const lowAerobicSecs = zoneMeta[0].secs + zoneMeta[1].secs;
                const thresholdSecs = zoneMeta[2].secs + zoneMeta[3].secs;
                const highIntensitySecs = zoneMeta[4].secs + zoneMeta[5].secs;

                const lowAerobicPct = Math.round((lowAerobicSecs / totalZoneSecs) * 100);
                const thresholdPct = Math.round((thresholdSecs / totalZoneSecs) * 100);
                const highIntensityPct = Math.max(0, 100 - lowAerobicPct - thresholdPct);

                const activeHoverZone =
                  hrZoneHoverIdx !== null && zoneMeta[hrZoneHoverIdx]
                    ? zoneMeta[hrZoneHoverIdx]
                    : dominantZone;

                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                    {/* Header & Hover Readout */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          Heart Rate Zone Distribution Summary (Z1–Z6 Time in Zone)
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {zoneSourceLabel} · Total Tracked HR Time:{' '}
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {formatDuration(totalZoneSecs)}
                          </span>{' '}
                          · Dominant Zone:{' '}
                          <span className={`font-mono font-bold ${dominantZone.textClass}`}>
                            {dominantZone.name} ({dominantZone.pct}%)
                          </span>
                        </p>
                      </div>

                      {activeHoverZone && (
                        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                          <span className={`font-bold ${activeHoverZone.textClass}`}>
                            {activeHoverZone.name} ({activeHoverZone.bpmRange})
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            Time: {formatStopwatch(activeHoverZone.secs)} ({activeHoverZone.pct}%)
                          </span>
                          <span className="font-sans text-slate-500 hidden sm:inline">
                            {activeHoverZone.effect}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 3-Bucket Seiler Polarization Summary Strip + 100% Stacked Distribution Bar */}
                    <div className="rounded-lg bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">
                          Low Aerobic (Z1–Z2): {formatStopwatch(lowAerobicSecs)} ({lowAerobicPct}%)
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          Tempo / Threshold (Z3–Z4): {formatStopwatch(thresholdSecs)} ({thresholdPct}%)
                        </span>
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          VO2max / Anaerobic (Z5–Z6): {formatStopwatch(highIntensitySecs)} (
                          {highIntensityPct}%)
                        </span>
                      </div>
                      <div className="w-full h-3.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                        {zoneMeta.map((z, idx) =>
                          z.pct > 0 ? (
                            <div
                              key={z.zone}
                              style={{ width: `${z.pct}%`, backgroundColor: z.colorHex }}
                              title={`${z.name}: ${formatStopwatch(z.secs)} (${z.pct}%)`}
                              onMouseEnter={() => setHrZoneHoverIdx(idx)}
                              className="h-full transition-all cursor-pointer first:rounded-l-full last:rounded-r-full"
                            />
                          ) : null
                        )}
                      </div>
                    </div>

                    {/* Interactive SVG Vertical Column Chart + Detailed Horizontal Zone Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                      {/* Left 7 Cols: SVG Vertical Bar Distribution Chart with Explicit X & Y Axis Labels */}
                      <div
                        className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-3 select-none"
                        onMouseLeave={() => setHrZoneHoverIdx(null)}
                      >
                        <svg viewBox="0 0 540 220" className="w-full h-52">
                          {(() => {
                            const chartLeft = 58;
                            const chartRight = 492;
                            const chartW = chartRight - chartLeft;
                            const chartTop = 22;
                            const chartBottom = 166;
                            const chartH = chartBottom - chartTop;
                            const colSlotW = chartW / zoneMeta.length;
                            const barW = Math.min(46, colSlotW * 0.62);

                            return (
                              <>
                                {/* Left Y-Axis Title */}
                                <text
                                  x={14}
                                  y={94}
                                  transform="rotate(-90 14 94)"
                                  textAnchor="middle"
                                  className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-bold"
                                >
                                  Time in Zone (mm:ss)
                                </text>

                                {/* Right Y-Axis Title */}
                                <text
                                  x={528}
                                  y={94}
                                  transform="rotate(90 528 94)"
                                  textAnchor="middle"
                                  className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans font-bold"
                                >
                                  Share of Workout (%)
                                </text>

                                {/* Horizontal Grid Lines & Ticks */}
                                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                                  const y = chartBottom - f * chartH;
                                  const tSecs = Math.round(f * maxZoneSecs);
                                  const pctVal = Math.round(
                                    ((f * maxZoneSecs) / totalZoneSecs) * 100
                                  );
                                  return (
                                    <g key={idx}>
                                      <line
                                        x1={chartLeft}
                                        y1={y}
                                        x2={chartRight}
                                        y2={y}
                                        stroke="currentColor"
                                        className="text-slate-200 dark:text-slate-800"
                                        strokeDasharray="3 3"
                                      />
                                      <text
                                        x={chartLeft - 6}
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                                      >
                                        {formatStopwatch(tSecs)}
                                      </text>
                                      <text
                                        x={chartRight + 6}
                                        y={y + 4}
                                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                                      >
                                        {pctVal}%
                                      </text>
                                    </g>
                                  );
                                })}

                                {/* Zone Bars */}
                                {zoneMeta.map((z, idx) => {
                                  const centerX = chartLeft + (idx + 0.5) * colSlotW;
                                  const barH = Math.max(
                                    z.secs > 0 ? 4 : 1,
                                    (z.secs / maxZoneSecs) * chartH
                                  );
                                  const barY = chartBottom - barH;
                                  const isHovered = hrZoneHoverIdx === idx;

                                  return (
                                    <g key={z.zone}>
                                      <rect
                                        x={centerX - barW / 2}
                                        y={barY}
                                        width={barW}
                                        height={barH}
                                        rx={5}
                                        fill={z.colorHex}
                                        fillOpacity={isHovered ? 1 : 0.85}
                                        stroke={isHovered ? '#0F172A' : 'none'}
                                        strokeWidth={isHovered ? 1.5 : 0}
                                      />
                                      {/* Value Label Above Bar */}
                                      <text
                                        x={centerX}
                                        y={Math.max(13, barY - 5)}
                                        textAnchor="middle"
                                        className="fill-slate-800 dark:fill-slate-100 text-[10px] font-mono font-bold"
                                      >
                                        {z.secs > 0 ? `${Math.round(z.pct)}%` : '0%'}
                                      </text>
                                      {/* X-Axis Zone Label */}
                                      <text
                                        x={centerX}
                                        y={182}
                                        textAnchor="middle"
                                        className="fill-slate-700 dark:fill-slate-200 text-[11px] font-mono font-bold"
                                      >
                                        {z.zone}
                                      </text>
                                      <text
                                        x={centerX}
                                        y={195}
                                        textAnchor="middle"
                                        className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
                                      >
                                        {z.bpmRange.replace(' bpm', '')}
                                      </text>
                                      {/* Hit Target */}
                                      <rect
                                        x={centerX - colSlotW / 2}
                                        y={0}
                                        width={colSlotW}
                                        height={202}
                                        fill="transparent"
                                        className="cursor-pointer"
                                        onMouseEnter={() => setHrZoneHoverIdx(idx)}
                                      />
                                    </g>
                                  );
                                })}

                                {/* X-Axis Title */}
                                <text
                                  x={chartLeft + chartW / 2}
                                  y={214}
                                  textAnchor="middle"
                                  className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-bold"
                                >
                                  X-Axis: Physiological Heart Rate Zones (Z1–Z6 · bpm thresholds)
                                </text>
                              </>
                            );
                          })()}
                        </svg>
                      </div>

                      {/* Right 5 Cols: Detailed Zone Table with Horizontal Progress Bars, BPM Ranges & Exact Duration */}
                      <div className="lg:col-span-5 space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 pb-1">
                          <span>Zone &amp; HR Threshold</span>
                          <span>Time Spent &amp; Share</span>
                        </div>
                        {zoneMeta.map((z, idx) => (
                          <div
                            key={z.zone}
                            onMouseEnter={() => setHrZoneHoverIdx(idx)}
                            onMouseLeave={() => setHrZoneHoverIdx(null)}
                            className={`rounded-lg p-2 transition-colors cursor-pointer ${
                              hrZoneHoverIdx === idx
                                ? 'bg-slate-100 dark:bg-slate-800/80'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-900/50'
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                                  style={{ backgroundColor: z.colorHex }}
                                />
                                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {z.shortLabel}
                                </span>
                                <span className="font-mono text-[11px] text-slate-500">
                                  ({z.bpmRange})
                                </span>
                              </div>
                              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100 shrink-0">
                                {formatStopwatch(z.secs)}{' '}
                                <span className="text-slate-500 font-normal">({z.pct}%)</span>
                              </div>
                            </div>
                            <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                style={{
                                  width: `${Math.min(100, z.pct)}%`,
                                  backgroundColor: z.colorHex,
                                }}
                                className="h-full rounded-full transition-all"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Auto-Detected Intervals & Lap Splits (Intervals.icu icu_intervals) */}
              {selectedActivity.intervals && selectedActivity.intervals.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Auto-Detected Intervals &amp; Lap Splits ({selectedActivity.intervals.length} Intervals)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Synced via Intervals.icu FIT Interval Detection
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                          <th className="py-2 pr-3">Interval / Type</th>
                          <th className="py-2 px-3 text-right">Duration &amp; Distance</th>
                          <th className="py-2 px-3 text-right">Power / %FTP</th>
                          <th className="py-2 px-3 text-right">Pace / GAP</th>
                          <th className="py-2 px-3 text-right">Heart Rate</th>
                          <th className="py-2 px-3 text-right">Cadence / Drift</th>
                          <th className="py-2 pl-3 text-right">Chart Zoom</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                        {selectedActivity.intervals.map((iv) => (
                          <tr
                            key={iv.id}
                            onClick={() =>
                              zoomStreamToTimeWindow(
                                Math.max(0, iv.startTimeSecs - 15),
                                iv.startTimeSecs + iv.durationSecs + 15
                              )
                            }
                            className={`cursor-pointer transition-colors ${
                              iv.type === 'WORK'
                                ? 'bg-blue-500/5 dark:bg-blue-500/10 font-medium hover:bg-blue-500/15'
                                : 'opacity-75 hover:bg-slate-50 dark:hover:bg-slate-900/50'
                            }`}
                          >
                            <td className="py-2.5 pr-3 font-sans">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold mr-2 ${
                                  iv.type === 'WORK'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                {iv.type}
                              </span>
                              <span className="text-slate-900 dark:text-slate-100">{iv.label}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {formatStopwatch(iv.durationSecs)} ·{' '}
                              {iv.distanceMeters > 0
                                ? formatDistance(iv.distanceMeters, distanceUnit, 2)
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {iv.avgWatts ? `${iv.avgWatts}W` : '—'}{' '}
                              {iv.intensityPct ? `(${iv.intensityPct}%)` : ''}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {iv.avgPaceSecsPerKm
                                ? formatPace(iv.avgPaceSecsPerKm, distanceUnit)
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {iv.avgHr ? `${iv.avgHr} / ${iv.maxHr} bpm` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {iv.avgCadence ? `${iv.avgCadence} rpm/spm` : '—'}
                              {iv.decouplingPct !== undefined ? ` · ${iv.decouplingPct}%` : ''}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-sans">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  zoomStreamToTimeWindow(
                                    Math.max(0, iv.startTimeSecs - 15),
                                    iv.startTimeSecs + iv.durationSecs + 15
                                  );
                                }}
                                className="min-h-[26px] px-2 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold transition-colors whitespace-nowrap"
                              >
                                Zoom Section
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Strava Segments on This Activity & Segment Performance Over Time Chart */}
              {(selectedActivity.environment === 'OUTDOOR' ||
                (selectedActivity.segmentEfforts && selectedActivity.segmentEfforts.length > 0)) && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Strava Segments on This Activity (
                        {selectedActivity.segmentEfforts?.length || 0} Matched Segments)
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Click any segment biked or run more than once (2x+) to inspect your historical elapsed time, power/pace, and heart rate progression over time
                      </p>
                    </div>
                    {onScanMoreSegments && (
                      <button
                        type="button"
                        onClick={onScanMoreSegments}
                        disabled={isScanningSegments}
                        className="min-h-[32px] px-3 py-1 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors whitespace-nowrap"
                      >
                        {isScanningSegments
                          ? 'Scanning Historical Segments...'
                          : 'Scan +30 Historical Workouts for Repeat Segments'}
                      </button>
                    )}
                  </div>

                  {selectedActivity.segmentEfforts && selectedActivity.segmentEfforts.length > 0 ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                              <th className="py-2 pr-3">Strava Segment</th>
                              <th className="py-2 px-3 text-right">Distance &amp; Grade</th>
                              <th className="py-2 px-3 text-right">Elapsed Time</th>
                              <th className="py-2 px-3 text-right">Power / Pace</th>
                              <th className="py-2 px-3 text-right">Avg HR</th>
                              <th className="py-2 px-3 text-right">All-Time PR / Delta</th>
                              <th className="py-2 pl-3 text-right">History Over Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                            {selectedActivity.segmentEfforts.map((eff) => {
                              const sid = String(eff.segmentId || eff.name);
                              const segHist = segmentHistoryBySegmentId.get(sid);
                              const totalAttempts = segHist?.efforts.length || 1;
                              const prSecs = segHist?.prElapsedTimeSecs || eff.elapsedTimeSecs;
                              const deltaSecs = eff.elapsedTimeSecs - prSecs;
                              const isSelectedForChart = modalSelectedSegmentId === sid;

                              return (
                                <tr
                                  key={eff.id}
                                  onClick={() => {
                                    if (totalAttempts >= 2) {
                                      setModalSelectedSegmentId(sid);
                                      setModalSegmentHoverIdx(null);
                                    }
                                  }}
                                  className={`${
                                    totalAttempts >= 2 ? 'cursor-pointer' : ''
                                  } transition-colors ${
                                    isSelectedForChart
                                      ? 'bg-blue-500/10 dark:bg-blue-500/15'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                  }`}
                                >
                                  <td className="py-2.5 pr-3 font-sans">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                                      {eff.name}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                                    {formatDistance(eff.distanceMeters, distanceUnit, 2)} ·{' '}
                                    {eff.averageGradePct > 0 ? `+${eff.averageGradePct}%` : `${eff.averageGradePct}%`}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                                    {formatStopwatch(eff.elapsedTimeSecs)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-blue-600 dark:text-blue-400 font-semibold">
                                    {eff.avgWatts
                                      ? `${eff.avgWatts}W (${(eff.avgWatts / athleteWeightKg).toFixed(2)} W/kg)`
                                      : eff.avgPaceSecsPerKm
                                        ? formatPace(eff.avgPaceSecsPerKm, distanceUnit)
                                        : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                                    {eff.avgHr ? `${eff.avgHr} bpm` : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    {eff.prRank === 1 || deltaSecs <= 0 ? (
                                      <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs">
                                        PR #1 ({formatStopwatch(prSecs)})
                                      </span>
                                    ) : eff.prRank === 2 ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                        2nd Best (+{deltaSecs}s vs PR)
                                      </span>
                                    ) : eff.prRank === 3 ? (
                                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                        3rd Best (+{deltaSecs}s vs PR)
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">
                                        +{deltaSecs}s (PR {formatStopwatch(prSecs)})
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 pl-3 text-right font-sans">
                                    {totalAttempts >= 2 ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setModalSelectedSegmentId(sid);
                                          setModalSegmentHoverIdx(null);
                                        }}
                                        className={`min-h-[28px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                                          isSelectedForChart
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20'
                                        }`}
                                      >
                                        {isSelectedForChart
                                          ? `Viewing Chart (${totalAttempts}x)`
                                          : `Trend Chart (${totalAttempts}x)`}
                                      </button>
                                    ) : (
                                      <span className="text-xs font-mono text-slate-400">1st effort</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Inline Segment Performance Over Time Chart (for any selected segment with >= 2 efforts) */}
                      {modalSelectedSegmentId &&
                        (() => {
                          const segHist = segmentHistoryBySegmentId.get(modalSelectedSegmentId);
                          if (!segHist || segHist.efforts.length < 2) return null;
                          const efforts = segHist.efforts;
                          const len = efforts.length;
                          const hoveredEffort =
                            modalSegmentHoverIdx !== null && efforts[modalSegmentHoverIdx]
                              ? efforts[modalSegmentHoverIdx]
                              : efforts.find((e) => e.activityId === selectedActivity.id) ||
                                efforts[efforts.length - 1];

                          return (
                            <div className="rounded-xl border border-blue-500/30 bg-slate-50/60 dark:bg-slate-900/60 p-4 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">
                                      Segment Performance Over Time ({len} Logged Efforts)
                                    </span>
                                  </div>
                                  <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                                    {segHist.name} ·{' '}
                                    {formatDistance(segHist.distanceMeters, distanceUnit, 2)} (
                                    {segHist.averageGradePct}% Grade) · All-Time PR:{' '}
                                    <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                                      {formatStopwatch(segHist.prElapsedTimeSecs)}
                                    </span>
                                  </h4>
                                </div>

                                {hoveredEffort && (
                                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                                    <span className="font-bold text-slate-900 dark:text-slate-100">
                                      {hoveredEffort.date}
                                      {hoveredEffort.activityId === selectedActivity.id
                                        ? ' (This Workout)'
                                        : ''}
                                    </span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                      Time: {formatStopwatch(hoveredEffort.elapsedTimeSecs)}
                                    </span>
                                    {hoveredEffort.avgWatts && (
                                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                                        Power: {hoveredEffort.avgWatts}W
                                      </span>
                                    )}
                                    {hoveredEffort.avgPaceSecsPerKm && (
                                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                                        Pace: {formatPace(hoveredEffort.avgPaceSecsPerKm, distanceUnit)}
                                      </span>
                                    )}
                                    {hoveredEffort.avgHr && (
                                      <span className="text-rose-500 font-bold">
                                        HR: {hoveredEffort.avgHr} bpm
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              <svg
                                viewBox="0 0 840 215"
                                className="w-full h-52 select-none"
                                onMouseLeave={() => setModalSegmentHoverIdx(null)}
                              >
                                {(() => {
                                  const chartLeft = 64;
                                  const chartRight = 774;
                                  const chartW = chartRight - chartLeft;
                                  const chartTop = 18;
                                  const chartBottom = 160;
                                  const chartH = chartBottom - chartTop;

                                  const times = efforts.map((e) => e.elapsedTimeSecs);
                                  const minTime = Math.min(...times);
                                  const maxTime = Math.max(...times);
                                  const timePad = Math.max(4, Math.round((maxTime - minTime) * 0.15));
                                  const lowT = Math.max(1, minTime - timePad);
                                  const highT = maxTime + timePad;
                                  const spanT = Math.max(10, highT - lowT);

                                  // Faster elapsed time (smaller seconds) is plotted HIGHER on the Y-axis
                                  const toYTime = (tSecs: number) =>
                                    chartBottom - ((highT - tSecs) / spanT) * chartH;

                                  const wattsList = efforts
                                    .map((e) => e.avgWatts || 0)
                                    .filter((w) => w > 0);
                                  const maxW = wattsList.length > 0 ? Math.max(250, ...wattsList) * 1.1 : 350;
                                  const minW = wattsList.length > 0 ? Math.max(50, Math.min(...wattsList) * 0.85) : 100;
                                  const toYWatts = (w: number) =>
                                    chartBottom - ((w - minW) / Math.max(20, maxW - minW)) * chartH;

                                  const xForIdx = (i: number) =>
                                    chartLeft + (i / Math.max(1, len - 1)) * chartW;

                                  const timePoints = efforts
                                    .map((e, i) => `${xForIdx(i)},${toYTime(e.elapsedTimeSecs)}`)
                                    .join(' ');

                                  const wattsPoints =
                                    wattsList.length >= 2
                                      ? efforts
                                          .filter((e) => (e.avgWatts || 0) > 0)
                                          .map((e) => {
                                            const idx = efforts.indexOf(e);
                                            return `${xForIdx(idx)},${toYWatts(e.avgWatts!)}`;
                                          })
                                          .join(' ')
                                      : '';

                                  const prY = toYTime(segHist.prElapsedTimeSecs);

                                  return (
                                    <>
                                      {/* Left Y-Axis Title */}
                                      <text
                                        x={15}
                                        y={89}
                                        transform="rotate(-90 15 89)"
                                        textAnchor="middle"
                                        className="fill-emerald-600 dark:fill-emerald-400 text-[11px] font-sans font-bold"
                                      >
                                        Elapsed Time (Faster ↑)
                                      </text>

                                      {/* Right Y-Axis Title */}
                                      <text
                                        x={826}
                                        y={89}
                                        transform="rotate(90 826 89)"
                                        textAnchor="middle"
                                        className="fill-blue-500 text-[11px] font-sans font-bold"
                                      >
                                        {wattsList.length >= 2 ? 'Avg Power (Watts)' : 'Avg Heart Rate (bpm)'}
                                      </text>

                                      {/* Horizontal Grid & Ticks */}
                                      {[0, 0.33, 0.66, 1].map((f, idx) => {
                                        const y = chartBottom - f * chartH;
                                        const tVal = Math.round(highT - f * spanT);
                                        const rightVal =
                                          wattsList.length >= 2
                                            ? `${Math.round(minW + f * (maxW - minW))}W`
                                            : `${Math.round(120 + f * 65)} bpm`;
                                        return (
                                          <g key={idx}>
                                            <line
                                              x1={chartLeft}
                                              y1={y}
                                              x2={chartRight}
                                              y2={y}
                                              stroke="currentColor"
                                              className="text-slate-200 dark:text-slate-800"
                                              strokeDasharray="3 3"
                                            />
                                            <text
                                              x={chartLeft - 8}
                                              y={y + 4}
                                              textAnchor="end"
                                              className="fill-emerald-600 dark:fill-emerald-400 text-[11px] font-mono"
                                            >
                                              {formatStopwatch(tVal)}
                                            </text>
                                            <text
                                              x={chartRight + 8}
                                              y={y + 4}
                                              className="fill-blue-500 text-[11px] font-mono"
                                            >
                                              {rightVal}
                                            </text>
                                          </g>
                                        );
                                      })}

                                      {/* All-Time PR Benchmark Line */}
                                      <line
                                        x1={chartLeft}
                                        y1={prY}
                                        x2={chartRight}
                                        y2={prY}
                                        stroke="#10B981"
                                        strokeWidth="1.25"
                                        strokeDasharray="5 4"
                                        strokeOpacity="0.7"
                                      />

                                      {/* Secondary Power Polyline */}
                                      {wattsPoints && (
                                        <polyline
                                          fill="none"
                                          stroke="#3B82F6"
                                          strokeWidth="2"
                                          strokeOpacity="0.8"
                                          points={wattsPoints}
                                        />
                                      )}

                                      {/* Primary Elapsed Time Polyline */}
                                      <polyline
                                        fill="none"
                                        stroke="#10B981"
                                        strokeWidth="2.5"
                                        points={timePoints}
                                      />

                                      {/* Effort Points & Current Activity Highlight */}
                                      {efforts.map((e, i) => {
                                        const x = xForIdx(i);
                                        const y = toYTime(e.elapsedTimeSecs);
                                        const isCurrentWorkout = e.activityId === selectedActivity.id;
                                        const isPr = e.prRank === 1;
                                        const colW = chartW / Math.max(1, len);
                                        return (
                                          <g key={e.effortId}>
                                            {isCurrentWorkout && (
                                              <circle
                                                cx={x}
                                                cy={y}
                                                r={8}
                                                fill="none"
                                                stroke="#F59E0B"
                                                strokeWidth="2.5"
                                              />
                                            )}
                                            <circle
                                              cx={x}
                                              cy={y}
                                              r={isCurrentWorkout || isPr ? 5 : 4}
                                              fill={isPr ? '#F59E0B' : '#10B981'}
                                              stroke="#fff"
                                              strokeWidth="1.5"
                                            />
                                            {(i === 0 ||
                                              i === len - 1 ||
                                              len <= 8 ||
                                              i % Math.ceil(len / 6) === 0) && (
                                              <text
                                                x={x}
                                                y={178}
                                                textAnchor="middle"
                                                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                                              >
                                                {e.date.slice(2)}
                                              </text>
                                            )}
                                            <rect
                                              x={x - colW / 2}
                                              y={0}
                                              width={colW}
                                              height={185}
                                              fill="transparent"
                                              className="cursor-pointer"
                                              onMouseEnter={() => setModalSegmentHoverIdx(i)}
                                            />
                                          </g>
                                        );
                                      })}

                                      <text
                                        x={chartLeft + chartW / 2}
                                        y={202}
                                        textAnchor="middle"
                                        className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                                      >
                                        Attempt Date (Chronological Progression · Gold Ring = Current Activity)
                                      </text>
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>
                          );
                        })()}
                    </>
                  ) : (
                    <div className="text-xs text-slate-500 py-3">
                      Loading Strava segment efforts from Intervals.icu / Strava streams for this outdoor workout...
                    </div>
                  )}
                </div>
              )}

              {/* Similar Historical Workouts & Repeat Comparison Table */}
              {similarHistoricalWorkouts.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Similar Historical Workouts &amp; Efficiency Progression ({similarHistoricalWorkouts.length} Matched Repeats)
                    </h3>
                    <span className="text-xs font-mono text-emerald-500">
                      Click &quot;Overlay in Split-View&quot; to compare streams side-by-side
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                          <th className="py-2 pr-3">Date &amp; Workout</th>
                          <th className="py-2 px-3 text-right">Distance &amp; Time</th>
                          <th className="py-2 px-3 text-right">NP Watts / Pace</th>
                          <th className="py-2 px-3 text-right">Avg HR</th>
                          <th className="py-2 px-3 text-right">Efficiency Factor (EF)</th>
                          <th className="py-2 pl-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                        {similarHistoricalWorkouts.map((sim) => (
                          <tr
                            key={sim.id}
                            onClick={() => onSelectActivity(sim)}
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                          >
                            <td className="py-2.5 pr-3 font-sans">
                              <span className="font-mono text-slate-500 mr-2">
                                {sim.startDateLocal.slice(0, 10)}
                              </span>
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {sim.name}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.distanceMeters > 0
                                ? formatDistance(sim.distanceMeters, distanceUnit, 2)
                                : '—'}{' '}
                              · {formatDuration(sim.movingTimeSecs)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.sportCategory === 'Running' && sim.avgPaceSecsPerKm
                                ? formatPace(sim.avgPaceSecsPerKm, distanceUnit)
                                : sim.normalizedPower
                                  ? `NP ${sim.normalizedPower}W`
                                  : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {sim.avgHr > 0 ? `${sim.avgHr} bpm` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              {sim.efficiencyFactor || '—'}
                            </td>
                            <td
                              className="py-2.5 pl-3 text-right font-sans"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  handleAssignToCompareSlot(selectedActivity, 'A');
                                  handleAssignToCompareSlot(sim, 'B');
                                  onSelectActivity(null);
                                }}
                                className="min-h-[28px] px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                              >
                                Overlay in Split-View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
