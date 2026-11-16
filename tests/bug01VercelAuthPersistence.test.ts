import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import { apiRouter } from '../server/apiRouter.ts';
import {
  scopedStoresInMemory,
  deriveStravaSessionSid,
} from '../server/sessionContext.ts';
import { setSessionCookie } from '../server/securityUtils.ts';
import { deleteTenantVault, saveTenantVaultAsync } from '../server/tokenVault.ts';

function extractCookiePairs(setCookieHeader: string[] | string | undefined): Record<string, string> {
  const list = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const out: Record<string, string> = {};
  for (const raw of list) {
    const first = raw.split(';')[0] || '';
    const eqIdx = first.indexOf('=');
    if (eqIdx > 0) {
      out[first.slice(0, eqIdx).trim()] = first.slice(eqIdx + 1).trim();
    }
  }
  return out;
}

describe('BUG-01: Vercel Deployment /tmp Wipe & Strava Auth Persistence', () => {
  let server: http.Server;
  let baseUrl = '';
  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  beforeEach(async () => {
    process.env.STRAVA_CLIENT_ID = '999999';
    process.env.STRAVA_CLIENT_SECRET = 'test_strava_secret_for_bug01_unit_suite_12345';
    process.env.SESSION_SECRET = 'test_session_secret_for_bug01_unit_suite_12345';

    const app = express();
    app.use(express.json());
    // Seed an initial OAuth callback vault before mounting apiRouter
    app.post('/__test/seed-strava-session', async (req, res) => {
      const { athleteId, refreshToken, accessToken, expiresAt, includePolicy = true } = req.body;
      const canonicalSid = deriveStravaSessionSid(athleteId);
      const scopeKey = canonicalSid.slice(0, 24);
      setSessionCookie(req, res, 'Test Athlete', canonicalSid);
      await saveTenantVaultAsync(`session_${scopeKey}`, {
        stravaClientId: process.env.STRAVA_CLIENT_ID,
        stravaClientSecret: process.env.STRAVA_CLIENT_SECRET,
        stravaRefreshToken: refreshToken,
        stravaAccessToken: accessToken,
        stravaExpiresAt: expiresAt,
        stravaAthleteId: athleteId,
        stravaAthleteName: 'Test Athlete',
        ...(includePolicy
          ? {
              stravaSyncPolicy: {
                window: '90d',
                importProfileAndGear: true,
                confirmedAt: new Date().toISOString(),
              },
            }
          : {}),
      });
      res.json({ ok: true, scopeKey });
    });
    app.use(apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
    scopedStoresInMemory.clear();
    const canonicalSid = deriveStravaSessionSid('777888');
    await deleteTenantVault(`session_${canonicalSid.slice(0, 24)}`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('updates thresh_vault cookie on Strava token rotation inside /api/strava/sync and survives full /tmp wipe across Vercel deploys', async () => {
    const athleteId = '777888';
    const canonicalSid = deriveStravaSessionSid(athleteId);
    const scopeKey = canonicalSid.slice(0, 24);
    let currentRefresh = 'refresh_token_v1';
    const stravaAfterUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('strava.com/oauth/token')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.refresh_token !== currentRefresh) {
          return new Response(JSON.stringify({ message: 'Invalid refresh token' }), { status: 400 });
        }
        currentRefresh = 'refresh_token_v2_rotated';
        return new Response(
          JSON.stringify({
            access_token: 'access_token_v2_fresh',
            refresh_token: currentRefresh,
            expires_at: Math.floor(Date.now() / 1000) + 21600,
            athlete: { id: Number(athleteId), firstname: 'Eli', lastname: 'Runner' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('strava.com/api/v3/athlete/activities')) {
        stravaAfterUrls.push(url);
        return new Response(
          JSON.stringify([
            {
              id: 5511001,
              name: 'Morning Track Threshold',
              type: 'Run',
              sport_type: 'Run',
              start_date_local: '2026-11-15T07:30:00Z',
              start_date: '2026-11-15T14:30:00Z',
              moving_time: 2400,
              distance: 8000,
              athlete: { id: Number(athleteId) },
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('strava.com/api/v3/athlete/zones')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes('strava.com/api/v3/athlete')) {
        return new Response(
          JSON.stringify({
            id: Number(athleteId),
            firstname: 'Eli',
            lastname: 'Runner',
            measurement_preference: 'feet',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('strava.com/api/v3/segments/starred')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('strava.com/api/v3/activities/')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return origFetch(input, init);
    }) as typeof fetch;

    // 1. Seed initial session with already-expired access token v1
    const seedResp = await origFetch(`${baseUrl}/__test/seed-strava-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athleteId,
        refreshToken: 'refresh_token_v1',
        accessToken: 'expired_access_v1',
        expiresAt: Math.floor(Date.now() / 1000) - 3600,
      }),
    });
    const seedCookies = extractCookiePairs(seedResp.headers.getSetCookie?.() || []);
    expect(seedCookies.thresh_session).toBeTruthy();

    // 2. Call /api/strava/sync -> triggers Strava token rotation v1 -> v2
    const recentAfterEpoch = Math.floor(Date.now() / 1000) - 5 * 86400;
    const sync1 = await origFetch(
      `${baseUrl}/api/strava/sync?window=90d&deltaOnly=true&afterEpoch=${recentAfterEpoch}`,
      {
        headers: {
          Cookie: `thresh_session=${seedCookies.thresh_session}`,
        },
      }
    );
    expect(sync1.status).toBe(200);
    const sync1Cookies = extractCookiePairs(sync1.headers.getSetCookie?.() || []);
    // Verify thresh_vault cookie was emitted WITH the rotated v2 token!
    expect(sync1Cookies.thresh_vault).toBeTruthy();
    const sync1Data = await sync1.json();
    expect(sync1Data.stravaTokens?.refreshToken).toBe('refresh_token_v2_rotated');
    // Verify incremental deltaOnly fetched strictly page 1 with client afterEpoch instead of 10 full pages
    expect(stravaAfterUrls.length).toBe(1);
    expect(stravaAfterUrls[0]).toContain('page=1');
    expect(stravaAfterUrls[0]).toContain(`after=${recentAfterEpoch}`);

    // 3. Simulate brand-new Vercel Serverless deployment: wipe ALL /tmp vault files + memory cache!
    scopedStoresInMemory.clear();
    const vaultFile = `/tmp/thresh-vault-session_${scopeKey}.enc`;
    if (fs.existsSync(vaultFile)) fs.unlinkSync(vaultFile);

    // 4. Subsequent request ONLY sends browser cookies (no localStorage headers!) -> must STILL be connected!
    const cookieJar = `thresh_session=${sync1Cookies.thresh_session || seedCookies.thresh_session}; thresh_vault=${sync1Cookies.thresh_vault}`;
    const statusAfterDeploy = await origFetch(`${baseUrl}/api/config/status`, {
      headers: { Cookie: cookieJar },
    });
    expect(statusAfterDeploy.status).toBe(200);
    const statusJson = await statusAfterDeploy.json();
    expect(statusJson.stravaConnected).toBe(true);
    expect(statusJson.stravaAthleteName).toBe('Eli Runner');
    expect(statusJson.stravaTokens?.refreshToken).toBe('refresh_token_v2_rotated');
    expect(statusJson.stravaSyncPolicy?.window).toBe('90d');

    // 5. Logout clears thresh_vault and disconnects session cleanly
    const logoutResp = await origFetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookieJar, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCredentials: true }),
    });
    expect(logoutResp.status).toBe(200);
    const logoutSetCookies = logoutResp.headers.getSetCookie?.() || [];
    expect(logoutSetCookies.some((c) => c.startsWith('thresh_vault=;') && c.includes('Max-Age=0'))).toBe(true);
  });

  it('rehydrates Strava tokens from thresh_vault cookie even when thresh_session sid differs after /tmp wipe', async () => {
    const athleteId = '777888';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('strava.com/api/v3/athlete')) {
        return new Response(
          JSON.stringify({
            id: Number(athleteId),
            firstname: 'Eli',
            lastname: 'Runner',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as typeof fetch;

    // Seed Strava session without policy so x-strava-sync-window header fallback can be verified too
    const seedResp = await origFetch(`${baseUrl}/__test/seed-strava-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athleteId,
        refreshToken: 'refresh_token_cross_sid',
        accessToken: 'access_token_cross_sid',
        expiresAt: Math.floor(Date.now() / 1000) + 21600,
        includePolicy: false,
      }),
    });
    const seedCookies = extractCookiePairs(seedResp.headers.getSetCookie?.() || []);
    const st1 = await origFetch(`${baseUrl}/api/config/status`, {
      headers: { Cookie: `thresh_session=${seedCookies.thresh_session}` },
    });
    const st1Cookies = extractCookiePairs(st1.headers.getSetCookie?.() || []);
    expect(st1Cookies.thresh_vault).toBeTruthy();

    // Acquire an unrelated session token (like anonymous POST /api/auth/session) and wipe /tmp
    const anonSess = await origFetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteName: 'OtherSid' }),
    });
    const anonCookies = extractCookiePairs(anonSess.headers.getSetCookie?.() || []);
    scopedStoresInMemory.clear();
    const scopeKey = deriveStravaSessionSid(athleteId).slice(0, 24);
    const vaultFile = `/tmp/thresh-vault-session_${scopeKey}.enc`;
    if (fs.existsSync(vaultFile)) fs.unlinkSync(vaultFile);

    const statusResp = await origFetch(`${baseUrl}/api/config/status`, {
      headers: {
        Cookie: `thresh_session=${anonCookies.thresh_session}; thresh_vault=${st1Cookies.thresh_vault}`,
        'x-strava-sync-window': '180d',
      },
    });
    const statusJson = await statusResp.json();
    expect(statusJson.stravaConnected).toBe(true);
    expect(statusJson.stravaTokens?.refreshToken).toBe('refresh_token_cross_sid');
    expect(statusJson.stravaSyncPolicy?.window).toBe('180d');
  });
});
