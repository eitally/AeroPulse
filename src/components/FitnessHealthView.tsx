import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp,
  Layers,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Users,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  ConnectedAthleteRecord,
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
  // Default to 1 year (365 days) so the macro season arc is immediately visible like Intervals.icu
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('1Y');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState<boolean>(false);

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

  const latestDay = wellnessDays[wellnessDays.length - 1] || {
    date: new Date().toISOString().slice(0, 10),
    ctl: 71.4,
    atl: 51.2,
    tsb: 20.2,
    loadRatio: 0.72,
    rampRate: -1.2,
    hrvRMSSD: 54,
    hrvBaseline7d: 52,
    hrvNormalBandLow: 44,
    hrvNormalBandHigh: 62,
    hrvStatus: 'Balanced' as const,
    restingHR: 49,
    sleepSecs: 26340,
    sleepScore: 78,
    sleepQuality: 2,
    sleepDebt7dSecs: 3200,
    weightKg: 70,
    vo2MaxCycling: 51,
    vo2MaxRunning: 51,
    rideEftp: 316,
    rideWPrime: 25120,
    ridePMax: 1204,
    runEftp: 340,
    garminTrainingStatus: 'Productive' as const,
    trainingStatusReason:
      'Optimal acute-to-chronic workload ratio building aerobic fitness.',
    readinessStatus: 'Optimal' as const,
    dailyLoad: 65,
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

  const [collapsedSections, setCollapsedSections] = useState<
    Record<'pmc' | 'ledger' | 'comparator' | 'radars', boolean>
  >({
    pmc: false,
    ledger: false,
    comparator: true,
    radars: true,
  });

  const toggleSection = (key: 'pmc' | 'ledger' | 'comparator' | 'radars') => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6">
      {/* ==========================================================================
          0. DAILY WORKOUT PRESCRIPTION TOP STRIP
         ========================================================================== */}
      {athleteProfile && onSyncMorphedToCalendar && onOpenAthleteProfileModal && (
        <ReadinessMorphingCard
          wellnessDays={wellnessDays}
          activities={activities}
          plannedEvents={plannedEvents}
          athleteProfile={athleteProfile}
          distanceUnit={distanceUnit}
          defaultExpanded={false}
          placementLabel="Daily Workout Prescription"
          onSyncMorphedToCalendar={onSyncMorphedToCalendar}
          onOpenAthleteProfileModal={onOpenAthleteProfileModal}
          onOpenCoachWithPrompt={onOpenCoachWithPrompt}
        />
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
                Fitness (CTL), Fatigue (ATL) &amp; Form (TSB)
              </span>
              <span className="text-xs font-mono text-sky-500">
                CTL {latestDay.ctl.toFixed(1)} · TSB {latestDay.tsb.toFixed(1)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleSection('pmc')}
              className="px-3 py-1 rounded-xl bg-sky-500/15 text-sky-500 text-xs font-mono font-semibold flex items-center gap-1"
            >
              <span>Expand Chart</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
      <section className="rounded-2xl liquid-glass overflow-hidden">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-slate-900/40">
          {/* Left: Plain-English Title + Date Range Dropdown + Calendar Picker + Span Summary */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 pr-1">
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                Fitness, Fatigue &amp; Freshness
              </span>
              <span className="px-2 py-0.5 rounded-md bg-sky-500/10 border border-sky-500/25 text-[10px] font-mono font-semibold text-sky-600 dark:text-sky-300">
                CTL · ATL · TSB
              </span>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDatePickerOpen((prev) => !prev)}
                className="min-h-[34px] inline-flex items-center gap-2 px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-blue-500/50 text-xs font-bold tracking-wide text-slate-900 dark:text-slate-100 transition-all"
              >
                <span className="font-mono">
                  {formatIntervalsRangeLabel(startDateStr, endDateStr)}
                </span>
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
              </button>

              {isDatePickerOpen && (
                <div className="absolute left-0 mt-2 z-30 w-72 rounded-2xl liquid-glass p-4 space-y-3 text-xs">
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

            <span className="text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
              <strong className="font-bold text-slate-900 dark:text-slate-100">
                {totalWeeksCount}
              </strong>{' '}
              weeks{' '}
              <strong className="font-bold text-slate-900 dark:text-slate-100">
                {totalDaysCount}
              </strong>{' '}
              days
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
                    ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right: Forward Projection + Customize Chart Popover */}
          <div className="flex flex-wrap items-center gap-2 relative min-w-0">
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
              <div className="absolute right-0 top-10 z-30 w-72 rounded-2xl liquid-glass p-4 space-y-3 text-xs shadow-2xl border border-slate-300/80 dark:border-white/15">
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

        {/* Fixed 2-Line Daily Activities Bar (58px static height so the SVG chart NEVER shifts vertically) */}
        <div className="px-4 sm:px-5 py-1.5 bg-white/30 dark:bg-slate-950/35 border-b border-slate-200/60 dark:border-white/10 h-[58px] min-h-[58px] max-h-[58px] overflow-hidden flex items-start justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 max-h-[46px] overflow-hidden flex-1">
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
          <div className="hidden lg:flex flex-col items-end justify-center text-[11px] text-slate-400 dark:text-slate-500 shrink-0 leading-tight pt-0.5">
            <span>Drag horizontally across chart to zoom date range</span>
            <span>Hover milestone badges on X-axis or CTL line for details</span>
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
              height={530}
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono uppercase tracking-wider text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  X-Axis &amp; CTL Milestone Markers ({totalMilestones}):
                </span>

                <button
                  type="button"
                  onClick={() => setActiveMilestoneFilter('ALL')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'ALL'
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40 font-bold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>All Milestones</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'EFTP_BREAKTHROUGH' ? 'ALL' : 'EFTP_BREAKTHROUGH'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'EFTP_BREAKTHROUGH'
                      ? 'bg-orange-500/20 text-orange-600 dark:text-orange-300 border-orange-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-orange-500/40'
                  }`}
                  title="Plotted on both the X-Axis baseline (diamond) and the Cyan CTL curve (ringed node)"
                >
                  <span className="w-2.5 h-2.5 rotate-45 bg-[#F97316] inline-block shrink-0" />
                  <span>New eFTP Breakthrough ({eftpCount})</span>
                  <span className="text-[9px] opacity-75">· on CTL &amp; X-Axis</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'RACE_OR_DISTANCE_PR' ? 'ALL' : 'RACE_OR_DISTANCE_PR'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'RACE_OR_DISTANCE_PR'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-amber-500/40'
                  }`}
                  title="Plotted on both the X-Axis baseline (gold badge) and the Cyan CTL curve (ringed node)"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] border border-white inline-block shrink-0" />
                  <span>Official Race / Run Distance PR ({raceCount})</span>
                  <span className="text-[9px] opacity-75">· on CTL &amp; X-Axis</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveMilestoneFilter((prev) =>
                      prev === 'POWER_OR_BENCHMARK_PR' ? 'ALL' : 'POWER_OR_BENCHMARK_PR'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] transition-all border ${
                    activeMilestoneFilter === 'POWER_OR_BENCHMARK_PR'
                      ? 'bg-pink-500/20 text-pink-600 dark:text-pink-300 border-pink-500/50 font-bold'
                      : 'border-slate-300/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-pink-500/40'
                  }`}
                  title="Plotted along the X-Axis baseline (triangle peak badge)"
                >
                  <span
                    className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[9px] border-b-[#EC4899] inline-block shrink-0"
                  />
                  <span>Power Curve / Benchmark Segment PR ({powerCount})</span>
                  <span className="text-[9px] opacity-75">· X-Axis only</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  setActiveMilestoneFilter((prev) => (prev === 'NONE' ? 'ALL' : 'NONE'))
                }
                className="px-2.5 py-1 rounded-lg text-[10px] font-mono text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-300/50 dark:border-white/10"
              >
                {activeMilestoneFilter === 'NONE' ? 'Show Milestone Badges' : 'Hide Badges'}
              </button>
            </div>
          );
        })()}

        {/* Intervals.icu Explanatory Footer Caption */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200/60 dark:border-white/10 bg-white/30 dark:bg-slate-900/30 text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-5xl">
            <strong className="text-[#0284C7] dark:text-[#38BDF8]">
              The blue line shows fitness.
            </strong>{' '}
            This is a 42 day exponentially weighted moving average of your training load.{' '}
            <strong className="text-[#7C3AED] dark:text-[#A855F7]">
              The purple line shows fatigue.
            </strong>{' '}
            This is a 7 day exponentially weighted moving average of your training load. Your form is your fitness minus fatigue: when your form is in the{' '}
            <strong className="text-emerald-600 dark:text-emerald-400">
              optimal training zone
            </strong>{' '}
            you are gaining fitness; when your form is{' '}
            <strong className="text-[#0284C7] dark:text-[#38BDF8]">fresh</strong>{' '}
            and you are fit then you are ready to race. Avoid staying in the{' '}
            <strong className="text-rose-600 dark:text-rose-400">
              high risk zone
            </strong>{' '}
            for long or you might become over-trained.
          </p>
          <button
            type="button"
            onClick={() =>
              onOpenCoachWithPrompt(
                `My current Fitness (CTL) is ${latestDay.ctl}, Fatigue (ATL) is ${latestDay.atl}, Form (TSB) is ${latestDay.tsb} (${getIntervalsFormZone(latestDay.tsb).label}), Sleep Score is ${latestWithSleep.sleepScore}, and HRV is ${latestWithHrv.hrvRMSSD}ms. Analyze my fitness/fatigue trend and recommend adjustments for the coming week.`
              )
            }
            className="min-h-[34px] px-4 py-1.5 rounded-xl bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
          >
            Ask AI Coach About My PMC
          </button>
        </div>
      </section>
        )}
      </div>

      {/* ==========================================================================
          2. 14-DAY READINESS LEDGER & KEY BIOMETRICS
         ========================================================================== */}
      <div id="fitness-sec-ledger" className="scroll-mt-28 space-y-6">
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
            <FourteenDayReadinessLedger wellnessDays={wellnessDays} />

      {/* ==========================================================================
          3. TRAINING STATUS, SLEEP, HRV & THRESHOLD READINESS CARDS
         ========================================================================== */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Fitness & Workload Ratio (CTL / ACWR) */}
        <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Fitness &amp; Status
              </span>
              <span
                className={`px-2 py-0.5 text-xs font-bold rounded-md border ${statusBadgeColor(
                  latestDay.garminTrainingStatus
                )}`}
              >
                {latestDay.garminTrainingStatus || 'Productive'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <div>
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestDay.ctl.toFixed(1)}
                </span>
                <span className="text-[11px] font-sans text-slate-500 ml-1.5">
                  Fitness <span className="font-mono opacity-75">(CTL)</span>
                </span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Load Ratio {(latestDay.loadRatio || 0.85).toFixed(2)}x
                </span>
                <span className="block text-[11px] text-slate-500">
                  Ramp {latestDay.rampRate && latestDay.rampRate > 0 ? `+${latestDay.rampRate}` : latestDay.rampRate || 0}/wk
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {latestDay.trainingStatusReason ||
              'Optimal workload ratio building long-term aerobic fitness.'}
          </p>
        </div>

        {/* Card 2: Overnight Sleep Score & Duration */}
        <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Overnight Sleep
              </span>
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                {latestWithSleep.date}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <div>
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestWithSleep.sleepScore || 78}
                </span>
                <span className="text-xs text-slate-500 ml-1">/ 100</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {(latestWithSleep.sleepSecs / 3600).toFixed(1)} hrs
                </span>
                <span className="block text-[11px] text-slate-500">
                  7d Debt {((latestWithSleep.sleepDebt7dSecs || 0) / 3600).toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-800/80 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full"
              style={{ width: `${Math.min(100, latestWithSleep.sleepScore || 78)}%` }}
            />
          </div>
        </div>

        {/* Card 3: Autonomic Recovery (Overnight HRV rMSSD) */}
        <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Autonomic Recovery <span className="font-mono text-[10px] opacity-75">(HRV)</span>
              </span>
              <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                {latestWithHrv.hrvStatus || 'Balanced'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <div>
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestWithHrv.hrvRMSSD}
                </span>
                <span className="text-xs text-slate-500 ml-1">ms rMSSD</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  7d Base: {latestWithHrv.hrvBaseline7d} ms
                </span>
                <span className="block text-[11px] text-slate-500">
                  Normal {latestWithHrv.hrvNormalBandLow || 44}–{latestWithHrv.hrvNormalBandHigh || 62} ms
                </span>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Resting HR: <strong className="text-slate-900 dark:text-slate-100">{latestDay.restingHR} bpm</strong> · VO2max: <strong className="text-slate-900 dark:text-slate-100">{latestDay.vo2MaxCycling || 51}</strong>
          </div>
        </div>

        {/* Card 4: Threshold Power & Anaerobic Reserve (eFTP / W') */}
        <div className="rounded-2xl liquid-glass p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Threshold Power <span className="font-mono text-[10px] opacity-75">(eFTP)</span>
              </span>
              <span className="text-xs font-mono text-orange-500 font-bold">
                CP · W&apos; Model
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono tabular-nums">
              <div>
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {latestDay.rideEftp || 316}W
                </span>
                <span className="text-xs text-slate-500 ml-1">Bike</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                  Run {latestDay.runEftp || 340}W
                </span>
                <span className="block text-[11px] text-slate-500">
                  Reserve W&apos; {((latestDay.rideWPrime || 25120) / 1000).toFixed(1)} kJ · Peak {latestDay.ridePMax || 1204}W
                </span>
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Weight:{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {distanceUnit === 'mi'
                ? `${Math.round((latestDay.weightKg || 70) * 2.20462262)} lbs`
                : `${latestDay.weightKg || 70} kg`}
            </strong>{' '}
            ({((latestDay.rideEftp || 316) / (latestDay.weightKg || 70)).toFixed(2)} W/kg)
          </div>
        </div>
      </section>

      {/* ==========================================================================
          4. AEROBIC STAMINA (CARDIAC DRIFT) & EFFICIENCY SUMMARY
         ========================================================================== */}
      <section className="rounded-2xl liquid-glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Aerobic Stamina &amp; Cardiovascular Economy
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
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
              <span>Aerobic Efficiency &amp; Cardiac Drift</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-300">
                EF · Pa:Hr
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              While Fitness (CTL) tracks mechanical workload, <strong>Aerobic Efficiency (Output ÷ Heart Rate)</strong> and{' '}
              <strong>Cardiac Drift (First-Half vs. Second-Half Stamina)</strong> reveal whether your internal cardiovascular cost is improving.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <div className="rounded-xl liquid-glass-subtle px-4 py-2.5">
              <span className="block text-[11px] font-sans text-slate-500">
                Aerobic Efficiency <span className="font-mono opacity-75">(EF)</span>
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {aerobicDurabilityStats.avgEf28}
                </span>
                <span
                  className={`text-xs font-bold ${
                    aerobicDurabilityStats.efPctDelta >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {aerobicDurabilityStats.efPctDelta >= 0
                    ? `+${aerobicDurabilityStats.efPctDelta}%`
                    : `${aerobicDurabilityStats.efPctDelta}%`}{' '}
                  (90d: {aerobicDurabilityStats.avgEf90})
                </span>
              </div>
            </div>

            <div className="rounded-xl liquid-glass-subtle px-4 py-2.5">
              <span className="block text-[11px] font-sans text-slate-500">
                Aerobic Stamina / Drift <span className="font-mono opacity-75">(Pa:Hr)</span>
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span
                  className={`text-xl font-extrabold ${
                    aerobicDurabilityStats.avgDecoupling <= 3.5
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : aerobicDurabilityStats.avgDecoupling <= 5.0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {aerobicDurabilityStats.avgDecoupling}%
                </span>
                <span className="text-xs text-slate-500">target &lt; 3.5%</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `My 28-day Aerobic Efficiency Factor (EF) is ${aerobicDurabilityStats.avgEf28} (${aerobicDurabilityStats.efPctDelta >= 0 ? '+' : ''}${aerobicDurabilityStats.efPctDelta}% vs 90-day EF of ${aerobicDurabilityStats.avgEf90}) and my average endurance cardiac drift (Pa:Hr decoupling) is ${aerobicDurabilityStats.avgDecoupling}%. Based on my current CTL (${latestDay.ctl}) and HRV (${latestWithHrv.hrvRMSSD}ms), should I focus on extending Z2 aerobic durability or progressing Z4 threshold intervals this week?`
                )
              }
              className="min-h-[38px] px-4 py-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-sans text-xs font-semibold shadow-sm transition-all"
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
