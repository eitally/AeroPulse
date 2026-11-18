import type {
  AthleteProfile,
  DistanceUnit,
  SportCategory,
  TrackWorkoutSpec,
} from '../types';
import { formatPace } from '../utils/formatters';
import { parseWorkoutSteps } from '../utils/workoutParser';
import { formatTrackSplitToken } from './trackPrescriptionEngine';

export type EndurancePlanArchetypeId =
  | 'CYC_FTP_BUILDER'
  | 'CYC_TIME_CRUNCHED_INDOOR'
  | 'CYC_CRIT_ROAD_RACE'
  | 'CYC_40K_TT_AERO'
  | 'CYC_CLIMBING_WKG'
  | 'CYC_GRAVEL_FONDO'
  | 'CYC_POLARIZED_BASE'
  | 'ROAD_5K'
  | 'ROAD_10K'
  | 'ROAD_HALF_MARATHON'
  | 'ROAD_MARATHON';

export type PlanStartAnchorMode = 'NEXT_MONDAY' | 'THIS_WEEK' | 'RACE_DATE';
export type PlanVolumeTier = 'AUTO' | 'STARTER' | 'INTERMEDIATE' | 'COMPETITIVE';

export interface EnduranceArchetypeMeta {
  id: EndurancePlanArchetypeId;
  category: 'CYCLING' | 'ROAD';
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
  const sport: SportCategory = isRunning ? 'Running' : 'Cycling';
  const isTimeCrunched = archetypeId === 'CYC_TIME_CRUNCHED_INDOOR';
  const effectiveFtp = isTimeCrunched
    ? Math.max(100, athleteProfile?.indoorFtp || athleteProfile?.ftp || ftpWatts || 250)
    : Math.max(100, athleteProfile?.ftp || ftpWatts || 260);
  const safeThresholdPace = Math.max(150, athleteProfile?.thresholdPaceSecsPerKm || 255);
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
    (archetypeId === 'CYC_GRAVEL_FONDO' || archetypeId === 'ROAD_MARATHON') && blockWeeks >= 12;

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

    if (!isRunning) {
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

      if (isFinalRaceWeek) {
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
