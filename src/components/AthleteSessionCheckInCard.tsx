import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Shield,
  Sliders,
  Zap,
} from './icons/PhosphorIcons';
import { computeCheckInStreak } from '../physiology/eveningHabitEngine';
import {
  evaluateSafetySwapFromCheckIn,
  type SafetySwapEventInput,
} from '../physiology/sessionCheckInAndDigestEngine';
import { parseStructuredTrackWorkout } from '../utils/workoutParser';
import type {
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  UnifiedActivity,
} from '../types';

export interface WatchlessCompletionInput {
  workoutName: string;
  durationMins: number;
  distanceKm: number;
  rpe: number;
  dateIso: string;
}

export function deriveWatchlessCompletionPayload(params: {
  todayPlanned?: PlannedWorkoutEvent | null;
  rpe: number;
  dateIso: string;
}): WatchlessCompletionInput {
  const { todayPlanned, rpe, dateIso } = params;
  const workoutName = todayPlanned?.name?.trim() || 'Self-Logged Session';

  let plannedMeters = 0;
  let parsedSecs = 0;
  if (todayPlanned?.trackSpec) {
    const ts = todayPlanned.trackSpec;
    const setMeters =
      ts.sets && ts.sets.length > 0
        ? ts.sets.reduce((acc, s) => acc + (s.repCount || 0) * (s.repDistanceMeters || 0), 0)
        : (ts.repCount || 0) * (ts.repDistanceMeters || 0);
    plannedMeters =
      (ts.warmupDistanceMeters || 0) + setMeters + (ts.cooldownDistanceMeters || 0);
  }
  if (todayPlanned?.workoutSyntax) {
    const nodes = parseStructuredTrackWorkout(todayPlanned.workoutSyntax);
    let syntaxMeters = 0;
    for (const node of nodes) {
      if (node.type === 'step') {
        syntaxMeters += node.step.distanceMeters || 0;
        parsedSecs += node.step.durationSecs || 0;
      } else {
        const repDist = node.steps.reduce((acc, s) => acc + (s.distanceMeters || 0), 0);
        const repDur = node.steps.reduce((acc, s) => acc + (s.durationSecs || 0), 0);
        syntaxMeters += repDist * node.repeatCount;
        parsedSecs += repDur * node.repeatCount;
      }
    }
    if (plannedMeters <= 0) plannedMeters = syntaxMeters;
  }

  const durationMins =
    todayPlanned?.plannedDurationSecs && todayPlanned.plannedDurationSecs > 0
      ? Math.max(1, Math.round(todayPlanned.plannedDurationSecs / 60))
      : parsedSecs > 0
        ? Math.max(1, Math.round(parsedSecs / 60))
        : 30;
  const distanceKm = plannedMeters > 0 ? Number((plannedMeters / 1000).toFixed(2)) : 0;

  return {
    workoutName,
    durationMins,
    distanceKm,
    rpe,
    dateIso,
  };
}

