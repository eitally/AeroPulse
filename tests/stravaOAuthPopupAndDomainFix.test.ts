import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { clearStravaRedirectCacheForTesting } from '../server/oauthHelpers.ts';
import {
  deriveStravaSessionSid,
  issueSessionToken,
  verifyOAuthStateToken,
} from '../server/securityUtils.ts';
import { deleteTenantVault } from '../server/tokenVault.ts';
import {
  decodeGooglePolylineClient,
  getSavedIntervalsHeaders,
  sanitizeHttpHeaderValue,
} from '../src/utils/telemetryStorage.ts';

describe('Strava OAuth Popup Close + "Failed to fetch" & Domain Migration Regression Suite', () => {
  const originalFetch = globalThis.fetch;
  const origEnv: Record<string, string | undefined> = {};
  let server: http.Server | null = null;
  let baseUrl = '';
  const createdAthleteIds: string[] = [];

  beforeEach(async () => {
    clearStravaRedirectCacheForTesting();
    for (const k of [
      'STRAVA_CLIENT_ID',
      'STRAVA_CLIENT_SECRET',
      'STRAVA_REDIRECT_URI',
      'STRAVA_FALLBACK_REDIRECT_URI',
      'SESSION_SECRET',
      'TOKEN_VAULT_KEY',
    ]) {
      origEnv[k] = process.env[k];
    }
    process.env.STRAVA_CLIENT_ID = '121717';
    process.env.STRAVA_CLIENT_SECRET = 'strava_popup_fix_test_secret_12345';
    process.env.SESSION_SECRET = 'thresh_popup_fix_session_secret_0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    delete process.env.STRAVA_REDIRECT_URI;
    delete process.env.STRAVA_FALLBACK_REDIRECT_URI;

    const app = express();
    app.use(express.json());
    app.use(apiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    clearStravaRedirectCacheForTesting();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    for (const athId of createdAthleteIds.splice(0)) {
      const sid = deriveStravaSessionSid(athId);
      await deleteTenantVault(`session_${sid.slice(0, 24)}`);
    }
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('serves CORS preflight (OPTIONS) and credentialed GET headers for trusted aeropulse-eta -> thresh-dev migration', async () => {
    const preflightResp = await originalFetch(`${baseUrl}/api/strava/auth/url`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://aeropulse-eta.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-session-token,x-strava-client-id',
      },
    });
    expect(preflightResp.status).toBe(204);
    expect(preflightResp.headers.get('access-control-allow-origin')).toBe(
      'https://aeropulse-eta.vercel.app'
    );
    expect(preflightResp.headers.get('access-control-allow-credentials')).toBe('true');

    const urlResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=https%3A%2F%2Faeropulse-eta.vercel.app&mode=cloud&flow=popup`,
      {
        headers: {
          Origin: 'https://aeropulse-eta.vercel.app',
          'x-strava-client-id': '121717',
        },
      }
    );
    expect(urlResp.status).toBe(200);
    expect(urlResp.headers.get('access-control-allow-origin')).toBe(
      'https://aeropulse-eta.vercel.app'
    );
    expect(urlResp.headers.get('access-control-allow-credentials')).toBe('true');
    const body = await urlResp.json();
    expect(body.url).toContain('https://www.strava.com/oauth/authorize');
    expect(body.state).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();

    // Untrusted origin must NOT receive Access-Control-Allow-Origin
    const evilResp = await originalFetch(`${baseUrl}/api/strava/auth/url`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(evilResp.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('auto-falls back redirect_uri to aeropulse-eta when Strava rejects thresh-dev and switches back once thresh-dev is registered', async () => {
    let acceptThreshDev = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://www.strava.com/oauth/authorize')) {
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri') || '';
        if (redirectUri.includes('thresh-dev.vercel.app') && !acceptThreshDev) {
          return new Response(
            JSON.stringify({
              message: 'Bad Request',
              errors: [{ resource: 'Application', field: 'redirect_uri', code: 'invalid' }],
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://www.strava.com/login' },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const fallbackResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=https%3A%2F%2Fthresh-dev.vercel.app&mode=cloud&flow=popup`
    );
    expect(fallbackResp.status).toBe(200);
    const fallbackData = await fallbackResp.json();
    expect(fallbackData.redirectUri).toBe('https://aeropulse-eta.vercel.app/auth/strava/callback');
    expect(fallbackData.url).toContain(
      `redirect_uri=${encodeURIComponent('https://aeropulse-eta.vercel.app/auth/strava/callback')}`
    );

    // Fallback redirects must NOT stick in cache: once thresh-dev is registered on Strava,
    // the very next request resolves to thresh-dev.vercel.app immediately without clearing cache
    acceptThreshDev = true;
    const directResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=https%3A%2F%2Fthresh-dev.vercel.app&mode=cloud&flow=popup`
    );
    expect(directResp.status).toBe(200);
    const directData = await directResp.json();
    expect(directData.redirectUri).toBe('https://thresh-dev.vercel.app/auth/strava/callback');
    expect(directData.url).toContain(
      `redirect_uri=${encodeURIComponent('https://thresh-dev.vercel.app/auth/strava/callback')}`
    );
  });

  it('canonicalizes legacy aeropulse-eta and Vercel preview origins to thresh-dev callback, preserves preview CORS, and blocks lone x-strava-client-id override', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://www.strava.com/oauth/authorize')) {
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri') || '';
        if (redirectUri.includes('thresh-dev.vercel.app')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://www.strava.com/login' },
          });
        }
        return new Response(
          JSON.stringify({
            message: 'Bad Request',
            errors: [{ resource: 'Application', field: 'redirect_uri', code: 'invalid' }],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    // 1. Legacy origin (aeropulse-eta.vercel.app) immediately resolves to thresh-dev.vercel.app
    const legacyResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=https%3A%2F%2Faeropulse-eta.vercel.app&mode=cloud&flow=popup`,
      {
        headers: {
          Origin: 'https://aeropulse-eta.vercel.app',
          'x-strava-client-id': '999999',
        },
      }
    );
    expect(legacyResp.status).toBe(200);
    const legacyData = await legacyResp.json();
    expect(legacyData.redirectUri).toBe('https://thresh-dev.vercel.app/auth/strava/callback');
    // Lone x-strava-client-id without x-strava-client-secret must NOT override server clientId
    expect(legacyData.clientId).toBe('121717');

    // 2. Vercel preview deployment origin falls back to thresh-dev.vercel.app and gets CORS headers
    const previewOrigin = 'https://thresh-git-preview-willow-glen-photography.vercel.app';
    const previewResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(previewOrigin)}&mode=cloud&flow=popup`,
      {
        headers: { Origin: previewOrigin },
      }
    );
    expect(previewResp.status).toBe(200);
    expect(previewResp.headers.get('access-control-allow-origin')).toBe(previewOrigin);
    expect(previewResp.headers.get('access-control-allow-credentials')).toBe('true');
    const previewData = await previewResp.json();
    expect(previewData.redirectUri).toBe('https://thresh-dev.vercel.app/auth/strava/callback');

    // 3. Full BYO pair (x-strava-client-id + x-strava-client-secret) overrides server clientId
    const byoResp = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=https%3A%2F%2Fthresh-dev.vercel.app&mode=cloud&flow=popup`,
      {
        headers: {
          'x-strava-client-id': '555',
          'x-strava-client-secret': 'user_custom_byo_secret_xyz',
        },
      }
    );
    expect(byoResp.status).toBe(200);
    const byoData = await byoResp.json();
    expect(byoData.clientId).toBe('555');
  });

  it('supports /auth/login popup fallback, emits cross-origin postMessage + storage relay, and allows cookie-less poll with signed state', async () => {
    const athleteId = '881122';
    createdAthleteIds.push(athleteId);
    const clientUuid = 'deadbeef-1234-4567-89ab-abcdef012345';

    const loginResp = await originalFetch(
      `${baseUrl}/api/strava/auth/login?flow=popup&mode=cloud&state=${clientUuid}&origin=https%3A%2F%2Faeropulse-eta.vercel.app`,
      { redirect: 'manual' }
    );
    expect(loginResp.status).toBe(302);
    const location = loginResp.headers.get('location') || '';
    expect(location.startsWith('https://www.strava.com/oauth/authorize')).toBe(true);

    const stateParam = new URL(location).searchParams.get('state') || '';
    const claims = verifyOAuthStateToken(stateParam);
    expect(claims?.flow).toBe('popup');
    expect(claims?.origin).toBe('https://aeropulse-eta.vercel.app');
    expect(claims?.nonce).toBe(clientUuid);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === 'https://www.strava.com/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: 'strava_acc_popup_fix',
            refresh_token: 'strava_ref_popup_fix',
            expires_at: 2100000000,
            athlete: {
              id: Number(athleteId),
              firstname: 'Jordan',
              lastname: 'Reyes',
              measurement_preference: 'feet',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target === 'https://www.strava.com/api/v3/athlete') {
        return new Response(
          JSON.stringify({
            id: Number(athleteId),
            firstname: 'Jordan',
            lastname: 'Reyes',
            measurement_preference: 'feet',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const cbResp = await originalFetch(
      `${baseUrl}/auth/strava/callback?code=cb_code_1&state=${encodeURIComponent(
        stateParam
      )}&scope=read,activity:read_all`
    );
    expect(cbResp.status).toBe(200);
    const html = await cbResp.text();
    expect(html).toContain('"isPopupFlow":true');
    expect(html).toContain('"openerOrigin":"https://aeropulse-eta.vercel.app"');
    expect(html).toContain('window.opener.postMessage(payload, payload.openerOrigin)');
    expect(html).toContain('window.opener.location.href = window.location.origin');
    expect(html).toContain('aeropulse_oauth_result_v1');

    // Different authenticated athlete must be rejected from polling this state
    const differentSessionToken = issueSessionToken(
      'intruder',
      deriveStravaSessionSid('999111')
    );
    const foreignPollResp = await originalFetch(
      `${baseUrl}/api/strava/auth/poll?state=${encodeURIComponent(stateParam)}`,
      {
        headers: { 'x-session-token': differentSessionToken },
      }
    );
    expect(foreignPollResp.status).toBe(200);
    expect((await foreignPollResp.json()).completed).toBe(false);

    // Un-cookied caller holding the signed state (e.g. Safari ITP / post-307) succeeds
    const cookielessPollResp = await originalFetch(
      `${baseUrl}/api/strava/auth/poll?state=${encodeURIComponent(stateParam)}`
    );
    expect(cookielessPollResp.status).toBe(200);
    const pollBody = await cookielessPollResp.json();
    expect(pollBody.completed).toBe(true);
    expect(pollBody.tokens?.refreshToken).toBe('strava_ref_popup_fix');
    expect(pollBody.athleteName).toBe('Jordan Reyes');
  });

  it('sanitizes non-ASCII / control characters in headers and decodes Strava polylines on client', () => {
    expect(sanitizeHttpHeaderValue('  abc\u2028\u0007xyz🔥\n ')).toBe('abcxyz');

    const store = new Map<string, string>([
      ['aeropulse_session_token', '\u2028tok_clean\n'],
      ['aeropulse_strava_client_id', ' 121717🔥 '],
    ]);
    const origStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
    };
    try {
      const headers = getSavedIntervalsHeaders();
      expect(headers['x-session-token']).toBe('tok_clean');
      expect(headers['x-strava-client-id']).toBe('121717');
    } finally {
      (globalThis as any).localStorage = origStorage;
    }

    const decoded = decodeGooglePolylineClient('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(decodeGooglePolylineClient('')).toBeUndefined();
  });
});
