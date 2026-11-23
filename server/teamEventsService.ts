import crypto from 'crypto';
import type {
  CoachEventGroup,
  CuratedMeetAlbumLink,
  CuratedMeetAlbumProvider,
  TeamBroadcastWorkout,
  TeamEventRecord,
  TeamEventRsvpCounts,
  TeamEventRsvpRecord,
  TeamEventRsvpStatus,
  TeamEventTravelMode,
  TeamEventType,
  TeamEventVisibilityScope,
  TeamEventsOverviewPayload,
} from '../src/types.ts';
import {
  canViewSafeguardingMedicalRole,
  loadTeamDocRaw,
  resolveLinkedChildMembershipIds,
  sanitizeTargetEventGroups,
} from './teamStoreCore.ts';
import { isSafeHttpsUrl } from './securityUtils.ts';
import {
  appendAuditLogAsync,
  deleteTeamEventPostgresAsync,
  listTeamEventRsvpsPostgresAsync,
  listTeamEventsPostgresAsync,
  loadTenantVaultAsync,
  sanitizeTenantId,
  saveTenantVaultAsync,
  upsertTeamEventPostgresAsync,
  upsertTeamEventRsvpPostgresAsync,
  withVaultLock,
} from './tokenVault.ts';

const VALID_EVENT_TYPES = new Set<TeamEventType>([
  'PRACTICE',
  'MEET',
  'BUS_TRAVEL',
  'TEAM_MEETING',
]);

const VALID_VISIBILITY_SCOPES = new Set<TeamEventVisibilityScope>([
  'TEAM_AND_FAMILIES_ONLY',
  'PUBLIC_HUB',
  'STAFF_ONLY',
]);

const VALID_RSVP_STATUSES = new Set<TeamEventRsvpStatus>([
  'GOING',
  'OUT',
  'LATE',
  'MEET_CONFLICT',
  'UNDECIDED',
]);

const VALID_TRAVEL_MODES = new Set<TeamEventTravelMode>([
  'TEAM_BUS',
  'PARENT_PICKUP',
  'SELF_TRAVEL',
]);

const VALID_ALBUM_PROVIDERS = new Set<CuratedMeetAlbumProvider>([
  'GOOGLE_PHOTOS',
  'APPLE_ICLOUD',
  'SMUGMUG',
  'SHUTTERFLY',
  'HUDL',
  'OTHER',
]);

function teamEventsVaultKey(teamId: string): string {
  return `team_events_${sanitizeTenantId(teamId)}`;
}

function teamRsvpsVaultKey(teamId: string): string {
  return `team_rsvps_${sanitizeTenantId(teamId)}`;
}

function computeRsvpCounts(rsvps: TeamEventRsvpRecord[]): TeamEventRsvpCounts {
  const counts: TeamEventRsvpCounts = {
    going: 0,
    out: 0,
    late: 0,
    conflict: 0,
    undecided: 0,
  };
  for (const r of rsvps) {
    if (r.status === 'GOING') counts.going += 1;
    else if (r.status === 'OUT') counts.out += 1;
    else if (r.status === 'LATE') counts.late += 1;
    else if (r.status === 'MEET_CONFLICT') counts.conflict += 1;
    else counts.undecided += 1;
  }
  return counts;
}

function sanitizeCuratedAlbumLinks(
  raw: unknown,
  authorName: string,
  nowIso: string
): { links: CuratedMeetAlbumLink[]; error?: string } {
  if (!Array.isArray(raw)) return { links: [] };
  const links: CuratedMeetAlbumLink[] = [];
  for (const entry of raw.slice(0, 5)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const rawUrl = String(item.url || '').trim();
    if (!rawUrl) continue;
    if (!isSafeHttpsUrl(rawUrl)) {
      return {
        links: [],
        error: 'Album links must use https:// URLs.',
      };
    }
    const label = String(item.label || 'Meet Photo Album').trim().slice(0, 80) || 'Meet Photo Album';
    const rawProvider = String(item.provider || '').trim().toUpperCase() as CuratedMeetAlbumProvider;
    const visibility =
      item.visibility === 'PUBLIC_HUB' ? 'PUBLIC_HUB' : 'TEAM_AND_FAMILIES_ONLY';
    links.push({
      id: String(item.id || `alb_${crypto.randomBytes(4).toString('hex')}`).trim(),
      label,
      url: rawUrl,
      ...(VALID_ALBUM_PROVIDERS.has(rawProvider) ? { provider: rawProvider } : {}),
      visibility,
      addedByName: String(item.addedByName || authorName).trim().slice(0, 60) || authorName,
      addedAt: String(item.addedAt || nowIso),
    });
  }
  return { links };
}

