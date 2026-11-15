import type {
  PlannedWorkoutEvent,
  SpeedReservePhenotype,
  TrackRepDistanceMeters,
  TrackSeasonPhase,
  TrackSpeedReserveProfile,
  TrackTargetEventGroup,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  VdotPodIntensity,
} from '../types';
import { blendTrackZonesForWeek } from './trackSpeedReserveEngine';

export type TrackStartingPhaseOption = 'FULL_PROGRESSION' | TrackSeasonPhase;

export interface GenerateTrackPlanInput {
  startDateIso: string;
  blockWeeks: 4 | 8 | 12 | 16;
  eventGroup: TrackTargetEventGroup;
  dateProfile: TrackSpeedReserveProfile;
  startingPhase?: TrackStartingPhaseOption;
  phenotypeOverride?: SpeedReservePhenotype | 'AUTO';
  goalTimeSecs?: number;
  weeklyBaselineDistanceKm?: number;
  athleticDays?: number;
}

export interface GeneratedTrackWeekPlan {
  weekNum: number;
  startDate: string;
  phaseKey: TrackSeasonPhase;
  phaseLabel: string;
  isDeload: boolean;
  isTaper: boolean;
  targetHours: number;
  targetTss: number;
  targetDistanceKm: number;
  ambitiousGoalWarning: boolean;
  zoneDistributionPct: [number, number, number, number, number, number];
  sessions: PlannedWorkoutEvent[];
}

export interface GeneratedTrackPlanSummary {
  eventGroup: TrackTargetEventGroup;
  phenotype: SpeedReservePhenotype;
  vdotAer: number;
  csMps: number;
  dPrimeMeters: number;
  asrMps: number;
  ambitiousGoalWarning: boolean;
  deltaMaxPct: number;
  rawGoalGapPct: number;
  weeks: GeneratedTrackWeekPlan[];
}

const ZONE_TO_POD_INTENSITY: Record<TrackTrainingZoneCode, VdotPodIntensity> = {
  E: 'EASY',
  SUB_T: 'SUB_THRESHOLD',
  T: 'THRESHOLD_CV',
  CV: 'THRESHOLD_CV',
  I: 'INTERVAL_VO2',
  R: 'REPETITION',
  FR: 'RACE_800M',
};

const ZONE_TO_PARSED_PCT: Record<TrackTrainingZoneCode, number> = {
  E: 68,
  SUB_T: 94,
  T: 98,
  CV: 102,
  I: 112,
  R: 120,
  FR: 132,
};

const PHASE_DISPLAY_NAMES: Record<TrackSeasonPhase, string> = {
  BASE: 'Base Building & Sub-T',
  STRENGTH_CV: 'Strength & Tinman CV',
  SPECIFIC: 'Race-Specific Track Peak',
  PEAK_TAPER: 'Championship Peak & Taper',
};

function addDaysIso(isoDate: string, daysToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + daysToAdd);
  return dt.toISOString().slice(0, 10);
}

