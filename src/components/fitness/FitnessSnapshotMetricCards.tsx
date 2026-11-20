import React from 'react';
import type { AthleteProfile, UnifiedWellnessDay } from '../../types';
import { ChartInfoTooltip } from '../ChartInfoTooltip';
import { FourteenDayReadinessLedger } from '../FourteenDayReadinessLedger';

export interface AerobicDurabilityStatsSummary {
  avgEf28: number;
  avgEf90: number;
  efPctDelta: number;
  avgDecoupling: number;
  durabilityState: 'optimal' | 'caution' | 'neutral' | 'warning';
  durabilityLabel: string;
  sampleCount: number;
}

export interface FitnessSnapshotMetricCardsProps {
  wellnessDays: UnifiedWellnessDay[];
  hasWellnessTelemetry: boolean;
  latestDay: UnifiedWellnessDay;
  latestWithSleep: UnifiedWellnessDay | undefined;
  latestWithHrv: UnifiedWellnessDay;
  aerobicDurabilityStats: AerobicDurabilityStatsSummary;
  statusBadgeColor: (status?: string) => string;
  athleteProfile?: AthleteProfile;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

export const FitnessSnapshotMetricCards: React.FC<FitnessSnapshotMetricCardsProps> = ({
  wellnessDays,
  hasWellnessTelemetry,
  latestDay,
  latestWithSleep,
  latestWithHrv,
  aerobicDurabilityStats,
  statusBadgeColor,
  athleteProfile,
  onOpenCoachWithPrompt,
}) => {
  return (
    <>
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Fitness & Workload Ratio (CTL + ACWR Sweet-Spot Gauge) */}
        {(() => {
          const acwr = latestDay.loadRatio || 0.92;
          const acwrMarkerPct = Math.max(4, Math.min(96, ((acwr - 0.5) / 1.1) * 100));
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Fitness &amp; Load
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md border ${statusBadgeColor(
                    latestDay.garminTrainingStatus
                  )}`}
                >
                  {latestDay.garminTrainingStatus || 'Productive'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {latestDay.ctl.toFixed(1)}
                  </span>
                  <span className="text-xs font-sans text-slate-500 ml-1.5">CTL</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0284C7] dark:text-sky-400">
                    ACWR {acwr.toFixed(2)}x
                  </span>
                  <span className="block text-2xs text-slate-500">
                    Ramp {latestDay.rampRate && latestDay.rampRate > 0 ? `+${latestDay.rampRate}` : latestDay.rampRate || 0}/wk
                  </span>
                </div>
              </div>
              {/* Graphic ACWR Sweet-Spot Gauge Bar */}
              <div className="space-y-1 pt-0.5">
                <div className="relative h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800/90 overflow-hidden">
                  {/* Optimal 0.80 - 1.30x Sweet Spot Band */}
                  <div
                    className="absolute top-0 bottom-0 bg-emerald-500/25 border-x border-emerald-500/50"
                    style={{ left: '27%', width: '45%' }}
                  />
                  {/* High Strain Zone > 1.30x */}
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-rose-500/20"
                    style={{ width: '28%' }}
                  />
                  {/* Live Marker Dot */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0284C7] dark:bg-sky-400 ring-2 ring-white dark:ring-slate-950"
                    style={{ left: `${acwrMarkerPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-600 dark:text-slate-400">
                  <span>0.5x</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Optimal 0.8–1.3x</span>
                  <span>1.6x</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 2: Overnight Sleep Score Radial Ring + Target Duration Bar (Zero Synthetic Stages) */}
        {(() => {
          const hasSleep = Boolean(latestWithSleep && (latestWithSleep.sleepSecs > 0 || latestWithSleep.sleepScore > 0));
          const score = hasSleep ? Math.max(0, Math.min(100, latestWithSleep?.sleepScore || 0)) : 0;
          const sleepHrs = (latestWithSleep?.sleepSecs || 0) / 3600;
          const targetPct = Math.min(100, Math.round((sleepHrs / 8.0) * 100));
          const circumference = 2 * Math.PI * 15.5;
          const dashOffset = circumference - (score / 100) * circumference;
          const ringColor = !hasSleep
            ? '#94A3B8'
            : score >= 80
              ? '#0D9488'
              : score >= 68
                ? '#0284C7'
                : '#D97706';
          return (
            <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Overnight Sleep
                  </span>
                  <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                    {hasSleep ? `${((latestWithSleep?.sleepDebt7dSecs || 0) / 3600).toFixed(1)}h debt` : 'Unsynced'}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {hasSleep && sleepHrs > 0 ? sleepHrs.toFixed(1) : '—'}
                  </span>
                  <span className="text-xs text-slate-500">hrs</span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full overflow-hidden flex bg-stone-200/80 dark:bg-slate-800">
                    <div
                      className="bg-[#0284C7] dark:bg-[#60A5FA] transition-all"
                      style={{ width: `${targetPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                    <span>{hasSleep ? `${targetPct}% of 8.0h target` : 'Connect Garmin / Intervals'}</span>
                    <span>{score > 0 ? `Score ${score}` : ''}</span>
                  </div>
                </div>
              </div>

              {/* Circular Radial Score Gauge */}
              <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                <svg className="w-14 h-14 -rotate-90" viewBox="0 0 38 38">
                  <circle
                    cx="19"
                    cy="19"
                    r="15.5"
                    fill="none"
                    stroke="currentColor"
                    className="text-stone-200 dark:text-slate-800"
                    strokeWidth="3.4"
                  />
                  <circle
                    cx="19"
                    cy="19"
                    r="15.5"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="3.4"
                    strokeDasharray={circumference.toFixed(1)}
                    strokeDashoffset={dashOffset.toFixed(1)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-center leading-none">
                  <span className="text-sm font-mono font-extrabold text-slate-900 dark:text-white">
                    {score > 0 ? score : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 3: Autonomic Recovery (HRV rMSSD + 60d Baseline Corridor Gauge) */}
        {(() => {
          const hrv = latestWithHrv.hrvRMSSD || 0;
          const hasHrv = hrv > 0;
          const low = latestWithHrv.hrvNormalBandLow || (hasHrv ? Math.round(hrv * 0.85) : 40);
          const high = latestWithHrv.hrvNormalBandHigh || (hasHrv ? Math.round(hrv * 1.15) : 70);
          const scaleMin = Math.max(15, low - 12);
          const scaleMax = high + 12;
          const span = Math.max(1, scaleMax - scaleMin);
          const bandLeft = Math.max(5, Math.min(80, ((low - scaleMin) / span) * 100));
          const bandWidth = Math.max(12, Math.min(85 - bandLeft, ((high - low) / span) * 100));
          const dotLeft = hasHrv ? Math.max(4, Math.min(96, ((hrv - scaleMin) / span) * 100)) : 50;
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  HRV &amp; RHR
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md ${
                    hasHrv ? 'ap-status-prime' : 'ap-well text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {hasHrv ? latestWithHrv.hrvStatus || 'Balanced' : 'Uncalibrated'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {hasHrv ? hrv : '—'}
                  </span>
                  <span className="text-xs text-slate-500 ml-1">ms</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0F766E] dark:text-[#2DD4BF]">
                    7d: {latestWithHrv.hrvBaseline7d > 0 ? `${latestWithHrv.hrvBaseline7d} ms` : '—'}
                  </span>
                  <span className="block text-2xs text-slate-500">
                    RHR {latestDay.restingHR > 0 ? `${latestDay.restingHR} bpm` : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 pt-0.5">
                <div className="relative h-2 w-full rounded-full bg-stone-200/80 dark:bg-slate-800/90">
                  {hasHrv && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 rounded-full bg-[#0D9488]/30 border border-[#0D9488]/60"
                        style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0D9488] ring-2 ring-white dark:ring-slate-950"
                        style={{ left: `${dotLeft}%` }}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                  <span>{hasHrv ? `Floor ${low}ms` : 'Sync nocturnal HRV'}</span>
                  <span>{hasHrv ? `Ceiling ${high}ms` : ''}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 4: Dual-Sport Threshold Power (Bike & Run eFTP + W' Gauge) */}
        {(() => {
          const bikeEftp = latestDay.rideEftp || athleteProfile?.eFtp || athleteProfile?.ftp || 0;
          const runEftp = latestDay.runEftp || athleteProfile?.runEFtp || athleteProfile?.runFtp || 0;
          const rawWPrime = latestDay.rideWPrime || athleteProfile?.wPrime || 0;
          const wPrimeKj = rawWPrime > 0 ? Number((rawWPrime / 1000).toFixed(1)) : 0;
          const wPrimePct = wPrimeKj > 0 ? Math.max(10, Math.min(100, Math.round((wPrimeKj / 32) * 100))) : 0;
          const pMaxVal = latestDay.ridePMax || athleteProfile?.pMax || 0;
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  THRESH · eFTP
                </span>
                <span className="text-xs font-mono text-[#EA580C] dark:text-orange-400 font-bold">
                  {athleteProfile?.safeSportHideWeight
                    ? 'Safe-Sport Shield'
                    : bikeEftp > 0 && (latestDay.weightKg || athleteProfile?.weightKg || 0) > 0
                      ? `${(bikeEftp / Math.max(35, latestDay.weightKg || athleteProfile?.weightKg || 0)).toFixed(2)} W/kg`
                      : bikeEftp > 0
                        ? `${bikeEftp} W`
                        : '— W/kg'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {bikeEftp > 0 ? `${bikeEftp}W` : '—'}
                  </span>
                  <span className="text-xs text-slate-500 ml-1">Bike</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0284C7] dark:text-sky-400">
                    Run {runEftp > 0 ? `${runEftp}W` : '—'}
                  </span>
                  <span className="block text-2xs text-slate-500">
                    W&apos; {wPrimeKj > 0 ? `${wPrimeKj} kJ` : '—'} · Pmax {pMaxVal > 0 ? `${pMaxVal}W` : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 pt-0.5">
                <div className="h-2 w-full rounded-full bg-stone-200/80 dark:bg-slate-800 overflow-hidden flex gap-0.5">
                  <div
                    className="h-full bg-[#EA580C] rounded-full transition-all"
                    style={{ width: `${wPrimePct}%` }}
                  />
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                  <span>Anaerobic Reserve (W&apos;)</span>
                  <span className="text-[#EA580C] dark:text-orange-400 font-semibold">
                    {wPrimeKj > 0 ? `${wPrimeKj} kJ` : hasWellnessTelemetry ? '—' : 'Calibrate FTP'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      <FourteenDayReadinessLedger wellnessDays={wellnessDays} />

      {/* ==========================================================================
          4. COMPACT AEROBIC STAMINA (CARDIAC DRIFT) & EFFICIENCY BAR
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Aerobic Efficiency &amp; Drift
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${
                aerobicDurabilityStats.durabilityState === 'optimal'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : aerobicDurabilityStats.durabilityState === 'caution'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
              }`}
            >
              {aerobicDurabilityStats.durabilityLabel}
            </span>
            <ChartInfoTooltip
              title="Aerobic Efficiency Factor (EF) & Cardiac Drift (Pa:Hr%)"
              subtitle="Mitochondrial Economy & First-Half vs. Second-Half Stamina"
              whatItMeasures="Aerobic Efficiency (EF = Normalized Power ÷ Average Heart Rate) quantifies how much output your cardiovascular system produces per heartbeat. Cardiac Drift (Pa:Hr%) measures how much your efficiency fades from the first half to the second half of endurance workouts."
              benchmarks="Cardiac Drift < 3.5%: Strong aerobic stamina ready for threshold progression. 3.5% – 5.0%: Moderate drift. > 5.0%: Incomplete aerobic base or fueling/hydration depletion."
              liveStatus={{
                label: `28d EF: ${aerobicDurabilityStats.avgEf28} (${
                  aerobicDurabilityStats.efPctDelta >= 0 ? '+' : ''
                }${aerobicDurabilityStats.efPctDelta}% vs 90d) · Avg Drift: ${
                  aerobicDurabilityStats.avgDecoupling
                }%`,
                state: aerobicDurabilityStats.durabilityState,
                interpretation:
                  aerobicDurabilityStats.avgDecoupling <= 3.5
                    ? 'Your cardiac drift on endurance workouts is well below the 5% physiological threshold, confirming strong stroke-volume stability.'
                    : 'Your heart rate drifts upward relative to power in the second half of long rides/runs; prioritize Z2 duration and in-ride fueling.',
              }}
              coachingAction="When 28-day Efficiency rises and Cardiac Drift stays under 3.5%, increase Z4/Z5 interval density; if drift exceeds 5%, extend steady Z2 aerobic volume."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-xs">
            <div className="px-3 py-1.5 rounded-xl liquid-glass-subtle flex items-center gap-2">
              <span className="text-slate-500 font-sans">EF (28d):</span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {aerobicDurabilityStats.avgEf28 > 0 ? aerobicDurabilityStats.avgEf28 : '—'}
              </span>
              {aerobicDurabilityStats.avgEf28 > 0 && (
                <span
                  className={`text-2xs font-bold ${
                    aerobicDurabilityStats.efPctDelta >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  ({aerobicDurabilityStats.efPctDelta >= 0 ? `+${aerobicDurabilityStats.efPctDelta}%` : `${aerobicDurabilityStats.efPctDelta}%`})
                </span>
              )}
            </div>

            <div className="px-3 py-1.5 rounded-xl liquid-glass-subtle flex items-center gap-2">
              <span className="text-slate-500 font-sans">Drift (Pa:Hr):</span>
              <span
                className={`text-sm font-extrabold ${
                  aerobicDurabilityStats.sampleCount === 0
                    ? 'text-slate-500 dark:text-slate-400'
                    : aerobicDurabilityStats.avgDecoupling <= 3.5
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : aerobicDurabilityStats.avgDecoupling <= 5.0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {aerobicDurabilityStats.sampleCount > 0
                  ? `${aerobicDurabilityStats.avgDecoupling}%`
                  : '—'}
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `My 28-day Aerobic Efficiency Factor (EF) is ${aerobicDurabilityStats.avgEf28} (${aerobicDurabilityStats.efPctDelta >= 0 ? '+' : ''}${aerobicDurabilityStats.efPctDelta}% vs 90-day EF of ${aerobicDurabilityStats.avgEf90}) and my average endurance cardiac drift (Pa:Hr decoupling) is ${aerobicDurabilityStats.avgDecoupling}%. Based on my current CTL (${latestDay.ctl}) and HRV (${latestWithHrv.hrvRMSSD}ms), should I focus on extending Z2 aerobic durability or progressing Z4 threshold intervals this week?`
                )
              }
              className="min-h-[32px] px-3 py-1.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-sans text-xs font-semibold shadow-sm transition-all"
            >
              Ask Coach: Stamina Rx
            </button>
          </div>
        </div>
      </section>
    </>
  );
};
