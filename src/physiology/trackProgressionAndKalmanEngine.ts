import type {
  AthleteProfile,
  TrackTrainingZoneCode,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types.ts';
import {
  buildTrackSpeedReserveProfile,
  computeRawMarkVdot,
  solveTrackPaceSecsPerKmForPctVdot,
} from './trackSpeedReserveEngine.ts';
import { pctVo2MaxAtDurationMins, vo2AtVelocityMpm } from './trackSpeedReserveEngine.ts';
import { getLocalDateIso } from './stravaLoadCalibration.ts';

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));
const round1 = (val: number): number => Number(val.toFixed(1));
const round2 = (val: number): number => Number(val.toFixed(2));

export type TrackProgressionAxisId =
  | 'SUB_THRESHOLD_CV'
  | 'VO2MAX_AEROBIC_POWER'
  | 'RACE_PACE_STAMINA'
  | 'GLYCOLYTIC_SPEED_ENDURANCE'
  | 'MAX_VELOCITY_NEUROMUSCULAR';

export interface TrackExecutionScoreInput {
  workSplitsSecs: number[];
  targetSplitSecs: number;
  plannedRestSecs: number;
  actualRestSecs?: number | number[];
  aerobicDecouplingPct?: number | null;
  strideLengthFadePct?: number | null;
}

export interface TrackExecutionScoreResult {
  totalScore: number;
  paceAdherenceScore: number;
  splitDisciplineScore: number;
  restFidelityScore: number;
  driftRetentionScore: number;
  positiveSplitFadePct: number;
  mapePct: number;
  cvPct: number;
  meanActualRestSecs: number;
  workoutHeroFlag: boolean;
  restCheatingFlag: boolean;
  verdictLabel: string;
}

export interface TrackProgressionAxisLevel {
  axisId: TrackProgressionAxisId;
  code: string;
  name: string;
  zoneFocus: TrackTrainingZoneCode;
  tauDays: number;
  level: number;
  prior28dLevel: number;
  delta28d: number;
  targetLevel: number;
  daysSinceLastStimulus: number | null;
  decayedSincePeak: number;
  lastExecutionScore: number | null;
}

export interface TrackProgressionSummary {
  axes: TrackProgressionAxisLevel[];
  latestExecutionScore: TrackExecutionScoreResult | null;
  flukeProtectedCount: number;
  partialCreditCount: number;
  restCheatPenaltyCount: number;
}

export type BayesianQuarantineReason =
  | 'ACCEPTED'
  | 'SUB_180S_SPRINT_REP'
  | 'WIND_AIDED_OVER_2MPS'
  | 'REST_CHEATED_WORKOUT'
  | 'HEAT_ALTITUDE_FATIGUE_DRAG'
  | 'UNVERIFIED_OUTLIER_JUMP';

export interface BayesianCalibrationAuditEntry {
  activityId: string;
  date: string;
  activityName: string;
  impliedCsMps: number;
  impliedVdotAer: number;
  status: 'ACCEPTED' | 'QUARANTINED' | 'CONFIRMED_OVERRIDE';
  reasonCode: BayesianQuarantineReason;
  reasonDetail: string;
  executionScore: number | null;
  kalmanGainApplied: number;
}

export interface BayesianTrackCalibrationResult {
  priorCsMps: number;
  posteriorCsMps: number;
  priorThresholdPaceSecsPerKm: number;
  posteriorThresholdPaceSecsPerKm: number;
  priorDPrimeMeters: number;
  posteriorDPrimeMeters: number;
  priorVdotAer: number;
  posteriorVdotAer: number;
  acceptedCount: number;
  quarantinedCount: number;
  overrideCount: number;
  auditLog: BayesianCalibrationAuditEntry[];
}

/**
 * Work-only 4-pillar `0-100` Track Execution Score:
 *  - `0.35` Pace Adherence (`S_pace`)
 *  - `0.30` Split Discipline + Anti-"Workout Hero" penalty (`S_split`)
 *  - `0.15` Rest Fidelity with `1.8x` rest-cheating penalty (`S_rest`)
 *  - `0.20` Pa:Hr & Stride Retention (`S_drift`)
 */
