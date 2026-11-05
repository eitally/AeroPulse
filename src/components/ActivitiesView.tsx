import React, { useMemo, useState } from 'react';
import { Award, Search, SlidersHorizontal, X } from 'lucide-react';
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
  const [streamHoverIndex, setStreamHoverIndex] = useState<number | null>(null);

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (selectedSport !== 'ALL' && act.sportCategory !== selectedSport) return false;
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) return false;
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
  }, [activities, selectedSport, envFilter, searchQuery]);

  // Aggregate summary of currently filtered workouts
  const summaryStats = useMemo(() => {
    const totalLoad = filteredActivities.reduce((acc, a) => acc + a.trainingLoad, 0);
    const totalDistanceMeters = filteredActivities.reduce((acc, a) => acc + a.distanceMeters, 0);
    const totalDurationSecs = filteredActivities.reduce((acc, a) => acc + a.movingTimeSecs, 0);
    const totalPrs = filteredActivities.reduce((acc, a) => acc + a.stravaPrCount, 0);
    const avgDecoupling =
      filteredActivities.length > 0
        ? (
            filteredActivities.reduce((acc, a) => acc + a.aerobicDecouplingPct, 0) /
            filteredActivities.length
          ).toFixed(1)
        : '0.0';
    return { totalLoad, totalDistanceMeters, totalDurationSecs, totalPrs, avgDecoupling };
  }, [filteredActivities]);

  return (
    <div className="space-y-6">
      {/* Filter & Summary Header Card */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Cross-Source Activity Explorer & Strava Segment Telemetry
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Filter by Outdoor road/trail vs. Indoor Smart Trainer & Treadmill, inspect second-by-second streams, and verify Strava segment PRs
            </p>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workout, shoe, bike..."
              className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Sport + Outdoor/Indoor Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(['ALL', 'Cycling', 'Running', 'Swimming', 'Strength'] as const).map((sport) => (
              <button
                key={sport}
                onClick={() => onSelectSport(sport)}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <span className="text-slate-500 block">Sessions</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{filteredActivities.length}</span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <span className="text-slate-500 block">Filtered Distance</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatDistance(summaryStats.totalDistanceMeters, distanceUnit, 1)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <span className="text-slate-500 block">Total Moving Time</span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formatDuration(summaryStats.totalDurationSecs)}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <span className="text-slate-500 block">Avg Decoupling</span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {summaryStats.avgDecoupling}%
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 px-3 py-2">
            <span className="text-slate-500 block">Strava Segment PRs</span>
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
              {summaryStats.totalPrs} PRs
            </span>
          </div>
        </div>
      </section>

      {/* High-Density Activity Table (Desktop) & Tap Cards (Mobile) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 overflow-hidden">
        {filteredActivities.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No workouts match your current Sport ({selectedSport}) and Environment ({envFilter}) filters.
            </p>
            <button
              onClick={() => {
                onSelectSport('ALL');
                onSelectEnvFilter('COMBINED');
                setSearchQuery('');
              }}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Date & Session</th>
                  <th className="py-3 px-3">Sport & Environment</th>
                  <th className="py-3 px-3 text-right">Distance / Time</th>
                  <th className="py-3 px-3 text-right">Output (NP / Pace)</th>
                  <th className="py-3 px-3 text-right">HR & Decoupling</th>
                  <th className="py-3 px-3 text-right">Load (TSS)</th>
                  <th className="py-3 px-4 text-right">Strava Segments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filteredActivities.map((act) => {
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
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {act.name}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                          {act.startDateLocal.slice(0, 10)} · {act.gearName || act.subType}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300">
                        <div>{act.sportCategory}</div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {act.environment === 'INDOOR' ? `Indoor · ${act.subType}` : `Outdoor · ${act.subType}`}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {act.distanceMeters > 0 ? formatDistance(act.distanceMeters, distanceUnit, 1) : '—'}
                        </div>
                        <div className="text-slate-500">
                          {formatDuration(act.movingTimeSecs)} · +{act.elevationGainMeters}m
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        {act.sportCategory === 'Running' && act.avgPaceSecsPerKm ? (
                          <>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {formatPace(act.avgPaceSecsPerKm, distanceUnit)}
                            </div>
                            <div className="text-slate-500">
                              GAP {formatPace(act.gapPaceSecsPerKm, distanceUnit)}
                            </div>
                          </>
                        ) : act.normalizedPower ? (
                          <>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              NP {act.normalizedPower}W
                            </div>
                            <div className="text-slate-500">
                              Avg {act.avgPower}W · IF {act.intensityFactor?.toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        <div className="text-slate-900 dark:text-slate-100">
                          {act.avgHr} / {act.maxHr} bpm
                        </div>
                        <div
                          className={
                            act.aerobicDecouplingPct <= 3.0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          Drift {act.aerobicDecouplingPct}% · EF {act.efficiencyFactor}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-blue-600 dark:text-blue-400">
                        {act.trainingLoad}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                        {act.segmentEfforts.length > 0 ? (
                          <div>
                            <span className="text-slate-900 dark:text-slate-100 font-medium">
                              {act.segmentEfforts.length} seg{act.segmentEfforts.length > 1 ? 's' : ''}
                            </span>
                            {act.stravaPrCount > 0 && (
                              <div className="text-amber-600 dark:text-amber-400 font-semibold">
                                {act.stravaPrCount} PR{act.stravaPrCount > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">0 segs</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Deep Activity Stream, Decoupling & Strava Segment Inspector Drawer / Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-6">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-t-3xl sm:rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto">
            {/* Mobile Drag Handle */}
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3" />

            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedActivity.sportCategory} ·{' '}
                  {selectedActivity.environment === 'INDOOR'
                    ? `Indoor (${selectedActivity.subType})`
                    : `Outdoor (${selectedActivity.subType})`}{' '}
                  · {selectedActivity.startDateLocal.replace('T', ' ').slice(0, 16)} · Synced via{' '}
                  {selectedActivity.sourceBadges.join(' + ')}
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
                  <div className="text-xs text-slate-500">Distance & Moving Time</div>
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
                    Training Load: {selectedActivity.trainingLoad} · IF {selectedActivity.intensityFactor || '0.82'}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Aerobic Decoupling (Pw:Hr / Pa:Hr)</div>
                  <div
                    className={`text-base font-bold font-mono tabular-nums mt-1 ${
                      selectedActivity.aerobicDecouplingPct <= 3.5
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {selectedActivity.aerobicDecouplingPct}% Drift
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    1st Half EF {selectedActivity.firstHalfEf} → 2nd Half EF {selectedActivity.secondHalfEf}
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-xs text-slate-500">Heart Rate & Cadence</div>
                  <div className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {selectedActivity.avgHr} bpm avg · {selectedActivity.maxHr} max
                  </div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Cadence: {selectedActivity.avgCadence || '—'}{' '}
                    {selectedActivity.sportCategory === 'Running' ? 'spm' : 'rpm'}
                  </div>
                </div>
              </div>

              {/* Synchronized Time-Series Stream Scrubber */}
              {selectedActivity.streams && selectedActivity.streams.time.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Second-by-Second Telemetry Stream (Intervals.icu / Garmin FIT)
                    </h3>
                    {streamHoverIndex !== null && (
                      <div className="text-xs font-mono tabular-nums flex items-center gap-3">
                        <span className="text-slate-500">
                          T+{formatStopwatch(selectedActivity.streams.time[streamHoverIndex] || 0)}
                        </span>
                        {selectedActivity.streams.watts && (
                          <span className="text-blue-500 font-semibold">
                            {selectedActivity.streams.watts[streamHoverIndex]} W
                          </span>
                        )}
                        {selectedActivity.streams.velocitySmooth && (
                          <span className="text-blue-500 font-semibold">
                            {formatPace(1000 / Math.max(1, selectedActivity.streams.velocitySmooth[streamHoverIndex]), distanceUnit)}
                          </span>
                        )}
                        {selectedActivity.streams.heartrate && (
                          <span className="text-red-500 font-semibold">
                            {selectedActivity.streams.heartrate[streamHoverIndex]} bpm
                          </span>
                        )}
                        {selectedActivity.streams.cadence && (
                          <span className="text-emerald-500">
                            {selectedActivity.streams.cadence[streamHoverIndex]} rpm/spm
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <svg
                    viewBox="0 0 760 150"
                    className="w-full h-36 select-none"
                    onMouseLeave={() => setStreamHoverIndex(null)}
                  >
                    {(() => {
                      const len = selectedActivity.streams!.time.length;
                      const hrArr = selectedActivity.streams!.heartrate || [];
                      const primaryArr =
                        selectedActivity.streams!.watts ||
                        (selectedActivity.streams!.velocitySmooth || []).map((v) => v * 80);

                      const maxPrimary = Math.max(350, ...primaryArr);
                      const hrPoints = hrArr
                        .map((hr, idx) => {
                          const x = 16 + (idx / Math.max(1, len - 1)) * 728;
                          const y = 135 - ((hr - 90) / 110) * 115;
                          return `${x},${Math.max(12, Math.min(138, y))}`;
                        })
                        .join(' ');

                      const primaryPoints = primaryArr
                        .map((val, idx) => {
                          const x = 16 + (idx / Math.max(1, len - 1)) * 728;
                          const y = 135 - (val / maxPrimary) * 115;
                          return `${x},${Math.max(12, Math.min(138, y))}`;
                        })
                        .join(' ');

                      return (
                        <>
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
                          {selectedActivity.streams!.time.map((_, idx) => {
                            const x = 16 + (idx / Math.max(1, len - 1)) * 728;
                            const colW = 728 / Math.max(1, len);
                            return (
                              <g key={idx}>
                                {streamHoverIndex === idx && (
                                  <line x1={x} y1={10} x2={x} y2={140} stroke="#94A3B8" strokeWidth="1" />
                                )}
                                <rect
                                  x={x - colW / 2}
                                  y={0}
                                  width={colW}
                                  height={150}
                                  fill="transparent"
                                  onMouseEnter={() => setStreamHoverIndex(idx)}
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

              {/* Strava Segment Efforts Table */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Strava Segment Performance ({selectedActivity.segmentEfforts.length} Matched Efforts)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    Synced via Strava API v3 include_all_efforts
                  </span>
                </div>

                {selectedActivity.segmentEfforts.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No timed Strava segments recorded on this session.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-3">Segment Name</th>
                          <th className="py-2 px-3 text-right">Distance & Grade</th>
                          <th className="py-2 px-3 text-right">Elapsed Time</th>
                          <th className="py-2 px-3 text-right">Output (Watts / Pace)</th>
                          <th className="py-2 px-3 text-right">Avg HR</th>
                          <th className="py-2 pl-3 text-right">Rank / Medal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                        {selectedActivity.segmentEfforts.map((se) => (
                          <tr key={se.id}>
                            <td className="py-2.5 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                              {se.name}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                              {formatDistance(se.distanceMeters, distanceUnit, 2)} · {se.averageGradePct}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                              {formatStopwatch(se.elapsedTimeSecs)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                              {se.avgWatts
                                ? `${se.avgWatts}W ${se.avgWattsPerKg ? `(${se.avgWattsPerKg} W/kg)` : ''}`
                                : se.avgPaceSecsPerKm
                                  ? formatPace(se.avgPaceSecsPerKm, distanceUnit)
                                  : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                              {se.avgHr ? `${se.avgHr} bpm` : '—'}
                            </td>
                            <td className="py-2.5 pl-3 text-right">
                              {se.prRank === 1 ? (
                                <span className="text-amber-600 dark:text-amber-400 font-bold">
                                  PR #1 {se.komRank ? `· Top ${se.komRank}` : ''}
                                </span>
                              ) : se.prRank === 2 ? (
                                <span className="text-slate-700 dark:text-slate-200 font-semibold">
                                  2nd Best
                                </span>
                              ) : se.prRank === 3 ? (
                                <span className="text-slate-600 dark:text-slate-400">3rd Best</span>
                              ) : (
                                <span className="text-slate-400">Completed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Time in Heart Rate Zones */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Time in Physiological Zones (Z1–Z6)
                </h3>
                <div className="space-y-2">
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
                      <div key={idx} className="grid grid-cols-12 items-center gap-2 text-xs">
                        <div className="col-span-4 sm:col-span-3 text-slate-600 dark:text-slate-300 truncate">
                          {zoneLabels[idx]}
                        </div>
                        <div className="col-span-5 sm:col-span-7 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
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
                        <div className="col-span-3 sm:col-span-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {Math.round(secs / 60)}m ({pct}%)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
