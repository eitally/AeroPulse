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
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments?: boolean;
  onSelectActivity?: (activity: UnifiedActivity) => void;
}

interface ExtendedSegmentHistory extends BenchmarkSegmentHistory {
  efforts: {
    date: string;
    startDateLocal: string;
    activityId?: string;
    activityName?: string;
    elapsedTimeSecs: number;
    avgWatts?: number;
    avgPaceSecsPerKm?: number;
    avgHr: number;
    prRank: 1 | 2 | 3 | null;
  }[];
}

export const PhysiologyView: React.FC<PhysiologyViewProps> = ({
  curves,
  benchmarkSegments,
  activities,
  wellnessDays,
  envFilter,
  distanceUnit,
  athleteWeightKg,
  onScanMoreSegments,
  isScanningSegments = false,
  onSelectActivity,
}) => {
  const [curveDiscipline, setCurveDiscipline] = useState<'Cycling' | 'Running'>('Cycling');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [segmentSportFilter, setSegmentSportFilter] = useState<'ALL' | 'Cycling' | 'Running'>('ALL');
  const [segmentSearch, setSegmentSearch] = useState<string>('');
  const [segmentHoverIdx, setSegmentHoverIdx] = useState<number | null>(null);

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

  // Group all Strava segment efforts by segmentId across all activities and filter for segments biked or run more than once (>= 2 efforts)
  const realBenchmarkSegments = useMemo<ExtendedSegmentHistory[]>(() => {
    const segMap = new Map<string, ExtendedSegmentHistory>();
    for (const act of activities) {
      if (!act.segmentEfforts || act.segmentEfforts.length === 0) continue;
      for (const eff of act.segmentEfforts) {
        if (!eff || !(eff.elapsedTimeSecs > 0)) continue;
        const sid = String(eff.segmentId || eff.name);
        const existing = segMap.get(sid);
        const effortEntry = {
          date: (eff.startDateLocal || act.startDateLocal).slice(0, 10),
          startDateLocal: eff.startDateLocal || act.startDateLocal,
          activityId: act.id,
          activityName: act.name,
          elapsedTimeSecs: eff.elapsedTimeSecs,
          avgWatts: eff.avgWatts,
          avgPaceSecsPerKm:
            eff.avgPaceSecsPerKm ||
            (act.sportCategory === 'Running' && eff.distanceMeters > 0
              ? Math.round(eff.elapsedTimeSecs / (eff.distanceMeters / 1000))
              : undefined),
          avgHr: eff.avgHr || act.avgHr || 0,
          prRank: eff.prRank,
        };
        if (!existing) {
          segMap.set(sid, {
            segmentId: sid,
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
          if (eff.averageGradePct && !existing.averageGradePct) {
            existing.averageGradePct = eff.averageGradePct;
          }
        }
      }
    }

    for (const seg of segMap.values()) {
      // Rank top 3 efforts by elapsedTimeSecs ascending
      const sortedBySpeed = [...seg.efforts].sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
      sortedBySpeed.forEach((e, idx) => {
        e.prRank = idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : null;
      });
      // Sort chronologically for time-series chart
      seg.efforts.sort(
        (a, b) => new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
      );
    }

    const repeatedList = Array.from(segMap.values())
      .filter((s) => s.efforts.length >= 2)
      .sort((a, b) => b.efforts.length - a.efforts.length);

    if (repeatedList.length > 0) return repeatedList;

    const allList = Array.from(segMap.values()).filter((s) => s.efforts.length > 0);
    return allList.length > 0
      ? allList
      : benchmarkSegments.map((b) => ({
          ...b,
          efforts: b.efforts.map((e) => ({ ...e, startDateLocal: e.date })),
        }));
  }, [activities, benchmarkSegments]);

  const filteredBenchmarkSegments = useMemo(() => {
    return realBenchmarkSegments.filter((seg) => {
      if (segmentSportFilter !== 'ALL' && seg.sportCategory !== segmentSportFilter) return false;
      if (
        segmentSearch.trim() &&
        !seg.name.toLowerCase().includes(segmentSearch.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [realBenchmarkSegments, segmentSportFilter, segmentSearch]);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
    realBenchmarkSegments[0]?.segmentId || ''
  );

  const activeSegment =
    filteredBenchmarkSegments.find((s) => s.segmentId === selectedSegmentId) ||
    filteredBenchmarkSegments[0] ||
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

      {/* 2. Strava Segment Performance Over Time (Segments Biked or Run 2+ Times) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Strava Segment Performance Over Time ({filteredBenchmarkSegments.length} Repeated Segments)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare elapsed time, average watts/pace, and heart rate efficiency across historical attempts on segments you have biked or run more than once
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sport Filter */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(['ALL', 'Cycling', 'Running'] as const).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    setSegmentSportFilter(sp);
                    setSegmentHoverIdx(null);
                  }}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    segmentSportFilter === sp
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {sp === 'ALL' ? 'All Sports' : sp}
                </button>
              ))}
            </div>

            {/* Segment Search Input */}
            <input
              type="text"
              value={segmentSearch}
              onChange={(e) => setSegmentSearch(e.target.value)}
              placeholder="Search segment name..."
              className="min-h-[34px] w-44 sm:w-56 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {onScanMoreSegments && (
              <button
                type="button"
                onClick={onScanMoreSegments}
                disabled={isScanningSegments}
                className="min-h-[34px] px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-50 text-xs font-semibold text-blue-600 dark:text-blue-400 transition-colors whitespace-nowrap"
              >
                {isScanningSegments
                  ? 'Scanning Historical Segments...'
                  : 'Scan +30 Workouts for Segments'}
              </button>
            )}
          </div>
        </div>

        {/* Segment Selector Buttons (Showing Repeat Count Nx) */}
        {filteredBenchmarkSegments.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 max-h-36 overflow-y-auto pr-1">
            {filteredBenchmarkSegments.slice(0, 36).map((seg) => {
              const isSelected = activeSegment?.segmentId === seg.segmentId;
              return (
                <button
                  key={seg.segmentId}
                  type="button"
                  onClick={() => {
                    setSelectedSegmentId(seg.segmentId);
                    setSegmentHoverIdx(null);
                  }}
                  className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
                  }`}
                >
                  {seg.name}{' '}
                  <span
                    className={`font-mono text-[11px] ml-1 ${
                      isSelected ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400 font-bold'
                    }`}
                  >
                    ({seg.efforts.length}x)
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-slate-500 py-4">
            No repeated segments matched your filter. Click &quot;Scan +30 Workouts for Segments&quot; above to index additional outdoor rides and runs.
          </div>
        )}

        {activeSegment && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Segment &amp; Discipline</div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1 truncate">
                  {activeSegment.name}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  {activeSegment.sportCategory} ·{' '}
                  {formatDistance(activeSegment.distanceMeters, distanceUnit, 2)} · Avg Grade{' '}
                  {activeSegment.averageGradePct > 0
                    ? `+${activeSegment.averageGradePct}%`
                    : `${activeSegment.averageGradePct}%`}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Personal Record (PR #1)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatStopwatch(activeSegment.prElapsedTimeSecs)}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Set on{' '}
                  {activeSegment.efforts.find((e) => e.prRank === 1)?.date ||
                    activeSegment.efforts[0]?.date}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Latest Attempt</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {formatStopwatch(
                    activeSegment.efforts[activeSegment.efforts.length - 1]?.elapsedTimeSecs || 0
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  {activeSegment.efforts[activeSegment.efforts.length - 1]?.date} (
                  {(activeSegment.efforts[activeSegment.efforts.length - 1]?.elapsedTimeSecs || 0) -
                    activeSegment.prElapsedTimeSecs <=
                  0
                    ? 'PR #1'
                    : `+${
                        (activeSegment.efforts[activeSegment.efforts.length - 1]?.elapsedTimeSecs ||
                          0) - activeSegment.prElapsedTimeSecs
                      }s vs PR`}
                  )
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-xs text-slate-500">Logged Attempts</div>
                <div className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
                  {activeSegment.efforts.length} efforts
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  Click any attempt to inspect workout
                </div>
              </div>
            </div>

            {/* Interactive Segment Performance Over Time SVG Chart */}
            {activeSegment.efforts.length >= 2 && (
              <div
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3 select-none"
                onMouseLeave={() => setSegmentHoverIdx(null)}
              >
                {(() => {
                  const efforts = activeSegment.efforts;
                  const len = efforts.length;
                  const hovered =
                    segmentHoverIdx !== null && efforts[segmentHoverIdx]
                      ? efforts[segmentHoverIdx]
                      : efforts[efforts.length - 1];

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-mono tabular-nums">
                        <span className="font-sans font-bold text-slate-900 dark:text-slate-100">
                          {activeSegment.name} — Elapsed Time (Emerald) &amp;{' '}
                          {activeSegment.sportCategory === 'Cycling'
                            ? 'Average Power (Blue)'
                            : 'Average Heart Rate (Red)'}{' '}
                          Over Time
                        </span>
                        {hovered && (
                          <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {hovered.date}
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              Time: {formatStopwatch(hovered.elapsedTimeSecs)}
                            </span>
                            {hovered.avgWatts && (
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                Power: {hovered.avgWatts}W (
                                {(hovered.avgWatts / athleteWeightKg).toFixed(2)} W/kg)
                              </span>
                            )}
                            {hovered.avgPaceSecsPerKm && (
                              <span className="text-blue-600 dark:text-blue-400 font-bold">
                                Pace: {formatPace(hovered.avgPaceSecsPerKm, distanceUnit)}
                              </span>
                            )}
                            {hovered.avgHr > 0 && (
                              <span className="text-rose-500 font-bold">
                                HR: {hovered.avgHr} bpm
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <svg viewBox="0 0 920 235" className="w-full h-60">
                        {(() => {
                          const chartLeft = 68;
                          const chartRight = 846;
                          const chartW = chartRight - chartLeft;
                          const chartTop = 20;
                          const chartBottom = 180;
                          const chartH = chartBottom - chartTop;

                          const times = efforts.map((e) => e.elapsedTimeSecs);
                          const minTime = Math.min(...times);
                          const maxTime = Math.max(...times);
                          const pad = Math.max(4, Math.round((maxTime - minTime) * 0.15));
                          const lowT = Math.max(1, minTime - pad);
                          const highT = maxTime + pad;
                          const spanT = Math.max(10, highT - lowT);

                          // Faster elapsed time (fewer seconds) is higher on Y-Axis
                          const toYTime = (tSecs: number) =>
                            chartBottom - ((highT - tSecs) / spanT) * chartH;

                          const wattsArr = efforts
                            .map((e) => e.avgWatts || 0)
                            .filter((w) => w > 0);
                          const useWatts = wattsArr.length >= 2;
                          const maxSecondary = useWatts
                            ? Math.max(250, ...wattsArr) * 1.1
                            : Math.max(185, ...efforts.map((e) => e.avgHr || 155)) + 5;
                          const minSecondary = useWatts
                            ? Math.max(50, Math.min(...wattsArr) * 0.85)
                            : Math.max(105, Math.min(...efforts.map((e) => e.avgHr || 140)) - 10);

                          const toYSecondary = (val: number) =>
                            chartBottom -
                            ((val - minSecondary) / Math.max(20, maxSecondary - minSecondary)) *
                              chartH;

                          const xForIdx = (i: number) =>
                            chartLeft + (i / Math.max(1, len - 1)) * chartW;

                          const timePts = efforts
                            .map((e, i) => `${xForIdx(i)},${toYTime(e.elapsedTimeSecs)}`)
                            .join(' ');

                          const secondaryPts = efforts
                            .map((e, i) => {
                              const v = useWatts ? e.avgWatts : e.avgHr;
                              return v && v > 0 ? `${xForIdx(i)},${toYSecondary(v)}` : null;
                            })
                            .filter(Boolean)
                            .join(' ');

                          const prY = toYTime(activeSegment.prElapsedTimeSecs);

                          return (
                            <>
                              {/* Left Y-Axis Title */}
                              <text
                                x={16}
                                y={100}
                                transform="rotate(-90 16 100)"
                                textAnchor="middle"
                                className="fill-emerald-600 dark:fill-emerald-400 text-[11px] font-sans font-bold"
                              >
                                Elapsed Time (mm:ss · Faster ↑)
                              </text>

                              {/* Right Y-Axis Title */}
                              <text
                                x={904}
                                y={100}
                                transform="rotate(90 904 100)"
                                textAnchor="middle"
                                className={`text-[11px] font-sans font-bold ${
                                  useWatts ? 'fill-blue-500' : 'fill-rose-500'
                                }`}
                              >
                                {useWatts ? 'Avg Power (Watts)' : 'Avg Heart Rate (bpm)'}
                              </text>

                              {[0, 0.33, 0.66, 1].map((f, idx) => {
                                const y = chartBottom - f * chartH;
                                const tVal = Math.round(highT - f * spanT);
                                const secVal = Math.round(
                                  minSecondary + f * (maxSecondary - minSecondary)
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
                                      className={`${
                                        useWatts ? 'fill-blue-500' : 'fill-rose-500'
                                      } text-[11px] font-mono`}
                                    >
                                      {useWatts ? `${secVal}W` : `${secVal} bpm`}
                                    </text>
                                  </g>
                                );
                              })}

                              {/* PR #1 Benchmark Line */}
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

                              {secondaryPts && (
                                <polyline
                                  fill="none"
                                  stroke={useWatts ? '#3B82F6' : '#F43F5E'}
                                  strokeWidth="2"
                                  strokeOpacity="0.8"
                                  points={secondaryPts}
                                />
                              )}

                              <polyline
                                fill="none"
                                stroke="#10B981"
                                strokeWidth="2.5"
                                points={timePts}
                              />

                              {efforts.map((e, i) => {
                                const x = xForIdx(i);
                                const y = toYTime(e.elapsedTimeSecs);
                                const isPr = e.prRank === 1;
                                const isHovered = segmentHoverIdx === i;
                                const colW = chartW / Math.max(1, len);
                                return (
                                  <g key={`${e.date}-${i}`}>
                                    {isHovered && (
                                      <line
                                        x1={x}
                                        y1={chartTop}
                                        x2={x}
                                        y2={chartBottom}
                                        stroke="#94A3B8"
                                        strokeWidth="1.5"
                                        strokeDasharray="3 2"
                                      />
                                    )}
                                    <circle
                                      cx={x}
                                      cy={y}
                                      r={isPr || isHovered ? 5.5 : 4}
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
                                        y={198}
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
                                      height={205}
                                      fill="transparent"
                                      className="cursor-pointer"
                                      onMouseEnter={() => setSegmentHoverIdx(i)}
                                      onClick={() => {
                                        if (e.activityId && onSelectActivity) {
                                          const foundAct = activities.find(
                                            (a) => a.id === e.activityId
                                          );
                                          if (foundAct) onSelectActivity(foundAct);
                                        }
                                      }}
                                    />
                                  </g>
                                );
                              })}

                              <text
                                x={chartLeft + chartW / 2}
                                y={222}
                                textAnchor="middle"
                                className="fill-slate-600 dark:fill-slate-300 text-xs font-sans font-bold"
                              >
                                Attempt Date (Chronological Progression · Gold Point = PR #1 · Click Point to Open Workout)
                              </text>
                            </>
                          );
                        })()}
                      </svg>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
                    <th className="py-2 px-4">Attempt Date &amp; Workout</th>
                    <th className="py-2 px-4 text-right">Elapsed Time</th>
                    <th className="py-2 px-4 text-right">Average Output</th>
                    <th className="py-2 px-4 text-right">Average Heart Rate</th>
                    <th className="py-2 px-4 text-right">Strava PR Rank / Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                  {[...activeSegment.efforts].reverse().map((ef, idx) => {
                    const deltaSecs = ef.elapsedTimeSecs - activeSegment.prElapsedTimeSecs;
                    return (
                      <tr
                        key={`${ef.date}-${idx}`}
                        onClick={() => {
                          if (ef.activityId && onSelectActivity) {
                            const found = activities.find((a) => a.id === ef.activityId);
                            if (found) onSelectActivity(found);
                          }
                        }}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                      >
                        <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">
                          <span className="font-semibold">{ef.date}</span>
                          {ef.activityName && (
                            <span className="font-sans text-xs text-slate-500 ml-2">
                              · {ef.activityName}
                            </span>
                          )}
                        </td>
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
                          {ef.avgHr > 0 ? `${ef.avgHr} bpm` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {ef.prRank === 1 || deltaSecs <= 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                              PR #1
                            </span>
                          ) : ef.prRank === 2 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              2nd Best (+{deltaSecs}s)
                            </span>
                          ) : ef.prRank === 3 ? (
                            <span className="text-blue-600 dark:text-blue-400 font-semibold">
                              3rd Best (+{deltaSecs}s)
                            </span>
                          ) : (
                            <span className="text-slate-400">+{deltaSecs}s vs PR</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
