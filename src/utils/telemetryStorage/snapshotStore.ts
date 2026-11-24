import type {
  AthleteGearItem,
  AthleteProfile,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  bulkUpsertActivitiesToDexie,
  db,
  getStoreMetadata,
  hydrateUnifiedActivity,
  saveStoreMetadata,
} from '../../db/workoutStore';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';
import { isBrowserSessionLoggedOut } from './clientSessionStorage';
import {
  CURRENT_PMC_MODEL_VERSION,
  getActivityWithLegacyAliases,
  recalibrateStravaActivityLoadClient,
  reclassifyActivityEnvironment,
  sanitizeStaleCollapsedProfile,
} from './profileCalibration';
import { deduplicateActivitiesArchive } from './activityMerge';
import { repairAndRecomputeWellnessDays } from './wellnessRecompute';

const IDB_NAME = 'aeropulse_telemetry_db';
const IDB_VERSION = 1;
const IDB_STORE = 'telemetry_snapshots';
const SNAPSHOT_KEY = 'primary_archive_v1';

export interface PersistedTelemetrySnapshot {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  gearItems: AthleteGearItem[];
  athleteProfile?: AthleteProfile;
  redactedStravaCount: number;
  earliestActivityDate?: string;
  pmcModelVersion?: number;
  ownerAthleteId?: string;
  savedAt: string;
}

function openTelemetryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

function purgeLegacyTelemetryDb(): void {
  try {
    if (typeof window !== 'undefined' && window.indexedDB) {
      window.indexedDB.deleteDatabase(IDB_NAME);
    }
  } catch {
    // ignore
  }
}

