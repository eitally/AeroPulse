import { DistanceUnit, EnvironmentFilter, UnifiedActivity } from '../types';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

export function formatDistance(meters: number, unit: DistanceUnit, decimals = 1): string {
  if (unit === 'mi') {
    return `${(meters / METERS_PER_MILE).toFixed(decimals)} mi`;
  }
  return `${(meters / METERS_PER_KM).toFixed(decimals)} km`;
}

export function convertMetersToUnit(meters: number, unit: DistanceUnit): number {
  return unit === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

export function convertUnitToMeters(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * METERS_PER_MILE : value * METERS_PER_KM;
}

export function formatPace(secsPerKm: number | undefined, unit: DistanceUnit): string {
  if (!secsPerKm || secsPerKm <= 0) return '—';
  const secs = unit === 'mi' ? Math.round(secsPerKm * 1.609344) : Math.round(secsPerKm);
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${rem.toString().padStart(2, '0')} /${unit}`;
}

export function formatPaceDelta(diffSecsPerKm: number, unit: DistanceUnit): string {
  const scaled = unit === 'mi' ? Math.round(diffSecsPerKm * 1.609344) : Math.round(diffSecsPerKm);
  const sign = scaled > 0 ? '+' : '';
  return `${sign}${scaled}s/${unit}`;
}

export function formatElevation(meters: number | undefined, unit: DistanceUnit): string {
  const m = meters || 0;
  if (unit === 'mi') {
    return `${Math.round(m * 3.28084).toLocaleString()} ft`;
  }
  return `${Math.round(m).toLocaleString()} m`;
}

export function formatWeight(kg: number | undefined, unit: DistanceUnit, decimals = 1): string {
  const valKg = kg || 0;
  if (unit === 'mi') {
    return `${(valKg * 2.20462).toFixed(decimals)} lbs`;
  }
  return `${valKg.toFixed(decimals)} kg`;
}

export function formatGoalMetricValue(
  value: number,
  goalUnit: string,
  distanceUnit: DistanceUnit,
  goalTitle?: string
): string {
  const u = (goalUnit || '').toLowerCase();
  const t = (goalTitle || '').toLowerCase();
  if (
    u === 'sec/km' ||
    u === 'secs/km' ||
    u === 's/km' ||
    u === 'pace' ||
    u === 'min/mi' ||
    u === 'min/km' ||
    t.includes('pace')
  ) {
    return formatPace(value, distanceUnit);
  }
  if (u === 'kg' || u === 'lbs') {
    return formatWeight(value, distanceUnit);
  }
  return `${value} ${goalUnit}`;
}

export function formatDuration(totalSecs: number): string {
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = Math.round(totalSecs % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export function formatStopwatch(totalSecs: number): string {
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = Math.round(totalSecs % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatSleepDuration(totalSecs: number): string {
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.round((totalSecs % 3600) / 60);
  return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
}

export interface AnnualMileageSummary {
  sportCategory: 'Running' | 'Cycling';
  year: number;
  workoutCount: number;
  outdoorCount: number;
  indoorCount: number;
  targetMeters: number;
  outdoorMeters: number;
  indoorMeters: number;
  displayedTotalMeters: number;
  combinedTotalMeters: number;
  proRatedTargetTodayMeters: number;
  deltaVsScheduleMeters: number;
  pctOfAnnualTarget: number;
  outdoorSharePct: number;
  indoorSharePct: number;
  requiredWeeklyMetersRemaining: number;
}

export function computeAnnualMileageSummary(
  sportCategory: 'Running' | 'Cycling',
  targetMeters: number,
  activities: UnifiedActivity[],
  envFilter: EnvironmentFilter,
  yearOverride?: number
): AnnualMileageSummary {
  const now = new Date();
  const targetYear = yearOverride || now.getFullYear();
  const targetYearPrefix = `${targetYear}-`;

  const startOfYear = new Date(Date.UTC(targetYear, 0, 1));
  const dayOfYear = Math.max(
    1,
    Math.min(365, Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1)
  );
  const totalDaysInYear = 365;
  const remainingWeeks = Math.max(1, (totalDaysInYear - dayOfYear) / 7);

  // Strictly filter to the target year (e.g. 2026 YTD) and sport category
  const sportActivities = activities.filter(
    (a) =>
      a.sportCategory === sportCategory &&
      String(a.startDateLocal || '').startsWith(targetYearPrefix)
  );

  const outdoorActs = sportActivities.filter((a) => a.environment === 'OUTDOOR');
  const indoorActs = sportActivities.filter((a) => a.environment === 'INDOOR');

  const outdoorMeters = outdoorActs.reduce((sum, a) => sum + (a.distanceMeters || 0), 0);
  const indoorMeters = indoorActs.reduce((sum, a) => sum + (a.distanceMeters || 0), 0);
  const combinedTotalMeters = outdoorMeters + indoorMeters;

  const displayedTotalMeters =
    envFilter === 'OUTDOOR'
      ? outdoorMeters
      : envFilter === 'INDOOR'
        ? indoorMeters
        : combinedTotalMeters;

  const proRatedTargetTodayMeters = (targetMeters * dayOfYear) / totalDaysInYear;
  const deltaVsScheduleMeters = displayedTotalMeters - proRatedTargetTodayMeters;
  const pctOfAnnualTarget = Math.min(
    100,
    Number(((displayedTotalMeters / Math.max(1, targetMeters)) * 100).toFixed(1))
  );

  const outdoorSharePct =
    combinedTotalMeters > 0 ? Math.round((outdoorMeters / combinedTotalMeters) * 100) : 0;
  const indoorSharePct = combinedTotalMeters > 0 ? 100 - outdoorSharePct : 0;

  const remainingMeters = Math.max(0, targetMeters - displayedTotalMeters);
  const requiredWeeklyMetersRemaining = remainingMeters / remainingWeeks;

  return {
    sportCategory,
    year: targetYear,
    workoutCount: sportActivities.length,
    outdoorCount: outdoorActs.length,
    indoorCount: indoorActs.length,
    targetMeters,
    outdoorMeters,
    indoorMeters,
    displayedTotalMeters,
    combinedTotalMeters,
    proRatedTargetTodayMeters,
    deltaVsScheduleMeters,
    pctOfAnnualTarget,
    outdoorSharePct,
    indoorSharePct,
    requiredWeeklyMetersRemaining,
  };
}
