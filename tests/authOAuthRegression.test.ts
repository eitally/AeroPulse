import http from 'http';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { getUserByProvider } from '../server/authService.ts';
import { verifyOAuthStateToken } from '../server/securityUtils.ts';
import { deleteTenantVault, loadTenantVaultAsync } from '../server/tokenVault.ts';

function extractCookiesFromHeaders(headers: Headers): string {
  const getSetCookieFn = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawList =
    typeof getSetCookieFn === 'function'
      ? getSetCookieFn.call(headers)
      : [headers.get('set-cookie') || ''].filter(Boolean);
  return rawList
    .map((entry) => entry.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

describe('OAuth Regressions — Strava Handoff & Google/Vercel Cold-Start Auth', () => {
  let server: http.Server;
  let baseUrl = '';

  const origEnv = {
    STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
    STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
  };
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
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

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('persists Strava callback tokens into HTML localStorage, vault poll storage, and OAUTH_AUTH_SUCCESS payload', async () => {
    process.env.STRAVA_CLIENT_ID = '121717';
    process.env.STRAVA_CLIENT_SECRET = 'strava_regression_secret_123456';

    const urlResp = await fetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}&mode=cloud&flow=popup`
    );
    expect(urlResp.status).toBe(200);
    const urlData = await urlResp.json();
    expect(urlData.state).toBeTruthy();
    const initialCookies = extractCookiesFromHeaders(urlResp.headers);
    const verifiedState = verifyOAuthStateToken(urlData.state);
    expect(verifiedState?.nonce).toBeTruthy();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.startsWith('https://www.strava.com/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'strv_acc_test_1',
            refresh_token: 'strv_ref_test_1',
            expires_at: 1999999999,
            athlete: {
              id: 445566,
              firstname: 'Maya',
              lastname: 'Lin',
              weight: 56.2,
              ftp: 245,
              measurement_preference: 'feet',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.startsWith('https://www.strava.com/api/v3/athlete')) {
        return new Response(
          JSON.stringify({
            id: 445566,
            firstname: 'Maya',
            lastname: 'Lin',
            weight: 56.2,
            ftp: 245,
            measurement_preference: 'feet',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const cbResp = await fetch(
      `${baseUrl}/auth/strava/callback?code=strava_code_xyz&state=${encodeURIComponent(urlData.state)}&scope=read,activity:read_all`,
      {
        headers: { Cookie: initialCookies },
      }
    );
    expect(cbResp.status).toBe(200);
    const html = await cbResp.text();
    expect(html).toContain('"type":"OAUTH_AUTH_SUCCESS"');
    // RT-19: raw Strava OAuth tokens must stay inside HttpOnly cookies / server KV vault, never exposed in HTML JS
    expect(html).not.toContain('strv_ref_test_1');
    expect(html).not.toContain('strv_acc_test_1');
    expect(html).not.toContain("localStorage.setItem('aeropulse_strava_refresh_token'");
    expect(html).toContain("localStorage.removeItem('aeropulse_logged_out')");

    // Verify saveTenantVaultAsync persisted poll payload for cross-instance Vercel lookup
    const vaultedPoll = await loadTenantVaultAsync<{ athleteId?: string; accessToken?: string } | null>(
      `oauth_poll_${verifiedState!.nonce}`,
      null
    );
    expect(vaultedPoll?.athleteId).toBe('445566');
    expect(vaultedPoll?.accessToken).toBe('strv_acc_test_1');

    // Verify /api/strava/auth/poll completes for caller session without leaking raw tokens in JSON
    const pollResp = await fetch(
      `${baseUrl}/api/strava/auth/poll?state=${encodeURIComponent(urlData.state)}`,
      {
        headers: { Cookie: initialCookies },
      }
    );
    expect(pollResp.status).toBe(200);
    const pollData = await pollResp.json();
    expect(pollData.completed).toBe(true);
    expect(pollData.tokens?.athleteId).toBe('445566');
    expect(pollData.tokens?.refreshToken).toBeUndefined();
    expect(pollData.tokens?.accessToken).toBeUndefined();
    expect(pollData.athleteName).toBe('Maya Lin');
    expect(pollResp.headers.get('set-cookie')).toContain('thresh_session=');
  });

  it('builds Google OAuth URL from multi-hop Vercel proxy headers and disables mock-login in production', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-123.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google_secret_456';

    const gUrlResp = await fetch(`${baseUrl}/api/auth/google/url`, {
      headers: {
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'aeropulse-eta.vercel.app',
      },
    });
    expect(gUrlResp.status).toBe(200);
    const gUrlData = await gUrlResp.json();
    expect(gUrlData.configured).toBe(true);
    expect(gUrlData.redirectUri).toBe('https://aeropulse-eta.vercel.app/api/auth/google/callback');
    expect(gUrlData.url).toBe(gUrlData.authUrl);
    expect(gUrlData.url).toContain(
      `redirect_uri=${encodeURIComponent('https://aeropulse-eta.vercel.app/api/auth/google/callback')}`
    );

    // Production without GOOGLE_CLIENT_ID must NEVER expose devMockUrl or allow mock-login
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.VERCEL = '1';

    const prodUnconfiguredResp = await fetch(`${baseUrl}/api/auth/google/url`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'aeropulse-eta.vercel.app',
      },
    });
    expect(prodUnconfiguredResp.status).toBe(200);
    const prodData = await prodUnconfiguredResp.json();
    expect(prodData.configured).toBe(false);
    expect(prodData.devMode).toBe(false);
    expect(prodData.devMockUrl).toBeUndefined();
    expect(prodData.devMockLoginUrl).toBeUndefined();
    expect(prodData.error).toContain('GOOGLE_CLIENT_ID');

    const mockGetResp = await fetch(`${baseUrl}/api/auth/mock-login?provider=google`);
    expect(mockGetResp.status).toBe(403);
    const mockPostResp = await fetch(`${baseUrl}/api/auth/mock-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'attacker@thresh.run' }),
    });
    expect(mockPostResp.status).toBe(403);
  });

  it('recovers Google user session via encrypted thresh_user cookie when serverless /tmp user file is absent', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-789.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google_secret_789';

    const initResp = await fetch(`${baseUrl}/api/auth/google/url`);
    const initData = await initResp.json();
    const stateParam = new URL(initData.url).searchParams.get('state')!;
    const oauthCookie = extractCookiesFromHeaders(initResp.headers);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({ access_token: 'google_acc_1', id_token: 'google_id_1' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target === 'https://www.googleapis.com/oauth2/v3/userinfo') {
        return new Response(
          JSON.stringify({
            sub: 'google_uid_coldstart_999',
            email: 'vercel.runner@example.com',
            name: 'Vercel Runner',
            picture: 'https://example.com/avatar.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const cbResp = await fetch(
      `${baseUrl}/api/auth/google/callback?code=g_code_abc&state=${encodeURIComponent(stateParam)}`,
      {
        redirect: 'manual',
        headers: { Cookie: oauthCookie },
      }
    );
    expect(cbResp.status).toBe(302);
    expect(cbResp.headers.get('location')).toBe('/?auth_just_signed_in=1');

    const sessionCookies = extractCookiesFromHeaders(cbResp.headers);
    expect(sessionCookies).toContain('thresh_session=');
    expect(sessionCookies).toContain('thresh_user=');

    const savedUser = await getUserByProvider('google', 'google_uid_coldstart_999');
    expect(savedUser).not.toBeNull();
    // Evict container-local user file to simulate hitting a brand-new cold serverless Lambda
    await deleteTenantVault(`user_${savedUser!.id}`);

    const meResp = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: sessionCookies },
    });
    expect(meResp.status).toBe(200);
    const meData = await meResp.json();
    expect(meData.authenticated).toBe(true);
    expect(meData.user?.email).toBe('vercel.runner@example.com');
    expect(meData.user?.name).toBe('Vercel Runner');
    expect(meData.sessionToken).toBeTruthy();
  });
});
