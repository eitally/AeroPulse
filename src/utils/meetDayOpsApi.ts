import type {
  MeetDayPacketEntryRecord,
  MeetDayPacketRecord,
  TeamSummaryWithRole,
} from '../types.ts';
import type { MeetEntryRecord } from '../physiology/meetDayOpsEngine.ts';
import { STORAGE_KEYS } from './storageKeys.ts';
import { TeamLifecycleApiError, buildThreshSessionHeaders } from './teamLifecycleApi.ts';

async function requestMeetDayJson<T>(
  url: string,
  init: RequestInit
): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data?.ok === false) {
    throw new TeamLifecycleApiError(data?.error || 'Request failed.', resp.status);
  }
  return data;
}

export function fetchMeetDayPacketsApi(teamId: string) {
  return requestMeetDayJson<{ packets: MeetDayPacketRecord[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/meet-day-packets`,
    { method: 'GET' }
  );
}

export function saveMeetDayPacketApi(
  teamId: string,
  packet: {
    packetId?: string;
    meetTitle: string;
    meetDate: string;
    laneCount: number;
    flightSize: number;
    partitionByDivision: boolean;
    entries: MeetDayPacketEntryRecord[];
  }
) {
  return requestMeetDayJson<{
    packet: MeetDayPacketRecord;
    packets: MeetDayPacketRecord[];
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/meet-day-packets`, {
    method: 'POST',
    body: JSON.stringify(packet),
  });
}

export function deleteMeetDayPacketApi(teamId: string, packetId: string) {
  return requestMeetDayJson<{
    packets: MeetDayPacketRecord[];
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(
    `/api/teams/${encodeURIComponent(teamId)}/meet-day-packets/${encodeURIComponent(packetId)}`,
    { method: 'DELETE' }
  );
}

export function meetEntriesToPacketEntries(
  entries: MeetEntryRecord[]
): MeetDayPacketEntryRecord[] {
  return entries.map((e) => ({
    id: e.id,
    athleteName: e.athleteName,
    ...(e.athleteId ? { membershipId: e.athleteId } : {}),
    ...(e.genderDivision ? { genderDivision: e.genderDivision } : {}),
    ...(e.division ? { division: e.division } : {}),
    ...(e.graduationYear ? { graduationYear: e.graduationYear } : {}),
    eventCode: e.eventCode,
    seedMarkRaw: e.seedMark || 'NT',
    ...(e.relayTeamCode ? { relayTeamCode: e.relayTeamCode } : {}),
    ...(e.relayLegOrder ? { relayLegOrder: e.relayLegOrder } : {}),
  }));
}

export function packetEntriesToMeetEntries(
  packetEntries: MeetDayPacketEntryRecord[]
): MeetEntryRecord[] {
  return packetEntries.map((p) => ({
    id: p.id,
    athleteId: p.membershipId || p.id,
    athleteName: p.athleteName,
    ...(p.genderDivision ? { genderDivision: p.genderDivision } : {}),
    ...(p.division ? { division: p.division } : {}),
    ...(p.graduationYear ? { graduationYear: p.graduationYear } : {}),
    eventCode: p.eventCode,
    seedMark: p.seedMarkRaw || 'NT',
    ...(p.relayTeamCode ? { relayTeamCode: p.relayTeamCode } : {}),
    ...(p.relayLegOrder ? { relayLegOrder: p.relayLegOrder } : {}),
  }));
}

type LocalMeetPacketStore = Record<string, MeetDayPacketRecord[]>;

function readLocalPacketStore(): LocalMeetPacketStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.MEET_DAY_PACKETS_LOCAL);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as LocalMeetPacketStore;
  } catch {
    return {};
  }
}

function writeLocalPacketStore(store: LocalMeetPacketStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.MEET_DAY_PACKETS_LOCAL, JSON.stringify(store));
  } catch {
    // ignore storage quota errors
  }
}

export function loadLocalMeetDayPackets(teamScopeKey = 'local'): MeetDayPacketRecord[] {
  const store = readLocalPacketStore();
  const list = store[teamScopeKey];
  return Array.isArray(list) ? list : [];
}

export function saveLocalMeetDayPacket(
  teamScopeKey: string,
  packet: Omit<MeetDayPacketRecord, 'updatedAt'> & { updatedAt?: string }
): MeetDayPacketRecord[] {
  const store = readLocalPacketStore();
  const prev = Array.isArray(store[teamScopeKey]) ? store[teamScopeKey] : [];
  const nextPacket: MeetDayPacketRecord = {
    ...packet,
    updatedAt: packet.updatedAt || new Date().toISOString(),
  };
  const nextList = [
    nextPacket,
    ...prev.filter((p) => p.packetId !== nextPacket.packetId),
  ].slice(0, 30);
  writeLocalPacketStore({ ...store, [teamScopeKey]: nextList });
  return nextList;
}

export function deleteLocalMeetDayPacket(
  teamScopeKey: string,
  packetId: string
): MeetDayPacketRecord[] {
  const store = readLocalPacketStore();
  const prev = Array.isArray(store[teamScopeKey]) ? store[teamScopeKey] : [];
  const nextList = prev.filter((p) => p.packetId !== packetId);
  writeLocalPacketStore({ ...store, [teamScopeKey]: nextList });
  return nextList;
}
