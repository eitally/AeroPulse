import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { followTeamAsParentOrFan } from '../server/athleticSyncService.ts';
import {
  dispatchTeamPushNotifications,
  removeUserPushSubscription,
  resetVapidKeyCacheForTest,
  saveUserPushSubscription,
  setPushNotificationSenderForTest,
  setTestEmailFallbackSenderForTests,
} from '../server/pushNotificationService.ts';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  updateTeamMemberPhotoRelease,
} from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import {
  deleteTeamCustomSubgroup,
  postTeamMessage,
  upsertTeamCustomSubgroup,
} from '../server/teamMessagingService.ts';
import { upsertTeamEvent } from '../server/teamEventsService.ts';
import { CoachTeamEventsBar } from '../src/components/coach/CoachTeamEventsBar.tsx';
import { TeamMessagingDrawer } from '../src/components/coach/TeamMessagingDrawer.tsx';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData.ts';
import {
  clearChatOutbox,
  enqueueChatOutboxMessage,
  flushChatOutbox,
  loadChatOutbox,
} from '../src/utils/chatOutbox.ts';
import { formatMessageForRemindOrParentSquare } from '../src/utils/remindFormatter.ts';
import { clearAllUserBrowserStorage, STORAGE_KEYS } from '../src/utils/storageKeys.ts';
import { TeamLifecycleApiError } from '../src/utils/teamLifecycleApi.ts';

