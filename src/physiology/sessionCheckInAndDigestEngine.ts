import type {
  CoachEventGroup,
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  SportCategory,
  TrackWorkoutSpec,
  UnifiedActivity,
} from '../types';

export interface SafetySwapEventInput {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  replaceExistingDate: boolean;
}

export interface SafetySwapEvaluation {
  shouldSwap: boolean;
  reasonLabel: string;
  targetEvent: PlannedWorkoutEvent | null;
  replacementEventInput: SafetySwapEventInput | null;
}

function addDaysIso(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function isAlreadyRecoverySwap(ev: PlannedWorkoutEvent): boolean {
  return /safety swap|low-impact|recovery flush|rpe guardrail/i.test(
    `${ev.name || ''} ${ev.description || ''}`
  );
}

function isHighImpactOrHardEvent(ev: PlannedWorkoutEvent): boolean {
  if (isAlreadyRecoverySwap(ev)) return false;
  if ((ev.plannedLoad || 0) >= 70) return true;
  if (ev.trackSpec) return true;
  return /\b(?:vo2|threshold|interval|intervals|sprint|race|tempo|rep|fartlek|sub-t|cv)\b/i.test(
    `${ev.name || ''} ${ev.workoutSyntax || ''}`
  );
}

/**
 * Evaluates whether a logged athlete check-in (pain flag or high RPE >= 9) warrants an
 * automatic low-impact recovery swap on the next key workout within a 48-hour window.
 */
export function evaluateSafetySwapFromCheckIn(opts: {
  checkIn: Pick<SessionCheckInRecord, 'date' | 'rpe' | 'painFlag' | 'painArea' | 'sorenessNote'>;
  upcomingEvents: PlannedWorkoutEvent[];
  todayIso: string;
}): SafetySwapEvaluation {
  const { checkIn, upcomingEvents, todayIso } = opts;
  const triggeredByPain = Boolean(checkIn.painFlag);
  const triggeredByHighRpe = (checkIn.rpe || 0) >= 9;

  if (!triggeredByPain && !triggeredByHighRpe) {
    return {
      shouldSwap: false,
      reasonLabel: '',
      targetEvent: null,
      replacementEventInput: null,
    };
  }

  const maxWindowIso = addDaysIso(todayIso, 2);
  const candidates = (upcomingEvents || [])
    .filter((ev) => {
      const d = (ev.date || '').slice(0, 10);
      return d >= todayIso && d <= maxWindowIso && isHighImpactOrHardEvent(ev);
    })
    .sort((a, b) => {
      const da = (a.date || '').slice(0, 10);
      const db = (b.date || '').slice(0, 10);
      // Prefer next day first when checking in today, else earliest upcoming session
      if (checkIn.date.slice(0, 10) === todayIso) {
        const aTomorrow = da > todayIso ? 0 : 1;
        const bTomorrow = db > todayIso ? 0 : 1;
        if (aTomorrow !== bTomorrow) return aTomorrow - bTomorrow;
      }
      return da.localeCompare(db);
    });

  const targetEvent = candidates[0] || null;
  if (!targetEvent) {
    return {
      shouldSwap: false,
      reasonLabel: triggeredByPain
        ? `Pain flagged (${checkIn.painArea || 'Soreness'}) — monitor next run`
        : `High strain logged (RPE ${checkIn.rpe}/10)`,
      targetEvent: null,
      replacementEventInput: null,
    };
  }

  const areaLabel = checkIn.painArea || 'Lower-Leg / Joint';
  const reasonLabel = triggeredByPain
    ? `${areaLabel} soreness flagged — swapped "${targetEvent.name}" to low-impact recovery`
    : `RPE ${checkIn.rpe}/10 strain — swapped "${targetEvent.name}" to Z1 recovery`;

  const sportCategory: SportCategory =
    targetEvent.sportCategory === 'Cycling' ? 'Cycling' : 'Running';

  const replacementEventInput: SafetySwapEventInput = {
    date: targetEvent.date.slice(0, 10),
    name: triggeredByPain
      ? 'Low-Impact Recovery Flush (Safety Swap)'
      : 'Z1 Recovery Spin / Mobility (RPE Guardrail)',
    sportCategory,
    environmentPreference: 'INDOOR',
    plannedDurationSecs: 2400,
    plannedLoad: Math.max(18, Math.min(32, Math.round((targetEvent.plannedLoad || 65) * 0.45))),
    workoutSyntax:
      '- 10m 55% Effort Easy Warmup\n- 20m 62% Effort Low-Impact Z1 Spin or Pool Jog\n- 10m 50% Effort Mobility Cooldown',
    description: triggeredByPain
      ? `Safe-Sport Auto Swap: replaced "${targetEvent.name}" following ${areaLabel} soreness check-in.${checkIn.sorenessNote ? ` Note: ${checkIn.sorenessNote}` : ''}`
      : `Load Guardrail Auto Swap: replaced "${targetEvent.name}" following RPE ${checkIn.rpe}/10 session strain.`,
    replaceExistingDate: true,
  };

  return {
    shouldSwap: true,
    reasonLabel,
    targetEvent,
    replacementEventInput,
  };
}

export type DigestAttentionReason =
  | 'PAIN_FLAG'
  | 'HIGH_RPE_STRAIN'
  | 'MISSED_KEY_SESSIONS'
  | 'ON_TRACK';

export interface CoachDigestAthleteRow {
  athleteId: string;
  name: string;
  eventGroup?: CoachEventGroup;
  plannedCount7d: number;
  completedCount7d: number;
  compliancePct: number;
  latestCheckIn: SessionCheckInRecord | null;
  checkedInToday: boolean;
  avgRpe7d: number | null;
  attentionReason: DigestAttentionReason;
  attentionSummary: string;
  isSelfFallback?: boolean;
}

export interface CoachSquadExecutionDigest {
  windowStartIso: string;
  windowEndIso: string;
  totalAthletes: number;
  checkedInTodayCount: number;
  painFlagCount: number;
  swappedCount: number;
  highRpeCount: number;
  teamCompliancePct: number;
  rows: CoachDigestAthleteRow[];
}

export interface DigestFallbackAthleteInput {
  id: string;
  name: string;
  eventGroup?: CoachEventGroup;
  plannedEvents: PlannedWorkoutEvent[];
  activities: UnifiedActivity[];
  sessionCheckIns: SessionCheckInRecord[];
}

const ATTENTION_PRIORITY: Record<DigestAttentionReason, number> = {
  PAIN_FLAG: 0,
  HIGH_RPE_STRAIN: 1,
  MISSED_KEY_SESSIONS: 2,
  ON_TRACK: 3,
};

/**
 * Aggregates athlete 7-day execution compliance alongside post-session RPE/pain check-ins
 * and sorts coaching attention flags to the top for rapid squad triage.
 */
export function buildCoachSquadExecutionDigest(opts: {
  roster: ConnectedAthleteRecord[];
  selfFallback?: DigestFallbackAthleteInput | null;
  todayIso: string;
  windowDays?: number;
}): CoachSquadExecutionDigest {
  const { roster, selfFallback, todayIso, windowDays = 7 } = opts;
  const windowEndIso = todayIso.slice(0, 10);
  const windowStartIso = addDaysIso(windowEndIso, -(Math.max(1, windowDays) - 1));

  const connected = (roster || []).filter((r) => r.status === 'CONNECTED');
  const sourceList: Array<{
    id: string;
    name: string;
    eventGroup?: CoachEventGroup;
    plannedEvents: PlannedWorkoutEvent[];
    activities: UnifiedActivity[];
    sessionCheckIns: SessionCheckInRecord[];
    isSelfFallback?: boolean;
  }> =
    connected.length > 0
      ? connected.map((a) => ({
          id: a.id,
          name: a.name,
          eventGroup: a.eventGroup,
          plannedEvents: a.plannedEvents || [],
          activities: a.activities || [],
          sessionCheckIns: a.sessionCheckIns || [],
        }))
      : selfFallback
        ? [{ ...selfFallback, isSelfFallback: true }]
        : [];

  let checkedInTodayCount = 0;
  let painFlagCount = 0;
  let swappedCount = 0;
  let highRpeCount = 0;
  let complianceSum = 0;

  const rows: CoachDigestAthleteRow[] = sourceList.map((ath) => {
    const plannedCount7d = ath.plannedEvents.filter((ev) => {
      const d = (ev.date || '').slice(0, 10);
      return d >= windowStartIso && d <= windowEndIso;
    }).length;

    const completedCount7d = ath.activities.filter((act) => {
      const d = (act.startDateLocal || '').slice(0, 10);
      return d >= windowStartIso && d <= windowEndIso;
    }).length;

    const compliancePct =
      plannedCount7d > 0
        ? Math.min(100, Math.round((completedCount7d / plannedCount7d) * 100))
        : completedCount7d > 0
          ? 100
          : 100;

    const recentCheckIns = [...(ath.sessionCheckIns || [])]
      .filter((c) => {
        const d = (c.date || '').slice(0, 10);
        return d >= windowStartIso && d <= windowEndIso;
      })
      .sort((a, b) =>
        `${b.date}:${b.createdAt}`.localeCompare(`${a.date}:${a.createdAt}`)
      );

    const latestCheckIn = recentCheckIns[0] || null;
    const checkedInToday = recentCheckIns.some(
      (c) => (c.date || '').slice(0, 10) === windowEndIso
    );
    const avgRpe7d =
      recentCheckIns.length > 0
        ? Number(
            (
              recentCheckIns.reduce((sum, c) => sum + (Number(c.rpe) || 0), 0) /
              recentCheckIns.length
            ).toFixed(1)
          )
        : null;

    if (checkedInToday) checkedInTodayCount += 1;
    const hasPain = Boolean(latestCheckIn?.painFlag);
    const hasHighRpe =
      (latestCheckIn?.rpe ?? 0) >= 9 || (avgRpe7d !== null && avgRpe7d >= 8.5);
    if (hasPain) painFlagCount += 1;
    if (latestCheckIn?.autoSwappedToRecovery) swappedCount += 1;
    if (hasHighRpe) highRpeCount += 1;
    complianceSum += compliancePct;

    let attentionReason: DigestAttentionReason = 'ON_TRACK';
    let attentionSummary = 'Executing on target';

    if (hasPain) {
      attentionReason = 'PAIN_FLAG';
      const area = latestCheckIn?.painArea || 'Soreness';
      attentionSummary = latestCheckIn?.autoSwappedToRecovery
        ? `Pain · ${area} (Swapped)`
        : `Pain · ${area}`;
    } else if (hasHighRpe) {
      attentionReason = 'HIGH_RPE_STRAIN';
      attentionSummary = `High RPE (${latestCheckIn?.rpe ?? avgRpe7d}/10)`;
    } else if (plannedCount7d >= 2 && compliancePct < 50) {
      attentionReason = 'MISSED_KEY_SESSIONS';
      attentionSummary = `Missed ${plannedCount7d - completedCount7d} of ${plannedCount7d} sessions`;
    } else if (latestCheckIn) {
      attentionSummary = `RPE ${latestCheckIn.rpe}/10 · On Track`;
    }

    return {
      athleteId: ath.id,
      name: ath.name,
      ...(ath.eventGroup ? { eventGroup: ath.eventGroup } : {}),
      plannedCount7d,
      completedCount7d,
      compliancePct,
      latestCheckIn,
      checkedInToday,
      avgRpe7d,
      attentionReason,
      attentionSummary,
      ...(ath.isSelfFallback ? { isSelfFallback: true } : {}),
    };
  });

  rows.sort((a, b) => {
    const priDiff =
      ATTENTION_PRIORITY[a.attentionReason] - ATTENTION_PRIORITY[b.attentionReason];
    if (priDiff !== 0) return priDiff;
    return a.name.localeCompare(b.name);
  });

  return {
    windowStartIso,
    windowEndIso,
    totalAthletes: rows.length,
    checkedInTodayCount,
    painFlagCount,
    swappedCount,
    highRpeCount,
    teamCompliancePct:
      rows.length > 0 ? Math.round(complianceSum / rows.length) : 100,
    rows,
  };
}

export type { TrackWorkoutSpec };