async function loadStoredEvents(teamId: string): Promise<TeamEventRecord[]> {
  const pgEvents = await listTeamEventsPostgresAsync<TeamEventRecord>(teamId);
  if (pgEvents !== null) return pgEvents;
  return loadTenantVaultAsync<TeamEventRecord[]>(teamEventsVaultKey(teamId), []);
}

async function loadStoredRsvps(teamId: string): Promise<TeamEventRsvpRecord[]> {
  const pgRows = await listTeamEventRsvpsPostgresAsync(teamId);
  if (pgRows !== null) {
    return pgRows.map((r) => ({
      eventId: r.event_id,
      membershipId: r.membership_id,
      status: VALID_RSVP_STATUSES.has(r.status as TeamEventRsvpStatus)
        ? (r.status as TeamEventRsvpStatus)
        : 'UNDECIDED',
      ...(r.travel_mode && VALID_TRAVEL_MODES.has(r.travel_mode as TeamEventTravelMode)
        ? { travelMode: r.travel_mode as TeamEventTravelMode }
        : {}),
      ...(r.note ? { note: r.note } : {}),
      updatedByRole: r.updated_by_role as TeamEventRsvpRecord['updatedByRole'],
      updatedAt: r.updated_at,
    }));
  }
  return loadTenantVaultAsync<TeamEventRsvpRecord[]>(teamRsvpsVaultKey(teamId), []);
}

