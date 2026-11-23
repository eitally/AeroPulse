import type { SavedStopwatchEntry } from '../components/TracksideStopwatchView';
import type {
  ConnectedAthleteRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../types';
import { STORAGE_KEYS } from './storageKeys';

export const MAX_OUTBOX_ATTEMPTS = 8;
const PERMANENT_ERROR_STATUSES = new Set([400, 403, 404, 422]);

export interface WalkOnStopwatchEntry {
  runnerId: string;
  runnerName: string;
  activity: UnifiedActivity;
  savedAt: string;
}

export interface StopwatchOutboxBatch {
  batchId: string;
  teamId: string;
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface StopwatchDeadLetterBatch extends StopwatchOutboxBatch {
  failedAt: string;
  status?: number;
  reason: string;
}

export interface PersistStopwatchResult {
  ok: boolean;
  team: TeamSummaryWithRole | null;
  status: number | null;
  error?: string;
  permanentFailure: boolean;
}

export interface StopwatchSaveResult {
  savedCount: number;
  selfCount: number;
  rosterCount: number;
  teamCount: number;
  walkOnCount: number;
  pendingTeamCount: number;
  skippedReadOnlyNames: string[];
  syncStatus: 'SYNCED' | 'PENDING_OFFLINE' | 'LOCAL_ONLY';
}

export interface StopwatchOutboxFlushResult {
  syncedBatches: number;
  syncedEntries: number;
  remainingBatches: number;
  remainingEntries: number;
  deadLetteredBatches?: number;
}

export interface PartitionedStopwatchSave {
  selfActs: UnifiedActivity[];
  rosterByRunnerId: Map<string, UnifiedActivity[]>;
  teamApiEntries: Array<{ membershipId: string; activity: UnifiedActivity }>;
  walkOnEntries: Array<{ runnerId: string; runnerName: string; activity: UnifiedActivity }>;
  skippedReadOnlyNames: string[];
  savedCount: number;
}

export interface PartitionStopwatchOptions {
  isTeamCoach?: boolean;
  activeTeamMembershipIds?: ReadonlySet<string>;
}

function emitOutboxUpdatedEvent(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('thresh:stopwatch-outbox-updated'));
    } catch {
      // ignore
    }
  }
}

export function partitionSavedStopwatchEntries(
  entries: SavedStopwatchEntry[],
  combinedRoster: ConnectedAthleteRecord[],
  options?: PartitionStopwatchOptions
): PartitionedStopwatchSave {
  const selfActs: UnifiedActivity[] = [];
  const rosterByRunnerId = new Map<string, UnifiedActivity[]>();
  const teamApiEntries: Array<{ membershipId: string; activity: UnifiedActivity }> = [];
  const walkOnEntries: Array<{ runnerId: string; runnerName: string; activity: UnifiedActivity }> = [];
  const skippedReadOnlyNames: string[] = [];
  const rosterLookup = new Map(combinedRoster.map((a) => [a.id, a]));
  let savedCount = 0;

  for (const entry of entries || []) {
    if (!entry || !entry.activity) continue;
    if (entry.runnerId === 'SELF') {
      selfActs.push(entry.activity);
      savedCount += 1;
      continue;
    }

    const match = rosterLookup.get(entry.runnerId);
    if (entry.runnerId.startsWith('team-mem-')) {
      const membershipId = entry.runnerId.slice('team-mem-'.length);
      const canCoachWrite =
        (match && match.role === 'COACH_EDIT') ||
        Boolean(
          options?.isTeamCoach &&
            (!options.activeTeamMembershipIds ||
              options.activeTeamMembershipIds.has(membershipId))
        );
      if (canCoachWrite) {
        const list = rosterByRunnerId.get(entry.runnerId) || [];
        list.push(entry.activity);
        rosterByRunnerId.set(entry.runnerId, list);
        teamApiEntries.push({
          membershipId,
          activity: entry.activity,
        });
        savedCount += 1;
      } else {
        skippedReadOnlyNames.push(entry.runnerName || match?.name || entry.runnerId);
      }
      continue;
    }

    if (match) {
      if (match.role === 'COACH_EDIT') {
        const list = rosterByRunnerId.get(entry.runnerId) || [];
        list.push(entry.activity);
        rosterByRunnerId.set(entry.runnerId, list);
        savedCount += 1;
      } else {
        skippedReadOnlyNames.push(entry.runnerName || match.name);
      }
      continue;
    }

    // Walk-on runners are persisted strictly to the dedicated Walk-On log,
    // never colliding with or polluting the coach's own `'SELF'` activity stream.
    walkOnEntries.push({
      runnerId: entry.runnerId,
      runnerName: entry.runnerName || 'Walk-On Runner',
      activity: entry.activity,
    });
    savedCount += 1;
  }

  return {
    selfActs,
    rosterByRunnerId,
    teamApiEntries,
    walkOnEntries,
    skippedReadOnlyNames,
    savedCount,
  };
}

