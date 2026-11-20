import { DistanceUnit, EnvironmentFilter, UnifiedActivity } from '../types';
import { formatSwimPacePer100 } from '../physiology/swimZones';

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

export function formatMultiSportPace(
  secsPerKm: number | undefined,
  unit: DistanceUnit,
  sportCategory?: string,
  subType?: string
): string {
  if (!secsPerKm || secsPerKm <= 0) return '—';
  if (sportCategory === 'Swimming') {
    const secs = Math.max(10, Math.round(secsPerKm / 10));
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')} /100m`;
  }
  if (subType === 'Rowing') {
    const secs = Math.max(20, Math.round(secsPerKm / 2));
    return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')} /500m`;
  }
  return formatPace(secsPerKm, unit);
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
  if (u === 's/100m' || u === 'secs/100m' || u === 'sec/100m') {
    return formatSwimPacePer100(value, distanceUnit);
  }
  if (u === 'kg' || u === 'lbs') {
    const kgValue = u === 'lbs' ? value / 2.20462 : value;
    return formatWeight(kgValue, distanceUnit);
  }
  return `${value} ${goalUnit}`;
}

/**
 * Formats a canonical secs/km pace into a plain `m:ss` clock string in the user's preferred unit
 * (e.g. `250 s/km, 'mi'` -> `'6:42'`, `'km'` -> `'4:10'`).
 */
export function formatPaceClockInput(secsPerKm: number, unit: DistanceUnit): string {
  const safe = Number(secsPerKm);
  if (!Number.isFinite(safe) || safe <= 0) return unit === 'mi' ? '7:30' : '4:40';
  const totalSecs = Math.max(
    60,
    Math.round(unit === 'mi' ? safe * (METERS_PER_MILE / 1000) : safe)
  );
  const mins = Math.floor(totalSecs / 60);
  const rem = totalSecs % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

/**
 * Parses a `mm:ss` pace clock string (e.g. `"7:30"`) or numeric seconds back to canonical `secsPerKm`.
 */
export function parsePaceClockInput(raw: string, unit: DistanceUnit): number | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  const match = clean.match(/^(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
  if (match) {
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
    const totalPerUnit = mins * 60 + secs;
    if (totalPerUnit < 90 || totalPerUnit > 1800) return null;
    return unit === 'mi' ? Math.round(totalPerUnit / (METERS_PER_MILE / 1000)) : Math.round(totalPerUnit);
  }
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && numeric >= 90 && numeric <= 900) {
    return Math.round(numeric);
  }
  return null;
}

export function formatDuration(totalSecs: number): string {
  const rounded = Math.max(0, Math.round(totalSecs));
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export function formatStopwatch(totalSecs: number): string {
  const rounded = Math.max(0, Math.round(totalSecs));
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatSleepDuration(totalSecs: number): string {
  const roundedMins = Math.max(0, Math.round(totalSecs / 60));
  const hrs = Math.floor(roundedMins / 60);
  const mins = roundedMins % 60;
  return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
}

export interface AnnualMileageSummary {
  sportCategory: 'Running' | 'Cycling' | 'Swimming';
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
  sportCategory: 'Running' | 'Cycling' | 'Swimming',
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
  const pctOfAnnualTarget =
    targetMeters > 0
      ? Math.min(
          100,
          Number(((displayedTotalMeters / targetMeters) * 100).toFixed(1))
        )
      : 0;

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