function projectSyntheticEventsFromTeamDoc(params: {
  teamId: string;
  storedEvents: TeamEventRecord[];
  broadcastWorkouts?: TeamBroadcastWorkout[];
  meetDayPackets?: import('../src/types.ts').MeetDayPacketRecord[];
}): TeamEventRecord[] {
  const byId = new Map<string, TeamEventRecord>();
  const matchedBroadcastIds = new Set<string>();
  const matchedPacketIds = new Set<string>();

  for (const ev of params.storedEvents) {
    byId.set(ev.eventId, ev);
    if (ev.broadcastId) matchedBroadcastIds.add(ev.broadcastId);
    if (ev.packetId) matchedPacketIds.add(ev.packetId);
  }

  for (const pkt of params.meetDayPackets || []) {
    if (matchedPacketIds.has(pkt.packetId)) continue;
    const syntheticId = pkt.eventId || `pkt_${pkt.packetId}`;
    if (byId.has(syntheticId)) continue;
    const liveUrl = pkt.liveResultsUrl || pkt.athleticLiveUrl;
    byId.set(syntheticId, {
      eventId: syntheticId,
      teamId: params.teamId,
      eventType: 'MEET',
      title: pkt.meetTitle,
      date: pkt.meetDate,
      ...(typeof pkt.meetDelayMinutes === 'number' ? { meetDelayMinutes: pkt.meetDelayMinutes } : {}),
      ...(liveUrl && isSafeHttpsUrl(liveUrl) ? { liveResultsUrl: liveUrl } : {}),
      ...(pkt.liveResultsLabel ? { liveResultsLabel: pkt.liveResultsLabel } : {}),
      ...(pkt.curatedAlbumLinks?.length ? { curatedAlbumLinks: pkt.curatedAlbumLinks } : {}),
      visibilityScope: 'TEAM_AND_FAMILIES_ONLY',
      packetId: pkt.packetId,
      createdAt: pkt.updatedAt,
      updatedAt: pkt.updatedAt,
    });
  }

  for (const bc of params.broadcastWorkouts || []) {
    if (matchedBroadcastIds.has(bc.broadcastId)) continue;
    const syntheticId = bc.eventId || `bc_${bc.broadcastId}`;
    if (byId.has(syntheticId)) continue;
    if (!bc.isOfficialMeet && !bc.scheduledTime) continue;
    byId.set(syntheticId, {
      eventId: syntheticId,
      teamId: params.teamId,
      eventType: bc.isOfficialMeet ? 'MEET' : 'PRACTICE',
      title: bc.name,
      date: bc.date,
      ...(bc.scheduledTime ? { startTime: bc.scheduledTime } : {}),
      ...(bc.locationName ? { locationName: bc.locationName } : {}),
      ...(bc.liveResultsUrl && isSafeHttpsUrl(bc.liveResultsUrl)
        ? { liveResultsUrl: bc.liveResultsUrl }
        : {}),
      ...(bc.liveResultsLabel ? { liveResultsLabel: bc.liveResultsLabel } : {}),
      ...(bc.curatedAlbumLinks?.length ? { curatedAlbumLinks: bc.curatedAlbumLinks } : {}),
      ...(bc.targetEventGroups?.length ? { targetEventGroups: bc.targetEventGroups } : {}),
      visibilityScope: 'TEAM_AND_FAMILIES_ONLY',
      broadcastId: bc.broadcastId,
      createdAt: bc.createdAt,
      updatedAt: bc.createdAt,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function listTeamEventsForCaller(params: {
  callerSid: string;
  teamId: string;
}): Promise<{ ok: boolean; status?: number; payload?: TeamEventsOverviewPayload; error?: string }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem) {
    return { ok: false, status: 403, error: 'Team membership required.' };
  }

  const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
  const linkedChildIds = resolveLinkedChildMembershipIds(doc.memberships, callerMem);

  const [storedEvents, storedRsvps] = await Promise.all([
    loadStoredEvents(params.teamId),
    loadStoredRsvps(params.teamId),
  ]);

  const allEvents = projectSyntheticEventsFromTeamDoc({
    teamId: params.teamId,
    storedEvents,
    broadcastWorkouts: doc.broadcastWorkouts,
    meetDayPackets: doc.meetDayPackets,
  }).filter((ev) => isStaff || ev.visibilityScope !== 'STAFF_ONLY');

  const rsvpsGrouped = new Map<string, TeamEventRsvpRecord[]>();
  for (const rsvp of storedRsvps) {
    const arr = rsvpsGrouped.get(rsvp.eventId) || [];
    arr.push(rsvp);
    rsvpsGrouped.set(rsvp.eventId, arr);
  }

  const rsvpCountsByEventId: Record<string, TeamEventRsvpCounts> = {};
  const rsvpsByEventId: Record<string, TeamEventRsvpRecord[]> = {};
  const myRsvps: TeamEventRsvpRecord[] = [];

  for (const ev of allEvents) {
    const list = rsvpsGrouped.get(ev.eventId) || [];
    rsvpCountsByEventId[ev.eventId] = computeRsvpCounts(list);
    if (isStaff) {
      rsvpsByEventId[ev.eventId] = list;
    }
    for (const rsvp of list) {
      const isOwn = rsvp.membershipId === callerMem.membershipId;
      const isChild = Boolean(linkedChildIds && linkedChildIds.has(rsvp.membershipId));
      if (isOwn || isChild) {
        myRsvps.push(rsvp);
      }
    }
  }

  return {
    ok: true,
    payload: {
      events: allEvents,
      rsvpCountsByEventId,
      myRsvps,
      ...(isStaff ? { rsvpsByEventId } : {}),
    },
  };
}

export async function upsertTeamEvent(params: {
  callerSid: string;
  teamId: string;
  input: Record<string, unknown>;
  originUrl?: string;
}): Promise<{
  ok: boolean;
  status?: number;
  event?: TeamEventRecord;
  photoReleaseOptOutNames?: string[];
  error?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
    return { ok: false, status: 403, error: 'Coach or team staff permissions required.' };
  }

  const cleanDate = String(params.input.date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { ok: false, status: 400, error: 'Valid YYYY-MM-DD event date required.' };
  }
  const cleanTitle = String(params.input.title || '').trim().slice(0, 140);
  if (!cleanTitle) {
    return { ok: false, status: 400, error: 'Event title is required.' };
  }

  const rawType = String(params.input.eventType || 'PRACTICE').trim().toUpperCase() as TeamEventType;
  const eventType: TeamEventType = VALID_EVENT_TYPES.has(rawType) ? rawType : 'PRACTICE';

  const rawVis = String(params.input.visibilityScope || 'TEAM_AND_FAMILIES_ONLY')
    .trim()
    .toUpperCase() as TeamEventVisibilityScope;
  const visibilityScope: TeamEventVisibilityScope = VALID_VISIBILITY_SCOPES.has(rawVis)
    ? rawVis
    : 'TEAM_AND_FAMILIES_ONLY';

  const liveResultsUrl = String(params.input.liveResultsUrl || '').trim();
  if (liveResultsUrl && !isSafeHttpsUrl(liveResultsUrl)) {
    return { ok: false, status: 400, error: 'Live timing link must use an https:// URL.' };
  }

  const nowIso = new Date().toISOString();
  const albumValidation = sanitizeCuratedAlbumLinks(
    params.input.curatedAlbumLinks,
    callerMem.invitedName,
    nowIso
  );
  if (albumValidation.error) {
    return { ok: false, status: 400, error: albumValidation.error };
  }

  const hasPublicAlbum = albumValidation.links.some((l) => l.visibility === 'PUBLIC_HUB');
  const photoReleaseOptOutNames = hasPublicAlbum
    ? doc.memberships
        .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.photoReleaseOptOut)
        .map((m) => m.invitedName)
    : [];

  const targetEventGroups: CoachEventGroup[] = Array.isArray(params.input.targetEventGroups)
    ? sanitizeTargetEventGroups(
        params.input.targetEventGroups.map((g) => String(g))
      ) || []
    : [];

  const eventId =
    String(params.input.eventId || '').trim().slice(0, 80) ||
    `ev_${crypto.randomBytes(6).toString('hex')}`;

  const safeDelay =
    typeof params.input.meetDelayMinutes === 'number' &&
    Number.isFinite(params.input.meetDelayMinutes)
      ? Math.max(0, Math.min(240, Math.round(params.input.meetDelayMinutes)))
      : undefined;

  const existingPg = await listTeamEventsPostgresAsync<TeamEventRecord>(params.teamId);
  let createdAt = nowIso;
  if (existingPg) {
    const prev = existingPg.find((e) => e.eventId === eventId);
    if (prev?.createdAt) createdAt = prev.createdAt;
  }

  const nextEvent: TeamEventRecord = {
    eventId,
    teamId: params.teamId,
    eventType,
    title: cleanTitle,
    date: cleanDate,
    ...(typeof params.input.startTime === 'string' && params.input.startTime.trim()
      ? { startTime: params.input.startTime.trim().slice(0, 16) }
      : {}),
    ...(typeof params.input.endTime === 'string' && params.input.endTime.trim()
      ? { endTime: params.input.endTime.trim().slice(0, 16) }
      : {}),
    ...(typeof params.input.timezone === 'string' && params.input.timezone.trim()
      ? { timezone: params.input.timezone.trim().slice(0, 64) }
      : {}),
    ...(typeof params.input.locationName === 'string' && params.input.locationName.trim()
      ? { locationName: params.input.locationName.trim().slice(0, 120) }
      : {}),
    ...(typeof params.input.venueId === 'string' && params.input.venueId.trim()
      ? { venueId: params.input.venueId.trim().slice(0, 64) }
      : {}),
    ...(typeof params.input.busDepartureTime === 'string' && params.input.busDepartureTime.trim()
      ? { busDepartureTime: params.input.busDepartureTime.trim().slice(0, 24) }
      : {}),
    ...(typeof params.input.busReturnTime === 'string' && params.input.busReturnTime.trim()
      ? { busReturnTime: params.input.busReturnTime.trim().slice(0, 24) }
      : {}),
    ...(safeDelay !== undefined ? { meetDelayMinutes: safeDelay } : {}),
    ...(liveResultsUrl ? { liveResultsUrl } : {}),
    ...(typeof params.input.liveResultsLabel === 'string' && params.input.liveResultsLabel.trim()
      ? { liveResultsLabel: params.input.liveResultsLabel.trim().slice(0, 60) }
      : {}),
    ...(albumValidation.links.length > 0 ? { curatedAlbumLinks: albumValidation.links } : {}),
    ...(targetEventGroups.length > 0 ? { targetEventGroups } : {}),
    visibilityScope,
    ...(typeof params.input.broadcastId === 'string' && params.input.broadcastId.trim()
      ? { broadcastId: params.input.broadcastId.trim().slice(0, 80) }
      : {}),
    ...(typeof params.input.packetId === 'string' && params.input.packetId.trim()
      ? { packetId: params.input.packetId.trim().slice(0, 80) }
      : {}),
    ...(typeof params.input.notes === 'string' && params.input.notes.trim()
      ? { notes: params.input.notes.trim().slice(0, 500) }
      : {}),
    createdAt,
    updatedAt: nowIso,
  };

  const savedToPg = await upsertTeamEventPostgresAsync({
    teamId: params.teamId,
    eventId,
    dateIso: cleanDate,
    eventType,
    eventPayload: nextEvent,
  });

  if (savedToPg === null) {
    await withVaultLock(`events_${sanitizeTenantId(params.teamId)}`, async () => {
      const existingList = await loadTenantVaultAsync<TeamEventRecord[]>(
        teamEventsVaultKey(params.teamId),
        []
      );
      const prev = existingList.find((e) => e.eventId === eventId);
      if (prev?.createdAt) {
        nextEvent.createdAt = prev.createdAt;
      }
      const nextList = [
        ...existingList.filter((e) => e.eventId !== eventId),
        nextEvent,
      ].sort((a, b) => a.date.localeCompare(b.date));
      await saveTenantVaultAsync(teamEventsVaultKey(params.teamId), nextList);
    });
  }

  await appendAuditLogAsync({
    teamId: params.teamId,
    actorSid: params.callerSid,
    action: 'TEAM_EVENT_UPSERTED',
    targetId: eventId,
    metadata: { eventType, date: cleanDate, visibilityScope },
  });

  return {
    ok: true,
    event: nextEvent,
    ...(photoReleaseOptOutNames.length > 0 ? { photoReleaseOptOutNames } : {}),
  };
}

