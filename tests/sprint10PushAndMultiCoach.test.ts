import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSafePushPayload,
  dispatchTeamPushNotifications,
  getOrInitVapidKeys,
  listUserPushSubscriptions,
  removeUserPushSubscription,
  resetVapidKeyCacheForTest,
  resolvePushRecipientSidsForTeamEvent,
  saveUserPushSubscription,
  setPushNotificationSenderForTest,
} from '../server/pushNotificationService.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  previewTeamJoinInvite,
} from '../server/teamService.ts';
import {
  inviteTeamCoachingStaff,
  postTeamAnnouncement,
  updateAssistantCoachEventGroups,
} from '../server/teamFieldAndDailyOpsService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import { postTeamMessage } from '../server/teamMessagingService.ts';
import { postTeamWorkoutComment } from '../server/teamWorkoutAndGovernanceService.ts';
import { loadTeamDocRaw } from '../server/teamStoreCore.ts';
import { doesCoachOwnAthlete } from '../src/physiology/teamOnboardingEngine.ts';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData.ts';

describe('Wave 4: Device Push Notifications & Multi-Coach Staff Responsibility', () => {
  const createdTeamIds: string[] = [];
  const createdPushSids: string[] = [];

  afterEach(async () => {
    setPushNotificationSenderForTest(null);
    resetVapidKeyCacheForTest();
    while (createdPushSids.length > 0) {
      const sid = createdPushSids.pop();
      if (sid) await removeUserPushSubscription({ userSid: sid }).catch(() => undefined);
    }
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  it('initializes and reuses persistent VAPID keys and enforces public HTTPS SSRF guards on push subscriptions', async () => {
    const first = await getOrInitVapidKeys();
    const second = await getOrInitVapidKeys();
    expect(first.publicKey.length).toBeGreaterThan(20);
    expect(second.publicKey).toBe(first.publicKey);

    const userSid = `push-user-${crypto.randomUUID()}`;
    createdPushSids.push(userSid);

    const badLocalhost = await saveUserPushSubscription({
      userSid,
      endpoint: 'http://localhost:3001/push',
      keys: { p256dh: 'p256dh-test', auth: 'auth-test' },
    });
    expect(badLocalhost.ok).toBe(false);

    const badPrivateIp = await saveUserPushSubscription({
      userSid,
      endpoint: 'https://127.0.0.1/internal',
      keys: { p256dh: 'p256dh-test', auth: 'auth-test' },
    });
    expect(badPrivateIp.ok).toBe(false);

    const saved = await saveUserPushSubscription({
      userSid,
      endpoint: 'https://fcm.googleapis.com/fcm/send/example-token-123',
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=', auth: 'tBHItJI5svbpez7KI4CCXg==' },
      userAgent: 'Vitest Push Client',
    });
    expect(saved.ok).toBe(true);
    const list = await listUserPushSubscriptions(userSid);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toContain('fcm.googleapis.com');
  });

  it('invites specialty coaches (Pole Vault, Hurdles, Throws), preserves adult role/subsets on email & token claim without minor blocks, and scopes athletes cleanly', async () => {
    const headCoachSid = `hc-${crypto.randomUUID()}`;
    const pvCoachSid = `pv-${crypto.randomUUID()}`;
    const throwsCoachSid = `thr-${crypto.randomUUID()}`;
    const pvAthSid = `ath-pv-${crypto.randomUUID()}`;
    const throwsAthSid = `ath-thr-${crypto.randomUUID()}`;
    const sprintAthSid = `ath-sp-${crypto.randomUUID()}`;

    const team = await createTeamForCoach({
      callerSid: headCoachSid,
      originUrl: 'https://thresh.fit',
      name: 'Oak Ridge Track & Field',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        {
          invitedName: 'Skylar Vance',
          invitedEmail: 'skylar@oakridge.edu',
          squadGroup: 'Field',
          eventGroup: 'POLE_VAULT',
          isMinorU18: true,
        },
        {
          invitedName: 'Mason Cole',
          invitedEmail: 'mason@oakridge.edu',
          squadGroup: 'Throws',
          eventGroup: 'THROWS',
          isMinorU18: true,
        },
        {
          invitedName: 'Zoe Bennett',
          invitedEmail: 'zoe@oakridge.edu',
          squadGroup: 'Sprints',
          eventGroup: 'SPRINTS',
          isMinorU18: true,
        },
      ],
    });

    const a1 = await claimTeamJoinInvite({
      callerSid: pvAthSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Skylar Vance',
      athleteEmail: 'skylar@oakridge.edu',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    const a2 = await claimTeamJoinInvite({
      callerSid: throwsAthSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Mason Cole',
      athleteEmail: 'mason@oakridge.edu',
      birthYear: currentYear - 17,
      deferParentEmail: true,
    });
    const a3 = await claimTeamJoinInvite({
      callerSid: sprintAthSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Zoe Bennett',
      athleteEmail: 'zoe@oakridge.edu',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    expect(a1.ok && a2.ok && a3.ok).toBe(true);

    const skylarMemId = a1.summary!.myMembershipId;
    const masonMemId = a2.summary!.myMembershipId;
    const zoeMemId = a3.summary!.myMembershipId;

    // Head Coach invites Pole Vault Coach (with explicit crossover sprinter Zoe pinned too)
    const pvInvite = await inviteTeamCoachingStaff({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      staffName: 'Coach Priya Nguyen',
      staffEmail: 'nguyen@oakridge.edu',
      role: 'ASSISTANT_COACH',
      coachSpecialtyTitle: 'Pole Vault Coach',
      coachEventGroups: ['POLE_VAULT'],
      assignedAthleteMembershipIds: [zoeMemId, 'invalid-nonexistent-id'],
      originUrl: 'https://thresh.fit',
    });
    expect(pvInvite.ok).toBe(true);
    expect(pvInvite.member?.coachSpecialtyTitle).toBe('Pole Vault Coach');
    expect(pvInvite.member?.assignedAthleteMembershipIds).toEqual([zoeMemId]);
    expect(pvInvite.inviteUrl).toContain(`/join/${team.brand.slug}?t=`);

    // Preview shows specialty title before claim
    const token = new URL(pvInvite.inviteUrl!).searchParams.get('t')!;
    const preview = await previewTeamJoinInvite(team.brand.slug, token);
    expect(preview.found).toBe(true);
    expect(preview.membership?.role).toBe('ASSISTANT_COACH');
    expect(preview.membership?.coachSpecialtyTitle).toBe('Pole Vault Coach');

    // Coach claims by email on a HIGH_SCHOOL team WITHOUT a parent email -> succeeds as adult staff
    const claimedPv = await claimTeamJoinInvite({
      callerSid: pvCoachSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Coach Priya Nguyen',
      athleteEmail: 'nguyen@oakridge.edu',
    });
    expect(claimedPv.ok).toBe(true);
    const pvClaimMem = claimedPv.summary?.memberships.find(
      (m) => m.membershipId === claimedPv.summary?.myMembershipId
    );
    expect(pvClaimMem?.role).toBe('ASSISTANT_COACH');
    expect(pvClaimMem?.isMinorU18).toBe(false);
    expect(pvClaimMem?.coachSpecialtyTitle).toBe('Pole Vault Coach');
    expect(pvClaimMem?.assignedAthleteMembershipIds).toEqual([zoeMemId]);

    // Check summary projection for the Pole Vault coach
    const pvTeams = await listTeamsForUser(pvCoachSid, 'https://thresh.fit');
    expect(pvTeams[0].myCoachSpecialtyTitle).toBe('Pole Vault Coach');
    expect(pvTeams[0].myCoachEventGroups).toEqual(['POLE_VAULT']);
    expect(pvTeams[0].myAssignedAthleteMembershipIds).toEqual([zoeMemId]);

    // Invite Throws Coach and claim via invite token
    const thrInvite = await inviteTeamCoachingStaff({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      staffName: 'Coach OConnor',
      role: 'ASSISTANT_COACH',
      coachSpecialtyTitle: 'Throws Coach',
      coachEventGroups: ['THROWS'],
      originUrl: 'https://thresh.fit',
    });
    expect(thrInvite.ok).toBe(true);
    const thrToken = new URL(thrInvite.inviteUrl!).searchParams.get('t')!;
    const claimedThr = await claimTeamJoinInvite({
      callerSid: throwsCoachSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.slug,
      inviteToken: thrToken,
      athleteName: 'Coach OConnor',
    });
    expect(claimedThr.ok).toBe(true);
    const thrClaimMem = claimedThr.summary?.memberships.find(
      (m) => m.membershipId === claimedThr.summary?.myMembershipId
    );
    expect(thrClaimMem?.role).toBe('ASSISTANT_COACH');
    expect(thrClaimMem?.coachSpecialtyTitle).toBe('Throws Coach');

    // Update ownership via Head Coach
    const updatedScope = await updateAssistantCoachEventGroups({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      membershipId: claimedThr.summary!.myMembershipId,
      coachEventGroups: ['THROWS', 'JUMPS'],
      coachSpecialtyTitle: 'Throws & Multi Coach',
      assignedAthleteMembershipIds: [skylarMemId],
      originUrl: 'https://thresh.fit',
    });
    expect(updatedScope.ok).toBe(true);

    // Ownership helper verification
    expect(
      doesCoachOwnAthlete({
        coachEventGroups: ['POLE_VAULT'],
        assignedAthleteMembershipIds: [zoeMemId],
        athleteEventGroup: 'POLE_VAULT',
        athleteMembershipId: skylarMemId,
      })
    ).toBe(true);
    expect(
      doesCoachOwnAthlete({
        coachEventGroups: ['POLE_VAULT'],
        assignedAthleteMembershipIds: [zoeMemId],
        athleteEventGroup: 'SPRINTS',
        athleteMembershipId: zoeMemId,
      })
    ).toBe(true);
    expect(
      doesCoachOwnAthlete({
        coachEventGroups: ['POLE_VAULT'],
        assignedAthleteMembershipIds: [zoeMemId],
        athleteEventGroup: 'THROWS',
        athleteMembershipId: masonMemId,
      })
    ).toBe(false);
  });

  it('fans out Web Push respecting RBAC, SafeSport minor & staff lock-screen redaction, quiet hours + weather override, and prunes 410 endpoints', async () => {
    const headCoachSid = `hc-p-${crypto.randomUUID()}`;
    const distCoachSid = `dc-p-${crypto.randomUUID()}`;
    const sprintCoachSid = `sc-p-${crypto.randomUUID()}`;
    const distAthSid = `da-p-${crypto.randomUUID()}`;
    const sprintAthSid = `sa-p-${crypto.randomUUID()}`;
    createdPushSids.push(headCoachSid, distCoachSid, sprintCoachSid, distAthSid, sprintAthSid);

    const team = await createTeamForCoach({
      callerSid: headCoachSid,
      originUrl: 'https://thresh.fit',
      name: 'Bay Area Track Club',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        { invitedName: 'Runner One', invitedEmail: 'runner1@batc.org', squadGroup: 'Distance', eventGroup: 'DISTANCE', isMinorU18: true },
        { invitedName: 'Sprinter Two', invitedEmail: 'sprinter2@batc.org', squadGroup: 'Sprints', eventGroup: 'SPRINTS', isMinorU18: true },
      ],
    });
    const rJoin = await claimTeamJoinInvite({
      callerSid: distAthSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Runner One',
      athleteEmail: 'runner1@batc.org',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    await claimTeamJoinInvite({
      callerSid: sprintAthSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Sprinter Two',
      athleteEmail: 'sprinter2@batc.org',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });

    const dInvite = await inviteTeamCoachingStaff({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      staffName: 'Distance Coach',
      staffEmail: 'dcoach@batc.org',
      coachEventGroups: ['DISTANCE'],
      originUrl: 'https://thresh.fit',
    });
    const sInvite = await inviteTeamCoachingStaff({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      staffName: 'Sprint Coach',
      staffEmail: 'scoach@batc.org',
      coachEventGroups: ['SPRINTS'],
      originUrl: 'https://thresh.fit',
    });
    await claimTeamJoinInvite({
      callerSid: distCoachSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.slug,
      inviteToken: new URL(dInvite.inviteUrl!).searchParams.get('t')!,
      athleteName: 'Distance Coach',
    });
    await claimTeamJoinInvite({
      callerSid: sprintCoachSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.slug,
      inviteToken: new URL(sInvite.inviteUrl!).searchParams.get('t')!,
      athleteName: 'Sprint Coach',
    });

    const doc = (await loadTeamDocRaw(team.brand.teamId))!;

    // RBAC Recipient Fan-Out Checks
    const staffOnlyRecipients = resolvePushRecipientSidsForTeamEvent({
      doc,
      senderSid: headCoachSid,
      kind: 'TEAM_MESSAGE',
      channelScope: 'COACHES_STAFF',
    });
    expect(staffOnlyRecipients).toContain(distCoachSid);
    expect(staffOnlyRecipients).toContain(sprintCoachSid);
    expect(staffOnlyRecipients).not.toContain(headCoachSid); // Never notify sender
    expect(staffOnlyRecipients).not.toContain(distAthSid); // Athletes excluded
    expect(staffOnlyRecipients).not.toContain(sprintAthSid);

    const directToDistanceRecipients = resolvePushRecipientSidsForTeamEvent({
      doc,
      senderSid: distAthSid,
      kind: 'WORKOUT_COMMENT',
      targetMembershipId: rJoin.summary!.myMembershipId,
    });
    expect(directToDistanceRecipients).toContain(headCoachSid);
    expect(directToDistanceRecipients).toContain(distCoachSid);
    expect(directToDistanceRecipients).not.toContain(sprintCoachSid); // Unassigned sprint coach skipped
    expect(directToDistanceRecipients).not.toContain(sprintAthSid);

    // SafeSport minor & staff confidential lock-screen payload redaction
    const redactedMinor = buildSafePushPayload({
      teamId: team.brand.teamId,
      teamShortName: 'BATC',
      senderName: 'Coach Morales',
      kind: 'WORKOUT_COMMENT',
      bodyText: 'Left Achilles pain flag — take off spikes',
      isMinorTarget: true,
    });
    expect(redactedMinor.body).not.toContain('Achilles');
    expect(redactedMinor.body).toContain('SafeSport CC note');

    const redactedStaff = buildSafePushPayload({
      teamId: team.brand.teamId,
      teamShortName: 'BATC',
      senderName: 'Coach Morales',
      kind: 'TEAM_MESSAGE',
      channelScope: 'COACHES_STAFF',
      bodyText: 'Runner One medical check needed',
      isMinorTarget: false,
    });
    expect(redactedStaff.body).not.toContain('medical');
    expect(redactedStaff.body).toContain('coaching staff message');

    // Subscribe devices (give sprinter a stale 410 endpoint to verify pruning)
    for (const sid of [distCoachSid, distAthSid]) {
      await saveUserPushSubscription({
        userSid: sid,
        endpoint: `https://push.example.com/${sid}`,
        keys: { p256dh: 'key-a', auth: 'auth-a' },
        muteQuietHours: true,
      });
    }
    await saveUserPushSubscription({
      userSid: sprintAthSid,
      endpoint: `https://push.example.com/${sprintAthSid}-stale`,
      keys: { p256dh: 'key-b', auth: 'auth-b' },
      muteQuietHours: true,
    });

    const deliveredLog: Array<{ endpoint: string; body: string }> = [];
    setPushNotificationSenderForTest(async (sub, payloadJson) => {
      if (sub.endpoint.endsWith('-stale')) {
        const err = new Error('Gone') as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
      const parsed = JSON.parse(payloadJson) as { body: string };
      deliveredLog.push({ endpoint: sub.endpoint, body: parsed.body });
      return { statusCode: 201 };
    });

    // Quiet hours suppression (11pm local hour with muteQuietHours: true)
    const quietRes = await dispatchTeamPushNotifications({
      teamId: team.brand.teamId,
      senderSid: headCoachSid,
      senderName: 'Head Coach',
      kind: 'TEAM_MESSAGE',
      channelScope: 'ALL_TEAM',
      bodyText: 'Non-urgent split check',
      clientLocalHour: 23,
      isEmergency: false,
    });
    expect(quietRes.deliveredCount).toBe(0);
    expect(quietRes.prunedCount).toBe(0);
  });

  it('triggers push sender from postTeamMessage, postTeamWorkoutComment, and weather emergency announcements and prunes 410 endpoints', async () => {
    const headCoachSid = `hc-live-${crypto.randomUUID()}`;
    const athSid = `ath-live-${crypto.randomUUID()}`;
    const staleSid = `stale-live-${crypto.randomUUID()}`;
    createdPushSids.push(headCoachSid, athSid, staleSid);

    const team = await createTeamForCoach({
      callerSid: headCoachSid,
      originUrl: 'https://thresh.fit',
      name: 'Coastside Track',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const currentYear = new Date().getFullYear();
    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        { invitedName: 'Active Runner', invitedEmail: 'active@coast.org', squadGroup: 'Distance', eventGroup: 'DISTANCE', isMinorU18: true },
        { invitedName: 'Gone Runner', invitedEmail: 'gone@coast.org', squadGroup: 'Distance', eventGroup: 'DISTANCE', isMinorU18: true },
      ],
    });
    const j1 = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Active Runner',
      athleteEmail: 'active@coast.org',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    await claimTeamJoinInvite({
      callerSid: staleSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Gone Runner',
      athleteEmail: 'gone@coast.org',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });

    await saveUserPushSubscription({
      userSid: athSid,
      endpoint: 'https://push.example.com/active-device',
      keys: { p256dh: 'p256-ok', auth: 'auth-ok' },
      muteQuietHours: true,
    });
    await saveUserPushSubscription({
      userSid: staleSid,
      endpoint: 'https://push.example.com/expired-device',
      keys: { p256dh: 'p256-stale', auth: 'auth-stale' },
      muteQuietHours: true,
    });

    const sent: Array<{ endpoint: string; title: string; body: string }> = [];
    setPushNotificationSenderForTest(async (sub, payloadJson) => {
      if (sub.endpoint.includes('expired-device')) {
        const err = new Error('Gone') as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
      const parsed = JSON.parse(payloadJson) as { title: string; body: string };
      sent.push({ endpoint: sub.endpoint, title: parsed.title, body: parsed.body });
      return { statusCode: 201 };
    });

    // 1. Weather emergency announcement during quiet hours -> bypasses muteQuietHours AND prunes stale 410 subscription
    const ann = await postTeamAnnouncement({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      title: 'Lightning Shelter',
      body: 'All runners inside main gym immediately.',
      category: 'WEATHER',
      originUrl: 'https://thresh.fit',
    });
    expect(ann.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.some((s) => s.title.includes('Alert') && s.body.includes('Lightning Shelter'))).toBe(true);
    expect(await listUserPushSubscriptions(staleSid)).toHaveLength(0);

    // 2. Minor workout comment -> redacted lock-screen text
    const cmt = await postTeamWorkoutComment({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      targetMembershipId: j1.summary!.myMembershipId,
      workoutDate: '2026-04-12',
      body: 'Right calf soreness noticed — stick to stationary spin.',
      originUrl: 'https://thresh.fit',
    });
    expect(cmt.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    const cmtPush = sent.find((s) => s.body.includes('SafeSport CC note'));
    expect(cmtPush).toBeDefined();
    expect(cmtPush!.body).not.toContain('calf');

    // 3. Team message fan-out
    const msg = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'ALL_TEAM',
      body: 'Bus loads at 2:45 PM at North Gate.',
      clientLocalHour: 14,
      originUrl: 'https://thresh.fit',
    });
    expect(msg.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.some((s) => s.body.includes('Bus loads at 2:45 PM'))).toBe(true);
  });

  it('preserves exact 12 athlete rows on Willow Glen demo squad while providing 5 specialty coaching staff across all T&F groups', () => {
    const squad = buildSampleDemoCoachSquad('2026-04-12');
    const athletes = squad.memberships.filter((m) => m.role === 'ATHLETE');
    const staff = squad.memberships.filter(
      (m) => m.role === 'HEAD_COACH' || m.role === 'ASSISTANT_COACH'
    );
    expect(athletes).toHaveLength(12);
    expect(staff.length).toBe(5);
    expect(staff.some((s) => s.coachSpecialtyTitle === 'Distance Coach')).toBe(true);
    expect(staff.some((s) => s.coachSpecialtyTitle === 'Sprints & Hurdles Coach')).toBe(true);
    expect(staff.some((s) => s.coachSpecialtyTitle === 'Jumps & Pole Vault Coach')).toBe(true);
    expect(staff.some((s) => s.coachSpecialtyTitle === 'Throws Coach')).toBe(true);
    const coveredGroups = new Set(athletes.map((a) => a.eventGroup));
    expect(coveredGroups.has('DISTANCE')).toBe(true);
    expect(coveredGroups.has('SPRINTS')).toBe(true);
    expect(coveredGroups.has('HURDLES')).toBe(true);
    expect(coveredGroups.has('JUMPS')).toBe(true);
    expect(coveredGroups.has('POLE_VAULT')).toBe(true);
    expect(coveredGroups.has('THROWS')).toBe(true);
  });
});
