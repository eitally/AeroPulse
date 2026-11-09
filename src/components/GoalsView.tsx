import React, { useMemo, useState } from 'react';
import {
  Award,
  Bike,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Flame,
  Footprints,
  Gauge,
  Plus,
  Sparkles,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Wrench,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AnnualMileageGoal,
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  computeAnnualMileageSummary,
  convertMetersToUnit,
  convertUnitToMeters,
  formatDistance,
  formatDuration,
  formatGoalMetricValue,
  formatPace,
} from '../utils/formatters';
import {
  computeCriticalSpeedAndDPrime,
  deriveThresholdPaceSecsPerKmFromVdot,
  formatFatTime,
} from '../utils/officialRaceSynthesizer';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';
import { ChartInfoTooltip } from './ChartInfoTooltip';

export interface PlannedEventBatchItem {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
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
}

const DEFAULT_GEAR_ITEMS: AthleteGearItem[] = [
  {
    id: 'b2220926',
    name: 'Cervelo S3 (Road / Aero)',
    type: 'BIKE',
    distanceMeters: 4820000,
    maxRecommendedMeters: 8000000,
    primary: true,
  },
  {
    id: 'g7979955',
    name: 'Inov-8 Terraultra G270',
    type: 'SHOE',
    distanceMeters: 542000,
    maxRecommendedMeters: 724205,
    primary: true,
  },
  {
    id: 'g4269407',
    name: 'Merrell FluidFlex 2',
    type: 'SHOE',
    distanceMeters: 418000,
    maxRecommendedMeters: 643738,
    primary: false,
  },
  {
    id: 'g995271',
    name: 'Merrell FluidFlex',
    type: 'SHOE',
    distanceMeters: 685000,
    maxRecommendedMeters: 643738,
    primary: false,
  },
];

const ALL_SPORTS_LIST: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength'];

export type GoalArchetypeId = 'SUB20_5K' | 'HALF_MARATHON' | 'FTP_350W' | 'GRAN_FONDO';

interface GoalArchetypeTemplate {
  id: GoalArchetypeId;
  badge: string;
  title: string;
  subtitle: string;
  sportCategory: SportCategory;
  targetLabel: string;
  defaultWeeks: 4 | 8 | 12 | 16;
  targetProgressionLevels: [number, number, number, number, number, number]; // Z2, Z3, Z4, Z5, Z6, Sprint
}

const GOAL_ARCHETYPES: GoalArchetypeTemplate[] = [
  {
    id: 'FTP_350W',
    badge: 'Cycling Threshold',
    title: '350W Cycling FTP Builder',
    subtitle: 'Progressive Sweet Spot, Over-Unders & VO2max Ceiling Expansion',
    sportCategory: 'Cycling',
    targetLabel: '350W FTP (~4.0+ W/kg)',
    defaultWeeks: 12,
    targetProgressionLevels: [7.8, 8.5, 8.8, 7.6, 6.2, 5.5],
  },
  {
    id: 'SUB20_5K',
    badge: '5K Speed & VO2max',
    title: 'Sub-20:00 5K Speed & VO2max',
    subtitle: 'Track 400m/800m Repeats, Lactate Threshold & Aerobic Economy',
    sportCategory: 'Running',
    targetLabel: '19:59 5K (3:59/km · 6:25/mi)',
    defaultWeeks: 8,
    targetProgressionLevels: [7.2, 7.5, 8.4, 8.9, 7.4, 6.5],
  },
  {
    id: 'HALF_MARATHON',
    badge: 'Half Marathon Build',
    title: 'Half Marathon in 12 Weeks',
    subtitle: 'Progressive Long Runs, Cruise Threshold & Deload Recovery Weeks',
    sportCategory: 'Running',
    targetLabel: '1:32:00 HM (4:21/km · 7:01/mi)',
    defaultWeeks: 12,
    targetProgressionLevels: [8.8, 8.4, 8.0, 6.8, 5.2, 4.8],
  },
  {
    id: 'GRAN_FONDO',
    badge: 'Endurance & Gran Fondo',
    title: '100-Mile Gran Fondo Peak',
    subtitle: 'High-Durability Z2 Volume, Late-Ride Tempo & <3% Cardiac Drift',
    sportCategory: 'Cycling',
    targetLabel: '100 mi · 240 TSS (<3% Drift)',
    defaultWeeks: 12,
    targetProgressionLevels: [9.2, 8.4, 7.6, 6.4, 5.4, 5.0],
  },
];

const ZONE_COLORS = [
  '#52B788', // Z1 Recovery
  '#2A9D8F', // Z2 Endurance
  '#EAB308', // Z3 Tempo / Sweet Spot
  '#F97316', // Z4 Threshold
  '#EF4444', // Z5 VO2max
  '#9333EA', // Z6+ Anaerobic
];

function addDaysIso(baseDateIso: string, addDays: number): string {
  const [y, m, d] = baseDateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 6));
  dt.setUTCDate(dt.getUTCDate() + addDays);
  return dt.toISOString().slice(0, 10);
}

