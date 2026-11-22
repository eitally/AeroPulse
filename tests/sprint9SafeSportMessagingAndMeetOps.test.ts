import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateHyTekSemiColonEntryCsv,
  parseTrackSeedTimeToSecs,
  seedFieldFlights,
  seedTrackHeats,
  validateNfhsFourEventLimits,
  type MeetEntryRecord,
} from '../src/physiology/meetDayOpsEngine.ts';
import {
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
} from '../server/teamService.ts';
import {
  removeTeamFromDirectoryAndVault,
  updateMemberRole,
} from '../server/teamLifecycleService.ts';
import { getTeamGovernanceAuditLog } from '../server/teamWorkoutAndGovernanceService.ts';
import {
  acknowledgeTeamMessage,
  flagTeamMessageForReview,
  postTeamMessage,
  updateTeamMessagingPolicy,
} from '../server/teamMessagingService.ts';

describe('Wave 3: SafeSport MAAPP Messaging & Meet-Day Heats/Flights/NFHS Ops', () => {
  const createdTeamIds: string[] = [];

  afterEach(async () => {
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  it('enforces SafeSport MAAPP rules: no private 1:1 minor DMs, Parent/Two-Adult CC, RBAC channel isolation, ack & flagging', async () => {
    const headCoachSid = `coach-s9-${crypto.randomUUID()}`;
    const asstCoachSid = `asst-s9-${crypto.randomUUID()}`;
    const ath1Sid = `ath1-s9-${crypto.randomUUID()}`;
    const ath2Sid = `ath2-s9-${crypto.randomUUID()}`;

    const team = await createTeamForCoach({
      callerSid: headCoachSid,
      originUrl: 'https://thresh.fit',
      name: 'Willow Creek High Track',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const currentYear = new Date().getFullYear();

    // Pre-invite athletes with distinct event groups and claim
    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        {
          invitedName: 'Elena Vasquez',
          invitedEmail: 'elena@wchs.edu',
          squadGroup: 'Sprints',
          eventGroup: 'SPRINTS',
          isMinorU18: true,
        },
        {
          invitedName: 'Marcus Bell',
          invitedEmail: 'marcus@wchs.edu',
          squadGroup: 'Distance',
          eventGroup: 'DISTANCE',
          isMinorU18: true,
        },
      ],
    });
    const j1 = await claimTeamJoinInvite({
      callerSid: ath1Sid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Elena Vasquez',
      athleteEmail: 'elena@wchs.edu',
      birthYear: currentYear - 16,
      deferParentEmail: true,
    });
    const j2 = await claimTeamJoinInvite({
      callerSid: ath2Sid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Marcus Bell',
      athleteEmail: 'marcus@wchs.edu',
      birthYear: currentYear - 17,
      deferParentEmail: true,
    });
    const mem1 = j1.summary!.memberships.find((m) => m.invitedName === 'Elena Vasquez')!;
    const mem2 = j2.summary!.memberships.find((m) => m.invitedName === 'Marcus Bell')!;

    await bulkCreateAndSendInvites({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        {
          invitedName: 'Assistant Coach Rivera',
          invitedEmail: 'rivera@wchs.edu',
          squadGroup: 'Sprints',
          isMinorU18: false,
        },
      ],
    });
    const jAsst = await claimTeamJoinInvite({
      callerSid: asstCoachSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Assistant Coach Rivera',
      athleteEmail: 'rivera@wchs.edu',
      birthYear: currentYear - 30,
    });
    const asstMem = jAsst.summary!.memberships.find((m) => m.invitedName === 'Assistant Coach Rivera')!;
    await updateMemberRole({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      membershipId: asstMem.membershipId,
      role: 'ASSISTANT_COACH',
      originUrl: 'https://thresh.fit',
    });

    // 1. Block secret 1:1 minor DM or disabled guardian CC with 403
    const secretAttempt = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'DIRECT_TRANSPARENT',
      targetMembershipId: mem1.membershipId,
      body: 'Private message without CC',
      privateDirectToMinor: true,
      originUrl: 'https://thresh.fit',
    });
    expect(secretAttempt.ok).toBe(false);
    expect(secretAttempt.status).toBe(403);

    const noCcAttempt = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'DIRECT_TRANSPARENT',
      targetMembershipId: mem1.membershipId,
      body: 'Attempt without guardian CC',
      guardianCc: false,
      originUrl: 'https://thresh.fit',
    });
    expect(noCcAttempt.ok).toBe(false);
    expect(noCcAttempt.status).toBe(403);

    // 2. Valid transparent DM applies Guardian CC + Two-Adult visibility, and respects quiet hours
    const validDm = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'DIRECT_TRANSPARENT',
      targetMembershipId: mem1.membershipId,
      body: 'Bring warmup blocks tomorrow at 3:15 PM.',
      clientLocalHour: 22,
      originUrl: 'https://thresh.fit',
    });
    expect(validDm.ok).toBe(true);
    expect(validDm.message?.guardianCcApplied).toBe(true);
    expect(validDm.message?.secondAdultVisible).toBe(true);
    expect(validDm.message?.sentDuringQuietHours).toBe(true);

    // 3. Emergency override clears quiet-hours curfew mark
    const emergencyMsg = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'ALL_TEAM',
      body: 'Meet bus moved to Gate B due to lightning storm.',
      clientLocalHour: 22,
      isEmergencyOverride: true,
      originUrl: 'https://thresh.fit',
    });
    expect(emergencyMsg.ok).toBe(true);
    expect(emergencyMsg.message?.isEmergencyOverride).toBe(true);
    expect(emergencyMsg.message?.sentDuringQuietHours).toBeUndefined();

    // 4. Staff-only message is invisible & denied to athletes
    const staffNote = await postTeamMessage({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      channelScope: 'COACHES_STAFF',
      body: 'Keep relay baton order confidential until warmups.',
      originUrl: 'https://thresh.fit',
    });
    expect(staffNote.ok).toBe(true);

    const athStaffDenied = await postTeamMessage({
      callerSid: ath1Sid,
      teamId: team.brand.teamId,
      channelScope: 'COACHES_STAFF',
      body: 'Peeking into staff chat',
      originUrl: 'https://thresh.fit',
    });
    expect(athStaffDenied.ok).toBe(false);
    expect(athStaffDenied.status).toBe(403);

    // Verify clean-room projection across caller roles:
    const asstTeams = await listTeamsForUser(asstCoachSid, 'https://thresh.fit');
    const asstTeam = asstTeams.find((t) => t.brand.teamId === team.brand.teamId)!;
    // Assistant Coach sees Two-Adult oversight of DM + Staff + Whole Team
    expect(asstTeam.teamMessages?.some((m) => m.id === validDm.message!.id)).toBe(true);
    expect(asstTeam.teamMessages?.some((m) => m.id === staffNote.message!.id)).toBe(true);

    const ath2Teams = await listTeamsForUser(ath2Sid, 'https://thresh.fit');
    const ath2Team = ath2Teams.find((t) => t.brand.teamId === team.brand.teamId)!;
    // Athlete 2 sees Whole Team emergency announcement, NEVER Athlete 1's DM and NEVER Coaches Staff chat
    expect(ath2Team.teamMessages?.some((m) => m.id === emergencyMsg.message!.id)).toBe(true);
    expect(ath2Team.teamMessages?.some((m) => m.id === validDm.message!.id)).toBe(false);
    expect(ath2Team.teamMessages?.some((m) => m.id === staffNote.message!.id)).toBe(false);
    expect(mem2.membershipId).toBeTruthy();

    // 5. Athlete acknowledges Whole Team message and flags an item -> audit log records it
    const ackRes = await acknowledgeTeamMessage({
      callerSid: ath2Sid,
      teamId: team.brand.teamId,
      messageId: emergencyMsg.message!.id,
      originUrl: 'https://thresh.fit',
    });
    expect(ackRes.ok).toBe(true);
    const ackedMsg = ackRes.team!.teamMessages!.find((m) => m.id === emergencyMsg.message!.id)!;
    expect(ackedMsg.acknowledgedByMembershipIds).toContain(mem2.membershipId);

    const flagRes = await flagTeamMessageForReview({
      callerSid: ath1Sid,
      teamId: team.brand.teamId,
      messageId: validDm.message!.id,
      reason: 'Check scheduling note',
      originUrl: 'https://thresh.fit',
    });
    expect(flagRes.ok).toBe(true);
    expect(
      flagRes.team!.teamMessages!.find((m) => m.id === validDm.message!.id)?.flaggedForAdminReview
    ).toBe(true);

    // 6. Announcement-only policy blocks athlete group posts while allowing transparent Direct message to staff
    const policyRes = await updateTeamMessagingPolicy({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
      athleteRepliesEnabled: false,
      originUrl: 'https://thresh.fit',
    });
    expect(policyRes.ok).toBe(true);
    expect(policyRes.team?.messagingPolicy?.athleteRepliesEnabled).toBe(false);

    const groupReplyBlocked = await postTeamMessage({
      callerSid: ath1Sid,
      teamId: team.brand.teamId,
      channelScope: 'ALL_TEAM',
      body: 'Reply when broadcast-only',
      originUrl: 'https://thresh.fit',
    });
    expect(groupReplyBlocked.ok).toBe(false);
    expect(groupReplyBlocked.status).toBe(403);

    const directToCoachAllowed = await postTeamMessage({
      callerSid: ath1Sid,
      teamId: team.brand.teamId,
      channelScope: 'DIRECT_TRANSPARENT',
      body: 'Running 5m late after lab.',
      originUrl: 'https://thresh.fit',
    });
    expect(directToCoachAllowed.ok).toBe(true);

    const audit = await getTeamGovernanceAuditLog({
      callerSid: headCoachSid,
      teamId: team.brand.teamId,
    });
    expect(audit.ok).toBe(true);
    expect(audit.entries?.some((e) => e.action === 'TEAM_MESSAGE_FLAGGED')).toBe(true);
    expect(audit.entries?.some((e) => e.action === 'TEAM_MESSAGING_POLICY_UPDATED')).toBe(true);
  });

  it('validates NFHS Rule 4-2 4-event limit, seeds Track Heats & Field Flights, and exports sanitized Hy-Tek CSV', () => {
    expect(parseTrackSeedTimeToSecs('4:18.42')).toBe(258.42);
    expect(parseTrackSeedTimeToSecs('10.94')).toBe(10.94);
    expect(parseTrackSeedTimeToSecs('NT')).toBeNull();

    const entries: MeetEntryRecord[] = [
      { id: '1', athleteId: 'a1', athleteName: 'Devon Carter', eventCode: '100m', seedMark: '10.94' },
      { id: '2', athleteId: 'a1', athleteName: 'Devon Carter', eventCode: '200m', seedMark: '22.10' },
      { id: '3', athleteId: 'a1', athleteName: 'Devon Carter', eventCode: '4x100m', seedMark: '42.80' },
      { id: '4', athleteId: 'a1', athleteName: 'Devon Carter', eventCode: 'LJ', seedMark: "22' 4\"" },
      { id: '5', athleteId: 'a1', athleteName: 'Devon Carter', eventCode: 'HJ', seedMark: "6' 2\"" },
      { id: '6', athleteId: 'a2', athleteName: '=CMD() Athlete', eventCode: '100m', seedMark: '11.40' },
      { id: '7', athleteId: 'a3', athleteName: 'Liam Wu', eventCode: 'LJ', seedMark: "19' 10\"" },
    ];

    const audit = validateNfhsFourEventLimits(entries, 4);
    expect(audit[0].athleteName).toBe('Devon Carter');
    expect(audit[0].eventCount).toBe(5);
    expect(audit[0].overLimit).toBe(true);
    expect(audit.find((r) => r.athleteName === 'Liam Wu')?.overLimit).toBe(false);

    const heats = seedTrackHeats(entries, '100m', 8);
    expect(heats).toHaveLength(2);
    expect(heats.find((h) => h.athleteName === 'Devon Carter')?.lane).toBe(4); // Top seed gets preferred center lane 4

    const flights = seedFieldFlights(entries, 'LJ', 12);
    expect(flights).toHaveLength(2);
    expect(flights[0].athleteName).toBe('Liam Wu'); // Weakest seed goes first in standard flight order
    expect(flights[1].athleteName).toBe('Devon Carter'); // Top mark jumps last

    const csv = generateHyTekSemiColonEntryCsv({ teamName: 'WGHS', entries });
    expect(csv).toContain('Team;Athlete;Gender;GradYear;Event;Category;SeedMark');
    expect(csv).toContain("'=CMD() Athlete");
  });
});