export function computeTrackExecutionScore(
  input: TrackExecutionScoreInput
): TrackExecutionScoreResult {
  const splits = (input.workSplitsSecs || []).filter((s) => Number.isFinite(s) && s > 0);
  const k = splits.length;
  const target = Math.max(10, input.targetSplitSecs || (k > 0 ? splits[0] : 60));

  if (k === 0) {
    return {
      totalScore: 80,
      paceAdherenceScore: 80,
      splitDisciplineScore: 80,
      restFidelityScore: 100,
      driftRetentionScore: 80,
      positiveSplitFadePct: 0,
      mapePct: 0,
      cvPct: 0,
      meanActualRestSecs: input.plannedRestSecs || 0,
      workoutHeroFlag: false,
      restCheatingFlag: false,
      verdictLabel: 'Awaiting Interval Splits',
    };
  }

  // 1. Pace adherence (MAPE vs prescribed split target)
  const mapePct =
    splits.reduce((acc, s) => acc + Math.abs(s - target) / target, 0) * (100 / k);
  const paceAdherenceScore = clamp(100 - 4.5 * mapePct, 0, 100);

  // 2. Split discipline + Anti-"Workout Hero" opening blowup guard
  const sliceLen = k >= 4 ? 2 : 1;
  const openMean = splits.slice(0, sliceLen).reduce((a, b) => a + b, 0) / sliceLen;
  const closeMean = splits.slice(k - sliceLen).reduce((a, b) => a + b, 0) / sliceLen;
  const positiveSplitFadePct = Math.max(0, ((closeMean - openMean) / target) * 100);

  const meanSplit = splits.reduce((a, b) => a + b, 0) / k;
  const variance = splits.reduce((a, b) => a + (b - meanSplit) ** 2, 0) / k;
  const cvPct = (Math.sqrt(variance) / Math.max(1, meanSplit)) * 100;

  const workoutHeroFlag =
    k >= 2 &&
    ((splits[0] < target * 0.975 && splits[k - 1] > target * 1.025) ||
      (positiveSplitFadePct >= 5.0 && splits[0] < target * 0.985));
  const heroPenalty = workoutHeroFlag ? 22 : 0;

  const splitDisciplineScore = clamp(
    100 - 2.5 * positiveSplitFadePct - 2.0 * cvPct - heroPenalty,
    0,
    100
  );

  // 3. Rest fidelity (asymmetric 1.8x penalty on rest-cheating!)
  const plannedRest = Math.max(0, input.plannedRestSecs || 0);
  const actualArr = Array.isArray(input.actualRestSecs)
    ? input.actualRestSecs.filter((r) => Number.isFinite(r) && r >= 0)
    : typeof input.actualRestSecs === 'number' && Number.isFinite(input.actualRestSecs)
      ? [input.actualRestSecs]
      : [plannedRest];
  const meanActualRestSecs =
    actualArr.length > 0
      ? actualArr.reduce((a, b) => a + b, 0) / actualArr.length
      : plannedRest;

  let restFidelityScore = 100;
  if (plannedRest > 0) {
    if (meanActualRestSecs > plannedRest) {
      const excessPct = ((meanActualRestSecs - plannedRest) / plannedRest) * 100;
      restFidelityScore = clamp(100 - 1.8 * excessPct, 0, 100);
    } else if (meanActualRestSecs < plannedRest) {
      const shortPct = ((plannedRest - meanActualRestSecs) / plannedRest) * 100;
      restFidelityScore = clamp(100 - 0.4 * shortPct, 65, 100);
    }
  }
  const restCheatingFlag = plannedRest > 0 && restFidelityScore < 70;

  // 4. Pa:Hr cardiac & stride mechanical drift retention
  const decoupling = input.aerobicDecouplingPct ?? 2.5;
  const strideFade = input.strideLengthFadePct ?? 0;
  const driftRetentionScore = clamp(
    88 -
      Math.max(0, decoupling - 2.5) * 3.5 -
      positiveSplitFadePct * 1.5 -
      Math.max(0, -strideFade - 1.5) * 2.5 +
      (k >= 3 && decoupling <= 2.5 && positiveSplitFadePct <= 1.0 ? 8 : 0),
    0,
    100
  );

  const rawTotal =
    0.35 * paceAdherenceScore +
    0.30 * splitDisciplineScore +
    0.15 * restFidelityScore +
    0.20 * driftRetentionScore;
  const totalScore = round1(clamp(rawTotal, 0, 100));

  const verdictLabel = restCheatingFlag
    ? 'Rest-Cheated Session'
    : workoutHeroFlag
      ? 'Workout Hero Flag'
      : totalScore >= 90
        ? 'Precision Track Execution'
        : totalScore >= 75
          ? 'Controlled Stimulus'
          : 'High Metabolic Drift';

  return {
    totalScore,
    paceAdherenceScore: round1(paceAdherenceScore),
    splitDisciplineScore: round1(splitDisciplineScore),
    restFidelityScore: round1(restFidelityScore),
    driftRetentionScore: round1(driftRetentionScore),
    positiveSplitFadePct: round1(positiveSplitFadePct),
    mapePct: round1(mapePct),
    cvPct: round1(cvPct),
    meanActualRestSecs: Math.round(meanActualRestSecs),
    workoutHeroFlag,
    restCheatingFlag,
    verdictLabel,
  };
}

