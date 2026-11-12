import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp,
  Layers,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Users,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  ConnectedAthleteRecord,
  CrossTrainingModality,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import {
  FourteenDayReadinessLedger,
  getIntervalsFormZone,
} from './FourteenDayReadinessLedger';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { ReadinessMorphingCard } from './ReadinessMorphingCard';
import { CircadianFirstTouchHero } from './CircadianFirstTouchHero';
import { DualAthleteComparator } from './DualAthleteComparator';
import { AthletePerformanceRadar } from './AthletePerformanceRadar';
import {
  buildDayLoadSegments,
  classifyActivityGarminLoad,
  classifyGarminLoadType,
  EChartsPMCDashboard,
  PMCDayPoint,
} from './charts/EChartsPMCDashboard';
import { useLiveWorkoutStoreStats } from '../db/workoutStore';
import {
  computeCrossTrainingEquivalence,
  computeDualSportPmcSeries,
  evaluateOrthopedicInterference,
  evaluatePlannedVsCompletedCompliance,
  evaluateStudentAthleteGuardrail,
  generateWeeklyTrainingGitDiff,
} from '../physiology';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';

interface FitnessHealthViewProps {
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  activities?: UnifiedActivity[];
  athleteProfile?: AthleteProfile;
  distanceUnit?: DistanceUnit;
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

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatIntervalsRangeLabel(startStr: string, endStr: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return `${String(d).padStart(2, '0')} ${SHORT_MONTHS[m - 1].toUpperCase()} ${y}`;
  };
  return `${fmt(startStr)} - ${fmt(endStr)}`;
}

function formatGutterDate(dateStr: string): { top: string; bottom: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return { top: dateStr, bottom: '' };
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wk = SHORT_WEEKDAYS[dt.getUTCDay()];
  const mon = SHORT_MONTHS[m - 1];
  return {
    top: `${wk} ${String(d).padStart(2, '0')}`,
    bottom: mon,
  };
}

