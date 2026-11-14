import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseBulkRosterCsvOrText,
} from '../src/physiology/teamOnboardingEngine';
import {
  autoLinkPendingTeamInvitesByEmail,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  migrateAnonymousTeamsToSid,
  previewTeamJoinInvite,
} from '../server/teamService';
import {
  deriveUserSessionSid,
} from '../server/securityUtils';
import {
  findOrCreateUser,
} from '../server/authService';

describe('[ONB-02] CSV roster auto-match by athlete email (decoupled from Strava claim)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('keys on athlete email as primary identifier in CSV roster parse', () => {
    const csv = [
      'Email, Name, Squad, SeedMark, GradYear',
      'elena.rostova@varsity.org, Elena Rostova, Varsity Distance, 18:22 5K, 2027',
      'marcus.v@varsity.org, Marcus Vance, Frosh/Soph, 5:04 1600m, 2029',
    ].join('\n');

    const parsed = parseBulkRosterCsvOrText(csv, 'HIGH_SCHOOL', 'Varsity');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      invitedEmail: 'elena.rostova@varsity.org',
      invitedName: 'Elena Rostova',
      squadGroup: 'Varsity Distance',
      seedMarkOrFtp: '18:22 5K',
      graduationYear: 2027,
      isMinorU18: true,
    });
    expect(parsed[1]).toMatchObject({
      invitedEmail: 'marcus.v@varsity.org',
      invitedName: 'Marcus Vance',
      squadGroup: 'Frosh/Soph',
      seedMarkOrFtp: '5:04 1600m',
      graduationYear: 2029,
    });
  });

  it('generates magic join URLs that append &email= parameter for instant matching', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Eagle Cross Country',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    const bulkResult = await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      rawCsvOrText: 'chloe.kim@olympic.edu, Chloe Kim, Varsity, 17:45 5K',
      sendEmailsNow: false,
    });

    expect(bulkResult.addedCount).toBe(1);
    const athleteMem = bulkResult.summary?.memberships.find(
      (m) => m.invitedEmail === 'chloe.kim@olympic.edu'
    );
    expect(athleteMem).toBeDefined();
    expect(athleteMem?.magicJoinUrl).toBeDefined();
    expect(athleteMem?.magicJoinUrl).toContain('&email=chloe.kim%40olympic.edu');
    expect(athleteMem?.magicJoinUrl).toMatch(/\/join\/[a-z0-9-]+[?]t=[a-zA-Z0-9_-]+&email=/);
  });

  it('pre-fills roster slot when previewTeamJoinInvite is called with athlete email', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Cougar Distance Club',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      rawCsvOrText: 'samuel.o@cougar.org, Samuel Oak, Varsity Pod, 16:50 5K',
      sendEmailsNow: false,
    });

    // Preview without token, but passing athlete email
    const preview = await previewTeamJoinInvite(team.brand.slug, undefined, 'samuel.o@cougar.org');
    expect(preview.found).toBe(true);
    expect(preview.brand?.name).toBe('Cougar Distance Club');
    expect(preview.membership).toBeDefined();
    expect(preview.membership?.invitedName).toBe('Samuel Oak');
    expect(preview.membership?.invitedEmail).toBe('samuel.o@cougar.org');
    expect(preview.membership?.squadGroup).toBe('Varsity Pod');
    expect(preview.membership?.seedMarkOrFtp).toBe('16:50 5K');
  });

  it('automatically links pending invites upon user authentication by email without Strava', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const athleteEmail = `nora_${crypto.randomBytes(4).toString('hex')}@velo.club`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Metro Velo Squad',
      orgType: 'CYCLING_CLUB',
      primarySport: 'Cycling',
    });

    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      rawCsvOrText: `${athleteEmail}, Nora Watts, A Group / Race, 275W`,
      sendEmailsNow: false,
    });

    // Athlete creates or authenticates THRESH user (Google / Magic Link / Passkey)
    const user = await findOrCreateUser('magic_link', athleteEmail, {
      email: athleteEmail,
      name: 'Nora Watts',
    });

    const userSid = deriveUserSessionSid(user.id);
    expect(userSid).toHaveLength(32);

    // Call auto-link by email
    const linkedTeamIds = await autoLinkPendingTeamInvitesByEmail({
      email: user.email,
      userSid,
      athleteName: user.name,
    });

    expect(linkedTeamIds).toContain(team.brand.teamId);

    // User's team list now includes the team and the membership is active with calibrated FTP
    const athleteTeams = await listTeamsForUser(userSid, origin);
    expect(athleteTeams).toHaveLength(1);
    expect(athleteTeams[0].brand.name).toBe('Metro Velo Squad');
    expect(athleteTeams[0].mySquadGroup).toBe('A Group / Race');

    const mem = athleteTeams[0].memberships.find((m) => m.invitedEmail === athleteEmail);
    expect(mem).toBeDefined();
    expect(mem?.status).toBe('ACTIVE');
    expect(mem?.liveSnapshot?.ftpWatts).toBe(275);
    expect(mem?.liveSnapshot?.verdictLabel).toContain('Auto-Matched');
  });

  it('prioritizes email matching over strava ID while retaining Strava ID as secondary fallback', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Summit Striders',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    // Coach imports 2 roster rows: one with email, one with Strava fallback only
    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      rawCsvOrText: [
        'Email, Name, Squad, SeedMark',
        'sarah.k@summit.org, Sarah Kelly, Varsity, 19:15 5K',
      ].join('\n'),
      sendEmailsNow: false,
    });

    const athlete1Sid = `ath1_${crypto.randomBytes(8).toString('hex')}`;
    // Claim matching by email
    const claimRes1 = await claimTeamJoinInvite({
      callerSid: athlete1Sid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteEmail: 'sarah.k@summit.org',
      athleteName: 'Sarah Kelly',
      stravaAthleteId: 'strava_999999',
    });

    expect(claimRes1.ok).toBe(true);
    const updatedMem1 = claimRes1.summary?.memberships.find(
      (m) => m.invitedEmail === 'sarah.k@summit.org'
    );
    expect(updatedMem1?.status).toBe('ACTIVE');
    expect(updatedMem1?.squadGroup).toBe('Varsity');

    // Claim secondary fallback with Strava ID when email is absent
    const athlete2Sid = `ath2_${crypto.randomBytes(8).toString('hex')}`;
    const claimRes2 = await claimTeamJoinInvite({
      callerSid: athlete2Sid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Anonymous Rider',
      stravaAthleteId: 'strava_fallback_888',
      squadGroup: 'Frosh/Soph',
    });

    expect(claimRes2.ok).toBe(true);
    const updatedMem2 = claimRes2.summary?.memberships.find(
      (m) => m.stravaAthleteId === 'strava_fallback_888'
    );
    expect(updatedMem2?.status).toBe('ACTIVE');
  });

  it('does not duplicate memberships when auto-linking and claiming simultaneously', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Pioneer XC',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    const athleteEmail = `leo_${crypto.randomBytes(4).toString('hex')}@pioneer.edu`;
    await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      rawCsvOrText: `${athleteEmail}, Leo Dupont, Junior Varsity, 20:30 5K`,
      sendEmailsNow: false,
    });

    const user = await findOrCreateUser('dev_mock', athleteEmail, {
      email: athleteEmail,
      name: 'Leo Dupont',
    });
    const userSid = deriveUserSessionSid(user.id);

    // Auto link
    await autoLinkPendingTeamInvitesByEmail({
      email: user.email,
      userSid,
      athleteName: user.name,
    });

    // Athlete also clicks claim
    const claimRes = await claimTeamJoinInvite({
      callerSid: userSid,
      originUrl: origin,
      codeOrSlug: team.brand.slug,
      athleteEmail: user.email,
      athleteName: user.name,
    });

    expect(claimRes.ok).toBe(true);
    const teamMems = claimRes.summary?.memberships.filter(
      (m) => m.invitedEmail === athleteEmail
    );
    expect(teamMems).toHaveLength(1);
    expect(teamMems![0].status).toBe('ACTIVE');
  });

  it('migrates anonymous pre-auth teams onto deterministic user session SID', async () => {
    const anonSid = `anon_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    // Athlete joins team while anonymous
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Falcon Harriers',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    const anonClaim = await claimTeamJoinInvite({
      callerSid: anonSid,
      originUrl: origin,
      codeOrSlug: team.brand.slug,
      athleteName: 'Anonymous Falcon',
    });
    expect(anonClaim.ok).toBe(true);

    const anonTeams = await listTeamsForUser(anonSid, origin);
    expect(anonTeams).toHaveLength(1);

    // Athlete authenticates with Google/Magic link
    const uniqueEmail = `falcon_${crypto.randomBytes(4).toString('hex')}@harriers.org`;
    const uniqueSub = `google_falcon_${crypto.randomBytes(4).toString('hex')}`;
    const user = await findOrCreateUser('google', uniqueSub, {
      email: uniqueEmail,
      name: 'Falcon Runner',
    });
    const authSid = deriveUserSessionSid(user.id);

    await migrateAnonymousTeamsToSid({
      oldSid: anonSid,
      newSid: authSid,
      athleteName: user.name,
      email: user.email,
    });

    const authTeams = await listTeamsForUser(authSid, origin);
    expect(authTeams).toHaveLength(1);
    expect(authTeams[0].brand.name).toBe('Falcon Harriers');
    expect(authTeams[0].myRole).toBe('ATHLETE');
    expect(authTeams[0].myMembershipId).toBeDefined();
    expect(authTeams[0].memberships.find((m) => m.membershipId === authTeams[0].myMembershipId)?.invitedName).toBe('Falcon Runner');
  });
});
