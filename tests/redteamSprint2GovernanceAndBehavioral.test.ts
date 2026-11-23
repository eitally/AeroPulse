import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { followTeamAsParentOrFan } from '../server/athleticSyncService.ts';
import { buildPostgresSslConfig } from '../server/tokenVault.ts';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import { buildSampleDemoCoachSquad, buildSampleDemoDataset } from '../src/data/sampleDemoData.ts';
import { ENDURANCE_PLAN_ARCHETYPES, generateEnduranceTrainingPlan } from '../src/physiology/cyclingPrescriptionEngine.ts';
import { computeDualSportPmcSeries } from '../src/physiology/pmc.ts';
import {
  formatDuration,
  formatGoalMetricValue,
  formatPaceClockInput,
  formatSleepDuration,
  formatStopwatch,
  parsePaceClockInput,
} from '../src/utils/formatters.ts';
import {
  purgeStaleRuntimeChunkCaches,
  triggerChunkSkewReload,
} from '../src/utils/lazyWithRetry.ts';

const ROOT = process.cwd();

describe('Red-Team Sprint 2 Governance, Safety, Math & Resilience Suite', () => {
  const createdTeamIds: string[] = [];
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
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
    for (const id of createdTeamIds) {
      await removeTeamFromDirectoryAndVault(id).catch(() => {});
    }
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  describe('1. Standalone Legal & Procurement Pack + Brand & TLS Hardening', () => {
    it('ships static /privacy, /terms, /subprocessors, /procurement HTML pages outside SPA fallback & SW precache', () => {
      for (const page of ['privacy.html', 'terms.html', 'subprocessors.html', 'procurement.html', 'legal.css']) {
        const full = path.join(ROOT, 'public', 'legal', page);
        expect(fs.existsSync(full)).toBe(true);
      }

      const privacyHtml = fs.readFileSync(path.join(ROOT, 'public/legal/privacy.html'), 'utf8');
      expect(privacyHtml).toMatch(/FERPA|SOPIPA|COPPA/);
      expect(privacyHtml).not.toMatch(/__APP_ENV__/);

      const procurementHtml = fs.readFileSync(path.join(ROOT, 'public/legal/procurement.html'), 'utf8');
      expect(procurementHtml).toMatch(/SDPC|NDPA|HECVAT|PO/);

      const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
      const rewrites: Array<{ source: string; destination: string }> = vercelJson.rewrites || [];
      expect(rewrites.some((r) => r.source === '/privacy' && r.destination === '/legal/privacy.html')).toBe(true);
      expect(rewrites.some((r) => r.source === '/terms' && r.destination === '/legal/terms.html')).toBe(true);
      expect(rewrites.some((r) => r.source === '/subprocessors' && r.destination === '/legal/subprocessors.html')).toBe(true);
      expect(rewrites.some((r) => r.source === '/procurement' && r.destination === '/legal/procurement.html')).toBe(true);

      const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain('**/legal/**');
      expect(viteConfig).toMatch(/privacy|terms|subprocessors|procurement/);
    });

    it('enforces Postgres TLS certificate verification by default and allows opt-out only when explicitly false', () => {
      expect(buildPostgresSslConfig('postgres://localhost:5432/thresh')).toBeUndefined();
      expect(buildPostgresSslConfig('postgres://user:pass@ep-cool.neon.tech/neondb', {})).toEqual({
        rejectUnauthorized: true,
      });
      expect(
        buildPostgresSslConfig('postgres://user:pass@ep-cool.neon.tech/neondb', {
          PG_SSL_ALLOW_SELF_SIGNED: 'true',
        })
      ).toEqual({
        rejectUnauthorized: false,
      });
    });

    it('passes the strict CamelCase MeetReady brand casing guard with 0 leaks', () => {
      const out = execFileSync('node', [path.join(ROOT, 'scripts/checkBrandCasing.mjs')], {
        encoding: 'utf8',
      });
      expect(out).toMatch(/PASS/i);
    });
  });

  describe('2. Backend Governance, ORG_ADMIN / ATHLETIC_TRAINER RBAC, Guardian Alerts & Audit Log', () => {
    it('enforces staff RBAC, Guardian CC on minor comments, PARENT_FOLLOWER venue visibility without biometrics, Workout Library CRUD & audit trail', async () => {
      const hexSid = () => crypto.randomBytes(12).toString('hex');
      const suffix = Date.now();
      const headCoachSid = hexSid();
      const trainerSid = hexSid();
      const adminSid = hexSid();
      const athleteSid = hexSid();
      const parentSid = hexSid();

      const cookieFor = (uid: string, sid: string) =>
        `${SESSION_COOKIE_NAME}=${issueSessionToken(uid, sid, 'verified')}`;

      const coachCookie = cookieFor('usr_coach', headCoachSid);
      const trainerCookie = cookieFor('usr_trainer', trainerSid);
      const adminCookie = cookieFor('usr_admin', adminSid);
      const athleteCookie = cookieFor('usr_ath', athleteSid);
      const parentCookie = cookieFor('usr_parent', parentSid);

      // 1. Head Coach creates High School XC team
      const createRes = await fetch(`${baseUrl}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          name: `Willow Glen Governance Test ${suffix}`,
          shortName: 'WGGOV',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          coachDisplayName: 'Coach Morales',
          externalSync: { enablePublicParentHub: true },
        }),
      });
      const createData = await createRes.json();
      expect(createRes.status).toBe(200);
      const teamId: string = createData.team.brand.teamId;
      const joinCode: string = createData.team.brand.joinCode;
      createdTeamIds.push(teamId);

      // 2. Minor athlete, Athletic Trainer candidate & Admin candidate join via join-claim
      const joinMinorRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: athleteCookie },
        body: JSON.stringify({
          codeOrSlug: joinCode,
          athleteName: 'Maya Chen',
          athleteEmail: 'maya.minor@wghs.edu',
          squadGroup: 'Varsity',
          birthMonthYear: '2010-05',
          parentGuardianEmail: 'guardian.chen@family.org',
        }),
      });
      const joinMinorData = await joinMinorRes.json();
      expect(joinMinorRes.status).toBe(200);
      const minorMemId: string = joinMinorData.team.memberships.find(
        (m: { invitedName: string }) => m.invitedName === 'Maya Chen'
      ).membershipId;

      const joinTrainerRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
        body: JSON.stringify({
          codeOrSlug: joinCode,
          athleteName: 'Jordan ATC',
          athleteEmail: 'atc@wghs.edu',
          squadGroup: 'Medical',
          birthMonthYear: '1992-04',
        }),
      });
      const joinTrainerData = await joinTrainerRes.json();
      const trainerMemId: string = joinTrainerData.team.memberships.find(
        (m: { invitedName: string }) => m.invitedName === 'Jordan ATC'
      ).membershipId;

      const joinAdminRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({
          codeOrSlug: joinCode,
          athleteName: 'AD Alvarez',
          athleteEmail: 'ad@wghs.edu',
          squadGroup: 'Admin',
          birthMonthYear: '1980-08',
        }),
      });
      const joinAdminData = await joinAdminRes.json();
      const adminMemId: string = joinAdminData.team.memberships.find(
        (m: { invitedName: string }) => m.invitedName === 'AD Alvarez'
      ).membershipId;

      // 3. Head Coach assigns ATHLETIC_TRAINER & ORG_ADMIN roles
      const promoteTrainerRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(trainerMemId)}/role`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({ role: 'ATHLETIC_TRAINER' }),
        }
      );
      expect(promoteTrainerRes.status).toBe(200);

      const promoteAdminRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(adminMemId)}/role`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({ role: 'ORG_ADMIN' }),
        }
      );
      expect(promoteAdminRes.status).toBe(200);

      // 4. ATHLETIC_TRAINER cannot broadcast workouts (403), but CAN record Guardian Safety Alerts
      const deniedBroadcastRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workouts/broadcast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
          body: JSON.stringify({
            targetSquadGroup: 'ALL',
            date: '2026-11-25',
            name: 'Unauthorized Trainer Workout',
            sportCategory: 'Running',
            plannedDurationSecs: 1800,
            plannedLoad: 40,
            workoutSyntax: '- 30m 65% Pace',
            description: 'Easy',
          }),
        }
      );
      expect(deniedBroadcastRes.status).toBe(403);

      const coachBroadcastRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workouts/broadcast`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({
            targetSquadGroup: 'ALL',
            date: '2026-11-25',
            name: '5×800m CV @ Track',
            sportCategory: 'Running',
            plannedDurationSecs: 3000,
            plannedLoad: 72,
            workoutSyntax: '- 2mi Z1\nMain Set 5x\n- 800m CV pace (90s jog)',
            description: 'Post-practice pickup at North Track Gate',
            scheduledTime: '15:45',
            locationName: 'Willow Glen North Track Gate',
            locationCategory: 'TRACK',
          }),
        }
      );
      expect(coachBroadcastRes.status).toBe(200);

      const alertRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/safety-alerts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
          body: JSON.stringify({
            targetMembershipId: minorMemId,
            category: 'PAIN_FLAG',
            severity: 'HIGH',
            summary: 'Right shin tenderness flagged during warm-up.',
            painLocation: 'SHIN',
          }),
        }
      );
      expect(alertRes.status).toBe(200);
      const alertData = await alertRes.json();
      expect(alertData.alert.athleteName).toBe('Maya Chen');

      // 5. Private minor comment (guardianCc: false) rejected with 403; guardianCc: true succeeds
      const blockedCommentRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({
            targetMembershipId: minorMemId,
            workoutDate: '2026-11-25',
            body: 'Private message without guardian CC',
            guardianCc: false,
          }),
        }
      );
      expect(blockedCommentRes.status).toBe(403);

      const okCommentRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({
            targetMembershipId: minorMemId,
            workoutDate: '2026-11-25',
            body: 'Keep volume easy on turf today.',
            guardianCc: true,
          }),
        }
      );
      expect(okCommentRes.status).toBe(200);
      const okCommentData = await okCommentRes.json();
      expect(okCommentData.comment.guardianCcApplied).toBe(true);

      // 6. Workout Library CRUD (create -> list -> delete)
      const saveLibRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workout-library`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
          body: JSON.stringify({
            name: '4×1000m CV Opener',
            category: 'TRACK',
            sportCategory: 'Running',
            workoutSyntax: 'Main Set 1\n- 4x1000m at CV pace (90s jog)',
            description: 'Threshold opener',
            plannedDurationSecs: 2700,
            plannedLoad: 68,
          }),
        }
      );
      expect(saveLibRes.status).toBe(200);
      const saveLibData = await saveLibRes.json();
      const tplId: string = saveLibData.template.id;

      const listLibRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workout-library`,
        { headers: { Cookie: coachCookie } }
      );
      const listLibData = await listLibRes.json();
      expect(listLibData.templates.some((t: { id: string }) => t.id === tplId)).toBe(true);

      const delLibRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workout-library/${encodeURIComponent(tplId)}`,
        { method: 'DELETE', headers: { Cookie: coachCookie } }
      );
      expect(delLibRes.status).toBe(200);

      // 7. PARENT_FOLLOWER receives pickup venue & ZERO private biometrics; linked guardian also sees child alerts/comments
      const followRes = await fetch(`${baseUrl}/api/teams/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({
          codeOrSlug: joinCode,
          followerName: 'Supporter Fan',
        }),
      });
      expect(followRes.status).toBe(200);
      const fanTeamsRes = await fetch(`${baseUrl}/api/teams`, {
        headers: { Cookie: parentCookie },
      });
      const fanTeamsData = await fanTeamsRes.json();
      const fanTeam = fanTeamsData.teams[0];
      expect(fanTeam.broadcastWorkouts.length).toBeGreaterThanOrEqual(1);
      expect(fanTeam.broadcastWorkouts[0].locationName).toBe('Willow Glen North Track Gate');
      expect(fanTeam.guardianSafetyAlerts).toEqual([]);
      expect(fanTeam.workoutComments).toEqual([]);
      for (const mem of fanTeam.memberships) {
        expect(mem.liveSnapshot).toBeUndefined();
      }

      const linkedGuardianSid = hexSid();
      const guardianFollow = await followTeamAsParentOrFan({
        callerSid: linkedGuardianSid,
        codeOrSlug: joinCode,
        followerName: 'Chen Guardian',
        verifiedEmail: 'guardian.chen@family.org',
        originUrl: baseUrl,
      });
      expect(guardianFollow.ok).toBe(true);
      const linkedCookie = cookieFor('usr_guardian_chen', linkedGuardianSid);
      const linkedTeamsRes = await fetch(`${baseUrl}/api/teams`, {
        headers: { Cookie: linkedCookie },
      });
      const linkedTeamsData = await linkedTeamsRes.json();
      const linkedTeam = linkedTeamsData.teams[0];
      expect(linkedTeam.broadcastWorkouts[0].locationName).toBe('Willow Glen North Track Gate');
      expect(linkedTeam.guardianSafetyAlerts.length).toBeGreaterThanOrEqual(1);
      expect(linkedTeam.workoutComments.length).toBeGreaterThanOrEqual(1);
      for (const mem of linkedTeam.memberships) {
        expect(mem.liveSnapshot).toBeUndefined();
      }

      // 8. ORG_ADMIN can view immutable audit log; ATHLETE and ATHLETIC_TRAINER receive 403
      const adminAuditRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/audit-log`,
        { headers: { Cookie: adminCookie } }
      );
      expect(adminAuditRes.status).toBe(200);
      const adminAuditData = await adminAuditRes.json();
      expect(adminAuditData.entries.length).toBeGreaterThan(0);

      const trainerAuditRes = await fetch(
        `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/audit-log`,
        { headers: { Cookie: trainerCookie } }
      );
      expect(trainerAuditRes.status).toBe(403);
    });
  });

  describe('3. 12-Athlete Coach Demo Squad, Formatters, Beginners, PMC Epoch Clamp & Offline Guard', () => {
    it('builds the 12-athlete Willow Glen Coach Demo squad with Maya Chen shin alert & non-zero PMC snapshots', () => {
      const ds = buildSampleDemoDataset('2026-11-19');
      expect(ds.plannedEvents).toHaveLength(4);
      expect(ds.demoTeams).toHaveLength(2);
      const squad = buildSampleDemoCoachSquad('2026-11-19');
      const athletes = squad.memberships.filter((m) => m.role === 'ATHLETE');
      expect(athletes).toHaveLength(12);
      expect(squad.guardianSafetyAlerts?.[0]?.athleteName).toBe('Maya Chen');
      expect(squad.workoutLibrary?.length).toBeGreaterThanOrEqual(6);
      expect(squad.workoutComments?.every((c) => c.guardianCcApplied)).toBe(true);
      for (const ath of athletes) {
        expect((ath.liveSnapshot?.ctl || 0)).toBeGreaterThan(20);
        expect((ath.liveSnapshot?.activities?.length || 0)).toBeGreaterThanOrEqual(1);
      }
    });

    it('fixes :60 duration/stopwatch/sleep rollover, double lbs conversion & pace clock parsing', () => {
      expect(formatDuration(59.6)).toBe('1m 00s');
      expect(formatDuration(119.8)).toBe('2m 00s');
      expect(formatStopwatch(59.996)).toBe('1:00');
      expect(formatStopwatch(60.0)).toBe('1:00');
      expect(formatStopwatch(3599.6)).toBe('1:00:00');
      expect(formatSleepDuration(3599)).toBe('1h 00m');
      expect(formatGoalMetricValue(150, 'lbs', 'mi')).toBe('150.0 lbs');
      expect(formatGoalMetricValue(66.5, 'kg', 'mi')).toBe('146.6 lbs');
      expect(formatPaceClockInput(252, 'km')).toBe('4:12');
      expect(parsePaceClockInput('6:45', 'km')).toBe(405);
      expect(parsePaceClockInput('bad', 'mi')).toBeNull();
    });

    it('includes Return-to-Run & First 5K confidence builder with zero FTP leaks', () => {
      const ids = ENDURANCE_PLAN_ARCHETYPES.map((a) => a.id);
      expect(ids).toContain('ROAD_RETURN_TO_RUN');
      expect(ids).toContain('ROAD_FIRST_5K');
      const rebuildWeeks = generateEnduranceTrainingPlan({
        archetypeId: 'ROAD_RETURN_TO_RUN',
        startDateIso: '2026-11-23',
        blockWeeks: 8,
        currentCtl: 20,
        distanceUnit: 'mi',
      });
      expect(rebuildWeeks).toHaveLength(8);
      for (const wk of rebuildWeeks) {
        for (const s of wk.sessions) {
          expect(s.workoutSyntax).not.toMatch(/FTP/i);
        }
      }
    });

    it('clamps pre-2000 .FIT epoch timestamps and computes 1,500 activities in < 500ms', () => {
      const profile = buildSampleDemoDataset('2026-11-19').athleteProfile;
      const baseMs = new Date('2026-11-01T08:00:00Z').getTime();
      const hugeActs = Array.from({ length: 1500 }, (_, i) => {
        const iso = new Date(baseMs - i * 12 * 3600 * 1000).toISOString().slice(0, 19);
        return {
          id: `stress-${i}`,
          startDateLocal: iso,
          name: `Session ${i}`,
          sportCategory: i % 3 === 0 ? ('Cycling' as const) : ('Running' as const),
          environment: 'OUTDOOR' as const,
          subType: 'Road' as const,
          movingTimeSecs: 2700,
          distanceMeters: 10000,
          elevationGainMeters: 40,
          intensityFactor: 0.8,
          variabilityIndex: 1.02,
          trainingLoad: 58,
          avgHr: 150,
          maxHr: 174,
          avgCadence: 175,
          aerobicDecouplingPct: 2.2,
          efficiencyFactor: 1.8,
          firstHalfEf: 1.82,
          secondHalfEf: 1.78,
          calories: 550,
          deviceName: 'Test Watch',
          zoneSecs: { hr: [300, 1500, 700, 200, 0] },
          stravaPrCount: 0,
          segmentEfforts: [],
          sourceBadges: ['Garmin' as const],
        };
      });

      // Inject corrupt 1989 Garmin .FIT epoch activity
      hugeActs.push({
        ...hugeActs[0],
        id: 'corrupt-fit-1989',
        startDateLocal: '1989-12-31T00:00:00',
      });

      const t0 = performance.now();
      const series = computeDualSportPmcSeries(hugeActs, profile, 90);
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(500);
      expect(series.length).toBeGreaterThan(0);
      expect(series[0].date >= '2000-01-01').toBe(true);
    });

    it('never deletes caches or triggers reload loops during offline chunk failures', async () => {
      const deleteSpy = vi.fn().mockResolvedValue(true);
      const reloadSpy = vi.fn();
      vi.stubGlobal('navigator', { onLine: false });
      vi.stubGlobal('window', {
        caches: { delete: deleteSpy },
        location: {
          origin: 'https://thresh.app',
          pathname: '/',
          search: '',
          hash: '',
          reload: reloadSpy,
        },
        sessionStorage: { getItem: () => null, setItem: () => {} },
      });

      await purgeStaleRuntimeChunkCaches();
      const reloaded = triggerChunkSkewReload('FitnessHealthView', 'fitness');

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(reloaded).toBe(false);

      vi.unstubAllGlobals();
    });
  });
});
