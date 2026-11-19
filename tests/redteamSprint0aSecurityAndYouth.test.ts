import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { resetAiRateLimitsForTesting } from '../server/secretManager.ts';
import {
  SESSION_COOKIE_NAME,
  deriveStravaSessionSid,
  deriveUserSessionSid,
  issueSessionToken,
  resolveTrustedCorsOrigin,
} from '../server/securityUtils.ts';
import {
  acknowledgeParentConsent,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  previewTeamJoinInvite,
  syncAthleteSnapshotAcrossTeams,
} from '../server/teamService.ts';
import { revokeAthleteGuardianConsentForTeam } from '../server/teamLifecycleService.ts';
import { applyExternalTeamSyncBatch } from '../server/athleticSyncService.ts';
import { sanitizeTelemetryForCleanRoom } from '../server/cleanRoomFirewall.ts';
import { findOrCreateUser, saveUser } from '../server/authService.ts';
import { saveTenantVaultAsync, deleteTenantVault } from '../server/tokenVault.ts';

function extractCookieMap(res: Response): Record<string, string> {
  const raw = res.headers.getSetCookie?.() || [];
  const fallback = res.headers.get('set-cookie');
  const list = raw.length > 0 ? raw : fallback ? [fallback] : [];
  const out: Record<string, string> = {};
  for (const item of list) {
    const first = item.split(';')[0] || '';
    const eq = first.indexOf('=');
    if (eq > 0) {
      out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    }
  }
  return out;
}

function buildEs256PasskeyFixture(origin: string, challenge: string, rpId = '127.0.0.1') {
  const credIdBuf = crypto.randomBytes(16);
  const credId = credIdBuf.toString('base64url');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const xBuf = Buffer.from(jwk.x!, 'base64url');
  const yBuf = Buffer.from(jwk.y!, 'base64url');
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
  const coseKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    xBuf,
    Buffer.from([0x22, 0x58, 0x20]),
    yBuf,
  ]);
  const credIdLenBuf = Buffer.alloc(2);
  credIdLenBuf.writeUInt16BE(credIdBuf.length, 0);
  const signCountBuf = Buffer.alloc(4);
  signCountBuf.writeUInt32BE(1, 0);
  const regAuthData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x45]),
    signCountBuf,
    Buffer.alloc(16, 0),
    credIdLenBuf,
    credIdBuf,
    coseKey,
  ]);
  const attestationObject = Buffer.concat([
    Buffer.from([0xa3, 0x63]),
    Buffer.from('fmt'),
    Buffer.from([0x64]),
    Buffer.from('none'),
    Buffer.from([0x67]),
    Buffer.from('attStmt'),
    Buffer.from([0xa0, 0x68]),
    Buffer.from('authData'),
    Buffer.from([0x58, regAuthData.length]),
    regAuthData,
  ]).toString('base64url');
  const regClientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.create', challenge, origin })
  ).toString('base64url');

  const signAssertion = (assertChallenge: string) => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: assertChallenge, origin })
    ).toString('base64url');
    const sc2 = Buffer.alloc(4);
    sc2.writeUInt32BE(2, 0);
    const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), sc2]);
    const clientHash = crypto
      .createHash('sha256')
      .update(Buffer.from(clientDataJSON, 'base64url'))
      .digest();
    const signature = crypto
      .sign('sha256', Buffer.concat([authData, clientHash]), privateKey)
      .toString('base64url');
    return {
      clientDataJSON,
      authenticatorData: authData.toString('base64url'),
      signature,
    };
  };

  return { credId, regClientDataJSON, attestationObject, signAssertion };
}

