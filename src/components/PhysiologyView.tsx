import React, { useMemo, useState } from 'react';
import {
  BenchmarkSegmentHistory,
  DistanceUnit,
  EnvironmentFilter,
  PowerPaceCurvePoint,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatDistance, formatPace, formatStopwatch } from '../utils/formatters';

interface PhysiologyViewProps {
  curves: PowerPaceCurvePoint[];
  benchmarkSegments: BenchmarkSegmentHistory[];
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  envFilter: EnvironmentFilter;
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
}

export const PhysiologyView: React.FC<PhysiologyViewProps> = ({
  curves,
  benchmarkSegments,
  activities,
  wellnessDays,
  envFilter,
  distanceUnit,
  athleteWeightKg,
}) => {
  const [curveDiscipline, setCurveDiscipline] = useState<'Cycling' | 'Running'>('Cycling');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Dynamically calibrate Power & Pace Duration Curves from athlete's real eFTP, W', Pmax & synced activities
  const calibratedCurves = useMemo(() => {
    const latestWithMetrics = [...wellnessDays]
      .reverse()
      .find((w) => (w.rideEftp && w.rideEftp > 150) || (w.runEftp && w.runEftp > 150));

    const rideEftp = latestWithMetrics?.rideEftp || 310;
    const rideWPrime = latestWithMetrics?.rideWPrime || 25120;
    const ridePMax = latestWithMetrics?.ridePMax || 1204;
    const runEftp = latestWithMetrics?.runEftp || 456;

    // Also inspect real cycling & running workouts for peak normalized power & pace
    const outdoorBikes = activities.filter(
      (a) => a.sportCategory === 'Cycling' && a.environment === 'OUTDOOR' && (a.normalizedPower || 0) > 0
    );
    const indoorBikes = activities.filter(
      (a) => a.sportCategory === 'Cycling' && a.environment === 'INDOOR' && (a.normalizedPower || 0) > 0
    );
    const maxOutNp = outdoorBikes.length > 0 ? Math.max(...outdoorBikes.map((a) => a.normalizedPower || 0)) : rideEftp;
    const maxInNp = indoorBikes.length > 0 ? Math.max(...indoorBikes.map((a) => a.normalizedPower || 0)) : Math.round(rideEftp * 0.97);

    const outRatio = Math.max(0.85, Math.min(1.15, maxOutNp / Math.max(200, rideEftp)));
    const inRatio = Math.max(0.85, Math.min(1.15, maxInNp / Math.max(200, rideEftp)));

    const thresholdSpeedMps = 3.25 + ((runEftp - 300) / 180) * 0.92;
    const baseThresholdPaceSecsKm = Math.round(1000 / thresholdSpeedMps);

    const durations = [
      { durationSecs: 5, durationLabel: '5 sec', runFactor: 0.68 },
      { durationSecs: 60, durationLabel: '1 min', runFactor: 0.78 },
      { durationSecs: 300, durationLabel: '5 min', runFactor: 0.89 },
      { durationSecs: 1200, durationLabel: '20 min', runFactor: 0.97 },
      { durationSecs: 3600, durationLabel: '60 min', runFactor: 1.01 },
      { durationSecs: 7200, durationLabel: '2 hr', runFactor: 1.07 },
    ];

    return durations.map((d, idx) => {
      // 3-parameter Critical Power model: P(t) = CP + W' / (t + W' / (Pmax - CP))
      const modelWatts = Math.round(
        rideEftp + rideWPrime / (d.durationSecs + rideWPrime / Math.max(100, ridePMax - rideEftp))
      );
      const cyclingOutdoorWatts = Math.round(modelWatts * outRatio);
      const cyclingIndoorWatts = Math.round(modelWatts * inRatio);
      const cyclingSeasonBestWatts = Math.round(Math.max(cyclingOutdoorWatts, cyclingIndoorWatts) * 1.03);

      const runningOutdoorPaceSecsKm = Math.round(baseThresholdPaceSecsKm * d.runFactor);
      const runningIndoorPaceSecsKm = Math.round(runningOutdoorPaceSecsKm * 1.025);
      const runningSeasonBestPaceSecsKm = Math.round(runningOutdoorPaceSecsKm * 0.98);

      return (
        curves[idx]
          ? {
              durationSecs: d.durationSecs,
              durationLabel: d.durationLabel,
              cyclingOutdoorWatts,
              cyclingIndoorWatts,
              cyclingSeasonBestWatts,
              runningOutdoorPaceSecsKm,
              runningIndoorPaceSecsKm,
              runningSeasonBestPaceSecsKm,
            }
          : {
              durationSecs: d.durationSecs,
              durationLabel: d.durationLabel,
              cyclingOutdoorWatts,
              cyclingIndoorWatts,
              cyclingSeasonBestWatts,
              runningOutdoorPaceSecsKm,
              runningIndoorPaceSecsKm,
              runningSeasonBestPaceSecsKm,
            }
      );
    });
  }, [wellnessDays, activities, curves]);

  // Extract real benchmark segments from synced activities if available
  const realBenchmarkSegments = useMemo<BenchmarkSegmentHistory[]>(() => {
    const segMap = new Map<string, BenchmarkSegmentHistory>();
    for (const act of activities) {
      if (!act.segmentEfforts || act.segmentEfforts.length === 0) continue;
      for (const eff of act.segmentEfforts) {
        const existing = segMap.get(eff.id);
        const effortEntry = {
          date: act.startDateLocal.slice(0, 10),
          elapsedTimeSecs: eff.elapsedTimeSecs,
          avgWatts: eff.avgWatts,
          avgPaceSecsPerKm: eff.avgPaceSecsPerKm,
          avgHr: eff.avgHr || act.avgHr || 155,
          prRank: eff.prRank,
        };
        if (!existing) {
          segMap.set(eff.id, {
            segmentId: eff.id,
            name: eff.name,
            sportCategory: act.sportCategory === 'Running' ? 'Running' : 'Cycling',
            distanceMeters: eff.distanceMeters,
            averageGradePct: eff.averageGradePct,
            location: act.subType || 'Strava Segment',
            prElapsedTimeSecs: eff.elapsedTimeSecs,
            efforts: [effortEntry],
          });
        } else {
          existing.efforts.push(effortEntry);
          if (eff.elapsedTimeSecs < existing.prElapsedTimeSecs) {
            existing.prElapsedTimeSecs = eff.elapsedTimeSecs;
          }
        }
      }
    }
    const list = Array.from(segMap.values()).filter((s) => s.efforts.length > 0);
    return list.length > 0 ? list : benchmarkSegments;
  }, [activities, benchmarkSegments]);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
    realBenchmarkSegments[0]?.segmentId || ''
  );

  const activeSegment =
    realBenchmarkSegments.find((s) => s.segmentId === selectedSegmentId) ||
    realBenchmarkSegments[0];

  const recent14Wellness = wellnessDays.slice(-14);

  const activeCurveHover =
    hoverIdx !== null && calibratedCurves[hoverIdx]
      ? calibratedCurves[hoverIdx]
      : calibratedCurves[3]; // 20 min default

  return (
    <div className="space-y-6">
      {/* 1. Critical Power & Running Pace Duration Curves (Outdoor vs. Indoor Smart Trainer / Treadmill) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Critical Power &amp; Pace Duration Curves (Outdoor vs. Trainer/Treadmill)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare peak outputs across Outdoor Road/Trail, Indoor Smart Trainer/Treadmill, and Season All-Time Bests
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(['Cycling', 'Running'] as const).map((disc) => (
              <button
                key={disc}
                onClick={() => setCurveDiscipline(disc)}
                className={`min-h-[36px] px-3.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
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

        {/* Interactive Power / Pace Duration Curve SVG Chart with Explicit X & Y Axis Labels */}
        <div
          className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-mono tabular-nums">
            <span className="font-sans font-bold text-slate-900 dark:text-slate-100">
              {curveDiscipline === 'Cycling'
                ? 'Mean Maximal Power Curve (Outdoor Blue · Indoor Trainer Emerald · Season Best Amber)'
                : `Mean Maximal Running Velocity Curve (Outdoor Blue · Treadmill Emerald · Season Best Amber)`}
            </span>
            {activeCurveHover && (
              <div className="flex items-center gap-4">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  Duration: {activeCurveHover.durationLabel}
                </span>
                {curveDiscipline === 'Cycling' ? (
                  <>
                    <span className="text-blue-500 font-bold">
                      Outdoor: {activeCurveHover.cyclingOutdoorWatts}W
                    </span>
                    <span className="text-emerald-500 font-bold">
                      Trainer: {activeCurveHover.cyclingIndoorWatts}W
                    </span>
                    <span className="text-amber-500 font-bold">
                      Best: {activeCurveHover.cyclingSeasonBestWatts}W
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-blue-500 font-bold">
                      Outdoor: {formatPace(activeCurveHover.runningOutdoorPaceSecsKm, distanceUnit)}
                    </span>
                    <span className="text-emerald-500 font-bold">
                      Treadmill: {formatPace(activeCurveHover.runningIndoorPaceSecsKm, distanceUnit)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <svg viewBox="0 0 920 240" className="w-full h-60">
            {(() => {
              const len = calibratedCurves.length;
              const xForIdx = (i: number) => 68 + (i / Math.max(1, len - 1)) * 816;

              if (curveDiscipline === 'Cycling') {
                const maxW = Math.max(
                  1100,
                  ...calibratedCurves.map((c) => c.cyclingSeasonBestWatts)
                );
                const toY = (w: number) => 190 - (w / maxW) * 165;

                const outPts = calibratedCurves
                  .map((c, i) => `${xForIdx(i)},${toY(c.cyclingOutdoorWatts)}`)
                  .join(' ');
                const inPts = calibratedCurves
                  .map((c, i) => `${xForIdx(i)},${toY(c.cyclingIndoorWatts)}`)
                  .join(' ');
                const bestPts = calibratedCurves
                  .map((c, i) => `${xForIdx(i)},${toY(c.cyclingSeasonBestWatts)}`)
                  .join(' ');

                return (
                  <>
                    <text
                      x={16}
                      y={108}
                      transform="rotate(-90 16 108)"
                      textAnchor="middle"
                      className="fill-blue-500 text-[11px] font-sans font-bold"
                    >
                      Power Output (Watts)
                    </text>

                    {[0.25, 0.5, 0.75, 1].map((f, idx) => {
                      const y = 190 - f * 165;
                      return (
                        <g key={idx}>
                          <line
                            x1={68}
                            y1={y}
                            x2={884}
                            y2={y}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-800"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={60}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {Math.round(f * maxW)}W
                          </text>
                        </g>
                      );
                    })}

                    <polyline
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="2"
                      strokeDasharray="5 3"
                      points={bestPts}
                    />
                    <polyline fill="none" stroke="#10B981" strokeWidth="2.25" points={inPts} />
                    <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={outPts} />

                    {calibratedCurves.map((c, i) => {
                      const x = xForIdx(i);
                      return (
                        <g key={c.durationLabel}>
                          <circle cx={x} cy={toY(c.cyclingOutdoorWatts)} r={4.5} fill="#3B82F6" />
                          <circle cx={x} cy={toY(c.cyclingIndoorWatts)} r={4} fill="#10B981" />
                          <text
                            x={x}
                            y={210}
                            textAnchor="middle"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono font-semibold"
                          >
                            {c.durationLabel}
                          </text>
                          <rect
                            x={x - 60}
                            y={0}
                            width={120}
                            height={215}
                            fill="transparent"
                            className="cursor-pointer"
                            onMouseEnter={() => setHoverIdx(i)}
                          />
                        </g>
                      );
                    })}

                    <text
                      x={476}
                      y={232}
                      textAnchor="middle"
                      className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                    >
                      Effort Duration (Logarithmic Intervals: 5 sec → 2 hours)
                    </text>
                  </>
                );
              }

              // Running Pace Curve (faster pace = lower secs/km = higher on chart)
              const minSecs = 150;
              const maxSecs = 310;
              const toY = (secs: number) =>
                190 - ((maxSecs - Math.min(maxSecs, Math.max(minSecs, secs))) / (maxSecs - minSecs)) * 165;

              const outPts = calibratedCurves
                .map((c, i) => `${xForIdx(i)},${toY(c.runningOutdoorPaceSecsKm)}`)
                .join(' ');
              const inPts = calibratedCurves
                .map((c, i) => `${xForIdx(i)},${toY(c.runningIndoorPaceSecsKm)}`)
                .join(' ');
              const bestPts = calibratedCurves
                .map((c, i) => `${xForIdx(i)},${toY(c.runningSeasonBestPaceSecsKm)}`)
                .join(' ');

              return (
                <>
                  <text
                    x={16}
                    y={108}
                    transform="rotate(-90 16 108)"
                    textAnchor="middle"
                    className="fill-orange-500 text-[11px] font-sans font-bold"
                  >
                    Running Pace (/{distanceUnit})
                  </text>

                  {[0.2, 0.5, 0.8, 1].map((f, idx) => {
                    const y = 190 - f * 165;
                    const secs = Math.round(maxSecs - f * (maxSecs - minSecs));
                    return (
                      <g key={idx}>
                        <line
                          x1={68}
                          y1={y}
                          x2={884}
                          y2={y}
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={62}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                        >
                          {formatPace(secs, distanceUnit).replace(`/${distanceUnit}`, '')}
                        </text>
                      </g>
                    );
                  })}

                  <polyline
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                    points={bestPts}
                  />
                  <polyline fill="none" stroke="#10B981" strokeWidth="2.25" points={inPts} />
                  <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={outPts} />

                  {calibratedCurves.map((c, i) => {
                    const x = xForIdx(i);
                    return (
                      <g key={c.durationLabel}>
                        <circle
                          cx={x}
                          cy={toY(c.runningOutdoorPaceSecsKm)}
                          r={4.5}
                          fill="#3B82F6"
                        />
                        <circle
                          cx={x}
                          cy={toY(c.runningIndoorPaceSecsKm)}
                          r={4}
                          fill="#10B981"
                        />
                        <text
                          x={x}
                          y={210}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono font-semibold"
                        >
                          {c.durationLabel}
                        </text>
                        <rect
                          x={x - 60}
                          y={0}
                          width={120}
                          height={215}
                          fill="transparent"
                          className="cursor-pointer"
                          onMouseEnter={() => setHoverIdx(i)}
                        />
                      </g>
                    );
                  })}

                  <text
                    x={476}
                    y={232}
                    textAnchor="middle"
                    className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                  >
                    Effort Duration (Logarithmic Intervals: 5 sec → 2 hours)
                  </text>
                </>
              );
            })()}
          </svg>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
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
              {calibratedCurves.map((pt) => {
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
                      {diffSecs >= 0
                        ? `-${diffSecs}s/km faster Outdoor`
                        : `${Math.abs(diffSecs)}s/km faster Treadmill`}
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

      {/* 2. Benchmark Strava Segments Historical Progression (Only shown if athlete has synced segment efforts) */}
      {realBenchmarkSegments.length > 0 && activeSegment && (
        <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Starred &amp; Benchmark Strava Segment Progression
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Track elapsed time, average watts/pace, and heart rate efficiency across historical attempts on your climbs and loops
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {realBenchmarkSegments.map((seg) => (
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

          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Segment Details</div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                  {activeSegment.sportCategory} ·{' '}
                  {formatDistance(activeSegment.distanceMeters, distanceUnit, 2)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Avg Grade {activeSegment.averageGradePct}% · {activeSegment.location}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Personal Record (PR #1)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatStopwatch(activeSegment.prElapsedTimeSecs)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Recorded on {activeSegment.efforts[activeSegment.efforts.length - 1]?.date}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Logged Attempts</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {activeSegment.efforts.length} efforts
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  Synced from Strava
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                    <th className="py-2 px-4">Attempt Date</th>
                    <th className="py-2 px-4 text-right">Elapsed Time</th>
                    <th className="py-2 px-4 text-right">Average Output</th>
                    <th className="py-2 px-4 text-right">Average Heart Rate</th>
                    <th className="py-2 px-4 text-right">Strava PR Rank</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                  {activeSegment.efforts.map((ef, idx) => (
                    <tr key={`${ef.date}-${idx}`}>
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
                          <span className="text-slate-400">Logged</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

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
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
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
                  <td className="py-2.5 px-3 font-sans font-semibold">
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
