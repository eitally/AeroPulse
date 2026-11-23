import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import {
  findOrCreateUser,
  getUserByEmail,
  getUserById,
  getUserByProvider,
  hashAuthLookupKey,
  linkProviderToUser,
  unlinkProviderFromUser,
  updateUserPrimaryEmail,
} from '../server/authService.ts';
import {
  applyExternalTeamSyncBatch,
} from '../server/athleticSyncService.ts';
import { parseExternalTeamRoster } from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  graduateTeamClass,
  leaveOrGraduateTeam,
  mergeDuplicateRosterMembers,
  previewParentConsentToken,
  revokeAthleteGuardianConsentForTeam,
  transferTeamHeadCoachOwnership,
  updateMemberRole,
} from '../server/teamLifecycleService.ts';
import {
  SESSION_COOKIE_NAME,
  deriveStravaSessionSid,
  deriveUserSessionSid,
  issueSessionToken,
  setSessionCookie,
} from '../server/securityUtils.ts';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  loadTeamDocRaw,
  recordCoachStopwatchActivities,
  saveTeamDocRaw,
  syncAthleteSnapshotAcrossTeams,
  teamDocVaultKey,
  updateTeamBranding,
  updateTeamMemberEmailsForUser,
  userTeamsVaultKey,
} from '../server/teamService.ts';
import {
  loadTenantVaultAsync,
  saveTenantVaultAsync,
} from '../server/tokenVault.ts';
import type { AthleteCloudStateEnvelope, UnifiedActivity } from '../src/types.ts';

