import React, { Suspense, useMemo, useState } from 'react';
import { ArrowLeftRight, Columns2, Sparkles, X } from '../icons/PhosphorIcons';
import type { DistanceUnit, UnifiedActivity } from '../../types';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatStopwatch,
} from '../../utils/formatters';
import { ChartInfoTooltip } from '../ChartInfoTooltip';
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary';
import { extractActivitySeries, sampleSeriesAt } from './activitySeriesUtils';
import { UPlotStreamChart } from './activityLazyViews';

export interface ActivitiesComparePanelProps {
  activities: UnifiedActivity[];
  filteredActivities: UnifiedActivity[];
  distanceUnit: DistanceUnit;
  athleteWeightKg: number;
  isMobile: boolean;
  compareIdA: string | null;
  compareIdB: string | null;
  setCompareIdA: React.Dispatch<React.SetStateAction<string | null>>;
  setCompareIdB: React.Dispatch<React.SetStateAction<string | null>>;
  compareActivityA: UnifiedActivity | null;
  compareActivityB: UnifiedActivity | null;
  onAssignToCompareSlot: (act: UnifiedActivity, slot?: 'A' | 'B') => void;
  handleAutoMatchRepeatForA: () => void;
  onCloseCompare: () => void;
}

export const ActivitiesComparePanel: React.FC<ActivitiesComparePanelProps> = ({
  activities,
  filteredActivities,
  distanceUnit,
  athleteWeightKg,
  isMobile,
  compareIdA,
  compareIdB,
  setCompareIdA,
  setCompareIdB,
  compareActivityA,
  compareActivityB,
  onAssignToCompareSlot: handleAssignToCompareSlot,
  handleAutoMatchRepeatForA,
  onCloseCompare,
}) => {
  const [compareXMode, setCompareXMode] = useState<'PERCENT' | 'TIME'>('PERCENT');
  const [smoothStreams, setSmoothStreams] = useState<boolean>(true);
  const [compareHoverStep, setCompareHoverStep] = useState<number | null>(null);

  const overlaidComparisonData = useMemo(() => {
    if (!compareActivityA || !compareActivityB) return null;
    const win = smoothStreams ? 5 : 1;
    const seriesA = extractActivitySeries(compareActivityA, win);
    const seriesB = extractActivitySeries(compareActivityB, win);

    const maxDurationSecs = Math.max(
      compareActivityA.movingTimeSecs || 1,
      compareActivityB.movingTimeSecs || 1,
      seriesA.points[seriesA.points.length - 1]?.timeSecs || 1,
      seriesB.points[seriesB.points.length - 1]?.timeSecs || 1
    );

    const stepsCount = 100;
    const alignedSteps = Array.from({ length: stepsCount }, (_, idx) => {
      const frac = idx / (stepsCount - 1);
      const xVal = compareXMode === 'PERCENT' ? frac * 100 : Math.round(frac * maxDurationSecs);
      const ptA = sampleSeriesAt(seriesA.points, compareXMode, xVal);
      const ptB = sampleSeriesAt(seriesB.points, compareXMode, xVal);
      return {
        stepIndex: idx,
        frac,
        xLabel:
          compareXMode === 'PERCENT'
            ? `${Math.round(frac * 100)}%`
            : formatStopwatch(Math.round(frac * maxDurationSecs)),
        timeSecsA: ptA?.timeSecs,
        timeSecsB: ptB?.timeSecs,
        powerA: ptA?.power,
        powerB: ptB?.power,
        hrA: ptA?.hr,
        hrB: ptB?.hr,
        cadenceA: ptA?.cadence,
        cadenceB: ptB?.cadence,
      };
    });

    const allPowers = alignedSteps
      .flatMap((s) => [s.powerA, s.powerB])
      .filter((v): v is number => v !== undefined && v > 0);
    const maxPower = Math.max(320, ...allPowers, 100);

    const allHrs = alignedSteps
      .flatMap((s) => [s.hrA, s.hrB])
      .filter((v): v is number => v !== undefined && v > 0);
    const minHr = allHrs.length > 0 ? Math.max(60, Math.min(...allHrs) - 10) : 85;
    const maxHr = allHrs.length > 0 ? Math.max(175, Math.max(...allHrs) + 8) : 195;

    return {
      alignedSteps,
      maxDurationSecs,
      maxPower,
      minHr,
      maxHr,
      isRealStreamA: seriesA.isRealStream,
      isRealStreamB: seriesB.isRealStream,
    };
  }, [compareActivityA, compareActivityB, compareXMode, smoothStreams]);

  return (
        <section className="rounded-xl bg-white dark:bg-ap-carbon border-2 border-blue-500/40 shadow-lg p-5 space-y-6">
          {/* Top Bar: Title, Alignment Controls, Smoothing Toggle & Close */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Columns2 className="w-4 h-4 text-blue-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Split-View Workout Comparator — Overlaid Power &amp; Heart Rate Telemetry
                </h2>
                <ChartInfoTooltip
                  title="Split-View Overlaid Workout Telemetry"
                  subtitle="Head-to-Head Physiological Efficiency & Pacing Analysis"
                  whatItMeasures="Overlays second-by-second Power/Output and Heart Rate streams from two workouts (aligned by % completion or elapsed time) alongside side-by-side HR zone distribution."
                  benchmarks="Higher Normalized Power at the same or lower Heart Rate (higher EF) with lower Pa:Hr decoupling indicates superior mitochondrial efficiency and cardiac stroke volume."
                  liveStatus={
                    compareActivityA && compareActivityB
                      ? {
                          label: `A: EF ${compareActivityA.efficiencyFactor || '—'} vs B: EF ${compareActivityB.efficiencyFactor || '—'}`,
                          state:
                            (compareActivityA.efficiencyFactor || 0) >=
                            (compareActivityB.efficiencyFactor || 0)
                              ? 'optimal'
                              : 'neutral',
                          interpretation: `Comparing ${compareActivityA.name} (${compareActivityA.startDateLocal.slice(0, 10)}) against ${compareActivityB.name} (${compareActivityB.startDateLocal.slice(0, 10)}).`,
                        }
                      : undefined
                  }
                  coachingAction="Use 'Auto-Match Repeat' to pair two workouts of similar duration or route, then inspect the late-workout Heart Rate trace for divergence (cardiac drift)."
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Select any two workouts from the dropdowns below or click the <strong>A</strong> / <strong>B</strong> buttons on any row in the activity table below
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={compareXMode}
                aria-label="Comparison alignment axis"
                onChange={(e) => setCompareXMode(e.target.value as 'PERCENT' | 'TIME')}
                className="min-h-[44px] sm:min-h-[34px] rounded-xl liquid-glass-subtle px-3 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100 cursor-pointer"
              >
                <option value="PERCENT">Align by % Completion (0–100%)</option>
                <option value="TIME">Align by Elapsed Time (mm:ss)</option>
              </select>

              {/* Rolling Smoothing Toggle */}
              <button
                type="button"
                onClick={() => setSmoothStreams((prev) => !prev)}
                className={`min-h-[34px] px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                  smoothStreams
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {smoothStreams ? 'Smoothed Rolling Trace' : 'Raw 1s Stream'}
              </button>

              <button
                type="button"
                onClick={() => onCloseCompare()}
                className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Back to Activity Log
              </button>
            </div>
          </div>

          {/* Side-by-Side Workout A & Workout B Selector Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Workout A Card (Blue) */}
            <div className="lg:col-span-5 rounded-xl bg-blue-500/5 border border-blue-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                  Workout A (Baseline · Blue)
                </span>
                {compareActivityA && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityA.startDateLocal.slice(0, 10)} · {compareActivityA.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdA || ''}
                aria-label="Select Workout A for baseline comparison"
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'A');
                }}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-blue-500/30 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout A...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityA ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.distanceMeters > 0
                        ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-2xs text-slate-500">
                      {formatDuration(compareActivityA.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                      {compareActivityA.normalizedPower
                        ? `NP ${compareActivityA.normalizedPower}W`
                        : compareActivityA.avgPaceSecsPerKm
                          ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityA.trainingLoad} TSS`}
                    </div>
                    <div className="text-2xs text-slate-500">
                      Avg {compareActivityA.avgPower ? `${compareActivityA.avgPower}W` : '—'} · EF{' '}
                      {compareActivityA.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityA.avgHr > 0 ? `${compareActivityA.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-2xs text-slate-500">
                      Max {compareActivityA.maxHr || '—'} · Drift{' '}
                      {compareActivityA.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a workout above or click <strong>A</strong> on any row in the table.
                </div>
              )}
            </div>

            {/* Center Swap & Auto-Match Repeat Controls */}
            <div className="lg:col-span-2 flex flex-row lg:flex-col items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const temp = compareIdA;
                  setCompareIdA(compareIdB);
                  setCompareIdB(temp);
                }}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                <span>Swap A ↔ B</span>
              </button>
              <button
                type="button"
                onClick={handleAutoMatchRepeatForA}
                disabled={!compareActivityA}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors"
                title="Automatically find a similar distance/duration repeat workout for Slot B"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Match Repeat</span>
              </button>
            </div>

            {/* Workout B Card (Amber) */}
            <div className="lg:col-span-5 rounded-xl bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                  Workout B (Comparison · Amber)
                </span>
                {compareActivityB && (
                  <span className="text-xs font-mono text-slate-500">
                    {compareActivityB.startDateLocal.slice(0, 10)} · {compareActivityB.sportCategory}
                  </span>
                )}
              </div>

              <select
                value={compareIdB || ''}
                aria-label="Select Workout B for comparison"
                onChange={(e) => {
                  const found = activities.find((a) => a.id === e.target.value);
                  if (found) handleAssignToCompareSlot(found, 'B');
                }}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-amber-500/30 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              >
                <option value="">Select Workout B...</option>
                {filteredActivities.slice(0, 250).map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.startDateLocal.slice(0, 10)} — {act.name} (
                    {act.distanceMeters > 0
                      ? formatDistance(act.distanceMeters, distanceUnit, 1)
                      : formatDuration(act.movingTimeSecs)}
                    )
                  </option>
                ))}
              </select>

              {compareActivityB ? (
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Distance / Time</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.distanceMeters > 0
                        ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                        : 'Indoor'}
                    </div>
                    <div className="text-2xs text-slate-500">
                      {formatDuration(compareActivityB.movingTimeSecs)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Power / Pace</div>
                    <div className="font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      {compareActivityB.normalizedPower
                        ? `NP ${compareActivityB.normalizedPower}W`
                        : compareActivityB.avgPaceSecsPerKm
                          ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                          : `${compareActivityB.trainingLoad} TSS`}
                    </div>
                    <div className="text-2xs text-slate-500">
                      Avg {compareActivityB.avgPower ? `${compareActivityB.avgPower}W` : '—'} · EF{' '}
                      {compareActivityB.efficiencyFactor || '—'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-slate-200/70 dark:border-slate-800">
                    <div className="text-2xs font-sans text-slate-500">Heart Rate</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {compareActivityB.avgHr > 0 ? `${compareActivityB.avgHr} bpm` : '—'}
                    </div>
                    <div className="text-2xs text-slate-500">
                      Max {compareActivityB.maxHr || '—'} · Drift{' '}
                      {compareActivityB.aerobicDecouplingPct}%
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-4 text-center">
                  Pick a second workout above or click <strong>B</strong> on any row in the table.
                </div>
              )}
            </div>
          </div>

          {/* Overlaid Power & Heart Rate Charts + Head-to-Head Delta Analysis */}
          {compareActivityA && compareActivityB && overlaidComparisonData && (
            <div className="space-y-5">
              {/* SYNCHRONIZED 1HZ UPLOT TELEMETRY COMPARATOR (Shared uPlot.sync crosshair) */}
              {(compareActivityA.streams || compareActivityB.streams) && (
                <WorkspaceErrorBoundary fallbackTitle="1Hz Stream Comparator" restoreTab="activities">
                  <Suspense
                    fallback={
                      <div className="h-56 rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300">
                        Loading 1Hz Stream Comparator…
                      </div>
                    }
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {compareActivityA.streams && (
                        <UPlotStreamChart
                          streams={compareActivityA.streams}
                          sportCategory={compareActivityA.sportCategory}
                          distanceUnit={distanceUnit}
                          athleteWeightKg={athleteWeightKg}
                          intervals={compareActivityA.intervals}
                          syncKey="aeropulse-compare-sync"
                          height={220}
                        />
                      )}
                      {compareActivityB.streams && (
                        <UPlotStreamChart
                          streams={compareActivityB.streams}
                          sportCategory={compareActivityB.sportCategory}
                          distanceUnit={distanceUnit}
                          athleteWeightKg={athleteWeightKg}
                          intervals={compareActivityB.intervals}
                          syncKey="aeropulse-compare-sync"
                          height={220}
                        />
                      )}
                    </div>
                  </Suspense>
                </WorkspaceErrorBoundary>
              )}

              {/* 1. OVERLAID POWER / OUTPUT COMPARISON CHART */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Power / Output Profile —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} ({compareActivityA.startDateLocal.slice(0, 10)})
                      </span>{' '}
                      vs{' '}
                      <span className="text-amber-600 dark:text-amber-400">
                        B: {compareActivityB.name} ({compareActivityB.startDateLocal.slice(0, 10)})
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Power / Equivalent Output (Watts) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Power */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-ap-turf border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerA}W`
                          : '—'}
                      </span>
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        B:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].powerB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].powerB}W`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].powerA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].powerB !==
                          undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB! >=
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].powerA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].powerB!}
                            W
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg:{' '}
                        {compareActivityA.avgPower || compareActivityA.normalizedPower || '—'}W
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                        <span className="w-3 h-0.5 bg-amber-500 inline-block" />B Avg:{' '}
                        {compareActivityB.avgPower || compareActivityB.normalizedPower || '—'}W
                      </span>
                    </div>
                  )}
                </div>

                {(() => {
                  const svgW = isMobile ? 360 : 860;
                  const svgH = isMobile ? 185 : 205;
                  const { alignedSteps, maxPower } = overlaidComparisonData;
                  const len = alignedSteps.length;
                  const chartLeft = isMobile ? 36 : 62;
                  const chartRight = isMobile ? 350 : 830;
                  const chartW = chartRight - chartLeft;
                  const chartTop = isMobile ? 14 : 16;
                  const chartBottom = isMobile ? 152 : 156;
                  const chartH = chartBottom - chartTop;
                  return (
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      className={isMobile ? 'w-full h-auto select-none' : 'w-full h-52 select-none'}
                      onMouseLeave={() => setCompareHoverStep(null)}
                    >
                      {(() => {

                    const pointsA = alignedSteps
                      .filter((s) => s.powerA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerA! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsB = alignedSteps
                      .filter((s) => s.powerB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - (s.powerB! / maxPower) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        {!isMobile && (
                          <text
                            x={16}
                            y={86}
                            transform="rotate(-90 16 86)"
                            textAnchor="middle"
                            className="fill-blue-500 text-xs font-sans font-bold"
                          >
                            Power / Output (Watts)
                          </text>
                        )}

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const wVal = Math.round(f * maxPower);
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
                                x={chartLeft - 6}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                              >
                                {wVal}W
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Power Trace (Amber) */}
                        {pointsB && (
                          <polyline
                            fill="none"
                            stroke="#F59E0B"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsB}
                          />
                        )}

                        {/* Workout A Power Trace (Blue) */}
                        {pointsA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={chartBottom + 15}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={svgH - 6}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-2xs sm:text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Progress (% Total Duration)'
                            : 'Elapsed Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.powerA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerA / maxPower) * chartH)
                                )
                              : null;
                          const yB =
                            s.powerB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(chartBottom, chartBottom - (s.powerB / maxPower) * chartH)
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F59E0B"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                    </svg>
                  );
                })()}
              </div>

              {/* 2. OVERLAID HEART RATE COMPARISON CHART (Synchronized Crosshair) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Overlaid Heart Rate Response —{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        A: {compareActivityA.name} (Avg {compareActivityA.avgHr || '—'} bpm)
                      </span>{' '}
                      vs{' '}
                      <span className="text-rose-600 dark:text-rose-400">
                        B: {compareActivityB.name} (Avg {compareActivityB.avgHr || '—'} bpm)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Y-Axis: Heart Rate (bpm) · X-Axis:{' '}
                      {compareXMode === 'PERCENT'
                        ? 'Normalized Workout Progress (0% – 100%)'
                        : 'Elapsed Workout Time (mm:ss)'}
                    </p>
                  </div>

                  {/* Synchronized Hover Readout for Heart Rate */}
                  {compareHoverStep !== null &&
                  overlaidComparisonData.alignedSteps[compareHoverStep] ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums bg-white dark:bg-ap-turf border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5">
                      <span className="text-slate-500 font-semibold">
                        {compareXMode === 'PERCENT' ? 'Progress:' : 'Elapsed:'}{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].xLabel}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        A HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrA} bpm`
                          : '—'}
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-bold">
                        B HR:{' '}
                        {overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined
                          ? `${overlaidComparisonData.alignedSteps[compareHoverStep].hrB} bpm`
                          : '—'}
                      </span>
                      {overlaidComparisonData.alignedSteps[compareHoverStep].hrA !== undefined &&
                        overlaidComparisonData.alignedSteps[compareHoverStep].hrB !== undefined && (
                          <span
                            className={`font-bold ${
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                                overlaidComparisonData.alignedSteps[compareHoverStep].hrB! <=
                              0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            Δ (A−B):{' '}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB! >
                            0
                              ? '+'
                              : ''}
                            {overlaidComparisonData.alignedSteps[compareHoverStep].hrA! -
                              overlaidComparisonData.alignedSteps[compareHoverStep].hrB!}{' '}
                            bpm
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                        <span className="w-3 h-0.5 bg-blue-500 inline-block" />A Avg/Max:{' '}
                        {compareActivityA.avgHr || '—'}/{compareActivityA.maxHr || '—'} bpm
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold">
                        <span className="w-3 h-0.5 bg-rose-500 inline-block" />B Avg/Max:{' '}
                        {compareActivityB.avgHr || '—'}/{compareActivityB.maxHr || '—'} bpm
                      </span>
                    </div>
                  )}
                </div>

                {(() => {
                  const svgW = isMobile ? 360 : 860;
                  const svgH = isMobile ? 185 : 205;
                  const { alignedSteps, minHr, maxHr } = overlaidComparisonData;
                  const len = alignedSteps.length;
                  const chartLeft = isMobile ? 36 : 62;
                  const chartRight = isMobile ? 350 : 830;
                  const chartW = chartRight - chartLeft;
                  const chartTop = isMobile ? 14 : 16;
                  const chartBottom = isMobile ? 152 : 156;
                  const chartH = chartBottom - chartTop;
                  return (
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      className={isMobile ? 'w-full h-auto select-none' : 'w-full h-52 select-none'}
                      onMouseLeave={() => setCompareHoverStep(null)}
                    >
                      {(() => {
                    const hrSpan = Math.max(20, maxHr - minHr);

                    const pointsHrA = alignedSteps
                      .filter((s) => s.hrA !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrA! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    const pointsHrB = alignedSteps
                      .filter((s) => s.hrB !== undefined)
                      .map((s) => {
                        const x = chartLeft + s.frac * chartW;
                        const y = chartBottom - ((s.hrB! - minHr) / hrSpan) * chartH;
                        return `${x},${Math.max(chartTop, Math.min(chartBottom, y))}`;
                      })
                      .join(' ');

                    return (
                      <>
                        {/* Y-Axis Title */}
                        {!isMobile && (
                          <text
                            x={16}
                            y={86}
                            transform="rotate(-90 16 86)"
                            textAnchor="middle"
                            className="fill-rose-500 text-xs font-sans font-bold"
                          >
                            Heart Rate (bpm)
                          </text>
                        )}

                        {/* Horizontal Grid Lines & Y-Axis Ticks */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const y = chartBottom - f * chartH;
                          const hrVal = Math.round(minHr + f * hrSpan);
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
                                x={chartLeft - 6}
                                y={y + 4}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                              >
                                {hrVal}
                              </text>
                            </g>
                          );
                        })}

                        {/* Workout B Heart Rate Trace (Rose/Red) */}
                        {pointsHrB && (
                          <polyline
                            fill="none"
                            stroke="#F43F5E"
                            strokeWidth="2.2"
                            strokeOpacity="0.9"
                            points={pointsHrB}
                          />
                        )}

                        {/* Workout A Heart Rate Trace (Blue) */}
                        {pointsHrA && (
                          <polyline
                            fill="none"
                            stroke="#3B82F6"
                            strokeWidth="2.2"
                            points={pointsHrA}
                          />
                        )}

                        {/* X-Axis Ticks & Label */}
                        {[0, 0.25, 0.5, 0.75, 1].map((f, idx) => {
                          const x = chartLeft + f * chartW;
                          const label =
                            compareXMode === 'PERCENT'
                              ? `${Math.round(f * 100)}%`
                              : formatStopwatch(
                                  Math.round(f * overlaidComparisonData.maxDurationSecs)
                                );
                          return (
                            <text
                              key={idx}
                              x={x}
                              y={chartBottom + 15}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-2xs font-mono"
                            >
                              {label}
                            </text>
                          );
                        })}
                        <text
                          x={chartLeft + chartW / 2}
                          y={svgH - 6}
                          textAnchor="middle"
                          className="fill-slate-600 dark:fill-slate-300 text-2xs sm:text-xs font-sans font-bold"
                        >
                          {compareXMode === 'PERCENT'
                            ? 'Progress (% Total Duration)'
                            : 'Elapsed Time (mm:ss)'}
                        </text>

                        {/* Interactive Crosshair Hit Columns */}
                        {alignedSteps.map((s, idx) => {
                          const x = chartLeft + s.frac * chartW;
                          const colW = chartW / Math.max(1, len);
                          const isHovered = compareHoverStep === idx;
                          const yA =
                            s.hrA !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrA - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          const yB =
                            s.hrB !== undefined
                              ? Math.max(
                                  chartTop,
                                  Math.min(
                                    chartBottom,
                                    chartBottom - ((s.hrB - minHr) / hrSpan) * chartH
                                  )
                                )
                              : null;
                          return (
                            <g key={idx}>
                              {isHovered && (
                                <>
                                  <line
                                    x1={x}
                                    y1={chartTop}
                                    x2={x}
                                    y2={chartBottom}
                                    stroke="#94A3B8"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                  />
                                  {yA !== null && (
                                    <circle
                                      cx={x}
                                      cy={yA}
                                      r={4.5}
                                      fill="#3B82F6"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                  {yB !== null && (
                                    <circle
                                      cx={x}
                                      cy={yB}
                                      r={4.5}
                                      fill="#F43F5E"
                                      stroke="#fff"
                                      strokeWidth="1.5"
                                    />
                                  )}
                                </>
                              )}
                              <rect
                                x={x - colW / 2}
                                y={0}
                                width={colW}
                                height={180}
                                fill="transparent"
                                className="cursor-crosshair"
                                onMouseEnter={() => setCompareHoverStep(idx)}
                                onMouseMove={() => setCompareHoverStep(idx)}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                    </svg>
                  );
                })()}
              </div>

              {/* 3. SIDE-BY-SIDE METRIC DELTA TABLE & DUAL HEART RATE ZONE COMPARISON */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left: Head-to-Head Physiological Metrics Table */}
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Head-to-Head Physiological Telemetry Deltas (A vs B)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Δ = Workout A − Workout B
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm border-collapse font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-sans text-slate-500">
                          <th className="py-2 pr-3">Metric</th>
                          <th className="py-2 px-3 text-right text-blue-600 dark:text-blue-400">
                            Workout A ({compareActivityA.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 px-3 text-right text-amber-600 dark:text-amber-400">
                            Workout B ({compareActivityB.startDateLocal.slice(0, 10)})
                          </th>
                          <th className="py-2 pl-3 text-right">Delta (A − B)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {(() => {
                          const npA = compareActivityA.normalizedPower || compareActivityA.avgPower || 0;
                          const npB = compareActivityB.normalizedPower || compareActivityB.avgPower || 0;
                          const efA = compareActivityA.efficiencyFactor || 0;
                          const efB = compareActivityB.efficiencyFactor || 0;
                          const hrA = compareActivityA.avgHr || 0;
                          const hrB = compareActivityB.avgHr || 0;
                          const driftA = compareActivityA.aerobicDecouplingPct || 0;
                          const driftB = compareActivityB.aerobicDecouplingPct || 0;

                          const rows = [
                            {
                              label: 'Distance',
                              valA:
                                compareActivityA.distanceMeters > 0
                                  ? formatDistance(compareActivityA.distanceMeters, distanceUnit, 2)
                                  : '—',
                              valB:
                                compareActivityB.distanceMeters > 0
                                  ? formatDistance(compareActivityB.distanceMeters, distanceUnit, 2)
                                  : '—',
                              delta:
                                compareActivityA.distanceMeters > 0 &&
                                compareActivityB.distanceMeters > 0
                                  ? `${compareActivityA.distanceMeters >= compareActivityB.distanceMeters ? '+' : '-'}${formatDistance(
                                      Math.abs(
                                        compareActivityA.distanceMeters -
                                          compareActivityB.distanceMeters
                                      ),
                                      distanceUnit,
                                      2
                                    )}`
                                  : '—',
                              good: true,
                            },
                            {
                              label: 'Moving Duration',
                              valA: formatDuration(compareActivityA.movingTimeSecs),
                              valB: formatDuration(compareActivityB.movingTimeSecs),
                              delta: `${compareActivityA.movingTimeSecs >= compareActivityB.movingTimeSecs ? '+' : '-'}${formatDuration(
                                Math.abs(
                                  compareActivityA.movingTimeSecs - compareActivityB.movingTimeSecs
                                )
                              )}`,
                              good: true,
                            },
                            {
                              label: 'Normalized / Avg Power',
                              valA: npA > 0 ? `${npA}W` : '—',
                              valB: npB > 0 ? `${npB}W` : '—',
                              delta:
                                npA > 0 && npB > 0
                                  ? `${npA - npB >= 0 ? '+' : ''}${npA - npB}W`
                                  : '—',
                              good: npA >= npB,
                            },
                            {
                              label: 'Average Pace',
                              valA: compareActivityA.avgPaceSecsPerKm
                                ? formatPace(compareActivityA.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              valB: compareActivityB.avgPaceSecsPerKm
                                ? formatPace(compareActivityB.avgPaceSecsPerKm, distanceUnit)
                                : '—',
                              delta:
                                compareActivityA.avgPaceSecsPerKm &&
                                compareActivityB.avgPaceSecsPerKm
                                  ? (() => {
                                      const rawDiff =
                                        compareActivityA.avgPaceSecsPerKm -
                                        compareActivityB.avgPaceSecsPerKm;
                                      const scaledDiff =
                                        distanceUnit === 'mi'
                                          ? Math.round(rawDiff * 1.609344)
                                          : Math.round(rawDiff);
                                      return `${scaledDiff <= 0 ? '' : '+'}${scaledDiff}s/${distanceUnit}`;
                                    })()
                                  : '—',
                              good:
                                (compareActivityA.avgPaceSecsPerKm || 0) <=
                                (compareActivityB.avgPaceSecsPerKm || 0),
                            },
                            {
                              label: 'Average Heart Rate',
                              valA: hrA > 0 ? `${hrA} bpm` : '—',
                              valB: hrB > 0 ? `${hrB} bpm` : '—',
                              delta:
                                hrA > 0 && hrB > 0
                                  ? `${hrA - hrB >= 0 ? '+' : ''}${hrA - hrB} bpm`
                                  : '—',
                              good: hrA <= hrB,
                            },
                            {
                              label: 'Efficiency Factor (EF)',
                              valA: efA > 0 ? efA.toFixed(2) : '—',
                              valB: efB > 0 ? efB.toFixed(2) : '—',
                              delta:
                                efA > 0 && efB > 0
                                  ? `${efA - efB >= 0 ? '+' : ''}${(efA - efB).toFixed(2)}`
                                  : '—',
                              good: efA >= efB,
                            },
                            {
                              label: 'Aerobic Decoupling (Drift)',
                              valA: `${driftA}%`,
                              valB: `${driftB}%`,
                              delta: `${driftA - driftB >= 0 ? '+' : ''}${(driftA - driftB).toFixed(1)}%`,
                              good: driftA <= driftB,
                            },
                            {
                              label: 'Training Load (TSS)',
                              valA: `${compareActivityA.trainingLoad} TSS`,
                              valB: `${compareActivityB.trainingLoad} TSS`,
                              delta: `${compareActivityA.trainingLoad - compareActivityB.trainingLoad >= 0 ? '+' : ''}${compareActivityA.trainingLoad - compareActivityB.trainingLoad} TSS`,
                              good: true,
                            },
                          ];

                          return rows.map((r, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-3 font-sans font-medium text-slate-700 dark:text-slate-300">
                                {r.label}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valA}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                                {r.valB}
                              </td>
                              <td
                                className={`py-2 pl-3 text-right font-bold ${
                                  r.delta === '—'
                                    ? 'text-slate-600 dark:text-slate-400'
                                    : r.good
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {r.delta}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right: Side-by-Side Time in Heart Rate Zones (Workout A vs Workout B) */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Side-by-Side HR Zone Distribution (Z1–Z6)
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Blue: A · Amber: B
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {['Z1 Rec', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2max', 'Z6 Anaerobic'].map(
                      (zLabel, idx) => {
                        const totA = Math.max(
                          1,
                          compareActivityA.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const totB = Math.max(
                          1,
                          compareActivityB.zoneSecs.hr.reduce((a, b) => a + b, 0)
                        );
                        const secsA = compareActivityA.zoneSecs.hr[idx] || 0;
                        const secsB = compareActivityB.zoneSecs.hr[idx] || 0;
                        const pctA = Math.round((secsA / totA) * 100);
                        const pctB = Math.round((secsB / totB) * 100);

                        return (
                          <div key={idx} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between font-mono">
                              <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">
                                {zLabel}
                              </span>
                              <span className="tabular-nums">
                                <strong className="text-blue-600 dark:text-blue-400">
                                  A: {Math.round(secsA / 60)}m ({pctA}%)
                                </strong>
                                {' · '}
                                <strong className="text-amber-600 dark:text-amber-400">
                                  B: {Math.round(secsB / 60)}m ({pctB}%)
                                </strong>
                              </span>
                            </div>
                            <div className="space-y-1">
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctA}%` }}
                                  className="h-full bg-blue-500"
                                />
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${pctB}%` }}
                                  className="h-full bg-amber-500"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                    <div className="text-center text-2xs font-semibold text-slate-500 pt-1">
                      Y-Axis: Physiological HR Zone · X-Axis: Share of Workout Time (0% – 100%)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
  );
};
