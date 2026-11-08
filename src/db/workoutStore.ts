import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ActivityInterval,
  ActivityStreamSet,
  AthleteGearItem,
  AthleteProfile,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';

/**
 * Relational Activity Record stored in the `activities` IndexedDB table.
 * High-frequency 1Hz `streams` are decoupled into `activityStreams` to prevent
 * main-table scan bloat while preserving relational schema indexes.
 */
export interface StoredActivityRecord extends Omit<UnifiedActivity, 'streams'> {
  id: string;
  name: string;
  type: SportCategory; // Indexed alias for sportCategory
  start_date: string; // Indexed alias for startDateLocal
  distance: number; // Indexed alias for distanceMeters
  moving_time: number; // Indexed alias for movingTimeSecs
  tss: number; // Indexed alias for trainingLoad
  hasStreams?: boolean;
}

/**
 * High-frequency 1Hz telemetry stream record stored in `activityStreams`.
 */
export interface StoredActivityStreamRecord {
  activityId: string;
  streams: ActivityStreamSet;
  intervals?: ActivityInterval[];
  sampleCount: number;
  updatedAt: string;
}

export interface StoredMetadataRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class WorkoutStoreDatabase extends Dexie {
  activities!: Table<StoredActivityRecord, string>;
  activityStreams!: Table<StoredActivityStreamRecord, string>;
  wellnessDays!: Table<UnifiedWellnessDay, string>;
  plannedEvents!: Table<PlannedWorkoutEvent, string>;
  gearItems!: Table<AthleteGearItem, string>;
  metadata!: Table<StoredMetadataRecord, string>;

  constructor() {
    super('AeroPulseWorkoutStoreDB');

    // Explicit relational schema boundaries for workout summaries vs 1Hz telemetry streams
    this.version(1).stores({
      activities:
        'id, name, type, start_date, distance, moving_time, tss, startDateLocal, sportCategory, environment',
      activityStreams: 'activityId, updatedAt', // Holds high-frequency 1Hz array streams
      wellnessDays: 'date, ctl, atl, tsb, readinessStatus',
      plannedEvents: 'id, date, sportCategory',
      gearItems: 'id, type',
      metadata: 'key',
    });
  }
}

export const db = new WorkoutStoreDatabase();

/**
 * Converts a UnifiedActivity into a relational StoredActivityRecord + optional StoredActivityStreamRecord.
 */
export function splitActivityAndStreams(activity: UnifiedActivity): {
  activityRecord: StoredActivityRecord;
  streamRecord?: StoredActivityStreamRecord;
} {
  const { streams, ...rest } = activity;
  const hasValidStream = Boolean(streams && Array.isArray(streams.time) && streams.time.length > 0);

  const activityRecord: StoredActivityRecord = {
    ...rest,
    id: activity.id,
    name: activity.name,
    type: activity.sportCategory,
    start_date: activity.startDateLocal,
    distance: activity.distanceMeters,
    moving_time: activity.movingTimeSecs,
    tss: activity.trainingLoad,
    hasStreams: hasValidStream || Boolean((activity as StoredActivityRecord).hasStreams),
  };

  const streamRecord: StoredActivityStreamRecord | undefined = hasValidStream
    ? {
        activityId: activity.id,
        streams: streams!,
        intervals: activity.intervals,
        sampleCount: streams!.time.length,
        updatedAt: new Date().toISOString(),
      }
    : undefined;

  return { activityRecord, streamRecord };
}

/**
 * Reconstructs a UnifiedActivity from a StoredActivityRecord and optional stream payload.
 */
export function hydrateUnifiedActivity(
  record: StoredActivityRecord,
  streamRecord?: StoredActivityStreamRecord
): UnifiedActivity {
  const {
    type: _type,
    start_date: _startDate,
    distance: _dist,
    moving_time: _movTime,
    tss: _tss,
    hasStreams: _hasStreams,
    ...core
  } = record;

  return {
    ...core,
    intervals: streamRecord?.intervals || core.intervals,
    streams: streamRecord?.streams,
  };
}

/**
 * Bulk-upserts activities and decouples any attached 1Hz streams into `activityStreams`.
 */
export async function bulkUpsertActivitiesToDexie(activities: UnifiedActivity[]): Promise<void> {
  if (!Array.isArray(activities) || activities.length === 0) return;

  const activityRecords: StoredActivityRecord[] = [];
  const streamRecords: StoredActivityStreamRecord[] = [];

  for (const act of activities) {
    if (!act || !act.id) continue;
    const { activityRecord, streamRecord } = splitActivityAndStreams(act);
    activityRecords.push(activityRecord);
    if (streamRecord) {
      streamRecords.push(streamRecord);
    }
  }

  await db.transaction('rw', db.activities, db.activityStreams, async () => {
    if (activityRecords.length > 0) {
      // Preserve `hasStreams: true` if stream already exists in activityStreams
      const existingStreamKeys = new Set(
        (await db.activityStreams.where('activityId').anyOf(activityRecords.map((a) => a.id)).primaryKeys()) as string[]
      );
      for (const rec of activityRecords) {
        if (existingStreamKeys.has(rec.id)) {
          rec.hasStreams = true;
        }
      }
      await db.activities.bulkPut(activityRecords);
    }
    if (streamRecords.length > 0) {
      await db.activityStreams.bulkPut(streamRecords);
    }
  });
}

