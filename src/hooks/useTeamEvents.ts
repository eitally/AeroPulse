import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLocalDateIso } from '../physiology/trainingProductivityEngine';
import type {
  TeamEventRecord,
  TeamEventRsvpCounts,
  TeamEventRsvpRecord,
  TeamEventRsvpStatus,
  TeamEventTravelMode,
  TeamSummaryWithRole,
} from '../types';
import {
  deleteTeamEventApi,
  fetchTeamEvents,
  saveTeamEventApi,
  submitTeamEventRsvpApi,
  type SaveTeamEventInput,
} from '../utils/teamEventsApi';

function shiftIsoDate(dateIso: string, deltaDays: number): string {
  const base = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateIso.slice(0, 10);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function computeCountsFromList(list: TeamEventRsvpRecord[]): TeamEventRsvpCounts {
  const counts: TeamEventRsvpCounts = { going: 0, out: 0, late: 0, conflict: 0, undecided: 0 };
  for (const r of list) {
    if (r.status === 'GOING') counts.going += 1;
    else if (r.status === 'OUT') counts.out += 1;
    else if (r.status === 'LATE') counts.late += 1;
    else if (r.status === 'MEET_CONFLICT') counts.conflict += 1;
    else counts.undecided += 1;
  }
  return counts;
}

interface StoredDemoEventsState {
  events: TeamEventRecord[];
  rsvpsByEventId: Record<string, TeamEventRsvpRecord[]>;
}

export function buildDemoTeamEventsState(
  activeTeam: TeamSummaryWithRole | null,
  todayIso: string
): StoredDemoEventsState {
  if (!activeTeam) return { events: [], rsvpsByEventId: {} };
  const teamId = activeTeam.brand.teamId;
  const athleteMembers = (activeTeam.memberships || []).filter(
    (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  const meetDate = shiftIsoDate(todayIso, 5);
  const packet = activeTeam.meetDayPackets?.[0];
  const meetId = packet ? `pkt_${packet.packetId}` : `demo_meet_${teamId}`;
  const practiceId = `demo_prac_${teamId}_${todayIso}`;

  const events: TeamEventRecord[] = [
    {
      eventId: practiceId,
      teamId,
      eventType: 'PRACTICE',
      title: '3:15 PM Track & Conditioning Practice',
      date: todayIso,
      startTime: '15:15',
      endTime: '17:00',
      locationName: activeTeam.brand.practiceVenues?.[0]?.name || 'School Track Oval',
      visibilityScope: 'TEAM_AND_FAMILIES_ONLY',
      createdAt: `${todayIso}T08:00:00Z`,
      updatedAt: `${todayIso}T08:00:00Z`,
    },
    {
      eventId: meetId,
      teamId,
      eventType: 'MEET',
      title: packet?.meetTitle || 'Saturday Valley Classic Invitational',
      date: packet?.meetDate || meetDate,
      startTime: '09:00',
      endTime: '14:30',
      locationName: 'Westmont Track Stadium',
      busDepartureTime: '07:15 AM',
      busReturnTime: '03:00 PM',
      meetDelayMinutes: packet?.meetDelayMinutes || 0,
      liveResultsUrl: packet?.athleticLiveUrl || 'https://live.athletic.net/meets/demo-invite',
      liveResultsLabel: 'AthleticLIVE Timing',
      visibilityScope: 'PUBLIC_HUB',
      ...(packet ? { packetId: packet.packetId } : {}),
      createdAt: `${todayIso}T08:00:00Z`,
      updatedAt: `${todayIso}T08:00:00Z`,
    },
  ];

  const firstAth = athleteMembers[0];
  const secondAth = athleteMembers[1];
  const thirdAth = athleteMembers[2];
  const nowIso = `${todayIso}T10:00:00Z`;
  const meetRsvps: TeamEventRsvpRecord[] = [];
  if (firstAth) {
    meetRsvps.push({
      eventId: meetId,
      membershipId: firstAth.membershipId,
      status: 'GOING',
      travelMode: 'TEAM_BUS',
      updatedByRole: 'ATHLETE',
      updatedAt: nowIso,
    });
  }
  if (secondAth) {
    meetRsvps.push({
      eventId: meetId,
      membershipId: secondAth.membershipId,
      status: 'MEET_CONFLICT',
      travelMode: 'PARENT_PICKUP',
      note: 'SAT Exam until 12:15 PM',
      updatedByRole: 'PARENT_FOLLOWER',
      updatedAt: nowIso,
    });
  }
  if (thirdAth) {
    meetRsvps.push({
      eventId: meetId,
      membershipId: thirdAth.membershipId,
      status: 'GOING',
      travelMode: 'TEAM_BUS',
      updatedByRole: 'ATHLETE',
      updatedAt: nowIso,
    });
  }

  const practiceRsvps: TeamEventRsvpRecord[] = [];
  if (secondAth) {
    practiceRsvps.push({
      eventId: practiceId,
      membershipId: secondAth.membershipId,
      status: 'LATE',
      note: 'Physics lab until 3:35 PM',
      updatedByRole: 'ATHLETE',
      updatedAt: nowIso,
    });
  }
  if (thirdAth) {
    practiceRsvps.push({
      eventId: practiceId,
      membershipId: thirdAth.membershipId,
      status: 'OUT',
      note: 'Orthodontist appointment',
      updatedByRole: 'PARENT_FOLLOWER',
      updatedAt: nowIso,
    });
  }

  return {
    events,
    rsvpsByEventId: {
      [meetId]: meetRsvps,
      [practiceId]: practiceRsvps,
    },
  };
}

function demoStorageKey(teamId: string): string {
  return `meetready_demo_team_events_v1_${teamId}`;
}

export interface UseTeamEventsResult {
  events: TeamEventRecord[];
  rsvpCountsByEventId: Record<string, TeamEventRsvpCounts>;
  rsvpsByEventId: Record<string, TeamEventRsvpRecord[]>;
  myRsvps: TeamEventRsvpRecord[];
  loading: boolean;
  error: string | null;
  upcomingConflictCount: number;
  nextMeetEvent: TeamEventRecord | null;
  nextMeetRsvpsByMemberId: Record<string, TeamEventRsvpRecord>;
  todayRsvpsByMemberId: Record<string, TeamEventRsvpRecord>;
  submitRsvp: (params: {
    eventId: string;
    membershipId?: string;
    status: TeamEventRsvpStatus;
    travelMode?: TeamEventTravelMode;
    note?: string;
  }) => Promise<boolean>;
  saveEvent: (input: SaveTeamEventInput) => Promise<{
    ok: boolean;
    event?: TeamEventRecord;
    photoReleaseOptOutNames?: string[];
    error?: string;
  }>;
  deleteEvent: (eventId: string) => Promise<boolean>;
  refreshEvents: () => Promise<void>;
}

function resolveDemoHydratedSnapshot(
  team: TeamSummaryWithRole,
  todayIso: string
): {
  events: TeamEventRecord[];
  rsvpsByEventId: Record<string, TeamEventRsvpRecord[]>;
  rsvpCountsByEventId: Record<string, TeamEventRsvpCounts>;
  myRsvps: TeamEventRsvpRecord[];
} {
  let state: StoredDemoEventsState | null = null;
  try {
    const raw =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem(demoStorageKey(team.brand.teamId))
        : null;
    if (raw) state = JSON.parse(raw) as StoredDemoEventsState;
  } catch {
    state = null;
  }
  if (!state) {
    state = buildDemoTeamEventsState(team, todayIso);
  }
  const counts: Record<string, TeamEventRsvpCounts> = {};
  const own: TeamEventRsvpRecord[] = [];
  const childSet = new Set(team.myLinkedChildMembershipIds || []);
  for (const ev of state.events) {
    const list = state.rsvpsByEventId[ev.eventId] || [];
    counts[ev.eventId] = computeCountsFromList(list);
    for (const r of list) {
      if (r.membershipId === team.myMembershipId || childSet.has(r.membershipId)) {
        own.push(r);
      }
    }
  }
  return {
    events: state.events,
    rsvpsByEventId: state.rsvpsByEventId,
    rsvpCountsByEventId: counts,
    myRsvps: own,
  };
}

export function useTeamEvents(
  activeTeam: TeamSummaryWithRole | null,
  isSampleDemoMode = false
): UseTeamEventsResult {
  const todayIso = getLocalDateIso();
  const teamId = activeTeam?.brand.teamId || '';
  const isDemoTeam = Boolean(
    !activeTeam ||
      isSampleDemoMode ||
      teamId.startsWith('demo_team_') ||
      teamId.startsWith('demo-team-')
  );

  const initialDemo = useMemo(
    () =>
      activeTeam && isDemoTeam
        ? resolveDemoHydratedSnapshot(activeTeam, todayIso)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [events, setEvents] = useState<TeamEventRecord[]>(() => initialDemo?.events || []);
  const [rsvpsByEventId, setRsvpsByEventId] = useState<Record<string, TeamEventRsvpRecord[]>>(
    () => initialDemo?.rsvpsByEventId || {}
  );
  const [rsvpCountsByEventId, setRsvpCountsByEventId] = useState<
    Record<string, TeamEventRsvpCounts>
  >(() => initialDemo?.rsvpCountsByEventId || {});
  const [myRsvps, setMyRsvps] = useState<TeamEventRsvpRecord[]>(() => initialDemo?.myRsvps || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const hydrateDemoState = useCallback(
    (team: TeamSummaryWithRole) => {
      const next = resolveDemoHydratedSnapshot(team, todayIso);
      setEvents(next.events);
      setRsvpsByEventId(next.rsvpsByEventId);
      setRsvpCountsByEventId(next.rsvpCountsByEventId);
      setMyRsvps(next.myRsvps);
    },
    [todayIso]
  );

  const refreshEvents = useCallback(async () => {
    if (!activeTeam) {
      setEvents([]);
      setRsvpsByEventId({});
      setRsvpCountsByEventId({});
      setMyRsvps([]);
      return;
    }
    if (isDemoTeam) {
      hydrateDemoState(activeTeam);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTeamEvents(activeTeam.brand.teamId);
      setEvents(payload.events);
      setRsvpCountsByEventId(payload.rsvpCountsByEventId);
      setMyRsvps(payload.myRsvps);
      setRsvpsByEventId(payload.rsvpsByEventId || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load team schedule.');
    } finally {
      setLoading(false);
    }
  }, [activeTeam, hydrateDemoState, isDemoTeam]);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  const submitRsvp = useCallback(
    async (params: {
      eventId: string;
      membershipId?: string;
      status: TeamEventRsvpStatus;
      travelMode?: TeamEventTravelMode;
      note?: string;
    }): Promise<boolean> => {
      if (!activeTeam) return false;
      if (isDemoTeam) {
        const targetMemId =
          params.membershipId ||
          activeTeam.myLinkedChildMembershipIds?.[0] ||
          activeTeam.myMembershipId;
        const nextRec: TeamEventRsvpRecord = {
          eventId: params.eventId,
          membershipId: targetMemId,
          status: params.status,
          ...(params.travelMode ? { travelMode: params.travelMode } : {}),
          ...(params.note?.trim() ? { note: params.note.trim().slice(0, 140) } : {}),
          updatedByRole: activeTeam.myRole,
          updatedAt: new Date().toISOString(),
        };
        setRsvpsByEventId((prev) => {
          const updatedList = [
            ...(prev[params.eventId] || []).filter((r) => r.membershipId !== targetMemId),
            nextRec,
          ];
          const nextByEv = { ...prev, [params.eventId]: updatedList };
          setRsvpCountsByEventId((cPrev) => ({
            ...cPrev,
            [params.eventId]: computeCountsFromList(updatedList),
          }));
          try {
            window.sessionStorage.setItem(
              demoStorageKey(activeTeam.brand.teamId),
              JSON.stringify({ events, rsvpsByEventId: nextByEv })
            );
          } catch {
            // ignore storage errors
          }
          return nextByEv;
        });
        setMyRsvps((prev) => [
          ...prev.filter(
            (r) => !(r.eventId === params.eventId && r.membershipId === targetMemId)
          ),
          nextRec,
        ]);
        return true;
      }

      try {
        const res = await submitTeamEventRsvpApi(
          activeTeam.brand.teamId,
          params.eventId,
          params
        );
        setRsvpCountsByEventId((prev) => ({
          ...prev,
          [params.eventId]: res.counts,
        }));
        setMyRsvps((prev) => [
          ...prev.filter(
            (r) => !(r.eventId === params.eventId && r.membershipId === res.rsvp.membershipId)
          ),
          res.rsvp,
        ]);
        setRsvpsByEventId((prev) => ({
          ...prev,
          [params.eventId]: [
            ...(prev[params.eventId] || []).filter(
              (r) => r.membershipId !== res.rsvp.membershipId
            ),
            res.rsvp,
          ],
        }));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to save RSVP.');
        return false;
      }
    },
    [activeTeam, events, isDemoTeam]
  );

  const saveEvent = useCallback(
    async (
      input: SaveTeamEventInput
    ): Promise<{
      ok: boolean;
      event?: TeamEventRecord;
      photoReleaseOptOutNames?: string[];
      error?: string;
    }> => {
      if (!activeTeam) return { ok: false, error: 'No active team selected.' };
      if (isDemoTeam) {
        const nowIso = new Date().toISOString();
        const eventId = input.eventId || `demo_ev_${Date.now()}`;
        const nextEv: TeamEventRecord = {
          eventId,
          teamId: activeTeam.brand.teamId,
          eventType: input.eventType,
          title: input.title.trim(),
          date: input.date,
          ...(input.startTime ? { startTime: input.startTime } : {}),
          ...(input.endTime ? { endTime: input.endTime } : {}),
          ...(input.locationName ? { locationName: input.locationName } : {}),
          ...(input.busDepartureTime ? { busDepartureTime: input.busDepartureTime } : {}),
          ...(input.busReturnTime ? { busReturnTime: input.busReturnTime } : {}),
          ...(typeof input.meetDelayMinutes === 'number'
            ? { meetDelayMinutes: input.meetDelayMinutes }
            : {}),
          ...(input.liveResultsUrl ? { liveResultsUrl: input.liveResultsUrl } : {}),
          ...(input.liveResultsLabel ? { liveResultsLabel: input.liveResultsLabel } : {}),
          ...(input.curatedAlbumLinks?.length
            ? { curatedAlbumLinks: input.curatedAlbumLinks }
            : {}),
          visibilityScope: input.visibilityScope || 'TEAM_AND_FAMILIES_ONLY',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        setEvents((prev) => {
          const nextEvents = [...prev.filter((e) => e.eventId !== eventId), nextEv].sort((a, b) =>
            a.date.localeCompare(b.date)
          );
          try {
            window.sessionStorage.setItem(
              demoStorageKey(activeTeam.brand.teamId),
              JSON.stringify({ events: nextEvents, rsvpsByEventId })
            );
          } catch {
            // ignore
          }
          return nextEvents;
        });
        return { ok: true, event: nextEv };
      }

      try {
        const res = await saveTeamEventApi(activeTeam.brand.teamId, input);
        setEvents((prev) =>
          [...prev.filter((e) => e.eventId !== res.event.eventId), res.event].sort((a, b) =>
            a.date.localeCompare(b.date)
          )
        );
        return {
          ok: true,
          event: res.event,
          ...(res.photoReleaseOptOutNames?.length
            ? { photoReleaseOptOutNames: res.photoReleaseOptOutNames }
            : {}),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to save event.',
        };
      }
    },
    [activeTeam, isDemoTeam, rsvpsByEventId]
  );

  const deleteEvent = useCallback(
    async (eventId: string): Promise<boolean> => {
      if (!activeTeam) return false;
      if (isDemoTeam) {
        setEvents((prev) => prev.filter((e) => e.eventId !== eventId));
        return true;
      }
      try {
        const deleted = await deleteTeamEventApi(activeTeam.brand.teamId, eventId);
        if (deleted) {
          setEvents((prev) => prev.filter((e) => e.eventId !== eventId));
        }
        return deleted;
      } catch {
        return false;
      }
    },
    [activeTeam, isDemoTeam]
  );

  const { nextMeetEvent, nextMeetRsvpsByMemberId, todayRsvpsByMemberId, upcomingConflictCount } =
    useMemo(() => {
      const sortedUpcomingMeets = events
        .filter((e) => e.eventType === 'MEET' && e.date >= todayIso)
        .sort((a, b) => a.date.localeCompare(b.date));
      const nextMeet = sortedUpcomingMeets[0] || null;
      const meetMap: Record<string, TeamEventRsvpRecord> = {};
      if (nextMeet) {
        for (const r of rsvpsByEventId[nextMeet.eventId] || []) {
          meetMap[r.membershipId] = r;
        }
      }

      const todayEvent =
        events.find((e) => e.date === todayIso && e.eventType === 'PRACTICE') ||
        events.find((e) => e.date === todayIso) ||
        null;
      const todayMap: Record<string, TeamEventRsvpRecord> = {};
      if (todayEvent) {
        for (const r of rsvpsByEventId[todayEvent.eventId] || []) {
          todayMap[r.membershipId] = r;
        }
      }

      let conflicts = 0;
      for (const ev of events) {
        if (ev.date < todayIso) continue;
        const c = rsvpCountsByEventId[ev.eventId];
        if (c) conflicts += c.out + c.conflict;
      }

      return {
        nextMeetEvent: nextMeet,
        nextMeetRsvpsByMemberId: meetMap,
        todayRsvpsByMemberId: todayMap,
        upcomingConflictCount: conflicts,
      };
    }, [events, rsvpCountsByEventId, rsvpsByEventId, todayIso]);

  return {
    events,
    rsvpCountsByEventId,
    rsvpsByEventId,
    myRsvps,
    loading,
    error,
    upcomingConflictCount,
    nextMeetEvent,
    nextMeetRsvpsByMemberId,
    todayRsvpsByMemberId,
    submitRsvp,
    saveEvent,
    deleteEvent,
    refreshEvents,
  };
}
