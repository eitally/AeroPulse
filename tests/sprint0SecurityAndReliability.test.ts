import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import app from '../server/vercelApp.ts';
import { apiRouter } from '../server/apiRouter.ts';
import { resetEmailOtpRateLimitsForTesting } from '../server/routers/teamRouter.ts';
import {
  SESSION_COOKIE_NAME,
  decodeAndVerifyToken,
  isCanonicalAuthenticatedClaims,
  issueSessionToken,
  resolveTrustedRequestOrigin,
  setSessionCookie,
} from '../server/securityUtils.ts';
import {
  resolveIntervalsCallbackUrl,
  resolvePolarCallbackUrl,
  resolveStravaCallbackUrl,
  resolveWahooCallbackUrl,
} from '../server/oauthHelpers.ts';
import {
  appendAuditLogAsync,
  deleteTenantVault,
  encryptJsonForVault,
  findTeamIdsByInvitedEmailPostgresAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  setPostgresPoolForTesting,
  syncNormalizedTeamPostgresAsync,
  withTeamRowLock,
} from '../server/tokenVault.ts';
import {
  autoLinkPendingTeamInvitesByEmail,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import { postTeamMessage } from '../server/teamMessagingService.ts';
import { postTeamWorkoutComment } from '../server/teamWorkoutAndGovernanceService.ts';
import { postTeamAnnouncement } from '../server/teamFieldAndDailyOpsService.ts';
import {
  followTeamAsParentOrFan,
  getPublicTeamHubBySlugOrCode,
} from '../server/athleticSyncService.ts';
import { buildParentConsentEmailContent } from '../server/teamEmailAndOtpService.ts';
import { sendMagicLinkEmail } from '../server/authService.ts';
import { captureServerException, parseSentryDsn } from '../server/observability.ts';
import { setPushNotificationSenderForTest } from '../server/pushNotificationService.ts';

function extractCookiePairs(res: Response): Record<string, string> {
  const raw = res.headers.getSetCookie?.() || [];
  const fallback = res.headers.get('set-cookie');
  const list = raw.length > 0 ? raw : fallback ? [fallback] : [];
  const out: Record<string, string> = {};
  for (const item of list) {
    const first = item.split(';')[0] || '';
    const eq = first.indexOf('=');
    if (eq > 0) {
      out[first.slice(0, eq).trim()] = decodeURIComponent(first.slice(eq + 1).trim());
    }
  }
  return out;
}

describe('Sprint 0: Track A Security, SafeSport & Serverless Reliability P0s', () => {
  const originalFetch = globalThis.fetch;
  const origEnvSnapshot = { ...process.env };
  const createdTeamIds: string[] = [];
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const testApp = express();
    testApp.use(express.json({ limit: '2mb' }));
    testApp.use(apiRouter);
    testApp.get('/__test/boom', () => {
      throw new Error('Unhandled route failure with Bearer secret_abc_123');
    });

    await new Promise<void>((resolve) => {
      server = testApp.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetEmailOtpRateLimitsForTesting();
    setPostgresPoolForTesting(null);
    setPushNotificationSenderForTest(null);
    process.env.SESSION_SECRET = 'sprint0_test_session_secret_0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    setPostgresPoolForTesting(null);
    setPushNotificationSenderForTest(null);
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnvSnapshot)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(origEnvSnapshot)) {
      if (v !== undefined) process.env[k] = v;
    }
    while (createdTeamIds.length > 0) {
      const tid = createdTeamIds.pop();
      if (tid) await removeTeamFromDirectoryAndVault(tid).catch(() => undefined);
    }
  });

  describe('P0-1: Follow Auth Escalation, Non-Canonical Sessions & Prod Fail-Closed Secrets', () => {
    it('classifies anon_*, thresh-supporter, thresh-athlete, and explicit anon as non-canonical while preserving default verified for canonical subjects', () => {
      const supporterTok = issueSessionToken('thresh-supporter', 'a'.repeat(32));
      const athleteTok = issueSessionToken('thresh-athlete', 'b'.repeat(32));
      const anonPrefixTok = issueSessionToken('anon_supporter_12345678', 'c'.repeat(32));
      const explicitAnonTok = issueSessionToken('usr_123', 'd'.repeat(32), 'anon');
      const canonicalDefaultTok = issueSessionToken('usr_real_coach', 'e'.repeat(32));
      const deviceUserDefaultTok = issueSessionToken('Device User', 'f'.repeat(32));

      expect(decodeAndVerifyToken(supporterTok)?.authLevel).toBe('anon');
      expect(decodeAndVerifyToken(athleteTok)?.authLevel).toBe('anon');
      expect(decodeAndVerifyToken(anonPrefixTok)?.authLevel).toBe('anon');
      expect(decodeAndVerifyToken(explicitAnonTok)?.authLevel).toBe('anon');

      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(supporterTok))).toBe(false);
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(athleteTok))).toBe(false);
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(anonPrefixTok))).toBe(false);
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(explicitAnonTok))).toBe(false);

      expect(decodeAndVerifyToken(canonicalDefaultTok)?.authLevel).toBe('verified');
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(canonicalDefaultTok))).toBe(true);
      expect(decodeAndVerifyToken(deviceUserDefaultTok)?.authLevel).toBe('verified');
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(deviceUserDefaultTok))).toBe(true);
    });

    it('prevents setSessionCookie from silently upgrading an anon session unless authLevel === verified is explicit', () => {
      const anonSid = '1234567890abcdef1234567890abcdef';
      const anonTok = issueSessionToken('anon_guest_1', anonSid, 'anon');
      const fakeReq = {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(anonTok)}` },
        secure: false,
      } as unknown as Request;
      const headers = new Map<string, string | string[]>();
      const fakeRes = {
        getHeader: (name: string) => headers.get(name),
        setHeader: (name: string, val: string | string[]) => {
          headers.set(name, val);
        },
      } as unknown as express.Response;

      const silentRefresh = setSessionCookie(fakeReq, fakeRes, 'Attacker Name', anonSid);
      expect(decodeAndVerifyToken(silentRefresh)?.authLevel).toBe('anon');
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(silentRefresh))).toBe(false);

      const explicitUpgrade = setSessionCookie(fakeReq, fakeRes, 'usr_verified_1', anonSid, 'verified');
      expect(decodeAndVerifyToken(explicitUpgrade)?.authLevel).toBe('verified');
      expect(isCanonicalAuthenticatedClaims(decodeAndVerifyToken(explicitUpgrade))).toBe(true);
    });

    it('fails closed in getSessionSecret() when production is active, VITEST is unset, and no env secret exists', () => {
      const prevVitest = process.env.VITEST;
      const prevNodeEnv = process.env.NODE_ENV;
      delete process.env.VITEST;
      process.env.NODE_ENV = 'production';
      for (const k of [
        'SESSION_SECRET',
        'TOKEN_VAULT_KEY',
        'OAUTH_ENCRYPTION_KEY',
        'STRAVA_CLIENT_SECRET',
        'CRON_SECRET',
      ]) {
        delete process.env[k];
      }
      try {
        expect(() => issueSessionToken('usr_prod_test')).toThrow(/SESSION_SECRET|TOKEN_VAULT_KEY/i);
      } finally {
        if (prevVitest !== undefined) process.env.VITEST = prevVitest;
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      }
    });

    it('mints anon follow token on POST /api/teams/follow ignoring followerName escalation and blocks verified endpoints', async () => {
      const coachSid = `coach_p01_${crypto.randomBytes(6).toString('hex')}`;
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: baseUrl,
        name: 'Bayshore Harriers',
        orgType: 'HIGH_SCHOOL',
        externalSync: { enablePublicParentHub: true },
      });
      createdTeamIds.push(team.brand.teamId);

      const followRes = await originalFetch(`${baseUrl}/api/teams/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codeOrSlug: team.brand.slug,
          followerName: 'usr_forged_admin_escalator',
        }),
      });
      expect(followRes.status).toBe(200);
      const followJson = await followRes.json();
      expect(followJson.ok).toBe(true);
      expect(followJson.sessionToken).toBeTruthy();

      const followClaims = decodeAndVerifyToken(followJson.sessionToken);
      expect(followClaims?.sub).toMatch(/^anon_supporter_[a-f0-9]{8}$/);
      expect(followClaims?.authLevel).toBe('anon');
      expect(isCanonicalAuthenticatedClaims(followClaims)).toBe(false);

      const cookies = extractCookiePairs(followRes);
      const cookieHeader = `${SESSION_COOKIE_NAME}=${cookies[SESSION_COOKIE_NAME]}`;

      const createRes = await originalFetch(`${baseUrl}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({ name: 'Escalated Team' }),
      });
      expect(createRes.status).toBe(401);

      const syncCfgRes = await originalFetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/external-sync/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ config: { enablePublicParentHub: false } }),
        }
      );
      expect(syncCfgRes.status).toBe(401);

      const syncIcsRes = await originalFetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/external-sync/ics`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ icsText: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
        }
      );
      expect(syncIcsRes.status).toBe(401);

      const syncApplyRes = await originalFetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/external-sync/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ athletes: [] }),
        }
      );
      expect(syncApplyRes.status).toBe(401);

      const statusRes = await originalFetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/members/${team.myMembershipId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ status: 'REVOKED' }),
        }
      );
      expect(statusRes.status).toBe(401);

      const roleRes = await originalFetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/members/${team.myMembershipId}/role`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
          body: JSON.stringify({ role: 'HEAD_COACH' }),
        }
      );
      expect(roleRes.status).toBe(401);
    });

    it('rejects untrusted origin and forwarded host in resolveTrustedRequestOrigin during production', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'https://meetready.app';
      const spoofReq = {
        body: { origin: 'https://evil-phish.example.com' },
        query: {},
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'evil-host.example.com',
        },
        secure: true,
      } as unknown as Request;
      expect(resolveTrustedRequestOrigin(spoofReq)).toBe('https://meetready.app');
    });
  });

  describe('P0-2 & P0-3: SafeSport MAAPP, PARENT_FOLLOWER Isolation, Public Hub & Auto-Link', () => {
    it('enforces SafeSport channel allowlist, PARENT_FOLLOWER DM isolation, staff emergency gate, and projection redaction', async () => {
      const coachSid = `coach_p02_${crypto.randomBytes(6).toString('hex')}`;
      const athSid = `ath_p02_${crypto.randomBytes(6).toString('hex')}`;
      const unlinkedParentSid = `par_unlinked_${crypto.randomBytes(6).toString('hex')}`;
      const linkedParentSid = `par_linked_${crypto.randomBytes(6).toString('hex')}`;

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: 'Sierra Vista High XC',
        orgType: 'HIGH_SCHOOL',
        externalSync: {
          enablePublicParentHub: true,
          icsCalendarUrl: 'https://private.athletic.net/secret-feed.ics',
          teamFilterKeyword: 'Sierra Vista',
        },
      });
      createdTeamIds.push(team.brand.teamId);

      const currentYear = new Date().getFullYear();
      await bulkCreateAndSendInvites({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        rows: [
          {
            invitedName: 'Jordan Ramirez',
            invitedEmail: 'jordan@svhs.edu',
            parentGuardianEmail: 'Guardian.Ramirez@Family.Org',
            squadGroup: 'Varsity',
            isMinorU18: true,
          },
          {
            invitedName: 'Taylor Brooks',
            invitedEmail: 'taylor@svhs.edu',
            squadGroup: 'Varsity',
            isMinorU18: true,
          },
        ],
      });

      const joined = await claimTeamJoinInvite({
        callerSid: athSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Jordan Ramirez',
        athleteEmail: 'jordan@svhs.edu',
        birthYear: currentYear - 16,
        parentGuardianEmail: 'Guardian.Ramirez@Family.Org',
      });
      expect(joined.ok).toBe(true);
      const jordanMemId = joined.summary!.myMembershipId;

      // Seed an official race activity containing private polyline/map/description fields on stored doc
      const doc = (await loadTeamDocRaw(team.brand.teamId))!;
      const jordanRawMem = doc.memberships.find((m) => m.membershipId === jordanMemId)!;
      jordanRawMem.coachRecordedActivities = [
        {
          id: 'race_strip_1',
          startDateLocal: '2026-10-10T09:00:00',
          name: 'League Finals 5K',
          sportCategory: 'Running',
          environment: 'OUTDOOR',
          subType: 'XC',
          movingTimeSecs: 1020,
          distanceMeters: 5000,
          elevationGainMeters: 45,
          trainingLoad: 72,
          avgHr: 181,
          maxHr: 194,
          aerobicDecouplingPct: 1.5,
          efficiencyFactor: 1.5,
          firstHalfEf: 1.51,
          secondHalfEf: 1.49,
          zoneSecs: { hr: [0, 0, 100, 300, 620, 0, 0] },
          stravaPrCount: 0,
          summaryPolyline: 'secret_home_route_polyline',
          segmentEfforts: [],
          sourceBadges: ['MeetReady'],
          officialRaceData: {
            meetName: 'League Finals',
            eventLabel: '5000m XC',
            eventDistanceMeters: 5000,
            fatTimeSecs: 1020.4,
            displayFatTime: '17:00.40',
            vdotScore: 54,
            platform: 'ATHLETIC_NET',
            trackType: 'XC_COURSE',
          },
          map: { summary_polyline: 'secret_map_polyline' },
          description: 'Private athlete recovery notes',
        } as unknown as NonNullable<typeof jordanRawMem.coachRecordedActivities>[number],
      ];
      await saveTeamDocRaw(team.brand.teamId, doc);

      // Follow as unlinked fan and as linked parent (case-insensitive email match)
      await followTeamAsParentOrFan({
        callerSid: unlinkedParentSid,
        codeOrSlug: team.brand.slug,
        followerName: 'Community Supporter',
        originUrl: 'https://meetready.app',
      });
      await followTeamAsParentOrFan({
        callerSid: linkedParentSid,
        codeOrSlug: team.brand.slug,
        followerName: 'Parent Ramirez',
        verifiedEmail: 'guardian.ramirez@family.org',
        originUrl: 'https://meetready.app',
      });

      // Invalid channelScope -> 400
      const badScope = await postTeamMessage({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        channelScope: 'HIDDEN_BACKCHANNEL' as 'ALL_TEAM',
        body: 'Should reject',
        originUrl: 'https://meetready.app',
      });
      expect(badScope.ok).toBe(false);
      expect(badScope.status).toBe(400);

      // PARENT_FOLLOWER blocked with 403 on ALL_TEAM, EVENT_GROUP, COACHES_STAFF
      for (const scope of ['ALL_TEAM', 'EVENT_GROUP', 'COACHES_STAFF'] as const) {
        const res = await postTeamMessage({
          callerSid: unlinkedParentSid,
          teamId: team.brand.teamId,
          channelScope: scope,
          body: 'Parent attempt',
          originUrl: 'https://meetready.app',
        });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(403);
      }

      // Unlinked PARENT_FOLLOWER blocked with 403 on DIRECT_TRANSPARENT to any minor
      const unlinkedDm = await postTeamMessage({
        callerSid: unlinkedParentSid,
        teamId: team.brand.teamId,
        channelScope: 'DIRECT_TRANSPARENT',
        targetMembershipId: jordanMemId,
        body: 'Trying to DM unrelated minor',
        originUrl: 'https://meetready.app',
      });
      expect(unlinkedDm.ok).toBe(false);
      expect(unlinkedDm.status).toBe(403);

      // Linked PARENT_FOLLOWER blocked with 403 when targeting ANOTHER athlete
      const otherMem = doc.memberships.find((m) => m.invitedName === 'Taylor Brooks')!;
      const wrongChildDm = await postTeamMessage({
        callerSid: linkedParentSid,
        teamId: team.brand.teamId,
        channelScope: 'DIRECT_TRANSPARENT',
        targetMembershipId: otherMem.membershipId,
        body: 'Wrong child attempt',
        originUrl: 'https://meetready.app',
      });
      expect(wrongChildDm.ok).toBe(false);
      expect(wrongChildDm.status).toBe(403);

      // Linked PARENT_FOLLOWER succeeds on DIRECT_TRANSPARENT for their own linked child
      const ownChildDm = await postTeamMessage({
        callerSid: linkedParentSid,
        teamId: team.brand.teamId,
        channelScope: 'DIRECT_TRANSPARENT',
        targetMembershipId: jordanMemId,
        body: 'Jordan has dentist appointment after practice.',
        originUrl: 'https://meetready.app',
      });
      expect(ownChildDm.ok).toBe(true);

      // Non-staff athlete cannot spoof isEmergencyOverride
      const athMsg = await postTeamMessage({
        callerSid: athSid,
        teamId: team.brand.teamId,
        channelScope: 'ALL_TEAM',
        body: 'Good luck everyone!',
        clientLocalHour: 23,
        isEmergencyOverride: true,
        originUrl: 'https://meetready.app',
      });
      expect(athMsg.ok).toBe(true);
      expect(athMsg.message?.isEmergencyOverride).toBeUndefined();
      expect(athMsg.message?.sentDuringQuietHours).toBe(true);

      // Staff ALL_TEAM message is visible to PARENT_FOLLOWER, athlete ALL_TEAM message is NOT
      const coachMsg = await postTeamMessage({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        channelScope: 'ALL_TEAM',
        body: 'Bus leaves at 7:15 AM.',
        originUrl: 'https://meetready.app',
      });
      expect(coachMsg.ok).toBe(true);

      const latestDoc = (await loadTeamDocRaw(team.brand.teamId))!;
      const unlinkedProj = projectTeamSummaryForCaller(
        latestDoc,
        unlinkedParentSid,
        'https://meetready.app'
      )!;
      expect(unlinkedProj.brand.joinCode).toBe('');
      expect(unlinkedProj.brand.externalSync?.icsCalendarUrl).toBeUndefined();
      expect(unlinkedProj.brand.externalSync?.teamFilterKeyword).toBeUndefined();
      expect(unlinkedProj.teamMessages?.some((m) => m.id === coachMsg.message!.id)).toBe(true);
      expect(unlinkedProj.teamMessages?.some((m) => m.id === athMsg.message!.id)).toBe(false);

      // Unlinked non-external unconsented minors abbreviated ("Jordan R.", "Taylor B.")
      expect(unlinkedProj.memberships.map((m) => m.invitedName)).toContain('Jordan R.');
      expect(unlinkedProj.memberships.map((m) => m.invitedName)).toContain('Taylor B.');

      // officialPublicResults strips summaryPolyline, map, description
      const projectedJordan = unlinkedProj.memberships.find((m) => m.membershipId === jordanMemId)!;
      const raceAct = projectedJordan.coachRecordedActivities?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(raceAct.summaryPolyline).toBeUndefined();
      expect(raceAct.map).toBeUndefined();
      expect(raceAct.description).toBeUndefined();

      // Linked parent keeps full name for their linked child (even if unconsented) while abbreviating unlinked child
      const linkedProj = projectTeamSummaryForCaller(
        latestDoc,
        linkedParentSid,
        'https://meetready.app'
      )!;
      expect(linkedProj.memberships.map((m) => m.invitedName)).toContain('Jordan Ramirez');
      expect(linkedProj.memberships.map((m) => m.invitedName)).toContain('Taylor B.');

      // Public Hub removes joinCode, strips private externalSync fields, and abbreviates HS unconsented non-external minors
      const hub = await getPublicTeamHubBySlugOrCode(team.brand.slug);
      expect(hub.found).toBe(true);
      expect(hub.brand?.joinCode).toBeUndefined();
      expect(hub.brand?.externalSync?.icsCalendarUrl).toBeUndefined();
      expect(hub.brand?.externalSync?.teamFilterKeyword).toBeUndefined();
      expect(hub.rosterLeaderboard.map((r) => r.name)).toContain('Jordan R.');
      expect(hub.rosterLeaderboard.map((r) => r.name)).toContain('Taylor B.');
    });

    it('restricts tertiary name fallback to !invitedEmail and prevents autoLinkPendingTeamInvitesByEmail from hijacking ACTIVE rows', async () => {
      const coachSid = `coach_p03_${crypto.randomBytes(6).toString('hex')}`;
      const originalOwnerSid = `owner_${crypto.randomBytes(6).toString('hex')}`;
      const attackerSid = `attacker_${crypto.randomBytes(6).toString('hex')}`;

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: 'Oakwood Track',
        orgType: 'COLLEGIATE',
      });
      createdTeamIds.push(team.brand.teamId);

      await bulkCreateAndSendInvites({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        rows: [
          {
            invitedName: 'Maya Lin',
            invitedEmail: 'maya.lin@oakwood.edu',
            squadGroup: 'Varsity',
            isMinorU18: false,
          },
        ],
      });

      // Attacker knowing only athleteName='Maya Lin' (without email/token) cannot hijack email-bound invite via tertiary fallback
      const hijackAttempt = await claimTeamJoinInvite({
        callerSid: attackerSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Maya Lin',
        birthYear: 2003,
      });
      expect(hijackAttempt.ok).toBe(true);

      // Legitimate owner claims Maya Lin's invited row using her email
      const legitClaim = await claimTeamJoinInvite({
        callerSid: originalOwnerSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Maya Lin',
        athleteEmail: 'maya.lin@oakwood.edu',
        birthYear: 2003,
      });
      expect(legitClaim.ok).toBe(true);
      const mayaMem = legitClaim.summary!.memberships.find(
        (m) => m.invitedEmail === 'maya.lin@oakwood.edu'
      )!;
      expect(mayaMem.userSid).toBe(originalOwnerSid);

      // Subsequent autoLinkPendingTeamInvitesByEmail for a different userSid must NOT overwrite ACTIVE userSid
      const relinked = await autoLinkPendingTeamInvitesByEmail({
        email: 'maya.lin@oakwood.edu',
        userSid: attackerSid,
      });
      expect(relinked).toEqual([]);
      const afterDoc = (await loadTeamDocRaw(team.brand.teamId))!;
      const afterMaya = afterDoc.memberships.find((m) => m.membershipId === mayaMem.membershipId)!;
      expect(afterMaya.userSid).toBe(originalOwnerSid);

      // deferParentEmail: true flow stays intact on HIGH_SCHOOL team without dispatching email
      const hsTeam = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: 'Defer Consent HS',
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(hsTeam.brand.teamId);
      const deferredClaim = await claimTeamJoinInvite({
        callerSid: `minor_defer_${crypto.randomBytes(4).toString('hex')}`,
        originUrl: 'https://meetready.app',
        codeOrSlug: hsTeam.brand.joinCode,
        athleteName: 'Deferred Minor',
        birthYear: new Date().getFullYear() - 15,
        deferParentEmail: true,
      });
      expect(deferredClaim.ok).toBe(true);
      const deferredMem = deferredClaim.summary!.memberships.find(
        (m) => m.membershipId === deferredClaim.summary!.myMembershipId
      )!;
      expect(deferredMem.sharingTier).toBe('LOAD_ONLY');
      expect(deferredMem.parentConsentStatus).toBe('PENDING');
    });

    it('persists sanitized coachAttribution internally on POST /api/teams and coach eventGroups without exposing attribution to team summary', async () => {
      const coachSid = 'a'.repeat(32);
      const coachTok = issueSessionToken('usr_coach_attr', coachSid, 'verified');
      const res = await originalFetch(`${baseUrl}/api/teams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachTok}`,
        },
        body: JSON.stringify({
          name: 'Attribution Harriers',
          orgType: 'HIGH_SCHOOL',
          eventGroups: ['DISTANCE', 'MID_DISTANCE'],
          attribution: {
            utm_source: 'print',
            utm_medium: 'clipboard_qr',
            utm_campaign: 'pod_sheet',
            selfReportedChannel: 'Track clinic',
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      createdTeamIds.push(data.team.brand.teamId);

      // Coach summary must NOT expose server-internal coachAttribution, while preserving coachEventGroups
      expect(data.team.coachAttribution).toBeUndefined();
      expect(data.team.myCoachEventGroups).toEqual(['DISTANCE', 'MID_DISTANCE']);

      const storedDoc = await loadTeamDocRaw(data.team.brand.teamId);
      expect(storedDoc?.coachAttribution).toMatchObject({
        utm_source: 'print',
        utm_medium: 'clipboard_qr',
        utm_campaign: 'pod_sheet',
        selfReportedChannel: 'Track clinic',
      });
    });
  });

  describe('P0-4: Email/Push Awaited Outside Lock & Accurate guardianEmailNotified', () => {
    it('sets guardianEmailNotified strictly from actual Resend delivery outcome outside lock and awaits push dispatch', async () => {
      process.env.RESEND_API_KEY = 're_test_key_123';
      const coachSid = `coach_p04_${crypto.randomBytes(6).toString('hex')}`;
      const athSid = `ath_p04_${crypto.randomBytes(6).toString('hex')}`;
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: 'Pinehurst Track',
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);

      const currentYear = new Date().getFullYear();
      let consentEmailCalls = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://api.resend.com/emails') {
          consentEmailCalls += 1;
          return new Response(JSON.stringify({ error: 'rate limited' }), { status: 500 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch;

      const joined = await claimTeamJoinInvite({
        callerSid: athSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Sam Lee',
        birthYear: currentYear - 15,
        parentGuardianEmail: 'parent.lee@example.org',
      });
      expect(joined.ok).toBe(true);
      // Awaited synchronously before claimTeamJoinInvite returned
      expect(consentEmailCalls).toBe(1);

      // When Resend returns 500, guardianEmailNotified MUST be false
      const failedDm = await postTeamMessage({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        channelScope: 'DIRECT_TRANSPARENT',
        targetMembershipId: joined.summary!.myMembershipId,
        body: 'Bring spikes tomorrow.',
        originUrl: 'https://meetready.app',
      });
      expect(failedDm.ok).toBe(true);
      expect(failedDm.message?.guardianEmailNotified).toBe(false);

      // When Resend succeeds (200), guardianEmailNotified MUST be true
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://api.resend.com/emails') {
          return new Response(JSON.stringify({ id: 're_msg_ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch;

      const okDm = await postTeamMessage({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        channelScope: 'DIRECT_TRANSPARENT',
        targetMembershipId: joined.summary!.myMembershipId,
        body: 'Meet bus at 3 PM.',
        originUrl: 'https://meetready.app',
      });
      expect(okDm.ok).toBe(true);
      expect(okDm.message?.guardianEmailNotified).toBe(true);

      // Comment & Announcement await outside lock cleanly
      const cmtRes = await postTeamWorkoutComment({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        targetMembershipId: joined.summary!.myMembershipId,
        body: 'Smooth tempo splits!',
        originUrl: 'https://meetready.app',
      });
      expect(cmtRes.ok).toBe(true);

      const annRes = await postTeamAnnouncement({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        title: 'Track Open',
        body: 'Gates open at 3:30 PM.',
        originUrl: 'https://meetready.app',
      });
      expect(annRes.ok).toBe(true);
    });
  });

  describe('P0-5: Vault Fail-Closed Key, Tx Client Reuse, Confirmed Miss Purge & Error Propagation', () => {
    it('fails closed in getVaultEncryptionKey() when production is active, VITEST is unset, and no env key exists', () => {
      const prevVitest = process.env.VITEST;
      const prevNodeEnv = process.env.NODE_ENV;
      delete process.env.VITEST;
      process.env.NODE_ENV = 'production';
      for (const k of [
        'TOKEN_VAULT_KEY',
        'OAUTH_ENCRYPTION_KEY',
        'SESSION_SECRET',
        'STRAVA_CLIENT_SECRET',
        'CRON_SECRET',
      ]) {
        delete process.env[k];
      }
      try {
        expect(() => encryptJsonForVault({ hello: 'world' })).toThrow(
          /TOKEN_VAULT_KEY|SESSION_SECRET/i
        );
      } finally {
        if (prevVitest !== undefined) process.env.VITEST = prevVitest;
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
      }
    });

    it('reuses a single tx client inside withTeamRowLock, purges stale /tmp on confirmed PG miss, batches UNNEST, and propagates write/delete errors', async () => {
      const vaultRows = new Map<string, string>();
      const memberRows = new Map<string, { team_id: string; invited_email: string | null; status: string }>();
      const txQueries: string[] = [];
      let poolConnectCalls = 0;
      let poolQueryCallsDuringTx = 0;
      let inTx = false;
      let failWrites = false;

      const createClient = (): pg.PoolClient =>
        ({
          query: vi.fn(async (sql: string, params?: unknown[]) => {
            const trimmed = sql.trim();
            txQueries.push(trimmed);
            if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
              return { rows: [] };
            }
            if (trimmed.startsWith('SET LOCAL lock_timeout')) {
              return { rows: [] };
            }
            if (trimmed.startsWith('SELECT pg_advisory_xact_lock')) {
              return { rows: [{ pg_advisory_xact_lock: '' }] };
            }
            if (trimmed.startsWith('SAVEPOINT') || trimmed.startsWith('RELEASE SAVEPOINT') || trimmed.startsWith('ROLLBACK TO SAVEPOINT')) {
              return { rows: [] };
            }
            if (trimmed.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
              const id = String(params?.[0] || '');
              const env = vaultRows.get(id);
              return { rows: env ? [{ encrypted_envelope: env }] : [] };
            }
            if (trimmed.startsWith('INSERT INTO thresh_tenant_vault')) {
              if (failWrites) throw new Error('Simulated PG write outage');
              vaultRows.set(String(params?.[0] || ''), String(params?.[1] || ''));
              return { rows: [] };
            }
            if (trimmed.startsWith('DELETE FROM thresh_tenant_vault')) {
              if (failWrites) throw new Error('Simulated PG delete outage');
              vaultRows.delete(String(params?.[0] || ''));
              return { rows: [] };
            }
            if (trimmed.startsWith('INSERT INTO thresh_teams')) {
              return { rows: [] };
            }
            if (trimmed.startsWith('DELETE FROM thresh_team_members')) {
              return { rows: [] };
            }
            if (trimmed.includes('FROM UNNEST')) {
              const tIds = (params?.[0] as string[]) || [];
              const mIds = (params?.[1] as string[]) || [];
              const emails = (params?.[3] as Array<string | null>) || [];
              const statuses = (params?.[5] as string[]) || [];
              for (let i = 0; i < tIds.length; i++) {
                memberRows.set(`${tIds[i]}:${mIds[i]}`, {
                  team_id: tIds[i],
                  invited_email: emails[i] || null,
                  status: statuses[i],
                });
              }
              return { rows: [] };
            }
            if (trimmed.startsWith('INSERT INTO thresh_audit_log')) {
              return { rows: [] };
            }
            return { rows: [] };
          }),
          release: vi.fn(),
        }) as unknown as pg.PoolClient;

      const mockPool = {
        on: vi.fn(),
        connect: vi.fn(async () => {
          poolConnectCalls += 1;
          if (inTx) {
            throw new Error('Deadlock: attempted second pool.connect() inside active tx!');
          }
          return createClient();
        }),
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (inTx) {
            poolQueryCallsDuringTx += 1;
            throw new Error(`Deadlock: attempted pool.query(${sql}) inside active tx!`);
          }
          if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
          if (sql.startsWith('SELECT 1')) return { rows: [{ '?column?': 1 }] };
          if (sql.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
            const env = vaultRows.get(String(params?.[0] || ''));
            return { rows: env ? [{ encrypted_envelope: env }] : [] };
          }
          if (sql.startsWith('INSERT INTO thresh_tenant_vault')) {
            if (failWrites) throw new Error('Simulated PG write outage');
            vaultRows.set(String(params?.[0] || ''), String(params?.[1] || ''));
            return { rows: [] };
          }
          if (sql.startsWith('DELETE FROM thresh_tenant_vault')) {
            if (failWrites) throw new Error('Simulated PG delete outage');
            vaultRows.delete(String(params?.[0] || ''));
            return { rows: [] };
          }
          if (sql.includes('FROM thresh_team_members')) {
            const email = String(params?.[0] || '');
            const matched = Array.from(memberRows.values())
              .filter(
                (r) =>
                  r.invited_email === email &&
                  (r.status === 'INVITED' || r.status === 'OPENED')
              )
              .map((r) => ({ team_id: r.team_id }));
            return { rows: matched };
          }
          return { rows: [] };
        }),
      } as unknown as pg.Pool;

      setPostgresPoolForTesting(mockPool);

      // 1. Confirmed PG miss purges stale /tmp file and memory cache (no resurrection!)
      const tenantKey = `miss_purge_${Date.now()}`;
      await saveTenantVaultAsync(tenantKey, { secret: 'resurrect_me_not' });
      const tmpPath = `/tmp/thresh-vault-${tenantKey}.enc`;
      expect(fs.existsSync(tmpPath)).toBe(true);
      // Simulate deletion from Postgres by another Lambda while local /tmp + memory cache still exist
      vaultRows.delete(tenantKey);
      const afterDeleteRead = await loadTenantVaultAsync(tenantKey, null);
      expect(afterDeleteRead).toBeNull();
      expect(fs.existsSync(tmpPath)).toBe(false);

      // 2. withTeamRowLock reuses single client (zero pool queries or 2nd connect inside tx) + UNNEST + SAVEPOINT + lock_timeout
      const teamId = `tm_tx_${crypto.randomBytes(4).toString('hex')}`;
      await withTeamRowLock(teamId, async () => {
        inTx = true;
        try {
          await loadTenantVaultAsync(`team_doc_${teamId}`, null);
          await saveTenantVaultAsync(`team_doc_${teamId}`, { ok: true });
          await syncNormalizedTeamPostgresAsync(
            teamId,
            { slug: 'tx-team', joinCode: 'TX-26', orgType: 'HIGH_SCHOOL' },
            { brand: { teamId } },
            [
              {
                membershipId: 'mem_1',
                invitedEmail: 'invitee@tx.edu',
                role: 'ATHLETE',
                status: 'INVITED',
              },
              {
                membershipId: 'mem_2',
                invitedEmail: 'active@tx.edu',
                role: 'ATHLETE',
                status: 'ACTIVE',
              },
            ]
          );
          await appendAuditLogAsync({
            teamId,
            actorSid: 'actor_1',
            action: 'TX_TEST',
          });
        } finally {
          inTx = false;
        }
      });

      expect(poolConnectCalls).toBe(1);
      expect(poolQueryCallsDuringTx).toBe(0);
      expect(txQueries.some((q) => q.includes("SET LOCAL lock_timeout = '4000ms'"))).toBe(true);
      expect(txQueries.some((q) => q === 'SAVEPOINT sync_norm_team')).toBe(true);
      expect(txQueries.some((q) => q.includes('FROM UNNEST'))).toBe(true);
      expect(txQueries.some((q) => q === 'RELEASE SAVEPOINT sync_norm_team')).toBe(true);

      // 3. findTeamIdsByInvitedEmailPostgresAsync finds pending INVITED/OPENED rows cleanly
      const foundIds = await findTeamIdsByInvitedEmailPostgresAsync('invitee@tx.edu');
      expect(foundIds).toEqual([teamId]);
      expect(await findTeamIdsByInvitedEmailPostgresAsync('active@tx.edu')).toEqual([]);

      // 4. Write & delete error propagation
      failWrites = true;
      await expect(saveTenantVaultAsync(tenantKey, { a: 1 })).rejects.toThrow(/Simulated PG write/);
      await expect(deleteTenantVault(tenantKey)).rejects.toThrow(/Simulated PG delete/);
      failWrites = false;

      // 5. withTeamRowLock throws cleanly if pool.connect fails instead of bypassing lock
      (mockPool.connect as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Pool exhausted')
      );
      await expect(withTeamRowLock(teamId, async () => 'bypassed')).rejects.toThrow(/Pool exhausted/);
    });
  });

  describe('P0-6: OTP Rate Limiting, Canonical Session, Consent HTML Escape & Resend Timeout', () => {
    it('enforces 429 rate limit on /api/auth/email/send-otp and prevents session fixation on /verify-otp', async () => {
      const rateEmail = `otp_rl_${Date.now()}@meetready.test`;
      let got429 = false;
      for (let i = 0; i < 8; i++) {
        const resp = await originalFetch(`${baseUrl}/api/auth/email/send-otp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-vercel-forwarded-for': '198.51.100.55',
          },
          body: JSON.stringify({ email: rateEmail }),
        });
        if (resp.status === 429) {
          got429 = true;
          break;
        }
      }
      expect(got429).toBe(true);

      // Verify OTP from an anon session MUST NOT inherit the attacker's anon sid (session fixation)
      const victimEmail = `otp_fix_${Date.now()}@meetready.test`;
      const sendResp = await originalFetch(`${baseUrl}/api/auth/email/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-forwarded-for': '198.51.100.56',
        },
        body: JSON.stringify({ email: victimEmail }),
      });
      expect(sendResp.status).toBe(200);
      const sendData = await sendResp.json();
      expect(sendData.devPreviewCode).toMatch(/^\d{6}$/);

      const attackerAnonSid = 'f'.repeat(32);
      const attackerAnonToken = issueSessionToken('anon_attacker', attackerAnonSid, 'anon');
      const verifyResp = await originalFetch(`${baseUrl}/api/auth/email/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-forwarded-for': '198.51.100.56',
          Cookie: `${SESSION_COOKIE_NAME}=${attackerAnonToken}`,
        },
        body: JSON.stringify({ email: victimEmail, code: sendData.devPreviewCode }),
      });
      expect(verifyResp.status).toBe(200);
      const verifyData = await verifyResp.json();
      expect(verifyData.sessionToken).toBeUndefined();
      const setCookies =
        verifyResp.headers.getSetCookie?.() || [verifyResp.headers.get('set-cookie') || ''];
      const sessionCookieEntry = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      expect(sessionCookieEntry).toBeTruthy();
      expect(sessionCookieEntry).toMatch(/HttpOnly/i);
      const mintedCookieToken = sessionCookieEntry!.split(';')[0]!.slice(`${SESSION_COOKIE_NAME}=`.length);
      const verifiedClaims = decodeAndVerifyToken(decodeURIComponent(mintedCookieToken));
      expect(verifiedClaims?.sid).toBeTruthy();
      expect(verifiedClaims?.sid).not.toBe(attackerAnonSid);
      expect(verifiedClaims?.sub).toMatch(/^usr_/);
      expect(verifiedClaims?.authLevel).toBe('verified');
      expect(isCanonicalAuthenticatedClaims(verifiedClaims)).toBe(true);

      // Verify OTP endpoint also enforces 429 rate limiting
      let verify429 = false;
      const rlVerifyEmail = `otp_vrl_${Date.now()}@meetready.test`;
      for (let i = 0; i < 14; i++) {
        const vResp = await originalFetch(`${baseUrl}/api/auth/email/verify-otp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-vercel-forwarded-for': '198.51.100.77',
          },
          body: JSON.stringify({ email: rlVerifyEmail, code: '123456' }),
        });
        if (vResp.status === 429) {
          verify429 = true;
          break;
        }
      }
      expect(verify429).toBe(true);
    });

    it('escapes parentConsentUrl and sanitizes brand.primaryHex in buildParentConsentEmailContent and unifies Resend sender with timeout', async () => {
      const content = buildParentConsentEmailContent({
        brand: {
          teamId: 'tm_1',
          slug: 'test-team',
          joinCode: 'TEST-26',
          name: 'Test <Script> High',
          shortName: 'TEST',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: 'red;background:url(https://evil.test)',
          secondaryHex: '#D97706',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach',
          createdAt: new Date().toISOString(),
        },
        athleteName: 'Alex Runner',
        parentConsentUrl: 'https://meetready.app/api/teams/parent-consent?token=abc"><script>alert(1)</script>',
      });
      expect(content.html).not.toContain('url(https://evil.test)');
      expect(content.html).not.toContain('<script>alert(1)</script>');
      expect(content.html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');

      process.env.RESEND_API_KEY = 're_test_magic';
      process.env.RESEND_FROM_EMAIL = 'Unified Sender <noreply@meetready.app>';
      delete process.env.AUTH_EMAIL_FROM;
      let capturedFrom = '';
      let hadSignal = false;
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}')) as { from?: string };
        capturedFrom = body.from || '';
        hadSignal = Boolean(init?.signal);
        return new Response(JSON.stringify({ id: 're_magic_ok' }), { status: 200 });
      }) as typeof fetch;

      const magicRes = await sendMagicLinkEmail('coach@school.edu', 'https://meetready.app/verify?t=1');
      expect(magicRes.sent).toBe(true);
      expect(capturedFrom).toBe('Unified Sender <noreply@meetready.app>');
      expect(hadSignal).toBe(true);
    });
  });

  describe('P0-7: OAuth Origin & Host Injection Protection', () => {
    it('blocks untrusted origin query and x-forwarded-host in production OAuth callback URL helpers', () => {
      process.env.NODE_ENV = 'production';
      process.env.APP_URL = 'https://meetready.app';
      delete process.env.STRAVA_REDIRECT_URI;
      delete process.env.INTERVALS_REDIRECT_URI;
      delete process.env.WAHOO_REDIRECT_URI;
      delete process.env.POLAR_REDIRECT_URI;

      const attackerReq = {
        query: { origin: 'https://phish.attacker.invalid' },
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'phish-host.attacker.invalid',
          host: 'phish-host.attacker.invalid',
        },
        protocol: 'https',
        secure: true,
      } as unknown as Request;

      expect(resolveStravaCallbackUrl(attackerReq)).toBe('https://meetready.app/auth/strava/callback');
      expect(resolveIntervalsCallbackUrl(attackerReq)).toBe(
        'https://meetready.app/auth/intervals/callback'
      );
      expect(resolveWahooCallbackUrl(attackerReq)).toBe('https://meetready.app/auth/wahoo/callback');
      expect(resolvePolarCallbackUrl(attackerReq)).toBe('https://meetready.app/auth/polar/callback');

      // Trusted origin still works in production
      const trustedReq = {
        query: { origin: 'https://thresh-dev.vercel.app' },
        headers: { host: 'thresh-dev.vercel.app' },
        protocol: 'https',
        secure: true,
      } as unknown as Request;
      expect(resolveStravaCallbackUrl(trustedReq)).toBe(
        'https://thresh-dev.vercel.app/auth/strava/callback'
      );
    });
  });

  describe('P0-8: Security Headers, /api/health, JSON Error Handler, Observability & Vanity Redirects', () => {
    it('emits HSTS on HTTPS and strict CSP on /api/* JSON vs callback-compatible CSP on HTML auth/consent endpoints', async () => {
      const apiRes = await originalFetch(`${baseUrl}/api/health`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(apiRes.status).toBe(200);
      expect(apiRes.headers.get('strict-transport-security')).toContain('max-age=63072000');
      expect(apiRes.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      );
      const healthBody = await apiRes.json();
      expect(healthBody).toMatchObject({
        ok: true,
        status: 'ok',
        storageBackend: 'ENCRYPTED_FILE',
        databaseConfigured: false,
        databaseHealthy: null,
      });
      expect(typeof healthBody.timestamp).toBe('string');

      const consentRes = await originalFetch(`${baseUrl}/api/teams/parent-consent?token=invalid`);
      expect(consentRes.status).toBe(400);
      const consentCsp = consentRes.headers.get('content-security-policy') || '';
      expect(consentCsp).toContain("script-src 'self' 'unsafe-inline'");
      expect(consentCsp).toContain("form-action 'self'");
      expect(consentCsp).toContain("frame-ancestors 'none'");

      const stravaCbRes = await originalFetch(`${baseUrl}/auth/strava/callback`);
      expect(stravaCbRes.status).toBe(400);
      expect(stravaCbRes.headers.get('content-security-policy')).toContain(
        "script-src 'self' 'unsafe-inline'"
      );
    });

    it('reports degraded 503 on /api/health when Postgres query fails and handles vercelApp JSON errors with observability', async () => {
      const unhealthyPool = {
        on: vi.fn(),
        query: vi.fn(async () => {
          throw new Error('DB connection refused');
        }),
      } as unknown as pg.Pool;
      setPostgresPoolForTesting(unhealthyPool);

      const degradedRes = await originalFetch(`${baseUrl}/api/health`);
      expect(degradedRes.status).toBe(503);
      const degradedBody = await degradedRes.json();
      expect(degradedBody).toMatchObject({
        ok: false,
        status: 'degraded',
        databaseConfigured: true,
        databaseHealthy: false,
      });
      setPostgresPoolForTesting(null);

      // Test Sentry DSN parsing + captureServerException redaction & bounded forwarding
      const parsedDsn = parseSentryDsn('https://pubKey123@o456.ingest.sentry.io/789');
      expect(parsedDsn).toEqual({
        storeUrl: 'https://o456.ingest.sentry.io/api/789/store/',
        publicKey: 'pubKey123',
        projectId: '789',
      });

      process.env.SENTRY_DSN = 'https://pubKey123@o456.ingest.sentry.io/789';
      let sentryPayload: Record<string, unknown> | null = null;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('ingest.sentry.io/api/789/store/')) {
          sentryPayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
          return new Response(JSON.stringify({ id: 'evt_1' }), { status: 200 });
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      await captureServerException(new Error('Failed with Bearer top_secret_jwt_123'), {
        scope: 'test-error',
        method: 'GET',
        path: '/api/test?token=secret_query_val',
        statusCode: 500,
      });
      expect(sentryPayload).not.toBeNull();
      expect(JSON.stringify(sentryPayload)).not.toContain('top_secret_jwt_123');
      expect(JSON.stringify(sentryPayload)).not.toContain('secret_query_val');

      // Test vercelApp 4-arg JSON error handler on malformed JSON body
      const vercelSrv = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => vercelSrv.once('listening', resolve));
      const addr = vercelSrv.address();
      const vPort = typeof addr === 'object' && addr ? addr.port : 0;
      try {
        const badJsonRes = await originalFetch(`http://127.0.0.1:${vPort}/api/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{invalid_json',
        });
        expect(badJsonRes.status).toBe(400);
        const badJsonBody = await badJsonRes.json();
        expect(badJsonBody.ok).toBe(false);
        expect(typeof badJsonBody.error).toBe('string');
      } finally {
        await new Promise<void>((resolve) => vercelSrv.close(() => resolve()));
      }
    });

    it('aligns server.ts vanityRedirects and 4-arg JSON error handler', () => {
      const serverTs = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
      expect(serverTs).toContain(
        "'/demo': '/?demo=1&sample=coach&utm_source=print&utm_medium=qr&utm_campaign=demo#coach'"
      );
      expect(serverTs).toContain(
        "'/meet': '/?demo=1&sample=coach&utm_source=print&utm_medium=banner&utm_campaign=meet_day#coach'"
      );
      expect(serverTs).toContain(
        "'/go/clipboard': '/?demo=1&sample=coach&utm_source=print&utm_medium=clipboard_qr&utm_campaign=pod_sheet#coach'"
      );
      expect(serverTs).toContain(
        "'/sticker': '/?demo=1&sample=coach&utm_source=print&utm_medium=sticker&utm_campaign=varsity_crest#coach'"
      );
      expect(serverTs).toContain(
        "'/tee': '/?demo=1&sample=coach&utm_source=print&utm_medium=tee&utm_campaign=coach_tee#coach'"
      );
      expect(serverTs).toContain('captureServerException');
    });
  });

  describe.skipIf(!process.env.DATABASE_URL)('Postgres Integration (Live DATABASE_URL)', () => {
    it('creates indexes, executes concurrent withTeamRowLock + UNNEST without deadlock, and never resurrects deleted rows', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const vaultKey = `pg_live_vault_${tag}`;
      await saveTenantVaultAsync(vaultKey, { hello: 'pg', tag });
      expect(await loadTenantVaultAsync<{ hello: string } | null>(vaultKey, null)).toEqual({
        hello: 'pg',
        tag,
      });

      await deleteTenantVault(vaultKey);
      expect(await loadTenantVaultAsync(vaultKey, null)).toBeNull();

      const coachSid = `pg_coach_${tag}`;
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `PG Integration ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);

      const invitedEmail = `pg_athlete_${tag}@school.edu`;
      await bulkCreateAndSendInvites({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        rows: [
          {
            invitedName: 'PG Runner',
            invitedEmail,
            squadGroup: 'Varsity',
            isMinorU18: true,
          },
        ],
        sendEmailsNow: false,
      });

      const pgTeams = await findTeamIdsByInvitedEmailPostgresAsync(invitedEmail);
      expect(pgTeams).toContain(team.brand.teamId);

      // Run 8 parallel withTeamRowLock operations (exceeding pool max: 5) to verify zero deadlock
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, idx) =>
          withTeamRowLock(team.brand.teamId, async () => {
            const loaded = await loadTeamDocRaw(team.brand.teamId);
            expect(loaded).not.toBeNull();
            return idx;
          })
        )
      );
      expect(results).toHaveLength(8);

      const healthRes = await originalFetch(`${baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson).toMatchObject({
        ok: true,
        storageBackend: 'POSTGRES',
        databaseConfigured: true,
        databaseHealthy: true,
      });
    });
  });
});
