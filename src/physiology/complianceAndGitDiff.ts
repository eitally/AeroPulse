import type {
  OrthopedicLoadSummary,
  PlannedWorkoutCompliance,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
  WeeklyGitDiffDayChange,
  WeeklyGitDiffProposal,
} from '../types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parseDateSafe(dateStr: string): Date {
  const clean = (dateStr || '').slice(0, 10);
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Evaluates Planned vs. Completed workout adherence (`0–100%`) across scheduled
 * `PlannedWorkoutEvent` items and completed `UnifiedActivity` workouts.
 */
export function evaluatePlannedVsCompletedCompliance(
  plannedEvents: PlannedWorkoutEvent[],
  activities: UnifiedActivity[],
  todayIso: string = new Date().toISOString().slice(0, 10)
): PlannedWorkoutCompliance[] {
  const actsByDate = new Map<string, UnifiedActivity[]>();
  for (const act of activities) {
    const d = (act.startDateLocal || '').slice(0, 10);
    if (!d) continue;
    const list = actsByDate.get(d);
    if (list) list.push(act);
    else actsByDate.set(d, [act]);
  }

  const usedActIds = new Set<string>();
  const results: PlannedWorkoutCompliance[] = [];

  for (const ev of plannedEvents) {
    const d = (ev.date || '').slice(0, 10);
    const plannedDurationMins = Math.max(
      15,
      Math.round((ev.plannedDurationSecs || 3600) / 60)
    );
    const plannedTss = Math.max(10, Math.round(ev.plannedLoad || 55));

    const candidates = (actsByDate.get(d) || []).filter((a) => !usedActIds.has(a.id));
    // Prefer exact sport match first, then any completed workout on that day
    const matched =
      candidates.find((a) => a.sportCategory === ev.sportCategory) || candidates[0] || null;

    if (!matched) {
      const isUpcoming = d > todayIso;
      results.push({
        date: d,
        plannedEventId: ev.id,
        plannedName: ev.name,
        plannedSport: ev.sportCategory,
        plannedDurationMins,
        plannedTss,
        matchedActivityId: null,
        matchedActivityName: null,
        actualDurationMins: 0,
        actualTss: 0,
        durationAdherencePct: 0,
        loadAdherencePct: 0,
        complianceScore: 0,
        status: isUpcoming ? 'UPCOMING' : 'MISSED',
        summaryLabel: isUpcoming
          ? `Scheduled (${plannedDurationMins}m · ${plannedTss} TSS)`
          : `Missed (${plannedDurationMins}m · ${plannedTss} TSS planned)`,
      });
      continue;
    }

    usedActIds.add(matched.id);
    const actualDurationMins = Math.max(1, Math.round((matched.movingTimeSecs || 0) / 60));
    const actualTss = Math.max(1, Math.round(matched.trainingLoad || 0));

    const durationRatio = actualDurationMins / plannedDurationMins;
    const loadRatio = actualTss / plannedTss;
    const durationAdherencePct = Math.round(durationRatio * 100);
    const loadAdherencePct = Math.round(loadRatio * 100);

    // Penalize large under- or over-reaching relative to 100% prescription
    const durError = Math.abs(1 - durationRatio);
    const loadError = Math.abs(1 - loadRatio);
    const sportPenalty = matched.sportCategory === ev.sportCategory ? 0 : 8;
    const rawScore = 100 - (durError * 45 + loadError * 55) - sportPenalty;
    const complianceScore = Math.max(15, Math.min(100, Math.round(rawScore)));

    const status: PlannedWorkoutCompliance['status'] =
      matched.sportCategory !== ev.sportCategory
        ? 'MODIFIED_COMPLETED'
        : complianceScore >= 80
          ? 'COMPLETED_ON_TARGET'
          : 'PARTIAL';

    results.push({
      date: d,
      plannedEventId: ev.id,
      plannedName: ev.name,
      plannedSport: ev.sportCategory,
      plannedDurationMins,
      plannedTss,
      matchedActivityId: matched.id,
      matchedActivityName: matched.name,
      actualDurationMins,
      actualTss,
      durationAdherencePct,
      loadAdherencePct,
      complianceScore,
      status,
      summaryLabel:
        status === 'MODIFIED_COMPLETED'
          ? `Cross-Modal Swap (${actualDurationMins}m ${matched.sportCategory} · ${complianceScore}% adherence)`
          : `${complianceScore}% Compliance (${actualDurationMins}/${plannedDurationMins}m · ${actualTss}/${plannedTss} TSS)`,
    });
  }

  return results;
}

