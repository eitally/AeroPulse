import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bike,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Footprints,
  HeartPulse,
  Moon,
  Sliders,
  Sparkles,
  Sun,
  TrendingUp,
  Zap,
} from './icons/PhosphorIcons';
import type {
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutCompliance,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { ThreshBrandWatermark } from './AeroPulseLogo';
import {
  evaluateRollingTrainingProductivity,
  evaluateSessionImpactReceipt,
  getLocalDateIso,
  type LoadFocusBucketSummary,
} from '../physiology/trainingProductivityEngine';

export type CircadianHeroMode = 'MORNING' | 'POST_SESSION';

interface CircadianFirstTouchHeroProps {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  athleteProfile?: AthleteProfile | null;
  distanceUnit: DistanceUnit;
  todayCompliance?: PlannedWorkoutCompliance | null;
  isWorkbenchExpanded: boolean;
  onToggleWorkbench: () => void;
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSyncMorphedToCalendar?: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onOpenAthleteProfileModal?: () => void;
  onOpenCoachWithPrompt?: (prompt: string) => void;
}

function toneBadgeClass(tone: 'prime' | 'info' | 'caution' | 'strained'): string {
  switch (tone) {
    case 'prime':
      return 'ap-status-prime';
    case 'info':
      return 'ap-status-info';
    case 'caution':
      return 'ap-status-caution';
    case 'strained':
      return 'ap-status-strained';
  }
}

const LoadFocusGaugeRow: React.FC<{ bucket: LoadFocusBucketSummary }> = ({
  bucket,
}) => {
  const clampedPct = Math.min(100, Math.max(0, bucket.sharePct));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: bucket.colorHex }}
          />
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {bucket.label}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 hidden sm:inline">
            {bucket.zoneSubtitle}
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
          <span className="font-bold text-slate-900 dark:text-white">
            {bucket.loadPts}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            ({bucket.sharePct}%)
          </span>
          {bucket.status === 'OPTIMAL' ? (
            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              ✓ Target
            </span>
          ) : bucket.status === 'SHORTFALL' ? (
            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {bucket.deltaPtsToTarget} pts
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-orange-500/15 text-orange-700 dark:text-orange-300">
              +{bucket.deltaPtsToTarget} pts
            </span>
          )}
        </div>
      </div>

      {/* Horizontal Gauge Track with Garmin-style Dashed Optimal Target Box */}
      <div className="relative h-2.5 rounded-full bg-slate-200/80 dark:bg-slate-800/90 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.max(clampedPct > 0 ? 3 : 0, clampedPct)}%`,
            backgroundColor: bucket.colorHex,
          }}
        />
        {/* Dashed Target Corridor Overlay */}
        <div
          className="absolute top-0 bottom-0 border-x-2 border-dashed border-slate-700/70 dark:border-white/75 bg-slate-900/[0.06] dark:bg-white/[0.09] pointer-events-none"
          style={{
            left: `${bucket.targetMinPct}%`,
            width: `${Math.max(4, bucket.targetMaxPct - bucket.targetMinPct)}%`,
          }}
          title={`Optimal Target Zone: ${bucket.targetMinPct}%–${bucket.targetMaxPct}% (${bucket.targetMinPts}–${bucket.targetMaxPts} pts)`}
        />
      </div>
    </div>
  );
};

