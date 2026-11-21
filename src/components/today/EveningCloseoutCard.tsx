import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Download,
  Flame,
  Moon,
  Shield,
  Sliders,
} from '../icons/PhosphorIcons';
import {
  computeCheckInStreak,
  computeOvernightRecoveryPrescription,
  evaluateTodayTrainingReceipt,
  evaluateTomorrowLockIn,
} from '../../physiology/eveningHabitEngine';
import {
  checkAndFireBedtimeReminder,
  downloadBedtimeReminderIcs,
  getBedtimeNotificationPermission,
  loadBedtimeReminderPrefs,
  requestBedtimeNotificationPermission,
  saveBedtimeReminderPrefs,
  type BedtimeReminderPrefs,
} from '../../utils/bedtimeReminderEngine';
import { formatPracticeTime12h } from '../../utils/workoutScheduleUtils';
import type { SafetySwapEventInput } from '../../physiology/sessionCheckInAndDigestEngine';
import type {
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';

export interface EveningCloseoutCardProps {
  todayIso?: string;
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  latestWellness?: UnifiedWellnessDay | null;
  safeSportHideWeight?: boolean;
  sessionCheckIns: SessionCheckInRecord[];
  onRecordCheckIn: (
    checkInInput: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
  isDuskMode: boolean;
  onToggleDuskMode: () => void;
}

const RPE_PRESETS: Array<{ rpe: number; label: string; hint: string }> = [
  { rpe: 3, label: 'Easy', hint: 'RPE 3' },
  { rpe: 5, label: 'Moderate', hint: 'RPE 5' },
  { rpe: 7, label: 'Hard', hint: 'RPE 7' },
  { rpe: 9, label: 'All-Out', hint: 'RPE 9' },
];

const LEG_FEEL_OPTIONS: Array<{
  id: 'FRESH' | 'NORMAL' | 'HEAVY';
  label: string;
}> = [
  { id: 'FRESH', label: 'Fresh' },
  { id: 'NORMAL', label: 'Normal' },
  { id: 'HEAVY', label: 'Heavy' },
];

const PAIN_AREAS: Array<{
  id: NonNullable<SessionCheckInRecord['painArea']>;
  label: string;
}> = [
  { id: 'SHIN', label: 'Shin' },
  { id: 'ACHILLES', label: 'Achilles' },
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
];

export const EveningCloseoutCard: React.FC<EveningCloseoutCardProps> = ({
  todayIso: propTodayIso,
  activities,
  plannedEvents,
  latestWellness,
  safeSportHideWeight = false,
  sessionCheckIns,
  onRecordCheckIn,
  isDuskMode,
  onToggleDuskMode,
}) => {
  const todayIso = useMemo(
    () => (propTodayIso || getLocalDateIso()).slice(0, 10),
    [propTodayIso]
  );

  const existingToday = useMemo(
    () => sessionCheckIns.find((c) => (c.date || '').slice(0, 10) === todayIso) || null,
    [sessionCheckIns, todayIso]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [selectedRpe, setSelectedRpe] = useState<number>(existingToday?.rpe ?? 5);
  const [legFeel, setLegFeel] = useState<'FRESH' | 'NORMAL' | 'HEAVY'>(
    existingToday?.legFeel ?? 'NORMAL'
  );
  const [lifeStressFlag, setLifeStressFlag] = useState<boolean>(
    Boolean(existingToday?.lifeStressFlag)
  );
  const [painDrawerOpen, setPainDrawerOpen] = useState<boolean>(
    Boolean(existingToday?.painFlag)
  );
  const [painArea, setPainArea] = useState<NonNullable<SessionCheckInRecord['painArea']>>(
    existingToday?.painArea || 'SHIN'
  );
  const [sorenessNote, setSorenessNote] = useState<string>(existingToday?.sorenessNote || '');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSwapFeedback, setLastSwapFeedback] = useState<string | null>(null);
  const [reminderPrefs, setReminderPrefs] = useState<BedtimeReminderPrefs>(() =>
    loadBedtimeReminderPrefs()
  );
  const [reminderStatus, setReminderStatus] = useState<string | null>(null);

  const todayReceipt = useMemo(
    () => evaluateTodayTrainingReceipt({ todayIso, activities, plannedEvents }),
    [todayIso, activities, plannedEvents]
  );

  const lockIn = useMemo(
    () =>
      evaluateTomorrowLockIn({
        todayIso,
        plannedEvents,
        rpe: selectedRpe,
        painFlag: painDrawerOpen,
        painArea,
        lifeStressFlag,
        legFeel,
      }),
    [todayIso, plannedEvents, selectedRpe, painDrawerOpen, painArea, lifeStressFlag, legFeel]
  );

  const overnightRx = useMemo(
    () =>
      computeOvernightRecoveryPrescription({
        todayLoadTss: todayReceipt.totalLoadTss,
        latestWellness,
        safeSportHideWeight,
        tomorrowEvent: lockIn.plannedEvent,
        tomorrowEvents: lockIn.tomorrowEvents,
        rpe: selectedRpe,
        legFeel,
        lifeStressFlag,
      }),
    [
      todayReceipt.totalLoadTss,
      latestWellness,
      safeSportHideWeight,
      lockIn.plannedEvent,
      lockIn.tomorrowEvents,
      selectedRpe,
      legFeel,
      lifeStressFlag,
    ]
  );

  useEffect(() => {
    if (!reminderPrefs.enabled || existingToday) return;
    const run = () => {
      checkAndFireBedtimeReminder({
        prefs: reminderPrefs,
        todayIso,
        hasLoggedToday: Boolean(existingToday),
        tomorrowSummary: overnightRx.tomorrowHeadline,
      });
    };
    run();
    const id = window.setInterval(run, 60_000);
    return () => window.clearInterval(id);
  }, [reminderPrefs, todayIso, existingToday, overnightRx.tomorrowHeadline]);

  const handleToggleBedtimeReminder = async () => {
    if (reminderPrefs.enabled) {
      const next = saveBedtimeReminderPrefs({ ...reminderPrefs, enabled: false });
      setReminderPrefs(next);
      setReminderStatus('Bedtime alert paused.');
      return;
    }
    const perm = await requestBedtimeNotificationPermission();
    const next = saveBedtimeReminderPrefs({ ...reminderPrefs, enabled: true });
    setReminderPrefs(next);
    if (perm === 'granted') {
      setReminderStatus(`Alert armed for ${formatPracticeTime12h(next.timeHhMm) || '9:15 PM'}.`);
    } else if (perm === 'denied') {
      setReminderStatus('Browser notifications blocked — use Calendar (.ics) alarm.');
    } else {
      setReminderStatus(`Saved for ${formatPracticeTime12h(next.timeHhMm) || '9:15 PM'} (add .ics alarm for lock-screen alert).`);
    }
  };

  const streakDays = useMemo(
    () => computeCheckInStreak(sessionCheckIns, todayIso),
    [sessionCheckIns, todayIso]
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const targetEv = lockIn.plannedEvent;
      await onRecordCheckIn(
        {
          date: todayIso,
          ...(targetEv ? { plannedEventId: targetEv.id, workoutName: targetEv.name } : {}),
          rpe: selectedRpe,
          painFlag: painDrawerOpen,
          ...(painDrawerOpen ? { painArea } : {}),
          ...(sorenessNote.trim() ? { sorenessNote: sorenessNote.trim() } : {}),
          ...(lockIn.swapEvaluation.shouldSwap && lockIn.swapEvaluation.replacementEventInput
            ? { autoSwappedToRecovery: true }
            : {}),
          legFeel,
          ...(lifeStressFlag ? { lifeStressFlag: true } : {}),
          sleepTargetHours: overnightRx.sleepTargetHours,
          tomorrowLocked: true,
          ritualSlot: 'TONIGHT',
        },
        lockIn.swapEvaluation.shouldSwap ? lockIn.swapEvaluation.replacementEventInput : null
      );
      setLastSwapFeedback(
        lockIn.swapEvaluation.shouldSwap && lockIn.swapEvaluation.replacementEventInput
          ? `Tomorrow updated to ${lockIn.swapEvaluation.replacementEventInput.name}`
          : 'Day closed and tomorrow locked.'
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
        className="p-4 sm:p-5 space-y-3"
      >
        <div
          data-testid="checkin-logged-summary"
          className="rounded-xl ap-card-inset p-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
              <span className="font-bold text-slate-900 dark:text-white">
                Tonight Closeout Complete
              </span>
              <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs ap-status-prime tabular-nums">
                RPE {existingToday.rpe}/10
              </span>
              {existingToday.legFeel && (
                <span className="px-2 py-0.5 rounded-md font-mono text-2xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Legs {existingToday.legFeel}
                </span>
              )}
              {existingToday.painFlag && existingToday.painArea && (
                <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs ap-status-strained">
                  {existingToday.painArea}
                </span>
              )}
              {streakDays > 0 && (
                <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs bg-amber-500/15 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                  <Flame className="w-3 h-3" />
                  <span>{streakDays}d streak</span>
                </span>
              )}
            </div>
            <p className="text-2xs text-slate-600 dark:text-slate-300">
              {existingToday.autoSwappedToRecovery
                ? `Swapped ${existingToday.workoutName || 'next workout'} to low-impact recovery and notified your coach.`
                : lastSwapFeedback ||
                  `Sleep target ${existingToday.sleepTargetHours || overnightRx.sleepTargetHours}h · Coach digest updated.`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="toggle-circadian-dusk-btn"
              onClick={onToggleDuskMode}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Moon className="w-3.5 h-3.5" />
              <span>{isDuskMode ? 'Dusk On' : 'Circadian Dusk'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedRpe(existingToday.rpe);
                setLegFeel(existingToday.legFeel || 'NORMAL');
                setLifeStressFlag(Boolean(existingToday.lifeStressFlag));
                setPainDrawerOpen(Boolean(existingToday.painFlag));
                if (existingToday.painArea) setPainArea(existingToday.painArea);
                setSorenessNote(existingToday.sorenessNote || '');
                setIsEditing(true);
              }}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer"
            >
              Update Check-In
            </button>
          </div>
        </div>
      </section>
    );
  }

  const showSafetyPanel = painDrawerOpen || selectedRpe >= 9 || lifeStressFlag;

  return (
    <section
      data-testid="athlete-session-checkin-card"
      className="p-4 sm:p-5 space-y-4"
    >
      {/* Header Row: Title, Streak, Dusk Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Moon className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            15-Second Evening Closeout &amp; Tomorrow Lock-In
          </h2>
          {streakDays > 0 && (
            <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs bg-amber-500/15 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
              <Flame className="w-3 h-3" />
              <span>{streakDays}d streak</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="toggle-bedtime-reminder-btn"
            aria-pressed={reminderPrefs.enabled}
            onClick={() => void handleToggleBedtimeReminder()}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              reminderPrefs.enabled ? 'ap-nav-volt-active' : 'ap-btn-secondary'
            }`}
            title={
              getBedtimeNotificationPermission() === 'granted'
                ? 'Nightly browser reminder armed'
                : 'Enable nightly closeout notification'
            }
          >
            <Bell className="w-3.5 h-3.5" />
            <span>
              {reminderPrefs.enabled
                ? `Remind ${formatPracticeTime12h(reminderPrefs.timeHhMm) || '9:15 PM'}`
                : '9:15 PM Reminder'}
            </span>
          </button>

          {reminderPrefs.enabled && (
            <>
              <input
                type="time"
                aria-label="Bedtime reminder time"
                value={reminderPrefs.timeHhMm}
                onChange={(e) => {
                  const next = saveBedtimeReminderPrefs({
                    ...reminderPrefs,
                    timeHhMm: e.target.value,
                  });
                  setReminderPrefs(next);
                }}
                className="min-h-[44px] sm:min-h-[34px] rounded-xl border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-xs text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => downloadBedtimeReminderIcs(reminderPrefs.timeHhMm)}
                className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-xl ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                title="Download daily calendar alarm (.ics) for phone lock-screen reminders"
              >
                <Download className="w-3.5 h-3.5" />
                <span>.ICS Alarm</span>
              </button>
            </>
          )}

          <button
            type="button"
            data-testid="toggle-circadian-dusk-btn"
            aria-pressed={isDuskMode}
            onClick={onToggleDuskMode}
            className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              isDuskMode ? 'ap-nav-volt-active' : 'ap-btn-secondary'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>{isDuskMode ? 'Circadian Dusk On' : 'Circadian Dusk'}</span>
          </button>
        </div>
      </div>

      {reminderStatus && (
        <div className="text-2xs font-mono text-slate-600 dark:text-slate-300">
          {reminderStatus}
        </div>
      )}

      {/* 3-Column Bento Summary: Today Receipt / Overnight Rx / Tomorrow Lock-In */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div className="rounded-xl ap-card-inset p-3 space-y-1">
          <div className="text-xs font-bold text-slate-900 dark:text-white">Today&apos;s Bank</div>
          <div className="text-xs font-mono font-semibold ap-text-brand tabular-nums">
            {todayReceipt.headline}
          </div>
          <div className="text-2xs text-slate-600 dark:text-slate-300">
            {todayReceipt.totalDurationMins}m · {todayReceipt.totalDistanceKm} km
          </div>
        </div>

        <div className="rounded-xl ap-card-inset p-3 space-y-1">
          <div className="text-xs font-bold text-slate-900 dark:text-white">
            Sleep Target {overnightRx.sleepTargetHours}h
          </div>
          <div className="text-2xs text-slate-700 dark:text-slate-200">
            {overnightRx.hydrationLitersLabel}
          </div>
          <div className="text-2xs text-slate-600 dark:text-slate-300">
            {overnightRx.fuelFocusLabel}
          </div>
        </div>

        <div className="rounded-xl ap-card-inset p-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              Tomorrow ({lockIn.tomorrowIso})
            </span>
            <span className="px-2 py-0.5 rounded-md font-mono font-bold text-2xs ap-status-prime">
              {lockIn.statusLabel}
            </span>
          </div>
          <div className="text-2xs text-slate-700 dark:text-slate-200">
            {overnightRx.tomorrowHeadline}
          </div>
        </div>
      </div>

      {/* Tap 1: RPE Presets */}
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

        {/* Leg Feel + Stress + Pain Toggle */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {LEG_FEEL_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={legFeel === opt.id}
              onClick={() => setLegFeel(opt.id)}
              className={`min-h-[44px] px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                legFeel === opt.id ? 'ap-nav-volt-active' : 'ap-btn-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={lifeStressFlag}
            onClick={() => setLifeStressFlag((prev) => !prev)}
            className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              lifeStressFlag ? 'ap-status-caution' : 'ap-btn-secondary'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span>High Stress</span>
          </button>

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
            <button
              type="button"
              data-testid="checkin-submit-clear"
              disabled={isSaving}
              onClick={handleSave}
              className="min-h-[44px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {isSaving ? 'Locking…' : 'Close Day & Lock Tomorrow'}
            </button>
          )}
        </div>
      </div>

      {/* Pain / High-Strain Safety Auto-Swap Preview */}
      {showSafetyPanel && (
        <div className="rounded-xl ap-card-inset p-3.5 space-y-3">
          {painDrawerOpen && (
            <div className="space-y-2">
              <div className="text-2xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                Select localized soreness / pain area:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PAIN_AREAS.map((area) => {
                  const active = painArea === area.id;
                  return (
                    <button
                      key={area.id}
                      type="button"
                      data-testid={`checkin-pain-${area.id}`}
                      aria-pressed={active}
                      onClick={() => setPainArea(area.id)}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                        active
                          ? 'ap-status-strained font-bold'
                          : 'bg-white dark:bg-ap-carbon text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {area.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={sorenessNote}
              maxLength={140}
              onChange={(e) => setSorenessNote(e.target.value)}
              placeholder="Optional note for your morning coach digest (e.g. tight left soleus, midterms)…"
              aria-label="Optional soreness or stress note for coach"
              className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-slate-900 dark:text-white"
            />
          </div>

          {lockIn.swapEvaluation.shouldSwap && lockIn.swapEvaluation.replacementEventInput && (
            <div
              data-testid="checkin-safety-swap-preview"
              className="rounded-xl ap-status-caution p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
            >
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">
                    Orthopedic Safety Swap: {lockIn.swapEvaluation.replacementEventInput.name}
                  </div>
                  <div className="text-2xs opacity-90">
                    {lockIn.swapEvaluation.reasonLabel} → Auto-swaps{' '}
                    <strong>{lockIn.swapEvaluation.targetEvent?.name}</strong> (
                    {lockIn.swapEvaluation.targetEvent?.date}) into non-impact recovery flush and
                    notifies your coach.
                  </div>
                </div>
              </div>
              <button
                type="button"
                data-testid="checkin-submit-pain-swap"
                disabled={isSaving}
                onClick={handleSave}
                className="min-h-[44px] sm:min-h-[38px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-bold shrink-0 cursor-pointer disabled:opacity-60"
              >
                {isSaving ? 'Locking…' : 'Flag, Auto-Swap Tomorrow & Alert Coach'}
              </button>
            </div>
          )}

          {!lockIn.swapEvaluation.shouldSwap && (
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="checkin-submit-pain-swap"
                disabled={isSaving}
                onClick={handleSave}
                className="min-h-[44px] sm:min-h-[38px] px-4 py-1.5 rounded-xl ap-btn-primary text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isSaving ? 'Locking…' : 'Close Day & Notify Coach'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
