import Dexie, { type Table } from 'dexie';
import { getFieldEventSpec, summarizeFieldSeries } from '../physiology/fieldEventsEngine';
import type {
  FieldEventLogRecord,
  TeamSummaryWithRole,
} from '../types';
import { STORAGE_KEYS } from './storageKeys';
import {
  recordTeamFieldMarksApi,
  TeamLifecycleApiError,
  type RecordTeamFieldMarkEntryInput,
} from './teamLifecycleApi';

export type FieldEventsOutboxEntry = RecordTeamFieldMarkEntryInput;

export interface FieldEventsOutboxBatch {
  batchId: string;
  clientBatchId: string;
  teamId: string;
  entries: FieldEventsOutboxEntry[];
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface FieldEventsOutboxDeadLetter extends FieldEventsOutboxBatch {
  droppedAt: string;
  statusCode?: number;
}

export interface FieldOutboxFlushResult {
  syncedBatches: number;
  syncedEntries: number;
  droppedBatches: number;
  remainingBatches: number;
  remainingEntries: number;
  lastError?: string;
}

class MeetReadyFieldOutboxDatabase extends Dexie {
  batches!: Table<FieldEventsOutboxBatch, string>;
  deadLetter!: Table<FieldEventsOutboxDeadLetter, string>;

  constructor() {
    super('MeetReadyFieldOutboxDB');
    this.version(1).stores({
      batches: 'batchId, teamId, createdAt',
      deadLetter: 'batchId, teamId, droppedAt',
    });
  }
}

let cachedOutboxDb: MeetReadyFieldOutboxDatabase | null = null;

function getOutboxDb(): MeetReadyFieldOutboxDatabase | null {
  if (typeof indexedDB === 'undefined') return null;
  try {
    if (!cachedOutboxDb) {
      cachedOutboxDb = new MeetReadyFieldOutboxDatabase();
    }
    return cachedOutboxDb;
  } catch {
    return null;
  }
}

function emitFieldOutboxUpdatedEvent(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('thresh:field-outbox-updated'));
    } catch {
      // ignore dispatch errors
    }
  }
}

function syncDexieMirrorAsync(batches: FieldEventsOutboxBatch[]): void {
  const db = getOutboxDb();
  if (!db) return;
  void db
    .transaction('rw', db.batches, async () => {
      await db.batches.clear();
      if (batches.length > 0) {
        await db.batches.bulkPut(batches);
      }
    })
    .catch(() => {
      // Private mode or closed IndexedDB falls back safely to localStorage
    });
}

function quarantineBatchInDexieAsync(
  batch: FieldEventsOutboxBatch,
  statusCode: number | undefined,
  reason: string
): void {
  const db = getOutboxDb();
  if (!db) return;
  const record: FieldEventsOutboxDeadLetter = {
    ...batch,
    lastError: reason,
    droppedAt: new Date().toISOString(),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
  void db.deadLetter.put(record).catch(() => {
    // ignore private mode IndexedDB failures
  });
}

function isValidOutboxBatch(candidate: unknown): candidate is FieldEventsOutboxBatch {
  if (!candidate || typeof candidate !== 'object') return false;
  const b = candidate as Partial<FieldEventsOutboxBatch>;
  return (
    typeof b.batchId === 'string' &&
    b.batchId.length > 0 &&
    typeof b.teamId === 'string' &&
    b.teamId.length > 0 &&
    Array.isArray(b.entries)
  );
}

export function loadFieldOutbox(): FieldEventsOutboxBatch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidOutboxBatch).map((b) => ({
      ...b,
      clientBatchId: b.clientBatchId || b.batchId,
      attempts: typeof b.attempts === 'number' && Number.isFinite(b.attempts) ? b.attempts : 0,
    }));
  } catch {
    return [];
  }
}

