import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter, resetAiRateLimitsForTesting } from '../server/apiRouter.ts';
import {
  findOrCreateUser,
  getUserByEmail,
  getUserById,
  updateUserBirthMonthYear,
} from '../server/authService.ts';
import { validateCoppaAgeInput } from '../server/coppaGuard.ts';
import {
  checkDistributedRateLimitAsync,
  resetRateLimitsForTesting,
} from '../server/rateLimiter.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  createTeamForCoach,
  claimTeamJoinInvite,
  loadTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
} from '../server/teamService.ts';
import { resetEmailOtpRateLimitsForTesting } from '../server/routers/teamRouter.ts';
import {
  recordTeamAttendanceBatch,
  recordTeamFieldMarks,
  teamFieldLogsVaultKey,
} from '../server/teamFieldAndDailyOpsService.ts';
import {
  declineAndPurgeParentConsent,
  removeTeamFromDirectoryAndVault,
} from '../server/teamLifecycleService.ts';
import {
  listTeamAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  setPostgresPoolForTesting,
} from '../server/tokenVault.ts';
import { postTeamMessage } from '../server/teamMessagingService.ts';
import {
  postTeamWorkoutComment,
  recordGuardianSafetyAlert,
} from '../server/teamWorkoutAndGovernanceService.ts';
import {
  clearSessionActiveHint,
  hasSessionActiveHint,
  markSessionActiveHint,
} from '../src/utils/sessionHint.ts';
import { buildThreshSessionHeaders } from '../src/utils/teamLifecycleApi.ts';
import { getSavedIntervalsHeaders } from '../src/utils/telemetryStorage.ts';
import type { AthleteCloudStateEnvelope } from '../src/types.ts';

const ROOT = process.cwd();

