import type { SavedStopwatchEntry } from '../components/TracksideStopwatchView';
import type {
  ConnectedAthleteRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../types';

export interface PartitionedStopwatchSave {
  selfActs: UnifiedActivity[];
  rosterByRunnerId: Map<string, UnifiedActivity[]>;
  teamApiEntries: Array<{ membershipId: string; activity: UnifiedActivity }>;
  savedCount: number;
}

export function partitionSavedStopwatchEntries(
  entries: SavedStopwatchEntry[],
  combinedRoster: ConnectedAthleteRecord[]
): PartitionedStopwatchSave {
  const selfActs: UnifiedActivity[] = [];
  const rosterByRunnerId = new Map<string, UnifiedActivity[]>();
  const teamApiEntries: Array<{ membershipId: string; activity: UnifiedActivity }> = [];
  const rosterLookup = new Map(combinedRoster.map((a) => [a.id, a]));
  let savedCount = 0;

  for (const entry of entries || []) {
    if (entry.runnerId === 'SELF') {
      selfActs.push(entry.activity);
      savedCount += 1;
      continue;
    }

    const match = rosterLookup.get(entry.runnerId);
    if (match && match.role === 'COACH_EDIT') {
      const list = rosterByRunnerId.get(entry.runnerId) || [];
      list.push(entry.activity);
      rosterByRunnerId.set(entry.runnerId, list);
      if (entry.runnerId.startsWith('team-mem-')) {
        teamApiEntries.push({
          membershipId: entry.runnerId.slice('team-mem-'.length),
          activity: entry.activity,
        });
      }
      savedCount += 1;
    }
  }

  return { selfActs, rosterByRunnerId, teamApiEntries, savedCount };
}

export async function persistCoachStopwatchActivitiesToServer(
  teamId: string,
  entries: Array<{ membershipId: string; activity: UnifiedActivity }>
): Promise<TeamSummaryWithRole | null> {
  if (!teamId || entries.length === 0 || typeof fetch !== 'function') return null;

  try {
    const token =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('aeropulse_session_token') || ''
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