export function loadStopwatchOutbox(): StopwatchOutboxBatch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STOPWATCH_OUTBOX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is StopwatchOutboxBatch =>
        Boolean(b && typeof b.batchId === 'string' && typeof b.teamId === 'string' && Array.isArray(b.entries))
    );
  } catch {
    return [];
  }
}

export function saveStopwatchOutbox(batches: StopwatchOutboxBatch[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (batches.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.STOPWATCH_OUTBOX);
    } else {
      localStorage.setItem(STORAGE_KEYS.STOPWATCH_OUTBOX, JSON.stringify(batches));
    }
    emitOutboxUpdatedEvent();
  } catch {
    // ignore quota errors
  }
}

export function listDeadLetterStopwatchBatches(): StopwatchDeadLetterBatch[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STOPWATCH_OUTBOX_DEAD_LETTER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is StopwatchDeadLetterBatch =>
        Boolean(b && typeof b.batchId === 'string' && typeof b.teamId === 'string' && Array.isArray(b.entries))
    );
  } catch {
    return [];
  }
}

function saveDeadLetterStopwatchBatches(batches: StopwatchDeadLetterBatch[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (batches.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.STOPWATCH_OUTBOX_DEAD_LETTER);
    } else {
      localStorage.setItem(
        STORAGE_KEYS.STOPWATCH_OUTBOX_DEAD_LETTER,
        JSON.stringify(batches.slice(0, 50))
      );
    }
    emitOutboxUpdatedEvent();
  } catch {
    // ignore quota errors
  }
}

export function moveStopwatchBatchToDeadLetter(
  batch: StopwatchOutboxBatch,
  reason: string,
  status?: number
): void {
  const existing = listDeadLetterStopwatchBatches().filter(
    (item) => item.batchId !== batch.batchId
  );
  const deadLetterItem: StopwatchDeadLetterBatch = {
    ...batch,
    failedAt: new Date().toISOString(),
    reason,
    ...(typeof status === 'number' ? { status } : {}),
  };
  saveDeadLetterStopwatchBatches([deadLetterItem, ...existing]);
  removeStopwatchOutboxBatch(batch.batchId);
}

export function dismissDeadLetterStopwatchBatch(batchId: string): void {
  const remaining = listDeadLetterStopwatchBatches().filter((b) => b.batchId !== batchId);
  saveDeadLetterStopwatchBatches(remaining);
}

