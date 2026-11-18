import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import express from 'express';
import http from 'http';
import fs from 'fs';
import { apiRouter } from '../server/apiRouter.ts';
import {
  deriveStravaSessionSid,
  scopedStoresInMemory,
} from '../server/sessionContext.ts';
import { setSessionCookie } from '../server/securityUtils.ts';
import {
  deleteTenantVault,
  saveTenantVaultAsync,
} from '../server/tokenVault.ts';
import { resolveTeamPlanTier } from '../server/teamService.ts';
import { sanitizeAthleteCloudState } from '../server/routers/athleteStateRouter.ts';
import {
  buildShareWorkoutUrl,
  computeSharedWorkoutPreview,
  consumePendingSharedWorkout,
  decodeSharedWorkoutPayload,
  encodeSharedWorkoutPayload,
  peekPendingSharedWorkout,
  sanitizeSharedWorkoutPayload,
  sharedWorkoutToPlannedEventInput,
  stashPendingSharedWorkout,
} from '../src/utils/shareWorkoutEngine.ts';

function extractCookiePairs(
  setCookieHeader: string[] | string | undefined
): Record<string, string> {
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

describe('CLD-01: Cross-Device Cloud State Sync & Founding Team Tier Tracking', () => {
  let server: http.Server;
  let baseUrl = '';
  const origEnv = { ...process.env };
  const testAthleteId = '9876543210987';
  let testSid = '';

  beforeEach(async () => {
    process.env.SESSION_SECRET = 'test_session_secret_for_cld01_unit_suite_12345';
    testSid = deriveStravaSessionSid(testAthleteId);

    const app = express();
    app.use(express.json());
    app.post('/__test/login-device', async (req, res) => {
      const { athleteId } = req.body;
      const canonicalSid = deriveStravaSessionSid(athleteId);
      const scopeKey = canonicalSid.slice(0, 24);
      setSessionCookie(req, res, 'Device User', canonicalSid);
      await saveTenantVaultAsync(`session_${scopeKey}`, {
        stravaAthleteId: athleteId,
        stravaAthleteName: 'Device User',
      });
      res.json({ ok: true, sid: canonicalSid });
    });
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

  afterEach(async () => {
    process.env = { ...origEnv };
    scopedStoresInMemory.clear();
    if (testSid) {
      deleteTenantVault(`session_${testSid.slice(0, 24)}`);
      deleteTenantVault(`athlete_state_strava_${testAthleteId}`);
      deleteTenantVault(`athlete_state_sid_${testSid}`);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('syncs plannedEvents, targetGoals, annualMileageGoals, profile thresholds, and units from Device A to Device B via Strava identity', async () => {
    // Device A logs in via Strava identity
    const loginA = await fetch(`${baseUrl}/__test/login-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId: testAthleteId }),
    });
    const cookiesA = extractCookiePairs(loginA.headers.getSetCookie?.() || []);
    expect(cookiesA.thresh_session).toBeTruthy();

    const todayIso = '2026-11-18';
    const saveRes = await fetch(`${baseUrl}/api/athlete-state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `thresh_session=${cookiesA.thresh_session}`,
      },
      body: JSON.stringify({
        plannedEvents: [
          {
            id: 'plan-cld01-1',
            date: todayIso,
            name: 'Sub-Threshold Track Cruise',
            sportCategory: 'Running',
            environmentPreference: 'OUTDOOR',
            description: '6x1000m @ LT',
            plannedLoad: 78,
            plannedDurationSecs: 3000,
            targetZoneSummary: 'Threshold LT2',
            workoutSyntax: '- 10m 65% Effort Warmup\n- 6x1000m 98% Effort\n- 10m 60% Effort Cooldown',
          },
        ],
        targetGoals: [
          {
            id: 'goal-1',
            title: 'State Meet 3200m',
            type: 'RACE_EVENT',
            sportCategory: 'Running',
            targetDate: '2026-12-12',
            priority: 'A-Race',
            currentValue: 580,
            targetValue: 560,
            unit: 's',
            notes: 'Negative split last 800m',
          },
        ],
        annualMileageGoals: [
          { sportCategory: 'Running', year: 2026, targetDistanceMeters: 3200000 },
        ],
        athleteProfile: {
          ftp: 315,
          thresholdPaceSecsPerKm: 230,
          primarySport: 'Hybrid',
        },
        distanceUnit: 'km',
      }),
    });
    expect(saveRes.status).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.ok).toBe(true);

    // Simulate cold Device B serverless restart by clearing in-memory caches
    scopedStoresInMemory.clear();

    const loginB = await fetch(`${baseUrl}/__test/login-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ athleteId: testAthleteId }),
    });
    const cookiesB = extractCookiePairs(loginB.headers.getSetCookie?.() || []);

    const getRes = await fetch(`${baseUrl}/api/athlete-state`, {
      headers: {
        Cookie: `thresh_session=${cookiesB.thresh_session}`,
      },
    });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.authenticated).toBe(true);
    expect(getBody.state.plannedEvents).toHaveLength(1);
    expect(getBody.state.plannedEvents[0].name).toBe('Sub-Threshold Track Cruise');
    expect(getBody.state.targetGoals[0].title).toBe('State Meet 3200m');
    expect(getBody.state.annualMileageGoals[0].targetDistanceMeters).toBe(3200000);
    expect(getBody.state.athleteProfile.ftp).toBe(315);
    expect(getBody.state.athleteProfile.thresholdPaceSecsPerKm).toBe(230);
    expect(getBody.state.distanceUnit).toBe('km');
  });

  it('enforces CMP-01 Clean-Room boundaries by stripping unwhitelisted or Strava telemetry keys', () => {
    const adversarialInput = {
      plannedEvents: [
        {
          id: 'p1',
          date: '2026-11-18',
          name: 'Sweet Spot 3x12m',
          sportCategory: 'Cycling',
          environmentPreference: 'INDOOR',
          description: 'Clean prescription',
          plannedLoad: 82,
          plannedDurationSecs: 3600,
          targetZoneSummary: 'Z3',
        },
      ],
      athleteProfile: {
        ftp: 290,
        stravaStreams: [1, 2, 3],
        rawStravaPayload: { id: 12345 },
      },
      activities: [{ id: 'raw-strava-1', watts: [250] }],
    };
    const dirty = sanitizeAthleteCloudState(
      adversarialInput as unknown as Record<string, unknown>
    );

    expect((dirty as unknown as Record<string, unknown>).activities).toBeUndefined();
    expect((dirty.athleteProfile as Record<string, unknown>)?.stravaStreams).toBeUndefined();
    expect((dirty.athleteProfile as Record<string, unknown>)?.rawStravaPayload).toBeUndefined();
    expect(dirty.athleteProfile?.ftp).toBe(290);
  });

  it('resolves team planTier accurately between SANDBOX (<=5 athletes) and FOUNDING_TEAM (>5 athletes)', () => {
    const makeAthletes = (count: number, status = 'ACTIVE') =>
      Array.from({ length: count }, () => ({ role: 'ATHLETE', status }));

    // 1 coach + 5 active athletes + 3 revoked athletes -> still SANDBOX
    expect(
      resolveTeamPlanTier([
        { role: 'HEAD_COACH', status: 'ACTIVE' },
        { role: 'ASSISTANT_COACH', status: 'ACTIVE' },
        ...makeAthletes(5, 'ACTIVE'),
        ...makeAthletes(3, 'REVOKED'),
      ])
    ).toBe('SANDBOX');

    // 6 active/invited athletes -> FOUNDING_TEAM
    expect(
      resolveTeamPlanTier([
        { role: 'HEAD_COACH', status: 'ACTIVE' },
        ...makeAthletes(5, 'ACTIVE'),
        ...makeAthletes(1, 'INVITED'),
      ])
    ).toBe('FOUNDING_TEAM');

    // 40 roster athletes -> FOUNDING_TEAM
    expect(resolveTeamPlanTier(makeAthletes(40, 'ACTIVE'))).toBe('FOUNDING_TEAM');
  });
});

describe('PLG-01: Share Workout Codec, Clean-Room Guard & Live Split Recalculation', () => {
  it('round-trips UTF-8 workouts and strips forbidden Strava telemetry & email PII', () => {
    const maliciousInput = {
      kind: 'WORKOUT' as const,
      version: 1 as const,
      title: 'Tempo Cruise — Varsity Pack',
      sport: 'Cycling' as const,
      date: '2026-11-19',
      workoutSyntax: '- 10m 60% FTP Warmup\n- 3x10m 90% FTP Tempo\n- 10m 55% FTP Cooldown',
      authorLabel: 'Coach Taylor coach@example.com',
      stravaId: '9999999999999',
      streams: [{ watts: 250 }],
      activities: [{ name: 'Secret Strava Ride' }],
    };

    const sanitized = sanitizeSharedWorkoutPayload(maliciousInput);
    expect(sanitized).not.toBeNull();
    expect(sanitized?.authorLabel).toContain('[redacted]');
    expect((sanitized as unknown as Record<string, unknown>).stravaId).toBeUndefined();
    expect((sanitized as unknown as Record<string, unknown>).streams).toBeUndefined();
    expect((sanitized as unknown as Record<string, unknown>).activities).toBeUndefined();

    const encoded = encodeSharedWorkoutPayload(sanitized!);
    const decoded = decodeSharedWorkoutPayload(encoded);
    expect(decoded?.title).toBe('Tempo Cruise — Varsity Pack');
    expect(decoded?.sport).toBe('Cycling');

    const url = buildShareWorkoutUrl(sanitized!, 'https://thresh-dev.vercel.app');
    expect(url.startsWith('https://thresh-dev.vercel.app/share/workout?w=')).toBe(true);
  });

  it('recalculates Cycling Wattage and Running mile/km splits dynamically', () => {
    const bikePayload = sanitizeSharedWorkoutPayload({
      kind: 'WORKOUT',
      version: 1,
      title: 'Threshold 4x5m',
      sport: 'Cycling',
      workoutSyntax: '- 10m 60% FTP Warmup\n- 4x5m 100% FTP Threshold\n- 10m 55% FTP Cooldown',
    })!;

    const at250 = computeSharedWorkoutPreview({
      payload: bikePayload,
      ftpWatts: 250,
      thresholdPaceSecsPerKm: 240,
      unit: 'mi',
    });
    const at300 = computeSharedWorkoutPreview({
      payload: bikePayload,
      ftpWatts: 300,
      thresholdPaceSecsPerKm: 240,
      unit: 'mi',
    });

    const work250 = at250.steps.find((s) => s.label.includes('Threshold'))!;
    const work300 = at300.steps.find((s) => s.label.includes('Threshold'))!;
    expect(work250.prescribedTargetLabel).toContain('250 W');
    expect(work300.prescribedTargetLabel).toContain('300 W');

    const runPayload = sanitizeSharedWorkoutPayload({
      kind: 'WORKOUT',
      version: 1,
      title: 'Track 6x400m @ LT',
      sport: 'Running',
      workoutSyntax: '- 10m 65% Effort Warmup\n- 400m 100% Effort Threshold',
    })!;
    const paceSlow = computeSharedWorkoutPreview({
      payload: runPayload,
      ftpWatts: 250,
      thresholdPaceSecsPerKm: 240, // 4:00/km -> 1:36 per 400m
      unit: 'km',
    });
    const paceFast = computeSharedWorkoutPreview({
      payload: runPayload,
      ftpWatts: 250,
      thresholdPaceSecsPerKm: 200, // 3:20/km -> 1:20 per 400m
      unit: 'km',
    });
    expect(paceSlow.steps[1].repSplitLabel).toBe('1:36 / 400m');
    expect(paceFast.steps[1].repSplitLabel).toBe('1:20 / 400m');
  });

  it('stashes and consumes pending shared workout across OAuth login & converts to PlannedWorkoutEvent', () => {
    const store = new Map<string, string>();
    const prevWin = (globalThis as Record<string, unknown>).window;
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    (globalThis as Record<string, unknown>).window = {
      localStorage: mockStorage,
      sessionStorage: mockStorage,
    };

    try {
      const payload = sanitizeSharedWorkoutPayload({
        kind: 'WORKOUT',
        version: 1,
        title: 'VO2 5x3m',
        sport: 'Cycling',
        date: '2026-11-20',
        workoutSyntax: '- 10m 60% FTP\n- 5x3m 112% FTP VO2\n- 10m 55% FTP',
      })!;

      stashPendingSharedWorkout(payload);
      expect(peekPendingSharedWorkout()?.title).toBe('VO2 5x3m');

      const consumed = consumePendingSharedWorkout();
      expect(consumed?.title).toBe('VO2 5x3m');
      expect(peekPendingSharedWorkout()).toBeNull();

      const eventInput = sharedWorkoutToPlannedEventInput(consumed!, {
        ftpWatts: 300,
        thresholdPaceSecsPerKm: 240,
        unit: 'mi',
      });
      expect(eventInput.name).toBe('VO2 5x3m');
      expect(eventInput.date).toBe('2026-11-20');
      expect(eventInput.plannedDurationSecs).toBeGreaterThan(1500);
    } finally {
      if (prevWin === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWin;
      }
    }
  });

  it('passes Impeccable static UI anti-pattern detector cleanly on ShareWorkoutPage when available locally', () => {
    const detectorPath =
      '/Users/elliottally/.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs';
    if (!fs.existsSync(detectorPath)) {
      return;
    }
    const output = execFileSync('node', [detectorPath, 'src/components/ShareWorkoutPage.tsx'], {
      encoding: 'utf8',
    });
    expect(output.trim()).toBe('');
  });
});
