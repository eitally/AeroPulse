import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter';
import { deriveStravaSessionSid } from '../server/securityUtils';
import { deleteTenantVault } from '../server/tokenVault';
import {
  calibrateThresholdsFromSeedMark,
  parseBulkRosterCsvOrText,
} from '../src/physiology/teamOnboardingEngine';
import { evaluateRollingTrainingProductivity } from '../src/physiology/trainingProductivityEngine';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';

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

  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

describe('End-to-End Strava Identity, Sync Window Policy, Optional Add-Ons & Team Onboarding', () => {
  const originalFetch = globalThis.fetch;
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
      'ALLOW_DEV_ENV_CREDENTIALS',
      'GARMIN_PERSONAL_API_KEY',
    ]) {
      envBackup[k] = process.env[k];
    }
    process.env.STRAVA_CLIENT_ID = '144999';
    process.env.STRAVA_CLIENT_SECRET = 'strava_test_secret_abcdef123456';
    process.env.SESSION_SECRET = 'thresh_test_session_secret_0123456789abcdef0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    delete process.env.ALLOW_DEV_ENV_CREDENTIALS;
    delete process.env.GARMIN_PERSONAL_API_KEY;

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
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    for (const athId of createdAthleteIds.splice(0)) {
      const sid = deriveStravaSessionSid(athId);
      await deleteTenantVault(sid);
    }
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function jarFetch(
    jar: SimpleCookieJar,
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers || {});
    const cookieHeader = jar.headerValue();
    if (cookieHeader) headers.set('cookie', cookieHeader);
    const res = await originalFetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });
    jar.absorbResponse(res);
    return res;
  }

  it('reports clean unauthenticated status with zero hardcoded personal Garmin API key leakage', async () => {
    const jar = new SimpleCookieJar();
    const res = await jarFetch(jar, '/api/config/status');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.stravaConfigured).toBe(true);
    expect(body.stravaConnected).toBe(false);
    expect(body.garminConnected).toBe(false);
    expect(body.intervalsConnected).toBe(false);
    expect(body.stravaSyncPolicy ?? null).toBeNull();
  });

  it('enforces HMAC-signed OAuth state CSRF protection and handles Strava cancel cleanly', async () => {
    const jar = new SimpleCookieJar();
    const authUrlRes = await jarFetch(
      jar,
      `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}&joinCode=PAXC-26&slug=paly-xc`
    );
    expect(authUrlRes.status).toBe(200);
    const { url, state } = await authUrlRes.json();
    expect(url).toContain('https://www.strava.com/oauth/authorize');
    expect(url).toContain('scope=read%2Cactivity%3Aread_all%2Cprofile%3Aread_all');
    expect(state).toContain('.');
    expect(jar.has('thresh_oauth_state')).toBe(true);

    // 1. Tampered state must be rejected with 400 before calling Strava
    const stravaSpy = vi.fn();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.startsWith('https://www.strava.com/')) {
        stravaSpy(target);
        throw new Error('Should not call Strava on tampered state');
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const tamperedRes = await jarFetch(
      jar,
      `/api/strava/callback?code=fake_code&state=${encodeURIComponent(`${state}tamper`)}`
    );
    expect(tamperedRes.status).toBe(400);
    expect(stravaSpy).not.toHaveBeenCalled();

    // 2. User clicking Cancel on Strava returns 200 HTML with cancelled: true + auto-close
    const authUrlRes2 = await jarFetch(
      jar,
      `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const { state: validState2 } = await authUrlRes2.json();
    const cancelRes = await jarFetch(
      jar,
      `/api/strava/callback?error=access_denied&state=${encodeURIComponent(validState2)}`
    );
    expect(cancelRes.status).toBe(200);
    const cancelHtml = await cancelRes.text();
    expect(cancelHtml).toContain('"cancelled":true');
    expect(cancelHtml).toContain('window.close()');
  });

  it('completes Strava OAuth identity, gates Step 2 Sync Choice, respects window=none vs window=90d with two-pass rTSS, and restores returning users across devices', async () => {
    const athleteId = `8844${Math.floor(1000 + Math.random() * 8999)}`;
    createdAthleteIds.push(athleteId);

    let activitiesEndpointHits = 0;
    let lastActivitiesUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === 'https://www.strava.com/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: 'at_live_strava_token_1',
            refresh_token: 'rt_live_strava_token_1',
            expires_at: Math.floor(Date.now() / 1000) + 21600,
            athlete: {
              id: Number(athleteId),
              firstname: 'Jordan',
              lastname: 'McAllister',
              measurement_preference: 'feet',
              ftp: 285,
              weight: 68.5,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.startsWith('https://www.strava.com/api/v3/athlete/activities')) {
        activitiesEndpointHits += 1;
        lastActivitiesUrl = target;
        const urlObj = new URL(target);
        const page = Number(urlObj.searchParams.get('page') || '1');
        if (page > 1) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify([
            {
              id: 500101,
              name: 'Morning Tempo Run (No Power Pod)',
              sport_type: 'Run',
              type: 'Run',
              start_date_local: new Date().toISOString().slice(0, 19) + 'Z',
              moving_time: 2400, // 40m
              distance: 10000, // 10km (4:00/km)
              total_elevation_gain: 45,
              average_heartrate: 166,
              max_heartrate: 179,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target === 'https://www.strava.com/api/v3/athlete') {
        return new Response(
          JSON.stringify({
            id: Number(athleteId),
            firstname: 'Jordan',
            lastname: 'McAllister',
            measurement_preference: 'feet',
            ftp: 285,
            weight: 68.5,
            shoes: [{ id: 'g1', name: 'Vaporfly 3', distance: 142000 }],
            bikes: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const jarDevice1 = new SimpleCookieJar();
    const urlRes = await jarFetch(
      jarDevice1,
      `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const { state } = await urlRes.json();

    // Complete OAuth callback
    const cbRes = await jarFetch(
      jarDevice1,
      `/api/strava/callback?code=valid_oauth_code&scope=read,activity:read_all,profile:read_all&state=${encodeURIComponent(state)}`
    );
    expect(cbRes.status).toBe(200);
    const cbHtml = await cbRes.text();

    // Brand-new user has NO sync policy yet -> hasExistingSyncPolicy must be false so Step 2 renders!
    expect(cbHtml).toContain('"hasExistingSyncPolicy":false');
    expect(jarDevice1.has('thresh_session')).toBe(true);
    expect(jarDevice1.has('thresh_vault')).toBe(true);

    // Poll endpoint rejects unsigned state, succeeds on signed state
    const badPoll = await jarFetch(jarDevice1, '/api/strava/auth/poll?state=unsigned');
    expect((await badPoll.json()).completed).toBe(false);
    const goodPoll = await jarFetch(
      jarDevice1,
      `/api/strava/auth/poll?state=${encodeURIComponent(state)}`
    );
    const pollData = await goodPoll.json();
    expect(pollData.completed).toBe(true);
    expect(pollData.athleteId).toBe(athleteId);
    expect(pollData.measurementPreference).toBe('mi');

    // Step 2 Option A: User selects "Identity Only" (window = 'none') -> 0 Strava workouts fetched
    const policyNoneRes = await jarFetch(jarDevice1, '/api/strava/sync-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: 'none', importProfileAndGear: false }),
    });
    expect(policyNoneRes.status).toBe(200);

    const syncNoneRes = await jarFetch(jarDevice1, '/api/strava/sync');
    const syncNoneBody = await syncNoneRes.json();
    expect(syncNoneBody.syncPaused).toBe(true);
    expect(syncNoneBody.activities).toEqual([]);
    expect(activitiesEndpointHits).toBe(0);

    // Step 2 Option B: User switches to "Last 90 Days" (window = '90d') -> fetches with `after` epoch & calibrates rTSS + EF!
    await jarFetch(jarDevice1, '/api/strava/sync-policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window: '90d', importProfileAndGear: true }),
    });
    const sync90Res = await jarFetch(jarDevice1, '/api/strava/sync?window=90d');
    const sync90Body = await sync90Res.json();
    expect(activitiesEndpointHits).toBeGreaterThan(0);
    expect(lastActivitiesUrl).toContain('after=');
    expect(sync90Body.activities).toHaveLength(1);
    const runAct = sync90Body.activities[0];
    expect(runAct.trainingLoad).toBeGreaterThan(55);
    expect(runAct.efficiencyFactor).toBeGreaterThan(1.2);
    expect(sync90Body.gearItems).toHaveLength(1);

    // Device 2 (fresh CookieJar, e.g. iOS Safari) signs in with the SAME Strava athlete -> restores sync policy!
    const jarDevice2 = new SimpleCookieJar();
    const urlRes2 = await jarFetch(
      jarDevice2,
      `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`
    );
    const { state: state2 } = await urlRes2.json();
    const cbRes2 = await jarFetch(
      jarDevice2,
      `/api/strava/callback?code=valid_oauth_code_2&scope=read,activity:read_all,profile:read_all&state=${encodeURIComponent(state2)}`
    );
    const cbHtml2 = await cbRes2.text();
    expect(cbHtml2).toContain('"hasExistingSyncPolicy":true');

    const statusDevice2 = await (await jarFetch(jarDevice2, '/api/config/status')).json();
    expect(statusDevice2.stravaConnected).toBe(true);
    expect(statusDevice2.stravaAthleteId).toBe(athleteId);
    expect(statusDevice2.stravaSyncPolicy?.window).toBe('90d');

    // Disconnect Strava clears session cleanly
    const discRes = await jarFetch(jarDevice2, '/api/strava/disconnect', { method: 'POST' });
    expect((await discRes.json()).ok).toBe(true);
  });

  it('gracefully flags missingActivityScope when a user unchecks activity permissions on Strava', async () => {
    const athleteId = `7733${Math.floor(1000 + Math.random() * 8999)}`;
    createdAthleteIds.push(athleteId);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === 'https://www.strava.com/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: 'at_limited_scope',
            refresh_token: 'rt_limited_scope',
            expires_at: Math.floor(Date.now() / 1000) + 21600,
            athlete: { id: Number(athleteId), firstname: 'Sam', lastname: 'Scope' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const jar = new SimpleCookieJar();
    const { state } = await (
      await jarFetch(jar, `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`)
    ).json();
    await jarFetch(
      jar,
      `/api/strava/callback?code=code_no_act&scope=read,profile:read_all&state=${encodeURIComponent(state)}`
    );

    const syncRes = await jarFetch(jar, '/api/strava/sync?window=90d');
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json();
    expect(syncBody.missingActivityScope).toBe(true);
    expect(syncBody.activities).toEqual([]);
  });

  it('auto-matches CSV roster invites on Strava team claim, enforces Collegiate adult U18 rules & Seed Marks, and isolates targeted workouts', async () => {
    // 1. Verify Collegiate Class of 2028 adult isMinorU18 === false & seed mark edge cases
    const collegeRows = parseBulkRosterCsvOrText(
      [
        'Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark',
        'Maya Lin, maya.lin@stanford.edu, 650-555-0133, Varsity, 2028, , 10:15',
      ].join('\n'),
      'COLLEGIATE',
      'Varsity'
    );
    expect(collegeRows).toHaveLength(1);
    expect(collegeRows[0].isMinorU18).toBe(false);

    const twoMileCal = calibrateThresholdsFromSeedMark('10:15', 'Running', 'mi');
    expect(twoMileCal.vdotEstimate).toBeGreaterThan(56);
    const bikeCal = calibrateThresholdsFromSeedMark('280W 20m', 'Cycling', 'mi');
    expect(bikeCal.cyclingFtpWatts).toBe(266);
    const eightHundredCal = calibrateThresholdsFromSeedMark('2:04 800m', 'Running', 'km');
    expect(eightHundredCal.vdotEstimate).toBeGreaterThan(55);

    // 2. Coach & two athletes authenticate via Strava and run full team claim + targeted push
    const coachAthId = `6611${Math.floor(1000 + Math.random() * 8999)}`;
    const mayaAthId = `6622${Math.floor(1000 + Math.random() * 8999)}`;
    const peerAthId = `6633${Math.floor(1000 + Math.random() * 8999)}`;
    createdAthleteIds.push(coachAthId, mayaAthId, peerAthId);

    let nextStravaProfile = { id: Number(coachAthId), firstname: 'Coach', lastname: 'Taylor' };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://www.strava.com/oauth/token') {
        return new Response(
          JSON.stringify({
            access_token: `at_${nextStravaProfile.id}`,
            refresh_token: `rt_${nextStravaProfile.id}`,
            expires_at: Math.floor(Date.now() / 1000) + 21600,
            athlete: nextStravaProfile,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    async function signInStrava(profile: { id: number; firstname: string; lastname: string }) {
      nextStravaProfile = profile;
      const jar = new SimpleCookieJar();
      const { state } = await (
        await jarFetch(jar, `/api/strava/auth/url?origin=${encodeURIComponent(baseUrl)}`)
      ).json();
      await jarFetch(
        jar,
        `/api/strava/callback?code=c_${profile.id}&scope=read,activity:read_all&state=${encodeURIComponent(state)}`
      );
      return jar;
    }

    const coachJar = await signInStrava({
      id: Number(coachAthId),
      firstname: 'Coach',
      lastname: 'Taylor',
    });

    // Coach creates Collegiate team
    const createRes = await jarFetch(coachJar, '/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: baseUrl,
        name: `Cardinal Distance ${Math.floor(100 + Math.random() * 899)}`,
        shortName: 'CARD XC',
        orgType: 'COLLEGIATE',
        defaultSafeSportShield: false,
        coachDisplayName: 'Coach Taylor',
      }),
    });
    const createdTeam = (await createRes.json()).team;
    expect(createdTeam.brand.joinCode).toBeTruthy();

    // Coach imports Maya via CSV
    await jarFetch(
      coachJar,
      `/api/teams/${encodeURIComponent(createdTeam.brand.teamId)}/invites/bulk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: baseUrl,
          rawCsvOrText: [
            'Name, Email, Squad, GradYear, SeedMark',
            'Maya Lin, maya.lin@stanford.edu, Varsity, 2028, 16:45 5K',
          ].join('\n'),
          sendEmailsNow: false,
        }),
      }
    );

    // Maya signs in with Strava and claims using ONLY the 6-char Join Code (no ?t= token!)
    const mayaJar = await signInStrava({
      id: Number(mayaAthId),
      firstname: 'Maya',
      lastname: 'Lin',
    });
    const mayaClaimRes = await jarFetch(mayaJar, '/api/teams/join-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: baseUrl,
        codeOrSlug: createdTeam.brand.joinCode,
        athleteName: 'Maya Lin',
        sharingTier: 'SUMMARY_ONLY',
        distanceUnit: 'km',
      }),
    });
    const mayaClaim = await mayaClaimRes.json();
    expect(mayaClaim.ok).toBe(true);
    // Must auto-match her pending CSV invite slot (total memberships stays Coach + Maya = 2, not 3!)
    expect(mayaClaim.team.memberships).toHaveLength(2);
    const mayaMember = mayaClaim.team.memberships.find(
      (m: any) => m.invitedName === 'Maya Lin'
    );
    expect(mayaMember.status).toBe('ACTIVE');
    expect(mayaMember.squadGroup).toBe('Varsity');
    expect(mayaMember.liveSnapshot.ctl).toBe(0);
    expect(mayaMember.liveSnapshot.readinessScore).toBe(0);

    // Peer athlete joins same squad
    const peerJar = await signInStrava({
      id: Number(peerAthId),
      firstname: 'Alex',
      lastname: 'Peer',
    });
    await jarFetch(peerJar, '/api/teams/join-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: baseUrl,
        codeOrSlug: createdTeam.brand.joinCode,
        athleteName: 'Alex Peer',
      }),
    });

    // Coach pushes individual workout targeted ONLY at Maya's membershipId
    await jarFetch(
      coachJar,
      `/api/teams/${encodeURIComponent(createdTeam.brand.teamId)}/workouts/broadcast`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: baseUrl,
          targetSquadGroup: 'Varsity',
          targetMembershipIds: [mayaMember.membershipId],
          date: '2026-11-14',
          name: 'Maya Individual Rehab AlterG Progression',
          sportCategory: 'Running',
          plannedDurationSecs: 2700,
          plannedLoad: 48,
          workoutSyntax: '- 45m 78% Pace',
          description: 'Individualized session for Maya only.',
        }),
      }
    );

    const mayaTeams = (await (await jarFetch(mayaJar, '/api/teams')).json()).teams;
    const peerTeams = (await (await jarFetch(peerJar, '/api/teams')).json()).teams;
    expect(mayaTeams[0].broadcastWorkouts).toHaveLength(1);
    expect(peerTeams[0].broadcastWorkouts).toHaveLength(0);
  });

  it('produces honest Day-1 CALIBRATING telemetry (0 CTL, 0 RHR, 0 Readiness) and pace-based running prescriptions with zero % FTP', () => {
    const profile = buildCompleteAthleteProfile(null);
    const emptyDay1 = evaluateRollingTrainingProductivity({
      activities: [],
      wellnessDays: [],
      athleteProfile: profile,
      asOfDateIso: '2026-11-11',
    });

    expect(emptyDay1.verdict).toBe('CALIBRATING');
    expect(emptyDay1.ctl).toBe(0);
    expect(emptyDay1.atl).toBe(0);
    expect(emptyDay1.rhrLatestBpm).toBe(0);
    expect(emptyDay1.readinessScore).toBe(0);
    expect(emptyDay1.gapPrescription.workoutSyntaxRunning).not.toContain('% FTP');
    expect(emptyDay1.gapPrescription.workoutSyntaxRunning).toContain('/km');
  });
});
