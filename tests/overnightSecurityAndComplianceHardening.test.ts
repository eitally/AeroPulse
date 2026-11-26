import crypto from 'crypto';
import fs from 'fs';
import type { Server } from 'http';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../server/vercelApp.ts';
import {
  deriveUserSessionSid,
  issueSessionToken,
  readBoundedResponseText,
  SESSION_COOKIE_NAME,
} from '../server/securityUtils.ts';
import {
  createMagicLinkToken,
  findOrCreateUser,
  linkProviderToUser,
  unlinkProviderFromUser,
  updateUserBirthMonthYear,
} from '../server/authService.ts';
import {
  autoLinkPendingTeamInvitesByEmail,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
} from '../server/teamService.ts';
import {
  removeTeamFromDirectoryAndVault,
  updateMemberRole,
  updateMemberRosterLifecycleStatus,
} from '../server/teamLifecycleService.ts';
import { broadcastWorkoutToTeamSquad } from '../server/teamWorkoutAndGovernanceService.ts';
import {
  followTeamAsParentOrFan,
  syncTeamIcsCalendar,
} from '../server/athleticSyncService.ts';
import {
  postTeamMessage,
  upsertTeamCustomSubgroup,
} from '../server/teamMessagingService.ts';
import {
  resolvePushRecipientSidsForTeamEvent,
  saveUserPushSubscription,
} from '../server/pushNotificationService.ts';
import { getClientRateLimitIp } from '../server/rateLimiter.ts';
import {
  createDelegatedTimingSession,
  submitDelegatedSplits,
} from '../server/teamTimingDelegationService.ts';
import {
  formatUserDataExportCsv,
  type UserDataExportPayload,
} from '../server/accountLifecycleService.ts';
import { loadTeamDocRaw, saveTeamDocRaw } from '../server/teamStoreCore.ts';
import {
  loadTenantVaultAsync,
  withTeamRowLock,
} from '../server/tokenVault.ts';
import { requestEmailOtpCode } from '../server/teamEmailAndOtpService.ts';