/**
 * Stores or updates a single 1Hz stream record for an activity without re-writing all activities.
 */
export async function saveActivityStreamToDexie(
  activityId: string,
  streams: ActivityStreamSet,
  intervals?: ActivityInterval[]
): Promise<void> {
  if (!activityId || !streams || !Array.isArray(streams.time)) return;
  const now = new Date().toISOString();
  await db.transaction('rw', db.activities, db.activityStreams, async () => {
    await db.activityStreams.put({
      activityId,
      streams,
      intervals,
      sampleCount: streams.time.length,
      updatedAt: now,
    });
    await db.activities.update(activityId, {
      hasStreams: true,
      ...(intervals && intervals.length > 0 ? { intervals } : {}),
    });
  });
}

/**
 * Loads a single activity's 1Hz stream record on demand from Dexie IndexedDB.
 */
export async function getActivityStreamFromDexie(
  activityId: string
): Promise<StoredActivityStreamRecord | undefined> {
  if (!activityId) return undefined;
  try {
    return await db.activityStreams.get(activityId);
  } catch {
    return undefined;
  }
}

/**
 * Reactive Dexie hook: Live query of workout summaries ordered by start_date descending.
 */
export function useLiveActivities(filters?: {
  sportCategory?: SportCategory | 'ALL';
  environment?: 'COMBINED' | 'OUTDOOR' | 'INDOOR';
}): UnifiedActivity[] | undefined {
  return useLiveQuery(async () => {
    let collection = db.activities.orderBy('start_date').reverse();
    const rows = await collection.toArray();
    return rows
      .filter((r) => {
        if (
          filters?.sportCategory &&
          filters.sportCategory !== 'ALL' &&
          r.sportCategory !== filters.sportCategory
        ) {
          return false;
        }
        if (
          filters?.environment &&
          filters.environment !== 'COMBINED' &&
          r.environment !== filters.environment
        ) {
          return false;
        }
        return true;
      })
      .map((r) => hydrateUnifiedActivity(r));
  }, [filters?.sportCategory, filters?.environment]);
}

/**
 * Reactive Dexie hook: Live query of a specific workout's 1Hz stream from `activityStreams`.
 */
export function useLiveActivityStream(
  activityId: string | null | undefined
): StoredActivityStreamRecord | undefined {
  return useLiveQuery(async () => {
    if (!activityId) return undefined;
    return await db.activityStreams.get(activityId);
  }, [activityId]);
}

/**
 * Reactive Dexie hook: Live query of daily wellness & PMC records ordered chronologically.
 */
export function useLiveWellnessDays(): UnifiedWellnessDay[] | undefined {
  return useLiveQuery(async () => {
    return await db.wellnessDays.orderBy('date').toArray();
  }, []);
}

/**
 * Reactive Dexie hook: Live telemetry database health & table counts.
 */
export function useLiveWorkoutStoreStats(): {
  activitiesCount: number;
  streamsCount: number;
  wellnessDaysCount: number;
  savedAt: string | null;
} {
  const stats = useLiveQuery(async () => {
    const [activitiesCount, streamsCount, wellnessDaysCount, metaSaved] = await Promise.all([
      db.activities.count(),
      db.activityStreams.count(),
      db.wellnessDays.count(),
      db.metadata.get('snapshot_meta'),
    ]);
    const metaVal = metaSaved?.value as { savedAt?: string } | undefined;
    return {
      activitiesCount,
      streamsCount,
      wellnessDaysCount,
      savedAt: metaVal?.savedAt || metaSaved?.updatedAt || null,
    };
  }, []);

  return (
    stats || {
      activitiesCount: 0,
      streamsCount: 0,
      wellnessDaysCount: 0,
      savedAt: null,
    }
  );
}

/**
 * Saves auxiliary metadata (e.g. AthleteProfile, earliestActivityDate, redactedStravaCount) to Dexie.
 */
export async function saveStoreMetadata<T>(key: string, value: T): Promise<void> {
  await db.metadata.put({
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
}

export async function getStoreMetadata<T>(key: string): Promise<T | undefined> {
  const rec = await db.metadata.get(key);
  return rec ? (rec.value as T) : undefined;
}