export async function deleteTeamEvent(params: {
  callerSid: string;
  teamId: string;
  eventId: string;
}): Promise<{ ok: boolean; status?: number; deleted?: boolean; error?: string }> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem || !canViewSafeguardingMedicalRole(callerMem.role)) {
    return { ok: false, status: 403, error: 'Coach or team staff permissions required.' };
  }

  const cleanEventId = String(params.eventId || '').trim();
  if (!cleanEventId) return { ok: false, status: 400, error: 'Event ID required.' };

  const deletedPg = await deleteTeamEventPostgresAsync(params.teamId, cleanEventId);
  let deleted = Boolean(deletedPg);
  if (deletedPg === null) {
    await withVaultLock(`events_${sanitizeTenantId(params.teamId)}`, async () => {
      const events = await loadTenantVaultAsync<TeamEventRecord[]>(
        teamEventsVaultKey(params.teamId),
        []
      );
      const nextEvents = events.filter((e) => e.eventId !== cleanEventId);
      deleted = nextEvents.length !== events.length;
      if (deleted) {
        await saveTenantVaultAsync(teamEventsVaultKey(params.teamId), nextEvents);
      }
    });
    if (deleted) {
      await withVaultLock(`rsvps_${sanitizeTenantId(params.teamId)}`, async () => {
        const rsvps = await loadTenantVaultAsync<TeamEventRsvpRecord[]>(
          teamRsvpsVaultKey(params.teamId),
          []
        );
        const filtered = rsvps.filter((r) => r.eventId !== cleanEventId);
        if (filtered.length !== rsvps.length) {
          await saveTenantVaultAsync(teamRsvpsVaultKey(params.teamId), filtered);
        }
      });
    }
  }

  return { ok: true, deleted };
}

