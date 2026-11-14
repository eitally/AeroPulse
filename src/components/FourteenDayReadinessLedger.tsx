import React, { useMemo } from 'react';
import { UnifiedWellnessDay } from '../types';
import { ChartInfoTooltip } from './ChartInfoTooltip';

interface FourteenDayReadinessLedgerProps {
  wellnessDays: UnifiedWellnessDay[];
}

type MeanBandStatus = 'WITHIN_25_GREEN' | 'BELOW_25_RED' | 'ABOVE_25_GRAY';

interface CellMeanEvaluation {
  pctDelta: number;
  status: MeanBandStatus;
}

export type IntervalsFormZone =
  | 'HIGH_RISK'
  | 'OPTIMAL'
  | 'GREY_ZONE'
  | 'FRESH'
  | 'TRANSITION';

export interface FormZoneMeta {
  zone: IntervalsFormZone;
  label: string;
  hex: string;
  cellClasses: string;
  badgeClasses: string;
}

/**
 * Intervals.icu exact 5-zone Form (TSB = CTL - ATL) classification & color scheme:
 * - High Risk (< -30): Red (#EF4444)
 * - Optimal (-30 to -10): Green (#10B981)
 * - Grey Zone (-10 to +5): Gray (#94A3B8)
 * - Fresh (+5 to +20): Blue (#0EA5E9 / #3B82F6)
 * - Transition (> +20): Yellow / Amber (#F59E0B)
 */
export function getIntervalsFormZone(tsb: number): FormZoneMeta {
  if (tsb < -30) {
    return {
      zone: 'HIGH_RISK',
      label: 'High Risk',
      hex: '#EF4444',
      cellClasses:
        'bg-rose-500/12 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-l border-l-rose-500 font-semibold',
      badgeClasses:
        'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30',
    };
  }
  if (tsb <= -10) {
    return {
      zone: 'OPTIMAL',
      label: 'Optimal',
      hex: '#10B981',
      cellClasses:
        'bg-emerald-500/12 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-l border-l-emerald-500 font-semibold',
      badgeClasses:
        'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
    };
  }
  if (tsb < 5) {
    return {
      zone: 'GREY_ZONE',
      label: 'Grey Zone',
      hex: '#94A3B8',
      cellClasses:
        'bg-slate-200/60 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-l border-l-slate-400 font-semibold',
      badgeClasses:
        'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-400/30',
    };
  }
  if (tsb <= 20) {
    return {
      zone: 'FRESH',
      label: 'Fresh',
      hex: '#0EA5E9',
      cellClasses:
        'bg-sky-500/12 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-l border-l-sky-500 font-semibold',
      badgeClasses:
        'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30',
    };
  }
  return {
    zone: 'TRANSITION',
    label: 'Transition',
    hex: '#F59E0B',
    cellClasses:
      'bg-amber-500/12 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-l border-l-amber-500 font-semibold',
    badgeClasses:
      'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  };
}

/**
 * Computes numerical readiness score (0-100) for a day so Readiness has an exact 14-day mean.
 */
function computeDailyReadinessScore(w: UnifiedWellnessDay): number {
  const baseStatusScore =
    w.readinessStatus === 'Optimal' ? 88 : w.readinessStatus === 'Caution' ? 62 : 36;
  const hrvRatio =
    w.hrvBaseline7d > 0 && w.hrvRMSSD > 0
      ? Math.max(0.5, Math.min(1.4, w.hrvRMSSD / w.hrvBaseline7d))
      : 1;
  const sleepComponent = w.sleepScore > 0 ? w.sleepScore : baseStatusScore;
  const raw = baseStatusScore * 0.45 + sleepComponent * 0.35 + hrvRatio * 75 * 0.2;
  return Math.round(Math.max(15, Math.min(100, raw)));
}

/**
 * Evaluates a daily metric value against the 14-day mean:
 * - Within ±25% of 14-day mean (-25% <= pctDelta <= +25%): GREEN
 * - >25% less than 14-day mean (pctDelta < -25%): RED
 * - >25% more than 14-day mean (pctDelta > +25%): GRAY
 */
function evaluateVs14dMeanBand(value: number, mean: number): CellMeanEvaluation {
  const denominator = Math.max(0.1, Math.abs(mean));
  const pctDelta = ((value - mean) / denominator) * 100;

  if (pctDelta < -25) {
    return {
      pctDelta,
      status: 'BELOW_25_RED',
    };
  }

  if (pctDelta > 25) {
    return {
      pctDelta,
      status: 'ABOVE_25_GRAY',
    };
  }

  return {
    pctDelta,
    status: 'WITHIN_25_GREEN',
  };
}

function getMeanCellClasses(status: MeanBandStatus): string {
  switch (status) {
    case 'WITHIN_25_GREEN':
      return 'bg-emerald-500/12 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-l border-l-emerald-500 font-semibold';
    case 'BELOW_25_RED':
      return 'bg-rose-500/12 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-l border-l-rose-500 font-semibold';
    case 'ABOVE_25_GRAY':
    default:
      return 'bg-slate-200/65 dark:bg-slate-800/75 text-slate-600 dark:text-slate-300 border-l border-l-slate-400 font-semibold';
  }
}

function getMeanDeltaPillClasses(status: MeanBandStatus): string {
  switch (status) {
    case 'WITHIN_25_GREEN':
      return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30';
    case 'BELOW_25_RED':
      return 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30';
    case 'ABOVE_25_GRAY':
    default:
      return 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-400/30';
  }
}

function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
}

