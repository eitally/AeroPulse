import React, { useState } from 'react';
import {
  BenchmarkSegmentHistory,
  DistanceUnit,
  EnvironmentFilter,
  PowerPaceCurvePoint,
  UnifiedWellnessDay,
} from '../types';
import { formatDistance, formatPace, formatStopwatch } from '../utils/formatters';

interface PhysiologyViewProps {
  curves: PowerPaceCurvePoint[];
  benchmarkSegments: BenchmarkSegmentHistory[];
  wellnessDays: UnifiedWellnessDay[];
  envFilter: EnvironmentFilter;
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
}

export const PhysiologyView: React.FC<PhysiologyViewProps> = ({
  curves,
  benchmarkSegments,
  wellnessDays,
  envFilter,
  distanceUnit,
  athleteWeightKg,
}) => {
  const [curveDiscipline, setCurveDiscipline] = useState<'Cycling' | 'Running'>('Cycling');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
    benchmarkSegments[0]?.segmentId || ''
  );

  const activeSegment =
    benchmarkSegments.find((s) => s.segmentId === selectedSegmentId) || benchmarkSegments[0];

  const recent14Wellness = wellnessDays.slice(-14);

  return (
    <div className="space-y-6">
      {/* 1. Critical Power & Running Pace Duration Curves (Outdoor vs. Indoor Smart Trainer / Treadmill) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Critical Power & Pace Duration Curves (Outdoor vs. Trainer/Treadmill)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare 42-day peak outputs across Outdoor Road/Trail, Indoor Smart Trainer/Treadmill, and Season Bests
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(['Cycling', 'Running'] as const).map((disc) => (
              <button
                key={disc}
                onClick={() => setCurveDiscipline(disc)}
                className={`min-h-[34px] px-3.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  curveDiscipline === disc
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {disc === 'Cycling' ? 'Cycling Power (W & W/kg)' : `Running Pace (/${distanceUnit})`}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2.5 px-4">Duration</th>
                <th className="py-2.5 px-4 text-right">
                  Outdoor Peak {envFilter === 'OUTDOOR' ? '(Active Filter)' : ''}
                </th>
                <th className="py-2.5 px-4 text-right">
                  Indoor ({curveDiscipline === 'Cycling' ? 'Smart Trainer' : 'Treadmill'}){' '}
                  {envFilter === 'INDOOR' ? '(Active Filter)' : ''}
                </th>
                <th className="py-2.5 px-4 text-right">Outdoor vs. Indoor Delta</th>
                <th className="py-2.5 px-4 text-right">Season All-Time Best</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {curves.map((pt) => {
                if (curveDiscipline === 'Cycling') {
                  const outWkg = (pt.cyclingOutdoorWatts / athleteWeightKg).toFixed(2);
                  const inWkg = (pt.cyclingIndoorWatts / athleteWeightKg).toFixed(2);
                  const bestWkg = (pt.cyclingSeasonBestWatts / athleteWeightKg).toFixed(2);
                  const diffW = pt.cyclingOutdoorWatts - pt.cyclingIndoorWatts;
                  return (
                    <tr key={pt.durationLabel} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                        {pt.durationLabel}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-600 dark:text-blue-400 font-semibold">
                        {pt.cyclingOutdoorWatts} W ({outWkg} W/kg)
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                        {pt.cyclingIndoorWatts} W ({inWkg} W/kg)
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">
                        {diffW >= 0 ? `+${diffW} W Outdoor` : `${Math.abs(diffW)} W Indoor`}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-900 dark:text-slate-100 font-semibold">
                        {pt.cyclingSeasonBestWatts} W ({bestWkg} W/kg)
                      </td>
                    </tr>
                  );
                }

                const diffSecs = pt.runningIndoorPaceSecsKm - pt.runningOutdoorPaceSecsKm;
                return (
                  <tr key={pt.durationLabel} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                      {pt.durationLabel}
                    </td>
                    <td className="py-3 px-4 text-right text-blue-600 dark:text-blue-400 font-semibold">
                      {formatPace(pt.runningOutdoorPaceSecsKm, distanceUnit)}
                    </td>
                    <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                      {formatPace(pt.runningIndoorPaceSecsKm, distanceUnit)}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">
                      {diffSecs >= 0 ? `-${diffSecs}s/km faster Outdoor` : `${Math.abs(diffSecs)}s/km faster Treadmill`}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-900 dark:text-slate-100 font-semibold">
                      {formatPace(pt.runningSeasonBestPaceSecsKm, distanceUnit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Benchmark Strava Segments Historical Progression */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Starred & Benchmark Strava Segment Progression
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track elapsed time, average watts/pace, and heart rate efficiency across historical attempts on your key climbs and loops
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {benchmarkSegments.map((seg) => (
              <button
                key={seg.segmentId}
                onClick={() => setSelectedSegmentId(seg.segmentId)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                  selectedSegmentId === seg.segmentId
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
                }`}
              >
                {seg.name}
              </button>
            ))}
          </div>
        </div>

        {activeSegment && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Segment Details</div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {activeSegment.sportCategory} · {formatDistance(activeSegment.distanceMeters, distanceUnit, 2)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Avg Grade {activeSegment.averageGradePct}% · {activeSegment.location}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Current Personal Record (PR #1)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatStopwatch(activeSegment.prElapsedTimeSecs)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Set on {activeSegment.efforts[activeSegment.efforts.length - 1]?.date}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Target Goal Time</div>
                <div className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
                  {activeSegment.targetElapsedTimeSecs
                    ? formatStopwatch(activeSegment.targetElapsedTimeSecs)
                    : '—'}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  {activeSegment.targetElapsedTimeSecs
                    ? `${activeSegment.prElapsedTimeSecs - activeSegment.targetElapsedTimeSecs}s to shave off PR`
                    : 'Benchmark tracking'}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Progression Over {activeSegment.efforts.length} Efforts</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  -{activeSegment.efforts[0].elapsedTimeSecs - activeSegment.prElapsedTimeSecs}s faster
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  Consistent aerobic gain
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-4">Attempt Date</th>
                    <th className="py-2 px-4 text-right">Elapsed Time</th>
                    <th className="py-2 px-4 text-right">Average Output</th>
                    <th className="py-2 px-4 text-right">Average Heart Rate</th>
                    <th className="py-2 px-4 text-right">Strava PR Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                  {activeSegment.efforts.map((ef) => (
                    <tr key={ef.date}>
                      <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">{ef.date}</td>
                      <td className="py-2.5 px-4 text-right font-semibold text-slate-900 dark:text-slate-100">
                        {formatStopwatch(ef.elapsedTimeSecs)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-blue-600 dark:text-blue-400">
                        {ef.avgWatts
                          ? `${ef.avgWatts} W (${(ef.avgWatts / athleteWeightKg).toFixed(2)} W/kg)`
                          : ef.avgPaceSecsPerKm
                            ? formatPace(ef.avgPaceSecsPerKm, distanceUnit)
                            : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">
                        {ef.avgHr} bpm
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {ef.prRank === 1 ? (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">PR #1</span>
                        ) : ef.prRank === 2 ? (
                          <span className="text-slate-700 dark:text-slate-200">2nd Best</span>
                        ) : ef.prRank === 3 ? (
                          <span className="text-slate-500">3rd Best</span>
                        ) : (
                          <span className="text-slate-400">Baseline</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 3. 14-Day Autonomic Recovery (HRV & RHR) vs. Daily Load Log */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            14-Day Garmin/Intervals.icu Autonomic Recovery vs. Training Load Ledger
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Inspect how high daily TSS loads affect next-morning HRV rMSSD, Resting HR, and Sleep Score
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Readiness</th>
                <th className="py-2 px-3 text-right">HRV (7d Base)</th>
                <th className="py-2 px-3 text-right">Resting HR</th>
                <th className="py-2 px-3 text-right">Sleep Score</th>
                <th className="py-2 px-3 text-right">CTL / ATL / TSB</th>
                <th className="py-2 px-3 text-right">Daily Load</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {[...recent14Wellness].reverse().map((w) => (
                <tr key={w.date} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100">{w.date}</td>
                  <td className="py-2.5 px-3 font-sans font-medium">
                    <span
                      className={
                        w.readinessStatus === 'Optimal'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : w.readinessStatus === 'Caution'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-500'
                      }
                    >
                      {w.readinessStatus}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900 dark:text-slate-100">
                    {w.hrvRMSSD} ms <span className="text-slate-400">({w.hrvBaseline7d})</span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                    {w.restingHR} bpm
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                    {w.sleepScore}/100
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                    {w.ctl.toFixed(1)} / {w.atl.toFixed(1)} / {w.tsb > 0 ? `+${w.tsb}` : w.tsb}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold text-blue-600 dark:text-blue-400">
                    {w.dailyLoad} TSS
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