export function saveFieldOutbox(batches: FieldEventsOutboxBatch[]): void {
  if (typeof localStorage !== 'undefined') {
    try {
      if (batches.length === 0) {
        localStorage.removeItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX);
      } else {
        localStorage.setItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX, JSON.stringify(batches));
      }
    } catch {
      // ignore localStorage quota errors; Dexie mirror still receives write below
    }
  }
  syncDexieMirrorAsync(batches);
  emitFieldOutboxUpdatedEvent();
}

/**
 * Hydrates localStorage from Dexie MeetReadyFieldOutboxDB if IndexedDB holds batches
 * that were evicted from or not yet mirrored to localStorage.
 */
export async function hydrateFieldOutboxFromDexie(): Promise<FieldEventsOutboxBatch[]> {
  const localBatches = loadFieldOutbox();
  const db = getOutboxDb();
  if (!db) return localBatches;
  try {
    const dexieBatches = (await db.batches.toArray()).filter(isValidOutboxBatch);
    if (dexieBatches.length === 0) return localBatches;
    const byId = new Map<string, FieldEventsOutboxBatch>();
    for (const b of dexieBatches) byId.set(b.batchId, b);
    for (const b of localBatches) byId.set(b.batchId, b);
    const merged = Array.from(byId.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
    if (merged.length !== localBatches.length) {
      saveFieldOutbox(merged);
    }
    return merged;
  } catch {
    return localBatches;
  }
}

export function enqueueFieldOutboxBatch(
  teamId: string,
  entries: FieldEventsOutboxEntry[],
  clientBatchId?: string
): FieldEventsOutboxBatch | null {
  const cleanTeamId = String(teamId || '').trim();
  if (!cleanTeamId || !Array.isArray(entries) || entries.length === 0) return null;

  const batchKey =
    String(clientBatchId || '').trim() ||
    `flb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const existing = loadFieldOutbox();
  const alreadyQueued = existing.find(
    (b) => b.batchId === batchKey || b.clientBatchId === batchKey
  );
  if (alreadyQueued) {
    return alreadyQueued;
  }

  const normalizedEntries = entries.map((e) => ({
    ...e,
    clientBatchId: e.clientBatchId || batchKey,
  }));

  const batch: FieldEventsOutboxBatch = {
    batchId: batchKey,
    clientBatchId: batchKey,
    teamId: cleanTeamId,
    entries: normalizedEntries,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

  saveFieldOutbox([...existing, batch]);
  return batch;
}

export function removeFieldOutboxBatch(batchId: string): void {
  const remaining = loadFieldOutbox().filter(
    (b) => b.batchId !== batchId && b.clientBatchId !== batchId
  );
  saveFieldOutbox(remaining);
}

export function countPendingFieldOutboxEntries(teamId?: string): number {
  return loadFieldOutbox()
    .filter((b) => !teamId || b.teamId === teamId)
    .reduce((sum, b) => sum + b.entries.length, 0);
}

function buildPendingFieldLogRecord(
  teamId: string,
  batch: FieldEventsOutboxBatch,
  entry: FieldEventsOutboxEntry,
  idx: number
): FieldEventLogRecord {
  const spec = getFieldEventSpec(entry.eventCode);
  const summary = summarizeFieldSeries(entry.eventCode, entry.attempts || [], entry.rpe);
  const bestMark = entry.bestMarkMeters ?? summary.bestMarkMeters ?? undefined;
  const bestWindLegal = entry.bestWindLegalMeters ?? summary.bestWindLegalMeters ?? undefined;
  const bestWindMps = entry.bestMarkWindMps ?? summary.bestMarkWindMps;
  const isWindAidedBest = entry.isWindAidedBest ?? summary.isWindAidedBest;

  return {
    id: `pending-${batch.clientBatchId}-${idx}`,
    teamId,
    ...(entry.membershipId ? { membershipId: entry.membershipId } : {}),
    athleteName: entry.athleteName,
    date: entry.date,
    eventCode: entry.eventCode,
    eventGroup: spec.eventGroup,
    isCompetition: Boolean(entry.isCompetition),
    meetOrPracticeTitle:
      entry.meetOrPracticeTitle?.trim() || `${spec.shortLabel} Session`,
    ...(entry.flightName ? { flightName: entry.flightName } : {}),
    ...(entry.implementSpec ? { implementSpec: entry.implementSpec } : {}),
    ...(entry.poleSpec ? { poleSpec: entry.poleSpec } : {}),
    ...(typeof entry.approachSteps === 'number'
      ? { approachSteps: entry.approachSteps }
      : {}),
    attempts: entry.attempts || [],
    ...(bestMark !== undefined ? { bestMarkMeters: bestMark } : {}),
    ...(bestWindLegal !== undefined ? { bestWindLegalMeters: bestWindLegal } : {}),
    ...(bestWindMps !== undefined ? { bestMarkWindMps: bestWindMps } : {}),
    ...(isWindAidedBest ? { isWindAidedBest: true } : {}),
    ...(entry.isNoHeight ?? summary.isNoHeight ? { isNoHeight: true } : {}),
    ...(typeof (entry.missesAtClearingHeight ?? summary.missesAtClearingHeight) === 'number'
      ? {
          missesAtClearingHeight:
            entry.missesAtClearingHeight ?? summary.missesAtClearingHeight,
        }
      : {}),
    ...(typeof (entry.totalVerticalMisses ?? summary.totalVerticalMisses) === 'number'
      ? { totalVerticalMisses: entry.totalVerticalMisses ?? summary.totalVerticalMisses }
      : {}),
    ...(typeof entry.placeRank === 'number' ? { placeRank: entry.placeRank } : {}),
    ...(typeof entry.advancedToFinals === 'boolean'
      ? { advancedToFinals: entry.advancedToFinals }
      : {}),
    ...(typeof entry.multiPoints === 'number' ? { multiPoints: entry.multiPoints } : {}),
    ...(typeof entry.rpe === 'number' ? { rpe: entry.rpe } : {}),
    clientBatchId: batch.clientBatchId,
    createdAt: batch.createdAt,
  };
}

function logIdentityKey(log: {
  clientBatchId?: string;
  eventCode: string;
  membershipId?: string;
  athleteName: string;
}): string | null {
  if (!log.clientBatchId) return null;
  const who = log.membershipId || log.athleteName.trim().toLowerCase();
  return `${log.clientBatchId}|${log.eventCode}|${who}`;
}

export function overlayPendingFieldOutboxOnTeams(
  teams: TeamSummaryWithRole[]
): TeamSummaryWithRole[] {
  if (!Array.isArray(teams) || teams.length === 0) return teams;
  const outbox = loadFieldOutbox();
  if (outbox.length === 0) return teams;

  const pendingByTeam = new Map<string, FieldEventLogRecord[]>();
  for (const batch of outbox) {
    const list = pendingByTeam.get(batch.teamId) || [];
    batch.entries.forEach((entry, idx) => {
      list.unshift(buildPendingFieldLogRecord(batch.teamId, batch, entry, idx));
    });
    pendingByTeam.set(batch.teamId, list);
  }

  return teams.map((team) => {
    const pendingLogs = pendingByTeam.get(team.brand.teamId);
    if (!pendingLogs || pendingLogs.length === 0) return team;

    const existingLogs = Array.isArray(team.fieldMarkLogs) ? team.fieldMarkLogs : [];
    const existingKeys = new Set(
      existingLogs.map((l) => logIdentityKey(l)).filter((k): k is string => Boolean(k))
    );
    const dedupedPending = pendingLogs.filter((p) => {
      const key = logIdentityKey(p);
      return !key || !existingKeys.has(key);
    });
    if (dedupedPending.length === 0) return team;

    const mergedLogs = [...dedupedPending, ...existingLogs].slice(0, 150);
    const baseTotal =
      typeof team.fieldMarkLogsTotalCount === 'number'
        ? Math.max(team.fieldMarkLogsTotalCount, existingLogs.length)
        : existingLogs.length;

    return {
      ...team,
      fieldMarkLogs: mergedLogs,
      fieldMarkLogsTotalCount: baseTotal + dedupedPending.length,
    };
  });
}

const PERMANENT_CLIENT_ERROR_STATUSES = new Set([400, 403, 404, 422]);

let inFlightFieldOutboxFlush: Promise<FieldOutboxFlushResult> | null = null;

/**
 * Flushes pending offline field-events batches in FIFO order whenever online.
 * Permanent 400/403/404/422 errors drop/quarantine without infinite retries;
 * offline/network/401/408/429/5xx errors remain queued with attempt counters.
 */
export async function flushFieldOutbox(
  onTeamUpdated?: (team: TeamSummaryWithRole) => void
): Promise<FieldOutboxFlushResult> {
  if (inFlightFieldOutboxFlush) {
    return inFlightFieldOutboxFlush;
  }

  inFlightFieldOutboxFlush = (async () => {
    const initialOutbox = await hydrateFieldOutboxFromDexie();
    if (initialOutbox.length === 0) {
      return {
        syncedBatches: 0,
        syncedEntries: 0,
        droppedBatches: 0,
        remainingBatches: 0,
        remainingEntries: 0,
      };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        syncedBatches: 0,
        syncedEntries: 0,
        droppedBatches: 0,
        remainingBatches: initialOutbox.length,
        remainingEntries: initialOutbox.reduce((s, b) => s + b.entries.length, 0),
      };
    }

    let syncedBatches = 0;
    let syncedEntries = 0;
    let droppedBatches = 0;
    let lastError: string | undefined;

    for (const batch of initialOutbox) {
      try {
        const resp = await recordTeamFieldMarksApi({
          teamId: batch.teamId,
          clientBatchId: batch.clientBatchId,
          entries: batch.entries,
        });
        syncedBatches += 1;
        syncedEntries += batch.entries.length;
        removeFieldOutboxBatch(batch.batchId);

        const updatedTeam =
          resp.team ||
          resp.teams?.find((t) => t.brand.teamId === batch.teamId);
        if (updatedTeam) {
          onTeamUpdated?.(updatedTeam);
        }
      } catch (err: unknown) {
        const status =
          err instanceof TeamLifecycleApiError
            ? err.status
            : typeof (err as { status?: unknown })?.status === 'number'
              ? (err as { status: number }).status
              : undefined;
        const message =
          err instanceof Error && err.message ? err.message : 'Pending network sync';
        lastError = message;

        if (status !== undefined && PERMANENT_CLIENT_ERROR_STATUSES.has(status)) {
          console.error(
            `[MeetReady Field Outbox] Dropping batch ${batch.batchId} due to HTTP ${status}: ${message}`
          );
          quarantineBatchInDexieAsync(batch, status, message);
          removeFieldOutboxBatch(batch.batchId);
          droppedBatches += 1;
        } else {
          const updated = loadFieldOutbox().map((b) =>
            b.batchId === batch.batchId
              ? {
                  ...b,
                  attempts: (b.attempts || 0) + 1,
                  lastError: message,
                }
              : b
          );
          saveFieldOutbox(updated);
        }
      }
    }

    const finalOutbox = loadFieldOutbox();
    return {
      syncedBatches,
      syncedEntries,
      droppedBatches,
      remainingBatches: finalOutbox.length,
      remainingEntries: finalOutbox.reduce((s, b) => s + b.entries.length, 0),
      ...(lastError ? { lastError } : {}),
    };
  })().finally(() => {
    inFlightFieldOutboxFlush = null;
  });

  return inFlightFieldOutboxFlush;
}

export async function clearFieldOutboxDb(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX);
    } catch {
      // ignore
    }
  }
  const db = getOutboxDb();
  if (db) {
    try {
      await Promise.all([db.batches.clear(), db.deadLetter.clear()]);
    } catch {
      // ignore private mode / closed DB errors
    }
  }
  emitFieldOutboxUpdatedEvent();
}
