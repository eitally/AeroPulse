import React, { Suspense, lazy, useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  ConnectedAthleteRecord,
  CrossTrainingModality,
  DistanceUnit,
  PlannedWorkoutEvent,
  SessionCheckInRecord,
  SportCategory,
  StudentAthleteCheckIn,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  FourteenDayReadinessLedger,
  getIntervalsFormZone,
} from './FourteenDayReadinessLedger';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import {
  AcwrThreeChannelBullets,
  SpikeBudgetSegmentedMeter,
} from './charts/MicroGraphics';
import { ReadinessMorphingCard } from './ReadinessMorphingCard';
import { CircadianFirstTouchHero, type CircadianHeroMode } from './CircadianFirstTouchHero';
import { AthleteSessionCheckInCard } from './AthleteSessionCheckInCard';
import { EveningCloseoutCard } from './today/EveningCloseoutCard';
import { resolveCircadianHeroMode } from '../physiology/eveningHabitEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import type { SafetySwapEventInput } from '../physiology/sessionCheckInAndDigestEngine';
import {
  buildDayLoadSegments,
  classifyActivityGarminLoad,
  classifyGarminLoadType,
  type PMCDayPoint,
} from '../physiology/garminLoadFocus';

const UPlotPMCDashboard = lazy(() =>
  import('./charts/UPlotPMCDashboard').then((m) => ({ default: m.UPlotPMCDashboard }))
);
import { useLiveWorkoutStoreStats } from '../db/workoutStore';
import {
  computeCrossTrainingEquivalence,
  computeDualSportPmcSeries,
  evaluateOrthopedicInterference,
  evaluatePlannedVsCompletedCompliance,
  evaluateStudentAthleteGuardrail,
  generateWeeklyTrainingGitDiff,
} from '../physiology';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import {
  BANISTER_ATL_DECAY,
  BANISTER_CTL_DECAY,
  shiftIsoDate,
} from '../physiology/stravaLoadCalibration';
import {
  formatMorphRunLabel,
  formatOrthoChannelLabel,
} from '../utils/plainLanguage';

interface FitnessHealthViewProps {
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  activities?: UnifiedActivity[];
  athleteProfile?: AthleteProfile;
  distanceUnit?: DistanceUnit;
  plainLanguageMode?: boolean;
  selfName?: string;
  selfProfile?: AthleteProfile;
  selfWellnessDays?: UnifiedWellnessDay[];
  connectedAthletes?: ConnectedAthleteRecord[];
  onOpenRosterModal?: () => void;
  onSelectActivity?: (activity: UnifiedActivity) => void;
  onSyncMorphedToCalendar?: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onOpenAthleteProfileModal?: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
  onQuickLogRun?: (activity: UnifiedActivity) => void;
  onOpenTracksideStopwatch?: () => void;
  sessionCheckIns?: SessionCheckInRecord[];
  onRecordSessionCheckIn?: (
    input: Omit<SessionCheckInRecord, 'id' | 'createdAt'>,
    safetySwapEvent?: SafetySwapEventInput | null
  ) => Promise<void> | void;
}

type DateRangePreset =
  | '7D'
  | '1M'
  | '42D'
  | '3M'
  | '6M'
  | '1Y'
  | '2Y'
  | 'ALL'
  | 'CUSTOM';

type MilestoneCategory =
  | 'EFTP_BREAKTHROUGH'
  | 'RACE_OR_DISTANCE_PR'
  | 'POWER_OR_BENCHMARK_PR';

interface PmcMilestone {
  category: MilestoneCategory;
  shortLabel: string;
  detailLabel: string;
  colorHex: string;
  activity?: UnifiedActivity;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatIntervalsRangeLabel(startStr: string, endStr: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return `${String(d).padStart(2, '0')} ${SHORT_MONTHS[m - 1].toUpperCase()} ${y}`;
  };
  return `${fmt(startStr)} - ${fmt(endStr)}`;
}

