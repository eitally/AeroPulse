import type {
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types.ts';
import { getLocalDateIso, shiftIsoDate } from './stravaLoadCalibration.ts';
import {
  evaluateSafetySwapFromCheckIn,
  type SafetySwapEvaluation,
} from './sessionCheckInAndDigestEngine.ts';
import {
  formatSessionLogisticsLine,
  sortPlannedEventsChronologically,
} from '../utils/workoutScheduleUtils.ts';

export type CircadianHeroMode = 'MORNING' | 'POST_SESSION' | 'TONIGHT';

export interface TodayTrainingReceipt {
  todayIso: string;
  sessionCount: number;
  totalLoadTss: number;
  totalDurationMins: number;
  totalDistanceKm: number;
  headline: string;
  plannedName?: string;
  plannedCount: number;
  plannedNames: string[];
}

export interface OvernightRecoveryPrescription {
  sleepTargetHours: number;
  hydrationLitersLabel: string;
  fuelFocusLabel: string;
  tomorrowHeadline: string;
}

export interface TomorrowLockInSummary {
  tomorrowIso: string;
  plannedEvent: PlannedWorkoutEvent | null;
  tomorrowEvents: PlannedWorkoutEvent[];
  swapEvaluation: SafetySwapEvaluation;
  statusLabel: string;
  actionSummary: string;
}

/**
 * Resolves the circadian workspace mode based on local hour and whether a workout
 * has already synced today (`19:00–03:59` -> Tonight Closeout; else Post-Session or Morning Brief).
 */
export function resolveCircadianHeroMode(params: {
  localHour?: number;
  hasCompletedToday: boolean;
}): CircadianHeroMode {
  const hour =
    typeof params.localHour === 'number' && Number.isFinite(params.localHour)
      ? params.localHour
      : new Date().getHours();
  if (hour >= 19 || hour < 4) return 'TONIGHT';
  return params.hasCompletedToday ? 'POST_SESSION' : 'MORNING';
}

export function evaluateTodayTrainingReceipt(params: {
  todayIso?: string;
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
}): TodayTrainingReceipt {
  const todayIso = (params.todayIso || getLocalDateIso()).slice(0, 10);
  const todayActs = (params.activities || []).filter(
    (a) => (a.startDateLocal || '').slice(0, 10) === todayIso
  );
  const todayPlans = sortPlannedEventsChronologically(
    (params.plannedEvents || []).filter(
      (p) => (p.date || '').slice(0, 10) === todayIso
    )
  );
  const todayPlan = todayPlans[0];

  const totalLoadTss = Math.round(
    todayActs.reduce((sum, a) => sum + (a.trainingLoad || 0), 0)
  );
  const totalDurationMins = Math.round(
    todayActs.reduce((sum, a) => sum + (a.movingTimeSecs || 0) / 60, 0)
  );
  const totalDistanceKm = Number(
    (todayActs.reduce((sum, a) => sum + (a.distanceMeters || 0), 0) / 1000).toFixed(1)
  );

  let headline = 'Rest or recovery day banked';
  if (todayActs.length === 1) {
    headline =
      todayPlans.length > 1
        ? `${todayActs[0].name} (1 of ${todayPlans.length} planned · ${totalLoadTss} TSS)`
        : `${todayActs[0].name} · ${totalLoadTss} TSS`;
  } else if (todayActs.length > 1) {
    headline = `${todayActs.length} sessions completed · ${totalLoadTss} TSS`;
  } else if (todayPlans.length > 1) {
    headline = `Planned double: ${todayPlans.map((p) => p.name).join(' + ')} (unlogged)`;
  } else if (todayPlan) {
    headline = `Planned: ${todayPlan.name} (unlogged)`;
  }

  return {
    todayIso,
    sessionCount: todayActs.length,
    totalLoadTss,
    totalDurationMins,
    totalDistanceKm,
    headline,
    plannedName: todayPlan?.name,
    plannedCount: todayPlans.length,
    plannedNames: todayPlans.map((p) => p.name),
  };
}

/**
 * Generates an overnight sleep + recovery nutrition guidance card that strictly avoids
 * body-weight multipliers or gram/kg formulas when `safeSportHideWeight` is enabled.
 */
export function computeOvernightRecoveryPrescription(params: {
  todayLoadTss: number;
  latestWellness?: UnifiedWellnessDay | null;
  safeSportHideWeight?: boolean;
  tomorrowEvent?: PlannedWorkoutEvent | null;
  tomorrowEvents?: PlannedWorkoutEvent[];
  rpe?: number;
  legFeel?: 'FRESH' | 'NORMAL' | 'HEAVY';
  lifeStressFlag?: boolean;
}): OvernightRecoveryPrescription {
  const {
    todayLoadTss,
    latestWellness,
    safeSportHideWeight = false,
    tomorrowEvent,
    tomorrowEvents,
    rpe = 5,
    legFeel = 'NORMAL',
    lifeStressFlag = false,
  } = params;

  const list =
    tomorrowEvents && tomorrowEvents.length > 0
      ? tomorrowEvents
      : tomorrowEvent
        ? [tomorrowEvent]
        : [];
  const primaryTomorrow = list[0] || null;
  const combinedTomorrowLoad = list.reduce((sum, e) => sum + (e.plannedLoad || 0), 0);

  let baseSleep = 8.0;
  if (todayLoadTss >= 95 || rpe >= 8 || legFeel === 'HEAVY') baseSleep += 0.75;
  if (lifeStressFlag) baseSleep += 0.5;
  if (latestWellness && latestWellness.sleepSecs > 0 && latestWellness.sleepSecs < 25200) {
    baseSleep += 0.5;
  }
  const sleepTargetHours = Number(Math.min(9.5, Math.max(7.5, baseSleep)).toFixed(1));

  const isHardTomorrow = list.some(
    (ev) =>
      (ev.plannedLoad || 0) >= 70 ||
      /threshold|interval|tempo|track|vo2|race|long/i.test(ev.name || '')
  );

  const hydrationLitersLabel =
    todayLoadTss >= 80
      ? 'Rehydrate steadily with electrolytes before bed'
      : 'Light fluids & tart cherry / herbal wind-down';

  const fuelFocusLabel = safeSportHideWeight
    ? isHardTomorrow
      ? 'Evening grain/pasta bowl + morning carb top-off for key session'
      : 'Balanced colorful dinner + protein-rich evening snack'
    : isHardTomorrow
      ? 'Glycogen reload tonight + complex carbs tomorrow morning'
      : 'Standard balanced recovery plate + casein/protein before sleep';

  const formatOneTomorrow = (ev: PlannedWorkoutEvent) => {
    const logi = formatSessionLogisticsLine(ev);
    return logi
      ? `${ev.name} (~${ev.plannedLoad} TSS · ${logi})`
      : `${ev.name} (~${ev.plannedLoad} TSS)`;
  };

  const tomorrowHeadline =
    list.length > 1
      ? `Double Day (${combinedTomorrowLoad} TSS): ${list.map(formatOneTomorrow).join(' + ')}`
      : primaryTomorrow
        ? formatOneTomorrow(primaryTomorrow)
        : 'Open schedule — ready for active recovery or base aerobic';

  return {
    sleepTargetHours,
    hydrationLitersLabel,
    fuelFocusLabel,
    tomorrowHeadline,
  };
}

/**
 * Computes consecutive daily check-in streak ending on `todayIso` (or `todayIso - 1` if today
 * has not been logged yet so streaks remain visible during the evening prompt).
 */
export function computeCheckInStreak(
  sessionCheckIns: SessionCheckInRecord[],
  todayIso: string = getLocalDateIso()
): number {
  const uniqueDates = new Set(
    (sessionCheckIns || []).map((c) => (c.date || '').slice(0, 10)).filter(Boolean)
  );
  if (uniqueDates.size === 0) return 0;

  let cursor = uniqueDates.has(todayIso) ? todayIso : shiftIsoDate(todayIso, -1);
  if (!uniqueDates.has(cursor)) return 0;

  let streak = 0;
  while (uniqueDates.has(cursor) && streak < 365) {
    streak += 1;
    cursor = shiftIsoDate(cursor, -1);
  }
  return streak;
}

export function evaluateTomorrowLockIn(params: {
  todayIso?: string;
  plannedEvents: PlannedWorkoutEvent[];
  rpe: number;
  painFlag: boolean;
  painArea?: SessionCheckInRecord['painArea'];
  lifeStressFlag?: boolean;
  legFeel?: 'FRESH' | 'NORMAL' | 'HEAVY';
}): TomorrowLockInSummary {
  const todayIso = (params.todayIso || getLocalDateIso()).slice(0, 10);
  const tomorrowIso = shiftIsoDate(todayIso, 1);

  const tomorrowEvents = sortPlannedEventsChronologically(
    (params.plannedEvents || []).filter(
      (p) => (p.date || '').slice(0, 10) === tomorrowIso
    )
  );
  const tomorrowEvent = tomorrowEvents[0] || null;

  const swapEvaluation = evaluateSafetySwapFromCheckIn({
    checkIn: {
      date: todayIso,
      rpe: params.painFlag || params.lifeStressFlag ? Math.max(params.rpe, 9) : params.rpe,
      painFlag: params.painFlag || Boolean(params.lifeStressFlag && params.legFeel === 'HEAVY'),
      painArea: params.painArea,
    },
    upcomingEvents: params.plannedEvents,
    todayIso,
  });

  if (swapEvaluation.shouldSwap && swapEvaluation.replacementEventInput) {
    return {
      tomorrowIso,
      plannedEvent: swapEvaluation.targetEvent || tomorrowEvent,
      tomorrowEvents,
      swapEvaluation,
      statusLabel: 'Auto-Morph Armed',
      actionSummary: `Swapping ${swapEvaluation.targetEvent?.name || 'tomorrow'} to ${swapEvaluation.replacementEventInput.name}`,
    };
  }

  return {
    tomorrowIso,
    plannedEvent: tomorrowEvent,
    tomorrowEvents,
    swapEvaluation,
    statusLabel: tomorrowEvent ? 'Locked As Planned' : 'Open Day',
    actionSummary:
      tomorrowEvents.length > 1
        ? `Double Day (${tomorrowEvents.map((e) => e.name).join(' + ')}) confirmed for ${tomorrowIso}`
        : tomorrowEvent
          ? `${tomorrowEvent.name}${formatSessionLogisticsLine(tomorrowEvent) ? ` (${formatSessionLogisticsLine(tomorrowEvent)})` : ''} confirmed for ${tomorrowIso}`
          : `No structured workout scheduled for ${tomorrowIso}`,
  };
}

/**
 * Surfaces last night's closeout context on the athlete's 6:00 AM Morning Brief.
 */
export function findMorningContinuityFromLastNight(
  sessionCheckIns: SessionCheckInRecord[],
  todayIso: string = getLocalDateIso()
): SessionCheckInRecord | null {
  const yesterdayIso = shiftIsoDate(todayIso.slice(0, 10), -1);
  const candidates = (sessionCheckIns || [])
    .filter((c) => {
      const d = (c.date || '').slice(0, 10);
      return d === yesterdayIso || (d === todayIso.slice(0, 10) && c.ritualSlot === 'TONIGHT');
    })
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return candidates[0] || null;
}
