import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTeamForCoach } from '../server/teamService.ts';
import {
  deleteTeamEvent,
  listTeamEventsForCaller,
  submitTeamEventRsvp,
  upsertTeamEvent,
} from '../server/teamEventsService.ts';
import {
  loadTeamDocRaw,
  saveTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
} from '../server/teamStoreCore.ts';
import { deleteTenantVault, sanitizeTenantId } from '../server/tokenVault.ts';

describe('Phase 1A: Unified TeamEvent Spine, Synthetic Backfill & Atomic Delta RSVPs', () => {
  const cleanupKeys: string[] = [];

  afterAll(async () => {
    for (const key of cleanupKeys) {
      await deleteTenantVault(key);
    }
  });

  it('defines thresh_team_events, thresh_team_event_rsvps, and thresh_team_messages tables in Postgres vault schema', () => {
    const tokenVaultSrc = fs.readFileSync(
      path.join(process.cwd(), 'server/tokenVault.ts'),
      'utf8'
    );
    expect(tokenVaultSrc).toContain('CREATE TABLE IF NOT EXISTS thresh_team_events');
    expect(tokenVaultSrc).toContain('CREATE TABLE IF NOT EXISTS thresh_team_event_rsvps');
    expect(tokenVaultSrc).toContain('CREATE TABLE IF NOT EXISTS thresh_team_messages');
  });

  it('synthesizes events from meetDayPackets/broadcastWorkouts and enforces staff roles, safe URLs, FERPA opt-outs, and atomic RSVP deltas', async () => {
    const coachSid = `coach-ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ath1Sid = `ath1-ev-${Date.now()}`;
    const ath2Sid = `ath2-ev-${Date.now()}`;
    const parentSid = `parent-ev-${Date.now()}`;

    const created = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Willow Glen Flyers',
      coachDisplayName: 'Coach Morales',
      orgType: 'HIGH_SCHOOL',
    });
    const teamId = created.brand.teamId;
    const safeId = sanitizeTenantId(teamId);
    cleanupKeys.push(
      teamDocVaultKey(teamId),
      userTeamsVaultKey(coachSid),
      `team_events_${safeId}`,
      `team_rsvps_${safeId}`
    );

    const doc = await loadTeamDocRaw(teamId);
    expect(doc).toBeTruthy();
    doc!.memberships.push(
      {
        membershipId: 'ath-child-1',
        teamId,
        userSid: ath1Sid,
        invitedName: 'Maya Chen',
        role: 'ATHLETE',
        status: 'ACTIVE',
        squadGroup: 'Girls Varsity',
        genderDivision: 'F',
        eventGroup: 'DISTANCE',
        isMinorU18: true,
        parentGuardianEmail: 'chen.family@example.org',
        photoReleaseOptOut: true,
        invitedAt: '2026-04-01T00:00:00Z',
      },
      {
        membershipId: 'ath-other-2',
        teamId,
        userSid: ath2Sid,
        invitedName: 'Devon Carter',
        role: 'ATHLETE',
        status: 'ACTIVE',
        squadGroup: 'Boys Varsity',
        genderDivision: 'M',
        eventGroup: 'SPRINTS',
        isMinorU18: false,
        invitedAt: '2026-04-01T00:00:00Z',
      },
      {
        membershipId: 'parent-1',
        teamId,
        userSid: parentSid,
        invitedName: 'Sarah Chen',
        invitedEmail: 'chen.family@example.org',
        role: 'PARENT_FOLLOWER',
        status: 'ACTIVE',
        squadGroup: 'Family',
        isMinorU18: false,
        invitedAt: '2026-04-01T00:00:00Z',
      }
    );
    doc!.meetDayPackets = [
      {
        packetId: 'pkt-synth-1',
        meetTitle: 'BVAL League Finals',
        meetDate: '2026-05-09',
        laneCount: 8,
        flightSize: 12,
        partitionByDivision: true,
        athleticLiveUrl: 'https://live.athletic.net/meets/12345',
        entries: [],
        updatedAt: '2026-05-08T18:00:00Z',
      },
    ];
    doc!.broadcastWorkouts = [
      {
        broadcastId: 'bc-synth-1',
        teamId,
        targetSquadGroup: 'ALL',
        date: '2026-05-06',
        name: 'Pre-Meet Strides & Handoffs',
        sportCategory: 'Running',
        plannedDurationSecs: 3600,
        plannedLoad: 55,
        workoutSyntax: '4x150m smooth',
        description: 'Relay exchanges at 4x100 zone',
        scheduledTime: '15:30',
        locationName: 'Main Track',
        pushedByCoachName: 'Coach Morales',
        createdAt: '2026-05-05T12:00:00Z',
      },
    ];
    await saveTeamDocRaw(teamId, doc!);

    // 1. Synthetic backfill projection
    const synthList = await listTeamEventsForCaller({ callerSid: coachSid, teamId });
    expect(synthList.ok).toBe(true);
    expect(synthList.payload?.events.map((e) => e.eventId)).toEqual(
      expect.arrayContaining(['pkt_pkt-synth-1', 'bc_bc-synth-1'])
    );

    // 2. Non-staff rejected from upsert/delete
    const athUpsert = await upsertTeamEvent({
      callerSid: ath1Sid,
      teamId,
      input: { title: 'Rogue Event', date: '2026-05-10', eventType: 'PRACTICE' },
    });
    expect(athUpsert.ok).toBe(false);
    expect(athUpsert.status).toBe(403);

    const parentDelete = await deleteTeamEvent({
      callerSid: parentSid,
      teamId,
      eventId: 'ev-1',
    });
    expect(parentDelete.ok).toBe(false);
    expect(parentDelete.status).toBe(403);

    // 3. Reject unsafe javascript: and data: URLs
    const badLive = await upsertTeamEvent({
      callerSid: coachSid,
      teamId,
      input: {
        title: 'Bad Live Link Meet',
        date: '2026-05-11',
        eventType: 'MEET',
        liveResultsUrl: 'javascript:alert(1)',
      },
    });
    expect(badLive.ok).toBe(false);
    expect(badLive.status).toBe(400);

    const badAlbum = await upsertTeamEvent({
      callerSid: coachSid,
      teamId,
      input: {
        title: 'Bad Album Meet',
        date: '2026-05-11',
        eventType: 'MEET',
        curatedAlbumLinks: [{ label: 'Bad', url: 'data:text/html,xss', visibility: 'PUBLIC_HUB' }],
      },
    });
    expect(badAlbum.ok).toBe(false);
    expect(badAlbum.status).toBe(400);

    // 4. Valid HTTPS URLs + FERPA photoReleaseOptOutNames warning for PUBLIC_HUB album
    const createdMeet = await upsertTeamEvent({
      callerSid: coachSid,
      teamId,
      input: {
        eventId: 'ev-ccs-trials',
        title: 'CCS Section Trials',
        date: '2026-05-16',
        eventType: 'MEET',
        startTime: '09:00',
        liveResultsUrl: 'https://live.athletic.net/meets/55555',
        curatedAlbumLinks: [
          {
            label: 'Parents Google Photos',
            url: 'https://photos.app.goo.gl/exampleAlbum123',
            provider: 'GOOGLE_PHOTOS',
            visibility: 'PUBLIC_HUB',
          },
        ],
      },
    });
    expect(createdMeet.ok).toBe(true);
    expect(createdMeet.event?.eventId).toBe('ev-ccs-trials');
    expect(createdMeet.photoReleaseOptOutNames).toEqual(['Maya Chen']);

    // 5. Atomic RSVP isolation & authorization
    const peerForbidden = await submitTeamEventRsvp({
      callerSid: ath1Sid,
      teamId,
      eventId: 'ev-ccs-trials',
      membershipId: 'ath-other-2',
      status: 'OUT',
    });
    expect(peerForbidden.ok).toBe(false);
    expect(peerForbidden.status).toBe(403);

    const ownAthRsvp = await submitTeamEventRsvp({
      callerSid: ath2Sid,
      teamId,
      eventId: 'ev-ccs-trials',
      status: 'GOING',
      travelMode: 'TEAM_BUS',
    });
    expect(ownAthRsvp.ok).toBe(true);
    expect(ownAthRsvp.counts).toEqual({
      going: 1,
      out: 0,
      late: 0,
      conflict: 0,
      undecided: 0,
    });

    const parentOtherForbidden = await submitTeamEventRsvp({
      callerSid: parentSid,
      teamId,
      eventId: 'ev-ccs-trials',
      membershipId: 'ath-other-2',
      status: 'OUT',
    });
    expect(parentOtherForbidden.ok).toBe(false);
    expect(parentOtherForbidden.status).toBe(403);

    const parentLinkedChildOk = await submitTeamEventRsvp({
      callerSid: parentSid,
      teamId,
      eventId: 'ev-ccs-trials',
      membershipId: 'ath-child-1',
      status: 'LATE',
      travelMode: 'PARENT_PICKUP',
      note: 'Arriving after AP exam',
    });
    expect(parentLinkedChildOk.ok).toBe(true);
    expect(parentLinkedChildOk.rsvp?.updatedByRole).toBe('PARENT_FOLLOWER');
    expect(parentLinkedChildOk.counts).toEqual({
      going: 1,
      out: 0,
      late: 1,
      conflict: 0,
      undecided: 0,
    });

    // Parent overview exposes only linked child RSVPs in myRsvps (never full team roster list)
    const parentOverview = await listTeamEventsForCaller({ callerSid: parentSid, teamId });
    expect(parentOverview.ok).toBe(true);
    expect(parentOverview.payload?.rsvpsByEventId).toBeUndefined();
    expect(parentOverview.payload?.myRsvps.map((r) => r.membershipId)).toEqual(['ath-child-1']);
    expect(parentOverview.payload?.rsvpCountsByEventId['ev-ccs-trials']).toEqual({
      going: 1,
      out: 0,
      late: 1,
      conflict: 0,
      undecided: 0,
    });

    // Staff deletes event and cleans up linked RSVPs
    const deleted = await deleteTeamEvent({
      callerSid: coachSid,
      teamId,
      eventId: 'ev-ccs-trials',
    });
    expect(deleted.ok).toBe(true);
    expect(deleted.deleted).toBe(true);
  });
});