/**
 * Extracts work splits, recovery durations, and implied target split from a track or interval activity.
 */
export function extractTrackIntervalMetricsForActivity(
  activity: UnifiedActivity,
  fallbackThresholdPaceSecsPerKm: number = 240,
  plannedRestOverrideSecs?: number
): TrackExecutionScoreInput | null {
  const workReps = (activity.intervals || []).filter((iv) => iv.type === 'WORK');
  if (workReps.length >= 2) {
    const recReps = (activity.intervals || []).filter((iv) => iv.type === 'RECOVERY');
    const workSplitsSecs = workReps.map((w) => w.durationSecs);
    const meanRepDist =
      workReps.reduce((s, w) => s + (w.distanceMeters || 400), 0) / workReps.length;
    const meanSpeedMps =
      workReps.reduce(
        (s, w) =>
          s +
          ((w.distanceMeters || meanRepDist) / Math.max(1, w.durationSecs)),
        0
      ) / workReps.length;
    const safeThreshMps = 1000 / Math.max(115, fallbackThresholdPaceSecsPerKm || 240);
    // Expected split scales cleanly to threshold reference unless rep intensities match a steady rep set
    const impliedZoneMps =
      meanSpeedMps >= safeThreshMps * 1.12
        ? safeThreshMps * 1.16
        : meanSpeedMps >= safeThreshMps * 1.03
          ? safeThreshMps * 1.07
          : safeThreshMps;
    const targetSplitSecs = round1(meanRepDist / Math.max(1.5, impliedZoneMps));
    const plannedRestSecs =
      typeof plannedRestOverrideSecs === 'number'
        ? plannedRestOverrideSecs
        : recReps.length > 0
          ? recReps[0].durationSecs
          : 60;
    const actualRestSecs =
      recReps.length > 0 ? recReps.map((r) => r.durationSecs) : [plannedRestSecs];

    return {
      workSplitsSecs,
      targetSplitSecs,
      plannedRestSecs,
      actualRestSecs,
      aerobicDecouplingPct: activity.aerobicDecouplingPct,
    };
  }

  if (
    activity.officialRaceData?.lapSplitsSecs &&
    activity.officialRaceData.lapSplitsSecs.length >= 2
  ) {
    const splits = activity.officialRaceData.lapSplitsSecs;
    const avgSplit = splits.reduce((a, b) => a + b, 0) / splits.length;
    return {
      workSplitsSecs: splits,
      targetSplitSecs: round1(avgSplit),
      plannedRestSecs: 0,
      actualRestSecs: [0],
      aerobicDecouplingPct: activity.aerobicDecouplingPct,
    };
  }

  return null;
}

