import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { corosRouter } from '../server/routers/corosRouter.ts';
import { buildCorosWorkoutPayload } from '../server/corosConnectService.ts';
import { buildGarminTrainingApiV2Payload } from '../server/garminConnectService.ts';
import { SESSION_COOKIE_NAME } from '../server/securityUtils.ts';
import { requestContext, responseByReq } from '../server/sessionContext.ts';

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

describe('Sprint 2 Track 2A · Official Garmin Partner OAuth, COROS Open API & Cross-Watch Push', () => {
  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;
  const envBackup: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'GARMIN_CLIENT_ID',
    'GARMIN_CLIENT_SECRET',
    'GARMIN_REDIRECT_URI',
    'GARMIN_PERSONAL_API_KEY',
    'COROS_CLIENT_ID',
    'COROS_CLIENT_SECRET',
    'COROS_REDIRECT_URI',
    'INTERVALS_CLIENT_ID',
    'INTERVALS_CLIENT_SECRET',
    'INTERVALS_REDIRECT_URI',
    'SESSION_SECRET',
  ];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      responseByReq.set(req, res);
      requestContext.run(req, () => next());
    });
    app.use(apiRouter);
    app.use(corosRouter);

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
    process.env.SESSION_SECRET = 'test_sprint2a_session_secret_0123456789';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (envBackup[k] === undefined) delete process.env[k];
      else process.env[k] = envBackup[k];
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Legacy Garmin Non-MFA Password Scraping Removal & Hygiene', () => {
    it('rejects email/password login on POST /api/config/garmin with HTTP 410 Deprecated', async () => {
      const res = await fetch(`${baseUrl}/api/config/garmin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'runner@example.com',
          password: 'super-secret-password',
        }),
      });
      expect(res.status).toBe(410);
      const body = (await res.json()) as {
        ok: boolean;
        deprecated?: boolean;
        error?: string;
      };
      expect(body.ok).toBe(false);
      expect(body.deprecated).toBe(true);
      expect(body.error).toContain('Garmin password login has been removed');
      expect(body.error).toContain('Official Garmin Partner OAuth');
    });

    it('preserves read-only GCDC Personal API Key connection while marking push capability false', async () => {
      const jar = new TestCookieJar();
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        if (url.includes('personal-api-key/token')) {
          return new Response(
            JSON.stringify({ access_token: 'gcdc_bearer_readonly_123', expires_in: 3600 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not mocked', { status: 404 });
      }) as typeof fetch;

      const connectRes = await fetch(`${baseUrl}/api/config/garmin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalApiKey: 'GCDC_TEST_PERSONAL_KEY_001' }),
      });
      jar.absorbResponse(connectRes);
      expect(connectRes.status).toBe(200);
      const connectJson = (await connectRes.json()) as {
        ok: boolean;
        garminConnected: boolean;
        garminAuthMethod: string;
        garminCanPushWorkouts: boolean;
      };
      expect(connectJson.ok).toBe(true);
      expect(connectJson.garminConnected).toBe(true);
      expect(connectJson.garminAuthMethod).toBe('PERSONAL_KEY');
      expect(connectJson.garminCanPushWorkouts).toBe(false);
      expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);

      const statusRes = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as {
        garminConnected: boolean;
        garminAuthMethod: string;
        garminCanPushWorkouts: boolean;
      };
      expect(statusJson.garminConnected).toBe(true);
      expect(statusJson.garminAuthMethod).toBe('PERSONAL_KEY');
      expect(statusJson.garminCanPushWorkouts).toBe(false);

      // Attempting Training API push with read-only GCDC key returns 403 or 503 with requiresPartnerOAuth
      delete process.env.GARMIN_CLIENT_ID;
      delete process.env.GARMIN_CLIENT_SECRET;
      const pushRes = await fetch(`${baseUrl}/api/garmin/workout/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({
          date: '2026-04-12',
          name: 'VO2 Max Repeats',
          sportCategory: 'Running',
          workoutSyntax: '- 4x(400m @5K + 200m jog)',
        }),
      });
      expect(pushRes.status).toBe(503);
      const pushJson = (await pushRes.json()) as {
        ok: boolean;
        requiresPartnerOAuth?: boolean;
        setupRequired?: boolean;
      };
      expect(pushJson.ok).toBe(false);
      expect(pushJson.requiresPartnerOAuth).toBe(true);
      expect(pushJson.setupRequired).toBe(true);

      // Cleanup GCDC session
      await fetch(`${baseUrl}/api/config/garmin`, {
        method: 'DELETE',
        headers: { Cookie: jar.headerValue() },
      });
    });

    it('contains zero legacy SSO scraping or aeropulse_session_token leaks across owned source files', () => {
      const root = process.cwd();
      const garminServiceSrc = fs.readFileSync(
        path.join(root, 'server/garminConnectService.ts'),
        'utf-8'
      );
      expect(garminServiceSrc).not.toContain('sso.garmin.com');
      expect(garminServiceSrc).not.toContain('preauthorized');
      expect(garminServiceSrc).not.toContain('_csrf');

      const dataSourcesSrc = fs.readFileSync(
        path.join(root, 'src/components/DataSourcesModal.tsx'),
        'utf-8'
      );
      expect(dataSourcesSrc).not.toContain('handleGarminCredentialsSubmit');
      expect(dataSourcesSrc).not.toContain('garminMfaCode');
      expect(dataSourcesSrc).not.toContain('garminEmail');
      expect(dataSourcesSrc).not.toContain('garminPassword');
      expect(dataSourcesSrc).not.toContain("garminMode === 'CREDENTIALS'");
      expect(dataSourcesSrc).not.toContain('aeropulse_session_token');
      expect(dataSourcesSrc).not.toMatch(/getItem\(['"]aeropulse_garmin_bearer_token/);
      expect(dataSourcesSrc).not.toMatch(/setItem\(['"]aeropulse_garmin_bearer_token/);

      const factorySrc = fs.readFileSync(
        path.join(root, 'server/oauthConnectorFactory.ts'),
        'utf-8'
      );
      expect(factorySrc).not.toContain('aeropulse_session_token');
      expect(factorySrc).toContain('thresh_session_active_hint');

      const intervalsRouterSrc = fs.readFileSync(
        path.join(root, 'server/routers/intervalsRouter.ts'),
        'utf-8'
      );
      expect(intervalsRouterSrc).not.toContain('aeropulse_session_token');

      const exportActionsSrc = fs.readFileSync(
        path.join(root, 'src/utils/workoutExportActions.ts'),
        'utf-8'
      );
      expect(exportActionsSrc).not.toContain('aeropulse_session_token');
      expect(exportActionsSrc).not.toContain('aeropulse_garmin_bearer_token');
      expect(exportActionsSrc).toContain("credentials: 'include'");

      const readinessCardSrc = fs.readFileSync(
        path.join(root, 'src/components/ReadinessMorphingCard.tsx'),
        'utf-8'
      );
      expect(readinessCardSrc).not.toContain('aeropulse_session_token');
      expect(readinessCardSrc).not.toContain('aeropulse_garmin_bearer_token');
      expect(readinessCardSrc).toContain('pushWorkoutToWearable');
    });
  });

  describe('2. Official Garmin Health/Training Partner OAuth 2.0 PKCE & Training API v2', () => {
    it('returns clean HTTP 503 setup response when GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET are not configured', async () => {
      delete process.env.GARMIN_CLIENT_ID;
      delete process.env.GARMIN_CLIENT_SECRET;

      const res = await fetch(`${baseUrl}/api/garmin/auth/url?flow=popup`);
      expect(res.status).toBe(503);
      const data = (await res.json()) as {
        ok: boolean;
        configured: boolean;
        setupRequired: boolean;
        error: string;
      };
      expect(data.ok).toBe(false);
      expect(data.configured).toBe(false);
      expect(data.setupRequired).toBe(true);
      expect(data.error).toContain('GARMIN_CLIENT_ID');
    });

    it('builds Official Garmin Training API v2 structured workout JSON with RepeatGroupDTO for track intervals', () => {
      const payload = buildGarminTrainingApiV2Payload({
        date: '2026-04-15',
        name: 'Track 4x400m @ 5K',
        sportCategory: 'Running',
        workoutSyntax: [
          '- 10m 68% Pace Warmup',
          'Main Set 4x',
          '- 400m 110% Pace',
          '- 200m 58% Pace Jog',
          '- 10m 65% Pace Cooldown',
        ].join('\n'),
        thresholdPaceSecsPerKm: 240,
      });

      expect(payload.workoutName).toBe('Track 4x400m @ 5K');
      expect(payload.sportType.sportTypeKey).toBe('running');
      expect(payload.workoutSegments.length).toBe(1);
      const steps = payload.workoutSegments[0].workoutSteps;
      const repeatNode = steps.find((s) => s.type === 'RepeatGroupDTO');
      expect(repeatNode).toBeDefined();
      expect(repeatNode?.numberOfIterations).toBe(4);
      expect(repeatNode?.workoutSteps?.length).toBeGreaterThanOrEqual(2);
      const workStep = repeatNode?.workoutSteps?.[0];
      expect(workStep?.endCondition?.conditionTypeKey).toBe('distance');
      expect(workStep?.endConditionValue).toBe(400);
      expect(workStep?.targetType?.workoutTargetTypeKey).toBe('pace.zone');
      expect(workStep?.targetValueOne).toBeGreaterThan(3.0);
    });

    it('completes OAuth 2.0 PKCE flow, refreshes token when expired, and pushes structured workout via Training API v2', async () => {
      process.env.GARMIN_CLIENT_ID = 'garmin_partner_id_123';
      process.env.GARMIN_CLIENT_SECRET = 'garmin_partner_secret_xyz';
      const jar = new TestCookieJar();

      const authRes = await fetch(`${baseUrl}/api/garmin/auth/url?flow=popup`);
      jar.absorbResponse(authRes);
      expect(authRes.status).toBe(200);
      const authData = (await authRes.json()) as {
        url: string;
        state: string;
        redirectUri: string;
      };
      expect(authData.url).toContain('https://connect.garmin.com/oauth2Confirm?');
      expect(authData.url).toContain('code_challenge_method=S256');
      expect(authData.url).toContain('code_challenge=');
      expect(authData.redirectUri).toContain('/auth/garmin/callback');

      const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        if (url === 'https://diauth.garmin.com/di-oauth2-service/oauth/token') {
          const bodyStr = String(init?.body || '');
          if (bodyStr.includes('grant_type=authorization_code')) {
            expect(bodyStr).toContain('code_verifier=');
            return new Response(
              JSON.stringify({
                access_token: 'garmin_oauth_access_initial',
                refresh_token: 'garmin_oauth_refresh_abc',
                // Already expires within 30s so next push exercises refresh flow
                expires_in: 10,
                scope: 'WORKOUT_WRITE WELLNESS_READ',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (bodyStr.includes('grant_type=refresh_token')) {
            return new Response(
              JSON.stringify({
                access_token: 'garmin_oauth_access_refreshed',
                refresh_token: 'garmin_oauth_refresh_def',
                expires_in: 7200,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        if (url === 'https://apis.garmin.com/wellness-api/rest/user/id') {
          return new Response(JSON.stringify({ userId: 'g-partner-901' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === 'https://apis.garmin.com/training-api/workout/v2') {
          const authHdr = (init?.headers as Record<string, string> | undefined)?.Authorization;
          expect(authHdr).toBe('Bearer garmin_oauth_access_refreshed');
          const parsedBody = JSON.parse(String(init?.body || '{}')) as {
            workoutName: string;
            sportType?: { sportTypeKey?: string };
          };
          expect(parsedBody.workoutName).toBe('Threshold Cruise Miles');
          expect(parsedBody.sportType?.sportTypeKey).toBe('running');
          return new Response(JSON.stringify({ workoutId: 882104 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === 'https://apis.garmin.com/training-api/schedule/') {
          const parsedBody = JSON.parse(String(init?.body || '{}')) as {
            workoutId: number;
            date: string;
          };
          expect(parsedBody.workoutId).toBe(882104);
          expect(parsedBody.date).toBe('2026-04-20');
          return new Response(JSON.stringify({ scheduleId: 551902 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Unexpected URL', { status: 404 });
      });
      globalThis.fetch = fetchSpy as typeof fetch;

      const cbRes = await fetch(
        `${baseUrl}/auth/garmin/callback?code=garmin_auth_code_1&state=${encodeURIComponent(
          authData.state
        )}`,
        { headers: { Cookie: jar.headerValue() } }
      );
      jar.absorbResponse(cbRes);
      expect(cbRes.status).toBe(200);
      const cbHtml = await cbRes.text();
      expect(cbHtml).toContain('Garmin Connect');
      expect(cbHtml).toContain('thresh_session_active_hint');
      expect(cbHtml).not.toContain('aeropulse_session_token');
      expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);

      const statusRes = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      expect(statusRes.status).toBe(200);
      const statusJson = (await statusRes.json()) as {
        garminConfigured: boolean;
        garminConnected: boolean;
        garminAuthMethod: string;
        garminCanPushWorkouts: boolean;
      };
      expect(statusJson.garminConfigured).toBe(true);
      expect(statusJson.garminConnected).toBe(true);
      expect(statusJson.garminAuthMethod).toBe('OAUTH');
      expect(statusJson.garminCanPushWorkouts).toBe(true);

      const pushRes = await fetch(`${baseUrl}/api/garmin/workout/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({
          date: '2026-04-20',
          name: 'Threshold Cruise Miles',
          sportCategory: 'Running',
          workoutSyntax: '10m Warmup\n3x(1600m @LT + 60s Jog)\n10m Cooldown',
        }),
      });
      expect(pushRes.status).toBe(200);
      const pushJson = (await pushRes.json()) as {
        ok: boolean;
        pushed: boolean;
        workoutId: number;
        scheduleId: number;
      };
      expect(pushJson.ok).toBe(true);
      expect(pushJson.pushed).toBe(true);
      expect(pushJson.workoutId).toBe(882104);
      expect(pushJson.scheduleId).toBe(551902);
    });
  });

  describe('3. Official COROS Open API OAuth 2.0, Sync, Structured Push & Logout Cleanup', () => {
    it('returns clean HTTP 503 when COROS_CLIENT_ID / COROS_CLIENT_SECRET are not configured', async () => {
      delete process.env.COROS_CLIENT_ID;
      delete process.env.COROS_CLIENT_SECRET;

      const res = await fetch(`${baseUrl}/api/coros/auth/url?flow=popup`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        ok: boolean;
        configured: boolean;
        setupRequired: boolean;
      };
      expect(body.ok).toBe(false);
      expect(body.configured).toBe(false);
      expect(body.setupRequired).toBe(true);
    });

    it('builds COROS structured workout payload and exposes corosWorkoutJson in /api/workouts/export', async () => {
      const trackSyntax = [
        '- 10m 68% Pace Warmup',
        'Main Set 4x',
        '- 400m 110% Pace',
        '- 200m 58% Pace Jog',
        '- 10m 65% Pace Cooldown',
      ].join('\n');

      const payload = buildCorosWorkoutPayload({
        date: '2026-04-22',
        name: 'Track 4x400m @ 5K',
        sportCategory: 'Running',
        workoutSyntax: trackSyntax,
        thresholdPaceSecsPerKm: 240,
      });

      expect(payload.name).toBe('Track 4x400m @ 5K');
      expect(payload.sportType).toBe(103);
      expect(payload.subSportType).toBe('TrackRun');
      const repeatBlock = payload.stages.find((st) => st.stageType === 'repeat');
      expect(repeatBlock).toBeDefined();
      expect(repeatBlock?.repeatCount).toBe(4);
      expect(repeatBlock?.childStages?.[0].targetType).toBe('distance');
      expect(repeatBlock?.childStages?.[0].targetValue).toBe(400);

      const exportRes = await fetch(`${baseUrl}/api/workouts/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Track 4x400m @ 5K',
          sportCategory: 'Running',
          workoutSyntax: trackSyntax,
        }),
      });
      expect(exportRes.status).toBe(200);
      const exportJson = (await exportRes.json()) as {
        fitWorkoutBase64: string;
        corosWorkoutJson?: {
          sportType?: number;
          subSportType?: string;
          stages?: unknown[];
        };
      };
      expect(exportJson.fitWorkoutBase64).toBeTruthy();
      expect(exportJson.corosWorkoutJson).toBeTruthy();
      expect(exportJson.corosWorkoutJson?.sportType).toBe(103);
      expect(exportJson.corosWorkoutJson?.subSportType).toBe('TrackRun');
      expect(Array.isArray(exportJson.corosWorkoutJson?.stages)).toBe(true);
    });

    it('completes COROS OAuth 2.0 flow, syncs activities with COROS badge, pushes workout, and clears tokens on logout', async () => {
      process.env.COROS_CLIENT_ID = 'coros_client_999';
      process.env.COROS_CLIENT_SECRET = 'coros_secret_888';
      const jar = new TestCookieJar();

      const authRes = await fetch(`${baseUrl}/api/coros/auth/url?flow=popup`);
      jar.absorbResponse(authRes);
      expect(authRes.status).toBe(200);
      const authData = (await authRes.json()) as {
        url: string;
        state: string;
        redirectUri: string;
      };
      expect(authData.url).toContain('https://open.coros.com/oauth2/authorize?');
      expect(authData.redirectUri).toContain('/auth/coros/callback');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        if (url === 'https://open.coros.com/oauth2/accesstoken') {
          return new Response(
            JSON.stringify({
              access_token: 'coros_access_token_xyz',
              refresh_token: 'coros_refresh_token_xyz',
              expires_in: 7200,
              openId: 'coros_open_777',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.startsWith('https://open.coros.com/v2/coros/user/info')) {
          return new Response(
            JSON.stringify({
              data: { openId: 'coros_open_777', nickname: 'PACE 3 Runner' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.startsWith('https://open.coros.com/v2/coros/sport/list')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  labelId: 'coros_w_101',
                  name: 'Morning Track Session',
                  mode: 8,
                  startTime: Math.floor(new Date('2026-04-18T06:30:00Z').getTime() / 1000),
                  totalTime: 2400,
                  distance: 9200,
                  avgHr: 158,
                  maxHr: 184,
                  trainingLoad: 76,
                  deviceName: 'COROS PACE 3',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url === 'https://open.coros.com/v2/coros/workout/create') {
          return new Response(
            JSON.stringify({
              result: '0000',
              data: { workoutId: 'coros_workout_456' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Unexpected COROS URL', { status: 404 });
      }) as typeof fetch;

      const cbRes = await fetch(
        `${baseUrl}/auth/coros/callback?code=coros_code_1&state=${encodeURIComponent(
          authData.state
        )}`,
        { headers: { Cookie: jar.headerValue() } }
      );
      jar.absorbResponse(cbRes);
      expect(cbRes.status).toBe(200);
      const cbHtml = await cbRes.text();
      expect(cbHtml).toContain('COROS');
      expect(cbHtml).toContain('thresh_session_active_hint');
      expect(cbHtml).not.toContain('aeropulse_session_token');

      const statusRes = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      const statusJson = (await statusRes.json()) as {
        corosConfigured: boolean;
        corosConnected: boolean;
        corosAthleteId: string;
        corosAthleteName: string;
      };
      expect(statusJson.corosConfigured).toBe(true);
      expect(statusJson.corosConnected).toBe(true);
      expect(statusJson.corosAthleteId).toBe('coros_open_777');
      expect(statusJson.corosAthleteName).toBe('PACE 3 Runner');

      const syncRes = await fetch(`${baseUrl}/api/coros/sync?days=30`, {
        headers: { Cookie: jar.headerValue() },
      });
      expect(syncRes.status).toBe(200);
      const syncJson = (await syncRes.json()) as {
        ok: boolean;
        activities: Array<{
          corosId?: string;
          sourceBadges: string[];
          name: string;
          distanceMeters: number;
          trainingLoad: number;
        }>;
      };
      expect(syncJson.ok).toBe(true);
      expect(syncJson.activities.length).toBe(1);
      expect(syncJson.activities[0].corosId).toBe('coros_w_101');
      expect(syncJson.activities[0].sourceBadges).toEqual(['COROS']);
      expect(syncJson.activities[0].distanceMeters).toBe(9200);
      expect(syncJson.activities[0].trainingLoad).toBeGreaterThan(0);

      const pushRes = await fetch(`${baseUrl}/api/coros/workout/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({
          date: '2026-04-22',
          name: 'COROS Threshold Intervals',
          sportCategory: 'Running',
          workoutSyntax: '- 10m 68% Pace Warmup\nMain Set 4x\n- 400m 110% Pace\n- 200m 58% Pace Jog\n- 10m 65% Pace Cooldown',
        }),
      });
      expect(pushRes.status).toBe(200);
      const pushJson = (await pushRes.json()) as {
        ok: boolean;
        pushed: boolean;
        workoutId: string;
      };
      expect(pushJson.ok).toBe(true);
      expect(pushJson.pushed).toBe(true);
      expect(pushJson.workoutId).toBe('coros_workout_456');

      // Full credential clear logout wipes COROS state cleanly
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({ clearCredentials: true }),
      });
      jar.absorbResponse(logoutRes);
      expect(logoutRes.status).toBe(200);

      const afterLogoutStatus = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      const afterLogoutJson = (await afterLogoutStatus.json()) as {
        corosConnected: boolean;
        garminCanPushWorkouts: boolean;
      };
      expect(afterLogoutJson.corosConnected).toBe(false);
      expect(afterLogoutJson.garminCanPushWorkouts).toBe(false);
    });
  });

  describe('4. Intervals.icu CALENDAR:WRITE Cross-Watch Bridge Push & Scope Upgrade Guard', () => {
    it('pushes structured workout when CALENDAR:WRITE scope is active and rejects read-only tokens with needsScopeUpgrade', async () => {
      process.env.INTERVALS_CLIENT_ID = 'icu_client_id_test';
      process.env.INTERVALS_CLIENT_SECRET = 'icu_client_secret_test';
      const jar = new TestCookieJar();

      const authRes = await fetch(`${baseUrl}/api/intervals/auth/url?flow=popup`);
      jar.absorbResponse(authRes);
      const authData = (await authRes.json()) as { state: string };

      let scopeMode: 'READ_ONLY' | 'WRITE' = 'READ_ONLY';

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(baseUrl)) {
          return originalFetch(input, init);
        }
        if (url === 'https://intervals.icu/api/oauth/token') {
          return new Response(
            JSON.stringify({
              token_type: 'Bearer',
              access_token: scopeMode === 'WRITE' ? 'icu_write_tok' : 'icu_readonly_tok',
              scope:
                scopeMode === 'WRITE'
                  ? 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:WRITE'
                  : 'ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ',
              id: 'i55100',
              name: 'Bridge Tester',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/events')) {
          return new Response(JSON.stringify({ id: 99321 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Unexpected URL', { status: 404 });
      }) as typeof fetch;

      // 1) Connect read-only token
      const cbReadOnly = await fetch(
        `${baseUrl}/api/intervals/callback?code=c_ro&state=${encodeURIComponent(authData.state)}`,
        { headers: { Cookie: jar.headerValue() } }
      );
      jar.absorbResponse(cbReadOnly);
      expect(cbReadOnly.status).toBe(200);

      const statusReadOnly = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      const statusReadOnlyJson = (await statusReadOnly.json()) as {
        intervalsCanWriteCalendar?: boolean;
        intervalsScope?: string;
      };
      expect(statusReadOnlyJson.intervalsCanWriteCalendar).toBe(false);

      const pushReadOnly = await fetch(`${baseUrl}/api/intervals/workout/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({
          date: '2026-04-25',
          name: 'Bridge Workout',
          sportCategory: 'Running',
          workoutSyntax: '- 30m 80% Pace',
        }),
      });
      expect(pushReadOnly.status).toBe(403);
      const pushReadOnlyJson = (await pushReadOnly.json()) as {
        ok: boolean;
        needsScopeUpgrade?: boolean;
      };
      expect(pushReadOnlyJson.ok).toBe(false);
      expect(pushReadOnlyJson.needsScopeUpgrade).toBe(true);

      // 2) Upgrade to CALENDAR:WRITE
      scopeMode = 'WRITE';
      const authRes2 = await fetch(`${baseUrl}/api/intervals/auth/url?flow=popup`, {
        headers: { Cookie: jar.headerValue() },
      });
      jar.absorbResponse(authRes2);
      const authData2 = (await authRes2.json()) as { state: string };

      const cbWrite = await fetch(
        `${baseUrl}/api/intervals/callback?code=c_rw&state=${encodeURIComponent(authData2.state)}`,
        { headers: { Cookie: jar.headerValue() } }
      );
      jar.absorbResponse(cbWrite);
      expect(cbWrite.status).toBe(200);

      const statusWrite = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jar.headerValue() },
      });
      const statusWriteJson = (await statusWrite.json()) as {
        intervalsCanWriteCalendar?: boolean;
        intervalsScope?: string;
      };
      expect(statusWriteJson.intervalsCanWriteCalendar).toBe(true);
      expect(statusWriteJson.intervalsScope).toContain('CALENDAR:WRITE');

      const pushWrite = await fetch(`${baseUrl}/api/intervals/workout/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: jar.headerValue(),
        },
        body: JSON.stringify({
          date: '2026-04-25',
          name: 'Bridge Workout',
          sportCategory: 'Running',
          workoutSyntax: '- 30m 80% Pace',
        }),
      });
      expect(pushWrite.status).toBe(200);
      const pushWriteJson = (await pushWrite.json()) as {
        ok: boolean;
        pushed: boolean;
        eventId: number;
      };
      expect(pushWriteJson.ok).toBe(true);
      expect(pushWriteJson.pushed).toBe(true);
      expect(pushWriteJson.eventId).toBe(99321);
    });
  });
});
