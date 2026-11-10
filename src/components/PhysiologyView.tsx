import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityStreamSet,
  AthleteProfile,
  BenchmarkSegmentHistory,
  DistanceUnit,
  EnvironmentFilter,
  PowerPaceCurvePoint,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatPace, formatStopwatch } from '../utils/formatters';
import { buildRepeatedSegmentsFromActivities } from './SegmentEffortOverTimeChart';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { AthletePerformanceRadar } from './AthletePerformanceRadar';
import { loadAllActivityStreamsMapFromDexie } from '../db/workoutStore';
import { buildEmpiricalMmpSummary } from '../physiology/mmpCurves';
import { computeFatigueSlicedDurability } from '../physiology/durabilityEngine';

interface PhysiologyViewProps {
  curves: PowerPaceCurvePoint[];
  benchmarkSegments: BenchmarkSegmentHistory[];
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  envFilter: EnvironmentFilter;
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
  athleteProfile?: AthleteProfile;
  onScanMoreSegments?: () => Promise<void>;
  isScanningSegments?: boolean;
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onOpenActivitiesSegments?: () => void;
}

export const PhysiologyView: React.FC<PhysiologyViewProps> = ({
  curves,
  activities,
  wellnessDays,
  envFilter,
  distanceUnit,
  athleteWeightKg,
  athleteProfile,
  onSelectActivity,
  onOpenActivitiesSegments,
}) => {
  const [curveDiscipline, setCurveDiscipline] = useState<'Cycling' | 'Running'>('Cycling');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [streamMap, setStreamMap] = useState<ReadonlyMap<string, ActivityStreamSet>>(
    () => new Map()
  );

  useEffect(() => {
    let active = true;
    loadAllActivityStreamsMapFromDexie()
      .then((loaded) => {
        if (active) setStreamMap(loaded);
      })
      .catch(() => {
        // Non-blocking fallback when IndexedDB is unavailable
      });
    return () => {
      active = false;
    };
  }, [activities.length]);

  const envFilteredActivities = useMemo(
    () =>
      envFilter === 'COMBINED'
        ? activities
        : activities.filter((a) => a.environment === envFilter),
    [activities, envFilter]
  );

  const empiricalSummary = useMemo(
    () => buildEmpiricalMmpSummary(envFilteredActivities, streamMap, athleteProfile),
    [envFilteredActivities, streamMap, athleteProfile]
  );

  const durabilityReport = useMemo(
    () =>
      computeFatigueSlicedDurability({
        discipline: curveDiscipline,
        activities: envFilteredActivities,
        streamMap,
        athleteProfile,
      }),
    [curveDiscipline, envFilteredActivities, streamMap, athleteProfile]
  );

  const empiricalByDuration = useMemo(() => {
    const map = new Map<number, (typeof empiricalSummary.points)[number]>();
    for (const pt of empiricalSummary.points) {
      map.set(pt.durationSecs, pt);
    }
    return map;
  }, [empiricalSummary.points]);

  // Dynamically calibrate Power & Pace Duration Curves from athlete's real eFTP, W', Pmax & synced activities
  const { calibratedCurves, hasPowerCalibration, hasPaceCalibration } = useMemo(() => {
    const latestWithMetrics = [...wellnessDays]
      .reverse()
      .find((w) => (w.rideEftp && w.rideEftp > 120) || (w.runEftp && w.runEftp > 120));

    const outdoorBikes = activities.filter(
      (a) =>
        a.sportCategory === 'Cycling' &&
        a.environment === 'OUTDOOR' &&
        (a.normalizedPower || a.avgPower || 0) > 0
    );
    const indoorBikes = activities.filter(
      (a) =>
        a.sportCategory === 'Cycling' &&
        a.environment === 'INDOOR' &&
        (a.normalizedPower || a.avgPower || 0) > 0
    );

    const maxOutNp =
      outdoorBikes.length > 0
        ? Math.max(...outdoorBikes.map((a) => a.normalizedPower || a.avgPower || 0))
        : 0;
    const maxInNp =
      indoorBikes.length > 0
        ? Math.max(...indoorBikes.map((a) => a.normalizedPower || a.avgPower || 0))
        : 0;

    const rideEftp =
      empiricalSummary.criticalPowerWatts ||
      latestWithMetrics?.rideEftp ||
      athleteProfile?.ftp ||
      athleteProfile?.indoorFtp ||
      Math.max(maxOutNp, maxInNp) ||
      0;
    const hasPower = rideEftp > 0;
    const rideWPrime =
      empiricalSummary.wPrimeJoules ||
      latestWithMetrics?.rideWPrime ||
      (hasPower ? Math.round(rideEftp * 75) : 0);
    const ridePMax =
      empiricalSummary.pMaxWatts ||
      latestWithMetrics?.ridePMax ||
      (hasPower ? Math.round(rideEftp * 3.6) : 0);

    const outRatio =
      hasPower && maxOutNp > 0
        ? Math.max(0.85, Math.min(1.15, maxOutNp / Math.max(150, rideEftp)))
        : hasPower
          ? 1
          : 0;
    const inRatio =
      hasPower && maxInNp > 0
        ? Math.max(0.85, Math.min(1.15, maxInNp / Math.max(150, rideEftp)))
        : hasPower && athleteProfile?.indoorFtp
          ? athleteProfile.indoorFtp / rideEftp
          : outRatio;

    const outdoorRuns = activities.filter(
      (a) =>
        a.sportCategory === 'Running' &&
        a.environment === 'OUTDOOR' &&
        (a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 0) > 0
    );
    const indoorRuns = activities.filter(
      (a) =>
        a.sportCategory === 'Running' &&
        a.environment === 'INDOOR' &&
        (a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 0) > 0
    );
    const bestOutRunPace =
      outdoorRuns.length > 0
        ? Math.min(...outdoorRuns.map((a) => a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 999))
        : 0;
    const bestInRunPace =
      indoorRuns.length > 0
        ? Math.min(...indoorRuns.map((a) => a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 999))
        : 0;

    const runEftp = latestWithMetrics?.runEftp || athleteProfile?.runFtp || 0;
    const baseThresholdPaceSecsKm =
      empiricalSummary.criticalPaceSecsPerKm ||
      athleteProfile?.thresholdPaceSecsPerKm ||
      (bestOutRunPace > 0 && bestOutRunPace < 900
        ? bestOutRunPace
        : runEftp > 0
          ? Math.round(1000 / (3.25 + ((runEftp - 300) / 180) * 0.92))
          : 0);
    const hasPace = baseThresholdPaceSecsKm > 0;

    const durations = [
      { durationSecs: 5, durationLabel: '5 sec', runFactor: 0.68 },
      { durationSecs: 60, durationLabel: '1 min', runFactor: 0.78 },
      { durationSecs: 300, durationLabel: '5 min', runFactor: 0.89 },
      { durationSecs: 1200, durationLabel: '20 min', runFactor: 0.97 },
      { durationSecs: 3600, durationLabel: '60 min', runFactor: 1.01 },
      { durationSecs: 7200, durationLabel: '2 hr', runFactor: 1.07 },
    ];

    const pts = durations.map((d, idx) => {
      if (curves[idx]) return curves[idx];
      const empiricalPt = empiricalByDuration.get(d.durationSecs);

      // 3-parameter Critical Power model: P(t) = CP + W' / (t + W' / (Pmax - CP))
      const modelWatts = hasPower
        ? Math.round(
            rideEftp + rideWPrime / (d.durationSecs + rideWPrime / Math.max(100, ridePMax - rideEftp))
          )
        : 0;
      const cyclingOutdoorWatts = hasPower ? Math.round(modelWatts * outRatio) : 0;
      const cyclingIndoorWatts = hasPower ? Math.round(modelWatts * inRatio) : 0;
      const cyclingSeasonBestWatts = Math.max(
        cyclingOutdoorWatts,
        cyclingIndoorWatts,
        empiricalPt?.bestWatts || 0
      );

      const runningOutdoorPaceSecsKm = hasPace
        ? Math.round(baseThresholdPaceSecsKm * d.runFactor)
        : 0;
      const runningIndoorPaceSecsKm =
        bestInRunPace > 0 && bestInRunPace < 900
          ? Math.round(bestInRunPace * d.runFactor)
          : runningOutdoorPaceSecsKm;
      const modeledBestPace =
        runningOutdoorPaceSecsKm > 0 && runningIndoorPaceSecsKm > 0
          ? Math.min(runningOutdoorPaceSecsKm, runningIndoorPaceSecsKm)
          : runningOutdoorPaceSecsKm || runningIndoorPaceSecsKm;
      const runningSeasonBestPaceSecsKm =
        empiricalPt?.bestGapSecsPerKm && empiricalPt.bestGapSecsPerKm > 0
          ? modeledBestPace > 0
            ? Math.min(modeledBestPace, Math.round(empiricalPt.bestGapSecsPerKm))
            : Math.round(empiricalPt.bestGapSecsPerKm)
          : modeledBestPace;

      return {
        durationSecs: d.durationSecs,
        durationLabel: d.durationLabel,
        cyclingOutdoorWatts,
        cyclingIndoorWatts,
        cyclingSeasonBestWatts,
        runningOutdoorPaceSecsKm,
        runningIndoorPaceSecsKm,
        runningSeasonBestPaceSecsKm,
      };
    });

    return {
      calibratedCurves: pts,
      hasPowerCalibration: hasPower,
      hasPaceCalibration: hasPace,
    };
  }, [wellnessDays, activities, curves, athleteProfile, empiricalSummary, empiricalByDuration]);

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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Peak Power &amp; Pace Duration Curves
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/25 text-[11px] font-mono font-semibold text-blue-600 dark:text-sky-300">
                CP · W&apos; · Pmax
              </span>
              <ChartInfoTooltip
                title="Critical Power (CP) & Pace Duration Curve (5s – 2hr)"
                subtitle="3-Parameter Bioenergetic Model (Pmax · W' · CP/eFTP)"
                whatItMeasures="Maps your maximum sustainable output across the three human energy systems: ATP-PCr Neuromuscular Sprint (5s–15s), Anaerobic Glycolytic Capacity W' (1m–5m), and Oxidative Phosphorylation / Lactate Threshold (20m–2h), split by Outdoor vs. Indoor Trainer."
                benchmarks="Indoor Smart Trainer 20m power is typically within 3–6% of Outdoor Road power; a gap >8% suggests indoor cooling, flywheel inertia, or bike-fit differences."
                liveStatus={{
                  label:
                    curveDiscipline === 'Cycling'
                      ? hasPowerCalibration
                        ? `20m Outdoor: ${calibratedCurves[3]?.cyclingOutdoorWatts || 0}W (${((calibratedCurves[3]?.cyclingOutdoorWatts || 0) / Math.max(40, athleteWeightKg)).toFixed(2)} W/kg) · Trainer: ${calibratedCurves[3]?.cyclingIndoorWatts || 0}W`
                        : 'Awaiting Power Calibration'
                      : hasPaceCalibration
                        ? `20m Outdoor: ${formatPace(calibratedCurves[3]?.runningOutdoorPaceSecsKm || 0, distanceUnit)} · Treadmill: ${formatPace(calibratedCurves[3]?.runningIndoorPaceSecsKm || 0, distanceUnit)}`
                        : 'Awaiting Pace Calibration',
                  state:
                    (curveDiscipline === 'Cycling' ? hasPowerCalibration : hasPaceCalibration)
                      ? 'optimal'
                      : 'neutral',
                  interpretation: `Showing ${curveDiscipline} CP/CS duration model calibrated to your profile and synced workouts.`,
                }}
                coachingAction="Use your Indoor Trainer 20m–60m curve for ERG-mode workout prescription, and your Outdoor curve for road/trail pacing."
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare peak outputs across Outdoor Road/Trail, Indoor Smart Trainer/Treadmill, and Season Bests
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

        {/* Fitted Critical Power / Critical Speed Bioenergetic KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-3.5 py-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              1Hz Streams Scanned
            </div>
            <div className="mt-0.5 text-sm font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {curveDiscipline === 'Cycling'
                ? `${empiricalSummary.scannedPowerStreamsCount} power files`
                : `${empiricalSummary.scannedPaceStreamsCount} GAP run files`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-3.5 py-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {curveDiscipline === 'Cycling' ? 'Critical Power (CP)' : 'Critical Speed (CS)'}
            </div>
            <div className="mt-0.5 text-sm font-mono font-bold tabular-nums text-blue-600 dark:text-sky-400">
              {curveDiscipline === 'Cycling'
                ? empiricalSummary.criticalPowerWatts
                  ? `${empiricalSummary.criticalPowerWatts} W (${(
                      empiricalSummary.criticalPowerWatts / Math.max(40, athleteWeightKg)
                    ).toFixed(2)} W/kg)`
                  : '—'
                : empiricalSummary.criticalPaceSecsPerKm
                  ? `${formatPace(Math.round(empiricalSummary.criticalPaceSecsPerKm), distanceUnit)}${
                      empiricalSummary.criticalSpeedMps
                        ? ` (${empiricalSummary.criticalSpeedMps.toFixed(2)} m/s)`
                        : ''
                    }`
                  : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-3.5 py-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {curveDiscipline === 'Cycling' ? "Anaerobic Work (W')" : "Anaerobic Reserve (D')"}
            </div>
            <div className="mt-0.5 text-sm font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {curveDiscipline === 'Cycling'
                ? empiricalSummary.wPrimeJoules
                  ? `${(empiricalSummary.wPrimeJoules / 1000).toFixed(1)} kJ`
                  : '—'
                : empiricalSummary.dPrimeMeters
                  ? `${empiricalSummary.dPrimeMeters} m`
                  : '—'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-3.5 py-2.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {curveDiscipline === 'Cycling' ? 'Neuromuscular Pmax' : '15s Sprint GAP Peak'}
            </div>
            <div className="mt-0.5 text-sm font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {curveDiscipline === 'Cycling'
                ? empiricalSummary.pMaxWatts
                  ? `${empiricalSummary.pMaxWatts} W`
                  : '—'
                : empiricalByDuration.get(15)?.bestGapSecsPerKm
                  ? formatPace(
                      Math.round(empiricalByDuration.get(15)!.bestGapSecsPerKm!),
                      distanceUnit
                    )
                  : '—'}
            </div>
          </div>
        </div>

        {/* Interactive Power / Pace Duration Curve SVG Chart with Explicit X & Y Axis Labels */}
        {(curveDiscipline === 'Cycling' && !hasPowerCalibration) ||
        (curveDiscipline === 'Running' && !hasPaceCalibration) ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {curveDiscipline === 'Cycling'
              ? 'No cycling FTP or power telemetry calibrated yet. Set your FTP in Athlete Profile or upload a power-meter .FIT file to unlock your Critical Power curve.'
              : 'No running threshold pace or GPS run telemetry calibrated yet. Set your Threshold Pace in Athlete Profile or upload a run to unlock your Critical Speed curve.'}
          </div>
        ) : (
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
        )}

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

                const rawDiffSecs = pt.runningIndoorPaceSecsKm - pt.runningOutdoorPaceSecsKm;
                const diffSecs =
                  distanceUnit === 'mi' ? Math.round(rawDiffSecs * 1.609344) : rawDiffSecs;
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
                        ? `-${diffSecs}s/${distanceUnit} faster Outdoor`
                        : `${Math.abs(diffSecs)}s/${distanceUnit} faster Treadmill`}
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

        {/* Empirical 1Hz Peak Efforts & PR Provenance Ledger */}
        {empiricalSummary.points.some((p) =>
          curveDiscipline === 'Cycling' ? p.bestWatts != null : p.bestGapSecsPerKm != null
        ) && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Empirical 1Hz Peak Efforts &amp; Workout PR Provenance
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Exact sliding-window bests scanned from local 1Hz telemetry streams and synced workouts. Click any source workout to inspect its stream.
                </p>
              </div>
              <span className="ap-status-info px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold">
                1s – 2h Prefix-Sum MMP
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 px-3">Window</th>
                    <th className="py-2 px-3 text-right">Empirical 1Hz Best</th>
                    <th className="py-2 px-3 text-right">Modeled CP/CS Target</th>
                    <th className="py-2 px-3 text-right">Timestamp</th>
                    <th className="py-2 px-3">PR Provenance Workout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                  {empiricalSummary.points
                    .filter((pt) => [1, 5, 15, 60, 300, 1200, 3600, 7200].includes(pt.durationSecs))
                    .map((pt) => {
                      const isCycling = curveDiscipline === 'Cycling';
                      const hasEmp = isCycling ? pt.bestWatts != null : pt.bestGapSecsPerKm != null;
                      if (!hasEmp && (isCycling ? !pt.modeledWatts : !pt.modeledGapSecsPerKm)) {
                        return null;
                      }
                      const srcId = isCycling ? pt.sourceActivityId : pt.paceSourceActivityId;
                      const srcName = isCycling ? pt.sourceActivityName : pt.paceSourceActivityName;
                      const srcDate = isCycling ? pt.sourceActivityDate : pt.paceSourceActivityDate;
                      const startOffset = isCycling
                        ? pt.startSecondOffset
                        : pt.paceStartSecondOffset;
                      const matchedAct = srcId ? activities.find((a) => a.id === srcId) : undefined;

                      return (
                        <tr
                          key={`emp-${pt.durationSecs}`}
                          className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                            {pt.label}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-blue-600 dark:text-sky-400">
                            {isCycling
                              ? pt.bestWatts != null
                                ? `${pt.bestWatts} W (${(
                                    pt.bestWatts / Math.max(40, athleteWeightKg)
                                  ).toFixed(2)} W/kg)`
                                : '—'
                              : pt.bestGapSecsPerKm != null
                                ? `${formatPace(Math.round(pt.bestGapSecsPerKm), distanceUnit)} GAP`
                                : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                            {isCycling
                              ? pt.modeledWatts != null
                                ? `${pt.modeledWatts} W`
                                : '—'
                              : pt.modeledGapSecsPerKm != null
                                ? formatPace(Math.round(pt.modeledGapSecsPerKm), distanceUnit)
                                : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-500">
                            {startOffset != null && startOffset > 0
                              ? `@ ${formatStopwatch(startOffset)}`
                              : hasEmp
                                ? 'Full effort'
                                : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            {matchedAct && onSelectActivity ? (
                              <button
                                type="button"
                                onClick={() => onSelectActivity(matchedAct)}
                                className="inline-flex items-center gap-1.5 text-left text-blue-600 dark:text-sky-400 hover:underline font-medium"
                              >
                                <span className="truncate max-w-[220px]">{srcName}</span>
                                {srcDate && (
                                  <span className="text-[11px] font-mono text-slate-400">
                                    ({srcDate}) →
                                  </span>
                                )}
                              </button>
                            ) : srcName ? (
                              <span className="text-slate-700 dark:text-slate-300">
                                {srcName} {srcDate ? `(${srcDate})` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-400">Modeled baseline</span>
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

      {/* 1B. 10x #2 — Fatigue-Sliced Physiological Durability Engine (kJ/kg & kcal Threshold Retention) */}
      <section className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ap-status-info px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold">
                10x #2 · Fatigue-Sliced Durability
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {curveDiscipline === 'Cycling'
                  ? 'Mechanical Work Durability (0 → 40 kJ/kg Threshold Retention)'
                  : 'Metabolic Energy Durability (0 → 2,000 kcal GAP Retention)'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Measures how much of your fresh (`0 {durabilityReport.unitLabel}`) 5-minute and 20-minute output survives deep into endurance races.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
            <span
              className={`px-2.5 py-1 rounded-lg font-bold ${
                durabilityReport.durabilityTier === 'PRO_TOUR_RESILIENT' ||
                durabilityReport.durabilityTier === 'WELL_CONDITIONED'
                  ? 'ap-status-prime'
                  : durabilityReport.durabilityTier === 'MODERATE_FADE'
                    ? 'ap-status-caution'
                    : 'ap-status-strained'
              }`}
            >
              {durabilityReport.durabilityTier.replace(/_/g, ' ')} ·{' '}
              {durabilityReport.retentionAtDeepFatiguePct.toFixed(1)}% Retained
            </span>
            <span className="px-2.5 py-1 rounded-lg liquid-capsule-track text-slate-700 dark:text-slate-200 font-semibold">
              Slope: -{durabilityReport.decaySlopePerUnitPct}% / bucket
            </span>
          </div>
        </div>

        {/* 5-Bucket Durability Retention Visual Bars & Table */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
          {durabilityReport.buckets.map((b) => {
            const barColor =
              b.retentionPct >= 95
                ? 'bg-emerald-500'
                : b.retentionPct >= 90
                  ? 'bg-blue-500'
                  : b.retentionPct >= 85
                    ? 'bg-amber-500'
                    : 'bg-rose-500';
            return (
              <div
                key={b.bucketIndex}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/60 p-3 space-y-2 font-mono tabular-nums"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {b.fatigueLabel}
                  </span>
                  <span className="font-bold text-blue-600 dark:text-sky-400">
                    {b.retentionPct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all`}
                    style={{ width: `${Math.max(25, Math.min(100, b.retentionPct))}%` }}
                  />
                </div>
                <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span>20m Hold:</span>
                    <strong className="text-slate-900 dark:text-white">
                      {curveDiscipline === 'Cycling'
                        ? `${b.best20mWatts ?? 0}W`
                        : formatPace(b.best20mGapSecsPerKm ?? 250, distanceUnit)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>5m Peak:</span>
                    <strong>
                      {curveDiscipline === 'Cycling'
                        ? `${b.best5mWatts ?? 0}W`
                        : formatPace(b.best5mGapSecsPerKm ?? 230, distanceUnit)}
                    </strong>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>HR Drift:</span>
                    <span>+{b.heartRateDriftPct.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Limiter Attribution & Fueling Prescription */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
              Primary Late-Race Limiter · {durabilityReport.primaryLimiter.replace(/_/g, ' ')}
            </div>
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
              {durabilityReport.limiterExplanation}
            </p>
          </div>
          <div className="rounded-xl liquid-glass-subtle p-3.5 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-bold">
              Exogenous Carbohydrate &amp; Durability Prescription
            </div>
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
              {durabilityReport.fuelingPrescription}
            </p>
          </div>
        </div>
      </section>

      {/* 2. Coggan Power Profile & WMA Age-Graded Percentile Radars */}
      {athleteProfile && (
        <AthletePerformanceRadar
          selfName={athleteProfile.name || 'Athlete'}
          selfProfile={athleteProfile}
          selfWellnessDays={wellnessDays}
          selfActivities={activities}
          connectedAthletes={[]}
          onOpenCoachWithPrompt={() => {}}
        />
      )}

      {/* Canonical Segment Analytics Pointer (Deduplicated from PhysiologyView) */}
      <section className="rounded-2xl liquid-glass px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <strong className="text-slate-900 dark:text-white">
            Segment Trophy Case &amp; Repeated Climb/Loop Progression ({repeatedSegments.length} tracked segments):
          </strong>{' '}
          Segment PRs and effort-over-time charts now live canonically inside the{' '}
          <strong>Activities</strong> workspace alongside your route maps and workout logs.
        </div>
        {onOpenActivitiesSegments && (
          <button
            type="button"
            onClick={onOpenActivitiesSegments}
            className="min-h-[34px] px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-600 dark:text-amber-300 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Open Segment Trophy Case in Activities →
          </button>
        )}
      </section>
    </div>
  );
};