const AXIS_SPECS: Array<{
  axisId: TrackProgressionAxisId;
  code: string;
  name: string;
  zoneFocus: TrackTrainingZoneCode;
  tauDays: number;
  defaultTarget: number;
}> = [
  {
    axisId: 'SUB_THRESHOLD_CV',
    code: 'Sub-T / CV',
    name: 'Sub-Threshold & Critical Velocity Density',
    zoneFocus: 'CV',
    tauDays: 45,
    defaultTarget: 8.2,
  },
  {
    axisId: 'VO2MAX_AEROBIC_POWER',
    code: 'VO2max (I)',
    name: 'Maximal Aerobic Power Intervals',
    zoneFocus: 'I',
    tauDays: 35,
    defaultTarget: 8.5,
  },
  {
    axisId: 'RACE_PACE_STAMINA',
    code: 'Race Stamina',
    name: 'Specific Event Pace & Stamina',
    zoneFocus: 'R',
    tauDays: 50,
    defaultTarget: 8.4,
  },
  {
    axisId: 'GLYCOLYTIC_SPEED_ENDURANCE',
    code: "Glycolytic (D')",
    name: "Anaerobic Capacity & D' Reserve",
    zoneFocus: 'FR',
    tauDays: 28,
    defaultTarget: 8.0,
  },
  {
    axisId: 'MAX_VELOCITY_NEUROMUSCULAR',
    code: 'Max-V / Neuro',
    name: 'Neuromuscular Alactic Flys & Coordination',
    zoneFocus: 'FR',
    tauDays: 21,
    defaultTarget: 7.8,
  },
];

function diffDaysIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function classifyActivityAxisWeights(
  act: UnifiedActivity,
  thresholdPaceSecsPerKm: number
): Record<TrackProgressionAxisId, number> {
  const name = (act.name || '').toLowerCase();
  const pace = act.gapPaceSecsPerKm || act.avgPaceSecsPerKm || thresholdPaceSecsPerKm;
  const ratio = thresholdPaceSecsPerKm / Math.max(95, pace); // >1.0 faster than T-pace
  const isTrackOrRace = act.subType === 'Track' || Boolean(act.officialRaceData);
  const workReps = (act.intervals || []).filter((i) => i.type === 'WORK');
  const meanDist =
    workReps.length > 0
      ? workReps.reduce((s, w) => s + (w.distanceMeters || 400), 0) / workReps.length
      : act.officialRaceData?.eventDistanceMeters || 0;

  const w: Record<TrackProgressionAxisId, number> = {
    SUB_THRESHOLD_CV: 0.25,
    VO2MAX_AEROBIC_POWER: 0.15,
    RACE_PACE_STAMINA: 0.15,
    GLYCOLYTIC_SPEED_ENDURANCE: 0.1,
    MAX_VELOCITY_NEUROMUSCULAR: 0.1,
  };

  if (act.officialRaceData || /race|meet|mile|800m|1500m|1600m|3200m/i.test(name)) {
    w.RACE_PACE_STAMINA = 1.0;
    w.VO2MAX_AEROBIC_POWER = 0.55;
    if (meanDist <= 900 || /400m|800m|fr\b/i.test(name)) {
      w.GLYCOLYTIC_SPEED_ENDURANCE = 0.95;
      w.MAX_VELOCITY_NEUROMUSCULAR = 0.65;
    }
    return w;
  }

  if (/fly|150m|200m|hill|sprint|stride|max\s*v|alactic/i.test(name) || (meanDist > 0 && meanDist <= 220)) {
    w.MAX_VELOCITY_NEUROMUSCULAR = 1.0;
    w.GLYCOLYTIC_SPEED_ENDURANCE = 0.7;
    w.RACE_PACE_STAMINA = 0.45;
    return w;
  }

  if (/sub-?t|cv\b|critical|tempo|threshold|cruise/i.test(name) || (ratio >= 0.9 && ratio <= 1.04 && isTrackOrRace)) {
    w.SUB_THRESHOLD_CV = 1.0;
    w.RACE_PACE_STAMINA = 0.5;
    return w;
  }

  if (/vo2|interval|1000m|800m|400m/i.test(name) || ratio >= 1.04 || isTrackOrRace) {
    w.VO2MAX_AEROBIC_POWER = 1.0;
    w.SUB_THRESHOLD_CV = 0.45;
    w.RACE_PACE_STAMINA = 0.65;
    w.GLYCOLYTIC_SPEED_ENDURANCE = ratio >= 1.12 ? 0.85 : 0.4;
    return w;
  }

  // Steady Z1/Z2 aerobic maintenance maintains Sub-T slightly without spiking anaerobically
  w.SUB_THRESHOLD_CV = Math.min(0.45, (act.movingTimeSecs || 0) / 5400);
  w.VO2MAX_AEROBIC_POWER = 0.1;
  w.RACE_PACE_STAMINA = 0.1;
  w.GLYCOLYTIC_SPEED_ENDURANCE = 0;
  w.MAX_VELOCITY_NEUROMUSCULAR = 0;
  return w;
}

