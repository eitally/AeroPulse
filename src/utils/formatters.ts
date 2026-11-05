import { DistanceUnit, EnvironmentFilter, UnifiedActivity } from '../types';
import { HISTORICAL_YTD_BASE_METERS } from '../data/mockTelemetry';

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
  envFilter: EnvironmentFilter
): AnnualMileageSummary {
  // Day 309 of 365 (Nov 5)
  const dayOfYear = 309;
  const totalDaysInYear = 365;
  const remainingWeeks = Math.max(1, (totalDaysInYear - dayOfYear) / 7);

  const sportActivities = activities.filter((a) => a.sportCategory === sportCategory);
  const recentOutdoor = sportActivities
    .filter((a) => a.environment === 'OUTDOOR')
    .reduce((sum, a) => sum + a.distanceMeters, 0);
  const recentIndoor = sportActivities
    .filter((a) => a.environment === 'INDOOR')
    .reduce((sum, a) => sum + a.distanceMeters, 0);

  const base = HISTORICAL_YTD_BASE_METERS[sportCategory];
  const outdoorMeters = base.outdoorMeters + recentOutdoor;
  const indoorMeters = base.indoorMeters + recentIndoor;
  const combinedTotalMeters = outdoorMeters + indoorMeters;

  const displayedTotalMeters =
    envFilter === 'OUTDOOR' ? outdoorMeters : envFilter === 'INDOOR' ? indoorMeters : combinedTotalMeters;

  const proRatedTargetTodayMeters = (targetMeters * dayOfYear) / totalDaysInYear;
  const deltaVsScheduleMeters = displayedTotalMeters - proRatedTargetTodayMeters;
  const pctOfAnnualTarget = Math.min(100, Number(((displayedTotalMeters / Math.max(1, targetMeters)) * 100).toFixed(1)));

  const outdoorSharePct =
    combinedTotalMeters > 0 ? Math.round((outdoorMeters / combinedTotalMeters) * 100) : 0;
  const indoorSharePct = 100 - outdoorSharePct;

  const remainingMeters = Math.max(0, targetMeters - displayedTotalMeters);
  const requiredWeeklyMetersRemaining = remainingMeters / remainingWeeks;

  return {
    sportCategory,
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
