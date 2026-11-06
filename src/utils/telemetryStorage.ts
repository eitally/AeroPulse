import {
  AthleteGearItem,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';

const IDB_NAME = 'aeropulse_telemetry_db';
const IDB_VERSION = 1;
const IDB_STORE = 'telemetry_snapshots';
const SNAPSHOT_KEY = 'primary_archive_v1';

export interface PersistedTelemetrySnapshot {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  plannedEvents: PlannedWorkoutEvent[];
  gearItems: AthleteGearItem[];
  redactedStravaCount: number;
  earliestActivityDate?: string;
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
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

export async function loadPersistedTelemetrySnapshot(): Promise<PersistedTelemetrySnapshot | null> {
  try {
    const db = await openTelemetryDb();
    return await new Promise<PersistedTelemetrySnapshot | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(SNAPSHOT_KEY);
      getReq.onsuccess = () => {
        const val = getReq.result as PersistedTelemetrySnapshot | undefined;
        resolve(val && Array.isArray(val.activities) ? val : null);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch {
    return null;
  }
}

export async function savePersistedTelemetrySnapshot(
  snapshot: Omit<PersistedTelemetrySnapshot, 'savedAt'> & { savedAt?: string }
): Promise<string | null> {
  try {
    const db = await openTelemetryDb();
    const savedAt = snapshot.savedAt || new Date().toISOString();
    const record: PersistedTelemetrySnapshot = {
      ...snapshot,
      savedAt,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(record, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return savedAt;
  } catch {
    return null;
  }
}

export async function clearPersistedTelemetrySnapshot(): Promise<void> {
  try {
    const db = await openTelemetryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Merges incoming synced activities with existing persisted activities without losing
 * previously hydrated streams, GPS route polylines, Strava segment efforts, kudos, or comments.
 */
export function mergeActivitiesNonDestructive(
  existing: UnifiedActivity[],
  incoming: UnifiedActivity[]
): UnifiedActivity[] {
  if (!Array.isArray(existing) || existing.length === 0) {
    return incoming;
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return existing;
  }

  const byId = new Map<string, UnifiedActivity>();
  const stravaIdToPrimaryId = new Map<string, string>();
  const intervalsIdToPrimaryId = new Map<string, string>();

  for (const act of existing) {
    if (!act || !act.id) continue;
    byId.set(act.id, act);
    if (act.stravaId) stravaIdToPrimaryId.set(String(act.stravaId), act.id);
    if (act.intervalsId) intervalsIdToPrimaryId.set(String(act.intervalsId), act.id);
  }

  for (const inc of incoming) {
    if (!inc || !inc.id) continue;
    const matchedKey =
      (byId.has(inc.id) ? inc.id : undefined) ||
      (inc.intervalsId ? intervalsIdToPrimaryId.get(String(inc.intervalsId)) : undefined) ||
      (inc.stravaId ? stravaIdToPrimaryId.get(String(inc.stravaId)) : undefined);

    if (!matchedKey) {
      byId.set(inc.id, inc);
      if (inc.stravaId) stravaIdToPrimaryId.set(String(inc.stravaId), inc.id);
      if (inc.intervalsId) intervalsIdToPrimaryId.set(String(inc.intervalsId), inc.id);
      continue;
    }

    const prev = byId.get(matchedKey)!;
    // Prefer whichever record has an Intervals.icu ID as the primary ID
    const canonicalId = prev.intervalsId ? prev.id : inc.intervalsId ? inc.id : prev.id;

    const mergedBadges = Array.from(
      new Set([...(prev.sourceBadges || []), ...(inc.sourceBadges || [])])
    ) as ('Intervals.icu' | 'Garmin' | 'Strava')[];

    const merged: UnifiedActivity = {
      ...prev,
      ...inc,
      id: canonicalId,
      intervalsId: inc.intervalsId || prev.intervalsId,
      stravaId: inc.stravaId || prev.stravaId,
      gearName: inc.gearName || prev.gearName,
      deviceName: inc.deviceName || prev.deviceName,
      avgPower: inc.avgPower ?? prev.avgPower,
      normalizedPower: inc.normalizedPower ?? prev.normalizedPower,
      intensityFactor: inc.intensityFactor ?? prev.intensityFactor,
      trainingLoad: inc.trainingLoad || prev.trainingLoad,
      avgHr: inc.avgHr || prev.avgHr,
      maxHr: inc.maxHr || prev.maxHr,
      efficiencyFactor: inc.efficiencyFactor || prev.efficiencyFactor,
      aerobicDecouplingPct: inc.aerobicDecouplingPct || prev.aerobicDecouplingPct,
      firstHalfEf: inc.firstHalfEf || prev.firstHalfEf,
      secondHalfEf: inc.secondHalfEf || prev.secondHalfEf,
      zoneSecs:
        inc.zoneSecs?.hr?.some((s) => s > 0) || !prev.zoneSecs?.hr?.some((s) => s > 0)
          ? inc.zoneSecs
          : prev.zoneSecs,
      stravaPrCount: Math.max(prev.stravaPrCount || 0, inc.stravaPrCount || 0),
      kudosCount: Math.max(prev.kudosCount || 0, inc.kudosCount || 0),
      commentCount: Math.max(prev.commentCount || 0, inc.commentCount || 0),
      achievementCount: Math.max(prev.achievementCount || 0, inc.achievementCount || 0),
      hasKudoed: inc.hasKudoed ?? prev.hasKudoed,
      kudoers:
        Array.isArray(inc.kudoers) && inc.kudoers.length > 0 ? inc.kudoers : prev.kudoers,
      comments:
        Array.isArray(inc.comments) && inc.comments.length > 0 ? inc.comments : prev.comments,
      summaryPolyline: inc.summaryPolyline || prev.summaryPolyline,
      routeLatLngs:
        Array.isArray(inc.routeLatLngs) && inc.routeLatLngs.length > 2
          ? inc.routeLatLngs
          : prev.routeLatLngs,
      startLatLng: inc.startLatLng || prev.startLatLng,
      endLatLng: inc.endLatLng || prev.endLatLng,
      streams:
        inc.streams && Array.isArray(inc.streams.time) && inc.streams.time.length > 0
          ? inc.streams
          : prev.streams,
      intervals:
        Array.isArray(inc.intervals) && inc.intervals.length > 0
          ? inc.intervals
          : prev.intervals,
      segmentEfforts:
        Array.isArray(inc.segmentEfforts) && inc.segmentEfforts.length > 0
          ? inc.segmentEfforts
          : prev.segmentEfforts,
      sourceBadges: mergedBadges,
    };

    if (canonicalId !== matchedKey) {
      byId.delete(matchedKey);
    }
    byId.set(canonicalId, merged);
    if (merged.stravaId) stravaIdToPrimaryId.set(String(merged.stravaId), canonicalId);
    if (merged.intervalsId) intervalsIdToPrimaryId.set(String(merged.intervalsId), canonicalId);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.startDateLocal).getTime() - new Date(a.startDateLocal).getTime()
  );
}

export function mergeWellnessDaysNonDestructive(
  existing: UnifiedWellnessDay[],
  incoming: UnifiedWellnessDay[]
): UnifiedWellnessDay[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;

  const byDate = new Map<string, UnifiedWellnessDay>();
  for (const w of existing) {
    if (w && w.date) byDate.set(w.date, w);
  }
  for (const w of incoming) {
    if (w && w.date) byDate.set(w.date, w);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export interface RotatedStravaTokenPayload {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  athleteName?: string;
}

export function saveRotatedStravaTokensToStorage(tokens?: RotatedStravaTokenPayload | null) {
  if (!tokens) return;
  try {
    if (tokens.refreshToken) {
      localStorage.setItem('aeropulse_strava_refresh_token', tokens.refreshToken.trim());
    }
    if (tokens.accessToken) {
      localStorage.setItem('aeropulse_strava_access_token', tokens.accessToken.trim());
    }
    if (tokens.expiresAt && tokens.expiresAt > 0) {
      localStorage.setItem('aeropulse_strava_expires_at', String(tokens.expiresAt));
    }
    if (tokens.clientId) {
      localStorage.setItem('aeropulse_strava_client_id', tokens.clientId.trim());
    }
    if (tokens.clientSecret) {
      localStorage.setItem('aeropulse_strava_client_secret', tokens.clientSecret.trim());
    }
  } catch {
    // ignore storage quota errors
  }
}
