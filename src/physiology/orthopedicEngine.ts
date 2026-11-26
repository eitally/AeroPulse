import type {
  AthleteProfile,
  OrthopedicLoadSummary,
  PlannedWorkoutEvent,
  TrackFootwearClass,
  UnifiedActivity,
} from '../types.ts';
import { computeHistoricalActivityLoad } from './pmc.ts';
import { getLocalDateIso } from './stravaLoadCalibration.ts';
import { resolveAthleteAgeTier } from './ageAndComplianceEngine.ts';

export const M_SHOE_MULTIPLIERS: Record<TrackFootwearClass, number> = {
  DAILY_TRAINER: 1.0,
  LIGHTWEIGHT_FLAT_SUPER_TRAINER: 1.1,
  CARBON_ROAD_RACER: 1.2,
  TRADITIONAL_TRACK_SPIKE: 1.35,
  CARBON_SUPER_SPIKE: 1.52,
};

export function resolveActivityFootwearClass(act: UnifiedActivity): TrackFootwearClass {
  const explicit = act.footwearClass ?? act.quickLog?.footwearClass;
  if (explicit) return explicit;
  const gear = (act.gearName ?? act.quickLog?.gearName ?? '').toLowerCase();
  if (!gear) return 'DAILY_TRAINER';
  if (
    /dragonfly|victory|ambition|avanti|md-x|ld-x|metaspike|maxfly|prime sp|takumi spike|super spike|carbon spike/.test(
      gear
    )
  ) {
    return 'CARBON_SUPER_SPIKE';
  }
  if (/spike|matumbo|mamba|rival|waffle|track spike/.test(gear)) {
    return 'TRADITIONAL_TRACK_SPIKE';
  }
  if (/vaporfly|alphafly|metaspeed|adios pro|endorphin pro|cielo|sc elite|cloudboom/.test(gear)) {
    return 'CARBON_ROAD_RACER';
  }
  if (/streakfly|takumi sen|sinister|hyperion|boston|endorphin speed|mach x|superblast/.test(gear)) {
    return 'LIGHTWEIGHT_FLAT_SUPER_TRAINER';
  }
  return 'DAILY_TRAINER';
}

export function resolveTrackCurveMultiplier(act: UnifiedActivity): number {
  if (act.sportCategory !== 'Running') return 1.0;
  const facility = act.trackFacility ?? act.quickLog?.trackFacility;
  if (facility === 'INDOOR_FLAT_200M') return 1.16;
  const isTrackLike =
    Boolean(facility) ||
    act.subType === 'Track' ||
    /\b(track|oval|200m|400m)\b/i.test(act.name || '');
  if (isTrackLike && act.environment === 'INDOOR' && facility !== 'INDOOR_BANKED_200M') {
    return 1.16;
  }
  if (facility === 'OUTDOOR_400M' || facility === 'INDOOR_BANKED_200M' || act.subType === 'Track') {
    return 1.06;
  }
  return 1.0;
}

