import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bike,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Footprints,
  HeartPulse,
  MapPin,
  Moon,
  Sliders,
  Sparkles,
  Sun,
  Timer,
  TrendingUp,
  Zap,
} from './icons/PhosphorIcons';
import { formatHumanReadableStepLine } from '../utils/workoutParser';
import { formatDistance, formatDuration } from '../utils/formatters';
import {
  formatOneHzHint,
  formatOptimalTunnelLabel,
  formatVerdictLabel,
} from '../utils/plainLanguage';
import { QuickRunLoggerCard } from './QuickRunLoggerCard';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  stageWorkoutInTracksideStopwatch,
} from '../hooks/useTracksideStopwatch';
import {
  BracketedIntervalTape,
  VitalsCorridorBulletRow,
} from './charts/MicroGraphics';
import type {
  AthleteProfile,
  DistanceUnit,
  OrthopedicLoadSummary,
  PlannedWorkoutCompliance,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  SportCategory,
  StudentAthleteGuardrailResult,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { EveningCloseoutCard } from './today/EveningCloseoutCard';
import {
  findMorningContinuityFromLastNight,
  resolveCircadianHeroMode,
  type CircadianHeroMode,
} from '../physiology/eveningHabitEngine';
import {
  formatPracticeTime12h,
  formatSessionLogisticsLine,
  sortPlannedEventsChronologically,
} from '../utils/workoutScheduleUtils';
import type { SafetySwapEventInput } from '../physiology/sessionCheckInAndDigestEngine';
import {
  evaluateRollingTrainingProductivity,
  evaluateSessionImpactReceipt,
  getLocalDateIso,
  type LoadFocusBucketSummary,
} from '../physiology/trainingProductivityEngine';

export type { CircadianHeroMode };

interface CircadianFirstTouchHeroProps {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  athleteProfile?: AthleteProfile | null;
  distanceUnit: DistanceUnit;
  plainLanguageMode?: boolean;
  todayCompliance?: PlannedWorkoutCompliance | null;
  orthopedicSummary?: OrthopedicLoadSummary | null;
  studentGuardrail?: StudentAthleteGuardrailResult | null;
  isWorkbenchExpanded: boolean;
  onToggleWorkbench: () => void;
  rxSport?: 'Cycling' | 'Running';
  onRxSportChange?: (sport: 'Cycling' | 'Running') => void;
  mode?: CircadianHeroMode;
  onModeChange?: (mode: CircadianHeroMode) => void;
  sessionCheckIns?: SessionCheckInRecord[];
  onRecordSessionCheckIn?: (
    input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
  isDuskMode?: boolean;
  onToggleDuskMode?: () => void;
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
  onQuickLogRun?: (activity: UnifiedActivity) => void;
  onOpenTracksideStopwatch?: () => void;
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
      <div className="flex items-center justify-between gap-2 text-2xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: bucket.colorHex }}
          />
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
            {bucket.label}
          </span>
          <span className="text-2xs font-mono text-slate-600 dark:text-slate-400 hidden sm:inline">
            {bucket.zoneSubtitle}
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
          <span className="font-bold text-slate-900 dark:text-white">
            {bucket.loadPts}
          </span>
          <span className="text-2xs text-ap-muted dark:text-ap-muted-dark">
            ({bucket.sharePct}%)
          </span>
          {bucket.status === 'OPTIMAL' ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-2xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <Check className="w-3 h-3 shrink-0" weight="bold" />
              <span>Target</span>
            </span>
          ) : bucket.status === 'SHORTFALL' ? (
            <span className="px-1.5 py-0.2 rounded text-2xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {bucket.deltaPtsToTarget} pts
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded text-2xs font-bold bg-orange-500/15 text-orange-700 dark:text-orange-300">
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
  plainLanguageMode = false,
  todayCompliance,
  orthopedicSummary = null,
  studentGuardrail = null,
  isWorkbenchExpanded,
  onToggleWorkbench,
  rxSport: controlledRxSport,
  onRxSportChange,
  mode: controlledMode,
  onModeChange,
  sessionCheckIns = [],
  onRecordSessionCheckIn,
  isDuskMode = false,
  onToggleDuskMode,
  onSelectActivity,
  onSyncMorphedToCalendar,
  onOpenAthleteProfileModal,
  onOpenCoachWithPrompt,
  onQuickLogRun,
  onOpenTracksideStopwatch,
}) => {
  const todayIso = useMemo(() => getLocalDateIso(), []);

  const hasCompletedToday = useMemo(
    () =>
      activities.some((a) => (a.startDateLocal || '').slice(0, 10) === todayIso),
    [activities, todayIso]
  );

  const latestCompletedActivity = useMemo(() => {
    if (hasCompletedToday || activities.length === 0) return null;
    return (
      [...activities].sort((a, b) =>
        (b.startDateLocal || '').localeCompare(a.startDateLocal || '')
      )[0] || null
    );
  }, [hasCompletedToday, activities]);

  const [internalMode, setInternalMode] = useState<CircadianHeroMode>(() =>
    resolveCircadianHeroMode({ hasCompletedToday })
  );
  const mode = controlledMode ?? internalMode;
  const setMode = (next: CircadianHeroMode) => {
    setInternalMode(next);
    onModeChange?.(next);
  };

  // Auto-flip into Post-Session Receipt as soon as a workout syncs for today (without overriding explicit Tonight mode)
  useEffect(() => {
    if (hasCompletedToday && !controlledMode) {
      setInternalMode((prev) => (prev === 'MORNING' ? 'POST_SESSION' : prev));
    }
  }, [hasCompletedToday, controlledMode]);

  const lastNightContinuity = useMemo(
    () => findMorningContinuityFromLastNight(sessionCheckIns, todayIso),
    [sessionCheckIns, todayIso]
  );

  const productivity = useMemo(
    () =>
      evaluateRollingTrainingProductivity({
        activities,
        wellnessDays,
        athleteProfile,
        asOfDateIso: todayIso,
        distanceUnit,
      }),
    [activities, wellnessDays, athleteProfile, todayIso, distanceUnit]
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

  const inferredDefaultSport = useMemo<'Cycling' | 'Running'>(() => {
    const todayPlanned = plannedEvents.find(
      (ev) =>
        (ev.date || '').slice(0, 10) === todayIso &&
        (ev.sportCategory === 'Running' || ev.sportCategory === 'Cycling')
    );
    if (todayPlanned?.sportCategory === 'Running' || todayPlanned?.sportCategory === 'Cycling') {
      return todayPlanned.sportCategory;
    }
    if (athleteProfile?.primarySport === 'Running') return 'Running';
    if (athleteProfile?.primarySport === 'Cycling') return 'Cycling';
    return productivity.efPrimarySport === 'Running' ? 'Running' : 'Cycling';
  }, [plannedEvents, todayIso, athleteProfile?.primarySport, productivity.efPrimarySport]);

  const [internalRxSport, setInternalRxSport] = useState<'Cycling' | 'Running'>(
    inferredDefaultSport
  );
  const [hasManualSportOverride, setHasManualSportOverride] = useState<boolean>(false);

  useEffect(() => {
    if (!hasManualSportOverride && controlledRxSport === undefined) {
      setInternalRxSport(inferredDefaultSport);
    }
  }, [inferredDefaultSport, hasManualSportOverride, controlledRxSport]);

  const rxSport = controlledRxSport ?? internalRxSport;
  const handleSelectRxSport = (nextSport: 'Cycling' | 'Running') => {
    setHasManualSportOverride(true);
    if (onRxSportChange) {
      onRxSportChange(nextSport);
    } else {
      setInternalRxSport(nextSport);
    }
  };
  const [isSavingRx, setIsSavingRx] = useState<boolean>(false);
  const [rxToast, setRxToast] = useState<string | null>(null);
  const [selectedTodayIdx, setSelectedTodayIdx] = useState<number>(0);

  const todayScheduledList = useMemo(
    () =>
      sortPlannedEventsChronologically(
        plannedEvents.filter((ev) => (ev.date || '').slice(0, 10) === todayIso)
      ),
    [plannedEvents, todayIso]
  );

  const todayScheduled = useMemo(() => {
    if (todayScheduledList.length === 0) return null;
    if (selectedTodayIdx > 0 && selectedTodayIdx < todayScheduledList.length) {
      return todayScheduledList[selectedTodayIdx];
    }
    const sportMatched =
      todayScheduledList.find(
        (ev) => ev.sportCategory === rxSport || ev.sportCategory === 'Multisport'
      ) || todayScheduledList[0];
    return sportMatched || null;
  }, [todayScheduledList, selectedTodayIdx, rxSport]);

  const todayCombinedPlannedTss = useMemo(
    () => todayScheduledList.reduce((acc, ev) => acc + (ev.plannedLoad || 0), 0),
    [todayScheduledList]
  );

  const activeRxTitle =
    rxSport === 'Running'
      ? productivity.gapPrescription.recommendedTitleRunning
      : productivity.gapPrescription.recommendedTitleCycling;
  const activeRxSyntax =
    rxSport === 'Running'
      ? productivity.gapPrescription.workoutSyntaxRunning
      : productivity.gapPrescription.workoutSyntaxCycling;

  const isBoneStressStop = studentGuardrail?.status === 'BONE_STRESS_STOP';
  const isHighImpactGuardrail =
    orthopedicSummary?.riskTier === 'HIGH_IMPACT_GUARDRAIL' || isBoneStressStop;
  const shouldOfferGuardrailSwap = Boolean(
    isHighImpactGuardrail &&
      orthopedicSummary?.canMorphTodayRunToBike &&
      (todayScheduled ? todayScheduled.sportCategory === 'Running' : rxSport === 'Running')
  );

  const handleCommitGuardrailSwap = async () => {
    if (!onSyncMorphedToCalendar || !orthopedicSummary) return;
    setIsSavingRx(true);
    setRxToast(null);
    try {
      await onSyncMorphedToCalendar({
        date: todayIso,
        name: `Orthopedic Swap: ${orthopedicSummary.suggestedBikeDurationMins}m High-Cadence Z2 Ride`,
        sportCategory: 'Cycling',
        environmentPreference: 'FLEXIBLE',
        plannedDurationSecs: orthopedicSummary.suggestedBikeDurationMins * 60,
        plannedLoad: orthopedicSummary.suggestedBikeTss,
        workoutSyntax: orthopedicSummary.suggestedBikeWorkoutSyntax,
        description:
          'Cross-modal aerobic-equivalent ride generated by MeetReady Orthopedic Interference Engine (zero tibial/Achilles impact).',
        replaceExistingDate: true,
      });
      setRxToast(
        `Swapped today to ${orthopedicSummary.suggestedBikeDurationMins}m Zero-Impact Z2 Ride (${orthopedicSummary.suggestedBikeTss} TSS).`
      );
      window.setTimeout(() => setRxToast(null), 5000);
    } finally {
      setIsSavingRx(false);
    }
  };

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
        description: `${productivity.gapPrescription.rationale} [Auto-tuned by MeetReady 7-Day Rolling Load Focus Engine]`,
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
      {/* Signature 4px MeetReady Volt Top Rail */}
      <div className="absolute top-0 left-0 right-0 h-[4px] ap-brand-hairline pointer-events-none" />

      {/* Top Circadian Header Bar */}
      <div className="relative px-4 sm:px-5 py-3 border-b border-emerald-900/15 dark:border-[#254431] bg-[#EDF4EF]/85 dark:bg-[#0D1711]/90 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h1 className="text-base sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {mode === 'TONIGHT'
              ? 'Tonight Closeout & Tomorrow Lock-In'
              : mode === 'MORNING'
                ? 'Today’s Readiness & Prescription'
                : 'Today’s Session Receipt'}
          </h1>
          {mode === 'TONIGHT' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-2xs font-mono font-semibold uppercase tracking-wider bg-ap-inset text-ap-clay dark:bg-ap-turf dark:text-ap-volt">
              <Moon className="w-3.5 h-3.5" />
              <span>Bedtime Ritual · {todayIso}</span>
            </span>
          ) : mode === 'MORNING' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-2xs font-mono font-semibold uppercase tracking-wider bg-ap-inset text-ap-clay dark:bg-ap-turf dark:text-ap-volt">
              <Sun className="w-3.5 h-3.5" />
              <span>7d Rolling</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ap-status-prime text-2xs font-mono font-bold uppercase tracking-wide">
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
              <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-semibold ap-status-info">
                {todayCompliance.summaryLabel}
              </span>
            )}

          {athleteProfile && onOpenAthleteProfileModal && (() => {
            const pacePerUnitSecs =
              athleteProfile.thresholdPaceSecsPerKm > 0
                ? distanceUnit === 'mi'
                  ? athleteProfile.thresholdPaceSecsPerKm * 1.609344
                  : athleteProfile.thresholdPaceSecsPerKm
                : 0;
            const paceWholeSecs = Math.round(pacePerUnitSecs);
            const paceFormatted =
              paceWholeSecs > 0
                ? `${Math.floor(paceWholeSecs / 60)}:${String(paceWholeSecs % 60).padStart(2, '0')}/${distanceUnit}`
                : null;
            return (
              <button
                type="button"
                onClick={onOpenAthleteProfileModal}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg liquid-capsule-track text-2xs font-mono tabular-nums text-slate-600 dark:text-slate-300 hover:text-[#166534] dark:hover:text-ap-volt transition-colors cursor-pointer"
                title="Inspect or update Strava / Garmin / Intervals thresholds & HR zones"
              >
                {rxSport === 'Running' ? (
                  <>
                    {paceFormatted && (
                      <>
                        <span>LT2 {paceFormatted}</span>
                        <span className="opacity-40">·</span>
                      </>
                    )}
                    <span>
                      LTHR {athleteProfile.runLthr > 0 ? athleteProfile.runLthr : athleteProfile.lthr}{' '}
                      bpm
                    </span>
                  </>
                ) : (
                  <>
                    <span>FTP {athleteProfile.ftp}W</span>
                    <span className="opacity-40">·</span>
                    <span>LTHR {athleteProfile.lthr} bpm</span>
                  </>
                )}
              </button>
            );
          })()}
        </div>

        {/* Tri-Modal Circadian Switcher: Morning Brief | Post-Session | Tonight */}
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-xl liquid-capsule-track inline-flex items-center text-xs">
            <button
              type="button"
              aria-pressed={mode === 'MORNING'}
              onClick={() => setMode('MORNING')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-all cursor-pointer ${
                mode === 'MORNING'
                  ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE]'
                  : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
              <span>Morning Brief</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'POST_SESSION'}
              onClick={() => setMode('POST_SESSION')}
              disabled={!sessionReceipt}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-all ${
                !sessionReceipt
                  ? 'opacity-40 cursor-not-allowed text-ap-muted dark:text-ap-muted-dark'
                  : mode === 'POST_SESSION'
                    ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE] cursor-pointer'
                    : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white cursor-pointer'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
              <span>Post-Session</span>
              {hasCompletedToday && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
            <button
              type="button"
              data-testid="circadian-mode-tonight"
              aria-pressed={mode === 'TONIGHT'}
              onClick={() => setMode('TONIGHT')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg inline-flex items-center gap-1.5 font-semibold transition-all cursor-pointer ${
                mode === 'TONIGHT'
                  ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE]'
                  : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
              <span>Tonight</span>
            </button>
          </div>
        </div>
      </div>

      {/* ==========================================================================
          MODE C: TONIGHT CLOSEOUT & TOMORROW LOCK-IN (15s Bedtime Ritual)
         ========================================================================== */}
      {mode === 'TONIGHT' ? (
        <EveningCloseoutCard
          todayIso={todayIso}
          activities={activities}
          plannedEvents={plannedEvents}
          latestWellness={wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : null}
          safeSportHideWeight={Boolean(athleteProfile?.safeSportHideWeight)}
          sessionCheckIns={sessionCheckIns}
          onRecordCheckIn={onRecordSessionCheckIn || (() => {})}
          isDuskMode={isDuskMode}
          onToggleDuskMode={onToggleDuskMode || (() => {})}
        />
      ) : mode === 'MORNING' || !sessionReceipt ? (
        <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-3.5">
          {/* CARD 1 (5 Cols): 7-Day Rolling Training Productivity & 3-System Load Focus */}
          <div className="order-3 lg:order-1 lg:col-span-5 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wide ${toneBadgeClass(
                      productivity.verdictTone
                    )}`}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
                    <span>{formatVerdictLabel(productivity.verdictLabel, plainLanguageMode)}</span>
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

                <div className="flex items-center gap-1.5 font-mono text-2xs tabular-nums">
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
              {lastNightContinuity && (
                <div className="rounded-lg ap-card-inset px-2.5 py-1.5 text-2xs font-mono text-slate-700 dark:text-slate-200">
                  Last night: RPE {lastNightContinuity.rpe}/10
                  {lastNightContinuity.legFeel ? ` · Legs ${lastNightContinuity.legFeel}` : ''}
                  {lastNightContinuity.autoSwappedToRecovery
                    ? ' · Tomorrow auto-morphed to recovery'
                    : lastNightContinuity.sleepTargetHours
                      ? ` · Sleep target ${lastNightContinuity.sleepTargetHours}h`
                      : ''}
                </div>
              )}

              {/* 7-Day Acute Load Tunnel Bar */}
              <div className="pt-0.5 space-y-1">
                <div className="flex items-center justify-between text-2xs font-mono tabular-nums text-ap-muted dark:text-ap-muted-dark">
                  <span>
                    7d Acute Load:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {productivity.acuteLoad7d} TSS
                    </strong>{' '}
                    ({productivity.acwr.toFixed(2)}x)
                  </span>
                  <span>
                    {formatOptimalTunnelLabel(plainLanguageMode)}: {productivity.optimalLoadMin}–
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
            <div className="space-y-2.5 pt-1 border-t border-ap-cobalt/12 dark:border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                <span>7-Day Load Focus Mix</span>
                <span className="text-2xs opacity-85">Dashed Box = Target</span>
              </div>
              {productivity.buckets.map((bucket) => (
                <LoadFocusGaugeRow key={bucket.key} bucket={bucket} />
              ))}
            </div>

            {/* Mini 7-Day Daily Stacked Bar Strip */}
            <div className="pt-2 border-t border-ap-cobalt/12 dark:border-white/10">
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
                        className={`text-2xs font-mono leading-none ${
                          day.dayShort === 'Today'
                            ? 'font-bold text-ap-cobalt dark:text-ap-volt'
                            : 'text-ap-muted dark:text-ap-muted-dark'
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

          {/* CARD 2 (3 Cols): Overnight Autonomic & Strain Readiness — Single Recessed Well + Hairline Rows */}
          <div className="order-1 lg:order-2 lg:col-span-3 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-ap-cobalt/12 dark:border-white/10">
              <h2 className="text-sm sm:text-base font-bold text-ap-ink dark:text-white leading-snug">
                Morning Readiness
              </h2>
              <div className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                <span className="ap-kpi-value text-2xl sm:text-3xl font-extrabold text-ap-ink dark:text-white">
                  {productivity.verdict === 'CALIBRATING' || productivity.readinessScore === 0
                    ? '—'
                    : `${productivity.readinessScore}/100`}
                </span>
                <span
                  data-testid="morning-readiness-state-badge"
                  className={`px-2 py-0.5 rounded-full text-2xs font-mono font-bold uppercase ${
                    productivity.verdict === 'CALIBRATING' || productivity.readinessScore === 0
                      ? 'ap-status-info'
                      : isBoneStressStop
                        ? 'ap-status-strained'
                        : isHighImpactGuardrail &&
                            (productivity.autonomicState === 'PRIME' ||
                              productivity.autonomicState === 'BALANCED')
                          ? 'ap-status-caution'
                          : productivity.autonomicState === 'PRIME'
                            ? 'ap-status-prime'
                            : productivity.autonomicState === 'BALANCED'
                              ? 'ap-status-info'
                              : productivity.autonomicState === 'CAUTION'
                                ? 'ap-status-caution'
                                : 'ap-status-strained'
                  }`}
                >
                  {productivity.verdict === 'CALIBRATING' || productivity.readinessScore === 0
                    ? 'Calibrating'
                    : isBoneStressStop
                      ? 'Bone-Stress Stop'
                      : isHighImpactGuardrail &&
                          (productivity.autonomicState === 'PRIME' ||
                            productivity.autonomicState === 'BALANCED')
                        ? 'Impact Guardrail'
                        : productivity.autonomicState}
                </span>
              </div>
            </div>

            {isHighImpactGuardrail &&
              (productivity.autonomicState === 'PRIME' ||
                productivity.autonomicState === 'BALANCED') && (
                <p
                  data-testid="readiness-guardrail-reconciliation"
                  className="text-2xs rounded-lg ap-status-caution px-2.5 py-1.5 font-medium leading-snug"
                >
                  Cardio/HRV recovered ({productivity.readinessScore}/100),{' '}
                  {isBoneStressStop && studentGuardrail
                    ? `but bone-stress safeguard is active — switch to zero-impact cross-training.`
                    : `but 7d running impact is ${orthopedicSummary?.impactAcwr.toFixed(2)}x normal — protect legs.`}
                </p>
              )}

            {productivity.hrvLatestMs === 0 &&
            productivity.sleepScoreLatest === 0 &&
            productivity.sleepHoursLatest === 0 &&
            productivity.rhrLatestBpm === 0 ? (
              <div
                data-testid="strava-only-readiness-summary"
                className="grid grid-cols-2 lg:grid-cols-1 gap-2 lg:gap-0 lg:divide-y lg:divide-ap-cobalt/12 lg:dark:divide-white/10 font-mono tabular-nums flex-1"
              >
                <div className="p-2 lg:p-0 lg:py-2 lg:first:pt-0 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="font-medium">Form (TSB)</span>
                    <span className="text-2xs opacity-85">Freshness</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    <span>
                      {productivity.tsb > 0
                        ? `+${productivity.tsb.toFixed(0)}`
                        : productivity.tsb.toFixed(0)}
                    </span>
                    <VitalsCorridorBulletRow
                      valuePct={50 + productivity.tsb}
                      bandStartPct={30}
                      bandWidthPct={45}
                      tone={productivity.tsb < -20 ? 'caution' : 'prime'}
                    />
                  </div>
                </div>

                <div className="p-2 lg:p-0 lg:py-2 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="font-medium">Fitness (CTL)</span>
                    <span className="text-2xs opacity-85">
                      {productivity.ctlRamp7d >= 0
                        ? `+${productivity.ctlRamp7d}/wk`
                        : `${productivity.ctlRamp7d}/wk`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    {productivity.ctl.toFixed(0)}
                  </div>
                </div>

                <div className="p-2 lg:p-0 lg:py-2 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="font-medium">7d Acute Load</span>
                    <span className="text-2xs opacity-85">
                      {productivity.acwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    <span>{productivity.acuteLoad7d} TSS</span>
                    <VitalsCorridorBulletRow
                      valuePct={((productivity.acwr - 0.4) / 1.4) * 100}
                      tone={
                        productivity.acwr >= 1.35
                          ? 'strained'
                          : productivity.acwr >= 1.2
                            ? 'caution'
                            : 'prime'
                      }
                    />
                  </div>
                </div>

                {onOpenAthleteProfileModal ? (
                  <button
                    type="button"
                    onClick={onOpenAthleteProfileModal}
                    className="col-span-2 lg:col-span-1 pt-2 min-h-[44px] sm:min-h-[32px] text-left font-sans text-2xs font-medium text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-ap-volt underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Link Garmin, Wahoo, Polar, or Intervals.icu for overnight HRV &amp; sleep →
                  </button>
                ) : (
                  <div className="col-span-2 lg:col-span-1 pt-2 font-sans text-2xs text-ap-muted dark:text-ap-muted-dark">
                    Optional: link Garmin, Wahoo, Polar, or Intervals.icu for overnight HRV &amp; sleep.
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 lg:gap-0 lg:divide-y lg:divide-ap-cobalt/12 lg:dark:divide-white/10 font-mono tabular-nums flex-1">
                <div className="p-2 lg:p-0 lg:py-2 lg:first:pt-0 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span
                      className="inline-flex items-center gap-1 font-medium"
                      title="Overnight HRV (rMSSD)"
                    >
                      <HeartPulse className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      Overnight HRV
                    </span>
                    <span className="text-2xs opacity-85">
                      {productivity.hrv7dAvgMs > 0
                        ? `${productivity.hrv7dAvgMs}ms`
                        : 'Wearable'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    <span>
                      {productivity.hrvLatestMs > 0
                        ? `${productivity.hrvLatestMs} ms`
                        : 'Wearable needed'}
                    </span>
                    {productivity.hrvLatestMs > 0 && (
                      <VitalsCorridorBulletRow
                        valuePct={
                          productivity.hrv7dAvgMs > 0
                            ? 50 + ((productivity.hrvLatestMs - productivity.hrv7dAvgMs) / Math.max(10, productivity.hrv7dAvgMs * 0.25)) * 25
                            : 55
                        }
                        tone={
                          productivity.autonomicState === 'SUPPRESSED'
                            ? 'strained'
                            : productivity.autonomicState === 'CAUTION'
                              ? 'caution'
                              : 'prime'
                        }
                      />
                    )}
                  </div>
                </div>

                <div className="p-2 lg:p-0 lg:py-2 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Moon className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                      Overnight Sleep
                    </span>
                    <span className="text-2xs opacity-85">
                      {productivity.sleepHoursLatest > 0
                        ? `${productivity.sleepHoursLatest}h`
                        : '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-ap-ink dark:text-white truncate">
                    <span>
                      {productivity.sleepScoreLatest > 0
                        ? `Score ${productivity.sleepScoreLatest}`
                        : productivity.sleepHoursLatest > 0
                          ? `${productivity.sleepHoursLatest} hrs`
                          : 'Awaiting sync'}
                    </span>
                    {productivity.sleepHoursLatest > 0 && (
                      <VitalsCorridorBulletRow
                        valuePct={(productivity.sleepHoursLatest / 9.5) * 100}
                        bandStartPct={68}
                        bandWidthPct={25}
                        tone={productivity.sleepHoursLatest < 6.5 ? 'caution' : 'info'}
                      />
                    )}
                  </div>
                </div>

                <div className="p-2 lg:p-0 lg:py-2 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="font-medium">Resting HR</span>
                    <span className="text-2xs opacity-85">
                      {productivity.rhrLatestBpm === 0
                        ? 'Wearable'
                        : productivity.rhrDeltaBpm === 0
                          ? 'Base'
                          : `${productivity.rhrDeltaBpm > 0 ? `+${productivity.rhrDeltaBpm}` : productivity.rhrDeltaBpm} base`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    <span>
                      {productivity.rhrLatestBpm > 0
                        ? `${productivity.rhrLatestBpm} bpm`
                        : 'Wearable needed'}
                    </span>
                    {productivity.rhrLatestBpm > 0 && (
                      <VitalsCorridorBulletRow
                        valuePct={50 + productivity.rhrDeltaBpm * 4}
                        bandStartPct={32}
                        bandWidthPct={36}
                        tone={productivity.rhrDeltaBpm >= 5 ? 'caution' : 'prime'}
                      />
                    )}
                  </div>
                </div>

                <div className="p-2 lg:p-0 lg:py-2 lg:last:pb-0 rounded-lg lg:rounded-none bg-slate-100/50 dark:bg-white/5 lg:bg-transparent lg:dark:bg-transparent">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span className="font-medium">Form (TSB)</span>
                    <span className="text-2xs opacity-85">
                      CTL {productivity.ctl.toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold text-ap-ink dark:text-white">
                    {productivity.tsb > 0
                      ? `+${productivity.tsb.toFixed(0)}`
                      : productivity.tsb.toFixed(0)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CARD 3 (4 Cols): Prepare for Today — Coherent Scheduled or Gap-Filling Prescription */}
          <div className="order-2 lg:order-3 lg:col-span-4 rounded-xl liquid-glass-subtle p-3.5 sm:p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-ap-ink dark:text-white leading-snug">
                  {todayScheduled ? todayScheduled.name : activeRxTitle}
                </h2>

                <div
                  role="group"
                  aria-label="Target workout sport"
                  className="p-0.5 rounded-lg liquid-capsule-track inline-flex items-center text-2xs shrink-0"
                >
                  <button
                    type="button"
                    aria-pressed={rxSport === 'Cycling'}
                    onClick={() => handleSelectRxSport('Cycling')}
                    className={`min-h-[44px] sm:min-h-[30px] px-3 sm:px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-semibold cursor-pointer ${
                      rxSport === 'Cycling'
                        ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE]'
                        : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                    }`}
                  >
                    <Bike className="w-3 h-3 text-ap-cobalt dark:text-ap-volt" />
                    <span>Bike</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={rxSport === 'Running'}
                    onClick={() => handleSelectRxSport('Running')}
                    className={`min-h-[44px] sm:min-h-[30px] px-3 sm:px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-semibold cursor-pointer ${
                      rxSport === 'Running'
                        ? 'liquid-capsule-active text-ap-ink dark:text-[#ECF2EE]'
                        : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                    }`}
                  >
                    <Footprints className="w-3 h-3 text-ap-cobalt dark:text-ap-volt" />
                    <span>Run</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-2xs font-mono tabular-nums text-[#35463B] dark:text-[#C5D1CA]">
                <span className="px-2 py-0.5 rounded-md ap-status-info font-bold">
                  {todayScheduled
                    ? todayScheduledList.length > 1
                      ? `Double Day (${todayScheduledList.length} sessions · ${todayCombinedPlannedTss} TSS)`
                      : 'Scheduled Today'
                    : 'Recommended'}
                </span>
                <span>
                  {todayScheduled
                    ? `${Math.round((todayScheduled.plannedDurationSecs || 3600) / 60)} min`
                    : `${productivity.gapPrescription.recommendedDurationMins} min`}
                </span>
                <span>·</span>
                <span className="font-bold text-ap-ink dark:text-white">
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

              {todayScheduled && formatSessionLogisticsLine(todayScheduled) && (
                <div
                  data-testid="hero-session-logistics-badge"
                  className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-md border border-ap-cobalt/20 dark:border-ap-edge-dark text-2xs font-mono font-semibold text-ap-cobalt dark:text-ap-volt"
                >
                  {todayScheduled.scheduledTime && <Clock className="w-3 h-3 shrink-0" />}
                  {todayScheduled.locationName && <MapPin className="w-3 h-3 shrink-0" />}
                  <span>{formatSessionLogisticsLine(todayScheduled)}</span>
                </div>
              )}

              {todayScheduledList.length > 1 && (
                <div
                  role="group"
                  aria-label="Today's multiple sessions"
                  data-testid="hero-double-day-switcher"
                  className="flex flex-wrap items-center gap-1"
                >
                  {todayScheduledList.map((ev, idx) => {
                    const active = todayScheduled?.id === ev.id;
                    const slotTag =
                      ev.sessionSlot && ev.sessionSlot !== 'SINGLE'
                        ? ev.sessionSlot
                        : formatPracticeTime12h(ev.scheduledTime) || `#${idx + 1}`;
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedTodayIdx(idx)}
                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-2xs font-mono font-semibold truncate max-w-[200px] cursor-pointer ${
                          active
                            ? 'ap-nav-volt-active'
                            : 'liquid-capsule-track text-[#1F3528] dark:text-[#C8D8CE]'
                        }`}
                        title={formatSessionLogisticsLine(ev) || ev.name}
                      >
                        {slotTag} · {ev.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-mono ${
                  shouldOfferGuardrailSwap ? 'ap-status-strained font-bold' : 'ap-status-caution'
                }`}
              >
                <Zap className="w-3 h-3 shrink-0" weight="fill" />
                <span>
                  {shouldOfferGuardrailSwap
                    ? `Guardrail Active · Zero-Impact Swap (${orthopedicSummary?.impactAcwr.toFixed(2)}x Impact)`
                    : productivity.gapPrescription.focusBadge}
                </span>
              </div>

              <p className="text-xs text-[#35463B] dark:text-[#C5D1CA] leading-snug">
                {shouldOfferGuardrailSwap && orthopedicSummary
                  ? orthopedicSummary.guardrailRecommendation
                  : todayScheduled
                    ? todayScheduled.description ||
                      `Scheduled ${todayScheduled.sportCategory.toLowerCase()} session on your calendar.`
                    : productivity.gapPrescription.rationale}
              </p>

              {/* Zone Effort Tape Skyline */}
              <BracketedIntervalTape
                workoutSyntax={
                  shouldOfferGuardrailSwap && orthopedicSummary
                    ? orthopedicSummary.suggestedBikeWorkoutSyntax
                    : todayScheduled?.workoutSyntax || activeRxSyntax
                }
                compact
              />

              {/* Hairline-Divided Step Preview (Zero Nested Sub-Cards) */}
              <div className="pt-2 border-t border-ap-cobalt/12 dark:border-white/10 divide-y divide-ap-cobalt/10 dark:divide-white/10 font-mono text-2xs text-ap-ink dark:text-[#ECF2EE]">
                {(shouldOfferGuardrailSwap && orthopedicSummary
                  ? orthopedicSummary.suggestedBikeWorkoutSyntax
                  : todayScheduled?.workoutSyntax || activeRxSyntax
                )
                  .split('\n')
                  .filter((line) => line.trim().length > 0)
                  .slice(0, 4)
                  .map((stepLine, idx) => {
                    const readableLine = formatHumanReadableStepLine(
                      stepLine,
                      shouldOfferGuardrailSwap
                        ? 'Cycling'
                        : todayScheduled?.sportCategory || rxSport || 'Running',
                      athleteProfile?.thresholdPaceSecsPerKm,
                      distanceUnit,
                      athleteProfile?.ftp
                    );
                    return (
                      <div key={idx} className="py-1 first:pt-0 last:pb-0 truncate">
                        {readableLine.replace(/^-\s*/, '· ')}
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {shouldOfferGuardrailSwap && orthopedicSummary && onSyncMorphedToCalendar ? (
                  <>
                    <button
                      type="button"
                      data-testid="hero-guardrail-swap-btn"
                      disabled={isSavingRx}
                      onClick={() => void handleCommitGuardrailSwap()}
                      className="ap-btn-primary px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 flex-1 justify-center cursor-pointer"
                    >
                      <CalendarCheck className="w-3.5 h-3.5" />
                      <span>
                        {isSavingRx
                          ? 'Swapping…'
                          : `Swap Run → ${orthopedicSummary.suggestedBikeDurationMins}m Zero-Impact Ride`}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-expanded={isWorkbenchExpanded}
                      onClick={onToggleWorkbench}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      title="Open full Skyline Interval Workbench, Garmin Push & .FIT/.ZWO Export"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Customize &amp; Export</span>
                      {isWorkbenchExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </>
                ) : todayScheduled ? (
                  <>
                    <button
                      type="button"
                      aria-expanded={isWorkbenchExpanded}
                      onClick={onToggleWorkbench}
                      className="ap-btn-primary px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 flex-1 justify-center cursor-pointer"
                      title="Open full Skyline Interval Workbench, Garmin Push & .FIT/.ZWO Export"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Customize &amp; Export</span>
                      {isWorkbenchExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {onSyncMorphedToCalendar && (
                      <button
                        type="button"
                        disabled={isSavingRx}
                        onClick={handleCommitGapRx}
                        className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        title={`Replace today's scheduled workout with ${activeRxTitle} (${productivity.gapPrescription.recommendedDurationMins}m · ~${productivity.gapPrescription.recommendedTss} TSS)`}
                      >
                        <CalendarCheck className="w-3.5 h-3.5" />
                        <span>
                          {isSavingRx ? 'Swapping…' : 'Use Readiness Workout'}
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {onSyncMorphedToCalendar && (
                      <button
                        type="button"
                        disabled={isSavingRx}
                        onClick={handleCommitGapRx}
                        className="ap-btn-primary px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 flex-1 justify-center cursor-pointer"
                      >
                        <CalendarCheck className="w-3.5 h-3.5" />
                        <span>
                          {isSavingRx ? 'Scheduling…' : "Schedule Today's Workout"}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      aria-expanded={isWorkbenchExpanded}
                      onClick={onToggleWorkbench}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      title="Open full Skyline Interval Workbench, Garmin Push & .FIT/.ZWO Export"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Customize &amp; Export</span>
                      {isWorkbenchExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </>
                )}

                {onOpenTracksideStopwatch &&
                  (todayScheduled?.sportCategory || rxSport) === 'Running' && (
                    <button
                      type="button"
                      data-testid="today-open-stopwatch-btn"
                      onClick={() => {
                        if (todayScheduled) {
                          const spec = inferTrackWorkoutSpecFromPlannedEvent(todayScheduled);
                          if (spec) {
                            stageWorkoutInTracksideStopwatch({
                              title: todayScheduled.name,
                              spec,
                            });
                          }
                        }
                        onOpenTracksideStopwatch();
                      }}
                      className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold cursor-pointer transition-colors"
                    >
                      <Timer className="w-3.5 h-3.5" weight="bold" />
                      <span>Time on Track</span>
                    </button>
                  )}

                {onOpenCoachWithPrompt && (
                  <button
                    type="button"
                    aria-label="Ask AI Coach about your 7-day productivity and load focus"
                    onClick={() =>
                      onOpenCoachWithPrompt(
                        `My 7-day rolling training status is ${productivity.verdictLabel} (${productivity.acuteLoad7d} TSS; Low Aerobic ${productivity.buckets[0].sharePct}%, High Aerobic ${productivity.buckets[1].sharePct}%, Neuromuscular ${productivity.buckets[2].sharePct}%; Readiness ${productivity.readinessScore}/100). How should I approach today and the next 3 days?`
                      )
                    }
                    className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] px-2.5 rounded-xl border border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 inline-flex items-center justify-center cursor-pointer"
                    title="Ask AI Coach about your 7-day productivity & load focus"
                  >
                    <Sparkles className="w-3.5 h-3.5 ap-text-brand" />
                  </button>
                )}
              </div>

              {onQuickLogRun &&
                athleteProfile &&
                (todayScheduled?.sportCategory || rxSport) === 'Running' && (
                  <QuickRunLoggerCard
                    compact
                    distanceUnit={distanceUnit}
                    athleteProfile={athleteProfile}
                    onSaveRun={onQuickLogRun}
                  />
                )}

              {rxToast && (
                <div className="rounded-lg ap-status-prime px-2.5 py-1.5 text-2xs font-medium">
                  {rxToast}
                </div>
              )}
            </div>
          </div>

          {latestCompletedActivity && onSelectActivity && (
            <div
              data-testid="today-last-run-strip"
              className="order-4 lg:col-span-12 rounded-xl ap-card-inset px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="px-2 py-0.5 rounded-md liquid-capsule-track font-mono text-2xs font-bold uppercase text-ap-cobalt dark:text-ap-volt shrink-0">
                  Last Session
                </span>
                <span className="text-xs font-bold text-ap-ink dark:text-white truncate max-w-[240px] sm:max-w-[360px]">
                  {latestCompletedActivity.name}
                </span>
                <span className="text-2xs font-mono tabular-nums text-ap-muted dark:text-ap-muted-dark">
                  {(latestCompletedActivity.startDateLocal || '').slice(0, 10)} ·{' '}
                  {formatDistance(latestCompletedActivity.distanceMeters || 0, distanceUnit)} ·{' '}
                  {formatDuration(latestCompletedActivity.movingTimeSecs || 0)} ·{' '}
                  {Math.round(latestCompletedActivity.trainingLoad || 0)} TSS
                </span>
              </div>
              <button
                type="button"
                data-testid="today-last-run-inspect-btn"
                onClick={() => onSelectActivity(latestCompletedActivity)}
                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <span>Inspect</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
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
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  {sessionReceipt.needleHeadline}
                </h3>
                <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold">
                  <span className="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {sessionReceipt.verdictBeforeLabel}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md ${toneBadgeClass(
                      productivity.verdictTone
                    )}`}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />
                    <span>{sessionReceipt.verdictAfterLabel}</span>
                  </span>
                </div>
              </div>

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
                  {formatOptimalTunnelLabel(plainLanguageMode)}: {sessionReceipt.optimalLoadMin}–
                  {sessionReceipt.optimalLoadMax} TSS
                </span>
              </div>
            </div>

            {/* Session Energy-System Contribution Rows */}
            <div className="space-y-2 pt-2 border-t border-ap-cobalt/12 dark:border-white/10">
              <div className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark">
                Energy-System Strain Added &amp; 7d Mix Shift
              </div>
              <div className="grid grid-cols-3 divide-x divide-ap-cobalt/12 dark:divide-white/10 font-mono tabular-nums">
                {sessionReceipt.bucketShiftHighlights.map((b, idx) => (
                  <div
                    key={b.key}
                    className={`py-1 space-y-1 ${idx === 0 ? 'pr-2.5' : idx === 1 ? 'px-2.5' : 'pl-2.5'}`}
                  >
                    <div className="flex items-center justify-between gap-1 text-2xs">
                      <span
                        className="font-bold truncate"
                        style={{ color: b.colorHex }}
                      >
                        {b.shortLabel}
                      </span>
                      {b.closedDeficit ? (
                        <span className="inline-flex items-center gap-0.5 text-2xs font-bold text-emerald-700 dark:text-emerald-400">
                          <Check className="w-3 h-3 shrink-0" weight="bold" />
                          <span>Closed</span>
                        </span>
                      ) : b.insideTargetNow ? (
                        <span className="inline-flex items-center text-2xs text-emerald-700 dark:text-emerald-400">
                          <Check className="w-3 h-3 shrink-0" weight="bold" />
                        </span>
                      ) : null}
                    </div>
                    <div className="text-sm font-extrabold text-ap-ink dark:text-white">
                      +{b.addedPts}{' '}
                      <span className="text-2xs font-normal text-ap-muted dark:text-ap-muted-dark">
                        pts
                      </span>
                    </div>
                    <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                      {b.shareBeforePct}% →{' '}
                      <strong className="text-ap-ink dark:text-slate-200">
                        {b.shareAfterPct}%
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recovery Window & Tomorrow Preview */}
            <div className="pt-2.5 border-t border-ap-cobalt/12 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="inline-flex items-center gap-1.5 font-mono font-semibold text-ap-ink dark:text-slate-100">
                <Clock className="w-3.5 h-3.5 text-[#0D9488]" />
                <span>Est. Recovery: ~{sessionReceipt.recoveryHours}h</span>
              </div>
              <span className="text-[#35463B] dark:text-[#C5D1CA] font-medium">
                {sessionReceipt.tomorrowHeadline}
              </span>
            </div>
          </div>

          {/* RIGHT 6 COLS: 30-Second Session Performance Receipt */}
          <div className="lg:col-span-6 rounded-xl liquid-glass-subtle p-4 flex flex-col justify-between space-y-3.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-bold text-ap-ink dark:text-white truncate">
                  {sessionReceipt.combinedTitle}
                </h3>
                <span className="px-2 py-0.5 rounded-md liquid-capsule-track font-mono text-2xs font-bold text-ap-ink dark:text-slate-100 shrink-0">
                  {sessionReceipt.totalDurationMins}m ·{' '}
                  {sessionReceipt.totalLoad} TSS
                </span>
              </div>

              {/* 3-Column Session KPI Grid (Hairline Divided) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ap-cobalt/12 dark:divide-white/10 font-mono tabular-nums pt-1">
                <div className="py-1.5 sm:py-0 sm:pr-3">
                  <div className="text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    {sessionReceipt.primaryOutputLabel}
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-ap-ink dark:text-white">
                    {sessionReceipt.primaryOutputValue}
                  </div>
                  <div className="text-2xs text-ap-muted dark:text-ap-muted-dark truncate">
                    {sessionReceipt.secondaryOutputValue}
                  </div>
                </div>

                <div className="py-1.5 sm:py-0 sm:px-3">
                  <div className="flex items-center justify-between text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    <span>Efficiency (EF)</span>
                    <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-ap-ink dark:text-white">
                    {sessionReceipt.efValue !== null
                      ? sessionReceipt.efValue.toFixed(2)
                      : '—'}
                  </div>
                  <div
                    className={`text-2xs font-semibold ${
                      sessionReceipt.efDeltaPct !== null &&
                      sessionReceipt.efDeltaPct >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-ap-muted dark:text-ap-muted-dark'
                    }`}
                  >
                    {sessionReceipt.efDeltaPct !== null
                      ? `${sessionReceipt.efDeltaPct >= 0 ? `+${sessionReceipt.efDeltaPct}%` : `${sessionReceipt.efDeltaPct}%`} vs 28d avg`
                      : 'Sport EF logged'}
                  </div>
                </div>

                <div className="py-1.5 sm:py-0 sm:pl-3">
                  <div className="text-2xs font-sans text-ap-muted dark:text-ap-muted-dark">
                    Aerobic Drift
                  </div>
                  <div className="mt-0.5 text-sm font-extrabold text-ap-ink dark:text-white">
                    {sessionReceipt.decouplingPct !== null
                      ? `${sessionReceipt.decouplingPct}%`
                      : sessionReceipt.debriefReport?.wPrimeMinPct !== null &&
                          sessionReceipt.debriefReport?.wPrimeMinPct !== undefined
                        ? `${sessionReceipt.debriefReport.wPrimeMinPct}% W' floor`
                        : 'Coupled'}
                  </div>
                  <div
                    className={`text-2xs truncate ${
                      sessionReceipt.decouplingTone === 'prime'
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : sessionReceipt.decouplingTone === 'strained'
                          ? 'text-rose-700 dark:text-rose-400 font-semibold'
                          : 'text-ap-muted dark:text-ap-muted-dark'
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
              <div className="space-y-1.5 pt-1 border-t border-ap-cobalt/12 dark:border-white/10">
                {sessionReceipt.hrZones5.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
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
                    <div className="flex items-center justify-between text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
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

            {/* Deep-Link CTA to Full 1Hz Telemetry & Skyline Workbench */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                {sessionReceipt.debriefReport
                  ? sessionReceipt.debriefReport.headline
                  : formatOneHzHint(plainLanguageMode)}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={isWorkbenchExpanded}
                  onClick={onToggleWorkbench}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Customize &amp; Export</span>
                </button>
                {onSelectActivity && (
                  <button
                    type="button"
                    onClick={() => onSelectActivity(sessionReceipt.primaryActivity)}
                    className="ap-btn-pine !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Inspect 1Hz Telemetry →</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
