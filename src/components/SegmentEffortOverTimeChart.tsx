import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  Calendar,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  TrendingDown,
  Trophy,
  ZoomIn,
} from "./icons/PhosphorIcons";
import { DistanceUnit, UnifiedActivity } from '../types';
import { formatDistance, formatPace, formatStopwatch } from '../utils/formatters';
import { ChartInfoTooltip } from './ChartInfoTooltip';

export interface SegmentEffortPoint {
  effortId: string;
  activityId: string;
  activityName: string;
  date: string; // YYYY-MM-DD
  startDateLocal: string;
  elapsedTimeSecs: number;
  movingTimeSecs?: number;
  avgWatts?: number;
  avgPaceSecsPerKm?: number;
  avgHr?: number;
  prRank: 1 | 2 | 3 | null;
  startTimeSecs?: number;
  endTimeSecs?: number;
}

export interface RepeatedSegmentSummary {
  segmentId: string;
  name: string;
  sportCategory: 'Cycling' | 'Running';
  distanceMeters: number;
  averageGradePct: number;
  prElapsedTimeSecs: number;
  efforts: SegmentEffortPoint[];
}

interface SegmentEffortOverTimeChartProps {
  segments: RepeatedSegmentSummary[];
  selectedSegmentId: string | null;
  onSelectSegmentId: (segmentId: string) => void;
  distanceUnit: DistanceUnit;
  athleteWeightKg?: number;
  currentActivityId?: string;
  onSelectActivity?: (activityId: string) => void;
  onZoomToSegmentWindow?: (startTimeSecs: number, endTimeSecs: number) => void;
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments?: boolean;
  showSegmentPicker?: boolean;
  compact?: boolean;
}

export function buildRepeatedSegmentsFromActivities(
  activities: UnifiedActivity[]
): RepeatedSegmentSummary[] {
  const map = new Map<string, RepeatedSegmentSummary>();

  for (const act of activities) {
    if (!Array.isArray(act.segmentEfforts) || act.segmentEfforts.length === 0) continue;
    for (const eff of act.segmentEfforts) {
      if (!eff || !(eff.elapsedTimeSecs > 0)) continue;
      const sid = String(eff.segmentId || eff.name);
      const existing = map.get(sid);
      const entry: SegmentEffortPoint = {
        effortId: eff.id || `${act.id}-${sid}-${eff.startDateLocal}`,
        activityId: act.id,
        activityName: act.name,
        date: (eff.startDateLocal || act.startDateLocal).slice(0, 10),
        startDateLocal: eff.startDateLocal || act.startDateLocal,
        elapsedTimeSecs: Math.round(eff.elapsedTimeSecs),
        movingTimeSecs: eff.movingTimeSecs ? Math.round(eff.movingTimeSecs) : undefined,
        avgWatts: eff.avgWatts,
        avgPaceSecsPerKm:
          eff.avgPaceSecsPerKm ||
          (act.sportCategory === 'Running' && eff.distanceMeters > 0
            ? Math.round(eff.elapsedTimeSecs / (eff.distanceMeters / 1000))
            : undefined),
        avgHr: eff.avgHr || (act.avgHr > 0 ? act.avgHr : undefined),
        prRank: eff.prRank,
        startTimeSecs: eff.startTimeSecs,
        endTimeSecs: eff.endTimeSecs,
      };

      if (!existing) {
        map.set(sid, {
          segmentId: sid,
          name: eff.name,
          sportCategory: act.sportCategory === 'Running' ? 'Running' : 'Cycling',
          distanceMeters: eff.distanceMeters,
          averageGradePct: eff.averageGradePct,
          prElapsedTimeSecs: entry.elapsedTimeSecs,
          efforts: [entry],
        });
      } else {
        // Avoid duplicate effort entries from the same activity + startTimeSecs
        const isDup = existing.efforts.some(
          (e) =>
            e.activityId === entry.activityId &&
            Math.abs((e.startTimeSecs || 0) - (entry.startTimeSecs || 0)) < 5 &&
            e.elapsedTimeSecs === entry.elapsedTimeSecs
        );
        if (!isDup) {
          existing.efforts.push(entry);
          if (entry.elapsedTimeSecs < existing.prElapsedTimeSecs) {
            existing.prElapsedTimeSecs = entry.elapsedTimeSecs;
          }
          if (eff.averageGradePct && !existing.averageGradePct) {
            existing.averageGradePct = eff.averageGradePct;
          }
        }
      }
    }
  }

  const repeated: RepeatedSegmentSummary[] = [];
  for (const seg of map.values()) {
    if (seg.efforts.length < 2) continue;
    // Rank fastest 3 efforts
    const bySpeed = [...seg.efforts].sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
    bySpeed.forEach((e, idx) => {
      e.prRank = idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null;
    });
    // Sort chronologically ascending by date
    seg.efforts.sort(
      (a, b) => new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
    );
    repeated.push(seg);
  }

  return repeated.sort((a, b) => b.efforts.length - a.efforts.length);
}

