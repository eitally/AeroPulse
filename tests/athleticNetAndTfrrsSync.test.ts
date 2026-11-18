import http from 'http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { SESSION_COOKIE_NAME } from '../server/securityUtils.ts';
import { loadTeamDocRaw, saveTeamDocRaw } from '../server/teamService.ts';
import {
  COLLEGIATE_TFRRS_PRESET,
  WILLOW_GLEN_XC_PRESET,
  buildPresetExternalTeamSummary,
  buildThreshExternalSyncBookmarklet,
  detectExternalPasteKind,
  matchExternalResultsToRoster,
  normalizeWebcalUrl,
  parseExternalMeetResults,
  parseExternalTeamRoster,
  parseExternalTeamUrl,
  parseIcsCalendarToMeets,
  parsePastedScheduleToMeets,
  resolveRaceEventDistance,
  tryParseBookmarkletEnvelope,
} from '../src/utils/athleticNetAndTfrrsEngine.ts';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute.ts';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage.tsx';
import { AthleticNetTfrrsSyncModal } from '../src/components/AthleticNetTfrrsSyncModal.tsx';

describe('Athletic.net & TFRRS Team Sync + Clean-Room Parent Hub', () => {
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
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  describe('1. URL & Distance Parsers', () => {
    it('parses Athletic.net modern photos URL, legacy School.aspx URL, and collegiate TFRRS URLs', () => {
      const wgPhotos = parseExternalTeamUrl('https://www.athletic.net/photos/team/1073/xc');
      expect(wgPhotos).toMatchObject({
        platform: 'ATHLETIC_NET',
        athleticNetSchoolId: '1073',
        athleticNetSportSlug: 'xc',
        canonicalUrl: 'https://www.athletic.net/team/1073/xc',
        orgTypeHint: 'HIGH_SCHOOL',
        inferredTeamName: 'Willow Glen High School',
      });

      const legacy = parseExternalTeamUrl(
        'https://www.athletic.net/CrossCountry/School.aspx?SchoolID=1073'
      );
      expect(legacy).toMatchObject({
        platform: 'ATHLETIC_NET',
        athleticNetSchoolId: '1073',
        athleticNetSportSlug: 'xc',
        canonicalUrl: 'https://www.athletic.net/team/1073/xc',
      });

      const tfrrs = parseExternalTeamUrl(
        'https://xc.tfrrs.org/teams/xc/CA_college_m_Pacific.html'
      );
      expect(tfrrs).toMatchObject({
        platform: 'TFRRS',
        tfrrsTeamCode: 'CA_college_m_Pacific',
        genderHint: 'M',
        orgTypeHint: 'COLLEGIATE',
      });
    });

    it('resolves non-5K California HS XC course distances and NCAA/Track distances accurately', () => {
      const crystal = resolveRaceEventDistance('Crystal Springs 2.95 mi Varsity');
      expect(crystal.distanceMeters).toBe(4748);
      expect(crystal.trackType).toBe('XC_COURSE');
      expect(crystal.isCrossCountry).toBe(true);

      const montgomery = resolveRaceEventDistance('Montgomery Hill 2.74 mi');
      expect(montgomery.distanceMeters).toBe(4410);
      expect(montgomery.trackType).toBe('XC_COURSE');

      const ncaa8k = resolveRaceEventDistance('NCAA Men 8K XC');
      expect(ncaa8k.distanceMeters).toBe(8000);
      expect(ncaa8k.trackType).toBe('XC_COURSE');

      const track1600 = resolveRaceEventDistance('1600m Outdoor');
      expect(track1600.distanceMeters).toBe(1600);
      expect(track1600.trackType).toBe('OUTDOOR_400M');
      expect(track1600.isCrossCountry).toBe(false);
    });
  });

  describe('2. Schedule, Roster, Hy-Tek & Meet Result Parsing + Fuzzy Matching', () => {
    it('normalizes webcal URLs and parses all 5 Willow Glen .ics meet events plus pasted schedule tables', () => {
      expect(normalizeWebcalUrl('webcal://www.athletic.net/cal/team-1073.ics')).toBe(
        'https://www.athletic.net/cal/team-1073.ics'
      );
      expect(normalizeWebcalUrl('webcals://www.athletic.net/cal/team-1073.ics')).toBe(
        'https://www.athletic.net/cal/team-1073.ics'
      );

      const meets = parseIcsCalendarToMeets(
        WILLOW_GLEN_XC_PRESET.sampleScheduleIcs,
        'ATHLETIC_NET'
      );
      expect(meets).toHaveLength(5);
      expect(meets[1]).toMatchObject({
        date: '2026-10-17',
        name: 'Serra Crystal Springs Invitational (2.95 mi)',
        locationCategory: 'XC_COURSE',
        distanceMeters: 4748,
      });

      const tableMeets = parsePastedScheduleToMeets(
        [
          '09/19/2026 | Lowell Invitational | Golden Gate Park, SF | 09:00',
          '10/17/2026 | Crystal Springs Invitational 2.95 mi | Crystal Springs Course, Belmont',
        ].join('\n'),
        { externalSource: 'ATHLETIC_NET' }
      );
      expect(tableMeets).toHaveLength(2);
      expect(tableMeets[0].date).toBe('2026-09-19');
      expect(tableMeets[1].distanceMeters).toBe(4748);
    });

    it('parses Athletic.net rosters, Collegiate TFRRS CSV (FR-1..SR-4), and Hy-Tek semicolon rows', () => {
      const wgRoster = parseExternalTeamRoster(WILLOW_GLEN_XC_PRESET.sampleRosterText, {
        orgType: 'HIGH_SCHOOL',
        externalSource: 'ATHLETIC_NET',
      });
      expect(wgRoster).toHaveLength(6);
      expect(wgRoster[0]).toMatchObject({
        name: 'Lucas Alvarez',
        squadGroup: 'Boys Varsity',
        genderDivision: 'M',
        seedMarkOrFtp: '15:18.40',
        isMinorU18: true,
        externalSource: 'ATHLETIC_NET',
      });
      expect(wgRoster[3]).toMatchObject({
        name: 'Sofia Chen',
        squadGroup: 'Girls Varsity',
        genderDivision: 'F',
      });

      const tfrrsRoster = parseExternalTeamRoster(COLLEGIATE_TFRRS_PRESET.sampleRosterText, {
        orgType: 'COLLEGIATE',
        externalSource: 'TFRRS',
      });
      expect(tfrrsRoster).toHaveLength(3);
      expect(tfrrsRoster[0]).toMatchObject({
        name: 'Jordan Mercer',
        externalAthleteId: '8491021',
        gradeLabel: 'SR-4',
        genderDivision: 'M',
        externalSource: 'TFRRS',
        isMinorU18: false,
      });

      const hytekRows = parseExternalTeamRoster(
        'Alvarez, Lucas; 12; Boys Varsity; 15:18.40\nNavarro, Mateo; 11; Boys Varsity; 15:54.10',
        { orgType: 'HIGH_SCHOOL', externalSource: 'HYTEK' }
      );
      expect(hytekRows).toHaveLength(2);
      expect(hytekRows[0].name).toBe('Lucas Alvarez');
    });

    it('filters meet results to Willow Glen, matches "Last, First" athletes, and synthesizes VDOT-calibrated races', () => {
      const lastFirstResults = `Meet: Serra Crystal Springs Invitational | Date: 2026-10-17 | Course: Crystal Springs 2.95 mi
1 | Alvarez, Lucas | 12 | Willow Glen | 15:18.40
8 | Navarro, Mateo | 11 | Willow Glen | 15:54.10
14 | Liam O'Connor | 11 | Rival High | 16:08.50
21 | Ethan Wu | 11 | Willow Glen | 16:22.80
3 | Sofia Chen | 12 | Willow Glen | 18:14.20
11 | Maya Patel | 10 | Willow Glen | 18:49.50`;

      expect(detectExternalPasteKind(lastFirstResults)).toBe('MEET_RESULTS');

      const parsed = parseExternalMeetResults(lastFirstResults, {
        teamFilterKeyword: 'Willow Glen',
        externalSource: 'ATHLETIC_NET',
      });
      expect(parsed).toHaveLength(5);
      expect(parsed.some((r) => /O'Connor/i.test(r.athleteName))).toBe(false);
      expect(parsed[0].eventDistanceMeters).toBe(4748);

      const matchSummary = matchExternalResultsToRoster(parsed, [
        {
          membershipId: 'mem_lucas',
          invitedName: 'Lucas Alvarez',
          squadGroup: 'Boys Varsity',
        },
        {
          membershipId: 'mem_sofia',
          invitedName: 'Sofia Chen',
          squadGroup: 'Girls Varsity',
        },
      ]);

      expect(matchSummary.matchedExistingCount).toBe(2);
      expect(matchSummary.newWalkOnCount).toBe(3);
      expect(matchSummary.matched[0]).toMatchObject({
        action: 'MATCHED',
        membershipId: 'mem_lucas',
        matchedAthleteName: 'Lucas Alvarez',
      });
      expect(matchSummary.matched[0].activity.officialRaceData?.vdotScore).toBeGreaterThan(50);
      expect(matchSummary.matched[0].activity.distanceMeters).toBe(4748);
    });

    it('builds valid javascript: bookmarklet and parses THRESH_SYNC_V1 envelopes', () => {
      const bm = buildThreshExternalSyncBookmarklet('https://thresh-dev.vercel.app');
      expect(bm.startsWith('javascript:')).toBe(true);
      expect(decodeURIComponent(bm)).toContain('THRESH_EXTERNAL_SYNC_V1');

      const sampleClip = `THRESH_SYNC_V1:${JSON.stringify({
        schema: 'THRESH_SYNC_V1',
        sourcePlatform: 'ATHLETIC_NET',
        pageUrl: 'https://www.athletic.net/team/1073/xc',
        pageTitle: 'Willow Glen XC Roster',
        capturedAt: '2026-10-17T16:00:00.000Z',
        athletes: [{ name: 'Lucas Alvarez', externalAthleteId: '18492011', gradeOrYear: '12', seedMark: '15:18.40' }],
      })}`;
      const env = tryParseBookmarkletEnvelope(sampleClip);
      expect(env?.athletes?.[0].externalAthleteId).toBe('18492011');
      expect(detectExternalPasteKind(sampleClip)).toBe('ROSTER');
    });
  });

  describe('3. Express HTTP Endpoints, SSRF Guard & Safe-Sport Clean-Room Isolation', () => {
    it('syncs Willow Glen HS via API, blocks loopback .ics SSRF, and guarantees zero PII/biometrics on public hub and PARENT_FOLLOWER role', async () => {
      // 1. Coach creates Willow Glen team
      const createResp = await fetch(`${baseUrl}/api/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Willow Glen High School XC',
          shortName: 'WGHS XC',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#991B1B',
          secondaryHex: '#D97706',
          coachDisplayName: 'Coach Morales',
          coachEmail: 'coach.morales@secret-school.edu',
          externalSync: {
            platform: 'ATHLETIC_NET',
            athleticNetSchoolId: '1073',
            athleticNetUrl: 'https://www.athletic.net/photos/team/1073/xc',
            teamFilterKeyword: 'Willow Glen',
            enablePublicParentHub: true,
          },
        }),
      });
      const createData = await createResp.json();
      expect(createResp.status).toBe(200);
      expect(createData.ok).toBe(true);
      expect(createData.sessionToken).toBeTruthy();

      const teamId: string = createData.team.brand.teamId;
      const slug: string = createData.team.brand.slug;
      const coachCookie = `${SESSION_COOKIE_NAME}=${createData.sessionToken}`;

      // 2. Seed an athlete membership with sensitive PII & biometric wellness/check-in/GPS data
      const doc = await loadTeamDocRaw(teamId);
      expect(doc).toBeTruthy();
      if (!doc) return;
      doc.memberships.push({
        membershipId: 'mem_lucas_sensitive',
        teamId,
        userSid: 'sid_lucas_athlete',
        role: 'ATHLETE',
        squadGroup: 'Boys Varsity',
        invitedName: 'Lucas Alvarez',
        invitedEmail: 'lucas.private.athlete@wghs.edu',
        invitedPhone: '+14085550199',
        parentGuardianEmail: 'parent.alvarez@privatefamily.org',
        isMinorU18: true,
        parentConsentStatus: 'ACKNOWLEDGED',
        status: 'ACTIVE',
        invitedAt: new Date().toISOString(),
        liveSnapshot: {
          updatedAt: new Date().toISOString(),
          hasConnectedWatch: true,
          verdictLabel: 'Fresh & Ready',
          readinessScore: 86,
          ctl: 58,
          atl: 52,
          tsb: 6,
          acuteLoad7d: 340,
          lowAerobicPct: 78,
          highAerobicPct: 15,
          neuromuscularPct: 7,
          caraHours7d: 7.2,
          safeSportHideWeight: true,
          wellnessDays: [
            {
              date: '2026-10-16',
              ctl: 58,
              atl: 52,
              tsb: 6,
              rampRate: 1.2,
              hrvRMSSD: 74,
              hrvBaseline7d: 71,
              restingHR: 47,
              sleepSecs: 29400,
              sleepScore: 89,
              weightKg: 61.5,
              readinessStatus: 'Optimal',
              dailyLoad: 68,
            },
          ],
          activities: [
            {
              id: 'secret_gps_run',
              name: 'Home Street Tempo',
              startDateLocal: '2026-10-15T15:30:00',
              movingTimeSecs: 2400,
              distanceMeters: 9600,
              elevationGainMeters: 42,
              sportCategory: 'Running',
              environment: 'OUTDOOR',
              subType: 'Road',
              trainingLoad: 68,
              avgHr: 162,
              maxHr: 178,
              aerobicDecouplingPct: 2.1,
              efficiencyFactor: 1.45,
              firstHalfEf: 1.46,
              secondHalfEf: 1.43,
              zoneSecs: { hr: [120, 600, 900, 600, 180, 0, 0] },
              stravaPrCount: 0,
              summaryPolyline: 'a~l~Fjk~uOwHJy@P_PRIVATE_HOME_POLYLINE',
              segmentEfforts: [],
              sourceBadges: ['Strava'],
            },
          ],
          sessionCheckIns: [
            {
              id: 'chk_secret',
              date: '2026-10-16',
              rpe: 8,
              painFlag: true,
              painArea: 'SHIN',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      await saveTeamDocRaw(teamId, doc);

      // 3. SSRF Guard Check on loopback .ics URL
      const ssrfResp = await fetch(`${baseUrl}/api/teams/${teamId}/external-sync/ics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({ icsUrl: 'http://127.0.0.1:8080/internal-secret.ics' }),
      });
      const ssrfData = await ssrfResp.json();
      expect(ssrfData.ok).toBe(false);
      expect(ssrfData.note).toMatch(/Blocked unsafe|private network/i);

      // 4. Sync .ics text & apply roster + meet results
      const icsResp = await fetch(`${baseUrl}/api/teams/${teamId}/external-sync/ics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({ icsText: WILLOW_GLEN_XC_PRESET.sampleScheduleIcs }),
      });
      const icsData = await icsResp.json();
      expect(icsResp.status).toBe(200);
      expect(icsData.ok).toBe(true);
      expect(icsData.addedMeetsCount).toBe(5);

      const wgResults = parseExternalMeetResults(WILLOW_GLEN_XC_PRESET.sampleMeetResultsText, {
        teamFilterKeyword: 'Willow Glen',
        externalSource: 'ATHLETIC_NET',
      });
      const applyResp = await fetch(`${baseUrl}/api/teams/${teamId}/external-sync/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          athletes: parseExternalTeamRoster(WILLOW_GLEN_XC_PRESET.sampleRosterText, {
            orgType: 'HIGH_SCHOOL',
            externalSource: 'ATHLETIC_NET',
          }),
          results: wgResults,
        }),
      });
      const applyData = await applyResp.json();
      expect(applyResp.status).toBe(200);
      expect(applyData.ok).toBe(true);
      expect(applyData.recordedResults).toBe(5);

      // 5. Public Team Hub GET returns schedule & official 15:18.40 mark with ZERO PII / biometrics
      const pubResp = await fetch(`${baseUrl}/api/teams/public/${encodeURIComponent(slug)}`);
      const pubText = await pubResp.text();
      expect(pubResp.status).toBe(200);
      const pubJson = JSON.parse(pubText);
      expect(pubJson.found).toBe(true);
      expect(pubJson.stats.meetCount).toBe(5);
      expect(pubJson.stats.officialResultCount).toBeGreaterThanOrEqual(5);
      expect(pubText).toContain('15:18.40');
      expect(pubText).toContain('Crystal Springs');

      // Zero PII / biometric leakage assertions
      for (const forbidden of [
        'lucas.private.athlete@wghs.edu',
        'parent.alvarez@privatefamily.org',
        'coach.morales@secret-school.edu',
        '4085550199',
        'hrvRMSSD',
        'sleepSecs',
        'weightKg',
        'summaryPolyline',
        'PRIVATE_HOME_POLYLINE',
        'painArea',
        'SHIN',
      ]) {
        expect(pubText).not.toContain(forbidden);
      }

      // 6. Parent/Fan follow endpoint assigns PARENT_FOLLOWER role with Clean-Room team projection
      const followResp = await fetch(`${baseUrl}/api/teams/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeOrSlug: slug, followerName: 'Sarah Alvarez' }),
      });
      const followText = await followResp.text();
      expect(followResp.status).toBe(200);
      const followData = JSON.parse(followText);
      expect(followData.ok).toBe(true);
      expect(followData.team.myRole).toBe('PARENT_FOLLOWER');
      for (const forbidden of [
        'lucas.private.athlete@wghs.edu',
        'parent.alvarez@privatefamily.org',
        '4085550199',
        'hrvRMSSD',
        'sleepSecs',
        'weightKg',
        'summaryPolyline',
        'painArea',
      ]) {
        expect(followText).not.toContain(forbidden);
      }
    });
  });

  describe('4. SSR Component Rendering Checks', () => {
    it('renders PublicTeamHubPage and AthleticNetTfrrsSyncModal cleanly with renderToStaticMarkup', () => {
      const presetTeam = buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach Morales');
      const hubPayload = buildCleanRoomPublicHubFromTeamSummary(presetTeam);

      const hubHtml = renderToStaticMarkup(
        React.createElement(PublicTeamHubPage, {
          slugOrCode: 'willow-glen-high-school-xc',
          isDark: false,
          onToggleDark: () => {},
          initialPayloadForTest: hubPayload,
          onExitHub: () => {},
        })
      );
      expect(hubHtml).toContain('Willow Glen High School XC');
      expect(hubHtml).toContain('Season Meet Schedule');
      expect(hubHtml).toContain('15:18.40');

      const emptyTeamModalHtml = renderToStaticMarkup(
        React.createElement(AthleticNetTfrrsSyncModal, {
          isOpen: true,
          inlineRenderForTest: true,
          onClose: () => {},
          activeTeam: null,
          myTeams: [],
          selfName: 'Coach Morales',
          onTeamsUpdated: () => {},
        })
      );
      expect(emptyTeamModalHtml).toContain('Quick-Setup Willow Glen HS (1073/xc)');

      const modalHtml = renderToStaticMarkup(
        React.createElement(AthleticNetTfrrsSyncModal, {
          isOpen: true,
          inlineRenderForTest: true,
          onClose: () => {},
          activeTeam: presetTeam,
          myTeams: [presetTeam],
          selfName: 'Coach Morales',
          onTeamsUpdated: () => {},
        })
      );
      expect(modalHtml).toContain('Athletic.net');
      expect(modalHtml).toContain('TFRRS');
      expect(modalHtml).toContain('Crystal Springs 2.95 mi Results');
    });
  });
});
