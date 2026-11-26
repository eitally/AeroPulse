import Dexie, { type Table } from 'dexie';
import type { CoachEventGroup, TeamMessageChannelScope } from '../types';
import { STORAGE_KEYS } from './storageKeys';
import { TeamLifecycleApiError } from './teamLifecycleApi';

export interface QueuedChatOutboxMessage {
  localId: string;
  teamId: string;
  channelScope: TeamMessageChannelScope;
  eventGroup?: CoachEventGroup;
  customSubgroupId?: string;
  targetMembershipId?: string;
  body: string;
  guardianCc?: boolean;
  isEmergencyOverride?: boolean;
  clientLocalHour?: number;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface ChatOutboxDeadLetter extends QueuedChatOutboxMessage {
  failedAt: string;
  statusCode?: number;
}

export interface ChatOutboxFlushResult {
  sentCount: number;
  droppedCount: number;
  remainingCount: number;
  lastError?: string;
}

const MAX_CHAT_OUTBOX_ATTEMPTS = 8;
const PERMANENT_ERROR_STATUSES = new Set([400, 403, 404, 422]);

class MeetReadyChatOutboxDatabase extends Dexie {
  messages!: Table<QueuedChatOutboxMessage, string>;
  deadLetter!: Table<ChatOutboxDeadLetter, string>;

  constructor() {
    super('MeetReadyChatOutboxDB');
    this.version(1).stores({
      messages: 'localId, teamId, createdAt',
      deadLetter: 'localId, teamId, failedAt',
    });
  }
}

let cachedChatDb: MeetReadyChatOutboxDatabase | null = null;
const inFlightChatFlushByKey = new Map<string, Promise<ChatOutboxFlushResult>>();
const redrainChatFlushByKey = new Set<string>();
let pendingChatDexieOp: Promise<void> = Promise.resolve();
let memoryChatShadow: Map<string, QueuedChatOutboxMessage> | null = null;

function enqueueChatDexieOp(op: (db: MeetReadyChatOutboxDatabase) => Promise<void>): Promise<void> {
  const db = getChatOutboxDb();
  if (!db) return Promise.resolve();
  const next = pendingChatDexieOp
    .catch(() => {})
    .then(async () => {
      try {
        await op(db);
      } catch {
        // Private mode or closed IndexedDB falls back to localStorage cleanly
      }
    });
  pendingChatDexieOp = next;
  return next;
}

function getChatOutboxDb(): MeetReadyChatOutboxDatabase | null {
  if (typeof indexedDB === 'undefined') return null;
  try {
    if (!cachedChatDb) {
      cachedChatDb = new MeetReadyChatOutboxDatabase();
    }
    return cachedChatDb;
  } catch {
    return null;
  }
}

function emitChatOutboxUpdated(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('thresh:chat-outbox-updated'));
    } catch {
      // ignore dispatch failures
    }
  }
}

function isValidQueuedMessage(candidate: unknown): candidate is QueuedChatOutboxMessage {
  if (!candidate || typeof candidate !== 'object') return false;
  const msg = candidate as Partial<QueuedChatOutboxMessage>;
  return (
    typeof msg.localId === 'string' &&
    msg.localId.length > 0 &&
    typeof msg.teamId === 'string' &&
    msg.teamId.length > 0 &&
    typeof msg.channelScope === 'string' &&
    typeof msg.body === 'string' &&
    msg.body.trim().length > 0
  );
}

function writeChatLocalStorage(items: QueuedChatOutboxMessage[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (items.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.CHAT_OUTBOX);
    } else {
      localStorage.setItem(STORAGE_KEYS.CHAT_OUTBOX, JSON.stringify(items));
    }
  } catch {
    // ignore localStorage quota errors; memory shadow + Dexie keep records intact
  }
}

function quarantineChatDeadLetterAsync(
  msg: QueuedChatOutboxMessage,
  statusCode: number | undefined,
  reason: string
): Promise<void> {
  const record: ChatOutboxDeadLetter = {
    ...msg,
    lastError: reason,
    failedAt: new Date().toISOString(),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
  return enqueueChatDexieOp(async (db) => {
    await db.deadLetter.put(record);
  });
}

function readChatLocalStorageRaw(): QueuedChatOutboxMessage[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_OUTBOX);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueuedMessage).map((m) => ({
      ...m,
      attempts: typeof m.attempts === 'number' && Number.isFinite(m.attempts) ? m.attempts : 0,
    }));
  } catch {
    return null;
  }
}

