import React, { useMemo, useState } from 'react';
import {
  PlannedWorkoutEvent,
  UnifiedWellnessDay,
} from '../types';

interface FitnessHealthViewProps {
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  onOpenCoachWithPrompt: (prompt: string) => void;
}

type DateRangePreset = '42D' | '90D' | '6M' | '1Y' | '2Y' | 'ALL' | 'CUSTOM';

export const FitnessHealthView: React.FC<FitnessHealthViewProps> = ({
  wellnessDays,
  plannedEvents,
  onOpenCoachWithPrompt,
}) => {
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('90D');
  const [customStart, setCustomStart] = useState<string>('2025-01-01');
  const [customEnd, setCustomEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Forward PMC "What-If" Tapering / Build Simulator state
  const [forwardDays, setForwardDays] = useState<0 | 14 | 28 | 42>(14);
  const [simulatedDailyTss, setSimulatedDailyTss] = useState<number>(65);

  // Customizable Subplots toggles (matching Intervals.icu /fitness subplots)
  const [showTsbSubplot, setShowTsbSubplot] = useState<boolean>(true);
  const [showSleepSubplot, setShowSleepSubplot] = useState<boolean>(true);
  const [showHrvSubplot, setShowHrvSubplot] = useState<boolean>(true);
  const [showRhrVo2Subplot, setShowRhrVo2Subplot] = useState<boolean>(true);
  const [showEftpSubplot, setShowEftpSubplot] = useState<boolean>(true);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const latestDay = wellnessDays[wellnessDays.length - 1] || {
    date: new Date().toISOString().slice(0, 10),
    ctl: 72.4,
    atl: 57.6,
    tsb: 14.8,
    loadRatio: 0.8,
    rampRate: -1.2,
    hrvRMSSD: 54,
    hrvBaseline7d: 52,
    hrvNormalBandLow: 44,
    hrvNormalBandHigh: 62,
    hrvStatus: 'Balanced' as const,
    restingHR: 49,
    sleepSecs: 26340,
    sleepScore: 78,
    sleepQuality: 2,
    sleepDebt7dSecs: 3200,
    weightKg: 70,
    vo2MaxCycling: 51,
    vo2MaxRunning: 51,
    rideEftp: 310,
    rideWPrime: 25120,
    ridePMax: 1204,
    runEftp: 456,
    garminTrainingStatus: 'Productive' as const,
    trainingStatusReason: 'Optimal acute-to-chronic workload ratio building aerobic fitness.',
    readinessStatus: 'Optimal' as const,
    dailyLoad: 65,
  };

  // Find the most recent day with non-zero sleep & HRV in case today's morning sync hasn't posted yet
  const latestWithSleep = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].sleepSecs > 0 || wellnessDays[i].sleepScore > 0) {
        return wellnessDays[i];
      }
    }
    return latestDay;
  }, [wellnessDays, latestDay]);

  const latestWithHrv = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].hrvRMSSD > 0) {
        return wellnessDays[i];
      }
    }
    return latestDay;
  }, [wellnessDays, latestDay]);

  // Filter historical wellness series + append Forward PMC projection days if enabled
  const chartSeries = useMemo(() => {
    let filtered = wellnessDays;
    if (rangePreset === '42D') filtered = wellnessDays.slice(-42);
    else if (rangePreset === '90D') filtered = wellnessDays.slice(-90);
    else if (rangePreset === '6M') filtered = wellnessDays.slice(-180);
    else if (rangePreset === '1Y') filtered = wellnessDays.slice(-365);
    else if (rangePreset === '2Y') filtered = wellnessDays.slice(-730);
    else if (rangePreset === 'CUSTOM') {
      filtered = wellnessDays.filter((w) => w.date >= customStart && w.date <= customEnd);
    }

    const maxHistoricalPoints = 220;
    const step = Math.max(1, Math.floor(filtered.length / maxHistoricalPoints));
    const sampled: (UnifiedWellnessDay & { isProjected?: boolean })[] = filtered.filter(
      (_, idx) => idx % step === 0 || idx === filtered.length - 1
    );

    if (forwardDays > 0 && sampled.length > 0) {
      const last = sampled[sampled.length - 1];
      let curCtl = last.ctl;
      let curAtl = last.atl;
      const startDate = new Date(last.date);

      const plannedByDate = new Map<string, number>();
      for (const ev of plannedEvents) {
        const d = ev.date.slice(0, 10);
        plannedByDate.set(d, (plannedByDate.get(d) || 0) + (ev.plannedLoad || 0));
      }

      for (let d = 1; d <= forwardDays; d++) {
        const nextDate = new Date(startDate);
        nextDate.setUTCDate(nextDate.getUTCDate() + d);
        const dateStr = nextDate.toISOString().slice(0, 10);
        const dayLoad = plannedByDate.has(dateStr)
          ? plannedByDate.get(dateStr)!
          : simulatedDailyTss;

        curCtl = curCtl + (dayLoad - curCtl) / 42;
        curAtl = curAtl + (dayLoad - curAtl) / 7;
        const curTsb = curCtl - curAtl;

        sampled.push({
          ...last,
          date: dateStr,
          ctl: Number(curCtl.toFixed(1)),
          atl: Number(curAtl.toFixed(1)),
          tsb: Number(curTsb.toFixed(1)),
          dailyLoad: dayLoad,
          isProjected: true,
        });
      }
    }

    return sampled;
  }, [wellnessDays, rangePreset, customStart, customEnd, forwardDays, simulatedDailyTss, plannedEvents]);

  const activePoint =
    hoverIdx !== null && chartSeries[hoverIdx]
      ? chartSeries[hoverIdx]
      : chartSeries[chartSeries.length - 1] || latestDay;

  const statusBadgeColor = (status?: string) => {
    switch (status) {
      case 'Peaking':
        return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30';
      case 'Productive':
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'Maintaining':
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
      case 'Recovery':
        return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30';
      case 'Strained':
      case 'Overreaching':
        return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
      default:
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    }
  };

  // Helper to render date ticks along the bottom X-axis of any chart
  const renderXAxisDates = (len: number, yPos: number, titleYPos: number) => (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
        const ptIdx = Math.min(len - 1, Math.floor(f * (len - 1)));
        const pt = chartSeries[ptIdx];
        if (!pt) return null;
        const x = 56 + f * 836;
        return (
          <text
            key={idx}
            x={x}
            y={yPos}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
          >
            {pt.date}
          </text>
        );
      })}
      <text
        x={474}
        y={titleYPos}
        textAnchor="middle"
        className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans font-semibold"
      >
        Date ({chartSeries[0]?.date} → {chartSeries[chartSeries.length - 1]?.date})
      </text>
    </>
  );

  // Helper to render interactive hover scrubber columns on every chart & subplot
  const renderInteractiveScrubber = (len: number, height: number, lineBottomY: number) =>
    chartSeries.map((_, i) => {
      const x = 56 + (i / Math.max(1, len - 1)) * 836;
      const colW = 836 / Math.max(1, len);
      return (
        <g key={i}>
          {hoverIdx === i && (
            <line
              x1={x}
              y1={10}
              x2={x}
              y2={lineBottomY}
              stroke="#3B82F6"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}
          <rect
            x={x - colW / 2}
            y={0}
            width={colW}
            height={height}
            fill="transparent"
            className="cursor-crosshair"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseMove={() => setHoverIdx(i)}
          />
        </g>
      );
    });

  return (
    <div className="space-y-6">
      {/* Top Row: Garmin Health, Sleep, HRV Status & 8-State Training Status Cockpit */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Garmin 8-State Training Status & Load Ratio */}
        <div className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Garmin Training Status
              </span>
              <span
                className={`px-2 py-0.5 text-xs font-bold rounded border ${statusBadgeColor(
                  latestDay.garminTrainingStatus
                )}`}
              >
                {latestDay.garminTrainingStatus || 'Productive'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <div>
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  CTL {latestDay.ctl}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  ATL {latestDay.atl} · TSB {latestDay.tsb > 0 ? `+${latestDay.tsb}` : latestDay.tsb}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              {latestDay.trainingStatusReason}
            </p>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-slate-500 font-sans">Load Ratio (ACWR):</span>
            <span
              className={
                (latestDay.loadRatio || 1) >= 0.8 && (latestDay.loadRatio || 1) <= 1.3
                  ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'text-amber-500 font-bold'
              }
            >
              {latestDay.loadRatio || (latestDay.atl / Math.max(1, latestDay.ctl)).toFixed(2)}x
              (Optimal 0.8–1.3x)
            </span>
          </div>
        </div>

        {/* Card 2: Garmin Sleep Architecture & 7-Day Sleep Debt */}
        <div className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Garmin Sleep &amp; Score ({latestWithSleep.date.slice(5)})
              </span>
              <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">
                Score {latestWithSleep.sleepScore || 78} / 100
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {Math.floor((latestWithSleep.sleepSecs || 26340) / 3600)}h{' '}
                {Math.round(((latestWithSleep.sleepSecs || 26340) % 3600) / 60)}m
              </span>
              <span className="text-xs text-slate-500">
                {latestWithSleep.sleepQuality === 1
                  ? 'Great Quality'
                  : latestWithSleep.sleepQuality === 2
                    ? 'Good Quality'
                    : 'Restorative'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mt-2.5">
              <div
                style={{ width: `${Math.min(100, latestWithSleep.sleepScore || 78)}%` }}
                className="h-full bg-indigo-500"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-slate-500 font-sans">7-Day Sleep Debt:</span>
            <span className="text-slate-800 dark:text-slate-200 font-semibold">
              {((latestWithSleep.sleepDebt7dSecs || 0) / 3600).toFixed(1)} hrs
            </span>
          </div>
        </div>

        {/* Card 3: Garmin HRV Status & 60-Day Baseline Corridor */}
        <div className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Garmin HRV Status ({latestWithHrv.date.slice(5)})
              </span>
              <span
                className={`text-xs font-mono font-bold ${
                  latestWithHrv.hrvStatus === 'Low'
                    ? 'text-red-500'
                    : latestWithHrv.hrvStatus === 'Unbalanced'
                      ? 'text-amber-500'
                      : 'text-emerald-500'
                }`}
              >
                {latestWithHrv.hrvStatus || 'Balanced'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                {latestWithHrv.hrvRMSSD} ms
              </span>
              <span className="text-xs text-slate-500">
                7d Avg: {latestWithHrv.hrvBaseline7d} ms
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
              60d Normal Corridor: {latestWithHrv.hrvNormalBandLow || 42}–
              {latestWithHrv.hrvNormalBandHigh || 62} ms
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-slate-500 font-sans">Resting HR &amp; Steps:</span>
            <span className="text-slate-800 dark:text-slate-200 font-semibold">
              {latestWithHrv.restingHR} bpm ·{' '}
              {(latestDay.steps || latestWithHrv.steps || 9940).toLocaleString()} steps
            </span>
          </div>
        </div>

        {/* Card 4: VO2max & Intervals.icu eFTP / W' */}
        <div className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                VO2max &amp; Critical Power (eFTP)
              </span>
              <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
                VO2max {latestDay.vo2MaxCycling || 51}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-3 font-mono tabular-nums">
              <div>
                <span className="text-xs text-slate-400 block font-sans">Bike eFTP</span>
                <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestDay.rideEftp || 310} W
                </span>
              </div>
              <div className="border-l border-slate-200 dark:border-slate-800 pl-3">
                <span className="text-xs text-slate-400 block font-sans">Run eFTP</span>
                <span className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestDay.runEftp || 456} W
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-slate-500 font-sans">Anaerobic W&apos; &amp; Pmax:</span>
            <span className="text-slate-800 dark:text-slate-200 font-semibold">
              {((latestDay.rideWPrime || 25120) / 1000).toFixed(1)} kJ ·{' '}
              {latestDay.ridePMax || 1204} W
            </span>
          </div>
        </div>
      </section>

      {/* Main Intervals.icu Performance Management Chart (PMC) + Stackable Subplots */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Intervals.icu Fitness &amp; Freshness (PMC) + Garmin Health Subplots
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Hover over any chart below to inspect synchronized daily CTL, ATL, TSB, Garmin Sleep, Overnight HRV, Resting HR, VO2max, and eFTP details
            </p>
          </div>

          {/* Date Range Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              {(
                [
                  { id: '42D', label: '42d' },
                  { id: '90D', label: '90d' },
                  { id: '6M', label: '6m' },
                  { id: '1Y', label: '1y' },
                  { id: '2Y', label: '2y' },
                  { id: 'ALL', label: 'All-Time' },
                  { id: 'CUSTOM', label: 'Custom' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setRangePreset(p.id)}
                  className={`min-h-[32px] px-3 py-1 text-xs font-mono font-medium rounded-md transition-colors ${
                    rangePreset === p.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {rangePreset === 'CUSTOM' && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs"
                />
                <span className="text-slate-400">→</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {/* Forward PMC Simulator & Subplot Checkboxes Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-3.5">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Subplots:</span>
            {[
              { label: 'Form (TSB Zones)', checked: showTsbSubplot, set: setShowTsbSubplot },
              { label: 'Garmin Sleep Score & Hrs', checked: showSleepSubplot, set: setShowSleepSubplot },
              { label: 'HRV + 60d Normal Corridor', checked: showHrvSubplot, set: setShowHrvSubplot },
              { label: 'Resting HR & VO2max', checked: showRhrVo2Subplot, set: setShowRhrVo2Subplot },
              { label: 'Cycling & Run eFTP', checked: showEftpSubplot, set: setShowEftpSubplot },
            ].map((sp) => (
              <label
                key={sp.label}
                className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 cursor-pointer select-none font-medium"
              >
                <input
                  type="checkbox"
                  checked={sp.checked}
                  onChange={(e) => sp.set(e.target.checked)}
                  className="rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                />
                <span>{sp.label}</span>
              </label>
            ))}
          </div>

          {/* Forward PMC Simulator Controls */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 px-3 py-1.5">
            <span className="font-medium text-slate-600 dark:text-slate-300">
              Forward PMC Simulator:
            </span>
            <select
              value={forwardDays}
              onChange={(e) => setForwardDays(Number(e.target.value) as 0 | 14 | 28 | 42)}
              className="rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 font-mono text-xs"
            >
              <option value={0}>Off (Historical Only)</option>
              <option value={14}>+14 Days Projection</option>
              <option value={28}>+28 Days Projection</option>
              <option value={42}>+42 Days Projection</option>
            </select>
            {forwardDays > 0 && (
              <div className="flex items-center gap-2 font-mono">
                <span className="text-slate-500">Assumed Load:</span>
                <input
                  type="range"
                  min={0}
                  max={140}
                  step={5}
                  value={simulatedDailyTss}
                  onChange={(e) => setSimulatedDailyTss(Number(e.target.value))}
                  className="w-20 accent-blue-600"
                />
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {simulatedDailyTss} TSS/d
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Rich Synchronized Daily Hover Telemetry Inspector Card */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/95 border border-blue-500/30 p-3.5 space-y-2.5 text-xs font-mono tabular-nums shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-xs">
                {hoverIdx !== null ? 'HOVERED DAY DETAILS' : 'LATEST DAY DETAILS'}
              </span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {activePoint.date}
              </span>
              {activePoint.isProjected && (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-sans font-semibold">
                  PROJECTED SIMULATION
                </span>
              )}
              {activePoint.garminTrainingStatus && !activePoint.isProjected && (
                <span className="text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                  Garmin Status: {activePoint.garminTrainingStatus} ({activePoint.readinessStatus || 'Optimal'})
                </span>
              )}
            </div>
            <span className="text-slate-500 font-sans">
              Move cursor across any chart to inspect daily values
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Fitness (CTL)</span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                {activePoint.ctl}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Fatigue (ATL)</span>
              <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                {activePoint.atl}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Form (TSB)</span>
              <span
                className={`text-sm font-bold ${
                  activePoint.tsb >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : activePoint.tsb < -18
                      ? 'text-red-500'
                      : 'text-amber-500'
                }`}
              >
                {activePoint.tsb > 0 ? `+${activePoint.tsb}` : activePoint.tsb}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Daily Load</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {activePoint.dailyLoad} TSS
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Garmin Sleep</span>
              <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                {activePoint.sleepSecs > 0
                  ? `${(activePoint.sleepSecs / 3600).toFixed(1)}h (${activePoint.sleepScore || '—'})`
                  : '—'}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Overnight HRV</span>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {activePoint.hrvRMSSD > 0
                  ? `${activePoint.hrvRMSSD}ms (7d: ${activePoint.hrvBaseline7d}ms)`
                  : '—'}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">RHR &amp; VO2max</span>
              <span className="text-sm font-bold text-rose-500">
                {activePoint.restingHR || '—'} bpm · VO2 {activePoint.vo2MaxCycling || 51}
              </span>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5">
              <span className="text-slate-500 block font-sans">Bike / Run eFTP</span>
              <span className="text-sm font-bold text-cyan-600 dark:text-cyan-400">
                {activePoint.rideEftp || 310}W / {activePoint.runEftp || 456}W
              </span>
            </div>
          </div>
        </div>

        {/* Synchronized Stack of SVG Charts */}
        <div
          className="space-y-4 select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* 1. Primary PMC Chart: CTL (Fitness), ATL (Fatigue), and Daily TSS Bars */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
              <span className="font-bold text-slate-900 dark:text-slate-100">
                1. Performance Management Chart: Fitness (CTL · Blue), Fatigue (ATL · Purple) &amp; Daily TSS Bars
              </span>
              <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">
                {activePoint.date}: CTL {activePoint.ctl} · ATL {activePoint.atl} · Load {activePoint.dailyLoad} TSS
              </span>
            </div>
            <svg viewBox="0 0 920 225" className="w-full h-56">
              {(() => {
                const len = Math.max(1, chartSeries.length);
                const maxVal = Math.max(
                  110,
                  ...chartSeries.map((d) => Math.max(d.ctl, d.atl, d.dailyLoad * 0.65))
                );

                const ctlPoints = chartSeries
                  .map((d, i) => {
                    const x = 56 + (i / Math.max(1, len - 1)) * 836;
                    const y = 178 - (d.ctl / maxVal) * 156;
                    return `${x},${y}`;
                  })
                  .join(' ');

                const atlPoints = chartSeries
                  .map((d, i) => {
                    const x = 56 + (i / Math.max(1, len - 1)) * 836;
                    const y = 178 - (d.atl / maxVal) * 156;
                    return `${x},${y}`;
                  })
                  .join(' ');

                const areaPoints = `56,178 ${ctlPoints} ${56 + 836},178`;

                return (
                  <>
                    {/* Left Y-Axis Label */}
                    <text
                      x={14}
                      y={98}
                      transform="rotate(-90 14 98)"
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans font-semibold"
                    >
                      Load (CTL / ATL / TSS)
                    </text>

                    {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                      const y = 178 - f * 156;
                      return (
                        <g key={idx}>
                          <line
                            x1={56}
                            y1={y}
                            x2={892}
                            y2={y}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-800"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={50}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {Math.round(f * maxVal)}
                          </text>
                        </g>
                      );
                    })}

                    <polygon points={areaPoints} fill="rgba(59, 130, 246, 0.14)" />

                    {/* Daily Load Bars */}
                    {chartSeries.map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      const barH = Math.min(156, ((d.dailyLoad * 0.55) / maxVal) * 156);
                      return (
                        <rect
                          key={i}
                          x={x - 1.5}
                          y={178 - barH}
                          width={3}
                          height={barH}
                          fill={d.isProjected ? '#F59E0B' : '#64748B'}
                          opacity={d.isProjected ? 0.5 : 0.35}
                        />
                      );
                    })}

                    <polyline
                      fill="none"
                      stroke="#A855F7"
                      strokeWidth="2"
                      points={atlPoints}
                    />
                    <polyline
                      fill="none"
                      stroke="#3B82F6"
                      strokeWidth="2.5"
                      points={ctlPoints}
                    />

                    {/* Highlighted Hover Dots */}
                    {hoverIdx !== null && chartSeries[hoverIdx] && (
                      <>
                        <circle
                          cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                          cy={178 - (chartSeries[hoverIdx].ctl / maxVal) * 156}
                          r={4.5}
                          fill="#3B82F6"
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                          cy={178 - (chartSeries[hoverIdx].atl / maxVal) * 156}
                          r={4}
                          fill="#A855F7"
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                      </>
                    )}

                    {renderXAxisDates(len, 198, 216)}
                    {renderInteractiveScrubber(len, 225, 180)}
                  </>
                );
              })()}
            </svg>
          </div>

          {/* 2. Form (TSB) Zones Subplot */}
          {showTsbSubplot && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  2. Form (TSB = CTL − ATL) · Freshness vs. Optimal Training Zone (−10 to −30)
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  {activePoint.date} TSB: {activePoint.tsb > 0 ? `+${activePoint.tsb}` : activePoint.tsb}
                </span>
              </div>
              <svg viewBox="0 0 920 148" className="w-full h-36">
                {(() => {
                  const len = Math.max(1, chartSeries.length);
                  const zeroY = 48;
                  const toY = (tsb: number) =>
                    Math.max(10, Math.min(104, zeroY - (tsb / 40) * 45));

                  const pts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.tsb)}`;
                    })
                    .join(' ');

                  return (
                    <>
                      <text
                        x={14}
                        y={56}
                        transform="rotate(-90 14 56)"
                        textAnchor="middle"
                        className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans font-semibold"
                      >
                        Form (TSB)
                      </text>

                      {/* Optimal Training Zone Band (-10 to -30) */}
                      <rect
                        x={56}
                        y={toY(-10)}
                        width={836}
                        height={toY(-30) - toY(-10)}
                        fill="rgba(16, 185, 129, 0.1)"
                      />
                      {[20, 0, -10, -30].map((v) => (
                        <g key={v}>
                          <line
                            x1={56}
                            y1={toY(v)}
                            x2={892}
                            y2={toY(v)}
                            stroke={v === 0 ? '#64748B' : 'currentColor'}
                            className={v === 0 ? '' : 'text-slate-200 dark:text-slate-800'}
                            strokeDasharray="3 3"
                          />
                          <text
                            x={50}
                            y={toY(v) + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {v > 0 ? `+${v}` : v}
                          </text>
                        </g>
                      ))}
                      <polyline
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="2.25"
                        points={pts}
                      />
                      {hoverIdx !== null && chartSeries[hoverIdx] && (
                        <circle
                          cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                          cy={toY(chartSeries[hoverIdx].tsb)}
                          r={4.5}
                          fill="#10B981"
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                      )}
                      {renderXAxisDates(len, 122, 140)}
                      {renderInteractiveScrubber(len, 148, 106)}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* 3. Garmin Sleep Duration & Sleep Score Subplot */}
          {showSleepSubplot && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  3. Garmin Sleep Duration (Indigo Bars · Hours) &amp; Sleep Score (Sky Line · 0–100)
                </span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                  {activePoint.date}: {(activePoint.sleepSecs / 3600).toFixed(1)}h · Score {activePoint.sleepScore || '—'}/100
                </span>
              </div>
              <svg viewBox="0 0 920 148" className="w-full h-36">
                {(() => {
                  const len = Math.max(1, chartSeries.length);
                  const scorePts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      const sc = d.sleepScore || 75;
                      const y = 104 - ((sc - 40) / 60) * 88;
                      return `${x},${Math.max(10, Math.min(104, y))}`;
                    })
                    .join(' ');

                  return (
                    <>
                      <text
                        x={14}
                        y={56}
                        transform="rotate(-90 14 56)"
                        textAnchor="middle"
                        className="fill-indigo-500 text-[11px] font-sans font-semibold"
                      >
                        Sleep (h / Score)
                      </text>

                      {[5, 7.5, 10].map((hrs) => {
                        const y = 104 - (hrs / 10) * 88;
                        return (
                          <g key={hrs}>
                            <line
                              x1={56}
                              y1={y}
                              x2={892}
                              y2={y}
                              stroke={hrs === 7.5 ? '#6366F1' : 'currentColor'}
                              className={hrs === 7.5 ? '' : 'text-slate-200 dark:text-slate-800'}
                              strokeDasharray="3 3"
                              opacity={hrs === 7.5 ? 0.6 : 1}
                            />
                            <text
                              x={50}
                              y={y + 4}
                              textAnchor="end"
                              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                            >
                              {hrs}h
                            </text>
                          </g>
                        );
                      })}

                      {chartSeries.map((d, i) => {
                        const x = 56 + (i / Math.max(1, len - 1)) * 836;
                        const hrs = (d.sleepSecs || 0) / 3600;
                        const barH = Math.min(90, (hrs / 10) * 88);
                        return (
                          <rect
                            key={i}
                            x={x - 2}
                            y={104 - barH}
                            width={4}
                            height={barH}
                            fill="#6366F1"
                            opacity={hoverIdx === i ? 0.95 : 0.55}
                          />
                        );
                      })}
                      <polyline
                        fill="none"
                        stroke="#38BDF8"
                        strokeWidth="2"
                        points={scorePts}
                      />
                      {hoverIdx !== null && chartSeries[hoverIdx] && (
                        <circle
                          cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                          cy={Math.max(
                            10,
                            Math.min(104, 104 - (((chartSeries[hoverIdx].sleepScore || 75) - 40) / 60) * 88)
                          )}
                          r={4.5}
                          fill="#38BDF8"
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                      )}
                      {renderXAxisDates(len, 122, 140)}
                      {renderInteractiveScrubber(len, 148, 106)}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* 4. Garmin HRV (rMSSD) + 7d Rolling Avg + 60d Normal Baseline Band Subplot */}
          {showHrvSubplot && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  4. Garmin Overnight HRV (rMSSD ms) · 7d Average (Emerald) &amp; 60d Normal Corridor
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  {activePoint.date}: HRV {activePoint.hrvRMSSD || '—'}ms · 7d Avg {activePoint.hrvBaseline7d || '—'}ms (Band {activePoint.hrvNormalBandLow || 42}–{activePoint.hrvNormalBandHigh || 62}ms)
                </span>
              </div>
              <svg viewBox="0 0 920 148" className="w-full h-36">
                {(() => {
                  const len = Math.max(1, chartSeries.length);
                  const toY = (ms: number) =>
                    Math.max(10, Math.min(104, 104 - ((ms - 25) / 65) * 88));

                  const bandTop = chartSeries.map(
                    (d, i) =>
                      `${56 + (i / Math.max(1, len - 1)) * 836},${toY(d.hrvNormalBandHigh || 62)}`
                  );
                  const bandBottom = [...chartSeries]
                    .reverse()
                    .map((d, revI) => {
                      const i = len - 1 - revI;
                      return `${56 + (i / Math.max(1, len - 1)) * 836},${toY(
                        d.hrvNormalBandLow || 42
                      )}`;
                    });

                  const avgPts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.hrvBaseline7d || d.hrvRMSSD || 52)}`;
                    })
                    .join(' ');

                  return (
                    <>
                      <text
                        x={14}
                        y={56}
                        transform="rotate(-90 14 56)"
                        textAnchor="middle"
                        className="fill-emerald-500 text-[11px] font-sans font-semibold"
                      >
                        HRV (ms)
                      </text>

                      <polygon
                        points={[...bandTop, ...bandBottom].join(' ')}
                        fill="rgba(16, 185, 129, 0.14)"
                      />
                      {[35, 50, 65, 80].map((ms) => (
                        <g key={ms}>
                          <line
                            x1={56}
                            y1={toY(ms)}
                            x2={892}
                            y2={toY(ms)}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-800"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={50}
                            y={toY(ms) + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {ms}ms
                          </text>
                        </g>
                      ))}
                      {chartSeries.map((d, i) => {
                        if (!d.hrvRMSSD) return null;
                        const x = 56 + (i / Math.max(1, len - 1)) * 836;
                        return (
                          <circle
                            key={i}
                            cx={x}
                            cy={toY(d.hrvRMSSD)}
                            r={hoverIdx === i ? 4.5 : 2.5}
                            fill={d.hrvStatus === 'Low' ? '#EF4444' : '#34D399'}
                            opacity={hoverIdx === i ? 1 : 0.8}
                          />
                        );
                      })}
                      <polyline
                        fill="none"
                        stroke="#10B981"
                        strokeWidth="2.25"
                        points={avgPts}
                      />
                      {renderXAxisDates(len, 122, 140)}
                      {renderInteractiveScrubber(len, 148, 106)}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* 5. Resting Heart Rate & VO2max Subplot */}
          {showRhrVo2Subplot && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  5. Garmin Resting Heart Rate (Rose · bpm) &amp; VO2max (Cyan · mL/kg/min)
                </span>
                <span className="font-mono text-rose-500 font-semibold">
                  {activePoint.date}: RHR {activePoint.restingHR || '—'} bpm · VO2max {activePoint.vo2MaxCycling || 51}
                </span>
              </div>
              <svg viewBox="0 0 920 148" className="w-full h-36">
                {(() => {
                  const len = Math.max(1, chartSeries.length);
                  const toY = (val: number) =>
                    Math.max(10, Math.min(104, 104 - ((val - 38) / 30) * 88));

                  const rhrPts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.restingHR || 49)}`;
                    })
                    .join(' ');

                  const vo2Pts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.vo2MaxCycling || 51)}`;
                    })
                    .join(' ');

                  return (
                    <>
                      <text
                        x={14}
                        y={56}
                        transform="rotate(-90 14 56)"
                        textAnchor="middle"
                        className="fill-rose-500 text-[11px] font-sans font-semibold"
                      >
                        RHR / VO2max
                      </text>
                      {[42, 50, 58, 65].map((val) => (
                        <g key={val}>
                          <line
                            x1={56}
                            y1={toY(val)}
                            x2={892}
                            y2={toY(val)}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-800"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={50}
                            y={toY(val) + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {val}
                          </text>
                        </g>
                      ))}
                      <polyline
                        fill="none"
                        stroke="#F43F5E"
                        strokeWidth="2"
                        points={rhrPts}
                      />
                      <polyline
                        fill="none"
                        stroke="#06B6D4"
                        strokeWidth="2"
                        points={vo2Pts}
                      />
                      {hoverIdx !== null && chartSeries[hoverIdx] && (
                        <>
                          <circle
                            cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                            cy={toY(chartSeries[hoverIdx].restingHR || 49)}
                            r={4.5}
                            fill="#F43F5E"
                            stroke="#fff"
                            strokeWidth="1.5"
                          />
                          <circle
                            cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                            cy={toY(chartSeries[hoverIdx].vo2MaxCycling || 51)}
                            r={4.5}
                            fill="#06B6D4"
                            stroke="#fff"
                            strokeWidth="1.5"
                          />
                        </>
                      )}
                      {renderXAxisDates(len, 122, 140)}
                      {renderInteractiveScrubber(len, 148, 106)}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* 6. Cycling & Running eFTP Subplot */}
          {showEftpSubplot && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-1.5">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  6. Estimated Functional Threshold Power (Bike eFTP Cyan · Run eFTP Orange)
                </span>
                <span className="font-mono text-cyan-600 dark:text-cyan-400 font-semibold">
                  {activePoint.date}: Bike eFTP {activePoint.rideEftp || 310}W · Run eFTP {activePoint.runEftp || 456}W
                </span>
              </div>
              <svg viewBox="0 0 920 148" className="w-full h-36">
                {(() => {
                  const len = Math.max(1, chartSeries.length);
                  const toY = (w: number) =>
                    Math.max(10, Math.min(104, 104 - ((w - 220) / 280) * 88));

                  const bikePts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.rideEftp || 310)}`;
                    })
                    .join(' ');
                  const runPts = chartSeries
                    .map((d, i) => {
                      const x = 56 + (i / Math.max(1, len - 1)) * 836;
                      return `${x},${toY(d.runEftp || 456)}`;
                    })
                    .join(' ');
                  return (
                    <>
                      <text
                        x={14}
                        y={56}
                        transform="rotate(-90 14 56)"
                        textAnchor="middle"
                        className="fill-cyan-500 text-[11px] font-sans font-semibold"
                      >
                        eFTP (Watts)
                      </text>
                      {[250, 325, 400, 475].map((w) => (
                        <g key={w}>
                          <line
                            x1={56}
                            y1={toY(w)}
                            x2={892}
                            y2={toY(w)}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-800"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={50}
                            y={toY(w) + 4}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                          >
                            {w}W
                          </text>
                        </g>
                      ))}
                      <polyline fill="none" stroke="#06B6D4" strokeWidth="2.25" points={bikePts} />
                      <polyline fill="none" stroke="#F97316" strokeWidth="2.25" points={runPts} />
                      {hoverIdx !== null && chartSeries[hoverIdx] && (
                        <>
                          <circle
                            cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                            cy={toY(chartSeries[hoverIdx].rideEftp || 310)}
                            r={4.5}
                            fill="#06B6D4"
                            stroke="#fff"
                            strokeWidth="1.5"
                          />
                          <circle
                            cx={56 + (hoverIdx / Math.max(1, len - 1)) * 836}
                            cy={toY(chartSeries[hoverIdx].runEftp || 456)}
                            r={4.5}
                            fill="#F97316"
                            stroke="#fff"
                            strokeWidth="1.5"
                          />
                        </>
                      )}
                      {renderXAxisDates(len, 122, 140)}
                      {renderInteractiveScrubber(len, 148, 106)}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}
        </div>

        {/* AI Coach Quick Action */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Want to optimize your taper or adjust this week&apos;s cycling/running load based on your Garmin Sleep Score ({latestWithSleep.sleepScore}) and HRV ({latestWithHrv.hrvRMSSD} ms)?
          </p>
          <button
            onClick={() =>
              onOpenCoachWithPrompt(
                `My Garmin Training Status is ${latestDay.garminTrainingStatus} (CTL ${latestDay.ctl}, ATL ${latestDay.atl}, TSB ${latestDay.tsb}), last night's Sleep Score was ${latestWithSleep.sleepScore} (${(latestWithSleep.sleepSecs / 3600).toFixed(1)}h), and HRV is ${latestWithHrv.hrvRMSSD}ms (${latestWithHrv.hrvStatus}). What training program adjustments do you recommend for the next 7 days?`
              )
            }
            className="min-h-[38px] px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
          >
            Analyze Fitness &amp; Sleep with AI Coach
          </button>
        </div>
      </section>
    </div>
  );
};
