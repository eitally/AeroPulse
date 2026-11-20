import type {
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import { formatPace } from '../../utils/formatters';
import {
  INTERVALS_EFFORT_ZONES,
  computeAmplitudeHeightPct,
  getIntervalsZoneFromIntensityPct,
  parseWorkoutSteps,
  type ParsedWorkoutStep as ParsedStep,
} from '../../utils/workoutParser';

export interface CalendarDayCell {
  dateStr: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  wellness?: UnifiedWellnessDay;
  dayActivities: UnifiedActivity[];
  dayPlanned: PlannedWorkoutEvent[];
}

export interface CalendarWeekSummary {
  weekIndex: number;
  isoWeekNum: number;
  days: CalendarDayCell[];
  totalDurationSecs: number;
  totalDistanceMeters: number;
  totalElevationMeters: number;
  totalLoad: number;
  totalKcal: number;
  endOfWeekWellness?: UnifiedWellnessDay;
  ramp7d: number;
  bySport: Array<{
    sport: SportCategory;
    timeSecs: number;
    distanceMeters: number;
    load: number;
  }>;
  weekZoneSharesPct: [number, number, number, number, number, number];
  weekZoneLabel: string;
  weekZoneRatio: string;
}

export interface HoveredPrescriptionTooltipData {
  dateStr: string;
  stripe: DayPlannedEffortStripe;
  top: number;
  left: number;
  width: number;
}

export function getSportHeaderColor(sport: SportCategory): string {
  if (sport === 'Cycling') return 'bg-[#0369A1] text-white';
  if (sport === 'Running') return 'bg-[#047857] text-white';
  if (sport === 'Swimming') return 'bg-[#0F766E] text-white';
  if (sport === 'Strength') return 'bg-[#6D28D9] text-white';
  return 'bg-[#33463A] text-white';
}

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

export const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const SHORT_MONTHS = [
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

export const MONTH_NAMES = [
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

export function formatHeaderDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${SHORT_WEEKDAYS[dt.getUTCDay()]}, ${SHORT_MONTHS[m - 1]} ${d}`;
}

export interface DayPlannedEffortStripe {
  source: 'SCHEDULED';
  primaryEvent: PlannedWorkoutEvent;
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
    inkClass: string;
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
 * Builds the color-coded Planned Effort Stripe strictly from explicitly scheduled
 * `PlannedWorkoutEvent`s on that day. Returns `null` when no workout is scheduled.
 */
export function buildDayPlannedEffortStripe(
  _dateStr: string,
  dayPlanned: PlannedWorkoutEvent[],
  _wellness: UnifiedWellnessDay | undefined,
  _dayActivities: UnifiedActivity[]
): DayPlannedEffortStripe | null {
  if (dayPlanned.length === 0) return null;

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
          durationSecs: st.durationSecs || mins * 60,
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
          durationSecs: warmM * 60,
          intensityPct: 54,
          zone: 1,
          zoneCode: zWarm.code,
          zoneColor: zWarm.color,
        },
        {
          label: ev.name,
          durationMins: workM,
          durationSecs: workM * 60,
          intensityPct: mainPct,
          zone: zMain.zone,
          zoneCode: zMain.code,
          zoneColor: zMain.color,
        },
        {
          label: 'Cooldown',
          durationMins: coolM,
          durationSecs: coolM * 60,
          intensityPct: 52,
          zone: 1,
          zoneCode: zWarm.code,
          zoneColor: zWarm.color,
        }
      );
    }
  }

  const rawTotalMins = Math.max(
    0.25,
    stepsRaw.reduce((acc, s) => acc + s.durationMins, 0)
  );
  const totalMins = Math.max(1, Math.round(rawTotalMins));
  const zoneMins = [0, 0, 0, 0, 0, 0];
  for (const s of stepsRaw) {
    zoneMins[s.zone - 1] += s.durationMins;
  }
  const zoneSharesPct = zoneMins.map((m) =>
    Math.round((m / rawTotalMins) * 100)
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
    primaryEvent: primary,
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
      inkClass: domMeta.inkClass,
    },
    steps: stepsRaw.map((s) => {
      const zInfo = getIntervalsZoneFromIntensityPct(s.intensityPct);
      return {
        label: s.label,
        durationMins: s.durationMins,
        intensityPct: s.intensityPct,
        widthPct: (s.durationMins / rawTotalMins) * 100,
        heightPct: computeAmplitudeHeightPct(s.intensityPct, zInfo.heightPct),
        zone: s.zone,
        zoneCode: s.zoneCode,
        color: s.zoneColor,
      };
    }),
    zoneSharesPct,
  };
}

export function getIsoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatIntervalsDayHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wk = SHORT_WEEKDAYS[dt.getUTCDay()];
  const mon = SHORT_MONTHS[m - 1];
  return `${wk} ${String(d).padStart(2, '0')} ${mon}`;
}

export function formatCompactDuration(secs: number): string {
  if (!secs || secs <= 0) return '0m';
  const totalMins = Math.round(secs / 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) {
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${Math.max(1, m)}m`;
}

export function formatSleepHm(secs: number): string {
  if (!secs || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export function formatPaceWithUnit(secsPerKm: number | undefined, unit: DistanceUnit): string {
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

export function zoneInfoForIndex(z: number): {
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
export function buildActivityEffortPresentation(
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
