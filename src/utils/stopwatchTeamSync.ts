import type { SavedStopwatchEntry } from '../components/TracksideStopwatchView';
import type {
  ConnectedAthleteRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../types';
import { STORAGE_KEYS } from './storageKeys';

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
): Promise<TeamSummaryWithRole | null> {
  if (!teamId || entries.length === 0 || typeof fetch !== 'function') return null;

  try {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN) || ''
        : '';
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamId)}/stopwatch-activities`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-session-token': token } : {}),
        },
        body: JSON.stringify({ entries }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; team?: TeamSummaryWithRole };
    return data.ok && data.team ? data.team : null;
  } catch {
    return null;
  }
}

let inFlightOutboxFlush: Promise<StopwatchOutboxFlushResult> | null = null;

/**
 * Flushes pending offline stopwatch team split batches in FIFO order whenever the network is reachable.
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
      return { syncedBatches: 0, syncedEntries: 0, remainingBatches: 0, remainingEntries: 0 };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const remainingEntries = initialOutbox.reduce((s, b) => s + b.entries.length, 0);
      return {
        syncedBatches: 0,
        syncedEntries: 0,
        remainingBatches: initialOutbox.length,
        remainingEntries,
      };
    }

    let syncedBatches = 0;
    let syncedEntries = 0;

    for (const batch of initialOutbox) {
      const updatedTeam = await persistCoachStopwatchActivitiesToServer(batch.teamId, batch.entries);
      if (updatedTeam) {
        syncedBatches += 1;
        syncedEntries += batch.entries.length;
        removeStopwatchOutboxBatch(batch.batchId);
        onTeamUpdated?.(updatedTeam);
      } else {
        const latestOutbox = loadStopwatchOutbox().map((b) =>
          b.batchId === batch.batchId
            ? {
                ...b,
                attempts: (b.attempts || 0) + 1,
                lastError: 'Pending network sync',
              }
            : b
        );
        saveStopwatchOutbox(latestOutbox);
      }
    }

    const finalOutbox = loadStopwatchOutbox();
    return {
      syncedBatches,
      syncedEntries,
      remainingBatches: finalOutbox.length,
      remainingEntries: finalOutbox.reduce((s, b) => s + b.entries.length, 0),
    };
  })().finally(() => {
    inFlightOutboxFlush = null;
  });

  return inFlightOutboxFlush;
}