export const FitnessHealthView: React.FC<FitnessHealthViewProps> = ({
  wellnessDays,
  plannedEvents,
  activities = [],
  athleteProfile,
  distanceUnit = 'mi',
  selfName = 'Primary Athlete',
  selfProfile,
  selfWellnessDays,
  connectedAthletes = [],
  onOpenRosterModal,
  onSelectActivity,
  onSyncMorphedToCalendar,
  onOpenAthleteProfileModal,
  onOpenCoachWithPrompt,
}) => {
  // Default to 42D (6-week microcycle) so daily load bars and acute fitness swings are immediately readable
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('42D');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
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

  // Synchronized Subplots toggles
  const [showTsbSubplot, setShowTsbSubplot] = useState<boolean>(true);
  const [showRampSubplot, setShowRampSubplot] = useState<boolean>(true);
  const [showMaxHrSubplot, setShowMaxHrSubplot] = useState<boolean>(true);
  const [showEftpSubplot, setShowEftpSubplot] = useState<boolean>(true);
  const [showWeeklyLoadSubplot, setShowWeeklyLoadSubplot] = useState<boolean>(true);
  const [showHrvSubplot, setShowHrvSubplot] = useState<boolean>(true);

  // Interactive hover & click-and-drag brush zoom state
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [brushStartIdx, setBrushStartIdx] = useState<number | null>(null);
  const [brushEndIdx, setBrushEndIdx] = useState<number | null>(null);
  const isBrushingRef = useRef<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const todayIso = useMemo(() => getLocalDateIso(), []);
  const hasWellnessTelemetry = wellnessDays.length > 0;
  const [orthoSwappedToast, setOrthoSwappedToast] = useState<string | null>(null);

  const dualSportLatest = useMemo(() => {
    if (!athleteProfile || activities.length === 0) return null;
    const series = computeDualSportPmcSeries(activities, athleteProfile, 14);
    return series.length > 0 ? series[series.length - 1] : null;
  }, [activities, athleteProfile]);

  const orthopedicSummary = useMemo(() => {
    if (!athleteProfile) return null;
    const todayPlanned = plannedEvents.filter((p) => (p.date || '').slice(0, 10) === todayIso);
    return evaluateOrthopedicInterference(activities, athleteProfile, todayPlanned, todayIso);
  }, [activities, athleteProfile, plannedEvents, todayIso]);

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
    restingHR: athleteProfile?.restingHr || 0,
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
    garminTrainingStatus: 'Productive' as const,
    trainingStatusReason:
      'Connect Garmin Connect, Intervals.icu, or upload FIT/GPX files to calibrate your Banister load curve.',
    readinessStatus: 'Optimal' as const,
    dailyLoad: 0,
  };

  // Index activities by YYYY-MM-DD so we can plot Max HR spikes, Workout/PR dots, and click-through
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

        curCtl = curCtl + (dayLoad - curCtl) / 42;
        curAtl = curAtl + (dayLoad - curAtl) / 7;
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

  const [activeMilestoneFilter, setActiveMilestoneFilter] = useState<
    'ALL' | MilestoneCategory | 'NONE'
  >('ALL');

  // Enrich each day with Max HR, Weekly Load buckets, and True Physiological / Race Milestones
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

  // Group into 7-day calendar week buckets for the Weekly Load (Work) bar subplot (split by per-activity Garmin Load Focus)
  const weeklyLoadBuckets = useMemo(() => {
    const buckets: {
      startIdx: number;
      endIdx: number;
      totalLoad: number;
      lowAerobicLoad: number;
      highAerobicLoad: number;
      anaerobicLoad: number;
    }[] = [];
    if (enrichedSeries.length === 0) return buckets;

    let bucketStart = 0;
    let sumLoad = 0;
    let sumLow = 0;
    let sumHigh = 0;
    let sumAnaerobic = 0;

    enrichedSeries.forEach((d, idx) => {
      if (d.activitySegments && d.activitySegments.length > 0) {
        for (const seg of d.activitySegments) {
          sumLoad += seg.load;
          if (seg.focus.type === 'ANAEROBIC') {
            sumAnaerobic += seg.load;
          } else if (seg.focus.type === 'HIGH_AEROBIC') {
            sumHigh += seg.load;
          } else {
            sumLow += seg.load;
          }
        }
      } else {
        const load = d.dailyLoad || 0;
        sumLoad += load;
        sumLow += load;
      }
      const [y, m, dayNum] = d.date.split('-').map(Number);
      const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, dayNum || 1));
      const isSunday = dt.getUTCDay() === 0;
      if (isSunday || idx === enrichedSeries.length - 1) {
        buckets.push({
          startIdx: bucketStart,
          endIdx: idx,
          totalLoad: Math.round(sumLoad),
          lowAerobicLoad: Math.round(sumLow),
          highAerobicLoad: Math.round(sumHigh),
          anaerobicLoad: Math.round(sumAnaerobic),
        });
        bucketStart = idx + 1;
        sumLoad = 0;
        sumLow = 0;
        sumHigh = 0;
        sumAnaerobic = 0;
      }
    });
    return buckets;
  }, [enrichedSeries]);

  const [pmcEngine, setPmcEngine] = useState<'ECHARTS' | 'SVG' | 'BOTH'>('ECHARTS');
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

  const activeIdx =
    hoverIdx !== null && enrichedSeries[hoverIdx]
      ? hoverIdx
      : enrichedSeries.length - 1;
  const activePoint = enrichedSeries[activeIdx] || enrichedSeries[0];

  const startDateStr = enrichedSeries[0]?.date || customStart;
  const endDateStr =
    enrichedSeries[enrichedSeries.length - 1]?.date || customEnd;
  const totalDaysCount = enrichedSeries.length;
  const totalWeeksCount = Math.max(1, Math.round(totalDaysCount / 7));

  // Compute 28d vs 90d Aerobic Efficiency (EF = NP/HR) & Pa:Hr Decoupling Durability for the Coach Summary Card
  const aerobicDurabilityStats = useMemo(() => {
    const nowMs = Date.now();
    const d28Cutoff = new Date(nowMs - 28 * 86400 * 1000).toISOString().slice(0, 10);
    const d90Cutoff = new Date(nowMs - 90 * 86400 * 1000).toISOString().slice(0, 10);

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
        : 1.78;
    const avgEf90 =
      ef90List.length > 0
        ? Number((ef90List.reduce((s, v) => s + v, 0) / ef90List.length).toFixed(2))
        : 1.73;
    const efPctDelta = Number((((avgEf28 - avgEf90) / Math.max(0.1, avgEf90)) * 100).toFixed(1));

    const enduranceActs = activities
      .filter(
        (a) =>
          a.movingTimeSecs >= 2700 &&
          typeof a.aerobicDecouplingPct === 'number' &&
          a.aerobicDecouplingPct >= -5 &&
          a.aerobicDecouplingPct <= 20
      )
      .slice(0, 24);

    const avgDecoupling =
      enduranceActs.length > 0
        ? Number(
            (
              enduranceActs.reduce((s, a) => s + a.aerobicDecouplingPct, 0) /
              enduranceActs.length
            ).toFixed(1)
          )
        : 2.9;

    const durabilityState: 'optimal' | 'caution' | 'warning' =
      avgDecoupling <= 3.5 ? 'optimal' : avgDecoupling <= 5.0 ? 'caution' : 'warning';
    const durabilityLabel =
      avgDecoupling <= 3.5
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
      sampleCount: Math.max(enduranceActs.length, ef28List.length),
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

  // Convert clientX mouse coordinate to index in enrichedSeries
  const clientXToIndex = (clientX: number): number | null => {
    if (!svgRef.current || enrichedSeries.length === 0) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / Math.max(1, rect.width)) * 1140;
    const plotLeft = 48;
    const plotRight = 982;
    const plotW = plotRight - plotLeft;
    if (svgX < plotLeft - 10 || svgX > plotRight + 10) return null;
    const clamped = Math.max(0, Math.min(1, (svgX - plotLeft) / plotW));
    return Math.round(clamped * Math.max(0, enrichedSeries.length - 1));
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = clientXToIndex(e.clientX);
    if (idx === null) return;
    isBrushingRef.current = true;
    setBrushStartIdx(idx);
    setBrushEndIdx(idx);
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = clientXToIndex(e.clientX);
    if (idx !== null) {
      setHoverIdx(idx);
      if (isBrushingRef.current) {
        setBrushEndIdx(idx);
      }
    }
  };

  const handleSvgMouseUp = () => {
    if (!isBrushingRef.current) return;
    isBrushingRef.current = false;
    if (
      brushStartIdx !== null &&
      brushEndIdx !== null &&
      Math.abs(brushEndIdx - brushStartIdx) >= 4
    ) {
      const low = Math.min(brushStartIdx, brushEndIdx);
      const high = Math.max(brushStartIdx, brushEndIdx);
      const dStart = enrichedSeries[low]?.date;
      const dEnd = enrichedSeries[high]?.date;
      if (dStart && dEnd) {
        setCustomStart(dStart);
        setCustomEnd(dEnd);
        setRangePreset('CUSTOM');
      }
    } else if (
      brushStartIdx !== null &&
      brushEndIdx !== null &&
      Math.abs(brushEndIdx - brushStartIdx) <= 1
    ) {
      // Single click on a day with workouts opens the primary workout on that day
      const clickedDay = enrichedSeries[brushStartIdx];
      if (
        clickedDay &&
        clickedDay.dayActivities.length > 0 &&
        onSelectActivity
      ) {
        onSelectActivity(clickedDay.dayActivities[0]);
      }
    }
    setBrushStartIdx(null);
    setBrushEndIdx(null);
  };

  // Circadian 6:00 AM Hero: Morning Brief expanded by default; collapse automatically once today's workout is completed
  const todayCompletedActivities = useMemo(
    () => activitiesByDate.get(todayIso) || [],
    [activitiesByDate, todayIso]
  );

  const [isPrescriptionExpanded, setIsPrescriptionExpanded] = useState<boolean>(false);
  const [isOrthoDrawerOpen, setIsOrthoDrawerOpen] = useState<boolean>(false);
  const [showGuardrailsBar, setShowGuardrailsBar] = useState<boolean>(false);

  const [collapsedSections, setCollapsedSections] = useState<
    Record<'pmc' | 'ledger' | 'comparator' | 'radars', boolean>
  >({
    pmc: false,
    ledger: true,
    comparator: true,
    radars: true,
  });

  // Student-Athlete Check-In (Academic/Exam Stress, Shin/Bone Soreness, Ferritin) & Cross-Training Equivalence
  const [isStudentCheckInOpen, setIsStudentCheckInOpen] = useState<boolean>(false);
  const [academicStress, setAcademicStress] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [shinBoneSoreness, setShinBoneSoreness] = useState<0 | 1 | 2 | 3>(0);
  const [achillesSoreness, setAchillesSoreness] = useState<0 | 1 | 2 | 3>(0);
  const [crossTrainModality, setCrossTrainModality] =
    useState<CrossTrainingModality>('AQUA_JOGGING');
  const [crossTrainMins, setCrossTrainMins] = useState<number>(45);
  const [crossTrainRpe, setCrossTrainRpe] = useState<number>(6);
  const [crossTrainToast, setCrossTrainToast] = useState<string | null>(null);

  const studentGuardrail = useMemo(
    () =>
      evaluateStudentAthleteGuardrail({
        date: todayIso,
        academicStress,
        shinMetatarsalSoreness: shinBoneSoreness,
        achillesTendonSoreness: achillesSoreness,
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
      latestWithSleep.sleepSecs,
      athleteProfile?.ferritinNgMl,
      latestDay.readinessStatus,
    ]
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

  const toggleSection = (key: 'pmc' | 'ledger' | 'comparator' | 'radars') => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
        todayCompliance={todayCompliance}
        isWorkbenchExpanded={isPrescriptionExpanded}
        onToggleWorkbench={() => setIsPrescriptionExpanded((prev) => !prev)}
        onSelectActivity={onSelectActivity}
        onSyncMorphedToCalendar={onSyncMorphedToCalendar}
        onOpenAthleteProfileModal={onOpenAthleteProfileModal}
        onOpenCoachWithPrompt={onOpenCoachWithPrompt}
      />

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
            isExpanded={isPrescriptionExpanded}
            onToggleExpand={() => setIsPrescriptionExpanded((prev) => !prev)}
            placementLabel={
              todayCompletedActivities.length > 0
                ? 'Skyline Workbench · Session Completed'
                : 'Skyline Workbench · Garmin & .FIT Export'
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
                className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase ${
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
                Injury Guardrails, Cross-Training &amp; Schedule Adjuster
              </span>
              {dualSportLatest && (
                <span className="hidden lg:inline text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  · Run {dualSportLatest.runningCtl.toFixed(0)} / Bike {dualSportLatest.cyclingCtl.toFixed(0)} CTL
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowGuardrailsBar((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl liquid-capsule-track text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-200 hover:opacity-90 cursor-pointer"
            >
              <span>
                {showGuardrailsBar ||
                orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
                studentGuardrail.status !== 'CLEARED_FULL_WORKOUT'
                  ? 'Hide Tools'
                  : 'Open Tools'}
              </span>
              {showGuardrailsBar ||
              orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
              studentGuardrail.status !== 'CLEARED_FULL_WORKOUT' ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>
          </div>

          {(showGuardrailsBar ||
            orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL' ||
            studentGuardrail.status !== 'CLEARED_FULL_WORKOUT' ||
            isOrthoDrawerOpen ||
            isGitDiffOpen ||
            isStudentCheckInOpen) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
              {/* Pill 1: Dual-Sport CTL & Impact Balance */}
              <button
                type="button"
                onClick={() => setIsOrthoDrawerOpen((prev) => !prev)}
                className={`rounded-xl px-3 py-2 text-left border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                  isOrthoDrawerOpen ||
                  orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL'
                    ? 'border-[#84CC16] bg-[#C8FF00]/15 dark:border-[#C8FF00]/55 dark:bg-[#C8FF00]/10'
                    : 'liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
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
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {dualSportLatest
                      ? `Bike ${dualSportLatest.cyclingCtl.toFixed(0)} · Run ${dualSportLatest.runningCtl.toFixed(0)} CTL · Impact ${orthopedicSummary.impactAcwr.toFixed(2)}x`
                      : `Impact Ratio ${orthopedicSummary.impactAcwr.toFixed(2)}x · Torque ${orthopedicSummary.torqueAcwr.toFixed(2)}x`}
                  </div>
                </div>
                {isOrthoDrawerOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </button>

              {/* Pill 2: Weekly Schedule Adjuster */}
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
                      <span className="ap-status-info px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase">
                        7-Day Plan
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        Weekly Schedule Adjuster
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
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
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
                      className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
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
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {studentGuardrail.headline}
                  </div>
                </div>
                {isStudentCheckInOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </button>
            </div>
          )}

          {/* Expandable Drawer 1: 3-Channel Orthopedic Interference & Run->Bike Swap */}
          {(isOrthoDrawerOpen ||
            orthopedicSummary.riskTier === 'HIGH_IMPACT_GUARDRAIL') && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                  {orthopedicSummary.guardrailHeadline}
                </h3>
                {dualSportLatest && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums">
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track text-slate-700 dark:text-slate-200 font-semibold">
                      Systemic CTL {dualSportLatest.systemicCtl.toFixed(1)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track text-[#1D4ED8] dark:text-sky-300 font-semibold">
                      Bike CTL {dualSportLatest.cyclingCtl.toFixed(1)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md liquid-capsule-track text-[#0D9488] dark:text-teal-300 font-semibold">
                      Run CTL {dualSportLatest.runningCtl.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    1. Central Cardiorespiratory (7d)
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.centralAutonomicLoad7d} TSS
                    </span>
                    <span className="text-xs text-[#1D4ED8] dark:text-sky-300">
                      {orthopedicSummary.centralAcwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                </div>

                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    2. Eccentric Run Impact (7d)
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      {orthopedicSummary.eccentricImpactLoad7d} pts
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        orthopedicSummary.impactAcwr >= 1.32
                          ? 'text-[#D9480F]'
                          : orthopedicSummary.impactAcwr >= 1.18
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[#0D9488] dark:text-teal-300'
                      }`}
                    >
                      {orthopedicSummary.impactAcwr.toFixed(2)}x ACWR
                    </span>
                  </div>
                </div>

                <div className="rounded-xl liquid-glass-subtle px-3.5 py-2.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    3. Concentric Bike Torque (7d)
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
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-[240px]">
                  {orthopedicSummary.guardrailRecommendation}
                </p>

                {onSyncMorphedToCalendar &&
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
                      Morph Run → {orthopedicSummary.suggestedBikeDurationMins}m Zero-Impact Ride
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

          {/* Expandable Drawer 2: Weekly Training Git-Diff */}
          {weeklyGitDiffProposal && isGitDiffOpen && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 p-3.5 space-y-2.5 text-xs">
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
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
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
                          <div className="mt-1 space-y-0.5 text-[11px]">
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
                          <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
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
                    <span className="text-[11px] text-slate-500">
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
          {(isStudentCheckInOpen || studentGuardrail.status !== 'CLEARED_FULL_WORKOUT') && (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1 text-xs">
                {/* Left 6 Cols: 5-Second Student-Athlete Check-In (Exams, Shin/Metatarsal BSI, Ferritin) */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">
                      5-Second Student-Athlete Check-In (Academic + Bone Stress)
                    </span>
                    <span className="font-mono text-[11px] text-blue-600 dark:text-sky-300 font-bold">
                      Intensity Cap: {studentGuardrail.intensityScalePct}%
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Academic / Exam Stress
                      </label>
                      <select
                        value={academicStress}
                        onChange={(e) =>
                          setAcademicStress(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      >
                        <option value={1}>1 — Normal Classes</option>
                        <option value={2}>2 — Light Papers</option>
                        <option value={3}>3 — Midterms / Labs</option>
                        <option value={4}>4 — Heavy Exams</option>
                        <option value={5}>5 — Finals / All-Nighter</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Shin / Foot Bone Pain
                      </label>
                      <select
                        value={shinBoneSoreness}
                        onChange={(e) =>
                          setShinBoneSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Zero Pain</option>
                        <option value={1}>1 — Mild Diffuse Tightness</option>
                        <option value={2}>2 — Focal Point Tenderness</option>
                        <option value={3}>3 — Hop / Walk Pain (BSI)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Achilles / Calf Tendon
                      </label>
                      <select
                        value={achillesSoreness}
                        onChange={(e) =>
                          setAchillesSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Springy / Clear</option>
                        <option value={1}>1 — Morning Stiffness</option>
                        <option value={2}>2 — Pinch Soreness</option>
                        <option value={3}>3 — Sharp Load Pain</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {studentGuardrail.recommendation}
                  </p>
                </div>

                {/* Right 6 Cols: Training Room Cross-Training -> Virtual Running Miles Converter */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/70 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Training Room Cross-Training → Virtual Miles
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-bold tabular-nums">
                      ≈{' '}
                      {distanceUnit === 'km'
                        ? `${crossTrainEquiv.equivalentRunKm} virtual km`
                        : `${crossTrainEquiv.equivalentRunMiles} virtual mi`}{' '}
                      · {crossTrainEquiv.estimatedSystemicTss} TSS ({crossTrainEquiv.impactLoadSavedPct}% impact saved)
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Modality
                      </label>
                      <select
                        value={crossTrainModality}
                        onChange={(e) =>
                          setCrossTrainModality(e.target.value as CrossTrainingModality)
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      >
                        <option value="AQUA_JOGGING">Aqua Jogging</option>
                        <option value="ALTER_G">AlterG (75% BW)</option>
                        <option value="ELLIPTICAL">Elliptical (90+ RPM)</option>
                        <option value="ARC_TRAINER">Arc Trainer</option>
                        <option value="STATIONARY_BIKE">Spin / Smart Bike</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Duration (min)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={240}
                        step={5}
                        value={crossTrainMins}
                        onChange={(e) => setCrossTrainMins(Math.max(10, Number(e.target.value) || 30))}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-slate-500 mb-1">
                        Effort RPE (1–10)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={crossTrainRpe}
                        onChange={(e) =>
                          setCrossTrainRpe(Math.max(1, Math.min(10, Number(e.target.value) || 6)))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500 flex-1 min-w-[180px]">
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
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs whitespace-nowrap"
                      >
                        Schedule Cross-Training Swap
                      </button>
                    )}
                  </div>

                  {crossTrainToast && (
                    <div className="rounded-lg ap-status-prime px-2.5 py-1.5 text-[11px] font-medium">
                      {crossTrainToast}
                    </div>
                  )}
                </div>
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
              {athleteProfile && onSyncMorphedToCalendar && onOpenAthleteProfileModal && (
                <button
                  type="button"
                  onClick={() => setIsPrescriptionExpanded((prev) => !prev)}
                  className="ap-btn-primary !min-h-[30px] !px-2.5 !py-1 !rounded-xl text-[11px] uppercase tracking-wide"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Daily Workout Prescription</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleSection('pmc')}
                className="px-3 py-1 rounded-xl ap-badge-volt text-xs font-mono flex items-center gap-1"
              >
                <span>Expand Chart</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
      <section className="rounded-2xl liquid-glass overflow-hidden">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-slate-900/40">
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
                coachingAction="Maintain purple Fatigue (ATL) above cyan Fitness (CTL) during build blocks to keep Form in the green Optimal zone (-10 to -30), then shed ATL 10–14 days before A-races so Form rises into the blue Fresh zone (+5 to +20)."
              />
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDatePickerOpen((prev) => !prev)}
                className="min-h-[34px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-[#84CC16] dark:hover:border-[#C8FF00]/50 text-xs font-bold tracking-wide text-slate-900 dark:text-slate-100 transition-all"
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
                      <label className="block text-[10px] font-sans text-slate-500 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setRangePreset('CUSTOM');
                        }}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-950/80 px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-sans text-slate-500 mb-1">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => {
                          setCustomEnd(e.target.value);
                          setRangePreset('CUSTOM');
                        }}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-950/80 px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setIsDatePickerOpen(false)}
                      className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
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
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/25 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Zoom (1y)</span>
              </button>
            )}
          </div>

          {/* Center: Recessed macOS Capsule Switcher for Quick Date Presets */}
          <div className="ap-toolbar-scroll p-1 rounded-xl liquid-capsule-track max-w-full">
            {(
              [
                { id: '7D', label: '7d' },
                { id: '1M', label: '1m' },
                { id: '42D', label: '42d' },
                { id: '3M', label: '3m' },
                { id: '6M', label: '6m' },
                { id: '1Y', label: '1y' },
                { id: '2Y', label: '2y' },
                { id: 'ALL', label: 'All' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setRangePreset(p.id)}
                className={`min-h-[28px] px-2.5 py-0.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  rangePreset === p.id
                    ? 'ap-nav-volt-active'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right: Inline Daily Workout Prescription Trigger + Forward Projection + Customize Chart Popover */}
          <div className="flex flex-wrap items-center gap-2 relative min-w-0">
            {athleteProfile && onSyncMorphedToCalendar && onOpenAthleteProfileModal && (
              <button
                type="button"
                onClick={() => setIsPrescriptionExpanded((prev) => !prev)}
                className={`min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-bold tracking-wide uppercase shadow-2xs transition-all cursor-pointer ${
                  isPrescriptionExpanded
                    ? 'ap-badge-volt'
                    : 'ap-btn-primary !min-h-[32px] !py-1 !px-3'
                }`}
                title="Open or collapse today's readiness-calibrated Daily Workout Prescription"
              >
                <Sparkles className="w-3 h-3" />
                <span>Daily Workout Prescription</span>
                {isPrescriptionExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 opacity-80" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                )}
              </button>
            )}

            <select
              value={forwardDays}
              onChange={(e) =>
                setForwardDays(Number(e.target.value) as 0 | 14 | 28 | 42)
              }
              className="min-h-[32px] rounded-xl liquid-glass-subtle px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200"
              title="Project future CTL, ATL & Form"
            >
              <option value={0}>Projection: Off</option>
              <option value={14}>+14d Projection</option>
              <option value={28}>+28d Projection</option>
              <option value={42}>+42d Projection</option>
            </select>

            <button
              type="button"
              onClick={() => setIsCustomizeOpen((prev) => !prev)}
              className="min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-blue-500/35 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-sky-300 text-xs font-bold tracking-wide transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Customize Chart ▾</span>
            </button>

            <button
              type="button"
              onClick={() => toggleSection('pmc')}
              title="Collapse PMC Chart"
              className="min-h-[32px] px-2 py-1 rounded-xl liquid-glass-subtle text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>

            {isCustomizeOpen && (
              <div className="absolute right-0 top-10 z-30 w-[min(18rem,calc(100vw-2rem))] rounded-2xl liquid-glass p-4 space-y-3 text-xs shadow-2xl border border-slate-300/80 dark:border-white/15">
                <div className="font-bold text-slate-900 dark:text-slate-100 border-b border-slate-200/70 dark:border-white/10 pb-1.5 flex items-center justify-between">
                  <span>Synchronized Chart Strips</span>
                  <button
                    type="button"
                    onClick={() => setIsCustomizeOpen(false)}
                    className="text-[11px] font-mono text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    Done
                  </button>
                </div>
                {[
                  {
                    label: 'Form (TSB 5-Zone Curve)',
                    checked: showTsbSubplot,
                    set: setShowTsbSubplot,
                  },
                  {
                    label: '7-Day Ramp Rate (CTL/wk)',
                    checked: showRampSubplot,
                    set: setShowRampSubplot,
                  },
                  {
                    label: 'Daily Max HR Spikes',
                    checked: showMaxHrSubplot,
                    set: setShowMaxHrSubplot,
                  },
                  {
                    label: 'Ride & Run eFTP Step Lines',
                    checked: showEftpSubplot,
                    set: setShowEftpSubplot,
                  },
                  {
                    label: 'Weekly Training Load (Work)',
                    checked: showWeeklyLoadSubplot,
                    set: setShowWeeklyLoadSubplot,
                  },
                  {
                    label: 'Overnight HRV & Resting HR',
                    checked: showHrvSubplot,
                    set: setShowHrvSubplot,
                  },
                ].map((item) => (
                  <label
                    key={item.label}
                    className="flex items-center justify-between gap-2 cursor-pointer select-none py-0.5 text-slate-700 dark:text-slate-300 font-medium"
                  >
                    <span>{item.label}</span>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => item.set(e.target.checked)}
                      className="rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                ))}
                {forwardDays > 0 && (
                  <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-1">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span>Simulated TSS/day:</span>
                      <span className="font-bold text-blue-500">
                        {simulatedDailyTss} TSS
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={150}
                      step={5}
                      value={simulatedDailyTss}
                      onChange={(e) =>
                        setSimulatedDailyTss(Number(e.target.value))
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                )}

                {/* Chart Layout & Local Cache Diagnostics */}
                <div className="pt-2.5 border-t border-slate-200/70 dark:border-white/10 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Chart Layout
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl liquid-capsule-track text-[11px] font-mono">
                    {(
                      [
                        { id: 'SVG', label: 'Multi-Pane' },
                        { id: 'ECHARTS', label: 'Interactive' },
                        { id: 'BOTH', label: 'Split View' },
                      ] as const
                    ).map((eng) => (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => setPmcEngine(eng.id)}
                        className={`px-2 py-1 rounded-lg transition-all ${
                          pmcEngine === eng.id
                            ? 'liquid-capsule-active text-cyan-600 dark:text-cyan-300 font-bold'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        {eng.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-emerald-600 dark:text-emerald-400 pt-1">
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
        <div className="px-3 sm:px-5 py-1.5 bg-white/30 dark:bg-slate-950/35 border-b border-slate-200/60 dark:border-white/10 min-h-[52px] sm:h-[58px] sm:min-h-[58px] sm:max-h-[58px] overflow-hidden flex items-start justify-between gap-2 sm:gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 sm:max-h-[46px] sm:overflow-hidden flex-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900/5 dark:bg-white/10 font-mono font-bold text-slate-800 dark:text-slate-100 shrink-0">
              {activePoint.date}
            </span>
            {activePoint.dailyLoad > 0 &&
              (activePoint.activitySegments && activePoint.activitySegments.length > 1 ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold border border-slate-300/70 dark:border-white/15 bg-slate-900/5 dark:bg-white/5 text-slate-700 dark:text-slate-200 shrink-0"
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
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold border shrink-0"
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
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/5 dark:bg-white/5 font-mono text-[10.5px] text-slate-600 dark:text-slate-300 shrink-0">
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
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg font-mono text-[11px] font-bold border shadow-2xs transition-transform hover:scale-[1.01] shrink-0"
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
                    <span className="font-mono text-[10.5px] font-bold shrink-0">
                      ({actLoad} TSS · {actFocus.shortLabel})
                    </span>
                  </button>
                );
              })
            ) : (
              <span className="inline-flex items-center gap-2 py-0.5 text-slate-500 dark:text-slate-400">
                <span>Rest / Recovery Day ({activePoint.dailyLoad} TSS)</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono text-[11px]">
                  CTL {activePoint.ctl.toFixed(1)} · ATL {activePoint.atl.toFixed(1)} · Form{' '}
                  {activePoint.tsb > 0 ? `+${activePoint.tsb.toFixed(1)}` : activePoint.tsb.toFixed(1)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* ==========================================================================
            APACHE ECHARTS CHRONIC FITNESS DECAY MODEL (CTL / ATL / TSB / RAMP WITH DATAZOOM)
           ========================================================================== */}
        {(pmcEngine === 'ECHARTS' || pmcEngine === 'BOTH') && (
          <div className="px-3 sm:px-5 pt-3 pb-1">
            <EChartsPMCDashboard
              timeline={echartsTimeline}
              onSelectActivity={(act) => onSelectActivity && onSelectActivity(act)}
              onSelectDate={(dateStr) => {
                const foundIdx = enrichedSeries.findIndex((d) => d.date === dateStr);
                if (foundIdx >= 0) setHoverIdx(foundIdx);
              }}
              onSelectDateRange={(startStr, endStr) => {
                setCustomStart(startStr);
                setCustomEnd(endStr);
                setRangePreset('CUSTOM');
              }}
              height={isCompactMobile ? 380 : 530}
            />
          </div>
        )}

        {/* ==========================================================================
            UNIFIED MULTI-PANE INTERVALS.ICU SVG CANVAS + RIGHT-MARGIN READOUT GUTTER
           ========================================================================== */}
        {(pmcEngine === 'SVG' || pmcEngine === 'BOTH') && (
        <div className="px-2 sm:px-4 pt-3 pb-2 select-none overflow-x-auto">
          {(() => {
            const len = Math.max(1, enrichedSeries.length);
            const plotLeft = 48;
            const plotRight = 982;
            const plotW = plotRight - plotLeft;
            const gutterLeft = 996;
            const xFor = (i: number) =>
              plotLeft + (i / Math.max(1, len - 1)) * plotW;

            // --- PANE 1 GEOMETRY: Training load per day (2x tall: 310px height) ---
            const p1Top = 14;
            const p1Height = 300;
            const p1Bottom = p1Top + p1Height;

            // Auto-scaled Y-axis floor & ceiling (rounded to 10-unit intervals, just like Intervals.icu!)
            const allCtlAtl = enrichedSeries.flatMap((d) => [d.ctl, d.atl]);
            const rawMinLoad = Math.min(...allCtlAtl);
            const rawMaxLoad = Math.max(...allCtlAtl);
            const minLoad = Math.max(
              0,
              Math.floor((rawMinLoad - 4) / 10) * 10
            );
            const maxLoad = Math.max(
              minLoad + 40,
              Math.ceil((rawMaxLoad + 5) / 10) * 10
            );
            const loadSpan = Math.max(20, maxLoad - minLoad);
            const yLoad = (v: number) =>
              Math.max(
                p1Top,
                Math.min(
                  p1Bottom,
                  p1Bottom - ((v - minLoad) / loadSpan) * p1Height
                )
              );

            const loadTicks: number[] = [];
            for (let t = minLoad; t <= maxLoad; t += 10) {
              loadTicks.push(t);
            }

            const ctlPolyline = enrichedSeries
              .map((d, i) => `${xFor(i).toFixed(1)},${yLoad(d.ctl).toFixed(1)}`)
              .join(' ');
            const atlPolyline = enrichedSeries
              .map((d, i) => `${xFor(i).toFixed(1)},${yLoad(d.atl).toFixed(1)}`)
              .join(' ');
            const ctlAreaPoints = `${plotLeft},${p1Bottom} ${ctlPolyline} ${plotRight},${p1Bottom}`;

            // --- DYNAMIC VERTICAL STACK FOR SECONDARY PANES ---
            let cursorY = p1Bottom + 10;

            // Pane 2: Form (TSB) — 185px tall
            const p2Top = cursorY;
            const p2Height = showTsbSubplot ? 185 : 0;
            const p2Bottom = p2Top + p2Height;
            if (showTsbSubplot) cursorY = p2Bottom + 10;

            // Pane 2B: 7-Day Ramp Rate (CTL/wk) — 88px tall (directly beneath Form chart)
            const pRampTop = cursorY;
            const pRampHeight = showRampSubplot ? 88 : 0;
            const pRampBottom = pRampTop + pRampHeight;
            if (showRampSubplot) cursorY = pRampBottom + 10;

            // Pane 3: Max HR — 96px tall
            const p3Top = cursorY;
            const p3Height = showMaxHrSubplot ? 96 : 0;
            const p3Bottom = p3Top + p3Height;
            if (showMaxHrSubplot) cursorY = p3Bottom + 10;

            // Pane 4: Ride / Run eFTP — 74px tall
            const p4Top = cursorY;
            const p4Height = showEftpSubplot ? 74 : 0;
            const p4Bottom = p4Top + p4Height;
            if (showEftpSubplot) cursorY = p4Bottom + 10;

            // Pane 5: Weekly Load (Work) — 82px tall
            const p5Top = cursorY;
            const p5Height = showWeeklyLoadSubplot ? 82 : 0;
            const p5Bottom = p5Top + p5Height;
            if (showWeeklyLoadSubplot) cursorY = p5Bottom + 10;

            // Pane 6: Overnight HRV & RHR — 86px tall
            const p6Top = cursorY;
            const p6Height = showHrvSubplot ? 86 : 0;
            const p6Bottom = p6Top + p6Height;
            if (showHrvSubplot) cursorY = p6Bottom + 10;

            const bottomAxisY = cursorY + 14;
            const totalSvgHeight = bottomAxisY + 12;

            // Form (TSB) Y mapping (-38 to +28)
            const tsbMax = 28;
            const tsbMin = -38;
            const yTsb = (tsb: number) => {
              const clamped = Math.max(tsbMin, Math.min(tsbMax, tsb));
              return (
                p2Top + ((tsbMax - clamped) / (tsbMax - tsbMin)) * p2Height
              );
            };
            const tsbPolyline = showTsbSubplot
              ? enrichedSeries
                  .map(
                    (d, i) => `${xFor(i).toFixed(1)},${yTsb(d.tsb).toFixed(1)}`
                  )
                  .join(' ')
              : '';

            // Gradient stop percentages for the multi-color Form line
            const pctAtTsb = (val: number) =>
              `${Math.max(0, Math.min(100, ((tsbMax - val) / (tsbMax - tsbMin)) * 100)).toFixed(1)}%`;

            // Month / Year Calendar Ticks along the shared bottom X-axis
            const calendarTicks: { idx: number; label: string; isYear: boolean }[] = [];
            enrichedSeries.forEach((d, i) => {
              if (i === 0) {
                const [, m, dayNum] = d.date.split('-').map(Number);
                const g = formatGutterDate(d.date);
                calendarTicks.push({
                  idx: 0,
                  label: `${g.top.split(' ')[0]} ${String(dayNum).padStart(2, '0')} ${SHORT_MONTHS[(m || 1) - 1]}`,
                  isYear: false,
                });
                return;
              }
              const prevDate = enrichedSeries[i - 1].date;
              if (d.date.slice(0, 7) !== prevDate.slice(0, 7)) {
                const [y, m] = d.date.split('-').map(Number);
                if (m === 1) {
                  calendarTicks.push({ idx: i, label: String(y), isYear: true });
                } else {
                  calendarTicks.push({
                    idx: i,
                    label: SHORT_MONTHS[(m || 1) - 1],
                    isYear: false,
                  });
                }
              }
            });

            const activeFormZone = getIntervalsFormZone(activePoint.tsb);
            const activeGutterDate = formatGutterDate(activePoint.date);

            return (
              <svg
                ref={svgRef}
                viewBox={`0 0 1140 ${totalSvgHeight}`}
                className="w-full h-auto min-w-[780px] cursor-crosshair"
                onMouseDown={handleSvgMouseDown}
                onMouseMove={handleSvgMouseMove}
                onMouseUp={handleSvgMouseUp}
                onMouseLeave={() => {
                  setHoverIdx(null);
                  if (isBrushingRef.current) {
                    isBrushingRef.current = false;
                    setBrushStartIdx(null);
                    setBrushEndIdx(null);
                  }
                }}
              >
                <defs>
                  {/* Soft Cyan Vertical Area Fill for CTL Fitness */}
                  <linearGradient
                    id="intervals-ctl-area-grad"
                    x1="0"
                    y1={p1Top}
                    x2="0"
                    y2={p1Bottom}
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.02" />
                  </linearGradient>

                  {/* Luminous SVG Curve Glow Filters */}
                  <filter id="ctl-glow" x="-5%" y="-15%" width="110%" height="130%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2.2" floodColor="#0EA5E9" floodOpacity="0.35" />
                  </filter>
                  <filter id="atl-glow" x="-5%" y="-15%" width="110%" height="130%">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.8" floodColor="#8B5CF6" floodOpacity="0.28" />
                  </filter>

                  {/* Continuous Multi-Color Form (TSB) Stroke Gradient with Hard Stops at Zone Thresholds */}
                  {showTsbSubplot && (
                    <linearGradient
                      id="intervals-tsb-stroke-grad"
                      x1="0"
                      y1={p2Top}
                      x2="0"
                      y2={p2Bottom}
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" stopColor="#F59E0B" />
                      <stop offset={pctAtTsb(20)} stopColor="#F59E0B" />
                      <stop offset={pctAtTsb(20)} stopColor="#0EA5E9" />
                      <stop offset={pctAtTsb(5)} stopColor="#0EA5E9" />
                      <stop offset={pctAtTsb(5)} stopColor="#94A3B8" />
                      <stop offset={pctAtTsb(-10)} stopColor="#94A3B8" />
                      <stop offset={pctAtTsb(-10)} stopColor="#10B981" />
                      <stop offset={pctAtTsb(-30)} stopColor="#10B981" />
                      <stop offset={pctAtTsb(-30)} stopColor="#EF4444" />
                      <stop offset="100%" stopColor="#EF4444" />
                    </linearGradient>
                  )}
                </defs>

                {/* ==============================================================
                    PANE 1: TRAINING LOAD PER DAY (CTL FITNESS & ATL FATIGUE)
                   ============================================================== */}
                <rect
                  x={plotLeft}
                  y={p1Top}
                  width={plotW}
                  height={p1Height}
                  fill="none"
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800"
                />

                <text
                  x={15}
                  y={p1Top + p1Height / 2}
                  transform={`rotate(-90 15 ${p1Top + p1Height / 2})`}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                >
                  Training load per day
                </text>

                {/* 10-Unit Auto-Scaled Horizontal Gridlines */}
                {loadTicks.map((t) => {
                  const y = yLoad(t);
                  return (
                    <g key={`p1-tick-${t}`}>
                      <line
                        x1={plotLeft}
                        y1={y}
                        x2={plotRight}
                        y2={y}
                        stroke="currentColor"
                        className="text-slate-100 dark:text-slate-800/80"
                        strokeWidth="1"
                      />
                      <text
                        x={plotLeft - 6}
                        y={y + 3.5}
                        textAnchor="end"
                        className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                      >
                        {t}
                      </text>
                    </g>
                  );
                })}

                {/* Dashed Horizontal Reference Line at Active/Current CTL Fitness Level */}
                <line
                  x1={plotLeft}
                  y1={yLoad(activePoint.ctl)}
                  x2={plotRight}
                  y2={yLoad(activePoint.ctl)}
                  stroke="#94A3B8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  opacity="0.7"
                />

                {/* Daily Training Load Bars (Stacked per-activity by Garmin Load Focus: Low Aerobic / High Aerobic / Anaerobic) */}
                {enrichedSeries.map((d, i) => {
                  const load = d.dailyLoad || 0;
                  if (load <= 0) return null;
                  const x = xFor(i);
                  const maxBarH = p1Height * 0.42;
                  const totalBarH = Math.min(maxBarH, Math.max(3, (load / 180) * maxBarH));
                  const barW = Math.max(1.8, Math.min(5.5, (plotW / len) * 0.68));
                  const isHovered = activeIdx === i;
                  const baseOpacity = isHovered ? 0.96 : d.isProjected ? 0.25 : 0.78;
                  const segments =
                    d.activitySegments && d.activitySegments.length > 0
                      ? d.activitySegments
                      : [
                          {
                            activityId: `day-${d.date}`,
                            activityName: d.garminFocus.label,
                            sport: 'Training',
                            load,
                            focus: d.garminFocus,
                          },
                        ];
                  const minSlice = segments.length > 1 ? Math.max(7, load * 0.11) : 0;
                  const boostedLoads = segments.map((s) =>
                    s.load > 0 ? Math.max(s.load, minSlice) : 0
                  );
                  const segTotalLoad =
                    boostedLoads.reduce((acc, v) => acc + v, 0) || load;
                  let currentBottom = p1Bottom;

                  return (
                    <g key={`p1-garmin-load-stack-${d.date}`}>
                      {segments.map((seg, sIdx) => {
                        const frac = boostedLoads[sIdx] / segTotalLoad;
                        const segH =
                          sIdx === segments.length - 1
                            ? Math.max(1.5, currentBottom - (p1Bottom - totalBarH))
                            : Math.max(2, frac * totalBarH);
                        const yTop = currentBottom - segH;
                        currentBottom = yTop;
                        return (
                          <rect
                            key={`p1-garmin-seg-${d.date}-${seg.activityId}-${sIdx}`}
                            x={x - barW / 2}
                            y={yTop}
                            width={barW}
                            height={segH}
                            rx={sIdx === segments.length - 1 ? 1 : 0}
                            fill={seg.focus.solidColor}
                            opacity={baseOpacity}
                          />
                        );
                      })}
                    </g>
                  );
                })}

                {/* CTL Shaded Cyan Area */}
                <polygon
                  points={ctlAreaPoints}
                  fill="url(#intervals-ctl-area-grad)"
                />

                {/* Purple Fatigue (ATL) Curve */}
                <polyline
                  fill="none"
                  stroke="#8B5CF6"
                  strokeWidth="1.65"
                  strokeLinejoin="round"
                  filter="url(#atl-glow)"
                  points={atlPolyline}
                />

                {/* Cyan Fitness (CTL) Curve */}
                <polyline
                  fill="none"
                  stroke="#0EA5E9"
                  strokeWidth="2.25"
                  strokeLinejoin="round"
                  filter="url(#ctl-glow)"
                  points={ctlPolyline}
                />

                {/* Milestone Markers Along X-Axis Baseline & CTL Curve (A-Races & eFTP Only on CTL) */}
                {activeMilestoneFilter !== 'NONE' &&
                  enrichedSeries.map((d, i) => {
                    if (!d.milestones || d.milestones.length === 0) return null;
                    const visibleMilestones =
                      activeMilestoneFilter === 'ALL'
                        ? d.milestones
                        : d.milestones.filter((m) => m.category === activeMilestoneFilter);
                    if (visibleMilestones.length === 0) return null;

                    const x = xFor(i);
                    const primaryMs = visibleMilestones[0];
                    const ctlMilestone = visibleMilestones.find(
                      (m) =>
                        m.category === 'EFTP_BREAKTHROUGH' || m.category === 'RACE_OR_DISTANCE_PR'
                    );
                    const isHoveredDay = activeIdx === i;
                    const baseY = p1Bottom - 7;

                    return (
                      <g key={`p1-markers-${d.date}`}>
                        {/* Subtle vertical guideline connecting X-axis milestone to CTL curve */}
                        {ctlMilestone && (
                          <line
                            x1={x}
                            y1={yLoad(d.ctl) + 4}
                            x2={x}
                            y2={baseY - 5}
                            stroke={ctlMilestone.colorHex}
                            strokeWidth={isHoveredDay ? '1.3' : '0.8'}
                            strokeDasharray="2 2"
                            opacity={isHoveredDay ? '0.85' : '0.4'}
                          />
                        )}

                        {/* CTL Curve Node: ONLY for A-Races / Distance PRs and eFTP Breakthroughs */}
                        {ctlMilestone && (
                          <g>
                            <circle
                              cx={x}
                              cy={yLoad(d.ctl)}
                              r={isHoveredDay ? 5.2 : 3.8}
                              fill={ctlMilestone.colorHex}
                              stroke="#0F172A"
                              strokeWidth="1.4"
                            />
                            <circle
                              cx={x}
                              cy={yLoad(d.ctl)}
                              r={1.6}
                              fill="#FFFFFF"
                            />
                          </g>
                        )}

                        {/* Color-Coded X-Axis Baseline Milestone Badge */}
                        {primaryMs.category === 'EFTP_BREAKTHROUGH' && (
                          /* Aero Orange Diamond Badge for New eFTP Breakthrough */
                          <polygon
                            points={`${x},${baseY - 5} ${x + 4.8},${baseY} ${x},${baseY + 5} ${x - 4.8},${baseY}`}
                            fill="#F97316"
                            stroke="#FFFFFF"
                            strokeWidth={isHoveredDay ? '1.5' : '0.9'}
                          />
                        )}
                        {primaryMs.category === 'RACE_OR_DISTANCE_PR' && (
                          /* Gold Trophy / Hex Badge for Official Race or Running Distance PR */
                          <g>
                            <circle
                              cx={x}
                              cy={baseY}
                              r={isHoveredDay ? 5.2 : 4.2}
                              fill="#F59E0B"
                              stroke="#FFFFFF"
                              strokeWidth={isHoveredDay ? '1.5' : '1'}
                            />
                            <circle cx={x} cy={baseY} r={1.6} fill="#0F172A" />
                          </g>
                        )}
                        {primaryMs.category === 'POWER_OR_BENCHMARK_PR' && (
                          /* Magenta Triangle / Peak Badge for Power Curve or Benchmark Segment PR */
                          <polygon
                            points={`${x},${baseY - 5} ${x + 4.8},${baseY + 4.2} ${x - 4.8},${baseY + 4.2}`}
                            fill="#EC4899"
                            stroke="#FFFFFF"
                            strokeWidth={isHoveredDay ? '1.5' : '0.9'}
                          />
                        )}
                      </g>
                    );
                  })}

                {/* On-Canvas Floating Callout Tooltip When Hovering a Day with a Milestone */}
                {activePoint.milestones &&
                  activePoint.milestones.length > 0 &&
                  activeMilestoneFilter !== 'NONE' &&
                  (() => {
                    const visible =
                      activeMilestoneFilter === 'ALL'
                        ? activePoint.milestones
                        : activePoint.milestones.filter(
                            (m) => m.category === activeMilestoneFilter
                          );
                    if (visible.length === 0) return null;
                    const ms = visible[0];
                    const rawX = xFor(activeIdx);
                    const boxW = Math.min(340, Math.max(175, ms.detailLabel.length * 6.2 + 24));
                    const boxX = Math.max(
                      plotLeft + 6,
                      Math.min(plotRight - boxW - 6, rawX - boxW / 2)
                    );
                    const boxY = p1Bottom - 36;
                    return (
                      <g pointerEvents="none">
                        <rect
                          x={boxX}
                          y={boxY}
                          width={boxW}
                          height={22}
                          rx={6}
                          fill="#0F172A"
                          fillOpacity="0.94"
                          stroke={ms.colorHex}
                          strokeWidth="1.2"
                        />
                        <circle cx={boxX + 10} cy={boxY + 11} r={3.2} fill={ms.colorHex} />
                        <text
                          x={boxX + 18}
                          y={boxY + 14.5}
                          className="fill-white text-[10.5px] font-mono font-semibold"
                        >
                          {ms.detailLabel.slice(0, 50)}
                        </text>
                      </g>
                    );
                  })()}

                {/* Active Hover Dots on CTL & ATL */}
                <circle
                  cx={xFor(activeIdx)}
                  cy={yLoad(activePoint.ctl)}
                  r={4}
                  fill="#0EA5E9"
                  stroke="#fff"
                  strokeWidth="1.5"
                />
                <circle
                  cx={xFor(activeIdx)}
                  cy={yLoad(activePoint.atl)}
                  r={3.8}
                  fill="#8B5CF6"
                  stroke="#fff"
                  strokeWidth="1.5"
                />

                {/* PANE 1 RIGHT-MARGIN PINNED READOUT GUTTER (Exact Intervals.icu Layout) */}
                <g transform={`translate(${gutterLeft + 52}, ${p1Top + 14})`}>
                  <text
                    x={0}
                    y={0}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                  >
                    {activeGutterDate.top}
                  </text>
                  <text
                    x={0}
                    y={13}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                  >
                    {activeGutterDate.bottom}
                  </text>

                  <text
                    x={0}
                    y={44}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                  >
                    Fitness
                  </text>
                  <text
                    x={0}
                    y={62}
                    textAnchor="middle"
                    className="fill-[#0284C7] dark:fill-[#38BDF8] text-[15px] font-sans font-bold"
                  >
                    {Math.round(activePoint.ctl)}
                  </text>

                  <text
                    x={0}
                    y={88}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                  >
                    Fatigue
                  </text>
                  <text
                    x={0}
                    y={106}
                    textAnchor="middle"
                    className="fill-[#7C3AED] dark:fill-[#A855F7] text-[15px] font-sans font-bold"
                  >
                    {Math.round(activePoint.atl)}
                  </text>

                  <text
                    x={0}
                    y={132}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                  >
                    Form
                  </text>
                  <text
                    x={0}
                    y={150}
                    textAnchor="middle"
                    fill={activeFormZone.hex}
                    className="text-[15px] font-sans font-bold"
                  >
                    {Math.round(activePoint.tsb)}
                  </text>

                  <text
                    x={0}
                    y={174}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[10.5px] font-sans"
                  >
                    {activeFormZone.label === 'Grey Zone'
                      ? 'Grey Zone'
                      : `${activeFormZone.label} Zone`}
                  </text>
                </g>

                {/* ==============================================================
                    PANE 2: FORM (TSB = CTL - ATL) WITH 5 INTERVALS.ICU ZONE BANDS
                   ============================================================== */}
                {showTsbSubplot && (
                  <g>
                    <text
                      x={15}
                      y={p2Top + p2Height / 2}
                      transform={`rotate(-90 15 ${p2Top + p2Height / 2})`}
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                    >
                      Form
                    </text>

                    {/* 5 Horizontal Intervals.icu Zone Background Fills */}
                    {/* Transition (> +20) */}
                    <rect
                      x={plotLeft}
                      y={yTsb(tsbMax)}
                      width={plotW}
                      height={Math.max(0, yTsb(20) - yTsb(tsbMax))}
                      fill="rgba(245, 158, 11, 0.08)"
                    />
                    {/* Fresh (+5 to +20) */}
                    <rect
                      x={plotLeft}
                      y={yTsb(20)}
                      width={plotW}
                      height={Math.max(0, yTsb(5) - yTsb(20))}
                      fill="rgba(14, 165, 233, 0.08)"
                    />
                    {/* Grey Zone (-10 to +5) */}
                    <rect
                      x={plotLeft}
                      y={yTsb(5)}
                      width={plotW}
                      height={Math.max(0, yTsb(-10) - yTsb(5))}
                      fill="rgba(148, 163, 184, 0.09)"
                    />
                    {/* Optimal (-30 to -10) */}
                    <rect
                      x={plotLeft}
                      y={yTsb(-10)}
                      width={plotW}
                      height={Math.max(0, yTsb(-30) - yTsb(-10))}
                      fill="rgba(16, 185, 129, 0.10)"
                    />
                    {/* High Risk (< -30) */}
                    <rect
                      x={plotLeft}
                      y={yTsb(-30)}
                      width={plotW}
                      height={Math.max(0, yTsb(tsbMin) - yTsb(-30))}
                      fill="rgba(239, 68, 68, 0.11)"
                    />

                    {/* Pane 2 Border */}
                    <rect
                      x={plotLeft}
                      y={p2Top}
                      width={plotW}
                      height={p2Height}
                      fill="none"
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                    />

                    {/* Zone Threshold Reference Lines (+20, +5, -10, -30) */}
                    {[20, 5, -10, -30].map((v) => {
                      const y = yTsb(v);
                      return (
                        <g key={`tsb-line-${v}`}>
                          <line
                            x1={plotLeft}
                            y1={y}
                            x2={plotRight}
                            y2={y}
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-700/70"
                            strokeDasharray="2 2"
                          />
                          <text
                            x={plotLeft - 6}
                            y={y + 3.5}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                          >
                            {v}
                          </text>
                        </g>
                      );
                    })}

                    {/* Continuous Multi-Color Form (TSB) Curve */}
                    <polyline
                      fill="none"
                      stroke="url(#intervals-tsb-stroke-grad)"
                      strokeWidth="1.9"
                      strokeLinejoin="round"
                      points={tsbPolyline}
                    />

                    {/* Red Warning Dots on High Risk (< -30) Days */}
                    {enrichedSeries.map((d, i) =>
                      d.tsb < -30 ? (
                        <circle
                          key={`hrisk-${d.date}`}
                          cx={xFor(i)}
                          cy={yTsb(d.tsb)}
                          r={2.6}
                          fill="#EF4444"
                        />
                      ) : null
                    )}

                    {/* Active Hover Dot on TSB */}
                    <circle
                      cx={xFor(activeIdx)}
                      cy={yTsb(activePoint.tsb)}
                      r={4}
                      fill={activeFormZone.hex}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />

                    {/* Right-Margin Zone Labels Aligned to Band Heights */}
                    <g className="text-[11px] font-sans">
                      <line
                        x1={gutterLeft - 4}
                        y1={yTsb(tsbMax) + 2}
                        x2={gutterLeft - 4}
                        y2={yTsb(20) - 2}
                        stroke="#F59E0B"
                        strokeWidth="2"
                      />
                      <text
                        x={gutterLeft + 4}
                        y={(yTsb(tsbMax) + yTsb(20)) / 2 + 4}
                        fill="#D97706"
                      >
                        Transition
                      </text>

                      <line
                        x1={gutterLeft - 4}
                        y1={yTsb(20) + 2}
                        x2={gutterLeft - 4}
                        y2={yTsb(5) - 2}
                        stroke="#0EA5E9"
                        strokeWidth="2"
                      />
                      <text
                        x={gutterLeft + 4}
                        y={(yTsb(20) + yTsb(5)) / 2 + 4}
                        fill="#0284C7"
                      >
                        Fresh
                      </text>

                      <line
                        x1={gutterLeft - 4}
                        y1={yTsb(5) + 2}
                        x2={gutterLeft - 4}
                        y2={yTsb(-10) - 2}
                        stroke="#94A3B8"
                        strokeWidth="2"
                      />
                      <text
                        x={gutterLeft + 4}
                        y={(yTsb(5) + yTsb(-10)) / 2 + 4}
                        fill="#64748B"
                      >
                        Grey Zone
                      </text>

                      <line
                        x1={gutterLeft - 4}
                        y1={yTsb(-10) + 2}
                        x2={gutterLeft - 4}
                        y2={yTsb(-30) - 2}
                        stroke="#10B981"
                        strokeWidth="2"
                      />
                      <text
                        x={gutterLeft + 4}
                        y={(yTsb(-10) + yTsb(-30)) / 2 + 4}
                        fill="#10B981"
                      >
                        Optimal
                      </text>

                      <line
                        x1={gutterLeft - 4}
                        y1={yTsb(-30) + 2}
                        x2={gutterLeft - 4}
                        y2={yTsb(tsbMin) - 2}
                        stroke="#EF4444"
                        strokeWidth="2"
                      />
                      <text
                        x={gutterLeft + 4}
                        y={(yTsb(-30) + yTsb(tsbMin)) / 2 + 4}
                        fill="#EF4444"
                      >
                        High Risk
                      </text>
                    </g>
                  </g>
                )}

                {/* ==============================================================
                    PANE 2B: 7-DAY RAMP RATE (CTL/WK) SUB-CHART BENEATH FORM
                   ============================================================== */}
                {showRampSubplot &&
                  (() => {
                    const rampMin = -8;
                    const rampMax = 12;
                    const yRamp = (v: number) => {
                      const clamped = Math.max(rampMin, Math.min(rampMax, v));
                      return (
                        pRampTop +
                        ((rampMax - clamped) / (rampMax - rampMin)) * pRampHeight
                      );
                    };
                    const zeroY = yRamp(0);
                    const optY = yRamp(5);
                    const riskY = yRamp(7);
                    const barW = Math.max(1.8, Math.min(5.2, (plotW / len) * 0.65));

                    return (
                      <g>
                        {/* Optimal Ramp Zone Band (0 to +5.0 CTL/wk) */}
                        <rect
                          x={plotLeft}
                          y={optY}
                          width={plotW}
                          height={Math.max(0, zeroY - optY)}
                          fill="rgba(16, 185, 129, 0.07)"
                        />
                        {/* Caution Ramp Zone Band (+5.0 to +7.0 CTL/wk) */}
                        <rect
                          x={plotLeft}
                          y={riskY}
                          width={plotW}
                          height={Math.max(0, optY - riskY)}
                          fill="rgba(245, 158, 11, 0.07)"
                        />
                        {/* High Risk Ramp Zone Band (> +7.0 CTL/wk) */}
                        <rect
                          x={plotLeft}
                          y={pRampTop}
                          width={plotW}
                          height={Math.max(0, riskY - pRampTop)}
                          fill="rgba(244, 63, 94, 0.07)"
                        />

                        <rect
                          x={plotLeft}
                          y={pRampTop}
                          width={plotW}
                          height={pRampHeight}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                        />

                        <text
                          x={15}
                          y={pRampTop + pRampHeight / 2}
                          transform={`rotate(-90 15 ${pRampTop + pRampHeight / 2})`}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Ramp (/wk)
                        </text>

                        {[-5, 0, 5, 10].map((v) => (
                          <g key={`ramp-grid-${v}`}>
                            <line
                              x1={plotLeft}
                              y1={yRamp(v)}
                              x2={plotRight}
                              y2={yRamp(v)}
                              stroke={v === 0 ? '#64748B' : v === 5 ? '#10B981' : 'currentColor'}
                              strokeDasharray={v === 5 ? '3 3' : undefined}
                              strokeWidth={v === 0 ? '1.1' : '1'}
                              opacity={v === 0 || v === 5 ? '0.6' : '1'}
                              className={
                                v === 0 || v === 5
                                  ? undefined
                                  : 'text-slate-100 dark:text-slate-800/80'
                              }
                            />
                            <text
                              x={plotLeft - 6}
                              y={yRamp(v) + 3}
                              textAnchor="end"
                              className="fill-slate-500 dark:fill-slate-400 text-[9.5px] font-mono"
                            >
                              {v > 0 ? `+${v}` : v}
                            </text>
                          </g>
                        ))}

                        {enrichedSeries.map((d, i) => {
                          const r = d.rampRate || 0;
                          const x = xFor(i);
                          const valY = yRamp(r);
                          const top = Math.min(zeroY, valY);
                          const h = Math.max(1.5, Math.abs(valY - zeroY));
                          const fillHex =
                            r > 7
                              ? '#F43F5E'
                              : r > 5
                                ? '#F59E0B'
                                : r >= 0
                                  ? '#10B981'
                                  : '#38BDF8';
                          return (
                            <rect
                              key={`ramp-bar-${d.date}`}
                              x={x - barW / 2}
                              y={top}
                              width={barW}
                              height={h}
                              rx={0.8}
                              fill={fillHex}
                              opacity={activeIdx === i ? '1' : d.isProjected ? '0.35' : '0.78'}
                            />
                          );
                        })}

                        {/* Right-margin readout */}
                        <text
                          x={gutterLeft + 4}
                          y={pRampTop + pRampHeight / 2 - 4}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Ramp{' '}
                          <tspan
                            fill={
                              activePoint.rampRate > 7
                                ? '#F43F5E'
                                : activePoint.rampRate > 5
                                  ? '#F59E0B'
                                  : activePoint.rampRate >= 0
                                    ? '#10B981'
                                    : '#38BDF8'
                            }
                            className="font-bold font-mono"
                          >
                            {activePoint.rampRate > 0
                              ? `+${activePoint.rampRate.toFixed(1)}`
                              : activePoint.rampRate.toFixed(1)}
                            /wk
                          </tspan>
                        </text>
                        <text
                          x={gutterLeft + 4}
                          y={pRampTop + pRampHeight / 2 + 12}
                          className="fill-slate-400 dark:fill-slate-500 text-[10px] font-sans"
                        >
                          {activePoint.rampRate > 7
                            ? 'High Risk (>+7)'
                            : activePoint.rampRate > 5
                              ? 'Heavy Build'
                              : activePoint.rampRate >= 0
                                ? 'Optimal (0..+5)'
                                : 'Taper / Recov'}
                        </text>
                      </g>
                    );
                  })()}

                {/* ==============================================================
                    PANE 3: DAILY MAX HR VERTICAL IMPULSE SPIKES
                   ============================================================== */}
                {showMaxHrSubplot &&
                  (() => {
                    const hrMin = 90;
                    const hrMax = 188;
                    const yHr = (hr: number) =>
                      Math.max(
                        p3Top,
                        Math.min(
                          p3Bottom,
                          p3Bottom - ((hr - hrMin) / (hrMax - hrMin)) * p3Height
                        )
                      );
                    return (
                      <g>
                        <rect
                          x={plotLeft}
                          y={p3Top}
                          width={plotW}
                          height={p3Height}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                        />
                        <text
                          x={15}
                          y={p3Top + p3Height / 2}
                          transform={`rotate(-90 15 ${p3Top + p3Height / 2})`}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Max HR
                        </text>
                        {[100, 120, 140, 160, 180].map((v) => (
                          <g key={`hr-grid-${v}`}>
                            <line
                              x1={plotLeft}
                              y1={yHr(v)}
                              x2={plotRight}
                              y2={yHr(v)}
                              stroke="currentColor"
                              className="text-slate-100 dark:text-slate-800/80"
                            />
                            <text
                              x={plotLeft - 6}
                              y={yHr(v) + 3}
                              textAnchor="end"
                              className="fill-slate-500 dark:fill-slate-400 text-[9.5px] font-mono"
                            >
                              {v}
                            </text>
                          </g>
                        ))}
                        {enrichedSeries.map((d, i) => {
                          if (!d.maxHr || d.maxHr < 95) return null;
                          const x = xFor(i);
                          const topY = yHr(d.maxHr);
                          return (
                            <line
                              key={`hr-bar-${d.date}`}
                              x1={x}
                              y1={topY}
                              x2={x}
                              y2={p3Bottom}
                              stroke={hoverIdx === i ? '#EF4444' : '#F87171'}
                              strokeWidth={len > 220 ? '1.6' : '2.4'}
                              opacity={hoverIdx === i ? '1' : '0.82'}
                            />
                          );
                        })}
                        {/* Right-margin readout */}
                        <text
                          x={gutterLeft + 4}
                          y={p3Top + p3Height / 2 - 4}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Max HR{' '}
                          <tspan className="fill-[#EF4444] font-bold">
                            {activePoint.maxHr > 0
                              ? `${activePoint.maxHr} bpm`
                              : '—'}
                          </tspan>
                        </text>
                      </g>
                    );
                  })()}

                {/* ==============================================================
                    PANE 4: RIDE & RUN eFTP STEP LINES
                   ============================================================== */}
                {showEftpSubplot &&
                  (() => {
                    const allEftp = enrichedSeries.flatMap((d) => [
                      d.rideEftp || 310,
                      d.runEftp || 340,
                    ]);
                    const minFtp = Math.floor((Math.min(...allEftp) - 10) / 20) * 20;
                    const maxFtp = Math.ceil((Math.max(...allEftp) + 10) / 20) * 20;
                    const span = Math.max(40, maxFtp - minFtp);
                    const yFtp = (w: number) =>
                      Math.max(
                        p4Top,
                        Math.min(
                          p4Bottom,
                          p4Bottom - ((w - minFtp) / span) * p4Height
                        )
                      );
                    const ridePts = enrichedSeries
                      .map(
                        (d, i) =>
                          `${xFor(i).toFixed(1)},${yFtp(d.rideEftp || 310).toFixed(1)}`
                      )
                      .join(' ');
                    const runPts = enrichedSeries
                      .map(
                        (d, i) =>
                          `${xFor(i).toFixed(1)},${yFtp(d.runEftp || 340).toFixed(1)}`
                      )
                      .join(' ');

                    return (
                      <g>
                        <rect
                          x={plotLeft}
                          y={p4Top}
                          width={plotW}
                          height={p4Height}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                        />
                        <text
                          x={15}
                          y={p4Top + p4Height / 2}
                          transform={`rotate(-90 15 ${p4Top + p4Height / 2})`}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Ride / Run FTP
                        </text>
                        {[minFtp + 10, Math.round((minFtp + maxFtp) / 2), maxFtp - 10].map(
                          (v, idx) => (
                            <g key={`ftp-tick-${idx}`}>
                              <line
                                x1={plotLeft}
                                y1={yFtp(v)}
                                x2={plotRight}
                                y2={yFtp(v)}
                                stroke="currentColor"
                                className="text-slate-100 dark:text-slate-800/80"
                              />
                              <text
                                x={plotLeft - 6}
                                y={yFtp(v) + 3}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[9.5px] font-mono"
                              >
                                {v}
                              </text>
                            </g>
                          )
                        )}
                        <polyline
                          fill="none"
                          stroke="#8B5CF6"
                          strokeWidth="1.5"
                          points={runPts}
                        />
                        <polyline
                          fill="none"
                          stroke="#F97316"
                          strokeWidth="1.6"
                          points={ridePts}
                        />
                        <text
                          x={gutterLeft + 4}
                          y={p4Top + p4Height / 2 - 4}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Run{' '}
                          <tspan className="fill-[#8B5CF6] font-bold">
                            {activePoint.runEftp || 340}W
                          </tspan>
                        </text>
                        <text
                          x={gutterLeft + 4}
                          y={p4Top + p4Height / 2 + 12}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          eFTP{' '}
                          <tspan className="fill-[#F97316] font-bold">
                            {activePoint.rideEftp || 310}W
                          </tspan>
                        </text>
                      </g>
                    );
                  })()}

                {/* ==============================================================
                    PANE 5: WEEKLY TRAINING LOAD (WORK / TSS) BARS BY GARMIN FOCUS
                   ============================================================== */}
                {showWeeklyLoadSubplot &&
                  (() => {
                    const maxWkLoad = Math.max(
                      500,
                      ...weeklyLoadBuckets.map((b) => b.totalLoad)
                    );
                    const yWk = (v: number) =>
                      Math.max(
                        p5Top,
                        Math.min(
                          p5Bottom,
                          p5Bottom - (v / maxWkLoad) * (p5Height - 6)
                        )
                      );
                    const activeBucket =
                      weeklyLoadBuckets.find(
                        (b) => activeIdx >= b.startIdx && activeIdx <= b.endIdx
                      ) || weeklyLoadBuckets[weeklyLoadBuckets.length - 1];

                    return (
                      <g>
                        <rect
                          x={plotLeft}
                          y={p5Top}
                          width={plotW}
                          height={p5Height}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                        />
                        <text
                          x={15}
                          y={p5Top + p5Height / 2}
                          transform={`rotate(-90 15 ${p5Top + p5Height / 2})`}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Work / Wk
                        </text>
                        {[0, Math.round(maxWkLoad * 0.5), Math.round(maxWkLoad * 0.9)].map(
                          (v, idx) => (
                            <g key={`wk-tick-${idx}`}>
                              <line
                                x1={plotLeft}
                                y1={yWk(v)}
                                x2={plotRight}
                                y2={yWk(v)}
                                stroke="currentColor"
                                className="text-slate-100 dark:text-slate-800/80"
                              />
                              <text
                                x={plotLeft - 6}
                                y={yWk(v) + 3}
                                textAnchor="end"
                                className="fill-slate-500 dark:fill-slate-400 text-[9.5px] font-mono"
                              >
                                {v}
                              </text>
                            </g>
                          )
                        )}
                        {weeklyLoadBuckets.map((b, bIdx) => {
                          const xStart = xFor(b.startIdx);
                          const xEnd = xFor(b.endIdx);
                          const barW = Math.max(4, xEnd - xStart - 2);
                          const lowTopY = yWk(b.lowAerobicLoad);
                          const highTopY = yWk(b.lowAerobicLoad + b.highAerobicLoad);
                          const totalTopY = yWk(b.totalLoad);
                          return (
                            <g key={`wk-bar-${bIdx}`}>
                              {/* Low Aerobic Base (Sky Blue) */}
                              {b.lowAerobicLoad > 0 && (
                                <rect
                                  x={xStart + 1}
                                  y={lowTopY}
                                  width={barW}
                                  height={Math.max(1, p5Bottom - lowTopY)}
                                  fill="#38BDF8"
                                  opacity="0.72"
                                />
                              )}
                              {/* High Aerobic Stack (Orange) */}
                              {b.highAerobicLoad > 0 && (
                                <rect
                                  x={xStart + 1}
                                  y={highTopY}
                                  width={barW}
                                  height={Math.max(1, lowTopY - highTopY)}
                                  fill="#F97316"
                                  opacity="0.78"
                                />
                              )}
                              {/* Anaerobic Stack (Magenta-Purple) */}
                              {b.anaerobicLoad > 0 && (
                                <rect
                                  x={xStart + 1}
                                  y={totalTopY}
                                  width={barW}
                                  height={Math.max(1, highTopY - totalTopY)}
                                  fill="#D946EF"
                                  opacity="0.82"
                                />
                              )}
                            </g>
                          );
                        })}
                        <text
                          x={gutterLeft + 4}
                          y={p5Top + p5Height / 2 + 4}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          Week{' '}
                          <tspan className="fill-[#38BDF8] font-bold">
                            {activeBucket ? `${activeBucket.totalLoad} TSS` : '—'}
                          </tspan>
                        </text>
                      </g>
                    );
                  })()}

                {/* ==============================================================
                    PANE 6: OVERNIGHT HRV (rMSSD) & RESTING HR STRIP
                   ============================================================== */}
                {showHrvSubplot &&
                  (() => {
                    const minHrv = 25;
                    const maxHrv = 95;
                    const yHrv = (v: number) =>
                      Math.max(
                        p6Top,
                        Math.min(
                          p6Bottom,
                          p6Bottom - ((v - minHrv) / (maxHrv - minHrv)) * p6Height
                        )
                      );
                    const hrvPts = enrichedSeries
                      .map(
                        (d, i) =>
                          `${xFor(i).toFixed(1)},${yHrv(d.hrvRMSSD || 52).toFixed(1)}`
                      )
                      .join(' ');
                    const rhrPts = enrichedSeries
                      .map(
                        (d, i) =>
                          `${xFor(i).toFixed(1)},${yHrv(d.restingHR || 49).toFixed(1)}`
                      )
                      .join(' ');
                    const upperBand = enrichedSeries
                      .map(
                        (d, i) =>
                          `${xFor(i).toFixed(1)},${yHrv(d.hrvNormalBandHigh || 62).toFixed(1)}`
                      )
                      .join(' ');
                    const lowerBand = [...enrichedSeries]
                      .reverse()
                      .map((d, revIdx) => {
                        const i = len - 1 - revIdx;
                        return `${xFor(i).toFixed(1)},${yHrv(d.hrvNormalBandLow || 44).toFixed(1)}`;
                      })
                      .join(' ');

                    return (
                      <g>
                        <rect
                          x={plotLeft}
                          y={p6Top}
                          width={plotW}
                          height={p6Height}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-200 dark:text-slate-800"
                        />
                        <text
                          x={15}
                          y={p6Top + p6Height / 2}
                          transform={`rotate(-90 15 ${p6Top + p6Height / 2})`}
                          textAnchor="middle"
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          HRV / RHR
                        </text>
                        {[40, 60, 80].map((v) => (
                          <g key={`hrv-tick-${v}`}>
                            <line
                              x1={plotLeft}
                              y1={yHrv(v)}
                              x2={plotRight}
                              y2={yHrv(v)}
                              stroke="currentColor"
                              className="text-slate-100 dark:text-slate-800/80"
                            />
                            <text
                              x={plotLeft - 6}
                              y={yHrv(v) + 3}
                              textAnchor="end"
                              className="fill-slate-500 dark:fill-slate-400 text-[9.5px] font-mono"
                            >
                              {v}
                            </text>
                          </g>
                        ))}
                        <polygon
                          points={`${upperBand} ${lowerBand}`}
                          fill="rgba(16, 185, 129, 0.14)"
                        />
                        <polyline
                          fill="none"
                          stroke="#F43F5E"
                          strokeWidth="1.3"
                          strokeDasharray="3 2"
                          points={rhrPts}
                        />
                        <polyline
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="1.7"
                          points={hrvPts}
                        />
                        <text
                          x={gutterLeft + 4}
                          y={p6Top + p6Height / 2 - 4}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          HRV{' '}
                          <tspan className="fill-[#10B981] font-bold">
                            {activePoint.hrvRMSSD || '—'}ms
                          </tspan>
                        </text>
                        <text
                          x={gutterLeft + 4}
                          y={p6Top + p6Height / 2 + 12}
                          className="fill-slate-500 dark:fill-slate-400 text-[11px] font-sans"
                        >
                          RHR{' '}
                          <tspan className="fill-[#F43F5E] font-bold">
                            {activePoint.restingHR || '—'}bpm
                          </tspan>
                        </text>
                      </g>
                    );
                  })()}

                {/* ==============================================================
                    SHARED BOTTOM CALENDAR AXIS (Sat 08 Nov, Dec, 2026, Feb...)
                   ============================================================== */}
                {calendarTicks.map((t, idx) => {
                  const x = xFor(t.idx);
                  return (
                    <text
                      key={`cal-tick-${idx}`}
                      x={x}
                      y={bottomAxisY}
                      textAnchor={idx === 0 ? 'start' : 'middle'}
                      className={`text-[11px] font-sans ${
                        t.isYear
                          ? 'fill-slate-900 dark:fill-slate-100 font-bold'
                          : 'fill-slate-500 dark:fill-slate-400'
                      }`}
                    >
                      {t.label}
                    </text>
                  );
                })}

                {/* Full-Height Synchronized Crosshair & Brush Selection Overlay */}
                {hoverIdx !== null && (
                  <line
                    x1={xFor(hoverIdx)}
                    y1={p1Top}
                    x2={xFor(hoverIdx)}
                    y2={cursorY - 10}
                    stroke="#0EA5E9"
                    strokeWidth="1.2"
                    strokeDasharray="3 2"
                    pointerEvents="none"
                  />
                )}

                {brushStartIdx !== null &&
                  brushEndIdx !== null &&
                  Math.abs(brushEndIdx - brushStartIdx) >= 2 && (
                    <rect
                      x={Math.min(xFor(brushStartIdx), xFor(brushEndIdx))}
                      y={p1Top}
                      width={Math.abs(xFor(brushEndIdx) - xFor(brushStartIdx))}
                      height={cursorY - 10 - p1Top}
                      fill="rgba(14, 165, 233, 0.16)"
                      stroke="#0EA5E9"
                      strokeWidth="1"
                      pointerEvents="none"
                    />
                  )}
              </svg>
            );
          })()}
        </div>
        )}

        {/* Interactive Milestone Badges Legend & Filter Strip (SVG Multi-Pane mode) */}
        {(pmcEngine === 'SVG' || pmcEngine === 'BOTH') && (() => {
          const eftpCount = enrichedSeries.filter((d) =>
            d.milestones?.some((m) => m.category === 'EFTP_BREAKTHROUGH')
          ).length;
          const raceCount = enrichedSeries.filter((d) =>
            d.milestones?.some((m) => m.category === 'RACE_OR_DISTANCE_PR')
          ).length;
          const powerCount = enrichedSeries.filter((d) =>
            d.milestones?.some((m) => m.category === 'POWER_OR_BENCHMARK_PR')
          ).length;
          const totalMilestones = eftpCount + raceCount + powerCount;

          return (
            <div className="px-4 sm:px-6 py-2.5 border-t border-slate-200/60 dark:border-white/10 bg-slate-900/5 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono uppercase tracking-wider text-[10px] font-bold text-slate-500 dark:text-slate-400 mr-1">
                  Milestones ({totalMilestones}):
                </span>

                <button
                  type="button"
                  onClick={() => setActiveMilestoneFilter('ALL')}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'ALL'
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40 font-bold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>All</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'EFTP_BREAKTHROUGH' ? 'ALL' : 'EFTP_BREAKTHROUGH'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'EFTP_BREAKTHROUGH'
                      ? 'bg-orange-500/20 text-orange-600 dark:text-orange-300 border-orange-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-orange-500/40'
                  }`}
                  title="New eFTP Breakthroughs plotted on CTL & X-Axis"
                >
                  <span className="w-2 h-2 rotate-45 bg-[#F97316] inline-block shrink-0" />
                  <span>eFTP ({eftpCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'RACE_OR_DISTANCE_PR' ? 'ALL' : 'RACE_OR_DISTANCE_PR'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'RACE_OR_DISTANCE_PR'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-amber-500/40'
                  }`}
                  title="Official Race & Distance PRs plotted on CTL & X-Axis"
                >
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B] border border-white inline-block shrink-0" />
                  <span>Race PR ({raceCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'POWER_OR_BENCHMARK_PR' ? 'ALL' : 'POWER_OR_BENCHMARK_PR'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'POWER_OR_BENCHMARK_PR'
                      ? 'bg-pink-500/20 text-pink-600 dark:text-pink-300 border-pink-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-pink-500/40'
                  }`}
                  title="Power Curve & Benchmark Segment PRs"
                >
                  <span className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-[#EC4899] inline-block shrink-0" />
                  <span>Power PR ({powerCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) => (prev === 'NONE' ? 'ALL' : 'NONE'))
                  }
                  className="px-2 py-0.5 rounded-md text-[10px] font-mono text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300/50 dark:border-white/10"
                >
                  {activeMilestoneFilter === 'NONE' ? 'Show' : 'Hide'}
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  onOpenCoachWithPrompt(
                    `My current Fitness (CTL) is ${latestDay.ctl}, Fatigue (ATL) is ${latestDay.atl}, Form (TSB) is ${latestDay.tsb} (${getIntervalsFormZone(latestDay.tsb).label}), Sleep Score is ${latestWithSleep.sleepScore}, and HRV is ${latestWithHrv.hrvRMSSD}ms. Analyze my fitness/fatigue trend and recommend adjustments for the coming week.`
                  )
                }
                className="min-h-[30px] px-3 py-1 rounded-xl bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
              >
                Ask AI Coach About My PMC
              </button>
            </div>
          );
        })()}
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
                HRV {latestWithHrv.hrvRMSSD}ms · EF {aerobicDurabilityStats.avgEf28}
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleSection('ledger')}
              className="px-3 py-1 rounded-xl bg-emerald-500/15 text-emerald-500 text-xs font-mono font-semibold flex items-center gap-1"
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
                  <span className="text-xs font-bold text-[#0B4F9E] dark:text-sky-400">
                    ACWR {acwr.toFixed(2)}x
                  </span>
                  <span className="block text-[11px] text-slate-500">
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
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#0B4F9E] dark:bg-sky-400 ring-2 ring-white dark:ring-slate-950"
                    style={{ left: `${acwrMarkerPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400">
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
                ? '#1D4ED8'
                : '#D97706';
          return (
            <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Overnight Sleep
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
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
                      className="bg-[#1D4ED8] dark:bg-[#60A5FA] transition-all"
                      style={{ width: `${targetPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
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
                  <span className="block text-[11px] text-slate-500">
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
                <div className="flex justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
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
                <span className="text-xs font-mono text-[#D9480F] dark:text-[#FB6514] font-bold">
                  {bikeEftp > 0
                    ? `${(bikeEftp / (latestDay.weightKg || athleteProfile?.weightKg || 70)).toFixed(2)} W/kg`
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
                  <span className="text-xs font-bold text-[#1D4ED8] dark:text-[#60A5FA]">
                    Run {runEftp > 0 ? `${runEftp}W` : '—'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    W&apos; {wPrimeKj > 0 ? `${wPrimeKj} kJ` : '—'} · Pmax {pMaxVal > 0 ? `${pMaxVal}W` : '—'}
                  </span>
                </div>
              </div>
              <div className="space-y-1 pt-0.5">
                <div className="h-2 w-full rounded-full bg-stone-200/80 dark:bg-slate-800 overflow-hidden flex gap-0.5">
                  <div
                    className="h-full bg-[#D9480F] dark:bg-[#FB6514] rounded-full transition-all"
                    style={{ width: `${wPrimePct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  <span>Anaerobic Reserve (W&apos;)</span>
                  <span className="text-[#D9480F] dark:text-[#FB6514] font-semibold">
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
                {aerobicDurabilityStats.avgEf28}
              </span>
              <span
                className={`text-[11px] font-bold ${
                  aerobicDurabilityStats.efPctDelta >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                ({aerobicDurabilityStats.efPctDelta >= 0 ? `+${aerobicDurabilityStats.efPctDelta}%` : `${aerobicDurabilityStats.efPctDelta}%`})
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-xl liquid-glass-subtle flex items-center gap-2">
              <span className="text-slate-500 font-sans">Drift (Pa:Hr):</span>
              <span
                className={`text-sm font-extrabold ${
                  aerobicDurabilityStats.avgDecoupling <= 3.5
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : aerobicDurabilityStats.avgDecoupling <= 5.0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {aerobicDurabilityStats.avgDecoupling}%
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

      {/* ==========================================================================
          5. ON-DEMAND BENCHMARKING & ATHLETE COMPARISON TOOLS (HIDDEN BY DEFAULT)
         ========================================================================== */}
      <div className="rounded-2xl liquid-glass px-4 sm:px-5 py-3.5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Radar className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              <strong className="text-slate-900 dark:text-white">
                Benchmarking &amp; Peer Comparison:
              </strong>{' '}
              Compare your telemetry side-by-side with a training partner or inspect your Age-Graded Percentile Radars.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => toggleSection('comparator')}
              className={`min-h-[32px] px-3 py-1 rounded-xl text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors border ${
                !collapsedSections.comparator
                  ? 'bg-orange-500/20 text-orange-600 dark:text-orange-300 border-orange-500/40'
                  : 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/25'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>
                {collapsedSections.comparator
                  ? 'Compare with Another Athlete ▾'
                  : 'Hide Athlete Comparison ▴'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => toggleSection('radars')}
              className={`min-h-[32px] px-3 py-1 rounded-xl text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors border ${
                !collapsedSections.radars
                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/40'
                  : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/25'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              <span>
                {collapsedSections.radars
                  ? 'Age-Graded Percentile Radars ▾'
                  : 'Hide Percentile Radars ▴'}
              </span>
            </button>
          </div>
        </div>

        {!collapsedSections.comparator && (
          <div id="fitness-sec-comparator" className="pt-2 border-t border-slate-200/70 dark:border-white/10">
            <DualAthleteComparator
              selfName={selfName}
              selfProfile={selfProfile || athleteProfile}
              selfWellnessDays={
                selfWellnessDays && selfWellnessDays.length > 0 ? selfWellnessDays : wellnessDays
              }
              selfActivities={activities}
              connectedAthletes={connectedAthletes}
              onOpenRosterModal={onOpenRosterModal}
              onOpenCoachWithPrompt={onOpenCoachWithPrompt}
            />
          </div>
        )}

        {!collapsedSections.radars && (
          <div id="fitness-sec-radars" className="pt-2 border-t border-slate-200/70 dark:border-white/10">
            <AthletePerformanceRadar
              selfName={selfName}
              selfProfile={selfProfile || athleteProfile}
              selfWellnessDays={
                selfWellnessDays && selfWellnessDays.length > 0 ? selfWellnessDays : wellnessDays
              }
              selfActivities={activities}
              selfPlannedEvents={plannedEvents}
              connectedAthletes={connectedAthletes}
              onOpenRosterModal={onOpenRosterModal}
              onOpenCoachWithPrompt={onOpenCoachWithPrompt}
            />
          </div>
        )}
      </div>
    </div>
  );
};
