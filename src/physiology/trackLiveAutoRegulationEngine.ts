import type { TrackTrainingZoneCode, VdotPodIntensity } from '../types.ts';

export type TrackLiveAutoRegCueType =
  | 'NONE'
  | 'HERO_PACE_BRAKE'
  | 'METABOLIC_DRIFT_REST'
  | 'CV_CONVERSION_PIVOT'
  | 'NEURO_STOP_RULE';

export type TrackLiveAutoRegAction =
  | 'NONE'
  | 'EXTEND_REST_30S'
  | 'CONVERT_REMAINING_TO_CV'
  | 'END_SESSION_85_STIMULUS';

export interface RunnerLiveAutoRegInput {
  runnerId: string;
  runnerName: string;
  podKey: string;
  lapSplitsSecs: number[];
  plannedRepCount: number;
  repDistanceMeters: number;
  restDurationSecs: number;
  thresholdPaceSecsPerKm: number;
  dPrimeCapMeters?: number;
  targetSplitSecs?: number | null;
  intensity?: VdotPodIntensity;
  zoneCode?: TrackTrainingZoneCode;
}

export interface RunnerLiveAutoRegState {
  runnerId: string;
  runnerName: string;
  podKey: string;
  completedReps: number;
  plannedReps: number;
  referenceSplitSecs: number | null;
  lastSplitSecs: number | null;
  fadePct: number;
  consecutiveFadeCount: number;
  dPrimeCapMeters: number;
  dPrimeBalanceMeters: number;
  dPrimeBalancePct: number;
  cueType: TrackLiveAutoRegCueType;
  recommendedAction: TrackLiveAutoRegAction;
  headline: string;
  coachingCue: string;
  signature: string;
}

export interface SquadLiveAutoRegSummary {
  byRunnerId: Record<string, RunnerLiveAutoRegState>;
  primaryAlert: RunnerLiveAutoRegState | null;
  activeAlerts: RunnerLiveAutoRegState[];
}

const CUE_PRIORITY: Record<TrackLiveAutoRegCueType, number> = {
  NEURO_STOP_RULE: 4,
  CV_CONVERSION_PIVOT: 3,
  METABOLIC_DRIFT_REST: 2,
  HERO_PACE_BRAKE: 1,
  NONE: 0,
};

function isSupraThresholdSession(
  intensity?: VdotPodIntensity,
  zoneCode?: TrackTrainingZoneCode
): boolean {
  if (zoneCode === 'I' || zoneCode === 'R' || zoneCode === 'FR') return true;
  if (zoneCode === 'CV' || zoneCode === 'T' || zoneCode === 'SUB_T' || zoneCode === 'E') {
    return false;
  }
  return (
    intensity === 'INTERVAL_VO2' ||
    intensity === 'RACE_3200M' ||
    intensity === 'REPETITION' ||
    intensity === 'RACE_1600M' ||
    intensity === 'RACE_800M' ||
    intensity === 'RACE_400M'
  );
}

/**
 * Evaluates live intra-session Fade %, differential running D' balance, and prioritized
 * trackside coaching cues / 1-tap mid-workout pivots (`HERO_PACE_BRAKE`, `METABOLIC_DRIFT_REST`,
 * `CV_CONVERSION_PIVOT`, `NEURO_STOP_RULE`).
 */
