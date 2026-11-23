import crypto from 'crypto';
import type {
  MeetDayPacketEntryRecord,
  MeetDayPacketRecord,
  TeamSummaryWithRole,
} from '../src/types.ts';
import {
  canProgramWorkoutsRole,
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from './teamStoreCore.ts';
import { appendAuditLogAsync, withTeamRowLock } from './tokenVault.ts';

function sanitizeMeetDayPacketEntry(
  raw: unknown,
  idx: number
): MeetDayPacketEntryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const athleteName = String(obj.athleteName || '').trim().slice(0, 64);
  const eventCode = String(obj.eventCode || '').trim().slice(0, 24);
  if (!athleteName || !eventCode) return null;

  const rawGender = String(obj.genderDivision || '').trim().toUpperCase();
  const genderDivision =
    rawGender === 'M' || rawGender === 'F' || rawGender === 'NONBINARY'
      ? (rawGender as 'M' | 'F' | 'NONBINARY')
      : undefined;

  const division =
    typeof obj.division === 'string' && obj.division.trim()
      ? obj.division.trim().slice(0, 32)
      : undefined;

  const membershipId =
    typeof obj.membershipId === 'string' && obj.membershipId.trim()
      ? obj.membershipId.trim().slice(0, 64)
      : undefined;

  const gradNum =
    typeof obj.graduationYear === 'number' && Number.isFinite(obj.graduationYear)
      ? Math.round(obj.graduationYear)
      : undefined;
  const graduationYear =
    gradNum && gradNum >= 2000 && gradNum <= 2045 ? gradNum : undefined;

  const seedMarkRaw = String(obj.seedMarkRaw ?? 'NT').trim().slice(0, 32) || 'NT';

  const relayTeamCode =
    typeof obj.relayTeamCode === 'string' && obj.relayTeamCode.trim()
      ? obj.relayTeamCode.trim().toUpperCase().slice(0, 4)
      : undefined;

  const rawLeg =
    typeof obj.relayLegOrder === 'number' && Number.isInteger(obj.relayLegOrder)
      ? obj.relayLegOrder
      : undefined;
  const relayLegOrder =
    rawLeg === 1 || rawLeg === 2 || rawLeg === 3 || rawLeg === 4 ? rawLeg : undefined;

  const id =
    typeof obj.id === 'string' && obj.id.trim()
      ? obj.id.trim().slice(0, 64)
      : `entry_${idx}_${crypto.randomBytes(4).toString('hex')}`;

  return {
    id,
    athleteName,
    ...(membershipId ? { membershipId } : {}),
    ...(genderDivision ? { genderDivision } : {}),
    ...(division ? { division } : {}),
    ...(graduationYear ? { graduationYear } : {}),
    eventCode,
    seedMarkRaw,
    ...(relayTeamCode ? { relayTeamCode } : {}),
    ...(relayLegOrder ? { relayLegOrder } : {}),
  };
}

export async function listMeetDayPackets(params: {
  callerSid: string;
  teamId: string;
}): Promise<{
  ok: boolean;
  status?: number;
  packets?: MeetDayPacketRecord[];
  error?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) {
    return { ok: false, status: 404, error: 'Team not found.' };
  }
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
    return { ok: false, status: 403, error: 'Coaching staff permissions required.' };
  }
  return {
    ok: true,
    packets: doc.meetDayPackets || [],
  };
}

export async function saveMeetDayPacket(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  packet: {
    packetId?: unknown;
    meetTitle?: unknown;
    meetDate?: unknown;
    laneCount?: unknown;
    flightSize?: unknown;
    partitionByDivision?: unknown;
    entries?: unknown;
  };
}): Promise<{
  ok: boolean;
  status?: number;
  packet?: MeetDayPacketRecord;
  packets?: MeetDayPacketRecord[];
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanTitle = String(params.packet?.meetTitle || '').trim().slice(0, 120);
  if (!cleanTitle) {
    return { ok: false, status: 400, error: 'Meet title is required.' };
  }

  const rawDate = String(params.packet?.meetDate || '').trim().slice(0, 10);
  const meetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  const rawLaneCount = Number(params.packet?.laneCount);
  const laneCount = Number.isFinite(rawLaneCount)
    ? Math.max(4, Math.min(16, Math.round(rawLaneCount)))
    : 8;

  const rawFlightSize = Number(params.packet?.flightSize);
  const flightSize = Number.isFinite(rawFlightSize)
    ? Math.max(4, Math.min(24, Math.round(rawFlightSize)))
    : 12;

  const partitionByDivision = params.packet?.partitionByDivision !== false;

  const rawEntries = Array.isArray(params.packet?.entries) ? params.packet.entries : [];
  const entries: MeetDayPacketEntryRecord[] = [];
  for (let i = 0; i < Math.min(500, rawEntries.length); i++) {
    const clean = sanitizeMeetDayPacketEntry(rawEntries[i], i);
    if (clean) entries.push(clean);
  }

  const requestedPacketId =
    typeof params.packet?.packetId === 'string'
      ? params.packet.packetId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      : '';
  const packetId = requestedPacketId || `mdp_${crypto.randomBytes(6).toString('hex')}`;

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, status: 404, error: 'Team not found.' };
    }

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Coach or Org Admin permissions required to manage meet-day packets.',
      };
    }

    const nowIso = new Date().toISOString();
    const savedPacket: MeetDayPacketRecord = {
      packetId,
      meetTitle: cleanTitle,
      meetDate,
      laneCount,
      flightSize,
      partitionByDivision,
      entries,
      updatedAt: nowIso,
      updatedByName: callerMem.invitedName || doc.brand.coachDisplayName || 'Coach',
    };

    const existing = Array.isArray(doc.meetDayPackets) ? doc.meetDayPackets : [];
    doc.meetDayPackets = [
      savedPacket,
      ...existing.filter((p) => p.packetId !== packetId),
    ].slice(0, 50);
    doc.updatedAt = nowIso;

    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'MEET_DAY_PACKET_SAVED',
      targetId: packetId,
      metadata: {
        meetTitle: cleanTitle,
        entryCount: entries.length,
        partitionByDivision,
      },
    });

    return {
      ok: true,
      packet: savedPacket,
      packets: doc.meetDayPackets,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}

export async function deleteMeetDayPacket(params: {
  callerSid: string;
  teamId: string;
  packetId: string;
  originUrl: string;
}): Promise<{
  ok: boolean;
  status?: number;
  packets?: MeetDayPacketRecord[];
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const cleanPacketId = String(params.packetId || '').trim();
  if (!cleanPacketId) {
    return { ok: false, status: 400, error: 'Packet ID is required.' };
  }

  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false, status: 404, error: 'Team not found.' };
    }

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
    );
    if (
      !callerMem ||
      (!canProgramWorkoutsRole(callerMem.role) && callerMem.role !== 'ORG_ADMIN')
    ) {
      return {
        ok: false,
        status: 403,
        error: 'Coach or Org Admin permissions required to delete meet-day packets.',
      };
    }

    const before = Array.isArray(doc.meetDayPackets) ? doc.meetDayPackets : [];
    const next = before.filter((p) => p.packetId !== cleanPacketId);
    if (next.length === before.length) {
      return { ok: false, status: 404, error: 'Meet-day packet not found.' };
    }

    doc.meetDayPackets = next;
    doc.updatedAt = new Date().toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'MEET_DAY_PACKET_DELETED',
      targetId: cleanPacketId,
      metadata: {},
    });

    return {
      ok: true,
      packets: doc.meetDayPackets,
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });
}
