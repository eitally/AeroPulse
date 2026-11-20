import type {
  AthleteProfile,
  DistanceUnit,
  SportCategory,
  TrackWorkoutSpec,
} from '../types';
import { formatPace } from '../utils/formatters';
import { parseWorkoutSteps } from '../utils/workoutParser';
import { formatTrackSplitToken } from './trackPrescriptionEngine';
import {
  DEFAULT_SWIM_CSS_SECS_PER_100M,
  formatSwimDistance,
  formatSwimPacePer100,
} from './swimZones';

export type EndurancePlanArchetypeId =
  | 'CYC_FTP_BUILDER'
  | 'CYC_TIME_CRUNCHED_INDOOR'
  | 'CYC_CRIT_ROAD_RACE'
  | 'CYC_40K_TT_AERO'
  | 'CYC_CLIMBING_WKG'
  | 'CYC_GRAVEL_FONDO'
  | 'CYC_POLARIZED_BASE'
  | 'ROAD_RETURN_TO_RUN'
  | 'ROAD_FIRST_5K'
  | 'ROAD_5K'
  | 'ROAD_10K'
  | 'ROAD_HALF_MARATHON'
  | 'ROAD_MARATHON'
  | 'SWIM_CSS_ENDURANCE'
  | 'TRI_OLYMPIC'
  | 'TRI_70_3';

export type PlanStartAnchorMode = 'NEXT_MONDAY' | 'THIS_WEEK' | 'RACE_DATE';
export type PlanVolumeTier = 'AUTO' | 'STARTER' | 'INTERMEDIATE' | 'COMPETITIVE';

export interface EnduranceArchetypeMeta {
  id: EndurancePlanArchetypeId;
  category: 'CYCLING' | 'ROAD' | 'SWIM_TRI';
  badge: string;
  title: string;
  subtitle: string;
  sportCategory: SportCategory;
  targetLabel: string;
  defaultWeeks: 4 | 8 | 12 | 16;
  targetProgressionLevels: [number, number, number, number, number, number];
}

export const ENDURANCE_PLAN_ARCHETYPES: EnduranceArchetypeMeta[] = [
  {
    id: 'CYC_FTP_BUILDER',
    category: 'CYCLING',
    badge: 'Cycling · Threshold',
    title: 'Cycling FTP Builder (+8% Peak)',
    subtitle: 'Sweet Spot, Over-Unders & VO2max Ceiling Expansion',
    sportCategory: 'Cycling',
    targetLabel: '+8% FTP & W/kg Peak',
    defaultWeeks: 12,
    targetProgressionLevels: [7.8, 8.5, 8.8, 7.6, 6.2, 5.5],
  },
  {
    id: 'CYC_TIME_CRUNCHED_INDOOR',
    category: 'CYCLING',
    badge: 'Cycling · <5h/wk',
    title: 'Time-Crunched Indoor FTP',
    subtitle: '45–60m ERG Threshold & Microbursts on Indoor FTP',
    sportCategory: 'Cycling',
    targetLabel: 'Max ROI <= 60m Weekdays',
    defaultWeeks: 8,
    targetProgressionLevels: [6.8, 8.2, 8.8, 8.4, 7.0, 5.8],
  },
  {
    id: 'CYC_CRIT_ROAD_RACE',
    category: 'CYCLING',
    badge: 'Cycling · Crit / Road',
    title: 'Criterium & Road Race Punch',
    subtitle: '30/15s Microbursts, Anaerobic Attacks & Corner Surges',
    sportCategory: 'Cycling',
    targetLabel: 'Repeatable Z5/Z6 Surges',
    defaultWeeks: 8,
    targetProgressionLevels: [7.2, 7.8, 8.0, 8.9, 9.2, 8.8],
  },
  {
    id: 'CYC_40K_TT_AERO',
    category: 'CYCLING',
    badge: 'Cycling · Time Trial',
    title: '40km TT & Aero TTE',
    subtitle: '2x20m, 3x15m & 1x40m Sustained Aero-Tuck Threshold',
    sportCategory: 'Cycling',
    targetLabel: '40km Sustained 98–102% FTP',
    defaultWeeks: 12,
    targetProgressionLevels: [7.6, 8.6, 9.4, 7.8, 6.2, 5.2],
  },
  {
    id: 'CYC_CLIMBING_WKG',
    category: 'CYCLING',
    badge: 'Cycling · Climbing',
    title: 'Climbing & W/kg Mountain Peak',
    subtitle: 'Low-Cadence Torque & Sustained 20–30m Climb Repeats',
    sportCategory: 'Cycling',
    targetLabel: 'VAM + Threshold W/kg',
    defaultWeeks: 12,
    targetProgressionLevels: [8.4, 8.4, 9.0, 8.2, 6.5, 5.4],
  },
  {
    id: 'CYC_GRAVEL_FONDO',
    category: 'CYCLING',
    badge: 'Cycling · Gran Fondo',
    title: '100-Mile Gran Fondo / Gravel',
    subtitle: 'High-Durability Z2 Base, Late-Ride Tempo & 2-Week Taper',
    sportCategory: 'Cycling',
    targetLabel: '100 mi · <3% Drift',
    defaultWeeks: 12,
    targetProgressionLevels: [9.2, 8.4, 7.6, 6.4, 5.4, 5.0],
  },
  {
    id: 'CYC_POLARIZED_BASE',
    category: 'CYCLING',
    badge: 'Cycling · 80/20 Base',
    title: 'Polarized 80/20 Endurance',
    subtitle: 'Seiler Model: >=80% Easy Z2 Volume + 4x8m VO2 Ceiling',
    sportCategory: 'Cycling',
    targetLabel: '80% Z1/Z2 · 20% Z4/Z5',
    defaultWeeks: 12,
    targetProgressionLevels: [9.4, 6.2, 7.2, 8.8, 6.4, 5.2],
  },
  {
    id: 'ROAD_RETURN_TO_RUN',
    category: 'ROAD',
    badge: 'Beginner · Rebuild',
    title: 'Return-to-Run & Joint Rebuild',
    subtitle: 'Gentle Walk/Jog Progression, Cadence Cues & Zero-Impact Swaps',
    sportCategory: 'Running',
    targetLabel: 'Pain-Free 30m Continuous Run',
    defaultWeeks: 8,
    targetProgressionLevels: [6.4, 5.2, 4.0, 2.5, 2.0, 1.5],
  },
  {
    id: 'ROAD_FIRST_5K',
    category: 'ROAD',
    badge: 'Beginner · First 5K',
    title: 'First 5K Confidence Builder',
    subtitle: 'Conversational Easy Runs, Gradual Duration & Optional Strides',
    sportCategory: 'Running',
    targetLabel: 'Finish Strong 5K (3×/wk Min)',
    defaultWeeks: 8,
    targetProgressionLevels: [7.0, 6.2, 5.2, 4.0, 2.8, 2.0],
  },
  {
    id: 'ROAD_5K',
    category: 'ROAD',
    badge: 'Road · 5K Speed',
    title: '5K Speed & VO2max Peak',
    subtitle: '800m/1000m VO2 Intervals, Fast Reps & Aerobic Cap',
    sportCategory: 'Running',
    targetLabel: '5K Race Pace & Economy',
    defaultWeeks: 8,
    targetProgressionLevels: [7.2, 7.5, 8.4, 8.9, 7.4, 6.5],
  },
  {
    id: 'ROAD_10K',
    category: 'ROAD',
    badge: 'Road · 10K / CV',
    title: '10K Threshold & CV Build',
    subtitle: 'Critical Velocity 1000s, Threshold Cruises & Tempo Finish',
    sportCategory: 'Running',
    targetLabel: '10K Lactate Clearance',
    defaultWeeks: 8,
    targetProgressionLevels: [7.8, 8.2, 8.8, 8.4, 6.8, 5.8],
  },
  {
    id: 'ROAD_HALF_MARATHON',
    category: 'ROAD',
    badge: 'Road · Half Marathon',
    title: 'Half Marathon in 12 Weeks',
    subtitle: 'Lactate Cruises, Progressive Long Runs & Deload Weeks',
    sportCategory: 'Running',
    targetLabel: '21.1 km Sustained Pace',
    defaultWeeks: 12,
    targetProgressionLevels: [8.8, 8.4, 8.0, 6.8, 5.2, 4.8],
  },
  {
    id: 'ROAD_MARATHON',
    category: 'ROAD',
    badge: 'Road · Marathon',
    title: 'Marathon Peak & Fueling',
    subtitle: 'MP Fast-Finish Long Runs, Gut Training & 2-Week Taper',
    sportCategory: 'Running',
    targetLabel: '42.2 km Durability Peak',
    defaultWeeks: 16,
    targetProgressionLevels: [9.4, 8.8, 7.8, 6.0, 4.8, 4.5],
  },
  {
    id: 'SWIM_CSS_ENDURANCE',
    category: 'SWIM_TRI',
    badge: 'Swim · CSS',
    title: 'Swim CSS Threshold & 1500m',
    subtitle: 'Pool CSS Intervals, Pull/Drill Economy & Open-Water Pacing',
    sportCategory: 'Swimming',
    targetLabel: 'CSS Pace & Stroke Efficiency',
    defaultWeeks: 8,
    targetProgressionLevels: [7.6, 8.2, 8.8, 7.8, 6.2, 5.0],
  },
  {
    id: 'TRI_OLYMPIC',
    category: 'SWIM_TRI',
    badge: 'Triathlon · Olympic',
    title: 'Olympic Triathlon (1.5k / 40k / 10k)',
    subtitle: 'Balanced Swim CSS, Aero Bike Tempo & T2 Off-Bike Brick Runs',
    sportCategory: 'Multisport',
    targetLabel: 'Swim + Bike + T2 Brick',
    defaultWeeks: 12,
    targetProgressionLevels: [8.2, 8.6, 8.4, 7.4, 6.0, 5.2],
  },
  {
    id: 'TRI_70_3',
    category: 'SWIM_TRI',
    badge: 'Triathlon · 70.3',
    title: 'Half-Ironman 70.3 Endurance Peak',
    subtitle: 'Long Aero Rides, 1.9km CSS Swims, Brick Runs & 2-Week Taper',
    sportCategory: 'Multisport',
    targetLabel: '70.3 Durability + 90g/h Fuel',
    defaultWeeks: 16,
    targetProgressionLevels: [9.2, 8.8, 8.0, 6.6, 5.4, 4.8],
  },
];