export function enqueueStopwatchOutboxBatch(
  teamId: string,
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>
): StopwatchOutboxBatch | null {
  if (!teamId || !Array.isArray(entries) || entries.length === 0) return null;
  const batch: StopwatchOutboxBatch = {
    batchId: `swb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    teamId,
    entries,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const next = [...loadStopwatchOutbox(), batch];
  saveStopwatchOutbox(next);
  return batch;
}

export function removeStopwatchOutboxBatch(batchId: string): void {
  const remaining = loadStopwatchOutbox().filter((b) => b.batchId !== batchId);
  saveStopwatchOutbox(remaining);
}

export function countPendingStopwatchOutboxEntries(teamId?: string): number {
  return loadStopwatchOutbox()
    .filter((b) => !teamId || b.teamId === teamId)
    .reduce((sum, b) => sum + b.entries.length, 0);
}

export function overlayPendingStopwatchOutboxOnTeams(
  teams: TeamSummaryWithRole[]
): TeamSummaryWithRole[] {
  if (!Array.isArray(teams) || teams.length === 0) return teams;
  const outbox = loadStopwatchOutbox();
  if (outbox.length === 0) return teams;

  const pendingByTeam = new Map<string, Map<string, UnifiedActivity[]>>();
  for (const batch of outbox) {
    let memMap = pendingByTeam.get(batch.teamId);
    if (!memMap) {
      memMap = new Map<string, UnifiedActivity[]>();
      pendingByTeam.set(batch.teamId, memMap);
    }
    for (const item of batch.entries) {
      if (!item?.membershipId || !item?.activity?.id) continue;
      const list = memMap.get(item.membershipId) || [];
      list.push(item.activity);
      memMap.set(item.membershipId, list);
    }
  }

  return teams.map((team) => {
    const memMap = pendingByTeam.get(team.brand.teamId);
    if (!memMap || memMap.size === 0) return team;
    return {
      ...team,
      memberships: team.memberships.map((m) => {
        const pendingActs = memMap.get(m.membershipId);
        if (!pendingActs || pendingActs.length === 0) return m;
        const pendingIds = new Set(pendingActs.map((a) => a.id));
        const existingRecorded = Array.isArray(m.coachRecordedActivities)
          ? m.coachRecordedActivities.filter((a) => !pendingIds.has(a.id))
          : [];
        return {
          ...m,
          coachRecordedActivities: [...pendingActs, ...existingRecorded].slice(0, 50),
        };
      }),
    };
  });
}

export function loadWalkOnStopwatchEntriesLocal(): WalkOnStopwatchEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WALKON_STOPWATCH_LOGS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistWalkOnStopwatchEntriesLocal(
  entries: Array<{ runnerId: string; runnerName: string; activity: UnifiedActivity }>
): WalkOnStopwatchEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return loadWalkOnStopwatchEntriesLocal();
  const savedAt = new Date().toISOString();
  const incomingIds = new Set(entries.map((e) => e.activity.id));
  const existing = loadWalkOnStopwatchEntriesLocal().filter(
    (item) => item?.activity?.id && !incomingIds.has(item.activity.id)
  );
  const next: WalkOnStopwatchEntry[] = [
    ...entries.map((e) => ({
      runnerId: e.runnerId,
      runnerName: e.runnerName,
      activity: e.activity,
      savedAt,
    })),
    ...existing,
  ].slice(0, 100);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.WALKON_STOPWATCH_LOGS, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }
  return next;
}

export async function persistCoachStopwatchActivitiesToServer(
  teamId: string,
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>
): Promise<PersistStopwatchResult> {
  if (!teamId || entries.length === 0 || typeof fetch !== 'function') {
    return {
      ok: false,
      team: null,
      status: null,
      error: 'Missing team or entries',
      permanentFailure: true,
    };
  }

  try {
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/stopwatch-activities`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      team?: TeamSummaryWithRole;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        team: null,
        status: res.status,
        error: data?.error || `HTTP ${res.status}`,
        permanentFailure: PERMANENT_ERROR_STATUSES.has(res.status),
      };
    }
    if (data.ok && data.team) {
      return { ok: true, team: data.team, status: res.status, permanentFailure: false };
    }
    return {
      ok: false,
      team: null,
      status: res.status,
      error: data?.error || 'Invalid server response',
      permanentFailure: false,
    };
  } catch (err) {
    return {
      ok: false,
      team: null,
      status: null,
      error: err instanceof Error ? err.message : 'Network failure',
      permanentFailure: false,
    };
  }
}

