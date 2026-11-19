import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';
import {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
  getEffectiveIntervalsClientConfig,
} from '../server/apiRouter.ts';
import { SESSION_COOKIE_NAME, decodeAndVerifyToken } from '../server/securityUtils.ts';

class SimpleCookieJar {
  private cookies = new Map<string, string>();

  absorbResponse(res: Response) {
    const rawHeaders: string[] =
      typeof (res.headers as any).getSetCookie === 'function'
        ? (res.headers as any).getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')!]
          : [];
    for (const hdr of rawHeaders) {
      const firstPart = hdr.split(';')[0] || '';
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (!value || hdr.includes('Max-Age=0')) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  headerValue(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

describe('CON-03 · Intervals.icu OAuth 2.0 Connector & Power-User Fallback', () => {
  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;
  const envBackup: Record<string, string | undefined> = {};

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

  beforeEach(() => {
    for (const k of ['INTERVALS_CLIENT_ID', 'INTERVALS_CLIENT_SECRET', 'INTERVALS_REDIRECT_URI']) {
      envBackup[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects /api/intervals/auth/url if client credentials are not configured', async () => {
    delete process.env.INTERVALS_CLIENT_ID;
    delete process.env.INTERVALS_CLIENT_SECRET;

    const res = await fetch(`${baseUrl}/api/intervals/auth/url`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Intervals.icu OAuth is not configured');
  });

  it('generates standard OAuth 2.0 authorization URL with requested scopes and HMAC state', async () => {
    process.env.INTERVALS_CLIENT_ID = 'test_intervals_client_id_123';
    process.env.INTERVALS_CLIENT_SECRET = 'test_intervals_secret_abc';

    const res = await fetch(`${baseUrl}/api/intervals/auth/url?flow=popup`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; clientId: string; state: string };

    expect(data.clientId).toBe('test_intervals_client_id_123');
    expect(data.url).toContain('https://intervals.icu/oauth/authorize?');
    expect(data.url).toContain('client_id=test_intervals_client_id_123');
    expect(data.url).toContain('scope=ACTIVITY%3AREAD%2CWELLNESS%3AREAD%2CCALENDAR%3AREAD');
    expect(data.url).toContain('response_type=code');
    expect(data.state).toBeTruthy();
  });

  it('rejects /auth/intervals/callback when state is missing or invalid', async () => {
    process.env.INTERVALS_CLIENT_ID = 'test_intervals_client_id_123';
    process.env.INTERVALS_CLIENT_SECRET = 'test_intervals_secret_abc';

    const res = await fetch(`${baseUrl}/auth/intervals/callback?code=mock_code&state=invalid.tampered.state`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Security Verification Failed');
  });

  it('handles user cancellation/denial cleanly on /auth/intervals/callback', async () => {
    process.env.INTERVALS_CLIENT_ID = 'test_intervals_client_id_123';
    process.env.INTERVALS_CLIENT_SECRET = 'test_intervals_secret_abc';

    const res = await fetch(`${baseUrl}/auth/intervals/callback?error=access_denied`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Access was denied by the user on Intervals.icu');
  });

  it('exchanges OAuth authorization code, securely stores tokens, and renders success HTML', async () => {
    process.env.INTERVALS_CLIENT_ID = 'test_intervals_client_id_123';
    process.env.INTERVALS_CLIENT_SECRET = 'test_intervals_secret_abc';

    // 1. Get a valid signed state token + browser OAuth state cookie
    const jar = new SimpleCookieJar();
    const urlRes = await fetch(`${baseUrl}/api/intervals/auth/url`);
    jar.absorbResponse(urlRes);
    const { state } = (await urlRes.json()) as { state: string };

    // 2. Mock Intervals.icu token exchange endpoint
    const mockTokenPayload = {
      token_type: 'Bearer',
      access_token: 'icu_bearer_token_xyz987',
      scope: 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ',
      id: 'i88421',
      name: 'Coros Runner',
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('/api/oauth/token')) {
        return new Response(JSON.stringify(mockTokenPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    // 3. Invoke callback with OAuth state cookie
    const callbackRes = await fetch(
      `${baseUrl}/auth/intervals/callback?code=valid_auth_code_123&state=${encodeURIComponent(state)}`,
      { redirect: 'manual', headers: { Cookie: jar.headerValue() } }
    );

    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain('Intervals.icu Connected');
    expect(html).toContain('Coros Runner');
    expect(html).toContain('aeropulse_oauth');
    expect(html).toContain('OAUTH_AUTH_SUCCESS');

    // 4. Verify /api/config/status reports Intervals.icu connected via OAuth
    jar.absorbResponse(callbackRes);
    const statusRes = await fetch(`${baseUrl}/api/config/status`, {
      headers: { Cookie: jar.headerValue() },
    });
    const statusData = await statusRes.json();
    expect(statusData.intervalsConnected).toBe(true);
    expect(statusData.intervalsAuthMethod).toBe('OAUTH');
    expect(statusData.intervalsAthleteId).toBe('i88421');
  });

  it('seamlessly calls /api/intervals/sync using Bearer token when OAuth is connected', async () => {
    const mockActivities = [
      {
        id: 'act_101',
        name: 'Morning Intervals 6x800m',
        type: 'Run',
        start_date_local: '2026-11-14T07:00:00',
        moving_time: 2400,
        distance: 8200,
        average_heartrate: 162,
        icu_training_load: 65,
      },
    ];
    const mockWellness = [
      {
        id: '2026-11-14',
        hrv: 68,
        hrvSDNN: 72,
        sleepSecs: 28800,
        sleepScore: 89,
        restingHR: 46,
      },
    ];

    let capturedAuthHeader: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('intervals.icu/api/v1/athlete/')) {
        capturedAuthHeader = (init?.headers as Record<string, string>)?.Authorization || null;
        if (urlStr.includes('/activities')) {
          return new Response(JSON.stringify(mockActivities), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/wellness')) {
          return new Response(JSON.stringify(mockWellness), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/events')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ id: 'i88421', name: 'Coros Runner' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    const syncRes = await fetch(`${baseUrl}/api/intervals/sync`, {
      headers: {
        'x-intervals-access-token': 'icu_bearer_token_xyz987',
        'x-intervals-athlete-id': 'i88421',
      },
    });

    expect(syncRes.status).toBe(200);
    expect(capturedAuthHeader).toBe('Bearer icu_bearer_token_xyz987');
    const syncData = await syncRes.json();
    expect(syncData.activities.length).toBe(1);
    expect(syncData.wellnessDays.length).toBe(1);
    expect(syncData.wellnessDays[0].hrvRMSSD).toBe(68);
  });

  it('supports power-user personal API key fallback via /api/intervals/connect', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('intervals.icu/api/v1/athlete/0')) {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        expect(auth).toContain('Basic ');
        return new Response(
          JSON.stringify({
            id: 'i99999',
            name: 'Power User Athlete',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as any;

    const connectRes = await fetch(`${baseUrl}/api/intervals/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'personal_key_sec_456',
        athleteId: '0',
      }),
    });

    expect(connectRes.status).toBe(200);
    const data = await connectRes.json();
    expect(data.connected).toBe(true);
    expect(data.athleteName).toBe('Power User Athlete');

    // Header resolution test
    const authHeader = getIntervalsAuthHeader({ apiKey: 'personal_key_sec_456' });
    expect(authHeader).toBe(
      'Basic ' + Buffer.from('API_KEY:personal_key_sec_456').toString('base64')
    );
  });

  it('cleans up tokens upon /api/intervals/disconnect', async () => {
    const disconnectRes = await fetch(`${baseUrl}/api/intervals/disconnect`, {
      method: 'POST',
    });
    expect(disconnectRes.status).toBe(200);
    const data = await disconnectRes.json();
    expect(data.connected).toBe(false);

    const statusRes = await fetch(`${baseUrl}/api/config/status`);
    const statusData = await statusRes.json();
    expect(statusData.intervalsConnected).toBe(false);
  });
});
