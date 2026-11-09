import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bike,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  FileText,
  Footprints,
  Heart,
  Moon,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
  Waves,
  X,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  DistanceUnit,
  EnvironmentFilter,
  PlannedWorkoutEvent,
  SportCategory,
  TargetGoal,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { formatDistance } from '../utils/formatters';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import {
  INTERVALS_EFFORT_ZONES,
  ParsedWorkoutStep as ParsedStep,
  computeAmplitudeHeightPct,
  getIntervalsZoneFromIntensityPct,
  parseWorkoutSteps,
} from '../utils/workoutParser';

export { INTERVALS_EFFORT_ZONES };

interface CalendarViewProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  targetGoals?: TargetGoal[];
  envFilter: EnvironmentFilter;
  selectedSport: SportCategory | 'ALL';
  onSelectSport?: (sport: SportCategory | 'ALL') => void;
  distanceUnit: DistanceUnit;
  athleteFtp: number;
  athleteProfile?: AthleteProfile;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onCreatePlannedEvent: (event: {
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
  onDeletePlannedEvent: (id: string) => Promise<void>;
  onBatchCreatePlannedEvents?: (
    events: {
      date: string;
      name: string;
      sportCategory: SportCategory;
      environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
    }[],
    clearFutureEvents?: boolean
  ) => Promise<void>;
  onOpenTodayWorkout?: () => void;
  onOpenAthleteProfileModal?: () => void;
  onOpenGoalsArchitect?: () => void;
  onOpenOfficialRaceModal?: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatHeaderDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${SHORT_WEEKDAYS[dt.getUTCDay()]}, ${SHORT_MONTHS[m - 1]} ${d}`;
}

export interface DayPlannedEffortStripe {
  source: 'SCHEDULED' | 'MICROCYCLE_TARGET';
  workoutName: string;
  description: string;
  sportCategory: SportCategory;
  totalDurationMins: number;
  plannedLoad: number;
  workoutSyntax: string;
  dominantZone: {
    zone: 1 | 2 | 3 | 4 | 5 | 6;
    code: string;
    name: string;
    color: string;
  };
  steps: {
    label: string;
    durationMins: number;
    intensityPct: number;
    widthPct: number;
    heightPct: number;
    zone: 1 | 2 | 3 | 4 | 5 | 6;
    zoneCode: string;
    color: string;
  }[];
  zoneSharesPct: [number, number, number, number, number, number];
}

/**
 * Builds the Intervals.icu color-coded Planned Effort Stripe for a calendar day.
 * - Uses explicitly scheduled `PlannedWorkoutEvent`s on that day when present.
 * - Otherwise synthesizes a periodized daily training prescription based on the day of week
 *   and the athlete's physiological readiness/TSB so every day visualizes its planned intensity zones.
 */
function buildDayPlannedEffortStripe(
  dateStr: string,
  dayPlanned: PlannedWorkoutEvent[],
  wellness: UnifiedWellnessDay | undefined,
  dayActivities: UnifiedActivity[]
): DayPlannedEffortStripe {
  // 1. Explicitly scheduled workout(s) on this day
  if (dayPlanned.length > 0) {
    const primary = dayPlanned[0];
    const stepsRaw: ParsedStep[] = [];

    for (const ev of dayPlanned) {
      const parsed = parseWorkoutSteps(ev.workoutSyntax || '');
      if (parsed.length > 0) {
        stepsRaw.push(...parsed);
      } else if (ev.structuredSteps && ev.structuredSteps.length > 0) {
        for (const st of ev.structuredSteps) {
          const mins = st.durationSecs
            ? Math.max(1, Math.round(st.durationSecs / 60))
            : 15;
          const pct = st.targetPctFtp || 70;
          const zMeta = getIntervalsZoneFromIntensityPct(pct);
          stepsRaw.push({
            label: st.label,
            durationMins: mins,
            intensityPct: pct,
            zone: zMeta.zone,
            zoneCode: zMeta.code,
            zoneColor: zMeta.color,
          });
        }
      } else {
        const totalM = Math.max(20, Math.round((ev.plannedDurationSecs || 3600) / 60));
        const nameAndTarget = `${ev.name} ${ev.targetZoneSummary || ''}`;
        let mainPct = 70;
        if (/vo2|z5|interval|hiit/i.test(nameAndTarget)) mainPct = 112;
        else if (/threshold|ftp|z4/i.test(nameAndTarget)) mainPct = 98;
        else if (/sweet\s*spot|tempo|z3/i.test(nameAndTarget)) mainPct = 88;
        else if (/recovery|easy|flush|z1/i.test(nameAndTarget)) mainPct = 52;
        const zMain = getIntervalsZoneFromIntensityPct(mainPct);
        const zWarm = INTERVALS_EFFORT_ZONES[0];
        const warmM = Math.round(totalM * 0.2);
        const coolM = Math.round(totalM * 0.15);
        const workM = Math.max(10, totalM - warmM - coolM);
        stepsRaw.push(
          {
            label: 'Warmup',
            durationMins: warmM,
            intensityPct: 54,
            zone: 1,
            zoneCode: zWarm.code,
            zoneColor: zWarm.color,
          },
          {
            label: ev.name,
            durationMins: workM,
            intensityPct: mainPct,
            zone: zMain.zone,
            zoneCode: zMain.code,
            zoneColor: zMain.color,
          },
          {
            label: 'Cooldown',
            durationMins: coolM,
            intensityPct: 52,
            zone: 1,
            zoneCode: zWarm.code,
            zoneColor: zWarm.color,
          }
        );
      }
    }

    const totalMins = Math.max(
      1,
      stepsRaw.reduce((acc, s) => acc + s.durationMins, 0)
    );
    const zoneMins = [0, 0, 0, 0, 0, 0];
    for (const s of stepsRaw) {
      zoneMins[s.zone - 1] += s.durationMins;
    }
    const zoneSharesPct = zoneMins.map((m) =>
      Math.round((m / totalMins) * 100)
    ) as [number, number, number, number, number, number];

    let domIdx = 1;
    for (let z = 5; z >= 0; z--) {
      if (zoneSharesPct[z] >= 15) {
        domIdx = z;
        break;
      }
    }
    const domMeta = INTERVALS_EFFORT_ZONES[domIdx];
    const unitLabel = primary.sportCategory === 'Running' ? 'Threshold Pace' : 'FTP';

    return {
      source: 'SCHEDULED',
      workoutName:
        dayPlanned.length > 1
          ? `${primary.name} (+${dayPlanned.length - 1})`
          : primary.name,
      description:
        primary.description ||
        `Scheduled ${primary.sportCategory.toLowerCase()} session targeting ${domMeta.code} (${domMeta.name}) with ${totalMins}m total duration.`,
      sportCategory: primary.sportCategory,
      totalDurationMins: totalMins,
      plannedLoad: dayPlanned.reduce((acc, e) => acc + (e.plannedLoad || 0), 0),
      workoutSyntax:
        primary.workoutSyntax ||
        stepsRaw.map((s) => `- ${s.durationMins}m ${s.intensityPct}% ${unitLabel} ${s.label}`).join('\n'),
      dominantZone: {
        zone: domMeta.zone,
        code: domMeta.code,
        name: domMeta.name,
        color: domMeta.color,
      },
      steps: stepsRaw.map((s) => {
        const zInfo = getIntervalsZoneFromIntensityPct(s.intensityPct);
        return {
          label: s.label,
          durationMins: s.durationMins,
          intensityPct: s.intensityPct,
          widthPct: (s.durationMins / totalMins) * 100,
          heightPct: computeAmplitudeHeightPct(s.intensityPct, zInfo.heightPct),
          zone: s.zone,
          zoneCode: s.zoneCode,
          color: s.zoneColor,
        };
      }),
      zoneSharesPct,
    };
  }

  // 2. Periodized Daily Microcycle Target (calibrated to weekday + morning TSB/readiness + sport)
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const tsb = wellness?.tsb ?? 0;
  const primarySport: SportCategory =
    dayActivities[0]?.sportCategory || (dow === 3 || dow === 0 ? 'Running' : 'Cycling');
  const isRun = primarySport === 'Running';

  let workoutName = isRun ? '50m Z2 Aerobic Base Run' : '60m Z2 Aerobic Base Ride';
  let description = isRun
    ? 'Steady aerobic endurance run in Zone 2 to build mitochondrial density and running economy.'
    : 'Steady aerobic base ride in Zone 2 (68% FTP) to build capillary density and fat oxidation.';
  let plannedLoad = 52;
  let syntax = `- 10m 54% FTP Warmup\n- 40m 68% FTP Z2 Endurance\n- 10m 52% FTP Cooldown`;

  if (dow === 1) {
    workoutName = isRun ? '35m Z1 Easy Recovery Jog' : '45m Z1 Active Recovery Spin';
    description = isRun
      ? 'Low-impact parasympathetic recovery jog strictly capped in Zone 1 to flush legs after weekend volume.'
      : 'Easy high-cadence Zone 1 active recovery spin (<55% FTP) to accelerate autonomic recovery.';
    plannedLoad = 28;
    syntax = isRun
      ? `- 8m 50% Pace Easy Walk/Jog\n- 20m 54% Pace Z1 Recovery Jog\n- 7m 48% Pace Cooldown`
      : `- 10m 50% FTP Easy Spin\n- 25m 54% FTP Z1 Recovery Flush\n- 10m 48% FTP Cooldown`;
  } else if (dow === 2) {
    if (tsb < -18) {
      workoutName = isRun
        ? '3x8m Z3 Tempo Cruise Intervals'
        : '3x10m Tempo / Sweet Spot Control';
      description = isRun
        ? 'Controlled marathon/half-marathon tempo intervals in Zone 3 with 3m easy jog recoveries (adapted for current fatigue).'
        : 'Sub-threshold Sweet Spot blocks (86–88% FTP) with 4m Z1 recoveries to build muscular endurance without excessive strain.';
      plannedLoad = 68;
      syntax = isRun
        ? `- 10m 62% Pace Warmup\n- 8m 86% Pace Z3 Tempo\n- 3m 54% Pace Z1 Jog\n- 8m 88% Pace Z3 Tempo\n- 3m 54% Pace Z1 Jog\n- 8m 88% Pace Z3 Tempo\n- 10m 52% Pace Cooldown`
        : `- 12m 62% FTP Warmup\n- 10m 86% FTP Sweet Spot\n- 4m 54% FTP Z1 Recovery\n- 10m 88% FTP Sweet Spot\n- 4m 54% FTP Z1 Recovery\n- 10m 88% FTP Sweet Spot\n- 10m 52% FTP Cooldown`;
    } else {
      workoutName = isRun
        ? '5x4m Z5 VO2max Track Intervals'
        : '5x4m VO2max Aerobic Ceiling';
      description = isRun
        ? 'High-velocity 5K/3K pace VO2max intervals in Zone 5 with equal 4m recovery jogs to elevate maximal oxygen uptake.'
        : 'High-output Zone 5 VO2max intervals (112–114% FTP) with 4m Z1 spinning recoveries to raise aerobic ceiling.';
      plannedLoad = 82;
      syntax = `- 15m 65% FTP Warmup\n- 4m 112% FTP Z5 VO2max\n- 4m 52% FTP Z1 Recovery\n- 4m 112% FTP Z5 VO2max\n- 4m 52% FTP Z1 Recovery\n- 4m 114% FTP Z5 VO2max\n- 4m 52% FTP Z1 Recovery\n- 4m 114% FTP Z5 VO2max\n- 10m 52% FTP Cooldown`;
    }
  } else if (dow === 3) {
    workoutName = isRun ? '50m Z2 Aerobic Foundation Run' : '60m Z2 Aerobic Foundation Ride';
    description = isRun
      ? 'Mid-week conversational Zone 2 aerobic run to reinforce running economy between quality sessions.'
      : 'Mid-week steady Zone 2 endurance ride (70% FTP) to consolidate aerobic volume.';
    plannedLoad = 54;
    syntax = isRun
      ? `- 10m 54% Pace Warmup\n- 32m 70% Pace Z2 Aerobic Run\n- 8m 52% Pace Cooldown`
      : `- 10m 54% FTP Warmup\n- 40m 70% FTP Z2 Endurance\n- 10m 52% FTP Cooldown`;
  } else if (dow === 4) {
    workoutName = isRun
      ? '4x6m Z4 Lactate Threshold Run'
      : '4x8m Threshold / Sweet Spot';
    description = isRun
      ? 'Cruise threshold intervals at 10K/Half-Marathon lactate turnpoint (Zone 4) with 3m float recoveries.'
      : 'Sustained Zone 4 lactate threshold intervals (95–98% FTP) with 4m Z1 recovery valleys to raise functional threshold power.';
    plannedLoad = 76;
    syntax = isRun
      ? `- 12m 64% Pace Warmup\n- 6m 96% Pace Z4 Threshold\n- 3m 54% Pace Z1 Jog\n- 6m 97% Pace Z4 Threshold\n- 3m 54% Pace Z1 Jog\n- 6m 98% Pace Z4 Threshold\n- 3m 54% Pace Z1 Jog\n- 6m 98% Pace Z4 Threshold\n- 8m 52% Pace Cooldown`
      : `- 12m 64% FTP Warmup\n- 8m 95% FTP Z4 Threshold\n- 4m 54% FTP Z1 Recovery\n- 8m 96% FTP Z4 Threshold\n- 4m 54% FTP Z1 Recovery\n- 8m 98% FTP Z4 Threshold\n- 4m 54% FTP Z1 Recovery\n- 8m 98% FTP Z4 Threshold\n- 8m 52% FTP Cooldown`;
  } else if (dow === 5) {
    workoutName = isRun
      ? '40m Z1/Z2 Shakeout + Strides'
      : '45m Z1/Z2 Neuromuscular Openers';
    description = isRun
      ? 'Easy pre-weekend aerobic shakeout run with brief neuromuscular activation strides.'
      : 'Easy Zone 1/2 spin with a short Zone 4/5 neuromuscular opener ahead of weekend endurance volume.';
    plannedLoad = 36;
    syntax = `- 15m 54% FTP Z1 Warmup\n- 20m 66% FTP Z2 Easy Base\n- 2m 105% FTP Z4 Opener\n- 8m 50% FTP Z1 Cooldown`;
  } else if (dow === 6) {
    workoutName = isRun
      ? '75m Z2 Endurance + Z3 Progression Run'
      : '2h Z2 Endurance + Z3 Progression';
    description = isRun
      ? 'Weekend progressive endurance run starting in Zone 2 and finishing with 20m in Zone 3 marathon tempo.'
      : 'Long weekend endurance ride in Zone 2 with a 25-minute Zone 3 tempo progression in the final hour.';
    plannedLoad = 108;
    syntax = `- 15m 55% FTP Warmup\n- 65m 70% FTP Z2 Endurance\n- 25m 84% FTP Z3 Tempo Finish\n- 15m 52% FTP Cooldown`;
  } else {
    workoutName = isRun ? '75m Steady Z2 Long Aerobic Run' : '90m Steady Z2 Aerobic Volume';
    description = isRun
      ? 'Sunday long aerobic endurance run strictly in Zone 2 to build durability and glycogen sparing.'
      : 'Sunday steady Zone 2 aerobic endurance ride (69% FTP) for volume accumulation.';
    plannedLoad = 74;
    syntax = isRun
      ? `- 10m 54% Pace Warmup\n- 55m 69% Pace Z2 Long Run\n- 10m 52% Pace Cooldown`
      : `- 10m 54% FTP Warmup\n- 70m 69% FTP Z2 Endurance\n- 10m 52% FTP Cooldown`;
  }

  const stepsRaw = parseWorkoutSteps(syntax);
  const totalMins = Math.max(
    1,
    stepsRaw.reduce((acc, s) => acc + s.durationMins, 0)
  );
  const zoneMins = [0, 0, 0, 0, 0, 0];
  for (const s of stepsRaw) {
    zoneMins[s.zone - 1] += s.durationMins;
  }
  const zoneSharesPct = zoneMins.map((m) =>
    Math.round((m / totalMins) * 100)
  ) as [number, number, number, number, number, number];

  let domIdx = 1;
  for (let z = 5; z >= 0; z--) {
    if (zoneSharesPct[z] >= 15) {
      domIdx = z;
      break;
    }
  }
  const domMeta = INTERVALS_EFFORT_ZONES[domIdx];

  return {
    source: 'MICROCYCLE_TARGET',
    workoutName,
    description,
    sportCategory: primarySport,
    totalDurationMins: totalMins,
    plannedLoad,
    workoutSyntax: syntax,
    dominantZone: {
      zone: domMeta.zone,
      code: domMeta.code,
      name: domMeta.name,
      color: domMeta.color,
    },
    steps: stepsRaw.map((s) => {
      const zInfo = getIntervalsZoneFromIntensityPct(s.intensityPct);
      return {
        label: s.label,
        durationMins: s.durationMins,
        intensityPct: s.intensityPct,
        widthPct: (s.durationMins / totalMins) * 100,
        heightPct: computeAmplitudeHeightPct(s.intensityPct, zInfo.heightPct),
        zone: s.zone,
        zoneCode: s.zoneCode,
        color: s.zoneColor,
      };
    }),
    zoneSharesPct,
  };
}

function getIsoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatIntervalsDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wk = SHORT_WEEKDAYS[dt.getUTCDay()];
  const mon = SHORT_MONTHS[m - 1];
  return `${wk} ${String(d).padStart(2, '0')} ${mon}`;
}

function formatCompactDuration(secs: number): string {
  if (!secs || secs <= 0) return '0m';
  const totalMins = Math.round(secs / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) {
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.max(1, m)}m`;
}

function formatSleepHm(secs: number): string {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

function formatPaceWithUnit(secsPerKm: number | undefined, unit: DistanceUnit): string {
  if (!secsPerKm || secsPerKm <= 0) return '';
  const secs = unit === 'mi' ? secsPerKm * 1.60934 : secsPerKm;
  const mins = Math.floor(secs / 60);
  const rem = Math.round(secs % 60);
  const adjMins = rem === 60 ? mins + 1 : mins;
  const adjRem = rem === 60 ? 0 : rem;
  return `${adjMins}:${String(adjRem).padStart(2, '0')}/${unit}`;
}

export interface EffortSlice {
  zone: 1 | 2 | 3 | 4 | 5 | 6;
  widthPct: number;
  heightPct: number;
  color: string;
}

export interface ActivityEffortPresentation {
  mode: 'steady-bar' | 'skyline';
  slices: EffortSlice[];
  zoneSharesPct: [number, number, number, number, number, number]; // Z1..Z6 percentages (sum = 100)
  hasStructuredWork: boolean;
}

function zoneInfoForIndex(z: number): {
  zone: 1 | 2 | 3 | 4 | 5 | 6;
  color: string;
  heightPct: number;
} {
  const clamped = Math.max(1, Math.min(6, Math.round(z))) as 1 | 2 | 3 | 4 | 5 | 6;
  const meta = INTERVALS_EFFORT_ZONES[clamped - 1];
  return {
    zone: clamped,
    color: meta.color,
    heightPct: meta.heightPct,
  };
}

/**
 * Computes the chronological Effort Zone representation for an activity card,
 * matching the Intervals.icu Calendar visual language:
 * - Steady Z1/Z2 workouts render a clean horizontal zone bar with soft gradient fill
 *   (plus any brief Z3/Z4 accent segments).
 * - Multi-zone, interval, race, or track workouts render a chronological Effort Zone
 *   Skyline where each slice's height and color show the intensity progression.
 */
function buildActivityEffortPresentation(
  act: UnifiedActivity,
  athleteFtp: number,
  athleteProfile?: AthleteProfile
): ActivityEffortPresentation {
  const isIndoorAct =
    act.environment === 'INDOOR' ||
    act.subType === 'Virtual Cycling' ||
    act.subType === 'Smart Trainer';
  const ftp = Math.max(
    150,
    isIndoorAct && athleteProfile?.indoorFtp
      ? athleteProfile.indoorFtp
      : athleteProfile?.ftp || athleteFtp || 280
  );

  // 1. Check if we have real time-series streams (watts or heartrate)
  if (act.streams && Array.isArray(act.streams.time) && act.streams.time.length >= 12) {
    const watts = act.streams.watts;
    const hr = act.streams.heartrate;
    const numBuckets = 24;
    const useWatts =
      Array.isArray(watts) && watts.length >= 12 && watts.some((w) => w > 30);
    const series = useWatts ? watts! : Array.isArray(hr) && hr.length >= 12 ? hr : null;

    if (series && series.length >= 12) {
      const bucketSize = Math.max(1, Math.floor(series.length / numBuckets));
      const rawZones: (1 | 2 | 3 | 4 | 5 | 6)[] = [];
      const zoneCounts = [0, 0, 0, 0, 0, 0];

      for (let b = 0; b < numBuckets; b++) {
        const start = b * bucketSize;
        const end = b === numBuckets - 1 ? series.length : Math.min(series.length, (b + 1) * bucketSize);
        if (start >= series.length) break;
        let sum = 0;
        let count = 0;
        for (let i = start; i < end; i++) {
          sum += series[i] || 0;
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        let z: 1 | 2 | 3 | 4 | 5 | 6 = 2;
        if (useWatts) {
          const pct = (avg / ftp) * 100;
          if (pct < 56) z = 1;
          else if (pct <= 75) z = 2;
          else if (pct <= 90) z = 3;
          else if (pct <= 105) z = 4;
          else if (pct <= 120) z = 5;
          else z = 6;
        } else {
          const maxHr = Math.max(175, act.maxHr || 185);
          const pctHr = (avg / maxHr) * 100;
          if (pctHr < 68) z = 1;
          else if (pctHr <= 79) z = 2;
          else if (pctHr <= 87) z = 3;
          else if (pctHr <= 93) z = 4;
          else if (pctHr <= 97) z = 5;
          else z = 6;
        }
        rawZones.push(z);
        zoneCounts[z - 1]++;
      }

      const totalB = Math.max(1, rawZones.length);
      const zoneSharesPct = zoneCounts.map((c) => Math.round((c / totalB) * 100)) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const highZoneShare =
        zoneSharesPct[2] + zoneSharesPct[3] + zoneSharesPct[4] + zoneSharesPct[5];
      const slices: EffortSlice[] = rawZones.map((z) => {
        const info = zoneInfoForIndex(z);
        return {
          zone: info.zone,
          widthPct: 100 / totalB,
          heightPct: info.heightPct,
          color: info.color,
        };
      });

      return {
        mode: highZoneShare >= 12 ? 'skyline' : 'steady-bar',
        slices,
        zoneSharesPct,
        hasStructuredWork: highZoneShare >= 15,
      };
    }
  }

  // 2. Otherwise inspect zoneSecs.power (preferred for cycling if non-empty) or zoneSecs.hr
  const pZones = act.zoneSecs?.power || [];
  const hZones = act.zoneSecs?.hr || [];
  const pSum = pZones.reduce((acc, v) => acc + (v || 0), 0);
  const hSum = hZones.reduce((acc, v) => acc + (v || 0), 0);

  const raw6 = [0, 0, 0, 0, 0, 0];
  if (pSum > 60) {
    raw6[0] = pZones[0] || 0;
    raw6[1] = pZones[1] || 0;
    raw6[2] = pZones[2] || 0;
    raw6[3] = pZones[3] || 0;
    raw6[4] = pZones[4] || 0;
    raw6[5] = (pZones[5] || 0) + (pZones[6] || 0);
  } else if (hSum > 60) {
    raw6[0] = hZones[0] || 0;
    raw6[1] = hZones[1] || 0;
    raw6[2] = hZones[2] || 0;
    raw6[3] = hZones[3] || 0;
    raw6[4] = hZones[4] || 0;
    raw6[5] = (hZones[5] || 0) + (hZones[6] || 0);
  } else {
    // Synthesize zone distribution from intensityFactor / avgPower / avgHr / workout name
    const pwr = act.normalizedPower || act.avgPower || 0;
    const ifVal =
      act.intensityFactor ||
      (pwr > 0 ? pwr / ftp : act.avgHr > 0 ? act.avgHr / 175 : 0.65);
    const isRaceOrIntervalName =
      /race|interval|track|threshold|tempo|vo2|chapman|stonegrinder|crit|zwift\s*-\s*race/i.test(
        act.name
      );

    if (isRaceOrIntervalName || ifVal >= 0.88) {
      raw6[0] = 12;
      raw6[1] = 28;
      raw6[2] = 24;
      raw6[3] = 22;
      raw6[4] = 10;
      raw6[5] = 4;
    } else if (ifVal >= 0.76) {
      raw6[0] = 15;
      raw6[1] = 48;
      raw6[2] = 25;
      raw6[3] = 10;
      raw6[4] = 2;
      raw6[5] = 0;
    } else {
      raw6[0] = 28;
      raw6[1] = 68;
      raw6[2] = 4;
      raw6[3] = 0;
      raw6[4] = 0;
      raw6[5] = 0;
    }
  }

  const totalSecs = Math.max(1, raw6.reduce((a, b) => a + b, 0));
  const zoneSharesPct = raw6.map((v) => Math.round((v / totalSecs) * 100)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const highIntensityPct =
    zoneSharesPct[2] + zoneSharesPct[3] + zoneSharesPct[4] + zoneSharesPct[5];
  const veryHighPct = zoneSharesPct[3] + zoneSharesPct[4] + zoneSharesPct[5];
  const isSteadyCommuteOrBase =
    highIntensityPct < 14 &&
    veryHighPct < 8 &&
    !/race|interval|track|chapman|stonegrinder|crit|vo2|threshold/i.test(act.name);

  if (isSteadyCommuteOrBase) {
    // Steady bar mode (like "San Jose Cycling", "San Jose Walking", "HIIT", "Zwift - Going Coastal in Watopia")
    // Show a clean dominant Z1/Z2 bar across the width, plus any small Z3/Z4 tail accent on the right
    const slices: EffortSlice[] = [];
    const z1z2Share = Math.max(85, zoneSharesPct[0] + zoneSharesPct[1]);
    const dominantZone: 1 | 2 = zoneSharesPct[0] > zoneSharesPct[1] * 1.4 ? 1 : 2;
    const domInfo = zoneInfoForIndex(dominantZone);

    if (highIntensityPct >= 4) {
      const accentZone: 3 | 4 = zoneSharesPct[3] >= zoneSharesPct[2] ? 4 : 3;
      const accentInfo = zoneInfoForIndex(accentZone);
      const accentWidth = Math.min(18, Math.max(6, highIntensityPct));
      slices.push({
        zone: domInfo.zone,
        widthPct: 100 - accentWidth,
        heightPct: domInfo.heightPct,
        color: domInfo.color,
      });
      slices.push({
        zone: accentInfo.zone,
        widthPct: accentWidth,
        heightPct: accentInfo.heightPct,
        color: accentInfo.color,
      });
    } else {
      slices.push({
        zone: domInfo.zone,
        widthPct: Math.min(100, z1z2Share + 15),
        heightPct: domInfo.heightPct,
        color: domInfo.color,
      });
    }

    return {
      mode: 'steady-bar',
      slices,
      zoneSharesPct,
      hasStructuredWork: highIntensityPct >= 6,
    };
  }

  // Skyline mode (like "Zwift - Chapman's Peak in Video", "Zwift - Race: Stonegrinder Series", "San Jose Track Running")
  // Build a realistic 20-slice chronological workout progression whose zone counts match `zoneSharesPct`
  const numSlices = 20;
  const countsPerZone = zoneSharesPct.map((pct) =>
    Math.max(0, Math.round((pct / 100) * numSlices))
  );
  let sumCounts = countsPerZone.reduce((a, b) => a + b, 0);
  while (sumCounts < numSlices) {
    countsPerZone[1]++;
    sumCounts++;
  }
  while (sumCounts > numSlices) {
    const maxIdx = countsPerZone.indexOf(Math.max(...countsPerZone));
    if (countsPerZone[maxIdx] > 1) {
      countsPerZone[maxIdx]--;
      sumCounts--;
    } else {
      break;
    }
  }

  // Arrange slices into a physiological session structure:
  // Warmup (Z1/Z2) -> Main Set (interleaving Z3/Z4/Z5/Z6 peaks with Z2/Z1 valleys) -> Cooldown (Z2/Z1)
  const z1Pool = Array(countsPerZone[0]).fill(1) as (1 | 2 | 3 | 4 | 5 | 6)[];
  const z2Pool = Array(countsPerZone[1]).fill(2) as (1 | 2 | 3 | 4 | 5 | 6)[];
  const workPool: (1 | 2 | 3 | 4 | 5 | 6)[] = [
    ...Array(countsPerZone[2]).fill(3),
    ...Array(countsPerZone[3]).fill(4),
    ...Array(countsPerZone[4]).fill(5),
    ...Array(countsPerZone[5]).fill(6),
  ];

  const orderedZones: (1 | 2 | 3 | 4 | 5 | 6)[] = [];
  // Warmup: take 1-2 from Z1 and 1-2 from Z2
  if (z1Pool.length > 0) orderedZones.push(z1Pool.pop()!);
  if (z2Pool.length > 0) orderedZones.push(z2Pool.pop()!);
  if (z2Pool.length > 1) orderedZones.push(z2Pool.pop()!);

  // Reserve 1 Z2 and 1 Z1 for cooldown
  const cooldown: (1 | 2 | 3 | 4 | 5 | 6)[] = [];
  if (z1Pool.length > 0) cooldown.unshift(z1Pool.pop()!);
  if (z2Pool.length > 0) cooldown.unshift(z2Pool.pop()!);

  const easyRemaining = [...z2Pool, ...z1Pool];

  // If it's a track run or interval workout, alternate work blocks and recovery valleys
  const isTrackOrIntervals = /track|interval|repeat|vo2|hiit/i.test(act.name);
  if (isTrackOrIntervals && workPool.length >= 3 && easyRemaining.length >= 2) {
    // Sort workPool so highest zones are in the middle-to-late main set
    workPool.sort((a, b) => b - a);
    while (workPool.length > 0 || easyRemaining.length > 0) {
      if (workPool.length > 0) orderedZones.push(workPool.shift()!);
      if (workPool.length > 0 && easyRemaining.length === 0) {
        orderedZones.push(workPool.shift()!);
      }
      if (easyRemaining.length > 0) orderedZones.push(easyRemaining.shift()!);
    }
  } else {
    // Progressive build / race profile (like Chapman's Peak or Stonegrinder Series)
    workPool.sort((a, b) => a - b);
    const halfEasy = Math.ceil(easyRemaining.length / 2);
    orderedZones.push(...easyRemaining.slice(0, halfEasy));
    orderedZones.push(...workPool);
    orderedZones.push(...easyRemaining.slice(halfEasy));
  }

  orderedZones.push(...cooldown);

  // Compress adjacent identical zones into clean proportional skyline blocks
  const mergedSlices: EffortSlice[] = [];
  const unitW = 100 / Math.max(1, orderedZones.length);
  for (const z of orderedZones) {
    const info = zoneInfoForIndex(z);
    const prev = mergedSlices[mergedSlices.length - 1];
    if (prev && prev.zone === info.zone && !isTrackOrIntervals) {
      prev.widthPct += unitW;
    } else {
      mergedSlices.push({
        zone: info.zone,
        widthPct: unitW,
        heightPct: info.heightPct,
        color: info.color,
      });
    }
  }

  return {
    mode: 'skyline',
    slices: mergedSlices,
    zoneSharesPct,
    hasStructuredWork: true,
  };
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  activities,
  wellnessDays,
  plannedEvents,
  targetGoals = [],
  envFilter,
  selectedSport,
  onSelectSport,
  distanceUnit,
  athleteFtp,
  athleteProfile,
  onSelectActivity,
  onCreatePlannedEvent,
  onDeletePlannedEvent,
  onBatchCreatePlannedEvents,
  onOpenTodayWorkout,
  onOpenAthleteProfileModal,
  onOpenGoalsArchitect,
  onOpenOfficialRaceModal,
  onOpenCoachWithPrompt,
}) => {
  const [sportFilter, setSportFilter] = useState<SportCategory | 'ALL'>(selectedSport);
  useEffect(() => {
    setSportFilter(selectedSport);
  }, [selectedSport]);

  const [cardDensity, setCardDensity] = useState<'intervals' | 'compact'>('intervals');
  const [mobileLayout, setMobileLayout] = useState<'agenda' | 'grid'>('agenda');
  const [showDayEffortStripe, setShowDayEffortStripe] = useState<boolean>(true);
  const [hoveredPrescription, setHoveredPrescription] = useState<{
    dateStr: string;
    stripe: DayPlannedEffortStripe;
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Default to the month of the most recent activity or wellness entry
  const initialDate = useMemo(() => {
    if (activities.length > 0) {
      const latestStr = activities[0].startDateLocal.slice(0, 10);
      const [y, m] = latestStr.split('-').map(Number);
      if (y && m) return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [activities]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);

  // Workout Builder Modal State
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);

  useEffect(() => {
    if (!isBuilderOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsBuilderOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBuilderOpen]);

  const [builderDate, setBuilderDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [builderName, setBuilderName] = useState('4x8m Sweet Spot Progression');
  const [builderSport, setBuilderSport] = useState<SportCategory>('Cycling');
  const [builderEnv, setBuilderEnv] = useState<'OUTDOOR' | 'INDOOR' | 'FLEXIBLE'>('FLEXIBLE');
  const [builderSyntax, setBuilderSyntax] = useState(
    `- 15m 60% FTP Warmup\n- 8m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 92% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 92% FTP Sweet Spot\n- 10m 55% FTP Cooldown`
  );
  const [builderNotes, setBuilderNotes] = useState(
    'Maintain smooth 90+ rpm cadence. Abort final interval if cardiac decoupling exceeds 5%.'
  );
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);

  const parsedBuilderSteps = useMemo(() => parseWorkoutSteps(builderSyntax), [builderSyntax]);

  const computedBuilderSummary = useMemo(() => {
    if (parsedBuilderSteps.length === 0) {
      return { durationSecs: 3600, load: 65 };
    }
    const totalMins = parsedBuilderSteps.reduce((acc, s) => acc + s.durationMins, 0);
    const weightedIf =
      parsedBuilderSteps.reduce(
        (acc, s) => acc + s.durationMins * Math.pow(s.intensityPct / 100, 2),
        0
      ) / Math.max(1, totalMins);
    const estimatedTss = Math.round((totalMins / 60) * weightedIf * 100);
    return {
      durationSecs: totalMins * 60,
      load: Math.max(10, estimatedTss),
    };
  }, [parsedBuilderSteps]);

  // Index wellness by date
  const wellnessByDate = useMemo(() => {
    const map = new Map<string, UnifiedWellnessDay>();
    for (const w of wellnessDays) {
      map.set(w.date, w);
    }
    return map;
  }, [wellnessDays]);

  const activeSportFilter = sportFilter;

  // Index filtered activities by YYYY-MM-DD (sorted chronologically within each day)
  const activitiesByDate = useMemo(() => {
    const map = new Map<string, UnifiedActivity[]>();
    for (const act of activities) {
      if (envFilter !== 'COMBINED' && act.environment !== envFilter) continue;
      if (activeSportFilter !== 'ALL' && act.sportCategory !== activeSportFilter) continue;
      const dateStr = act.startDateLocal.slice(0, 10);
      const list = map.get(dateStr) || [];
      list.push(act);
      map.set(dateStr, list);
    }
    for (const [k, list] of map.entries()) {
      list.sort(
        (a, b) =>
          new Date(a.startDateLocal).getTime() - new Date(b.startDateLocal).getTime()
      );
      map.set(k, list);
    }
    return map;
  }, [activities, envFilter, activeSportFilter]);

  // Index planned workouts by YYYY-MM-DD
  const plannedByDate = useMemo(() => {
    const map = new Map<string, PlannedWorkoutEvent[]>();
    for (const ev of plannedEvents) {
      if (activeSportFilter !== 'ALL' && ev.sportCategory !== activeSportFilter) continue;
      const dateStr = ev.date.slice(0, 10);
      const list = map.get(dateStr) || [];
      list.push(ev);
      map.set(dateStr, list);
    }
    return map;
  }, [plannedEvents, activeSportFilter]);

  // Build Monday-aligned weeks for the active month
  const calendarWeeks = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);

    // Day of week: Monday = 0 ... Sunday = 6
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const endOffset = (7 - ((lastDayOfMonth.getDay() + 6) % 7) - 1 + 7) % 7;

    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
    const gridEnd = new Date(viewYear, viewMonth + 1, endOffset);

    const weeks: {
      weekIndex: number;
      isoWeekNum: number;
      days: {
        dateStr: string;
        dayNumber: number;
        isCurrentMonth: boolean;
        wellness?: UnifiedWellnessDay;
        dayActivities: UnifiedActivity[];
        dayPlanned: PlannedWorkoutEvent[];
      }[];
      totalDurationSecs: number;
      totalDistanceMeters: number;
      totalElevationMeters: number;
      totalLoad: number;
      totalKcal: number;
      endOfWeekWellness?: UnifiedWellnessDay;
      ramp7d: number;
      bySport: {
        sport: SportCategory;
        timeSecs: number;
        distanceMeters: number;
        load: number;
      }[];
      weekZoneSharesPct: [number, number, number, number, number, number];
      weekZoneLabel: string;
      weekZoneRatio: string;
    }[] = [];

    const cursor = new Date(gridStart);
    let weekIdx = 0;

    while (cursor <= gridEnd) {
      const days = [];
      let totalDurationSecs = 0;
      let totalDistanceMeters = 0;
      let totalElevationMeters = 0;
      let totalLoad = 0;
      let totalKcal = 0;
      let endOfWeekWellness: UnifiedWellnessDay | undefined;
      let startOfWeekWellness: UnifiedWellnessDay | undefined;

      const sportTotals = new Map<
        SportCategory,
        { timeSecs: number; distanceMeters: number; load: number }
      >();
      const weekZoneSecs = [0, 0, 0, 0, 0, 0];

      for (let d = 0; d < 7; d++) {
        const yyyy = cursor.getFullYear();
        const mm = String(cursor.getMonth() + 1).padStart(2, '0');
        const dd = String(cursor.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const isCurrentMonth = cursor.getMonth() === viewMonth;

        const wellness = wellnessByDate.get(dateStr);
        if (wellness) {
          if (!startOfWeekWellness) startOfWeekWellness = wellness;
          endOfWeekWellness = wellness;
        }
        const dayActivities = activitiesByDate.get(dateStr) || [];
        const dayPlanned = plannedByDate.get(dateStr) || [];

        for (const a of dayActivities) {
          totalDurationSecs += a.movingTimeSecs || 0;
          totalDistanceMeters += a.distanceMeters || 0;
          totalElevationMeters += a.elevationGainMeters || 0;
          totalLoad += a.trainingLoad || 0;

          // Estimate kcal from mechanical work or duration/HR
          const pwr = a.avgPower || a.normalizedPower || 0;
          const actKcal =
            pwr > 0
              ? Math.round((pwr * a.movingTimeSecs) / 1000)
              : Math.round((a.movingTimeSecs / 60) * 9.5);
          totalKcal += actKcal;

          const curSport = sportTotals.get(a.sportCategory) || {
            timeSecs: 0,
            distanceMeters: 0,
            load: 0,
          };
          curSport.timeSecs += a.movingTimeSecs || 0;
          curSport.distanceMeters += a.distanceMeters || 0;
          curSport.load += a.trainingLoad || 0;
          sportTotals.set(a.sportCategory, curSport);

          const pres = buildActivityEffortPresentation(a, athleteFtp, athleteProfile);
          for (let z = 0; z < 6; z++) {
            weekZoneSecs[z] += (pres.zoneSharesPct[z] / 100) * (a.movingTimeSecs || 0);
          }
        }

        days.push({
          dateStr,
          dayNumber: cursor.getDate(),
          isCurrentMonth,
          wellness,
          dayActivities,
          dayPlanned,
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      const isoWeekNum = getIsoWeekNumber(days[0].dateStr);
      const ramp7d =
        endOfWeekWellness && startOfWeekWellness
          ? Number((endOfWeekWellness.ctl - startOfWeekWellness.ctl).toFixed(1))
          : endOfWeekWellness?.rampRate || 0;

      const bySportOrder: SportCategory[] = ['Cycling', 'Running', 'Swimming', 'Strength'];
      const bySport = bySportOrder
        .filter((s) => sportTotals.has(s))
        .map((s) => ({
          sport: s,
          ...sportTotals.get(s)!,
        }));

      const totalWeekZoneSecs = Math.max(
        1,
        weekZoneSecs.reduce((acc, v) => acc + v, 0)
      );
      const weekZoneSharesPct = weekZoneSecs.map((v) =>
        Math.round((v / totalWeekZoneSecs) * 100)
      ) as [number, number, number, number, number, number];

      const baseShare = weekZoneSharesPct[0] + weekZoneSharesPct[1];
      const tempoThreshShare = weekZoneSharesPct[2] + weekZoneSharesPct[3];
      const vo2AnaerobicShare = weekZoneSharesPct[4] + weekZoneSharesPct[5];

      let weekZoneLabel = 'Base';
      if (vo2AnaerobicShare >= 15 && baseShare >= 68) {
        weekZoneLabel = 'Polarized';
      } else if (tempoThreshShare >= 22) {
        weekZoneLabel = 'Threshold';
      } else if (baseShare >= 85) {
        weekZoneLabel = 'Base';
      } else if (totalLoad > 0) {
        weekZoneLabel = 'Pyramidal';
      }

      const ratioNum =
        tempoThreshShare + vo2AnaerobicShare > 0
          ? (baseShare / Math.max(12, tempoThreshShare + vo2AnaerobicShare)).toFixed(2)
          : '1.80';

      weeks.push({
        weekIndex: weekIdx++,
        isoWeekNum,
        days,
        totalDurationSecs,
        totalDistanceMeters,
        totalElevationMeters,
        totalLoad,
        totalKcal,
        endOfWeekWellness,
        ramp7d,
        bySport,
        weekZoneSharesPct,
        weekZoneLabel,
        weekZoneRatio: ratioNum,
      });
    }

    return weeks;
  }, [
    viewYear,
    viewMonth,
    wellnessByDate,
    activitiesByDate,
    plannedByDate,
    athleteFtp,
    athleteProfile,
  ]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToday = () => {
    if (activities.length > 0) {
      const latestStr = activities[0].startDateLocal.slice(0, 10);
      const [y, m] = latestStr.split('-').map(Number);
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
        return;
      }
    }
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const handleOpenBuilderForDate = (
    dateStr: string,
    prefill?: {
      name: string;
      sportCategory: SportCategory;
      workoutSyntax: string;
    }
  ) => {
    setBuilderDate(dateStr);
    if (prefill) {
      setBuilderName(prefill.name);
      setBuilderSport(prefill.sportCategory);
      setBuilderSyntax(prefill.workoutSyntax);
    }
    setIsBuilderOpen(true);
  };

  const handleSubmitWorkoutBuilder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWorkout(true);
    try {
      await onCreatePlannedEvent({
        date: builderDate,
        name: builderName,
        sportCategory: builderSport,
        environmentPreference: builderEnv,
        plannedDurationSecs: computedBuilderSummary.durationSecs,
        plannedLoad: computedBuilderSummary.load,
        workoutSyntax: builderSyntax,
        description: builderNotes,
      });
      setIsBuilderOpen(false);
    } finally {
      setIsSavingWorkout(false);
    }
  };

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const getSportHeaderColor = (sport: SportCategory) => {
    if (sport === 'Cycling') return 'bg-[#0066CC] text-white';
    if (sport === 'Running') return 'bg-[#16A34A] text-white';
    if (sport === 'Swimming') return 'bg-[#0891B2] text-white';
    return 'bg-[#6B6661] dark:bg-[#57534E] text-white';
  };

  const getSportIcon = (sport: SportCategory, className = 'w-3.5 h-3.5') => {
    if (sport === 'Cycling') return <Bike className={className} />;
    if (sport === 'Running') return <Footprints className={className} />;
    if (sport === 'Swimming') return <Waves className={className} />;
    return <Dumbbell className={className} />;
  };

  const primaryObjective = useMemo(() => {
    const aRace = targetGoals.find((g) => g.priority === 'A-Race') || targetGoals[0];
    if (aRace) {
      const daysOut = Math.max(
        7,
        Math.round(
          (new Date(`${aRace.targetDate}T00:00:00Z`).getTime() - Date.now()) / 86400000
        )
      );
      const weeksOut = Math.max(1, Math.round(daysOut / 7));
      const phase =
        weeksOut <= 2
          ? 'Peak & Taper'
          : weeksOut % 4 === 0
            ? 'Deload Week (-30%)'
            : weeksOut <= 6
              ? 'Specific Build'
              : 'Aerobic Base';
      const pct = Math.min(
        98,
        Math.max(20, Math.round((aRace.currentValue / Math.max(1, aRace.targetValue)) * 100))
      );
      const isPaceGoal =
        /pace|sec\/km|s\/km|min\/mi|min\/km/i.test(aRace.unit || '') ||
        /pace/i.test(aRace.title || '');
      const currentStr = isPaceGoal
        ? formatPaceWithUnit(aRace.currentValue, distanceUnit)
        : `${aRace.currentValue} ${aRace.unit}`;
      const targetStr = isPaceGoal
        ? formatPaceWithUnit(aRace.targetValue, distanceUnit)
        : `${aRace.targetValue} ${aRace.unit}`;
      return {
        title: aRace.title,
        sport: aRace.sportCategory,
        targetDate: aRace.targetDate,
        weeksOut,
        daysOut,
        phase,
        currentStr,
        targetStr,
        pct,
      };
    }
    const curFtp = athleteProfile?.ftp || athleteFtp || 295;
    return {
      title: '350W Cycling FTP & Sub-20:00 5K Hybrid Peak',
      sport: 'Cycling' as SportCategory,
      targetDate: '2027-02-01',
      weeksOut: 12,
      daysOut: 84,
      phase: 'Specific Build (Wk 4 Deload Active)',
      currentStr: `${curFtp}W FTP`,
      targetStr: '350W FTP',
      pct: Math.min(98, Math.round((curFtp / 350) * 100)),
    };
  }, [targetGoals, athleteProfile, athleteFtp, distanceUnit]);

  return (
    <div className="space-y-4">
      {/* Primary Objective & Block Phase Ribbon */}
      <section className="rounded-2xl liquid-glass px-4 py-3 border border-blue-500/25 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-mono font-bold uppercase tracking-wider">
            Primary Goal Glance
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                {primaryObjective.title}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono font-bold">
                {primaryObjective.phase}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                · {primaryObjective.weeksOut} wks ({primaryObjective.daysOut}d) to target
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-36 sm:w-48 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  style={{ width: `${primaryObjective.pct}%` }}
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"
                />
              </div>
              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                {primaryObjective.currentStr} → <strong>{primaryObjective.targetStr}</strong> (
                {primaryObjective.pct}%)
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenTodayWorkout && (
            <button
              type="button"
              onClick={onOpenTodayWorkout}
              className="min-h-[32px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl liquid-glass-subtle hover:border-sky-500/40 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <span>Today&apos;s Readiness &amp; Workout →</span>
            </button>
          )}
          {onOpenGoalsArchitect && (
            <button
              type="button"
              onClick={onOpenGoalsArchitect}
              className="min-h-[32px] inline-flex items-center gap-1.5 px-3.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Training Block &amp; Race Goals →</span>
            </button>
          )}
        </div>
      </section>

      {/* Top Calendar Header & Controls */}
      <section className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <CalendarIcon className="w-4 h-4 text-blue-500" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </h1>
            <ChartInfoTooltip
              title="Training Calendar & Activity Effort Zones"
              subtitle="Weekly Load Architecture, Morning Readiness & Intra-Workout Zone Skyline"
              whatItMeasures="Combines your weekly physiological summary on the left (Total Time, Training Load, Fitness CTL, Fatigue ATL, Form TSB, and Sport Breakdown) with daily morning autonomic metrics (Sleep, Resting HR, HRV) and individual activity cards displaying the effort zones (Z1–Z6+) through each workout."
              benchmarks="Polarized / Base Weeks: 75–85% of weekly duration in Z1–Z2 (Teal-Green) and 15–20% in Z4–Z6 (Orange/Red/Purple). Threshold Weeks: >20% in Z3–Z4. Steady Z2 rides display a smooth green bar; interval, race, and track workouts display a multi-color effort skyline."
              coachingAction="Scan down the left Week column to verify progressive overload (Ramp +2 to +5 CTL/wk), then inspect each day's Effort Zone strips to ensure easy recovery days stay strictly in Z1/Z2 green so hard interval days can hit deep Z4/Z5/Z6 peaks."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sport Category Filter Pills */}
            <div className="flex items-center gap-0.5 p-1 rounded-xl liquid-capsule-track">
              {(['ALL', 'Cycling', 'Running', 'Swimming', 'Strength'] as const).map((sp) => {
                const active = activeSportFilter === sp;
                return (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => {
                      setSportFilter(sp);
                      onSelectSport?.(sp);
                    }}
                    className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      active
                        ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {sp === 'ALL' ? 'All Sports' : sp}
                  </button>
                );
              })}
            </div>

            {/* Month Switcher */}
            <div className="flex items-center gap-1 rounded-xl liquid-capsule-track p-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="min-h-[30px] px-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleJumpToday}
                className="min-h-[30px] px-2.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="min-h-[30px] px-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                title="Next Month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {onOpenOfficialRaceModal && (
              <button
                type="button"
                onClick={onOpenOfficialRaceModal}
                className="min-h-[34px] inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 transition-colors whitespace-nowrap"
                title="Log official track or road race results"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Log Race</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleOpenBuilderForDate(todayIso)}
              className="min-h-[34px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Schedule</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `Review my ${MONTH_NAMES[viewMonth]} ${viewYear} training calendar, weekly load progression, and effort zone distribution. Propose 2 structured workouts for this week.`
                )
              }
              className="min-h-[34px] inline-flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-sky-300 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Review</span>
            </button>
          </div>
        </div>

        {/* Compact Effort Zone Swatches & Card Density Toggle */}
        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">
              Zones:
            </span>
            {INTERVALS_EFFORT_ZONES.map((z) => (
              <span
                key={z.code}
                className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-mono text-[10px]"
                title={`${z.code}: ${z.name}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{ backgroundColor: z.color }}
                />
                <strong className="text-slate-900 dark:text-white">{z.code}</strong>
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Mobile View Mode Toggle (Agenda vs 8-Column Grid) */}
            <div className="flex md:hidden items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[10px]">
              <button
                type="button"
                onClick={() => setMobileLayout('agenda')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  mobileLayout === 'agenda'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Agenda
              </button>
              <button
                type="button"
                onClick={() => setMobileLayout('grid')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  mobileLayout === 'grid'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Full Grid
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowDayEffortStripe((v) => !v)}
              className={`px-2 py-0.5 rounded-lg border text-[10px] font-semibold transition-all inline-flex items-center gap-1.5 ${
                showDayEffortStripe
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-sky-300'
                  : 'border-slate-300/70 dark:border-slate-700/70 text-slate-500 dark:text-slate-400'
              }`}
              title="Toggle daily planned workout Effort Stripes"
            >
              <span>Stripes: {showDayEffortStripe ? 'On' : 'Off'}</span>
            </button>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[10px]">
              <button
                type="button"
                onClick={() => setCardDensity('intervals')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  cardDensity === 'intervals'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Detailed
              </button>
              <button
                type="button"
                onClick={() => setCardDensity('compact')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  cardDensity === 'compact'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Compact
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Mobile Week & Day Agenda View (< md when mobileLayout === 'agenda') */}
      {mobileLayout === 'agenda' && (
        <section className="md:hidden space-y-3">
          {calendarWeeks.map((week) => {
            const eow = week.endOfWeekWellness;
            const tsbVal = eow ? Math.round(eow.tsb) : null;
            const activeDays = week.days.filter(
              (d) =>
                d.isCurrentMonth ||
                d.dayActivities.length > 0 ||
                d.dayPlanned.length > 0 ||
                d.dateStr === todayIso
            );
            if (activeDays.length === 0) return null;

            return (
              <div
                key={`mob-wk-${week.weekIndex}`}
                className="rounded-2xl liquid-glass overflow-hidden border border-slate-200/90 dark:border-slate-800/90"
              >
                {/* Mobile Week Summary Header */}
                <div className="p-3 bg-slate-100/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-extrabold font-mono">
                        W{week.isoWeekNum}
                      </span>
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                        {formatHeaderDate(week.days[0].dateStr)} –{' '}
                        {formatHeaderDate(week.days[6].dateStr)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCoachWithPrompt(
                          `Analyze Week ${week.isoWeekNum} (${week.days[0].dateStr} to ${week.days[6].dateStr}): Total time ${formatCompactDuration(week.totalDurationSecs)}, Load ${week.totalLoad}, Fitness ${eow ? Math.round(eow.ctl) : '-'}, Form ${tsbVal ?? '-'}, Zone focus ${week.weekZoneLabel}.`
                        )
                      }
                      className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-sky-400 text-[11px] font-semibold"
                    >
                      AI Coach
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono">
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[9px] uppercase text-slate-400 block">Time</span>
                      <strong className="text-slate-900 dark:text-white">
                        {week.totalDurationSecs > 0
                          ? formatCompactDuration(week.totalDurationSecs)
                          : '0m'}
                      </strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[9px] uppercase text-slate-400 block">Load</span>
                      <strong className="text-slate-900 dark:text-white">{week.totalLoad}</strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[9px] uppercase text-slate-400 block">CTL</span>
                      <strong className="text-[#7C3AED] dark:text-purple-400">
                        {eow ? Math.round(eow.ctl) : '—'}
                      </strong>
                    </div>
                    <div className="px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
                      <span className="text-[9px] uppercase text-slate-400 block">Form</span>
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {tsbVal !== null ? (tsbVal > 0 ? `+${tsbVal}` : tsbVal) : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Mobile Daily Cards */}
                <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                  {activeDays.map((day) => {
                    const isToday = day.dateStr === todayIso;
                    const dayStripe = buildDayPlannedEffortStripe(
                      day.dateStr,
                      day.dayPlanned,
                      day.wellness,
                      day.dayActivities
                    );
                    const w = day.wellness;
                    const sleepH =
                      w && w.sleepSecs > 0 ? `${(w.sleepSecs / 3600).toFixed(1)}h` : null;

                    return (
                      <div
                        key={`mob-day-${day.dateStr}`}
                        className={`p-3 space-y-2 ${
                          isToday
                            ? 'bg-sky-500/[0.06] dark:bg-sky-500/[0.08]'
                            : !day.isCurrentMonth
                              ? 'bg-slate-100/70 dark:bg-slate-900/60'
                              : 'bg-white/75 dark:bg-slate-950/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-xs font-bold font-mono ${
                                isToday
                                  ? 'px-2 py-0.5 rounded-md bg-blue-600 text-white'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {formatHeaderDate(day.dateStr)}
                            </span>
                            {w && (
                              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                {sleepH && <span>{sleepH}</span>}
                                {w.restingHR > 0 && <span>{w.restingHR}bpm</span>}
                                {w.hrvRMSSD > 0 && (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    {Math.round(w.hrvRMSSD)}ms
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenBuilderForDate(day.dateStr, {
                                name: dayStripe.workoutName,
                                sportCategory: dayStripe.sportCategory,
                                workoutSyntax: dayStripe.workoutSyntax,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-semibold"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Plan</span>
                          </button>
                        </div>

                        {/* Planned Effort Stripe */}
                        {showDayEffortStripe && (
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenBuilderForDate(day.dateStr, {
                                name: dayStripe.workoutName,
                                sportCategory: dayStripe.sportCategory,
                                workoutSyntax: dayStripe.workoutSyntax,
                              })
                            }
                            className="w-full text-left rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-2 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                                {dayStripe.sportCategory === 'Running' ? 'Run' : 'Bike'} Rx:{' '}
                                {dayStripe.workoutName}
                              </span>
                              <span
                                className="font-mono font-bold shrink-0"
                                style={{ color: dayStripe.dominantZone.color }}
                              >
                                {dayStripe.dominantZone.code} · {dayStripe.totalDurationMins}m
                              </span>
                            </div>
                            <div className="h-3 w-full flex items-end gap-[1px] rounded-xs bg-slate-200/50 dark:bg-slate-800/60 px-0.5 pt-0.5 overflow-hidden">
                              {dayStripe.steps.map((s, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    width: `${s.widthPct}%`,
                                    height: `${s.heightPct}%`,
                                    backgroundColor: s.color,
                                  }}
                                  className="rounded-t-[1px]"
                                />
                              ))}
                            </div>
                          </button>
                        )}

                        {/* Completed Activities */}
                        {day.dayActivities.map((act) => {
                          const effort = buildActivityEffortPresentation(
                            act,
                            athleteFtp,
                            athleteProfile
                          );
                          return (
                            <div
                              key={`mob-act-${act.id}`}
                              onClick={() => onSelectActivity(act)}
                              className="cursor-pointer rounded-xl overflow-hidden border border-slate-300/90 dark:border-slate-700/90 bg-white dark:bg-[#1E222B] shadow-xs"
                            >
                              <div
                                className={`px-2.5 py-1.5 flex items-center justify-between gap-2 ${getSportHeaderColor(
                                  act.sportCategory
                                )}`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 text-xs font-bold truncate">
                                  {getSportIcon(act.sportCategory, 'w-3.5 h-3.5 shrink-0')}
                                  <span className="truncate">{act.name}</span>
                                </div>
                                <span className="text-[11px] font-mono font-extrabold shrink-0">
                                  {formatCompactDuration(act.movingTimeSecs)} · Load{' '}
                                  {act.trainingLoad}
                                </span>
                              </div>
                              <div className="p-2 flex items-center justify-between gap-3 text-[11px] font-mono text-slate-700 dark:text-slate-200">
                                <span>
                                  {act.distanceMeters > 0
                                    ? formatDistance(act.distanceMeters, distanceUnit, 1)
                                    : act.subType}
                                </span>
                                <div className="flex items-center gap-2">
                                  {(act.normalizedPower || act.avgPower) && (
                                    <span className="font-bold text-blue-600 dark:text-sky-400">
                                      {act.normalizedPower || act.avgPower}W
                                    </span>
                                  )}
                                  {act.avgHr && (
                                    <span className="text-rose-600 dark:text-rose-400">
                                      {act.avgHr}bpm
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="px-2 pb-2">
                                <div className="h-3.5 w-full flex items-end gap-[1px] bg-slate-100 dark:bg-slate-900/70 rounded-xs overflow-hidden">
                                  {effort.slices.map((sl, sIdx) => (
                                    <div
                                      key={sIdx}
                                      style={{
                                        width: `${sl.widthPct}%`,
                                        height: `${sl.heightPct}%`,
                                        backgroundColor: sl.color,
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Explicitly Scheduled Planned Events */}
                        {day.dayPlanned.map((ev) => (
                          <div
                            key={`mob-plan-${ev.id}`}
                            className="rounded-xl border border-dashed border-blue-500/45 bg-blue-500/[0.05] p-2.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono uppercase text-blue-600 dark:text-sky-400 font-semibold">
                                Planned · {ev.sportCategory} ·{' '}
                                {formatCompactDuration(ev.plannedDurationSecs)} · ~{ev.plannedLoad}{' '}
                                TSS
                              </div>
                              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {ev.name}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onDeletePlannedEvent(ev.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-500"
                              title="Delete planned workout"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Intervals.icu 8-Column Calendar Grid (Left Week Summary Column + 7 Day Columns) */}
      <section
        className={`${
          mobileLayout === 'agenda' ? 'hidden md:block' : 'block'
        } rounded-2xl liquid-glass overflow-hidden border border-slate-200/90 dark:border-slate-800/90`}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[1140px]">
            {/* Sticky 8-Column Day Header Row */}
            <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/90 text-[10px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400">
              <div className="px-3 py-2.5 border-r border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span>WEEK</span>
                <span className="font-mono text-[9px] text-slate-400">CTL / TSB</span>
              </div>
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="px-2.5 py-2.5 border-r last:border-r-0 border-slate-200 dark:border-slate-800 text-center"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Week Rows */}
            <div className="divide-y divide-slate-300/80 dark:divide-slate-800">
              {calendarWeeks.map((week) => {
                const eow = week.endOfWeekWellness;
                const tsbVal = eow ? Math.round(eow.tsb) : null;
                const tsbColorClass =
                  tsbVal === null
                    ? 'text-slate-500'
                    : tsbVal >= 5
                      ? 'text-[#0284C7] dark:text-sky-400'
                      : tsbVal >= -10
                        ? 'text-slate-600 dark:text-slate-300'
                        : tsbVal >= -30
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400';

                return (
                  <div
                    key={week.weekIndex}
                    className="grid grid-cols-8 min-h-[210px] bg-white/60 dark:bg-slate-950/40"
                  >
                    {/* COLUMN 1 (LEFT): STREAMLINED WEEKLY SUMMARY COLUMN */}
                    <div className="p-3 border-r border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 flex flex-col justify-between space-y-2.5 text-[11px]">
                      <div className="space-y-2">
                        {/* Week Number Title */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                            W{week.isoWeekNum}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenCoachWithPrompt(
                                `Analyze Week ${week.isoWeekNum} (${week.days[0].dateStr} to ${week.days[6].dateStr}): Total time ${formatCompactDuration(week.totalDurationSecs)}, Load ${week.totalLoad}, Fitness ${eow ? Math.round(eow.ctl) : '-'}, Fatigue ${eow ? Math.round(eow.atl) : '-'}, Form ${tsbVal ?? '-'}, Zone focus ${week.weekZoneLabel}.`
                              )
                            }
                            className="text-[10px] font-semibold text-blue-600 dark:text-sky-400 hover:underline"
                            title="Ask AI Coach about this week"
                          >
                            Coach
                          </button>
                        </div>

                        {/* 4 Core Weekly Metrics: Time, Load, CTL, Form */}
                        <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 text-[11px] leading-snug">
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">Time</span>
                            <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatCompactDuration(week.totalDurationSecs)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">Load</span>
                            <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                              {week.totalLoad}
                            </span>
                          </div>

                          {eow && (
                            <>
                              <div className="flex items-baseline justify-between gap-1">
                                <span className="text-slate-500 dark:text-slate-400">CTL</span>
                                <span className="font-mono font-bold tabular-nums text-[#0284C7] dark:text-sky-400">
                                  {Math.round(eow.ctl)}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between gap-1">
                                <span className="text-slate-500 dark:text-slate-400">Form</span>
                                <span
                                  className={`font-mono font-bold tabular-nums ${tsbColorClass}`}
                                >
                                  {tsbVal !== null && tsbVal > 0 ? `+${tsbVal}` : tsbVal}
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Per-Sport Time / Dist / Load Table (matching Intervals.icu screenshot) */}
                        {week.bySport.length > 0 && (
                          <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
                            <div className="grid grid-cols-12 text-[10px] text-slate-400 dark:text-slate-500 pb-1 font-medium">
                              <span className="col-span-2" />
                              <span className="col-span-4 text-right">Time</span>
                              <span className="col-span-3 text-right">Dist</span>
                              <span className="col-span-3 text-right">Load</span>
                            </div>
                            <div className="space-y-1 font-mono tabular-nums text-[10px]">
                              {week.bySport.map((row) => (
                                <div
                                  key={row.sport}
                                  className="grid grid-cols-12 items-center text-slate-700 dark:text-slate-200"
                                >
                                  <span className="col-span-2 text-[#0284C7] dark:text-sky-400 flex items-center">
                                    {getSportIcon(row.sport, 'w-3 h-3')}
                                  </span>
                                  <span className="col-span-4 text-right font-medium">
                                    {formatCompactDuration(row.timeSecs)}
                                  </span>
                                  <span className="col-span-3 text-right text-slate-600 dark:text-slate-300">
                                    {row.distanceMeters > 100
                                      ? formatDistance(row.distanceMeters, distanceUnit, 0)
                                      : '-'}
                                  </span>
                                  <span className="col-span-3 text-right font-semibold">
                                    {row.load}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Weekly Zone Classification & Mini Effort Distribution Bar */}
                      {week.totalDurationSecs > 0 && (
                        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 dark:text-slate-400">Zones</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                              {week.weekZoneLabel} {week.weekZoneRatio}
                            </span>
                          </div>
                          <div
                            className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800"
                            title={`Weekly Effort Zone Mix: Z1 ${week.weekZoneSharesPct[0]}% · Z2 ${week.weekZoneSharesPct[1]}% · Z3 ${week.weekZoneSharesPct[2]}% · Z4 ${week.weekZoneSharesPct[3]}% · Z5+ ${week.weekZoneSharesPct[4] + week.weekZoneSharesPct[5]}%`}
                          >
                            {week.weekZoneSharesPct.map((pct, zIdx) =>
                              pct > 0 ? (
                                <div
                                  key={zIdx}
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: INTERVALS_EFFORT_ZONES[zIdx].color,
                                  }}
                                  className="h-full"
                                />
                              ) : null
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* COLUMNS 2–8: MONDAY THROUGH SUNDAY CELLS */}
                    {week.days.map((cell) => {
                      const isToday = cell.dateStr === todayIso;
                      const w = cell.wellness;
                      const dayLoadSum = cell.dayActivities.reduce(
                        (acc, a) => acc + (a.trainingLoad || 0),
                        0
                      );
                      const sleepHm = w && w.sleepSecs > 0 ? formatSleepHm(w.sleepSecs) : '';
                      const plannedStripe = buildDayPlannedEffortStripe(
                        cell.dateStr,
                        cell.dayPlanned,
                        w,
                        cell.dayActivities
                      );
                      const plannedZoneBreakdownTooltip = INTERVALS_EFFORT_ZONES.map((z, idx) =>
                        plannedStripe.zoneSharesPct[idx] > 0
                          ? `${z.code} (${z.name}): ${plannedStripe.zoneSharesPct[idx]}%`
                          : null
                      )
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <div
                          key={cell.dateStr}
                          className={`p-2 border-r last:border-r-0 border-slate-200 dark:border-slate-800 flex flex-col justify-between transition-colors group ${
                            !cell.isCurrentMonth
                              ? 'bg-slate-200/55 dark:bg-slate-950/80'
                              : isToday
                                ? 'bg-blue-50/40 dark:bg-blue-950/20'
                                : 'hover:bg-slate-50/60 dark:hover:bg-slate-900/30'
                          }`}
                        >
                          <div className="space-y-2">
                            {/* Day Header + Compact Morning Wellness Strip + Planned Workout Effort Stripe */}
                            <div className="space-y-1 text-center border-b border-slate-200/60 dark:border-slate-800/60 pb-1.5">
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className="text-[9px] font-mono font-bold px-1 py-0.2 rounded-xs leading-tight"
                                  style={{
                                    backgroundColor: `${plannedStripe.dominantZone.color}22`,
                                    color: plannedStripe.dominantZone.color,
                                  }}
                                  title={`Planned Target Zone: ${plannedStripe.dominantZone.code} ${plannedStripe.dominantZone.name}`}
                                >
                                  {plannedStripe.dominantZone.code}
                                </span>
                                <span
                                  className={`text-[11px] font-mono ${
                                    isToday
                                      ? 'font-bold text-blue-600 dark:text-sky-400'
                                      : 'font-medium text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {formatIntervalsDayHeader(cell.dateStr)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenBuilderForDate(cell.dateStr, {
                                      name: plannedStripe.workoutName,
                                      sportCategory: plannedStripe.sportCategory,
                                      workoutSyntax: plannedStripe.workoutSyntax,
                                    })
                                  }
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-opacity"
                                  title={`Schedule or edit planned workout on ${cell.dateStr}`}
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>

                              {/* SMALL DIMENSIONAL DAILY PLANNED WORKOUT EFFORT SKYLINE (With Y-Axis Amplitude & Hover Tooltip) */}
                              {showDayEffortStripe && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenBuilderForDate(cell.dateStr, {
                                      name: plannedStripe.workoutName,
                                      sportCategory: plannedStripe.sportCategory,
                                      workoutSyntax: plannedStripe.workoutSyntax,
                                    })
                                  }
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
                                    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
                                    const cardW = 310;
                                    let left = rect.left + rect.width / 2 - cardW / 2;
                                    if (left + cardW > vw - 12) left = vw - cardW - 12;
                                    if (left < 12) left = 12;
                                    let top = rect.bottom + 6;
                                    if (top + 230 > vh - 12 && rect.top > 240) {
                                      top = rect.top - 225;
                                    }
                                    setHoveredPrescription({
                                      dateStr: cell.dateStr,
                                      stripe: plannedStripe,
                                      top,
                                      left,
                                      width: cardW,
                                    });
                                  }}
                                  onMouseLeave={() =>
                                    setHoveredPrescription((prev) =>
                                      prev?.dateStr === cell.dateStr ? null : prev
                                    )
                                  }
                                  className="w-full text-left group/stripe rounded-xs overflow-hidden border border-slate-200/80 dark:border-slate-800/80 hover:border-blue-500/60 transition-colors focus:outline-hidden"
                                  title={`${plannedStripe.sportCategory} (${
                                    plannedStripe.source === 'SCHEDULED'
                                      ? 'Scheduled Workout'
                                      : 'Daily Prescription'
                                  }): ${plannedStripe.workoutName} (${plannedStripe.totalDurationMins}m · ~${plannedStripe.plannedLoad} TSS)\n${plannedStripe.description}\nZones: ${plannedZoneBreakdownTooltip}`}
                                >
                                  {/* Dimensional Mini Effort Skyline with Y-Axis Amplitude */}
                                  <div className="relative h-[18px] w-full flex items-stretch bg-slate-100/90 dark:bg-slate-900/90">
                                    {/* Mini Y-Axis Amplitude Scale Gutter */}
                                    <div className="w-[14px] shrink-0 border-r border-slate-300/70 dark:border-slate-700/70 flex flex-col justify-between items-end pr-[2px] py-[1px] text-[6.5px] leading-none font-mono text-slate-400 dark:text-slate-500 select-none">
                                      <span>100</span>
                                      <span>50</span>
                                    </div>
                                    {/* Proportional Effort Amplitude Bars */}
                                    <div className="relative flex-1 flex items-end px-[1px] pt-[2px]">
                                      {/* 100% FTP / Threshold Reference Dashed Line */}
                                      <div
                                        className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/45 dark:border-slate-500/45"
                                        style={{ bottom: '74%' }}
                                      />
                                      {plannedStripe.steps.map((st, sIdx) => (
                                        <div
                                          key={sIdx}
                                          style={{
                                            width: `${st.widthPct}%`,
                                            height: `${st.heightPct}%`,
                                            backgroundColor: st.color,
                                          }}
                                          className="border-r last:border-r-0 border-white/25 dark:border-slate-950/35 rounded-t-[1px] transition-all"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  {/* Compact Micro Label with Cycling / Running Modality Icon */}
                                  <div className="flex items-center justify-between gap-1 px-1 py-0.5 bg-slate-100/80 dark:bg-slate-900/80 group-hover/stripe:bg-blue-500/10 border-t border-slate-200/60 dark:border-slate-800/60 transition-colors">
                                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-slate-600 dark:text-slate-300 truncate min-w-0">
                                      {plannedStripe.sportCategory === 'Running' ? (
                                        <Footprints className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <Bike className="w-2.5 h-2.5 text-blue-600 dark:text-sky-400 shrink-0" />
                                      )}
                                      <span className="truncate">
                                        {plannedStripe.workoutName}
                                      </span>
                                    </span>
                                    <span className="text-[9px] font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                                      {plannedStripe.totalDurationMins}m
                                    </span>
                                  </div>
                                </button>
                              )}

                              {/* Line 1 of Morning Wellness: Sleep duration + score + weight */}
                              {w && (sleepHm || w.sleepScore > 0 || w.weightKg > 0) && (
                                <div className="flex flex-wrap items-center justify-center gap-x-1 text-[10px] font-mono tabular-nums leading-tight pt-0.5">
                                  {sleepHm && (
                                    <span className="inline-flex items-center gap-0.5 text-slate-700 dark:text-slate-300 font-semibold">
                                      <Moon className="w-2.5 h-2.5 text-slate-800 dark:text-slate-200 fill-current" />
                                      <span>{sleepHm}</span>
                                    </span>
                                  )}
                                  {w.sleepScore > 0 && (
                                    <span
                                      className={`font-bold ${
                                        w.sleepScore >= 80
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : w.sleepScore >= 65
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-rose-600 dark:text-rose-400'
                                      }`}
                                    >
                                      {w.sleepScore}
                                    </span>
                                  )}
                                  {w.sleepQuality && (
                                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                      Q{w.sleepQuality}
                                    </span>
                                  )}
                                  {w.weightKg > 0 && (
                                    <span className="text-slate-400 dark:text-slate-500">
                                      {distanceUnit === 'mi'
                                        ? `${Math.round(w.weightKg * 2.20462)}lbs`
                                        : `${w.weightKg.toFixed(1)}kg`}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Line 2 of Morning Wellness: Resting HR + HRV + Day Load */}
                              {w && (w.restingHR > 0 || w.hrvRMSSD > 0 || dayLoadSum > 0) && (
                                <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-[10px] font-mono tabular-nums leading-tight">
                                  {(w.restingHR > 0 || w.hrvRMSSD > 0) && (
                                    <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400 font-semibold">
                                      <Heart className="w-2.5 h-2.5 fill-current" />
                                      {w.restingHR > 0 && <span>{w.restingHR}</span>}
                                      {w.hrvRMSSD > 0 && <span>{w.hrvRMSSD} ms</span>}
                                    </span>
                                  )}
                                  {dayLoadSum > 0 && (
                                    <span className="text-slate-600 dark:text-slate-300 font-semibold">
                                      Load {dayLoadSum}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Completed Activity Cards with Effort Zones Through Each Activity */}
                            <div className="space-y-2">
                              {cell.dayActivities.map((act) => {
                                const effort = buildActivityEffortPresentation(
                                  act,
                                  athleteFtp,
                                  athleteProfile
                                );
                                const isVirtualRide =
                                  act.sportCategory === 'Cycling' &&
                                  (act.environment === 'INDOOR' ||
                                    act.subType === 'Virtual Cycling' ||
                                    act.subType === 'Smart Trainer' ||
                                    /zwift|trainer|virtual|watopia|makuri/i.test(act.name));

                                const powerVal = act.avgPower || act.normalizedPower || 0;
                                const paceLabel =
                                  act.sportCategory === 'Running' && act.avgPaceSecsPerKm
                                    ? formatPaceWithUnit(act.avgPaceSecsPerKm, distanceUnit)
                                    : '';
                                const gapLabel =
                                  act.sportCategory === 'Running' &&
                                  act.gapPaceSecsPerKm &&
                                  Math.abs(act.gapPaceSecsPerKm - (act.avgPaceSecsPerKm || 0)) >= 3
                                    ? formatPaceWithUnit(act.gapPaceSecsPerKm, distanceUnit)
                                    : '';

                                const zoneTooltip = INTERVALS_EFFORT_ZONES.map(
                                  (z, idx) => `${z.code}: ${effort.zoneSharesPct[idx]}%`
                                ).join(' · ');

                                return (
                                  <button
                                    key={act.id}
                                    type="button"
                                    onClick={() => onSelectActivity(act)}
                                    className="w-full text-left rounded-lg bg-white dark:bg-slate-900/95 border border-slate-300/85 dark:border-slate-700/85 shadow-xs hover:shadow-md hover:border-blue-500/70 transition-all overflow-hidden flex flex-col"
                                  >
                                    {/* 1. Sport-Colored Top Bar (or Gold Championship Bar for Official FAT Races) */}
                                    <div
                                      className={`px-2 py-1 flex items-center justify-between gap-1 text-[11px] font-bold font-mono tabular-nums ${
                                        act.officialRaceData
                                          ? 'bg-[#D97706] text-white'
                                          : getSportHeaderColor(act.sportCategory)
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-1 min-w-0">
                                        {act.officialRaceData ? (
                                          <Trophy className="w-3.5 h-3.5 shrink-0" />
                                        ) : (
                                          getSportIcon(act.sportCategory, 'w-3.5 h-3.5 shrink-0')
                                        )}
                                        <span>
                                          {act.officialRaceData
                                            ? `${act.officialRaceData.eventLabel} · ${act.officialRaceData.displayFatTime}`
                                            : formatCompactDuration(act.movingTimeSecs)}
                                        </span>
                                      </span>
                                      {act.officialRaceData ? (
                                        <span className="text-[9px] uppercase tracking-wider px-1 rounded bg-black/25">
                                          {act.officialRaceData.platform}
                                        </span>
                                      ) : act.distanceMeters > 100 ? (
                                        <span className="truncate">
                                          {formatDistance(act.distanceMeters, distanceUnit, 1)}
                                        </span>
                                      ) : isVirtualRide ? (
                                        <span className="text-[9px] uppercase tracking-wider px-1 rounded bg-white/20">
                                          Virtual
                                        </span>
                                      ) : null}
                                    </div>

                                    {/* 2. Centered Physiological Telemetry Readout */}
                                    {cardDensity === 'intervals' && (
                                      <div className="px-1.5 pt-1.5 pb-1 text-center space-y-0.5 font-mono tabular-nums">
                                        {act.officialRaceData && (
                                          <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                            {act.officialRaceData.placeFinish || 'Official FAT'} · VDOT{' '}
                                            {act.officialRaceData.vdotScore.toFixed(1)}
                                          </div>
                                        )}
                                        <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-[11px] font-bold leading-tight">
                                          {act.avgHr > 0 && (
                                            <span className="text-[#B91C1C] dark:text-rose-400">
                                              {act.avgHr}bpm
                                            </span>
                                          )}
                                          {powerVal > 0 && (
                                            <span className="text-[#4338CA] dark:text-indigo-300">
                                              {powerVal}W
                                            </span>
                                          )}
                                          {paceLabel && (
                                            <span className="text-[#1D4ED8] dark:text-sky-300">
                                              {paceLabel}
                                            </span>
                                          )}
                                        </div>

                                          <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-tight">
                                            <span>Load {act.trainingLoad}</span>
                                            {(() => {
                                              const targetMins = Math.max(
                                                20,
                                                plannedStripe.totalDurationMins || 45
                                              );
                                              const actualMins = Math.max(
                                                1,
                                                Math.round(act.movingTimeSecs / 60)
                                              );
                                              const durRatio =
                                                Math.min(actualMins, targetMins) /
                                                Math.max(actualMins, targetMins);
                                              const compliancePct = Math.min(
                                                99,
                                                Math.max(72, Math.round(74 + durRatio * 24))
                                              );
                                              return (
                                                <span
                                                  className={`px-1 py-0.2 rounded-xs text-[9px] font-mono ${
                                                    compliancePct >= 88
                                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                                  }`}
                                                  title={`Planned vs. Actual Execution Compliance: ${compliancePct}% compliance against ${plannedStripe.workoutName} (${plannedStripe.sportCategory})`}
                                                >
                                                  {compliancePct}% Compliance
                                                </span>
                                              );
                                            })()}
                                          </div>

                                          {gapLabel && (
                                            <div className="text-[10px] font-bold text-[#4338CA] dark:text-indigo-300 leading-tight">
                                              GAP {gapLabel}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                    {/* 3. Dimensional Effort Zones Skyline Through the Activity (With Y-Axis Amplitude) */}
                                    <div
                                      className="w-full px-0.5 pt-1"
                                      title={`Completed Effort Zones (${act.sportCategory}) — ${zoneTooltip}`}
                                    >
                                      <div className="relative h-[22px] w-full flex items-stretch bg-slate-100/75 dark:bg-slate-800/45 rounded-xs overflow-hidden">
                                        {/* Small Y-Axis Amplitude Scale */}
                                        <div className="w-[13px] shrink-0 border-r border-slate-300/60 dark:border-slate-700/60 flex flex-col justify-between items-end pr-[1.5px] py-[1px] text-[6px] leading-none font-mono text-slate-400 dark:text-slate-500 select-none">
                                          <span>Z5</span>
                                          <span>Z1</span>
                                        </div>
                                        <div className="relative flex-1 flex items-end px-[1px] pt-[2px]">
                                          <div
                                            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/40 dark:border-slate-500/40"
                                            style={{ bottom: '74%' }}
                                          />
                                          {effort.slices.map((s, idx) => (
                                            <div
                                              key={idx}
                                              style={{
                                                width: `${s.widthPct}%`,
                                                height: `${s.heightPct}%`,
                                                backgroundColor: s.color,
                                              }}
                                              className="transition-all border-r last:border-r-0 border-white/15 dark:border-slate-950/25 first:rounded-tl-[1px] last:rounded-tr-[1px]"
                                            />
                                          ))}
                                          {/* Continuous Z2 baseline rule along the bottom */}
                                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2A9D8F]/85" />
                                        </div>
                                      </div>
                                    </div>

                                    {/* 4. Centered Activity Title Footer */}
                                    <div className="px-1.5 py-1.5 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-200/70 dark:border-slate-800/80 text-center flex items-center justify-center gap-1">
                                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 leading-tight line-clamp-2">
                                        {act.name}
                                      </span>
                                      {act.stravaPrCount > 0 ? (
                                        <span
                                          className="inline-flex items-center text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 shrink-0"
                                          title={`${act.stravaPrCount} Strava PR(s)`}
                                        >
                                          <Trophy className="w-2.5 h-2.5" />
                                        </span>
                                      ) : (
                                        <FileText className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 shrink-0 opacity-75" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}

                              {/* Planned Workout Cards with Intervals.icu Effort Stripe & Skyline */}
                              {cell.dayPlanned.map((ev) => {
                                const evStripe = buildDayPlannedEffortStripe(
                                  cell.dateStr,
                                  [ev],
                                  w,
                                  cell.dayActivities
                                );
                                return (
                                  <div
                                    key={ev.id}
                                    className="rounded-lg border border-dashed border-blue-500/60 bg-blue-500/5 dark:bg-blue-500/10 overflow-hidden flex flex-col"
                                  >
                                    {/* Top Intervals.icu Effort Stripe along Planned Card Header */}
                                    <div className="h-[4px] w-full flex">
                                      {evStripe.steps.map((s, i) => (
                                        <div
                                          key={i}
                                          style={{
                                            width: `${s.widthPct}%`,
                                            backgroundColor: s.color,
                                          }}
                                          className="h-full"
                                        />
                                      ))}
                                    </div>

                                    <div className="p-2 space-y-1.5">
                                      <div className="flex items-start justify-between gap-1">
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
                                            <span>Planned · {ev.sportCategory}</span>
                                            <span
                                              className="px-1 rounded-xs text-[9px] font-bold"
                                              style={{
                                                backgroundColor: `${evStripe.dominantZone.color}25`,
                                                color: evStripe.dominantZone.color,
                                              }}
                                            >
                                              {evStripe.dominantZone.code}
                                            </span>
                                          </div>
                                          <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">
                                            {ev.name}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => onDeletePlannedEvent(ev.id)}
                                          className="p-0.5 text-slate-400 hover:text-rose-500 transition-colors"
                                          title="Delete planned workout"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>

                                      {evStripe.steps.length > 0 && (
                                        <div className="relative h-5 w-full flex items-end gap-[1px] pt-0.5 bg-slate-100/60 dark:bg-slate-900/50 px-0.5 rounded-xs overflow-hidden">
                                          {evStripe.steps.map((s, i) => (
                                            <div
                                              key={i}
                                              style={{
                                                width: `${s.widthPct}%`,
                                                height: `${s.heightPct}%`,
                                                backgroundColor: s.color,
                                              }}
                                              className="rounded-t-[1px]"
                                              title={`${s.label} (${s.durationMins}m · ${s.zoneCode})`}
                                            />
                                          ))}
                                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2A9D8F]/80" />
                                        </div>
                                      )}

                                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                        <span>{formatCompactDuration(ev.plannedDurationSecs)}</span>
                                        <span>Load ~{ev.plannedLoad}</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="pt-1" />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Intervals.icu Text-Syntax Structured Workout Builder Modal */}
      {isBuilderOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setIsBuilderOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl liquid-glass p-6 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
                  Structured Workout Builder
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  Schedule Planned Session for {builderDate}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsBuilderOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitWorkoutBuilder} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Workout Title
                  </label>
                  <input
                    type="text"
                    required
                    value={builderName}
                    onChange={(e) => setBuilderName(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={builderDate}
                    onChange={(e) => setBuilderDate(e.target.value)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Sport Category
                  </label>
                  <select
                    value={builderSport}
                    onChange={(e) => setBuilderSport(e.target.value as SportCategory)}
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="Cycling">Cycling</option>
                    <option value="Running">Running</option>
                    <option value="Swimming">Swimming</option>
                    <option value="Strength">Strength</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Environment Preference
                  </label>
                  <select
                    value={builderEnv}
                    onChange={(e) =>
                      setBuilderEnv(e.target.value as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE')
                    }
                    className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="FLEXIBLE">Flexible (Outdoor or Indoor)</option>
                    <option value="OUTDOOR">Outdoor Only</option>
                    <option value="INDOOR">Indoor (Smart Trainer / Treadmill)</option>
                  </select>
                </div>
              </div>

              {/* Quick Workout Templates */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Presets:</span>
                {[
                  {
                    label: 'Z2 Aerobic Endurance (90m)',
                    name: '90m Z2 Aerobic Base',
                    syntax: `- 10m 55% FTP Warmup\n- 70m 70% FTP Z2 Endurance\n- 10m 55% FTP Cooldown`,
                  },
                  {
                    label: '4x8m Sweet Spot',
                    name: '4x8m Sweet Spot Progression',
                    syntax: `- 15m 60% FTP Warmup\n- 8m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 92% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 8m 92% FTP Sweet Spot\n- 10m 55% FTP Cooldown`,
                  },
                  {
                    label: '5x4m VO2max Intervals',
                    name: '5x4m VO2max Ceiling',
                    syntax: `- 15m 60% FTP Warmup\n- 4m 112% FTP VO2max\n- 4m 50% FTP Recovery\n- 4m 112% FTP VO2max\n- 4m 50% FTP Recovery\n- 4m 114% FTP VO2max\n- 4m 50% FTP Recovery\n- 4m 114% FTP VO2max\n- 4m 50% FTP Recovery\n- 4m 115% FTP VO2max\n- 10m 50% FTP Cooldown`,
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setBuilderName(preset.name);
                      setBuilderSyntax(preset.syntax);
                    }}
                    className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Workout Steps (one step per line starting with <code>-</code>)
                  </label>
                  <span className="text-[11px] font-mono text-blue-600 dark:text-sky-400">
                    Est. {Math.round(computedBuilderSummary.durationSecs / 60)}m ·{' '}
                    {computedBuilderSummary.load} TSS (FTP {athleteFtp}W)
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={builderSyntax}
                  onChange={(e) => setBuilderSyntax(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Live Visual Step Profile Preview */}
              {parsedBuilderSteps.length > 0 && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                  <div className="text-[11px] font-mono text-slate-500 flex items-center justify-between">
                    <span>Live Effort Zone Skyline Preview</span>
                    <span>
                      {parsedBuilderSteps.length} steps ·{' '}
                      {Math.round(computedBuilderSummary.durationSecs / 60)} min total
                    </span>
                  </div>
                  <div className="h-16 w-full flex items-end gap-1 pt-2">
                    {parsedBuilderSteps.map((s, idx) => (
                      <div
                        key={idx}
                        style={{
                          flex: s.durationMins,
                          height: `${Math.min(100, Math.max(20, (s.intensityPct / 130) * 100))}%`,
                          backgroundColor: s.zoneColor,
                        }}
                        className="rounded-t transition-all relative group"
                        title={`${s.label} (${s.durationMins}m @ ${s.intensityPct}%)`}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Execution &amp; Pacing Notes
                </label>
                <input
                  type="text"
                  value={builderNotes}
                  onChange={(e) => setBuilderNotes(e.target.value)}
                  className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsBuilderOpen(false)}
                  className="min-h-[38px] px-4 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingWorkout}
                  className="min-h-[38px] px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                >
                  {isSavingWorkout ? 'Saving...' : 'Save to Calendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Instant Floating Hover Tooltip for Daily Prescribed Workout Stripes */}
      {hoveredPrescription &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: `${hoveredPrescription.top}px`,
              left: `${hoveredPrescription.left}px`,
              width: `${hoveredPrescription.width}px`,
              zIndex: 9999,
            }}
            className="pointer-events-none rounded-2xl liquid-glass p-3.5 shadow-2xl border border-slate-300/90 dark:border-slate-700/90 text-xs space-y-2.5 animate-in fade-in duration-100"
          >
            {/* Header: Sport Badge (Cycling vs. Running) + Date */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/80 pb-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                  hoveredPrescription.stripe.sportCategory === 'Running'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35'
                    : 'bg-blue-500/15 text-blue-700 dark:text-sky-300 border border-blue-500/35'
                }`}
              >
                {hoveredPrescription.stripe.sportCategory === 'Running' ? (
                  <Footprints className="w-3 h-3" />
                ) : (
                  <Bike className="w-3 h-3" />
                )}
                <span>
                  {hoveredPrescription.stripe.sportCategory}{' '}
                  {hoveredPrescription.stripe.source === 'SCHEDULED'
                    ? 'Scheduled Workout'
                    : 'Prescription'}
                </span>
              </span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {hoveredPrescription.dateStr}
              </span>
            </div>

            {/* Workout Title, Duration, Target Load & Dominant Zone */}
            <div>
              <div className="font-bold text-slate-900 dark:text-white text-[13px] leading-snug">
                {hoveredPrescription.stripe.workoutName}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] font-mono">
                <span className="text-slate-700 dark:text-slate-200 font-semibold">
                  {hoveredPrescription.stripe.totalDurationMins} min
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-blue-600 dark:text-sky-400 font-semibold">
                  ~{hoveredPrescription.stripe.plannedLoad} TSS
                </span>
                <span className="text-slate-400">·</span>
                <span
                  className="px-1.5 py-0.2 rounded text-[10px] font-bold"
                  style={{
                    backgroundColor: `${hoveredPrescription.stripe.dominantZone.color}22`,
                    color: hoveredPrescription.stripe.dominantZone.color,
                  }}
                >
                  {hoveredPrescription.stripe.dominantZone.code}{' '}
                  {hoveredPrescription.stripe.dominantZone.name}
                </span>
              </div>
            </div>

            {/* Plain-English Prescription Description */}
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              {hoveredPrescription.stripe.description}
            </p>

            {/* Dimensional Skyline with Y-Axis (% FTP or % Threshold Pace) */}
            <div className="rounded-lg bg-slate-100/90 dark:bg-slate-900/90 p-2 border border-slate-200/70 dark:border-slate-800/70 space-y-1.5">
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 dark:text-slate-400">
                <span>
                  Y-Axis Amplitude:{' '}
                  {hoveredPrescription.stripe.sportCategory === 'Running'
                    ? '% Threshold Pace'
                    : '% FTP'}
                </span>
                <span>Click stripe to edit</span>
              </div>
              <div className="relative h-8 w-full flex items-stretch">
                <div className="w-7 shrink-0 border-r border-slate-300/70 dark:border-slate-700/70 flex flex-col justify-between items-end pr-1 text-[8px] font-mono text-slate-400">
                  <span>100%</span>
                  <span>50%</span>
                </div>
                <div className="relative flex-1 flex items-end gap-[1px] pl-1">
                  <div
                    className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/50"
                    style={{ bottom: '74%' }}
                  />
                  {hoveredPrescription.stripe.steps.map((st, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: `${st.widthPct}%`,
                        height: `${st.heightPct}%`,
                        backgroundColor: st.color,
                      }}
                      className="rounded-t-[2px]"
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Step-by-Step Intervals Breakdown */}
            <div className="space-y-1 pt-0.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                Prescribed Structure ({hoveredPrescription.stripe.steps.length} steps)
              </div>
              <div className="space-y-0.5 max-h-28 overflow-hidden">
                {hoveredPrescription.stripe.steps.slice(0, 6).map((st, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 text-[10.5px] font-mono"
                  >
                    <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 truncate">
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: st.color }}
                      />
                      <span className="truncate">{st.label}</span>
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">
                      {st.durationMins}m · {st.intensityPct}% ({st.zoneCode})
                    </span>
                  </div>
                ))}
                {hoveredPrescription.stripe.steps.length > 6 && (
                  <div className="text-[10px] font-mono text-slate-400 italic">
                    +{hoveredPrescription.stripe.steps.length - 6} more interval steps…
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
