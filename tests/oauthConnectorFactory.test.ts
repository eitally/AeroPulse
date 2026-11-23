import http from 'node:http';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { getEffectivePolarTokens } from '../server/routers/polarRouter.ts';
import { getEffectiveWahooTokens } from '../server/routers/wahooRouter.ts';
import { SESSION_COOKIE_NAME } from '../server/securityUtils.ts';
import { bindRequestScopeKey, requestContext } from '../server/sessionContext.ts';

class TestCookieJar {
  private cookies = new Map<string, string>();

  absorbResponse(res: Response) {
    const hdrObj = res.headers as Headers & { getSetCookie?: () => string[] };
    const rawHeaders: string[] =
      typeof hdrObj.getSetCookie === 'function'
        ? hdrObj.getSetCookie()
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

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  headerValue(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

describe('Sprint 3 PR 3A · OAuth Connector Factory (Polar & Wahoo)', () => {
  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'POLAR_CLIENT_ID',
    'POLAR_CLIENT_SECRET',
    'WAHOO_CLIENT_ID',
    'WAHOO_CLIENT_SECRET',
    'SESSION_SECRET',
  ];

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
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
    }
    process.env.SESSION_SECRET = 'test_oauth_factory_session_secret_998877';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns 400 when Polar env creds are missing and 200 without PKCE + sets CSRF cookie when configured', async () => {
    delete process.env.POLAR_CLIENT_ID;
    delete process.env.POLAR_CLIENT_SECRET;

    const missingResp = await fetch(`${baseUrl}/api/polar/auth/url`);
    expect(missingResp.status).toBe(400);
    const missingJson = (await missingResp.json()) as { error?: string };
    expect(missingJson.error).toContain('POLAR_CLIENT_ID');

    process.env.POLAR_CLIENT_ID = 'polar_client_123';
    process.env.POLAR_CLIENT_SECRET = 'polar_secret_456';

    const jar = new TestCookieJar();
    const okResp = await fetch(`${baseUrl}/api/polar/auth/url?flow=popup`);
    jar.absorbResponse(okResp);
    expect(okResp.status).toBe(200);
    const data = (await okResp.json()) as { url: string; state: string; clientId: string };
    expect(data.url).toContain('https://flow.polar.com/oauth2/authorization');
    expect(data.url).not.toContain('code_challenge');
    expect(data.clientId).toBe('polar_client_123');
    expect(jar.headerValue()).toContain('thresh_oauth_state=');
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);
  });

  it('issues Wahoo authorization URL with PKCE S256 code_challenge and CSRF state cookie', async () => {
    process.env.WAHOO_CLIENT_ID = 'wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'wahoo_secret_456';

    const jar = new TestCookieJar();
    const resp = await fetch(`${baseUrl}/api/wahoo/auth/url?flow=popup`);
    jar.absorbResponse(resp);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { url: string; state: string };
    const parsedUrl = new URL(data.url);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe('https://api.wahooligan.com/oauth/authorize');
    expect(parsedUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsedUrl.searchParams.get('scope')).toBe(
      'user_read workouts_read workouts_write plans_write'
    );
    expect(jar.headerValue()).toContain('thresh_oauth_state=');
  });

  it('rejects missing or mismatched CSRF state cookies with HTTP 400 on Polar & Wahoo callbacks', async () => {
    process.env.POLAR_CLIENT_ID = 'polar_client_123';
    process.env.POLAR_CLIENT_SECRET = 'polar_secret_456';
    process.env.WAHOO_CLIENT_ID = 'wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'wahoo_secret_456';

    const wahooUrlResp = await fetch(`${baseUrl}/api/wahoo/auth/url`);
    const { state } = (await wahooUrlResp.json()) as { state: string };

    // Missing cookie completely
    const polarCb = await fetch(`${baseUrl}/auth/polar/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(polarCb.status).toBe(400);
    expect(await polarCb.text()).toContain('Security Verification Failed');

    // Mismatched cookie nonce
    const wahooCb = await fetch(
      `${baseUrl}/auth/wahoo/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: 'thresh_oauth_state=forged_nonce_00000' } }
    );
    expect(wahooCb.status).toBe(400);
    expect(await wahooCb.text()).toContain('Security Verification Failed');
  });

  it('exchanges Wahoo PKCE code with code_verifier, stores scoped tokens, and disconnects cleanly for both Polar & Wahoo', async () => {
    process.env.POLAR_CLIENT_ID = 'polar_client_123';
    process.env.POLAR_CLIENT_SECRET = 'polar_secret_456';
    process.env.WAHOO_CLIENT_ID = 'wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'wahoo_secret_456';

    const jar = new TestCookieJar();
    const authUrlResp = await fetch(`${baseUrl}/api/wahoo/auth/url?flow=popup`);
    jar.absorbResponse(authUrlResp);
    const { state } = (await authUrlResp.json()) as { state: string };

    let sentCodeVerifier = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (targetUrl === 'https://api.wahooligan.com/oauth/token') {
        const bodyParams = new URLSearchParams(String(init?.body || ''));
        sentCodeVerifier = bodyParams.get('code_verifier') || '';
        return new Response(
          JSON.stringify({
            access_token: 'wahoo_acc_987',
            refresh_token: 'wahoo_ref_654',
            expires_in: 7200,
            scope: 'user_read workouts_read',
            user: { id: 8822, first_name: 'Elena', last_name: 'Vance' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const cbResp = await fetch(
      `${baseUrl}/auth/wahoo/callback?code=wahoo_code_ok&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: jar.headerValue() } }
    );
    jar.absorbResponse(cbResp);
    expect(cbResp.status).toBe(200);
    const html = await cbResp.text();
    expect(sentCodeVerifier.length).toBeGreaterThan(20);
    expect(html).toContain('OAUTH_AUTH_SUCCESS');
    expect(html).toContain('aeropulse_wahoo_connected');
    expect(html).toContain('Elena Vance');

    // Disconnect Wahoo & verify store tokens cleared + { connected: false }
    const disconnectWahoo = await fetch(`${baseUrl}/api/wahoo/disconnect`, {
      method: 'POST',
      headers: { Cookie: jar.headerValue() },
    });
    expect(disconnectWahoo.status).toBe(200);
    expect(await disconnectWahoo.json()).toEqual({ connected: false });

    // Disconnect Polar & verify { connected: false } + clean token getters under empty context
    const disconnectPolar = await fetch(`${baseUrl}/api/polar/disconnect`, {
      method: 'POST',
      headers: { Cookie: jar.headerValue() },
    });
    expect(disconnectPolar.status).toBe(200);
    expect(await disconnectPolar.json()).toEqual({ connected: false });

    const reqShim = { headers: {} } as unknown as express.Request;
    requestContext.run(reqShim, () => {
      bindRequestScopeKey(reqShim, 'oauth_factory_probe_sid');
      expect(getEffectiveWahooTokens(reqShim).accessToken).toBe('');
      expect(getEffectivePolarTokens(reqShim).accessToken).toBe('');
    });
  });
});