/**
 * Computes the 5-Axis Track Progression Levels (`1.0-10.0`) with `14d` inactivity decay onset,
 * `0.85` `TRK-08` stimulus credit preservation, anti-rest-cheating discounting, and
 * low-HRV fluke-day protection (`-0.15` floor cap).
 */
export function computeTrackProgressionLevels(params: {
  activities: UnifiedActivity[];
  wellnessDays?: UnifiedWellnessDay[];
  athleteProfile?: Partial<AthleteProfile>;
  referenceDateIso?: string;
  targetOverrides?: Partial<Record<TrackProgressionAxisId, number>>;
  plannedRestByActivityId?: Record<string, number>;
}): TrackProgressionSummary {
  const {
    activities,
    wellnessDays = [],
    athleteProfile,
    referenceDateIso,
    targetOverrides,
    plannedRestByActivityId = {},
  } = params;

  const runs = activities
    .filter((a) => a.sportCategory === 'Running')
    .slice()
    .sort((a, b) => (a.startDateLocal || '').localeCompare(b.startDateLocal || ''));

  const refDate =
    referenceDateIso?.slice(0, 10) ||
    runs[runs.length - 1]?.startDateLocal.slice(0, 10) ||
    getLocalDateIso();

  const wellnessByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of wellnessDays) {
    if (w?.date) wellnessByDate.set(w.date.slice(0, 10), w);
  }

  const thresholdPace = athleteProfile?.thresholdPaceSecsPerKm || 230;
  const priorCutoffIso = new Date(
    new Date(`${refDate}T12:00:00Z`).getTime() - 28 * 86400000
  )
    .toISOString()
    .slice(0, 10);

  const replayState = (upToIso: string) => {
    const levels: Record<TrackProgressionAxisId, number> = {
      SUB_THRESHOLD_CV: 2.8,
      VO2MAX_AEROBIC_POWER: 2.5,
      RACE_PACE_STAMINA: 2.4,
      GLYCOLYTIC_SPEED_ENDURANCE: 2.2,
      MAX_VELOCITY_NEUROMUSCULAR: 2.2,
    };
    const lastStimDate: Partial<Record<TrackProgressionAxisId, string>> = {};
    const decayedAmount: Record<TrackProgressionAxisId, number> = {
      SUB_THRESHOLD_CV: 0,
      VO2MAX_AEROBIC_POWER: 0,
      RACE_PACE_STAMINA: 0,
      GLYCOLYTIC_SPEED_ENDURANCE: 0,
      MAX_VELOCITY_NEUROMUSCULAR: 0,
    };
    const lastExecScore: Partial<Record<TrackProgressionAxisId, number>> = {};

    let latestExecutionScore: TrackExecutionScoreResult | null = null;
    let flukeProtectedCount = 0;
    let partialCreditCount = 0;
    let restCheatPenaltyCount = 0;

    for (const act of runs) {
      const actDate = (act.startDateLocal || '').slice(0, 10);
      if (!actDate || actDate > upToIso) continue;

      const weights = classifyActivityAxisWeights(act, thresholdPace);
      const metrics = extractTrackIntervalMetricsForActivity(
        act,
        thresholdPace,
        plannedRestByActivityId[act.id]
      );
      const exec = metrics ? computeTrackExecutionScore(metrics) : null;
      if (exec) latestExecutionScore = exec;

      const stimulusRatio = clamp(act.stimulusCompletionRatio ?? 1.0, 0.25, 1.0);
      if (stimulusRatio < 1.0) partialCreditCount++;

      const wellness = wellnessByDate.get(actDate);
      const isFlukeLowDay = Boolean(
        wellness &&
          (wellness.hrvStatus === 'Low' ||
            wellness.readinessStatus === 'Strain' ||
            (wellness.hrvBaseline7d > 0 && wellness.hrvRMSSD < wellness.hrvBaseline7d * 0.86))
      );

      let execMultiplier = 1.0;
      if (exec) {
        if (exec.restCheatingFlag) {
          execMultiplier = 0.2;
          restCheatPenaltyCount++;
        } else if (exec.workoutHeroFlag) {
          execMultiplier = 0.45;
        } else {
          execMultiplier = 0.45 + 0.55 * (exec.totalScore / 100);
        }
      }

      const loadScale = clamp((act.trainingLoad || 55) / 75, 0.45, 1.5);

      for (const spec of AXIS_SPECS) {
        const weight = weights[spec.axisId];
        if (weight <= 0.05) continue;

        const prevDate = lastStimDate[spec.axisId];
        if (prevDate) {
          const gapDays = diffDaysIso(prevDate, actDate);
          if (gapDays > 14) {
            const before = levels[spec.axisId];
            const after =
              1.0 + (before - 1.0) * Math.exp(-(gapDays - 14) / spec.tauDays);
            decayedAmount[spec.axisId] += Math.max(0, before - after);
            levels[spec.axisId] = after;
          }
        }

        const baseStep = 0.72 * weight * loadScale * stimulusRatio * execMultiplier;
        let nextVal = levels[spec.axisId] + baseStep * (1 - (levels[spec.axisId] - 1) / 10.5);

        if (isFlukeLowDay && exec && exec.totalScore < 68) {
          nextVal = Math.max(levels[spec.axisId] - 0.15, nextVal - 0.12);
          flukeProtectedCount++;
        }

        levels[spec.axisId] = clamp(nextVal, 1.0, 10.0);
        lastStimDate[spec.axisId] = actDate;
        if (exec) lastExecScore[spec.axisId] = exec.totalScore;
      }
    }

    // Apply trailing inactivity decay from last stimulus to `upToIso`
    for (const spec of AXIS_SPECS) {
      const prevDate = lastStimDate[spec.axisId];
      if (prevDate) {
        const gapDays = diffDaysIso(prevDate, upToIso);
        if (gapDays > 14) {
          const before = levels[spec.axisId];
          const after =
            1.0 + (before - 1.0) * Math.exp(-(gapDays - 14) / spec.tauDays);
          decayedAmount[spec.axisId] += Math.max(0, before - after);
          levels[spec.axisId] = clamp(after, 1.0, 10.0);
        }
      }
    }

    return {
      levels,
      lastStimDate,
      decayedAmount,
      lastExecScore,
      latestExecutionScore,
      flukeProtectedCount,
      partialCreditCount,
      restCheatPenaltyCount,
    };
  };

  const cur = replayState(refDate);
  const prior = replayState(priorCutoffIso);

  const axes: TrackProgressionAxisLevel[] = AXIS_SPECS.map((spec) => {
    const level = round1(cur.levels[spec.axisId]);
    const prior28dLevel = round1(prior.levels[spec.axisId]);
    const prevDate = cur.lastStimDate[spec.axisId];
    return {
      axisId: spec.axisId,
      code: spec.code,
      name: spec.name,
      zoneFocus: spec.zoneFocus,
      tauDays: spec.tauDays,
      level,
      prior28dLevel,
      delta28d: round1(level - prior28dLevel),
      targetLevel: targetOverrides?.[spec.axisId] ?? spec.defaultTarget,
      daysSinceLastStimulus: prevDate ? diffDaysIso(prevDate, refDate) : null,
      decayedSincePeak: round1(cur.decayedAmount[spec.axisId]),
      lastExecutionScore: cur.lastExecScore[spec.axisId] ?? null,
    };
  });

  return {
    axes,
    latestExecutionScore: cur.latestExecutionScore,
    flukeProtectedCount: cur.flukeProtectedCount,
    partialCreditCount: cur.partialCreditCount,
    restCheatPenaltyCount: cur.restCheatPenaltyCount,
  };
}