export interface GeneratedEnduranceSession {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  trackSpec?: TrackWorkoutSpec;
  replaceExistingDate: boolean;
}

export interface GeneratedEnduranceWeek {
  weekNum: number;
  startDateIso: string;
  phase: 'Aerobic Base' | 'Specific Build' | 'Deload (-30%)' | 'Peak & Taper';
  isDeload: boolean;
  isTaper: boolean;
  targetTss: number;
  targetHours: string;
  sessions: GeneratedEnduranceSession[];
  zoneDistributionPct: [number, number, number, number, number, number];
}

export interface GenerateEndurancePlanInput {
  archetypeId: EndurancePlanArchetypeId;
  startDateIso: string;
  blockWeeks: 4 | 8 | 12 | 16;
  selectedWeekdays?: number[];
  longDayOffset?: number;
  environmentPreference?: 'FLEXIBLE' | 'OUTDOOR' | 'INDOOR';
  currentCtl: number;
  volumeTier?: PlanVolumeTier;
  distanceUnit?: DistanceUnit;
  athleteProfile?: AthleteProfile;
  ftpWatts?: number;
  targetRaceDateIso?: string;
}

function addDaysIso(baseDateIso: string, addDays: number): string {
  const now = new Date();
  const [y, m, d] = baseDateIso.split('-').map(Number);
  const dt = new Date(
    Date.UTC(y || now.getUTCFullYear(), (m || now.getUTCMonth() + 1) - 1, d || now.getUTCDate())
  );
  dt.setUTCDate(dt.getUTCDate() + addDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Resolves the Monday YYYY-MM-DD starting date for a periodized block based on anchor mode.
 */
export function resolvePlanStartMondayIso(params: {
  anchorMode: PlanStartAnchorMode;
  todayIso: string;
  targetRaceDateIso?: string;
  blockWeeks: number;
}): string {
  const { anchorMode, todayIso, targetRaceDateIso, blockWeeks } = params;
  const [y, m, d] = todayIso.split('-').map(Number);
  const todayDt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  const dow = todayDt.getUTCDay() || 7; // 1=Mon .. 7=Sun

  if (anchorMode === 'THIS_WEEK') {
    return addDaysIso(todayIso, 1 - dow);
  }

  if (anchorMode === 'RACE_DATE' && targetRaceDateIso && /^\d{4}-\d{2}-\d{2}$/.test(targetRaceDateIso)) {
    const [ry, rm, rd] = targetRaceDateIso.split('-').map(Number);
    const raceDt = new Date(Date.UTC(ry, rm - 1, rd));
    const raceDow = raceDt.getUTCDay() || 7;
    const raceWeekMonday = addDaysIso(targetRaceDateIso, 1 - raceDow);
    return addDaysIso(raceWeekMonday, -(Math.max(1, blockWeeks) - 1) * 7);
  }

  // NEXT_MONDAY: upcoming Monday (same date if today is already Monday)
  return dow === 1 ? todayIso : addDaysIso(todayIso, 8 - dow);
}

function normalizeWeekdays(
  selectedWeekdays: number[] | undefined,
  longDayOffset: number | undefined
): {
  q1Offset: number;
  q2Offset: number;
  longOffset: number;
  easyOffsets: number[];
} {
  const clean =
    Array.isArray(selectedWeekdays) && selectedWeekdays.length > 0
      ? Array.from(
          new Set(selectedWeekdays.map((d) => Math.max(0, Math.min(6, Math.round(d)))))
        ).sort((a, b) => a - b)
      : [1, 2, 3, 5, 6];

  const resolvedLong =
    typeof longDayOffset === 'number' && clean.includes(longDayOffset)
      ? longDayOffset
      : clean.includes(6)
        ? 6
        : clean.includes(5)
          ? 5
          : clean[clean.length - 1] ?? 6;

  const nonLong = clean.filter((d) => d !== resolvedLong);
  const q1Offset = nonLong[0] ?? 1;
  const q2Offset =
    nonLong.length >= 3
      ? nonLong[nonLong.length - 1]
      : nonLong.length >= 2
        ? nonLong[1]
        : q1Offset === 3
          ? 4
          : 3;

  const easyOffsets = nonLong.filter((d) => d !== q1Offset && d !== q2Offset);
  return { q1Offset, q2Offset, longOffset: resolvedLong, easyOffsets };
}

function computeSessionTss(
  workoutSyntax: string,
  sport: SportCategory,
  thresholdPace: number
): { durationSecs: number; tss: number } {
  const steps = parseWorkoutSteps(workoutSyntax, thresholdPace);
  if (steps.length === 0) return { durationSecs: 2700, tss: 48 };
  const durationSecs = Math.round(
    steps.reduce((acc, s) => acc + (s.durationSecs || s.durationMins * 60), 0)
  );
  const totalMins = Math.max(1, durationSecs / 60);
  const weightedIf =
    steps.reduce((acc, s) => {
      const m = (s.durationSecs || s.durationMins * 60) / 60;
      const clampedPct = Math.max(42, Math.min(135, s.intensityPct || 68)) / 100;
      return acc + m * clampedPct * clampedPct;
    }, 0) / totalMins;
  const sportFactor = sport === 'Running' ? 92 : 98;
  return {
    durationSecs,
    tss: Math.max(18, Math.round((totalMins / 60) * weightedIf * sportFactor)),
  };
}

function computeZoneDistributionFromSessions(
  sessions: GeneratedEnduranceSession[],
  thresholdPace: number
): [number, number, number, number, number, number] {
  const zoneSecs = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (const s of sessions) {
    const steps = parseWorkoutSteps(s.workoutSyntax, thresholdPace);
    if (steps.length === 0) {
      zoneSecs[1] += s.plannedDurationSecs;
      total += s.plannedDurationSecs;
      continue;
    }
    for (const st of steps) {
      const dur = st.durationSecs || st.durationMins * 60;
      zoneSecs[Math.max(0, Math.min(5, st.zone - 1))] += dur;
      total += dur;
    }
  }
  if (total <= 0) return [18, 60, 10, 8, 4, 0];
  return zoneSecs.map((secs) => Math.round((secs / total) * 100)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

function resolveVolumeMultiplier(currentCtl: number, volumeTier: PlanVolumeTier): number {
  if (volumeTier === 'STARTER') return 0.78;
  if (volumeTier === 'INTERMEDIATE') return 1.0;
  if (volumeTier === 'COMPETITIVE') return 1.2;
  if (currentCtl >= 70) return 1.16;
  if (currentCtl >= 40) return 1.0;
  return 0.84;
}

function capMins(mins: number, maxMins: number): number {
  return Math.max(20, Math.min(maxMins, Math.round(mins)));
}

/**
 * Generates an individualized Cycling (7 archetypes) or Road Running (4 archetypes) periodized plan
 * with CTL volume scaling, Deload weeks every 4th non-taper week, Race-Week Taper (-45% to -55% TSS),
 * and zero cross-discipline metric leakage (% FTP strictly isolated to Cycling).
 */
export function generateEnduranceTrainingPlan(
  input: GenerateEndurancePlanInput
): GeneratedEnduranceWeek[] {
  const {
    archetypeId,
    startDateIso,
    blockWeeks,
    selectedWeekdays,
    longDayOffset,
    environmentPreference = 'FLEXIBLE',
    currentCtl,
    volumeTier = 'AUTO',
    distanceUnit = 'mi',
    athleteProfile,
    ftpWatts,
  } = input;

  const isRunning = archetypeId.startsWith('ROAD_');
  const isSwimOnly = archetypeId === 'SWIM_CSS_ENDURANCE';
  const isTri = archetypeId === 'TRI_OLYMPIC' || archetypeId === 'TRI_70_3';
  const isTimeCrunched = archetypeId === 'CYC_TIME_CRUNCHED_INDOOR';
  const effectiveFtp = isTimeCrunched
    ? Math.max(100, athleteProfile?.indoorFtp || athleteProfile?.ftp || ftpWatts || 250)
    : Math.max(100, athleteProfile?.ftp || ftpWatts || 260);
  const safeThresholdPace = Math.max(150, athleteProfile?.thresholdPaceSecsPerKm || 255);
  const safeCssSecs = Math.max(
    65,
    Math.min(220, athleteProfile?.swimCssSecsPer100m || DEFAULT_SWIM_CSS_SECS_PER_100M)
  );
  const cssPaceStr = formatSwimPacePer100(safeCssSecs, distanceUnit);
  const easyPaceSecs = Math.round(safeThresholdPace * 1.28);
  const tempoPaceSecs = Math.round(safeThresholdPace * 1.09);
  const mpPaceSecs = Math.round(safeThresholdPace * 1.1);
  const cvPaceSecs = Math.round(safeThresholdPace * 0.98);
  const vo2PaceSecs = Math.round(safeThresholdPace * 0.91);
  const rPaceSecs = Math.round(safeThresholdPace * 0.85);

  const volMult = resolveVolumeMultiplier(currentCtl, volumeTier);
  const { q1Offset, q2Offset, longOffset, easyOffsets } = normalizeWeekdays(
    selectedWeekdays,
    longDayOffset
  );

  const twoWeekTaper =
    (archetypeId === 'CYC_GRAVEL_FONDO' ||
      archetypeId === 'ROAD_MARATHON' ||
      archetypeId === 'TRI_70_3') &&
    blockWeeks >= 12;

  const weeks: GeneratedEnduranceWeek[] = [];

  for (let w = 0; w < blockWeeks; w++) {
    const weekNum = w + 1;
    const weekMondayIso = addDaysIso(startDateIso, w * 7);
    const isFinalRaceWeek = weekNum === blockWeeks;
    const isPenultimateTaper = twoWeekTaper && weekNum === blockWeeks - 1;
    const isTaper = isFinalRaceWeek || isPenultimateTaper;
    const isDeload = !isTaper && weekNum % 4 === 0;

    const phase: GeneratedEnduranceWeek['phase'] = isTaper
      ? 'Peak & Taper'
      : isDeload
        ? 'Deload (-30%)'
        : weekNum <= Math.ceil(blockWeeks * 0.42)
          ? 'Aerobic Base'
          : 'Specific Build';

    // Build factor peaks before taper; final race week cuts duration dramatically (~50% TSS)
    const buildProgress = w / Math.max(1, blockWeeks - (twoWeekTaper ? 2 : 1));
    const weekDurScale = isFinalRaceWeek
      ? 0.46
      : isPenultimateTaper
        ? 0.72
        : isDeload
          ? 0.72
          : (0.9 + Math.min(0.24, buildProgress * 0.24)) * volMult;

    const sessions: GeneratedEnduranceSession[] = [];
    const envForSession = (preferIndoor = false): 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE' =>
      isTimeCrunched && preferIndoor
        ? 'INDOOR'
        : environmentPreference === 'FLEXIBLE'
          ? isTimeCrunched
            ? 'INDOOR'
            : 'FLEXIBLE'
          : environmentPreference;

    const addCyclingSession = (
      dayOffset: number,
      name: string,
      workoutSyntax: string,
      description: string,
      preferIndoor = false
    ) => {
      const { durationSecs, tss } = computeSessionTss(workoutSyntax, 'Cycling', safeThresholdPace);
      sessions.push({
        date: addDaysIso(weekMondayIso, dayOffset),
        name,
        sportCategory: 'Cycling',
        environmentPreference: envForSession(preferIndoor),
        plannedDurationSecs: durationSecs,
        plannedLoad: tss,
        workoutSyntax,
        description,
        replaceExistingDate: true,
      });
    };

    const addRunningSession = (
      dayOffset: number,
      name: string,
      workoutSyntax: string,
      description: string,
      trackSpec?: TrackWorkoutSpec
    ) => {
      const { durationSecs, tss } = computeSessionTss(workoutSyntax, 'Running', safeThresholdPace);
      sessions.push({
        date: addDaysIso(weekMondayIso, dayOffset),
        name,
        sportCategory: 'Running',
        environmentPreference: environmentPreference === 'INDOOR' ? 'INDOOR' : 'OUTDOOR',
        plannedDurationSecs: durationSecs,
        plannedLoad: tss,
        workoutSyntax,
        description,
        ...(trackSpec ? { trackSpec } : {}),
        replaceExistingDate: true,
      });
    };

    const addSwimSession = (
      dayOffset: number,
      name: string,
      workoutSyntax: string,
      description: string,
      durationSecs: number,
      load: number
    ) => {
      sessions.push({
        date: addDaysIso(weekMondayIso, dayOffset),
        name,
        sportCategory: 'Swimming',
        environmentPreference: 'INDOOR',
        plannedDurationSecs: Math.max(600, Math.round(durationSecs)),
        plannedLoad: Math.max(10, Math.round(load)),
        workoutSyntax,
        description,
        replaceExistingDate: true,
      });
    };

    const addBrickSession = (
      dayOffset: number,
      name: string,
      workoutSyntax: string,
      description: string,
      durationSecs: number,
      load: number
    ) => {
      sessions.push({
        date: addDaysIso(weekMondayIso, dayOffset),
        name,
        sportCategory: 'Multisport',
        environmentPreference: envForSession(false),
        plannedDurationSecs: Math.max(1200, Math.round(durationSecs)),
        plannedLoad: Math.max(15, Math.round(load)),
        workoutSyntax,
        description,
        replaceExistingDate: true,
      });
    };

    if (isSwimOnly) {
      // ==================== SWIM CSS ARCHETYPE (0 % FTP LEAKS!) ====================
      const easySwimPaceStr = formatSwimPacePer100(Math.round(safeCssSecs * 1.14), distanceUnit);
      if (isFinalRaceWeek) {
        addSwimSession(
          q1Offset,
          `Wk${weekNum} CSS Opener: 4x100m @ ${cssPaceStr}`,
          `Warmup\n- 300m Easy Choice + 4x50 Drill @ ${easySwimPaceStr}\n\nMain Set 1\n- 4x100m @ ${cssPaceStr} CSS (20s rest)\n\nCooldown\n- 200m Z1 Swim Down`,
          `Crisp neuromuscular CSS activation (~${cssPaceStr}) shedding fatigue for meet/open-water peak.`,
          1320,
          22
        );
        addSwimSession(
          q2Offset,
          `Wk${weekNum} Pre-Race Drill Shakeout (${formatSwimDistance(900, distanceUnit)})`,
          `Warmup\n- 300m Z1 Free @ ${easySwimPaceStr}\n\nMain Set 1\n- 4x75m Build Sighting & Turns\n\nCooldown\n- 300m Easy Choice`,
          `Relaxed catch and streamline feel at ${easySwimPaceStr}.`,
          1080,
          14
        );
        addSwimSession(
          longOffset,
          `Wk${weekNum} Race Activation Warmup Swim (${formatSwimDistance(800, distanceUnit)})`,
          `Warmup\n- 400m Z1 Flush\n\nMain Set 1\n- 4x50m Controlled Snap @ ${cssPaceStr}\n\nCooldown\n- 200m Easy`,
          `Short taper shakeout keeping water feel sharp (~50% taper volume).`,
          960,
          14
        );
      } else {
        const repDist = weekNum % 2 === 1 ? 100 : 200;
        const repCount = isDeload ? (repDist === 100 ? 6 : 4) : repDist === 100 ? 10 : 6;
        const q1Meters = 400 + repCount * repDist + 200;
        const q1Secs = Math.round((q1Meters / 100) * safeCssSecs * 1.18);
        addSwimSession(
          q1Offset,
          `Wk${weekNum} CSS Threshold Pool Set: ${repCount}x${repDist}m @ ${cssPaceStr}`,
          `Warmup\n- 400m Easy Choice + 4x50 Drill @ ${easySwimPaceStr}\n\nMain Set 1\n- ${repCount}x${repDist}m @ ${cssPaceStr} CSS (${repDist === 100 ? '15s' : '25s'} rest)\n\nCooldown\n- 200m Z1 Swim Down`,
          `Primary CSS pace repeatability at ${cssPaceStr} (${formatSwimDistance(q1Meters, distanceUnit)}).`,
          q1Secs,
          (q1Secs / 3600) * (isDeload ? 56 : 74)
        );

        const q2CruiseCount = isDeload ? 3 : 5;
        const q2Meters = 400 + q2CruiseCount * 300 + 200;
        const q2Secs = Math.round((q2Meters / 100) * safeCssSecs * 1.2);
        addSwimSession(
          q2Offset,
          `Wk${weekNum} Aerobic Pull & CSS Cruise: ${q2CruiseCount}x300m`,
          `Warmup\n- 400m Z1 Free/Back @ ${easySwimPaceStr}\n\nMain Set 1\n- ${q2CruiseCount}x300m Pull Buoy Smooth CSS+4s (${formatSwimPacePer100(safeCssSecs + 4, distanceUnit)}, 20s rest)\n\nCooldown\n- 200m Easy`,
          `Distance-per-stroke endurance and catch stability (${formatSwimDistance(q2Meters, distanceUnit)}).`,
          q2Secs,
          (q2Secs / 3600) * (isDeload ? 50 : 64)
        );

        easyOffsets.forEach((off, idx) => {
          const drillMeters = Math.round(1400 * weekDurScale);
          const drillSecs = Math.round((drillMeters / 100) * safeCssSecs * 1.24);
          addSwimSession(
            off,
            `Wk${weekNum} Technique & Aerobic Flush (${formatSwimDistance(drillMeters, distanceUnit)})`,
            `Warmup\n- 300m Easy Choice\n\nMain Set 1\n- ${formatSwimDistance(Math.max(600, drillMeters - 500), distanceUnit)} Catch-Up & Fingertip Drag Drills @ ${easySwimPaceStr}\n\nCooldown\n- 200m Z1 Easy`,
            idx === 0
              ? `Low-strain streamline mechanics around ${easySwimPaceStr}.`
              : `Parasympathetic aerobic water feel.`,
            drillSecs,
            (drillSecs / 3600) * 46
          );
        });

        const longSwimMeters = Math.max(
          1500,
          Math.min(3600, Math.round((1800 + w * 200) * weekDurScale / 100) * 100)
        );
        const longSecs = Math.round((longSwimMeters / 100) * safeCssSecs * 1.18);
        addSwimSession(
          longOffset,
          `Wk${weekNum} Continuous Open-Water / 1500m Endurance (${formatSwimDistance(longSwimMeters, distanceUnit)})`,
          `Warmup\n- 400m Z1 Progressive @ ${easySwimPaceStr}\n\nMain Set 1\n- ${formatSwimDistance(Math.max(800, longSwimMeters - 600), distanceUnit)} Negative-Split Sighting Endurance near ${cssPaceStr}\n\nCooldown\n- 200m Z1 Flush`,
          `Sustained open-water pacing & bilateral breathing rhythm (${formatSwimDistance(longSwimMeters, distanceUnit)}).`,
          longSecs,
          (longSecs / 3600) * (isDeload ? 54 : 68)
        );
      }
    } else if (isTri) {
      // ==================== TRIATHLON ARCHETYPES (OLYMPIC & 70.3) ====================
      const is703 = archetypeId === 'TRI_70_3';
      const easyRunStr = formatPace(easyPaceSecs, distanceUnit);
      const tRunStr = formatPace(safeThresholdPace, distanceUnit);
      const aeroBikeWatts = Math.round(effectiveFtp * (is703 ? 0.8 : 0.88));
      const ssBikeWatts = Math.round(effectiveFtp * 0.9);

      if (isFinalRaceWeek) {
        addSwimSession(
          q1Offset,
          `Wk${weekNum} Race-Week Swim Opener (4x100m @ ${cssPaceStr})`,
          `Warmup\n- 300m Z1 Free\n\nMain Set 1\n- 4x100m @ ${cssPaceStr} CSS (20s rest)\n\nCooldown\n- 200m Easy`,
          `Light open-water/pool sharpness without arm fatigue.`,
          1200,
          20
        );
        addBrickSession(
          q2Offset,
          `Wk${weekNum} Taper Bike → Run T2 Opener (28m)`,
          `Warmup\n- 10m 56% FTP Easy Bike\n\nMain Set 1\n- 8m 88% FTP Bike Opener\n\nMain Set 2\n- 2m T2 Change\n- 8m 86% Pace T2 Crisp Run`,
          `Short neuromuscular T2 primer calibrated to ${effectiveFtp}W FTP & ${tRunStr} run pace.`,
          1680,
          26
        );
        addSwimSession(
          longOffset,
          `Wk${weekNum} Pre-Race Shakeout Swim (600m Easy)`,
          `Warmup\n- 400m Z1 Flush\n\nMain Set 1\n- 4x50m Progressive Sighting`,
          `Calm pre-start taper flush (~50% peak volume).`,
          900,
          12
        );
      } else {
        // Q1: Pool CSS Threshold Swim (zero % FTP)
        const swimReps = isDeload ? 6 : is703 ? 10 : 8;
        const swimMeters = 400 + swimReps * 150 + 200;
        const swimSecs = Math.round((swimMeters / 100) * safeCssSecs * 1.18);
        addSwimSession(
          q1Offset,
          `Wk${weekNum} Tri Swim CSS: ${swimReps}x150m @ ${cssPaceStr}`,
          `Warmup\n- 400m Easy Choice + 4x50 Sighting Drill\n\nMain Set 1\n- ${swimReps}x150m @ ${cssPaceStr} CSS (20s rest)\n\nCooldown\n- 200m Easy`,
          `Race-pace sighting & CSS swim durability (${formatSwimDistance(swimMeters, distanceUnit)}).`,
          swimSecs,
          (swimSecs / 3600) * (isDeload ? 54 : 70)
        );

        // Q2: Aero Bike Threshold / Sweet-Spot
        const bikeReps = isDeload ? 2 : is703 ? 4 : 3;
        const bikeRepMins = is703 ? 15 : 12;
        addCyclingSession(
          q2Offset,
          `Wk${weekNum} Tri Aero Bike: ${bikeReps}x${bikeRepMins}m @ ${ssBikeWatts}W`,
          `- 12m 56% FTP Warmup\nMain Set ${bikeReps}x\n- ${bikeRepMins}m 88% FTP Aero Position\n- 4m 52% FTP Easy Spin\n- 8m 50% FTP Cooldown`,
          `Sustained aero-bar power holding ~${ssBikeWatts}W while keeping legs ready to run.`,
          false
        );

        // Easy / balanced weekday sessions across Run, Swim, Bike
        easyOffsets.forEach((off, idx) => {
          if (idx % 2 === 0) {
            const runMins = capMins((is703 ? 45 : 38) * weekDurScale, 55);
            addRunningSession(
              off,
              `Wk${weekNum} Tri Easy Aerobic Run (${runMins}m @ ${easyRunStr})`,
              `- 8m 64% Pace Warmup\n- ${Math.max(15, runMins - 14)}m 72% Pace Easy Z2 Run\n- 6m 60% Pace Cooldown`,
              `Low-impact Z2 mileage at ${easyRunStr} building run durability under bike load.`
            );
          } else {
            const aerobicSwimMeters = is703 ? 2000 : 1600;
            const sSecs = Math.round((aerobicSwimMeters / 100) * safeCssSecs * 1.22);
            addSwimSession(
              off,
              `Wk${weekNum} Aerobic Pull & Buoy Swim (${formatSwimDistance(aerobicSwimMeters, distanceUnit)})`,
              `Warmup\n- 400m Z1 Free\n\nMain Set 1\n- ${formatSwimDistance(aerobicSwimMeters - 600, distanceUnit)} Pull Buoy Tempo @ ${formatSwimPacePer100(safeCssSecs + 5, distanceUnit)}\n\nCooldown\n- 200m Easy`,
              `Upper-body aerobic endurance saving legs for weekend brick work.`,
              sSecs,
              (sSecs / 3600) * 58
            );
          }
        });

        // Weekend Long Brick: Aero Ride -> Off-Bike T2 Run
        const bikeBrickMins = capMins(
          (is703 ? 95 + Math.min(45, w * 4) : 60 + Math.min(25, w * 3)) * weekDurScale,
          155
        );
        const runBrickMins = capMins(
          (is703 ? 30 + Math.min(20, w * 2) : 20 + Math.min(12, w)) * weekDurScale,
          55
        );
        const totalBrickMins = 12 + bikeBrickMins + 2 + runBrickMins + 6;
        const brickTss = Math.round((totalBrickMins / 60) * (isDeload || isTaper ? 58 : 78));
        addBrickSession(
          longOffset,
          `Wk${weekNum} ${is703 ? '70.3' : 'Olympic'} Long Ride → T2 Brick (${bikeBrickMins}m Bike + ${runBrickMins}m Run)`,
          `Warmup\n- 12m 58% FTP Aero Warmup\n\nMain Set 1 (Aero Bike)\n- ${bikeBrickMins}m ${is703 ? 78 : 84}% FTP Race Effort (${aeroBikeWatts}W)\n\nMain Set 2 (T2 Brick Run)\n- 2m T2 Transition\n- ${runBrickMins}m 88% Pace Off-Bike Run\n\nCooldown\n- 6m 60% Pace Easy Walk/Jog`,
          `Practice race fueling (60–90g CHO/hr on bike) and T2 cadence transition into ${runBrickMins}m steady run (~${tRunStr} threshold).`,
          totalBrickMins * 60,
          brickTss
        );
      }
    } else if (!isRunning) {
      // ==================== 7 CYCLING ARCHETYPES ====================
      const ssWatts = Math.round(effectiveFtp * 0.9);
      const ftpTargetW = Math.round(effectiveFtp * 0.98);
      const vo2Watts = Math.round(effectiveFtp * 1.12);
      const z2Watts = Math.round(effectiveFtp * 0.69);

      if (isFinalRaceWeek) {
        addCyclingSession(
          q1Offset,
          `Wk${weekNum} Race Opener: 3x2m @ ${ftpTargetW}W + 3x20s Surges`,
          `- 12m 56% FTP Warmup\nMain Set 3x\n- 2m 100% FTP Opener\n- 3m 52% FTP Easy Spin\nMain Set 3x\n- 20s 125% FTP Snap\n- 2m 50% FTP Spin\n- 8m 50% FTP Cooldown`,
          `Crisp neuromuscular openers @ ${effectiveFtp}W FTP baseline while shedding fatigue (~50% taper volume).`,
          true
        );
        addCyclingSession(
          q2Offset,
          `Wk${weekNum} Taper Legs Flush (35m Easy)`,
          `- 10m 54% FTP Warmup\n- 20m 64% FTP Z2 Flush\n- 5m 50% FTP Cooldown`,
          `Low-strain spin keeping leg speed fresh for event day.`,
          true
        );
        addCyclingSession(
          longOffset,
          `Wk${weekNum} Goal Event Peak / Shakeout (40m)`,
          `- 10m 55% FTP Warmup\n- 22m 75% FTP Race Spin\n- 8m 50% FTP Cooldown`,
          `Final race-week activation calibrated for peak TSB freshness (+5 to +15 Form).`
        );
      } else {
        // Key Quality 1 (Q1)
        if (archetypeId === 'CYC_TIME_CRUNCHED_INDOOR') {
          const reps = isDeload ? 3 : 4;
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} Indoor ERG: ${reps}x6m Over-Unders (${Math.round(effectiveFtp * 0.96)}W)`,
            `- 8m 56% FTP Warmup\nMain Set ${reps}x\n- 6m 96% FTP Threshold\n- 3m 52% FTP Spin\n- 6m 50% FTP Cooldown`,
            `Indoor FTP ${effectiveFtp}W calibrated (<=60m weekday cap).`,
            true
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Indoor VO2: 4x3m @ ${vo2Watts}W (45m)`,
            `- 10m 58% FTP Warmup\nMain Set 4x\n- 3m 112% FTP VO2max\n- 3m 50% FTP Recovery\n- 10m 50% FTP Cooldown`,
            `High-density aerobic ceiling stimulus fitting strict 45–60m trainer windows.`,
            true
          );
        } else if (archetypeId === 'CYC_CRIT_ROAD_RACE') {
          const surgeSets = isDeload ? 8 : 12;
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} Crit Microbursts: ${surgeSets}x30/15s @ ${Math.round(effectiveFtp * 1.24)}W`,
            `- 15m 60% FTP Warmup\nMain Set ${surgeSets}x\n- 30s 124% FTP Surge\n- 15s 55% FTP Float\n- 12m 54% FTP Recovery\nMain Set ${Math.max(4, surgeSets - 4)}x\n- 30s 122% FTP Acceleration\n- 15s 55% FTP Float\n- 10m 52% FTP Cooldown`,
            `Repeatable corner exit power (~${Math.round(effectiveFtp * 1.24)}W) with rapid lactate clearance.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Crit Attack + Threshold Hold (${isDeload ? '3x6m' : '4x8m'})`,
            `- 15m 60% FTP Warmup\nMain Set ${isDeload ? 3 : 4}x\n- ${isDeload ? 6 : 8}m 98% FTP Breakaway Pace\n- 4m 55% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Simulate attacking off the front and holding threshold watts (${ftpTargetW}W) in the aero drops.`
          );
        } else if (archetypeId === 'CYC_40K_TT_AERO') {
          const ttSyntax = isDeload
            ? `- 12m 58% FTP Warmup\nMain Set 2x\n- 12m 95% FTP Aero Threshold\n- 4m 52% FTP Spin\n- 10m 52% FTP Cooldown`
            : weekNum >= blockWeeks - 2
              ? `- 15m 60% FTP Warmup\n- 36m 99% FTP Aero TT Simulation\n- 10m 52% FTP Cooldown`
              : `- 15m 60% FTP Warmup\nMain Set 2x\n- 20m 97% FTP Aero Threshold\n- 5m 52% FTP Easy Spin\n- 10m 52% FTP Cooldown`;
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} 40K Aero TTE @ ${ftpTargetW}W`,
            ttSyntax,
            `Stay in aero tuck 100% of work blocks to build Time Trial TTE near ${ftpTargetW}W.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} TT Over-Under Control: 3x12m @ 95–102% FTP`,
            `- 15m 58% FTP Warmup\nMain Set ${isDeload ? 2 : 3}x\n- 12m 96% FTP Aero Over-Under\n- 4m 52% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Dial cadence 90–95 rpm with minimal torso rock on flat & false-flat terrain.`
          );
        } else if (archetypeId === 'CYC_CLIMBING_WKG') {
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} Low-Cadence Climb Torque: ${isDeload ? '3x8m' : '4x10m'} @ ${Math.round(effectiveFtp * 0.92)}W`,
            `- 15m 58% FTP Warmup\nMain Set ${isDeload ? 3 : 4}x\n- ${isDeload ? 8 : 10}m 92% FTP Climb 60rpm\n- 4m 54% FTP Spin\n- 10m 52% FTP Cooldown`,
            `Muscular endurance seated on 6–8% climbs @ ~${Math.round(effectiveFtp * 0.92)}W.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Mountain VO2 / W/kg Pitch: ${isDeload ? '3x4m' : '5x4m'} @ ${vo2Watts}W`,
            `- 15m 60% FTP Warmup\nMain Set ${isDeload ? 3 : 5}x\n- 4m 110% FTP Steep Grade Climb\n- 4m 52% FTP Descent Spin\n- 10m 52% FTP Cooldown`,
            `Raise peak sustainable VAM on sustained mountain gradients.`
          );
        } else if (archetypeId === 'CYC_POLARIZED_BASE') {
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} Seiler Polarized Ceiling: ${isDeload ? '3x6m' : '4x8m'} @ ${Math.round(effectiveFtp * 1.06)}W`,
            `- 15m 58% FTP Warmup\nMain Set ${isDeload ? 3 : 4}x\n- ${isDeload ? 6 : 8}m 106% FTP VO2max\n- 4m 52% FTP Easy Spin\n- 12m 54% FTP Cooldown`,
            `80/20 Polarized quality day: hard Z5 ceiling blocks flanked by purely easy Z1/Z2 riding.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Polarized Z2 Endurance Ride (${capMins(75 * weekDurScale, 90)}m)`,
            `- 10m 55% FTP Warmup\n- ${capMins(75 * weekDurScale, 90) - 20}m 68% FTP Strict Z2\n- 10m 52% FTP Cooldown`,
            `Keep strictly <74% FTP (${z2Watts}W) to preserve Seiler >=80% low-intensity distribution.`
          );
        } else if (archetypeId === 'CYC_GRAVEL_FONDO') {
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} Gravel Tempo Strength: ${isDeload ? '2x15m' : '3x15m'} @ ${ssWatts}W`,
            `- 15m 58% FTP Warmup\nMain Set ${isDeload ? 2 : 3}x\n- 15m 86% FTP Gravel Tempo\n- 4m 54% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Build fatigue-resistant torque (~${ssWatts}W) across rough surface pacing.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Fondo VO2 Booster: ${isDeload ? '3x4m' : '5x4m'} @ ${vo2Watts}W`,
            `- 15m 60% FTP Warmup\nMain Set ${isDeload ? 3 : 5}x\n- 4m 110% FTP Climb Punch\n- 4m 52% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Keep top-end punch sharp while weekend rides push multi-hour durability.`
          );
        } else {
          // CYC_FTP_BUILDER
          addCyclingSession(
            q1Offset,
            `Wk${weekNum} FTP Ceiling: ${isDeload ? '3x4m' : '5x4m'} @ ${vo2Watts}W`,
            `- 15m 62% FTP Warmup\nMain Set ${isDeload ? 3 : 5}x\n- 4m 112% FTP VO2max\n- 4m 52% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Raise VO2 ceiling (~${vo2Watts}W) to lift sustainable FTP headroom.`
          );
          addCyclingSession(
            q2Offset,
            `Wk${weekNum} Sweet Spot Progression: ${isDeload ? '2x10m' : '4x10m'} @ ${ssWatts}W`,
            `- 12m 60% FTP Warmup\nMain Set ${isDeload ? 2 : 4}x\n- 10m 92% FTP Sweet Spot\n- 3m 54% FTP Recovery\n- 10m 52% FTP Cooldown`,
            `Build muscular threshold durability at ${ssWatts}–${ftpTargetW}W.`
          );
        }

        // Easy Weekday Fillers
        easyOffsets.forEach((off, idx) => {
          const maxEasy = isTimeCrunched ? 50 : 75;
          const easyMins = capMins((idx === 0 ? 55 : 45) * weekDurScale, maxEasy);
          addCyclingSession(
            off,
            `Wk${weekNum} Z2 Aerobic Base (${easyMins}m @ ${z2Watts}W)`,
            `- 8m 54% FTP Warmup\n- ${Math.max(15, easyMins - 16)}m 68% FTP Z2 Endurance\n- 8m 52% FTP Cooldown`,
            `Low-strain aerobic spin (<73% FTP / ~${z2Watts}W) with zero Z3 creep.`,
            isTimeCrunched
          );
        });

        // Weekend Long Ride (Capped at 75m if Time-Crunched Indoor; scales up for Fondo)
        const baseLongMins =
          archetypeId === 'CYC_GRAVEL_FONDO'
            ? 145 + Math.min(60, w * 8)
            : archetypeId === 'CYC_POLARIZED_BASE'
              ? 120 + Math.min(45, w * 5)
              : isTimeCrunched
                ? 68
                : 105 + Math.min(35, w * 4);
        const longMins = capMins(baseLongMins * weekDurScale, isTimeCrunched ? 75 : 220);

        const longSyntax =
          archetypeId === 'CYC_POLARIZED_BASE'
            ? `- 12m 56% FTP Warmup\n- ${Math.max(25, longMins - 22)}m 68% FTP Strict Z2 Ride\n- 10m 52% FTP Cooldown`
            : isTimeCrunched
              ? `- 10m 58% FTP Warmup\n- ${Math.max(25, longMins - 20)}m 75% FTP Z2/Tempo\n- 10m 52% FTP Cooldown`
              : `- 15m 56% FTP Warmup\n- ${Math.max(30, longMins - 40)}m 69% FTP Z2 Endurance\n- 15m 86% FTP Z3 Tempo Finish\n- 10m 52% FTP Cooldown`;

        addCyclingSession(
          longOffset,
          `Wk${weekNum} ${isTimeCrunched ? 'Weekend Indoor Endurance' : 'Long Z2 Endurance'} (${longMins}m)`,
          longSyntax,
          archetypeId === 'CYC_POLARIZED_BASE'
            ? `Pure Seiler Z2 aerobic volume (~${z2Watts}W) — fuel 60g CHO/hr and monitor drift.`
            : `Durability ride anchored around ${z2Watts}W Z2; keep cardiac decoupling <3.5%.`,
          isTimeCrunched
        );
      }
    } else {
      // ==================== 4 ROAD RUNNING ARCHETYPES (0 % FTP LEAKS!) ====================
      const ePaceStr = formatPace(easyPaceSecs, distanceUnit);
      const mpPaceStr = formatPace(mpPaceSecs, distanceUnit);
      const tPaceStr = formatPace(safeThresholdPace, distanceUnit);
      const cvPaceStr = formatPace(cvPaceSecs, distanceUnit);
      const vo2PaceStr = formatPace(vo2PaceSecs, distanceUnit);
      const rPaceStr = formatPace(rPaceSecs, distanceUnit);

      if (archetypeId === 'ROAD_RETURN_TO_RUN' || archetypeId === 'ROAD_FIRST_5K') {
        const isRebuild = archetypeId === 'ROAD_RETURN_TO_RUN';
        const jogMins = isRebuild ? Math.min(34, 14 + weekNum * 3) : Math.min(40, 20 + weekNum * 3);
        const walkJogReps = isRebuild ? Math.max(4, 7 - Math.floor(weekNum / 2)) : 4;
        const runIntervalMins = isRebuild ? Math.min(8, 3 + Math.floor(weekNum / 2)) : Math.min(10, 5 + Math.floor(weekNum / 2));

        if (isFinalRaceWeek) {
          addRunningSession(
            longOffset,
            isRebuild ? `Wk${weekNum} 30-Minute Pain-Free Milestone Run` : `Wk${weekNum} First 5K Celebration Run`,
            `- 5m 54% Pace Brisk Walk Warmup\n- ${isRebuild ? 25 : 28}m 66% Pace Steady Conversational Effort\n- 3m 52% Pace Cool-Down Walk`,
            `Focus on smooth tall posture and relaxed breathing — completion over pace.`
          );
        } else {
          addRunningSession(
            q1Offset,
            isRebuild
              ? `Wk${weekNum} Walk/Jog Tendon Prep (${walkJogReps}× ${runIntervalMins}m Jog / 90s Walk)`
              : `Wk${weekNum} Easy Rhythm Walk/Jog (${jogMins}m Total)`,
            `- 5m 52% Pace Brisk Walk Warmup\nMain Set ${walkJogReps}x\n- ${runIntervalMins}m 66% Pace Gentle Jog\n- 90s 52% Pace Walk Recovery\n- 5m 52% Pace Cooldown Walk`,
            `Gentle cyclic loading at conversational effort (~${ePaceStr}). Keep soreness at or below 2/10.`
          );
          if (q2Offset !== q1Offset && q2Offset !== longOffset) {
            addRunningSession(
              q2Offset,
              isRebuild
                ? `Wk${weekNum} Low-Impact Flush + Stride Balance (${jogMins}m)`
                : `Wk${weekNum} Conversational Base + Gentle Strides (${jogMins}m)`,
              `- 5m 52% Pace Brisk Walk Warmup\n- ${Math.max(12, jogMins - 10)}m 66% Pace Conversational Effort\n- 5m 52% Pace Cooldown Walk`,
              `Easy conversational miles (~${ePaceStr}). Swap to an easy stationary bike or pool session anytime legs feel heavy.`
            );
          }
          addRunningSession(
            longOffset,
            isRebuild
              ? `Wk${weekNum} Weekend Progressive Walk/Jog (${jogMins + 6}m)`
              : `Wk${weekNum} Weekend Endurance Anchor (${Math.min(45, jogMins + 10)}m)`,
            `- 5m 52% Pace Brisk Walk Warmup\n- ${Math.min(36, jogMins)}m 68% Pace Comfortable Jog\n- 5m 52% Pace Cooldown Walk`,
            `Gradual endurance progression prioritizing consistency over speed.`
          );
        }
      } else if (isFinalRaceWeek) {
        addRunningSession(
          q1Offset,
          `Wk${weekNum} Taper Sharpener: 4x400m @ ${formatTrackSplitToken(
            (safeThresholdPace * 0.96 * 400) / 1000
          )} + Strides`,
          `- 12m 65% Pace Warmup\nMain Set 4x\n- 400m 104% Pace Controlled Opener\n- 90s 56% Pace Jog\n- 8m 62% Pace Cooldown`,
          `Flush heavy legs while maintaining neuromuscular elasticity at ${tPaceStr}. Keep effort smooth.`,
          {
            repCount: 4,
            repDistanceMeters: 400,
            zoneCode: 'CV',
            podIntensity: 'THRESHOLD_CV',
            targetSplitSecs: Number(((cvPaceSecs * 400) / 1000).toFixed(1)),
            restDurationSecs: 90,
            waveMode: 'POD_10S',
          }
        );
        addRunningSession(
          q2Offset,
          `Wk${weekNum} Pre-Race Shakeout (25m Easy + 4 Strides)`,
          `- 20m 65% Pace Easy Shakeout\nMain Set 4x\n- 20s 108% Pace Light Stride\n- 60s 55% Pace Jog\n- 5m 60% Pace Cooldown`,
          `Easy parasympathetic jog at ${ePaceStr} prioritizing glycogen loading and hydration.`
        );
        addRunningSession(
          longOffset,
          `Wk${weekNum} Race Week / Shakeout Run (30m)`,
          `- 25m 66% Pace Easy Flush\n- 5m 60% Pace Cooldown`,
          `Short aerobic shakeout or race-day warmup keeping final-week volume ~50% reduced.`
        );
      } else {
        if (archetypeId === 'ROAD_5K') {
          const reps800 = isDeload ? 4 : 6;
          const split800 = formatTrackSplitToken((vo2PaceSecs * 800) / 1000);
          addRunningSession(
            q1Offset,
            `Wk${weekNum} 5K Track VO2: ${reps800}x800m @ ${split800}`,
            `- 12m 66% Pace Warmup\nMain Set ${reps800}x\n- 800m 110% Pace VO2max\n- 2m 56% Pace Jog\n- 10m 62% Pace Cooldown`,
            `Target 5K VO2 pace (~${vo2PaceStr}) hitting ${split800} per 800m.`,
            {
              repCount: reps800,
              repDistanceMeters: 800,
              zoneCode: 'I',
              podIntensity: 'INTERVAL_VO2',
              targetSplitSecs: Number(((vo2PaceSecs * 800) / 1000).toFixed(1)),
              restDurationSecs: 120,
              waveMode: 'POD_10S',
            }
          );
          addRunningSession(
            q2Offset,
            `Wk${weekNum} 5K Speed Economy: ${isDeload ? 4 : 6}x400m @ ${rPaceStr}`,
            `- 12m 65% Pace Warmup\nMain Set ${isDeload ? 4 : 6}x\n- 400m 118% Pace R Pace\n- 90s 56% Pace Jog\n- 10m 62% Pace Cooldown`,
            `Smooth 5K finishing speed (~${rPaceStr}) with relaxed shoulders.`,
            {
              repCount: isDeload ? 4 : 6,
              repDistanceMeters: 400,
              zoneCode: 'R',
              podIntensity: 'REPETITION',
              targetSplitSecs: Number(((rPaceSecs * 400) / 1000).toFixed(1)),
              restDurationSecs: 90,
              waveMode: 'POD_10S',
            }
          );
        } else if (archetypeId === 'ROAD_10K') {
          const cvReps = isDeload ? 4 : 6;
          const split1k = formatTrackSplitToken(cvPaceSecs);
          addRunningSession(
            q1Offset,
            `Wk${weekNum} 10K CV Repeats: ${cvReps}x1000m @ ${split1k}`,
            `- 12m 66% Pace Warmup\nMain Set ${cvReps}x\n- 1000m 102% Pace CV Pace\n- 75s 56% Pace Jog\n- 10m 62% Pace Cooldown`,
            `Tinman CV intervals (~${cvPaceStr}) maximizing slow-twitch endurance without overtaxing recovery.`,
            {
              repCount: cvReps,
              repDistanceMeters: 1000,
              zoneCode: 'CV',
              podIntensity: 'THRESHOLD_CV',
              targetSplitSecs: Number(cvPaceSecs.toFixed(1)),
              restDurationSecs: 75,
              waveMode: 'POD_10S',
            }
          );
          addRunningSession(
            q2Offset,
            `Wk${weekNum} 10K Cruise Tempo: ${isDeload ? '3x6m' : '4x8m'} @ ${tPaceStr}`,
            `- 12m 66% Pace Warmup\nMain Set ${isDeload ? 3 : 4}x\n- ${isDeload ? 6 : 8}m 98% Pace Threshold Pace\n- 2m 56% Pace Float\n- 10m 62% Pace Cooldown`,
            `Sustained lactate clearance at ${tPaceStr} threshold.`
          );
        } else if (archetypeId === 'ROAD_HALF_MARATHON') {
          const reps = isDeload ? 3 : Math.min(5, 3 + Math.floor(w / 3));
          addRunningSession(
            q1Offset,
            `Wk${weekNum} HM Threshold Cruise: ${reps}x8m @ ${tPaceStr}`,
            `- 12m 66% Pace Warmup\nMain Set ${reps}x\n- 8m 98% Pace Threshold Cruise\n- 3m 56% Pace Float\n- 10m 62% Pace Cooldown`,
            `Dial rhythm around ${tPaceStr} with active 3m floats rather than standing rest.`
          );
          addRunningSession(
            q2Offset,
            `Wk${weekNum} Half-Marathon Rhythm: ${isDeload ? '20m' : '30m'} @ ${formatPace(tempoPaceSecs, distanceUnit)}`,
            `- 12m 66% Pace Warmup\n- ${isDeload ? 20 : 30}m 92% Pace HM Tempo Pace\n- 10m 62% Pace Cooldown`,
            `Lock into half-marathon goal pace (~${formatPace(tempoPaceSecs, distanceUnit)}) watching cardiac drift <3.5%.`
          );
        } else {
          // ROAD_MARATHON
          addRunningSession(
            q1Offset,
            `Wk${weekNum} Marathon Cruise Threshold: ${isDeload ? '3x6m' : '4x10m'} @ ${tPaceStr}`,
            `- 12m 66% Pace Warmup\nMain Set ${isDeload ? 3 : 4}x\n- ${isDeload ? 6 : 10}m 97% Pace Threshold Pace\n- 3m 56% Pace Float\n- 10m 62% Pace Cooldown`,
            `Raise lactate clearance ceiling to pull marathon race pace (~${mpPaceStr}) lower.`
          );
          addRunningSession(
            q2Offset,
            `Wk${weekNum} Midweek Marathon Pace Progression (${isDeload ? '35m' : '50m'})`,
            `- 15m 66% Pace Warmup\n- ${isDeload ? 15 : 25}m 89% Pace Marathon Pace\n- 10m 62% Pace Cooldown`,
            `Lock smoothly onto ${mpPaceStr} marathon effort after an easy aerobic warmup.`
          );
        }

        // Easy Weekday Runs
        easyOffsets.forEach((off, idx) => {
          const easyMins = capMins((idx === 0 ? 46 : 38) * weekDurScale, 58);
          addRunningSession(
            off,
            `Wk${weekNum} Easy Aerobic Run (${easyMins}m @ ${ePaceStr})`,
            `- 8m 64% Pace Warmup\n- ${Math.max(15, easyMins - 16)}m 70% Pace Easy Aerobic\nMain Set 4x\n- 20s 108% Pace Stride\n- 60s 56% Pace Jog\n- 6m 60% Pace Cooldown`,
            `Conversational aerobic running (~${ePaceStr}) + relaxed strides.`
          );
        });

        // Weekend Long Run (Zero % FTP anywhere!)
        const baseLongRunMins =
          archetypeId === 'ROAD_MARATHON'
            ? 105 + Math.min(60, w * 5)
            : archetypeId === 'ROAD_HALF_MARATHON'
              ? 85 + Math.min(40, w * 4)
              : 70 + Math.min(25, w * 3);
        const longRunMins = capMins(baseLongRunMins * weekDurScale, 170);
        const fastFinishMins = archetypeId === 'ROAD_MARATHON' && !isDeload && !isTaper ? 20 : 12;

        addRunningSession(
          longOffset,
          `Wk${weekNum} Long Endurance Run (${longRunMins}m${
            !isDeload && !isTaper ? ` + ${fastFinishMins}m Tempo Finish` : ''
          })`,
          isDeload || isTaper
            ? `- 10m 64% Pace Warmup\n- ${Math.max(25, longRunMins - 20)}m 70% Pace Easy Long Run\n- 10m 62% Pace Cooldown`
            : `- 12m 65% Pace Warmup\n- ${Math.max(30, longRunMins - 22 - fastFinishMins)}m 71% Pace Z2 Long Run\n- ${fastFinishMins}m ${
                archetypeId === 'ROAD_MARATHON' ? '89%' : '86%'
              } Pace Steady Finish\n- 10m 62% Pace Cooldown`,
          `Build aerobic endurance at ${ePaceStr} closing near ${
            archetypeId === 'ROAD_MARATHON' ? mpPaceStr : formatPace(tempoPaceSecs, distanceUnit)
          }. Practice 60–90g/hr carb fueling on 75m+ runs.`
        );
      }
    }

    sessions.sort((a, b) => a.date.localeCompare(b.date));
    const totalSecs = sessions.reduce((acc, s) => acc + s.plannedDurationSecs, 0);
    const totalTss = sessions.reduce((acc, s) => acc + s.plannedLoad, 0);
    const zoneDistributionPct = computeZoneDistributionFromSessions(sessions, safeThresholdPace);

    weeks.push({
      weekNum,
      startDateIso: weekMondayIso,
      phase,
      isDeload,
      isTaper,
      targetTss: totalTss,
      targetHours: (totalSecs / 3600).toFixed(1),
      sessions,
      zoneDistributionPct,
    });
  }

  return weeks;
}
