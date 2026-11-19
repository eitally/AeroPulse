import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';
import { webhooksAndExportRouter } from '../server/routers/webhooksAndExportRouter.ts';
import {
  getEffectivePolarClientConfig,
  getEffectivePolarTokens,
  parsePolarDurationSecs,
} from '../server/apiRouter.ts';
import { mergeActivitiesNonDestructive, findMatchingActivityByProximity } from '../src/utils/telemetryStorage.ts';
import type { UnifiedActivity } from '../src/types.ts';

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

describe('CON-01 · Polar AccessLink Connector (OAuth 2.0, Webhook, rTSS & Smart Deduplication)', () => {
  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(apiRouter);
    app.use(webhooksAndExportRouter);

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
    for (const k of ['POLAR_CLIENT_ID', 'POLAR_CLIENT_SECRET', 'POLAR_REDIRECT_URI']) {
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

  it('rejects /api/polar/auth/url if client credentials are not configured', async () => {
    delete process.env.POLAR_CLIENT_ID;
    delete process.env.POLAR_CLIENT_SECRET;

    const res = await fetch(`${baseUrl}/api/polar/auth/url`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Polar OAuth is not configured');
  });

  it('generates standard OAuth 2.0 authorization URL with accesslink.read_all scope and signed state', async () => {
    process.env.POLAR_CLIENT_ID = 'test_polar_client_987';
    process.env.POLAR_CLIENT_SECRET = 'test_polar_secret_xyz';

    const res = await fetch(`${baseUrl}/api/polar/auth/url?flow=popup`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; clientId: string; state: string };

    expect(data.clientId).toBe('test_polar_client_987');
    expect(data.url).toContain('https://flow.polar.com/oauth2/authorization?');
    expect(data.url).toContain('client_id=test_polar_client_987');
    expect(data.url).toContain('scope=accesslink.read_all');
    expect(data.url).toContain('response_type=code');
    expect(data.state).toBeTruthy();
  });

  it('rejects /auth/polar/callback when state is missing or invalid', async () => {
    process.env.POLAR_CLIENT_ID = 'test_polar_client_987';
    process.env.POLAR_CLIENT_SECRET = 'test_polar_secret_xyz';

    const res = await fetch(`${baseUrl}/auth/polar/callback?code=mock_code&state=invalid.tampered.state`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Security Verification Failed');
  });

  it('handles user cancellation/denial cleanly on /auth/polar/callback', async () => {
    process.env.POLAR_CLIENT_ID = 'test_polar_client_987';
    process.env.POLAR_CLIENT_SECRET = 'test_polar_secret_xyz';

    const res = await fetch(`${baseUrl}/auth/polar/callback?error=access_denied`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Access was denied by the user on Polar');
  });

  it('exchanges OAuth authorization code via HTTP Basic auth, registers user, stores tokens, and renders success HTML', async () => {
    process.env.POLAR_CLIENT_ID = 'test_polar_client_987';
    process.env.POLAR_CLIENT_SECRET = 'test_polar_secret_xyz';

    // 1. Get signed state token + browser OAuth state cookie
    const jar = new SimpleCookieJar();
    const urlRes = await fetch(`${baseUrl}/api/polar/auth/url`);
    jar.absorbResponse(urlRes);
    const { state } = (await urlRes.json()) as { state: string };

    // 2. Mock Polar token exchange and user registration
    const mockTokenPayload = {
      token_type: 'bearer',
      access_token: 'polar_access_token_sec456',
      expires_in: 7776000,
      scope: 'accesslink.read_all',
      x_user_id: 88204,
    };

    let capturedAuthHdr = '';
    let capturedBodyStr = '';
    let userRegistered = false;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('polarremote.com/v2/oauth2/token')) {
        capturedAuthHdr = String((init?.headers as any)?.Authorization || '');
        capturedBodyStr = String(init?.body || '');
        return new Response(JSON.stringify(mockTokenPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('polarremote.com/v2/users')) {
        userRegistered = true;
        return new Response(JSON.stringify({ 'polar-user-id': 88204, 'member-id': 'mem_88204' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    // 3. Invoke callback with OAuth state cookie
    const callbackRes = await fetch(
      `${baseUrl}/auth/polar/callback?code=valid_polar_code_111&state=${encodeURIComponent(state)}`,
      { redirect: 'manual', headers: { Cookie: jar.headerValue() } }
    );

    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain('Polar Connected');
    expect(html).toContain('Polar Athlete 88204');
    expect(html).toContain('OAUTH_AUTH_SUCCESS');

    // Verify Basic auth was used with client_id:client_secret base64 encoded
    const expectedBasic = `Basic ${Buffer.from('test_polar_client_987:test_polar_secret_xyz').toString('base64')}`;
    expect(capturedAuthHdr).toBe(expectedBasic);
    expect(capturedBodyStr).toContain('grant_type=authorization_code');
    expect(capturedBodyStr).toContain('code=valid_polar_code_111');
    expect(userRegistered).toBe(true);

    // 4. Verify /api/config/status reports Polar connected via OAuth
    jar.absorbResponse(callbackRes);
    const statusRes = await fetch(`${baseUrl}/api/config/status`, {
      headers: { Cookie: jar.headerValue() },
    });
    const statusData = await statusRes.json();
    expect(statusData.polarConnected).toBe(true);
    expect(statusData.polarAthleteId).toBe('88204');
    expect(statusData.polarAthleteName).toBe('Polar Athlete 88204');
  });

  it('correctly parses ISO 8601 and numeric duration strings via parsePolarDurationSecs', () => {
    expect(parsePolarDurationSecs(3600)).toBe(3600);
    expect(parsePolarDurationSecs('1800')).toBe(1800);
    expect(parsePolarDurationSecs('PT42M30S')).toBe(2550);
    expect(parsePolarDurationSecs('PT1H15M20S')).toBe(4520);
    expect(parsePolarDurationSecs('PT55S')).toBe(55);
    expect(parsePolarDurationSecs('invalid')).toBe(0);
    expect(parsePolarDurationSecs(undefined)).toBe(0);
  });

  it('fetches and normalizes exercises with automatic rTSS and HR zone distribution', async () => {
    const mockExercises = [
      {
        id: 99101,
        upload_time: '2026-11-14T10:00:00.000Z',
        start_time: '2026-11-14T09:00:00.000Z',
        sport: 'RUNNING',
        detailed_sport_info: 'ROAD_RUNNING',
        duration: 'PT50M', // 3000 seconds
        distance: 10000, // 10k in 50 min = 5:00/km = 8:03/mi pace
        heart_rate: {
          average: 156,
          maximum: 174,
          zones: [
            { lower_limit: 100, upper_limit: 125, in_zone: 'PT5M' },
            { lower_limit: 126, upper_limit: 142, in_zone: 'PT10M' },
            { lower_limit: 143, upper_limit: 160, in_zone: 'PT25M' },
            { lower_limit: 161, upper_limit: 175, in_zone: 'PT10M' },
            { lower_limit: 176, upper_limit: 195, in_zone: 'PT0S' },
          ],
        },
        device: 'Polar Vantage V3',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('polarremote.com/v2/exercises')) {
        return new Response(JSON.stringify(mockExercises), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    const syncRes = await fetch(`${baseUrl}/api/polar/sync`, {
      headers: { 'x-polar-access-token': 'mock_polar_valid_token' },
    });
    expect(syncRes.status).toBe(200);
    const syncData = await syncRes.json();
    expect(syncData.exercisesCount).toBe(1);
    expect(syncData.activities.length).toBe(1);

    const act: UnifiedActivity = syncData.activities[0];
    expect(act.polarId).toBe('99101');
    expect(act.sportCategory).toBe('Running');
    expect(act.name).toBe('Polar Run');
    expect(act.movingTimeSecs).toBe(3000);
    expect(act.distanceMeters).toBe(10000);
    expect(act.avgHr).toBe(156);
    expect(act.maxHr).toBe(174);
    expect(act.sourceBadges).toContain('Polar');
    expect(act.deviceName).toBe('Polar Vantage V3');

    // Automatic running rTSS calculation
    expect(act.trainingLoad).toBeGreaterThan(50);
    expect(act.efficiencyFactor).toBeGreaterThan(0);

    // HR zone distribution mapping (0-based array indices matching Garmin Z1..Z5)
    expect(act.zoneSecs?.hr).toBeDefined();
    expect(act.zoneSecs!.hr.length).toBe(7);
    expect(act.zoneSecs!.hr[0]).toBe(300); // Z1: 5 min = 300s
    expect(act.zoneSecs!.hr[1]).toBe(600); // Z2: 10 min = 600s
    expect(act.zoneSecs!.hr[2]).toBe(1500); // Z3: 25 min = 1500s
    expect(act.zoneSecs!.hr[3]).toBe(600); // Z4: 10 min = 600s
  });

  it('receives Polar webhook and echoes verification challenge', async () => {
    // 1. Verification challenge
    const challengeRes = await fetch(`${baseUrl}/api/webhooks/polar?hub.challenge=test_polar_verify_challenge_55`);
    expect(challengeRes.status).toBe(200);
    const challengeText = await challengeRes.text();
    expect(challengeText).toBe('test_polar_verify_challenge_55');

    // 2. Webhook exercise notification payload
    const webhookPayload = {
      event: 'EXERCISE',
      user_id: 88204,
      entity_id: '99102',
      timestamp: '2026-11-14T12:00:00.000Z',
    };

    const webhookRes = await fetch(`${baseUrl}/api/webhooks/polar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });

    expect(webhookRes.status).toBe(200);
    const webhookData = await webhookRes.json();
    expect(webhookData.ok).toBe(true);
    expect(webhookData.provider).toBe('POLAR');
    expect(webhookData.cleanRoomEligibleForAiAndCoaching).toBe(true);
    expect(webhookData.polarEvent).toBe('EXERCISE');
    expect(webhookData.entityId).toBe('99102');
  });

  it('deduplicates Polar activities against existing Strava/Garmin/Wahoo activities within +/- 5 minutes without double-counting', () => {
    const existingStravaRun: UnifiedActivity = {
      id: 'strava_555666',
      stravaId: '555666',
      startDateLocal: '2026-11-14T07:02:00Z',
      name: 'Morning Tempo Run',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 2400,
      distanceMeters: 8000,
      elevationGainMeters: 45,
      trainingLoad: 55,
      avgHr: 162,
      maxHr: 178,
      aerobicDecouplingPct: 1.8,
      efficiencyFactor: 1.35,
      firstHalfEf: 1.36,
      secondHalfEf: 1.34,
      zoneSecs: { hr: [0, 200, 400, 1200, 600, 0, 0] },
      stravaPrCount: 1,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    };

    const incomingPolarRun: UnifiedActivity = {
      id: 'polar_99101',
      polarId: '99101',
      startDateLocal: '2026-11-14T07:00:00Z', // 2 minutes earlier (within +/- 300s)
      name: 'Polar Running',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 2410,
      distanceMeters: 8050,
      elevationGainMeters: 48,
      trainingLoad: 56,
      avgHr: 162,
      maxHr: 178,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.35,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 200, 400, 1200, 610, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Polar'],
      deviceName: 'Polar Pacer Pro',
    };

    // Test findMatchingActivityByProximity directly
    const match = findMatchingActivityByProximity(incomingPolarRun, [existingStravaRun], 300);
    expect(match).toBeDefined();
    expect(match?.id).toBe('strava_555666');

    // Test mergeActivitiesNonDestructive deduplication
    const merged = mergeActivitiesNonDestructive([existingStravaRun], [incomingPolarRun]);
    expect(merged.length).toBe(1); // Deduped! NOT double-counted!
    expect(merged[0].sourceBadges).toContain('Strava');
    expect(merged[0].sourceBadges).toContain('Polar');
    expect(merged[0].polarId).toBe('99101');
    expect(merged[0].stravaId).toBe('555666');
    expect(merged[0].deviceName).toBe('Polar Pacer Pro');
  });

  it('cleans up tokens upon /api/polar/disconnect', async () => {
    const disconnectRes = await fetch(`${baseUrl}/api/polar/disconnect`, {
      method: 'POST',
    });
    expect(disconnectRes.status).toBe(200);
    const data = await disconnectRes.json();
    expect(data.connected).toBe(false);

    const statusRes = await fetch(`${baseUrl}/api/config/status`);
    const statusData = await statusRes.json();
    expect(statusData.polarConnected).toBe(false);
  });
});
