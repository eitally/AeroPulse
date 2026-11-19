import http from 'http';
import vm from 'vm';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { deriveStravaSessionSid } from '../server/securityUtils.ts';
import { deleteTenantVault } from '../server/tokenVault.ts';
import { hasPendingTeamJoinInBrowser } from '../src/utils/telemetryStorage.ts';

function extractCallbackPayloadAndScript(html: string): { payload: any; scriptBody: string } {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Missing <script> block in Strava callback HTML');
  return {
    payload: null,
    scriptBody: match[1],
  };
}

function executeCallbackHtmlScript(
  html: string,
  initialLocalStorage: Record<string, string> = {}
) {
  const { scriptBody } = extractCallbackPayloadAndScript(html);
  const store = new Map<string, string>(Object.entries(initialLocalStorage));
  const localStorageMock = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  let replacedUrl = '';
  const windowMock: any = {
    opener: null,
    name: '',
    location: {
      origin: 'http://127.0.0.1:3000',
      href: '',
      replace: (u: string) => {
        replacedUrl = u;
      },
    },
    close: () => {},
  };
  const postedMessages: any[] = [];
  class BroadcastChannelMock {
    constructor(_name: string) {}
    postMessage(msg: any) {
      postedMessages.push(msg);
    }
    close() {}
  }

  vm.runInNewContext(scriptBody, {
    localStorage: localStorageMock,
    window: windowMock,
    BroadcastChannel: BroadcastChannelMock,
    setTimeout: (_fn: any) => 0,
  });

  return { store, replacedUrl, postedMessages };
}

