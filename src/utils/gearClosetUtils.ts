import type {
  AthleteGearItem,
  DistanceUnit,
  TrackFootwearClass,
  UnifiedActivity,
} from '../types';

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KM = 1000;

export interface FootwearClassSpec {
  id: TrackFootwearClass;
  label: string;
  shortLabel: string;
  defaultMaxMiles: number;
  defaultMaxMeters: number;
}

export const TRACK_FOOTWEAR_CLASS_SPECS: Record<TrackFootwearClass, FootwearClassSpec> = {
  DAILY_TRAINER: {
    id: 'DAILY_TRAINER',
    label: 'Daily Trainer',
    shortLabel: 'Daily Trainer',
    defaultMaxMiles: 450,
    defaultMaxMeters: Math.round(450 * METERS_PER_MILE),
  },
  LIGHTWEIGHT_FLAT_SUPER_TRAINER: {
    id: 'LIGHTWEIGHT_FLAT_SUPER_TRAINER',
    label: 'Super Trainer',
    shortLabel: 'Super Trainer',
    defaultMaxMiles: 300,
    defaultMaxMeters: Math.round(300 * METERS_PER_MILE),
  },
  CARBON_ROAD_RACER: {
    id: 'CARBON_ROAD_RACER',
    label: 'Carbon Racer',
    shortLabel: 'Carbon Racer',
    defaultMaxMiles: 175,
    defaultMaxMeters: Math.round(175 * METERS_PER_MILE),
  },
  TRADITIONAL_TRACK_SPIKE: {
    id: 'TRADITIONAL_TRACK_SPIKE',
    label: 'Track Spike',
    shortLabel: 'Track Spike',
    defaultMaxMiles: 120,
    defaultMaxMeters: Math.round(120 * METERS_PER_MILE),
  },
  CARBON_SUPER_SPIKE: {
    id: 'CARBON_SUPER_SPIKE',
    label: 'Carbon Super Spike',
    shortLabel: 'Super Spike',
    defaultMaxMiles: 80,
    defaultMaxMeters: Math.round(80 * METERS_PER_MILE),
  },
};

export const TRACK_FOOTWEAR_CLASS_LIST: FootwearClassSpec[] = [
  TRACK_FOOTWEAR_CLASS_SPECS.DAILY_TRAINER,
  TRACK_FOOTWEAR_CLASS_SPECS.LIGHTWEIGHT_FLAT_SUPER_TRAINER,
  TRACK_FOOTWEAR_CLASS_SPECS.CARBON_ROAD_RACER,
  TRACK_FOOTWEAR_CLASS_SPECS.TRADITIONAL_TRACK_SPIKE,
  TRACK_FOOTWEAR_CLASS_SPECS.CARBON_SUPER_SPIKE,
];

export type GearWearStatus = 'HEALTHY' | 'APPROACHING_RETIREMENT' | 'REPLACE_SOON' | 'RETIRED';

export interface GearWearSummary {
  item: AthleteGearItem;
  baselineMeters: number;
  matchedActivityMeters: number;
  matchedActivityCount: number;
  totalMeters: number;
  maxRecommendedMeters: number;
  wearRatio: number;
  wearPct: number;
  status: GearWearStatus;
  statusLabel: string;
}

export function getDefaultMaxRecommendedMeters(
  type: 'SHOE' | 'BIKE',
  footwearClass: TrackFootwearClass = 'DAILY_TRAINER'
): number {
  if (type === 'BIKE') {
    return Math.round(5000 * METERS_PER_MILE);
  }
  return (
    TRACK_FOOTWEAR_CLASS_SPECS[footwearClass]?.defaultMaxMeters ??
    TRACK_FOOTWEAR_CLASS_SPECS.DAILY_TRAINER.defaultMaxMeters
  );
}

export function getFootwearClassLabel(footwearClass?: TrackFootwearClass): string {
  if (!footwearClass) return TRACK_FOOTWEAR_CLASS_SPECS.DAILY_TRAINER.label;
  return TRACK_FOOTWEAR_CLASS_SPECS[footwearClass]?.label ?? TRACK_FOOTWEAR_CLASS_SPECS.DAILY_TRAINER.label;
}