/**
 * 10x Differentiator #3: Zero-Touch "6:00 AM Autonomous Morph" with Weekly Training Git-Diff
 *
 * Fuses overnight HRV / readiness + TSB + 3-Channel Orthopedic Interference to propose
 * a transparent Git-Diff across the next 7 days (`- Original / + Proposed`), preserving
 * macro aerobic stimulus while protecting autonomic and orthopedic guardrails.
 */
export function generateWeeklyTrainingGitDiff(params: {
  plannedEvents: PlannedWorkoutEvent[];
  latestWellness?: UnifiedWellnessDay | null;
  orthopedicSummary: OrthopedicLoadSummary;
  todayIso?: string;
}): WeeklyGitDiffProposal {
  const {
    plannedEvents,
    latestWellness,
    orthopedicSummary,
    todayIso = new Date().toISOString().slice(0, 10),
  } = params;

  const hrvScore = latestWellness
    ? latestWellness.readinessStatus === 'Strain'
      ? 52
      : latestWellness.readinessStatus === 'Caution'
        ? 64
        : Math.max(70, latestWellness.sleepScore || 78)
    : 76;
  const tsb = latestWellness?.tsb ?? 0;
  const highImpactRisk =
    orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
    orthopedicSummary.impactAcwr >= 1.3;
  const lowAutonomicReadiness = hrvScore < 62 || tsb < -22;

  const readinessVerdict: WeeklyGitDiffProposal['readinessVerdict'] = highImpactRisk
    ? 'RED_GUARDRAIL'
    : lowAutonomicReadiness || orthopedicSummary.riskTier === 'ELEVATED_IMPACT'
      ? 'AMBER_ADAPT'
      : 'GREEN_PRIME';

  // Build 7-day window starting from todayIso
  const baseDate = parseDateSafe(todayIso);
  const upcomingDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(baseDate.getTime() + i * 86_400_000);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    upcomingDates.push(`${yyyy}-${mm}-${dd}`);
  }

  const eventsByDate = new Map<string, PlannedWorkoutEvent>();
  for (const ev of plannedEvents) {
    const d = (ev.date || '').slice(0, 10);
    if (upcomingDates.includes(d) && !eventsByDate.has(d)) {
      eventsByDate.set(d, ev);
    }
  }

  const dayChanges: WeeklyGitDiffDayChange[] = [];
  let swappedQualitySession: PlannedWorkoutEvent | null = null;

  for (let idx = 0; idx < upcomingDates.length; idx++) {
    const date = upcomingDates[idx];
    const dt = parseDateSafe(date);
    const dayLabel = `${DAY_LABELS[dt.getDay()]} ${date.slice(5)}`;
    const existing = eventsByDate.get(date);

    const origTitle =
      existing?.name ||
      (idx === 0
        ? 'Threshold Intervals (4x8m @ LT2)'
        : idx === 2
          ? 'Aerobic Z2 Endurance Run'
          : idx === 4
            ? 'Tempo Progression Session'
            : idx === 5
              ? 'Long Endurance Foundation'
              : 'Active Recovery / Mobility');
    const origSport =
      existing?.sportCategory || (idx % 2 === 0 ? 'Running' : 'Cycling');
    const origDur = existing?.plannedDurationSecs
      ? Math.round(existing.plannedDurationSecs / 60)
      : idx === 5
        ? 95
        : idx % 2 === 0
          ? 55
          : 60;
    const origTss = existing?.plannedLoad || (idx === 0 ? 78 : idx === 5 ? 105 : 52);

    // Day 0 (Today) adaptation logic
    if (idx === 0 && (highImpactRisk || lowAutonomicReadiness)) {
      if (highImpactRisk && origSport === 'Running') {
        swappedQualitySession = existing || {
          id: `synth-${date}`,
          date,
          name: origTitle,
          sportCategory: origSport,
          environmentPreference: 'OUTDOOR',
          description: '',
          plannedDurationSecs: origDur * 60,
          plannedLoad: origTss,
          targetZoneSummary: 'Z4 Threshold',
        };
        dayChanges.push({
          date,
          dayLabel: `${dayLabel} (Today)`,
          changeType: 'MODIFIED',
          originalEventId: existing?.id,
          originalTitle: origTitle,
          originalSport: origSport,
          originalDurationMins: origDur,
          originalTss: origTss,
          proposedTitle: 'Zero-Impact Aerobic Z2 Cadence Spin (Orthopedic Guardrail)',
          proposedSport: 'Cycling',
          proposedDurationMins: orthopedicSummary.suggestedBikeDurationMins || 55,
          proposedTss: orthopedicSummary.suggestedBikeTss || 45,
          proposedWorkoutSyntax: orthopedicSummary.suggestedBikeWorkoutSyntax,
          reason: `Impact ACWR is ${orthopedicSummary.impactAcwr.toFixed(2)}x — morphing today's run to 90+ rpm cycling unloads tibial/Achilles strain while banking aerobic volume.`,
        });
        continue;
      }

      if (lowAutonomicReadiness) {
        swappedQualitySession = existing || null;
        const reducedDur = Math.max(35, Math.round(origDur * 0.75));
        const reducedTss = Math.max(28, Math.round(origTss * 0.58));
        dayChanges.push({
          date,
          dayLabel: `${dayLabel} (Today)`,
          changeType: 'MODIFIED',
          originalEventId: existing?.id,
          originalTitle: origTitle,
          originalSport: origSport,
          originalDurationMins: origDur,
          originalTss: origTss,
          proposedTitle: `Autonomic Reset Z1/Z2 Aerobic Flush (${origSport})`,
          proposedSport: origSport,
          proposedDurationMins: reducedDur,
          proposedTss: reducedTss,
          proposedWorkoutSyntax: `Warmup\n- 10m 55%-65%\n\nMain Set\n- ${Math.max(15, reducedDur - 15)}m 65%-72%\n\nCooldown\n- 5m 50%-60%`,
          reason: `Readiness ${hrvScore}/100 (TSB ${Math.round(tsb)}) — shifting high-glycolytic intervals 48h forward so parasympathetic recovery rebounds first.`,
        });
        continue;
      }
    }

    // Day +2 (48h later): re-insert deferred quality session so weekly CTL stays on track
    if (idx === 2 && swappedQualitySession) {
      dayChanges.push({
        date,
        dayLabel,
        changeType: 'SWAPPED',
        originalEventId: existing?.id,
        originalTitle: origTitle,
        originalSport: origSport,
        originalDurationMins: origDur,
        originalTss: origTss,
        proposedTitle: `${swappedQualitySession.name} (Shifted +48h)`,
        proposedSport: swappedQualitySession.sportCategory,
        proposedDurationMins: Math.round((swappedQualitySession.plannedDurationSecs || 3600) / 60),
        proposedTss: swappedQualitySession.plannedLoad || 75,
        reason:
          'Re-anchored quality threshold stimulus 48h after today’s guardrail morph to preserve weekly CTL progression.',
      });
      swappedQualitySession = null;
      continue;
    }

    dayChanges.push({
      date,
      dayLabel: idx === 0 ? `${dayLabel} (Today)` : dayLabel,
      changeType: 'UNCHANGED',
      originalEventId: existing?.id,
      originalTitle: origTitle,
      originalSport: origSport,
      originalDurationMins: origDur,
      originalTss: origTss,
      proposedTitle: origTitle,
      proposedSport: origSport,
      proposedDurationMins: origDur,
      proposedTss: origTss,
      reason: 'On track — matches current readiness and progression trajectory.',
    });
  }

  const origWeekTss = dayChanges.reduce((s, d) => s + d.originalTss, 0);
  const propWeekTss = dayChanges.reduce((s, d) => s + d.proposedTss, 0);
  const netTssDelta = propWeekTss - origWeekTss;
  const netCtlDelta = Math.round((netTssDelta / 42) * 10) / 10;
  const netTsbDelta = Math.round((-netTssDelta / 7) * 10) / 10;

  const triggerReason =
    readinessVerdict === 'RED_GUARDRAIL'
      ? `Eccentric Running Impact ACWR (${orthopedicSummary.impactAcwr.toFixed(2)}x) crossed guardrail threshold`
      : readinessVerdict === 'AMBER_ADAPT'
        ? `Autonomic Readiness (${hrvScore}/100) & Form (TSB ${Math.round(tsb)}) call for 48h intensity shift`
        : `All 3 physiological channels green (Readiness ${hrvScore}/100 · Impact ACWR ${orthopedicSummary.impactAcwr.toFixed(2)}x)`;

  return {
    generatedAt: new Date().toISOString(),
    triggerReason,
    readinessVerdict,
    netTssDelta,
    netCtlDelta,
    netTsbDelta,
    dayChanges,
  };
}
