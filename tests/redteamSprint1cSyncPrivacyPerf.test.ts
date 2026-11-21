import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { resetAiRateLimitsForTesting } from '../server/secretManager.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  broadcastWorkoutToTeamSquad,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  syncAthleteSnapshotAcrossTeams,
} from '../server/teamService.ts';
import { sanitizeAthleteCloudState } from '../server/routers/athleteStateRouter.ts';
import { findOrCreateUser } from '../server/authService.ts';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage.ts';
import { applyAthletePrivacyShield } from '../src/data/athleteRosterData.ts';
import type { ConnectedAthleteRecord } from '../src/types.ts';

describe('Sprint 1C: Cloud Sync, Strict Privacy Shield & Performance Hygiene (RT-17, RT-20, RT-21, RT-27)', () => {
  let server: http.Server;
  let baseUrl = '';
  const originUrl = 'http://127.0.0.1:5173';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
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

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetAiRateLimitsForTesting();
  });

  it('RT-20: preserves birthMonthYear, skips localStorage fallback for team roster profiles, and preserves AM/PM venue logistics in cloud state', () => {
    const prevWin = (globalThis as Record<string, unknown>).window;
    const mockStorage = new Map<string, string>([
      ['aeropulse_strava_athlete_weight_kg', '84.5'],
      ['aeropulse_strava_athlete_ftp', '335'],
      ['aeropulse_strava_athlete_name', 'Coach Heavy'],
      ['thresh_primary_sport', 'Cycling'],
    ]);
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
        removeItem: (k: string) => mockStorage.delete(k),
      },
    };

    try {
      const rosterProf = buildCompleteAthleteProfile(
        {
          name: 'Maya Watchless',
          birthMonthYear: '2010-03',
          safeSportHideWeight: true,
        },
        undefined,
        undefined,
        { skipLocalStorageFallback: true }
      );
      expect(rosterProf.birthMonthYear).toBe('2010-03');
      expect(rosterProf.weightKg).toBe(70); // did NOT leak coach's 84.5 kg
      expect(rosterProf.ftp).toBe(250); // did NOT leak coach's 335W
      expect(rosterProf.primarySport).toBeUndefined(); // did NOT leak coach's Cycling sport
    } finally {
      if (prevWin === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWin;
      }
    }

    const sanitized = sanitizeAthleteCloudState({
      plannedEvents: [
        {
          id: 'ev-am-1',
          date: '2026-11-20',
          name: 'AM Shakeout + Strides',
          sportCategory: 'Running',
          environmentPreference: 'OUTDOOR',
          description: 'Easy 4 mi + 4x100m',
          plannedLoad: 42,
          plannedDurationSecs: 2100,
          targetZoneSummary: 'Z1-Z2',
          scheduledTime: '06:30',
          sessionSlot: 'AM',
          locationName: 'School Track',
          locationCategory: 'TRACK',
          meetingNotes: 'Meet by gate 2',
        },
      ],
    });
    expect(sanitized.plannedEvents).toHaveLength(1);
    expect(sanitized.plannedEvents[0].scheduledTime).toBe('06:30');
    expect(sanitized.plannedEvents[0].sessionSlot).toBe('AM');
    expect(sanitized.plannedEvents[0].locationName).toBe('School Track');
    expect(sanitized.plannedEvents[0].locationCategory).toBe('TRACK');
    expect(sanitized.plannedEvents[0].meetingNotes).toBe('Meet by gate 2');
  });

  it('RT-20: PUT /api/teams/:teamId/workouts/:broadcastId updates cloud broadcasts (and denies non-coaches) and DELETE /api/auth/account guards sole Head Coach', async () => {
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachUser = await findOrCreateUser('magic_link', `coach_1c_${unique}`, {
      email: `coach.1c.${unique}@example.com`,
      name: 'Coach 1C',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const coachCookie = issueSessionToken(coachUser.id, coachSid, 'verified');

    const created = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Cloud CRUD Club ${unique}`,
      orgType: 'RUNNING_CLUB',
      primarySport: 'Running',
      coachDisplayName: 'Coach 1C',
    });
    const teamId = created.brand.teamId;

    const afterPush = await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId,
      originUrl,
      targetSquadGroup: 'ALL',
      date: '2026-11-21',
      name: 'Initial Tempo',
      sportCategory: 'Running',
      plannedDurationSecs: 2400,
      plannedLoad: 65,
      workoutSyntax: '- 20m Z3 Tempo',
      description: 'Original plan',
      sessionSlot: 'AM',
      locationName: 'Old Park',
    });
    const broadcastId = afterPush!.broadcastWorkouts[0].broadcastId;

    const athleteUser = await findOrCreateUser('magic_link', `ath_1c_${unique}`, {
      email: `ath.1c.${unique}@example.com`,
      name: 'Runner 1C',
    });
    const athleteSid = deriveUserSessionSid(athleteUser.id);
    const athleteCookie = issueSessionToken(athleteUser.id, athleteSid, 'verified');
    await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl,
      codeOrSlug: created.brand.joinCode,
      athleteName: 'Runner 1C',
      birthMonthYear: '2001-05',
      sharingTier: 'FULL_STREAMS',
    });

    // Non-coach athlete cannot edit broadcast workout
    const deniedRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workouts/${encodeURIComponent(broadcastId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${athleteCookie}`,
        },
        body: JSON.stringify({ name: 'Hijacked Session' }),
      }
    );
    expect(deniedRes.status).toBe(403);

    // Coach updates title and venue logistics in place
    const putRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workouts/${encodeURIComponent(broadcastId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
        },
        body: JSON.stringify({
          origin: originUrl,
          name: 'Updated Threshold Ladder',
          scheduledTime: '15:45',
          sessionSlot: 'PM',
          locationName: 'Stadium Track',
          locationCategory: 'TRACK',
          meetingNotes: 'Spikes in bag',
        }),
      }
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.team.broadcastWorkouts[0].name).toBe('Updated Threshold Ladder');
    expect(putBody.team.broadcastWorkouts[0].scheduledTime).toBe('15:45');
    expect(putBody.team.broadcastWorkouts[0].sessionSlot).toBe('PM');
    expect(putBody.team.broadcastWorkouts[0].locationName).toBe('Stadium Track');
    expect(putBody.team.broadcastWorkouts[0].meetingNotes).toBe('Spikes in bag');

    // Sole active HEAD_COACH with active athletes cannot orphan team on permanent deletion (409)
    const blockedDeleteRes = await fetch(`${baseUrl}/api/auth/account?confirm=DELETE`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
      },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect(blockedDeleteRes.status).toBe(409);
    const blockedBody = await blockedDeleteRes.json();
    expect(blockedBody.error).toMatch(/Transfer Head Coach ownership/i);
  });

  it('RT-21: redacts GPS coordinates, HRV baselines & PMC load on client Privacy Shield and server team summaries', async () => {
    const sampleRecord: ConnectedAthleteRecord = {
      id: 'conn-priv-1',
      name: 'Private Athlete',
      avatarInitials: 'PA',
      location: 'San Jose, CA',
      stravaAthleteId: '0',
      inviteCode: 'PRIV123',
      role: 'COACH_EDIT',
      status: 'CONNECTED',
      primaryGoalSummary: 'Sub-17 5K',
      primarySport: 'Running',
      targetGoals: [],
      privacySettings: {
        shareWellnessAndHrv: 'PRIVATE',
        sharePmcAndZones: 'PRIVATE',
        shareGpsRoutes: 'PRIVATE',
        stravaComplianceShield: true,
        allowCoachCalendarEdits: false,
      },
      athleteProfile: buildCompleteAthleteProfile(
        { name: 'Private Athlete', ftp: 300, thresholdPaceSecsPerKm: 230 },
        undefined,
        undefined,
        { skipLocalStorageFallback: true }
      ),
      wellnessDays: [
        {
          date: '2026-11-19',
          ctl: 72,
          atl: 84,
          tsb: -12,
          rampRate: 3.1,
          dailyLoad: 95,
          hrvRMSSD: 64,
          hrvBaseline7d: 61,
          hrvNormalBandLow: 52,
          hrvNormalBandHigh: 72,
          hrvStatus: 'Balanced',
          restingHR: 48,
          sleepSecs: 28800,
          sleepScore: 89,
          sleepQuality: 2,
          sleepDebt7dSecs: 1200,
          soreness: 2,
          weightKg: 68,
          readinessStatus: 'Strain',
          rideEftp: 305,
          runEftp: 320,
          vo2MaxCycling: 61,
          vo2MaxRunning: 59,
        },
      ],
      activities: [
        {
          id: 'garmin-1',
          name: 'Morning Run',
          sportCategory: 'Running',
          environment: 'OUTDOOR',
          subType: 'Road',
          sourceBadges: ['Garmin'],
          startDateLocal: '2026-11-19T07:00:00',
          movingTimeSecs: 2400,
          distanceMeters: 9000,
          elevationGainMeters: 42,
          avgHr: 152,
          maxHr: 171,
          trainingLoad: 70,
          intensityFactor: 0.85,
          normalizedPower: 0,
          efficiencyFactor: 1.55,
          firstHalfEf: 1.57,
          secondHalfEf: 1.54,
          aerobicDecouplingPct: 2.1,
          zoneSecs: { hr: [300, 1200, 600, 300, 0, 0, 0] },
          stravaPrCount: 0,
          segmentEfforts: [],
          startLatLng: [37.3, -121.9],
          endLatLng: [37.31, -121.91],
          routeLatLngs: [
            [37.3, -121.9],
            [37.31, -121.91],
          ],
          summaryPolyline: 'abc',
        },
      ],
      plannedEvents: [],
    };

    const shielded = applyAthletePrivacyShield(sampleRecord);
    expect(shielded.redactedWellness).toBe(true);
    expect(shielded.redactedGpsRoutes).toBe(true);
    expect(shielded.redactedPmc).toBe(true);
    expect(shielded.activities[0].startLatLng).toBeUndefined();
    expect(shielded.activities[0].endLatLng).toBeUndefined();
    expect(shielded.activities[0].routeLatLngs).toBeUndefined();
    expect(shielded.wellnessDays[0].hrvBaseline7d).toBe(0);
    expect(shielded.wellnessDays[0].sleepQuality).toBeUndefined();
    expect(shielded.wellnessDays[0].readinessStatus).toBe('Optimal'); // masked from 'Strain'
    expect(shielded.wellnessDays[0].ctl).toBe(0);
    expect(shielded.wellnessDays[0].atl).toBe(0);
    expect(shielded.wellnessDays[0].tsb).toBe(0);
    expect(shielded.wellnessDays[0].rideEftp).toBeUndefined();
    expect(shielded.wellnessDays[0].vo2MaxRunning).toBeUndefined();

    // Server team summary projection with BOTH PMC and Wellness PRIVATE
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachUser = await findOrCreateUser('magic_link', `coach_p_${unique}`, {
      email: `coach.p.${unique}@example.com`,
      name: 'Coach Privacy',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const created = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Privacy Check Team ${unique}`,
      orgType: 'RUNNING_CLUB',
      primarySport: 'Running',
      coachDisplayName: 'Coach Privacy',
    });

    const athUser = await findOrCreateUser('magic_link', `ath_p_${unique}`, {
      email: `ath.p.${unique}@example.com`,
      name: 'Shielded Runner',
    });
    const athSid = deriveUserSessionSid(athUser.id);
    await claimTeamJoinInvite({
      callerSid: athSid,
      originUrl,
      codeOrSlug: created.brand.joinCode,
      athleteName: 'Shielded Runner',
      birthMonthYear: '1999-08',
      sharingTier: 'LOAD_ONLY',
    });
    await syncAthleteSnapshotAcrossTeams({
      callerSid: athSid,
      originUrl,
      snapshot: {
        verdictLabel: 'Strained · Recover',
        readinessScore: 54,
        ctl: 65,
        atl: 88,
        tsb: -23,
        acuteLoad7d: 440,
        caraHours7d: 14.5,
        lowAerobicPct: 70,
        highAerobicPct: 22,
        neuromuscularPct: 8,
        ftpWatts: 310,
        thresholdPaceSecsPerKm: 220,
        privacySettings: {
          shareWellnessAndHrv: 'PRIVATE',
          sharePmcAndZones: 'PRIVATE',
          shareGpsRoutes: 'PRIVATE',
          stravaComplianceShield: true,
          allowCoachCalendarEdits: false,
        },
      },
    });

    const coachTeams = await listTeamsForUser(coachSid, originUrl);
    const snap = coachTeams[0].memberships.find((m) => m.userSid === athSid)?.liveSnapshot;
    expect(snap).toBeDefined();
    expect(snap?.verdictLabel).toBe('Private');
    expect(snap?.readinessScore).toBe(0);
    expect(snap?.ctl).toBe(0);
    expect(snap?.atl).toBe(0);
    expect(snap?.acuteLoad7d).toBe(0);
    expect(snap?.caraHours7d).toBe(0);
    expect(snap?.lowAerobicPct).toBe(0);
    expect(snap?.ftpWatts).toBeUndefined();
    expect(snap?.thresholdPaceSecsPerKm).toBeUndefined();
  });

  it('RT-17 & RT-27: purges local developer paths, cleans index.html, drops 20Hz stopwatch polling, and stores docs figures as WebP', () => {
    const forbiddenPrefix = ['/Users', 'elliottally'].join('/');
    for (const dirName of ['src', 'server', 'tests', 'e2e', 'scripts']) {
      const rootDir = path.join(process.cwd(), dirName);
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|mjs|html)$/.test(entry.name)) {
            const content = fs.readFileSync(full, 'utf8');
            expect(content, `${full} leaked developer home path`).not.toContain(forbiddenPrefix);
          }
        }
      };
      walk(rootDir);
    }

    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    expect(indexHtml).not.toContain('<!-- THESIS:');
    expect(indexHtml).toContain('https://thresh.fit/brand/thresh-og-1200x630.png');

    const rosterModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/AthleteRosterModal.tsx'),
      'utf8'
    );
    expect(rosterModalSrc).toContain('useIsStopwatchRunning()');
    expect(rosterModalSrc).not.toContain('useTracksideStopwatch(');

    const figuresDir = path.join(process.cwd(), 'public/docs/figures');
    const figureFiles = fs.readdirSync(figuresDir);
    expect(figureFiles.filter((f) => f.endsWith('.png'))).toEqual([]);
    expect(figureFiles.filter((f) => f.endsWith('.webp')).length).toBeGreaterThanOrEqual(7);
  });
});
