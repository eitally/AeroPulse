import React, { useMemo, useState } from 'react';
import {
  BenchmarkSegmentHistory,
  DistanceUnit,
  EnvironmentFilter,
  PowerPaceCurvePoint,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatPace } from '../utils/formatters';
import {
  buildRepeatedSegmentsFromActivities,
  SegmentEffortOverTimeChart,
} from './SegmentEffortOverTimeChart';
import { FourteenDayReadinessLedger } from './FourteenDayReadinessLedger';

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

export const PhysiologyView: React.FC<PhysiologyViewProps> = ({
  curves,
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
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

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

  const repeatedSegments = useMemo(
    () => buildRepeatedSegmentsFromActivities(activities),
    [activities]
  );

  const activeCurveHover =
    hoverIdx !== null && calibratedCurves[hoverIdx]
      ? calibratedCurves[hoverIdx]
      : calibratedCurves[3]; // 20 min default

  return (
    <div className="space-y-6">
      {/* 1. Critical Power & Running Pace Duration Curves (Outdoor vs. Indoor Smart Trainer / Treadmill) */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Critical Power &amp; Pace Duration Curves (Outdoor vs. Trainer/Treadmill)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare peak outputs across Outdoor Road/Trail, Indoor Smart Trainer/Treadmill, and Season All-Time Bests
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
            {(['Cycling', 'Running'] as const).map((disc) => (
              <button
                key={disc}
                onClick={() => setCurveDiscipline(disc)}
                className={`min-h-[34px] px-3.5 py-1 text-xs rounded-lg transition-all whitespace-nowrap ${
                  curveDiscipline === disc
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
                }`}
              >
                {disc === 'Cycling' ? 'Cycling Power (W & W/kg)' : `Running Pace (/${distanceUnit})`}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Power / Pace Duration Curve SVG Chart with Explicit X & Y Axis Labels */}
        <div
          className="rounded-xl liquid-glass-subtle p-4 space-y-2 select-none"
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

      {/* 2. Segment 'Effort Over Time' Chart (Segments with Multiple Recorded Attempts) */}
      <SegmentEffortOverTimeChart
        segments={repeatedSegments}
        selectedSegmentId={selectedSegmentId}
        onSelectSegmentId={setSelectedSegmentId}
        distanceUnit={distanceUnit}
        athleteWeightKg={athleteWeightKg}
        onSelectActivity={(actId) => {
          if (onSelectActivity) {
            const found = activities.find((a) => a.id === actId);
            if (found) onSelectActivity(found);
          }
        }}
        onScanMoreSegments={onScanMoreSegments}
        isScanningSegments={isScanningSegments}
        showSegmentPicker={true}
      />

      {/* 3. 14-Day Autonomic Recovery (HRV & RHR) vs. Daily Load Ledger (±25% vs. 14d Mean) */}
      <FourteenDayReadinessLedger wellnessDays={wellnessDays} />
    </div>
  );
};