export interface AthleteSessionCheckInCardProps {
  todayIso: string;
  activities?: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  sessionCheckIns: SessionCheckInRecord[];
  onRecordCheckIn: (
    input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
  onLogWatchlessCompletion?: (input: WatchlessCompletionInput) => Promise<void> | void;
}

const RPE_PRESETS: Array<{ rpe: number; label: string; hint: string }> = [
  { rpe: 3, label: 'Easy', hint: 'RPE 3' },
  { rpe: 5, label: 'Moderate', hint: 'RPE 5' },
  { rpe: 7, label: 'Hard', hint: 'RPE 7' },
  { rpe: 9, label: 'All-Out', hint: 'RPE 9' },
];

const PAIN_AREAS: Array<{
  id: NonNullable<SessionCheckInRecord['painArea']>;
  label: string;
}> = [
  { id: 'SHIN', label: 'Shin' },
  { id: 'ACHILLES', label: 'Achilles / Calf' },
  { id: 'KNEE', label: 'Knee' },
  { id: 'HAMSTRING', label: 'Hamstring' },
  { id: 'QUAD', label: 'Quad' },
  { id: 'GROIN', label: 'Groin' },
  { id: 'ANKLE', label: 'Ankle' },
  { id: 'SHOULDER', label: 'Shoulder' },
  { id: 'ELBOW', label: 'Elbow' },
  { id: 'FOOT', label: 'Foot' },
  { id: 'HIP', label: 'Hip' },
  { id: 'BACK', label: 'Back' },
  { id: 'OTHER', label: 'Other' },
];

export const AthleteSessionCheckInCard: React.FC<AthleteSessionCheckInCardProps> = ({
  todayIso,
  activities = [],
  plannedEvents,
  sessionCheckIns,
  onRecordCheckIn,
  onLogWatchlessCompletion,
}) => {
  const existingToday = useMemo(
    () => sessionCheckIns.find((c) => (c.date || '').slice(0, 10) === todayIso) || null,
    [sessionCheckIns, todayIso]
  );
  const hasSyncedToday = useMemo(
    () => activities.some((a) => (a.startDateLocal || '').slice(0, 10) === todayIso),
    [activities, todayIso]
  );
  const streakDays = useMemo(
    () => computeCheckInStreak(sessionCheckIns, todayIso),
    [sessionCheckIns, todayIso]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [selectedRpe, setSelectedRpe] = useState<number>(existingToday?.rpe ?? 5);
  const [painDrawerOpen, setPainDrawerOpen] = useState<boolean>(
    Boolean(existingToday?.painFlag)
  );
  const [painArea, setPainArea] = useState<NonNullable<SessionCheckInRecord['painArea']>>(
    existingToday?.painArea || 'SHIN'
  );
  const [sorenessNote, setSorenessNote] = useState<string>(existingToday?.sorenessNote || '');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSwapFeedback, setLastSwapFeedback] = useState<string | null>(null);
  const [justLoggedWatchless, setJustLoggedWatchless] = useState<boolean>(false);

  const todayPlanned = useMemo(
    () => plannedEvents.find((ev) => (ev.date || '').slice(0, 10) === todayIso) || null,
    [plannedEvents, todayIso]
  );

  const swapEval = useMemo(
    () =>
      evaluateSafetySwapFromCheckIn({
        checkIn: {
          date: todayIso,
          rpe: selectedRpe,
          painFlag: painDrawerOpen,
          painArea: painDrawerOpen ? painArea : undefined,
          sorenessNote: sorenessNote.trim() || undefined,
        },
        upcomingEvents: plannedEvents,
        todayIso,
      }),
    [todayIso, selectedRpe, painDrawerOpen, painArea, sorenessNote, plannedEvents]
  );

  const submitCheckIn = async (opts: {
    painFlag: boolean;
    applySwap: boolean;
    logWatchless?: boolean;
  }) => {
    setIsSaving(true);
    try {
      const swapInput = opts.applySwap ? swapEval.replacementEventInput : null;
      if (opts.logWatchless && onLogWatchlessCompletion && !hasSyncedToday) {
        await onLogWatchlessCompletion(
          deriveWatchlessCompletionPayload({
            todayPlanned,
            rpe: selectedRpe,
            dateIso: todayIso,
          })
        );
        setJustLoggedWatchless(true);
      } else {
        setJustLoggedWatchless(false);
      }
      await onRecordCheckIn(
        {
          date: todayIso,
          plannedEventId: todayPlanned?.id,
          workoutName: todayPlanned?.name || 'Daily Session',
          rpe: selectedRpe,
          painFlag: opts.painFlag,
          ...(opts.painFlag ? { painArea } : {}),
          ...(opts.painFlag && sorenessNote.trim()
            ? { sorenessNote: sorenessNote.trim() }
            : {}),
          autoSwappedToRecovery: Boolean(swapInput),
        },
        swapInput
      );
      setLastSwapFeedback(
        swapInput
          ? `Swapped "${swapEval.targetEvent?.name || 'upcoming workout'}" to low-impact recovery.`
          : null
      );
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (existingToday && !isEditing) {
    return (
      <section
        data-testid="athlete-session-checkin-card"
        className="rounded-2xl liquid-glass px-4 py-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div
          data-testid="checkin-logged-summary"
          className="flex flex-wrap items-center gap-2.5 min-w-0 text-xs"
        >
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-2xs font-bold uppercase ${
              existingToday.painFlag
                ? 'ap-status-strained'
                : existingToday.rpe >= 9
                  ? 'ap-status-caution'
                  : 'ap-status-prime'
            }`}
          >
            {existingToday.painFlag
              ? `Pain · ${existingToday.painArea || 'Flagged'}`
              : `RPE ${existingToday.rpe}/10`}
          </span>
          {justLoggedWatchless && (
            <span className="px-2 py-0.5 rounded-md font-mono text-2xs font-bold ap-status-info">
              Self-Logged
            </span>
          )}
          <span className="font-semibold text-slate-900 dark:text-white">
            Today&apos;s Check-In Logged
          </span>
          <span className="text-slate-600 dark:text-slate-300 truncate">
            {existingToday.autoSwappedToRecovery
              ? lastSwapFeedback || 'Safety Swap active — upcoming high-impact session converted to recovery.'
              : `${existingToday.workoutName || 'Session'} · Shared cleanly with your coach digest.`}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedRpe(existingToday.rpe);
            setPainDrawerOpen(Boolean(existingToday.painFlag));
            if (existingToday.painArea) setPainArea(existingToday.painArea);
            setSorenessNote(existingToday.sorenessNote || '');
            setIsEditing(true);
          }}
          className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold shrink-0 cursor-pointer"
        >
          Update Check-In
        </button>
      </section>
    );
  }

  const showSafetyPanel = painDrawerOpen || selectedRpe >= 9;

  return (
    <section
      data-testid="athlete-session-checkin-card"
      className="rounded-2xl liquid-glass p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            2-Tap Post-Session Check-In
          </h2>
          {streakDays > 0 && (
            <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs bg-amber-500/15 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
              <Flame className="w-3 h-3" />
              <span>{streakDays}d streak</span>
            </span>
          )}
          {todayPlanned && (
            <span className="hidden sm:inline text-2xs font-mono text-slate-600 dark:text-slate-400">
              · {todayPlanned.name}
            </span>
          )}
        </div>
        <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
          Updates coach execution digest &amp; impact guardrails
        </span>
      </div>

      {/* Tap 1: Effort RPE + Tap 2: Clear or Pain Toggle */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Select session effort RPE"
          className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 flex-1"
        >
          {RPE_PRESETS.map((preset) => {
            const active = selectedRpe === preset.rpe;
            return (
              <button
                key={preset.rpe}
                type="button"
                data-testid={`checkin-rpe-${preset.rpe}`}
                aria-pressed={active}
                onClick={() => setSelectedRpe(preset.rpe)}
                className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                  active
                    ? 'ap-nav-volt-active'
                    : 'ap-card-inset text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                <span>{preset.label}</span>
                <span className="font-mono text-2xs opacity-80">{preset.hint}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="checkin-toggle-pain"
            aria-pressed={painDrawerOpen}
            onClick={() => setPainDrawerOpen((prev) => !prev)}
            className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              painDrawerOpen
                ? 'ap-status-strained border border-rose-500/40'
                : 'ap-btn-secondary'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{painDrawerOpen ? 'Pain Flagged' : 'Flag Pain / Tightness'}</span>
          </button>

          {!painDrawerOpen && (
            <>
              {!hasSyncedToday && (
                <button
                  type="button"
                  data-testid="watchless-did-workout-btn"
                  disabled={isSaving}
                  onClick={() =>
                    void submitCheckIn({
                      painFlag: false,
                      applySwap: false,
                      logWatchless: true,
                    })
                  }
                  className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-ap-frame/30 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon text-xs font-bold text-ap-ink dark:text-ap-chalk hover:brightness-95 cursor-pointer disabled:opacity-50"
                >
                  I Did Today&apos;s Workout ✓
                </button>
              )}
              <button
                type="button"
                data-testid="checkin-submit-clear"
                disabled={isSaving}
                onClick={() => void submitCheckIn({ painFlag: false, applySwap: false })}
                className="min-h-[44px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span>{isSaving ? 'Saving...' : 'Feeling Good · Log'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conditional Safe-Sport Body-Area Picker & Auto Safety Swap Drawer */}
      {showSafetyPanel && (
        <div className="rounded-xl ap-card-inset p-3.5 space-y-3">
          {painDrawerOpen && (
            <div className="space-y-2">
              <div className="text-2xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Pinpoint Tightness / Pain Area (Coach Safety Signal)
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {PAIN_AREAS.map((area) => {
                  const selected = painArea === area.id;
                  return (
                    <button
                      key={area.id}
                      type="button"
                      data-testid={`checkin-pain-${area.id}`}
                      aria-pressed={selected}
                      onClick={() => setPainArea(area.id)}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                        selected
                          ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian'
                          : 'bg-white dark:bg-ap-carbon border border-stone-200 dark:border-ap-edge text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {area.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                maxLength={120}
                value={sorenessNote}
                onChange={(e) => setSorenessNote(e.target.value)}
                placeholder="Optional note (e.g., tight left shin on track turns)"
                aria-label="Optional soreness note"
                className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs text-slate-900 dark:text-white"
              />
            </div>
          )}

          <div
            data-testid="checkin-safety-swap-preview"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-stone-200/80 dark:border-white/10"
          >
            <div className="flex items-start gap-2 text-xs min-w-0">
              <Shield className="w-4 h-4 ap-text-brand shrink-0 mt-0.5" weight="duotone" />
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                  <span>
                    {swapEval.shouldSwap && swapEval.targetEvent
                      ? `Auto Safety Swap Ready (${swapEval.targetEvent.date.slice(0, 10)})`
                      : 'Coach Safety Flag Ready'}
                  </span>
                  {swapEval.shouldSwap && swapEval.replacementEventInput && (
                    <span className="px-1.5 py-0.5 rounded font-mono text-2xs ap-status-prime">
                      Run → Z2
                    </span>
                  )}
                </div>
                <div className="text-2xs text-slate-600 dark:text-slate-300">
                  {swapEval.shouldSwap && swapEval.replacementEventInput
                    ? `Converts "${swapEval.targetEvent?.name}" into ${swapEval.replacementEventInput.name} (~${swapEval.replacementEventInput.plannedLoad} TSS).`
                    : 'Logs check-in and flags elevated soreness/strain in Coach Execution Digest.'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {swapEval.shouldSwap && swapEval.replacementEventInput && (
                <button
                  type="button"
                  data-testid="checkin-submit-no-swap"
                  disabled={isSaving}
                  onClick={() => void submitCheckIn({ painFlag: painDrawerOpen, applySwap: false })}
                  className="min-h-[44px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Keep Original Plan</span>
                </button>
              )}
              <button
                type="button"
                data-testid="checkin-submit-pain-swap"
                disabled={isSaving}
                onClick={() =>
                  void submitCheckIn({
                    painFlag: painDrawerOpen,
                    applySwap: Boolean(swapEval.replacementEventInput),
                  })
                }
                className="min-h-[44px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSaving
                  ? 'Saving...'
                  : swapEval.shouldSwap && swapEval.replacementEventInput
                    ? 'Log & Swap to Low-Impact'
                    : 'Save Pain Flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