function parseWindSpeedFromReading(windReading?: string): number {
  if (!windReading) return 0;
  const match = windReading.match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Huber-weighted 1D Bayesian / Kalman `CS / D' / VDOT_aer` calibrator that quarantines
 * `<180s` sprints, `>+2.0 m/s` tailwinds, rest-cheated sessions (`S_rest < 70`),
 * hot/fatigue downward slowdowns, and unverified outlier jumps until confirmed in the UI drawer.
 */
export function runBayesianTrackCalibrator(params: {
  activities: UnifiedActivity[];
  wellnessDays?: UnifiedWellnessDay[];
  priorThresholdPaceSecsPerKm: number;
  priorDPrimeMeters?: number;
  confirmedQuarantineIds?: string[];
  plannedRestByActivityId?: Record<string, number>;
}): BayesianTrackCalibrationResult {
  const {
    activities,
    wellnessDays = [],
    priorThresholdPaceSecsPerKm,
    priorDPrimeMeters = 220,
    confirmedQuarantineIds = [],
    plannedRestByActivityId = {},
  } = params;

  const baseProfile = buildTrackSpeedReserveProfile({
    thresholdPaceSecsPerKm: priorThresholdPaceSecsPerKm || 240,
  });
  const priorCsMps = baseProfile.csMps;
  const priorVdotAer = baseProfile.vdotAer;
  let postCs = priorCsMps;
  let postDPrime = clamp(priorDPrimeMeters, 110, 420);
  let posteriorVariance = 0.04; // (0.20 m/s)^2 prior uncertainty

  const confirmedSet = new Set(confirmedQuarantineIds);
  const wellnessByDate = new Map<string, UnifiedWellnessDay>();
  for (const w of wellnessDays) {
    if (w?.date) wellnessByDate.set(w.date.slice(0, 10), w);
  }

  const candidates = activities
    .filter(
      (a) =>
        a.sportCategory === 'Running' &&
        (Boolean(a.officialRaceData) ||
          a.subType === 'Track' ||
          ((a.intervals || []).filter((i) => i.type === 'WORK').length >= 2))
    )
    .slice()
    .sort((a, b) => (a.startDateLocal || '').localeCompare(b.startDateLocal || ''));

  const auditLog: BayesianCalibrationAuditEntry[] = [];
  let acceptedCount = 0;
  let quarantinedCount = 0;
  let overrideCount = 0;

  for (const act of candidates) {
    const actDate = (act.startDateLocal || '').slice(0, 10);
    const workReps = (act.intervals || []).filter((i) => i.type === 'WORK');
    const metrics = extractTrackIntervalMetricsForActivity(
      act,
      (1000 / Math.max(2.0, postCs)) * 1.07,
      plannedRestByActivityId[act.id]
    );
    const exec = metrics ? computeTrackExecutionScore(metrics) : null;

    // Infer implied performance CS (m/s)
    let impliedCs = postCs;
    let totalQualityDurationSecs = 0;

    if (act.officialRaceData) {
      const dist = Math.max(100, act.officialRaceData.eventDistanceMeters);
      const secs = Math.max(12, act.officialRaceData.fatTimeSecs);
      totalQualityDurationSecs = secs;
      const raceVdot = computeRawMarkVdot(dist, secs);
      const cvPaceSecsKm = solveTrackPaceSecsPerKmForPctVdot(raceVdot * 0.975, 0.9215, [115, 520]);
      impliedCs = 1000 / cvPaceSecsKm;
    } else if (workReps.length >= 2) {
      const totalDist = workReps.reduce((s, w) => s + (w.distanceMeters || 400), 0);
      totalQualityDurationSecs = workReps.reduce((s, w) => s + w.durationSecs, 0);
      const avgSpeed = totalDist / Math.max(1, totalQualityDurationSecs);
      // Assume high-quality track interval reps average ~1.06x CS; use conservative aerobic conversion
      impliedCs = avgSpeed / 1.06;
    } else {
      totalQualityDurationSecs = act.movingTimeSecs || 600;
      const speed = 1000 / Math.max(120, act.gapPaceSecsPerKm || act.avgPaceSecsPerKm || 240);
      impliedCs = speed / 0.94;
    }

    impliedCs = clamp(impliedCs, 2.3, 6.8);
    const windMps = parseWindSpeedFromReading(act.officialRaceData?.windReading);
    const wellness = wellnessByDate.get(actDate);
    const nameLower = `${act.name || ''} ${act.quickLog?.notes || ''}`.toLowerCase();
    const heatOrFatigue =
      /heat|hot|humid|altitude|tired|heavy|sick/.test(nameLower) ||
      wellness?.readinessStatus === 'Strain' ||
      wellness?.hrvStatus === 'Low';

    let reasonCode: BayesianQuarantineReason = 'ACCEPTED';
    let reasonDetail = 'Verified track performance folded into Huber-Kalman posterior.';

    if (totalQualityDurationSecs < 180) {
      reasonCode = 'SUB_180S_SPRINT_REP';
      reasonDetail = `Total fast effort (${Math.round(totalQualityDurationSecs)}s < 180s) anchors anaerobic sprint speed, not Critical Speed.`;
    } else if (windMps > 2.0) {
      reasonCode = 'WIND_AIDED_OVER_2MPS';
      reasonDetail = `Wind-aided reading (+${windMps.toFixed(1)} m/s > +2.0 m/s legal limit); excluded from CS promotion.`;
    } else if (exec?.restCheatingFlag) {
      reasonCode = 'REST_CHEATED_WORKOUT';
      reasonDetail = `Recovery stretched (${exec.meanActualRestSecs}s vs ${metrics?.plannedRestSecs}s plan · S_rest ${exec.restFidelityScore}); split speed quarantined.`;
    } else if (heatOrFatigue && impliedCs < postCs) {
      reasonCode = 'HEAT_ALTITUDE_FATIGUE_DRAG';
      reasonDetail = 'Environmental heat/altitude or autonomic strain slowed pace; downward CS drag blocked.';
    } else if (!act.officialRaceData && (impliedCs - postCs) / Math.max(1, postCs) > 0.065) {
      reasonCode = 'UNVERIFIED_OUTLIER_JUMP';
      reasonDetail = `Workout pace implies +${(((impliedCs - postCs) / postCs) * 100).toFixed(1)}% CS jump without FAT race verification.`;
    }

    const isQuarantined = reasonCode !== 'ACCEPTED' && !confirmedSet.has(act.id);
    const isConfirmedOverride = reasonCode !== 'ACCEPTED' && confirmedSet.has(act.id);

    let gainApplied = 0;
    if (!isQuarantined) {
      const obsNoiseR = act.officialRaceData ? 0.015 : 0.045;
      const innov = impliedCs - postCs;
      const huberDelta = 0.22; // m/s threshold before down-weighting innovation
      const huberScale =
        Math.abs(innov) <= huberDelta ? 1 : huberDelta / Math.abs(innov);
      const rawK = posteriorVariance / (posteriorVariance + obsNoiseR);
      gainApplied = round2(rawK * huberScale);
      postCs = clamp(postCs + gainApplied * innov, 2.4, 6.8);
      posteriorVariance = clamp((1 - rawK * huberScale) * posteriorVariance + 0.002, 0.006, 0.08);
      if (isConfirmedOverride) overrideCount++;
      else acceptedCount++;
    } else {
      quarantinedCount++;
    }

    const impliedVdot = round1(
      vo2AtVelocityMpm(impliedCs * 60) / pctVo2MaxAtDurationMins(35)
    );

    auditLog.push({
      activityId: act.id,
      date: actDate,
      activityName: act.name,
      impliedCsMps: round2(impliedCs),
      impliedVdotAer: clamp(impliedVdot, 22, 92),
      status: isQuarantined
        ? 'QUARANTINED'
        : isConfirmedOverride
          ? 'CONFIRMED_OVERRIDE'
          : 'ACCEPTED',
      reasonCode,
      reasonDetail,
      executionScore: exec ? exec.totalScore : null,
      kalmanGainApplied: gainApplied,
    });
  }

  const posteriorVdotAer = round1(
    clamp(vo2AtVelocityMpm(postCs * 60) / pctVo2MaxAtDurationMins(35), 22, 92)
  );
  const posteriorThresholdPaceSecsPerKm = solveTrackPaceSecsPerKmForPctVdot(
    posteriorVdotAer,
    0.88,
    [125, 500]
  );

  return {
    priorCsMps: round2(priorCsMps),
    posteriorCsMps: round2(postCs),
    priorThresholdPaceSecsPerKm: round1(priorThresholdPaceSecsPerKm || 240),
    posteriorThresholdPaceSecsPerKm: round1(posteriorThresholdPaceSecsPerKm),
    priorDPrimeMeters: Math.round(priorDPrimeMeters),
    posteriorDPrimeMeters: Math.round(postDPrime),
    priorVdotAer: round1(priorVdotAer),
    posteriorVdotAer,
    acceptedCount,
    quarantinedCount,
    overrideCount,
    auditLog,
  };
}