describe('Option A · 1-Click Homepage Strava Login & Pending Team Join Behavior', () => {
  const originalFetch = globalThis.fetch;
  const origWindow = globalThis.window;
  const envBackup: Record<string, string | undefined> = {};
  let server: http.Server | null = null;
  let baseUrl = '';
  const createdAthleteIds: string[] = [];

  beforeEach(async () => {
    for (const k of [
      'STRAVA_CLIENT_ID',
      'STRAVA_CLIENT_SECRET',
      'SESSION_SECRET',
      'TOKEN_VAULT_KEY',
    ]) {
      envBackup[k] = process.env[k];
    }
    process.env.STRAVA_CLIENT_ID = '144999';
    process.env.STRAVA_CLIENT_SECRET = 'strava_opt_a_secret_abcdef123456';
    process.env.SESSION_SECRET = 'thresh_opt_a_session_secret_0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(apiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (origWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    for (const athId of createdAthleteIds.splice(0)) {
      const sid = deriveStravaSessionSid(athId);
      await deleteTenantVault(`session_${sid.slice(0, 24)}`);
    }
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function mockStravaTokenExchange(athleteId: string) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://www.strava.com/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: `at_${athleteId}`,
            refresh_token: `rt_${athleteId}`,
            expires_at: Math.floor(Date.now() / 1000) + 21600,
            athlete: {
              id: Number(athleteId),
              firstname: 'Jordan',
              lastname: 'Fast',
              measurement_preference: 'feet',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;
  }

  it('routes standalone Strava OAuth straight to /#fitness, initializes smart default sync policy, and preserves same-athlete custom policies', async () => {
    const athleteId = `9101${Math.floor(1000 + Math.random() * 8999)}`;
    const otherAthleteId = `9102${Math.floor(1000 + Math.random() * 8999)}`;
    createdAthleteIds.push(athleteId, otherAthleteId);
    mockStravaTokenExchange(athleteId);

    const urlRes = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const oauthCookie1 = (urlRes.headers.getSetCookie?.() || [urlRes.headers.get('set-cookie') || ''])
      .map((s) => s.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const { state } = await urlRes.json();

    const cbRes = await originalFetch(
      `${baseUrl}/api/strava/callback?code=c_1&scope=read,activity:read_all,profile:read_all&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie1 } }
    );
    expect(cbRes.status).toBe(200);
    const html = await cbRes.text();
    expect(html).toContain('"returnUrl":"/#fitness"');
    expect(html).toContain('"hasPendingTeamJoin":false');
    expect(html).toContain('"hasExistingSyncPolicy":false');

    // First login with empty localStorage initializes 90d default and passes auth gate
    const firstRun = executeCallbackHtmlScript(html);
    expect(firstRun.replacedUrl).toBe('/#fitness');
    expect(firstRun.store.get('aeropulse_auth_gate_passed')).toBe('1');
    const policy1 = JSON.parse(firstRun.store.get('aeropulse_strava_sync_policy') || '{}');
    expect(policy1.window).toBe('90d');
    expect(policy1.importProfileAndGear).toBe(true);

    // Same athlete re-logging in after selecting window='all' keeps window='all'
    const customPolicyJson = JSON.stringify({
      window: 'all',
      importProfileAndGear: true,
      confirmedAt: '2026-11-10T00:00:00.000Z',
    });
    const sameAthReLogin = executeCallbackHtmlScript(html, {
      aeropulse_strava_athlete_id: athleteId,
      aeropulse_strava_sync_policy: customPolicyJson,
    });
    expect(sameAthReLogin.store.get('aeropulse_auth_gate_passed')).toBe('1');
    expect(
      JSON.parse(sameAthReLogin.store.get('aeropulse_strava_sync_policy') || '{}').window
    ).toBe('all');

    // Different athlete signing in clears previous athlete's policy & sets default '90d'
    mockStravaTokenExchange(otherAthleteId);
    const urlResOther = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const oauthCookie2 = (urlResOther.headers.getSetCookie?.() || [urlResOther.headers.get('set-cookie') || ''])
      .map((s) => s.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const { state: stateOther } = await urlResOther.json();
    const cbOther = await (
      await originalFetch(
        `${baseUrl}/api/strava/callback?code=c_2&scope=read,activity:read_all&state=${encodeURIComponent(stateOther)}`,
        { headers: { Cookie: oauthCookie2 } }
      )
    ).text();
    const diffAthLogin = executeCallbackHtmlScript(cbOther, {
      aeropulse_strava_athlete_id: athleteId,
      aeropulse_strava_sync_policy: customPolicyJson,
    });
    expect(
      JSON.parse(diffAthLogin.store.get('aeropulse_strava_sync_policy') || '{}').window
    ).toBe('90d');

    // Unchecking activity:read scope initializes window='none'
    mockStravaTokenExchange(athleteId);
    const urlResNoScope = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const oauthCookie3 = (urlResNoScope.headers.getSetCookie?.() || [urlResNoScope.headers.get('set-cookie') || ''])
      .map((s) => s.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const { state: stateNoScope } = await urlResNoScope.json();
    const cbNoScope = await (
      await originalFetch(
        `${baseUrl}/api/strava/callback?code=c_3&scope=read,profile:read_all&state=${encodeURIComponent(stateNoScope)}`,
        { headers: { Cookie: oauthCookie3 } }
      )
    ).text();
    const noScopeRun = executeCallbackHtmlScript(cbNoScope);
    expect(
      JSON.parse(noScopeRun.store.get('aeropulse_strava_sync_policy') || '{}').window
    ).toBe('none');
  });

  it('keeps onboarding returnUrl when joinCode is present so team invite claiming still runs', async () => {
    const athleteId = `9201${Math.floor(1000 + Math.random() * 8999)}`;
    createdAthleteIds.push(athleteId);
    mockStravaTokenExchange(athleteId);

    const urlRes = await originalFetch(
      `${baseUrl}/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}&joinCode=PAXC-26`
    );
    const oauthCookie = (urlRes.headers.getSetCookie?.() || [urlRes.headers.get('set-cookie') || ''])
      .map((s) => s.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const { state } = await urlRes.json();

    const cbRes = await originalFetch(
      `${baseUrl}/api/strava/callback?code=c_team&scope=read,activity:read_all&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie } }
    );
    expect(cbRes.status).toBe(200);
    const html = await cbRes.text();
    expect(html).toContain('"hasPendingTeamJoin":true');
    const teamRun = executeCallbackHtmlScript(html);
    expect(teamRun.replacedUrl).toContain('/?join=PAXC-26&oauth=strava_connected');
    expect(teamRun.postedMessages[0]?.hasPendingTeamJoin).toBe(true);
  });

  it('detects pending team joins across /, ?join=, /join/<slug>, and sessionStorage', () => {
    const setMockWindow = (pathname: string, search: string, storedJoin: string | null) => {
      (globalThis as any).window = {
        location: { pathname, search },
        sessionStorage: {
          getItem: (key: string) => (key === 'thresh_pending_team_join_v1' ? storedJoin : null),
        },
      };
    };

    setMockWindow('/', '', null);
    expect(hasPendingTeamJoinInBrowser()).toBe(false);

    setMockWindow('/', '?join=PAXC-26', null);
    expect(hasPendingTeamJoinInBrowser()).toBe(true);

    setMockWindow('/', '?team=paly-xc', null);
    expect(hasPendingTeamJoinInBrowser()).toBe(true);

    setMockWindow('/join/paly-xc', '', null);
    expect(hasPendingTeamJoinInBrowser()).toBe(true);

    setMockWindow('/', '', JSON.stringify({ codeOrSlug: 'PAXC-26' }));
    expect(hasPendingTeamJoinInBrowser()).toBe(true);

    setMockWindow('/', '', JSON.stringify({ codeOrSlug: '   ' }));
    expect(hasPendingTeamJoinInBrowser()).toBe(false);
  });
});