function normalizeGearName(raw?: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function doesActivityMatchGear(
  activity: UnifiedActivity,
  gear: AthleteGearItem
): boolean {
  const actGearId = String(activity.gearId || activity.quickLog?.gearId || '').trim();
  if (actGearId && actGearId === gear.id) {
    return true;
  }

  const actGearName = normalizeGearName(activity.gearName || activity.quickLog?.gearName);
  if (!actGearName) return false;

  const gearName = normalizeGearName(gear.name);
  if (!gearName) return false;
  if (actGearName === gearName) return true;

  const brand = normalizeGearName(gear.brand);
  if (brand && actGearName === `${brand} ${gearName}`) {
    return true;
  }

  return false;
}

export function computeGearWearSummary(
  gear: AthleteGearItem,
  activities: UnifiedActivity[]
): GearWearSummary {
  const baselineMeters = Math.max(0, Number(gear.distanceMeters || 0));
  const fallbackMax = getDefaultMaxRecommendedMeters(
    gear.type,
    gear.footwearClass || 'DAILY_TRAINER'
  );
  const maxRecommendedMeters = Math.max(
    1000,
    Number(gear.maxRecommendedMeters || fallbackMax)
  );

  let matchedActivityMeters = 0;
  let matchedActivityCount = 0;
  for (const act of activities || []) {
    if (!act) continue;
    if (doesActivityMatchGear(act, gear)) {
      matchedActivityMeters += Math.max(0, Number(act.distanceMeters || 0));
      matchedActivityCount += 1;
    }
  }

  const totalMeters = baselineMeters + matchedActivityMeters;
  const wearRatio = totalMeters / maxRecommendedMeters;
  const wearPct = Math.round(wearRatio * 100);

  let status: GearWearStatus = 'HEALTHY';
  let statusLabel = 'Healthy';
  if (gear.retired) {
    status = 'RETIRED';
    statusLabel = 'Retired';
  } else if (wearRatio >= 1.0) {
    status = 'REPLACE_SOON';
    statusLabel = 'Replace Soon';
  } else if (wearRatio >= 0.85) {
    status = 'APPROACHING_RETIREMENT';
    statusLabel = 'Approaching Retirement';
  }

  return {
    item: gear,
    baselineMeters,
    matchedActivityMeters,
    matchedActivityCount,
    totalMeters,
    maxRecommendedMeters,
    wearRatio,
    wearPct,
    status,
    statusLabel,
  };
}

export function computeGearClosetSummaries(
  gearItems: AthleteGearItem[],
  activities: UnifiedActivity[]
): GearWearSummary[] {
  return (gearItems || [])
    .map((item) => computeGearWearSummary(item, activities))
    .sort((a, b) => {
      if (Boolean(a.item.retired) !== Boolean(b.item.retired)) {
        return a.item.retired ? 1 : -1;
      }
      if (Boolean(a.item.primary) !== Boolean(b.item.primary)) {
        return a.item.primary ? -1 : 1;
      }
      return b.wearRatio - a.wearRatio;
    });
}

export function formatGearDistanceValue(
  meters: number,
  unit: DistanceUnit,
  decimals = 1
): string {
  const safe = Math.max(0, Number(meters || 0));
  if (unit === 'mi') {
    return `${(safe / METERS_PER_MILE).toFixed(decimals)} mi`;
  }
  return `${(safe / METERS_PER_KM).toFixed(decimals)} km`;
}

export function metersToDisplayUnitInput(meters: number, unit: DistanceUnit): string {
  const safe = Math.max(0, Number(meters || 0));
  const val = unit === 'mi' ? safe / METERS_PER_MILE : safe / METERS_PER_KM;
  return Number.isInteger(Number(val.toFixed(1)))
    ? String(Math.round(val))
    : val.toFixed(1);
}

export function displayUnitInputToMeters(rawValue: string, unit: DistanceUnit): number {
  const num = Number(rawValue);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * (unit === 'mi' ? METERS_PER_MILE : METERS_PER_KM));
}

export function setPrimaryGearItem(
  items: AthleteGearItem[],
  targetId: string
): AthleteGearItem[] {
  const target = items.find((item) => item.id === targetId);
  if (!target) return items;
  return items.map((item) => {
    if (item.id === targetId) {
      return { ...item, primary: true, retired: false, retiredAt: undefined };
    }
    if (item.type === target.type) {
      return { ...item, primary: false };
    }
    return item;
  });
}

export function toggleRetireGearItem(
  items: AthleteGearItem[],
  targetId: string,
  retiredDateIso: string
): AthleteGearItem[] {
  return items.map((item) => {
    if (item.id !== targetId) return item;
    const nextRetired = !item.retired;
    return {
      ...item,
      retired: nextRetired,
      retiredAt: nextRetired ? retiredDateIso : undefined,
      primary: nextRetired ? false : item.primary,
    };
  });
}

export function upsertGearItem(
  items: AthleteGearItem[],
  nextItem: AthleteGearItem
): AthleteGearItem[] {
  const exists = items.some((item) => item.id === nextItem.id);
  const updated = exists
    ? items.map((item) => (item.id === nextItem.id ? nextItem : item))
    : [nextItem, ...items];

  if (nextItem.primary && !nextItem.retired) {
    return setPrimaryGearItem(updated, nextItem.id);
  }
  return updated;
}