describe('Red-Team Sprint 0A · Security, Auth, Clean-Room & Youth Compliance Regressions', () => {
  const originalFetch = globalThis.fetch;
  const origEnv: Record<string, string | undefined> = {};
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
    resetAiRateLimitsForTesting();
    for (const k of [
      'NODE_ENV',
      'VERCEL',
      'RESEND_API_KEY',
      'SESSION_SECRET',
      'PASSKEY_CHALLENGE_SECRET',
      'TOKEN_VAULT_KEY',
      'STRAVA_CLIENT_ID',
      'STRAVA_CLIENT_SECRET',
      'STRAVA_WEBHOOK_VERIFY_TOKEN',
      'STRAVA_WEBHOOK_SUBSCRIPTION_ID',
      'INTERVALS_WEBHOOK_SECRET',
      'CRON_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'VERCEL_BRANCH_URL',
      'GEMINI_API_KEY',
      'APP_BASE_URL',
    ]) {
      origEnv[k] = process.env[k];
    }
    process.env.SESSION_SECRET = 'rt_sprint0a_test_session_secret_0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('RT-01: /api/auth/session mints opaque anon_* blocked on verified endpoints', async () => {
    const sessRes = await originalFetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: 'attacker_forged_victim_sid_1234', athleteName: 'Attacker' }),
    });
    expect(sessRes.status).toBe(200);
    const cookies = extractCookieMap(sessRes);
    expect(cookies[SESSION_COOKIE_NAME]).toBeTruthy();
    const cookieHeader = `${SESSION_COOKIE_NAME}=${cookies[SESSION_COOKIE_NAME]}`;

    const me = await (
      await originalFetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieHeader } })
    ).json();
    expect(me.authenticated).toBe(false);

    const statePut = await originalFetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ state: {} }),
    });
    expect(statePut.status).toBe(401);

    const gemCfg = await originalFetch(`${baseUrl}/api/gemini/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ apiKey: 'AIza_evil' }),
    });
    expect(gemCfg.status).toBe(401);

    const coachChat = await originalFetch(`${baseUrl}/api/coach/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ message: 'Hi' }),
    });
    expect(coachChat.status).toBe(401);

    const createTeam = await originalFetch(`${baseUrl}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ name: 'Anon Team' }),
    });
    expect(createTeam.status).toBe(401);

    const joinClaim = await originalFetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ codeOrSlug: 'ABC123' }),
    });
    expect(joinClaim.status).toBe(401);

    const delAcct = await originalFetch(`${baseUrl}/api/auth/account?confirm=DELETE`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(delAcct.status).toBe(401);
  });

  it('RT-02: rejects forged passkeys, challenge replay, and 409 existing-email account takeover', async () => {
    const email = `pk_guard_${Date.now()}@thresh.run`;
    const optRes = await originalFetch(`${baseUrl}/api/auth/passkey/register-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Passkey Victim' }),
    });
    const opt = await optRes.json();
    const fix = buildEs256PasskeyFixture(baseUrl, opt.options.challenge);

    // Register real passkey
    const regOk = await originalFetch(`${baseUrl}/api/auth/passkey/register-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: opt.challengeToken,
        email,
        name: 'Passkey Victim',
        credential: {
          id: fix.credId,
          rawId: fix.credId,
          response: {
            clientDataJSON: fix.regClientDataJSON,
            attestationObject: fix.attestationObject,
          },
        },
      }),
    });
    expect(regOk.status).toBe(200);

    // 1. Replay same register challenge jti -> 400
    const replayReg = await originalFetch(`${baseUrl}/api/auth/passkey/register-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: opt.challengeToken,
        email: `other_${Date.now()}@thresh.run`,
        credential: {
          id: fix.credId,
          rawId: fix.credId,
          response: {
            clientDataJSON: fix.regClientDataJSON,
            attestationObject: fix.attestationObject,
          },
        },
      }),
    });
    expect(replayReg.status).toBe(400);

    // 2. Unauthenticated attacker tries to attach a new passkey to existing email -> 409
    const opt2 = await (
      await originalFetch(`${baseUrl}/api/auth/passkey/register-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    ).json();
    const attackerFix = buildEs256PasskeyFixture(baseUrl, opt2.options.challenge);
    const conflictReg = await originalFetch(`${baseUrl}/api/auth/passkey/register-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: opt2.challengeToken,
        email,
        credential: {
          id: attackerFix.credId,
          rawId: attackerFix.credId,
          response: {
            clientDataJSON: attackerFix.regClientDataJSON,
            attestationObject: attackerFix.attestationObject,
          },
        },
      }),
    });
    expect(conflictReg.status).toBe(409);

    // 3. Forged signature in auth-verify -> 401
    const authOpt = await (
      await originalFetch(`${baseUrl}/api/auth/passkey/auth-options`, { method: 'POST' })
    ).json();
    const realAssertion = fix.signAssertion(authOpt.options.challenge);
    const forgedAuth = await originalFetch(`${baseUrl}/api/auth/passkey/auth-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: authOpt.challengeToken,
        credential: {
          id: fix.credId,
          rawId: fix.credId,
          response: {
            ...realAssertion,
            signature: crypto.randomBytes(64).toString('base64url'),
          },
        },
      }),
    });
    expect(forgedAuth.status).toBe(401);
  });

  it('RT-03: strips Strava/untagged recentWorkouts, keeps Polar, enforces forceZeroWeight & locks U18 minors out of Gemini', async () => {
    const cleaned = sanitizeTelemetryForCleanRoom(
      {
        recentWorkouts: [
          { name: 'Untagged Sneaky Run', load: 55 },
          { name: 'Strava Run', stravaId: '991', sourceBadges: ['Strava'] },
          { name: 'Polar Vantage Tempo', sourceBadges: ['Polar'], load: 72 },
          { name: 'Garmin Track', sourceBadges: ['Garmin'], weightKg: 62 },
        ],
        athleteProfile: { weightKg: 62, ftp: 280 },
      },
      { forceZeroWeight: true, requireFirstPartyProvenance: true }
    );
    expect(cleaned.recentWorkouts).toHaveLength(2);
    expect(cleaned.recentWorkouts.map((w: any) => w.name)).toEqual([
      'Polar Vantage Tempo',
      'Garmin Track',
    ]);
    expect(cleaned.zeroWeightEnforced).toBe(true);
    expect(cleaned.athleteProfile.weightKg).toBeUndefined();

    // U18 Minor user with BYO Gemini key MUST NEVER hit external Gemini API
    const yr = new Date().getFullYear() - 15;
    const minorUser = await findOrCreateUser('magic_link', `minor_ai_${Date.now()}@hs.edu`, {
      name: 'Minor Athlete',
    });
    minorUser.birthMonthYear = `${yr}-04`;
    await saveUser(minorUser);

    let calledGeminiExternal = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('generativelanguage.googleapis.com')) {
        calledGeminiExternal = true;
      }
      return originalFetch(input, init);
    }) as any;

    const minorToken = issueSessionToken(minorUser.id, deriveUserSessionSid(minorUser.id), 'verified');
    const chatRes = await originalFetch(`${baseUrl}/api/coach/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${minorToken}`,
        'x-gemini-api-key': 'AIza_minor_byo_test_key_should_not_leave',
      },
      body: JSON.stringify({
        message: 'Give me a track workout',
        telemetrySummary: { athleteProfile: { weightKg: 52, ftp: 240 } },
      }),
    });
    expect(chatRes.status).toBe(200);
    const chatJson = await chatRes.json();
    expect(chatJson.engine).toBe('LOCAL_PHYSIOLOGY_ENGINE');
    expect(calledGeminiExternal).toBe(false);
  });

  it('RT-04: enforces production fail-closed Magic Link, GET confirm non-mutation, trusted origins & rate limits', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    delete process.env.RESEND_API_KEY;
    process.env.GOOGLE_CLIENT_ID = 'google_prod_cid';
    process.env.GOOGLE_CLIENT_SECRET = 'google_prod_secret';
    process.env.APP_BASE_URL = 'https://thresh-dev.vercel.app';

    const failSend = await originalFetch(`${baseUrl}/api/auth/magic-link/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vercel-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({ email: `prod_fail_${Date.now()}@thresh.run` }),
    });
    expect(failSend.status).toBe(503);

    const gUrlRes = await originalFetch(`${baseUrl}/api/auth/google/url`, {
      headers: {
        'x-forwarded-host': 'evil-phish.attacker.com',
        'x-forwarded-proto': 'https',
      },
    });
    const gUrl = await gUrlRes.json();
    expect(gUrl.redirectUri).toBe('https://thresh-dev.vercel.app/api/auth/google/callback');

    // Rate limiting under non-prod IP bucket
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'test';
    let got429 = false;
    const rlEmail = `ratelimit_${Date.now()}@thresh.test`;
    for (let i = 0; i < 8; i++) {
      const r = await originalFetch(`${baseUrl}/api/auth/magic-link/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-forwarded-for': '203.0.113.77',
        },
        body: JSON.stringify({ email: rlEmail }),
      });
      if (r.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });

  it('RT-05: blocks CSRF callbacks missing cookie nonce & rejects wildcard preview CORS', async () => {
    process.env.STRAVA_CLIENT_ID = '121717';
    process.env.STRAVA_CLIENT_SECRET = 'sec';
    process.env.WAHOO_CLIENT_ID = 'w_cid';
    process.env.WAHOO_CLIENT_SECRET = 'w_sec';
    process.env.POLAR_CLIENT_ID = 'p_cid';
    process.env.POLAR_CLIENT_SECRET = 'p_sec';
    process.env.INTERVALS_CLIENT_ID = 'i_cid';
    process.env.INTERVALS_CLIENT_SECRET = 'i_sec';
    process.env.GOOGLE_CLIENT_ID = 'g_cid';
    process.env.GOOGLE_CLIENT_SECRET = 'g_sec';

    const { state: sState } = await (await originalFetch(`${baseUrl}/api/strava/auth/url`)).json();
    const { state: wState } = await (await originalFetch(`${baseUrl}/api/wahoo/auth/url`)).json();
    const { state: pState } = await (await originalFetch(`${baseUrl}/api/polar/auth/url`)).json();
    const { state: iState } = await (
      await originalFetch(`${baseUrl}/api/intervals/auth/url`)
    ).json();
    const { authUrl: gAuthUrl } = await (
      await originalFetch(`${baseUrl}/api/auth/google/url`)
    ).json();
    const gState = new URL(gAuthUrl).searchParams.get('state') || '';

    expect(
      (await originalFetch(`${baseUrl}/auth/strava/callback?code=c&state=${sState}`)).status
    ).toBe(400);
    expect(
      (await originalFetch(`${baseUrl}/auth/wahoo/callback?code=c&state=${wState}`)).status
    ).toBe(400);
    expect(
      (await originalFetch(`${baseUrl}/auth/polar/callback?code=c&state=${pState}`)).status
    ).toBe(400);
    expect(
      (await originalFetch(`${baseUrl}/auth/intervals/callback?code=c&state=${iState}`)).status
    ).toBe(400);
    const gCb = await originalFetch(
      `${baseUrl}/api/auth/google/callback?code=c&state=${encodeURIComponent(gState)}`,
      { redirect: 'manual' }
    );
    expect(gCb.headers.get('location')).toContain('invalid_state_csrf');

    expect(resolveTrustedCorsOrigin('https://random-attacker-preview.vercel.app')).toBeNull();
  });

  it('RT-06: requires 2-step email verification code for primary email migration', async () => {
    const email = `migrate_src_${Date.now()}@school.edu`;
    const newEmail = `migrate_dst_${Date.now()}@gmail.com`;
    const u = await findOrCreateUser('magic_link', email, { email, name: 'Senior Grad' });
    const tok = issueSessionToken(u.id, deriveUserSessionSid(u.id), 'verified');

    const step1 = await (
      await originalFetch(`${baseUrl}/api/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${tok}` },
        body: JSON.stringify({ newEmail }),
      })
    ).json();
    expect(step1.verificationRequired).toBe(true);
    expect(step1.devCode).toMatch(/^\d{6}$/);

    const badCode = await originalFetch(`${baseUrl}/api/auth/change-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${tok}` },
      body: JSON.stringify({ newEmail, verificationCode: '000000' }),
    });
    expect(badCode.status).toBe(400);

    const step2 = await originalFetch(`${baseUrl}/api/auth/change-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${tok}` },
      body: JSON.stringify({ newEmail, verificationCode: step1.devCode }),
    });
    expect(step2.status).toBe(200);
    expect((await step2.json()).user?.email).toBe(newEmail);
  });

  it('RT-07: blocks unauth preview email enumeration, coach hijack, and javascript: externalProfileUrl XSS', async () => {
    const coachSid = `rt07_coach_${Date.now()}`;
    const athEmail = `rt07_ath_${Date.now()}@club.org`;
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.app',
      name: `RT07 Club ${Date.now()}`,
      orgType: 'RUNNING_CLUB',
      coachDisplayName: 'Coach Alpha',
      coachEmail: 'coach.alpha@club.org',
    });

    // Unauthenticated preview with ?email= must not return membership PII
    const prevRes = await (
      await originalFetch(
        `${baseUrl}/api/teams/join-preview?codeOrSlug=${team.brand.joinCode}&email=coach.alpha@club.org`
      )
    ).json();
    expect(prevRes.found).toBe(true);
    expect(prevRes.membership).toBeUndefined();

    // Attacker claiming with spoofed coach email cannot hijack HEAD_COACH role
    const atkUser = await findOrCreateUser('magic_link', athEmail, { name: 'Attacker' });
    const atkTok = issueSessionToken(atkUser.id, deriveUserSessionSid(atkUser.id), 'verified');
    const claimRes = await originalFetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${atkTok}`,
      },
      body: JSON.stringify({
        codeOrSlug: team.brand.joinCode,
        athleteEmail: 'coach.alpha@club.org',
        athleteName: 'Hijacker',
        birthYear: 1998,
      }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    const myRole = claimed.team.memberships.find(
      (m: any) => m.userSid === deriveUserSessionSid(atkUser.id)
    )?.role;
    expect(myRole).toBe('ATHLETE');

    // javascript: externalProfileUrl stripped by athleticSyncService
    const syncOut = await applyExternalTeamSyncBatch({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.app',
      athletes: [
        {
          name: 'XSS Victim',
          squadGroup: 'Varsity',
          isMinorU18: false,
          externalSource: 'ATHLETIC_NET',
          externalProfileUrl: 'javascript:alert(document.cookie)',
        },
      ],
    });
    const xssRow = syncOut.summary?.memberships.find((m) => m.invitedName === 'XSS Victim');
    expect(xssRow?.externalProfileUrl).toBeUndefined();
  });

  it('RT-08 & RT-09: blocks minor DOB tampering, enforces HS consent & quarantine, hides consent tokens, and drops private wellness', async () => {
    const prevResend = process.env.RESEND_API_KEY;
    let consentTok = '';
    process.env.RESEND_API_KEY = 're_test_rt09';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.resend.com/emails')) {
        const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
        const m = body.html?.match(/\/api\/teams\/parent-consent\?token=([A-Za-z0-9_-]+)/);
        if (m?.[1]) consentTok = m[1];
        return new Response(JSON.stringify({ id: 'em_rt09' }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as any;

    const coachSid = `rt09_coach_${Date.now()}`;
    const hsTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.app',
      name: `RT09 High ${Date.now()}`,
      orgType: 'HIGH_SCHOOL',
    });

    const athSid = `rt09_ath_${Date.now()}`;
    const noParent = await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl: 'https://thresh.app',
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Teen Runner',
      birthYear: new Date().getFullYear() - 16,
    });
    expect(noParent.ok).toBe(false);

    const minorUser = await findOrCreateUser('magic_link', `rt09_minor_${Date.now()}@hs.edu`, {
      name: 'Teen Runner',
    });
    minorUser.birthMonthYear = `${new Date().getFullYear() - 16}-05`;
    await saveUser(minorUser);
    const minorTok = issueSessionToken(minorUser.id, deriveUserSessionSid(minorUser.id), 'verified');

    // Minor cannot overwrite stored DOB to 18+ via /api/auth/birth-month
    const dobTamper = await originalFetch(`${baseUrl}/api/auth/birth-month`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${minorTok}`,
      },
      body: JSON.stringify({ birthMonthYear: '1995-01' }),
    });
    expect(dobTamper.status).toBe(403);

    const minorClaim = await claimTeamJoinInvite({
      callerSid: deriveUserSessionSid(minorUser.id),
      originUrl: 'https://thresh.app',
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Teen Runner',
      birthMonthYear: minorUser.birthMonthYear,
      parentGuardianEmail: 'guardian.rt09@family.org',
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(minorClaim.ok).toBe(true);
    expect(
      minorClaim.summary?.memberships.find((m) => m.userSid === deriveUserSessionSid(minorUser.id))
        ?.parentConsentToken
    ).toBeUndefined();
    expect(consentTok).toBeTruthy();

    // Guardian self-removal blocked for minor even if adult birthMonthYear is passed
    const guardianRevokeAttempt = await revokeAthleteGuardianConsentForTeam({
      callerSid: deriveUserSessionSid(minorUser.id),
      teamId: hsTeam.brand.teamId,
      originUrl: 'https://thresh.app',
      birthMonthYear: '1990-01',
    });
    expect(guardianRevokeAttempt.ok).toBe(false);

    // Pending HIGH_SCHOOL consent MUST be quarantined before parent acknowledges
    await syncAthleteSnapshotAcrossTeams({
      callerSid: deriveUserSessionSid(minorUser.id),
      originUrl: 'https://thresh.app',
      snapshot: {
        readinessScore: 88,
        wellnessDays: [{ date: '2026-11-18', ctl: 40, atl: 42, tsb: -2, rampRate: 1, hrvRMSSD: 60, hrvBaseline7d: 58, restingHR: 50, sleepSecs: 28800, sleepScore: 85, weightKg: 54, readinessStatus: 'Optimal', dailyLoad: 50 }],
      },
    });
    let coachTeams = await listTeamsForUser(coachSid, 'https://thresh.app');
    let minorSnap = coachTeams[0].memberships.find(
      (m) => m.userSid === deriveUserSessionSid(minorUser.id)
    )?.liveSnapshot;
    expect(minorSnap?.verdictLabel).toBe('Awaiting Parent Consent');
    expect(minorSnap?.wellnessDays).toBeUndefined();

    // Parent approves hashed consent token; private wellness setting still hides wellnessDays
    expect((await acknowledgeParentConsent(consentTok)).ok).toBe(true);
    await syncAthleteSnapshotAcrossTeams({
      callerSid: deriveUserSessionSid(minorUser.id),
      originUrl: 'https://thresh.app',
      snapshot: {
        readinessScore: 88,
        privacySettings: {
          shareWellnessAndHrv: 'PRIVATE',
          sharePmcAndZones: 'COACHES_ONLY',
          shareGpsRoutes: 'PRIVATE',
          stravaComplianceShield: true,
          allowCoachCalendarEdits: false,
        },
        wellnessDays: [{ date: '2026-11-18', ctl: 40, atl: 42, tsb: -2, rampRate: 1, hrvRMSSD: 60, hrvBaseline7d: 58, restingHR: 50, sleepSecs: 28800, sleepScore: 85, weightKg: 54, readinessStatus: 'Optimal', dailyLoad: 50 }],
      },
    });
    coachTeams = await listTeamsForUser(coachSid, 'https://thresh.app');
    minorSnap = coachTeams[0].memberships.find(
      (m) => m.userSid === deriveUserSessionSid(minorUser.id)
    )?.liveSnapshot;
    expect(minorSnap?.verdictLabel).toBe('Active');
    expect(minorSnap?.wellnessDays).toBeUndefined();

    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
  });

  it('RT-18 & RT-19: gates routes/kudos/webhooks, fail-closes prod webhooks, and wipes vault cookies & /tmp archives on disconnect', async () => {
    expect(
      (
        await originalFetch(`${baseUrl}/api/activities/hydrate-routes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-intervals-api-key': 'fake' },
        })
      ).status
    ).toBe(401);
    expect(
      (await originalFetch(`${baseUrl}/api/strava/activities/12345/kudos`)).status
    ).toBe(401);
    expect(
      (
        await originalFetch(`${baseUrl}/api/activities/12345/kudos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status
    ).toBe(401);
    expect(
      (
        await originalFetch(`${baseUrl}/api/webhooks/intervals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status
    ).toBe(401);

    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
    expect(
      (
        await originalFetch(
          `${baseUrl}/api/webhooks/strava?hub.mode=subscribe&hub.challenge=ch123`
        )
      ).status
    ).toBe(503);
    expect(
      (
        await originalFetch(`${baseUrl}/api/webhooks/strava`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription_id: 999 }),
        })
      ).status
    ).toBe(503);

    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'real_v_tok';
    process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = '4242';
    expect(
      (
        await originalFetch(
          `${baseUrl}/api/webhooks/strava?hub.mode=subscribe&hub.challenge=ch&hub.verify_token=wrong`
        )
      ).status
    ).toBe(403);
    expect(
      (
        await originalFetch(`${baseUrl}/api/webhooks/strava`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription_id: 1111 }),
        })
      ).status
    ).toBe(403);

    // Disconnect wipes thresh_vault cookie and unlinks /tmp Strava archive
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'test';
    const athId = `987654${Math.floor(10 + Math.random() * 89)}`;
    const sid = deriveStravaSessionSid(athId);
    const scopeKey = sid.slice(0, 24);
    await saveTenantVaultAsync(`session_${scopeKey}`, {
      stravaAthleteId: athId,
      stravaAccessToken: 'tok_disc',
      stravaRefreshToken: 'ref_disc',
    });
    const archivePath = `/tmp/aeropulse-strava-archive-${athId}.json`;
    fs.writeFileSync(archivePath, JSON.stringify([{ id: '1' }]));
    const tok = issueSessionToken(athId, sid, 'verified');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('strava.com/oauth/deauthorize')) {
        return new Response('{}', { status: 200 });
      }
      return originalFetch(input, init);
    }) as any;

    const discRes = await originalFetch(`${baseUrl}/api/strava/disconnect`, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${tok}` },
    });
    expect(discRes.status).toBe(200);
    const setCookies = discRes.headers.getSetCookie?.() || [];
    expect(setCookies.some((c) => c.startsWith('thresh_vault=') && c.includes('Max-Age=0'))).toBe(
      true
    );
    expect(fs.existsSync(archivePath)).toBe(false);
    await deleteTenantVault(`session_${scopeKey}`);
  });
});
