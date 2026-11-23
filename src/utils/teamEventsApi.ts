import type {
  TeamEventRecord,
  TeamEventRsvpCounts,
  TeamEventRsvpRecord,
  TeamEventRsvpStatus,
  TeamEventTravelMode,
  TeamEventsOverviewPayload,
} from '../types';

export interface SaveTeamEventInput {
  eventId?: string;
  eventType: TeamEventRecord['eventType'];
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  locationName?: string;
  venueId?: string;
  busDepartureTime?: string;
  busReturnTime?: string;
  meetDelayMinutes?: number;
  liveResultsUrl?: string;
  liveResultsLabel?: string;
  curatedAlbumLinks?: TeamEventRecord['curatedAlbumLinks'];
  targetEventGroups?: TeamEventRecord['targetEventGroups'];
  visibilityScope?: TeamEventRecord['visibilityScope'];
  broadcastId?: string;
  packetId?: string;
  notes?: string;
}

export async function fetchTeamEvents(
  teamId: string
): Promise<TeamEventsOverviewPayload> {
  const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/events`, {
    credentials: 'include',
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  } & Partial<TeamEventsOverviewPayload>;
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load team events.');
  }
  return {
    events: payload.events || [],
    rsvpCountsByEventId: payload.rsvpCountsByEventId || {},
    myRsvps: payload.myRsvps || [],
    ...(payload.rsvpsByEventId ? { rsvpsByEventId: payload.rsvpsByEventId } : {}),
  };
}

export async function saveTeamEventApi(
  teamId: string,
  input: SaveTeamEventInput
): Promise<{ event: TeamEventRecord; photoReleaseOptOutNames?: string[] }> {
  const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/events`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    event?: TeamEventRecord;
    photoReleaseOptOutNames?: string[];
    error?: string;
  };
  if (!res.ok || !payload.ok || !payload.event) {
    throw new Error(payload.error || 'Failed to save team event.');
  }
  return {
    event: payload.event,
    ...(payload.photoReleaseOptOutNames?.length
      ? { photoReleaseOptOutNames: payload.photoReleaseOptOutNames }
      : {}),
  };
}

export async function deleteTeamEventApi(
  teamId: string,
  eventId: string
): Promise<boolean> {
  const res = await fetch(
    `/api/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      credentials: 'include',
    }
  );
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    deleted?: boolean;
    error?: string;
  };
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to delete team event.');
  }
  return Boolean(payload.deleted);
}

export async function submitTeamEventRsvpApi(
  teamId: string,
  eventId: string,
  input: {
    membershipId?: string;
    status: TeamEventRsvpStatus;
    travelMode?: TeamEventTravelMode;
    note?: string;
  }
): Promise<{ rsvp: TeamEventRsvpRecord; counts: TeamEventRsvpCounts }> {
  const res = await fetch(
    `/api/teams/${encodeURIComponent(teamId)}/events/${encodeURIComponent(eventId)}/rsvp`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    rsvp?: TeamEventRsvpRecord;
    counts?: TeamEventRsvpCounts;
    error?: string;
  };
  if (!res.ok || !payload.ok || !payload.rsvp || !payload.counts) {
    throw new Error(payload.error || 'Failed to submit RSVP.');
  }
  return {
    rsvp: payload.rsvp,
    counts: payload.counts,
  };
}

export interface TeamCalendarFeedMeta {
  feedUrl: string;
  webcalUrl: string;
  googleCalendarUrl: string;
  canRotate: boolean;
}

export async function fetchTeamCalendarFeedMeta(
  teamId: string
): Promise<TeamCalendarFeedMeta> {
  const res = await fetch(
    `/api/teams/${encodeURIComponent(teamId)}/calendar-feed/meta`,
    { credentials: 'include' }
  );
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  } & Partial<TeamCalendarFeedMeta>;
  if (!res.ok || !payload.ok || !payload.feedUrl) {
    throw new Error(payload.error || 'Unable to load calendar feed URL.');
  }
  return {
    feedUrl: payload.feedUrl,
    webcalUrl: payload.webcalUrl || payload.feedUrl.replace(/^https?:\/\//i, 'webcal://'),
    googleCalendarUrl:
      payload.googleCalendarUrl ||
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(payload.feedUrl)}`,
    canRotate: Boolean(payload.canRotate),
  };
}

export async function rotateTeamCalendarFeedToken(
  teamId: string
): Promise<TeamCalendarFeedMeta> {
  const res = await fetch(
    `/api/teams/${encodeURIComponent(teamId)}/calendar-feed/rotate`,
    {
      method: 'POST',
      credentials: 'include',
    }
  );
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  } & Partial<TeamCalendarFeedMeta>;
  if (!res.ok || !payload.ok || !payload.feedUrl) {
    throw new Error(payload.error || 'Unable to rotate calendar feed URL.');
  }
  return {
    feedUrl: payload.feedUrl,
    webcalUrl: payload.webcalUrl || payload.feedUrl.replace(/^https?:\/\//i, 'webcal://'),
    googleCalendarUrl:
      payload.googleCalendarUrl ||
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(payload.feedUrl)}`,
    canRotate: Boolean(payload.canRotate),
  };
}
