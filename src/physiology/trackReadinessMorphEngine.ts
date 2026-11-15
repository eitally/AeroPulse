import type {
  AthleteProfile,
  OrthopedicLoadSummary,
  PlannedWorkoutEvent,
  StudentAthleteCheckIn,
  StudentAthleteGuardrailResult,
  TrackSeasonPhase,
  TrackTrainingZoneCode,
  UnifiedWellnessDay,
} from '../types.ts';
import {
  computeCrossTrainingEquivalence,
  formatTrackMark,
} from './scholasticEngine.ts';
import { buildTrackSpeedReserveProfile } from './trackSpeedReserveEngine.ts';
import { parseStructuredTrackWorkout } from '../utils/workoutParser.ts';

export type TrackReadinessMorphMode =
  | 'BALANCED'
  | 'SUPERCOMPENSATION'
  | 'CAUTION_PIVOT'
  | 'RECOVERY_FLUSH'
  | 'BONE_STRESS_STOP';

export interface LnRmssdReadinessSummary {
  hrv: number;
  lnRmssd: number | null;
  hrvBaselineMeanLn: number | null;
  zScore30d: number;
  parasympatheticSaturation: boolean;
  hrvState: 'optimal' | 'caution' | 'strained' | 'missing';
  hrvPct: number;
  hrvDetail: string;
  rhr: number;
  rhrDelta: number;
  sleepScore: number;
  latestTsb: number;
  windowSampleDays: number;
}

export interface TrackReadinessMorphParams {
  mode: TrackReadinessMorphMode;
  baselineTitle: string;
  baselineSyntax: string;
  plannedEvent?: PlannedWorkoutEvent;
  athleteProfile: AthleteProfile;
  distanceUnit: 'km' | 'mi';
  orthopedicSummary: OrthopedicLoadSummary;
  studentGuardrail?: StudentAthleteGuardrailResult;
  seasonPhase?: TrackSeasonPhase;
}

export interface TrackReadinessMorphedPrescription {
  title: string;
  badge: string;
  rationale: string;
  workoutSyntax: string;
  repDistanceMeters: number;
  repCount: number;
  footwearRecommendation: string;
  spikedMetersPlanned: number;
  preservesFixedLapDistance: boolean;
}

/**
 * Evaluates 30-day rolling natural-log rMSSD z-score + vagal saturation guard.
 * Catches non-functional overreaching where zScore > +1.5 coincides with elevated RHR,
 * deep TSB fatigue (<= -18), or subjective FLAT energy.
 */
