import type {
  AthleteProfile,
  OrthopedicLoadSummary,
  PlannedWorkoutEvent,
  UnifiedActivity,
} from '../types';
import { computeHistoricalActivityLoad } from './pmc';

/**
 * 10x Differentiator #1: Cross-Modal Run ↔ Bike 3-Channel Orthopedic Interference Engine
 *
 * Separates every session into:
 *  1. Central Autonomic / Cardiorespiratory Load (all sports aerobic TSS)
 *  2. Eccentric Orthopedic Impact Load (running mechanical shock weighted by velocity^2 + grade)
 *  3. Concentric Muscular Torque Load (cycling climbing/power torque + steep uphill run torque)
 *
 * Detects tibial / Achilles eccentric overload spikes (Impact ACWR > 1.30) even when
 * systemic HRV/TSB looks green, and prescribes an aerobic-equivalent zero-impact Bike morph!
 */
export function computeActivityThreeChannelLoads(
  act: UnifiedActivity,
  profile: AthleteProfile
): { central: number; eccentricImpact: number; concentricTorque: number } {
  const baseLoad = computeHistoricalActivityLoad(act, profile);
  const central = baseLoad;

  if (act.sportCategory === 'Running') {
    const distKm = Math.max(0, (act.distanceMeters || 0) / 1000);
    const durHrs = Math.max(0.05, (act.movingTimeSecs || 1) / 3600);
    const speedKph = distKm / durHrs;
    // Biomechanical ground reaction impulse scales non-linearly with running speed above 11 km/h
    const speedFactor = Math.max(0.75, Math.min(2.1, Math.pow(speedKph / 12.0, 1.35)));
    const terrainShockFactor =
      act.elevationGainMeters > 150 ? 1.18 : act.environment === 'INDOOR' ? 0.88 : 1.0;
    const eccentricImpact = distKm * 7.5 * speedFactor * terrainShockFactor;
    const uphillTorque = (act.elevationGainMeters || 0) * 0.08 + baseLoad * 0.25;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(eccentricImpact * 10) / 10,
      concentricTorque: Math.round(uphillTorque * 10) / 10,
    };
  }

  if (act.sportCategory === 'Cycling') {
    const cadence = act.avgCadence && act.avgCadence > 30 ? act.avgCadence : 85;
    const lowCadenceFactor = Math.max(0.8, Math.min(1.65, 85 / cadence));
    const climbingFactor = (act.elevationGainMeters || 0) > 600 ? 1.2 : 1.0;
    const concentricTorque = baseLoad * 0.85 * lowCadenceFactor * climbingFactor;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: 0, // Zero ground-reaction impact!
      concentricTorque: Math.round(concentricTorque * 10) / 10,
    };
  }

  return {
    central: Math.round(central * 10) / 10,
    eccentricImpact: Math.round(baseLoad * 0.15 * 10) / 10,
    concentricTorque: Math.round(baseLoad * 0.4 * 10) / 10,
  };
}

