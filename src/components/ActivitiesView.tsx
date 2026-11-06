import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
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

interface ActivitiesViewProps {
  activities: UnifiedActivity[];
  selectedSport: SportCategory | 'ALL';
  onSelectSport: (sport: SportCategory | 'ALL') => void;
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  selectedActivity: UnifiedActivity | null;
  onSelectActivity: (activity: UnifiedActivity | null) => void;
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
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);
  const [streamHoverIndex, setStreamHoverIndex] = useState<number | null>(null);

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

  return (
    <div className="space-y-6">
      {/* Filter & All-Time Archive Summary Header Card */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              All-Time Activity Explorer, Interval Splits &amp; Similar Workout Matcher
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Browse all {activities.length.toLocaleString()} historical workouts across Garmin Connect, Intervals.icu, and Strava, inspect auto-detected intervals, and compare repeat sessions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                  <th className="py-3 px-4 text-right">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredActivities.slice(0, visibleLimit).map((act) => {
                  const isSelected = selectedActivity?.id === act.id;
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
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {act.name}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 font-mono text-xs">
                          {act.startDateLocal.slice(0, 10)} · {act.gearName || act.deviceName || act.subType}
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
              <button
                onClick={() => onSelectActivity(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                aria-label="Close inspector"
              >
                <X className="w-4 h-4" />
              </button>
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

              {/* Synchronized Time-Series Stream Scrubber with Explicit X & Y Axis Labels */}
              {selectedActivity.streams && selectedActivity.streams.time.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Second-by-Second Telemetry Stream (Power/Pace · Blue &amp; Heart Rate · Red)
                    </h3>
                    {streamHoverIndex !== null && (
                      <div className="text-xs font-mono tabular-nums flex items-center gap-3">
                        <span className="text-slate-500 font-semibold">
                          Elapsed: {formatStopwatch(selectedActivity.streams.time[streamHoverIndex] || 0)}
                        </span>
                        {selectedActivity.streams.watts && (
                          <span className="text-blue-500 font-bold">
                            Power: {selectedActivity.streams.watts[streamHoverIndex]} W
                          </span>
                        )}
                        {selectedActivity.streams.velocitySmooth && (
                          <span className="text-blue-500 font-bold">
                            Pace:{' '}
                            {formatPace(
                              1000 /
                                Math.max(
                                  1,
                                  selectedActivity.streams.velocitySmooth[streamHoverIndex]
                                ),
                              distanceUnit
                            )}
                          </span>
                        )}
                        {selectedActivity.streams.heartrate && (
                          <span className="text-red-500 font-bold">
                            HR: {selectedActivity.streams.heartrate[streamHoverIndex]} bpm
                          </span>
                        )}
                        {selectedActivity.streams.cadence && (
                          <span className="text-emerald-500 font-semibold">
                            Cadence: {selectedActivity.streams.cadence[streamHoverIndex]} rpm/spm
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <svg
                    viewBox="0 0 840 195"
                    className="w-full h-48 select-none"
                    onMouseLeave={() => setStreamHoverIndex(null)}
                  >
                    {(() => {
                      const timeArr = selectedActivity.streams!.time;
                      const len = timeArr.length;
                      const hrArr = selectedActivity.streams!.heartrate || [];
                      const primaryArr =
                        selectedActivity.streams!.watts ||
                        (selectedActivity.streams!.velocitySmooth || []).map((v) => v * 80);

                      const maxPrimary = Math.max(350, ...primaryArr);
                      const hrPoints = hrArr
                        .map((hr, idx) => {
                          const x = 58 + (idx / Math.max(1, len - 1)) * 716;
                          const y = 148 - ((hr - 90) / 110) * 124;
                          return `${x},${Math.max(14, Math.min(150, y))}`;
                        })
                        .join(' ');

                      const primaryPoints = primaryArr
                        .map((val, idx) => {
                          const x = 58 + (idx / Math.max(1, len - 1)) * 716;
                          const y = 148 - (val / maxPrimary) * 124;
                          return `${x},${Math.max(14, Math.min(150, y))}`;
                        })
                        .join(' ');

                      const maxElapsedSecs = timeArr[len - 1] || selectedActivity.movingTimeSecs;

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
                            {selectedActivity.streams!.watts ? 'Power (Watts)' : 'Velocity / Output'}
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
                            const y = 148 - f * 124;
                            const pVal = Math.round(f * maxPrimary);
                            const hrVal = Math.round(90 + f * 110);
                            return (
                              <g key={idx}>
                                <line
                                  x1={58}
                                  y1={y}
                                  x2={774}
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

                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2"
                            points={primaryPoints}
                          />
                          <polyline
                            fill="none"
                            stroke="#EF4444"
                            strokeWidth="1.75"
                            points={hrPoints}
                          />

                          {/* X-Axis Elapsed Time Ticks & Label */}
                          {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                            const x = 58 + f * 716;
                            const tSecs = Math.round(f * maxElapsedSecs);
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
                            y={188}
                            textAnchor="middle"
                            className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                          >
                            Elapsed Workout Time (mm:ss)
                          </text>

                          {timeArr.map((_, idx) => {
                            const x = 58 + (idx / Math.max(1, len - 1)) * 716;
                            const colW = 716 / Math.max(1, len);
                            return (
                              <g key={idx}>
                                {streamHoverIndex === idx && (
                                  <line
                                    x1={x}
                                    y1={14}
                                    x2={x}
                                    y2={150}
                                    stroke="#3B82F6"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                )}
                                <rect
                                  x={x - colW / 2}
                                  y={0}
                                  width={colW}
                                  height={175}
                                  fill="transparent"
                                  className="cursor-crosshair"
                                  onMouseEnter={() => setStreamHoverIndex(idx)}
                                  onMouseMove={() => setStreamHoverIndex(idx)}
                                />
                              </g>
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                </div>
              )}

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
                          <th className="py-2 pl-3 text-right">Cadence / Drift</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                        {selectedActivity.intervals.map((iv) => (
                          <tr
                            key={iv.id}
                            className={
                              iv.type === 'WORK'
                                ? 'bg-blue-500/5 dark:bg-blue-500/10 font-medium'
                                : 'opacity-75'
                            }
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
                            <td className="py-2.5 pl-3 text-right">
                              {iv.avgCadence ? `${iv.avgCadence} rpm/spm` : '—'}
                              {iv.decouplingPct !== undefined ? ` · ${iv.decouplingPct}%` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                      Compare Output &amp; Heart Rate at Similar Distance/Duration
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
                          <th className="py-2 pl-3 text-right">Efficiency Factor (EF)</th>
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
                            <td className="py-2.5 pl-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                              {sim.efficiencyFactor || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Time in Heart Rate Zones with Explicit X & Y Axis Headers */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Time in Physiological Zones (Z1–Z6)
                  </h3>
                  <span className="text-xs font-mono text-slate-500">
                    Y-Axis: Physiological Zone · X-Axis: Share of Workout Time (%)
                  </span>
                </div>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-12 items-center gap-2 text-xs font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                    <div className="col-span-4 sm:col-span-3">Y-Axis: Intensity Zone</div>
                    <div className="col-span-5 sm:col-span-7 flex justify-between font-mono text-[11px]">
                      <span>0%</span>
                      <span>25%</span>
                      <span>50%</span>
                      <span>75%</span>
                      <span>100%</span>
                    </div>
                    <div className="col-span-3 sm:col-span-2 text-right">Duration &amp; %</div>
                  </div>
                  {selectedActivity.zoneSecs.hr.slice(0, 6).map((secs, idx) => {
                    const totalZoneSecs = Math.max(
                      1,
                      selectedActivity.zoneSecs.hr.reduce((a, b) => a + b, 0)
                    );
                    const pct = Math.round((secs / totalZoneSecs) * 100);
                    const zoneLabels = [
                      'Z1 Recovery',
                      'Z2 Aerobic Endurance',
                      'Z3 Tempo / Sweet Spot',
                      'Z4 Lactate Threshold',
                      'Z5 VO2max',
                      'Z6 Anaerobic Capacity',
                    ];
                    return (
                      <div key={idx} className="grid grid-cols-12 items-center gap-2 text-xs sm:text-sm">
                        <div className="col-span-4 sm:col-span-3 font-medium text-slate-700 dark:text-slate-300 truncate">
                          {zoneLabels[idx]}
                        </div>
                        <div className="col-span-5 sm:col-span-7 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className={`h-full ${
                              idx <= 1
                                ? 'bg-blue-500'
                                : idx === 2
                                  ? 'bg-emerald-500'
                                  : idx === 3
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                            }`}
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 font-semibold">
                          {Math.round(secs / 60)}m ({pct}%)
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-center text-xs font-semibold text-slate-500 pt-1">
                    X-Axis: Percentage of Total Workout Moving Time (0% – 100%)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
