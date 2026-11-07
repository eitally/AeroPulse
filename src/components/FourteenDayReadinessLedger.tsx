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
        'bg-rose-500/12 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-l-2 border-l-rose-500 font-semibold',
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
        'bg-emerald-500/12 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-l-2 border-l-emerald-500 font-semibold',
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
        'bg-slate-200/60 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-l-2 border-l-slate-400 font-semibold',
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
        'bg-sky-500/12 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-l-2 border-l-sky-500 font-semibold',
      badgeClasses:
        'bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30',
    };
  }
  return {
    zone: 'TRANSITION',
    label: 'Transition',
    hex: '#F59E0B',
    cellClasses:
      'bg-amber-500/12 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-l-2 border-l-amber-500 font-semibold',
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
      return 'bg-emerald-500/12 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-l-2 border-l-emerald-500 font-semibold';
    case 'BELOW_25_RED':
      return 'bg-rose-500/12 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-l-2 border-l-rose-500 font-semibold';
    case 'ABOVE_25_GRAY':
    default:
      return 'bg-slate-200/65 dark:bg-slate-800/75 text-slate-600 dark:text-slate-300 border-l-2 border-l-slate-400 font-semibold';
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

export const FourteenDayReadinessLedger: React.FC<FourteenDayReadinessLedgerProps> = ({
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

    const maxCtlAtl = Math.max(
      100,
      ...rows.map((r) => Math.max(r.ctl, r.atl, r.dailyLoad * 0.6))
    );

    return {
      rows: [...rows].reverse(), // Most recent day first in table
      means,
      maxCtlAtl,
    };
  }, [chronological14]);

  const { rows, means, maxCtlAtl } = enrichedRowsAndMeans;

  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              14-Day Autonomic Recovery, Daily Load &amp; Intervals.icu PMC Ledger
            </h2>
            <ChartInfoTooltip
              title="14-Day Autonomic Readiness & Daily Load Deviation Ledger"
              subtitle="Acute-vs-Baseline Homeostasis & Intervals.icu TSB Matrix"
              whatItMeasures="Compares each day's Readiness, Overnight HRV rMSSD, Resting HR, Sleep Score, and Daily Training Load against your rolling 14-day mean while tracking CTL, ATL, and 5-zone TSB Form."
              benchmarks="Green: Within ±25% of your 14-day mean (consistent homeostasis). Red: >25% below your 14-day mean (autonomic suppression or recovery day). Gray: >25% above your 14-day mean (acute overload spike)."
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
              coachingAction="Watch for 2+ consecutive Red HRV or Sleep cells following Gray (> +25%) Daily Load spikes—this signals incomplete parasympathetic rebound and warrants an active recovery day."
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Daily Load &amp; recovery metrics are colored vs. the 14-day mean (Green within ±25%, Red &gt;25% below, Gray &gt;25% above) · CTL, ATL &amp; TSB use Intervals.icu colors
          </p>
        </div>

        {/* Legends: 14-Day Mean Rule + Intervals.icu CTL/ATL/TSB Colors */}
        <div className="flex flex-col sm:items-end gap-1.5 text-[11px] font-medium">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-mono uppercase text-[10px] mr-1">
              vs 14d Mean:
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Within ±25% (Green)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>&gt;25% Below Mean (Red)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>&gt;25% Above Mean (Gray)</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-mono uppercase text-[10px] mr-1">
              Intervals.icu PMC:
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
              <span className="w-2 h-2 rounded-full bg-[#0EA5E9]" />
              <span>CTL Fitness</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
              <span className="w-2 h-2 rounded-full bg-[#A855F7]" />
              <span>ATL Fatigue</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md liquid-capsule-track text-slate-600 dark:text-slate-300 font-mono text-[10px]">
              <span>TSB Form Zones:</span>
              <span className="text-rose-500 font-bold">High Risk (&lt;-30)</span>·
              <span className="text-emerald-500 font-bold">Optimal (-30..-10)</span>·
              <span className="text-slate-400 font-bold">Grey (-10..+5)</span>·
              <span className="text-sky-500 font-bold">Fresh (+5..+20)</span>·
              <span className="text-amber-500 font-bold">Transition (&gt;+20)</span>
            </span>
          </div>
        </div>
      </div>

      {/* 14-Day Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/30 dark:bg-slate-950/30">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-100/70 dark:bg-slate-900/70 border-b border-slate-200/80 dark:border-white/10 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider">
              <th className="py-2.5 px-3 font-semibold">Date</th>
              <th className="py-2.5 px-3 font-semibold">Readiness (vs 14d)</th>
              <th className="py-2.5 px-3 text-right font-semibold">HRV rMSSD (vs 14d)</th>
              <th className="py-2.5 px-3 text-right font-semibold">Resting HR (vs 14d)</th>
              <th className="py-2.5 px-3 text-right font-semibold">Sleep Score (vs 14d)</th>
              <th className="py-2.5 px-3 text-right font-semibold text-[#0EA5E9]">
                CTL (Fitness)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold text-[#A855F7]">
                ATL (Fatigue)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold">
                TSB (Intervals.icu Form)
              </th>
              <th className="py-2.5 px-3 text-right font-semibold">
                Daily Load (vs 14d Mean)
              </th>
            </tr>

            {/* Pinned 14-Day Mean Baseline Row */}
            <tr className="bg-blue-500/8 dark:bg-blue-500/12 border-b-2 border-blue-500/30 font-mono text-xs text-slate-900 dark:text-slate-100">
              <td className="py-2 px-3 font-sans font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap">
                14-Day Mean
              </td>
              <td className="py-2 px-3 font-bold">
                {means.readinessScore.toFixed(0)}/100{' '}
                <span className="text-[10px] font-normal text-slate-500">mean</span>
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
              <td className="py-2 px-3 text-right font-bold text-[#0EA5E9]">
                {means.ctl.toFixed(1)}
              </td>
              <td className="py-2 px-3 text-right font-bold text-[#A855F7]">
                {means.atl.toFixed(1)}
              </td>
              <td className="py-2 px-3 text-right font-bold">
                {(() => {
                  const meanForm = getIntervalsFormZone(means.tsb);
                  return (
                    <span style={{ color: meanForm.hex }}>
                      {means.tsb > 0 ? `+${means.tsb.toFixed(1)}` : means.tsb.toFixed(1)} (
                      {meanForm.label})
                    </span>
                  );
                })()}
              </td>
              <td className="py-2 px-3 text-right font-bold text-emerald-700 dark:text-emerald-300">
                {means.dailyLoad.toFixed(0)} TSS{' '}
                <span className="text-[10px] font-normal text-slate-500">
                  (±25%: {Math.round(means.dailyLoad * 0.75)}–{Math.round(means.dailyLoad * 1.25)})
                </span>
              </td>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums text-xs">
            {rows.map((w) => {
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

              // Intervals.icu coloring & inline bar scaling for CTL, ATL, and TSB
              const ctlPctWidth = Math.min(100, Math.max(8, (w.ctl / maxCtlAtl) * 100));
              const atlPctWidth = Math.min(100, Math.max(8, (w.atl / maxCtlAtl) * 100));
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
                        <span className="text-[11px] opacity-80">({w.readinessScore})</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${getMeanDeltaPillClasses(
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
                      hrvEval ? getMeanCellClasses(hrvEval.status) : 'text-slate-400'
                    }`}
                  >
                    {w.hrvRMSSD > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>
                          {w.hrvRMSSD} ms{' '}
                          <span className="text-[10px] opacity-70">({w.hrvBaseline7d})</span>
                        </span>
                        {hrvEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${getMeanDeltaPillClasses(
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
                      rhrEval ? getMeanCellClasses(rhrEval.status) : 'text-slate-400'
                    }`}
                  >
                    {w.restingHR > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>{w.restingHR} bpm</span>
                        {rhrEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${getMeanDeltaPillClasses(
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
                      sleepEval ? getMeanCellClasses(sleepEval.status) : 'text-slate-400'
                    }`}
                  >
                    {w.sleepScore > 0 ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <span>{w.sleepScore}/100</span>
                        {sleepEval && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${getMeanDeltaPillClasses(
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

                  {/* CTL (Fitness) — Intervals.icu Cyan (#0EA5E9) + Inline Bar */}
                  <td className="py-2.5 px-3 text-right whitespace-nowrap bg-sky-500/8 dark:bg-sky-500/12 border-l-2 border-l-[#0EA5E9]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-bold text-sky-700 dark:text-sky-300">
                          {w.ctl.toFixed(1)}
                        </span>
                      </div>
                      <div className="w-20 ml-auto h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#0EA5E9]"
                          style={{ width: `${ctlPctWidth}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* ATL (Fatigue) — Intervals.icu Purple (#A855F7) + Inline Bar */}
                  <td className="py-2.5 px-3 text-right whitespace-nowrap bg-purple-500/8 dark:bg-purple-500/12 border-l-2 border-l-[#A855F7]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-bold text-purple-700 dark:text-purple-300">
                          {w.atl.toFixed(1)}
                        </span>
                      </div>
                      <div className="w-20 ml-auto h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#A855F7]"
                          style={{ width: `${atlPctWidth}%` }}
                        />
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
                        className={`px-1.5 py-0.5 rounded font-sans text-[10px] font-semibold ${formMeta.badgeClasses}`}
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
                        className={`px-1.5 py-0.5 rounded text-[10px] ${getMeanDeltaPillClasses(
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
    </section>
  );
};