async function loadLegacyTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    if ('databases' in window.indexedDB && typeof window.indexedDB.databases === 'function') {
      const dbs = await window.indexedDB.databases();
      if (!dbs.some((d) => d.name === IDB_NAME)) {
        return null;
      }
    }
    const idb = await openTelemetryDb();
    const result = await new Promise<PersistedTelemetrySnapshot | null>((resolve, reject) => {
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        resolve(null);
        return;
      }
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(SNAPSHOT_KEY);
      getReq.onsuccess = () => {
        const val = getReq.result as PersistedTelemetrySnapshot | undefined;
        if (val && Array.isArray(val.activities)) {
          resolve({
            ...val,
            activities: val.activities.map(reclassifyActivityEnvironment),
          });
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
    idb.close();
    return result;
  } catch {
    return null;
  }
}

export async function loadPersistedTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    // Deliberately omit `db.activityStreams.toArray()` on boot so 1Hz telemetry streams stay
    // lazily decoupled in IndexedDB until an individual activity is inspected.
    const [storedActivities, wellnessDays, plannedEvents, gearItems, snapshotMeta] =
      await Promise.all([
        db.activities.orderBy('start_date').reverse().toArray(),
        db.wellnessDays.orderBy('date').toArray(),
        db.plannedEvents.orderBy('date').toArray(),
        db.gearItems.toArray(),
        getStoreMetadata<{
          athleteProfile?: AthleteProfile;
          redactedStravaCount?: number;
          earliestActivityDate?: string;
          pmcModelVersion?: number;
          ownerAthleteId?: string;
          savedAt?: string;
        }>('snapshot_meta'),
      ]);

    const realStoredActivities = storedActivities.filter((rec) => !/^act-\d+$/.test(rec.id));
    if (realStoredActivities.length > 0) {
      purgeLegacyTelemetryDb();
      const hydratedActivities = deduplicateActivitiesArchive(
        realStoredActivities.map((rec) =>
          reclassifyActivityEnvironment(hydrateUnifiedActivity(rec))
        )
      );
      const hasIntervals = hydratedActivities.some(
        (a) =>
          Boolean(a.intervalsId || getActivityWithLegacyAliases(a).intervalsActivityId) ||
          a.sourceBadges?.includes('Intervals.icu')
      );
      const storedVersion = Number(snapshotMeta?.pmcModelVersion || 0);
      const todayIso = getLocalDateIso();
      if (storedVersion < CURRENT_PMC_MODEL_VERSION) {
        const sanitizedProfile = sanitizeStaleCollapsedProfile(snapshotMeta?.athleteProfile) as
          | AthleteProfile
          | undefined;
        const recalibratedActs = hydratedActivities.map((act) =>
          recalibrateStravaActivityLoadClient(act, sanitizedProfile)
        );
        const recomputedWellness = repairAndRecomputeWellnessDays(
          wellnessDays,
          recalibratedActs,
          todayIso,
          { forceFullRecomputeIfNoCliff: !hasIntervals }
        );
        return {
          activities: recalibratedActs,
          wellnessDays: recomputedWellness,
          plannedEvents,
          gearItems,
          athleteProfile: sanitizedProfile,
          redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
          earliestActivityDate:
            snapshotMeta?.earliestActivityDate ||
            recalibratedActs[recalibratedActs.length - 1]?.startDateLocal?.slice(0, 10),
          pmcModelVersion: storedVersion || 1,
          ownerAthleteId: snapshotMeta?.ownerAthleteId,
          savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
        };
      }
      const repairedWellness = repairAndRecomputeWellnessDays(
        wellnessDays,
        hydratedActivities,
        todayIso,
        { profile: snapshotMeta?.athleteProfile }
      );
      return {
        activities: hydratedActivities,
        wellnessDays: repairedWellness,
        plannedEvents,
        gearItems,
        athleteProfile: snapshotMeta?.athleteProfile,
        redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
        earliestActivityDate:
          snapshotMeta?.earliestActivityDate ||
          hydratedActivities[hydratedActivities.length - 1]?.startDateLocal?.slice(0, 10),
        pmcModelVersion: storedVersion || CURRENT_PMC_MODEL_VERSION,
        ownerAthleteId: snapshotMeta?.ownerAthleteId,
        savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
      };
    }

    const legacy = await loadLegacyTelemetrySnapshot();
    if (legacy) {
      const realLegacyActivities = legacy.activities.filter((rec) => !/^act-\d+$/.test(rec.id));
      if (realLegacyActivities.length > 0) {
        const cleanedLegacy = { ...legacy, activities: realLegacyActivities };
        await savePersistedTelemetrySnapshot(cleanedLegacy);
        purgeLegacyTelemetryDb();
        return {
          ...cleanedLegacy,
          activities: realLegacyActivities.map(({ streams: _s, ...summary }) => summary),
        };
      }
      purgeLegacyTelemetryDb();
    }

    const hasPersistedNonActivityState =
      plannedEvents.length > 0 ||
      wellnessDays.length > 0 ||
      gearItems.length > 0 ||
      Boolean(snapshotMeta?.athleteProfile || snapshotMeta?.ownerAthleteId || snapshotMeta?.savedAt);
    if (hasPersistedNonActivityState) {
      const sanitizedProfile = sanitizeStaleCollapsedProfile(snapshotMeta?.athleteProfile) as
        | AthleteProfile
        | undefined;
      return {
        activities: [],
        wellnessDays,
        plannedEvents,
        gearItems,
        athleteProfile: sanitizedProfile,
        redactedStravaCount: snapshotMeta?.redactedStravaCount || 0,
        earliestActivityDate: snapshotMeta?.earliestActivityDate,
        pmcModelVersion: Number(snapshotMeta?.pmcModelVersion || CURRENT_PMC_MODEL_VERSION),
        ownerAthleteId: snapshotMeta?.ownerAthleteId,
        savedAt: snapshotMeta?.savedAt || new Date().toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function savePersistedTelemetrySnapshot(
  snapshot: Omit<PersistedTelemetrySnapshot, 'savedAt'> & { savedAt?: string }
): Promise<string | null> {
  try {
    if (isBrowserSessionLoggedOut()) return null;
    const savedAt = snapshot.savedAt || new Date().toISOString();
    const normalizedActivities = Array.isArray(snapshot.activities)
      ? snapshot.activities.map(reclassifyActivityEnvironment)
      : [];

    await bulkUpsertActivitiesToDexie(normalizedActivities);
    if (isBrowserSessionLoggedOut()) return null;

    await db.transaction(
      'rw',
      db.wellnessDays,
      db.plannedEvents,
      db.gearItems,
      db.metadata,
      async () => {
        if (Array.isArray(snapshot.wellnessDays)) {
          await db.wellnessDays.clear();
          if (snapshot.wellnessDays.length > 0) {
            await db.wellnessDays.bulkPut(snapshot.wellnessDays);
          }
        }
        if (Array.isArray(snapshot.plannedEvents)) {
          await db.plannedEvents.clear();
          if (snapshot.plannedEvents.length > 0) {
            await db.plannedEvents.bulkPut(snapshot.plannedEvents);
          }
        }
        if (Array.isArray(snapshot.gearItems)) {
          await db.gearItems.clear();
          if (snapshot.gearItems.length > 0) {
            await db.gearItems.bulkPut(snapshot.gearItems);
          }
        }
        let ownerAthleteId = snapshot.ownerAthleteId;
        if (!ownerAthleteId && typeof localStorage !== 'undefined') {
          try {
            ownerAthleteId =
              localStorage.getItem('aeropulse_store_owner_athlete_id') ||
              localStorage.getItem('aeropulse_strava_athlete_id') ||
              undefined;
          } catch {
            ownerAthleteId = undefined;
          }
        }
        await saveStoreMetadata('snapshot_meta', {
          athleteProfile: snapshot.athleteProfile,
          redactedStravaCount: snapshot.redactedStravaCount || 0,
          earliestActivityDate: snapshot.earliestActivityDate,
          pmcModelVersion: snapshot.pmcModelVersion ?? CURRENT_PMC_MODEL_VERSION,
          ownerAthleteId,
          savedAt,
        });
      }
    );

    return savedAt;
  } catch {
    return null;
  }
}

export async function replaceGearItemsInStore(items: AthleteGearItem[]): Promise<void> {
  try {
    if (isBrowserSessionLoggedOut()) return;
    await db.transaction('rw', db.gearItems, async () => {
      await db.gearItems.clear();
      if (Array.isArray(items) && items.length > 0) {
        await db.gearItems.bulkPut(items);
      }
    });
  } catch {
    // Non-fatal IndexedDB persistence fallback
  }
}

export async function replacePlannedEventsInStore(
  events: PlannedWorkoutEvent[]
): Promise<void> {
  try {
    if (isBrowserSessionLoggedOut()) return;
    await db.transaction('rw', db.plannedEvents, async () => {
      await db.plannedEvents.clear();
      if (Array.isArray(events) && events.length > 0) {
        await db.plannedEvents.bulkPut(events);
      }
    });
  } catch {
    // Non-fatal IndexedDB persistence fallback
  }
}

export async function clearPersistedTelemetrySnapshot(): Promise<void> {
  try {
    await db.transaction(
      'rw',
      [db.activities, db.activityStreams, db.wellnessDays, db.plannedEvents, db.gearItems, db.metadata],
      async () => {
        await Promise.all([
          db.activities.clear(),
          db.activityStreams.clear(),
          db.wellnessDays.clear(),
          db.plannedEvents.clear(),
          db.gearItems.clear(),
          db.metadata.clear(),
        ]);
      }
    );
  } catch {
    // ignore
  }
  purgeLegacyTelemetryDb();
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      await window.caches.delete('aeropulse-telemetry-api-swr');
    }
  } catch {
    // ignore
  }
}