function authCookie(userId: string, sid: string): string {
  return `${SESSION_COOKIE_NAME}=${issueSessionToken(userId, sid, 'verified')}`;
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('Phase 3: Unified Comms Hub, Push→Email Fallback, Durable Chat Outbox & Curated Meet Albums + FERPA Guardrails', () => {
  const createdTeamIds: string[] = [];
  const createdPushSids: string[] = [];
  const origLocalStorage = globalThis.localStorage;
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    setPushNotificationSenderForTest(null);
    setTestEmailFallbackSenderForTests(null);
    resetVapidKeyCacheForTest();
    clearAllUserBrowserStorage({ preserveLoggedOutFlag: false });
    await clearChatOutbox();
    vi.unstubAllGlobals();
    if (origLocalStorage) {
      globalThis.localStorage = origLocalStorage;
    }
    while (createdPushSids.length > 0) {
      const sid = createdPushSids.pop();
      if (sid) await removeUserPushSubscription({ userSid: sid }).catch(() => undefined);
    }
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  it('enforces PARENTS_ONLY & CUSTOM_SUBGROUP ACLs, SafeSport two-adult visibility, and Push→Email fallback with redaction & quiet hours', async () => {
    const coachSid = `coach-${crypto.randomUUID()}`;
    const athleteInSubSid = `ath-in-${crypto.randomUUID()}`;
    const athleteOutSubSid = `ath-out-${crypto.randomUUID()}`;
    const parentSid = `parent-${crypto.randomUUID()}`;
    createdPushSids.push(coachSid, athleteInSubSid, athleteOutSubSid, parentSid);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Crestwood Distance Project',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    const teamId = team.brand.teamId;
    createdTeamIds.push(teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId,
      originUrl: 'https://meetready.app',
      rows: [
        {
          invitedName: 'Elena Vance',
          invitedEmail: 'elena@crestwood.edu',
          parentGuardianEmail: 'parent.vance@example.com',
          squadGroup: 'Distance',
          eventGroup: 'DISTANCE',
          isMinorU18: true,
        },
        {
          invitedName: 'Liam Park',
          invitedEmail: 'liam@crestwood.edu',
          squadGroup: 'Sprints',
          eventGroup: 'SPRINTS',
          isMinorU18: true,
        },
      ],
    });

    const elenaClaim = await claimTeamJoinInvite({
      callerSid: athleteInSubSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Elena Vance',
      athleteEmail: 'elena@crestwood.edu',
      parentGuardianEmail: 'parent.vance@example.com',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    const liamClaim = await claimTeamJoinInvite({
      callerSid: athleteOutSubSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Liam Park',
      athleteEmail: 'liam@crestwood.edu',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    expect(elenaClaim.ok && liamClaim.ok).toBe(true);
    const elenaMemId = elenaClaim.summary!.myMembershipId;
    const liamMemId = liamClaim.summary!.myMembershipId;

    const parentFollow = await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Sarah Vance',
      verifiedEmail: 'parent.vance@example.com',
      originUrl: 'https://meetready.app',
    });
    expect(parentFollow.ok).toBe(true);

    // 1. PARENTS_ONLY channel ACLs: Coach + Parent allowed; Athlete strictly blocked
    const coachParentsMsg = await postTeamMessage({
      callerSid: coachSid,
      teamId,
      channelScope: 'PARENTS_ONLY',
      body: 'Bus departure moved to 2:15 PM at South Lot.',
      clientLocalHour: 14,
      originUrl: 'https://meetready.app',
    });
    expect(coachParentsMsg.ok).toBe(true);

    const parentReply = await postTeamMessage({
      callerSid: parentSid,
      teamId,
      channelScope: 'PARENTS_ONLY',
      body: 'Thanks Coach, bringing extra water bottles.',
      clientLocalHour: 14,
      originUrl: 'https://meetready.app',
    });
    expect(parentReply.ok).toBe(true);

    const athleteBlockedParents = await postTeamMessage({
      callerSid: athleteInSubSid,
      teamId,
      channelScope: 'PARENTS_ONLY',
      body: 'Can athletes post in parents channel?',
      clientLocalHour: 14,
      originUrl: 'https://meetready.app',
    });
    expect(athleteBlockedParents.ok).toBe(false);
    expect(athleteBlockedParents.status).toBe(403);

    const athTeamsAfterParents = await listTeamsForUser(athleteInSubSid, 'https://meetready.app');
    expect(
      athTeamsAfterParents[0]?.teamMessages?.some((m) => m.channelScope === 'PARENTS_ONLY')
    ).toBe(false);
    const parentTeamsAfterParents = await listTeamsForUser(parentSid, 'https://meetready.app');
    expect(
      parentTeamsAfterParents[0]?.teamMessages?.some((m) => m.channelScope === 'PARENTS_ONLY')
    ).toBe(true);

    // 2. CUSTOM_SUBGROUP: Elena is member; Liam is NOT; Parent of Elena has SafeSport visibility
    const sgRes = await upsertTeamCustomSubgroup({
      callerSid: coachSid,
      teamId,
      name: 'Varsity Travel Bus',
      memberIds: [elenaMemId],
      includeLinkedParents: true,
      originUrl: 'https://meetready.app',
    });
    expect(sgRes.ok).toBe(true);
    const subgroupId = sgRes.subgroup!.id;

    const coachSubMsg = await postTeamMessage({
      callerSid: coachSid,
      teamId,
      channelScope: 'CUSTOM_SUBGROUP',
      customSubgroupId: subgroupId,
      body: 'Seat assignments posted for Varsity Travel Bus.',
      clientLocalHour: 14,
      originUrl: 'https://meetready.app',
    });
    expect(coachSubMsg.ok).toBe(true);

    const outsiderSubMsg = await postTeamMessage({
      callerSid: athleteOutSubSid,
      teamId,
      channelScope: 'CUSTOM_SUBGROUP',
      customSubgroupId: subgroupId,
      body: 'Let me in',
      clientLocalHour: 14,
      originUrl: 'https://meetready.app',
    });
    expect(outsiderSubMsg.ok).toBe(false);
    expect(outsiderSubMsg.status).toBe(403);

    const liamTeams = await listTeamsForUser(athleteOutSubSid, 'https://meetready.app');
    expect(liamTeams[0]?.customSubgroups || []).toHaveLength(0);
    expect(
      liamTeams[0]?.teamMessages?.some((m) => m.customSubgroupId === subgroupId)
    ).toBe(false);

    const parentTeamsSg = await listTeamsForUser(parentSid, 'https://meetready.app');
    expect(parentTeamsSg[0]?.customSubgroups?.some((g) => g.id === subgroupId)).toBe(true);
    expect(
      parentTeamsSg[0]?.teamMessages?.some((m) => m.customSubgroupId === subgroupId)
    ).toBe(true);

    // 3. Push -> Email Fallback:
    // Subscribe Elena to Web Push, leave Liam & Sarah Vance without Push
    await saveUserPushSubscription({
      userSid: athleteInSubSid,
      endpoint: 'https://fcm.googleapis.com/fcm/send/elena-device-1',
      keys: {
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
        auth: 'tBHItJI5svbpez7KI4CCXg==',
      },
      muteQuietHours: true,
    });
    const pushedEndpoints: string[] = [];
    setPushNotificationSenderForTest(async (sub) => {
      pushedEndpoints.push(sub.endpoint);
      return { statusCode: 201 };
    });

    const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
    setTestEmailFallbackSenderForTests(async (req) => {
      sentEmails.push({ to: req.to, subject: req.subject, text: req.text });
      return { delivered: true };
    });

    // Broadcast ALL_TEAM daytime: Elena gets Web Push (no email), Liam & Sarah Vance get Email Fallback
    const dayFallback = await dispatchTeamPushNotifications({
      teamId,
      senderSid: coachSid,
      senderName: 'Coach Rivera',
      kind: 'TEAM_MESSAGE',
      channelScope: 'ALL_TEAM',
      bodyText: 'Meet warmup at 3:00 PM on infield.',
      clientLocalHour: 14,
    });
    expect(dayFallback.deliveredCount).toBe(1);
    expect(pushedEndpoints).toHaveLength(1);
    expect(sentEmails.some((e) => e.to === 'elena@crestwood.edu')).toBe(false);
    expect(sentEmails.some((e) => e.to === 'liam@crestwood.edu')).toBe(true);

    // SafeSport minor DM lock/email redaction check
    sentEmails.length = 0;
    await dispatchTeamPushNotifications({
      teamId,
      senderSid: coachSid,
      senderName: 'Coach Rivera',
      kind: 'TEAM_MESSAGE',
      channelScope: 'DIRECT_TRANSPARENT',
      targetMembershipId: liamMemId,
      bodyText: 'SECRET_MINOR_NOTE_CHECK_BODY',
      clientLocalHour: 14,
    });
    expect(sentEmails.length).toBeGreaterThanOrEqual(1);
    for (const em of sentEmails) {
      expect(em.text).not.toContain('SECRET_MINOR_NOTE_CHECK_BODY');
      expect(em.text).toContain('SafeSport CC note');
    }

    // Quiet hours suppresses non-emergency email fallback, emergency overrides it
    sentEmails.length = 0;
    const quietSkip = await dispatchTeamPushNotifications({
      teamId,
      senderSid: coachSid,
      senderName: 'Coach Rivera',
      kind: 'TEAM_MESSAGE',
      channelScope: 'ALL_TEAM',
      bodyText: 'Non-urgent quiet note',
      clientLocalHour: 22,
      isEmergency: false,
    });
    expect(quietSkip.emailFallbackCount).toBe(0);
    expect(sentEmails).toHaveLength(0);

    const emergencyOverride = await dispatchTeamPushNotifications({
      teamId,
      senderSid: coachSid,
      senderName: 'Coach Rivera',
      kind: 'ANNOUNCEMENT',
      announcementCategory: 'WEATHER',
      bodyText: 'LIGHTNING DELAY: Bus loading early.',
      clientLocalHour: 22,
      isEmergency: true,
    });
    expect(emergencyOverride.emailFallbackCount).toBeGreaterThanOrEqual(1);
    expect(sentEmails.some((e) => e.text.includes('LIGHTNING DELAY'))).toBe(true);

    const delRes = await deleteTeamCustomSubgroup({
      callerSid: coachSid,
      teamId,
      subgroupId,
      originUrl: 'https://meetready.app',
    });
    expect(delRes.ok).toBe(true);
  });

  it('persists durable offline chat outbox across reloads, flushes on reconnect, quarantines permanent 403, and wipes cleanly on sign-out', async () => {
    const queued = enqueueChatOutboxMessage({
      teamId: 'team_outbox_1',
      channelScope: 'PARENTS_ONLY',
      body: 'Practice ends 15m early due to heat advisory.',
      guardianCc: true,
    });
    expect(queued).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_OUTBOX)).toContain(
      'Practice ends 15m early due to heat advisory.'
    );
    expect(loadChatOutbox('team_outbox_1')).toHaveLength(1);

    // Permanent 403 error drops/quarantines cleanly without infinite retry loop
    const dropRes = await flushChatOutbox(async () => {
      throw new TeamLifecycleApiError('Forbidden by SafeSport policy', 403);
    }, 'team_outbox_1');
    expect(dropRes.droppedCount).toBe(1);
    expect(loadChatOutbox('team_outbox_1')).toHaveLength(0);

    // Re-queue valid message & flush successfully
    const valid = enqueueChatOutboxMessage({
      teamId: 'team_outbox_2',
      channelScope: 'ALL_TEAM',
      body: 'Bring spikes tomorrow.',
    });
    expect(valid).toBeTruthy();
    const sentBodies: string[] = [];
    const okRes = await flushChatOutbox(async (msg) => {
      sentBodies.push(msg.body);
    }, 'team_outbox_2');
    expect(okRes.sentCount).toBe(1);
    expect(sentBodies).toEqual(['Bring spikes tomorrow.']);
    expect(loadChatOutbox('team_outbox_2')).toHaveLength(0);

    // Enqueue and verify clearAllUserBrowserStorage wipes STORAGE_KEYS.CHAT_OUTBOX
    enqueueChatOutboxMessage({
      teamId: 'team_outbox_3',
      channelScope: 'ALL_TEAM',
      body: 'Shared tablet message before sign-out',
    });
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_OUTBOX)).toBeTruthy();
    clearAllUserBrowserStorage();
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_OUTBOX)).toBeNull();
  });

  it('formats Remind / ParentSquare SMS summaries cleanly with PII redaction', () => {
    const text = formatMessageForRemindOrParentSquare({
      teamShortName: 'Oak TF',
      teamSlug: 'oak-tf',
      title: 'Bus Departure Update',
      body: 'Meet bus at 2:15 PM. Reach parent@example.com or 555-234-5678 if delayed.',
      publicHubOrigin: 'https://meetready.app',
    });
    expect(text).toContain('[MeetReady · Oak TF] Bus Departure Update');
    expect(text).not.toContain('parent@example.com');
    expect(text).not.toContain('555-234-5678');
    expect(text).toContain('https://meetready.app/team/oak-tf');
  });

  it('enforces FERPA photoReleaseOptOut PATCH ACL, projects opt-out names on PUBLIC_HUB album save, and renders Unified Comms Hub & album SSR', async () => {
    const coachSid = crypto.randomBytes(16).toString('hex');
    const ath1Sid = crypto.randomBytes(16).toString('hex');
    const ath2Sid = crypto.randomBytes(16).toString('hex');
    const parentSid = crypto.randomBytes(16).toString('hex');

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: baseUrl,
      name: 'Bayshore Harriers',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    const teamId = team.brand.teamId;
    createdTeamIds.push(teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId,
      originUrl: baseUrl,
      rows: [
        {
          invitedName: 'Maya Chen',
          invitedEmail: 'maya@bayshore.edu',
          parentGuardianEmail: 'chen.guardian@example.com',
          squadGroup: 'Distance',
          eventGroup: 'DISTANCE',
          isMinorU18: true,
        },
        {
          invitedName: 'Jordan Bell',
          invitedEmail: 'jordan@bayshore.edu',
          squadGroup: 'Sprints',
          eventGroup: 'SPRINTS',
          isMinorU18: true,
        },
      ],
    });

    const mayaClaim = await claimTeamJoinInvite({
      callerSid: ath1Sid,
      originUrl: baseUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Maya Chen',
      athleteEmail: 'maya@bayshore.edu',
      parentGuardianEmail: 'chen.guardian@example.com',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    const jordanClaim = await claimTeamJoinInvite({
      callerSid: ath2Sid,
      originUrl: baseUrl,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Jordan Bell',
      athleteEmail: 'jordan@bayshore.edu',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    expect(mayaClaim.ok && jordanClaim.ok).toBe(true);
    const mayaMemId = mayaClaim.summary!.myMembershipId;

    const followRes = await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Lin Chen',
      verifiedEmail: 'chen.guardian@example.com',
      originUrl: baseUrl,
    });
    expect(followRes.ok).toBe(true);

    // Unrelated athlete cannot flip Maya's FERPA photo opt-out
    const unauthRes = await fetch(
      `${baseUrl}/api/teams/${teamId}/members/${mayaMemId}/photo-release`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie('u-ath2', ath2Sid),
        },
        body: JSON.stringify({ photoReleaseOptOut: true }),
      }
    );
    expect(unauthRes.status).toBe(403);

    // Linked parent toggles Maya's FERPA opt-out ON via HTTP endpoint
    const parentPatch = await fetch(
      `${baseUrl}/api/teams/${teamId}/members/${mayaMemId}/photo-release`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie('u-parent', parentSid),
        },
        body: JSON.stringify({ photoReleaseOptOut: true }),
      }
    );
    expect(parentPatch.status).toBe(200);
    const parentJson = (await parentPatch.json()) as { ok: boolean };
    expect(parentJson.ok).toBe(true);

    // Coach saves meet with PUBLIC_HUB photo album -> receives FERPA warning names
    const eventSave = await upsertTeamEvent({
      callerSid: coachSid,
      teamId,
      input: {
        title: 'Bayshore Classic Invitational',
        eventType: 'MEET',
        date: '2026-11-28',
        visibilityScope: 'PUBLIC_HUB',
        curatedAlbumLinks: [
          {
            id: 'alb_classic',
            label: 'Classic Photos',
            url: 'https://photos.app.goo.gl/bayshoreClassic',
            visibility: 'PUBLIC_HUB',
            addedAt: new Date().toISOString(),
          },
        ],
      },
    });
    expect(eventSave.ok).toBe(true);
    expect(eventSave.photoReleaseOptOutNames).toContain('Maya Chen');

    // Also test coach clearing photoReleaseOptOut cleanly
    const coachClear = await updateTeamMemberPhotoRelease({
      callerSid: coachSid,
      teamId,
      membershipId: mayaMemId,
      photoReleaseOptOut: false,
      originUrl: baseUrl,
    });
    expect(coachClear.ok).toBe(true);
    expect(
      coachClear.team?.memberships.find((m) => m.membershipId === mayaMemId)
        ?.photoReleaseOptOut
    ).toBe(false);

    // Render Unified Comms Hub & CoachTeamEventsBar SSR cleanly
    const demoTeam = buildSampleDemoCoachSquad('Coach Rivera');
    const drawerHtml = renderToStaticMarkup(
      React.createElement(TeamMessagingDrawer, {
        isOpen: true,
        onClose: () => {},
        activeTeam: demoTeam,
        myTeams: [demoTeam],
        onTeamsUpdated: () => {},
        viewerMode: 'COACH',
        initialScope: 'ALL_TEAM',
      })
    );
    expect(drawerHtml).toContain('Comms Hub');
    expect(drawerHtml).toContain('comms-tab-announcements');
    expect(drawerHtml).toContain('comms-tab-workout-notes');
    expect(drawerHtml).toContain('messaging-scope-parents_only');
    expect(drawerHtml).toContain('messaging-scope-custom_subgroup');
    expect(drawerHtml).toContain('Copy Remind');
    expect(drawerHtml).toContain('Receipts');

    const eventsBarHtml = renderToStaticMarkup(
      React.createElement(CoachTeamEventsBar, {
        teamId: demoTeam.brand.teamId,
        isDemoMode: true,
        events: [eventSave.event!],
        rsvpCountsByEventId: {},
        photoOptOutAthleteNames: ['Maya Chen'],
        onSaveEvent: async () => undefined,
        onDeleteEvent: async () => undefined,
      })
    );
    expect(eventsBarHtml).toContain('Classic Photos');
    expect(eventsBarHtml).toContain('https://photos.app.goo.gl/bayshoreClassic');
  });
});