const FourteenDayReadinessLedgerInner: React.FC<FourteenDayReadinessLedgerProps> = ({
  wellnessDays,
}) => {
  const chronological14 = useMemo(() => wellnessDays.slice(-14), [wellnessDays]);

  const enrichedRowsAndMeans = useMemo(() => {
    const rows = chronological14.map((w) => ({
      ...w,
      readinessScore: computeDailyReadinessScore(w),
    }));

    const avgOf = (vals: number[], allowZero = false) => {
      const valid = allowZero ? vals : vals.filter((v) => v > 0);
      if (valid.length === 0) return 0;
      return valid.reduce((acc, v) => acc + v, 0) / valid.length;
    };

    const means = {
      readinessScore: avgOf(rows.map((r) => r.readinessScore)),
      hrvRMSSD: avgOf(rows.map((r) => r.hrvRMSSD)),
      restingHR: avgOf(rows.map((r) => r.restingHR)),
      sleepScore: avgOf(rows.map((r) => r.sleepScore)),
      ctl: avgOf(rows.map((r) => r.ctl), true),
      atl: avgOf(rows.map((r) => r.atl), true),
      tsb: avgOf(rows.map((r) => r.tsb), true),
      dailyLoad: avgOf(rows.map((r) => r.dailyLoad), true),
    };

    const ctlVals = rows.map((r) => r.ctl);
    const atlVals = rows.map((r) => r.atl);

    const ctlMinRaw = Math.min(...ctlVals, means.ctl);
    const ctlMaxRaw = Math.max(...ctlVals, means.ctl);
    const ctlSpan = Math.max(2.5, ctlMaxRaw - ctlMinRaw);
    const ctlBounds = {
      min: ctlMinRaw - ctlSpan * 0.18,
      max: ctlMaxRaw + ctlSpan * 0.18,
    };

    const atlMinRaw = Math.min(...atlVals, means.atl);
    const atlMaxRaw = Math.max(...atlVals, means.atl);
    const atlSpan = Math.max(6.0, atlMaxRaw - atlMinRaw);
    const atlBounds = {
      min: atlMinRaw - atlSpan * 0.15,
      max: atlMaxRaw + atlSpan * 0.15,
    };

    return {
      rows: [...rows].reverse(), // Most recent day first in table (index 0 = Today, index 13 = 14d ago)
      means,
      ctlBounds,
      atlBounds,
    };
  }, [chronological14]);

  const { rows, means, ctlBounds, atlBounds } = enrichedRowsAndMeans;

  // Map a value into horizontal coordinate [6, 50] inside a 56px-wide vertical trend track
  const normTrackX = (val: number, bounds: { min: number; max: number }): number => {
    const span = Math.max(0.001, bounds.max - bounds.min);
    const ratio = Math.max(0, Math.min(1, (val - bounds.min) / span));
    return Number((6 + ratio * 44).toFixed(1));
  };

  const ctlMeanX = normTrackX(means.ctl, ctlBounds);
  const atlMeanX = normTrackX(means.atl, atlBounds);
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <section className="rounded-2xl liquid-glass px-4 py-3.5 sm:px-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            14-Day Readiness Ledger
          </h2>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            14d Mean: <strong className="text-[#0F766E] dark:text-[#2DD4BF]">CTL {means.ctl.toFixed(1)}</strong> ·{' '}
            <strong className="text-emerald-700 dark:text-emerald-400">HRV {means.hrvRMSSD.toFixed(0)}ms</strong> ·{' '}
            <strong className="text-slate-700 dark:text-slate-200">{means.dailyLoad.toFixed(0)} TSS/d</strong>
          </span>
          <div>
            <ChartInfoTooltip
              title="14-Day Readiness & Vertical CTL/ATL Trend Ledger"
              subtitle="Acute-vs-Baseline Homeostasis & Vertical 14-Day Trajectory"
              whatItMeasures="Compares each day's Readiness, Overnight HRV rMSSD, Resting HR, Sleep Score, and Daily Training Load against your rolling 14-day mean while plotting a continuous 14-day vertical trend line (and day-over-day delta) for Fitness (CTL) and Fatigue (ATL)."
              benchmarks="Green: Within ±25% of your 14-day mean (consistent homeostasis). Red: >25% below your 14-day mean (autonomic suppression or recovery day). Gray: >25% above your 14-day mean (acute overload spike). In the CTL & ATL columns, the vertical curve flows from 14 days ago (bottom) to Today (top) against the dashed 14-day mean reference line."
              liveStatus={{
                label: `14d Mean Load: ${means.dailyLoad.toFixed(0)} TSS · Mean HRV: ${means.hrvRMSSD.toFixed(1)}ms · Mean Form: ${means.tsb > 0 ? `+${means.tsb.toFixed(1)}` : means.tsb.toFixed(1)}`,
                state:
                  means.tsb < -30
                    ? 'warning'
                    : means.tsb <= -10 || (means.tsb >= 5 && means.tsb <= 20)
                      ? 'optimal'
                      : 'neutral',
                interpretation: `Your 14-day average daily load is ${means.dailyLoad.toFixed(0)} TSS (green consistency band: ${Math.round(means.dailyLoad * 0.75)}–${Math.round(means.dailyLoad * 1.25)} TSS) with a mean HRV of ${means.hrvRMSSD.toFixed(1)}ms.`,
              }}
              coachingAction="Watch the vertical CTL (teal) and ATL (rose) trajectories alongside HRV: when ATL curves sharply right (rising fatigue) and triggers 2+ Red HRV cells, schedule an active recovery day."
            />
          </div>
        </div>

        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls="thresh-14d-readiness-table"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl liquid-glass-subtle text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-700/40 dark:hover:border-emerald-400/40 transition-colors"
        >
          <span>{isExpanded ? 'Hide 14-Day Table' : 'Show 14-Day Table'}</span>
          <span className="text-2xs font-mono" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
        </button>
      </div>

      {/* 14-Day Table */}
      {isExpanded && (
      <div
        id="thresh-14d-readiness-table"
        className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/30 dark:bg-slate-950/30"
      >
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-100/70 dark:bg-slate-900/70 border-b border-slate-200/80 dark:border-white/10 text-slate-500 dark:text-slate-400 text-2xs uppercase tracking-wider">
              <th className="py-2.5 px-3 font-semibold">Date</th>
              <th className="py-2.5 px-3 font-semibold">Readiness</th>
              <th className="py-2.5 px-3 text-right font-semibold">HRV</th>
              <th className="py-2.5 px-3 text-right font-semibold">RHR</th>
              <th className="py-2.5 px-3 text-right font-semibold">Sleep</th>
              <th className="py-2.5 px-3 text-right font-semibold text-[#0F766E] dark:text-[#2DD4BF]">
                CTL (14d)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold text-[#BE123C] dark:text-[#FB7185]">
                ATL (14d)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold">
                Form (TSB)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold">
                Load
              </th>
            </tr>

            {/* Pinned 14-Day Mean Baseline Row */}
            <tr className="bg-emerald-950/6 dark:bg-emerald-400/10 border-b-2 border-emerald-700/25 dark:border-emerald-400/25 font-mono text-xs text-emerald-950 dark:text-emerald-50">
              <td className="py-2 px-3 font-sans font-bold text-[#1C5436] dark:text-[#C8FF00] whitespace-nowrap">
                14d Mean
              </td>
              <td className="py-2 px-3 font-bold">
                {means.readinessScore.toFixed(0)}/100
              </td>
              <td className="py-2 px-3 text-right font-bold">
                {means.hrvRMSSD > 0 ? `${means.hrvRMSSD.toFixed(1)} ms` : '—'}
              </td>
              <td className="py-2 px-3 text-right font-bold">
                {means.restingHR > 0 ? `${means.restingHR.toFixed(1)} bpm` : '—'}
              </td>
              <td className="py-2 px-3 text-right font-bold">
                {means.sleepScore > 0 ? `${means.sleepScore.toFixed(1)}/100` : '—'}
              </td>
              <td className="py-2 px-3 text-right font-bold text-[#0F766E] dark:text-[#2DD4BF] whitespace-nowrap">
                {means.ctl.toFixed(1)}
              </td>
              <td className="py-2 px-3 text-right font-bold text-[#BE123C] dark:text-[#FB7185] whitespace-nowrap">
                {means.atl.toFixed(1)}
              </td>
              <td className="py-2 px-3 text-right font-bold">
                {(() => {
                  const meanForm = getIntervalsFormZone(means.tsb);
                  const meanTextClass =
                    meanForm.zone === 'HIGH_RISK'
                      ? 'text-rose-700 dark:text-rose-300'
                      : meanForm.zone === 'OPTIMAL'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : meanForm.zone === 'FRESH'
                          ? 'text-sky-700 dark:text-sky-300'
                          : meanForm.zone === 'TRANSITION'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-slate-700 dark:text-slate-300';
                  return (
                    <span className={meanTextClass}>
                      {means.tsb > 0 ? `+${means.tsb.toFixed(1)}` : means.tsb.toFixed(1)}
                    </span>
                  );
                })()}
              </td>
              <td className="py-2 px-3 text-right font-bold text-emerald-700 dark:text-emerald-300">
                {means.dailyLoad.toFixed(0)} TSS
              </td>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
            {rows.map((w, rowIdx) => {
              // 14-day mean rule: Green if within ±25% of 14d mean, Red if >25% below mean, Gray if >25% above mean
              const readinessEval = evaluateVs14dMeanBand(
                w.readinessScore,
                means.readinessScore
              );
              const hrvEval =
                w.hrvRMSSD > 0 && means.hrvRMSSD > 0
                  ? evaluateVs14dMeanBand(w.hrvRMSSD, means.hrvRMSSD)
                  : null;
              const rhrEval =
                w.restingHR > 0 && means.restingHR > 0
                  ? evaluateVs14dMeanBand(w.restingHR, means.restingHR)
                  : null;
              const sleepEval =
                w.sleepScore > 0 && means.sleepScore > 0
                  ? evaluateVs14dMeanBand(w.sleepScore, means.sleepScore)
                  : null;
              const loadEval = evaluateVs14dMeanBand(w.dailyLoad, means.dailyLoad);

              // Neighboring rows: rowIdx - 1 is newer (above), rowIdx + 1 is older/yesterday (below)
              const newerRow = rowIdx > 0 ? rows[rowIdx - 1] : null;
              const olderRow = rowIdx < rows.length - 1 ? rows[rowIdx + 1] : null;

              // Vertical CTL coordinates ( seamlessly connecting row-to-row from bottom to top )
              const ctlXCurr = normTrackX(w.ctl, ctlBounds);
              const ctlXTop = newerRow
                ? Number(((ctlXCurr + normTrackX(newerRow.ctl, ctlBounds)) / 2).toFixed(1))
                : ctlXCurr;
              const ctlXBot = olderRow
                ? Number(((ctlXCurr + normTrackX(olderRow.ctl, ctlBounds)) / 2).toFixed(1))
                : ctlXCurr;
              const ctlDayDelta = olderRow ? Number((w.ctl - olderRow.ctl).toFixed(1)) : 0;

              // Vertical ATL coordinates ( seamlessly connecting row-to-row from bottom to top )
              const atlXCurr = normTrackX(w.atl, atlBounds);
              const atlXTop = newerRow
                ? Number(((atlXCurr + normTrackX(newerRow.atl, atlBounds)) / 2).toFixed(1))
                : atlXCurr;
              const atlXBot = olderRow
                ? Number(((atlXCurr + normTrackX(olderRow.atl, atlBounds)) / 2).toFixed(1))
                : atlXCurr;
              const atlDayDelta = olderRow ? Number((w.atl - olderRow.atl).toFixed(1)) : 0;

              const formMeta = getIntervalsFormZone(w.tsb);

              return (
                <tr
                  key={w.date}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-colors"
                >
                  {/* Date */}
                  <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100 whitespace-nowrap font-medium">
                    {w.date}
                  </td>

                  {/* Readiness (within ±25% Green, < -25% Red, > +25% Gray) */}
                  <td
                    className={`py-2.5 px-3 whitespace-nowrap ${getMeanCellClasses(
                      readinessEval.status
                    )}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-sans font-semibold">{w.readinessStatus}</span>{' '}
                        <span className="text-2xs opacity-80">({w.readinessScore})</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-2xs ${getMeanDeltaPillClasses(
                          readinessEval.status
                        )}`}
                      >
                        {formatSignedPct(readinessEval.pctDelta)}
                      </span>
                    </div>
                  </td>

                  {/* HRV (rMSSD) */}
                  <td
                    className={`py-2.5 px-3 text-right whitespace-nowrap ${
                      hrvEval ? getMeanCellClasses(hrvEval.status) : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {w.hrvRMSSD > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>
                          {w.hrvRMSSD} ms{' '}
                          <span className="text-2xs opacity-70">({w.hrvBaseline7d})</span>
                        </span>
                        {hrvEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-2xs ${getMeanDeltaPillClasses(
                              hrvEval.status
                            )}`}
                          >
                            {formatSignedPct(hrvEval.pctDelta)}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>

                  {/* Resting HR */}
                  <td
                    className={`py-2.5 px-3 text-right whitespace-nowrap ${
                      rhrEval ? getMeanCellClasses(rhrEval.status) : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {w.restingHR > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>{w.restingHR} bpm</span>
                        {rhrEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-2xs ${getMeanDeltaPillClasses(
                              rhrEval.status
                            )}`}
                          >
                            {formatSignedPct(rhrEval.pctDelta)}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>

                  {/* Sleep Score */}
                  <td
                    className={`py-2.5 px-3 text-right whitespace-nowrap ${
                      sleepEval ? getMeanCellClasses(sleepEval.status) : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {w.sleepScore > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>{w.sleepScore}/100</span>
                        {sleepEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-2xs ${getMeanDeltaPillClasses(
                              sleepEval.status
                            )}`}
                          >
                            {formatSignedPct(sleepEval.pctDelta)}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>

                  {/* CTL (Fitness) — Continuous Vertical 14-Day Trend Track + Value + d/d Delta */}
                  <td
                    className="py-0 px-3 text-right whitespace-nowrap bg-teal-500/8 dark:bg-teal-500/12 border-l border-l-[#0D9488]"
                    title={`CTL Fitness on ${w.date}: ${w.ctl.toFixed(1)} (${ctlDayDelta >= 0 ? '+' : ''}${ctlDayDelta.toFixed(1)} vs prior day · 14d Mean: ${means.ctl.toFixed(1)})`}
                  >
                    <div className="flex items-center justify-end gap-2.5 h-11">
                      {/* Continuous Vertical Trend Segment (connects seamlessly across all 14 rows) */}
                      <div className="relative w-14 h-full shrink-0 bg-emerald-950/5 dark:bg-[#0B120E]/60 border-x border-teal-500/15">
                        <svg
                          viewBox="0 0 56 44"
                          preserveAspectRatio="none"
                          className="w-full h-full block overflow-visible"
                        >
                          {/* Shaded area under the vertical curve */}
                          <polygon
                            points={`0,${newerRow ? 0 : 22} ${ctlXTop},${newerRow ? 0 : 22} ${ctlXCurr},22 ${ctlXBot},${olderRow ? 44 : 22} 0,${olderRow ? 44 : 22}`}
                            fill="rgba(13, 148, 136, 0.2)"
                          />
                          {/* Dashed vertical 14-Day Mean reference line */}
                          <line
                            x1={ctlMeanX}
                            y1={0}
                            x2={ctlMeanX}
                            y2={44}
                            stroke="rgba(13, 148, 136, 0.45)"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          {/* Continuous vertical trend polyline */}
                          <polyline
                            fill="none"
                            stroke="#0D9488"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={`${ctlXTop},${newerRow ? 0 : 22} ${ctlXCurr},22 ${ctlXBot},${olderRow ? 44 : 22}`}
                          />
                        </svg>
                        {/* Non-distorted circular node at current day's exact coordinate */}
                        <span
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#0D9488] dark:bg-[#2DD4BF] ring-2 ring-white dark:ring-[#101B15] shadow-xs pointer-events-none"
                          style={{ left: `${(ctlXCurr / 56) * 100}%` }}
                        />
                      </div>

                      {/* Actual Value + Day-over-Day Delta */}
                      <div className="min-w-[54px] text-right leading-tight">
                        <div className="font-bold text-[#0F766E] dark:text-[#2DD4BF]">
                          {w.ctl.toFixed(1)}
                        </div>
                        <div
                          className={`text-2xs font-semibold ${
                            ctlDayDelta > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : ctlDayDelta < 0
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {olderRow
                            ? `${ctlDayDelta > 0 ? '+' : ''}${ctlDayDelta.toFixed(1)} d/d`
                            : 'base'}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* ATL (Fatigue) — Continuous Vertical 14-Day Trend Track + Value + d/d Delta */}
                  <td
                    className="py-0 px-3 text-right whitespace-nowrap bg-rose-500/8 dark:bg-rose-500/12 border-l border-l-[#E11D48]"
                    title={`ATL Fatigue on ${w.date}: ${w.atl.toFixed(1)} (${atlDayDelta >= 0 ? '+' : ''}${atlDayDelta.toFixed(1)} vs prior day · 14d Mean: ${means.atl.toFixed(1)})`}
                  >
                    <div className="flex items-center justify-end gap-2.5 h-11">
                      {/* Continuous Vertical Trend Segment (connects seamlessly across all 14 rows) */}
                      <div className="relative w-14 h-full shrink-0 bg-emerald-950/5 dark:bg-[#0B120E]/60 border-x border-rose-500/15">
                        <svg
                          viewBox="0 0 56 44"
                          preserveAspectRatio="none"
                          className="w-full h-full block overflow-visible"
                        >
                          {/* Shaded area under the vertical curve */}
                          <polygon
                            points={`0,${newerRow ? 0 : 22} ${atlXTop},${newerRow ? 0 : 22} ${atlXCurr},22 ${atlXBot},${olderRow ? 44 : 22} 0,${olderRow ? 44 : 22}`}
                            fill="rgba(225, 29, 72, 0.18)"
                          />
                          {/* Dashed vertical 14-Day Mean reference line */}
                          <line
                            x1={atlMeanX}
                            y1={0}
                            x2={atlMeanX}
                            y2={44}
                            stroke="rgba(225, 29, 72, 0.45)"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          {/* Continuous vertical trend polyline */}
                          <polyline
                            fill="none"
                            stroke="#E11D48"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={`${atlXTop},${newerRow ? 0 : 22} ${atlXCurr},22 ${atlXBot},${olderRow ? 44 : 22}`}
                          />
                        </svg>
                        {/* Non-distorted circular node at current day's exact coordinate */}
                        <span
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#E11D48] dark:bg-[#FB7185] ring-2 ring-white dark:ring-[#101B15] shadow-xs pointer-events-none"
                          style={{ left: `${(atlXCurr / 56) * 100}%` }}
                        />
                      </div>

                      {/* Actual Value + Day-over-Day Delta */}
                      <div className="min-w-[54px] text-right leading-tight">
                        <div className="font-bold text-[#BE123C] dark:text-[#FB7185]">
                          {w.atl.toFixed(1)}
                        </div>
                        <div
                          className={`text-2xs font-semibold ${
                            atlDayDelta > 5
                              ? 'text-rose-600 dark:text-rose-400'
                              : atlDayDelta < 0
                                ? 'text-teal-700 dark:text-teal-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {olderRow
                            ? `${atlDayDelta > 0 ? '+' : ''}${atlDayDelta.toFixed(1)} d/d`
                            : 'base'}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* TSB (Form) — Intervals.icu 5-Zone Coloring & Badge */}
                  <td className={`py-2.5 px-3 text-right whitespace-nowrap ${formMeta.cellClasses}`}>
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <span className="font-bold">
                        {w.tsb > 0 ? `+${w.tsb.toFixed(1)}` : w.tsb.toFixed(1)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-sans text-2xs font-semibold ${formMeta.badgeClasses}`}
                      >
                        {formMeta.label}
                      </span>
                    </div>
                  </td>

                  {/* Daily Load (TSS): Green within ±25% of 14d mean, Red >25% below mean, Gray >25% above mean */}
                  <td
                    className={`py-2.5 px-3 text-right whitespace-nowrap ${getMeanCellClasses(
                      loadEval.status
                    )}`}
                  >
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <span>{w.dailyLoad} TSS</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-2xs ${getMeanDeltaPillClasses(
                          loadEval.status
                        )}`}
                      >
                        {formatSignedPct(loadEval.pctDelta)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
};

export const FourteenDayReadinessLedger = React.memo(FourteenDayReadinessLedgerInner);