describe('Overnight Security, Youth Safeguarding & Backend Reliability Hardening', () => {
  let server: Server;
  let baseUrl = '';
  const createdTeamIds: string[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('P0 #1: shared-device magic-link login for User B does NOT hijack verified Coach A team ownership', async () => {
    const coachEmail = `coach-a-${crypto.randomUUID()}@school.edu`;
    const userBEmail = `user-b-${crypto.randomUUID()}@school.edu`;
    const coachUser = await findOrCreateUser('magic_link', coachEmail, {
      email: coachEmail,
      name: 'Coach A',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Lincoln Track',
      coachDisplayName: 'Coach A',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const coachCookieToken = issueSessionToken(coachUser.id, coachSid, 'verified');
    const { token: magicToken } = await createMagicLinkToken(userBEmail);

    const res = await fetch(`${baseUrl}/api/auth/magic-link/verify`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        cookie: `${SESSION_COOKIE_NAME}=${coachCookieToken}`,
      },
      body: JSON.stringify({ token: magicToken }),
    });
    expect(res.status).toBe(303);

    const coachTeamsAfter = await listTeamsForUser(coachSid, 'https://meetready.app');
    expect(coachTeamsAfter.some((t) => t.brand.teamId === team.brand.teamId)).toBe(true);

    const userBRecord = await findOrCreateUser('magic_link', userBEmail, {
      email: userBEmail,
      name: 'User B',
    });
    const userBSid = deriveUserSessionSid(userBRecord.id);
    const userBTeamsAfter = await listTeamsForUser(userBSid, 'https://meetready.app');
    expect(userBTeamsAfter.some((t) => t.brand.teamId === team.brand.teamId)).toBe(false);
  });

  it('P0 #2: Email OTP login on shared browser does NOT bind a new email to verified Coach A sid', async () => {
    const coachEmail = `otp-coach-${crypto.randomUUID()}@school.edu`;
    const newAthleteEmail = `otp-ath-${crypto.randomUUID()}@school.edu`;
    const coachUser = await findOrCreateUser('magic_link', coachEmail, {
      email: coachEmail,
      name: 'Coach OTP',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const coachTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'OTP Guard Team',
      coachDisplayName: 'Coach OTP',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(coachTeam.brand.teamId);

    const sendRes = await requestEmailOtpCode(newAthleteEmail, { birthMonthYear: '2000-05' });
    expect(sendRes.ok).toBe(true);
    expect(sendRes.devPreviewCode).toMatch(/^\d{6}$/);

    const coachCookieToken = issueSessionToken(coachUser.id, coachSid, 'verified');
    const verifyRes = await fetch(`${baseUrl}/api/auth/email/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        cookie: `${SESSION_COOKIE_NAME}=${coachCookieToken}`,
      },
      body: JSON.stringify({
        email: newAthleteEmail,
        code: sendRes.devPreviewCode,
        birthMonthYear: '2000-05',
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyJson = (await verifyRes.json()) as {
      ok: boolean;
      teams: Array<{ brand: { teamId: string } }>;
    };
    expect(verifyJson.ok).toBe(true);
    expect(verifyJson.teams.some((t) => t.brand.teamId === coachTeam.brand.teamId)).toBe(false);
  });

  it('P0 #3: SafeSport MAAPP enforces parent visibility on HIGH_SCHOOL CUSTOM_SUBGROUP even if includeLinkedParents: false is passed', async () => {
    const coachSid = `ss-coach-${crypto.randomUUID()}`;
    const athSid = `ss-ath-${crypto.randomUUID()}`;
    const parentSid = `ss-par-${crypto.randomUUID()}`;
    const parentEmail = `parent-${crypto.randomUUID()}@family.org`;
    const minorEmail = `maya-${crypto.randomUUID()}@student.edu`;
    const currentYear = new Date().getFullYear();

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Oakridge HS XC',
      coachDisplayName: 'Coach Safe',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    createdTeamIds.push(team.brand.teamId);

    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      rows: [
        {
          invitedName: 'Maya Minor',
          invitedEmail: minorEmail,
          parentGuardianEmail: parentEmail,
          squadGroup: 'Distance',
          isMinorU18: true,
        },
      ],
    });

    const claim = await claimTeamJoinInvite({
      callerSid: athSid,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Maya Minor',
      athleteEmail: minorEmail,
      parentGuardianEmail: parentEmail,
      birthYear: currentYear - 16,
      deferParentEmail: true,
      originUrl: 'https://meetready.app',
    });
    expect(claim.ok).toBe(true);
    const minorMemId = claim.summary!.myMembershipId;

    await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Maya Parent',
      verifiedEmail: parentEmail,
      originUrl: 'https://meetready.app',
    });

    const sg = await upsertTeamCustomSubgroup({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      name: '1-on-1 Check',
      memberIds: [minorMemId],
      includeLinkedParents: false,
      originUrl: 'https://meetready.app',
    });
    expect(sg.ok).toBe(true);
    expect(sg.subgroup?.includeLinkedParents).toBe(true);

    const msg = await postTeamMessage({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      channelScope: 'CUSTOM_SUBGROUP',
      customSubgroupId: sg.subgroup!.id,
      body: 'Confirming 400m split targets for Friday.',
      clientMessageId: 'offline-msg-idem-1',
      originUrl: 'https://meetready.app',
    });
    expect(msg.ok).toBe(true);

    // Idempotency retry check: same clientMessageId returns deduplicated without double-posting
    const dupMsg = await postTeamMessage({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      channelScope: 'CUSTOM_SUBGROUP',
      customSubgroupId: sg.subgroup!.id,
      body: 'Confirming 400m split targets for Friday.',
      clientMessageId: 'offline-msg-idem-1',
      originUrl: 'https://meetready.app',
    });
    expect(dupMsg.ok).toBe(true);
    expect(dupMsg.deduplicated).toBe(true);
    expect(dupMsg.message?.id).toBe(msg.message?.id);

    const parentTeams = await listTeamsForUser(parentSid, 'https://meetready.app');
    const parentTeam = parentTeams.find((t) => t.brand.teamId === team.brand.teamId);
    expect(parentTeam?.customSubgroups?.some((g) => g.id === sg.subgroup!.id)).toBe(true);
    expect(parentTeam?.teamMessages?.some((m) => m.id === msg.message?.id)).toBe(true);

    // Push recipients must also include the linked parent
    const rawDoc = await loadTeamDocRaw(team.brand.teamId);
    const pushSids = resolvePushRecipientSidsForTeamEvent({
      doc: rawDoc!,
      senderSid: coachSid,
      kind: 'TEAM_MESSAGE',
      channelScope: 'CUSTOM_SUBGROUP',
      customSubgroupId: sg.subgroup!.id,
    });
    expect(pushSids).toContain(parentSid);
  });

  it('P1 #4: Web Push subscription endpoint rejects IPv4-mapped IPv6, ULA, CGNAT, and metadata IPs', async () => {
    const sid = `ssrf-push-${crypto.randomUUID()}`;
    const blockedUrls = [
      'https://[::ffff:169.254.169.254]/push',
      'https://[::ffff:127.0.0.1]/push',
      'https://[fd00::1]/push',
      'https://[fe80::1]/push',
      'https://100.64.0.1/push',
      'https://0.0.0.0/push',
      'https://metadata.internal/push',
    ];
    for (const endpoint of blockedUrls) {
      const res = await saveUserPushSubscription({
        userSid: sid,
        endpoint,
        keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
      });
      expect(res.ok, `Expected SSRF endpoint to be blocked: ${endpoint}`).toBe(false);
    }
  });

  it('P1 #5: Strava webhook rejects path traversal owner_id_str without touching /tmp files', async () => {
    const sentinelName = `thresh-sentinel-${crypto.randomUUID()}`;
    const sentinelPath = `/tmp/${sentinelName}.json`;
    fs.writeFileSync(sentinelPath, JSON.stringify({ safe: true }), 'utf8');
    try {
      const res = await fetch(`${baseUrl}/api/webhooks/strava`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_type: 'athlete',
          aspect_type: 'delete',
          owner_id_str: `../${sentinelName}`,
        }),
      });
      expect(res.status).toBe(400);
      expect(fs.existsSync(sentinelPath)).toBe(true);
    } finally {
      if (fs.existsSync(sentinelPath)) fs.unlinkSync(sentinelPath);
    }
  });

  it('P1 #6 & #7 & #12 & #13: strips peer athleteOverrides, blocks ASSISTANT_COACH revoking ORG_ADMIN, enforces timing PIN for PARENT_FOLLOWER, and quarantines auto-linked minors', async () => {
    const headCoachSid = `rbac-hc-${crypto.randomUUID()}`;
    const asstCoachSid = `rbac-ac-${crypto.randomUUID()}`;
    const orgAdminSid = `rbac-oa-${crypto.randomUUID()}`;
    const athASid = `rbac-atha-${crypto.randomUUID()}`;
    const athBSid = `rbac-athb-${crypto.randomUUID()}`;
    const parentSid = `rbac-par-${crypto.randomUUID()}`;
    const acEmail = `ac-${crypto.randomUUID()}@school.edu`;
    const adEmail = `ad-${crypto.randomUUID()}@school.edu`;
    const athAEmail = `atha-${crypto.randomUUID()}@school.edu`;
    const athBEmail = `athb-${crypto.randomUUID()}@school.edu`;
    const minorAutoEmail = `minor-autolink-${crypto.randomUUID()}@student.edu`;
    const currentYear = new Date().getFullYear();

    const team = await createTeamForCoach({
      callerSid: headCoachSid,
      originUrl: 'https://meetready.app',
      name: 'RBAC Guard HS',
      coachDisplayName: 'Head Coach',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      externalSync: { enablePublicParentHub: true },
    });
    createdTeamIds.push(team.brand.teamId);

    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      rows: [
        { invitedName: 'Asst Coach', invitedEmail: acEmail, squadGroup: 'Staff', isMinorU18: false },
        { invitedName: 'District AD', invitedEmail: adEmail, squadGroup: 'Staff', isMinorU18: false },
        { invitedName: 'Athlete A', invitedEmail: athAEmail, squadGroup: 'Distance', isMinorU18: true },
        { invitedName: 'Athlete B', invitedEmail: athBEmail, squadGroup: 'Distance', isMinorU18: true },
        { invitedName: 'Auto Minor', invitedEmail: minorAutoEmail, squadGroup: 'Distance', isMinorU18: true },
      ],
    });

    const acClaim = await claimTeamJoinInvite({
      callerSid: asstCoachSid,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Asst Coach',
      athleteEmail: acEmail,
      birthYear: 1985,
      originUrl: 'https://meetready.app',
    });
    const oaClaim = await claimTeamJoinInvite({
      callerSid: orgAdminSid,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'District AD',
      athleteEmail: adEmail,
      birthYear: 1980,
      originUrl: 'https://meetready.app',
    });
    const athAClaim = await claimTeamJoinInvite({
      callerSid: athASid,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Athlete A',
      athleteEmail: athAEmail,
      birthYear: currentYear - 16,
      deferParentEmail: true,
      originUrl: 'https://meetready.app',
    });
    const athBClaim = await claimTeamJoinInvite({
      callerSid: athBSid,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Athlete B',
      athleteEmail: athBEmail,
      birthYear: currentYear - 16,
      deferParentEmail: true,
      originUrl: 'https://meetready.app',
    });

    const acMemId = acClaim.summary!.myMembershipId;
    const oaMemId = oaClaim.summary!.myMembershipId;
    const athAMemId = athAClaim.summary!.myMembershipId;
    const athBMemId = athBClaim.summary!.myMembershipId;

    await updateMemberRole({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      membershipId: acMemId,
      role: 'ASSISTANT_COACH',
      originUrl: 'https://meetready.app',
    });
    await updateMemberRole({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      membershipId: oaMemId,
      role: 'ORG_ADMIN',
      originUrl: 'https://meetready.app',
    });

    // P1 #7: Assistant coach cannot revoke ORG_ADMIN
    const badRevoke = await updateMemberRosterLifecycleStatus({
      callerSid: asstCoachSid,
      teamId: team.brand.teamId,
      membershipId: oaMemId,
      status: 'REVOKED',
      originUrl: 'https://meetready.app',
    });
    expect(badRevoke.ok).toBe(false);

    // P1 #6: Peer athleteOverrides and targetMembershipIds stripped for ATHLETE viewers
    await broadcastWorkoutToTeamSquad({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      date: '2026-12-01',
      name: 'Tempo Mod',
      description: '20 min tempo',
      sportCategory: 'Running',
      plannedDurationSecs: 1800,
      plannedLoad: 45,
      workoutSyntax: '20m tempo',
      targetSquadGroup: 'ALL',
      targetMembershipIds: [athAMemId, athBMemId],
      athleteOverrides: {
        [athAMemId]: {
          name: 'Athlete A Shin Rehab',
          workoutSyntax: '15m easy',
          description: 'Keep under 6:30/mi',
        },
        [athBMemId]: {
          name: 'Athlete B Knee RTP',
          workoutSyntax: '10m jog',
          description: 'Private medical restriction',
        },
      },
    });

    const athATeams = await listTeamsForUser(athASid, 'https://meetready.app');
    const athABroadcast = athATeams[0]?.broadcastWorkouts?.[0];
    expect(athABroadcast?.targetMembershipIds).toBeUndefined();
    expect(Object.keys(athABroadcast?.athleteOverrides || {})).toEqual([athAMemId]);

    // P2 #12: PARENT_FOLLOWER cannot bypass 4-digit PIN on delegated timing pass
    await followTeamAsParentOrFan({
      callerSid: parentSid,
      codeOrSlug: team.brand.slug,
      followerName: 'Spectator Parent',
      verifiedEmail: `spec-${crypto.randomUUID()}@family.org`,
      originUrl: 'https://meetready.app',
    });
    const passRes = await createDelegatedTimingSession({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      meetTitle: 'Spring Dual',
      eventLabel: '1600m Heat 1',
      runners: [{ membershipId: athAMemId, displayName: 'Athlete A' }],
      assignedMembershipId: acMemId,
      pin: '4821',
    });
    expect(passRes.ok).toBe(true);
    const parentSubmitNoPin = await submitDelegatedSplits({
      passCode: passRes.session!.passCode,
      callerSid: parentSid,
      capturedByName: 'Spectator Parent',
      entries: [
        {
          entryKey: passRes.session!.runners[0].entryKey,
          displayName: 'Athlete A',
          splitsMs: [72000],
          cumulativeMs: [72000],
          finishMs: 72000,
        },
      ],
    });
    expect(parentSubmitNoPin.ok).toBe(false);
    expect(parentSubmitNoPin.statusCode).toBe(403);

    // P2 #13: Auto-linked minor invite receives LOAD_ONLY and parentConsentStatus PENDING
    const minorAutoSid = `minor-auto-${crypto.randomUUID()}`;
    await autoLinkPendingTeamInvitesByEmail({
      email: minorAutoEmail,
      userSid: minorAutoSid,
      athleteName: 'Auto Minor',
    });
    const rawDoc = await loadTeamDocRaw(team.brand.teamId);
    const linkedMinor = rawDoc?.memberships.find((m) => m.userSid === minorAutoSid);
    expect(linkedMinor?.sharingTier).toBe('LOAD_ONLY');
    expect(linkedMinor?.parentConsentStatus).toBe('PENDING');
  });

  it('P1 #8 & #9: getClientRateLimitIp ignores spoofed headers outside Vercel and /api/workouts/export bounds repeatCount DoS', async () => {
    const prevVercel = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      const makeReq = (spoofIp: string) =>
        ({
          headers: {
            'x-vercel-forwarded-for': spoofIp,
            'x-forwarded-for': spoofIp,
          },
          ip: '198.51.100.10',
          socket: { remoteAddress: '198.51.100.10' },
        }) as unknown as Request;
      expect(getClientRateLimitIp(makeReq('1.1.1.1'))).toBe('198.51.100.10');
      expect(getClientRateLimitIp(makeReq('2.2.2.2'))).toBe('198.51.100.10');
    } finally {
      if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
    }

    const dosRes = await fetch(`${baseUrl}/api/workouts/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DoS Test',
        steps: [{ repeatCount: 10_000_000, steps: [{ label: 'x', durationSecs: 60 }] }],
      }),
    });
    expect(dosRes.status).toBe(400);
  });

  it('P1 #10: syncTeamIcsCalendar preserves concurrent team mutations via withTeamRowLock', async () => {
    const coachSid = `ics-lock-coach-${crypto.randomUUID()}`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: 'Lock Test Track',
      coachDisplayName: 'Coach Lock',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const sampleIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:lock-meet-1@meetready.test',
      'DTSTART:20260418T160000Z',
      'SUMMARY:Spring Invitational',
      'LOCATION:Lincoln Stadium',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const [icsRes] = await Promise.all([
      syncTeamIcsCalendar({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        icsText: sampleIcs,
      }),
      withTeamRowLock(team.brand.teamId, async () => {
        const doc = await loadTeamDocRaw(team.brand.teamId);
        if (doc) {
          doc.announcements = [
            ...(doc.announcements || []),
            {
              id: 'ann_concurrent_1',
              teamId: team.brand.teamId,
              title: 'Bus Update',
              body: 'Bus leaves at 2:15 PM',
              category: 'MEET_LOGISTICS',
              publishToParentHub: true,
              authorName: 'Coach Lock',
              createdAt: new Date().toISOString(),
            },
          ];
          await saveTeamDocRaw(team.brand.teamId, doc);
        }
      }),
    ]);

    expect(icsRes.ok).toBe(true);
    const finalDoc = await loadTeamDocRaw(team.brand.teamId);
    expect(finalDoc?.announcements?.some((a) => a.id === 'ann_concurrent_1')).toBe(true);
    expect(finalDoc?.broadcastWorkouts?.some((b) => b.name.includes('Spring Invitational'))).toBe(
      true
    );
  });

  it('P2 #11 & #14 & #15: enforces minor DOB lock across /api/athlete/profile, prevents last-provider unlink lockout, bounds response streams, and neutralizes whitespace CSV formulas', async () => {
    // P2 #11: Minor DOB on ThreshUser blocks adult downgrade on /api/athlete/profile
    const minorEmail = `dob-lock-${crypto.randomUUID()}@student.edu`;
    const minorUser = await findOrCreateUser('magic_link', minorEmail, {
      email: minorEmail,
      name: 'Minor Lock',
    });
    await updateUserBirthMonthYear(minorUser.id, '2011-05');
    const minorSid = deriveUserSessionSid(minorUser.id);
    const minorCookie = issueSessionToken(minorUser.id, minorSid, 'verified');

    const dobDowngradeRes = await fetch(`${baseUrl}/api/athlete/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        cookie: `${SESSION_COOKIE_NAME}=${minorCookie}`,
      },
      body: JSON.stringify({
        athleteProfile: { name: 'Minor Lock', birthMonthYear: '1994-01' },
      }),
    });
    expect(dobDowngradeRes.status).toBe(403);

    // P2 #14: Unlinking provider when all authProviders match that provider is blocked
    const pkUser = await findOrCreateUser('passkey', `pk-1-${crypto.randomUUID()}`, {
      name: 'Passkey Only',
    });
    await linkProviderToUser(pkUser.id, 'passkey', `pk-2-${crypto.randomUUID()}`);
    const blockedUnlink = await unlinkProviderFromUser(pkUser.id, 'passkey');
    expect(blockedUnlink.ok).toBe(false);

    await linkProviderToUser(pkUser.id, 'google', `goog-${crypto.randomUUID()}`);
    const okUnlink = await unlinkProviderFromUser(pkUser.id, 'passkey');
    expect(okUnlink.ok).toBe(true);
    const loadedVault = await loadTenantVaultAsync<{ passkeys?: unknown[] } | null>(
      `auth_user_${pkUser.id}`,
      null
    );
    expect(loadedVault?.passkeys || []).toHaveLength(0);

    // P2 #15a: readBoundedResponseText caps huge streams without reading full body
    const hugeChunk = new Uint8Array(4096).fill(65); // 'A'
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) {
          controller.close();
          return;
        }
        controller.enqueue(hugeChunk);
      },
    });
    const fakeResp = new Response(stream);
    const bounded = await readBoundedResponseText(fakeResp, 8192);
    expect(bounded.length).toBe(8192);
    expect(pulls).toBeLessThan(10);

    // P2 #15b: CSV export neutralizes leading-space and leading-newline formula payloads
    const nowIso = new Date().toISOString();
    const exportPayload: UserDataExportPayload = {
      schemaVersion: 'meetready-export-v1',
      exportedAt: nowIso,
      account: {
        id: 'usr_csv_test',
        name: ' =HYPERLINK("https://evil.test","click")',
        email: 'csv@test.org',
        role: 'ATHLETE',
        createdAt: nowIso,
        updatedAt: nowIso,
        authProviders: [],
        passkeys: [],
        connectedServices: [],
      },
      athleteState: {
        updatedAt: nowIso,
        plannedEvents: [
          {
            id: 'pe1',
            date: '2026-12-01',
            name: '\n+cmd|\'/C calc\'!A0',
            sportCategory: 'Running',
            plannedLoad: -12.5,
            plannedDurationSecs: 1200,
            description: 'Test',
            environmentPreference: 'OUTDOOR',
            targetZoneSummary: 'Z2',
          },
        ],
        targetGoals: [],
        annualMileageGoals: [],
        gearItems: [],
        sessionCheckIns: [],
        coachArchivedActivities: [],
      },
      teams: [],
      summary: {
        plannedEventsCount: 1,
        sessionCheckInsCount: 0,
        coachArchivedActivitiesCount: 0,
        gearItemsCount: 0,
        teamMembershipsCount: 0,
        fieldMarkLogsCount: 0,
      },
    };
    const csv = formatUserDataExportCsv(exportPayload);
    expect(csv).toContain(`' =HYPERLINK(""https://evil.test"",""click"")`);
    expect(csv).toContain(`"'\n+cmd|'/C calc'!A0"`);
    expect(csv).toContain(',1200,-12.5');
  });
});