export function evaluateOrthopedicInterference(
  activities: UnifiedActivity[],
  profile: AthleteProfile,
  todayPlannedEvents: PlannedWorkoutEvent[] = [],
  referenceDateIso?: string
): OrthopedicLoadSummary {
  const refDateStr = (referenceDateIso || new Date().toISOString()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);
  const dayMs = 86_400_000;

  let central7d = 0;
  let central28d = 0;
  let impact7d = 0;
  let impact28d = 0;
  let torque7d = 0;
  let torque28d = 0;

  for (const act of activities) {
    const actDate = (act.startDateLocal || '').slice(0, 10);
    const actMs = Date.parse(`${actDate}T12:00:00Z`);
    if (!Number.isFinite(actMs) || actMs > refMs) continue;
    const ageDays = (refMs - actMs) / dayMs;
    if (ageDays > 28) continue;

    const ch = computeActivityThreeChannelLoads(act, profile);
    central28d += ch.central;
    impact28d += ch.eccentricImpact;
    torque28d += ch.concentricTorque;

    if (ageDays <= 7) {
      central7d += ch.central;
      impact7d += ch.eccentricImpact;
      torque7d += ch.concentricTorque;
    }
  }

  const chronicCentralWeekly = Math.max(80, central28d / 4);
  const chronicImpactWeekly = Math.max(45, impact28d / 4);
  const chronicTorqueWeekly = Math.max(60, torque28d / 4);

  const centralAcwr = Math.round((central7d / chronicCentralWeekly) * 100) / 100;
  const impactAcwr = Math.round((impact7d / chronicImpactWeekly) * 100) / 100;
  const torqueAcwr = Math.round((torque7d / chronicTorqueWeekly) * 100) / 100;

  const scheduledRun = todayPlannedEvents.find((e) => e.sportCategory === 'Running');
  const baseRunMins = scheduledRun
    ? Math.max(30, Math.round(scheduledRun.plannedDurationSecs / 60))
    : 45;
  const suggestedBikeDurationMins = Math.round((baseRunMins * 1.25) / 5) * 5;
  const suggestedBikeTss = scheduledRun?.plannedLoad
    ? Math.round(scheduledRun.plannedLoad * 0.95)
    : Math.round(suggestedBikeDurationMins * 0.82);

  const z2DurationMins = Math.max(20, suggestedBikeDurationMins - 20);
  const suggestedBikeWorkoutSyntax = `Warmup\n- 10m 55%-68% 90rpm\n\nMain Set\n- ${z2DurationMins}m 70%-76% 92rpm\n\nCooldown\n- 10m 50%-60% 85rpm`;

  let riskTier: OrthopedicLoadSummary['riskTier'] = 'OPTIMAL';
  let guardrailHeadline = 'Orthopedic Impact Balanced';
  let guardrailRecommendation =
    '7-day tibial/Achilles eccentric impact load is aligned with your 28-day chronic running baseline.';

  if (impactAcwr >= 1.32 && impact7d >= 85) {
    riskTier = 'HIGH_IMPACT_GUARDRAIL';
    guardrailHeadline = `Impact ACWR ${impactAcwr.toFixed(2)}x · High Eccentric Strain`;
    guardrailRecommendation = scheduledRun
      ? `7d running impact spiked to ${Math.round(impact7d)} pts (${impactAcwr.toFixed(2)}x chronic baseline). Morph today's "${scheduledRun.name}" into a ${suggestedBikeDurationMins}m high-cadence Z2 ride to preserve aerobic CTL with zero tibial impact.`
      : `7d running impact reached ${Math.round(impact7d)} pts (${impactAcwr.toFixed(2)}x chronic baseline). Favor zero-impact Z2 spinning (${suggestedBikeDurationMins}m @ 90+ rpm) before your next quality run.`;
  } else if (impactAcwr >= 1.18 && impact7d >= 60) {
    riskTier = 'ELEVATED_IMPACT';
    guardrailHeadline = `Impact ACWR ${impactAcwr.toFixed(2)}x · Watch Running Volume`;
    guardrailRecommendation =
      'Running mechanical load is building near your upper ramp ceiling. Keep easy runs on flat/soft surfaces or substitute an aerobic spin if calves/shins feel tight.';
  } else if (activities.length === 0) {
    guardrailHeadline = 'Awaiting Run & Ride Load History';
    guardrailRecommendation =
      'Sync or upload workouts to track separated Central Cardiorespiratory, Eccentric Running Impact, and Concentric Bike Torque loads.';
  }

  return {
    centralAutonomicLoad7d: Math.round(central7d),
    eccentricImpactLoad7d: Math.round(impact7d),
    concentricTorqueLoad7d: Math.round(torque7d),
    impactAcwr,
    torqueAcwr,
    centralAcwr,
    riskTier,
    guardrailHeadline,
    guardrailRecommendation,
    canMorphTodayRunToBike:
      riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
      (riskTier === 'ELEVATED_IMPACT' && Boolean(scheduledRun)),
    suggestedBikeDurationMins,
    suggestedBikeTss,
    suggestedBikeWorkoutSyntax,
  };
}