const FitnessHealthViewInner: React.FC<FitnessHealthViewProps> = ({
  wellnessDays,
  plannedEvents,
  activities = [],
  athleteProfile,
  distanceUnit = 'mi',
  plainLanguageMode = false,
  onSelectActivity,
  onSyncMorphedToCalendar,
  onOpenAthleteProfileModal,
  onOpenCoachWithPrompt,
  onQuickLogRun,
  onOpenTracksideStopwatch,
  sessionCheckIns = [],
  onRecordSessionCheckIn,
}) => {
  // Default to 42D (6-week microcycle) so daily load bars and acute fitness swings are immediately readable
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('42D');
  const [customStart, setCustomStart] = useState<string>(() =>
    shiftIsoDate(getLocalDateIso(), -365)
  );
  const [customEnd, setCustomEnd] = useState<string>(() => getLocalDateIso());
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState<boolean>(false);
  const [isCompactMobile, setIsCompactMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsCompactMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Forward PMC "What-If" Tapering / Build Simulator state
  const [forwardDays, setForwardDays] = useState<0 | 14 | 28 | 42>(0);
  const [simulatedDailyTss, setSimulatedDailyTss] = useState<number>(65);

  // Interactive hover state synced with uPlot PMC cursor
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const todayIso = useMemo(() => getLocalDateIso(), []);
  const hasCompletedToday = useMemo(
    () => activities.some((a) => (a.startDateLocal || '').slice(0, 10) === todayIso),
    [activities, todayIso]
  );
  const isEveningHours = resolveCircadianHeroMode({ hasCompletedToday }) === 'TONIGHT';
  const [circadianMode, setCircadianMode] = useState<CircadianHeroMode>(() =>
    hasCompletedToday ? 'POST_SESSION' : 'MORNING'
  );
  useEffect(() => {
    if (hasCompletedToday) {
      setCircadianMode((prev) => (prev === 'MORNING' ? 'POST_SESSION' : prev));
    }
  }, [hasCompletedToday]);
  const [isDuskMode, setIsDuskMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('thresh_dusk_mode') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('ap-dusk', isDuskMode);
    try {
      window.localStorage.setItem('thresh_dusk_mode', isDuskMode ? '1' : '0');
    } catch {
      // ignore storage quota errors
    }
  }, [isDuskMode]);
  const hasWellnessTelemetry = wellnessDays.length > 0;
  const [orthoSwappedToast, setOrthoSwappedToast] = useState<string | null>(null);
  const [showEmptyCheckIn, setShowEmptyCheckIn] = useState<boolean>(false);

  // Student-Athlete Check-In (Academic/Exam Stress, Shin/Metatarsal BSI, PHV Growth Plates) & Cross-Training
  const initialDailySoreness = useMemo(() => {
    try {
      const raw = window.localStorage.getItem(`thresh_daily_soreness_v1:${todayIso}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [todayIso]);
  const [isStudentCheckInOpen, setIsStudentCheckInOpen] = useState<boolean>(false);
  const [academicStress, setAcademicStress] = useState<1 | 2 | 3 | 4 | 5>(
    () => (initialDailySoreness.academicStress as 1 | 2 | 3 | 4 | 5) || 2
  );
  const [shinBoneSoreness, setShinBoneSoreness] = useState<0 | 1 | 2 | 3>(
    () => (initialDailySoreness.shinBoneSoreness as 0 | 1 | 2 | 3) || 0
  );
  const [achillesSoreness, setAchillesSoreness] = useState<0 | 1 | 2 | 3>(
    () => (initialDailySoreness.achillesSoreness as 0 | 1 | 2 | 3) || 0
  );
  const [kneeGrowthPlateSoreness, setKneeGrowthPlateSoreness] = useState<0 | 1 | 2 | 3>(
    () => (initialDailySoreness.kneeGrowthPlateSoreness as 0 | 1 | 2 | 3) || 0
  );
  const [heelApophysisSoreness, setHeelApophysisSoreness] = useState<0 | 1 | 2 | 3>(
    () => (initialDailySoreness.heelApophysisSoreness as 0 | 1 | 2 | 3) || 0
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(
        `thresh_daily_soreness_v1:${todayIso}`,
        JSON.stringify({
          academicStress,
          shinBoneSoreness,
          achillesSoreness,
          kneeGrowthPlateSoreness,
          heelApophysisSoreness,
        })
      );
    } catch {
      // ignore storage quota errors
    }
  }, [
    todayIso,
    academicStress,
    shinBoneSoreness,
    achillesSoreness,
    kneeGrowthPlateSoreness,
    heelApophysisSoreness,
  ]);
  const [crossTrainModality, setCrossTrainModality] =
    useState<CrossTrainingModality>('AQUA_JOGGING');
  const [crossTrainMins, setCrossTrainMins] = useState<number>(45);
  const [crossTrainRpe, setCrossTrainRpe] = useState<number>(6);
  const [crossTrainToast, setCrossTrainToast] = useState<string | null>(null);

  const dualSportLatest = useMemo(() => {
    if (!athleteProfile || (activities.length === 0 && wellnessDays.length === 0)) return null;
    const series = computeDualSportPmcSeries(activities, athleteProfile, 14, {
      seedWellnessDays: wellnessDays,
    });
    return series.length > 0 ? series[series.length - 1] : null;
  }, [activities, athleteProfile, wellnessDays]);

  const isMinorAthleteContext = useMemo(() => {
    if (!athleteProfile) return false;
    if (athleteProfile.birthMonthYear) {
      return resolveAthleteAgeTier({
        birthMonthYear: athleteProfile.birthMonthYear,
      }).isMinorU18;
    }
    return athleteProfile.academicDivision === 'HS_VARSITY';
  }, [athleteProfile]);

  const orthopedicSummary = useMemo(() => {
    if (!athleteProfile) return null;
    const todayPlanned = plannedEvents.filter((p) => (p.date || '').slice(0, 10) === todayIso);
    return evaluateOrthopedicInterference(activities, athleteProfile, todayPlanned, todayIso, {
      isMinorU18: isMinorAthleteContext,
      lowerLegSoreness: Math.max(shinBoneSoreness, achillesSoreness),
    });
  }, [activities, athleteProfile, plannedEvents, todayIso, shinBoneSoreness, achillesSoreness, isMinorAthleteContext]);

  const complianceRecords = useMemo(
    () => evaluatePlannedVsCompletedCompliance(plannedEvents, activities, todayIso),
    [plannedEvents, activities, todayIso]
  );

  const todayCompliance = useMemo(
    () => complianceRecords.find((c) => c.date === todayIso) || null,
    [complianceRecords, todayIso]
  );

  const [isGitDiffOpen, setIsGitDiffOpen] = useState<boolean>(false);
  const [gitDiffAppliedToast, setGitDiffAppliedToast] = useState<string | null>(null);

  const weeklyGitDiffProposal = useMemo(() => {
    if (!orthopedicSummary) return null;
    const latestW = wellnessDays.length > 0 ? wellnessDays[wellnessDays.length - 1] : null;
    return generateWeeklyTrainingGitDiff({
      plannedEvents,
      latestWellness: latestW,
      orthopedicSummary,
      todayIso,
    });
  }, [plannedEvents, wellnessDays, orthopedicSummary, todayIso]);

  const latestDay = wellnessDays[wellnessDays.length - 1] || {
    date: todayIso,
    ctl: 0,
    atl: 0,
    tsb: 0,
    loadRatio: 0,
    rampRate: 0,
    hrvRMSSD: 0,
    hrvBaseline7d: 0,
    hrvNormalBandLow: 0,
    hrvNormalBandHigh: 0,
    hrvStatus: 'Balanced' as const,
    restingHR: 0,
    sleepSecs: 0,
    sleepScore: 0,
    sleepQuality: 0,
    sleepDebt7dSecs: 0,
    weightKg: athleteProfile?.weightKg || 70,
    vo2MaxCycling: athleteProfile?.vo2MaxCycling || 0,
    vo2MaxRunning: athleteProfile?.vo2MaxRunning || 0,
    rideEftp: athleteProfile?.eFtp || 0,
    rideWPrime: athleteProfile?.wPrime || 0,
    ridePMax: athleteProfile?.pMax || 0,
    runEftp: athleteProfile?.runEFtp || 0,
    garminTrainingStatus: activities.length > 0 ? ('Productive' as const) : undefined,
    trainingStatusReason:
      'Sync recent workouts from Strava (or optionally connect Garmin Connect / Intervals.icu) to calibrate your Banister load curve.',
    readinessStatus: 'Optimal' as const,
    dailyLoad: 0,
  };

  // Index activities by YYYY-MM-DD so we can plot Max HR spikes, Workout/PR dots, and click-through
  const formId = useId();
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, UnifiedActivity[]>();
    for (const act of activities) {
      const d = (act.startDateLocal || '').slice(0, 10);
      if (!d) continue;
      const existing = map.get(d);
      if (existing) {
        existing.push(act);
      } else {
        map.set(d, [act]);
      }
    }
    return map;
  }, [activities]);

  // Find the most recent day with non-zero sleep & HRV
  const latestWithSleep = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].sleepSecs > 0 || wellnessDays[i].sleepScore > 0) {
        return wellnessDays[i];
      }
    }
    return latestDay;
  }, [wellnessDays, latestDay]);

  const latestWithHrv = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].hrvRMSSD > 0) {
        return wellnessDays[i];
      }
    }
    return latestDay;
  }, [wellnessDays, latestDay]);

  // Full 1-day resolution wellness series (zero downsampling so ATL spikes & TSB troughs stay crisp)
  const chartSeries = useMemo(() => {
    let filtered = wellnessDays;
    if (rangePreset === '7D') filtered = wellnessDays.slice(-7);
    else if (rangePreset === '1M') filtered = wellnessDays.slice(-30);
    else if (rangePreset === '42D') filtered = wellnessDays.slice(-42);
    else if (rangePreset === '3M') filtered = wellnessDays.slice(-90);
    else if (rangePreset === '6M') filtered = wellnessDays.slice(-180);
    else if (rangePreset === '1Y') filtered = wellnessDays.slice(-365);
    else if (rangePreset === '2Y') filtered = wellnessDays.slice(-730);
    else if (rangePreset === 'CUSTOM') {
      filtered = wellnessDays.filter(
        (w) => w.date >= customStart && w.date <= customEnd
      );
    }

    const base: (UnifiedWellnessDay & { isProjected?: boolean })[] =
      filtered.length > 0 ? [...filtered] : [latestDay];

    if (forwardDays > 0 && base.length > 0) {
      const last = base[base.length - 1];
      let curCtl = last.ctl;
      let curAtl = last.atl;
      const startDate = new Date(last.date);

      const plannedByDate = new Map<string, number>();
      for (const ev of plannedEvents) {
        const d = ev.date.slice(0, 10);
        plannedByDate.set(d, (plannedByDate.get(d) || 0) + (ev.plannedLoad || 0));
      }

      for (let d = 1; d <= forwardDays; d++) {
        const nextDate = new Date(startDate);
        nextDate.setUTCDate(nextDate.getUTCDate() + d);
        const dateStr = nextDate.toISOString().slice(0, 10);
        const dayLoad = plannedByDate.has(dateStr)
          ? plannedByDate.get(dateStr)!
          : simulatedDailyTss;

        curCtl = curCtl * BANISTER_CTL_DECAY + dayLoad * (1 - BANISTER_CTL_DECAY);
        curAtl = curAtl * BANISTER_ATL_DECAY + dayLoad * (1 - BANISTER_ATL_DECAY);
        const curTsb = curCtl - curAtl;

        base.push({
          ...last,
          date: dateStr,
          ctl: Number(curCtl.toFixed(1)),
          atl: Number(curAtl.toFixed(1)),
          tsb: Number(curTsb.toFixed(1)),
          dailyLoad: dayLoad,
          isProjected: true,
        });
      }
    }

    return base;
  }, [
    wellnessDays,
    rangePreset,
    customStart,
    customEnd,
    forwardDays,
    simulatedDailyTss,
    plannedEvents,
    latestDay,
  ]);

  // Enrich each day with Max HR and True Physiological / Race Milestones
  const enrichedSeries = useMemo(() => {
    // Pre-scan window to find fastest running pace (>= 1500m) and top cycling NP breakthroughs
    let bestRunPaceInWindow = Infinity;
    let maxRideNpInWindow = 0;
    for (const day of chartSeries) {
      const acts = activitiesByDate.get(day.date) || [];
      for (const a of acts) {
        if (
          a.sportCategory === 'Running' &&
          a.distanceMeters >= 1500 &&
          a.avgPaceSecsPerKm &&
          a.avgPaceSecsPerKm > 140 &&
          a.avgPaceSecsPerKm < bestRunPaceInWindow
        ) {
          bestRunPaceInWindow = a.avgPaceSecsPerKm;
        }
        const np = a.normalizedPower || a.avgPower || 0;
        if (a.sportCategory === 'Cycling' && np > maxRideNpInWindow) {
          maxRideNpInWindow = np;
        }
      }
    }

    return chartSeries.map((day, idx) => {
      const dayActs = activitiesByDate.get(day.date) || [];
      let maxHr = 0;
      let prCount = 0;
      for (const a of dayActs) {
        if ((a.maxHr || 0) > maxHr) maxHr = a.maxHr || 0;
        else if ((a.avgHr || 0) > maxHr) maxHr = Math.round((a.avgHr || 0) * 1.12);
        prCount += a.stravaPrCount || 0;
      }
      // Synthesize a realistic workout max HR if dailyLoad > 0 and no activity stream cached yet
      if (maxHr === 0 && day.dailyLoad > 12 && !day.isProjected) {
        const deterministicSeed =
          (day.date.charCodeAt(8) * 13 + day.date.charCodeAt(9) * 7 + idx) % 24;
        maxHr = Math.min(
          186,
          Math.max(132, Math.round(142 + day.dailyLoad * 0.22 + deterministicSeed - 10))
        );
      }

      // Detect true Milestone Performances for this day
      const milestones: PmcMilestone[] = [];
      if (!day.isProjected && idx > 0) {
        const prevDay = chartSeries[idx - 1];
        const prevRideEftp = prevDay?.rideEftp || 0;
        const currRideEftp = day.rideEftp || 0;
        const prevRunEftp = prevDay?.runEftp || 0;
        const currRunEftp = day.runEftp || 0;

        // 1. New Cycling or Running eFTP Breakthrough Increase
        if (prevRideEftp > 0 && currRideEftp - prevRideEftp >= 2) {
          const delta = Math.round(currRideEftp - prevRideEftp);
          milestones.push({
            category: 'EFTP_BREAKTHROUGH',
            shortLabel: `eFTP ${currRideEftp}W (+${delta}W)`,
            detailLabel: `New Cycling eFTP Breakthrough: ${currRideEftp}W (+${delta}W)`,
            colorHex: '#F97316',
            activity: dayActs.find((a) => a.sportCategory === 'Cycling') || dayActs[0],
          });
        } else if (prevRunEftp > 0 && currRunEftp - prevRunEftp >= 2) {
          const delta = Math.round(currRunEftp - prevRunEftp);
          milestones.push({
            category: 'EFTP_BREAKTHROUGH',
            shortLabel: `Run eFTP ${currRunEftp}W (+${delta}W)`,
            detailLabel: `New Running eFTP Breakthrough: ${currRunEftp}W (+${delta}W)`,
            colorHex: '#F97316',
            activity: dayActs.find((a) => a.sportCategory === 'Running') || dayActs[0],
          });
        }

        // 2. Official Race Results & Running Distance PRs
        for (const a of dayActs) {
          const isOfficialRace = Boolean(a.officialRaceData);
          const isNamedRaceOrTt =
            /\b(race|championship|marathon|half marathon|5k|10k|mile|1500m|3000m|5000m|time trial|\btt\b|gran fondo|criterium|crit)\b/i.test(
              a.name
            ) &&
            ((a.intensityFactor || 0) >= 0.86 || (a.trainingLoad || 0) >= 85 || isOfficialRace);
          const isWindowFastestRun =
            a.sportCategory === 'Running' &&
            a.distanceMeters >= 1500 &&
            a.avgPaceSecsPerKm !== undefined &&
            Math.abs(a.avgPaceSecsPerKm - bestRunPaceInWindow) <= 0.5;

          if (isOfficialRace || isNamedRaceOrTt || isWindowFastestRun) {
            const raceLabel = a.officialRaceData
              ? `Official Race (${a.officialRaceData.eventLabel}: ${a.officialRaceData.displayFatTime})`
              : isWindowFastestRun
                ? `Running PR Pace: ${a.name}`
                : `Race / TT Milestone: ${a.name}`;
            milestones.push({
              category: 'RACE_OR_DISTANCE_PR',
              shortLabel: a.officialRaceData
                ? `${a.officialRaceData.eventLabel} Race`
                : 'Race / Run PR',
              detailLabel: raceLabel,
              colorHex: '#F59E0B',
              activity: a,
            });
            break;
          }
        }

        // 3. Power Curve Peak or Major Benchmark Segment PR
        for (const a of dayActs) {
          const np = a.normalizedPower || a.avgPower || 0;
          const hasGoldBenchmarkSeg =
            Array.isArray(a.segmentEfforts) &&
            a.segmentEfforts.some((s) => s.prRank === 1 && s.elapsedTimeSecs >= 90);
          const isWindowPeakPower =
            a.sportCategory === 'Cycling' &&
            maxRideNpInWindow >= 240 &&
            np >= maxRideNpInWindow * 0.96 &&
            (a.intensityFactor || 0) >= 0.88;
          const isHighIntensityMultiPr =
            (a.stravaPrCount || 0) >= 2 &&
            ((a.intensityFactor || 0) >= 0.88 || (a.trainingLoad || 0) >= 95);

          if (hasGoldBenchmarkSeg || isWindowPeakPower || isHighIntensityMultiPr) {
            const segName = a.segmentEfforts?.find((s) => s.prRank === 1)?.name;
            milestones.push({
              category: 'POWER_OR_BENCHMARK_PR',
              shortLabel: np > 0 ? `Peak ${np}W NP` : 'Benchmark PR',
              detailLabel: segName
                ? `Benchmark Segment Gold PR: ${segName}${np ? ` (${np}W NP)` : ''}`
                : np > 0
                  ? `Peak Power Output: ${a.name} (${np}W NP · ${a.stravaPrCount || 1} PRs)`
                  : `Major Segment PR: ${a.name} (${a.stravaPrCount || 1} PRs)`,
              colorHex: '#EC4899',
              activity: a,
            });
            break;
          }
        }
      }

      const prev7 = idx >= 7 ? chartSeries[idx - 7] : chartSeries[0];
      const computedRamp =
        typeof day.rampRate === 'number' && day.rampRate !== 0
          ? Number(day.rampRate.toFixed(1))
          : Number((day.ctl - (prev7?.ctl ?? day.ctl)).toFixed(1));
      const classifyOpts = {
        ftp: day.rideEftp || athleteProfile?.ftp || 300,
        lthr: athleteProfile?.lthr || 168,
        maxHr: athleteProfile?.maxHr || 190,
        thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 245,
      };
      const activitySegments = buildDayLoadSegments(
        dayActs,
        day.dailyLoad || 0,
        day.date,
        classifyOpts
      );
      const garminFocus = classifyGarminLoadType(
        dayActs,
        day.dailyLoad || 0,
        maxHr,
        classifyOpts
      );

      return {
        ...day,
        rampRate: computedRamp,
        garminFocus,
        activitySegments,
        dayActivities: dayActs,
        maxHr,
        prCount,
        milestones,
      };
    });
  }, [chartSeries, activitiesByDate, athleteProfile]);

  const dexieStats = useLiveWorkoutStoreStats();

  const echartsTimeline: PMCDayPoint[] = useMemo(() => {
    return enrichedSeries.map((d) => ({
      date: d.date,
      ctl: d.ctl,
      atl: d.atl,
      tsb: d.tsb,
      tss: d.dailyLoad || 0,
      eftp: d.rideEftp || d.runEftp || athleteProfile?.ftp || 310,
      rampRate: d.rampRate || 0,
      activities: d.dayActivities.map((a) => ({
        ...a,
        type: a.sportCategory,
        start_date: a.startDateLocal,
        distance: a.distanceMeters,
        moving_time: a.movingTimeSecs,
        tss: a.trainingLoad,
      })),
      wellness: d,
    }));
  }, [enrichedSeries, athleteProfile?.ftp]);

  const handleEChartsSelectDate = useCallback(
    (dateStr: string) => {
      const foundIdx = enrichedSeries.findIndex((d) => d.date === dateStr);
      if (foundIdx >= 0) setHoverIdx(foundIdx);
    },
    [enrichedSeries]
  );

  const handleEChartsSelectDateRange = useCallback((startStr: string, endStr: string) => {
    setCustomStart(startStr);
    setCustomEnd(endStr);
    setRangePreset('CUSTOM');
  }, []);

  const activeIdx =
    hoverIdx !== null && enrichedSeries[hoverIdx]
      ? hoverIdx
      : enrichedSeries.length - 1;
  const activePoint = enrichedSeries[activeIdx] || enrichedSeries[0];

  const startDateStr = enrichedSeries[0]?.date || customStart;
  const endDateStr =
    enrichedSeries[enrichedSeries.length - 1]?.date || customEnd;

  // Compute 28d vs 90d Aerobic Efficiency (EF = NP/HR) & Pa:Hr Decoupling Durability for the Coach Summary Card
  const aerobicDurabilityStats = useMemo(() => {
    const d28Cutoff = shiftIsoDate(todayIso, -28);
    const d90Cutoff = shiftIsoDate(todayIso, -90);

    const validEfActs = activities.filter(
      (a) => a.efficiencyFactor && a.efficiencyFactor > 0.7 && a.efficiencyFactor < 3.2
    );
    const ef28List = validEfActs
      .filter((a) => a.startDateLocal.slice(0, 10) >= d28Cutoff)
      .map((a) => a.efficiencyFactor);
    const ef90List = validEfActs
      .filter((a) => a.startDateLocal.slice(0, 10) >= d90Cutoff)
      .map((a) => a.efficiencyFactor);

    const avgEf28 =
      ef28List.length > 0
        ? Number((ef28List.reduce((s, v) => s + v, 0) / ef28List.length).toFixed(2))
        : 0;
    const avgEf90 =
      ef90List.length > 0
        ? Number((ef90List.reduce((s, v) => s + v, 0) / ef90List.length).toFixed(2))
        : avgEf28;
    const efPctDelta =
      avgEf28 > 0 && avgEf90 > 0
        ? Number((((avgEf28 - avgEf90) / Math.max(0.1, avgEf90)) * 100).toFixed(1))
        : 0;

    const enduranceActs = activities
      .filter(
        (a) =>
          a.movingTimeSecs >= 2700 &&
          typeof a.aerobicDecouplingPct === 'number' &&
          a.aerobicDecouplingPct >= -5 &&
          a.aerobicDecouplingPct <= 20
      )
      .slice(0, 24);

    const sampleCount = Math.max(enduranceActs.length, ef28List.length);
    if (sampleCount === 0) {
      return {
        avgEf28: 0,
        avgEf90: 0,
        efPctDelta: 0,
        avgDecoupling: 0,
        durabilityState: 'optimal' as const,
        durabilityLabel: 'Awaiting Endurance Sync',
        sampleCount: 0,
      };
    }

    const avgDecoupling =
      enduranceActs.length > 0
        ? Number(
            (
              enduranceActs.reduce((s, a) => s + a.aerobicDecouplingPct, 0) /
              enduranceActs.length
            ).toFixed(1)
          )
        : 0;

    const durabilityState: 'optimal' | 'caution' | 'warning' =
      enduranceActs.length === 0 || avgDecoupling <= 3.5
        ? 'optimal'
        : avgDecoupling <= 5.0
          ? 'caution'
          : 'warning';
    const durabilityLabel =
      enduranceActs.length === 0
        ? 'EF Calibrated · Awaiting ≥45m Drift Sample'
        : avgDecoupling <= 3.5
          ? 'High Aerobic Durability (<3.5%)'
          : avgDecoupling <= 5.0
            ? 'Moderate Drift (3.5–5.0%)'
            : 'Elevated Cardiac Drift (>5.0%)';

    return {
      avgEf28,
      avgEf90,
      efPctDelta,
      avgDecoupling,
      durabilityState,
      durabilityLabel,
      sampleCount,
    };
  }, [activities]);

  const statusBadgeColor = (status?: string) => {
    switch (status) {
      case 'Peaking':
        return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30';
      case 'Productive':
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'Maintaining':
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
      case 'Recovery':
        return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30';
      case 'Strained':
      case 'Overreaching':
        return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
      default:
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    }
  };

  // Circadian 6:00 AM Hero: Morning Brief expanded by default; collapse automatically once today's workout is completed
  const todayCompletedActivities = useMemo(
    () => activitiesByDate.get(todayIso) || [],
    [activitiesByDate, todayIso]
  );

  const [isPrescriptionExpanded, setIsPrescriptionExpanded] = useState<boolean>(false);
  const inferredRxSport = useMemo<'Cycling' | 'Running'>(() => {
    const todayPlanned = plannedEvents.find(
      (ev) =>
        (ev.date || '').slice(0, 10) === todayIso &&
        (ev.sportCategory === 'Running' || ev.sportCategory === 'Cycling')
    );
    if (todayPlanned?.sportCategory === 'Running' || todayPlanned?.sportCategory === 'Cycling') {
      return todayPlanned.sportCategory;
    }
    if (athleteProfile?.primarySport === 'Running') return 'Running';
    if (athleteProfile?.primarySport === 'Cycling') return 'Cycling';
    const runCount = activities.filter((a) => a.sportCategory === 'Running').length;
    const bikeCount = activities.filter((a) => a.sportCategory === 'Cycling').length;
    return runCount > bikeCount ? 'Running' : 'Cycling';
  }, [plannedEvents, todayIso, athleteProfile?.primarySport, activities]);

  const [sharedRxSport, setSharedRxSport] = useState<'Cycling' | 'Running'>(inferredRxSport);
  const [hasManualRxSport, setHasManualRxSport] = useState<boolean>(false);

  useEffect(() => {
    if (!hasManualRxSport) {
      setSharedRxSport(inferredRxSport);
    }
  }, [inferredRxSport, hasManualRxSport]);

  const handleSharedRxSportChange = (nextSport: 'Cycling' | 'Running') => {
    setHasManualRxSport(true);
    setSharedRxSport(nextSport);
  };
  const [guardrailsBarOverride, setGuardrailsBarOverride] = useState<boolean | null>(null);
  const [orthoDrawerOverride, setOrthoDrawerOverride] = useState<boolean | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<
    Record<'pmc' | 'ledger', boolean>
  >({
    pmc: false,
    ledger: true,
  });
  const isStudentContext = Boolean(
    athleteProfile?.academicDivision && athleteProfile.academicDivision !== 'CLUB_OPEN' ||
      isMinorAthleteContext
  );

  const studentCheckIn = useMemo<StudentAthleteCheckIn>(
    () => ({
      date: todayIso,
      academicStress,
      shinMetatarsalSoreness: shinBoneSoreness,
      achillesTendonSoreness: achillesSoreness,
      kneeGrowthPlateSoreness,
      heelApophysisSoreness,
      sleepHours:
        latestWithSleep.sleepSecs > 0 ? Number((latestWithSleep.sleepSecs / 3600).toFixed(1)) : 7.4,
      ferritinNgMl: athleteProfile?.ferritinNgMl,
      energyFeel: latestDay.readinessStatus === 'Strain' ? 'FLAT' : 'NORMAL',
    }),
    [
      todayIso,
      academicStress,
      shinBoneSoreness,
      achillesSoreness,
      kneeGrowthPlateSoreness,
      heelApophysisSoreness,
      latestWithSleep.sleepSecs,
      athleteProfile?.ferritinNgMl,
      latestDay.readinessStatus,
    ]
  );

  const studentGuardrail = useMemo(
    () => evaluateStudentAthleteGuardrail(studentCheckIn),
    [studentCheckIn]
  );

  const safeSportWatchReport = useMemo(
    () =>
      evaluateSafeSportPatternWatch({
        activities,
        wellnessDays,
        checkIn: studentCheckIn,
        isMinorU18: isMinorAthleteContext,
        hasParentGuardianCc: isMinorAthleteContext,
        hasAthleticTrainer: Boolean(athleteProfile?.academicDivision),
        referenceDateIso: todayIso,
      }),
    [activities, wellnessDays, studentCheckIn, athleteProfile, isMinorAthleteContext, todayIso]
  );

  const crossTrainEquiv = useMemo(
    () =>
      computeCrossTrainingEquivalence({
        modality: crossTrainModality,
        durationMins: crossTrainMins,
        rpe: crossTrainRpe,
      }),
    [crossTrainModality, crossTrainMins, crossTrainRpe]
  );

  const toggleSection = (key: 'pmc' | 'ledger') => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const autoExpandGuardrails = Boolean(
    orthopedicSummary?.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
      studentGuardrail.status !== 'CLEARED_FULL_WORKOUT'
  );
  const isGuardrailsBarOpen =
    guardrailsBarOverride !== null
      ? guardrailsBarOverride
      : autoExpandGuardrails || isGitDiffOpen || isStudentCheckInOpen;
  const isOrthoDrawerVisible =
    isGuardrailsBarOpen &&
    (orthoDrawerOverride !== null
      ? orthoDrawerOverride
      : orthopedicSummary?.riskTier === 'HIGH_IMPACT_GUARDRAIL');

  const hasTodayOrthoBikeSwap = useMemo(
    () =>
      plannedEvents.some(
        (p) =>
          (p.date || '').slice(0, 10) === todayIso &&
          p.sportCategory === 'Cycling' &&
          p.name.toLowerCase().includes('orthopedic swap')
      ),
    [plannedEvents, todayIso]
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ==========================================================================
          0A. BI-MODAL CIRCADIAN FIRST-TOUCH HERO (Morning Wake-Up <-> Post-Session Receipt)
         ========================================================================== */}
      <CircadianFirstTouchHero
        wellnessDays={wellnessDays}
        activities={activities}
        plannedEvents={plannedEvents}
        athleteProfile={athleteProfile}
        distanceUnit={distanceUnit}
        plainLanguageMode={plainLanguageMode}
        todayCompliance={todayCompliance}
        orthopedicSummary={orthopedicSummary}
        studentGuardrail={studentGuardrail}
        isWorkbenchExpanded={isPrescriptionExpanded}
        onToggleWorkbench={() => setIsPrescriptionExpanded((prev) => !prev)}
        rxSport={sharedRxSport}
        onRxSportChange={handleSharedRxSportChange}
        mode={circadianMode}
        onModeChange={setCircadianMode}
        sessionCheckIns={sessionCheckIns}
        onRecordSessionCheckIn={onRecordSessionCheckIn}
        isDuskMode={isDuskMode}
        onToggleDuskMode={() => setIsDuskMode((prev) => !prev)}
        onSelectActivity={onSelectActivity}
        onSyncMorphedToCalendar={onSyncMorphedToCalendar}
        onOpenAthleteProfileModal={onOpenAthleteProfileModal}
        onOpenCoachWithPrompt={onOpenCoachWithPrompt}
        onQuickLogRun={onQuickLogRun}
        onOpenTracksideStopwatch={onOpenTracksideStopwatch}
      />

      {onRecordSessionCheckIn &&
        circadianMode !== 'TONIGHT' &&
        (activities.length > 0 ||
        plannedEvents.length > 0 ||
        sessionCheckIns.length > 0 ||
        showEmptyCheckIn ? (
          isEveningHours ? (
            <div className="rounded-2xl liquid-glass overflow-hidden">
              <EveningCloseoutCard
                todayIso={todayIso}
                activities={activities}
                plannedEvents={plannedEvents}
                latestWellness={latestDay}
                safeSportHideWeight={Boolean(athleteProfile?.safeSportHideWeight)}
                sessionCheckIns={sessionCheckIns}
                onRecordCheckIn={onRecordSessionCheckIn}
                isDuskMode={isDuskMode}
                onToggleDuskMode={() => setIsDuskMode((prev) => !prev)}
              />
            </div>
          ) : (
            <AthleteSessionCheckInCard
              todayIso={todayIso}
              plannedEvents={plannedEvents}
              sessionCheckIns={sessionCheckIns}
              onRecordCheckIn={onRecordSessionCheckIn}
            />
          )
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowEmptyCheckIn(true)}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-card-inset text-xs font-mono font-semibold text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-[#F4F7F4] cursor-pointer"
            >
              Log Post-Session Readiness / RPE &amp; Pain Check-In →
            </button>
          </div>
        ))}

      {/* ==========================================================================
          0B. ON-DEMAND SKYLINE INTERVAL WORKBENCH & GARMIN/.FIT EXPORT DRAWER
         ========================================================================== */}
      {isPrescriptionExpanded &&
        athleteProfile &&
        onSyncMorphedToCalendar &&
        onOpenAthleteProfileModal && (
          <ReadinessMorphingCard
            wellnessDays={wellnessDays}
            activities={activities}
            plannedEvents={plannedEvents}
            athleteProfile={athleteProfile}
            distanceUnit={distanceUnit}
            studentCheckIn={studentCheckIn}
            orthopedicSummary={orthopedicSummary ?? undefined}
            isExpanded={isPrescriptionExpanded}
            onToggleExpand={() => setIsPrescriptionExpanded((prev) => !prev)}
            sportMode={sharedRxSport}
            onSportModeChange={handleSharedRxSportChange}
            placementLabel={
              todayCompletedActivities.length > 0
                ? 'Skyline Workbench · Session Completed'
                : 'Skyline Workbench · Customize & Export'
            }
            onSyncMorphedToCalendar={onSyncMorphedToCalendar}
            onOpenAthleteProfileModal={onOpenAthleteProfileModal}
            onOpenCoachWithPrompt={onOpenCoachWithPrompt}
          />
        )}

      {/* ==========================================================================
          0C. PROGRESSIVE DISCLOSURE GUARDRAIL & SCHEDULE TOOLS (Collapsed when Clear)
         ========================================================================== */}
      {orthopedicSummary && (
        <section className="rounded-2xl liquid-glass px-3.5 py-2.5 sm:px-4 sm:py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span
                className={`px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase ${
                  orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
                  studentGuardrail.status === 'BONE_STRESS_STOP'
                    ? 'ap-status-strained'
                    : orthopedicSummary.riskTier === 'ELEVATED_IMPACT' ||
                        studentGuardrail.status !== 'CLEARED_FULL_WORKOUT'
                      ? 'ap-status-caution'
                      : 'ap-status-prime'
                }`}
              >
                {orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
                studentGuardrail.status === 'BONE_STRESS_STOP'
                  ? 'Guardrail Active'
                  : orthopedicSummary.riskTier === 'ELEVATED_IMPACT' ||
                      studentGuardrail.status !== 'CLEARED_FULL_WORKOUT'
                    ? 'Elevated Load'
                    : 'All Clear'}
              </span>
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Injury Guardrails, Cross-Training &amp; Plan vs. Actual Ledger
              </span>
              {dualSportLatest && (
                <span className="hidden lg:inline text-2xs font-mono text-slate-500 dark:text-slate-400">
                  · Run {dualSportLatest.runningCtl.toFixed(0)} / Bike {dualSportLatest.cyclingCtl.toFixed(0)} CTL
                </span>
              )}
            </div>
            <button
              type="button"
              data-testid="toggle-guardrails-tools"
              aria-expanded={isGuardrailsBarOpen}
              onClick={() => {
                const nextOpen = !isGuardrailsBarOpen;
                setGuardrailsBarOverride(nextOpen);
                if (!nextOpen) {
                  setOrthoDrawerOverride(false);
                  setIsGitDiffOpen(false);
                  setIsStudentCheckInOpen(false);
                }
              }}
              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-3 sm:px-2.5 py-1 rounded-xl liquid-capsule-track text-2xs font-mono font-semibold text-slate-700 dark:text-slate-200 hover:opacity-90 cursor-pointer"
            >
              <span>{isGuardrailsBarOpen ? 'Hide Tools' : 'Open Tools'}</span>
              {isGuardrailsBarOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              )}
            </button>
          </div>

          {isGuardrailsBarOpen && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
              {/* Pill 1: Dual-Sport CTL & Impact Balance */}
              <button
                type="button"
                onClick={() => setOrthoDrawerOverride(!isOrthoDrawerVisible)}
                className={`rounded-xl px-3 py-2 text-left border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isOrthoDrawerVisible
                    ? 'border-[#84CC16] bg-[#C8FF00]/15 dark:border-[#C8FF00]/55 dark:bg-[#C8FF00]/10'
                    : 'liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                        orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL'
                          ? 'ap-status-strained'
                          : orthopedicSummary.riskTier === 'ELEVATED_IMPACT'
                            ? 'ap-status-caution'
                            : 'ap-status-prime'
                      }`}
                    >
                      {orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL'
                        ? 'High Impact'
                        : orthopedicSummary.riskTier === 'ELEVATED_IMPACT'
                          ? 'Elevated'
                          : 'Balanced'}
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Impact &amp; Run/Bike Load
                    </span>
                  </div>
                  <div className="mt-0.5 text-2xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {dualSportLatest
                      ? `Bike ${dualSportLatest.cyclingCtl.toFixed(0)} · Run ${dualSportLatest.runningCtl.toFixed(0)} CTL · Impact ${orthopedicSummary.impactAcwr.toFixed(2)}x`
                      : `Impact Ratio ${orthopedicSummary.impactAcwr.toFixed(2)}x · Torque ${orthopedicSummary.torqueAcwr.toFixed(2)}x`}
                  </div>
                </div>
                {isOrthoDrawerVisible ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                )}
              </button>

              {/* Pill 2: Plan vs. Actual Ledger */}
              {weeklyGitDiffProposal && (
                <button
                  type="button"
                  onClick={() => setIsGitDiffOpen((prev) => !prev)}
                  className={`rounded-xl px-3 py-2 text-left border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                    isGitDiffOpen
                      ? 'border-[#84CC16] bg-[#C8FF00]/15 dark:border-[#C8FF00]/55 dark:bg-[#C8FF00]/10'
                      : 'liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/40'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="ap-status-info px-1.5 py-0.5 rounded text-2xs font-mono font-bold uppercase">
                        7-Day Plan
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        Plan vs. Actual Ledger
                      </span>
                    </div>
                    <div className="mt-0.5 text-2xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                      Load{' '}
                      {weeklyGitDiffProposal.netTssDelta >= 0
                        ? `+${weeklyGitDiffProposal.netTssDelta}`
                        : weeklyGitDiffProposal.netTssDelta}{' '}
                      TSS · Form{' '}
                      {weeklyGitDiffProposal.netTsbDelta >= 0
                        ? `+${weeklyGitDiffProposal.netTsbDelta}`
                        : weeklyGitDiffProposal.netTsbDelta}
                    </div>
                  </div>
                  {isGitDiffOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                  )}
                </button>
              )}

              {/* Pill 3: Soreness Check-In & Cross-Training */}
              <button
                type="button"
                onClick={() => setIsStudentCheckInOpen((prev) => !prev)}
                className={`rounded-xl px-3 py-2 text-left border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isStudentCheckInOpen ||
                  studentGuardrail.status !== 'CLEARED_FULL_WORKOUT'
                    ? 'border-[#84CC16] bg-[#C8FF00]/15 dark:border-[#C8FF00]/55 dark:bg-[#C8FF00]/10'
                    : 'liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                        studentGuardrail.status === 'BONE_STRESS_STOP'
                          ? 'ap-status-strained'
                          : studentGuardrail.status === 'CLEARED_FULL_WORKOUT'
                            ? 'ap-status-prime'
                            : 'ap-status-caution'
                      }`}
                    >
                      {studentGuardrail.status === 'BONE_STRESS_STOP'
                        ? 'Rest Run'
                        : studentGuardrail.status === 'CLEARED_FULL_WORKOUT'
                          ? 'Cleared'
                          : 'Adjusted'}
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Soreness &amp; Cross-Training
                    </span>
                  </div>
                  <div className="mt-0.5 text-2xs font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {studentGuardrail.headline}
                  </div>
                </div>
                {isStudentCheckInOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
                )}
              </button>
            </div>
          )}

          {/* Expandable Drawer 1: 3-Channel Orthopedic Interference & Run->Bike Swap */}
          {isOrthoDrawerVisible && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                  {orthopedicSummary.guardrailHeadline}
                </h3>
                {dualSportLatest && (
                  <div className="flex flex-wrap items-center gap-1.5 text-2xs font-mono tabular-nums">
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track text-slate-700 dark:text-slate-200 font-semibold">
                      Systemic CTL {dualSportLatest.systemicCtl.toFixed(1)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track ap-ink-sky font-semibold">
                      Bike CTL {dualSportLatest.cyclingCtl.toFixed(1)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track ap-ink-teal font-semibold">
                      Run CTL {dualSportLatest.runningCtl.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {formatOrthoChannelLabel(1, plainLanguageMode)}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.centralAutonomicLoad7d} TSS
                    </span>
                    <span className="text-xs font-semibold ap-ink-sky">
                      {orthopedicSummary.centralAcwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                </div>

                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {formatOrthoChannelLabel(2, plainLanguageMode)}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.eccentricImpactLoad7d} pts
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        orthopedicSummary.impactAcwr >= 1.32
                          ? 'ap-ink-vermilion'
                          : orthopedicSummary.impactAcwr >= 1.18
                            ? 'ap-ink-amber'
                            : 'ap-ink-teal'
                      }`}
                    >
                      {orthopedicSummary.impactAcwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                </div>

                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {formatOrthoChannelLabel(3, plainLanguageMode)}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.concentricTorqueLoad7d} pts
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                      {orthopedicSummary.torqueAcwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                </div>

                <div
                  data-testid="ortho-spike-budget-tile"
                  className="rounded-xl liquid-glass-subtle px-3.5 py-2.5"
                >
                  <div className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    4. Spiked-Meter &amp; Curve Budget
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.spikedMeters7d}/{orthopedicSummary.spikedMetersWeeklyCap}m
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        orthopedicSummary.trainerOnly48hLockActive
                          ? 'ap-ink-rose'
                          : orthopedicSummary.spikeGuardrailStatus === 'SPIKE_CAP_WARNING'
                            ? 'ap-ink-amber'
                            : 'ap-ink-teal'
                      }`}
                    >
                      {orthopedicSummary.trainerOnly48hLockActive
                        ? '48h Lock'
                        : `${orthopedicSummary.spikeAcwr.toFixed(2)}x Spike`}
                    </span>
                  </div>
                  <SpikeBudgetSegmentedMeter
                    usedMeters={orthopedicSummary.spikedMeters7d}
                    capMeters={orthopedicSummary.spikedMetersWeeklyCap}
                  />
                </div>
              </div>

              <AcwrThreeChannelBullets
                cardioAcwr={orthopedicSummary.centralAcwr}
                impactAcwr={orthopedicSummary.impactAcwr}
                torqueAcwr={orthopedicSummary.torqueAcwr}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-[240px]">
                  {orthopedicSummary.guardrailRecommendation}
                </p>

                {onSyncMorphedToCalendar &&
                  !hasTodayOrthoBikeSwap &&
                  (orthopedicSummary.canMorphTodayRunToBike ||
                    plannedEvents.some(
                      (p) =>
                        (p.date || '').slice(0, 10) === todayIso &&
                        p.sportCategory === 'Running'
                    )) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onSyncMorphedToCalendar({
                          date: todayIso,
                          name: `Orthopedic Swap: ${orthopedicSummary.suggestedBikeDurationMins}m High-Cadence Z2 Ride`,
                          sportCategory: 'Cycling',
                          environmentPreference: 'FLEXIBLE',
                          plannedDurationSecs:
                            orthopedicSummary.suggestedBikeDurationMins * 60,
                          plannedLoad: orthopedicSummary.suggestedBikeTss,
                          workoutSyntax:
                            orthopedicSummary.suggestedBikeWorkoutSyntax,
                          description:
                            'Cross-modal aerobic-equivalent ride generated by THRESH Orthopedic Interference Engine (zero tibial/Achilles impact).',
                          replaceExistingDate: true,
                        });
                        setOrthoSwappedToast(
                          `Swapped today to ${orthopedicSummary.suggestedBikeDurationMins}m Zero-Impact Z2 Ride (${orthopedicSummary.suggestedBikeTss} TSS).`
                        );
                        window.setTimeout(() => setOrthoSwappedToast(null), 4500);
                      }}
                      className="ap-btn-primary px-3.5 text-xs whitespace-nowrap"
                    >
                      {formatMorphRunLabel(
                        orthopedicSummary.suggestedBikeDurationMins,
                        plainLanguageMode
                      )}
                    </button>
                  )}
              </div>

              {orthoSwappedToast && (
                <div className="rounded-xl ap-status-prime px-3 py-2 text-xs font-medium">
                  {orthoSwappedToast}
                </div>
              )}
            </div>
          )}

          {/* Expandable Drawer 2: Plan vs. Actual Ledger */}
          {isGuardrailsBarOpen && weeklyGitDiffProposal && isGitDiffOpen && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#15231B]/70 p-3.5 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {weeklyGitDiffProposal.triggerReason}
                  </span>
                </div>
                <div className="space-y-1.5 font-mono">
                  {weeklyGitDiffProposal.dayChanges.map((dayChange) => {
                    const isChanged = dayChange.changeType !== 'UNCHANGED';
                    return (
                      <div
                        key={dayChange.date}
                        className={`rounded-lg px-3 py-2 border ${
                          isChanged
                            ? 'border-blue-500/35 bg-blue-500/5 dark:bg-sky-500/10'
                            : 'border-slate-200/70 dark:border-slate-800/80'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {dayChange.dayLabel}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-2xs font-bold uppercase ${
                              dayChange.changeType === 'MODIFIED'
                                ? 'ap-status-caution'
                                : dayChange.changeType === 'SWAPPED'
                                  ? 'ap-status-info'
                                  : 'ap-status-prime'
                            }`}
                          >
                            {dayChange.changeType}
                          </span>
                        </div>
                        {isChanged ? (
                          <div className="mt-1 space-y-0.5 text-2xs">
                            <div className="text-rose-600 dark:text-rose-400 line-through">
                              - {dayChange.originalTitle} ({dayChange.originalSport} ·{' '}
                              {dayChange.originalDurationMins}m · {dayChange.originalTss} TSS)
                            </div>
                            <div className="text-emerald-700 dark:text-emerald-300 font-semibold">
                              + {dayChange.proposedTitle} ({dayChange.proposedSport} ·{' '}
                              {dayChange.proposedDurationMins}m · {dayChange.proposedTss} TSS)
                            </div>
                            <div className="font-sans text-slate-600 dark:text-slate-400 pt-0.5">
                              {dayChange.reason}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-0.5 text-2xs text-slate-600 dark:text-slate-300">
                            = {dayChange.proposedTitle} ({dayChange.proposedSport} ·{' '}
                            {dayChange.proposedDurationMins}m · {dayChange.proposedTss} TSS)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {onSyncMorphedToCalendar && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-2xs text-slate-500">
                      Commits modified/swapped sessions directly to your Training Plan calendar.
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const changed = weeklyGitDiffProposal.dayChanges.filter(
                          (d) => d.changeType !== 'UNCHANGED'
                        );
                        const targets =
                          changed.length > 0 ? changed : [weeklyGitDiffProposal.dayChanges[0]];
                        for (const item of targets) {
                          await onSyncMorphedToCalendar({
                            date: item.date,
                            name: item.proposedTitle,
                            sportCategory: item.proposedSport,
                            environmentPreference: 'FLEXIBLE',
                            plannedDurationSecs: item.proposedDurationMins * 60,
                            plannedLoad: item.proposedTss,
                            workoutSyntax:
                              item.proposedWorkoutSyntax ||
                              `Warmup\n- 10m 55%-68%\n\nMain Set\n- ${Math.max(
                                15,
                                item.proposedDurationMins - 20
                              )}m 72%-82%\n\nCooldown\n- 10m 50%-60%`,
                            description: item.reason,
                            replaceExistingDate: true,
                          });
                        }
                        setGitDiffAppliedToast(
                          `Committed ${targets.length} weekly schedule adjustment${
                            targets.length === 1 ? '' : 's'
                          } to your Training Plan.`
                        );
                        window.setTimeout(() => setGitDiffAppliedToast(null), 4500);
                      }}
                      className="ap-btn-primary px-3.5 text-xs cursor-pointer"
                    >
                      Apply Adjustments to Plan
                    </button>
                  </div>
                )}

                {gitDiffAppliedToast && (
                  <div className="rounded-lg ap-status-prime px-3 py-1.5 text-xs font-medium">
                    {gitDiffAppliedToast}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expandable Drawer 3: Scholastic / Collegiate Student-Athlete Check-In & Cross-Training Equivalence */}
          {isGuardrailsBarOpen &&
            (isStudentCheckInOpen || studentGuardrail.status !== 'CLEARED_FULL_WORKOUT') && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1 text-xs">
                {/* Left 6 Cols: 5-Second Readiness & Soreness Check-In */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#15231B]/70 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {isStudentContext
                        ? '5-Second Student-Athlete Check-In'
                        : '5-Second Soreness & Life-Stress Check-In'}
                    </span>
                    <span className="px-2 py-0.5 rounded ap-status-info font-mono text-2xs font-bold">
                      Intensity Cap: {studentGuardrail.intensityScalePct}%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-academic-stress`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {isStudentContext ? 'School / Exam Stress' : 'Life / Work Stress'}
                      </label>
                      <select
                        id={`${formId}-academic-stress`}
                        value={academicStress}
                        onChange={(e) =>
                          setAcademicStress(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value={1}>
                          {isStudentContext ? '1 — Normal Classes' : '1 — Low / Routine'}
                        </option>
                        <option value={2}>
                          {isStudentContext ? '2 — Light Papers' : '2 — Manageable Week'}
                        </option>
                        <option value={3}>
                          {isStudentContext ? '3 — Midterms / Labs' : '3 — Busy / Moderate'}
                        </option>
                        <option value={4}>
                          {isStudentContext ? '4 — Heavy Exams' : '4 — Heavy Workload'}
                        </option>
                        <option value={5}>
                          {isStudentContext ? '5 — Finals / All-Nighter' : '5 — Exhausted / Poor Sleep'}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-shin-pain`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Shin / Foot Bone Pain
                      </label>
                      <select
                        id={`${formId}-shin-pain`}
                        value={shinBoneSoreness}
                        onChange={(e) =>
                          setShinBoneSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Zero Pain</option>
                        <option value={1}>1 — Mild Diffuse Tightness</option>
                        <option value={2}>2 — Focal Point Tenderness</option>
                        <option value={3}>3 — Hop / Walk Pain (Stop)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-achilles-soreness`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Achilles / Calf Tendon
                      </label>
                      <select
                        id={`${formId}-achilles-soreness`}
                        value={achillesSoreness}
                        onChange={(e) =>
                          setAchillesSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Springy / Clear</option>
                        <option value={1}>1 — Morning Stiffness</option>
                        <option value={2}>2 — Pinch Soreness</option>
                        <option value={3}>3 — Sharp Load Pain</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-phv-knee`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {isStudentContext ? 'Knee Growth-Plate' : 'Front Knee Tendon'}
                      </label>
                      <select
                        id={`${formId}-phv-knee`}
                        data-testid="phv-knee-select"
                        value={kneeGrowthPlateSoreness}
                        onChange={(e) =>
                          setKneeGrowthPlateSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Pain-Free</option>
                        <option value={1}>1 — Post-Jump Tightness</option>
                        <option value={2}>2 — Tender Kneecap / Bump</option>
                        <option value={3}>3 — Pause Jumps &amp; Spikes</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-phv-heel`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {isStudentContext ? 'Heel Growth-Plate' : 'Heel / Plantar Soreness'}
                      </label>
                      <select
                        id={`${formId}-phv-heel`}
                        data-testid="phv-heel-select"
                        value={heelApophysisSoreness}
                        onChange={(e) =>
                          setHeelApophysisSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Pain-Free</option>
                        <option value={1}>1 — Warmup Soreness</option>
                        <option value={2}>2 — Squeeze Tenderness</option>
                        <option value={3}>3 — Avoid Impact</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {studentGuardrail.recommendation}
                  </p>
                </div>

                {/* Right 6 Cols: Training Room Cross-Training -> Virtual Running Miles Converter */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-[#15231B]/70 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Training Room Cross-Training → Virtual Miles
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-2xs font-bold tabular-nums">
                      ≈{' '}
                      {distanceUnit === 'km'
                        ? `${crossTrainEquiv.equivalentRunKm} virtual km`
                        : `${crossTrainEquiv.equivalentRunMiles} virtual mi`}{' '}
                      · {crossTrainEquiv.estimatedSystemicTss} TSS ({crossTrainEquiv.impactLoadSavedPct}% impact saved)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-modality`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Modality
                      </label>
                      <select
                        id={`${formId}-crosstrain-modality`}
                        value={crossTrainModality}
                        onChange={(e) =>
                          setCrossTrainModality(e.target.value as CrossTrainingModality)
                        }
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      >
                        <option value="AQUA_JOGGING">Aqua Jogging</option>
                        <option value="ALTER_G">AlterG (75% BW)</option>
                        <option value="ELLIPTICAL">Elliptical (90+ RPM)</option>
                        <option value="ARC_TRAINER">Arc Trainer</option>
                        <option value="STATIONARY_BIKE">Spin / Smart Bike</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-mins`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Duration (min)
                      </label>
                      <input
                        id={`${formId}-crosstrain-mins`}
                        type="number"
                        min={10}
                        max={240}
                        step={5}
                        value={crossTrainMins}
                        onChange={(e) => setCrossTrainMins(Math.max(10, Number(e.target.value) || 30))}
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-rpe`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Effort RPE (1–10)
                      </label>
                      <input
                        id={`${formId}-crosstrain-rpe`}
                        type="number"
                        min={1}
                        max={10}
                        value={crossTrainRpe}
                        onChange={(e) =>
                          setCrossTrainRpe(Math.max(1, Math.min(10, Number(e.target.value) || 6)))
                        }
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-2xs text-slate-500 flex-1 min-w-[180px]">
                      {crossTrainEquiv.coachingNote} ({crossTrainEquiv.caraCountableHours}h NCAA CARA)
                    </span>
                    {onSyncMorphedToCalendar && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onSyncMorphedToCalendar({
                            date: todayIso,
                            name: `Training Room Swap: ${crossTrainEquiv.durationMins}m ${crossTrainEquiv.modalityLabel}`,
                            sportCategory:
                              crossTrainModality === 'STATIONARY_BIKE' ? 'Cycling' : 'Multisport',
                            environmentPreference: 'INDOOR',
                            plannedDurationSecs: crossTrainEquiv.durationMins * 60,
                            plannedLoad: crossTrainEquiv.estimatedSystemicTss,
                            workoutSyntax: `Warmup\n- 10m RPE 4\n\nMain Set\n- ${Math.max(
                              10,
                              crossTrainEquiv.durationMins - 15
                            )}m RPE ${crossTrainEquiv.rpe}\n\nCooldown\n- 5m RPE 3`,
                            description: `${crossTrainEquiv.coachingNote} Equivalent to ${crossTrainEquiv.equivalentRunMiles} virtual running miles (${crossTrainEquiv.impactLoadSavedPct}% bone-impact reduction).`,
                            replaceExistingDate: true,
                          });
                          setCrossTrainToast(
                            `Scheduled ${crossTrainEquiv.durationMins}m ${crossTrainEquiv.modalityLabel} (≈ ${crossTrainEquiv.equivalentRunMiles} virtual mi · ${crossTrainEquiv.estimatedSystemicTss} TSS) for ${todayIso}.`
                          );
                          window.setTimeout(() => setCrossTrainToast(null), 4000);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] font-semibold text-xs whitespace-nowrap"
                      >
                        Schedule Cross-Training Swap
                      </button>
                    )}
                  </div>

                  {crossTrainToast && (
                    <div className="rounded-lg ap-status-prime px-2.5 py-1.5 text-2xs font-medium">
                      {crossTrainToast}
                    </div>
                  )}
                </div>
              </div>

              {/* Zero-Weight Longitudinal Energy, Iron & Growth-Plate Watch (TRK-12) */}
              <div
                data-testid="safesport-pattern-watch-card"
                className="rounded-xl ap-card-inset p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase ${
                        safeSportWatchReport.trafficLight === 'RED_MEDICAL_REVIEW'
                          ? 'ap-status-strained'
                          : safeSportWatchReport.trafficLight === 'AMBER_WATCH'
                            ? 'ap-status-caution'
                            : 'ap-status-prime'
                      }`}
                    >
                      {safeSportWatchReport.trafficLight === 'RED_MEDICAL_REVIEW'
                        ? 'Medical / AT Review'
                        : safeSportWatchReport.trafficLight === 'AMBER_WATCH'
                          ? 'Pattern Watch'
                          : 'Zero-Weight Clear'}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      Longitudinal Energy, Iron &amp; Growth-Plate Watch ({safeSportWatchReport.windowRecentDays}d vs{' '}
                      {safeSportWatchReport.windowBaselineDays}d)
                    </span>
                  </div>
                  <span className="font-mono text-2xs text-slate-600 dark:text-slate-300">
                    {safeSportWatchReport.medicalRoutingSummary}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-2xs tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-[#101B15]/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">Easy HR Drift</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaEasyHrBpm !== null
                        ? `${safeSportWatchReport.deltaEasyHrBpm >= 0 ? '+' : ''}${safeSportWatchReport.deltaEasyHrBpm} bpm`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-[#101B15]/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">Efficiency (EF)</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaEfficiencyFactorPct !== null
                        ? `${safeSportWatchReport.deltaEfficiencyFactorPct >= 0 ? '+' : ''}${safeSportWatchReport.deltaEfficiencyFactorPct}%`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-[#101B15]/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">60s HR Recovery</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaHrr60Bpm !== null
                        ? `${safeSportWatchReport.deltaHrr60Bpm >= 0 ? '+' : ''}${safeSportWatchReport.deltaHrr60Bpm} bpm`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-[#101B15]/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">Ferritin / PHV</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.phvGrowthPlateFlag
                        ? 'PHV Protection'
                        : safeSportWatchReport.ferritinStatus === 'DEPLETED_UNDER_30'
                          ? 'Ferritin < 30'
                          : safeSportWatchReport.ferritinStatus === 'SUBOPTIMAL_30_50'
                            ? 'Ferritin 30–49'
                            : safeSportWatchReport.ferritinStatus === 'OPTIMAL'
                              ? 'Optimal >= 50'
                              : 'Zero Weight Logged'}
                    </div>
                  </div>
                </div>

                <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {safeSportWatchReport.athleteGuidance}
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ==========================================================================
          1. FITNESS (CTL), FATIGUE (ATL) & FORM (TSB) MULTI-PANE CHART
         ========================================================================== */}
      <div id="fitness-sec-pmc" className="scroll-mt-28 space-y-2">
        {collapsedSections.pmc ? (
          <div className="rounded-2xl liquid-glass px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                Fitness, Fatigue &amp; Freshness
              </span>
              <span className="text-xs font-mono text-sky-500">
                CTL {latestDay.ctl.toFixed(1)} · TSB {latestDay.tsb.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={false}
                onClick={() => toggleSection('pmc')}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl ap-pill-active text-xs font-mono font-bold flex items-center gap-1 cursor-pointer"
              >
                <span>Expand Chart</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
      <section className="rounded-2xl liquid-glass overflow-hidden">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 px-2.5 sm:px-5 py-2.5 sm:py-3 border-b border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-slate-900/40">
          {/* Left: Plain-English Title + Info Icon + Date Range Picker */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 pr-1">
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                Fitness, Fatigue &amp; Freshness
              </span>
              <ChartInfoTooltip
                title="Performance Management Chart (PMC) — CTL, ATL & TSB Form"
                subtitle="Banister Impulse-Response & Intervals.icu 5-Zone Form Model"
                whatItMeasures="Models Chronic Training Load (CTL, 42-day exponential fitness average), Acute Training Load (ATL, 7-day fatigue average), and Training Stress Balance (TSB = CTL − ATL, net freshness/form) alongside Max HR spikes, eFTP step progressions, and weekly TSS bars."
                benchmarks="Optimal Productive Training: TSB between -10 and -30 (Green). Race-Ready Freshness: TSB between +5 and +20 (Blue). Overreaching High Risk: TSB below -30 (Red) or weekly CTL ramp > 7 TSS/day/week."
                liveStatus={{
                  label: `CTL ${latestDay.ctl.toFixed(0)} · ATL ${latestDay.atl.toFixed(0)} · Form ${
                    latestDay.tsb > 0 ? `+${latestDay.tsb.toFixed(0)}` : latestDay.tsb.toFixed(0)
                  } (${getIntervalsFormZone(latestDay.tsb).label})`,
                  state:
                    latestDay.tsb < -30
                      ? 'warning'
                      : latestDay.tsb <= -10 || (latestDay.tsb >= 5 && latestDay.tsb <= 20)
                        ? 'optimal'
                        : 'neutral',
                  interpretation: `Your Form is currently in the ${getIntervalsFormZone(latestDay.tsb).label} zone with a 7-day HRV baseline of ${latestWithHrv.hrvBaseline7d}ms.`,
                }}
                coachingAction="Maintain rose Fatigue (ATL) above teal Fitness (CTL) during build blocks to keep Form in the green Optimal zone (-10 to -30), then shed ATL 10–14 days before A-races so Form rises into the blue Fresh zone (+5 to +20)."
              />
            </div>
            <div className="relative">
              <button
                type="button"
                aria-expanded={isDatePickerOpen}
                onClick={() => {
                  setIsDatePickerOpen((prev) => {
                    if (!prev) setIsCustomizeOpen(false);
                    return !prev;
                  });
                }}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/50 text-xs font-bold tracking-wide text-slate-900 dark:text-slate-100 transition-all"
              >
                <span className="font-mono">
                  {formatIntervalsRangeLabel(startDateStr, endDateStr)}
                </span>
                <Calendar className="w-3.5 h-3.5 ap-text-brand" />
              </button>

              {isDatePickerOpen && (
                <div className="absolute left-0 mt-2 z-30 w-[min(18rem,calc(100vw-2rem))] rounded-2xl liquid-glass p-4 space-y-3 text-xs shadow-2xl">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Custom Date Range
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <div>
                      <label
                        htmlFor={`${formId}-pmc-start`}
                        className="block text-2xs font-sans text-slate-500 mb-1"
                      >
                        Start Date
                      </label>
                      <input
                        id={`${formId}-pmc-start`}
                        type="date"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setRangePreset('CUSTOM');
                        }}
                        className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-[#15231B]/80 px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${formId}-pmc-end`}
                        className="block text-2xs font-sans text-slate-500 mb-1"
                      >
                        End Date
                      </label>
                      <input
                        id={`${formId}-pmc-end`}
                        type="date"
                        value={customEnd}
                        onChange={(e) => {
                          setCustomEnd(e.target.value);
                          setRangePreset('CUSTOM');
                        }}
                        className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-[#15231B]/80 px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsDatePickerOpen(false)}
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] font-semibold transition-colors"
                    >
                      Apply Range
                    </button>
                  </div>
                </div>
              )}
            </div>

            {rangePreset === 'CUSTOM' && (
              <button
                type="button"
                onClick={() => setRangePreset('1Y')}
                className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Zoom (1y)</span>
              </button>
            )}
          </div>

          {/* Center: Distilled Preset Date Switcher + Custom Trigger */}
          <div className="ap-toolbar-scroll p-1 rounded-xl liquid-capsule-track max-w-full">
            {(
              [
                { id: '7D', label: '7d' },
                { id: '42D', label: '42d' },
                { id: '3M', label: '90d' },
                { id: '1Y', label: '1y' },
                { id: 'ALL', label: 'All' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={rangePreset === p.id}
                onClick={() => setRangePreset(p.id)}
                className={`min-h-[44px] sm:min-h-[30px] px-3 sm:px-2.5 py-0.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  rangePreset === p.id
                    ? 'ap-nav-volt-active'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-expanded={isDatePickerOpen}
              onClick={() => setIsDatePickerOpen((prev) => !prev)}
              className={`min-h-[44px] sm:min-h-[30px] px-3 sm:px-2.5 py-0.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                rangePreset === 'CUSTOM' ||
                rangePreset === '1M' ||
                rangePreset === '6M' ||
                rangePreset === '2Y' ||
                isDatePickerOpen
                  ? 'ap-nav-volt-active'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Custom…
            </button>
          </div>

          {/* Right: Forward Projection + Customize Chart Popover */}
          <div className="flex flex-wrap items-center gap-2 relative min-w-0">
            <select
              value={forwardDays}
              aria-label="Project future CTL, ATL and Form"
              onChange={(e) => {
                const nextDays = Number(e.target.value) as 0 | 14 | 28 | 42;
                setForwardDays(nextDays);
                if (nextDays === 0) setIsCustomizeOpen(false);
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200"
              title="Project future CTL, ATL & Form"
            >
              <option value={0}>Projection: Off</option>
              <option value={14}>+14d Projection</option>
              <option value={28}>+28d Projection</option>
              <option value={42}>+42d Projection</option>
            </select>

            {forwardDays > 0 && (
              <button
                type="button"
                data-testid="pmc-customize-chart-btn"
                onClick={() => {
                  setIsCustomizeOpen((prev) => {
                    if (!prev) setIsDatePickerOpen(false);
                    return !prev;
                  });
                }}
                aria-expanded={isCustomizeOpen}
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl ap-btn-secondary text-xs font-bold tracking-wide transition-colors cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Projection Rate ▾</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleSection('pmc')}
              aria-expanded={true}
              aria-label="Collapse PMC Chart"
              title="Collapse PMC Chart"
              className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center px-2 py-1 rounded-xl liquid-glass-subtle text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>

            {isCustomizeOpen && forwardDays > 0 && (
              <div className="absolute right-0 top-10 z-30 w-[min(18rem,calc(100vw-2rem))] rounded-2xl liquid-glass p-4 space-y-3 text-xs shadow-2xl border border-slate-300/80 dark:border-white/15">
                <div className="font-bold text-slate-900 dark:text-slate-100 border-b border-slate-200/70 dark:border-white/10 pb-1.5 flex items-center justify-between">
                  <span>Chart Options</span>
                  <button
                    type="button"
                    onClick={() => setIsCustomizeOpen(false)}
                    className="text-2xs font-mono text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    Done
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-2xs">
                    <label htmlFor={`${formId}-sim-daily-tss`}>Simulated TSS/day:</label>
                    <span className="font-bold ap-ink-teal">
                      {simulatedDailyTss} TSS
                    </span>
                  </div>
                  <input
                    id={`${formId}-sim-daily-tss`}
                    type="range"
                    min={0}
                    max={150}
                    step={5}
                    value={simulatedDailyTss}
                    onChange={(e) =>
                      setSimulatedDailyTss(Number(e.target.value))
                    }
                    className="w-full accent-[#1C5436] dark:accent-[#C8FF00]"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomizeOpen(false);
                      onOpenCoachWithPrompt(
                        `My current Fitness (CTL) is ${latestDay.ctl}, Fatigue (ATL) is ${latestDay.atl}, Form (TSB) is ${latestDay.tsb} (${getIntervalsFormZone(latestDay.tsb).label}), Sleep Score is ${latestWithSleep.sleepScore}, and HRV is ${latestWithHrv.hrvRMSSD}ms. Analyze my fitness/fatigue trend and recommend adjustments for the coming week.`
                      );
                    }}
                    className="w-full min-h-[36px] px-3 py-1.5 rounded-xl ap-btn-pine text-xs font-semibold transition-all cursor-pointer"
                  >
                    Ask AI Coach About My PMC
                  </button>
                  <div className="flex items-center justify-between text-2xs font-mono text-emerald-600 dark:text-emerald-400 pt-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Local Cache
                    </span>
                    <span>
                      {dexieStats.activitiesCount} acts · {dexieStats.streamsCount} streams
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Daily Activities Bar (responsive wrapping on mobile, static 58px height on sm+ so desktop SVG never shifts) */}
        <div className="px-2.5 sm:px-5 py-1.5 bg-white/30 dark:bg-[#15231B]/35 border-b border-slate-200/60 dark:border-white/10 min-h-[52px] sm:h-[58px] sm:min-h-[58px] sm:max-h-[58px] overflow-hidden flex items-start justify-between gap-2 sm:gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 sm:max-h-[46px] sm:overflow-hidden flex-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900/5 dark:bg-white/10 font-mono font-bold text-slate-800 dark:text-slate-100 shrink-0">
              {activePoint.date}
            </span>
            {activePoint.dailyLoad > 0 &&
              (activePoint.activitySegments && activePoint.activitySegments.length > 1 ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-2xs font-bold border border-slate-300/70 dark:border-white/15 bg-slate-900/5 dark:bg-white/5 text-slate-700 dark:text-slate-200 shrink-0"
                  title={`Stacked Daily Load (${activePoint.dailyLoad} TSS): ${activePoint.activitySegments
                    .map((s) => `${s.activityName} (${s.load} TSS · ${s.focus.shortLabel})`)
                    .join(' + ')}`}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {activePoint.activitySegments.map((seg, sIdx) => (
                      <span
                        key={`seg-dot-${seg.activityId}-${sIdx}`}
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: seg.focus.solidColor }}
                      />
                    ))}
                  </span>
                  <span>
                    {activePoint.dailyLoad} TSS ({activePoint.activitySegments.length} acts)
                  </span>
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-2xs font-bold border shrink-0"
                  style={{
                    backgroundColor: activePoint.garminFocus.badgeBg,
                    borderColor: `${activePoint.garminFocus.solidColor}55`,
                    color: activePoint.garminFocus.solidColor,
                  }}
                  title={`Garmin Load Focus: ${activePoint.garminFocus.label}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: activePoint.garminFocus.solidColor }}
                  />
                  <span>
                    {activePoint.garminFocus.label} ({activePoint.dailyLoad} TSS)
                  </span>
                </span>
              ))}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/5 dark:bg-white/5 font-mono text-2xs text-slate-600 dark:text-slate-300 shrink-0">
              <span>Ramp:</span>
              <span
                className={`font-bold ${
                  activePoint.rampRate > 7
                    ? 'text-rose-500'
                    : activePoint.rampRate > 5
                      ? 'text-amber-500'
                      : activePoint.rampRate >= 0
                        ? 'text-emerald-500'
                        : 'text-sky-400'
                }`}
              >
                {activePoint.rampRate > 0
                  ? `+${activePoint.rampRate.toFixed(1)}`
                  : activePoint.rampRate.toFixed(1)}
                /wk
              </span>
            </span>
            {activePoint.milestones &&
              activePoint.milestones.map((ms, mIdx) => (
                <button
                  key={`ms-pill-${mIdx}`}
                  type="button"
                  onClick={() => ms.activity && onSelectActivity && onSelectActivity(ms.activity)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg font-mono text-2xs font-bold border shadow-2xs transition-transform hover:scale-[1.01] shrink-0"
                  style={{
                    backgroundColor: `${ms.colorHex}1F`,
                    borderColor: `${ms.colorHex}66`,
                    color: ms.colorHex,
                  }}
                  title="Click to inspect milestone workout streams"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: ms.colorHex }}
                  />
                  <span className="truncate max-w-[300px]">{ms.detailLabel}</span>
                </button>
              ))}
            {activePoint.dayActivities.length > 0 ? (
              activePoint.dayActivities.slice(0, 5).map((act) => {
                const segMatch = activePoint.activitySegments?.find((s) => s.activityId === act.id);
                const actFocus =
                  segMatch?.focus ||
                  classifyActivityGarminLoad(act, {
                    ftp: activePoint.rideEftp || athleteProfile?.ftp || 300,
                    lthr: athleteProfile?.lthr || 168,
                    maxHr: athleteProfile?.maxHr || 190,
                    thresholdPaceSecsPerKm: athleteProfile?.thresholdPaceSecsPerKm || 245,
                  });
                const actLoad = segMatch ? segMatch.load : Math.round(act.trainingLoad || 0);
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onSelectActivity && onSelectActivity(act)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border font-medium transition-transform hover:scale-[1.01] max-w-[300px] shrink-0"
                    style={{
                      backgroundColor: actFocus.badgeBg,
                      borderColor: `${actFocus.solidColor}55`,
                      color: actFocus.solidColor,
                    }}
                    title={`${act.name} — ${actLoad} TSS · ${actFocus.label}`}
                  >
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: actFocus.solidColor }}
                    />
                    <span className="truncate max-w-[155px] text-slate-900 dark:text-slate-100">
                      {act.name}
                    </span>
                    <span className="font-mono text-2xs font-bold shrink-0">
                      ({actLoad} TSS · {actFocus.shortLabel})
                    </span>
                  </button>
                );
              })
            ) : (
              <span className="inline-flex items-center gap-2 py-0.5 text-slate-500 dark:text-slate-400">
                <span>Rest / Recovery Day ({activePoint.dailyLoad} TSS)</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono text-2xs">
                  CTL {activePoint.ctl.toFixed(1)} · ATL {activePoint.atl.toFixed(1)} · Form{' '}
                  {activePoint.tsb > 0 ? `+${activePoint.tsb.toFixed(1)}` : activePoint.tsb.toFixed(1)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* ==========================================================================
            SINGLE CANONICAL uPLOT PERFORMANCE MANAGEMENT CHART (CTL / ATL / TSB / RAMP)
           ========================================================================== */}
        <div className="px-1 sm:px-2 lg:px-5 pt-2 sm:pt-3 pb-2">
          <Suspense
            fallback={
              <div
                className="w-full rounded-2xl liquid-glass-subtle flex items-center justify-center text-xs font-mono text-slate-600 dark:text-slate-300"
                style={{ height: `${isCompactMobile ? 380 : 390}px` }}
              >
                Loading Performance Management Chart…
              </div>
            }
          >
            <UPlotPMCDashboard
              embedded
              timeline={echartsTimeline}
              onSelectActivity={onSelectActivity}
              onSelectDate={handleEChartsSelectDate}
              onSelectDateRange={handleEChartsSelectDateRange}
              height={isCompactMobile ? 380 : 390}
            />
          </Suspense>
        </div>
      </section>
        )}
      </div>

      {/* ==========================================================================
          2. 14-DAY READINESS LEDGER & KEY BIOMETRICS
         ========================================================================== */}
      <div id="fitness-sec-ledger" className="scroll-mt-28 space-y-5">
        {collapsedSections.ledger ? (
          <div className="rounded-2xl liquid-glass px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                14-Day Readiness Ledger &amp; Key Biometrics
              </span>
              <span className="text-xs font-mono text-emerald-500">
                HRV {latestWithHrv.hrvRMSSD > 0 ? `${latestWithHrv.hrvRMSSD}ms` : '—'} · EF{' '}
                {aerobicDurabilityStats.avgEf28 > 0 ? aerobicDurabilityStats.avgEf28 : '—'}
              </span>
            </div>
            <button
              type="button"
              aria-expanded={false}
              onClick={() => toggleSection('ledger')}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-mono font-semibold flex items-center gap-1"
            >
              <span>Expand Ledger &amp; KPIs</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
      {/* ==========================================================================
          3. GRAPHIC BIOMETRIC INSTRUMENT KPI CARDS (CTL/ACWR, SLEEP RING, HRV CORRIDOR, THRESHOLD)
         ========================================================================== */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Fitness & Workload Ratio (CTL + ACWR Sweet-Spot Gauge) */}
        {(() => {
          const acwr = latestDay.loadRatio || 0.92;
          const acwrMarkerPct = Math.max(4, Math.min(96, ((acwr - 0.5) / 1.1) * 100));
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Fitness &amp; Load
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md border ${statusBadgeColor(
                    latestDay.garminTrainingStatus
                  )}`}
                >
                  {latestDay.garminTrainingStatus || 'Productive'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {latestDay.ctl.toFixed(1)}
                  </span>
                  <span className="text-xs font-sans text-slate-500 ml-1.5">CTL</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0284C7] dark:text-sky-400">
                    ACWR {acwr.toFixed(2)}x
                  </span>
                  <span className="block text-2xs text-slate-500">
                    Ramp {latestDay.rampRate && latestDay.rampRate > 0 ? `+${latestDay.rampRate}` : latestDay.rampRate || 0}/wk
                  </span>
                </div>
              </div>
              {/* Graphic ACWR Sweet-Spot Gauge Bar */}
              <div className="space-y-1 pt-0.5">
                <div className="relative h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800/90 overflow-hidden">
                  {/* Optimal 0.80 - 1.30x Sweet Spot Band */}
                  <div
                    className="absolute top-0 bottom-0 bg-emerald-500/25 border-x border-emerald-500/50"
                    style={{ left: '27%', width: '45%' }}
                  />
                  {/* High Strain Zone > 1.30x */}
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-rose-500/20"
                    style={{ width: '28%' }}
                  />
                  {/* Live Marker Dot */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0284C7] dark:bg-sky-400 ring-2 ring-white dark:ring-slate-950"
                    style={{ left: `${acwrMarkerPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-600 dark:text-slate-400">
                  <span>0.5x</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Optimal 0.8–1.3x</span>
                  <span>1.6x</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 2: Overnight Sleep Score Radial Ring + Target Duration Bar (Zero Synthetic Stages) */}
        {(() => {
          const hasSleep = latestWithSleep.sleepSecs > 0 || latestWithSleep.sleepScore > 0;
          const score = hasSleep ? Math.max(0, Math.min(100, latestWithSleep.sleepScore || 0)) : 0;
          const sleepHrs = (latestWithSleep.sleepSecs || 0) / 3600;
          const targetPct = Math.min(100, Math.round((sleepHrs / 8.0) * 100));
          const circumference = 2 * Math.PI * 15.5;
          const dashOffset = circumference - (score / 100) * circumference;
          const ringColor = !hasSleep
            ? '#94A3B8'
            : score >= 80
              ? '#0D9488'
              : score >= 68
                ? '#0284C7'
                : '#D97706';
          return (
            <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Overnight Sleep
                  </span>
                  <span className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                    {hasSleep ? `${((latestWithSleep.sleepDebt7dSecs || 0) / 3600).toFixed(1)}h debt` : 'Unsynced'}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {hasSleep && sleepHrs > 0 ? sleepHrs.toFixed(1) : '—'}
                  </span>
                  <span className="text-xs text-slate-500">hrs</span>
                </div>
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full overflow-hidden flex bg-stone-200/80 dark:bg-slate-800">
                    <div
                      className="bg-[#0284C7] dark:bg-[#60A5FA] transition-all"
                      style={{ width: `${targetPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                    <span>{hasSleep ? `${targetPct}% of 8.0h target` : 'Connect Garmin / Intervals'}</span>
                    <span>{score > 0 ? `Score ${score}` : ''}</span>
                  </div>
                </div>
              </div>

              {/* Circular Radial Score Gauge */}
              <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                <svg className="w-14 h-14 -rotate-90" viewBox="0 0 38 38">
                  <circle
                    cx="19"
                    cy="19"
                    r="15.5"
                    fill="none"
                    stroke="currentColor"
                    className="text-stone-200 dark:text-slate-800"
                    strokeWidth="3.4"
                  />
                  <circle
                    cx="19"
                    cy="19"
                    r="15.5"
                    fill="none"
                    stroke={ringColor}
                    strokeWidth="3.4"
                    strokeDasharray={circumference.toFixed(1)}
                    strokeDashoffset={dashOffset.toFixed(1)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-center leading-none">
                  <span className="text-sm font-mono font-extrabold text-slate-900 dark:text-white">
                    {score > 0 ? score : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 3: Autonomic Recovery (HRV rMSSD + 60d Baseline Corridor Gauge) */}
        {(() => {
          const hrv = latestWithHrv.hrvRMSSD || 0;
          const hasHrv = hrv > 0;
          const low = latestWithHrv.hrvNormalBandLow || (hasHrv ? Math.round(hrv * 0.85) : 40);
          const high = latestWithHrv.hrvNormalBandHigh || (hasHrv ? Math.round(hrv * 1.15) : 70);
          const scaleMin = Math.max(15, low - 12);
          const scaleMax = high + 12;
          const span = Math.max(1, scaleMax - scaleMin);
          const bandLeft = Math.max(5, Math.min(80, ((low - scaleMin) / span) * 100));
          const bandWidth = Math.max(12, Math.min(85 - bandLeft, ((high - low) / span) * 100));
          const dotLeft = hasHrv ? Math.max(4, Math.min(96, ((hrv - scaleMin) / span) * 100)) : 50;
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  HRV &amp; RHR
                </span>
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-md ${
                    hasHrv ? 'ap-status-prime' : 'ap-well text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {hasHrv ? latestWithHrv.hrvStatus || 'Balanced' : 'Uncalibrated'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {hasHrv ? hrv : '—'}
                  </span>
                  <span className="text-xs text-slate-500 ml-1">ms</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0F766E] dark:text-[#2DD4BF]">
                    7d: {latestWithHrv.hrvBaseline7d > 0 ? `${latestWithHrv.hrvBaseline7d} ms` : '—'}
                  </span>
                  <span className="block text-2xs text-slate-500">
                    RHR {latestDay.restingHR > 0 ? `${latestDay.restingHR} bpm` : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 pt-0.5">
                <div className="relative h-2 w-full rounded-full bg-stone-200/80 dark:bg-slate-800/90">
                  {hasHrv && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 rounded-full bg-[#0D9488]/30 border border-[#0D9488]/60"
                        style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0D9488] ring-2 ring-white dark:ring-slate-950"
                        style={{ left: `${dotLeft}%` }}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                  <span>{hasHrv ? `Floor ${low}ms` : 'Sync nocturnal HRV'}</span>
                  <span>{hasHrv ? `Ceiling ${high}ms` : ''}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card 4: Dual-Sport Threshold Power (Bike & Run eFTP + W' Gauge) */}
        {(() => {
          const bikeEftp = latestDay.rideEftp || athleteProfile?.eFtp || athleteProfile?.ftp || 0;
          const runEftp = latestDay.runEftp || athleteProfile?.runEFtp || athleteProfile?.runFtp || 0;
          const rawWPrime = latestDay.rideWPrime || athleteProfile?.wPrime || 0;
          const wPrimeKj = rawWPrime > 0 ? Number((rawWPrime / 1000).toFixed(1)) : 0;
          const wPrimePct = wPrimeKj > 0 ? Math.max(10, Math.min(100, Math.round((wPrimeKj / 32) * 100))) : 0;
          const pMaxVal = latestDay.ridePMax || athleteProfile?.pMax || 0;
          return (
            <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  THRESH · eFTP
                </span>
                <span className="text-xs font-mono text-[#EA580C] dark:text-orange-400 font-bold">
                  {athleteProfile?.safeSportHideWeight
                    ? 'Safe-Sport Shield'
                    : bikeEftp > 0 && (latestDay.weightKg || athleteProfile?.weightKg || 0) > 0
                      ? `${(bikeEftp / Math.max(35, latestDay.weightKg || athleteProfile?.weightKg || 0)).toFixed(2)} W/kg`
                      : bikeEftp > 0
                        ? `${bikeEftp} W`
                        : '— W/kg'}
                </span>
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <div>
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                    {bikeEftp > 0 ? `${bikeEftp}W` : '—'}
                  </span>
                  <span className="text-xs text-slate-500 ml-1">Bike</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-[#0284C7] dark:text-sky-400">
                    Run {runEftp > 0 ? `${runEftp}W` : '—'}
                  </span>
                  <span className="block text-2xs text-slate-500">
                    W&apos; {wPrimeKj > 0 ? `${wPrimeKj} kJ` : '—'} · Pmax {pMaxVal > 0 ? `${pMaxVal}W` : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 pt-0.5">
                <div className="h-2 w-full rounded-full bg-stone-200/80 dark:bg-slate-800 overflow-hidden flex gap-0.5">
                  <div
                    className="h-full bg-[#EA580C] rounded-full transition-all"
                    style={{ width: `${wPrimePct}%` }}
                  />
                </div>
                <div className="flex justify-between text-2xs font-mono text-slate-500 dark:text-slate-400">
                  <span>Anaerobic Reserve (W&apos;)</span>
                  <span className="text-[#EA580C] dark:text-orange-400 font-semibold">
                    {wPrimeKj > 0 ? `${wPrimeKj} kJ` : hasWellnessTelemetry ? '—' : 'Calibrate FTP'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      <FourteenDayReadinessLedger wellnessDays={wellnessDays} />

      {/* ==========================================================================
          4. COMPACT AEROBIC STAMINA (CARDIAC DRIFT) & EFFICIENCY BAR
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Aerobic Efficiency &amp; Drift
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold border ${
                aerobicDurabilityStats.durabilityState === 'optimal'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  : aerobicDurabilityStats.durabilityState === 'caution'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
              }`}
            >
              {aerobicDurabilityStats.durabilityLabel}
            </span>
            <ChartInfoTooltip
              title="Aerobic Efficiency Factor (EF) & Cardiac Drift (Pa:Hr%)"
              subtitle="Mitochondrial Economy & First-Half vs. Second-Half Stamina"
              whatItMeasures="Aerobic Efficiency (EF = Normalized Power ÷ Average Heart Rate) quantifies how much output your cardiovascular system produces per heartbeat. Cardiac Drift (Pa:Hr%) measures how much your efficiency fades from the first half to the second half of endurance workouts."
              benchmarks="Cardiac Drift < 3.5%: Strong aerobic stamina ready for threshold progression. 3.5% – 5.0%: Moderate drift. > 5.0%: Incomplete aerobic base or fueling/hydration depletion."
              liveStatus={{
                label: `28d EF: ${aerobicDurabilityStats.avgEf28} (${
                  aerobicDurabilityStats.efPctDelta >= 0 ? '+' : ''
                }${aerobicDurabilityStats.efPctDelta}% vs 90d) · Avg Drift: ${
                  aerobicDurabilityStats.avgDecoupling
                }%`,
                state: aerobicDurabilityStats.durabilityState,
                interpretation:
                  aerobicDurabilityStats.avgDecoupling <= 3.5
                    ? 'Your cardiac drift on endurance workouts is well below the 5% physiological threshold, confirming strong stroke-volume stability.'
                    : 'Your heart rate drifts upward relative to power in the second half of long rides/runs; prioritize Z2 duration and in-ride fueling.',
              }}
              coachingAction="When 28-day Efficiency rises and Cardiac Drift stays under 3.5%, increase Z4/Z5 interval density; if drift exceeds 5%, extend steady Z2 aerobic volume."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-xs">
            <div className="px-3 py-1.5 rounded-xl liquid-glass-subtle flex items-center gap-2">
              <span className="text-slate-500 font-sans">EF (28d):</span>
              <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                {aerobicDurabilityStats.avgEf28 > 0 ? aerobicDurabilityStats.avgEf28 : '—'}
              </span>
              {aerobicDurabilityStats.avgEf28 > 0 && (
                <span
                  className={`text-2xs font-bold ${
                    aerobicDurabilityStats.efPctDelta >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  ({aerobicDurabilityStats.efPctDelta >= 0 ? `+${aerobicDurabilityStats.efPctDelta}%` : `${aerobicDurabilityStats.efPctDelta}%`})
                </span>
              )}
            </div>

            <div className="px-3 py-1.5 rounded-xl liquid-glass-subtle flex items-center gap-2">
              <span className="text-slate-500 font-sans">Drift (Pa:Hr):</span>
              <span
                className={`text-sm font-extrabold ${
                  aerobicDurabilityStats.sampleCount === 0
                    ? 'text-slate-500 dark:text-slate-400'
                    : aerobicDurabilityStats.avgDecoupling <= 3.5
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : aerobicDurabilityStats.avgDecoupling <= 5.0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {aerobicDurabilityStats.sampleCount > 0
                  ? `${aerobicDurabilityStats.avgDecoupling}%`
                  : '—'}
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `My 28-day Aerobic Efficiency Factor (EF) is ${aerobicDurabilityStats.avgEf28} (${aerobicDurabilityStats.efPctDelta >= 0 ? '+' : ''}${aerobicDurabilityStats.efPctDelta}% vs 90-day EF of ${aerobicDurabilityStats.avgEf90}) and my average endurance cardiac drift (Pa:Hr decoupling) is ${aerobicDurabilityStats.avgDecoupling}%. Based on my current CTL (${latestDay.ctl}) and HRV (${latestWithHrv.hrvRMSSD}ms), should I focus on extending Z2 aerobic durability or progressing Z4 threshold intervals this week?`
                )
              }
              className="min-h-[32px] px-3 py-1.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-sans text-xs font-semibold shadow-sm transition-all"
            >
              Ask Coach: Stamina Rx
            </button>
          </div>
        </div>
      </section>
          </>
        )}
      </div>

    </div>
  );
};

export const FitnessHealthView = React.memo(FitnessHealthViewInner);