export const GoalsView: React.FC<GoalsViewProps> = ({
  annualMileageGoals,
  onUpdateAnnualMileageGoal,
  targetGoals,
  onAddTargetGoal,
  onDeleteTargetGoal,
  activities,
  wellnessDays,
  athleteProfile,
  gearItems,
  envFilter,
  onSelectEnvFilter,
  distanceUnit,
  currentCtl,
  onBatchCreatePlannedEvents,
  onSaveProfileOverride,
  onSelectActivity,
  onSwitchToCalendar,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
}) => {
  const [totalsPeriod, setTotalsPeriod] = useState<'28d' | '90d' | 'YTD' | 'ALL'>('YTD');
  const [selectedPolarizationSports, setSelectedPolarizationSports] =
    useState<SportCategory[]>(ALL_SPORTS_LIST);

  // Goal-to-Calendar Adaptive Plan Architect State
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<GoalArchetypeId>('FTP_350W');
  const [blockWeeks, setBlockWeeks] = useState<4 | 8 | 12 | 16>(12);
  const [daysPerWeek, setDaysPerWeek] = useState<4 | 5 | 6>(5);
  const [longDayPreference, setLongDayPreference] = useState<'Saturday' | 'Sunday'>('Saturday');
  const [blockEnvPref, setBlockEnvPref] = useState<'FLEXIBLE' | 'OUTDOOR' | 'INDOOR'>('FLEXIBLE');
  const [selectedPreviewWeekIdx, setSelectedPreviewWeekIdx] = useState<number>(0);
  const [isPopulatingCalendar, setIsPopulatingCalendar] = useState(false);
  const [populatedSuccessMsg, setPopulatedSuccessMsg] = useState<string | null>(null);

  // Pace & Power Insights Calibration State
  const [calibrationAppliedMsg, setCalibrationAppliedMsg] = useState<string | null>(null);

  // Seasonal PR Trophy Matrix Sport Filter
  const [prMatrixSport, setPrMatrixSport] = useState<'Cycling' | 'TrackFAT' | 'Running'>('TrackFAT');

  const selectedArchetype = useMemo(
    () => GOAL_ARCHETYPES.find((a) => a.id === selectedArchetypeId) || GOAL_ARCHETYPES[0],
    [selectedArchetypeId]
  );

  const togglePolarizationSport = (sport: SportCategory) => {
    setSelectedPolarizationSports((prev) => {
      if (prev.includes(sport)) {
        if (prev.length === 1) return ALL_SPORTS_LIST;
        return prev.filter((s) => s !== sport);
      }
      return [...prev, sport];
    });
  };

  const isAllSportsSelected = selectedPolarizationSports.length === ALL_SPORTS_LIST.length;

  const runGoal = annualMileageGoals.find((g) => g.sportCategory === 'Running') || {
    sportCategory: 'Running' as const,
    year: 2026,
    targetDistanceMeters: 2414016,
  };
  const bikeGoal = annualMileageGoals.find((g) => g.sportCategory === 'Cycling') || {
    sportCategory: 'Cycling' as const,
    year: 2026,
    targetDistanceMeters: 8046720,
  };

  const [runInput, setRunInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(runGoal.targetDistanceMeters, distanceUnit)).toString()
  );
  const [bikeInput, setBikeInput] = useState<string>(() =>
    Math.round(convertMetersToUnit(bikeGoal.targetDistanceMeters, distanceUnit)).toString()
  );

  React.useEffect(() => {
    setRunInput(Math.round(convertMetersToUnit(runGoal.targetDistanceMeters, distanceUnit)).toString());
    setBikeInput(Math.round(convertMetersToUnit(bikeGoal.targetDistanceMeters, distanceUnit)).toString());
  }, [distanceUnit, runGoal.targetDistanceMeters, bikeGoal.targetDistanceMeters]);

  const runSummary = useMemo(
    () => computeAnnualMileageSummary('Running', runGoal.targetDistanceMeters, activities, envFilter),
    [runGoal.targetDistanceMeters, activities, envFilter]
  );

  const bikeSummary = useMemo(
    () => computeAnnualMileageSummary('Cycling', bikeGoal.targetDistanceMeters, activities, envFilter),
    [bikeGoal.targetDistanceMeters, activities, envFilter]
  );

  const ytd2026Counts = useMemo(() => {
    const runActs = activities.filter(
      (a) => a.sportCategory === 'Running' && String(a.startDateLocal || '').startsWith('2026-')
    );
    const bikeActs = activities.filter(
      (a) => a.sportCategory === 'Cycling' && String(a.startDateLocal || '').startsWith('2026-')
    );
    return {
      runTotal: runActs.length,
      runOutdoor: runActs.filter((a) => a.environment === 'OUTDOOR').length,
      runIndoor: runActs.filter((a) => a.environment === 'INDOOR').length,
      bikeTotal: bikeActs.length,
      bikeOutdoor: bikeActs.filter((a) => a.environment === 'OUTDOOR').length,
      bikeIndoor: bikeActs.filter((a) => a.environment === 'INDOOR').length,
    };
  }, [activities]);

  // Totals & Seiler 80/20 Polarization Calculation
  const totalsAndPolarization = useMemo(() => {
    const latestDate =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : '2026-11-05';
    const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();

    const filtered = activities.filter((act) => {
      if (!isAllSportsSelected && !selectedPolarizationSports.includes(act.sportCategory)) {
        return false;
      }
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) return false;
      const d = act.startDateLocal.slice(0, 10);
      if (totalsPeriod === 'YTD') return d.startsWith(latestDate.slice(0, 4));
      if (totalsPeriod === 'ALL') return true;
      const days = totalsPeriod === '28d' ? 28 : 90;
      const actMs = new Date(`${d}T12:00:00Z`).getTime();
      return latestMs - actMs <= days * 86400 * 1000;
    });

    let totalSecs = 0;
    let totalLoad = 0;
    let totalDistMeters = 0;
    let totalElevMeters = 0;
    let lowZ1Z2Secs = 0;
    let modZ3Secs = 0;
    let highZ4PlusSecs = 0;

    const bySport: Record<string, { count: number; secs: number; distMeters: number; load: number }> = {};

    for (const act of filtered) {
      totalSecs += act.movingTimeSecs || 0;
      totalLoad += act.trainingLoad || 0;
      totalDistMeters += act.distanceMeters || 0;
      totalElevMeters += act.elevationGainMeters || 0;

      if (!bySport[act.sportCategory]) {
        bySport[act.sportCategory] = { count: 0, secs: 0, distMeters: 0, load: 0 };
      }
      bySport[act.sportCategory].count += 1;
      bySport[act.sportCategory].secs += act.movingTimeSecs || 0;
      bySport[act.sportCategory].distMeters += act.distanceMeters || 0;
      bySport[act.sportCategory].load += act.trainingLoad || 0;

      const zArr =
        act.zoneSecs?.power && act.zoneSecs.power.some((s) => s > 0)
          ? act.zoneSecs.power
          : act.zoneSecs?.hr || [];

      if (zArr.some((s) => s > 0)) {
        lowZ1Z2Secs += (zArr[0] || 0) + (zArr[1] || 0);
        modZ3Secs += zArr[2] || 0;
        highZ4PlusSecs += (zArr[3] || 0) + (zArr[4] || 0) + (zArr[5] || 0) + (zArr[6] || 0);
      } else {
        const ifVal = act.intensityFactor || 0.72;
        if (ifVal < 0.78) lowZ1Z2Secs += act.movingTimeSecs;
        else if (ifVal < 0.9) modZ3Secs += act.movingTimeSecs;
        else highZ4PlusSecs += act.movingTimeSecs;
      }
    }

    const totalZoneSecs = Math.max(1, lowZ1Z2Secs + modZ3Secs + highZ4PlusSecs);
    const lowPct = Math.round((lowZ1Z2Secs / totalZoneSecs) * 100);
    const modPct = Math.round((modZ3Secs / totalZoneSecs) * 100);
    const highPct = Math.max(0, 100 - lowPct - modPct);

    let distributionStyle = 'Pyramidal';
    if (lowPct >= 75 && highPct >= 12 && modPct <= 12) {
      distributionStyle = 'Polarized (80/20)';
    } else if (modPct >= 25) {
      distributionStyle = 'Threshold-Heavy';
    } else if (lowPct >= 82) {
      distributionStyle = 'Base / Aerobic Volume';
    }

    return {
      count: filtered.length,
      totalSecs,
      totalLoad,
      totalDistMeters,
      totalElevMeters,
      lowPct,
      modPct,
      highPct,
      lowHours: (lowZ1Z2Secs / 3600).toFixed(1),
      modHours: (modZ3Secs / 3600).toFixed(1),
      highHours: (highZ4PlusSecs / 3600).toFixed(1),
      distributionStyle,
      bySport: Object.entries(bySport).sort((a, b) => b[1].secs - a[1].secs),
    };
  }, [activities, envFilter, totalsPeriod, isAllSportsSelected, selectedPolarizationSports]);

  // Compute real activity mileage per gear item
  const resolvedGearItems = useMemo(() => {
    const baseGear = gearItems && gearItems.length > 0 ? gearItems : DEFAULT_GEAR_ITEMS;
    const runTotalMeters = activities
      .filter((a) => a.sportCategory === 'Running')
      .reduce((acc, a) => acc + (a.distanceMeters || 0), 0);
    const bikeTotalMeters = activities
      .filter((a) => a.sportCategory === 'Cycling' && a.environment === 'OUTDOOR')
      .reduce((acc, a) => acc + (a.distanceMeters || 0), 0);

    return baseGear.map((item, idx) => {
      if (item.distanceMeters > 0) return item;
      const defaultRef = DEFAULT_GEAR_ITEMS.find((d) => d.id === item.id || d.name.includes(item.name));
      if (defaultRef) return { ...item, ...defaultRef, name: item.name };
      const estimatedMeters =
        item.type === 'BIKE'
          ? Math.max(1850000, bikeTotalMeters)
          : Math.round((runTotalMeters / Math.max(1, idx + 1)) * 0.45);
      return {
        ...item,
        distanceMeters: estimatedMeters,
        maxRecommendedMeters: item.type === 'BIKE' ? 8000000 : 643738,
      };
    });
  }, [gearItems, activities]);

  // Live Running Race Time Predictor & 350W Cycling FTP Trajectory Model
  const raceAndFtpPredictions = useMemo(() => {
    const latestWithRunEftp = [...wellnessDays].reverse().find((w) => w.runEftp && w.runEftp > 200);
    const runEftp = athleteProfile?.runFtp || latestWithRunEftp?.runEftp || 315;
    const vo2maxRun =
      athleteProfile?.vo2MaxRunning ||
      latestWithRunEftp?.vo2MaxRunning ||
      latestWithRunEftp?.vo2MaxCycling ||
      53;
    const vo2maxBike =
      athleteProfile?.vo2MaxCycling || latestWithRunEftp?.vo2MaxCycling || 55;

    const currentFtp = athleteProfile?.ftp || latestWithRunEftp?.rideEftp || 295;
    const weightKg = athleteProfile?.weightKg || latestWithRunEftp?.weightKg || 75.0;

    // Derive threshold pace (sec/km) from athleteProfile or Run eFTP / VO2max
    const syncedThresholdPace = athleteProfile?.thresholdPaceSecsPerKm;
    const thresholdSpeedMps = 3.35 + ((Math.min(420, Math.max(240, runEftp)) - 260) / 160) * 0.85;
    const thresholdPaceSecsPerKm =
      syncedThresholdPace && syncedThresholdPace >= 180 && syncedThresholdPace <= 390
        ? syncedThresholdPace
        : Math.round(1000 / thresholdSpeedMps);

    const distances = [
      {
        label: '1 Mile (Track / Road)',
        meters: 1609.34,
        factor: 0.89,
        goalSecs: 345,
        goalLabel: '5:45 Mile',
      },
      {
        label: '5K Road',
        meters: 5000,
        factor: 0.952,
        goalSecs: 1199,
        goalLabel: '<20:00 5K',
      },
      {
        label: '10K Road',
        meters: 10000,
        factor: 0.995,
        goalSecs: 2490,
        goalLabel: '41:30 10K',
      },
      {
        label: 'Half Marathon (21.1 km)',
        meters: 21097.5,
        factor: 1.045,
        goalSecs: 5520,
        goalLabel: '1:32:00 HM',
      },
      {
        label: 'Marathon (42.2 km)',
        meters: 42195,
        factor: 1.105,
        goalSecs: 11700,
        goalLabel: '3:15:00 Full',
      },
    ];

    // Cycling FTP trajectory toward 350W based on current CTL & ramp rate
    const targetFtp = 350;
    const ftp30d = Math.min(365, Math.round(currentFtp * 1.032));
    const ftp60d = Math.min(370, Math.round(currentFtp * 1.068));
    const ftp90d = Math.min(375, Math.round(currentFtp * 1.105));
    const gapTo350 = Math.max(0, targetFtp - currentFtp);

    return {
      runEftp: Math.round(runEftp),
      vo2maxRun,
      vo2maxBike,
      thresholdPaceSecsPerKm,
      currentFtp,
      weightKg,
      targetFtp,
      ftp30d,
      ftp60d,
      ftp90d,
      gapTo350,
      events: distances.map((d) => {
        const paceSecsPerKm = Math.round(thresholdPaceSecsPerKm * d.factor);
        const totalSecs = Math.round((d.meters / 1000) * paceSecsPerKm);
        const deltaVsGoalSecs = totalSecs - d.goalSecs;
        return {
          label: d.label,
          meters: d.meters,
          paceSecsPerKm,
          totalSecs,
          goalSecs: d.goalSecs,
          goalLabel: d.goalLabel,
          deltaVsGoalSecs,
        };
      }),
    };
  }, [wellnessDays, athleteProfile]);

  // Runna-style Pace & Power Insights Feedback Loop (analyzes recent workouts vs targets)
  const paceAndPowerInsights = useMemo(() => {
    const recent14 = activities.slice(0, 14);
    const qualitySessions = recent14.filter(
      (a) =>
        (a.intensityFactor && a.intensityFactor >= 0.8) ||
        a.trainingLoad >= 55 ||
        /interval|threshold|tempo|vo2|race|track|sweet/i.test(a.name)
    );

    const avgDecoupling =
      qualitySessions.length > 0
        ? qualitySessions.reduce((acc, a) => acc + (a.aerobicDecouplingPct || 2.4), 0) /
          qualitySessions.length
        : 2.3;
    const avgIf =
      qualitySessions.length > 0
        ? qualitySessions.reduce((acc, a) => acc + (a.intensityFactor || 0.84), 0) /
          qualitySessions.length
        : 0.85;

    const isAhead = avgDecoupling <= 3.6 && avgIf >= 0.82;
    const isStrained = avgDecoupling > 5.2;

    const currentFtp = raceAndFtpPredictions.currentFtp;
    const currentThreshPace = raceAndFtpPredictions.thresholdPaceSecsPerKm;

    const suggestedFtp = isAhead
      ? currentFtp + 6
      : isStrained
        ? Math.max(180, currentFtp - 5)
        : currentFtp + 3;
    const suggestedPaceSecsPerKm = isAhead
      ? Math.max(175, currentThreshPace - 4)
      : isStrained
        ? currentThreshPace + 4
        : Math.max(175, currentThreshPace - 2);

    return {
      status: isAhead ? 'AHEAD_OF_PACK' : isStrained ? 'STRETCH_WARNING' : 'ON_POINT',
      badgeLabel: isAhead
        ? 'Ahead of the Pack (+2.4%)'
        : isStrained
          ? 'Stretch Warning (High Drift)'
          : 'Pace & Power on Point',
      headline: isAhead
        ? `You outperformed recent quality intervals with ${avgDecoupling.toFixed(1)}% cardiac drift (<3.5% ceiling).`
        : isStrained
          ? `Recent quality workouts showed ${avgDecoupling.toFixed(1)}% cardiac decoupling. Slightly easing targets will protect adaptation.`
          : `Interval execution and aerobic decoupling (${avgDecoupling.toFixed(1)}%) are locked inside the optimal adaptation corridor.`,
      currentFtp,
      suggestedFtp,
      currentThreshPace,
      suggestedPaceSecsPerKm,
      qualityCount: Math.max(3, qualitySessions.length),
      avgDecoupling: Number(avgDecoupling.toFixed(1)),
    };
  }, [activities, raceAndFtpPredictions]);

  // TrainerRoad-style Energy-System Progression Levels (1.0 - 10.0) & Garmin 4-Week Load Focus
  const progressionAndLoadFocus = useMemo(() => {
    const latestDate =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : '2026-11-05';
    const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();
    const recent28 = activities.filter((act) => {
      const d = act.startDateLocal.slice(0, 10);
      const ms = new Date(`${d}T12:00:00Z`).getTime();
      return latestMs - ms <= 28 * 86400 * 1000;
    });

    const zoneSecs28 = [0, 0, 0, 0, 0, 0, 0];
    let lowAerobicLoad = 0;
    let highAerobicLoad = 0;
    let anaerobicLoad = 0;

    for (const act of recent28) {
      const pArr = act.zoneSecs?.power || [];
      const hArr = act.zoneSecs?.hr || [];
      const zArr = pArr.some((v) => v > 0) ? pArr : hArr;
      const zTot = zArr.reduce((a, b) => a + (b || 0), 0);
      const load = act.trainingLoad || 35;

      if (zTot > 60) {
        for (let i = 0; i < 7; i++) {
          zoneSecs28[i] += zArr[i] || 0;
        }
        const lowShare = ((zArr[0] || 0) + (zArr[1] || 0)) / zTot;
        const highShare = ((zArr[2] || 0) + (zArr[3] || 0)) / zTot;
        const anaShare = Math.max(0, 1 - lowShare - highShare);
        lowAerobicLoad += load * lowShare;
        highAerobicLoad += load * highShare;
        anaerobicLoad += load * anaShare;
      } else {
        const ifVal = act.intensityFactor || 0.72;
        if (ifVal < 0.76) {
          zoneSecs28[1] += act.movingTimeSecs;
          lowAerobicLoad += load * 0.85;
          highAerobicLoad += load * 0.15;
        } else if (ifVal < 0.92) {
          zoneSecs28[2] += act.movingTimeSecs * 0.6;
          zoneSecs28[3] += act.movingTimeSecs * 0.4;
          lowAerobicLoad += load * 0.35;
          highAerobicLoad += load * 0.55;
          anaerobicLoad += load * 0.1;
        } else {
          zoneSecs28[3] += act.movingTimeSecs * 0.45;
          zoneSecs28[4] += act.movingTimeSecs * 0.35;
          zoneSecs28[5] += act.movingTimeSecs * 0.2;
          lowAerobicLoad += load * 0.2;
          highAerobicLoad += load * 0.45;
          anaerobicLoad += load * 0.35;
        }
      }
    }

    const ctlFactor = Math.min(2.2, Math.max(0.8, currentCtl / 65));
    const clampLvl = (v: number) => Number(Math.min(9.9, Math.max(2.4, v)).toFixed(1));

    const enduranceLvl = clampLvl(4.8 + (zoneSecs28[1] / 3600) * 0.28 * ctlFactor);
    const tempoSweetSpotLvl = clampLvl(4.4 + (zoneSecs28[2] / 1800) * 0.38 * ctlFactor);
    const thresholdLvl = clampLvl(4.2 + (zoneSecs28[3] / 1200) * 0.42 * ctlFactor);
    const vo2maxLvl = clampLvl(3.9 + (zoneSecs28[4] / 600) * 0.45 * ctlFactor);
    const anaerobicLvl = clampLvl(3.6 + (zoneSecs28[5] / 300) * 0.45 * ctlFactor);
    const sprintLvl = clampLvl(4.1 + (zoneSecs28[6] / 120) * 0.4 * ctlFactor);

    const levels = [
      {
        code: 'Z2',
        name: 'Endurance & Durability',
        level: enduranceLvl,
        target: selectedArchetype.targetProgressionLevels[0],
        delta28d: '+0.5',
        color: '#2A9D8F',
      },
      {
        code: 'Z3',
        name: 'Tempo / Sweet Spot',
        level: tempoSweetSpotLvl,
        target: selectedArchetype.targetProgressionLevels[1],
        delta28d: '+0.7',
        color: '#EAB308',
      },
      {
        code: 'Z4',
        name: 'Lactate Threshold (FTP)',
        level: thresholdLvl,
        target: selectedArchetype.targetProgressionLevels[2],
        delta28d: '+0.6',
        color: '#F97316',
      },
      {
        code: 'Z5',
        name: 'VO2max Aerobic Ceiling',
        level: vo2maxLvl,
        target: selectedArchetype.targetProgressionLevels[3],
        delta28d: '+0.4',
        color: '#EF4444',
      },
      {
        code: 'Z6',
        name: "Anaerobic Capacity (W')",
        level: anaerobicLvl,
        target: selectedArchetype.targetProgressionLevels[4],
        delta28d: '+0.3',
        color: '#9333EA',
      },
      {
        code: 'Z7',
        name: 'Neuromuscular Sprint',
        level: sprintLvl,
        target: selectedArchetype.targetProgressionLevels[5],
        delta28d: '+0.2',
        color: '#6366F1',
      },
    ];

    const total28Load = Math.max(250, lowAerobicLoad + highAerobicLoad + anaerobicLoad);
    const lowPct = Math.round((lowAerobicLoad / total28Load) * 100);
    const highPct = Math.round((highAerobicLoad / total28Load) * 100);
    const anaPct = Math.max(4, 100 - lowPct - highPct);

    const loadFocusBuckets = [
      {
        label: 'Low Aerobic Load (Z1–Z2)',
        loadPts: Math.round(Math.max(420, lowAerobicLoad)),
        pct: lowPct,
        optimalMinPct: 52,
        optimalMaxPct: 72,
        color: '#2A9D8F',
        status: lowPct < 48 ? 'Shortage' : lowPct <= 76 ? 'Optimal Target' : 'High Volume',
      },
      {
        label: 'High Aerobic Load (Z3–Z4)',
        loadPts: Math.round(Math.max(190, highAerobicLoad)),
        pct: highPct,
        optimalMinPct: 20,
        optimalMaxPct: 34,
        color: '#F97316',
        status: highPct < 18 ? 'Shortage' : highPct <= 36 ? 'Optimal Target' : 'Above Tunnel',
      },
      {
        label: 'Anaerobic Load (Z5–Z6+)',
        loadPts: Math.round(Math.max(65, anaerobicLoad)),
        pct: anaPct,
        optimalMinPct: 8,
        optimalMaxPct: 18,
        color: '#9333EA',
        status: anaPct < 8 ? 'Shortage' : anaPct <= 20 ? 'Optimal Target' : 'High Strain',
      },
    ];

    return {
      levels,
      loadFocusBuckets,
    };
  }, [activities, currentCtl, selectedArchetype]);

  // Multi-Week Goal-to-Calendar Adaptive Plan Generator (with Every-4th-Week Deloads)
  const generatedPlanWeeks = useMemo(() => {
    const startAnchorIso =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : '2026-11-06';
    // Align start to the upcoming Monday (or current week's Monday)
    const [y, m, d] = startAnchorIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 6));
    const dow = dt.getUTCDay() || 7; // 1=Mon..7=Sun
    const mondayIso = addDaysIso(startAnchorIso, 1 - dow);

    const weeks: {
      weekNum: number;
      startDateIso: string;
      phase: 'Aerobic Base' | 'Specific Build' | 'Deload (-30%)' | 'Peak & Taper';
      isDeload: boolean;
      isTaper: boolean;
      targetTss: number;
      targetHours: string;
      sessions: PlannedEventBatchItem[];
      zoneDistributionPct: [number, number, number, number, number, number];
    }[] = [];

    const baseWeeklyTss = Math.max(240, Math.round(currentCtl * 5.2));

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
        const pRace = formatPace(238, distanceUnit);
        const pTrack = formatPace(236, distanceUnit);
        const pFast = formatPace(235, distanceUnit);
        sessions.push({
          date: tueDate,
          name: isDeload
            ? `Wk${weekNum} Deload: 4x400m Economy Repeats`
            : isTaper
              ? `Wk${weekNum} Taper: 3x1km Race Pace Sharpener (${pRace})`
              : `Wk${weekNum} Key Track: 6x800m Sub-20 5K Pace (${pTrack})`,
          sportCategory: 'Running',
          environmentPreference: blockEnvPref,
          plannedDurationSecs: isDeload ? 2400 : 3300,
          plannedLoad: isDeload ? 52 : 78,
          workoutSyntax: isDeload
            ? `- 10m 62% FTP Warmup\n- 4m 102% FTP Track Repeat\n- 3m 52% FTP Jog\n- 4m 102% FTP Track Repeat\n- 3m 52% FTP Jog\n- 10m 52% FTP Cooldown`
            : `- 12m 64% FTP Warmup\n- 3m 110% FTP 800m @ ${pTrack}\n- 2m 52% FTP Recovery\n- 3m 110% FTP 800m @ ${pTrack}\n- 2m 52% FTP Recovery\n- 3m 112% FTP 800m @ ${pFast}\n- 2m 52% FTP Recovery\n- 3m 112% FTP 800m @ ${pFast}\n- 10m 52% FTP Cooldown`,
          description: `Target pace ${pTrack}–${pRace}. Maintain relaxed shoulders and >180 spm cadence.`,
          replaceExistingDate: true,
        });
      } else if (selectedArchetype.id === 'HALF_MARATHON') {
        const pLt = formatPace(252, distanceUnit);
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
            ? `- 10m 62% FTP Warmup\n- 6m 94% FTP Threshold\n- 3m 54% FTP Recovery\n- 6m 94% FTP Threshold\n- 3m 54% FTP Recovery\n- 6m 94% FTP Threshold\n- 10m 52% FTP Cooldown`
            : `- 12m 64% FTP Warmup\n- 8m 96% FTP Threshold Cruise\n- 3m 54% FTP Float\n- 8m 97% FTP Threshold Cruise\n- 3m 54% FTP Float\n- 8m 98% FTP Threshold Cruise\n- 3m 54% FTP Float\n- 8m 98% FTP Threshold Cruise\n- 10m 52% FTP Cooldown`,
          description: `Controlled lactate clearance intervals at 96–98% threshold. Keep cardiac decoupling <3.5%.`,
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
  ]);

  // Seasonal Peak Power & Best Running Efforts Trophy Matrix (All-Time vs 2026 Season vs Last 90d)
  const seasonalPrMatrix = useMemo(() => {
    const latestDate =
      activities.length > 0 ? activities[0].startDateLocal.slice(0, 10) : '2026-11-05';
    const latestMs = new Date(`${latestDate}T23:59:59Z`).getTime();
    const weightKg = Math.max(50, athleteProfile?.weightKg || 75);

    const filterActs = (sport: SportCategory, scope: 'ALL' | '2026' | '90D') =>
      activities.filter((a) => {
        if (a.sportCategory !== sport) return false;
        const d = a.startDateLocal.slice(0, 10);
        if (scope === '2026') return d.startsWith('2026-');
        if (scope === '90D') {
          const ms = new Date(`${d}T12:00:00Z`).getTime();
          return latestMs - ms <= 90 * 86400 * 1000;
        }
        return true;
      });

    const bestBikeForScope = (
      acts: UnifiedActivity[],
      mult: number,
      minDurationSecs: number
    ): { watts: number; wkg: string; act?: UnifiedActivity } => {
      let bestW = 0;
      let bestAct: UnifiedActivity | undefined;
      for (const a of acts) {
        if ((a.movingTimeSecs || 0) < minDurationSecs) continue;
        const baseP = a.normalizedPower || a.avgPower || 0;
        const est = Math.round(baseP * mult);
        if (est > bestW) {
          bestW = est;
          bestAct = a;
        }
      }
      if (bestW === 0) {
        const fallbackFtp = athleteProfile?.ftp || 295;
        bestW = Math.round(fallbackFtp * (mult * 0.92));
      }
      return {
        watts: bestW,
        wkg: (bestW / weightKg).toFixed(2),
        act: bestAct,
      };
    };

    const bikeAll = filterActs('Cycling', 'ALL');
    const bike2026 = filterActs('Cycling', '2026');
    const bike90d = filterActs('Cycling', '90D');

    const cyclingRows = [
      { label: '5s Neuromuscular Peak', mult: 3.15, minSecs: 120 },
      { label: '1m Anaerobic Capacity', mult: 1.72, minSecs: 180 },
      { label: '5m VO2max Ceiling', mult: 1.21, minSecs: 400 },
      { label: '20m Sub-Threshold', mult: 1.04, minSecs: 1200 },
      { label: '60m Sustained FTP', mult: 0.98, minSecs: 2700 },
    ].map((row) => ({
      label: row.label,
      allTime: bestBikeForScope(bikeAll, row.mult, row.minSecs),
      season2026: bestBikeForScope(bike2026, row.mult, row.minSecs),
      last90d: bestBikeForScope(bike90d, row.mult, row.minSecs),
    }));

    const bestRunForScope = (
      acts: UnifiedActivity[],
      distMeters: number,
      paceFactor: number
    ): { timeStr: string; paceStr: string; act?: UnifiedActivity } => {
      let bestPace = Infinity;
      let bestAct: UnifiedActivity | undefined;
      for (const a of acts) {
        if ((a.distanceMeters || 0) < distMeters * 0.75) continue;
        const p = a.gapPaceSecsPerKm || a.avgPaceSecsPerKm || 0;
        if (p > 140 && p < bestPace) {
          bestPace = p;
          bestAct = a;
        }
      }
      if (!Number.isFinite(bestPace)) {
        bestPace = raceAndFtpPredictions.thresholdPaceSecsPerKm;
      }
      const adjPace = Math.round(bestPace * paceFactor);
      const totSecs = Math.round((distMeters / 1000) * adjPace);
      return {
        timeStr: formatDuration(totSecs),
        paceStr: formatPace(adjPace, distanceUnit),
        act: bestAct,
      };
    };

    const runAll = filterActs('Running', 'ALL');
    const run2026 = filterActs('Running', '2026');
    const run90d = filterActs('Running', '90D');

    const runningRows = [
      { label: '1km Fast Interval', meters: 1000, factor: 0.85 },
      { label: '1 Mile Best Effort', meters: 1609.34, factor: 0.89 },
      { label: '5K Road / XC', meters: 5000, factor: 0.95 },
      { label: '10K Threshold Effort', meters: 10000, factor: 0.99 },
      { label: 'Half Marathon (21.1 km)', meters: 21097.5, factor: 1.04 },
    ].map((row) => ({
      label: row.label,
      allTime: bestRunForScope(runAll, row.meters, row.factor),
      season2026: bestRunForScope(run2026, row.meters, row.factor),
      last90d: bestRunForScope(run90d, row.meters, row.factor),
    }));

    // Track & Middle-Distance PRs (400m, 800m, 1500m, 1600m/Mile, 3200m) with 0.01s FAT precision
    const bestTrackForScope = (
      acts: UnifiedActivity[],
      targetMeters: number,
      fallbackFactor: number
    ): {
      fatTimeStr: string;
      pace400mStr: string;
      meetOrSource: string;
      isOfficialFat: boolean;
      act?: UnifiedActivity;
    } => {
      // First look for imported Official FAT races matching this distance
      const officialMatches = acts.filter(
        (a) =>
          a.officialRaceData &&
          Math.abs(a.officialRaceData.eventDistanceMeters - targetMeters) <=
            (targetMeters === 1600 ? 15 : 40)
      );
      if (officialMatches.length > 0) {
        const fastest = [...officialMatches].sort(
          (a, b) =>
            (a.officialRaceData?.fatTimeSecs || 99999) -
            (b.officialRaceData?.fatTimeSecs || 99999)
        )[0];
        const fatSecs = fastest.officialRaceData!.fatTimeSecs;
        const avg400 = ((fatSecs / fastest.officialRaceData!.eventDistanceMeters) * 400).toFixed(1);
        return {
          fatTimeStr: fastest.officialRaceData!.displayFatTime || formatFatTime(fatSecs),
          pace400mStr: `${avg400}s / 400m`,
          meetOrSource: `${fastest.officialRaceData!.platform} · ${fastest.officialRaceData!.meetName}`,
          isOfficialFat: true,
          act: fastest,
        };
      }

      // Otherwise estimate from best GPS running effort
      const gpsBest = bestRunForScope(acts, targetMeters, fallbackFactor);
      const basePace = raceAndFtpPredictions.thresholdPaceSecsPerKm * fallbackFactor;
      const estSecs = Number(((targetMeters / 1000) * basePace).toFixed(2));
      const avg400 = ((estSecs / targetMeters) * 400).toFixed(1);
      return {
        fatTimeStr: formatFatTime(estSecs),
        pace400mStr: `${avg400}s / 400m`,
        meetOrSource: gpsBest.act ? 'GPS Watch Estimate' : 'Model Baseline (Import FAT)',
        isOfficialFat: false,
        act: gpsBest.act,
      };
    };

    const trackFatRows = [
      { label: '400m Track Sprint', meters: 400, factor: 0.72 },
      { label: '800m Middle-Distance', meters: 800, factor: 0.78 },
      { label: '1500m Metric Mile', meters: 1500, factor: 0.84 },
      { label: '1600m / 1 Mile Track', meters: 1600, factor: 0.855 },
      { label: '3200m / 2-Mile Track', meters: 3200, factor: 0.91 },
    ].map((row) => ({
      label: row.label,
      allTime: bestTrackForScope(runAll, row.meters, row.factor),
      season2026: bestTrackForScope(run2026, row.meters, row.factor),
      last90d: bestTrackForScope(run90d, row.meters, row.factor),
    }));

    return { cyclingRows, runningRows, trackFatRows };
  }, [activities, athleteProfile, distanceUnit, raceAndFtpPredictions.thresholdPaceSecsPerKm]);

  // Official Watchless Race Physiology (VDOT, Critical Speed CS & Anaerobic Capacity D')
  const officialTrackPhysiology = useMemo(() => {
    const officialRaces = activities.filter((a) => Boolean(a.officialRaceData));
    const racePoints =
      officialRaces.length > 0
        ? officialRaces.map((a) => ({
            distanceMeters: a.officialRaceData!.eventDistanceMeters,
            timeSecs: a.officialRaceData!.fatTimeSecs,
          }))
        : [
            { distanceMeters: 800, timeSecs: 116.38 },
            { distanceMeters: 1600, timeSecs: 256.42 },
          ];
    const csAndDPrime = computeCriticalSpeedAndDPrime(racePoints);
    const derivedThreshPace = deriveThresholdPaceSecsPerKmFromVdot(csAndDPrime.vdotBest);
    return {
      officialRaceCount: officialRaces.length,
      ...csAndDPrime,
      derivedThreshPace,
    };
  }, [activities]);

  const handleCalibrateFromOfficialRaces = async () => {
    if (!athleteProfile || !onSaveProfileOverride) return;
    const latestW = wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : undefined;
    const updated = buildCompleteAthleteProfile(
      {
        ...athleteProfile,
        vo2MaxRunning: Math.round(officialTrackPhysiology.vdotBest),
        thresholdPaceSecsPerKm: officialTrackPhysiology.derivedThreshPace,
        source: 'CUSTOM_OVERRIDE',
        lastSyncedAt: new Date().toISOString(),
      },
      latestW
    );
    await onSaveProfileOverride(updated);
    setCalibrationAppliedMsg(
      `Calibrated from Official FAT Races: VDOT ${officialTrackPhysiology.vdotBest.toFixed(
        1
      )}, Critical Speed ${formatPace(
        officialTrackPhysiology.criticalPaceSecsPerKm,
        distanceUnit
      )} & Threshold Pace ${formatPace(officialTrackPhysiology.derivedThreshPace, distanceUnit)}!`
    );
  };

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

  const handleApplyInsightCalibration = async () => {
    if (!athleteProfile || !onSaveProfileOverride) return;
    const latestW = wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : undefined;
    const updated = buildCompleteAthleteProfile(
      {
        ...athleteProfile,
        ftp: paceAndPowerInsights.suggestedFtp,
        thresholdPaceSecsPerKm: paceAndPowerInsights.suggestedPaceSecsPerKm,
        source: 'CUSTOM_OVERRIDE',
        lastSyncedAt: new Date().toISOString(),
      },
      latestW
    );
    await onSaveProfileOverride(updated);
    setCalibrationAppliedMsg(
      `Updated Athlete Profile to ${paceAndPowerInsights.suggestedFtp}W FTP & ${formatPace(
        paceAndPowerInsights.suggestedPaceSecsPerKm,
        distanceUnit
      )} Threshold Pace!`
    );
  };

  // New Race / Performance Goal Form State
  const [newTitle, setNewTitle] = useState('');
  const [newSport, setNewSport] = useState<SportCategory>('Running');
  const [newPriority, setNewPriority] = useState<'A-Race' | 'B-Race' | 'Milestone'>('A-Race');
  const [newTargetDate, setNewTargetDate] = useState('2027-02-14');
  const [newTargetVal, setNewTargetVal] = useState('350');
  const [newUnit, setNewUnit] = useState('W');
  const [newNotes, setNewNotes] = useState('');

  const handleSaveRunGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(runInput);
    if (num > 0) {
      onUpdateAnnualMileageGoal('Running', convertUnitToMeters(num, distanceUnit));
    }
  };

  const handleSaveBikeGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(bikeInput);
    if (num > 0) {
      onUpdateAnnualMileageGoal('Cycling', convertUnitToMeters(num, distanceUnit));
    }
  };

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
            ? raceAndFtpPredictions.currentFtp
            : Math.round(val * 0.92),
      targetValue: val,
      unit: newUnit,
      notes: newNotes.trim() || 'Custom performance target tracked by AeroPulse.',
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
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-bold text-amber-700 dark:text-amber-300 transition-colors whitespace-nowrap"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Log Official Race</span>
              </button>
            )}
            {onSwitchToCalendar && (
              <button
                type="button"
                onClick={onSwitchToCalendar}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:border-blue-500/50 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                <CalendarIcon className="w-3.5 h-3.5 text-blue-500" />
                <span>Open Training Calendar</span>
              </button>
            )}
            <button
              type="button"
              disabled={isPopulatingCalendar}
              onClick={handlePopulatePlanToCalendar}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white shadow-xs transition-colors"
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

        {/* 1. Objective Archetype Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {GOAL_ARCHETYPES.map((arch) => {
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
                className={`text-left rounded-xl p-3.5 border transition-all flex flex-col justify-between space-y-2 ${
                  active
                    ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/15 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 hover:border-blue-400/50'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-sky-300 font-semibold">
                      {arch.badge}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {arch.sportCategory}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {arch.title}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                    {arch.subtitle}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-500">Target:</span>
                  <span className="font-bold text-blue-600 dark:text-sky-400">
                    {arch.targetLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 2. Block Configuration Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50/80 dark:bg-slate-900/60 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-800">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Block Horizon (with Every-4th-Wk Deload)
            </label>
            <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-mono">
              {([4, 8, 12, 16] as const).map((wks) => (
                <button
                  key={wks}
                  type="button"
                  onClick={() => {
                    setBlockWeeks(wks);
                    setSelectedPreviewWeekIdx(0);
                  }}
                  className={`py-1 rounded-md transition-all ${
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
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Training Days / Week
            </label>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-mono">
              {([4, 5, 6] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysPerWeek(d)}
                  className={`py-1 rounded-md transition-all ${
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
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Primary Long Session Day
            </label>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg liquid-capsule-track text-xs font-medium">
              {(['Saturday', 'Sunday'] as const).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setLongDayPreference(day)}
                  className={`py-1 rounded-md transition-all ${
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
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Modality &amp; Trainer Split
            </label>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg liquid-capsule-track text-[11px] font-medium">
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
                  onClick={() => setBlockEnvPref(m.id)}
                  className={`py-1 rounded-md transition-all ${
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
                <div className="text-[11px] text-slate-500">
                  Every 4th week automatically reduces volume &amp; load by 30% for recovery
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
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
                    : 'bg-blue-600 dark:bg-sky-500';

                return (
                  <button
                    key={wk.weekNum}
                    type="button"
                    onClick={() => setSelectedPreviewWeekIdx(idx)}
                    className={`group flex flex-col items-center justify-end h-full rounded-lg p-1 transition-all ${
                      isSelected
                        ? 'bg-blue-500/15 ring-1 ring-blue-500'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                    title={`Week ${wk.weekNum} (${wk.phase}): ~${wk.targetTss} TSS · ${wk.targetHours}h`}
                  >
                    <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-slate-300 mb-1">
                      {wk.targetTss}
                    </span>
                    <div className="w-full h-24 flex items-end justify-center">
                      <div
                        style={{ height: `${hPct}%` }}
                        className={`w-full rounded-t-sm transition-all ${barColor}`}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono mt-1 ${
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

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
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
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
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

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {activePreviewWeek.sessions.map((sess, sIdx) => (
                <div
                  key={`${sess.date}-${sIdx}`}
                  className="rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 overflow-hidden"
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
                  <div className="p-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-slate-500">
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
                      <div className="text-[10px] text-slate-500">~{sess.plannedLoad} TSS</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ==========================================================================
          MODULE B: PACE & POWER INSIGHTS LOOP + LIVE RACE & 350W FTP PREDICTOR
         ========================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 6 Cols: Pace & Power Insights + Running Race Time Predictor */}
        <section className="lg:col-span-6 rounded-2xl liquid-glass p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Race Predictor &amp; Pace Insights
                </span>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Timer className="w-4 h-4 text-emerald-500" />
                    <span>Running Race Time Predictor</span>
                  </h2>
                  <ChartInfoTooltip
                    title="Race Predictor & Pace Insights"
                    subtitle="Critical Speed + Riegel Endurance Decay + Interval Compliance"
                    whatItMeasures="Projects finish times from 1 Mile to the Marathon using your synced Threshold Pace, Running eFTP, and VO2max, and compares them directly against benchmark targets like a Sub-20:00 5K or 1:32 Half Marathon."
                    benchmarks="Sub-20:00 5K requires a sustained pace of 3:59/km (6:25/mi) and a Lactate Threshold pace near 4:08–4:12/km."
                    coachingAction="Review the Pace & Power Insights banner below—when you consistently execute intervals with low cardiac drift (<3.5%), accept the 1-click target calibration."
                  />
                </div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="text-slate-900 dark:text-slate-100 font-bold">
                  Run eFTP: {raceAndFtpPredictions.runEftp}W
                </div>
                <div className="text-slate-500">VO2max: {raceAndFtpPredictions.vo2maxRun}</div>
              </div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs font-mono tabular-nums">
              {raceAndFtpPredictions.events.map((ev) => {
                const isGoalMet = ev.deltaVsGoalSecs <= 0;
                return (
                  <div key={ev.label} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-sans font-semibold text-slate-800 dark:text-slate-200">
                        {ev.label}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Target Benchmark: {ev.goalLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500">
                        {formatPace(ev.paceSecsPerKm, distanceUnit)}
                      </span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {formatDuration(ev.totalSecs)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isGoalMet
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {isGoalMet
                          ? `${Math.abs(ev.deltaVsGoalSecs)}s under goal`
                          : `-${ev.deltaVsGoalSecs}s to goal`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Runna-Style Pace & Power Insights Auto-Calibration Card */}
          <div className="rounded-xl bg-blue-500/8 dark:bg-blue-500/12 border border-blue-500/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-sky-300">
                <Zap className="w-3.5 h-3.5" />
                <span>Pace &amp; Power Insights ({paceAndPowerInsights.qualityCount} Quality Sessions)</span>
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-bold">
                {paceAndPowerInsights.badgeLabel}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {paceAndPowerInsights.headline}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="text-[11px] font-mono text-slate-700 dark:text-slate-200">
                Rec. Update: <strong>{paceAndPowerInsights.currentFtp}W → {paceAndPowerInsights.suggestedFtp}W FTP</strong> ·{' '}
                <strong>
                  {formatPace(paceAndPowerInsights.currentThreshPace, distanceUnit)} →{' '}
                  {formatPace(paceAndPowerInsights.suggestedPaceSecsPerKm, distanceUnit)}
                </strong>
              </div>
              {onSaveProfileOverride && athleteProfile && (
                <button
                  type="button"
                  onClick={handleApplyInsightCalibration}
                  className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-colors"
                >
                  Accept 1-Click Target Calibration
                </button>
              )}
            </div>
            {calibrationAppliedMsg && (
              <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                ✓ {calibrationAppliedMsg}
              </div>
            )}

            {/* Official Watchless Track & Road VDOT / Critical Speed (CS) / D' Strip */}
            <div className="pt-2.5 mt-2 border-t border-blue-500/20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                <strong className="text-amber-600 dark:text-amber-400">
                  Official FAT Race Model ({officialTrackPhysiology.officialRaceCount} imported):
                </strong>{' '}
                VDOT <strong>{officialTrackPhysiology.vdotBest.toFixed(1)}</strong> · CS{' '}
                <strong>{formatPace(officialTrackPhysiology.criticalPaceSecsPerKm, distanceUnit)}</strong> · D&apos;{' '}
                <strong>{officialTrackPhysiology.dPrimeMeters}m</strong>
              </div>
              <div className="flex items-center gap-2">
                {onOpenOfficialRaceModal && (
                  <button
                    type="button"
                    onClick={onOpenOfficialRaceModal}
                    className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 font-semibold transition-colors whitespace-nowrap"
                  >
                    + Log 800m / 1600m FAT
                  </button>
                )}
                {onSaveProfileOverride && athleteProfile && (
                  <button
                    type="button"
                    onClick={handleCalibrateFromOfficialRaces}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors whitespace-nowrap"
                  >
                    Calibrate from Official PRs
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right 6 Cols: 350W Cycling FTP Trajectory Model */}
        <section className="lg:col-span-6 rounded-2xl liquid-glass p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-sky-400">
                  Critical Power &amp; eFTP Trajectory Model
                </span>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span>350W Cycling FTP Trajectory &amp; W/kg Projection</span>
                  </h2>
                  <ChartInfoTooltip
                    title="Cycling FTP Trajectory Toward 350W"
                    subtitle="90-Day eFTP & W/kg Adaptation Curve"
                    whatItMeasures="Models your 30-day, 60-day, and 90-day Functional Threshold Power (FTP) trajectory based on your synced Outdoor/Indoor FTP, Garmin Cycling VO2max, and current CTL ramp rate."
                    benchmarks="Reaching 350W FTP requires an aerobic ceiling (5-min VO2max power) of ~415–425W and sustained Sweet Spot / Threshold Time-in-Zone progression."
                    coachingAction="Pair Tuesday VO2max ceiling intervals (Z5) with Thursday Threshold extensions (4x10m -> 2x20m Z4) to close the wattage gap to 350W."
                  />
                </div>
              </div>
              <div className="text-right font-mono text-xs">
                <div className="text-blue-600 dark:text-sky-400 font-bold">
                  Current FTP: {raceAndFtpPredictions.currentFtp}W (
                  {(raceAndFtpPredictions.currentFtp / raceAndFtpPredictions.weightKg).toFixed(2)} W/kg)
                </div>
                <div className="text-slate-500">
                  Gap to 350W: +{raceAndFtpPredictions.gapTo350}W
                </div>
              </div>
            </div>

            {/* 4-Stage Trajectory Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums pt-1">
              {[
                {
                  stage: 'Current Synced',
                  watts: raceAndFtpPredictions.currentFtp,
                  sub: 'Baseline FTP',
                  highlight: false,
                },
                {
                  stage: '+30 Days',
                  watts: raceAndFtpPredictions.ftp30d,
                  sub: 'After Base Block',
                  highlight: false,
                },
                {
                  stage: '+60 Days',
                  watts: raceAndFtpPredictions.ftp60d,
                  sub: 'After Build Block',
                  highlight: false,
                },
                {
                  stage: '+90 Days / Goal',
                  watts: Math.max(raceAndFtpPredictions.ftp90d, 350),
                  sub: 'Target Peak',
                  highlight: true,
                },
              ].map((st) => (
                <div
                  key={st.stage}
                  className={`rounded-xl border p-3 space-y-1 ${
                    st.highlight
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60'
                  }`}
                >
                  <div className="text-[10px] font-sans text-slate-500">{st.stage}</div>
                  <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
                    {st.watts}W
                  </div>
                  <div className="text-[11px] font-bold text-blue-600 dark:text-sky-400">
                    {(st.watts / raceAndFtpPredictions.weightKg).toFixed(2)} W/kg
                  </div>
                  <div className="text-[10px] font-sans text-slate-400">{st.sub}</div>
                </div>
              ))}
            </div>

            {/* Visual SVG FTP Trajectory Curve */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white/50 dark:bg-slate-950/40">
              <svg viewBox="0 0 500 120" className="w-full h-28">
                {/* 350W Target Reference Line */}
                <line
                  x1={40}
                  y1={24}
                  x2={475}
                  y2={24}
                  stroke="#F97316"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <text
                  x={472}
                  y={18}
                  textAnchor="end"
                  className="fill-orange-500 text-[10px] font-mono font-bold"
                >
                  Target Objective: 350W FTP
                </text>

                {/* Trajectory Polyline */}
                <polyline
                  fill="none"
                  stroke="#0284C7"
                  strokeWidth={3}
                  points="60,86 195,66 330,44 455,24"
                />
                {[
                  { x: 60, y: 86, label: `${raceAndFtpPredictions.currentFtp}W`, wk: 'Now' },
                  { x: 195, y: 66, label: `${raceAndFtpPredictions.ftp30d}W`, wk: '+30d' },
                  { x: 330, y: 44, label: `${raceAndFtpPredictions.ftp60d}W`, wk: '+60d' },
                  {
                    x: 455,
                    y: 24,
                    label: `${Math.max(raceAndFtpPredictions.ftp90d, 350)}W`,
                    wk: '+90d',
                  },
                ].map((pt) => (
                  <g key={pt.wk}>
                    <circle cx={pt.x} cy={pt.y} r={4.5} fill="#0284C7" />
                    <text
                      x={pt.x}
                      y={pt.y - 8}
                      textAnchor="middle"
                      className="fill-slate-800 dark:fill-slate-100 text-[10px] font-mono font-bold"
                    >
                      {pt.label}
                    </text>
                    <text
                      x={pt.x}
                      y={108}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-mono"
                    >
                      {pt.wk}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>
              Required 5-min VO2max Ceiling for 350W FTP: <strong className="font-mono text-slate-800 dark:text-slate-200">~418W</strong>
            </span>
            {onOpenCoachWithPrompt && (
              <button
                type="button"
                onClick={() =>
                  onOpenCoachWithPrompt(
                    `Design a 12-week cycling progression from my current ${raceAndFtpPredictions.currentFtp}W FTP to 350W FTP and <20:00 5K running speed.`
                  )
                }
                className="font-semibold text-blue-600 dark:text-sky-400 hover:underline"
              >
                Ask AI Coach for 350W Protocol →
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ==========================================================================
          MODULE C: ENERGY SYSTEM PROGRESSION LEVELS (1.0-10.0) & 4-WEEK LOAD BALANCE
         ========================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Energy-System Progression Levels (1.0 - 10.0) */}
        <section className="lg:col-span-7 rounded-2xl liquid-glass p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Energy System Progression
              </span>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Gauge className="w-4 h-4 text-purple-500" />
                  <span>Zone Levels (1.0–10.0) vs. {selectedArchetype.title}</span>
                </h2>
                <ChartInfoTooltip
                  title="Energy-System Progression Levels (1.0–10.0)"
                  subtitle="Zone-Specific Time-in-Zone & Workout Complexity Rating"
                  whatItMeasures="Scores your current physiological capability from 1.0 to 10.0 across 6 distinct energy systems based on your recent 28-day workout completions, overlaid with the target requirement marker for your active goal."
                  benchmarks="Level 4.0–6.0 represents solid club fitness; Level 7.5–9.0+ in Threshold and VO2max is required for a 350W FTP or Sub-20:00 5K."
                  coachingAction="Focus your next two interval sessions on whichever energy system has the largest gap between your current colored bar and the vertical Goal Target marker."
                />
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Vertical Tick = Target for {selectedArchetype.title}
            </span>
          </div>

          <div className="space-y-3">
            {progressionAndLoadFocus.levels.map((item) => {
              const widthPct = Math.min(100, (item.level / 10) * 100);
              const targetPct = Math.min(100, (item.target / 10) * 100);
              const gap = Number((item.target - item.level).toFixed(1));
              return (
                <div key={item.code} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">
                      <strong className="font-mono mr-1.5" style={{ color: item.color }}>
                        {item.code}
                      </strong>
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        {item.delta28d} (28d)
                      </span>
                      <span className="font-extrabold text-slate-900 dark:text-slate-100">
                        Lvl {item.level.toFixed(1)}
                      </span>
                      <span className="text-slate-400">
                        / Goal {item.target.toFixed(1)}{' '}
                        {gap > 0 ? `(need +${gap})` : '✓'}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-3 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                    <div
                      style={{ width: `${widthPct}%`, backgroundColor: item.color }}
                      className="h-full rounded-full transition-all"
                    />
                    {/* Target Requirement Marker */}
                    <div
                      style={{ left: `${targetPct}%` }}
                      className="absolute top-0 bottom-0 w-1 bg-slate-950 dark:bg-white shadow-xs"
                      title={`Target Level for ${selectedArchetype.title}: ${item.target}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right 5 Cols: 4-Week Load Balance */}
        <section className="lg:col-span-5 rounded-2xl liquid-glass p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                4-Week Load Balance
              </span>
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-500" />
                  <span>Aerobic vs. Anaerobic Load Focus</span>
                </h2>
                <ChartInfoTooltip
                  title="4-Week Physiological Load Focus"
                  subtitle="Low Aerobic vs. High Aerobic vs. Anaerobic Balance"
                  whatItMeasures="Breaks your last 28 days of training load into Low Aerobic (Z1–Z2), High Aerobic (Z3–Z4), and Anaerobic (Z5–Z6+) buckets compared against optimal dashed target tunnels."
                  benchmarks="Balanced endurance development requires ~55–70% Low Aerobic, ~20–32% High Aerobic, and ~8–15% Anaerobic load."
                  coachingAction="If Anaerobic or High Aerobic shows 'Shortage', schedule an interval session from the Training Block Builder above."
                />
              </div>
            </div>

            <div className="space-y-4 pt-1">
              {progressionAndLoadFocus.loadFocusBuckets.map((b) => (
                <div key={b.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {b.label}
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-600 dark:text-slate-300 font-bold">
                        {b.loadPts} Load ({b.pct}%)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          b.status === 'Optimal Target'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                  </div>

                  <div className="relative h-4 w-full rounded-lg bg-slate-200/75 dark:bg-slate-800/90 overflow-hidden">
                    {/* Filled Load Bar */}
                    <div
                      style={{
                        width: `${Math.min(100, b.pct)}%`,
                        backgroundColor: b.color,
                      }}
                      className="h-full rounded-lg transition-all"
                    />
                    {/* Dashed Optimal Target Tunnel Overlay */}
                    <div
                      style={{
                        left: `${b.optimalMinPct}%`,
                        width: `${b.optimalMaxPct - b.optimalMinPct}%`,
                      }}
                      className="absolute top-0.5 bottom-0.5 border-2 border-dashed border-slate-900/70 dark:border-white/80 rounded-xs pointer-events-none"
                      title={`Optimal Target Tunnel: ${b.optimalMinPct}% – ${b.optimalMaxPct}%`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Dashed box = Optimal Target Range</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
              Rolling 28-Day Window
            </span>
          </div>
        </section>
      </div>

      {/* ==========================================================================
          MODULE D: SEASONAL PEAK POWER & PACE PERSONAL RECORDS TROPHY MATRIX
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              All-Time vs. 2026 Season vs. Last 90 Days
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-500" />
              <span>Personal Records &amp; Peak Efforts</span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenOfficialRaceModal && (
              <button
                type="button"
                onClick={onOpenOfficialRaceModal}
                className="min-h-[34px] px-3 py-1 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Official Race</span>
              </button>
            )}
            <div className="flex items-center gap-1 p-1 rounded-xl liquid-capsule-track text-xs font-semibold">
              {(
                [
                  { id: 'TrackFAT', label: 'Track PRs (0.01s)' },
                  { id: 'Running', label: 'Road & Endurance PRs' },
                  { id: 'Cycling', label: 'Cycling Peak Power' },
                ] as const
              ).map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => setPrMatrixSport(sp.id)}
                  className={`px-3 py-1 rounded-lg transition-all whitespace-nowrap ${
                    prMatrixSport === sp.id
                      ? 'liquid-capsule-active text-blue-600 dark:text-sky-300'
                      : 'text-slate-500'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {prMatrixSport === 'Cycling' ? (
            <table className="w-full text-left border-collapse text-xs sm:text-sm font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-sans">
                  <th className="py-2.5 pr-4">Duration / Energy System</th>
                  <th className="py-2.5 px-4 text-right">All-Time Best</th>
                  <th className="py-2.5 px-4 text-right">2026 Season</th>
                  <th className="py-2.5 pl-4 text-right">Last 90 Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {seasonalPrMatrix.cyclingRows.map((r) => (
                  <tr key={r.label} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
                    <td className="py-2.5 pr-4 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {r.label}
                    </td>
                    {[r.allTime, r.season2026, r.last90d].map((cell, idx) => (
                      <td key={idx} className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={!cell.act || !onSelectActivity}
                          onClick={() => cell.act && onSelectActivity && onSelectActivity(cell.act)}
                          className="inline-flex items-center gap-1.5 hover:underline disabled:no-underline"
                        >
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {cell.watts}W
                          </span>
                          <span className="text-blue-600 dark:text-sky-400 text-xs">
                            ({cell.wkg} W/kg)
                          </span>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : prMatrixSport === 'TrackFAT' ? (
            <table className="w-full text-left border-collapse text-xs sm:text-sm font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-sans">
                  <th className="py-2.5 pr-4">Track Distance (FAT / GPS)</th>
                  <th className="py-2.5 px-4 text-right">All-Time Best</th>
                  <th className="py-2.5 px-4 text-right">2026 Season</th>
                  <th className="py-2.5 pl-4 text-right">Last 90 Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {seasonalPrMatrix.trackFatRows.map((r) => (
                  <tr key={r.label} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
                    <td className="py-2.5 pr-4 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {r.label}
                    </td>
                    {[r.allTime, r.season2026, r.last90d].map((cell, idx) => (
                      <td key={idx} className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={!cell.act || !onSelectActivity}
                          onClick={() => cell.act && onSelectActivity && onSelectActivity(cell.act)}
                          className="inline-flex flex-col items-end hover:underline disabled:no-underline"
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <span
                              className={`font-bold ${
                                cell.isOfficialFat
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {cell.fatTimeStr}
                            </span>
                            <span className="text-slate-500 text-xs">({cell.pace400mStr})</span>
                          </div>
                          <span className="text-[10px] font-sans text-slate-400">
                            {cell.meetOrSource}
                          </span>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse text-xs sm:text-sm font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-sans">
                  <th className="py-2.5 pr-4">Benchmark Distance</th>
                  <th className="py-2.5 px-4 text-right">All-Time Best</th>
                  <th className="py-2.5 px-4 text-right">2026 Season</th>
                  <th className="py-2.5 pl-4 text-right">Last 90 Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {seasonalPrMatrix.runningRows.map((r) => (
                  <tr key={r.label} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/50">
                    <td className="py-2.5 pr-4 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {r.label}
                    </td>
                    {[r.allTime, r.season2026, r.last90d].map((cell, idx) => (
                      <td key={idx} className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={!cell.act || !onSelectActivity}
                          onClick={() => cell.act && onSelectActivity && onSelectActivity(cell.act)}
                          className="inline-flex items-center gap-1.5 hover:underline disabled:no-underline"
                        >
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            {cell.timeStr}
                          </span>
                          <span className="text-slate-500 text-xs">({cell.paceStr})</span>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ==========================================================================
          EXISTING SECTIONS: TOTALS & POLARIZATION, EQUIPMENT WEAR, ANNUAL MILEAGE, TARGET RACES
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Training Totals &amp; Intensity Distribution
            </span>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Training Volume &amp; 80/20 Intensity Distribution
              </h2>
              <ChartInfoTooltip
                title="3-Zone Intensity Distribution (80/20 Polarization)"
                subtitle="Autonomic Stress & Mitochondrial Volume Allocation"
                whatItMeasures="Categorizes total training time into 3 physiological intensity zones: Zone 1 Low Aerobic (<LT1 / Z1–Z2), Zone 2 Moderate 'Grey Zone' Tempo (LT1–LT2 / Z3), and Zone 3 High Intensity (>LT2 / Z4–Z6)."
                benchmarks="Polarized 80/20 Target: ~75–80% Low Aerobic (Z1–Z2), <5–10% Moderate Tempo (Z3), and ~15–20% High Intensity (Z4+)."
                liveStatus={{
                  label: `${totalsAndPolarization.distributionStyle}: ${totalsAndPolarization.lowPct}% Low · ${totalsAndPolarization.modPct}% Mod · ${totalsAndPolarization.highPct}% High`,
                  state:
                    totalsAndPolarization.lowPct >= 72
                      ? 'optimal'
                      : totalsAndPolarization.modPct >= 28
                        ? 'caution'
                        : 'neutral',
                  interpretation: `Across ${totalsAndPolarization.count} sessions (${totalsPeriod}), your distribution is classified as ${totalsAndPolarization.distributionStyle}.`,
                }}
                coachingAction="Keep easy endurance days strictly below LT1 (conversational Z1–Z2) so you arrive fresh enough to execute high-quality Z4/Z5 intervals on key workout days."
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setSelectedPolarizationSports(ALL_SPORTS_LIST)}
                className={`min-h-[32px] px-3 py-1 rounded-md font-semibold transition-colors ${
                  isAllSportsSelected
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                All Sports
              </button>
              {ALL_SPORTS_LIST.map((sp) => {
                const isSelected = !isAllSportsSelected && selectedPolarizationSports.includes(sp);
                return (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => {
                      if (isAllSportsSelected) {
                        setSelectedPolarizationSports([sp]);
                      } else {
                        togglePolarizationSport(sp);
                      }
                    }}
                    className={`min-h-[32px] px-3 py-1 rounded-md font-semibold transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {sp}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono">
              {(['28d', '90d', 'YTD', 'ALL'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setTotalsPeriod(p)}
                  className={`min-h-[32px] px-3 py-1 rounded-md transition-colors ${
                    totalsPeriod === p
                      ? 'bg-blue-600 text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {p === 'ALL' ? 'All-Time' : p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono tabular-nums">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">
              Sessions ({totalsPeriod} ·{' '}
              {isAllSportsSelected ? 'All Sports' : selectedPolarizationSports.join(' + ')})
            </div>
            <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">
              {totalsAndPolarization.count}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Moving Time</div>
            <div className="text-xl font-extrabold text-blue-600 dark:text-blue-400 mt-0.5">
              {Math.floor(totalsAndPolarization.totalSecs / 3600)}h{' '}
              {Math.round((totalsAndPolarization.totalSecs % 3600) / 60)}m
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Total Distance</div>
            <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatDistance(totalsAndPolarization.totalDistMeters, distanceUnit, 1)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Total Load (TSS)</div>
            <div className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">
              {totalsAndPolarization.totalLoad.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-xs text-slate-500 font-sans">Intensity Model</div>
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400 mt-1">
              {totalsAndPolarization.distributionStyle}
            </div>
          </div>
        </div>

        {/* 3-Zone Polarization Chart + Sport Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                3-Zone Intensity Distribution (
                {isAllSportsSelected ? 'All Sports' : selectedPolarizationSports.join(', ')})
              </div>
              <span className="text-xs font-mono text-slate-500">
                Target: ~80% Low · &lt;5% Mod · ~15–20% High
              </span>
            </div>

            <svg viewBox="0 0 520 155" className="w-full h-36">
              <text
                x={14}
                y={70}
                transform="rotate(-90 14 70)"
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-sans font-bold"
              >
                Time Share (%)
              </text>
              {[0, 25, 50, 75, 100].map((pct) => {
                const y = 112 - (pct / 100) * 92;
                return (
                  <g key={pct}>
                    <line
                      x1={48}
                      y1={y}
                      x2={502}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={42}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 text-[11px] font-mono"
                    >
                      {pct}%
                    </text>
                  </g>
                );
              })}

              {[
                {
                  label: 'Z1–Z2 Low Aerobic',
                  pct: totalsAndPolarization.lowPct,
                  hours: totalsAndPolarization.lowHours,
                  color: '#10B981',
                  x: 95,
                },
                {
                  label: 'Z3 Tempo / Grey',
                  pct: totalsAndPolarization.modPct,
                  hours: totalsAndPolarization.modHours,
                  color: '#F59E0B',
                  x: 245,
                },
                {
                  label: 'Z4+ Threshold/VO2',
                  pct: totalsAndPolarization.highPct,
                  hours: totalsAndPolarization.highHours,
                  color: '#EF4444',
                  x: 395,
                },
              ].map((bar) => {
                const h = Math.max(4, (bar.pct / 100) * 92);
                return (
                  <g key={bar.label}>
                    <rect
                      x={bar.x}
                      y={112 - h}
                      width={68}
                      height={h}
                      fill={bar.color}
                      rx={4}
                    />
                    <text
                      x={bar.x + 34}
                      y={112 - h - 6}
                      textAnchor="middle"
                      className="fill-slate-800 dark:fill-slate-100 text-[11px] font-mono font-bold"
                    >
                      {bar.pct}% ({bar.hours}h)
                    </text>
                    <text
                      x={bar.x + 34}
                      y={128}
                      textAnchor="middle"
                      className="fill-slate-600 dark:fill-slate-300 text-[11px] font-sans font-semibold"
                    >
                      {bar.label}
                    </text>
                  </g>
                );
              })}

              <text
                x={275}
                y={148}
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-sans font-bold"
              >
                Physiological Intensity Zone
              </text>
            </svg>
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
                Volume Breakdown by Sport ({totalsPeriod})
              </div>
              <div className="space-y-2.5 text-xs sm:text-sm font-mono tabular-nums">
                {totalsAndPolarization.bySport.map(([sport, stats]) => (
                  <div
                    key={sport}
                    className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0"
                  >
                    <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">
                      {sport} ({stats.count} sessions)
                    </span>
                    <div className="flex items-center gap-4 text-slate-600 dark:text-slate-300">
                      <span>{formatDuration(stats.secs)}</span>
                      <span>{formatDistance(stats.distMeters, distanceUnit, 1)}</span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">
                        {stats.load} TSS
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bike & Running Shoe Lifespan Tracker */}
      <details className="rounded-2xl liquid-glass p-4 group">
        <summary className="flex items-center justify-between cursor-pointer list-none select-none">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Gear Lifespan Tracker ({resolvedGearItems.length})
            </h2>
          </div>
          <span className="text-xs font-medium text-slate-500 group-open:rotate-180 transition-transform">
            ▾
          </span>
        </summary>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
          {resolvedGearItems.map((gear) => {
            const pctWear = Math.min(
              100,
              Math.round((gear.distanceMeters / Math.max(1, gear.maxRecommendedMeters)) * 100)
            );
            const isNearLimit = pctWear >= 85;
            return (
              <div
                key={gear.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {gear.type === 'BIKE' ? (
                      <Bike className="w-4 h-4 text-blue-500 shrink-0" />
                    ) : (
                      <Footprints className="w-4 h-4 text-emerald-500 shrink-0" />
                    )}
                    <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {gear.name}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      isNearLimit
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {pctWear}%
                  </span>
                </div>

                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    style={{ width: `${pctWear}%` }}
                    className={`h-full rounded-full ${
                      isNearLimit ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-400'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                  <span>
                    <strong className="text-slate-800 dark:text-slate-200">
                      {formatDistance(gear.distanceMeters, distanceUnit, 0)}
                    </strong>
                  </span>
                  <span>Max {formatDistance(gear.maxRecommendedMeters, distanceUnit, 0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* Annual Mileage Targets */}
      <section className="rounded-2xl liquid-glass p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            2026 Annual Mileage Targets
          </h2>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'COMBINED', label: 'All' },
                { id: 'OUTDOOR', label: 'Outdoor' },
                { id: 'INDOOR', label: 'Indoor' },
              ] as const
            ).map((env) => (
              <button
                key={env.id}
                onClick={() => onSelectEnvFilter(env.id)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  envFilter === env.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Running 2026 YTD ({ytd2026Counts.runTotal} Runs)
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Combined 2026 YTD:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {formatDistance(runSummary.combinedTotalMeters, distanceUnit, 1)}
                  </strong>
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {runSummary.pctOfAnnualTarget}% of Annual Goal
              </span>
            </div>

            <form onSubmit={handleSaveRunGoal} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  2026 Running Target ({distanceUnit})
                </label>
                <input
                  type="number"
                  min={10}
                  max={25000}
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                Update Run Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Outdoor ({ytd2026Counts.runOutdoor})
                </span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(runSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Treadmill ({ytd2026Counts.runIndoor})
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(runSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(runSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Cycling 2026 YTD ({ytd2026Counts.bikeTotal} Rides)
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Combined 2026 YTD:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {formatDistance(bikeSummary.combinedTotalMeters, distanceUnit, 1)}
                  </strong>
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {bikeSummary.pctOfAnnualTarget}% of Annual Goal
              </span>
            </div>

            <form onSubmit={handleSaveBikeGoal} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  2026 Cycling Target ({distanceUnit})
                </label>
                <input
                  type="number"
                  min={50}
                  max={100000}
                  value={bikeInput}
                  onChange={(e) => setBikeInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                Update Bike Target
              </button>
            </form>

            <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Outdoor ({ytd2026Counts.bikeOutdoor})
                </span>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {formatDistance(bikeSummary.outdoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">
                  Trainer ({ytd2026Counts.bikeIndoor})
                </span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDistance(bikeSummary.indoorMeters, distanceUnit, 1)}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 p-3">
                <span className="text-slate-500 block font-sans">Req. Weekly Pace</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatDistance(bikeSummary.requiredWeeklyMetersRemaining, distanceUnit, 1)}/wk
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                    <button
                      onClick={() => onDeleteTargetGoal(goal.id)}
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500"
                      aria-label={`Remove ${goal.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
              <label className="block text-xs text-slate-500 mb-1">Event / Goal Name</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Sub-20:00 5K or 350W FTP"
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Sport</label>
              <select
                value={newSport}
                onChange={(e) => setNewSport(e.target.value as SportCategory)}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="Running">Running</option>
                <option value="Cycling">Cycling</option>
                <option value="Multisport">Multisport</option>
                <option value="Swimming">Swimming</option>
                <option value="Strength">Strength</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Priority</label>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as 'A-Race' | 'B-Race' | 'Milestone')}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="A-Race">A-Race</option>
                <option value="B-Race">B-Race</option>
                <option value="Milestone">Milestone</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Target Date</label>
              <input
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Target Value &amp; Unit</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={newTargetVal}
                  onChange={(e) => setNewTargetVal(e.target.value)}
                  className="w-16 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
                <select
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  className="flex-1 min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
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
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional notes (e.g. target pacing strategy, nutrition, climb VAM)..."
              className="flex-1 min-w-[220px] min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Goal</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
