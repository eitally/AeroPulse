import React, { useId, useMemo, useState } from 'react';
import {
  Award,
  Bike,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Download,
  Footprints,
  Gauge,
  Plus,
  Sparkles,
  Target,
  Timer,
  Trash2,
  Trophy,
} from "./icons/PhosphorIcons";
import {
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SpeedReservePhenotype,
  SportCategory,
  TargetGoal,
  TrackTargetEventGroup,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  buildTrackSpeedReserveProfile,
  defaultMetersForTrackEvent,
  parseTrackMarkClockInput,
} from '../physiology/trackSpeedReserveEngine';
import {
  formatTrackSplitToken,
  generatePeriodizedTrackPlan,
  type TrackStartingPhaseOption,
} from '../physiology/trackPrescriptionEngine';
import {
  formatDuration,
  formatGoalMetricValue,
  formatPace,
} from '../utils/formatters';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';
import {
  buildFitStepsFromWorkoutSyntax,
  downloadGarminFitWorkoutFile,
} from '../utils/fitWorkoutEncoder';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  stageWorkoutInTracksideStopwatch,
} from '../hooks/useTracksideStopwatch';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { computeFatigueSlicedDurability } from '../physiology/durabilityEngine';
import { simulateCoursePacingAndFueling } from '../physiology/raceSimulator';

export interface PlannedEventBatchItem {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  trackSpec?: TrackWorkoutSpec;
  replaceExistingDate?: boolean;
}

interface GoalsViewProps {
  annualMileageGoals: AnnualMileageGoal[];
  onUpdateAnnualMileageGoal: (sport: 'Running' | 'Cycling', targetMeters: number) => void;
  targetGoals: TargetGoal[];
  onAddTargetGoal: (goal: Omit<TargetGoal, 'id'>) => void;
  onDeleteTargetGoal: (id: string) => void;
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents?: PlannedWorkoutEvent[];
  athleteProfile?: AthleteProfile;
  gearItems?: AthleteGearItem[];
  envFilter: EnvironmentFilter;
  onSelectEnvFilter: (env: EnvironmentFilter) => void;
  distanceUnit: DistanceUnit;
  currentCtl: number;
  onBatchCreatePlannedEvents?: (events: PlannedEventBatchItem[]) => Promise<void>;
  onSaveProfileOverride?: (updatedProfile: AthleteProfile) => Promise<void>;
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSwitchToCalendar?: () => void;
  onOpenOfficialRaceModal?: () => void;
  onOpenCoachWithPrompt?: (prompt: string) => void;
  onOpenTracksideStopwatch?: () => void;
}

const ALL_SPORTS_LIST: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength'];

export type GoalArchetypeId =
  | 'TRACK_800M'
  | 'TRACK_1500_MILE'
  | 'TRACK_3000_3200M'
  | 'TRACK_5000M'
  | 'SUB20_5K'
  | 'HALF_MARATHON'
  | 'FTP_350W'
  | 'GRAN_FONDO';

export type GoalArchetypeCategory = 'ALL' | 'TRACK' | 'ROAD' | 'CYCLING';

interface GoalArchetypeTemplate {
  id: GoalArchetypeId;
  category: Exclude<GoalArchetypeCategory, 'ALL'>;
  badge: string;
  title: string;
  subtitle: string;
  sportCategory: SportCategory;
  targetLabel: string;
  defaultWeeks: 4 | 8 | 12 | 16;
  trackEventGroup?: TrackTargetEventGroup;
  targetProgressionLevels: [number, number, number, number, number, number]; // Z2, Z3, Z4, Z5, Z6, Sprint
}

const GOAL_ARCHETYPES: GoalArchetypeTemplate[] = [
  {
    id: 'TRACK_800M',
    category: 'TRACK',
    badge: 'Track 800m',
    title: '800m Track Specialization',
    subtitle: 'Speed-Reserve Flys, Critical Velocity & Specific 300m Rhythm',
    sportCategory: 'Running',
    targetLabel: 'CS+D\' · ASR Peak',
    defaultWeeks: 12,
    trackEventGroup: '800M',
    targetProgressionLevels: [6.8, 7.6, 8.2, 8.8, 9.2, 9.5],
  },
  {
    id: 'TRACK_1500_MILE',
    category: 'TRACK',
    badge: 'Track 1500m / Mile',
    title: '1500m / Mile Track Architect',
    subtitle: 'Sub-T Cruises, Tinman CV & Un-Clamped R-Pace Quarter Repeats',
    sportCategory: 'Running',
    targetLabel: '400m R-Pace + CV',
    defaultWeeks: 12,
    trackEventGroup: '1500_MILE',
    targetProgressionLevels: [7.4, 7.9, 8.5, 9.0, 8.8, 8.2],
  },
  {
    id: 'TRACK_3000_3200M',
    category: 'TRACK',
    badge: 'Track 3000m / 3200m',
    title: '3000m / 3200m Championship Build',
    subtitle: 'Norwegian Sub-T Volume, CV Progressions & VO2max Economy',
    sportCategory: 'Running',
    targetLabel: 'Sub-T · CV · 3K I',
    defaultWeeks: 12,
    trackEventGroup: '3000_3200M',
    targetProgressionLevels: [8.0, 8.4, 8.8, 9.1, 7.8, 6.8],
  },
  {
    id: 'TRACK_5000M',
    category: 'TRACK',
    badge: 'Track 5000m',
    title: '5000m Track Endurance Peak',
    subtitle: 'Sub-T 1000m Density, 1200m CV Grinders & 5K Race Control',
    sportCategory: 'Running',
    targetLabel: 'High Sub-T + 5K I',
    defaultWeeks: 16,
    trackEventGroup: '5000M',
    targetProgressionLevels: [8.6, 8.8, 9.0, 8.9, 7.2, 6.2],
  },
  {
    id: 'FTP_350W',
    category: 'CYCLING',
    badge: 'Cycling Threshold',
    title: 'Cycling FTP Builder (+8% Peak)',
    subtitle: 'Progressive Sweet Spot, Over-Unders & VO2max Ceiling Expansion',
    sportCategory: 'Cycling',
    targetLabel: '+8% FTP & W/kg Peak',
    defaultWeeks: 12,
    targetProgressionLevels: [7.8, 8.5, 8.8, 7.6, 6.2, 5.5],
  },
  {
    id: 'SUB20_5K',
    category: 'ROAD',
    badge: 'Road 5K Speed',
    title: '5K Speed & VO2max Peak',
    subtitle: 'Track 400m/800m Repeats, Lactate Threshold & Aerobic Economy',
    sportCategory: 'Running',
    targetLabel: '5K Race Pace & VO2max',
    defaultWeeks: 8,
    targetProgressionLevels: [7.2, 7.5, 8.4, 8.9, 7.4, 6.5],
  },
  {
    id: 'HALF_MARATHON',
    category: 'ROAD',
    badge: 'Half Marathon Build',
    title: 'Half Marathon in 12 Weeks',
    subtitle: 'Progressive Long Runs, Cruise Threshold & Deload Recovery Weeks',
    sportCategory: 'Running',
    targetLabel: '21.1 km Sustained Threshold',
    defaultWeeks: 12,
    targetProgressionLevels: [8.8, 8.4, 8.0, 6.8, 5.2, 4.8],
  },
  {
    id: 'GRAN_FONDO',
    category: 'CYCLING',
    badge: 'Endurance & Gran Fondo',
    title: '100-Mile Gran Fondo Peak',
    subtitle: 'High-Durability Z2 Volume, Late-Ride Tempo & <3% Cardiac Drift',
    sportCategory: 'Cycling',
    targetLabel: '100 mi · <3% Cardiac Drift',
    defaultWeeks: 12,
    targetProgressionLevels: [9.2, 8.4, 7.6, 6.4, 5.4, 5.0],
  },
];

const ZONE_COLORS = [
  '#94A3B8', // Z1 Recovery
  '#0D9488', // Z2 Endurance
  '#D97706', // Z3 Tempo / Sweet Spot
  '#EA580C', // Z4 Threshold
  '#DC2626', // Z5 VO2max
  '#7C3AED', // Z6+ Anaerobic
];