export const CircadianFirstTouchHero: React.FC<CircadianFirstTouchHeroProps> = ({
  wellnessDays,
  activities,
  plannedEvents,
  athleteProfile,
  distanceUnit,
  todayCompliance,
  isWorkbenchExpanded,
  onToggleWorkbench,
  onSelectActivity,
  onSyncMorphedToCalendar,
  onOpenAthleteProfileModal,
  onOpenCoachWithPrompt,
}) => {
  const todayIso = useMemo(() => getLocalDateIso(), []);

  const hasCompletedToday = useMemo(
    () =>
      activities.some((a) => (a.startDateLocal || '').slice(0, 10) === todayIso),
    [activities, todayIso]
  );

  const [mode, setMode] = useState<CircadianHeroMode>(() =>
    hasCompletedToday ? 'POST_SESSION' : 'MORNING'
  );

  // Auto-flip into Post-Session Receipt as soon as a workout syncs for today
  useEffect(() => {
    if (hasCompletedToday) {
      setMode('POST_SESSION');
    }
  }, [hasCompletedToday]);

  const productivity = useMemo(
    () =>
      evaluateRollingTrainingProductivity({
        activities,
        wellnessDays,
        athleteProfile,
        asOfDateIso: todayIso,
      }),
    [activities, wellnessDays, athleteProfile, todayIso]
  );

  const sessionReceipt = useMemo(
    () =>
      evaluateSessionImpactReceipt({
        activities,
        wellnessDays,
        athleteProfile,
        todayIso,
        distanceUnit,
      }),
    [activities, wellnessDays, athleteProfile, todayIso, distanceUnit]
  );

  const [rxSport, setRxSport] = useState<'Cycling' | 'Running'>(() =>
    productivity.efPrimarySport === 'Running' ? 'Running' : 'Cycling'
  );
  const [isSavingRx, setIsSavingRx] = useState<boolean>(false);
  const [rxToast, setRxToast] = useState<string | null>(null);

  const todayScheduled = useMemo(
    () =>
      plannedEvents.find(
        (ev) =>
          (ev.date || '').slice(0, 10) === todayIso &&
          (ev.sportCategory === rxSport || ev.sportCategory === 'Multisport')
      ) ||
      plannedEvents.find((ev) => (ev.date || '').slice(0, 10) === todayIso) ||
      null,
    [plannedEvents, todayIso, rxSport]
  );

  const activeRxTitle =
    rxSport === 'Running'
      ? productivity.gapPrescription.recommendedTitleRunning
      : productivity.gapPrescription.recommendedTitleCycling;
  const activeRxSyntax =
    rxSport === 'Running'
      ? productivity.gapPrescription.workoutSyntaxRunning
      : productivity.gapPrescription.workoutSyntaxCycling;

  const handleCommitGapRx = async () => {
    if (!onSyncMorphedToCalendar) return;
    setIsSavingRx(true);
    setRxToast(null);
    try {
      await onSyncMorphedToCalendar({
        date: todayIso,
        name: activeRxTitle,
        sportCategory: rxSport,
        environmentPreference: 'FLEXIBLE',
        plannedDurationSecs:
          productivity.gapPrescription.recommendedDurationMins * 60,
        plannedLoad: productivity.gapPrescription.recommendedTss,
        workoutSyntax: activeRxSyntax,
        description: `${productivity.gapPrescription.rationale} [Auto-tuned by THRESH 7-Day Rolling Load Focus Engine]`,
        replaceExistingDate: true,
      });
      setRxToast(
        `Scheduled "${activeRxTitle}" (${productivity.gapPrescription.recommendedTss} TSS) for today.`
      );
      window.setTimeout(() => setRxToast(null), 5000);
    } finally {
      setIsSavingRx(false);
    }
  };

  // Acute Load Tunnel Gauge geometry (scale 0 .. 1.6x chronicWeeklyLoad)
  const tunnelScaleMax = Math.max(
    180,
    Math.round(productivity.chronicWeeklyLoad * 1.6),
    productivity.acuteLoad7d + 25
  );
  const acuteMarkerPct = Math.min(
    98,
    Math.max(2, Math.round((productivity.acuteLoad7d / tunnelScaleMax) * 100))
  );
  const optStartPct = Math.round(
    (productivity.optimalLoadMin / tunnelScaleMax) * 100
  );
  const optWidthPct = Math.max(
    8,
    Math.round(
      ((productivity.optimalLoadMax - productivity.optimalLoadMin) /
        tunnelScaleMax) *
        100
    )
  );

  const maxSparkDayLoad = Math.max(
    45,
    ...productivity.dailyWindow.map((d) => d.totalLoad)
  );

  return (
    <section className="relative rounded-2xl liquid-glass overflow-hidden">
      {/* Signature 4px THRESH Volt Top Rail */}
      <div className="absolute top-0 left-0 right-0 h-[4px] ap-brand-hairline pointer-events-none" />
      <ThreshBrandWatermark className="w-32 h-32 absolute -right-3 -top-3 text-slate-900 dark:text-white pointer-events-none" />

      {/* Top Circadian Header Bar */}
      <div className="relative px-4 sm:px-5 py-3 border-b border-lime-600/20 dark:border-[#C8FF00]/15 bg-[#F8FAEE]/75 dark:bg-[#0D1310]/75 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {mode === 'MORNING' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ap-badge-volt text-[11px] font-mono uppercase tracking-wide">
              <Sun className="w-3.5 h-3.5" />
              <span>Morning Check-In · 7d Rolling</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ap-status-prime text-[11px] font-mono font-bold uppercase tracking-wide">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {sessionReceipt?.isTodaySession
                  ? `Session Complete · ${todayIso}`
                  : `Latest Session Receipt · ${sessionReceipt?.sessionDateIso || todayIso}`}
              </span>
            </span>
          )}

          {mode === 'POST_SESSION' &&
            sessionReceipt?.isTodaySession &&
            todayCompliance &&
            todayCompliance.matchedActivityId && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ap-status-info">
                {todayCompliance.summaryLabel}
              </span>
            )}

          {athleteProfile && onOpenAthleteProfileModal && (
            <button
              type="button"
              onClick={onOpenAthleteProfileModal}
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg liquid-capsule-track text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-sky-300 transition-colors cursor-pointer"
              title="Inspect or update synced Garmin / Intervals thresholds & HR zones"
            >
              <span>FTP {athleteProfile.ftp}W</span>
              <span className="opacity-40">·</span>
              <span>LTHR {athleteProfile.lthr} bpm</span>
              {athleteProfile.runLthr > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <span>Run LTHR {athleteProfile.runLthr}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Bi-Modal Switcher: Morning Brief <-> Post-Session Receipt */}
        <div className="flex items-center gap-2">
          <div className="p-0.5 rounded-xl liquid-capsule-track inline-flex items-center text-xs">
            <button
              type="button"
              onClick={() => setMode('MORNING')}
              className={`min-h-[28px] px-2.5 py-0.5 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-all cursor-pointer ${
                mode === 'MORNING'
                  ? 'liquid-capsule-active text-[#0B4F9E] dark:text-sky-300'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Morning Brief</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('POST_SESSION')}
              disabled={!sessionReceipt}
              className={`min-h-[28px] px-2.5 py-0.5 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-all ${
                !sessionReceipt
                  ? 'opacity-40 cursor-not-allowed text-slate-400'
                  : mode === 'POST_SESSION'
                    ? 'liquid-capsule-active text-[#0D9488] dark:text-teal-300 cursor-pointer'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Post-Session</span>
              {hasCompletedToday && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ==========================================================================
          MODE A: MORNING WAKE-UP 3-CARD BENTO (Productivity + Readiness + Gap RX)
         ========================================================================== */}
      {mode === 'MORNING' || !sessionReceipt ? (
        <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* CARD 1 (5 Cols): 7-Day Rolling Training Productivity & 3-System Load Focus */}
          <div className="lg:col-span-5 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wide ${toneBadgeClass(
                      productivity.verdictTone
                    )}`}
                  >
                    ● {productivity.verdictLabel}
                  </span>
                  <ChartInfoTooltip
                    title="7-Day Rolling Training Productivity & Load Focus"
                    subtitle="Transparent Ramp Corridor + 3-System Zone Strain + Sport-Matched EF"
                    whatItMeasures="Synthesizes your rolling 7-day acute load against your 42-day chronic tunnel (0.80x–1.25x), partitions time-in-zone across Low Aerobic (Z1–Z2), High Aerobic (Z3–Z4), and Neuromuscular/VO2 (Z5–Z7), and checks sport-matched Aerobic Efficiency (Output/HR) + overnight HRV absorption."
                    benchmarks="Optimal Polarization Corridor: 65–78% Low Aerobic, 15–25% High Aerobic, 6–14% Neuromuscular/Anaerobic, with weekly CTL ramp between +1.0 and +5.5 pts/wk."
                    liveStatus={{
                      label: `${productivity.verdictLabel} · ${productivity.acuteLoad7d} TSS (${productivity.acwr.toFixed(2)}x ACWR)`,
                      state:
                        productivity.verdictTone === 'prime'
                          ? 'optimal'
                          : productivity.verdictTone === 'strained' ||
                              productivity.verdictTone === 'caution'
                            ? 'warning'
                            : 'neutral',
                      interpretation: productivity.headlineWhy,
                    }}
                    coachingAction={productivity.actionCallout}
                  />
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                  <span className="px-2 py-0.5 rounded-md liquid-capsule-track text-slate-700 dark:text-slate-200 font-semibold">
                    {productivity.ctlRamp7d >= 0
                      ? `+${productivity.ctlRamp7d}`
                      : productivity.ctlRamp7d}{' '}
                    CTL/wk
                  </span>
                  {productivity.efDeltaPct !== null && (
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        productivity.efDeltaPct >= 0
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }`}
                      title={`7-day vs 28-day ${productivity.efPrimarySport} Aerobic Efficiency Factor`}
                    >
                      EF{' '}
                      {productivity.efDeltaPct >= 0
                        ? `+${productivity.efDeltaPct}%`
                        : `${productivity.efDeltaPct}%`}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {productivity.headlineWhy}
              </p>

              {/* 7-Day Acute Load Tunnel Bar */}
              <div className="pt-0.5 space-y-1">
                <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <span>
                    7d Acute Load:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {productivity.acuteLoad7d} TSS
                    </strong>{' '}
                    ({productivity.acwr.toFixed(2)}x)
                  </span>
                  <span>
                    Optimal Tunnel: {productivity.optimalLoadMin}–
                    {productivity.optimalLoadMax}
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-slate-200/85 dark:bg-slate-800/90 overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 bg-emerald-500/22 dark:bg-emerald-400/20 border-x border-emerald-600/50 dark:border-emerald-400/50"
                    style={{
                      left: `${optStartPct}%`,
                      width: `${optWidthPct}%`,
                    }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-2 rounded-full bg-slate-900 dark:bg-white shadow-xs"
                    style={{ left: `calc(${acuteMarkerPct}% - 4px)` }}
                  />
                </div>
              </div>
            </div>

            {/* 3-System Load Focus Bars with Dashed Target Boxes */}
            <div className="space-y-2.5 pt-1 border-t border-slate-200/70 dark:border-white/10">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>7-Day Load Focus Mix</span>
                <span>Dashed Box = Optimal Target</span>
              </div>
              {productivity.buckets.map((bucket) => (
                <LoadFocusGaugeRow key={bucket.key} bucket={bucket} />
              ))}
            </div>

            {/* Mini 7-Day Daily Stacked Bar Strip */}
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10">
              <div className="grid grid-cols-7 gap-1.5 items-end h-11">
                {productivity.dailyWindow.map((day) => {
                  const lowH = Math.round(
                    (day.lowAerobicLoad / maxSparkDayLoad) * 28
                  );
                  const highH = Math.round(
                    (day.highAerobicLoad / maxSparkDayLoad) * 28
                  );
                  const neuroH = Math.round(
                    (day.neuromuscularLoad / maxSparkDayLoad) * 28
                  );
                  return (
                    <div
                      key={day.date}
                      className="flex flex-col items-center gap-1"
                      title={`${day.date}: ${day.totalLoad} TSS (Low ${day.lowAerobicLoad} · High ${day.highAerobicLoad} · Neuro ${day.neuromuscularLoad})`}
                    >
                      <div className="w-full max-w-[24px] h-7 flex flex-col-reverse rounded-xs overflow-hidden bg-slate-200/55 dark:bg-slate-800/60">
                        {day.totalLoad > 0 && (
                          <>
                            <div
                              style={{
                                height: `${Math.max(lowH > 0 ? 2 : 0, lowH)}px`,
                                backgroundColor: '#0D9488',
                              }}
                            />
                            <div
                              style={{
                                height: `${Math.max(highH > 0 ? 2 : 0, highH)}px`,
                                backgroundColor: '#EA580C',
                              }}
                            />
                            <div
                              style={{
                                height: `${Math.max(neuroH > 0 ? 2 : 0, neuroH)}px`,
                                backgroundColor: '#7C3AED',
                              }}
                            />
                          </>
                        )}
                      </div>
                      <span
                        className={`text-[9.5px] font-mono leading-none ${
                          day.dayShort === 'Today'
                            ? 'font-bold text-[#0B4F9E] dark:text-sky-300'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {day.dayShort}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* CARD 2 (3 Cols): Overnight Autonomic & Strain Readiness */}
          <div className="lg:col-span-3 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Morning Readiness
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {productivity.readinessScore}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    / 100
                  </span>
                </div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold uppercase ${
                  productivity.autonomicState === 'PRIME'
                    ? 'ap-status-prime'
                    : productivity.autonomicState === 'BALANCED'
                      ? 'ap-status-info'
                      : productivity.autonomicState === 'CAUTION'
                        ? 'ap-status-caution'
                        : 'ap-status-strained'
                }`}
              >
                {productivity.autonomicState}
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 font-mono tabular-nums">
              <div className="rounded-lg bg-white/60 dark:bg-slate-950/55 border border-slate-200/70 dark:border-white/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] font-sans text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <HeartPulse className="w-3 h-3 text-emerald-500" />
                    HRV (rMSSD)
                  </span>
                  <span>
                    7d avg{' '}
                    {productivity.hrv7dAvgMs > 0
                      ? `${productivity.hrv7dAvgMs}ms`
                      : '—'}
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                  {productivity.hrvLatestMs > 0
                    ? `${productivity.hrvLatestMs} ms`
                    : '— ms'}
                </div>
              </div>

              <div className="rounded-lg bg-white/60 dark:bg-slate-950/55 border border-slate-200/70 dark:border-white/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] font-sans text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Moon className="w-3 h-3 text-indigo-500" />
                    Overnight Sleep
                  </span>
                  <span>
                    {productivity.sleepHoursLatest > 0
                      ? `${productivity.sleepHoursLatest}h`
                      : '—'}
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                  {productivity.sleepScoreLatest > 0
                    ? `Score ${productivity.sleepScoreLatest}`
                    : productivity.sleepHoursLatest > 0
                      ? `${productivity.sleepHoursLatest} hrs`
                      : 'Awaiting sync'}
                </div>
              </div>

              <div className="rounded-lg bg-white/60 dark:bg-slate-950/55 border border-slate-200/70 dark:border-white/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] font-sans text-slate-500 dark:text-slate-400">
                  <span>Resting HR</span>
                  <span>
                    {productivity.rhrDeltaBpm === 0
                      ? 'On baseline'
                      : `${productivity.rhrDeltaBpm > 0 ? `+${productivity.rhrDeltaBpm}` : productivity.rhrDeltaBpm} vs base`}
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                  {productivity.rhrLatestBpm > 0
                    ? `${productivity.rhrLatestBpm} bpm`
                    : '— bpm'}
                </div>
              </div>

              <div className="rounded-lg bg-white/60 dark:bg-slate-950/55 border border-slate-200/70 dark:border-white/10 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] font-sans text-slate-500 dark:text-slate-400">
                  <span>Form (TSB)</span>
                  <span>
                    CTL {productivity.ctl.toFixed(0)} · ATL{' '}
                    {productivity.atl.toFixed(0)}
                  </span>
                </div>
                <div className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                  {productivity.tsb > 0
                    ? `+${productivity.tsb.toFixed(0)}`
                    : productivity.tsb.toFixed(0)}
                </div>
              </div>
            </div>
          </div>

          {/* CARD 3 (4 Cols): Prepare for Today — Gap-Filling Workout Prescription */}
          <div className="lg:col-span-4 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded-md text-[10.5px] font-mono ap-badge-volt">
                  {productivity.gapPrescription.focusBadge}
                </span>

                <div className="p-0.5 rounded-lg liquid-capsule-track inline-flex items-center text-[11px]">
                  <button
                    type="button"
                    onClick={() => setRxSport('Cycling')}
                    className={`px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-semibold cursor-pointer ${
                      rxSport === 'Cycling'
                        ? 'liquid-capsule-active text-[#0B4F9E] dark:text-sky-300'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Bike className="w-3 h-3" />
                    <span>Bike</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRxSport('Running')}
                    className={`px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-semibold cursor-pointer ${
                      rxSport === 'Running'
                        ? 'liquid-capsule-active text-[#0D9488] dark:text-teal-300'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Footprints className="w-3 h-3" />
                    <span>Run</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {todayScheduled
                    ? 'On Calendar Today + 7d Focus Guidance'
                    : "Today's Gap-Filling Prescription"}
                </div>
                <h3 className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug">
                  {todayScheduled ? todayScheduled.name : activeRxTitle}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <span>
                    {todayScheduled
                      ? `${Math.round((todayScheduled.plannedDurationSecs || 3600) / 60)} min`
                      : `${productivity.gapPrescription.recommendedDurationMins} min`}
                  </span>
                  <span>·</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {todayScheduled
                      ? `${todayScheduled.plannedLoad} TSS`
                      : `~${productivity.gapPrescription.recommendedTss} TSS`}
                  </span>
                  {athleteProfile && (
                    <>
                      <span>·</span>
                      <span>
                        {rxSport === 'Running'
                          ? `LTHR ${athleteProfile.runLthr || athleteProfile.lthr} bpm`
                          : `FTP ${athleteProfile.ftp}W`}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {productivity.gapPrescription.rationale}
              </p>

              {/* Compact Step Preview */}
              <div className="rounded-lg bg-white/60 dark:bg-slate-950/55 border border-slate-200/70 dark:border-white/10 px-3 py-2 space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                {activeRxSyntax
                  .split('\n')
                  .slice(0, 4)
                  .map((stepLine, idx) => (
                    <div key={idx} className="truncate">
                      {stepLine.replace(/^-\s*/, '• ')}
                    </div>
                  ))}
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {onSyncMorphedToCalendar && (
                  <button
                    type="button"
                    disabled={isSavingRx}
                    onClick={handleCommitGapRx}
                    className="ap-btn-primary px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 flex-1 justify-center cursor-pointer"
                  >
                    <CalendarCheck className="w-3.5 h-3.5" />
                    <span>
                      {isSavingRx ? 'Scheduling…' : 'Schedule Gap-Filler RX'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onToggleWorkbench}
                  className="ap-btn-secondary px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  title="Open full Skyline Interval Workbench, Garmin Push & .FIT/.ZWO Export"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Garmin / .FIT</span>
                  {isWorkbenchExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {onOpenCoachWithPrompt && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenCoachWithPrompt(
                        `My 7-day rolling training status is ${productivity.verdictLabel} (${productivity.acuteLoad7d} TSS; Low Aerobic ${productivity.buckets[0].sharePct}%, High Aerobic ${productivity.buckets[1].sharePct}%, Neuromuscular ${productivity.buckets[2].sharePct}%; Readiness ${productivity.readinessScore}/100). How should I approach today and the next 3 days?`
                      )
                    }
                    className="min-h-[34px] px-2.5 rounded-xl border border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center cursor-pointer"
                    title="Ask AI Coach about your 7-day productivity & load focus"
                  >
                    <Sparkles className="w-3.5 h-3.5 ap-text-brand" />
                  </button>
                )}
              </div>

              {rxToast && (
                <div className="rounded-lg ap-status-prime px-2.5 py-1.5 text-[11px] font-medium">
                  {rxToast}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ==========================================================================
           MODE B: POST-WORKOUT FINISH RECEIPT (7d Needle Shift + Performance Receipt)
          ========================================================================== */
        <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* LEFT 6 COLS: How This Session Moved Your 7-Day Needle */}
          <div className="lg:col-span-6 rounded-xl liquid-glass-subtle p-4 flex flex-col justify-between space-y-3.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. 7-Day Rolling Needle Impact
                </span>
                <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold">
                  <span className="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {sessionReceipt.verdictBeforeLabel}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  <span
                    className={`px-2.5 py-0.5 rounded-md ${toneBadgeClass(
                      productivity.verdictTone
                    )}`}
                  >
                    ● {sessionReceipt.verdictAfterLabel}
                  </span>
                </div>
              </div>

              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {sessionReceipt.needleHeadline}
              </h3>

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                <span>
                  7d Load:{' '}
                  <strong>{sessionReceipt.acuteLoadBefore}</strong> →{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {sessionReceipt.acuteLoadAfter} TSS
                  </strong>
                </span>
                <span className="opacity-40">·</span>
                <span>
                  Optimal Tunnel: {sessionReceipt.optimalLoadMin}–
                  {sessionReceipt.optimalLoadMax} TSS
                </span>
              </div>
            </div>

            {/* Session Energy-System Contribution Pills */}
            <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Energy-System Strain Added &amp; 7d Mix Shift
              </div>
              <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
                {sessionReceipt.bucketShiftHighlights.map((b) => (
                  <div
                    key={b.key}
                    className="rounded-lg bg-white/65 dark:bg-slate-950/55 border border-slate-200/75 dark:border-white/10 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span
                        className="font-bold truncate"
                        style={{ color: b.colorHex }}
                      >
                        {b.shortLabel}
                      </span>
                      {b.closedDeficit ? (
                        <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ Closed
                        </span>
                      ) : b.insideTargetNow ? (
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400">
                          ✓
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      +{b.addedPts}{' '}
                      <span className="text-[10px] font-normal text-slate-500">
                        pts
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {b.shareBeforePct}% →{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {b.shareAfterPct}%
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recovery Window & Tomorrow Preview */}
            <div className="rounded-xl bg-slate-900/[0.04] dark:bg-white/[0.04] border border-slate-200/70 dark:border-white/10 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-800 dark:text-slate-100">
                <Clock className="w-3.5 h-3.5 text-[#0D9488]" />
                <span>Est. Recovery: ~{sessionReceipt.recoveryHours}h</span>
              </div>
              <span className="text-slate-600 dark:text-slate-300 font-medium">
                {sessionReceipt.tomorrowHeadline}
              </span>
            </div>
          </div>

          {/* RIGHT 6 COLS: 30-Second Session Performance Receipt */}
          <div className="lg:col-span-6 rounded-xl liquid-glass-subtle p-4 flex flex-col justify-between space-y-3.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  2. Performance Receipt vs 28d Baseline
                </span>
                <span className="px-2 py-0.5 rounded-md liquid-capsule-track font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100">
                  {sessionReceipt.totalDurationMins}m ·{' '}
                  {sessionReceipt.totalLoad} TSS
                </span>
              </div>

              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {sessionReceipt.combinedTitle}
              </h3>

              {/* 3-Column Session KPI Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono tabular-nums pt-0.5">
                <div className="rounded-lg bg-white/65 dark:bg-slate-950/55 border border-slate-200/75 dark:border-white/10 p-2.5">
                  <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                    {sessionReceipt.primaryOutputLabel}
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-white">
                    {sessionReceipt.primaryOutputValue}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {sessionReceipt.secondaryOutputValue}
                  </div>
                </div>

                <div className="rounded-lg bg-white/65 dark:bg-slate-950/55 border border-slate-200/75 dark:border-white/10 p-2.5">
                  <div className="flex items-center justify-between text-[10px] font-sans text-slate-500 dark:text-slate-400">
                    <span>Efficiency (EF)</span>
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-white">
                    {sessionReceipt.efValue !== null
                      ? sessionReceipt.efValue.toFixed(2)
                      : '—'}
                  </div>
                  <div
                    className={`text-[10px] font-semibold ${
                      sessionReceipt.efDeltaPct !== null &&
                      sessionReceipt.efDeltaPct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {sessionReceipt.efDeltaPct !== null
                      ? `${sessionReceipt.efDeltaPct >= 0 ? `+${sessionReceipt.efDeltaPct}%` : `${sessionReceipt.efDeltaPct}%`} vs 28d avg`
                      : 'Sport EF logged'}
                  </div>
                </div>

                <div className="rounded-lg bg-white/65 dark:bg-slate-950/55 border border-slate-200/75 dark:border-white/10 p-2.5">
                  <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                    Aerobic Drift
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-white">
                    {sessionReceipt.decouplingPct !== null
                      ? `${sessionReceipt.decouplingPct}%`
                      : sessionReceipt.debriefReport?.wPrimeMinPct !== null &&
                          sessionReceipt.debriefReport?.wPrimeMinPct !== undefined
                        ? `${sessionReceipt.debriefReport.wPrimeMinPct}% W' floor`
                        : 'Coupled'}
                  </div>
                  <div
                    className={`text-[10px] truncate ${
                      sessionReceipt.decouplingTone === 'prime'
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : sessionReceipt.decouplingTone === 'strained'
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {sessionReceipt.decouplingVerdict}
                  </div>
                </div>
              </div>
            </div>

            {/* Garmin 5-Zone HR (or 7-Zone Power) Time-in-Zone Pill Strip */}
            {(sessionReceipt.powerZones7.length > 0 ||
              sessionReceipt.hrZones5.length > 0) && (
              <div className="space-y-1.5 pt-1 border-t border-slate-200/70 dark:border-white/10">
                {sessionReceipt.hrZones5.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>Garmin 5-Zone HR Distribution</span>
                      <span>
                        {sessionReceipt.hrZones5
                          .filter((z) => z.pct >= 6)
                          .map((z) => `${z.zone} ${z.pct}%`)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden flex bg-slate-200/80 dark:bg-slate-800">
                      {sessionReceipt.hrZones5.map((z) =>
                        z.pct > 0 ? (
                          <div
                            key={z.zone}
                            style={{
                              width: `${z.pct}%`,
                              backgroundColor: z.colorHex,
                            }}
                            title={`${z.zone} (${z.label}): ${z.pct}% (${Math.round(z.secs / 60)}m)`}
                          />
                        ) : null
                      )}
                    </div>
                  </div>
                )}

                {sessionReceipt.powerZones7.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span>7-Zone Power Distribution</span>
                      <span>
                        {sessionReceipt.powerZones7
                          .filter((z) => z.pct >= 6)
                          .map((z) => `${z.zone} ${z.pct}%`)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden flex bg-slate-200/80 dark:bg-slate-800">
                      {sessionReceipt.powerZones7.map((z) =>
                        z.pct > 0 ? (
                          <div
                            key={z.zone}
                            style={{
                              width: `${z.pct}%`,
                              backgroundColor: z.colorHex,
                            }}
                            title={`${z.zone} (${z.label}): ${z.pct}% (${Math.round(z.secs / 60)}m)`}
                          />
                        ) : null
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Deep-Link CTA to Full 1Hz Telemetry */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {sessionReceipt.debriefReport
                  ? sessionReceipt.debriefReport.headline
                  : 'Open 1Hz streams for Skiba W’ match-burn, HRR60 & lap splits'}
              </span>
              {onSelectActivity && (
                <button
                  type="button"
                  onClick={() => onSelectActivity(sessionReceipt.primaryActivity)}
                  className="ap-btn-primary px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Inspect 1Hz Telemetry →</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