export async function submitTeamEventRsvp(params: {
  callerSid: string;
  teamId: string;
  eventId: string;
  membershipId?: string;
  status: unknown;
  travelMode?: unknown;
  note?: unknown;
}): Promise<{
  ok: boolean;
  status?: number;
  rsvp?: TeamEventRsvpRecord;
  counts?: TeamEventRsvpCounts;
  error?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: 'Team not found.' };

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED'
  );
  if (!callerMem) {
    return { ok: false, status: 403, error: 'Team membership required.' };
  }

  const cleanEventId = String(params.eventId || '').trim();
  if (!cleanEventId) {
    return { ok: false, status: 400, error: 'Event ID required.' };
  }

  const cleanStatus = String(params.status || '').trim().toUpperCase() as TeamEventRsvpStatus;
  if (!VALID_RSVP_STATUSES.has(cleanStatus)) {
    return { ok: false, status: 400, error: 'Invalid RSVP status.' };
  }

  const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
  const linkedChildIds = resolveLinkedChildMembershipIds(doc.memberships, callerMem);

  let targetMembershipId = String(params.membershipId || '').trim();
  if (!targetMembershipId) {
    if (callerMem.role === 'PARENT_FOLLOWER') {
      const firstChild = linkedChildIds ? Array.from(linkedChildIds)[0] : '';
      if (!firstChild) {
        return {
          ok: false,
          status: 403,
          error: 'No linked student-athlete found for this guardian account.',
        };
      }
      targetMembershipId = firstChild;
    } else {
      targetMembershipId = callerMem.membershipId;
    }
  }

  const targetMem = doc.memberships.find(
    (m) => m.membershipId === targetMembershipId && m.status !== 'REVOKED'
  );
  if (!targetMem) {
    return { ok: false, status: 404, error: 'Target athlete membership not found.' };
  }

  if (!isStaff) {
    if (callerMem.role === 'PARENT_FOLLOWER') {
      if (!linkedChildIds || !linkedChildIds.has(targetMembershipId)) {
        return {
          ok: false,
          status: 403,
          error: 'Guardians may only submit RSVPs for their linked student-athletes.',
        };
      }
    } else if (targetMembershipId !== callerMem.membershipId) {
      return {
        ok: false,
        status: 403,
        error: 'Athletes may only submit RSVPs for themselves.',
      };
    }
  }

  const rawTravel = typeof params.travelMode === 'string'
    ? (params.travelMode.trim().toUpperCase() as TeamEventTravelMode)
    : undefined;
  const travelMode = rawTravel && VALID_TRAVEL_MODES.has(rawTravel) ? rawTravel : undefined;
  const note =
    typeof params.note === 'string' && params.note.trim()
      ? params.note.trim().slice(0, 140)
      : undefined;

  const nowIso = new Date().toISOString();
  const nextRsvp: TeamEventRsvpRecord = {
    eventId: cleanEventId,
    membershipId: targetMembershipId,
    status: cleanStatus,
    ...(travelMode ? { travelMode } : {}),
    ...(note ? { note } : {}),
    updatedByRole: callerMem.role,
    updatedAt: nowIso,
  };

  const savedToPg = await upsertTeamEventRsvpPostgresAsync({
    teamId: params.teamId,
    eventId: cleanEventId,
    membershipId: targetMembershipId,
    status: cleanStatus,
    travelMode,
    note,
    updatedByRole: callerMem.role,
    updatedBySid: params.callerSid,
    updatedAt: nowIso,
  });

  let eventRsvps: TeamEventRsvpRecord[] = [];
  if (savedToPg !== null) {
    const pgRows = await listTeamEventRsvpsPostgresAsync(params.teamId, cleanEventId);
    eventRsvps = (pgRows || []).map((r) => ({
      eventId: r.event_id,
      membershipId: r.membership_id,
      status: VALID_RSVP_STATUSES.has(r.status as TeamEventRsvpStatus)
        ? (r.status as TeamEventRsvpStatus)
        : 'UNDECIDED',
      ...(r.travel_mode && VALID_TRAVEL_MODES.has(r.travel_mode as TeamEventTravelMode)
        ? { travelMode: r.travel_mode as TeamEventTravelMode }
        : {}),
      ...(r.note ? { note: r.note } : {}),
      updatedByRole: r.updated_by_role as TeamEventRsvpRecord['updatedByRole'],
      updatedAt: r.updated_at,
    }));
  } else {
    await withVaultLock(`rsvps_${sanitizeTenantId(params.teamId)}`, async () => {
      const existingList = await loadTenantVaultAsync<TeamEventRsvpRecord[]>(
        teamRsvpsVaultKey(params.teamId),
        []
      );
      const nextList = [
        ...existingList.filter(
          (r) => !(r.eventId === cleanEventId && r.membershipId === targetMembershipId)
        ),
        nextRsvp,
      ];
      await saveTenantVaultAsync(teamRsvpsVaultKey(params.teamId), nextList);
      eventRsvps = nextList.filter((r) => r.eventId === cleanEventId);
    });
  }

  return {
    ok: true,
    rsvp: nextRsvp,
    counts: computeRsvpCounts(eventRsvps),
  };
}