export function formatTrackSplitToken(secs: number): string {
  const s = Number(Math.max(10, secs).toFixed(1));
  if (s < 75) return `${s.toFixed(1)}s`;
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, '0')}`;
}

export function formatRestDurationCue(secs: number): string {
  if (secs >= 120 && secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

function getZoneSplitForMeters(
  paceSecsPerKm: number,
  meters: TrackRepDistanceMeters
): number {
  return Number(((paceSecsPerKm * meters) / 1000).toFixed(1));
}

function resolvePhaseForWeek(
  weekNum: number,
  totalWeeks: number,
  startingPhase: TrackStartingPhaseOption
): TrackSeasonPhase {
  const frac = (weekNum - 1) / Math.max(1, totalWeeks);
  if (startingPhase === 'FULL_PROGRESSION') {
    if (frac < 0.25) return 'BASE';
    if (frac < 0.5) return 'STRENGTH_CV';
    if (frac < 0.78) return 'SPECIFIC';
    return 'PEAK_TAPER';
  }
  if (startingPhase === 'BASE') {
    if (frac < 0.45) return 'BASE';
    if (frac < 0.7) return 'STRENGTH_CV';
    if (frac < 0.88) return 'SPECIFIC';
    return 'PEAK_TAPER';
  }
  if (startingPhase === 'STRENGTH_CV') {
    if (frac < 0.48) return 'STRENGTH_CV';
    if (frac < 0.82) return 'SPECIFIC';
    return 'PEAK_TAPER';
  }
  if (startingPhase === 'SPECIFIC') {
    if (frac < 0.75) return 'SPECIFIC';
    return 'PEAK_TAPER';
  }
  return 'PEAK_TAPER';
}

interface QualityTemplate {
  titlePrefix: string;
  repCount: number;
  repDistance: TrackRepDistanceMeters;
  zone: TrackTrainingZoneCode;
  restSecs: number;
  recoveryLabel: string;
  warmupMins: number;
  cooldownMins: number;
  note: string;
}

const SINGLE_SESSION_CAPS_METERS: Record<TrackTrainingZoneCode, number> = {
  E: 28000,
  SUB_T: 10000,
  T: 10000,
  CV: 8000,
  I: 6000,
  R: 4800,
  FR: 2400,
};

const WEEKLY_PCT_CAPS: Record<TrackTrainingZoneCode, number> = {
  E: 1.0,
  SUB_T: 0.12,
  T: 0.10,
  CV: 0.08,
  I: 0.08,
  R: 0.05,
  FR: 0.025,
};

function scaleRepDistanceForAthlete(
  zone: TrackTrainingZoneCode,
  repDistance: TrackRepDistanceMeters,
  repCount: number,
  vdotAer: number
): { repDistance: TrackRepDistanceMeters; repCount: number } {
  const origTotal = repDistance * repCount;
  if (zone === 'I') {
    if (vdotAer < 45 && repDistance >= 800) {
      const nextDist: TrackRepDistanceMeters = 600;
      return {
        repDistance: nextDist,
        repCount: Math.max(3, Math.round(origTotal / nextDist)),
      };
    }
    if (vdotAer < 52 && repDistance >= 1000) {
      const nextDist: TrackRepDistanceMeters = 800;
      return {
        repDistance: nextDist,
        repCount: Math.max(3, Math.round(origTotal / nextDist)),
      };
    }
  }
  if ((zone === 'SUB_T' || zone === 'CV' || zone === 'T') && vdotAer < 46 && repDistance >= 1000) {
    const nextDist: TrackRepDistanceMeters = 800;
    return {
      repDistance: nextDist,
      repCount: Math.max(4, Math.round(origTotal / nextDist)),
    };
  }
  return { repDistance, repCount };
}

function selectQualityPairForWeek(params: {
  eventGroup: TrackTargetEventGroup;
  phase: TrackSeasonPhase;
  phenotype: SpeedReservePhenotype;
  vdotAer: number;
  weekInPhaseIdx: number;
  isDeload: boolean;
  isTaper: boolean;
  isFinalRaceWeek: boolean;
}): [QualityTemplate, QualityTemplate] {
  const { eventGroup, phase, phenotype, vdotAer, weekInPhaseIdx, isDeload, isTaper, isFinalRaceWeek } =
    params;

  let q1: QualityTemplate;
  let q2: QualityTemplate;

  if (eventGroup === '800M') {
    if (phase === 'BASE') {
      q1 = {
        titlePrefix: phenotype === 'SPEED' ? 'Broken Sub-T Rhythm' : 'Sub-T Track Cruise',
        repCount: phenotype === 'SPEED' ? 8 : 6,
        repDistance: phenotype === 'SPEED' ? 600 : 1000,
        zone: 'SUB_T',
        restSecs: phenotype === 'SPEED' ? 45 : 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Controlled lactate clearance without tying up neural turnover.',
      };
      q2 = {
        titlePrefix: 'Neuromechanical Fly & Mechanics',
        repCount: 8,
        repDistance: 150,
        zone: 'FR',
        restSecs: 150,
        recoveryLabel: 'Walk back',
        warmupMins: 18,
        cooldownMins: 10,
        note: 'Full recovery max-relaxation stride mechanics to raise MSS ceiling.',
      };
    } else if (phase === 'STRENGTH_CV') {
      q1 = {
        titlePrefix: 'Critical Velocity Track',
        repCount: phenotype === 'ENDURANCE' ? 6 : 5,
        repDistance: 800,
        zone: 'CV',
        restSecs: 75,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Raise aerobic speed asymptote (CS) smoothly.',
      };
      q2 = {
        titlePrefix: 'Mile Economy 200s',
        repCount: 8,
        repDistance: 200,
        zone: 'R',
        restSecs: 90,
        recoveryLabel: 'Jog 200m',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Springy elastic ground contact at 1500m race cadence.',
      };
    } else if (phase === 'SPECIFIC') {
      q1 = {
        titlePrefix: '800m Specific 300m Rhythm',
        repCount: phenotype === 'ENDURANCE' ? 6 : 5,
        repDistance: 300,
        zone: 'FR',
        restSecs: 150,
        recoveryLabel: 'Walk/Jog',
        warmupMins: 18,
        cooldownMins: 10,
        note: 'Relaxed posture through 200m split into simulated final 100m drive.',
      };
      q2 = {
        titlePrefix: phenotype === 'SPEED' ? 'Broken Sub-T Support' : '800m Aerobic Support',
        repCount: phenotype === 'SPEED' ? 6 : 4,
        repDistance: phenotype === 'SPEED' ? 600 : 600,
        zone: phenotype === 'SPEED' ? 'SUB_T' : 'I',
        restSecs: phenotype === 'SPEED' ? 45 : 120,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'VO2 kinetics priming & lactate shuttling support.',
      };
    } else {
      q1 = {
        titlePrefix: '800m Championship Sharpener',
        repCount: isFinalRaceWeek ? 3 : 4,
        repDistance: 300,
        zone: 'FR',
        restSecs: 210,
        recoveryLabel: 'Full Walk',
        warmupMins: 18,
        cooldownMins: 10,
        note: 'Dialed-in race-week neuromuscular snap; end feeling fast.',
      };
      q2 = {
        titlePrefix: 'Race-Week Pop 200s',
        repCount: 4,
        repDistance: 200,
        zone: 'R',
        restSecs: 150,
        recoveryLabel: 'Walk/Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Crisp opening-lap rhythm primer 48–72h out from race.',
      };
    }
  } else if (eventGroup === '1500_MILE') {
    if (phase === 'BASE') {
      q1 = {
        titlePrefix: phenotype === 'SPEED' ? 'Fractional Sub-T Track' : 'Norwegian Sub-T Cruise',
        repCount: phenotype === 'SPEED' ? 8 : 6,
        repDistance: phenotype === 'SPEED' ? 800 : 1000,
        zone: 'SUB_T',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Keep lactate strictly controlled under threshold while building track volume.',
      };
      q2 = {
        titlePrefix: 'Mile Economy 200s',
        repCount: phenotype === 'ENDURANCE' ? 10 : 8,
        repDistance: 200,
        zone: 'R',
        restSecs: 90,
        recoveryLabel: '200m Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Alactic running economy touches to keep ASR wide.',
      };
    } else if (phase === 'STRENGTH_CV') {
      q1 = {
        titlePrefix: 'Tinman CV Track Intervals',
        repCount: phenotype === 'SPEED' ? 7 : 6,
        repDistance: phenotype === 'SPEED' ? 800 : 1000,
        zone: 'CV',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'High aerobic fiber recruitment right at Critical Speed without acidosis.',
      };
      q2 = {
        titlePrefix: 'Mile R-Pace Quarters',
        repCount: 6 + Math.min(2, weekInPhaseIdx % 2),
        repDistance: 400,
        zone: 'R',
        restSecs: 90,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Lock in exact 400m split autopilot with full recovery.',
      };
    } else if (phase === 'SPECIFIC') {
      const use600s = weekInPhaseIdx >= 2;
      q1 = use600s
        ? {
            titlePrefix: 'Mile Race-Specific 600s',
            repCount: phenotype === 'SPEED' ? 4 : 5,
            repDistance: 600,
            zone: 'R',
            restSecs: 135,
            recoveryLabel: 'Jog',
            warmupMins: 15,
            cooldownMins: 10,
            note: 'Practice lap-3 bell-lap composure at exact Goal Mile rhythm.',
          }
        : {
            titlePrefix: 'Mile Race Rhythm 400s',
            repCount: phenotype === 'SPEED' ? 8 : 10,
            repDistance: 400,
            zone: 'R',
            restSecs: 90,
            recoveryLabel: 'Jog',
            warmupMins: 15,
            cooldownMins: 10,
            note: 'Even splits within +/-0.5s per lap on relaxed mechanics.',
          };
      q2 = {
        titlePrefix: phenotype === 'SPEED' ? 'Sub-T Maintenance + Kick' : 'VO2max Ceiling 800s',
        repCount: phenotype === 'SPEED' ? 6 : 5,
        repDistance: 800,
        zone: phenotype === 'SPEED' ? 'SUB_T' : 'I',
        restSecs: phenotype === 'SPEED' ? 60 : 150,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note:
          phenotype === 'SPEED'
            ? 'Preserve aerobic base for high-ASR athletes during Peak specificity.'
            : 'Drive cardiac output & VO2max ceiling in Specific mesocycle.',
      };
    } else {
      q1 = {
        titlePrefix: 'Mile Championship 300s',
        repCount: isFinalRaceWeek ? 4 : 6,
        repDistance: 300,
        zone: 'R',
        restSecs: 120,
        recoveryLabel: 'Walk/Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Tapered race-pace fluency; snap without fatigue.',
      };
      q2 = {
        titlePrefix: 'Taper Sub-T Tune-Up',
        repCount: 4,
        repDistance: 800,
        zone: 'SUB_T',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 12,
        cooldownMins: 10,
        note: 'Light aerobic rhythm flush to keep blood plasma volume topped up.',
      };
    }
  } else if (eventGroup === '3000_3200M') {
    if (phase === 'BASE') {
      q1 = {
        titlePrefix: 'Norwegian Sub-T 1000s',
        repCount: 7,
        repDistance: 1000,
        zone: 'SUB_T',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Build high-volume mitochondrial stimulus under 2.5 mmol/L lactate.',
      };
      q2 = {
        titlePrefix: 'Alactic Economy 200s',
        repCount: 8,
        repDistance: 200,
        zone: 'R',
        restSecs: 90,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Smooth mechanical stride length while building base mileage.',
      };
    } else if (phase === 'STRENGTH_CV') {
      q1 = {
        titlePrefix: '3200m Tinman CV Repeats',
        repCount: 6,
        repDistance: 1000,
        zone: 'CV',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Raise Critical Velocity toward target 3000m/3200m rhythm.',
      };
      q2 = {
        titlePrefix: 'VO2max Intro 600s',
        repCount: 6,
        repDistance: 600,
        zone: 'I',
        restSecs: 120,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Controlled transition into severe-domain VO2max efficiency.',
      };
    } else if (phase === 'SPECIFIC') {
      q1 = {
        titlePrefix: '3K/3200m Specific VO2max',
        repCount: 5,
        repDistance: 1000,
        zone: 'I',
        restSecs: 150,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Sustained 3K pace control at minimal oxygen-cost drift.',
      };
      q2 = {
        titlePrefix: 'Closing Gear 400s',
        repCount: 8,
        repDistance: 400,
        zone: 'R',
        restSecs: 75,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Simulate finishing last 400m strongly off 3200m effort.',
      };
    } else {
      q1 = {
        titlePrefix: '3K Peak Rhythm 600s',
        repCount: isFinalRaceWeek ? 3 : 4,
        repDistance: 600,
        zone: 'I',
        restSecs: 120,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Sharp 3200m opening pace feel without deep glycogen depletion.',
      };
      q2 = {
        titlePrefix: 'Race-Week Speed 200s',
        repCount: 6,
        repDistance: 200,
        zone: 'R',
        restSecs: 120,
        recoveryLabel: 'Walk/Jog',
        warmupMins: 12,
        cooldownMins: 10,
        note: 'Crisp kick mechanics 72h prior to championship line.',
      };
    }
  } else {
    // 5000M
    if (phase === 'BASE') {
      q1 = {
        titlePrefix: 'Norwegian Sub-T Base Cruises',
        repCount: phenotype === 'SPEED' ? 8 : 9,
        repDistance: 1000,
        zone: 'SUB_T',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Cornerstone sub-threshold aerobic density for 5000m durability.',
      };
      q2 = {
        titlePrefix: '5K Stride Economy 200s',
        repCount: 8,
        repDistance: 200,
        zone: 'R',
        restSecs: 75,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Low-fatigue mechanical crispness every week.',
      };
    } else if (phase === 'STRENGTH_CV') {
      q1 = {
        titlePrefix: phenotype === 'SPEED' ? 'Sub-T 1200m Cruises' : 'CV 1200m Grinder',
        repCount: 5,
        repDistance: 1200,
        zone: phenotype === 'SPEED' ? 'SUB_T' : 'CV',
        restSecs: 75,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Extend aerobic stamina through 3-lap repetitions.',
      };
      q2 = {
        titlePrefix: 'VO2max 800m Stimulus',
        repCount: 6,
        repDistance: 800,
        zone: 'I',
        restSecs: 120,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: '5K-specific oxygen uptake elevation.',
      };
    } else if (phase === 'SPECIFIC') {
      q1 = {
        titlePrefix: '5K Specific 1000m Repeats',
        repCount: phenotype === 'SPEED' ? 5 : 6,
        repDistance: 1000,
        zone: 'I',
        restSecs: 120,
        recoveryLabel: '200m Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Exact 5000m race pace calibration lap by lap.',
      };
      q2 = {
        titlePrefix: 'Sub-T Support + Economy',
        repCount: 6,
        repDistance: 1000,
        zone: 'SUB_T',
        restSecs: 60,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'High aerobic efficiency between VO2max efforts.',
      };
    } else {
      q1 = {
        titlePrefix: '5K Taper Rhythm 800s',
        repCount: isFinalRaceWeek ? 3 : 4,
        repDistance: 800,
        zone: 'I',
        restSecs: 120,
        recoveryLabel: 'Jog',
        warmupMins: 15,
        cooldownMins: 10,
        note: 'Dial in first-mile 5K discipline while shedding fatigue.',
      };
      q2 = {
        titlePrefix: 'Closing Kick 300s',
        repCount: 6,
        repDistance: 300,
        zone: 'R',
        restSecs: 90,
        recoveryLabel: 'Jog',
        warmupMins: 12,
        cooldownMins: 10,
        note: 'Fast-finish biomechanics on fresh legs.',
      };
    }
  }

  // Apply Tier 3-4 duration down-scaling & Deload/Taper volume reduction
  const applyModifiers = (tpl: QualityTemplate): QualityTemplate => {
    const scaled = scaleRepDistanceForAthlete(
      tpl.zone,
      tpl.repDistance,
      tpl.repCount,
      vdotAer
    );
    let reps = scaled.repCount;
    if (isDeload && !isTaper) {
      reps = Math.max(3, Math.round(reps * 0.72));
    } else if (isTaper && !isFinalRaceWeek) {
      reps = Math.max(3, Math.round(reps * 0.65));
    }
    return {
      ...tpl,
      repDistance: scaled.repDistance,
      repCount: reps,
    };
  };

  return [applyModifiers(q1), applyModifiers(q2)];
}

/**
 * Generates an Event x Phase Periodized Track Plan (800m, 1500m/Mile, 3000m/3200m, 5000m)
 * anchored to the athlete's 2-parameter CS + D' & ASR profile, enforcing weekly/session safety caps.
 */
export function generatePeriodizedTrackPlan(
  input: GenerateTrackPlanInput
): GeneratedTrackPlanSummary {
  const {
    startDateIso,
    blockWeeks,
    eventGroup,
    dateProfile,
    startingPhase = 'FULL_PROGRESSION',
    phenotypeOverride = 'AUTO',
    goalTimeSecs,
    weeklyBaselineDistanceKm,
  } = input;

  const phenotype: SpeedReservePhenotype =
    phenotypeOverride && phenotypeOverride !== 'AUTO'
      ? phenotypeOverride
      : dateProfile.phenotype;

  // Baseline weekly mileage scales responsibly by athlete VDOT tier (40 km to 95 km) unless specified
  const autoWeeklyKm = Math.round(
    Math.max(42, Math.min(92, 34 + (dateProfile.vdotAer - 38) * 1.45))
  );
  const baseWeeklyKm = Math.max(36, weeklyBaselineDistanceKm || autoWeeklyKm);

  const weeks: GeneratedTrackWeekPlan[] = [];
  let maxRawGoalGapPct = 0;
  let anyAmbitiousGoalWarning = false;
  let deltaMaxPct = 3.5;

  for (let w = 1; w <= blockWeeks; w++) {
    const phaseKey = resolvePhaseForWeek(w, blockWeeks, startingPhase);
    const isTaper = phaseKey === 'PEAK_TAPER' && w >= blockWeeks - 1;
    const isFinalRaceWeek = w === blockWeeks;
    const isDeload = w % 4 === 0 && !isTaper;

    // Week index within phase for intra-phase workout evolution
    const prevPhaseWeeks = weeks.filter((prev) => prev.phaseKey === phaseKey).length;

    const weekMultiplier = isFinalRaceWeek
      ? 0.55
      : isTaper
        ? 0.7
        : isDeload
          ? 0.72
          : Math.min(1.16, 0.92 + w * 0.02);
    const weeklyTargetKm = Math.round(baseWeeklyKm * weekMultiplier);
    const weeklyTargetMeters = weeklyTargetKm * 1000;

    const blended = blendTrackZonesForWeek({
      dateProfile,
      targetEvent: eventGroup,
      goalTimeSecs,
      weekNum: w,
      totalWeeks: blockWeeks,
      phase: phaseKey,
    });
    deltaMaxPct = blended.deltaMaxPct;
    maxRawGoalGapPct = Math.max(maxRawGoalGapPct, blended.rawGoalGapPct);
    if (blended.ambitiousGoalWarning) anyAmbitiousGoalWarning = true;

    const pair = selectQualityPairForWeek({
      eventGroup,
      phase: phaseKey,
      phenotype,
      vdotAer: dateProfile.vdotAer,
      weekInPhaseIdx: prevPhaseWeeks,
      isDeload,
      isTaper,
      isFinalRaceWeek,
    });

    // Track cumulative anaerobic/VO2/CV distance (`CV + I + R + FR <= 15%` weekly safety budget)
    let highIntensityBudgetMeters = Math.round(weeklyTargetMeters * 0.15);

    const buildSessionFromTemplate = (
      tpl: QualityTemplate,
      dayOffset: number
    ): PlannedWorkoutEvent => {
      const zoneRow = blended.zones[tpl.zone];
      const paceSecsKm = zoneRow.paceSecsPerKm;

      // Enforce single-session cap AND weekly zone % cap
      const maxForZoneSingle = SINGLE_SESSION_CAPS_METERS[tpl.zone];
      const maxForZoneWeekly = Math.round(weeklyTargetMeters * WEEKLY_PCT_CAPS[tpl.zone]);
      const maxDistForSession = Math.min(maxForZoneSingle, maxForZoneWeekly);

      let safeRepCount = Math.max(
        2,
        Math.min(tpl.repCount, Math.floor(maxDistForSession / tpl.repDistance))
      );

      if (tpl.zone === 'CV' || tpl.zone === 'I' || tpl.zone === 'R' || tpl.zone === 'FR') {
        const maxByCombo = Math.floor(highIntensityBudgetMeters / tpl.repDistance);
        safeRepCount = Math.max(2, Math.min(safeRepCount, Math.max(2, maxByCombo)));
        highIntensityBudgetMeters = Math.max(
          0,
          highIntensityBudgetMeters - safeRepCount * tpl.repDistance
        );
      }

      const splitSecs = getZoneSplitForMeters(paceSecsKm, tpl.repDistance);
      const splitToken = formatTrackSplitToken(splitSecs);
      const restToken = formatRestDurationCue(tpl.restSecs);
      const parsedPct = ZONE_TO_PARSED_PCT[tpl.zone];
      const zoneDisplay = tpl.zone === 'SUB_T' ? 'Sub-T' : tpl.zone;

      const workoutSyntax = [
        `- ${tpl.warmupMins}m 68% Pace Warmup & Strides`,
        `Main Set ${safeRepCount}x`,
        `- ${tpl.repDistance}m @ ${splitToken} (${parsedPct}% Pace) ${zoneDisplay}`,
        `- ${restToken} 58% Pace ${tpl.recoveryLabel}`,
        `- ${tpl.cooldownMins}m 65% Pace Cooldown`,
      ].join('\n');

      const totalWorkSecs = safeRepCount * (splitSecs + tpl.restSecs);
      const plannedDurationSecs = Math.round(
        (tpl.warmupMins + tpl.cooldownMins) * 60 + totalWorkSecs
      );
      const intensityRatio = Math.max(0.85, parsedPct / 100);
      const plannedLoad = Math.round((plannedDurationSecs / 3600) * intensityRatio * intensityRatio * 86);

      const trackSpec: TrackWorkoutSpec = {
        repCount: safeRepCount,
        repDistanceMeters: tpl.repDistance,
        zoneCode: tpl.zone,
        podIntensity: ZONE_TO_POD_INTENSITY[tpl.zone],
        targetSplitSecs: splitSecs,
        restDurationSecs: tpl.restSecs,
        recoveryCue: `${restToken} ${tpl.recoveryLabel}`,
        waveMode: 'POD_10S',
        eventGroup,
        phase: phaseKey,
      };

      return {
        id: `trk-plan-w${w}-${dayOffset}-${tpl.zone.toLowerCase()}`,
        date: addDaysIso(startDateIso, (w - 1) * 7 + dayOffset),
        name: `${tpl.titlePrefix}: ${safeRepCount}×${tpl.repDistance}m @ ${splitToken}`,
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        description: `${tpl.note} Target ${zoneDisplay} split ${splitToken} per ${tpl.repDistance}m (${restToken} ${tpl.recoveryLabel.toLowerCase()}).`,
        plannedLoad: Math.max(38, plannedLoad),
        plannedDurationSecs,
        targetZoneSummary: `${zoneDisplay} · ${safeRepCount}×${tpl.repDistance}m`,
        workoutSyntax,
        trackSpec,
        source: 'AI_COACH',
      };
    };

    const q1Session = buildSessionFromTemplate(pair[0], 1); // Tuesday Track Session
    const q2Session = buildSessionFromTemplate(pair[1], 4); // Friday Track Session

    // Supporting Easy Aerobic + Long Endurance sessions calibrated strictly to Date E Pace
    const easyPaceToken = formatTrackSplitToken(blended.zones.E.paceSecsPerKm);
    const easyDurationMins = isFinalRaceWeek ? 30 : isTaper ? 38 : isDeload ? 40 : 48;
    const longDurationMins = isFinalRaceWeek ? 45 : isTaper ? 60 : isDeload ? 65 : 85;

    const easyMidWeek: PlannedWorkoutEvent = {
      id: `trk-plan-w${w}-2-easy`,
      date: addDaysIso(startDateIso, (w - 1) * 7 + 2),
      name: `Aerobic Recovery + 4×100m Strides`,
      sportCategory: 'Running',
      environmentPreference: 'FLEXIBLE',
      description: `Relaxed E-pace flushing (~${easyPaceToken}/km) followed by 4 relaxed 100m strides.`,
      plannedLoad: Math.round((easyDurationMins / 60) * 52),
      plannedDurationSecs: easyDurationMins * 60,
      targetZoneSummary: 'E · Z2 Aerobic',
      workoutSyntax: `- ${easyDurationMins}m 68% Pace Easy Aerobic\nMain Set 4x\n- 100m 110% Pace Fast Stride\n- 60s 55% Pace Walk/Jog`,
      source: 'AI_COACH',
    };

    const longEndurance: PlannedWorkoutEvent = {
      id: `trk-plan-w${w}-6-long`,
      date: addDaysIso(startDateIso, (w - 1) * 7 + 6),
      name: isFinalRaceWeek
        ? 'Pre-Meet Easy Long Flush'
        : `${longDurationMins}m Aerobic Long Run`,
      sportCategory: 'Running',
      environmentPreference: 'OUTDOOR',
      description: `Build capillary density strictly at Date E Pace (~${easyPaceToken}/km) without straining recovery.`,
      plannedLoad: Math.round((longDurationMins / 60) * 62),
      plannedDurationSecs: longDurationMins * 60,
      targetZoneSummary: 'E · Aerobic Endurance',
      workoutSyntax: `- ${longDurationMins}m 70% Pace Aerobic Endurance`,
      source: 'AI_COACH',
    };

    const weekSessions = [q1Session, easyMidWeek, q2Session, longEndurance];
    const totalSecs = weekSessions.reduce((acc, s) => acc + s.plannedDurationSecs, 0);
    const totalTss = weekSessions.reduce((acc, s) => acc + s.plannedLoad, 0);

    const zPct: [number, number, number, number, number, number] =
      phaseKey === 'BASE'
        ? [18, 62, 14, 4, 2, 0]
        : phaseKey === 'STRENGTH_CV'
          ? [16, 56, 12, 10, 4, 2]
          : phaseKey === 'SPECIFIC'
            ? [20, 52, 6, 8, 8, 6]
            : [24, 54, 6, 6, 6, 4];

    weeks.push({
      weekNum: w,
      startDate: addDaysIso(startDateIso, (w - 1) * 7),
      phaseKey,
      phaseLabel: PHASE_DISPLAY_NAMES[phaseKey],
      isDeload,
      isTaper,
      targetHours: Number((totalSecs / 3600).toFixed(1)),
      targetTss: totalTss,
      targetDistanceKm: weeklyTargetKm,
      ambitiousGoalWarning: blended.ambitiousGoalWarning,
      zoneDistributionPct: zPct,
      sessions: weekSessions,
    });
  }

  return {
    eventGroup,
    phenotype,
    vdotAer: dateProfile.vdotAer,
    csMps: dateProfile.csMps,
    dPrimeMeters: dateProfile.dPrimeMeters,
    asrMps: dateProfile.asrMps,
    ambitiousGoalWarning: anyAmbitiousGoalWarning,
    deltaMaxPct,
    rawGoalGapPct: maxRawGoalGapPct,
    weeks,
  };
}
