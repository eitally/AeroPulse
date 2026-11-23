import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import {
  buildDistrictOverviewFromDocs,
} from '../server/teamDistrictService.ts';
import {
  computeHaversineDistanceMeters,
  recordTeamAttendanceBatch,
  selfCheckInTeamAttendance,
} from '../server/teamFieldAndDailyOpsService.ts';
import {
  createTeamForCoach,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  sanitizeCoachAttribution,
  updateTeamBranding,
  type StoredTeamDocument,
} from '../server/teamService.ts';
import { removeTeamFromDirectoryAndVault } from '../server/teamLifecycleService.ts';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils.ts';
import { listTeamAuditLogAsync } from '../server/tokenVault.ts';
import {
  buildWahooPlanJson,
  hasWahooWorkoutPushScopes,
} from '../server/wahooConnectService.ts';
import {
  buildClientDistrictOverviewFromTeams,
  buildDistrictAdExecutiveSummaryHtml,
} from '../src/utils/districtAdOverviewHelper.ts';
import { PracticeAttendanceCheckInCard } from '../src/components/today/PracticeAttendanceCheckInCard.tsx';
import { CoachDailyOpsPanel } from '../src/components/coach/CoachDailyOpsPanel.tsx';
import { DistrictAdOverviewModal } from '../src/components/coach/DistrictAdOverviewModal.tsx';
import { CalendarWatchPushItems } from '../src/components/calendar/CalendarWatchPushItems.tsx';
import type { TeamSummaryWithRole } from '../src/types.ts';

class SimpleCookieJar {
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