let inFlightOutboxFlush: Promise<StopwatchOutboxFlushResult> | null = null;

/**
 * Flushes pending offline stopwatch team split batches in FIFO order whenever the network is reachable.
 * Permanent 4xx poison pills (400/403/404/422) and batches exceeding MAX_OUTBOX_ATTEMPTS are moved
 * to dead-letter storage so valid batches queued behind them flush immediately.
 */
export async function flushStopwatchOutbox(
  onTeamUpdated?: (team: TeamSummaryWithRole) => void
): Promise<StopwatchOutboxFlushResult> {
  if (inFlightOutboxFlush) {
    return inFlightOutboxFlush;
  }

  inFlightOutboxFlush = (async () => {
    const initialOutbox = loadStopwatchOutbox();
    if (initialOutbox.length === 0) {
      return {
        syncedBatches: 0,
        syncedEntries: 0,
        remainingBatches: 0,
        remainingEntries: 0,
        deadLetteredBatches: 0,
      };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const remainingEntries = initialOutbox.reduce((s, b) => s + b.entries.length, 0);
      return {
        syncedBatches: 0,
        syncedEntries: 0,
        remainingBatches: initialOutbox.length,
        remainingEntries,
        deadLetteredBatches: 0,
      };
    }

    let syncedBatches = 0;
    let syncedEntries = 0;
    let deadLetteredBatches = 0;

    for (const batch of initialOutbox) {
      if ((batch.attempts || 0) >= MAX_OUTBOX_ATTEMPTS) {
        moveStopwatchBatchToDeadLetter(
          batch,
          batch.lastError || `Exhausted ${MAX_OUTBOX_ATTEMPTS} sync attempts`
        );
        deadLetteredBatches += 1;
        continue;
      }

      const result = await persistCoachStopwatchActivitiesToServer(batch.teamId, batch.entries);
      if (result.ok && result.team) {
        syncedBatches += 1;
        syncedEntries += batch.entries.length;
        removeStopwatchOutboxBatch(batch.batchId);
        onTeamUpdated?.(result.team);
      } else if (result.permanentFailure) {
        const nextAttempts = (batch.attempts || 0) + 1;
        const reason = result.error || `HTTP ${result.status ?? 'error'}`;
        moveStopwatchBatchToDeadLetter(
          { ...batch, attempts: nextAttempts, lastError: reason },
          reason,
          result.status ?? undefined
        );
        deadLetteredBatches += 1;
      } else {
        const nextAttempts = (batch.attempts || 0) + 1;
        const reason = result.error || 'Pending network sync';
        if (nextAttempts >= MAX_OUTBOX_ATTEMPTS) {
          moveStopwatchBatchToDeadLetter(
            { ...batch, attempts: nextAttempts, lastError: reason },
            `Exhausted ${MAX_OUTBOX_ATTEMPTS} attempts (${reason})`,
            result.status ?? undefined
          );
          deadLetteredBatches += 1;
        } else {
          const latestOutbox = loadStopwatchOutbox().map((b) =>
            b.batchId === batch.batchId
              ? {
                  ...b,
                  attempts: nextAttempts,
                  lastError: reason,
                }
              : b
          );
          saveStopwatchOutbox(latestOutbox);
        }
      }
    }

    const finalOutbox = loadStopwatchOutbox();
    return {
      syncedBatches,
      syncedEntries,
      remainingBatches: finalOutbox.length,
      remainingEntries: finalOutbox.reduce((s, b) => s + b.entries.length, 0),
      deadLetteredBatches,
    };
  })().finally(() => {
    inFlightOutboxFlush = null;
  });

  return inFlightOutboxFlush;
}