function makeMockActivity(id: string, overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id,
    name: `Mock Workout ${id}`,
    startDateLocal: new Date().toISOString(),
    distanceMeters: 5000,
    movingTimeSecs: 1200,
    elevationGainMeters: 20,
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    trainingLoad: 68,
    avgHr: 162,
    maxHr: 178,
    aerobicDecouplingPct: 1.5,
    efficiencyFactor: 1.44,
    firstHalfEf: 1.45,
    secondHalfEf: 1.43,
    zoneSecs: { hr: [0, 120, 180, 300, 300, 60, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: [],
    ...overrides,
  };
}

describe('LIFECYCLE · Identity, Team Departure, Age Compliance, RBAC & Concurrency', () => {
  const originalFetch = globalThis.fetch;
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: false }));
    app.use(apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_dummy_lifecycle';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.resend.com/emails')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `msg_${crypto.randomBytes(4).toString('hex')}` }),
        } as Response;
      }
      if (url.includes('strava.com/oauth/deauthorize') || url.includes('polarremote.com/v2/users')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    vi.restoreAllMocks();
  });

  it('preserves canonical usr_ identity, team memberships, and secondary tokens across Strava linking and provider unlinking', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const googleUser = await findOrCreateUser('google', `g_${tag}`, {
      email: `multi_${tag}@thresh.test`,
      name: 'Maya Runner',
    });
    const canonicalSid = deriveUserSessionSid(googleUser.id);
    const scopeKey = canonicalSid.slice(0, 24);

    // Join a team first and store secondary wearable tokens in canonical session vault
    const coachSid = `coach_multi_${tag}`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.test',
      name: `Bay Club ${tag}`,
      orgType: 'RUNNING_CLUB',
    });
    const joined = await claimTeamJoinInvite({
      callerSid: canonicalSid,
      originUrl: 'https://thresh.test',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Maya Runner',
      birthYear: 1998,
    });
    expect(joined.ok).toBe(true);

    await saveTenantVaultAsync(`session_${scopeKey}`, {
      intervalsAccessToken: 'int_tok_keep',
      wahooAccessToken: 'wahoo_tok_keep',
      polarAccessToken: 'polar_tok_keep',
    });

    // Linking Strava onto the canonical user must preserve usr_... subject in cookie
    const stravaAthId = `88${Math.floor(100000 + Math.random() * 899999)}`;
    await linkProviderToUser(googleUser.id, 'strava', stravaAthId, {
      name: 'Maya Runner',
    });
    const fakeReq = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${issueSessionToken(googleUser.id, canonicalSid)}`,
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as express.Request;
    const cookiesWritten: string[] = [];
    const fakeRes = {
      setHeader: (_k: string, v: string | string[]) => {
        if (Array.isArray(v)) cookiesWritten.push(...v);
        else cookiesWritten.push(v);
      },
      getHeader: () => cookiesWritten,
    } as unknown as express.Response;
    const mintedToken = setSessionCookie(fakeReq, fakeRes, stravaAthId, canonicalSid);
    expect(mintedToken).toBeTruthy();
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'x-session-token': mintedToken },
    }).then((r) => r.json());
    expect(meRes.authenticated).toBe(true);
    expect(meRes.user.id).toBe(googleUser.id);

    const sessionDoc = await loadTenantVaultAsync<Record<string, any> | null>(
      `session_${scopeKey}`,
      null
    );
    expect(sessionDoc?.intervalsAccessToken).toBe('int_tok_keep');
    expect(sessionDoc?.wahooAccessToken).toBe('wahoo_tok_keep');
    expect(sessionDoc?.polarAccessToken).toBe('polar_tok_keep');

    const myTeams = await listTeamsForUser(canonicalSid, 'https://thresh.test');
    expect(myTeams.some((t) => t.brand.teamId === team.brand.teamId)).toBe(true);

    // Unlinking Strava cleans up auth_prov_ lookup key so old provider won't re-login deleted link
    const unlinkRes = await unlinkProviderFromUser(googleUser.id, 'strava');
    expect(unlinkRes.ok).toBe(true);
    expect(await getUserByProvider('strava', stravaAthId)).toBeNull();
  });

  it('enforces COPPA <13 block, 13-17 non-school quarantine & GET-safe consent, 18+ graduation/adult transition, and TFRRS college adult default', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const origin = 'https://thresh.test';
    const currentYear = new Date().getFullYear();

    const hsTeam = await createTeamForCoach({
      callerSid: `coach_hs_${tag}`,
      originUrl: origin,
      name: `Lincoln HS ${tag}`,
      orgType: 'HIGH_SCHOOL',
    });
    const clubTeam = await createTeamForCoach({
      callerSid: `coach_club_${tag}`,
      originUrl: origin,
      name: `Youth Striders ${tag}`,
      orgType: 'RUNNING_CLUB',
    });
    const collegeTeam = await createTeamForCoach({
      callerSid: `coach_col_${tag}`,
      originUrl: origin,
      name: `Pacific College ${tag}`,
      orgType: 'COLLEGIATE',
    });

    // 1. Under-13 (COPPA) hard-blocked across both HS and private club
    const u13Attempt = await claimTeamJoinInvite({
      callerSid: `u13_${tag}`,
      originUrl: origin,
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Young Runner',
      birthYear: currentYear - 11,
      parentGuardianEmail: 'parent@family.test',
    });
    expect(u13Attempt.ok).toBe(false);
    expect(u13Attempt.error).toMatch(/13 or older|COPPA/i);

    // 2. Non-school 13-17 rejected without parent email, quarantined while PENDING, GET does NOT mutate!
    const clubMinorNoParent = await claimTeamJoinInvite({
      callerSid: `cminor_${tag}`,
      originUrl: origin,
      codeOrSlug: clubTeam.brand.joinCode,
      athleteName: 'Sam ClubMinor',
      birthYear: currentYear - 15,
    });
    expect(clubMinorNoParent.ok).toBe(false);

    const prevResend = process.env.RESEND_API_KEY;
    let consentToken = '';
    process.env.RESEND_API_KEY = 're_test_lifecycle_consent';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.resend.com/emails')) {
        const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
        const m = body.html?.match(/\/api\/teams\/parent-consent\?token=([A-Za-z0-9_-]+)/);
        if (m?.[1]) consentToken = m[1];
        return new Response(JSON.stringify({ id: 'em_lc_1' }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as any;

    let clubMinorJoin: Awaited<ReturnType<typeof claimTeamJoinInvite>>;
    try {
      clubMinorJoin = await claimTeamJoinInvite({
        callerSid: `cminor_${tag}`,
        originUrl: origin,
        codeOrSlug: clubTeam.brand.joinCode,
        athleteName: 'Sam ClubMinor',
        birthYear: currentYear - 15,
        parentGuardianEmail: 'guardian.sam@family.test',
      });
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      globalThis.fetch = originalFetch;
      if (prevResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResend;
    }
    expect(clubMinorJoin.ok).toBe(true);
    expect(
      clubMinorJoin.summary!.memberships.find((m) => m.userSid === `cminor_${tag}`)
        ?.parentConsentToken
    ).toBeUndefined();
    expect(consentToken).toBeTruthy();

    // Quarantined snapshot push while PENDING on non-school club
    await syncAthleteSnapshotAcrossTeams({
      callerSid: `cminor_${tag}`,
      originUrl: origin,
      snapshot: { readinessScore: 84, ctl: 42, atl: 39, tsb: 3, acuteLoad7d: 260 },
    });
    let clubDoc = await loadTeamDocRaw(clubTeam.brand.teamId);
    const pendingSnap = clubDoc?.memberships.find(
      (m) => m.userSid === `cminor_${tag}`
    )?.liveSnapshot;
    expect(pendingSnap?.verdictLabel).toBe('Awaiting Parent Consent');
    expect(pendingSnap?.readinessScore).toBe(0);
    expect(pendingSnap?.wellnessDays).toBeUndefined();
    expect(pendingSnap?.activities).toEqual([]);

    // GET /api/teams/parent-consent renders HTML preview WITHOUT approving!
    const getConsentRes = await fetch(
      `${baseUrl}/api/teams/parent-consent?token=${encodeURIComponent(consentToken)}`
    );
    expect(getConsentRes.status).toBe(200);
    const getHtml = await getConsentRes.text();
    expect(getHtml).toContain('Approve &amp; Acknowledge Safeguards');
    const previewStillPending = await previewParentConsentToken(consentToken);
    expect(previewStillPending.alreadyAcknowledged).toBe(false);

    // POST /api/teams/parent-consent APPROVE activates consent and allows sync
    const postApproveRes = await fetch(`${baseUrl}/api/teams/parent-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: consentToken, action: 'APPROVE' }).toString(),
    });
    expect(postApproveRes.status).toBe(200);
    await syncAthleteSnapshotAcrossTeams({
      callerSid: `cminor_${tag}`,
      originUrl: origin,
      snapshot: { readinessScore: 84, ctl: 42, atl: 39, tsb: 3, acuteLoad7d: 260 },
    });
    clubDoc = await loadTeamDocRaw(clubTeam.brand.teamId);
    expect(
      clubDoc?.memberships.find((m) => m.userSid === `cminor_${tag}`)?.liveSnapshot?.ctl
    ).toBe(42);

    // 3. Turning 18 on a High School team skips parent email requirement and lets athlete revoke legacy guardian CC
    const hsSeniorSid = `hssenior_${tag}`;
    const adultBirthMonthYear = `${currentYear - 19}-02`;
    const hsSeniorJoin = await claimTeamJoinInvite({
      callerSid: hsSeniorSid,
      originUrl: origin,
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Jordan Senior',
      birthMonthYear: adultBirthMonthYear,
    });
    expect(hsSeniorJoin.ok).toBe(true);
    const seniorMem = hsSeniorJoin.summary!.memberships.find(
      (m) => m.userSid === hsSeniorSid
    )!;
    expect(seniorMem.isMinorU18).toBe(false);
    expect(seniorMem.parentConsentStatus).toBe('NOT_REQUIRED');

    // 17-yr minor CANNOT bypass guardian consent by tampering birthMonthYear to an adult date
    const turning18Sid = `turn18_${tag}`;
    await claimTeamJoinInvite({
      callerSid: turning18Sid,
      originUrl: origin,
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Devon Turned18',
      birthYear: currentYear - 17,
      parentGuardianEmail: 'old.parent@family.test',
    });
    const blockedTamperRev = await revokeAthleteGuardianConsentForTeam({
      callerSid: turning18Sid,
      teamId: hsTeam.brand.teamId,
      originUrl: origin,
      birthMonthYear: adultBirthMonthYear,
    });
    expect(blockedTamperRev.ok).toBe(false);

    // Legacy minor whose stored birthYear has aged to 18+ can self-revoke guardian CC cleanly
    const hsDocPreAge = await loadTeamDocRaw(hsTeam.brand.teamId);
    const legacyMem = hsDocPreAge!.memberships.find((m) => m.userSid === turning18Sid)!;
    legacyMem.birthYear = currentYear - 19;
    delete legacyMem.birthMonthYear;
    await saveTeamDocRaw(hsTeam.brand.teamId, hsDocPreAge!);

    const revGuardian = await revokeAthleteGuardianConsentForTeam({
      callerSid: turning18Sid,
      teamId: hsTeam.brand.teamId,
      originUrl: origin,
      birthMonthYear: adultBirthMonthYear,
    });
    expect(revGuardian.ok).toBe(true);
    const revMem = revGuardian.summary!.memberships.find(
      (m) => m.userSid === turning18Sid
    )!;
    expect(revMem.isMinorU18).toBe(false);
    expect(revMem.parentGuardianEmail).toBeUndefined();

    // 4. High School July 15 post-graduation rollover auto-transitions to ALUMNI & halts sync
    const gradSid = `hsgrad_${tag}`;
    await claimTeamJoinInvite({
      callerSid: gradSid,
      originUrl: origin,
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Alum Runner',
      birthMonthYear: adultBirthMonthYear,
      graduationYear: currentYear - 1,
    });
    await syncAthleteSnapshotAcrossTeams({
      callerSid: gradSid,
      originUrl: origin,
      snapshot: { readinessScore: 90, ctl: 50, atl: 45, tsb: 5, acuteLoad7d: 300 },
    });
    const afterGradDoc = await loadTeamDocRaw(hsTeam.brand.teamId);
    const gradMem = afterGradDoc?.memberships.find((m) => m.userSid === gradSid)!;
    expect(gradMem.status).toBe('ALUMNI');
    expect(gradMem.liveSnapshot).toBeUndefined();

    // 5. Collegiate TFRRS roster parser + batch sync defaults isMinorU18 === false
    const parsedCollegeAthletes = parseExternalTeamRoster('Alex Collegiate', {
      orgType: 'COLLEGIATE',
      externalSource: 'TFRRS',
    });
    expect(parsedCollegeAthletes[0]?.isMinorU18).toBe(false);
    const tfrrsSync = await applyExternalTeamSyncBatch({
      callerSid: `coach_col_${tag}`,
      teamId: collegeTeam.brand.teamId,
      originUrl: origin,
      athletes: parsedCollegeAthletes,
    });
    expect(tfrrsSync.addedAthletes).toBe(1);
    const collegeDoc = await loadTeamDocRaw(collegeTeam.brand.teamId);
    expect(
      collegeDoc?.memberships.find((m) => m.invitedName === 'Alex Collegiate')?.isMinorU18
    ).toBe(false);
  });

  it('archives Stopwatch/FAT history into athlete vault on team departure, permanently erases account on DELETE, and handles Strava deauth webhooks', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const origin = 'https://thresh.test';
    const athUser = await findOrCreateUser('magic_link', `leave_${tag}@thresh.test`, {
      email: `leave_${tag}@thresh.test`,
      name: 'Taylor Departing',
    });
    const athSid = deriveUserSessionSid(athUser.id);
    const coachSid = `coach_leave_${tag}`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: `Departures HS ${tag}`,
      orgType: 'HIGH_SCHOOL',
    });
    const joinRes = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Taylor Departing',
      birthYear: 2005,
    });
    const memId = joinRes.summary!.memberships.find((m) => m.userSid === athSid)!.membershipId;

    // Seed personal cloud state + coach-recorded trackside workout + live snapshot
    await saveTenantVaultAsync<AthleteCloudStateEnvelope>(`athlete_state_user_${athUser.id}`, {
      version: 1,
      updatedAt: new Date().toISOString(),
      plannedEvents: [],
      targetGoals: [],
      annualMileageGoals: [],
      distanceUnit: 'mi',
    });
    const trackAct = makeMockActivity(`sw_keep_${tag}`, { name: 'Coach Timed 8x400m' });
    await recordCoachStopwatchActivities({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      entries: [{ membershipId: memId, activity: trackAct }],
    });
    await syncAthleteSnapshotAcrossTeams({
      callerSid: athSid,
      originUrl: origin,
      snapshot: { readinessScore: 88, ctl: 55, atl: 48, tsb: 7, acuteLoad7d: 310 },
    });

    // Athlete voluntarily leaves team while keeping their data
    const leaveRes = await leaveOrGraduateTeam({
      callerSid: athSid,
      userId: athUser.id,
      teamId: team.brand.teamId,
      mode: 'LEAVE',
      originUrl: origin,
    });
    expect(leaveRes.ok).toBe(true);

    const personalVault = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(
      `athlete_state_user_${athUser.id}`,
      null
    );
    expect(personalVault?.coachArchivedActivities?.map((a) => a.id)).toContain(`sw_keep_${tag}`);

    const teamAfterLeave = await loadTeamDocRaw(team.brand.teamId);
    const departedMem = teamAfterLeave?.memberships.find((m) => m.membershipId === memId)!;
    expect(departedMem.status).toBe('REVOKED');
    expect(departedMem.liveSnapshot).toBeUndefined();

    // Future snapshot sync does NOT repopulate former team
    await syncAthleteSnapshotAcrossTeams({
      callerSid: athSid,
      originUrl: origin,
      snapshot: { readinessScore: 70, ctl: 60, atl: 60, tsb: 0, acuteLoad7d: 390 },
    });
    const recheckTeam = await loadTeamDocRaw(team.brand.teamId);
    expect(
      recheckTeam?.memberships.find((m) => m.membershipId === memId)?.liveSnapshot
    ).toBeUndefined();

    // Full permanent account deletion via DELETE /api/auth/account
    const sessionTok = issueSessionToken(athUser.id, athSid);
    const delRes = await fetch(`${baseUrl}/api/auth/account?confirm=DELETE`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionTok,
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(delRes.status).toBe(200);
    expect(await getUserById(athUser.id)).toBeNull();
    expect(await getUserByEmail(`leave_${tag}@thresh.test`)).toBeNull();
    expect(
      await loadTenantVaultAsync(`athlete_state_user_${athUser.id}`, null)
    ).toBeNull();
    expect(await loadTenantVaultAsync(userTeamsVaultKey(athSid), null)).toBeNull();

    // Strava deauth webhook revokes tokens & clears /tmp archive + activity delete removes activity
    const stravaOwner = `9911${Math.floor(1000 + Math.random() * 8999)}`;
    const stravaScope = deriveStravaSessionSid(stravaOwner).slice(0, 24);
    await saveTenantVaultAsync(`session_${stravaScope}`, {
      stravaAccessToken: 'old_acc',
      stravaRefreshToken: 'old_ref',
      stravaExpiresAt: 1999999999,
      stravaAthleteId: stravaOwner,
    });
    const archivePath = `/tmp/aeropulse-strava-archive-${stravaOwner}.json`;
    fs.writeFileSync(
      archivePath,
      JSON.stringify([{ id: 'strava-act-1' }, { id: 'strava-act-2' }]),
      'utf8'
    );

    const actDelRes = await fetch(`${baseUrl}/api/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'activity',
        aspect_type: 'delete',
        object_id: 'strava-act-1',
        owner_id: stravaOwner,
      }),
    }).then((r) => r.json());
    expect(actDelRes.removedFromArchive).toBe(true);
    expect(JSON.parse(fs.readFileSync(archivePath, 'utf8')).length).toBe(1);

    const deauthRes = await fetch(`${baseUrl}/api/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'athlete',
        aspect_type: 'update',
        owner_id: stravaOwner,
        updates: { authorized: 'false' },
      }),
    }).then((r) => r.json());
    expect(deauthRes.handled).toBe('athlete-deauthorize');
    const wipedSession = await loadTenantVaultAsync<Record<string, any> | null>(
      `session_${stravaScope}`,
      null
    );
    expect(wipedSession?.stravaAccessToken).toBe('');
    expect(fs.existsSync(archivePath)).toBe(false);
  });

  it('supports email mobility, fuzzy Last, First claim & duplicate merge, staff RBAC/ownership transfer, and 25-athlete concurrent join stampede', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const origin = 'https://thresh.test';
    const coachSid = `coach_rbac_${tag}`;

    // 1. Primary email mobility (student .edu -> personal gmail)
    const studentUser = await findOrCreateUser('magic_link', `senior_${tag}@school.edu`, {
      email: `senior_${tag}@school.edu`,
      name: 'Lucas Alvarez',
    });
    const emailUpdate = await updateUserPrimaryEmail(studentUser.id, `lucas_${tag}@gmail.com`);
    expect(emailUpdate.ok).toBe(true);
    expect(await getUserByEmail(`senior_${tag}@school.edu`)).toBeNull();
    expect((await getUserByEmail(`lucas_${tag}@gmail.com`))?.id).toBe(studentUser.id);
    expect(hashAuthLookupKey(`lucas_${tag}@gmail.com`)).not.toBe('');

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: `Stampede Club ${tag}`,
      orgType: 'COLLEGIATE',
      coachDisplayName: 'Head Coach A',
    });
    await updateTeamMemberEmailsForUser({
      callerSid: deriveUserSessionSid(studentUser.id),
      newEmail: `lucas_${tag}@gmail.com`,
    });

    // 2. Fuzzy claim ("Alvarez, Lucas" -> "Lucas Alvarez") & Duplicate Merge
    await applyExternalTeamSyncBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      athletes: [
        {
          name: 'Alvarez, Lucas',
          squadGroup: 'Varsity',
          externalSource: 'ATHLETIC_NET',
          isMinorU18: false,
        },
      ],
    });
    const fuzzyJoin = await claimTeamJoinInvite({
      callerSid: deriveUserSessionSid(studentUser.id),
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Lucas Alvarez',
      birthYear: 2004,
    });
    expect(fuzzyJoin.ok).toBe(true);
    const claimedLucas = fuzzyJoin.summary!.memberships.filter(
      (m) => m.invitedName.toLowerCase().includes('alvarez') && m.status === 'ACTIVE'
    );
    expect(claimedLucas).toHaveLength(1);

    // Seed an extra INVITED row + merge into claimedLucas[0]
    const extraSync = await applyExternalTeamSyncBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      athletes: [
        {
          name: 'L. Alvarez Duplicate',
          squadGroup: 'Varsity',
          externalSource: 'ATHLETIC_NET',
          isMinorU18: false,
        },
      ],
    });
    expect(extraSync.addedAthletes).toBe(1);
    const ghostRow = extraSync.summary!.memberships.find(
      (m) => m.invitedName === 'L. Alvarez Duplicate'
    )!;
    await recordCoachStopwatchActivities({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      entries: [{ membershipId: ghostRow.membershipId, activity: makeMockActivity(`merge_${tag}`) }],
    });
    const mergedRes = await mergeDuplicateRosterMembers({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      sourceMembershipId: ghostRow.membershipId,
      targetMembershipId: claimedLucas[0].membershipId,
      originUrl: origin,
    });
    expect(mergedRes.ok).toBe(true);
    const updatedTarget = mergedRes.summary!.memberships.find(
      (m) => m.membershipId === claimedLucas[0].membershipId
    )!;
    expect(updatedTarget.coachRecordedActivities?.map((a) => a.id)).toContain(`merge_${tag}`);

    // 3. Assistant Coach RBAC restriction & Head Coach Ownership Transfer
    const assistantSid = deriveUserSessionSid(studentUser.id);
    const promoteRes = await updateMemberRole({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: claimedLucas[0].membershipId,
      role: 'ASSISTANT_COACH',
      originUrl: origin,
    });
    expect(promoteRes.ok).toBe(true);

    // Assistant cannot weaken Safe-Sport shield or promote/demote roles or graduate classes
    const weakened = await updateTeamBranding({
      callerSid: assistantSid,
      teamId: team.brand.teamId,
      originUrl: origin,
      updates: { orgType: 'RUNNING_CLUB', defaultSafeSportShield: false },
    });
    expect(weakened?.brand.orgType).toBe('COLLEGIATE');
    const roleBlocked = await updateMemberRole({
      callerSid: assistantSid,
      teamId: team.brand.teamId,
      membershipId: claimedLucas[0].membershipId,
      role: 'ATHLETE',
      originUrl: origin,
    });
    expect(roleBlocked.ok).toBe(false);
    const gradBlocked = await graduateTeamClass({
      callerSid: assistantSid,
      teamId: team.brand.teamId,
      graduationYear: 2026,
      originUrl: origin,
    });
    expect(gradBlocked.ok).toBe(false);

    // Transfer Head Coach ownership to assistant
    const xfer = await transferTeamHeadCoachOwnership({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      newHeadCoachMembershipId: claimedLucas[0].membershipId,
      originUrl: origin,
    });
    expect(xfer.ok).toBe(true);
    expect(
      xfer.summary!.memberships.find((m) => m.membershipId === claimedLucas[0].membershipId)?.role
    ).toBe('HEAD_COACH');

    // 4. 25-athlete concurrent locker-room join stampede (withVaultLock prevents lost updates)
    const stampedeTeam = await createTeamForCoach({
      callerSid: `coach_stampede_${tag}`,
      originUrl: origin,
      name: `Locker Room 25 ${tag}`,
      orgType: 'COLLEGIATE',
    });
    const joins = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        claimTeamJoinInvite({
          callerSid: `stampede_${tag}_${i}`,
          originUrl: origin,
          codeOrSlug: stampedeTeam.brand.joinCode,
          athleteName: `Runner ${i + 1}`,
          birthYear: 2003,
        })
      )
    );
    expect(joins.every((j) => j.ok)).toBe(true);
    const finalDoc = await loadTeamDocRaw(stampedeTeam.brand.teamId);
    const activeAthletes = (finalDoc?.memberships || []).filter(
      (m) => m.role === 'ATHLETE' && m.status === 'ACTIVE'
    );
    expect(activeAthletes).toHaveLength(25);
    expect(finalDoc && (await loadTenantVaultAsync(teamDocVaultKey(stampedeTeam.brand.teamId), null))).toBeTruthy();
  });
});
