import React, { useMemo, useState } from 'react';
import { ArrowRight, Calendar, Compass, Flame, HeartPulse, Moon, Trophy } from 'lucide-react';
import {
  AnnualMileageGoal,
  DailyWorkoutOption,
  DistanceUnit,
  EnvironmentFilter,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  computeAnnualMileageSummary,
  formatDistance,
  formatSleepDuration,
} from '../utils/formatters';

interface OverviewViewProps {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  annualMileageGoals: AnnualMileageGoal[];
  targetGoals: TargetGoal[];
  selectedWorkoutOption: DailyWorkoutOption;
  envFilter: EnvironmentFilter;
  distanceUnit: DistanceUnit;
  onNavigateTab: (tab: 'overview' | 'activities' | 'physiology' | 'goals' | 'coach') => void;
  onSelectActivity: (activity: UnifiedActivity) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  wellnessDays,
  activities,
  annualMileageGoals,
  targetGoals,
  selectedWorkoutOption,
  envFilter,
  distanceUnit,
  onNavigateTab,
  onSelectActivity,
}) => {
  const [pmcWindowDays, setPmcWindowDays] = useState<14 | 42 | 90>(42);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const todayWellness = wellnessDays[wellnessDays.length - 1] || {
    date: '2026-11-05',
    ctl: 74.2,
    atl: 78.3,
    tsb: -4.1,
    rampRate: 1.6,
    hrvRMSSD: 71,
    hrvBaseline7d: 68,
    restingHR: 45,
    sleepSecs: 28200,
    sleepScore: 87,
    weightKg: 69.4,
    vo2MaxCycling: 64,
    vo2MaxRunning: 61,
    readinessStatus: 'Optimal' as const,
    dailyLoad: 0,
  };

  const hrvDelta = todayWellness.hrvRMSSD - todayWellness.hrvBaseline7d;

  const slicedWellness = useMemo(() => {
    return wellnessDays.slice(-pmcWindowDays);
  }, [wellnessDays, pmcWindowDays]);

  const activeHoverDay =
    hoverIdx !== null && slicedWellness[hoverIdx] ? slicedWellness[hoverIdx] : slicedWellness[slicedWellness.length - 1];

  const primaryARace = useMemo(() => {
    return targetGoals.find((g) => g.priority === 'A-Race') || targetGoals[0];
  }, [targetGoals]);

  const daysUntilARace = useMemo(() => {
    if (!primaryARace) return 38;
    const now = new Date('2026-11-05T00:00:00Z').getTime();
    const target = new Date(`${primaryARace.targetDate}T00:00:00Z`).getTime();
    return Math.max(1, Math.round((target - now) / (1000 * 60 * 60 * 24)));
  }, [primaryARace]);

  const runGoalMeters =
    annualMileageGoals.find((g) => g.sportCategory === 'Running')?.targetDistanceMeters || 2414016;
  const bikeGoalMeters =
    annualMileageGoals.find((g) => g.sportCategory === 'Cycling')?.targetDistanceMeters || 8046720;

  const runMileageSummary = useMemo(
    () => computeAnnualMileageSummary('Running', runGoalMeters, activities, envFilter),
    [runGoalMeters, activities, envFilter]
  );

  const bikeMileageSummary = useMemo(
    () => computeAnnualMileageSummary('Cycling', bikeGoalMeters, activities, envFilter),
    [bikeGoalMeters, activities, envFilter]
  );

  // SVG PMC Coordinate math
  const chartWidth = 880;
  const chartHeight = 250;
  const padLeft = 40;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 28;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const maxLoadVal = 120;
  const minTsbVal = -35;

  const yForLoad = (val: number) => {
    const clamped = Math.max(0, Math.min(maxLoadVal, val));
    return padTop + plotH - (clamped / maxLoadVal) * plotH;
  };

  const yForTsb = (tsb: number) => {
    // Map [-35, +35] to [padTop + plotH, padTop]
    const norm = (Math.max(-35, Math.min(35, tsb)) - minTsbVal) / 70;
    return padTop + plotH - norm * plotH;
  };

  const xForIndex = (i: number) => {
    if (slicedWellness.length <= 1) return padLeft;
    return padLeft + (i / (slicedWellness.length - 1)) * plotW;
  };

  const ctlPoints = slicedWellness.map((d, i) => `${xForIndex(i)},${yForLoad(d.ctl)}`).join(' ');
  const atlPoints = slicedWellness.map((d, i) => `${xForIndex(i)},${yForLoad(d.atl)}`).join(' ');
  const tsbPoints = slicedWellness.map((d, i) => `${xForIndex(i)},${yForTsb(d.tsb)}`).join(' ');

  const targetCtlY = primaryARace?.targetCtl ? yForLoad(primaryARace.targetCtl) : null;

  return (
    <div className="space-y-6">
      {/* 1. Morning Autonomic Readiness & Physiology Strip */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Morning Autonomic Readiness · Synced via Intervals.icu & Garmin Connect · {todayWellness.date}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
              Physiological Readiness:{' '}
              <span
                className={
                  todayWellness.readinessStatus === 'Optimal'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : todayWellness.readinessStatus === 'Caution'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }
              >
                {todayWellness.readinessStatus}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateTab('coach')}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              <span>View 3 Daily Workout Options</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4">
          {/* KPI 1: HRV */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">HRV (rMSSD)</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {todayWellness.hrvRMSSD} <span className="text-xs font-normal text-slate-500">ms</span>
            </div>
            <div className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {hrvDelta >= 0 ? `+${hrvDelta}` : hrvDelta} ms vs {todayWellness.hrvBaseline7d} ms 7d avg
            </div>
          </div>

          {/* KPI 2: Resting HR */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Resting Heart Rate</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {todayWellness.restingHR} <span className="text-xs font-normal text-slate-500">bpm</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Parasympathetic tone normal
            </div>
          </div>

          {/* KPI 3: Sleep */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Garmin Sleep Score</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {todayWellness.sleepScore}
              <span className="text-xs font-normal text-slate-500">/100</span>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {formatSleepDuration(todayWellness.sleepSecs)} duration
            </div>
          </div>

          {/* KPI 4: Chronic Training Load (CTL) */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Fitness (CTL)</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
              {todayWellness.ctl.toFixed(1)}
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Ramp {todayWellness.rampRate >= 0 ? `+${todayWellness.rampRate}` : todayWellness.rampRate}/wk · Target {primaryARace?.targetCtl || 84}
            </div>
          </div>

          {/* KPI 5: Fatigue (ATL) & Form (TSB) */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Form (TSB) / Fatigue</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {todayWellness.tsb > 0 ? `+${todayWellness.tsb}` : todayWellness.tsb}{' '}
              <span className="text-xs font-normal text-slate-500">· ATL {todayWellness.atl.toFixed(0)}</span>
            </div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400">
              Optimal productive training zone
            </div>
          </div>

          {/* KPI 6: Multi-Sport VO2max */}
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">VO2max (Bike / Run)</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {todayWellness.vo2MaxCycling || 64} <span className="text-slate-400">/</span> {todayWellness.vo2MaxRunning || 61}
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              mL/kg/min · {todayWellness.weightKg} kg
            </div>
          </div>
        </div>
      </section>

      {/* 2. Separate Annual Mileage Targets (Running & Cycling) with Outdoor vs. Trainer/Treadmill Split */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[runMileageSummary, bikeMileageSummary].map((summary) => {
          const isAhead = summary.deltaVsScheduleMeters >= 0;
          const indoorLabel = summary.sportCategory === 'Running' ? 'Treadmill' : 'Smart Trainer';

          return (
            <div
              key={summary.sportCategory}
              className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    2026 Annual {summary.sportCategory} Mileage Target ·{' '}
                    {envFilter === 'COMBINED'
                      ? 'Outdoor + Indoor Combined'
                      : envFilter === 'OUTDOOR'
                        ? 'Outdoor Only Filter Active'
                        : `${indoorLabel} Only Filter Active`}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {summary.sportCategory} YTD Volume
                  </h2>
                </div>
                <button
                  onClick={() => onNavigateTab('goals')}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Edit Target
                </button>
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <span className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatDistance(summary.displayedTotalMeters, distanceUnit, 1)}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 ml-2">
                    of {formatDistance(summary.targetMeters, distanceUnit, 0)} ({summary.pctOfAnnualTarget}%)
                  </span>
                </div>
                <div
                  className={`text-xs font-mono tabular-nums font-medium ${
                    isAhead ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {isAhead ? '+' : '-'}
                  {formatDistance(Math.abs(summary.deltaVsScheduleMeters), distanceUnit, 1)}{' '}
                  {isAhead ? 'ahead of pro-rated pace' : 'behind pro-rated pace'}
                </div>
              </div>

              {/* Dual-segment progress bar showing Outdoor vs Indoor contribution */}
              <div className="space-y-1.5">
                <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        (summary.outdoorMeters / Math.max(1, summary.targetMeters)) * 100
                      )}%`,
                    }}
                    className={`h-full transition-all ${
                      envFilter === 'INDOOR' ? 'bg-slate-400/30' : 'bg-blue-600 dark:bg-blue-500'
                    }`}
                    title="Outdoor Distance"
                  />
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        (summary.indoorMeters / Math.max(1, summary.targetMeters)) * 100
                      )}%`,
                    }}
                    className={`h-full transition-all ${
                      envFilter === 'OUTDOOR' ? 'bg-slate-400/30' : 'bg-emerald-500 dark:bg-emerald-400'
                    }`}
                    title={`Indoor (${indoorLabel}) Distance`}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>
                    Outdoor: {formatDistance(summary.outdoorMeters, distanceUnit, 1)} ({summary.outdoorSharePct}%)
                  </span>
                  <span>
                    Indoor ({indoorLabel}): {formatDistance(summary.indoorMeters, distanceUnit, 1)} ({summary.indoorSharePct}%)
                  </span>
                  <span>
                    Need {formatDistance(summary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk to Dec 31
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. Performance Management Chart (PMC: Fitness CTL, Fatigue ATL, Form TSB + Target Race Line) */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Performance Management Chart (Fitness CTL · Fatigue ATL · Form TSB)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Hover or tap across the timeline to inspect daily training load, HRV readiness, and progress toward your{' '}
              <span className="font-mono">{primaryARace?.targetCtl || 84} CTL</span> A-Race goal
            </p>
          </div>

          {/* Window Segmented Control */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {([14, 42, 90] as const).map((days) => (
              <button
                key={days}
                onClick={() => {
                  setPmcWindowDays(days);
                  setHoverIdx(null);
                }}
                className={`min-h-[34px] px-3 py-1 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  pmcWindowDays === days
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Active Day Telemetry Readout Bar */}
        {activeHoverDay && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs font-mono tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Date: {activeHoverDay.date}
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              Fitness (CTL): {activeHoverDay.ctl.toFixed(1)}
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              Fatigue (ATL): {activeHoverDay.atl.toFixed(1)}
            </span>
            <span
              className={
                activeHoverDay.tsb >= -10
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-500'
              }
            >
              Form (TSB): {activeHoverDay.tsb > 0 ? `+${activeHoverDay.tsb}` : activeHoverDay.tsb}
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              HRV: {activeHoverDay.hrvRMSSD} ms · RHR: {activeHoverDay.restingHR} bpm
            </span>
            <span className="text-slate-500">
              Daily Load: {activeHoverDay.dailyLoad} TSS
            </span>
          </div>
        )}

        {/* Interactive SVG Chart */}
        <div className="relative w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full h-60 select-none overflow-visible"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Horizontal grid lines */}
            {[25, 50, 75, 100].map((val) => {
              const y = yForLoad(val);
              return (
                <g key={val}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={chartWidth - padRight}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Target Race CTL Reference Line */}
            {targetCtlY !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={targetCtlY}
                  x2={chartWidth - padRight}
                  y2={targetCtlY}
                  stroke="#10B981"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
                <text
                  x={chartWidth - padRight - 4}
                  y={targetCtlY - 5}
                  textAnchor="end"
                  className="fill-emerald-500 text-[10px] font-mono font-semibold"
                >
                  A-Race Target CTL ({primaryARace?.targetCtl || 84})
                </text>
              </g>
            )}

            {/* Daily Training Load Subtle Bars */}
            {slicedWellness.map((d, idx) => {
              const x = xForIndex(idx);
              const barH = Math.min(plotH, (d.dailyLoad / 180) * plotH);
              const barY = padTop + plotH - barH;
              return (
                <rect
                  key={d.date}
                  x={x - 3}
                  y={barY}
                  width={6}
                  height={Math.max(0, barH)}
                  rx={1.5}
                  className="fill-slate-300/60 dark:fill-slate-800/80"
                />
              );
            })}

            {/* TSB (Form) Line */}
            <polyline
              fill="none"
              stroke="#10B981"
              strokeWidth="1.75"
              strokeOpacity="0.85"
              points={tsbPoints}
            />

            {/* ATL (Fatigue) Line */}
            <polyline
              fill="none"
              stroke="#F59E0B"
              strokeWidth="2"
              points={atlPoints}
            />

            {/* CTL (Fitness) Line */}
            <polyline
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2.75"
              points={ctlPoints}
            />

            {/* Interactive Hover Columns */}
            {slicedWellness.map((d, idx) => {
              const x = xForIndex(idx);
              const colW = plotW / Math.max(1, slicedWellness.length);
              return (
                <g key={`hit-${d.date}`}>
                  {hoverIdx === idx && (
                    <>
                      <line
                        x1={x}
                        y1={padTop}
                        x2={x}
                        y2={padTop + plotH}
                        stroke="#64748B"
                        strokeWidth="1"
                      />
                      <circle cx={x} cy={yForLoad(d.ctl)} r={4.5} className="fill-blue-500" />
                      <circle cx={x} cy={yForLoad(d.atl)} r={4} className="fill-amber-500" />
                      <circle cx={x} cy={yForTsb(d.tsb)} r={4} className="fill-emerald-500" />
                    </>
                  )}
                  <rect
                    x={x - colW / 2}
                    y={padTop}
                    width={colW}
                    height={plotH}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIdx(idx)}
                    onClick={() => setHoverIdx(idx)}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* 4. Bottom Split: Today's Active AI Workout Prescription & Recent Reconciled Workouts */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 5 cols: Today's Selected Workout Option & A-Race Countdown */}
        <div className="lg:col-span-5 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Today&apos;s Active AI Coach Prescription</span>
              <span className="font-mono">
                {selectedWorkoutOption.sportCategory} · {selectedWorkoutOption.environment} · {selectedWorkoutOption.durationMinutes}m
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {selectedWorkoutOption.title}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {selectedWorkoutOption.physiologicalWhy}
            </p>
            <div className="space-y-1.5 pt-1">
              {selectedWorkoutOption.structuredSteps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{step.label}</span>
                  <span className="font-mono text-slate-500 dark:text-slate-400 text-right">
                    {step.duration} · {step.targetZoneOrOutput}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {primaryARace && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Next A-Race: </span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{primaryARace.title}</span>
              </div>
              <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                {daysUntilARace} days out
              </span>
            </div>
          )}
        </div>

        {/* Right 7 cols: Recent Reconciled Activities with Strava Segment PR counts */}
        <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Recent Reconciled Workouts (Intervals.icu + Strava)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Click any session to inspect time-series streams, aerobic decoupling, and Strava segment PRs
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('activities')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Explore All
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {activities
              .filter((a) => envFilter === 'COMBINED' || a.environment === envFilter)
              .slice(0, 4)
              .map((act) => (
                <button
                  key={act.id}
                  onClick={() => onSelectActivity(act)}
                  className="w-full min-h-[56px] py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-50 dark:hover:bg-slate-900/60 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {act.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span>{act.sportCategory}</span>
                      <span>·</span>
                      <span>{act.environment === 'INDOOR' ? `Indoor (${act.subType})` : `Outdoor (${act.subType})`}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{act.startDateLocal.slice(0, 10)}</span>
                      {act.stravaPrCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            {act.stravaPrCount} Strava PR{act.stravaPrCount > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {act.distanceMeters > 0 ? formatDistance(act.distanceMeters, distanceUnit, 1) : `${Math.round(act.movingTimeSecs / 60)} min`}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Load {act.trainingLoad} · Decouple {act.aerobicDecouplingPct}%
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </section>
    </div>
  );
};