export function resolveActivitySpikedMeters(
  act: UnifiedActivity,
  footwearClass: TrackFootwearClass
): number {
  const explicit = act.spikedDistanceMeters ?? act.quickLog?.spikedDistanceMeters;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0, Math.round(explicit));
  }
  if (
    footwearClass !== 'TRADITIONAL_TRACK_SPIKE' &&
    footwearClass !== 'CARBON_SUPER_SPIKE'
  ) {
    return 0;
  }
  if (act.intervals && act.intervals.length > 0) {
    const workMeters = act.intervals
      .filter((iv) => iv.type === 'WORK')
      .reduce((acc, iv) => acc + Math.max(0, iv.distanceMeters || 0), 0);
    if (workMeters > 0) return Math.round(workMeters);
  }
  return Math.round(Math.min(act.distanceMeters || 0, 5000));
}

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
    // Biomechanical ground reaction impulse scales non-linearly with running speed above 11 km/h,
    // modulated by M_shoe (carbon super-spike Achilles/metatarsal load) & M_curve (track centripetal torque).
    const speedFactor = Math.max(0.75, Math.min(2.1, Math.pow(speedKph / 12.0, 1.35)));
    const terrainShockFactor =
      act.elevationGainMeters > 150 ? 1.18 : act.environment === 'INDOOR' ? 0.88 : 1.0;
    const footwearClass = resolveActivityFootwearClass(act);
    const spikedMeters = resolveActivitySpikedMeters(act, footwearClass);
    const totalMeters = Math.max(1, act.distanceMeters || 0);
    const spikeShare =
      spikedMeters > 0
        ? Math.min(1, spikedMeters / totalMeters)
        : footwearClass === 'CARBON_ROAD_RACER' || footwearClass === 'LIGHTWEIGHT_FLAT_SUPER_TRAINER'
          ? 1
          : 0;
    const effectiveShoeFactor = 1 + (M_SHOE_MULTIPLIERS[footwearClass] - 1) * spikeShare;
    const curveMultiplier = resolveTrackCurveMultiplier(act);
    const eccentricImpact =
      distKm * 7.5 * speedFactor * terrainShockFactor * effectiveShoeFactor * curveMultiplier;
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

  // Sport-accurate mechanical & tendon loading for cross-training modalities
  const rawMeta = `${act.rawSportType || ''} ${act.subType || ''} ${act.name || ''}`.toLowerCase();

  // Zero-impact endurance & mobility: 100% systemic fitness credit, 0 tibial/Achilles ground impact
  if (
    act.sportCategory === 'Swimming' ||
    act.subType === 'Pool' ||
    act.subType === 'Open Water' ||
    act.subType === 'Rowing' ||
    act.subType === 'Elliptical' ||
    act.subType === 'Paddling & Water' ||
    act.subType === 'Yoga & Mobility' ||
    /\b(swim|row|elliptical|kayak|canoe|paddle|surf|yoga|pilates|stretch|mobility|meditation)\b/.test(
      rawMeta
    )
  ) {
    const torqueMult =
      act.subType === 'Rowing' || act.subType === 'Paddling & Water'
        ? 0.65
        : act.subType === 'Elliptical'
          ? 0.45
          : 0;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: 0,
      concentricTorque: Math.round(baseLoad * torqueMult * 10) / 10,
    };
  }

  // Concentric-dominant low-impact vertical/gliding endurance
  if (
    act.subType === 'Stair Stepper' ||
    act.subType === 'Nordic Ski' ||
    /\b(stair|nordic|rollerski|xc ski|skierg)\b/.test(rawMeta)
  ) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.05 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.75 * 10) / 10,
    };
  }

  // Hiking & Walking: steep mountain hikes create real quad/calf downhill eccentric demand
  if (act.subType === 'Hiking' || /\b(hike|hiking|snowshoe)\b/.test(rawMeta)) {
    const steepFactor = (act.elevationGainMeters || 0) > 400 ? 1.25 : 1.0;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.3 * steepFactor * 10) / 10,
      concentricTorque: Math.round(((act.elevationGainMeters || 0) * 0.08 + baseLoad * 0.45) * 10) / 10,
    };
  }

  if (act.subType === 'Walking' || /\bwalk\b/.test(rawMeta)) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.12 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.25 * 10) / 10,
    };
  }

  // Multi-directional cutting / plyometric / alpine eccentric loads
  if (
    act.subType === 'HIIT & Circuit' ||
    act.subType === 'Court & Field' ||
    act.subType === 'Alpine & Backcountry Ski' ||
    /\b(hiit|crossfit|soccer|tennis|pickleball|basketball|alpine|snowboard|backcountry)\b/.test(
      rawMeta
    )
  ) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.42 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.55 * 10) / 10,
    };
  }

  // Heavy Resistance Strength & Climbing: high muscular torque, low bone-impact shock
  if (act.sportCategory === 'Strength' || act.subType === 'Climbing' || act.subType === 'Gym') {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.12 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.85 * 10) / 10,
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
  referenceDateIso?: string,
  options?: {
    isMinorU18?: boolean;
    lowerLegSoreness?: number;
  }
): OrthopedicLoadSummary {
  const refDateStr = (referenceDateIso || getLocalDateIso()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);
  const hasExplicitRef = Boolean(referenceDateIso);
  const refExactMs =
    referenceDateIso && referenceDateIso.includes('T')
      ? Date.parse(referenceDateIso)
      : hasExplicitRef
        ? refMs
        : Date.now();
  const dayMs = 86_400_000;
  const hourMs = 3_600_000;

  const isU18Cohort =
    options?.isMinorU18 ??
    (profile.birthMonthYear
      ? resolveAthleteAgeTier({ birthMonthYear: profile.birthMonthYear }).isMinorU18
      : profile.academicDivision === 'HS_VARSITY');
  const spikedMetersWeeklyCap = isU18Cohort
    ? 2000
    : profile.academicDivision === 'NCAA_D1'
      ? 4400
      : 3200;
  const superSpikeWeeklyCap = isU18Cohort
    ? 1600
    : profile.academicDivision === 'NCAA_D1'
      ? 3600
      : 2400;

  let central7d = 0;
  let central28d = 0;
  let impact7d = 0;
  let impact28d = 0;
  let torque7d = 0;
  let torque28d = 0;
  let spikedMeters7d = 0;
  let superSpikeMeters7d = 0;
  let spikedMeters72h = 0;
  let spikeWeightedLoad7d = 0;
  let spikeWeightedLoad28d = 0;
  let hoursSinceLastSuperSpike: number | null = null;

  for (const act of activities) {
    const actDate = (act.startDateLocal || '').slice(0, 10);
    const actMs = Date.parse(`${actDate}T12:00:00Z`);
    if (!Number.isFinite(actMs) || actMs > refMs) continue;
    const ageDays = (refMs - actMs) / dayMs;
    if (ageDays > 28) continue;

    const actExactMs =
      act.startDateLocal && act.startDateLocal.includes('T')
        ? Date.parse(act.startDateLocal)
        : actMs;
    const hoursAgo = Number.isFinite(actExactMs)
      ? Math.max(0, (refExactMs - actExactMs) / hourMs)
      : ageDays * 24;

    const ch = computeActivityThreeChannelLoads(act, profile);
    central28d += ch.central;
    impact28d += ch.eccentricImpact;
    torque28d += ch.concentricTorque;

    if (ageDays <= 7) {
      central7d += ch.central;
      impact7d += ch.eccentricImpact;
      torque7d += ch.concentricTorque;
    }

    if (act.sportCategory === 'Running') {
      const footwearClass = resolveActivityFootwearClass(act);
      const curveMultiplier = resolveTrackCurveMultiplier(act);
      const spikedMeters = resolveActivitySpikedMeters(act, footwearClass);
      const weightedSpike = spikedMeters * M_SHOE_MULTIPLIERS[footwearClass] * curveMultiplier;
      spikeWeightedLoad28d += weightedSpike;

      if (ageDays <= 7) {
        spikedMeters7d += spikedMeters;
        spikeWeightedLoad7d += weightedSpike;
        if (footwearClass === 'CARBON_SUPER_SPIKE') {
          superSpikeMeters7d += spikedMeters;
        }
      }
      if (hoursAgo <= 72) {
        spikedMeters72h += spikedMeters;
      }
      if (footwearClass === 'CARBON_SUPER_SPIKE' && spikedMeters > 0) {
        const roundedHrs = Math.round(hoursAgo * 10) / 10;
        hoursSinceLastSuperSpike =
          hoursSinceLastSuperSpike === null
            ? roundedHrs
            : Math.min(hoursSinceLastSuperSpike, roundedHrs);
      }
    }
  }

  const chronicCentralWeekly = Math.max(80, central28d / 4);
  const chronicImpactWeekly = Math.max(45, impact28d / 4);
  const chronicTorqueWeekly = Math.max(60, torque28d / 4);
  const chronicSpikeWeekly = Math.max(800, spikeWeightedLoad28d / 4);

  const centralAcwr = Math.round((central7d / chronicCentralWeekly) * 100) / 100;
  const impactAcwr = Math.round((impact7d / chronicImpactWeekly) * 100) / 100;
  const torqueAcwr = Math.round((torque7d / chronicTorqueWeekly) * 100) / 100;
  const spikeAcwr = Math.round((spikeWeightedLoad7d / chronicSpikeWeekly) * 100) / 100;
  const spikeRatio72h = Number((spikedMeters72h / Math.max(1, spikedMetersWeeklyCap)).toFixed(2));

  const within48hWindow = hoursSinceLastSuperSpike !== null && hoursSinceLastSuperSpike < 48;
  const sorenessTriggered = (options?.lowerLegSoreness ?? 0) >= 1;
  const trainerOnly48hLockActive = within48hWindow || sorenessTriggered;

  let trainerOnlyLockReason: string | null = null;
  if (within48hWindow && hoursSinceLastSuperSpike !== null) {
    trainerOnlyLockReason = `48h Trainers-Only Lock active (${hoursSinceLastSuperSpike.toFixed(1)}h since last carbon super-spike session).`;
  } else if (sorenessTriggered) {
    trainerOnlyLockReason = '48h Trainers-Only Lock triggered by shin/metatarsal or Achilles soreness >= 1.';
  }

  const spikeGuardrailStatus: OrthopedicLoadSummary['spikeGuardrailStatus'] =
    trainerOnly48hLockActive
      ? 'TRAINER_ONLY_48H_LOCK'
      : spikedMeters7d > spikedMetersWeeklyCap ||
          superSpikeMeters7d > superSpikeWeeklyCap ||
          spikeAcwr >= 1.35
        ? 'SPIKE_CAP_WARNING'
        : 'CLEAR';

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

  const scheduledFootwear = scheduledRun?.footwearClass ?? scheduledRun?.trackSpec?.footwearClass;
  const scheduledIsSpike =
    scheduledFootwear === 'CARBON_SUPER_SPIKE' || scheduledFootwear === 'TRADITIONAL_TRACK_SPIKE';
  if (spikeGuardrailStatus === 'TRAINER_ONLY_48H_LOCK' && (scheduledIsSpike || riskTier === 'OPTIMAL')) {
    if (scheduledIsSpike) {
      riskTier = 'HIGH_IMPACT_GUARDRAIL';
    } else if (riskTier === 'OPTIMAL') {
      riskTier = 'ELEVATED_IMPACT';
    }
    guardrailHeadline = `48h Trainers-Only Spike Lock (${Math.round(spikedMeters7d)}/${spikedMetersWeeklyCap}m 7d)`;
    guardrailRecommendation = `${trainerOnlyLockReason || 'Super-spike recovery gate active.'} Keep today's track work in Cushioned Daily Trainers / Flats to protect Achilles & metatarsal remodeling.`;
  } else if (spikeGuardrailStatus === 'SPIKE_CAP_WARNING' && riskTier === 'OPTIMAL') {
    riskTier = 'ELEVATED_IMPACT';
    guardrailHeadline = `Spiked Exposure Watch (${Math.round(spikedMeters7d)}/${spikedMetersWeeklyCap}m · ${spikeAcwr.toFixed(2)}x)`;
    guardrailRecommendation = `Weekly spiked volume reached ${Math.round(spikedMeters7d)}m (cap ${spikedMetersWeeklyCap}m; carbon super-spikes ${Math.round(superSpikeMeters7d)}/${superSpikeWeeklyCap}m). Shift remaining intervals to Trainers / Flats.`;
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
    spikedMeters7d: Math.round(spikedMeters7d),
    superSpikeMeters7d: Math.round(superSpikeMeters7d),
    spikedMeters72h: Math.round(spikedMeters72h),
    spikedMetersWeeklyCap,
    superSpikeWeeklyCap,
    spikeRatio72h,
    spikeAcwr,
    hoursSinceLastSuperSpike,
    trainerOnly48hLockActive,
    trainerOnlyLockReason,
    spikeGuardrailStatus,
  };
}