export function computeLnRmssdReadiness(
  wellnessDays: UnifiedWellnessDay[],
  profileRestingHr: number,
  checkIn?: StudentAthleteCheckIn
): LnRmssdReadinessSummary {
  const sorted = [...(wellnessDays || [])].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const validHrvDays = sorted.filter(
    (d) => typeof d.hrvRMSSD === 'number' && Number.isFinite(d.hrvRMSSD) && d.hrvRMSSD > 0
  );
  const window30 = validHrvDays.slice(-30);
  const lnValues = window30.map((d) => Math.log(d.hrvRMSSD));

  const latestHrvDay = window30[window30.length - 1] ?? latest;
  const hrv = latestHrvDay && latestHrvDay.hrvRMSSD > 0 ? Math.round(latestHrvDay.hrvRMSSD) : 0;
  const lnRmssd = hrv > 0 ? Number(Math.log(hrv).toFixed(3)) : null;

  let hrvBaselineMeanLn: number | null = null;
  let zScore30d = 0;

  if (lnValues.length >= 5 && lnRmssd !== null) {
    const meanLn = lnValues.reduce((acc, v) => acc + v, 0) / lnValues.length;
    const variance =
      lnValues.reduce((acc, v) => acc + (v - meanLn) * (v - meanLn), 0) / lnValues.length;
    const sdLn = Math.max(0.04, Math.sqrt(variance));
    hrvBaselineMeanLn = Number(meanLn.toFixed(3));
    zScore30d = Number(((lnRmssd - meanLn) / sdLn).toFixed(2));
  } else if (latestHrvDay?.hrvBaseline7d > 0 && lnRmssd !== null) {
    const baseLn = Math.log(latestHrvDay.hrvBaseline7d);
    hrvBaselineMeanLn = Number(baseLn.toFixed(3));
    zScore30d = Number(((lnRmssd - baseLn) / 0.09).toFixed(2));
  }

  const rhr = latest && latest.restingHR > 0 ? Math.round(latest.restingHR) : Math.round(profileRestingHr || 48);
  const rhrDelta =
    latest && latest.restingHR > 0 ? Math.round(latest.restingHR - (profileRestingHr || 48)) : 0;
  const latestTsb = latest ? Number((latest.ctl - latest.atl).toFixed(1)) : 0;
  const sleepScore = latest?.sleepScore ? Math.round(latest.sleepScore) : 80;

  const parasympatheticSaturation =
    hrv > 0 &&
    zScore30d > 1.5 &&
    (rhrDelta >= 2 || latestTsb <= -18 || checkIn?.energyFeel === 'FLAT');

  let hrvState: LnRmssdReadinessSummary['hrvState'] = 'optimal';
  if (hrv <= 0) {
    hrvState = 'missing';
  } else if (parasympatheticSaturation) {
    hrvState = 'caution';
  } else if (zScore30d <= -1.5) {
    hrvState = 'strained';
  } else if (zScore30d <= -0.75) {
    hrvState = 'caution';
  }

  const hrvPct =
    latestHrvDay && latestHrvDay.hrvBaseline7d > 0 && hrv > 0
      ? Math.round((hrv / latestHrvDay.hrvBaseline7d) * 100)
      : hrv > 0
        ? Math.max(55, Math.min(135, Math.round(Math.exp(zScore30d * 0.12) * 100)))
        : 100;

  let hrvDetail = 'Calibrating 30d Ln rMSSD';
  if (hrv > 0 && lnRmssd !== null) {
    const zSign = zScore30d >= 0 ? `+${zScore30d.toFixed(2)}` : zScore30d.toFixed(2);
    hrvDetail = parasympatheticSaturation
      ? `Vagal Saturation Watch (Ln z ${zSign} · RHR ${rhrDelta >= 0 ? `+${rhrDelta}` : rhrDelta} bpm)`
      : `Ln rMSSD ${lnRmssd.toFixed(2)} (z ${zSign} SD · ${window30.length || 1}d)`;
  }

  return {
    hrv,
    lnRmssd,
    hrvBaselineMeanLn,
    zScore30d,
    parasympatheticSaturation,
    hrvState,
    hrvPct,
    hrvDetail,
    rhr,
    rhrDelta,
    sleepScore,
    latestTsb,
    windowSampleDays: window30.length,
  };
}

const STANDARD_TRACK_REP_DISTANCES = [200, 300, 400, 600, 800, 1000, 1200, 1600] as const;

function snapToOvalRepDistance(meters: number): number {
  let best = 400;
  let minDiff = Infinity;
  for (const d of STANDARD_TRACK_REP_DISTANCES) {
    const diff = Math.abs(meters - d);
    if (diff < minDiff) {
      minDiff = diff;
      best = d;
    }
  }
  return minDiff <= 80 ? best : Math.max(200, Math.round(meters / 50) * 50);
}

function resolveZoneFromSyntaxIntensity(intensityPct: number): TrackTrainingZoneCode {
  if (intensityPct >= 106) return 'R';
  if (intensityPct >= 97) return 'I';
  if (intensityPct >= 92) return 'CV';
  if (intensityPct >= 88) return 'T';
  if (intensityPct >= 80) return 'SUB_T';
  return 'E';
}