export function loadChatOutbox(teamId?: string): QueuedChatOutboxMessage[] {
  const lsItems = readChatLocalStorageRaw();
  let merged: QueuedChatOutboxMessage[];
  if (lsItems && lsItems.length > 0) {
    const byId = new Map<string, QueuedChatOutboxMessage>();
    if (memoryChatShadow) {
      for (const m of memoryChatShadow.values()) byId.set(m.localId, m);
    }
    for (const m of lsItems) byId.set(m.localId, m);
    merged = Array.from(byId.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  } else if (memoryChatShadow && memoryChatShadow.size > 0) {
    merged = Array.from(memoryChatShadow.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  } else {
    merged = [];
  }
  return teamId ? merged.filter((m) => m.teamId === teamId) : merged;
}

export function saveChatOutbox(items: QueuedChatOutboxMessage[]): void {
  memoryChatShadow = new Map(items.map((m) => [m.localId, m]));
  writeChatLocalStorage(items);
  void enqueueChatDexieOp(async (db) => {
    await db.transaction('rw', db.messages, async () => {
      const keepIds = new Set(items.map((m) => m.localId));
      const existingKeys = await db.messages.toCollection().primaryKeys();
      const staleKeys = existingKeys.filter((k) => !keepIds.has(k));
      if (staleKeys.length > 0) {
        await db.messages.bulkDelete(staleKeys);
      }
      if (items.length > 0) {
        await db.messages.bulkPut(items);
      }
    });
  });
  emitChatOutboxUpdated();
}

export async function hydrateChatOutboxFromDexie(
  teamId?: string
): Promise<QueuedChatOutboxMessage[]> {
  await pendingChatDexieOp;
  const localItems = loadChatOutbox();
  const db = getChatOutboxDb();
  if (!db) {
    return teamId ? localItems.filter((m) => m.teamId === teamId) : localItems;
  }
  try {
    const dexieItems = (await db.messages.toArray()).filter(isValidQueuedMessage);
    if (dexieItems.length === 0) {
      return teamId ? localItems.filter((m) => m.teamId === teamId) : localItems;
    }
    const byId = new Map<string, QueuedChatOutboxMessage>();
    for (const item of dexieItems) byId.set(item.localId, item);
    for (const item of localItems) byId.set(item.localId, item);
    const merged = Array.from(byId.values()).sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
    memoryChatShadow = new Map(merged.map((m) => [m.localId, m]));
    writeChatLocalStorage(merged);
    return teamId ? merged.filter((m) => m.teamId === teamId) : merged;
  } catch {
    return teamId ? localItems.filter((m) => m.teamId === teamId) : localItems;
  }
}

export function enqueueChatOutboxMessage(
  input: Omit<QueuedChatOutboxMessage, 'localId' | 'createdAt' | 'attempts'> & {
    localId?: string;
    createdAt?: string;
  }
): QueuedChatOutboxMessage | null {
  const cleanTeamId = String(input.teamId || '').trim();
  const cleanBody = String(input.body || '').trim();
  if (!cleanTeamId || !cleanBody) return null;

  const localId =
    String(input.localId || '').trim() ||
    `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const existing = loadChatOutbox();
  const duplicate = existing.find((m) => m.localId === localId);
  if (duplicate) return duplicate;

  const queued: QueuedChatOutboxMessage = {
    localId,
    teamId: cleanTeamId,
    channelScope: input.channelScope,
    ...(input.eventGroup ? { eventGroup: input.eventGroup } : {}),
    ...(input.customSubgroupId ? { customSubgroupId: input.customSubgroupId } : {}),
    ...(input.targetMembershipId ? { targetMembershipId: input.targetMembershipId } : {}),
    body: cleanBody,
    ...(typeof input.guardianCc === 'boolean' ? { guardianCc: input.guardianCc } : {}),
    ...(input.isEmergencyOverride ? { isEmergencyOverride: true } : {}),
    ...(typeof input.clientLocalHour === 'number'
      ? { clientLocalHour: input.clientLocalHour }
      : {}),
    createdAt: input.createdAt || new Date().toISOString(),
    attempts: 0,
  };

  const next = [...existing, queued];
  memoryChatShadow = new Map(next.map((m) => [m.localId, m]));
  writeChatLocalStorage(next);
  // Atomic per-record Dexie put (never clears previously queued Dexie records on localStorage quota errors)
  void enqueueChatDexieOp(async (db) => {
    await db.messages.put(queued);
  });
  emitChatOutboxUpdated();
  return queued;
}

async function removeChatOutboxMessageAsync(localId: string): Promise<void> {
  const existing = loadChatOutbox();
  const next = existing.filter((m) => m.localId !== localId);
  memoryChatShadow = new Map(next.map((m) => [m.localId, m]));
  writeChatLocalStorage(next);
  await enqueueChatDexieOp(async (db) => {
    await db.messages.delete(localId);
  });
  emitChatOutboxUpdated();
}

export function removeChatOutboxMessage(localId: string): void {
  void removeChatOutboxMessageAsync(localId);
}

export async function flushChatOutbox(
  senderFn: (msg: QueuedChatOutboxMessage) => Promise<void>,
  teamId?: string
): Promise<ChatOutboxFlushResult> {
  const flushKey = teamId ? `team:${teamId}` : 'all';
  const existingInFlight = inFlightChatFlushByKey.get(flushKey);
  if (existingInFlight) {
    redrainChatFlushByKey.add(flushKey);
    return existingInFlight;
  }

  const runPromise = (async () => {
    let sentCount = 0;
    let droppedCount = 0;
    let lastError: string | undefined;
    const processedInPass = new Set<string>();

    do {
      redrainChatFlushByKey.delete(flushKey);
      const allItems = await hydrateChatOutboxFromDexie();
      const candidates = (teamId ? allItems.filter((m) => m.teamId === teamId) : allItems).filter(
        (m) => !processedInPass.has(m.localId)
      );
      if (candidates.length === 0) {
        break;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return {
          sentCount,
          droppedCount,
          remainingCount: candidates.length,
          ...(lastError ? { lastError } : {}),
        };
      }

      for (const item of candidates) {
        processedInPass.add(item.localId);
        if ((item.attempts || 0) >= MAX_CHAT_OUTBOX_ATTEMPTS) {
          const reason =
            item.lastError || `Exhausted ${MAX_CHAT_OUTBOX_ATTEMPTS} chat outbox attempts`;
          await quarantineChatDeadLetterAsync(item, undefined, reason);
          await removeChatOutboxMessageAsync(item.localId);
          droppedCount += 1;
          lastError = reason;
          continue;
        }

        try {
          await senderFn(item);
          await removeChatOutboxMessageAsync(item.localId);
          sentCount += 1;
        } catch (err: unknown) {
          const status =
            err instanceof TeamLifecycleApiError
              ? err.status
              : typeof (err as { status?: unknown })?.status === 'number'
                ? (err as { status: number }).status
                : undefined;
          const message =
            err instanceof Error && err.message ? err.message : 'Waiting for connection';
          lastError = message;
          const nextAttempts = (item.attempts || 0) + 1;

          if (
            (status !== undefined && PERMANENT_ERROR_STATUSES.has(status)) ||
            nextAttempts >= MAX_CHAT_OUTBOX_ATTEMPTS
          ) {
            await quarantineChatDeadLetterAsync(
              { ...item, attempts: nextAttempts, lastError: message },
              status,
              message
            );
            await removeChatOutboxMessageAsync(item.localId);
            droppedCount += 1;
          } else {
            const updatedMsg: QueuedChatOutboxMessage = {
              ...item,
              attempts: nextAttempts,
              lastError: message,
            };
            const updated = loadChatOutbox().map((m) =>
              m.localId === item.localId ? updatedMsg : m
            );
            memoryChatShadow = new Map(updated.map((m) => [m.localId, m]));
            writeChatLocalStorage(updated);
            await enqueueChatDexieOp(async (db) => {
              await db.messages.put(updatedMsg);
            });
            emitChatOutboxUpdated();
          }
        }
      }

      // Check if any new items were enqueued mid-flush
      const afterItems = loadChatOutbox(teamId);
      if (afterItems.some((m) => !processedInPass.has(m.localId))) {
        redrainChatFlushByKey.add(flushKey);
      }
    } while (redrainChatFlushByKey.has(flushKey));

    const remaining = loadChatOutbox(teamId).length;
    return {
      sentCount,
      droppedCount,
      remainingCount: remaining,
      ...(lastError ? { lastError } : {}),
    };
  })().finally(() => {
    inFlightChatFlushByKey.delete(flushKey);
    redrainChatFlushByKey.delete(flushKey);
  });

  inFlightChatFlushByKey.set(flushKey, runPromise);
  return runPromise;
}

export async function loadChatDeadLetter(teamId?: string): Promise<ChatOutboxDeadLetter[]> {
  await pendingChatDexieOp;
  const db = getChatOutboxDb();
  if (!db) return [];
  try {
    const rows = await db.deadLetter.toArray();
    return teamId ? rows.filter((r) => r.teamId === teamId) : rows;
  } catch {
    return [];
  }
}

export async function clearChatOutbox(): Promise<void> {
  memoryChatShadow = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEYS.CHAT_OUTBOX);
    } catch {
      // ignore
    }
  }
  await enqueueChatDexieOp(async (db) => {
    await Promise.all([db.messages.clear(), db.deadLetter.clear()]);
  });
  emitChatOutboxUpdated();
}