function addDaysIso(baseDateIso: string, addDays: number): string {
  const now = new Date();
  const [y, m, d] = baseDateIso.split('-').map(Number);
  const dt = new Date(
    Date.UTC(y || now.getUTCFullYear(), (m || now.getUTCMonth() + 1) - 1, d || now.getUTCDate())
  );
  dt.setUTCDate(dt.getUTCDate() + addDays);
  return dt.toISOString().slice(0, 10);
}

const GoalsViewInner: React.FC<GoalsViewProps> = ({
  targetGoals,
  onAddTargetGoal,
  onDeleteTargetGoal,
  activities,
  wellnessDays,
  athleteProfile,
  distanceUnit,
  currentCtl,
  onBatchCreatePlannedEvents,
  onOpenOfficialRaceModal,
  onSwitchToCalendar,
  onOpenTracksideStopwatch,
}) => {
  const formId = useId();

  // Goal-to-Calendar Adaptive Plan Architect State
  const [archetypeCategory, setArchetypeCategory] = useState<GoalArchetypeCategory>('ALL');
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<GoalArchetypeId>('FTP_350W');
  const [blockWeeks, setBlockWeeks] = useState<4 | 8 | 12 | 16>(12);
  const [daysPerWeek, setDaysPerWeek] = useState<4 | 5 | 6>(5);
  const [longDayPreference, setLongDayPreference] = useState<'Saturday' | 'Sunday'>('Saturday');
  const [blockEnvPref, setBlockEnvPref] = useState<'FLEXIBLE' | 'OUTDOOR' | 'INDOOR'>('FLEXIBLE');
  const [trackStartingPhase, setTrackStartingPhase] =
    useState<TrackStartingPhaseOption>('FULL_PROGRESSION');
  const [trackPhenotypeOverride, setTrackPhenotypeOverride] = useState<
    SpeedReservePhenotype | 'AUTO'
  >('AUTO');
  const [trackSeedInput, setTrackSeedInput] = useState<string>('');
  const [trackGoalInput, setTrackGoalInput] = useState<string>('');
  const [selectedPreviewWeekIdx, setSelectedPreviewWeekIdx] = useState<number>(0);
  const [isPopulatingCalendar, setIsPopulatingCalendar] = useState(false);
  const [populatedSuccessMsg, setPopulatedSuccessMsg] = useState<string | null>(null);

  const visibleArchetypes = useMemo(
    () =>
      archetypeCategory === 'ALL'
        ? GOAL_ARCHETYPES
        : GOAL_ARCHETYPES.filter((a) => a.category === archetypeCategory),
    [archetypeCategory]
  );

  const selectedArchetype = useMemo(
    () => GOAL_ARCHETYPES.find((a) => a.id === selectedArchetypeId) || GOAL_ARCHETYPES[0],
    [selectedArchetypeId]
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const currentBikeFtp = useMemo(() => {
    const latestRideEftp = [...wellnessDays].reverse().find((w) => w.rideEftp && w.rideEftp > 0)?.rideEftp;
    return athleteProfile?.ftp || latestRideEftp || 250;
  }, [athleteProfile?.ftp, wellnessDays]);

  // 10x #4: Course Physics, Durability, Weather & Carb/Sodium Race Simulator State
  const [simSport, setSimSport] = useState<'Cycling' | 'Running'>('Running');
  const [simRaceName, setSimRaceName] = useState<string>('Half Marathon / Gran Fondo A-Race');
  const [simDistKm, setSimDistKm] = useState<number>(21.1);
  const [simElevM, setSimElevM] = useState<number>(185);
  const [simTempC, setSimTempC] = useState<number>(18);
  const [simAltM, setSimAltM] = useState<number>(250);

  const raceSimulationReport = useMemo(() => {
    const prof = athleteProfile || buildCompleteAthleteProfile({});
    const durReport = computeFatigueSlicedDurability({
      discipline: simSport,
      activities,
      streamMap: new Map(),
      athleteProfile: prof,
    });
    return simulateCoursePacingAndFueling({
      sport: simSport,
      raceName: simRaceName,
      distanceKm: simDistKm,
      elevationGainMeters: simElevM,
      ambientTempC: simTempC,
      altitudeMeters: simAltM,
      athleteProfile: prof,
      durabilityReport: durReport,
    });
  }, [
    simSport,
    simRaceName,
    simDistKm,
    simElevM,
    simTempC,
    simAltM,
    athleteProfile,
    activities,
  ]);

  // Track Speed-Reserve Profile (derived from official FAT races, manual seed mark, or synced threshold pace)
  const trackSpeedReserveState = useMemo(() => {
    const officialMarks = activities
      .filter((a) => Boolean(a.officialRaceData))
      .map((a) => ({
        distanceMeters: a.officialRaceData!.eventDistanceMeters,
        durationSecs: a.officialRaceData!.fatTimeSecs,
        eventLabel: a.officialRaceData!.eventLabel,
        dateIso: a.startDateLocal.slice(0, 10),
      }));

    const parsedManualSeed = parseTrackMarkClockInput(
      trackSeedInput,
      selectedArchetype.trackEventGroup
        ? defaultMetersForTrackEvent(selectedArchetype.trackEventGroup)
        : 1609.34
    );

    const marks = parsedManualSeed ? [parsedManualSeed] : officialMarks;
    const isCalibratingEstimate =
      marks.length === 0 && !(athleteProfile?.thresholdPaceSecsPerKm && athleteProfile.thresholdPaceSecsPerKm > 0);

    const profile = buildTrackSpeedReserveProfile({
      marks,
      thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm,
      phenotypeOverride: trackPhenotypeOverride,
    });

    const parsedGoalMark = parseTrackMarkClockInput(
      trackGoalInput,
      selectedArchetype.trackEventGroup
        ? defaultMetersForTrackEvent(selectedArchetype.trackEventGroup)
        : 1609.34
    );

    return {
      profile,
      parsedManualSeed,
      goalTimeSecs: parsedGoalMark?.durationSecs,
      officialMarkCount: officialMarks.length,
      isCalibratingEstimate,
    };
  }, [
    activities,
    athleteProfile?.thresholdPaceSecsPerKm,
    selectedArchetype.trackEventGroup,
    trackGoalInput,
    trackPhenotypeOverride,
    trackSeedInput,
  ]);

  const trackPlanBundle = useMemo(() => {
    if (!selectedArchetype.trackEventGroup) return null;
    const startAnchorIso =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : todayIso;
    const now = new Date();
    const [y, m, d] = startAnchorIso.split('-').map(Number);
    const dt = new Date(
      Date.UTC(y || now.getUTCFullYear(), (m || now.getUTCMonth() + 1) - 1, d || now.getUTCDate())
    );
    const dow = dt.getUTCDay() || 7;
    const mondayIso = addDaysIso(startAnchorIso, 1 - dow);

    return generatePeriodizedTrackPlan({
      startDateIso: mondayIso,
      blockWeeks,
      eventGroup: selectedArchetype.trackEventGroup,
      dateProfile: trackSpeedReserveState.profile,
      startingPhase: trackStartingPhase,
      phenotypeOverride: trackPhenotypeOverride,
      goalTimeSecs: trackSpeedReserveState.goalTimeSecs,
    });
  }, [
    activities,
    blockWeeks,
    selectedArchetype.trackEventGroup,
    todayIso,
    trackPhenotypeOverride,
    trackSpeedReserveState.goalTimeSecs,
    trackSpeedReserveState.profile,
    trackStartingPhase,
  ]);

  // Multi-Week Goal-to-Calendar Adaptive Plan Generator (with Every-4th-Week Deloads)
  const generatedPlanWeeks = useMemo(() => {
    if (trackPlanBundle) {
      return trackPlanBundle.weeks.map((wk) => ({
        weekNum: wk.weekNum,
        startDateIso: wk.startDate,
        phase: wk.phaseLabel,
        isDeload: wk.isDeload,
        isTaper: wk.isTaper,
        targetTss: wk.targetTss,
        targetHours: wk.targetHours.toFixed(1),
        targetDistanceKm: wk.targetDistanceKm,
        sessions: wk.sessions.map((s) => ({
          date: s.date,
          name: s.name,
          sportCategory: s.sportCategory,
          environmentPreference:
            blockEnvPref === 'FLEXIBLE' ? s.environmentPreference : blockEnvPref,
          plannedDurationSecs: s.plannedDurationSecs,
          plannedLoad: s.plannedLoad,
          workoutSyntax: s.workoutSyntax || '',
          description: s.description,
          trackSpec: s.trackSpec,
          replaceExistingDate: true,
        })),
        zoneDistributionPct: wk.zoneDistributionPct,
      }));
    }

    const startAnchorIso =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : todayIso;
    // Align start to the upcoming Monday (or current week's Monday)
    const now = new Date();
    const [y, m, d] = startAnchorIso.split('-').map(Number);
    const dt = new Date(
      Date.UTC(y || now.getUTCFullYear(), (m || now.getUTCMonth() + 1) - 1, d || now.getUTCDate())
    );
    const dow = dt.getUTCDay() || 7; // 1=Mon..7=Sun
    const mondayIso = addDaysIso(startAnchorIso, 1 - dow);

    const weeks: {
      weekNum: number;
      startDateIso: string;
      phase: string;
      isDeload: boolean;
      isTaper: boolean;
      targetTss: number;
      targetHours: string;
      targetDistanceKm?: number;
      sessions: PlannedEventBatchItem[];
      zoneDistributionPct: [number, number, number, number, number, number];
    }[] = [];

    const baseWeeklyTss = Math.max(240, Math.round(currentCtl * 5.2));
    const dynZones = trackSpeedReserveState.profile.zones;

    for (let w = 0; w < blockWeeks; w++) {
      const weekNum = w + 1;
      const weekMondayIso = addDaysIso(mondayIso, w * 7);
      const isTaper = weekNum === blockWeeks;
      const isDeload = !isTaper && weekNum % 4 === 0;
      const phase: 'Aerobic Base' | 'Specific Build' | 'Deload (-30%)' | 'Peak & Taper' = isTaper
        ? 'Peak & Taper'
        : isDeload
          ? 'Deload (-30%)'
          : weekNum <= Math.ceil(blockWeeks * 0.45)
            ? 'Aerobic Base'
            : 'Specific Build';

      const loadMultiplier = isTaper
        ? 0.62
        : isDeload
          ? 0.7
          : 1 + (w / Math.max(1, blockWeeks)) * 0.24;
      const targetTss = Math.round(baseWeeklyTss * loadMultiplier);

      // Build structured workouts for this week based on selectedArchetype + daysPerWeek
      const sessions: PlannedEventBatchItem[] = [];
      const sport = selectedArchetype.sportCategory;
      const longOffset = longDayPreference === 'Saturday' ? 5 : 6; // 5=Sat, 6=Sun
      const recoveryLongDayOffset = longDayPreference === 'Saturday' ? 6 : 5;

      // Session 1 (Tuesday - offset 1): Key Interval Session
      const tueDate = addDaysIso(weekMondayIso, 1);
      if (selectedArchetype.id === 'SUB20_5K') {
        const pRace = formatPace(dynZones.CV.paceSecsPerKm, distanceUnit);
        const pTrack = formatPace(dynZones.I.paceSecsPerKm, distanceUnit);
        const split400R = formatTrackSplitToken(dynZones.R.splitsSecs.m400);
        const split800I = formatTrackSplitToken(dynZones.I.splitsSecs.m800);
        sessions.push({
          date: tueDate,
          name: isDeload
            ? `Wk${weekNum} Deload: 4×400m Economy @ ${split400R}`
            : isTaper
              ? `Wk${weekNum} Taper: 3×1km @ ${pRace}`
              : `Wk${weekNum} Key Track: 6×800m @ ${split800I}`,
          sportCategory: 'Running',
          environmentPreference: blockEnvPref,
          plannedDurationSecs: isDeload ? 2400 : 3300,
          plannedLoad: isDeload ? 52 : 78,
          workoutSyntax: isDeload
            ? `- 10m 66% Pace Warmup\nMain Set 4x\n- 400m @ ${split400R} (114% Pace) R\n- 90s 56% Pace Jog\n- 10m 64% Pace Cooldown`
            : isTaper
              ? `- 12m 66% Pace Warmup\nMain Set 3x\n- 1000m @ ${formatTrackSplitToken(dynZones.CV.splitsSecs.m1000)} (102% Pace) CV\n- 2m 56% Pace Jog\n- 10m 64% Pace Cooldown`
              : `- 12m 66% Pace Warmup\nMain Set 6x\n- 800m @ ${split800I} (110% Pace) I\n- 2m 56% Pace Jog\n- 10m 64% Pace Cooldown`,
          description: `Target pace ${pTrack}–${pRace} (${split800I}/800m). Maintain relaxed shoulders and >180 spm cadence.`,
          trackSpec: {
            repCount: isDeload ? 4 : isTaper ? 3 : 6,
            repDistanceMeters: isDeload ? 400 : isTaper ? 1000 : 800,
            zoneCode: isDeload ? 'R' : isTaper ? 'CV' : 'I',
            podIntensity: isDeload ? 'REPETITION' : isTaper ? 'THRESHOLD_CV' : 'INTERVAL_VO2',
            targetSplitSecs: isDeload
              ? dynZones.R.splitsSecs.m400
              : isTaper
                ? dynZones.CV.splitsSecs.m1000
                : dynZones.I.splitsSecs.m800,
            restDurationSecs: isDeload ? 90 : 120,
            waveMode: 'POD_10S',
          },
          replaceExistingDate: true,
        });
      } else if (selectedArchetype.id === 'HALF_MARATHON') {
        const pLt = formatPace(dynZones.T.paceSecsPerKm, distanceUnit);
        sessions.push({
          date: tueDate,
          name: isDeload
            ? `Wk${weekNum} Deload: 3x6m Smooth Threshold Cruise`
            : `Wk${weekNum} HM Build: ${3 + Math.min(2, Math.floor(w / 3))}x8m Lactate Threshold (${pLt})`,
          sportCategory: 'Running',
          environmentPreference: blockEnvPref,
          plannedDurationSecs: isDeload ? 2700 : 3600,
          plannedLoad: isDeload ? 56 : 82,
          workoutSyntax: isDeload
            ? `- 10m 65% Pace Warmup\n- 6m 94% Pace Sub-T\n- 3m 56% Pace Recovery\n- 6m 94% Pace Sub-T\n- 3m 56% Pace Recovery\n- 6m 94% Pace Sub-T\n- 10m 62% Pace Cooldown`
            : `- 12m 66% Pace Warmup\n- 8m 96% Pace Threshold Cruise\n- 3m 56% Pace Float\n- 8m 97% Pace Threshold Cruise\n- 3m 56% Pace Float\n- 8m 98% Pace Threshold Cruise\n- 3m 56% Pace Float\n- 8m 98% Pace Threshold Cruise\n- 10m 62% Pace Cooldown`,
          description: `Controlled lactate clearance intervals calibrated to your ${pLt} threshold. Keep cardiac decoupling <3.5%.`,
          replaceExistingDate: true,
        });
      } else {
        // FTP_350W or GRAN_FONDO
        sessions.push({
          date: tueDate,
          name: isDeload
            ? `Wk${weekNum} Deload: 3x6m Sweet Spot Opener`
            : `Wk${weekNum} FTP Ceiling: 5x${4 + (w % 2)}m VO2max @ 112% FTP`,
          sportCategory: 'Cycling',
          environmentPreference: blockEnvPref,
          plannedDurationSecs: isDeload ? 2700 : 3900,
          plannedLoad: isDeload ? 54 : 88,
          workoutSyntax: isDeload
            ? `- 10m 58% FTP Warmup\n- 6m 88% FTP Sweet Spot\n- 4m 52% FTP Recovery\n- 6m 88% FTP Sweet Spot\n- 4m 52% FTP Recovery\n- 6m 88% FTP Sweet Spot\n- 9m 50% FTP Cooldown`
            : `- 15m 64% FTP Warmup\n- 4m 112% FTP VO2max\n- 4m 52% FTP Z1 Spin\n- 4m 112% FTP VO2max\n- 4m 52% FTP Z1 Spin\n- 4m 114% FTP VO2max\n- 4m 52% FTP Z1 Spin\n- 4m 114% FTP VO2max\n- 4m 52% FTP Z1 Spin\n- 4m 115% FTP VO2max\n- 10m 50% FTP Cooldown`,
          description: `Expand maximal stroke volume and aerobic ceiling toward 350W FTP target.`,
          replaceExistingDate: true,
        });
      }

      // Session 2 (Wednesday - offset 2): Aerobic Z2 Foundation
      if (daysPerWeek >= 5) {
        sessions.push({
          date: addDaysIso(weekMondayIso, 2),
          name: `Wk${weekNum} Z2 Mitochondrial Base (${isDeload ? '45m' : '60m'})`,
          sportCategory: sport,
          environmentPreference: blockEnvPref,
          plannedDurationSecs: isDeload ? 2700 : 3600,
          plannedLoad: isDeload ? 38 : 54,
          workoutSyntax: `- 10m 54% FTP Warmup\n- ${isDeload ? 25 : 40}m 69% FTP Z2 Endurance\n- 10m 52% FTP Cooldown`,
          description: `Strict Z2 aerobic cap (<75% FTP / <80% LTHR) to maximize capillary density with minimal autonomic strain.`,
          replaceExistingDate: true,
        });
      }

      // Session 3 (Thursday - offset 3): Threshold / Sweet Spot Progression
      sessions.push({
        date: addDaysIso(weekMondayIso, 3),
        name:
          sport === 'Running'
            ? `Wk${weekNum} Tempo / Threshold Progression (${isDeload ? '40m' : '55m'})`
            : `Wk${weekNum} 350W Builder: ${isDeload ? '2x10m' : '4x10m'} Sweet Spot / Over-Unders`,
        sportCategory: sport,
        environmentPreference: blockEnvPref,
        plannedDurationSecs: isDeload ? 2400 : 3900,
        plannedLoad: isDeload ? 48 : 82,
        workoutSyntax: isDeload
          ? `- 10m 58% FTP Warmup\n- 10m 88% FTP Sweet Spot\n- 4m 54% FTP Recovery\n- 10m 88% FTP Sweet Spot\n- 6m 50% FTP Cooldown`
          : `- 12m 62% FTP Warmup\n- 10m 92% FTP Sweet Spot\n- 3m 54% FTP Recovery\n- 10m 94% FTP Threshold\n- 3m 54% FTP Recovery\n- 10m 96% FTP Threshold\n- 3m 54% FTP Recovery\n- 10m 98% FTP Threshold\n- 8m 50% FTP Cooldown`,
        description: `Progressive muscular endurance and lactate shuttle work.`,
        replaceExistingDate: true,
      });

      // Session 4 (Friday - offset 4): Optional Recovery Spin / Shakeout if 6 days/week
      if (daysPerWeek >= 6) {
        sessions.push({
          date: addDaysIso(weekMondayIso, 4),
          name: `Wk${weekNum} Z1 Parasympathetic Recovery Flush`,
          sportCategory: sport,
          environmentPreference: 'FLEXIBLE',
          plannedDurationSecs: 2400,
          plannedLoad: 26,
          workoutSyntax: `- 10m 50% FTP Easy\n- 20m 54% FTP Z1 Flush\n- 10m 48% FTP Cooldown`,
          description: `Active recovery flush prior to weekend volume block.`,
          replaceExistingDate: true,
        });
      }

      // Session 5 (Saturday/Sunday Long Session)
      const longMins = isDeload ? 75 : isTaper ? 65 : 95 + Math.min(35, w * 5);
      sessions.push({
        date: addDaysIso(weekMondayIso, longOffset),
        name:
          sport === 'Running'
            ? `Wk${weekNum} Long Endurance Run + Fast Finish (${longMins}m)`
            : `Wk${weekNum} Long Z2 Endurance + Late Tempo (${longMins}m)`,
        sportCategory: sport,
        environmentPreference: blockEnvPref === 'INDOOR' ? 'INDOOR' : 'OUTDOOR',
        plannedDurationSecs: longMins * 60,
        plannedLoad: Math.round(longMins * 0.92),
        workoutSyntax: `- 15m 56% FTP Warmup\n- ${Math.max(30, longMins - 40)}m 70% FTP Z2 Endurance\n- 15m 86% FTP Z3 Tempo Finish\n- 10m 52% FTP Cooldown`,
        description: `Long aerobic durability session. Monitor second-half cardiac decoupling (<3.5%).`,
        replaceExistingDate: true,
      });

      // Session 6 (Weekend Day 2 - Endurance / Aerobic Volume)
      sessions.push({
        date: addDaysIso(weekMondayIso, recoveryLongDayOffset),
        name: `Wk${weekNum} Steady Z2 Aerobic Volume (${isDeload ? '45m' : '65m'})`,
        sportCategory: sport,
        environmentPreference: blockEnvPref,
        plannedDurationSecs: isDeload ? 2700 : 3900,
        plannedLoad: isDeload ? 38 : 58,
        workoutSyntax: `- 10m 54% FTP Warmup\n- ${isDeload ? 25 : 45}m 68% FTP Steady Z2\n- 10m 50% FTP Cooldown`,
        description: `Smooth aerobic consolidation day.`,
        replaceExistingDate: true,
      });

      const totalSecs = sessions.reduce((acc, s) => acc + s.plannedDurationSecs, 0);
      const totalLoad = sessions.reduce((acc, s) => acc + s.plannedLoad, 0);

      weeks.push({
        weekNum,
        startDateIso: weekMondayIso,
        phase,
        isDeload,
        isTaper,
        targetTss: Math.max(targetTss, totalLoad),
        targetHours: (totalSecs / 3600).toFixed(1),
        sessions,
        zoneDistributionPct: isDeload
          ? [32, 54, 10, 4, 0, 0]
          : [18, 56, 12, 9, 5, 0],
      });
    }

    return weeks;
  }, [
    activities,
    blockWeeks,
    daysPerWeek,
    longDayPreference,
    blockEnvPref,
    currentCtl,
    selectedArchetype,
    todayIso,
    trackPlanBundle,
    trackSpeedReserveState.profile.zones,
    distanceUnit,
  ]);

  // Target Races & Fueling Simulator follow directly after Training Block Builder
  const handlePopulatePlanToCalendar = async () => {
    if (!onBatchCreatePlannedEvents) return;
    setIsPopulatingCalendar(true);
    setPopulatedSuccessMsg(null);
    try {
      const allSessions = generatedPlanWeeks.flatMap((w) => w.sessions);
      await onBatchCreatePlannedEvents(allSessions);
      setPopulatedSuccessMsg(
        `Populated ${allSessions.length} structured workouts (${blockWeeks}-week ${selectedArchetype.title} with Deload weeks) to your Training Calendar!`
      );
    } finally {
      setIsPopulatingCalendar(false);
    }
  };

  // New Race / Performance Goal Form State
  const [newTitle, setNewTitle] = useState('');
  const [newSport, setNewSport] = useState<SportCategory>('Running');
  const [newPriority, setNewPriority] = useState<'A-Race' | 'B-Race' | 'Milestone'>('A-Race');
  const [newTargetDate, setNewTargetDate] = useState('2027-02-14');
  const [newTargetVal, setNewTargetVal] = useState('350');
  const [newUnit, setNewUnit] = useState('W');
  const [newNotes, setNewNotes] = useState('');

  const handleAddGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const val = Number(newTargetVal) || 85;
    onAddTargetGoal({
      title: newTitle.trim(),
      type: newPriority === 'Milestone' ? 'PERFORMANCE_METRIC' : 'RACE_EVENT',
      sportCategory: newSport,
      targetDate: newTargetDate,
      priority: newPriority,
      targetCtl: newUnit === 'CTL' ? val : undefined,
      currentValue:
        newUnit === 'CTL'
          ? currentCtl
          : newUnit === 'W'
            ? currentBikeFtp
            : Math.round(val * 0.92),
      targetValue: val,
      unit: newUnit,
      notes: newNotes.trim() || 'Custom performance target tracked by Thresh.',
    });
    setNewTitle('');
    setNewNotes('');
  };

  const activePreviewWeek =
    generatedPlanWeeks[Math.min(selectedPreviewWeekIdx, generatedPlanWeeks.length - 1)] ||
    generatedPlanWeeks[0];

  return (
    <div className="space-y-6">
      {/* ==========================================================================
          MODULE A: GOAL-TO-CALENDAR ADAPTIVE PLAN BUILDER
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5 border border-blue-500/25">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-sky-400">
              <Target className="w-3.5 h-3.5" />
              <span>Training Block Builder</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                Periodized Training Plan
              </h1>
              <ChartInfoTooltip
                title="Periodized Training Plan Builder"
                subtitle="Automated Base → Build → Every-4th-Week Deload → Taper Architecture"
                whatItMeasures="Builds a complete multi-week structured training block tailored to your primary performance objective (e.g., 350W FTP, Sub-20:00 5K, or Half Marathon in 12 Weeks), automatically inserting a -30% recovery Deload Week every 4th week."
                benchmarks="Optimal block progression increases weekly TSS by +5–8% during 3-week loading microcycles followed by a -30% Deload week to allow supercompensation and prevent autonomic overreaching."
                coachingAction="Select your target goal and weekly schedule below, inspect the week-by-week progression and Effort Stripes, and click 'Populate Block to Training Calendar' to schedule all workouts onto your Training Calendar."
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenOfficialRaceModal && (
              <button
                type="button"
                onClick={onOpenOfficialRaceModal}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-bold text-amber-700 dark:text-amber-300 transition-colors whitespace-nowrap"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Log Official Race</span>
              </button>
            )}
            {onSwitchToCalendar && (
              <button
                type="button"
                onClick={onSwitchToCalendar}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:border-blue-500/50 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
                <span>Open Training Calendar</span>
              </button>
            )}
            <button
              type="button"
              disabled={isPopulatingCalendar}
              onClick={handlePopulatePlanToCalendar}
              className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] disabled:opacity-50 text-xs font-semibold text-white dark:text-[#080A09] shadow-xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isPopulatingCalendar
                  ? 'Populating Calendar...'
                  : `Populate ${blockWeeks}-Week Block to Calendar`}
              </span>
            </button>
          </div>
        </div>

        {populatedSuccessMsg && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{populatedSuccessMsg}</span>
            </span>
            {onSwitchToCalendar && (
              <button
                type="button"
                onClick={onSwitchToCalendar}
                className="inline-flex items-center gap-1 font-bold underline hover:opacity-80"
              >
                <span>View on Calendar</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* 1. Objective Discipline Filter & Archetype Cards */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'ALL', label: 'All Goals' },
              { id: 'TRACK', label: 'Track Oval' },
              { id: 'ROAD', label: 'Road Run' },
              { id: 'CYCLING', label: 'Cycling' },
            ] as const
          ).map((cat) => {
            const active = archetypeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setArchetypeCategory(cat.id);
                  const nextList =
                    cat.id === 'ALL'
                      ? GOAL_ARCHETYPES
                      : GOAL_ARCHETYPES.filter((a) => a.category === cat.id);
                  if (!nextList.some((a) => a.id === selectedArchetypeId) && nextList[0]) {
                    setSelectedArchetypeId(nextList[0].id);
                    setBlockWeeks(nextList[0].defaultWeeks);
                    setSelectedPreviewWeekIdx(0);
                    setPopulatedSuccessMsg(null);
                  }
                }}
                className={`min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1C5436] dark:bg-[#C8FF00] text-white dark:text-[#080A09] border-[#1C5436] dark:border-[#C8FF00] font-bold'
                    : 'bg-white/80 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-[#1C5436]/50'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {visibleArchetypes.map((arch) => {
            const active = arch.id === selectedArchetypeId;
            return (
              <button
                key={arch.id}
                type="button"
                onClick={() => {
                  setSelectedArchetypeId(arch.id);
                  setBlockWeeks(arch.defaultWeeks);
                  setSelectedPreviewWeekIdx(0);
                  setPopulatedSuccessMsg(null);
                }}
                className={`text-left rounded-xl p-3.5 border transition-all flex flex-col justify-between space-y-2 cursor-pointer ${
                  active
                    ? 'border-[#1C5436] dark:border-[#C8FF00] bg-[#1C5436]/[0.07] dark:bg-[#C8FF00]/[0.08] shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-slate-900/50 hover:border-[#1C5436]/50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-emerald-900/10 dark:bg-[#C8FF00]/15 text-[#1C5436] dark:text-[#C8FF00] font-bold">
                      {arch.badge}
                    </span>
                    <span className="text-2xs font-mono text-slate-500">
                      {arch.sportCategory}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {arch.title}
                  </div>
                  <p className="text-2xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-snug">
                    {arch.subtitle}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between text-2xs font-mono">
                  <span className="text-slate-500">Target:</span>
                  <span className="font-bold text-[#1C5436] dark:text-[#C8FF00]">
                    {arch.targetLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 1b. Track Speed-Reserve & 7-Zone Split Panel (shown for Track Oval archetypes) */}
        {selectedArchetype.trackEventGroup && (
          <div
            data-testid="track-speed-reserve-panel"
            className="rounded-xl border border-[#1C5436]/30 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00]" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Track Speed-Reserve &amp; Date-Pace Calibration
                </h2>
              </div>
              <span
                className={`px-2 py-0.5 rounded-lg font-mono text-2xs font-bold ${
                  trackSpeedReserveState.isCalibratingEstimate
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                }`}
              >
                {trackSpeedReserveState.isCalibratingEstimate
                  ? 'CALIBRATING · Default Baseline'
                  : trackSpeedReserveState.parsedManualSeed
                    ? `Seeded · ${Math.round(trackSpeedReserveState.parsedManualSeed.distanceMeters)}m in ${formatTrackSplitToken(
                        trackSpeedReserveState.parsedManualSeed.durationSecs
                      )}`
                    : `${trackSpeedReserveState.officialMarkCount} FAT Marks · CS + D'`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div>
                <label
                  htmlFor={`${formId}-track-phase`}
                  className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Season Phase
                </label>
                <select
                  id={`${formId}-track-phase`}
                  value={trackStartingPhase}
                  onChange={(e) => {
                    setTrackStartingPhase(e.target.value as TrackStartingPhaseOption);
                    setSelectedPreviewWeekIdx(0);
                  }}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                >
                  <option value="FULL_PROGRESSION">Full Periodized Arc</option>
                  <option value="BASE">Base Building &amp; Sub-T</option>
                  <option value="STRENGTH_CV">Strength &amp; Tinman CV</option>
                  <option value="SPECIFIC">Race-Specific Track Peak</option>
                  <option value="PEAK_TAPER">Championship Peak &amp; Taper</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-track-phenotype`}
                  className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  ASR Phenotype
                </label>
                <select
                  id={`${formId}-track-phenotype`}
                  value={trackPhenotypeOverride}
                  onChange={(e) =>
                    setTrackPhenotypeOverride(e.target.value as SpeedReservePhenotype | 'AUTO')
                  }
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                >
                  <option value="AUTO">Auto (From CS + D')</option>
                  <option value="ENDURANCE">Endurance (Lower D' · Aerobic)</option>
                  <option value="HYBRID">Hybrid (Balanced CS + ASR)</option>
                  <option value="SPEED">Speed Type (High ASR / D')</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-track-seed`}
                  className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Recent Seed Mark
                </label>
                <input
                  id={`${formId}-track-seed`}
                  data-testid="track-seed-input"
                  type="text"
                  value={trackSeedInput}
                  onChange={(e) => setTrackSeedInput(e.target.value)}
                  placeholder="e.g. 4:05 or 1500m 3:48.5"
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                />
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {(['4:05', '4:35', '5:15', '6:15'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTrackSeedInput(preset)}
                      className={`px-2 py-0.5 rounded font-mono text-2xs border cursor-pointer ${
                        trackSeedInput.trim() === preset
                          ? 'bg-[#1C5436] text-white border-[#1C5436] dark:bg-[#C8FF00] dark:text-[#080A09] font-bold'
                          : 'bg-white dark:bg-[#15231B] text-slate-700 dark:text-slate-300 border-stone-300 dark:border-[#2B543B]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-track-goal`}
                  className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Goal Mark (Optional)
                </label>
                <input
                  id={`${formId}-track-goal`}
                  data-testid="track-goal-input"
                  type="text"
                  value={trackGoalInput}
                  onChange={(e) => setTrackGoalInput(e.target.value)}
                  placeholder="e.g. 3:59 or 5k 14:40"
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-xs">
              <div className="rounded-lg bg-white dark:bg-[#15231B] border border-stone-200 dark:border-[#244331] px-3 py-2">
                <div className="text-2xs text-slate-500">Aerobic VDOT</div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {trackSpeedReserveState.profile.vdotAer.toFixed(1)}
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#15231B] border border-stone-200 dark:border-[#244331] px-3 py-2">
                <div className="text-2xs text-slate-500">Critical Speed (CV)</div>
                <div className="text-sm font-extrabold text-[#1C5436] dark:text-[#C8FF00]">
                  {formatPace(trackSpeedReserveState.profile.criticalPaceSecsPerKm, distanceUnit)}
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#15231B] border border-stone-200 dark:border-[#244331] px-3 py-2">
                <div className="text-2xs text-slate-500">Anaerobic D&apos;</div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {Math.round(trackSpeedReserveState.profile.dPrimeMeters)} m
                </div>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#15231B] border border-stone-200 dark:border-[#244331] px-3 py-2">
                <div className="text-2xs text-slate-500">Speed Reserve (ASR)</div>
                <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                  +{trackSpeedReserveState.profile.asrMps.toFixed(2)} m/s ·{' '}
                  {trackPlanBundle?.phenotype || trackSpeedReserveState.profile.phenotype}
                </div>
              </div>
            </div>

            {trackPlanBundle?.ambitiousGoalWarning && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 font-mono">
                Goal exceeds +{trackPlanBundle.deltaMaxPct.toFixed(1)}% 16-week physiological cap
                ({trackPlanBundle.rawGoalGapPct.toFixed(1)}% raw gap). Weekly prescriptions clamped
                to protect adaptation.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono tabular-nums text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-[#244331] text-2xs text-slate-500">
                    <th className="py-1.5 pr-3">Zone</th>
                    <th className="py-1.5 px-2">Pace</th>
                    <th className="py-1.5 px-2">200m</th>
                    <th className="py-1.5 px-2">400m</th>
                    <th className="py-1.5 px-2">800m</th>
                    <th className="py-1.5 px-2">1000m</th>
                    <th className="py-1.5 pl-2">1600m</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/70 dark:divide-[#244331]/70">
                  {(['E', 'SUB_T', 'T', 'CV', 'I', 'R', 'FR'] as TrackTrainingZoneCode[]).map(
                    (code) => {
                      const row = trackSpeedReserveState.profile.zones[code];
                      return (
                        <tr key={code} data-testid={`track-zone-row-${code}`}>
                          <td className="py-1.5 pr-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {row.code} · <span className="font-normal text-slate-600 dark:text-slate-300">{row.name}</span>
                          </td>
                          <td className="py-1.5 px-2 text-[#1C5436] dark:text-[#C8FF00] font-bold">
                            {formatPace(row.paceSecsPerKm, distanceUnit)}
                          </td>
                          <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                            {formatTrackSplitToken(row.splitsSecs.m200)}
                          </td>
                          <td className="py-1.5 px-2 font-bold text-slate-900 dark:text-white">
                            {formatTrackSplitToken(row.splitsSecs.m400)}
                          </td>
                          <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                            {formatTrackSplitToken(row.splitsSecs.m800)}
                          </td>
                          <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                            {formatTrackSplitToken(row.splitsSecs.m1000)}
                          </td>
                          <td className="py-1.5 pl-2 text-slate-800 dark:text-slate-200">
                            {formatTrackSplitToken(row.splitsSecs.m1600)}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. Block Configuration Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50/80 dark:bg-slate-900/60 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-800">
          <div>
            <div
              id={`${formId}-block-horizon`}
              className="block text-2xs font-semibold text-slate-500 mb-1"
            >
              Block Horizon (with Every-4th-Wk Deload)
            </div>
            <div
              role="group"
              aria-labelledby={`${formId}-block-horizon`}
              className="grid grid-cols-4 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-mono"
            >
              {([4, 8, 12, 16] as const).map((wks) => (
                <button
                  key={wks}
                  type="button"
                  aria-pressed={blockWeeks === wks}
                  onClick={() => {
                    setBlockWeeks(wks);
                    setSelectedPreviewWeekIdx(0);
                  }}
                  className={`min-h-[38px] py-1 rounded-md transition-all ${
                    blockWeeks === wks
                      ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-bold'
                      : 'text-slate-500'
                  }`}
                >
                  {wks} Wks
                </button>
              ))}
            </div>
          </div>

          <div>
            <div
              id={`${formId}-days-per-week`}
              className="block text-2xs font-semibold text-slate-500 mb-1"
            >
              Training Days / Week
            </div>
            <div
              role="group"
              aria-labelledby={`${formId}-days-per-week`}
              className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-mono"
            >
              {([4, 5, 6] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={daysPerWeek === d}
                  onClick={() => setDaysPerWeek(d)}
                  className={`min-h-[38px] py-1 rounded-md transition-all ${
                    daysPerWeek === d
                      ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-bold'
                      : 'text-slate-500'
                  }`}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>

          <div>
            <div
              id={`${formId}-long-day`}
              className="block text-2xs font-semibold text-slate-500 mb-1"
            >
              Primary Long Session Day
            </div>
            <div
              role="group"
              aria-labelledby={`${formId}-long-day`}
              className="grid grid-cols-2 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-medium"
            >
              {(['Saturday', 'Sunday'] as const).map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={longDayPreference === day}
                  onClick={() => setLongDayPreference(day)}
                  className={`min-h-[38px] py-1 rounded-md transition-all ${
                    longDayPreference === day
                      ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-bold'
                      : 'text-slate-500'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div
              id={`${formId}-modality-split`}
              className="block text-2xs font-semibold text-slate-500 mb-1"
            >
              Modality &amp; Trainer Split
            </div>
            <div
              role="group"
              aria-labelledby={`${formId}-modality-split`}
              className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-capsule-track text-2xs font-medium"
            >
              {(
                [
                  { id: 'FLEXIBLE', label: 'Hybrid' },
                  { id: 'OUTDOOR', label: 'Outdoor' },
                  { id: 'INDOOR', label: 'Virtual' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={blockEnvPref === m.id}
                  onClick={() => setBlockEnvPref(m.id)}
                  className={`min-h-[38px] py-1 rounded-md transition-all ${
                    blockEnvPref === m.id
                      ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-bold'
                      : 'text-slate-500'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3. Interactive Week-by-Week Mesocycle Architecture Bar Chart + Selected Week Workout Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Left 7 Cols: Mesocycle Progression Strip with Deload Week Highlights */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {blockWeeks}-Week Load Progression (Click Any Week to Inspect)
                </div>
                <div className="text-2xs text-slate-500">
                  Every 4th week automatically reduces volume &amp; load by 30% for recovery
                </div>
              </div>
              <div className="flex items-center gap-2 text-2xs font-mono">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-blue-500" /> Build
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" /> Deload (-30%)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-purple-500" /> Taper
                </span>
              </div>
            </div>

            <div className="grid grid-cols-8 sm:grid-cols-12 lg:grid-cols-16 gap-1.5 items-end h-36 pt-4 px-1">
              {generatedPlanWeeks.map((wk, idx) => {
                const maxTss = Math.max(...generatedPlanWeeks.map((w) => w.targetTss), 400);
                const hPct = Math.max(22, Math.round((wk.targetTss / maxTss) * 100));
                const isSelected = idx === selectedPreviewWeekIdx;
                const barColor = wk.isTaper
                  ? 'bg-purple-500'
                  : wk.isDeload
                    ? 'bg-emerald-500'
                    : 'bg-[#0D9488] dark:bg-[#2DD4BF]';

                return (
                  <button
                    key={wk.weekNum}
                    type="button"
                    onClick={() => setSelectedPreviewWeekIdx(idx)}
                    className={`group flex flex-col items-center justify-end h-full rounded-lg p-1 transition-all ${
                      isSelected
                        ? 'bg-[#0D9488]/15 dark:bg-[#2DD4BF]/15 ring-1 ring-[#0D9488] dark:ring-[#2DD4BF]'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title={`Week ${wk.weekNum} (${wk.phase}): ~${wk.targetTss} TSS · ${wk.targetHours}h`}
                  >
                    <span className="text-2xs font-mono font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {wk.targetTss}
                    </span>
                    <div className="w-full h-24 flex items-end justify-center">
                      <div
                        style={{ height: `${hPct}%` }}
                        className={`w-full rounded-t-sm transition-all ${barColor}`}
                      />
                    </div>
                    <span
                      className={`text-2xs font-mono mt-1 ${
                        isSelected
                          ? 'font-bold text-blue-600 dark:text-sky-300'
                          : 'text-slate-500'
                      }`}
                    >
                      W{wk.weekNum}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-500">
              <span>
                Selected: <strong className="text-slate-900 dark:text-slate-100">Week {activePreviewWeek.weekNum} ({activePreviewWeek.phase})</strong>
              </span>
              <span>
                Target Volume: <strong className="text-blue-600 dark:text-sky-400">{activePreviewWeek.targetHours} hrs · ~{activePreviewWeek.targetTss} TSS</strong>
              </span>
            </div>
          </div>

          {/* Right 5 Cols: Selected Week Structured Workouts Preview with Effort Stripes */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Week {activePreviewWeek.weekNum} Structured Prescriptions ({activePreviewWeek.sessions.length} Sessions)
              </div>
              <span
                className={`text-2xs font-mono font-bold px-2 py-0.5 rounded ${
                  activePreviewWeek.isDeload
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : activePreviewWeek.isTaper
                      ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                      : 'bg-blue-500/15 text-blue-600 dark:text-sky-400'
                }`}
              >
                {activePreviewWeek.phase}
              </span>
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {activePreviewWeek.sessions.map((sess, sIdx) => {
                const trackSpec =
                  sess.sportCategory === 'Running'
                    ? sess.trackSpec ||
                      inferTrackWorkoutSpecFromPlannedEvent({
                        name: sess.name,
                        workoutSyntax: sess.workoutSyntax,
                      })
                    : null;
                return (
                  <div
                    key={`${sess.date}-${sIdx}`}
                    className="rounded-lg bg-white dark:bg-[#15231B] border border-slate-200/80 dark:border-slate-800 overflow-hidden"
                  >
                    {/* Intervals.icu Effort Stripe along top of session card */}
                    <div className="h-[4px] w-full flex">
                      {activePreviewWeek.zoneDistributionPct.map((pct, zIdx) =>
                        pct > 0 ? (
                          <div
                            key={zIdx}
                            style={{
                              width: `${pct}%`,
                              backgroundColor: ZONE_COLORS[zIdx],
                            }}
                            className="h-full"
                          />
                        ) : null
                      )}
                    </div>
                    <div className="p-2.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-2xs font-mono text-slate-500">
                            {sess.date} · {sess.sportCategory}
                          </div>
                          <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                            {sess.name}
                          </div>
                        </div>
                        <div className="text-right font-mono shrink-0">
                          <div className="font-bold text-blue-600 dark:text-sky-400">
                            {Math.round(sess.plannedDurationSecs / 60)}m
                          </div>
                          <div className="text-2xs text-slate-500">~{sess.plannedLoad} TSS</div>
                        </div>
                      </div>
                      {(trackSpec || Boolean(sess.workoutSyntax)) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                          {trackSpec && (
                            <button
                              type="button"
                              data-testid="goals-launch-stopwatch"
                              onClick={() => {
                                stageWorkoutInTracksideStopwatch({
                                  title: sess.name,
                                  spec: trackSpec,
                                });
                                onOpenTracksideStopwatch?.();
                              }}
                              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-2xs font-mono font-bold cursor-pointer"
                            >
                              <Timer className="w-3.5 h-3.5" weight="bold" />
                              <span>Time on Track</span>
                            </button>
                          )}
                          {sess.workoutSyntax && (
                            <button
                              type="button"
                              data-testid="goals-export-fit"
                              onClick={() => {
                                const sport: 'Running' | 'Cycling' =
                                  sess.sportCategory === 'Cycling' ? 'Cycling' : 'Running';
                                const steps = buildFitStepsFromWorkoutSyntax(sess.workoutSyntax, {
                                  sport,
                                  ftpWatts: currentBikeFtp || 280,
                                  lthrBpm: athleteProfile?.lthr || 170,
                                  thresholdPaceSecsPerKm:
                                    trackSpeedReserveState.profile.thresholdPaceSecsPerKm ||
                                    athleteProfile?.thresholdPaceSecsPerKm ||
                                    250,
                                });
                                downloadGarminFitWorkoutFile({ name: sess.name, sport, steps }, sess.date);
                              }}
                              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#101B15] text-slate-700 dark:text-slate-200 text-2xs font-mono font-semibold hover:border-[#1C5436] cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" weight="bold" />
                              <span>.FIT</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>


      {/* Historical Physiology modules live on Today -> Physiology & Telemetry Deep-Dive */}
      {/* Target Race Calendar & Physiological Milestones */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Award className="w-4 h-4 text-blue-500" />
          <span>Target Races &amp; Performance Milestones</span>
        </h2>

        {targetGoals.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {targetGoals.map((goal) => {
              const now = Date.now();
              const targetTime = new Date(`${goal.targetDate}T00:00:00Z`).getTime();
              const daysRemaining = Math.max(1, Math.round((targetTime - now) / (1000 * 60 * 60 * 24)));
              const weeksRemaining = Math.max(1, daysRemaining / 7);
              const ctlGap = goal.targetCtl ? Math.max(0, goal.targetCtl - currentCtl) : 0;
              const reqWeeklyRamp = (ctlGap / weeksRemaining).toFixed(1);

              const phase =
                daysRemaining <= 14
                  ? 'Taper & Peak'
                  : daysRemaining <= 45
                    ? 'Specific Build'
                    : 'Aerobic Base';

              return (
                <div
                  key={goal.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {goal.priority} · {goal.sportCategory} · {goal.targetDate} ({daysRemaining}d out · {phase})
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {goal.title}
                      </h3>
                    </div>
                    {pendingDeleteGoalId === goal.id ? (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteTargetGoal(goal.id);
                            setPendingDeleteGoalId(null);
                          }}
                          className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-2xs font-bold"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteGoalId(null)}
                          className="min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs font-semibold"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteGoalId(goal.id)}
                        className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-500"
                        aria-label={`Remove ${goal.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300">{goal.notes}</p>

                  <div className="flex items-center justify-between text-xs font-mono tabular-nums pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span>
                      Current:{' '}
                      <strong>
                        {formatGoalMetricValue(
                          goal.currentValue,
                          goal.unit,
                          distanceUnit,
                          goal.title
                        )}
                      </strong>{' '}
                      → Target:{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {formatGoalMetricValue(
                          goal.targetValue,
                          goal.unit,
                          distanceUnit,
                          goal.title
                        )}
                      </strong>
                    </span>
                    {goal.targetCtl && (
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                        Req Ramp: +{reqWeeklyRamp} CTL/wk
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-800 p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
            No custom target races or performance milestones added yet. Use the form below to add an upcoming race or physiological goal.
          </div>
        )}

        <form
          onSubmit={handleAddGoalSubmit}
          className="rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
            Add Target Race or Performance Goal
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label htmlFor={`${formId}-goal-name`} className="block text-xs text-slate-500 mb-1">
                Event / Goal Name
              </label>
              <input
                id={`${formId}-goal-name`}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Sub-20:00 5K or 350W FTP"
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-sport`} className="block text-xs text-slate-500 mb-1">
                Sport
              </label>
              <select
                id={`${formId}-goal-sport`}
                value={newSport}
                onChange={(e) => setNewSport(e.target.value as SportCategory)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="Running">Running</option>
                <option value="Cycling">Cycling</option>
                <option value="Multisport">Multisport</option>
                <option value="Swimming">Swimming</option>
                <option value="Strength">Strength</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor={`${formId}-goal-priority`}
                className="block text-xs text-slate-500 mb-1"
              >
                Priority
              </label>
              <select
                id={`${formId}-goal-priority`}
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as 'A-Race' | 'B-Race' | 'Milestone')}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="A-Race">A-Race</option>
                <option value="B-Race">B-Race</option>
                <option value="Milestone">Milestone</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-date`} className="block text-xs text-slate-500 mb-1">
                Target Date
              </label>
              <input
                id={`${formId}-goal-date`}
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${formId}-goal-val`} className="block text-xs text-slate-500 mb-1">
                Target Value &amp; Unit
              </label>
              <div className="flex gap-1">
                <input
                  id={`${formId}-goal-val`}
                  type="number"
                  value={newTargetVal}
                  onChange={(e) => setNewTargetVal(e.target.value)}
                  className="w-16 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <select
                  value={newUnit}
                  aria-label="Goal target unit"
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-1.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                >
                  <option value="W">Watts</option>
                  <option value="CTL">CTL</option>
                  <option value="W/kg">W/kg</option>
                  <option value="min">min</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <input
              type="text"
              value={newNotes}
              aria-label="Optional goal notes"
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional notes (e.g. target pacing strategy, nutrition, climb VAM)..."
              className="flex-1 min-w-[220px] min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] px-4 py-1.5 text-xs font-semibold text-white dark:text-[#080A09] transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Goal</span>
            </button>
          </div>
        </form>
      </section>

      {/* Integrated Course Physics, Durability, Weather & Carb/Sodium Race Simulator */}
      <section className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ap-status-info px-2.5 py-0.5 rounded-full text-2xs font-mono font-semibold">
                Race Physics &amp; Fueling Simulator
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Course Elevation, Heat/Altitude &amp; Carbohydrate/Sodium Pacer
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Derates segment power/pace caps by course climb grade, ambient heat, altitude hypoxia, and your personal `kJ/kg` / `kcal` durability curve.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track">
            {(['Running', 'Cycling'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => {
                  setSimSport(sp);
                  if (sp === 'Cycling' && simDistKm < 30) {
                    setSimDistKm(112);
                    setSimElevM(1450);
                  } else if (sp === 'Running' && simDistKm > 45) {
                    setSimDistKm(21.1);
                    setSimElevM(185);
                  }
                }}
                className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  simSport === sp
                    ? 'liquid-capsule-active text-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {sp === 'Running' ? 'Road / Trail Run' : 'Road / Gravel / TT Bike'}
              </button>
            ))}
          </div>
        </div>

        {/* Course & Environmental Controls + Quick Presets */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
          <div className="col-span-2">
            <label
              htmlFor={`${formId}-sim-course-name`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Event / Course Name
            </label>
            <input
              id={`${formId}-sim-course-name`}
              type="text"
              value={simRaceName}
              onChange={(e) => setSimRaceName(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-dist`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Distance (km)
            </label>
            <input
              id={`${formId}-sim-dist`}
              type="number"
              min={1.5}
              max={400}
              step={0.1}
              value={simDistKm}
              onChange={(e) => setSimDistKm(Math.max(1.5, Number(e.target.value) || 5))}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-elev`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Elevation Gain (m)
            </label>
            <input
              id={`${formId}-sim-elev`}
              type="number"
              min={0}
              max={8000}
              step={25}
              value={simElevM}
              onChange={(e) => setSimElevM(Math.max(0, Number(e.target.value) || 0))}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-temp`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Ambient Temp (°C)
            </label>
            <input
              id={`${formId}-sim-temp`}
              type="number"
              min={-5}
              max={45}
              step={1}
              value={simTempC}
              onChange={(e) => setSimTempC(Number(e.target.value) || 15)}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-alt`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Mean Altitude (m)
            </label>
            <input
              id={`${formId}-sim-alt`}
              type="number"
              min={0}
              max={4000}
              step={100}
              value={simAltM}
              onChange={(e) => setSimAltM(Math.max(0, Number(e.target.value) || 0))}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Summary KPI Strip: Finish Time, Target Output, Derating Breakdown, and Hourly Fueling */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-[#15231B]/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Predicted Finish Time
            </div>
            <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
              {formatDuration(raceSimulationReport.predictedFinishTimeSecs)}
            </div>
            <div className="text-2xs text-blue-600 dark:text-sky-400">
              {raceSimulationReport.sport === 'Cycling'
                ? `Avg ${raceSimulationReport.averageTargetWatts ?? 0}W · NP ${
                    raceSimulationReport.normalizedTargetWatts ?? 0
                  }W`
                : `Avg ${formatPace(
                    raceSimulationReport.averageTargetPaceSecsPerKm ?? 250,
                    distanceUnit
                  )}`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-[#15231B]/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Environmental &amp; Durability Derating
            </div>
            <div className="mt-0.5 text-sm font-bold text-amber-600 dark:text-amber-400">
              Heat -{raceSimulationReport.thermalDeratingPct}% · Alt -
              {raceSimulationReport.altitudeDeratingPct}%
            </div>
            <div className="text-2xs text-slate-500">
              Durability Fade Cap: -{raceSimulationReport.durabilityDeratingPct}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-[#15231B]/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Carbohydrate Oxidation Target
            </div>
            <div className="mt-0.5 text-base font-bold text-emerald-600 dark:text-emerald-400">
              {raceSimulationReport.fuelingPlan.carbsGramsPerHour} g/hr ({' '}
              {raceSimulationReport.fuelingPlan.totalCarbsGrams}g total)
            </div>
            <div className="text-2xs text-slate-500">
              {raceSimulationReport.fuelingPlan.glucoseFructoseRatio} · ~
              {raceSimulationReport.fuelingPlan.gelEquivalentsCount} gels
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-[#15231B]/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Sodium &amp; Sweat Replacement
            </div>
            <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
              {raceSimulationReport.fuelingPlan.sodiumMgPerHour} mg/hr Na+
            </div>
            <div className="text-2xs text-slate-500">
              {raceSimulationReport.fuelingPlan.fluidMlPerHour} mL/hr fluid ·{' '}
              {raceSimulationReport.fuelingPlan.caffeineMgRecommendation}mg Caf
            </div>
          </div>
        </div>

        {/* 5-Segment Pacing & Fueling Execution Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 px-3">Course Segment</th>
                <th className="py-2 px-3 text-right">Grade / Fatigue</th>
                <th className="py-2 px-3 text-right">Target Cap</th>
                <th className="py-2 px-3 text-right">Split Time</th>
                <th className="py-2 px-3 text-right">Segment Fueling</th>
                <th className="py-2 px-3">Tactical Coaching Cue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {raceSimulationReport.segments.map((seg) => (
                <tr
                  key={seg.segmentIndex}
                  className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                >
                  <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                    {seg.segmentLabel}{' '}
                    <span className="font-mono text-2xs text-slate-500">
                      ({seg.startKm}–{seg.endKm} km)
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                    {seg.avgGradePct}% · {seg.accumulatedFatigueLabel}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-blue-600 dark:text-sky-400">
                    {raceSimulationReport.sport === 'Cycling'
                      ? `${seg.targetWatts ?? 0}W (${seg.targetWkg ?? 0} W/kg)`
                      : `${formatPace(seg.targetPaceSecsPerKm ?? 250, distanceUnit)} (GAP ${formatPace(
                          seg.targetGapSecsPerKm ?? 245,
                          distanceUnit
                        )})`}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-800 dark:text-slate-200">
                    {formatDuration(seg.segmentDurationSecs)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-emerald-300">
                    {seg.carbsGramsTarget}g CHO · {seg.sodiumMgTarget}mg Na+ · {seg.fluidMlTarget}mL
                  </td>
                  <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300">
                    {seg.coachingCue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export const GoalsView = React.memo(GoalsViewInner);