function inferTrackStructure(params: TrackReadinessMorphParams): {
  repCount: number;
  repDistanceMeters: number;
  zoneCode: TrackTrainingZoneCode;
  restSecs: number;
  phase: TrackSeasonPhase;
} {
  const spec = params.plannedEvent?.trackSpec;
  if (spec) {
    return {
      repCount: Math.max(1, spec.repCount),
      repDistanceMeters: spec.repDistanceMeters,
      zoneCode: spec.zoneCode,
      restSecs: Math.max(30, spec.restDurationSecs),
      phase: params.seasonPhase ?? spec.phase ?? 'SPECIFIC',
    };
  }

  const combinedText = `${params.baselineTitle}\n${params.baselineSyntax}`;
  const repeatRegex = combinedText.match(/(\d+)\s*[xX×]\s*(\d+)\s*m\b/);
  const ast = parseStructuredTrackWorkout(
    params.baselineSyntax,
    params.athleteProfile.thresholdPaceSecsPerKm || 250
  );

  let repCount = repeatRegex ? Number(repeatRegex[1]) : 6;
  let repDistanceMeters = repeatRegex ? snapToOvalRepDistance(Number(repeatRegex[2])) : 800;
  let workIntensityPct = 100;
  let restSecs = 75;

  const repeatNodes = ast.filter((n) => n.type === 'repeat');
  if (repeatNodes.length > 0) {
    const mainRepeat = repeatNodes[0];
    if (mainRepeat.type === 'repeat') {
      repCount = Math.max(1, mainRepeat.repeatCount);
      const workStep =
        mainRepeat.steps.find((s) => s.stepKind === 'work') ?? mainRepeat.steps[0];
      const restStep = mainRepeat.steps.find((s) => s.stepKind === 'rest');
      if (workStep) {
        if (workStep.distanceMeters && workStep.distanceMeters >= 150) {
          repDistanceMeters = snapToOvalRepDistance(workStep.distanceMeters);
        }
        workIntensityPct = workStep.intensityPct || workIntensityPct;
      }
      if (restStep && restStep.durationSecs >= 20) {
        restSecs = Math.round(restStep.durationSecs);
      }
    }
  } else {
    const workStep = ast
      .filter((n) => n.type === 'step')
      .map((n) => (n.type === 'step' ? n.step : null))
      .find((s) => s && s.stepKind === 'work');
    if (workStep?.intensityPct) {
      workIntensityPct = workStep.intensityPct;
    }
  }

  return {
    repCount: Math.max(1, Math.min(20, repCount)),
    repDistanceMeters,
    zoneCode: resolveZoneFromSyntaxIntensity(workIntensityPct),
    restSecs,
    phase: params.seasonPhase ?? 'SPECIFIC',
  };
}

/**
 * Generates pure running-native adaptive track workout morphs with zero "% FTP" cycling leakage,
 * preserving fixed oval lap geometry (200/300/400/600/800/1000/1200/1600m) while adjusting effort,
 * volume, recovery floats, or non-impact aqua/turf pivots to match autonomic & spike readiness.
 */