export function evaluateRunnerLiveAutoRegulation(
  input: RunnerLiveAutoRegInput
): RunnerLiveAutoRegState {
  const validSplits = (input.lapSplitsSecs || []).filter(
    (s) => Number.isFinite(s) && s > 0
  );
  const plannedReps = Math.max(1, Math.round(input.plannedRepCount || 6));
  const repDist = Math.max(100, input.repDistanceMeters || 400);
  const restSecs = Math.max(0, input.restDurationSecs ?? 60);
  const safeThresholdPace = Math.max(115, Math.min(540, input.thresholdPaceSecsPerKm || 245));
  const csMps = 1000 / safeThresholdPace;
  const dCap = Math.max(110, Math.min(420, input.dPrimeCapMeters ?? 220));
  const tauD = 180;

  let dBal = dCap;
  for (let i = 0; i < validSplits.length; i++) {
    const repSecs = Math.max(1, validSplits[i]);
    const vRep = repDist / repSecs;
    if (vRep > csMps) {
      dBal = Math.max(0, dBal - (vRep - csMps) * repSecs);
    }
    if (i < validSplits.length - 1 && restSecs > 0) {
      dBal = Math.min(dCap, dBal + (dCap - dBal) * (1 - Math.exp(-restSecs / tauD)));
    }
  }

  const dPrimeBalanceMeters = Number(dBal.toFixed(1));
  const dPrimeBalancePct = Math.round(Math.max(0, Math.min(100, (dBal / dCap) * 100)));

  const referenceSplitSecs =
    typeof input.targetSplitSecs === 'number' &&
    Number.isFinite(input.targetSplitSecs) &&
    input.targetSplitSecs > 0
      ? Number(input.targetSplitSecs.toFixed(2))
      : validSplits.length >= 2
        ? Number(((validSplits[0] + validSplits[1]) / 2).toFixed(2))
        : null;

  const lastSplitSecs =
    validSplits.length > 0 ? Number(validSplits[validSplits.length - 1].toFixed(2)) : null;

  const fadePct =
    lastSplitSecs !== null && referenceSplitSecs !== null && referenceSplitSecs > 0
      ? Number((((lastSplitSecs - referenceSplitSecs) / referenceSplitSecs) * 100).toFixed(1))
      : 0;

  let consecutiveFadeCount = 0;
  if (referenceSplitSecs !== null && referenceSplitSecs > 0) {
    for (let i = validSplits.length - 1; i >= 0; i--) {
      if (validSplits[i] > referenceSplitSecs * 1.025) {
        consecutiveFadeCount++;
      } else {
        break;
      }
    }
  }

  let cueType: TrackLiveAutoRegCueType = 'NONE';
  let recommendedAction: TrackLiveAutoRegAction = 'NONE';
  let headline = 'On Target Split Rhythm';
  let coachingCue = `Split control steady (${dPrimeBalancePct}% D' reserve intact).`;

  if (validSplits.length > 0 && referenceSplitSecs !== null && lastSplitSecs !== null) {
    const halfPlanThreshold = Math.max(2, Math.ceil(plannedReps * 0.5));
    const isSupra = isSupraThresholdSession(input.intensity, input.zoneCode);

    if (
      validSplits.length >= halfPlanThreshold &&
      (fadePct > 4.5 || dPrimeBalancePct < 15)
    ) {
      cueType = 'NEURO_STOP_RULE';
      recommendedAction = 'END_SESSION_85_STIMULUS';
      headline = `Neuro / D' Stop Rule Triggered (${validSplits.length}/${plannedReps} reps)`;
      coachingCue =
        dPrimeBalancePct < 15
          ? `Anaerobic reserve depleted to ${dPrimeBalancePct}% D' (${fadePct >= 0 ? '+' : ''}${fadePct.toFixed(1)}% split drift). End now with 85% stimulus credit intact.`
          : `Closing rep faded +${fadePct.toFixed(1)}% (${lastSplitSecs.toFixed(1)}s vs ${referenceSplitSecs.toFixed(1)}s target). Cap session cleanly with 85% stimulus credit.`;
    } else if (isSupra && consecutiveFadeCount >= 2) {
      cueType = 'CV_CONVERSION_PIVOT';
      recommendedAction = 'CONVERT_REMAINING_TO_CV';
      headline = `2 Consecutive VO2 Fades (+${fadePct.toFixed(1)}%) — Pivot to CV`;
      coachingCue = `Last ${consecutiveFadeCount} reps slipped >2.5% slower than target (${referenceSplitSecs.toFixed(1)}s). Convert remaining reps to Critical Velocity (CV) to keep mitochondrial quality high.`;
    } else if (
      validSplits.length >= 2 &&
      ((fadePct >= 2.5 && fadePct <= 4.5) || (dPrimeBalancePct < 35 && fadePct > 1.0))
    ) {
      cueType = 'METABOLIC_DRIFT_REST';
      recommendedAction = 'EXTEND_REST_30S';
      headline = `Metabolic Drift Detected (+${fadePct.toFixed(1)}% · ${dPrimeBalancePct}% D')`;
      coachingCue = `Extending recovery +30s restores PCr/D' clearance so remaining splits stay crisp instead of grinding.`;
    } else if (validSplits.length <= 2 && fadePct < -3.0) {
      const tooFastSecs = Math.max(0.5, referenceSplitSecs - lastSplitSecs).toFixed(1);
      cueType = 'HERO_PACE_BRAKE';
      recommendedAction = dPrimeBalancePct < 65 ? 'EXTEND_REST_30S' : 'NONE';
      headline = `Hero Pace Brake (${fadePct.toFixed(1)}% fast · -${tooFastSecs}s)`;
      coachingCue = `Rep ${validSplits.length} ran ${tooFastSecs}s faster than ${referenceSplitSecs.toFixed(1)}s target (${dPrimeBalancePct}% D' left). Ease back on the next rep to prevent a late crash.`;
    } else {
      headline = `On Target (${fadePct >= 0 ? '+' : ''}${fadePct.toFixed(1)}%)`;
      coachingCue = `${input.runnerName} holding rhythm with ${dPrimeBalancePct}% D' reserve.`;
    }
  }

  return {
    runnerId: input.runnerId,
    runnerName: input.runnerName,
    podKey: input.podKey,
    completedReps: validSplits.length,
    plannedReps,
    referenceSplitSecs,
    lastSplitSecs,
    fadePct,
    consecutiveFadeCount,
    dPrimeCapMeters: Math.round(dCap),
    dPrimeBalanceMeters,
    dPrimeBalancePct,
    cueType,
    recommendedAction,
    headline,
    coachingCue,
    signature: `${input.runnerId}:${cueType}:${validSplits.length}`,
  };
}

/**
 * Evaluates live auto-regulation telemetry across every timed athlete/pod in `#stopwatch`,
 * returning both per-runner state and the highest-priority non-dismissed team/solo alert.
 */
export function evaluateSquadLiveAutoRegulation(
  inputs: RunnerLiveAutoRegInput[],
  dismissedSignatures: string[] = []
): SquadLiveAutoRegSummary {
  const dismissed = new Set(dismissedSignatures);
  const byRunnerId: Record<string, RunnerLiveAutoRegState> = {};
  const alerts: RunnerLiveAutoRegState[] = [];

  for (const input of inputs) {
    const state = evaluateRunnerLiveAutoRegulation(input);
    byRunnerId[input.runnerId] = state;
    if (state.cueType !== 'NONE' && !dismissed.has(state.signature)) {
      alerts.push(state);
    }
  }

  alerts.sort((a, b) => {
    const prioDiff = CUE_PRIORITY[b.cueType] - CUE_PRIORITY[a.cueType];
    if (prioDiff !== 0) return prioDiff;
    return Math.abs(b.fadePct) - Math.abs(a.fadePct);
  });

  return {
    byRunnerId,
    primaryAlert: alerts[0] ?? null,
    activeAlerts: alerts,
  };
}