  headerValue(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

describe('Sprint 3C · Coach Parity (GPS Practice Check-In, District AD Overview) & Direct Wahoo Push', () => {
  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;
  const origEnv = { ...process.env };
  const createdTeamIds: string[] = [];

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

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test_sprint3c_session_secret_0123456789';
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    process.env = { ...origEnv };
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) {
        await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
      }
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  describe('1. GPS Practice Attendance Self-Check-In (COPPA/FERPA/SafeSport-Safe)', () => {
    it('computes accurate Haversine distance and sanitizes practiceVenues, districtName, and referrerHost', () => {
      expect(computeHaversineDistanceMeters(37.4419, -122.143, 37.4419, -122.143)).toBe(0);
      const dist111m = computeHaversineDistanceMeters(37.4419, -122.143, 37.4429, -122.143);
      expect(dist111m).toBeGreaterThan(105);
      expect(dist111m).toBeLessThan(120);

      const cleanAttr = sanitizeCoachAttribution({
        utm_source: 'ad_campaign',
        referrerHost: 'https://Sub.CoachingBlog.COM:8443/article/123?utm=bad#hash',
      });
      expect(cleanAttr?.referrerHost).toBe('sub.coachingblog.com');
      expect(cleanAttr?.referrerHost).not.toContain('article');
      expect(cleanAttr?.referrerHost).not.toContain('?');
    });

    it('sanitizes practiceVenues (max 8, valid lat/lng, clamped radius 50..1500) and persists via updateTeamBranding & PUT /practice-venues', async () => {
      const coachSid = crypto.randomBytes(12).toString('hex');
      const athSid = crypto.randomBytes(12).toString('hex');
      const coachCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_coach_gps', coachSid, 'verified')}`;
      const athCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_ath_gps', athSid, 'verified')}`;

      const createRes = await fetch(`${baseUrl}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          name: 'Paly Track & XC',
          shortName: 'PALY',
          orgType: 'HIGH_SCHOOL',
          districtName: '  Palo Alto Unified School District  ',
          practiceVenues: Array.from({ length: 10 }, (_, idx) => ({
            id: `v_${idx}`,
            name: `Venue ${idx}`,
            category: 'TRACK',
            latitude: 37.434 + idx * 0.001,
            longitude: -122.155,
            radiusMeters: idx === 0 ? 12 : idx === 1 ? 9999 : undefined,
            enabled: true,
          })),
        }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      const teamId: string = created.team.brand.teamId;
      createdTeamIds.push(teamId);

      expect(created.team.brand.districtName).toBe('Palo Alto Unified School District');
      expect(created.team.brand.practiceVenues).toHaveLength(8);
      expect(created.team.brand.practiceVenues[0].radiusMeters).toBe(50);
      expect(created.team.brand.practiceVenues[1].radiusMeters).toBe(1500);
      expect(created.team.brand.practiceVenues[2].radiusMeters).toBe(250);

      // Athlete joins
      const joinRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: athCookie },
        body: JSON.stringify({
          codeOrSlug: created.team.brand.joinCode,
          athleteName: 'Jordan Track',
          squadGroup: 'Varsity',
          birthMonthYear: '2009-05',
          parentGuardianEmail: 'parent.jordan@example.com',
        }),
      });
      expect(joinRes.status).toBe(200);

      // Athlete forbidden from PUT /practice-venues
      const athVenueRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/practice-venues`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: athCookie },
        body: JSON.stringify({ practiceVenues: [] }),
      });
      expect(athVenueRes.status).toBe(403);

      // Coach updates venues with invalid lat skipped and valid venue saved
      const putVenueRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/practice-venues`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          practiceVenues: [
            {
              id: 'invalid_lat',
              name: 'Bad Pin',
              category: 'TRACK',
              latitude: 120,
              longitude: 0,
              radiusMeters: 250,
              enabled: true,
            },
            {
              id: 'track_main',
              name: 'Paly Track Oval',
              category: 'TRACK',
              latitude: 37.435,
              longitude: -122.155,
              radiusMeters: 250,
              enabled: true,
            },
          ],
        }),
      });
      expect(putVenueRes.status).toBe(200);
      const putData = await putVenueRes.json();
      expect(putData.practiceVenues).toHaveLength(1);
      expect(putData.practiceVenues[0].id).toBe('track_main');

      // Direct service updateTeamBranding also persists districtName & venues via saveTeamDocRaw
      const branded = await updateTeamBranding({
        callerSid: coachSid,
        teamId,
        originUrl: baseUrl,
        updates: { districtName: 'PAUSD Athletics' },
      });
      expect(branded?.brand.districtName).toBe('PAUSD Athletics');
    });

    it('enforces geofence radius, privacy-zero coordinate persistence, parent exclusion, teammate isolation & manual override preservation', async () => {
      const coachSid = crypto.randomBytes(12).toString('hex');
      const ath1Sid = crypto.randomBytes(12).toString('hex');
      const ath2Sid = crypto.randomBytes(12).toString('hex');
      const parentSid = crypto.randomBytes(12).toString('hex');

      const coachCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_c1', coachSid, 'verified')}`;
      const ath1Cookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_a1', ath1Sid, 'verified')}`;
      const ath2Cookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_a2', ath2Sid, 'verified')}`;
      const parentCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_p1', parentSid, 'verified')}`;

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: baseUrl,
        name: 'Gunn Titans Track',
        orgType: 'HIGH_SCHOOL',
        externalSync: { enablePublicParentHub: true },
        practiceVenues: [
          {
            id: 'gunn_track',
            name: 'Gunn Stadium Track',
            category: 'TRACK',
            latitude: 37.4005,
            longitude: -122.133,
            radiusMeters: 250,
            enabled: true,
          },
        ],
      });
      const teamId = team.brand.teamId;
      createdTeamIds.push(teamId);

      const join1 = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ath1Cookie },
        body: JSON.stringify({
          codeOrSlug: team.brand.joinCode,
          athleteName: 'Maya Lin',
          squadGroup: 'Varsity',
          birthMonthYear: '2009-06',
          parentGuardianEmail: 'lin.parent@example.com',
        }),
      });
      const join1Json = await join1.json();
      const ath1MemId: string = join1Json.team.myMembershipId;

      const join2 = await fetch(`${baseUrl}/api/teams/join-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ath2Cookie },
        body: JSON.stringify({
          codeOrSlug: team.brand.joinCode,
          athleteName: 'Samir Patel',
          squadGroup: 'Varsity',
          birthMonthYear: '2009-09',
          parentGuardianEmail: 'patel.parent@example.com',
        }),
      });
      const join2Json = await join2.json();
      const ath2MemId: string = join2Json.team.myMembershipId;

      const followRes = await fetch(`${baseUrl}/api/teams/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ codeOrSlug: team.brand.slug, followerName: 'Lin Parent' }),
      });
      expect(followRes.status).toBe(200);

      const todayIso = new Date().toISOString().slice(0, 10);
      const tomorrowIso = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

      // Unauthenticated -> 401
      const unauthRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/attendance/self-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayIso, latitude: 37.4005, longitude: -122.133 }),
      });
      expect(unauthRes.status).toBe(401);

      // Parent follower -> 403
      const parentRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/attendance/self-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
        body: JSON.stringify({ date: todayIso, latitude: 37.4005, longitude: -122.133 }),
      });
      expect(parentRes.status).toBe(403);
      const parentJson = await parentRes.json();
      expect(parentJson.error).toContain('Parent/guardian follower');

      // Athlete outside radius (~550m north) -> 400
      const outRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/attendance/self-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ath1Cookie },
        body: JSON.stringify({ date: todayIso, latitude: 37.4055, longitude: -122.133 }),
      });
      expect(outRes.status).toBe(400);
      const outJson = await outRes.json();
      expect(outJson.verifiedOnSite).toBe(false);
      expect(outJson.distanceMeters).toBeGreaterThan(250);
      expect(outJson.radiusMeters).toBe(250);
      expect(outJson.venueName).toBe('Gunn Stadium Track');

      // Athlete inside radius (~22m away) -> 200
      const athLat = 37.4007;
      const athLng = -122.133;
      const inRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/attendance/self-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ath1Cookie },
        body: JSON.stringify({ date: todayIso, latitude: athLat, longitude: athLng, accuracyMeters: 8 }),
      });
      expect(inRes.status).toBe(200);
      const inJson = await inRes.json();
      expect(inJson.verifiedOnSite).toBe(true);
      expect(inJson.distanceMeters).toBeLessThanOrEqual(30);
      expect(inJson.record.method).toBe('GPS_GEOFENCE');
      expect(inJson.record.status).toBe('PRESENT');

      // Athlete coordinates MUST NEVER appear in response, stored attendance record, or audit log
      const serializedResp = JSON.stringify(inJson.record);
      expect(serializedResp).not.toContain('37.4007');
      expect(serializedResp).not.toContain('-122.133');

      const storedDoc = await loadTeamDocRaw(teamId);
      const storedRecordStr = JSON.stringify(storedDoc?.attendanceByDate?.[todayIso]);
      expect(storedRecordStr).not.toContain('37.4007');
      expect(storedRecordStr).not.toContain('-122.133');

      const auditEntries = await listTeamAuditLogAsync(teamId, 20);
      const gpsAudit = auditEntries.find((a) => a.action === 'ATTENDANCE_GPS_SELF_CHECKIN');
      expect(gpsAudit).toBeDefined();
      expect(JSON.stringify(gpsAudit?.metadata)).not.toContain('37.4007');
      expect(JSON.stringify(gpsAudit?.metadata)).not.toContain('-122.133');

      // Coach manual batch attendance preserves GPS metadata for ath1 (PRESENT) and supports INJURED_MODIFIED for ath2
      const batchRes = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          date: todayIso,
          entries: [
            { membershipId: ath1MemId, status: 'PRESENT' },
            { membershipId: ath2MemId, status: 'INJURED_MODIFIED', note: 'Bike alt' },
          ],
        }),
      });
      expect(batchRes.status).toBe(200);
      const batchJson = await batchRes.json();
      const coachDay = batchJson.team.attendanceByDate[todayIso];
      expect(coachDay[ath1MemId].method).toBe('GPS_GEOFENCE');
      expect(coachDay[ath1MemId].verifiedOnSite).toBe(true);
      expect(coachDay[ath2MemId].status).toBe('INJURED_MODIFIED');
      expect(coachDay[ath2MemId].method).toBe('COACH_MANUAL');

      // Projection isolation: ath1 sees only ath1, ath2 sees only ath2, parent sees none
      const latestDoc = (await loadTeamDocRaw(teamId))!;
      const ath1Proj = projectTeamSummaryForCaller(latestDoc, ath1Sid, baseUrl)!;
      const ath2Proj = projectTeamSummaryForCaller(latestDoc, ath2Sid, baseUrl)!;
      const parentProj = projectTeamSummaryForCaller(latestDoc, parentSid, baseUrl)!;

      expect(Object.keys(ath1Proj.attendanceByDate?.[todayIso] || {})).toEqual([ath1MemId]);
      expect(Object.keys(ath2Proj.attendanceByDate?.[todayIso] || {})).toEqual([ath2MemId]);
      expect(parentProj.attendanceByDate).toBeUndefined();

      // Test disabled / no enabled venue returns 400
      await updateTeamBranding({
        callerSid: coachSid,
        teamId,
        originUrl: baseUrl,
        updates: { practiceVenues: [] },
      });
      const noVenueRes = await selfCheckInTeamAttendance({
        callerSid: ath1Sid,
        teamId,
        date: todayIso,
        latitude: 37.4007,
        longitude: -122.133,
      });
      expect(noVenueRes.ok).toBe(false);
      expect(noVenueRes.statusCode).toBe(400);

      // Direct recordTeamAttendanceBatch preserves GPS when LATE, clears when ABSENT
      await updateTeamBranding({
        callerSid: coachSid,
        teamId,
        originUrl: baseUrl,
        updates: {
          practiceVenues: [
            {
              id: 'gunn_track',
              name: 'Gunn Stadium Track',
              category: 'TRACK',
              latitude: 37.4005,
              longitude: -122.133,
              radiusMeters: 250,
              enabled: true,
            },
          ],
        },
      });
      await selfCheckInTeamAttendance({
        callerSid: ath1Sid,
        teamId,
        date: tomorrowIso,
        latitude: 37.4006,
        longitude: -122.133,
      });
      const keepLate = await recordTeamAttendanceBatch({
        callerSid: coachSid,
        teamId,
        date: tomorrowIso,
        entries: [{ membershipId: ath1MemId, status: 'LATE' }],
        originUrl: baseUrl,
      });
      expect(keepLate.team?.attendanceByDate?.[tomorrowIso]?.[ath1MemId]?.method).toBe('GPS_GEOFENCE');

      const overrideAbsent = await recordTeamAttendanceBatch({
        callerSid: coachSid,
        teamId,
        date: tomorrowIso,
        entries: [{ membershipId: ath1MemId, status: 'ABSENT' }],
        originUrl: baseUrl,
      });
      expect(overrideAbsent.team?.attendanceByDate?.[tomorrowIso]?.[ath1MemId]?.method).toBe('COACH_MANUAL');
    });

    it('renders PracticeAttendanceCheckInCard privacy caption & CoachDailyOpsPanel GPS pill', () => {
      const mockTeam: TeamSummaryWithRole = {
        brand: {
          teamId: 'tm_ui_1',
          slug: 'ui-track',
          joinCode: 'UI-26',
          name: 'UI Track',
          shortName: 'UIT',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#B83A24',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach Test',
          createdAt: '2026-11-01T00:00:00Z',
          practiceVenues: [
            {
              id: 'v1',
              name: 'Campus Oval',
              category: 'TRACK',
              latitude: 37.44,
              longitude: -122.14,
              radiusMeters: 250,
              enabled: true,
            },
          ],
        },
        myRole: 'ATHLETE',
        mySquadGroup: 'Varsity',
        myMembershipId: 'mem_a1',
        totalInvited: 1,
        openedCount: 1,
        activeCount: 1,
        watchConnectedCount: 1,
        memberships: [
          {
            membershipId: 'mem_a1',
            teamId: 'tm_ui_1',
            role: 'ATHLETE',
            squadGroup: 'Varsity',
            invitedName: 'Alex Runner',
            isMinorU18: true,
            status: 'ACTIVE',
            invitedAt: '2026-11-01T00:00:00Z',
          },
        ],
        broadcastWorkouts: [],
        attendanceByDate: {
          '2026-11-22': {
            mem_a1: {
              date: '2026-11-22',
              membershipId: 'mem_a1',
              status: 'PRESENT',
              verifiedOnSite: true,
              distanceMeters: 18,
              venueId: 'v1',
              venueName: 'Campus Oval',
              method: 'GPS_GEOFENCE',
              updatedAt: '2026-11-22T15:15:00Z',
            },
          },
        },
      };

      const receiptHtml = renderToStaticMarkup(
        React.createElement(PracticeAttendanceCheckInCard, {
          activeTeam: mockTeam,
          todayIso: '2026-11-22',
        })
      );
      expect(receiptHtml).toContain('One-time on-site distance check only');
      expect(receiptHtml).toContain('your GPS coordinates are never saved or tracked');
      expect(receiptHtml).toContain('On-Site ✓');
      expect(receiptHtml).toContain('18m');

      const pendingTeam: TeamSummaryWithRole = {
        ...mockTeam,
        attendanceByDate: {},
      };
      const pendingHtml = renderToStaticMarkup(
        React.createElement(PracticeAttendanceCheckInCard, {
          activeTeam: pendingTeam,
          todayIso: '2026-11-22',
        })
      );
      expect(pendingHtml).toContain('data-testid="gps-practice-checkin-btn"');

      const coachTeam: TeamSummaryWithRole = {
        ...mockTeam,
        myRole: 'HEAD_COACH',
        attendanceByDate: {
          [new Date().toISOString().slice(0, 10)]: mockTeam.attendanceByDate!['2026-11-22'],
        },
      };
      // Use local date ISO matching CoachDailyOpsPanel todayLocalIso()
      const now = new Date();
      const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      coachTeam.attendanceByDate = {
        [localToday]: mockTeam.attendanceByDate!['2026-11-22'],
      };
      const coachHtml = renderToStaticMarkup(
        React.createElement(CoachDailyOpsPanel, {
          activeTeam: coachTeam,
          myTeams: [coachTeam],
          complexityTier: 'ESSENTIALS',
          onLaunchStopwatch: () => {},
          onLaunchFieldSheet: () => {},
          onTeamsUpdated: () => {},
        })
      );
      expect(coachHtml).toContain('GPS ✓ · 18m');
      expect(coachHtml).toContain('practice-venues-toggle-btn');
    });
  });

  describe('2. Multi-School District AD Overview ($2,000/yr District Tier)', () => {
    it('aggregates governed schools cleanly, strips clinical notes, PII & Stripe IDs, and serves GET /api/teams/district-overview', async () => {
      const adSid = crypto.randomBytes(12).toString('hex');
      const adCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_ad_1', adSid, 'verified')}`;

      const todayIso = new Date().toISOString().slice(0, 10);
      const tomorrowIso = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const docs: StoredTeamDocument[] = [
        {
          brand: {
            teamId: 'tm_dist_1',
            slug: 'paly-xc',
            joinCode: 'PALY',
            name: 'Palo Alto High XC',
            shortName: 'PALY XC',
            districtName: 'PAUSD',
            orgType: 'HIGH_SCHOOL',
            primarySport: 'Running',
            primaryHex: '#14532D',
            secondaryHex: '#D97706',
            defaultSafeSportShield: true,
            enableParentGuardianCc: true,
            coachDisplayName: 'AD Smith',
            createdAt: '2026-09-01T00:00:00Z',
          },
          memberships: [
            {
              membershipId: 'm_ad',
              teamId: 'tm_dist_1',
              userSid: adSid,
              role: 'ORG_ADMIN',
              squadGroup: 'Admin',
              invitedName: 'AD Smith',
              isMinorU18: false,
              status: 'ACTIVE',
              invitedAt: '2026-09-01T00:00:00Z',
            },
            {
              membershipId: 'm_ath1',
              teamId: 'tm_dist_1',
              role: 'ATHLETE',
              squadGroup: 'Varsity',
              invitedName: 'Secret Student Name',
              invitedEmail: 'student.secret@pausd.edu',
              parentGuardianEmail: 'mom.secret@example.com',
              birthMonthYear: '2009-05',
              isMinorU18: true,
              parentConsentStatus: 'ACKNOWLEDGED',
              status: 'ACTIVE',
              invitedAt: '2026-09-01T00:00:00Z',
              liveSnapshot: {
                updatedAt: '2026-11-22T00:00:00Z',
                hasConnectedWatch: true,
                verdictLabel: 'Amber',
                readinessScore: 60,
                ctl: 40,
                atl: 48,
                tsb: -8,
                acuteLoad7d: 260,
                lowAerobicPct: 70,
                highAerobicPct: 20,
                neuromuscularPct: 10,
                caraHours7d: 21.5,
                safeSportHideWeight: true,
                safeSportWatch: {
                  trafficLight: 'RED_MEDICAL_REVIEW',
                  coachSafeSummaryLabel: 'Review',
                },
              },
            },
            {
              membershipId: 'm_ath2',
              teamId: 'tm_dist_1',
              role: 'ATHLETE',
              squadGroup: 'JV',
              invitedName: 'Second Minor',
              birthMonthYear: '2010-03',
              isMinorU18: true,
              parentConsentStatus: 'PENDING',
              status: 'ACTIVE',
              invitedAt: '2026-09-01T00:00:00Z',
              liveSnapshot: {
                updatedAt: '2026-11-22T00:00:00Z',
                hasConnectedWatch: true,
                verdictLabel: 'Ready',
                readinessScore: 80,
                ctl: 30,
                atl: 28,
                tsb: 2,
                acuteLoad7d: 180,
                lowAerobicPct: 80,
                highAerobicPct: 15,
                neuromuscularPct: 5,
                caraHours7d: 18.5,
                safeSportHideWeight: true,
                safeSportWatch: {
                  trafficLight: 'AMBER_WATCH',
                  coachSafeSummaryLabel: 'Watch',
                },
              },
            },
          ],
          broadcastWorkouts: [],
          attendanceByDate: {
            [todayIso]: {
              m_ath1: {
                date: todayIso,
                membershipId: 'm_ath1',
                status: 'INJURED_MODIFIED',
                updatedAt: '2026-11-22T15:00:00Z',
              },
            },
          },
          injuryCases: [
            {
              id: 'inj_1',
              teamId: 'tm_dist_1',
              membershipId: 'm_ath1',
              athleteName: 'Secret Student Name',
              bodyRegion: 'SHIN',
              severity: 'HIGH',
              rtpStage: 'MODIFIED',
              restrictions: 'Pool only',
              coachGuidance: 'Aqua jog',
              privateClinicalNotes: 'CONFIDENTIAL CLINICAL NOTE DO NOT LEAK',
              createdAt: '2026-11-20T00:00:00Z',
              updatedAt: '2026-11-20T00:00:00Z',
            },
          ],
          billing: {
            planCode: 'DISTRICT_2000',
            status: 'ACTIVE_PAID',
            stripeCustomerId: 'cus_secret_stripe_123',
            stripeSubscriptionId: 'sub_secret_stripe_456',
            billingCycleEndIso: '2026-12-10',
            poInvoices: [
              {
                invoiceNumber: 'MR-PO-2026-9001',
                planCode: 'DISTRICT_2000',
                amountUsd: 2000,
                schoolOrDistrictName: 'PAUSD',
                billingContactEmail: 'ap@pausd.edu',
                issuedAt: '2026-11-01T00:00:00Z',
                dueDate: '2026-12-01',
                status: 'ISSUED',
              },
            ],
          },
          updatedAt: '2026-11-22T00:00:00Z',
        },
        {
          // Athlete-only membership must NOT appear in AD rollup
          brand: {
            teamId: 'tm_other_club',
            slug: 'other-club',
            joinCode: 'OTHR',
            name: 'External Club',
            shortName: 'EXT',
            districtName: 'Other District',
            orgType: 'RUNNING_CLUB',
            primarySport: 'Running',
            primaryHex: '#000000',
            secondaryHex: '#FFFFFF',
            defaultSafeSportShield: false,
            enableParentGuardianCc: false,
            coachDisplayName: 'Coach X',
            createdAt: '2026-09-01T00:00:00Z',
          },
          memberships: [
            {
              membershipId: 'm_role_ath',
              teamId: 'tm_other_club',
              userSid: adSid,
              role: 'ATHLETE',
              squadGroup: 'Open',
              invitedName: 'AD Running',
              isMinorU18: false,
              status: 'ACTIVE',
              invitedAt: '2026-09-01T00:00:00Z',
            },
          ],
          broadcastWorkouts: [],
          updatedAt: '2026-11-22T00:00:00Z',
        },
      ];

      const report = buildDistrictOverviewFromDocs(docs, adSid, { todayIso });
      expect(report.hasDistrictPlan).toBe(true);
      expect(report.availableDistrictNames).toEqual(['PAUSD']);
      expect(report.totals.schoolCount).toBe(1);
      expect(report.totals.activeAtInjuries).toBe(1);
      expect(report.totals.modifiedAttendanceToday).toBe(1);
      expect(report.totals.safeSportRedFlags).toBe(1);
      expect(report.totals.safeSportAmberFlags).toBe(1);
      expect(report.totals.overallGuardianCcCompliancePct).toBe(50);
      expect(report.totals.caraOverCapCount).toBe(1);
      expect(report.totals.caraWarningCount).toBe(1);
      expect(report.totals.avgCaraHours7d).toBe(20);
      expect(report.totals.schoolsNeedingRenewal).toBe(1);
      expect(report.totals.totalAnnualCommittedUsd).toBe(2000);

      // Strict PII, clinical note, and Stripe ID stripping
      const reportJson = JSON.stringify(report);
      expect(reportJson).not.toContain('CONFIDENTIAL CLINICAL NOTE');
      expect(reportJson).not.toContain('Secret Student Name');
      expect(reportJson).not.toContain('student.secret@pausd.edu');
      expect(reportJson).not.toContain('mom.secret@example.com');
      expect(reportJson).not.toContain('cus_secret_stripe_123');
      expect(reportJson).not.toContain('sub_secret_stripe_456');

      // HTTP endpoint: 401 when unauthenticated, 200 when verified, mounted before :teamId
      const unauthRes = await fetch(`${baseUrl}/api/teams/district-overview`);
      expect(unauthRes.status).toBe(401);

      const t1 = await createTeamForCoach({
        callerSid: adSid,
        originUrl: baseUrl,
        name: 'Gunn HS Track',
        orgType: 'HIGH_SCHOOL',
        districtName: 'PAUSD',
      });
      createdTeamIds.push(t1.brand.teamId);
      const t2 = await createTeamForCoach({
        callerSid: adSid,
        originUrl: baseUrl,
        name: 'Fremont HS Track',
        orgType: 'HIGH_SCHOOL',
        districtName: 'FUHSD',
      });
      createdTeamIds.push(t2.brand.teamId);

      const allRes = await fetch(`${baseUrl}/api/teams/district-overview`, {
        headers: { Cookie: adCookie },
      });
      expect(allRes.status).toBe(200);
      const allData = await allRes.json();
      expect(allData.ok).toBe(true);
      expect(allData.report.totals.schoolCount).toBe(2);
      expect(allData.report.availableDistrictNames).toEqual(['FUHSD', 'PAUSD']);

      const filteredRes = await fetch(
        `${baseUrl}/api/teams/district-overview?districtName=${encodeURIComponent('PAUSD')}`,
        { headers: { Cookie: adCookie } }
      );
      expect(filteredRes.status).toBe(200);
      const filteredData = await filteredRes.json();
      expect(filteredData.report.totals.schoolCount).toBe(1);
      expect(filteredData.report.schools[0].teamName).toBe('Gunn HS Track');

      // Client helper + safe printable HTML + Modal render check
      const clientReport = buildClientDistrictOverviewFromTeams([t1, t2]);
      expect(clientReport.totals.schoolCount).toBe(2);
      const xssReport = {
        ...clientReport,
        districtFilter: '<script>alert(1)</script>PAUSD',
      };
      const printHtml = buildDistrictAdExecutiveSummaryHtml(xssReport);
      expect(printHtml).toContain('@media print');
      expect(printHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;PAUSD');
      expect(printHtml).not.toContain('<script>alert(1)</script>');

      const modalHtml = renderToStaticMarkup(
        React.createElement(DistrictAdOverviewModal, {
          isOpen: true,
          onClose: () => {},
          myTeams: [t1, t2],
          activeTeamId: t1.brand.teamId,
          isSampleDemoMode: true,
          onSelectActiveTeam: () => {},
        })
      );
      expect(modalHtml).toContain('data-testid="district-ad-overview-modal"');
      expect(modalHtml).toContain('Print District AD Executive Summary');
      expect(modalHtml).toContain('Gunn HS Track');
    });
  });

  describe('3. Direct Wahoo Cloud API Workout Push (+ Polar/Suunto Flags)', () => {
    it('validates Wahoo write scopes and builds structured Wahoo plan.json from track syntax & fallback steps', () => {
      expect(hasWahooWorkoutPushScopes(undefined)).toBe(false);
      expect(hasWahooWorkoutPushScopes('user_read workouts_read')).toBe(false);
      expect(hasWahooWorkoutPushScopes('user_read workouts_read workouts_write')).toBe(false);
      expect(hasWahooWorkoutPushScopes('user_read workouts_read workouts_write plans_write')).toBe(
        true
      );

      const trackPlan = buildWahooPlanJson({
        date: '2026-11-24',
        name: 'Track 4x400m',
        sportCategory: 'Running',
        workoutSyntax: 'Warmup\n- 10m 65% Pace\n\nMain Set 4x\n- 400m 105% Pace\n- 200m jog',
        thresholdPaceSecsPerKm: 240,
      });
      expect(trackPlan.sport).toBe('Running');
      expect(trackPlan.intervals.length).toBeGreaterThanOrEqual(2);
      const repeatBlock = trackPlan.intervals.find((iv) => iv.repeat === 4);
      expect(repeatBlock).toBeDefined();
      expect(repeatBlock?.intervals?.[0].exit_trigger_type).toBe('distance');
      expect(repeatBlock?.intervals?.[0].exit_trigger_value).toBe(400);

      const fallbackPlan = buildWahooPlanJson({
        date: '2026-11-24',
        name: 'Sweet Spot Ride',
        sportCategory: 'Cycling',
        ftpWatts: 300,
        steps: [
          { label: 'Warmup', durationSecs: 600, targetPctFtp: 60, stepType: 'warmup' },
          { label: 'SS Block', durationSecs: 1200, targetPctFtp: 90, stepType: 'interval' },
        ],
      });
      expect(fallbackPlan.sport).toBe('Cycling');
      expect(fallbackPlan.intervals).toHaveLength(2);
      expect(fallbackPlan.intervals[1].targets[0]).toMatchObject({
        type: 'power',
        low: 257,
        high: 284,
      });
    });

    it('handles 503 setupRequired, 401 connectRequired, 403 needsScopeUpgrade, 200 pushed, partial 403 schedule, and 401 refresh retry', async () => {
      // 1. 503 setupRequired when WAHOO_CLIENT_ID / SECRET missing
      delete process.env.WAHOO_CLIENT_ID;
      delete process.env.WAHOO_CLIENT_SECRET;
      const res503 = await fetch(`${baseUrl}/api/wahoo/workouts/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Workout' }),
      });
      expect(res503.status).toBe(503);
      const json503 = await res503.json();
      expect(json503.setupRequired).toBe(true);
      expect(json503.pushed).toBe(false);

      // 2. 401 connectRequired when configured but not connected
      process.env.WAHOO_CLIENT_ID = 'wahoo_cid';
      process.env.WAHOO_CLIENT_SECRET = 'wahoo_csec';
      const res401 = await fetch(`${baseUrl}/api/wahoo/workout/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Workout' }),
      });
      expect(res401.status).toBe(401);
      const json401 = await res401.json();
      expect(json401.connectRequired).toBe(true);

      // 3. Connect via OAuth callback with read-only scope -> 403 needsScopeUpgrade + config status flags
      const jarRo = new SimpleCookieJar();
      const authUrlResRo = await fetch(`${baseUrl}/api/wahoo/auth/url`);
      jarRo.absorbResponse(authUrlResRo);
      const { state: stateRo, url: authUrlStr } = await authUrlResRo.json();
      expect(authUrlStr).toContain('workouts_write');
      expect(authUrlStr).toContain('plans_write');

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.startsWith(baseUrl)) return originalFetch(input, init);
        if (u.includes('api.wahooligan.com/oauth/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'wahoo_ro_tok',
              refresh_token: 'wahoo_ro_ref',
              expires_in: 7200,
              scope: 'user_read workouts_read',
              user: { id: 101, first_name: 'Read', last_name: 'Only' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const cbRo = await fetch(
        `${baseUrl}/auth/wahoo/callback?code=code_ro&state=${encodeURIComponent(stateRo)}`,
        { headers: { Cookie: jarRo.headerValue() } }
      );
      jarRo.absorbResponse(cbRo);
      expect(cbRo.status).toBe(200);

      const statusRo = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jarRo.headerValue() },
      });
      const statusRoJson = await statusRo.json();
      expect(statusRoJson.wahooConnected).toBe(true);
      expect(statusRoJson.wahooScope).toBe('user_read workouts_read');
      expect(statusRoJson.wahooCanPushWorkouts).toBe(false);
      expect(statusRoJson.polarCanPushWorkouts).toBe(false);
      expect(typeof statusRoJson.corosCanPushWorkouts).toBe('boolean');

      const res403 = await fetch(`${baseUrl}/api/wahoo/workouts/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: jarRo.headerValue() },
        body: JSON.stringify({ name: 'Blocked Ride' }),
      });
      expect(res403.status).toBe(403);
      const json403 = await res403.json();
      expect(json403.needsScopeUpgrade).toBe(true);

      // 4. Connect with full write scopes -> test 401 refresh retry + 200 pushed + base64 plan.json
      const jarRw = new SimpleCookieJar();
      const authUrlResRw = await fetch(`${baseUrl}/api/wahoo/auth/url`);
      jarRw.absorbResponse(authUrlResRw);
      const { state: stateRw } = await authUrlResRw.json();

      let planAttempts = 0;
      let capturedPlanDataUrl = '';
      let refreshedCount = 0;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.startsWith(baseUrl)) return originalFetch(input, init);
        if (u.includes('api.wahooligan.com/oauth/token')) {
          const bodyStr = String(init?.body || '');
          if (bodyStr.includes('grant_type=refresh_token')) {
            refreshedCount += 1;
            return new Response(
              JSON.stringify({
                access_token: 'wahoo_fresh_tok_2',
                refresh_token: 'wahoo_rw_ref_2',
                expires_in: 7200,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response(
            JSON.stringify({
              access_token: 'wahoo_stale_tok_1',
              refresh_token: 'wahoo_rw_ref_1',
              expires_in: 7200,
              scope: 'user_read workouts_read workouts_write plans_write',
              user: { id: 202, first_name: 'ELEMNT', last_name: 'Pro' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('api.wahooligan.com/v1/plans')) {
          planAttempts += 1;
          const authHdr = (init?.headers as Record<string, string>)?.Authorization || '';
          if (planAttempts === 1 && authHdr.includes('wahoo_stale_tok_1')) {
            return new Response('Token expired', { status: 401 });
          }
          const parsedBody = JSON.parse(String(init?.body || '{}')) as {
            plan?: { file?: string };
          };
          capturedPlanDataUrl = parsedBody.plan?.file || '';
          return new Response(JSON.stringify({ id: 9901 }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('api.wahooligan.com/v1/workouts')) {
          return new Response(JSON.stringify({ id: 8801 }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const cbRw = await fetch(
        `${baseUrl}/auth/wahoo/callback?code=code_rw&state=${encodeURIComponent(stateRw)}`,
        { headers: { Cookie: jarRw.headerValue() } }
      );
      jarRw.absorbResponse(cbRw);

      const statusRw = await fetch(`${baseUrl}/api/config/status`, {
        headers: { Cookie: jarRw.headerValue() },
      });
      const statusRwJson = await statusRw.json();
      expect(statusRwJson.wahooCanPushWorkouts).toBe(true);

      const pushRes = await fetch(`${baseUrl}/api/wahoo/workouts/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: jarRw.headerValue() },
        body: JSON.stringify({
          date: '2026-11-25',
          name: 'Threshold 3x10m',
          sportCategory: 'Cycling',
          ftpWatts: 290,
          workoutSyntax: '3x 10m 98% FTP (3m easy)',
        }),
      });
      expect(pushRes.status).toBe(200);
      const pushJson = await pushRes.json();
      expect(pushJson.pushed).toBe(true);
      expect(pushJson.partialSuccess).toBe(false);
      expect(pushJson.planId).toBe(9901);
      expect(pushJson.workoutId).toBe(8801);
      expect(refreshedCount).toBe(1);
      expect(planAttempts).toBe(2);
      expect(capturedPlanDataUrl.startsWith('data:application/json;base64,')).toBe(true);

      const decodedPlan = JSON.parse(
        Buffer.from(capturedPlanDataUrl.replace('data:application/json;base64,', ''), 'base64').toString(
          'utf8'
        )
      );
      expect(decodedPlan.name).toBe('Threshold 3x10m');

      // 5. Partial success when /v1/plans succeeds and /v1/workouts returns 403
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.startsWith(baseUrl)) return originalFetch(input, init);
        if (u.includes('api.wahooligan.com/v1/plans')) {
          return new Response(JSON.stringify({ id: 9902 }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('api.wahooligan.com/v1/workouts')) {
          return new Response('Calendar write restricted', { status: 403 });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof fetch;

      const partialRes = await fetch(`${baseUrl}/api/wahoo/workout/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: jarRw.headerValue() },
        body: JSON.stringify({
          date: '2026-11-26',
          name: 'Library Plan Only',
          sportCategory: 'Running',
          workoutSyntax: '20m 75% Pace',
        }),
      });
      expect(partialRes.status).toBe(200);
      const partialJson = await partialRes.json();
      expect(partialJson.pushed).toBe(true);
      expect(partialJson.partialSuccess).toBe(true);
      expect(partialJson.planId).toBe(9902);

      // 6. Export endpoint includes wahooPlanJson
      const exportRes = await fetch(`${baseUrl}/api/workouts/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Wahoo Export Test',
          sportCategory: 'Cycling',
          ftp: 280,
          workoutSyntax: '15m 65% Warmup\n20m 95% Threshold',
        }),
      });
      expect(exportRes.status).toBe(200);
      const exportJson = await exportRes.json();
      expect(exportJson.wahooPlanJson).toBeDefined();
      expect(exportJson.wahooPlanJson.name).toBe('Wahoo Export Test');
      expect(exportJson.wahooPlanJson.intervals.length).toBeGreaterThanOrEqual(2);

      // 7. UI buttons exist across CalendarWatchPushItems, VisualWorkoutBuilder & ReadinessMorphingCard
      const pushMenuHtml = renderToStaticMarkup(
        React.createElement(CalendarWatchPushItems, {
          options: {
            name: 'VO2 Set',
            sport: 'Running',
            workoutSyntax: '5x 3m 105% Pace',
          },
        })
      );
      expect(pushMenuHtml).toContain('data-testid="calendar-push-wahoo"');
      expect(pushMenuHtml).toContain('Wahoo ELEMNT');

      const vwbSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/VisualWorkoutBuilder.tsx'),
        'utf8'
      );
      expect(vwbSrc).toContain('data-testid="visual-builder-wahoo-push"');

      const rmcSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/ReadinessMorphingCard.tsx'),
        'utf8'
      );
      expect(rmcSrc).toContain("handlePushToWatch('wahoo')");
    });
  });
});