export function buildTrackReadinessMorphedPrescription(
  params: TrackReadinessMorphParams
): TrackReadinessMorphedPrescription {
  const {
    mode,
    baselineTitle,
    athleteProfile,
    orthopedicSummary,
    studentGuardrail,
  } = params;

  const thresholdPace = athleteProfile.thresholdPaceSecsPerKm || 250;
  const speedReserve = buildTrackSpeedReserveProfile({
    thresholdPaceSecsPerKm: thresholdPace,
  });

  const { repCount, repDistanceMeters, zoneCode, restSecs, phase } =
    inferTrackStructure(params);

  const pctPaceFor = (paceSecsPerKm: number): number =>
    Math.max(60, Math.min(135, Math.round((thresholdPace / Math.max(95, paceSecsPerKm)) * 100)));

  const splitForZone = (code: TrackTrainingZoneCode): number =>
    Number(((speedReserve.zones[code].paceSecsPerKm * repDistanceMeters) / 1000).toFixed(1));

  const targetSplitSecs = splitForZone(zoneCode);
  const targetSplitDisplay = formatTrackMark(targetSplitSecs, 1);
  const targetPctPace = pctPaceFor(speedReserve.zones[zoneCode].paceSecsPerKm);

  const footwearLocked =
    orthopedicSummary.trainerOnly48hLockActive || orthopedicSummary.spikeRatio72h >= 1.0;
  const spikeLockSuffix = orthopedicSummary.trainerOnly48hLockActive
    ? ' · Trainers Only (48h Spike Gate)'
    : orthopedicSummary.spikeRatio72h >= 1.0
      ? ' · Trainers Only (72h Spike Cap)'
      : '';
  const safeFootwearLabel = footwearLocked
    ? 'Daily Trainers Only (48h Spike Lock)'
    : 'Daily Trainers / Track Flats';

  // 1. BONE_STRESS_STOP -> Zero axial impact deep-water aqua jogging
  if (mode === 'BONE_STRESS_STOP') {
    const aquaEq = computeCrossTrainingEquivalence({
      modality: 'AQUA_JOGGING',
      durationMins: 45,
      rpe: 6,
    });
    return {
      title: '45m Deep-Water Aqua Jog · 0% Axial Load',
      badge: 'BONE STRESS STOP · 0% AXIAL IMPACT',
      rationale: `${studentGuardrail?.headline || 'Lower-leg / growth-plate soreness >= 2.'} Converted track impact into ${aquaEq.durationMins}m Deep-Water Aqua Jogging (~${aquaEq.equivalentRunMiles} mi aerobic eq, ${aquaEq.impactLoadSavedPct}% tibial shock saved, 0 spiked meters).`,
      workoutSyntax: `Warmup\n- 10m 62% Pace Deep-Water Sculling Warmup\n\nMain Set 5x\n- 5m 92% Pace High-Cadence Aqua Strides\n- 90s 58% Pace Float Recovery\n\nCooldown\n- 10m 60% Pace Deep-Water Cool Down`,
      repDistanceMeters,
      repCount: 5,
      footwearRecommendation: 'Pool Aqua-Belt (Zero Spikes · 0% Axial Load)',
      spikedMetersPlanned: 0,
      preservesFixedLapDistance: true,
    };
  }

  // 2. RECOVERY_FLUSH -> Soft-turf aerobic flush or E/T Grass Fartlek (zero spikes)
  if (mode === 'RECOVERY_FLUSH') {
    if (studentGuardrail?.suggestCrossTrainingSwap || orthopedicSummary.trainerOnly48hLockActive) {
      return {
        title: '30m Soft-Turf Aerobic Flush · Trainers Only',
        badge: 'AUTONOMIC & SPIKE RECOVERY FLUSH',
        rationale:
          '30d Ln rMSSD or 48h spike recovery gate flags systemic strain. Shifts off the oval onto soft grass/turf in cushioned daily trainers at 66%-74% Pace with zero spiked meters.',
        workoutSyntax: `Warmup\n- 10m 64% Pace Soft-Turf Shakeout\n\nMain Set\n- 15m 70%-74% Pace Grass Aerobic Flush\n\nCooldown\n- 5m 60% Pace Easy Walk + Mobility`,
        repDistanceMeters,
        repCount: 1,
        footwearRecommendation: 'Cushioned Daily Trainers · Soft Turf Only',
        spikedMetersPlanned: 0,
        preservesFixedLapDistance: true,
      };
    }

    return {
      title: '20m Grass E/T Fartlek Flush · Zero Spikes',
      badge: 'GRASS FARTLEK FLUSH (ZERO SPIKES)',
      rationale:
        'Unlocks parasympathetic rebound on forgiving turf without oval curve torque. Alternates relaxed E rhythm with smooth sub-threshold pickups strictly by feel in cushioned trainers.',
      workoutSyntax: `Warmup\n- 8m 66% Pace Turf Easy Warmup\n\nMain Set 4x\n- 90s 86% Pace Smooth Grass Surge\n- 90s 64% Pace Easy Turf Jog\n\nCooldown\n- 6m 62% Pace Grass Cool Down`,
      repDistanceMeters,
      repCount: 4,
      footwearRecommendation: 'Cushioned Daily Trainers · Grass Only',
      spikedMetersPlanned: 0,
      preservesFixedLapDistance: true,
    };
  }

  // 3. CAUTION_PIVOT -> Phase-aware oval morph holding fixed lap distances
  if (mode === 'CAUTION_PIVOT') {
    if (phase === 'PEAK_TAPER') {
      const trimmedCount = Math.max(2, Math.round(repCount * 0.67));
      return {
        title: `${trimmedCount} x ${repDistanceMeters}m @ ${targetSplitDisplay} · Peak Volume Trim (-33%)${spikeLockSuffix}`,
        badge: 'PEAK TAPER VOLUME TRIM · 100% PACE HELD',
        rationale: `Taper caution protects neuromuscular sharpness while cutting ~33% oval volume (${repCount} -> ${trimmedCount} reps of exact ${repDistanceMeters}m laps). Holds race rhythm cleanly without digging into reserve.`,
        workoutSyntax: `Warmup\n- 15m 66%-74% Pace Turf Warmup + Drills\n\nMain Set ${trimmedCount}x\n- ${repDistanceMeters}m @ ${targetSplitDisplay} (${targetPctPace}% Pace)\n- ${restSecs}s 58% Pace Full Walk/Jog Recovery\n\nCooldown\n- 10m 62%-68% Pace Turf Cooldown`,
        repDistanceMeters,
        repCount: trimmedCount,
        footwearRecommendation: safeFootwearLabel,
        spikedMetersPlanned: footwearLocked ? 0 : trimmedCount * repDistanceMeters,
        preservesFixedLapDistance: true,
      };
    }

    const pivotZone: TrackTrainingZoneCode =
      zoneCode === 'CV' || zoneCode === 'T' || zoneCode === 'SUB_T' ? 'SUB_T' : 'CV';
    const pivotSplitSecs = splitForZone(pivotZone);
    const pivotSplitDisplay = formatTrackMark(pivotSplitSecs, 1);
    const pivotPctPace = pctPaceFor(speedReserve.zones[pivotZone].paceSecsPerKm);

    return {
      title: `${repCount} x ${repDistanceMeters}m @ ${pivotSplitDisplay} ${pivotZone} w/ 60s Float${spikeLockSuffix}`,
      badge: `TRACK ${pivotZone} + 60S FLOAT PIVOT`,
      rationale: `Autonomic readiness or 72h spike exposure signals caution. Downshifts ${zoneCode} track intensity to controlled ${pivotZone} rhythm (${pivotSplitDisplay} per ${repDistanceMeters}m lap) with 60s active float—preserving fixed oval geometry while protecting Achilles & CNS.${footwearLocked ? ' Enforces Cushioned Daily Trainers (0m spikes).' : ''}`,
      workoutSyntax: `Warmup\n- 15m 65%-73% Pace Easy Warmup\n\nMain Set ${repCount}x\n- ${repDistanceMeters}m @ ${pivotSplitDisplay} (${pivotPctPace}% Pace)\n- 60s 66% Pace Active Float\n\nCooldown\n- 10m 62%-70% Pace Cooldown`,
      repDistanceMeters,
      repCount,
      footwearRecommendation: safeFootwearLabel,
      spikedMetersPlanned: footwearLocked ? 0 : repCount * repDistanceMeters,
      preservesFixedLapDistance: true,
    };
  }

  // 4. SUPERCOMPENSATION -> Closing Cutdown keeping fixed oval repDistanceMeters
  if (mode === 'SUPERCOMPENSATION') {
    const cutdownReps = repCount <= 2 ? 1 : 2;
    const holdReps = Math.max(0, repCount - cutdownReps);
    const cutdownDeltaSecs = Number((1.0 * (repDistanceMeters / 400)).toFixed(1));
    const cutdownSplitSecs = Math.max(22, Number((targetSplitSecs - cutdownDeltaSecs).toFixed(1)));
    const cutdownDisplay = formatTrackMark(cutdownSplitSecs, 1);
    const cutdownPaceSecsPerKm = (cutdownSplitSecs / repDistanceMeters) * 1000;
    const cutdownPctPace = pctPaceFor(cutdownPaceSecsPerKm);

    const holdBlock =
      holdReps > 0
        ? `Main Set ${holdReps}x\n- ${repDistanceMeters}m @ ${targetSplitDisplay} (${targetPctPace}% Pace)\n- ${restSecs}s 58% Pace Jog Recovery\n\n`
        : '';

    const titlePrefix =
      holdReps > 0
        ? `${holdReps} x ${repDistanceMeters}m @ ${targetSplitDisplay} + ${cutdownReps} x ${repDistanceMeters}m Cutdown @ ${cutdownDisplay}`
        : `${cutdownReps} x ${repDistanceMeters}m Cutdown @ ${cutdownDisplay}`;

    return {
      title: `${titlePrefix}${spikeLockSuffix}`,
      badge: `CLOSING CUTDOWN (-${cutdownDeltaSecs.toFixed(1)}S / REP)`,
      rationale: `30d Ln rMSSD is positive and rested. Holds fixed ${repDistanceMeters}m oval marks on opening reps before sharpening the final ${cutdownReps} x ${repDistanceMeters}m by -${cutdownDeltaSecs.toFixed(1)}s (-1.0s/400m progression).${footwearLocked ? ' Keep workout in Daily Trainers per 48h Spike Lock.' : ''}`,
      workoutSyntax: `Warmup\n- 15m 66%-74% Pace Warmup + Strides\n\n${holdBlock}Closing Cutdown ${cutdownReps}x\n- ${repDistanceMeters}m @ ${cutdownDisplay} (${cutdownPctPace}% Pace)\n- ${restSecs}s 58% Pace Full Recovery\n\nCooldown\n- 10m 62%-70% Pace Cooldown`,
      repDistanceMeters,
      repCount: holdReps + cutdownReps,
      footwearRecommendation: footwearLocked
        ? 'Daily Trainers Only (48h Spike Gate Overrides Super-Spikes)'
        : 'Track Spikes / Carbon Flats Permitted (Closing Cutdown)',
      spikedMetersPlanned: footwearLocked ? 0 : (holdReps + cutdownReps) * repDistanceMeters,
      preservesFixedLapDistance: true,
    };
  }

  // 5. BALANCED -> Prescribed Track Session (with automatic Trainer-Only badge if 48h lock active)
  const cleanBaseTitle =
    baselineTitle && baselineTitle.trim().length > 0
      ? baselineTitle.trim()
      : `${repCount} x ${repDistanceMeters}m @ ${targetSplitDisplay}`;
  return {
    title: `${cleanBaseTitle}${spikeLockSuffix}`,
    badge: footwearLocked
      ? 'PRESCRIBED SPLIT · TRAINERS ONLY LOCK'
      : '100% PRESCRIBED TRACK SESSION',
    rationale: footwearLocked
      ? `Autonomic readiness is optimal, so fixed ${repDistanceMeters}m split targets stay intact—while the 48h spike exposure gate keeps the session in cushioned daily trainers.`
      : `30d Ln rMSSD and 72h spike exposure align inside the green window. Execute exact ${repDistanceMeters}m track splits as written.`,
    workoutSyntax: `Warmup\n- 15m 65%-74% Pace Warmup\n\nMain Set ${repCount}x\n- ${repDistanceMeters}m @ ${targetSplitDisplay} (${targetPctPace}% Pace)\n- ${restSecs}s 58% Pace Jog Recovery\n\nCooldown\n- 10m 62%-70% Pace Cooldown`,
    repDistanceMeters,
    repCount,
    footwearRecommendation: safeFootwearLabel,
    spikedMetersPlanned: footwearLocked ? 0 : repCount * repDistanceMeters,
    preservesFixedLapDistance: true,
  };
}