export const SegmentEffortOverTimeChart: React.FC<SegmentEffortOverTimeChartProps> = ({
  segments,
  selectedSegmentId,
  onSelectSegmentId,
  distanceUnit,
  athleteWeightKg = 72.5,
  currentActivityId,
  onSelectActivity,
  onZoomToSegmentWindow,
  onScanMoreSegments,
  isScanningSegments = false,
  showSegmentPicker = true,
  compact = false,
}) => {
  const [sportFilter, setSportFilter] = useState<'ALL' | 'Cycling' | 'Running'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [xSpacingMode, setXSpacingMode] = useState<'DATE_SCALE' | 'ATTEMPT_ORDER'>('DATE_SCALE');
  const [invertYForFasterUp, setInvertYForFasterUp] = useState<boolean>(false);
  const [showOverlayMetric, setShowOverlayMetric] = useState<boolean>(true);

  const filteredSegments = useMemo(() => {
    const seenIds = new Set<string>();
    return segments.filter((seg) => {
      if (!seg || seg.efforts.length < 2) return false;
      if (seenIds.has(seg.segmentId)) return false;
      if (sportFilter !== 'ALL' && seg.sportCategory !== sportFilter) return false;
      if (
        searchQuery.trim() &&
        !seg.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      ) {
        return false;
      }
      seenIds.add(seg.segmentId);
      return true;
    });
  }, [segments, sportFilter, searchQuery]);

  const activeSegment = useMemo(() => {
    if (selectedSegmentId) {
      const exact =
        filteredSegments.find((s) => s.segmentId === selectedSegmentId) ||
        segments.find((s) => s.segmentId === selectedSegmentId);
      if (exact && exact.efforts.length >= 2) return exact;
    }
    return filteredSegments[0] || segments[0] || null;
  }, [filteredSegments, segments, selectedSegmentId]);

  if (!activeSegment || activeSegment.efforts.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Effort Over Time — Multi-Attempt Segment Progress Chart
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            No segments with 2+ recorded attempts found yet in the currently scanned workouts. Scan additional outdoor workouts to populate your multi-attempt segment history.
          </p>
        </div>
        {onScanMoreSegments && (
          <button
            type="button"
            onClick={onScanMoreSegments}
            disabled={isScanningSegments}
            className="min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanningSegments ? 'animate-spin' : ''}`} />
            <span>
              {isScanningSegments
                ? 'Scanning Historical Workouts...'
                : 'Scan +30 Workouts for Repeat Segments'}
            </span>
          </button>
        )}
      </div>
    );
  }

  const efforts = activeSegment.efforts;
  const len = efforts.length;
  const firstEffort = efforts[0];
  const latestEffort = efforts[len - 1];
  const prEffort =
    efforts.find((e) => e.prRank === 1) ||
    [...efforts].sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs)[0];

  const netChangeFirstToPrSecs = prEffort.elapsedTimeSecs - firstEffort.elapsedTimeSecs;
  const netChangeFirstToLatestSecs = latestEffort.elapsedTimeSecs - firstEffort.elapsedTimeSecs;
  const avgDurationSecs = Math.round(
    efforts.reduce((acc, e) => acc + e.elapsedTimeSecs, 0) / Math.max(1, len)
  );

  const activeHoveredEffort =
    hoverIdx !== null && efforts[hoverIdx]
      ? efforts[hoverIdx]
      : (currentActivityId && efforts.find((e) => e.activityId === currentActivityId)) ||
        latestEffort;

  const activeHoveredIndex = efforts.indexOf(activeHoveredEffort);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 sm:p-5 space-y-4">
      {/* Header Row & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-mono font-bold uppercase tracking-wider">
              <TrendingDown className="w-3.5 h-3.5" />
              Effort Over Time
            </span>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              Segment Effort Over Time — Duration (Seconds) vs. Attempt Date
            </h3>
            <ChartInfoTooltip
              title="Benchmark Segment Progression Over Time"
              subtitle="Real-World Field Testing & Repeat Effort Kinematics"
              whatItMeasures="Plots elapsed time (seconds) and average power/pace across every historical attempt on a repeated real-world road, gravel, or trail segment, highlighting your All-Time PR (gold) and Rolling Average."
              benchmarks="Consistent downward trend in elapsed time at equal or lower average Heart Rate confirms real-world transfer of laboratory eFTP and W/kg improvements."
              liveStatus={{
                label: `PR: ${formatStopwatch(prEffort.elapsedTimeSecs)} (${prEffort.date}) · Latest: ${formatStopwatch(latestEffort.elapsedTimeSecs)} (${len} attempts)`,
                state: latestEffort.elapsedTimeSecs <= avgDurationSecs ? 'optimal' : 'neutral',
                interpretation: `Across ${len} recorded attempts on "${activeSegment.name}", your PR is ${formatStopwatch(prEffort.elapsedTimeSecs)} and your mean time is ${formatStopwatch(avgDurationSecs)}.`,
              }}
              coachingAction="Click any point on the progression curve to open the full workout stream from that date and inspect pacing or wind/draft conditions."
            />
            {!/^strava-|^icu-|seg-/i.test(activeSegment.segmentId) &&
              /^\d+$/.test(activeSegment.segmentId) && (
                <a
                  href={`https://www.strava.com/segments/${encodeURIComponent(
                    activeSegment.segmentId
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#FC4C02] hover:underline"
                >
                  <span>Strava Segment</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Visualizing duration in seconds (<code className="font-mono">Y-axis</code>) against attempt date (<code className="font-mono">X-axis</code>) across{' '}
            <strong>{len} recorded attempts</strong> on <strong>{activeSegment.name}</strong> (
            {formatDistance(activeSegment.distanceMeters, distanceUnit, 2)} ·{' '}
            {activeSegment.averageGradePct > 0
              ? `+${activeSegment.averageGradePct}%`
              : `${activeSegment.averageGradePct}%`}{' '}
            grade)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* X-Axis Spacing Toggle */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setXSpacingMode('DATE_SCALE')}
              className={`min-h-[26px] px-2.5 py-0.5 rounded-md font-semibold transition-colors ${
                xSpacingMode === 'DATE_SCALE'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              X: Calendar Date
            </button>
            <button
              type="button"
              onClick={() => setXSpacingMode('ATTEMPT_ORDER')}
              className={`min-h-[26px] px-2.5 py-0.5 rounded-md font-semibold transition-colors ${
                xSpacingMode === 'ATTEMPT_ORDER'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              X: Attempt #1–#{len}
            </button>
          </div>

          {/* Y-Axis Direction Toggle */}
          <button
            type="button"
            onClick={() => setInvertYForFasterUp((prev) => !prev)}
            className="min-h-[28px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Toggle whether lower seconds (faster times) are at the bottom or top of the Y-axis"
          >
            {invertYForFasterUp ? 'Y-Axis: Faster ↑ (Inverted)' : 'Y-Axis: Duration (s) ↑'}
          </button>

          {/* Secondary Power/HR Overlay Toggle */}
          <button
            type="button"
            onClick={() => setShowOverlayMetric((prev) => !prev)}
            className={`min-h-[28px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
              showOverlayMetric
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-500'
            }`}
          >
            {showOverlayMetric ? 'Power/HR Overlay: On' : 'Power/HR Overlay: Off'}
          </button>

          {onScanMoreSegments && (
            <button
              type="button"
              onClick={onScanMoreSegments}
              disabled={isScanningSegments}
              className="min-h-[28px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-[11px] font-semibold text-blue-600 dark:text-blue-400 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3 h-3 ${isScanningSegments ? 'animate-spin' : ''}`} />
              <span>{isScanningSegments ? 'Scanning...' : 'Scan +30 Workouts'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Multi-Attempt Segment Selector Bar */}
      {showSegmentPicker && segments.length > 1 && (
        <div className="space-y-2.5">
          {!compact && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                {(['ALL', 'Cycling', 'Running'] as const).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => {
                      setSportFilter(sp);
                      setHoverIdx(null);
                    }}
                    className={`min-h-[28px] px-2.5 py-0.5 rounded-md font-semibold transition-colors ${
                      sportFilter === sp
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {sp === 'ALL' ? `All Multi-Attempt Segments (${segments.length})` : sp}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter repeated segments..."
                  className="w-full min-h-[30px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 pl-8 pr-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 max-h-28 overflow-y-auto pr-1">
            {filteredSegments.slice(0, 40).map((seg, segIdx) => {
              const isSelected = seg.segmentId === activeSegment.segmentId;
              return (
                <button
                  key={`${seg.segmentId}-${segIdx}`}
                  type="button"
                  onClick={() => {
                    onSelectSegmentId(seg.segmentId);
                    setHoverIdx(null);
                  }}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{seg.name}</span>
                  <span
                    className={`font-mono text-[11px] ml-1.5 font-bold ${
                      isSelected ? 'text-blue-100' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {seg.efforts.length} attempts · PR {seg.prElapsedTimeSecs}s
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4 Summary KPI Cards (All showing exact seconds + mm:ss) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] font-sans text-slate-500 flex items-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            <span>Personal Record (PR #1)</span>
          </div>
          <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {prEffort.elapsedTimeSecs}s{' '}
            <span className="text-xs font-normal text-slate-500">
              ({formatStopwatch(prEffort.elapsedTimeSecs)})
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Set on {prEffort.date}
            {prEffort.avgWatts ? ` · ${prEffort.avgWatts}W` : ''}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] font-sans text-slate-500 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
            <span>First vs. Latest Attempt</span>
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {firstEffort.elapsedTimeSecs}s → {latestEffort.elapsedTimeSecs}s
          </div>
          <div
            className={`text-[11px] font-semibold mt-0.5 ${
              netChangeFirstToLatestSecs <= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {netChangeFirstToLatestSecs <= 0
              ? `${netChangeFirstToLatestSecs}s faster vs. 1st attempt`
              : `+${netChangeFirstToLatestSecs}s vs. 1st attempt`}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] font-sans text-slate-500 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-500" />
            <span>Peak Progression Gain</span>
          </div>
          <div className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400 mt-0.5">
            {netChangeFirstToPrSecs <= 0 ? `${netChangeFirstToPrSecs}s` : `0s`}{' '}
            <span className="text-xs font-normal text-slate-500">
              (
              {firstEffort.elapsedTimeSecs > 0
                ? `${Math.abs(
                    Math.round((netChangeFirstToPrSecs / firstEffort.elapsedTimeSecs) * 1000) / 10
                  )}%`
                : '0%'}
              )
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            1st ({firstEffort.elapsedTimeSecs}s) → PR ({prEffort.elapsedTimeSecs}s)
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] font-sans text-slate-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Average Across {len} Attempts</span>
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {avgDurationSecs}s{' '}
            <span className="text-xs font-normal text-slate-500">
              ({formatStopwatch(avgDurationSecs)})
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Range: {prEffort.elapsedTimeSecs}s – {Math.max(...efforts.map((e) => e.elapsedTimeSecs))}
            s
          </div>
        </div>
      </div>

      {/* Interactive Hover Readout Banner */}
      {activeHoveredEffort && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-xs font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              Attempt #{activeHoveredIndex + 1} of {len} · {activeHoveredEffort.date}
            </span>
            <span className="font-sans text-slate-600 dark:text-slate-300 truncate max-w-[220px]">
              ({activeHoveredEffort.activityName})
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
              Duration: {activeHoveredEffort.elapsedTimeSecs}s (
              {formatStopwatch(activeHoveredEffort.elapsedTimeSecs)})
            </span>
            <span
              className={`font-semibold ${
                activeHoveredEffort.elapsedTimeSecs - activeSegment.prElapsedTimeSecs <= 0
                  ? 'text-amber-600 dark:text-amber-400 font-bold'
                  : 'text-slate-500'
              }`}
            >
              {activeHoveredEffort.elapsedTimeSecs - activeSegment.prElapsedTimeSecs <= 0
                ? '👑 All-Time PR #1'
                : `+${
                    activeHoveredEffort.elapsedTimeSecs - activeSegment.prElapsedTimeSecs
                  }s vs PR`}
            </span>
            {activeHoveredEffort.avgWatts && (
              <span className="text-blue-600 dark:text-blue-400 font-bold">
                {activeHoveredEffort.avgWatts}W (
                {(activeHoveredEffort.avgWatts / athleteWeightKg).toFixed(2)} W/kg)
              </span>
            )}
            {activeHoveredEffort.avgPaceSecsPerKm && (
              <span className="text-blue-600 dark:text-blue-400 font-bold">
                {formatPace(activeHoveredEffort.avgPaceSecsPerKm, distanceUnit)}
              </span>
            )}
            {activeHoveredEffort.avgHr && (
              <span className="text-rose-500 font-bold">{activeHoveredEffort.avgHr} bpm</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentActivityId &&
              activeHoveredEffort.activityId === currentActivityId &&
              onZoomToSegmentWindow &&
              activeHoveredEffort.startTimeSecs !== undefined &&
              activeHoveredEffort.endTimeSecs !== undefined && (
                <button
                  type="button"
                  onClick={() =>
                    onZoomToSegmentWindow(
                      Math.max(0, (activeHoveredEffort.startTimeSecs || 0) - 10),
                      (activeHoveredEffort.endTimeSecs || 0) + 10
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-sans font-semibold transition-colors"
                >
                  <ZoomIn className="w-3 h-3" />
                  <span>Zoom Segment on Stream &amp; Map</span>
                </button>
              )}
            {onSelectActivity && activeHoveredEffort.activityId !== currentActivityId && (
              <button
                type="button"
                onClick={() => onSelectActivity(activeHoveredEffort.activityId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[11px] font-sans font-semibold transition-colors"
              >
                <span>Inspect Workout</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main SVG 'Effort Over Time' Chart: Y = Duration (in seconds), X = Date */}
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/50 p-3 select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox="0 0 900 265" className="w-full h-64 overflow-visible">
          {(() => {
            const chartLeft = 82;
            const chartRight = showOverlayMetric ? 820 : 865;
            const chartW = chartRight - chartLeft;
            const chartTop = 22;
            const chartBottom = 202;
            const chartH = chartBottom - chartTop;

            const times = efforts.map((e) => e.elapsedTimeSecs);
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);
            const padSecs = Math.max(3, Math.ceil((maxTime - minTime) * 0.16));
            const lowT = Math.max(1, minTime - padSecs);
            const highT = maxTime + padSecs;
            const spanT = Math.max(6, highT - lowT);

            // Standard Y-axis: lowT at bottom, highT at top (Duration in seconds increases upward)
            // Or Inverted Y-axis: highT at bottom, lowT at top (Faster = higher)
            const toYDurationSecs = (secs: number) => {
              if (invertYForFasterUp) {
                return chartBottom - ((highT - secs) / spanT) * chartH;
              }
              return chartBottom - ((secs - lowT) / spanT) * chartH;
            };

            // Compute X coordinates either by Calendar Date timestamp or by Attempt Sequence
            const timestamps = efforts.map((e) => {
              const t = new Date(e.startDateLocal || e.date).getTime();
              return Number.isNaN(t) ? 0 : t;
            });
            const minTs = Math.min(...timestamps);
            const maxTs = Math.max(...timestamps);
            const tsSpan = maxTs - minTs;

            const xCoords: number[] = efforts.map((_, i) => {
              if (xSpacingMode === 'ATTEMPT_ORDER' || tsSpan < 86400 * 1000) {
                return chartLeft + (i / Math.max(1, len - 1)) * chartW;
              }
              // Blend 82% true date proportion + 18% sequence index so same-day repeats never overlap 100%
              const dateFrac = (timestamps[i] - minTs) / Math.max(1, tsSpan);
              const seqFrac = i / Math.max(1, len - 1);
              const blendedFrac = dateFrac * 0.85 + seqFrac * 0.15;
              return chartLeft + blendedFrac * chartW;
            });

            // Secondary overlay (Watts or HR)
            const wattsArr = efforts.map((e) => e.avgWatts || 0).filter((w) => w > 0);
            const useWatts = wattsArr.length >= 2;
            const secondaryVals = efforts.map((e) => (useWatts ? e.avgWatts || 0 : e.avgHr || 0));
            const validSecondary = secondaryVals.filter((v) => v > 0);
            const minSec =
              validSecondary.length > 0 ? Math.max(40, Math.min(...validSecondary) * 0.9) : 100;
            const maxSec =
              validSecondary.length > 0 ? Math.max(minSec + 20, Math.max(...validSecondary) * 1.08) : 300;
            const toYSecondary = (v: number) =>
              chartBottom - ((v - minSec) / Math.max(10, maxSec - minSec)) * chartH;

            // Linear Regression Trendline of Duration (seconds) over attempt index
            let regSlope = 0;
            let regIntercept = avgDurationSecs;
            if (len >= 2) {
              const meanX = (len - 1) / 2;
              const meanY = times.reduce((a, b) => a + b, 0) / len;
              let num = 0;
              let den = 0;
              for (let i = 0; i < len; i++) {
                num += (i - meanX) * (times[i] - meanY);
                den += (i - meanX) * (i - meanX);
              }
              regSlope = den > 0 ? num / den : 0;
              regIntercept = meanY - regSlope * meanX;
            }
            const trendStartSecs = regIntercept;
            const trendEndSecs = regIntercept + regSlope * (len - 1);

            const durationPointsStr = efforts
              .map((e, i) => `${xCoords[i]},${toYDurationSecs(e.elapsedTimeSecs)}`)
              .join(' ');

            const areaPathStr =
              len >= 2
                ? `M ${xCoords[0]},${chartBottom} ` +
                  efforts
                    .map((e, i) => `L ${xCoords[i]},${toYDurationSecs(e.elapsedTimeSecs)}`)
                    .join(' ') +
                  ` L ${xCoords[len - 1]},${chartBottom} Z`
                : '';

            const secondaryPointsStr =
              showOverlayMetric && validSecondary.length >= 2
                ? efforts
                    .map((e, i) => {
                      const val = useWatts ? e.avgWatts : e.avgHr;
                      return val && val > 0 ? `${xCoords[i]},${toYSecondary(val)}` : null;
                    })
                    .filter(Boolean)
                    .join(' ')
                : '';

            const prY = toYDurationSecs(activeSegment.prElapsedTimeSecs);

            return (
              <>
                <defs>
                  <linearGradient id="effortDurationAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Left Y-Axis Title: Duration (in seconds) */}
                <text
                  x={18}
                  y={112}
                  transform="rotate(-90 18 112)"
                  textAnchor="middle"
                  className="fill-emerald-600 dark:fill-emerald-400 text-[11px] font-sans font-bold"
                >
                  Duration in Seconds (s · mm:ss)
                </text>

                {/* Right Y-Axis Title (if overlay enabled) */}
                {showOverlayMetric && validSecondary.length >= 2 && (
                  <text
                    x={884}
                    y={112}
                    transform="rotate(90 884 112)"
                    textAnchor="middle"
                    className={`text-[11px] font-sans font-bold ${
                      useWatts ? 'fill-blue-500' : 'fill-rose-500'
                    }`}
                  >
                    {useWatts ? 'Average Power (Watts)' : 'Average Heart Rate (bpm)'}
                  </text>
                )}

                {/* Horizontal Grid Lines & Y-Axis Ticks (in Seconds + mm:ss) */}
                {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                  const y = chartBottom - f * chartH;
                  const tSecs = Math.round(
                    invertYForFasterUp ? highT - f * spanT : lowT + f * spanT
                  );
                  const secVal = Math.round(minSec + f * (maxSec - minSec));
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
                        className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-mono font-semibold"
                      >
                        {tSecs}s ({formatStopwatch(tSecs)})
                      </text>
                      {showOverlayMetric && validSecondary.length >= 2 && (
                        <text
                          x={chartRight + 8}
                          y={y + 4}
                          className={`${
                            useWatts ? 'fill-blue-500' : 'fill-rose-500'
                          } text-[10px] font-mono`}
                        >
                          {useWatts ? `${secVal}W` : `${secVal}bpm`}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Area Under Duration Curve */}
                {areaPathStr && <path d={areaPathStr} fill="url(#effortDurationAreaGrad)" />}

                {/* All-Time PR Reference Line */}
                <line
                  x1={chartLeft}
                  y1={prY}
                  x2={chartRight}
                  y2={prY}
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                  strokeOpacity="0.85"
                />
                <text
                  x={chartRight - 4}
                  y={Math.max(14, prY - 5)}
                  textAnchor="end"
                  className="fill-amber-500 text-[10px] font-mono font-bold"
                >
                  PR #1: {activeSegment.prElapsedTimeSecs}s (
                  {formatStopwatch(activeSegment.prElapsedTimeSecs)})
                </text>

                {/* Linear Progression Trendline */}
                {len >= 2 && (
                  <line
                    x1={xCoords[0]}
                    y1={toYDurationSecs(trendStartSecs)}
                    x2={xCoords[len - 1]}
                    y2={toYDurationSecs(trendEndSecs)}
                    stroke="#94A3B8"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    strokeOpacity="0.65"
                  />
                )}

                {/* Secondary Power / Heart Rate Polyline */}
                {secondaryPointsStr && (
                  <polyline
                    fill="none"
                    stroke={useWatts ? '#3B82F6' : '#F43F5E'}
                    strokeWidth="1.75"
                    strokeOpacity="0.75"
                    points={secondaryPointsStr}
                  />
                )}

                {/* Primary Duration (in seconds) Polyline */}
                <polyline
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.75"
                  points={durationPointsStr}
                />

                {/* Effort Nodes, X-Axis Date Labels & Hit Targets */}
                {efforts.map((e, i) => {
                  const x = xCoords[i];
                  const y = toYDurationSecs(e.elapsedTimeSecs);
                  const isPr = e.prRank === 1;
                  const isCurrentAct = Boolean(
                    currentActivityId && e.activityId === currentActivityId
                  );
                  const isHovered = activeHoveredIndex === i;

                  const prevX = i > 0 ? xCoords[i - 1] : chartLeft;
                  const nextX = i < len - 1 ? xCoords[i + 1] : chartRight;
                  const hitLeft = i === 0 ? chartLeft : (prevX + x) / 2;
                  const hitRight = i === len - 1 ? chartRight : (x + nextX) / 2;

                  const showDateTick =
                    i === 0 ||
                    i === len - 1 ||
                    isPr ||
                    isCurrentAct ||
                    len <= 7 ||
                    i % Math.ceil(len / 6) === 0;

                  return (
                    <g key={`${e.effortId}-${i}`}>
                      {/* Vertical Crosshair on Active Hover */}
                      {isHovered && (
                        <line
                          x1={x}
                          y1={chartTop}
                          x2={x}
                          y2={chartBottom}
                          stroke="#10B981"
                          strokeWidth="1.25"
                          strokeDasharray="3 2"
                        />
                      )}

                      {/* Highlight Ring for Current Activity */}
                      {isCurrentAct && (
                        <circle
                          cx={x}
                          cy={y}
                          r={9}
                          fill="none"
                          stroke="#3B82F6"
                          strokeWidth="2.5"
                        />
                      )}

                      {/* Effort Data Point */}
                      <circle
                        cx={x}
                        cy={y}
                        r={isPr || isHovered || isCurrentAct ? 5.5 : 4}
                        fill={isPr ? '#F59E0B' : isCurrentAct ? '#3B82F6' : '#10B981'}
                        stroke="#0F172A"
                        strokeWidth="1.5"
                      />

                      {/* Direct Seconds Label Above Point for PR, First, Latest, or Hovered */}
                      {(isPr || isHovered || i === 0 || i === len - 1) && (
                        <text
                          x={x}
                          y={Math.max(13, y - 9)}
                          textAnchor="middle"
                          className={`text-[10px] font-mono font-bold ${
                            isPr
                              ? 'fill-amber-500'
                              : isCurrentAct
                                ? 'fill-blue-500'
                                : 'fill-slate-700 dark:fill-slate-200'
                          }`}
                        >
                          {e.elapsedTimeSecs}s
                        </text>
                      )}

                      {/* X-Axis Date Tick */}
                      {showDateTick && (
                        <text
                          x={x}
                          y={220}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                        >
                          {e.date}
                        </text>
                      )}

                      {/* Interactive Hover & Click Hit Target */}
                      <rect
                        x={hitLeft}
                        y={chartTop}
                        width={Math.max(14, hitRight - hitLeft)}
                        height={chartH + 26}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoverIdx(i)}
                        onClick={() => {
                          if (
                            currentActivityId &&
                            e.activityId === currentActivityId &&
                            onZoomToSegmentWindow &&
                            e.startTimeSecs !== undefined &&
                            e.endTimeSecs !== undefined
                          ) {
                            onZoomToSegmentWindow(
                              Math.max(0, e.startTimeSecs - 10),
                              e.endTimeSecs + 10
                            );
                          } else if (onSelectActivity) {
                            onSelectActivity(e.activityId);
                          }
                        }}
                      />
                    </g>
                  );
                })}

                {/* X-Axis Title */}
                <text
                  x={chartLeft + chartW / 2}
                  y={246}
                  textAnchor="middle"
                  className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                >
                  X-Axis: Attempt Date (YYYY-MM-DD · Gold = PR #1 · Dashed = Linear Trend · Click Point to Inspect)
                </text>
              </>
            );
          })()}
        </svg>
      </div>

      {/* Chronological Attempt History Table (with exact Duration in seconds + mm:ss) */}
      {!compact && (
        <div className="overflow-x-auto pt-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 pr-3">Attempt # &amp; Date</th>
                <th className="py-2 px-3">Workout</th>
                <th className="py-2 px-3 text-right">Duration (Seconds)</th>
                <th className="py-2 px-3 text-right">Stopwatch (mm:ss)</th>
                <th className="py-2 px-3 text-right">Power / Pace</th>
                <th className="py-2 px-3 text-right">Avg HR</th>
                <th className="py-2 pl-3 text-right">PR Rank / vs. 1st Attempt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {[...efforts].reverse().map((eff, revIdx) => {
                const chronologicalIdx = efforts.indexOf(eff);
                const deltaPr = eff.elapsedTimeSecs - activeSegment.prElapsedTimeSecs;
                const deltaFirst = eff.elapsedTimeSecs - firstEffort.elapsedTimeSecs;
                const isCurrent = Boolean(
                  currentActivityId && eff.activityId === currentActivityId
                );

                return (
                  <tr
                    key={`${eff.effortId}-${revIdx}`}
                    onMouseEnter={() => setHoverIdx(chronologicalIdx)}
                    onClick={() => {
                      if (
                        isCurrent &&
                        onZoomToSegmentWindow &&
                        eff.startTimeSecs !== undefined &&
                        eff.endTimeSecs !== undefined
                      ) {
                        onZoomToSegmentWindow(
                          Math.max(0, eff.startTimeSecs - 10),
                          eff.endTimeSecs + 10
                        );
                      } else if (onSelectActivity) {
                        onSelectActivity(eff.activityId);
                      }
                    }}
                    className={`cursor-pointer transition-colors ${
                      isCurrent
                        ? 'bg-blue-500/10 dark:bg-blue-500/15 font-semibold'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                    }`}
                  >
                    <td className="py-2 pr-3 text-slate-900 dark:text-slate-100">
                      <span className="text-slate-400 mr-1.5">#{chronologicalIdx + 1}</span>
                      <span className="font-bold">{eff.date}</span>
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                      {eff.activityName}
                      {isCurrent && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold">
                          Current
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {eff.elapsedTimeSecs}s
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                      {formatStopwatch(eff.elapsedTimeSecs)}
                    </td>
                    <td className="py-2 px-3 text-right text-blue-600 dark:text-blue-400">
                      {eff.avgWatts
                        ? `${eff.avgWatts}W (${(eff.avgWatts / athleteWeightKg).toFixed(2)} W/kg)`
                        : eff.avgPaceSecsPerKm
                          ? formatPace(eff.avgPaceSecsPerKm, distanceUnit)
                          : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                      {eff.avgHr ? `${eff.avgHr} bpm` : '—'}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {eff.prRank === 1 || deltaPr <= 0 ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">
                          👑 PR #1 ({deltaFirst <= 0 ? `${deltaFirst}s` : `+${deltaFirst}s`} vs #1)
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          +{deltaPr}s vs PR ·{' '}
                          <span
                            className={
                              deltaFirst <= 0
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            {deltaFirst <= 0 ? `${deltaFirst}s` : `+${deltaFirst}s`} vs 1st
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
