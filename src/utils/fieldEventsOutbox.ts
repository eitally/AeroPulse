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

let pendingFieldDexieOp: Promise<void> = Promise.resolve();
let memoryFieldShadow: Map<string, FieldEventsOutboxBatch> | null = null;

function enqueueFieldDexieOp(op: (db: MeetReadyFieldOutboxDatabase) => Promise<void>): Promise<void> {
  const db = getOutboxDb();
  if (!db) return Promise.resolve();
  const next = pendingFieldDexieOp
    .catch(() => {})
    .then(async () => {
      try {
        await op(db);
      } catch {
        // Private mode or closed IndexedDB falls back safely to localStorage
      }
    });
  pendingFieldDexieOp = next;
  return next;
}

function writeFieldLocalStorage(batches: FieldEventsOutboxBatch[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (batches.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX);
    } else {
      localStorage.setItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX, JSON.stringify(batches));
    }
  } catch {
    // ignore localStorage quota errors; memory shadow + Dexie keep records intact
  }
}

function quarantineBatchInDexieAsync(
  batch: FieldEventsOutboxBatch,
  statusCode: number | undefined,
  reason: string
): Promise<void> {
  const record: FieldEventsOutboxDeadLetter = {
    ...batch,
    lastError: reason,
    droppedAt: new Date().toISOString(),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
  return enqueueFieldDexieOp(async (db) => {
    await db.deadLetter.put(record);
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

function readFieldLocalStorageRaw(): FieldEventsOutboxBatch[] | null {
  if (typeof localStorage === 'undefined') return null;
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
    return null;
  }
}

export function loadFieldOutbox(): FieldEventsOutboxBatch[] {
  const lsBatches = readFieldLocalStorageRaw();
  if (lsBatches && lsBatches.length > 0) {
    const byId = new Map<string, FieldEventsOutboxBatch>();
    if (memoryFieldShadow) {
      for (const b of memoryFieldShadow.values()) byId.set(b.batchId, b);
    }
    for (const b of lsBatches) byId.set(b.batchId, b);
    return Array.from(byId.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  }
  if (memoryFieldShadow && memoryFieldShadow.size > 0) {
    return Array.from(memoryFieldShadow.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  }
  return [];
}

export function saveFieldOutbox(batches: FieldEventsOutboxBatch[]): void {
  memoryFieldShadow = new Map(batches.map((b) => [b.batchId, b]));
  writeFieldLocalStorage(batches);
  void enqueueFieldDexieOp(async (db) => {
    await db.transaction('rw', db.batches, async () => {
      const keepIds = new Set(batches.map((b) => b.batchId));
      const existingKeys = await db.batches.toCollection().primaryKeys();
      const staleKeys = existingKeys.filter((k) => !keepIds.has(k));
      if (staleKeys.length > 0) {
        await db.batches.bulkDelete(staleKeys);
      }
      if (batches.length > 0) {
        await db.batches.bulkPut(batches);
      }
    });
  });
  emitFieldOutboxUpdatedEvent();
}

/**
 * Hydrates localStorage from Dexie MeetReadyFieldOutboxDB if IndexedDB holds batches
 * that were evicted from or not yet mirrored to localStorage.
 */
export async function hydrateFieldOutboxFromDexie(): Promise<FieldEventsOutboxBatch[]> {
  await pendingFieldDexieOp;
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
    memoryFieldShadow = new Map(merged.map((b) => [b.batchId, b]));
    writeFieldLocalStorage(merged);
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

  const next = [...existing, batch];
  memoryFieldShadow = new Map(next.map((b) => [b.batchId, b]));
  writeFieldLocalStorage(next);
  // Atomic per-record Dexie put (never clears existing Dexie batches if localStorage quota fails)
  void enqueueFieldDexieOp(async (db) => {
    await db.batches.put(batch);
  });
  emitFieldOutboxUpdatedEvent();
  return batch;
}

async function removeFieldOutboxBatchAsync(batchId: string): Promise<void> {
  const remaining = loadFieldOutbox().filter(
    (b) => b.batchId !== batchId && b.clientBatchId !== batchId
  );
  memoryFieldShadow = new Map(remaining.map((b) => [b.batchId, b]));
  writeFieldLocalStorage(remaining);
  await enqueueFieldDexieOp(async (db) => {
    await db.batches.delete(batchId);
  });
  emitFieldOutboxUpdatedEvent();
}

export function removeFieldOutboxBatch(batchId: string): void {
  void removeFieldOutboxBatchAsync(batchId);
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

export const MAX_FIELD_OUTBOX_ATTEMPTS = 5;
const PERMANENT_CLIENT_ERROR_STATUSES = new Set([400, 403, 404, 422]);

let inFlightFieldOutboxFlush: Promise<FieldOutboxFlushResult> | null = null;
let fieldFlushNeedsRedrain = false;

/**
 * Flushes pending offline field-events batches in FIFO order whenever online.
 * Permanent 400/403/404/422 errors drop/quarantine without infinite retries;
 * offline/network/401/408/429/5xx errors remain queued with attempt counters.
 */
export async function flushFieldOutbox(
  onTeamUpdated?: (team: TeamSummaryWithRole) => void
): Promise<FieldOutboxFlushResult> {
  if (inFlightFieldOutboxFlush) {
    fieldFlushNeedsRedrain = true;
    return inFlightFieldOutboxFlush;
  }

  inFlightFieldOutboxFlush = (async () => {
    let syncedBatches = 0;
    let syncedEntries = 0;
    let droppedBatches = 0;
    let lastError: string | undefined;
    const processedInPass = new Set<string>();

    do {
      fieldFlushNeedsRedrain = false;
      const initialOutbox = (await hydrateFieldOutboxFromDexie()).filter(
        (b) => !processedInPass.has(b.batchId)
      );
      if (initialOutbox.length === 0) {
        break;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return {
          syncedBatches,
          syncedEntries,
          droppedBatches,
          remainingBatches: initialOutbox.length,
          remainingEntries: initialOutbox.reduce((s, b) => s + b.entries.length, 0),
          ...(lastError ? { lastError } : {}),
        };
      }

      for (const batch of initialOutbox) {
        processedInPass.add(batch.batchId);
        if ((batch.attempts || 0) >= MAX_FIELD_OUTBOX_ATTEMPTS) {
          const reason =
            batch.lastError || `Exhausted ${MAX_FIELD_OUTBOX_ATTEMPTS} field outbox attempts`;
          console.error(`[MeetReady Field Outbox] Quarantining poison-pill batch ${batch.batchId}: ${reason}`);
          await quarantineBatchInDexieAsync(batch, undefined, reason);
          await removeFieldOutboxBatchAsync(batch.batchId);
          droppedBatches += 1;
          lastError = reason;
          continue;
        }

        try {
          const resp = await recordTeamFieldMarksApi({
            teamId: batch.teamId,
            clientBatchId: batch.clientBatchId,
            entries: batch.entries,
          });
          syncedBatches += 1;
          syncedEntries += batch.entries.length;
          await removeFieldOutboxBatchAsync(batch.batchId);

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
          const nextAttempts = (batch.attempts || 0) + 1;

          if (
            (status !== undefined && PERMANENT_CLIENT_ERROR_STATUSES.has(status)) ||
            nextAttempts >= MAX_FIELD_OUTBOX_ATTEMPTS
          ) {
            console.error(
              `[MeetReady Field Outbox] Dropping batch ${batch.batchId} (${status ? `HTTP ${status}` : `${nextAttempts} attempts`}): ${message}`
            );
            await quarantineBatchInDexieAsync(
              { ...batch, attempts: nextAttempts, lastError: message },
              status,
              message
            );
            await removeFieldOutboxBatchAsync(batch.batchId);
            droppedBatches += 1;
          } else {
            const updatedBatch: FieldEventsOutboxBatch = {
              ...batch,
              attempts: nextAttempts,
              lastError: message,
            };
            const updated = loadFieldOutbox().map((b) =>
              b.batchId === batch.batchId ? updatedBatch : b
            );
            memoryFieldShadow = new Map(updated.map((b) => [b.batchId, b]));
            writeFieldLocalStorage(updated);
            await enqueueFieldDexieOp(async (db) => {
              await db.batches.put(updatedBatch);
            });
            emitFieldOutboxUpdatedEvent();
          }
        }
      }

      if (loadFieldOutbox().some((b) => !processedInPass.has(b.batchId))) {
        fieldFlushNeedsRedrain = true;
      }
    } while (fieldFlushNeedsRedrain);

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
    fieldFlushNeedsRedrain = false;
  });

  return inFlightFieldOutboxFlush;
}

export async function clearFieldOutboxDb(): Promise<void> {
  memoryFieldShadow = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEYS.FIELD_EVENTS_OUTBOX);
    } catch {
      // ignore
    }
  }
  await enqueueFieldDexieOp(async (db) => {
    await Promise.all([db.batches.clear(), db.deadLetter.clear()]);
  });
  emitFieldOutboxUpdatedEvent();
}
