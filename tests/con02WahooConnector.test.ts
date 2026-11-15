import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';
import { webhooksAndExportRouter } from '../server/routers/webhooksAndExportRouter.ts';
import {
  getEffectiveWahooClientConfig,
  getEffectiveWahooTokens,
  ensureValidWahooAccessToken,
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

describe('CON-02 · Wahoo Cloud API Connector (OAuth 2.0 / PKCE, Webhook & Smart Deduplication)', () => {
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
    for (const k of ['WAHOO_CLIENT_ID', 'WAHOO_CLIENT_SECRET', 'WAHOO_REDIRECT_URI']) {
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

  it('rejects /api/wahoo/auth/url if client credentials are not configured', async () => {
    delete process.env.WAHOO_CLIENT_ID;
    delete process.env.WAHOO_CLIENT_SECRET;

    const res = await fetch(`${baseUrl}/api/wahoo/auth/url`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Wahoo OAuth is not configured');
  });

  it('generates standard OAuth 2.0 / PKCE authorization URL with user_read workouts_read scopes and code_challenge', async () => {
    process.env.WAHOO_CLIENT_ID = 'test_wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'test_wahoo_secret_abc';

    const res = await fetch(`${baseUrl}/api/wahoo/auth/url?flow=popup`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; clientId: string; state: string };

    expect(data.clientId).toBe('test_wahoo_client_123');
    expect(data.url).toContain('https://api.wahooligan.com/oauth/authorize?');
    expect(data.url).toContain('client_id=test_wahoo_client_123');
    expect(data.url).toContain('scope=user_read+workouts_read');
    expect(data.url).toContain('response_type=code');
    expect(data.url).toContain('code_challenge=');
    expect(data.url).toContain('code_challenge_method=S256');
    expect(data.state).toBeTruthy();
  });

  it('rejects /auth/wahoo/callback when state is missing or invalid', async () => {
    process.env.WAHOO_CLIENT_ID = 'test_wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'test_wahoo_secret_abc';

    const res = await fetch(`${baseUrl}/auth/wahoo/callback?code=mock_code&state=invalid.tampered.state`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Security Verification Failed');
  });

  it('handles user cancellation/denial cleanly on /auth/wahoo/callback', async () => {
    process.env.WAHOO_CLIENT_ID = 'test_wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'test_wahoo_secret_abc';

    const res = await fetch(`${baseUrl}/auth/wahoo/callback?error=access_denied`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Access was denied by the user on Wahoo');
  });

  it('exchanges OAuth authorization code with PKCE code_verifier, stores tokens, and renders success HTML', async () => {
    process.env.WAHOO_CLIENT_ID = 'test_wahoo_client_123';
    process.env.WAHOO_CLIENT_SECRET = 'test_wahoo_secret_abc';

    // 1. Get a valid signed state token with PKCE challenge
    const urlRes = await fetch(`${baseUrl}/api/wahoo/auth/url`);
    const { state } = (await urlRes.json()) as { state: string };

    // 2. Mock Wahoo token exchange endpoint
    const mockTokenPayload = {
      token_type: 'bearer',
      access_token: 'wahoo_access_token_sec789',
      refresh_token: 'wahoo_refresh_token_ref123',
      expires_in: 7200,
      scope: 'user_read workouts_read',
      user: {
        id: 77102,
        first_name: 'ELEMNT',
        last_name: 'Rider',
        email: 'rider@example.com',
      },
    };

    let capturedBodyStr = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('api.wahooligan.com/oauth/token')) {
        capturedBodyStr = String(init?.body || '');
        return new Response(JSON.stringify(mockTokenPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    // 3. Invoke callback
    const callbackRes = await fetch(
      `${baseUrl}/auth/wahoo/callback?code=valid_wahoo_code_999&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' }
    );

    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain('Wahoo Connected');
    expect(html).toContain('ELEMNT Rider');
    expect(html).toContain('OAUTH_AUTH_SUCCESS');
    const parsedBody = new URLSearchParams(capturedBodyStr);
    expect(parsedBody.get('code_verifier')).toBeTruthy();
    expect(parsedBody.get('code')).toBe('valid_wahoo_code_999');

    // 4. Verify /api/config/status reports Wahoo connected via OAuth
    const jar = new SimpleCookieJar();
    jar.absorbResponse(callbackRes);
    const statusRes = await fetch(`${baseUrl}/api/config/status`, {
      headers: { Cookie: jar.headerValue() },
    });
    const statusData = await statusRes.json();
    expect(statusData.wahooConnected).toBe(true);
    expect(statusData.wahooAthleteId).toBe('77102');
    expect(statusData.wahooAthleteName).toBe('ELEMNT Rider');
  });

  it('fetches workouts from /api/wahoo/workouts and streams FIT file from /api/wahoo/workouts/:id/file', async () => {
    const mockWorkouts = [
      {
        id: 44101,
        starts: '2026-11-14T09:00:00.000Z',
        name: 'Morning Sweet Spot Over-Unders',
        workout_type_id: 1, // Cycling
        workout_summary: {
          ascent_metres: 380,
          cadence_avg: 88,
          distance_metres: 31200,
          duration_active_seconds: 4200,
          duration_seconds: 4300,
          heart_rate_avg: 154,
          power_avg: 245,
        },
        file: {
          url: 'https://api.wahooligan.com/v1/workouts/44101/file',
          extension: '.fit',
        },
      },
    ];

    const mockFitBytes = new Uint8Array([0x0e, 0x10, 0x44, 0x08, 0x2e, 0x46, 0x49, 0x54]);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes('api.wahooligan.com/v1/workouts/44101/file')) {
        return new Response(mockFitBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      if (urlStr.includes('api.wahooligan.com/v1/workouts')) {
        return new Response(JSON.stringify({ workouts: mockWorkouts }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as any;

    // 1. Fetch workouts
    const workoutsRes = await fetch(`${baseUrl}/api/wahoo/workouts`, {
      headers: { 'x-wahoo-access-token': 'mock_wahoo_valid_token' },
    });
    expect(workoutsRes.status).toBe(200);
    const workoutsData = await workoutsRes.json();
    expect(workoutsData.workouts.length).toBe(1);
    expect(workoutsData.workouts[0].name).toBe('Morning Sweet Spot Over-Unders');

    // 2. Fetch .FIT file
    const fitRes = await fetch(`${baseUrl}/api/wahoo/workouts/44101/file`, {
      headers: { 'x-wahoo-access-token': 'mock_wahoo_valid_token' },
    });
    expect(fitRes.status).toBe(200);
    expect(fitRes.headers.get('content-type')).toContain('application/octet-stream');
    const fitBuf = await fitRes.arrayBuffer();
    expect(new Uint8Array(fitBuf)[4]).toBe(0x2e); // '.' in '.FIT'
  });

  it('receives workout_summary webhook and echoes verification challenge', async () => {
    // 1. Verification challenge
    const challengeRes = await fetch(`${baseUrl}/api/webhooks/wahoo?hub.challenge=test_wahoo_verify_challenge_99`);
    expect(challengeRes.status).toBe(200);
    const challengeText = await challengeRes.text();
    expect(challengeText).toBe('test_wahoo_verify_challenge_99');

    // 2. Webhook workout summary payload
    const webhookPayload = {
      event_type: 'workout_summary',
      user: { id: 77102 },
      workout: {
        id: 44102,
        starts: '2026-11-14T11:00:00.000Z',
        workout_type_id: 1,
        workout_summary: {
          distance_metres: 45000,
          duration_seconds: 5400,
          power_avg: 215,
        },
        file: {
          url: 'https://api.wahooligan.com/v1/workouts/44102/file',
        },
      },
    };

    const webhookRes = await fetch(`${baseUrl}/api/webhooks/wahoo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });

    expect(webhookRes.status).toBe(200);
    const webhookData = await webhookRes.json();
    expect(webhookData.ok).toBe(true);
    expect(webhookData.provider).toBe('WAHOO');
    expect(webhookData.cleanRoomEligibleForAiAndCoaching).toBe(true);
    expect(webhookData.workoutId).toBe(44102);
    expect(webhookData.fileUrl).toBe('https://api.wahooligan.com/v1/workouts/44102/file');
  });

  it('deduplicates Wahoo workouts against existing Strava/Garmin activities within +/- 5 minutes without double-counting', () => {
    const existingStravaRide: UnifiedActivity = {
      id: 'strava_123456',
      stravaId: '123456',
      startDateLocal: '2026-11-14T09:02:15Z',
      name: 'Morning Group Ride',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3600,
      distanceMeters: 30000,
      elevationGainMeters: 320,
      avgPower: 220,
      normalizedPower: 240,
      trainingLoad: 75,
      avgHr: 148,
      maxHr: 172,
      aerobicDecouplingPct: 2.1,
      efficiencyFactor: 1.48,
      firstHalfEf: 1.5,
      secondHalfEf: 1.46,
      zoneSecs: { hr: [0, 600, 1800, 1200, 0, 0, 0] },
      stravaPrCount: 2,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    };

    const incomingWahooRide: UnifiedActivity = {
      id: 'wahoo_44101',
      wahooId: '44101',
      startDateLocal: '2026-11-14T09:00:00Z', // 2 min 15 sec earlier (within +/- 300s)
      name: 'ELEMNT ROAM Morning Ride',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3615,
      distanceMeters: 30120,
      elevationGainMeters: 325,
      avgPower: 222,
      normalizedPower: 242,
      trainingLoad: 76,
      avgHr: 148,
      maxHr: 173,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.5,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Wahoo'],
      deviceName: 'Wahoo ELEMNT ROAM v2',
    };

    // Test findMatchingActivityByProximity directly
    const match = findMatchingActivityByProximity(incomingWahooRide, [existingStravaRide], 300);
    expect(match).toBeDefined();
    expect(match?.id).toBe('strava_123456');

    // Test mergeActivitiesNonDestructive deduplication
    const merged = mergeActivitiesNonDestructive([existingStravaRide], [incomingWahooRide]);
    expect(merged.length).toBe(1); // Deduped! NOT double-counted!
    expect(merged[0].sourceBadges).toContain('Strava');
    expect(merged[0].sourceBadges).toContain('Wahoo');
    expect(merged[0].wahooId).toBe('44101');
    expect(merged[0].stravaId).toBe('123456');
    expect(merged[0].trainingLoad).toBe(76);
  });

  it('does NOT deduplicate workouts beyond the 5-minute window or with differing sports', () => {
    const morningRide: UnifiedActivity = {
      id: 'strava_ride_1',
      stravaId: 'ride_1',
      startDateLocal: '2026-11-14T08:00:00Z',
      name: 'Morning Ride',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3600,
      distanceMeters: 28000,
      elevationGainMeters: 200,
      trainingLoad: 60,
      avgHr: 140,
      maxHr: 160,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.4,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Strava'],
    };

    const afternoonRide: UnifiedActivity = {
      id: 'wahoo_ride_2',
      wahooId: 'ride_2',
      startDateLocal: '2026-11-14T14:00:00Z', // 6 hours later
      name: 'Afternoon Ride',
      sportCategory: 'Cycling',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 3600,
      distanceMeters: 30000,
      elevationGainMeters: 250,
      trainingLoad: 65,
      avgHr: 145,
      maxHr: 165,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.4,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Wahoo'],
    };

    const morningRun: UnifiedActivity = {
      id: 'wahoo_run_1',
      wahooId: 'run_1',
      startDateLocal: '2026-11-14T08:01:00Z', // 1 min later, but Run vs Cycling
      name: 'Morning Warmup Jog',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Road',
      movingTimeSecs: 600,
      distanceMeters: 1500,
      elevationGainMeters: 10,
      trainingLoad: 12,
      avgHr: 130,
      maxHr: 145,
      aerobicDecouplingPct: 0,
      efficiencyFactor: 1.2,
      firstHalfEf: 0,
      secondHalfEf: 0,
      zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: ['Wahoo'],
    };

    const mergedTimeSeparated = mergeActivitiesNonDestructive([morningRide], [afternoonRide]);
    expect(mergedTimeSeparated.length).toBe(2);

    const mergedSportSeparated = mergeActivitiesNonDestructive([morningRide], [morningRun]);
    expect(mergedSportSeparated.length).toBe(2);
  });

  it('cleans up tokens upon /api/wahoo/disconnect', async () => {
    const disconnectRes = await fetch(`${baseUrl}/api/wahoo/disconnect`, {
      method: 'POST',
    });
    expect(disconnectRes.status).toBe(200);
    const data = await disconnectRes.json();
    expect(data.connected).toBe(false);

    const statusRes = await fetch(`${baseUrl}/api/config/status`);
    const statusData = await statusRes.json();
    expect(statusData.wahooConnected).toBe(false);
  });
});