function extractCookies(headers: Headers): string {
  const fn = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const list = typeof fn === 'function' ? fn.call(headers) : [headers.get('set-cookie') || ''].filter(Boolean);
  return list
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

describe('Sprint 2 Track 2B: FERPA Export, COPPA Direct-Signup Gate, Full Erasure, HttpOnly Sessions & Distributed Rate Limiting', () => {
  let server: http.Server;
  let baseUrl = '';
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };
  const createdTeamIds: string[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
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
    for (const tid of createdTeamIds) {
      await removeTeamFromDirectoryAndVault(tid).catch(() => undefined);
    }
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  beforeEach(() => {
    resetAiRateLimitsForTesting();
    resetEmailOtpRateLimitsForTesting();
    resetRateLimitsForTesting();
    setPostgresPoolForTesting(null);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    setPostgresPoolForTesting(null);
    vi.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, origEnv);
  });

  it('exports caller-scoped JSON & formula-safe CSV via GET /api/auth/export without leaking other athletes or secrets', async () => {
    const unauthRes = await fetch(`${baseUrl}/api/auth/export?format=json`);
    expect(unauthRes.status).toBe(401);

    const tag = crypto.randomBytes(4).toString('hex');
    const coachUser = await findOrCreateUser('magic_link', `coach_exp_${tag}@school.edu`, {
      email: `coach_exp_${tag}@school.edu`,
      name: 'Coach Rivera',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const athUser = await findOrCreateUser('magic_link', `ath_exp_${tag}@school.edu`, {
      email: `ath_exp_${tag}@school.edu`,
      name: `=CMD|'/C calc'!A0 ${tag}`,
    });
    const athSid = deriveUserSessionSid(athUser.id);
    const otherUser = await findOrCreateUser('magic_link', `other_exp_${tag}@school.edu`, {
      email: `other_exp_${tag}@school.edu`,
      name: 'Other Secret Athlete',
    });
    const otherSid = deriveUserSessionSid(otherUser.id);

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: `Export HS Track ${tag}`,
      orgType: 'HIGH_SCHOOL',
    });
    createdTeamIds.push(team.brand.teamId);

    const claimAth = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: `=CMD|'/C calc'!A0 ${tag}`,
      athleteEmail: athUser.email,
      birthMonthYear: '2009-04',
      parentGuardianEmail: `parent.ath.${tag}@example.org`,
    });
    expect(claimAth.ok).toBe(true);
    const athMemId = claimAth.summary!.memberships.find((m) => m.userSid === athSid)!.membershipId;

    const claimOther = await claimTeamJoinInvite({
      callerSid: otherSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Other Secret Athlete',
      athleteEmail: otherUser.email,
      birthMonthYear: '2004-06',
    });
    expect(claimOther.ok).toBe(true);
    const otherMemId = claimOther.summary!.memberships.find((m) => m.userSid === otherSid)!.membershipId;

    // Seed personal cloud state
    const cloudState: AthleteCloudStateEnvelope = {
      version: 1,
      updatedAt: '2026-11-20T12:00:00.000Z',
      distanceUnit: 'mi',
      athleteProfile: {
        name: athUser.name,
        primarySport: 'Running',
        thresholdPaceSecsPerKm: 245,
        birthMonthYear: '2009-04',
      },
      plannedEvents: [
        {
          id: `plan_${tag}`,
          date: '2026-11-21',
          name: '+10x400m Track',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          plannedDurationSecs: 3600,
          plannedLoad: 72,
          targetZoneSummary: 'Threshold',
          workoutSyntax: '- 10x 400m at 5k',
          description: 'Track threshold session',
        },
      ],
      targetGoals: [
        {
          id: `goal_${tag}`,
          title: 'Sub-2:00 800m',
          type: 'RACE_EVENT',
          sportCategory: 'Running',
          targetDate: '2027-05-01',
          priority: 'A-Race',
          currentValue: 122,
          targetValue: 119.5,
          unit: 'sec',
          notes: 'Spring league finals',
        },
      ],
      annualMileageGoals: [],
      gearItems: [
        {
          id: `shoe_${tag}`,
          name: 'Nike Dragonfly 2',
          type: 'SHOE',
          footwearClass: 'CARBON_SUPER_SPIKE',
          distanceMeters: 16093,
          maxRecommendedMeters: 241401,
          primary: true,
        },
      ],
      sessionCheckIns: [
        {
          id: `chk_${tag}`,
          date: '2026-11-20',
          workoutName: 'Tempo Run',
          rpe: 7,
          painFlag: true,
          painArea: 'SHIN',
          sorenessNote: '@shin tightness',
          createdAt: '2026-11-20T18:00:00.000Z',
        },
      ],
    };
    await saveTenantVaultAsync(`athlete_state_user_${athUser.id}`, cloudState);

    // Seed attendance, field marks & private clinical injury case for athMemId + otherMemId
    await recordTeamAttendanceBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      date: '2026-11-20',
      entries: [
        { membershipId: athMemId, status: 'PRESENT', note: 'On time' },
        { membershipId: otherMemId, status: 'ABSENT', note: 'Other athlete private note' },
      ],
    });
    await recordTeamFieldMarks({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      entries: [
        {
          membershipId: athMemId,
          athleteName: athUser.name,
          date: '2026-11-19',
          eventCode: 'LJ',
          isCompetition: true,
          meetOrPracticeTitle: 'League Invite',
          attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 6.12 }],
        },
        {
          membershipId: otherMemId,
          athleteName: 'Other Secret Athlete',
          date: '2026-11-19',
          eventCode: 'HJ',
          isCompetition: true,
          meetOrPracticeTitle: 'League Invite',
          attempts: [{ attemptNumber: 1, outcome: 'CLEAR', barHeightMeters: 1.95 }],
        },
      ],
    });

    const docWithInjury = await loadTeamDocRaw(team.brand.teamId);
    docWithInjury!.injuryCases = [
      {
        id: `inj_ath_${tag}`,
        teamId: team.brand.teamId,
        membershipId: athMemId,
        athleteName: athUser.name,
        bodyRegion: 'SHIN',
        severity: 'LOW',
        rtpStage: 'MODIFIED',
        restrictions: 'Avoid hard spikes on concrete',
        coachGuidance: 'Grass warmup only',
        privateClinicalNotes: 'SENSITIVE_AT_CLINICAL_NOTE_DO_NOT_EXPORT',
        createdAt: '2026-11-20T09:00:00.000Z',
        updatedAt: '2026-11-20T09:00:00.000Z',
      },
      {
        id: `inj_other_${tag}`,
        teamId: team.brand.teamId,
        membershipId: otherMemId,
        athleteName: 'Other Secret Athlete',
        bodyRegion: 'KNEE',
        severity: 'HIGH',
        rtpStage: 'OUT',
        restrictions: 'No running',
        coachGuidance: 'Pool only',
        privateClinicalNotes: 'OTHER_ATHLETE_CLINICAL',
        createdAt: '2026-11-20T09:00:00.000Z',
        updatedAt: '2026-11-20T09:00:00.000Z',
      },
    ];
    await saveTenantVaultAsync(teamDocVaultKey(team.brand.teamId), docWithInjury);

    const athCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(athUser.id, athSid, 'verified')}`;

    const badFormatRes = await fetch(`${baseUrl}/api/auth/export?format=xml`, {
      headers: { Cookie: athCookie },
    });
    expect(badFormatRes.status).toBe(400);

    const jsonRes = await fetch(`${baseUrl}/api/auth/export?format=json`, {
      headers: { Cookie: athCookie },
    });
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get('cache-control')).toContain('no-store');
    expect(jsonRes.headers.get('content-disposition')).toContain('meetready-data-export.json');
    const jsonText = await jsonRes.text();
    expect(jsonText).not.toContain('Other Secret Athlete');
    expect(jsonText).not.toContain('Other athlete private note');
    expect(jsonText).not.toContain('SENSITIVE_AT_CLINICAL_NOTE_DO_NOT_EXPORT');
    expect(jsonText).not.toContain('OTHER_ATHLETE_CLINICAL');
    expect(jsonText).not.toContain('parentConsentTokenHash');

    const exported = JSON.parse(jsonText);
    expect(exported.schemaVersion).toBe('meetready-export-v1');
    expect(exported.account.id).toBe(athUser.id);
    expect(exported.athleteState.plannedEvents).toHaveLength(1);
    expect(exported.athleteState.gearItems).toHaveLength(1);
    expect(exported.teams).toHaveLength(1);
    expect(exported.teams[0].attendanceRecords).toHaveLength(1);
    expect(exported.teams[0].fieldMarkLogs).toHaveLength(1);
    expect(exported.teams[0].fieldMarkLogs[0].eventCode).toBe('LJ');
    expect(exported.teams[0].injuryCases).toHaveLength(1);
    expect(exported.teams[0].injuryCases[0].privateClinicalNotes).toBeUndefined();

    const csvRes = await fetch(`${baseUrl}/api/auth/export?format=csv`, {
      headers: { Cookie: athCookie },
    });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    expect(csvRes.headers.get('content-disposition')).toContain('meetready-data-export.csv');
    const csvText = await csvRes.text();
    expect(csvText).toContain("'=CMD");
    expect(csvText).toContain("'+10x400m Track");
    expect(csvText).toContain("'@shin tightness");
    expect(csvText).toContain('Nike Dragonfly 2');
    expect(csvText).toContain('FIELD_MARK');
    expect(csvText).not.toContain('Other Secret Athlete');
  });

  it('enforces server-side COPPA <13 rejection & minor->adult block across direct auth/OTP/Strava/athlete-state endpoints', async () => {
    // 1. Unit checks for validateCoppaAgeInput
    const u13Check = validateCoppaAgeInput({ birthMonthYear: '2016-05' });
    expect(u13Check.ok).toBe(false);
    expect(u13Check.statusCode).toBe(400);
    expect(u13Check.isUnder13).toBe(true);

    const u13YearOnly = validateCoppaAgeInput({ birthYear: new Date().getFullYear() - 10 });
    expect(u13YearOnly.ok).toBe(false);
    expect(u13YearOnly.statusCode).toBe(400);

    const omittedCheck = validateCoppaAgeInput({});
    expect(omittedCheck.ok).toBe(true);

    const downgradeCheck = validateCoppaAgeInput({
      birthMonthYear: '1994-03',
      existingBirthMonthYear: `${new Date().getFullYear() - 16}-05`,
    });
    expect(downgradeCheck.ok).toBe(false);
    expect(downgradeCheck.statusCode).toBe(403);

    // 2. Magic Link send <13 reject
    const mlU13 = await fetch(`${baseUrl}/api/auth/magic-link/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `u13.ml.${Date.now()}@example.com`,
        birthMonthYear: `${new Date().getFullYear() - 11}-04`,
      }),
    });
    expect(mlU13.status).toBe(400);

    // 3. Google URL <13 reject
    const gU13 = await fetch(
      `${baseUrl}/api/auth/google/url?birthMonthYear=${new Date().getFullYear() - 9}-01`
    );
    expect(gU13.status).toBe(400);

    // 4. Passkey register-options <13 reject
    const pkU13 = await fetch(`${baseUrl}/api/auth/passkey/register-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `u13.pk.${Date.now()}@example.com`,
        birthYear: new Date().getFullYear() - 10,
      }),
    });
    expect(pkU13.status).toBe(400);

    // 5. Email OTP send-otp <13 reject AND valid DOB persistence on verify-otp without plaintext sessionToken
    const otpU13 = await fetch(`${baseUrl}/api/auth/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `u13.otp.${Date.now()}@example.com`,
        birthMonthYear: `${new Date().getFullYear() - 10}-06`,
      }),
    });
    expect(otpU13.status).toBe(400);

    const otpEmail = `minor.otp.${Date.now()}@school.edu`;
    const minorBmy = `${new Date().getFullYear() - 16}-05`;
    const otpSendOk = await fetch(`${baseUrl}/api/auth/email/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpEmail, birthMonthYear: minorBmy }),
    });
    expect(otpSendOk.status).toBe(200);
    const otpSendData = await otpSendOk.json();
    const otpVerifyOk = await fetch(`${baseUrl}/api/auth/email/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpEmail, code: otpSendData.devPreviewCode }),
    });
    expect(otpVerifyOk.status).toBe(200);
    const otpVerifyJson = await otpVerifyOk.json();
    expect(otpVerifyJson.sessionToken).toBeUndefined();
    expect(extractCookies(otpVerifyOk.headers)).toContain(`${SESSION_COOKIE_NAME}=`);
    const createdOtpUser = await getUserByEmail(otpEmail);
    expect(createdOtpUser?.birthMonthYear).toBe(minorBmy);

    // 6. Strava auth/url <13 reject
    process.env.STRAVA_CLIENT_ID = '121717';
    process.env.STRAVA_CLIENT_SECRET = 'strava_coppa_secret_123456';
    const stravaU13 = await fetch(
      `${baseUrl}/api/strava/auth/url?birthYear=${new Date().getFullYear() - 8}`
    );
    expect(stravaU13.status).toBe(400);

    // 7. POST /api/auth/birth-month year-only support & minor->adult block
    const adultUser = await findOrCreateUser('magic_link', `yr_only_${Date.now()}@school.edu`, {
      name: 'Year Only Athlete',
    });
    const adultCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(adultUser.id, deriveUserSessionSid(adultUser.id), 'verified')}`;
    const yrOnlyRes = await fetch(`${baseUrl}/api/auth/birth-month`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adultCookie },
      body: JSON.stringify({ birthYear: 2002 }),
    });
    expect(yrOnlyRes.status).toBe(200);
    const yrOnlyJson = await yrOnlyRes.json();
    expect(yrOnlyJson.sessionToken).toBeUndefined();
    expect(yrOnlyJson.user?.birthMonthYear).toBe('2002-12');

    // 8. PUT /api/athlete-state blocks <13, blocks minor->adult tamper, and preserves minor DOB if omitted
    const minorUser = await findOrCreateUser('magic_link', `state_minor_${Date.now()}@school.edu`, {
      name: 'Minor Athlete',
    });
    await updateUserBirthMonthYear(minorUser.id, minorBmy);
    const minorCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(minorUser.id, deriveUserSessionSid(minorUser.id), 'verified')}`;

    const stateU13 = await fetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({
        athleteProfile: { birthMonthYear: `${new Date().getFullYear() - 9}-04` },
      }),
    });
    expect(stateU13.status).toBe(400);

    const stateDowngrade = await fetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({
        athleteProfile: { birthMonthYear: '1990-01' },
      }),
    });
    expect(stateDowngrade.status).toBe(403);

    const stateKeep = await fetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({
        athleteProfile: { birthMonthYear: minorBmy, name: 'Minor Athlete' },
      }),
    });
    expect(stateKeep.status).toBe(200);

    const stateOmitDob = await fetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({
        athleteProfile: { name: 'Minor Athlete Updated' },
      }),
    });
    expect(stateOmitDob.status).toBe(200);
    const stateOmitJson = await stateOmitDob.json();
    expect(stateOmitJson.state.athleteProfile.birthMonthYear).toBe(minorBmy);
  });

  it('requires verified auth (401) and blocks Gemini for minors on POST /api/races/parse', async () => {
    let externalFetchCount = 0;
    process.env.GEMINI_API_KEY = 'fake-gemini-key-for-minor-gate-test';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (!target.startsWith(baseUrl)) {
        externalFetchCount += 1;
      }
      if (target.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini must NEVER be called for unauthenticated or minor requests');
      }
      return origFetch(input, init);
    }) as typeof fetch;

    // Unauthenticated rejected BEFORE SSRF fetch or Gemini
    const unauthRes = await origFetch(`${baseUrl}/api/races/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.athletic.net/TrackAndField/meet/12345/results',
        rawText: '800m 1:58.42 Stanford Invite Apr 4, 2026',
      }),
    });
    expect(unauthRes.status).toBe(401);
    expect(externalFetchCount).toBe(0);

    // Anon session rejected
    const anonCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('anon_123', 'a'.repeat(32), 'anon')}`;
    const anonRes = await origFetch(`${baseUrl}/api/races/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: anonCookie },
      body: JSON.stringify({ rawText: '800m 1:58.42 Stanford Invite Apr 4, 2026' }),
    });
    expect(anonRes.status).toBe(401);

    // Authenticated minor NEVER triggers Gemini; falls through cleanly to deterministic parser
    const minorUser = await findOrCreateUser('magic_link', `race_minor_${Date.now()}@hs.edu`, {
      name: 'Minor Track Runner',
    });
    await updateUserBirthMonthYear(minorUser.id, `${new Date().getFullYear() - 15}-04`);
    const minorCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(minorUser.id, deriveUserSessionSid(minorUser.id), 'verified')}`;

    const minorRes = await origFetch(`${baseUrl}/api/races/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: minorCookie },
      body: JSON.stringify({
        rawText: '800 METERS\t1:58.42\tStanford Invitational\tApr 4, 2026',
      }),
    });
    expect(minorRes.status).toBe(200);
    const minorJson = await minorRes.json();
    expect(minorJson.source).toBe('SERVER_DETERMINISTIC');
    expect(minorJson.races).toHaveLength(1);
    expect(externalFetchCount).toBe(0);
  });

  it('scrubs ALL team sub-arrays, sidecar vaults, audit PII & Postgres rows on consent decline, account deletion & team removal', async () => {
    const tag = crypto.randomBytes(4).toString('hex');
    const executedSql: Array<{ sql: string; params: unknown[] }> = [];
    const vaultRows = new Map<string, string>();
    const handleSql = (sql: string, params: unknown[] = []) => {
      const trimmed = sql.trim();
      executedSql.push({ sql: trimmed, params });
      if (trimmed.startsWith('SELECT pg_advisory_xact_lock')) {
        return { rows: [{ pg_advisory_xact_lock: '' }] };
      }
      if (trimmed.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
        const env = vaultRows.get(String(params[0] || ''));
        return { rows: env ? [{ encrypted_envelope: env }] : [] };
      }
      if (trimmed.startsWith('INSERT INTO thresh_tenant_vault')) {
        vaultRows.set(String(params[0] || ''), String(params[1] || ''));
        return { rows: [] };
      }
      if (trimmed.startsWith('DELETE FROM thresh_tenant_vault')) {
        vaultRows.delete(String(params[0] || ''));
        return { rows: [] };
      }
      return { rows: [] };
    };
    const mockPool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
      connect: vi.fn(async () => ({
        query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
        release: vi.fn(),
      })),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };
    setPostgresPoolForTesting(mockPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

    let capturedConsentToken = '';
    process.env.RESEND_API_KEY = 're_test_erasure';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.resend.com/emails')) {
        const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
        const m = body.html?.match(/\/api\/teams\/parent-consent\?token=([A-Za-z0-9_-]+)/);
        if (m?.[1]) capturedConsentToken = m[1];
        return new Response(JSON.stringify({ id: 'em_erasure' }), { status: 200 });
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const coachUser = await findOrCreateUser('magic_link', `coach_erase_${tag}@hs.edu`, {
      name: 'Coach Erase',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://meetready.app',
      name: `Erasure HS ${tag}`,
      orgType: 'HIGH_SCHOOL',
    });
    createdTeamIds.push(team.brand.teamId);

    const minorUser = await findOrCreateUser('magic_link', `minor_decline_${tag}@hs.edu`, {
      email: `minor_decline_${tag}@hs.edu`,
      name: 'Declining Minor',
    });
    const minorSid = deriveUserSessionSid(minorUser.id);
    const minorDob = `${new Date().getFullYear() - 15}-06`;
    await updateUserBirthMonthYear(minorUser.id, minorDob);

    const minorClaim = await claimTeamJoinInvite({
      callerSid: minorSid,
      originUrl: 'https://meetready.app',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Declining Minor',
      athleteEmail: minorUser.email,
      birthMonthYear: minorDob,
      parentGuardianEmail: `guardian.${tag}@family.org`,
    });
    expect(minorClaim.error).toBeUndefined();
    expect(minorClaim.ok).toBe(true);
    expect(capturedConsentToken).toBeTruthy();
    const minorMemId = minorClaim.summary!.memberships.find((m) => m.userSid === minorSid)!.membershipId;

    // Seed sub-arrays & sidecars for Declining Minor
    await postTeamWorkoutComment({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      targetMembershipId: minorMemId,
      workoutDate: '2026-11-20',
      body: 'Great repeats Declining Minor',
    });
    await recordGuardianSafetyAlert({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      targetMembershipId: minorMemId,
      category: 'PAIN_FLAG',
      severity: 'CAUTION',
      summary: 'Shin soreness',
    });
    await recordTeamAttendanceBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      date: '2026-11-20',
      entries: [{ membershipId: minorMemId, status: 'PRESENT' }],
    });
    await recordTeamFieldMarks({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      entries: [
        {
          membershipId: minorMemId,
          athleteName: 'Declining Minor',
          date: '2026-11-20',
          eventCode: 'LJ',
          isCompetition: false,
          meetOrPracticeTitle: 'Practice',
          attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 5.5 }],
        },
      ],
    });
    await postTeamMessage({
      callerSid: minorSid,
      teamId: team.brand.teamId,
      originUrl: 'https://meetready.app',
      channelScope: 'ALL_TEAM',
      body: 'Minor chat message',
    });

    const docBefore = await loadTeamDocRaw(team.brand.teamId);
    docBefore!.broadcastWorkouts = [
      {
        broadcastId: `bw_${tag}`,
        teamId: team.brand.teamId,
        targetSquadGroup: 'Varsity',
        targetMembershipIds: [minorMemId],
        athleteOverrides: { [minorMemId]: { workoutSyntax: '- 4x200m' } },
        date: '2026-11-22',
        name: 'Track Session',
        sportCategory: 'Running',
        plannedDurationSecs: 2400,
        plannedLoad: 50,
        workoutSyntax: '- 6x200m',
        description: 'Speed',
        pushedByCoachName: 'Coach Erase',
        createdAt: '2026-11-20T00:00:00.000Z',
      },
    ];
    docBefore!.meetDayPackets = [
      {
        packetId: `pkt_${tag}`,
        meetTitle: 'League Meet',
        meetDate: '2026-11-25',
        laneCount: 8,
        flightSize: 12,
        partitionByDivision: true,
        updatedAt: '2026-11-20T00:00:00.000Z',
        entries: [
          {
            id: `ent_${tag}`,
            membershipId: minorMemId,
            athleteName: 'Declining Minor',
            eventCode: '800m',
            seedMarkRaw: '2:05.00',
          },
        ],
      },
    ];
    docBefore!.injuryCases = [
      {
        id: `ic_${tag}`,
        teamId: team.brand.teamId,
        membershipId: minorMemId,
        athleteName: 'Declining Minor',
        bodyRegion: 'SHIN',
        severity: 'LOW',
        rtpStage: 'MODIFIED',
        restrictions: 'Easy grass',
        coachGuidance: 'Skip spikes',
        createdAt: '2026-11-20T00:00:00.000Z',
        updatedAt: '2026-11-20T00:00:00.000Z',
      },
    ];
    await saveTenantVaultAsync(teamDocVaultKey(team.brand.teamId), docBefore);

    // 1. Guardian declines consent -> full purge across all sub-arrays + sidecar + Postgres + zero plaintext originalName in audit!
    const declineRes = await declineAndPurgeParentConsent(capturedConsentToken);
    expect(declineRes.ok).toBe(true);

    const docAfter = await loadTeamDocRaw(team.brand.teamId);
    const purgedMem = docAfter!.memberships.find((m) => m.membershipId === minorMemId)!;
    expect(purgedMem.status).toBe('REVOKED');
    expect(purgedMem.invitedName).toBe('Withdrawn Minor');
    expect(purgedMem.userSid).toBeUndefined();
    expect(docAfter!.workoutComments || []).toHaveLength(0);
    expect(docAfter!.guardianSafetyAlerts || []).toHaveLength(0);
    expect(Object.keys(docAfter!.attendanceByDate || {})).toHaveLength(0);
    expect(docAfter!.fieldMarkLogs || []).toHaveLength(0);
    expect(docAfter!.meetDayPackets![0].entries).toHaveLength(0);
    expect(docAfter!.injuryCases || []).toHaveLength(0);
    expect(docAfter!.teamMessages || []).toHaveLength(0);
    expect(docAfter!.broadcastWorkouts[0].targetMembershipIds).toEqual([]);
    expect(docAfter!.broadcastWorkouts[0].athleteOverrides?.[minorMemId]).toBeUndefined();

    const sidecarFieldLogs = await loadTenantVaultAsync<unknown[]>(
      teamFieldLogsVaultKey(team.brand.teamId),
      []
    );
    expect(sidecarFieldLogs).toHaveLength(0);

    const auditEntries = await listTeamAuditLogAsync(team.brand.teamId, 50);
    const serializedAudit = JSON.stringify(auditEntries);
    expect(serializedAudit).not.toContain('Declining Minor');
    const declineAudit = auditEntries.find((a) => a.action === 'PARENT_CONSENT_DECLINED');
    expect(declineAudit).toBeDefined();
    expect(declineAudit!.metadata.originalName).toBeUndefined();

    expect(
      executedSql.some((q) => q.sql.includes('DELETE FROM thresh_team_members'))
    ).toBe(true);
    expect(
      executedSql.some((q) => q.sql.includes('UPDATE thresh_audit_log'))
    ).toBe(true);

    // 2. Permanent account deletion for sole Head Coach deletes team & Postgres rows
    const coachCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(coachUser.id, coachSid, 'verified')}`;
    const delCoachRes = await fetch(`${baseUrl}/api/auth/account?confirm=DELETE`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(delCoachRes.status).toBe(200);
    expect(await getUserById(coachUser.id)).toBeNull();
    expect(await loadTeamDocRaw(team.brand.teamId)).toBeNull();
    expect(await loadTenantVaultAsync(userTeamsVaultKey(coachSid), null)).toBeNull();
    expect(
      executedSql.some((q) => q.sql.includes('DELETE FROM thresh_teams WHERE team_id'))
    ).toBe(true);
    expect(
      executedSql.some((q) => q.sql.includes('DELETE FROM thresh_audit_log WHERE team_id'))
    ).toBe(true);
  });

  it('uses distributed Upstash Redis and Postgres thresh_rate_limits backends with fallback to memory', async () => {
    // 1. Upstash REST backend
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash_test_token_123';
    let redisCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://mock-upstash.upstash.io/pipeline') {
        redisCount += 1;
        return new Response(
          JSON.stringify([{ result: redisCount }, { result: 60000 }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const r1 = await checkDistributedRateLimitAsync('upstash_key', 2, 60_000);
    expect(r1).toMatchObject({ allowed: true, backend: 'UPSTASH_REDIS', remaining: 1 });
    const r2 = await checkDistributedRateLimitAsync('upstash_key', 2, 60_000);
    expect(r2).toMatchObject({ allowed: true, backend: 'UPSTASH_REDIS', remaining: 0 });
    const r3 = await checkDistributedRateLimitAsync('upstash_key', 2, 60_000);
    expect(r3.allowed).toBe(false);
    expect(r3.backend).toBe('UPSTASH_REDIS');
    expect(r3.retryAfterSecs).toBeGreaterThan(0);

    // 2. Postgres thresh_rate_limits backend
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    let pgCount = 0;
    const rlPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO thresh_rate_limits')) {
          pgCount += 1;
          return {
            rows: [{ request_count: pgCount, expires_at: Date.now() + 30_000 }],
          };
        }
        return { rows: [] };
      }),
      on: vi.fn(),
      end: vi.fn(async () => undefined),
    };
    setPostgresPoolForTesting(rlPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

    const p1 = await checkDistributedRateLimitAsync('pg_key', 2, 30_000);
    expect(p1).toMatchObject({ allowed: true, backend: 'POSTGRES', remaining: 1 });
    const p2 = await checkDistributedRateLimitAsync('pg_key', 2, 30_000);
    expect(p2).toMatchObject({ allowed: true, backend: 'POSTGRES', remaining: 0 });
    const p3 = await checkDistributedRateLimitAsync('pg_key', 2, 30_000);
    expect(p3).toMatchObject({ allowed: false, backend: 'POSTGRES' });
  });

  it('migrates frontend helpers to HttpOnly cookies + sessionHint.ts and completes subprocessors.html', () => {
    const store = new Map<string, string>([
      ['aeropulse_session_token', 'secret_legacy_tok'],
      ['aeropulse_intervals_api_key', 'icu_key_123'],
    ]);
    const origStorage = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    try {
      expect(getSavedIntervalsHeaders()['x-session-token']).toBeUndefined();
      expect(buildThreshSessionHeaders()['x-session-token']).toBeUndefined();
      expect(hasSessionActiveHint()).toBe(false);
      markSessionActiveHint();
      expect(hasSessionActiveHint()).toBe(true);
      expect(store.get('thresh_session_active_hint')).toBe('1');
      expect(store.has('aeropulse_session_token')).toBe(false);
      clearSessionActiveHint();
      expect(hasSessionActiveHint()).toBe(false);
    } finally {
      (globalThis as { localStorage?: Storage }).localStorage = origStorage;
    }

    const subHtml = fs.readFileSync(path.join(ROOT, 'public/legal/subprocessors.html'), 'utf8');
    for (const vendor of [
      'Vercel',
      'Neon',
      'Resend',
      'Google Gemini',
      'Upstash Redis',
      'Stripe',
      'Google Identity',
      'Strava',
      'Garmin',
      'COROS',
      'Intervals.icu',
      'Wahoo',
      'Polar',
      '/api/auth/export',
      '/api/auth/account',
    ]) {
      expect(subHtml).toContain(vendor);
    }
  });
});
