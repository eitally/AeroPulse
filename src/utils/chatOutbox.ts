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
let inFlightChatFlush: Promise<ChatOutboxFlushResult> | null = null;

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

function syncChatDexieMirrorAsync(items: QueuedChatOutboxMessage[]): void {
  const db = getChatOutboxDb();
  if (!db) return;
  void db
    .transaction('rw', db.messages, async () => {
      await db.messages.clear();
      if (items.length > 0) {
        await db.messages.bulkPut(items);
      }
    })
    .catch(() => {
      // Private mode or closed IndexedDB falls back to localStorage cleanly
    });
}

function quarantineChatDeadLetterAsync(
  msg: QueuedChatOutboxMessage,
  statusCode: number | undefined,
  reason: string
): void {
  const db = getChatOutboxDb();
  if (!db) return;
  const record: ChatOutboxDeadLetter = {
    ...msg,
    lastError: reason,
    failedAt: new Date().toISOString(),
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
  void db.deadLetter.put(record).catch(() => {
    // ignore private mode IndexedDB failures
  });
}

export function loadChatOutbox(teamId?: string): QueuedChatOutboxMessage[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_OUTBOX);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidQueuedMessage).map((m) => ({
      ...m,
      attempts: typeof m.attempts === 'number' && Number.isFinite(m.attempts) ? m.attempts : 0,
    }));
    return teamId ? valid.filter((m) => m.teamId === teamId) : valid;
  } catch {
    return [];
  }
}

export function saveChatOutbox(items: QueuedChatOutboxMessage[]): void {
  if (typeof localStorage !== 'undefined') {
    try {
      if (items.length === 0) {
        localStorage.removeItem(STORAGE_KEYS.CHAT_OUTBOX);
      } else {
        localStorage.setItem(STORAGE_KEYS.CHAT_OUTBOX, JSON.stringify(items));
      }
    } catch {
      // ignore localStorage quota errors; Dexie mirror receives write below
    }
  }
  syncChatDexieMirrorAsync(items);
  emitChatOutboxUpdated();
}

export async function hydrateChatOutboxFromDexie(
  teamId?: string
): Promise<QueuedChatOutboxMessage[]> {
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
    if (merged.length !== localItems.length) {
      saveChatOutbox(merged);
    }
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

  saveChatOutbox([...existing, queued]);
  return queued;
}

export function removeChatOutboxMessage(localId: string): void {
  const existing = loadChatOutbox();
  const next = existing.filter((m) => m.localId !== localId);
  if (next.length !== existing.length) {
    saveChatOutbox(next);
  }
}

export async function flushChatOutbox(
  senderFn: (msg: QueuedChatOutboxMessage) => Promise<void>,
  teamId?: string
): Promise<ChatOutboxFlushResult> {
  if (inFlightChatFlush) {
    return inFlightChatFlush;
  }

  inFlightChatFlush = (async () => {
    const allItems = await hydrateChatOutboxFromDexie();
    const candidates = teamId ? allItems.filter((m) => m.teamId === teamId) : allItems;
    if (candidates.length === 0) {
      return { sentCount: 0, droppedCount: 0, remainingCount: 0 };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        sentCount: 0,
        droppedCount: 0,
        remainingCount: candidates.length,
      };
    }

    let sentCount = 0;
    let droppedCount = 0;
    let lastError: string | undefined;

    for (const item of candidates) {
      if ((item.attempts || 0) >= MAX_CHAT_OUTBOX_ATTEMPTS) {
        const reason =
          item.lastError || `Exhausted ${MAX_CHAT_OUTBOX_ATTEMPTS} chat outbox attempts`;
        quarantineChatDeadLetterAsync(item, undefined, reason);
        removeChatOutboxMessage(item.localId);
        droppedCount += 1;
        lastError = reason;
        continue;
      }

      try {
        await senderFn(item);
        removeChatOutboxMessage(item.localId);
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
          quarantineChatDeadLetterAsync(
            { ...item, attempts: nextAttempts, lastError: message },
            status,
            message
          );
          removeChatOutboxMessage(item.localId);
          droppedCount += 1;
        } else {
          const updated = loadChatOutbox().map((m) =>
            m.localId === item.localId
              ? { ...m, attempts: nextAttempts, lastError: message }
              : m
          );
          saveChatOutbox(updated);
        }
      }
    }

    const remaining = loadChatOutbox(teamId).length;
    return {
      sentCount,
      droppedCount,
      remainingCount: remaining,
      ...(lastError ? { lastError } : {}),
    };
  })().finally(() => {
    inFlightChatFlush = null;
  });

  return inFlightChatFlush;
}

export async function loadChatDeadLetter(teamId?: string): Promise<ChatOutboxDeadLetter[]> {
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
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEYS.CHAT_OUTBOX);
    } catch {
      // ignore
    }
  }
  const db = getChatOutboxDb();
  if (db) {
    try {
      await Promise.all([db.messages.clear(), db.deadLetter.clear()]);
    } catch {
      // ignore private mode errors
    }
  }
  emitChatOutboxUpdated();
}
