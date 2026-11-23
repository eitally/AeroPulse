import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { findOrCreateUser } from '../server/authService.ts';
import { createTeamForCoach, claimTeamJoinInvite } from '../server/teamService.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
} from '../server/securityUtils.ts';
import { loadTeamDocRaw } from '../server/teamStoreCore.ts';
import { applyParsedExternalFieldMarksToDoc } from '../server/athleticFieldSyncHelper.ts';
import {
  ALL_MEET_DAY_EVENTS,
  computeHyTekHy3Checksum,
  generateAthleticNetEntryCsv,
  generateHyTekHy3File,
  openPrintableMeetDayPacketWindow,
  seedFieldFlights,
  seedTrackHeats,
  type MeetEntryRecord,
} from '../src/physiology/meetDayOpsEngine.ts';
import {
  DEFAULT_RELAY_QUARTETS,
  RACE_STOPWATCH_PRESETS,
  RELAY_RACE_PRESETS,
  applyTapRelayBatonHandoff,
  applyUndoLastSplit,
  computeRelayQuartetTelemetry,
  inferTrackWorkoutSpecFromPlannedEvent,
  type PersistedTracksideStopwatchState,
} from '../src/hooks/useTracksideStopwatch.ts';
import {
  parseStructuredTrackWorkout,
  parseWorkoutSteps,
} from '../src/utils/workoutParser.ts';
import { synthesizeTracksideWorkoutActivity } from '../src/utils/stopwatchActivitySynthesizer.ts';
import { fuseWearableStreamWithStopwatchSplits } from '../src/utils/stopwatchWearableFusion.ts';
import { synthesizeOfficialRaceActivity } from '../src/utils/officialRaceSynthesizer.ts';
import {
  COURSE_DISTANCE_PRESETS,
  buildPresetExternalTeamSummary,
  detectExternalPasteKind,
  matchExternalResultsToRoster,
  parseExternalMeetResults,
  applyExternalSyncLocallyToTeamSummary,
} from '../src/utils/athleticNetAndTfrrsEngine.ts';
import type { FieldEventLogRecord } from '../src/types.ts';

function buildBaseStopwatchState(): PersistedTracksideStopwatchState {
  return {
    isRunning: false,
    startedAtEpochMs: null,
    sessionStartedEpochMs: null,
    accumulatedMs: 0,
    athleteLapTimestampsSecs: {},
    tapHistory: [],
    extraPodAthletes: [],
    sessionType: 'RACE',
    viewMode: 'CARDS',
    showChuteBar: false,
    workoutPresetId: '8x400',
    customWorkoutSpec: null,
    raceEventLabel: '4x100m',
    restDurationSecs: 60,
    waveMode: 'MASS',
    chuteQueueSecs: [],
    runnerLastTapEpochMs: {},
    sessionTitle: 'Sprint 1B Test',
    soundEnabled: false,
    wakeLockEnabled: false,
    relayQuartets: DEFAULT_RELAY_QUARTETS,
    relayBatonTimestampsSecs: {},
  };
}

describe('Sprint 1B: Partitioned Meet-Day Ops, Hy-Tek .hy3, Relay Timing, <100m Sprints & Field Sync', () => {
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

  describe('1. Gender/Division Partitioning, Hy-Tek .hy3 & Sanitized Exports', () => {
    it('includes DMR, 60m, and 60mH in ALL_MEET_DAY_EVENTS', () => {
      const codes = ALL_MEET_DAY_EVENTS.map((e) => e.code);
      expect(codes).toContain('DMR');
      expect(codes).toContain('60m');
      expect(codes).toContain('60mH');
    });

    it('strictly partitions heats and flights by genderDivision & division while keeping unpartitioned calls backward-compatible', () => {
      const entries: MeetEntryRecord[] = [
        { id: 'e1', athleteId: 'b1', athleteName: 'Devon Carter', genderDivision: 'M', division: 'Varsity', eventCode: '100m', seedMark: '10.92' },
        { id: 'e2', athleteId: 'b2', athleteName: 'Noah Lee', genderDivision: 'M', division: 'Varsity', eventCode: '100m', seedMark: '11.14' },
        { id: 'e3', athleteId: 'g1', athleteName: 'Chloe Okafor', genderDivision: 'F', division: 'Varsity', eventCode: '100m', seedMark: '12.05' },
        { id: 'e4', athleteId: 'g2', athleteName: 'Maya Singh', genderDivision: 'F', division: 'Junior Varsity', eventCode: '100m', seedMark: '12.88' },
        { id: 'e5', athleteId: 'fb1', athleteName: 'Marcus Vance', genderDivision: 'M', division: 'Varsity', eventCode: 'LJ', seedMark: '21-06.50' },
        { id: 'e6', athleteId: 'fg1', athleteName: 'Priya Nair', genderDivision: 'F', division: 'Varsity', eventCode: 'LJ', seedMark: '18-04.00' },
        { id: 'e7', athleteId: 'fg2', athleteName: 'Elena Cruz', genderDivision: 'F', division: 'Frosh/Soph', eventCode: 'LJ', seedMark: '16-02.00' },
      ];

      const heats = seedTrackHeats(entries, '100m', 8);
      const heatNums = new Set(heats.map((h) => `${h.heatNumber}|${h.partitionLabel || ''}`));
      expect(heatNums.size).toBe(3);
      for (const part of new Set(heats.map((h) => h.partitionLabel))) {
        const rowsInPart = heats.filter((h) => h.partitionLabel === part);
        expect(new Set(rowsInPart.map((r) => r.genderDivision)).size).toBe(1);
        expect(new Set(rowsInPart.map((r) => r.division)).size).toBe(1);
      }

      const flights = seedFieldFlights(entries, 'LJ', 12);
      const flightParts = new Set(flights.map((f) => `${f.flightNumber}|${f.partitionLabel || ''}`));
      expect(flightParts.size).toBe(3);
      for (const part of new Set(flights.map((f) => f.partitionLabel))) {
        const rowsInPart = flights.filter((f) => f.partitionLabel === part);
        expect(new Set(rowsInPart.map((r) => r.genderDivision)).size).toBe(1);
        expect(new Set(rowsInPart.map((r) => r.division)).size).toBe(1);
      }

      // Backward compatibility: explicit partitionByDivision=false groups into single heat
      const legacyHeats = seedTrackHeats(entries, '100m', 8, false);
      expect(new Set(legacyHeats.map((h) => h.heatNumber)).size).toBe(1);
      expect(legacyHeats).toHaveLength(4);
    });

    it('emits standard fixed-width 130-char CR/LF .hy3 files with A1..F2 records and valid 2-digit checksums', () => {
      const hy3 = generateHyTekHy3File({
        meetTitle: 'Spring Dual Invitational',
        meetDate: '2026-04-18',
        teamCode: 'OAKG',
        teamName: 'Oak Grove High',
        entries: [
          { id: 'h1', athleteId: 'a1', athleteName: 'Devon Carter', genderDivision: 'M', division: 'Varsity', graduationYear: 2027, eventCode: '60m', seedMark: '6.94' },
          { id: 'h2', athleteId: 'a2', athleteName: 'Chloe Okafor', genderDivision: 'F', division: 'Varsity', graduationYear: 2028, eventCode: 'LJ', seedMark: '18-04.50' },
          { id: 'h3', athleteId: 'r1', athleteName: 'Devon Carter', genderDivision: 'M', division: 'Varsity', graduationYear: 2027, eventCode: '4x100m', seedMark: '42.85', relayTeamCode: 'A', relayLegOrder: 1 },
          { id: 'h4', athleteId: 'r2', athleteName: 'Noah Lee', genderDivision: 'M', division: 'Varsity', graduationYear: 2027, eventCode: '4x100m', seedMark: '42.85', relayTeamCode: 'A', relayLegOrder: 2 },
        ],
      });

      expect(hy3).toContain('\r\n');
      const lines = hy3.split('\r\n').filter(Boolean);
      const prefixes = new Set(lines.map((l) => l.slice(0, 2)));
      expect(prefixes.has('A1')).toBe(true);
      expect(prefixes.has('B1')).toBe(true);
      expect(prefixes.has('B2')).toBe(true);
      expect(prefixes.has('C1')).toBe(true);
      expect(prefixes.has('D1')).toBe(true);
      expect(prefixes.has('E1')).toBe(true);
      expect(prefixes.has('E2')).toBe(true);
      expect(prefixes.has('F1')).toBe(true);
      expect(prefixes.has('F2')).toBe(true);

      for (const line of lines) {
        expect(line.length).toBe(130);
        const body = line.slice(0, 128);
        const cs = line.slice(128, 130);
        expect(cs).toBe(computeHyTekHy3Checksum(body));
      }
    });

    it('sanitizes Athletic.net CSV cells against formula injection', () => {
      const csv = generateAthleticNetEntryCsv([
        {
          id: 'bad-csv-1',
          athleteId: 'bad1',
          athleteName: '=CMD("calc")',
          genderDivision: 'F',
          division: '+Varsity',
          eventCode: '100m',
          seedMark: '@SUM(A1)',
          relayTeamCode: '-A',
        },
      ]);
      expect(csv).not.toMatch(/(?:^|,)"?=CMD/m);
      expect(csv).toContain("'=CMD");
      expect(csv).toContain("'+Varsity");
      expect(csv).toContain("'@SUM");
      expect(csv).toContain("'-A");
    });

    it('prints separate partitioned tables per event + gender + division', () => {
      let printedHtml = '';
      const origWindow = globalThis.window;
      const fakeDoc = {
        open: () => {},
        write: (html: string) => {
          printedHtml = html;
        },
        close: () => {},
      };
      (globalThis as unknown as { window: unknown }).window = {
        open: () => ({
          document: fakeDoc,
          focus: () => {},
          print: () => {},
        }),
      };

      try {
        const ok = openPrintableMeetDayPacketWindow({
          teamName: 'Oak Grove High',
          meetTitle: 'Partition Print Check',
          entries: [
            { id: 'pm1', athleteId: 'm1', athleteName: 'Devon Carter', genderDivision: 'M', division: 'Varsity', eventCode: '100m', seedMark: '10.90' },
            { id: 'pf1', athleteId: 'f1', athleteName: 'Chloe Okafor', genderDivision: 'F', division: 'Varsity', eventCode: '100m', seedMark: '12.10' },
          ],
        });
        expect(ok).toBe(true);
        expect(printedHtml).toContain('Boys Varsity');
        expect(printedHtml).toContain('Girls Varsity');
        expect((printedHtml.match(/<table\b/gi) || []).length).toBeGreaterThanOrEqual(2);
      } finally {
        (globalThis as unknown as { window: unknown }).window = origWindow;
      }
    });

    it('persists meet-day packets via GET/POST/DELETE /api/teams/:teamId/meet-day-packets and enforces athlete role guard', async () => {
      const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const coachUser = await findOrCreateUser('magic_link', `coach_md_${unique}`, {
        email: `coach.md.${unique}@example.com`,
        name: 'Coach MeetOps',
      });
      const coachSid = deriveUserSessionSid(coachUser.id);
      const coachCookie = issueSessionToken(coachUser.id, coachSid, 'verified');

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl,
        name: `MeetOps Squad ${unique}`,
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach MeetOps',
      });

      const athUser = await findOrCreateUser('magic_link', `ath_md_${unique}`, {
        email: `ath.md.${unique}@example.com`,
        name: 'Athlete Reader',
      });
      const athSid = deriveUserSessionSid(athUser.id);
      const athCookie = issueSessionToken(athUser.id, athSid, 'verified');
      await claimTeamJoinInvite({
        callerSid: athSid,
        originUrl,
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Athlete Reader',
        birthMonthYear: '2001-05',
      });

      // Unauthenticated -> 401
      const unauthResp = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/meet-day-packets`);
      expect(unauthResp.status).toBe(401);

      // Athlete role -> 403 on write
      const athPost = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/meet-day-packets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${athCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({ meetTitle: 'Unauthorized Meet', meetDate: '2026-04-18', entries: [] }),
      });
      expect(athPost.status).toBe(403);

      // Coach POST -> 200 persisted packet
      const createResp = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/meet-day-packets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
          Origin: originUrl,
        },
        body: JSON.stringify({
          meetTitle: 'Oak Grove Dual',
          meetDate: '2026-04-18',
          entries: [
            {
              entryId: 'ent-1',
              athleteName: 'Devon Carter',
              genderDivision: 'M',
              division: 'Varsity',
              eventCode: '60m',
              seedMark: '6.92',
            },
          ],
        }),
      });
      expect(createResp.status).toBe(200);
      const createJson = (await createResp.json()) as {
        packet: { packetId: string; meetTitle: string; entries: unknown[] };
        packets: Array<{ packetId: string }>;
      };
      expect(createJson.packet.meetTitle).toBe('Oak Grove Dual');
      expect(createJson.packet.entries).toHaveLength(1);

      // GET lists saved packet
      const listResp = await fetch(`${baseUrl}/api/teams/${team.brand.teamId}/meet-day-packets`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}` },
      });
      expect(listResp.status).toBe(200);
      const listJson = (await listResp.json()) as {
        packets: Array<{ packetId: string; entries: Array<{ eventCode: string; division?: string }> }>;
      };
      expect(listJson.packets).toHaveLength(1);
      expect(listJson.packets[0].entries[0].eventCode).toBe('60m');
      expect(listJson.packets[0].entries[0].division).toBe('Varsity');

      // DELETE removes packet
      const delResp = await fetch(
        `${baseUrl}/api/teams/${team.brand.teamId}/meet-day-packets/${encodeURIComponent(createJson.packet.packetId)}`,
        {
          method: 'DELETE',
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=${coachCookie}`,
            Origin: originUrl,
          },
        }
      );
      expect(delResp.status).toBe(200);
      const docAfter = await loadTeamDocRaw(team.brand.teamId);
      expect(docAfter?.meetDayPackets || []).toHaveLength(0);
    });
  });

  describe('2. Relay Baton-Split Timing & <100m Sprint Presets / Parsers', () => {
    it('exposes 4x100m, 4x400m, 4x800m, and DMR [1200,400,800,1600] relay presets', () => {
      const labels = RELAY_RACE_PRESETS.map((p) => p.label);
      expect(labels).toEqual(expect.arrayContaining(['4x100m', '4x400m', '4x800m', 'DMR']));
      const dmr = RELAY_RACE_PRESETS.find((p) => p.label === 'DMR');
      expect(dmr?.legDistancesMeters).toEqual([1200, 400, 800, 1600]);
      expect(dmr?.distanceMeters).toBe(4000);
      expect(RACE_STOPWATCH_PRESETS.some((p) => p.label === 'DMR')).toBe(true);
    });

    it('records 4 relay baton handoffs with Leadoff vs Flying leg splits, exchange alerts, projection & undo', () => {
      const state = buildBaseStopwatchState();
      state.startedAtEpochMs = 1_000_000;
      state.isRunning = true;

      const h1 = applyTapRelayBatonHandoff(state, 'relay-A', 1_011_100);
      expect(h1.legNumber).toBe(1);
      expect(h1.handoffSecs).toBeCloseTo(11.1, 1);

      const midTel = computeRelayQuartetTelemetry({
        quartet: DEFAULT_RELAY_QUARTETS[0],
        preset: RELAY_RACE_PRESETS[0],
        rawHandoffTimestampsSecs: h1.next.relayBatonTimestampsSecs?.['relay-A'] || [],
        isRunning: true,
      });
      expect(midTel.projectedTeamFinishSecs).toBeCloseTo(44.4, 1);

      const h2 = applyTapRelayBatonHandoff(h1.next, 'relay-A', 1_021_400);
      const h2Tel = computeRelayQuartetTelemetry({
        quartet: DEFAULT_RELAY_QUARTETS[0],
        preset: RELAY_RACE_PRESETS[0],
        rawHandoffTimestampsSecs: h2.next.relayBatonTimestampsSecs?.['relay-A'] || [],
        isRunning: true,
      });
      expect(h2Tel.legs[0].timingContext).toBe('Leg 1 Leadoff');
      expect(h2Tel.legs[1].timingContext).toBe('Flying');
      expect(h2Tel.legs[1].legSplitSecs).toBeCloseTo(10.3, 1);
      expect(h2Tel.exchangeAlert).toContain('Clean Exchange 2');

      const h3 = applyTapRelayBatonHandoff(h2.next, 'relay-A', 1_033_900);
      const slowTel = computeRelayQuartetTelemetry({
        quartet: DEFAULT_RELAY_QUARTETS[0],
        preset: RELAY_RACE_PRESETS[0],
        rawHandoffTimestampsSecs: h3.next.relayBatonTimestampsSecs?.['relay-A'] || [],
        isRunning: true,
      });
      expect(slowTel.exchangeAlert).toContain('Exchange 3 Warning');

      const undone = applyUndoLastSplit(h3.next);
      expect(undone.undone?.kind).toBe('RELAY_HANDOFF');
      expect(undone.next.relayBatonTimestampsSecs?.['relay-A']).toHaveLength(2);

      const h3Re = applyTapRelayBatonHandoff(undone.next, 'relay-A', 1_032_000);
      const h4 = applyTapRelayBatonHandoff(h3Re.next, 'relay-A', 1_042_200);
      const h5 = applyTapRelayBatonHandoff(h4.next, 'relay-A', 1_050_000);
      expect(h5.blockedByFinishLock).toBe(true);
    });

    it('parses <100m sprints (6x30m, 4x60m blocks, 6x20m starts, 4x10m) without breaking FTP minutes or walk rest', () => {
      for (const sample of ['6x30m', '4x60m blocks', '6x20m starts', '4x10m']) {
        const steps = parseWorkoutSteps(sample);
        expect(steps.length).toBeGreaterThanOrEqual(4);
        expect(steps[0].repeatTotal).toBeGreaterThanOrEqual(4);
        expect(steps[0].distanceMeters).toBeLessThan(100);
        expect(steps[0].distanceMeters).toBeGreaterThanOrEqual(10);

        const spec = inferTrackWorkoutSpecFromPlannedEvent({ name: sample, workoutSyntax: sample });
        expect(spec).not.toBeNull();
        expect(spec?.repDistanceMeters).toBeLessThan(100);
      }

      // Guard: bike FTP minutes stay duration-based
      const bikeAst = parseStructuredTrackWorkout('15m 60% FTP Warmup\n3x 10m 88% FTP\n10m 55% Cooldown');
      const repNode = bikeAst.find((n) => n.type === 'repeat');
      expect(repNode?.type).toBe('repeat');
      if (repNode?.type === 'repeat') {
        expect(repNode.steps[0].durationSecs).toBe(600);
        expect(repNode.steps[0].distanceMeters).toBeUndefined();
      }
      expect(
        inferTrackWorkoutSpecFromPlannedEvent({
          name: 'Threshold Cycling',
          workoutSyntax: '3x 10m 88% FTP',
        })
      ).toBeNull();

      // Guard: walk rest stays rest duration & meters
      const restAst = parseStructuredTrackWorkout('4x 200m 105% @3k (60m walk)');
      const rNode = restAst[0];
      expect(rNode?.type).toBe('repeat');
      if (rNode?.type === 'repeat') {
        expect(rNode.steps[0].distanceMeters).toBe(200);
        expect(rNode.steps[1]?.stepKind).toBe('rest');
        expect(rNode.steps[1]?.distanceMeters).toBe(60);
      }
    });

    it('synthesizes <100m stopwatch workouts, wearable fusion reps, and 60m / 4x100m official races accurately', () => {
      const workoutAct = synthesizeTracksideWorkoutActivity({
        runnerId: 'ath-sprint-1',
        runnerName: 'Devon Carter',
        thresholdPaceSecsPerKm: 230,
        lthr: 172,
        maxHr: 196,
        presetLabel: '6 x 30m · Flys',
        repDistanceMeters: 30,
        restDurationSecs: 120,
        lapSplitsSecs: [3.42, 3.39, 3.38, 3.39, 3.37, 3.39],
      });
      const workReps = (workoutAct.intervals || []).filter((i) => i.type === 'WORK');
      expect(workReps).toHaveLength(6);
      expect(workReps.every((r) => r.distanceMeters === 30)).toBe(true);

      const times = Array.from({ length: 180 }, (_, idx) => idx);
      const velocitySmooth = times.map((t) => (t % 30 < 8 ? 8.2 : 0.4));
      const heartrate = times.map(() => 155);
      const fused = fuseWearableStreamWithStopwatchSplits({
        wearableStreams: {
          time: times,
          velocitySmooth,
          heartrate,
        },
        lapSplitsSecs: [6.95, 6.93, 6.91, 6.92],
        repDistanceMeters: 60,
        restDurationSecs: 120,
      });
      const workIntervals = fused.intervals.filter((i) => i.type === 'WORK');
      expect(workIntervals.length).toBe(4);
      expect(workIntervals.every((r) => r.distanceMeters === 60)).toBe(true);

      const race60 = synthesizeOfficialRaceActivity({
        id: 'race-60m-1',
        date: '2026-04-18',
        meetName: 'Indoor Classic',
        eventLabel: '60m',
        eventDistanceMeters: 60,
        fatTimeSecs: 6.84,
        displayFatTime: '6.84',
        platform: 'Athletic.net',
        trackType: 'INDOOR_BANKED_200M',
        lapSplitDistanceMeters: 60,
        lapSplitsSecs: [],
        includeWarmupCooldown: false,
      });
      expect(race60.distanceMeters).toBe(60);
      expect(race60.movingTimeSecs).toBe(7);

      const race4x100 = synthesizeOfficialRaceActivity({
        id: 'race-4x100-1',
        date: '2026-04-18',
        meetName: 'Relay Carnival',
        eventLabel: '4x100m',
        eventDistanceMeters: 400,
        fatTimeSecs: 42.15,
        displayFatTime: '42.15',
        platform: 'Athletic.net',
        trackType: 'OUTDOOR_400M',
        lapSplitDistanceMeters: 100,
        lapSplitsSecs: [11.12, 10.18, 10.45, 10.4],
        includeWarmupCooldown: false,
      });
      expect(race4x100.officialRaceData?.lapSplitsSecs).toEqual([11.12, 10.18, 10.45, 10.4]);
    });
  });

  describe('3. Field Marks in External Sync & Neutral Global Presets', () => {
    it('parses imperial & metric field marks, wind readings, FOUL/NH/NM without misparsing throws as running seconds', () => {
      const text = [
        'Meet: Regional Showcase | Date: 2026-04-18',
        'Boys Long Jump',
        '1 | Marcus Vance | 11 | Central HS | 21-06.50 (+1.4)',
        '2 | Eli Brooks | 12 | Oak Grove | 21\' 2.5" (+2.4)',
        '3 | Noah Reed | 10 | Oak Grove | FOUL',
        'Girls Shot Put',
        '1 | Maya Singh | 12 | Oak Grove | 14.82m',
        '2 | Jordan Hayes | 11 | Oak Grove | 45-04.25',
        'Boys High Jump',
        '1 | Kai Park | 11 | Central HS | 6-02',
        '2 | Owen Cruz | 10 | Central HS | NH',
        'Girls Pole Vault',
        '1 | Nia Patel | 12 | Oak Grove | 13-06.25',
        'Girls Discus',
        '1 | Tessa Diaz | 11 | Central HS | 142-08',
        '2 | Hana Kim | 11 | Central HS | 52.10m',
      ].join('\n');

      expect(detectExternalPasteKind(text)).toBe('MEET_RESULTS');
      const parsed = parseExternalMeetResults(text);
      expect(parsed).toHaveLength(10);
      expect(parsed.every((r) => r.isFieldEvent === true)).toBe(true);

      const lj1 = parsed[0];
      expect(lj1.fieldEventCode).toBe('LJ');
      expect(lj1.fieldMarkMeters).toBeCloseTo(6.566, 2);
      expect(lj1.windMps).toBe(1.4);
      expect(lj1.isWindAided).toBeFalsy();

      const lj2 = parsed[1];
      expect(lj2.isWindAided).toBe(true);

      const foulRow = parsed[2];
      expect(foulRow.isNoMarkOrFoul).toBe(true);
      expect(foulRow.displayFieldMark).toBe('FOUL');

      const spMetric = parsed[3];
      expect(spMetric.fieldEventCode).toBe('SP');
      expect(spMetric.fieldMarkMeters).toBeCloseTo(14.82, 2);

      const nhRow = parsed[6];
      expect(nhRow.fieldEventCode).toBe('HJ');
      expect(nhRow.isNoMarkOrFoul).toBe(true);
      expect(nhRow.displayFieldMark).toBe('NH');

      // Standalone metric throw lines are NEVER parsed as running seconds
      const throwOnly = parseExternalMeetResults('Maya Singh | 14.82m\nJordan Hayes | 45.30m');
      expect(throwOnly).toHaveLength(0);

      // 60m sprint row parses cleanly as running race
      const sprintRows = parseExternalMeetResults('Boys 60m Finals\n1 | Devon Carter | 12 | Central HS | 6.84');
      expect(sprintRows).toHaveLength(1);
      expect(sprintRows[0].isFieldEvent).toBeUndefined();
      expect(sprintRows[0].eventDistanceMeters).toBe(60);
      expect(sprintRows[0].fatTimeSecs).toBe(6.84);
    });

    it('matches field items without creating fake running VDOT activities and deduplicates in applyParsedExternalFieldMarksToDoc', () => {
      const sampleText = [
        'Meet: League Dual | Date: 2026-04-18',
        'Girls Shot Put',
        '1 | Maya Singh | 12 | Oak Grove | 14.82m',
        'Boys Long Jump',
        '1 | Marcus Vance | 11 | Oak Grove | 21-06.50 (+1.4)',
      ].join('\n');

      const rows = parseExternalMeetResults(sampleText);
      const roster = [
        { membershipId: 'mem-1', invitedName: 'Maya Singh', squadGroup: 'Varsity' },
      ];
      const matchSummary = matchExternalResultsToRoster(rows, roster);
      expect(matchSummary.matched).toHaveLength(0);
      expect(matchSummary.matchedFieldItems).toHaveLength(2);
      expect(matchSummary.matchedExistingCount).toBe(1);
      expect(matchSummary.newWalkOnCount).toBe(1);

      const fakeDoc = {
        brand: {
          teamId: 'tm_test_field',
          slug: 'oak-grove-tf',
          joinCode: 'OAK-26',
          name: 'Oak Grove High Track',
          shortName: 'OGHS',
          orgType: 'HIGH_SCHOOL' as const,
          primarySport: 'Running' as const,
          primaryHex: '#B83A24',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach Test',
          planTier: 'FOUNDING_TEAM' as const,
          createdAt: new Date().toISOString(),
        },
        memberships: [
          {
            membershipId: 'mem-1',
            teamId: 'tm_test_field',
            role: 'ATHLETE' as const,
            squadGroup: 'Varsity',
            invitedName: 'Maya Singh',
            isMinorU18: true,
            status: 'ACTIVE' as const,
            invitedAt: new Date().toISOString(),
            coachRecordedActivities: [],
          },
        ],
        broadcastWorkouts: [],
        coachWorkouts: [],
        joinRequests: [],
        parentLinks: [],
        fieldMarkLogs: [] as FieldEventLogRecord[],
        updatedAt: new Date().toISOString(),
      };

      const firstPass = applyParsedExternalFieldMarksToDoc({
        doc: fakeDoc,
        matchedFieldItems: matchSummary.matchedFieldItems,
      });
      expect(firstPass.addedCount).toBe(2);
      expect(fakeDoc.fieldMarkLogs).toHaveLength(2);
      expect(fakeDoc.fieldMarkLogs[0].isCompetition).toBe(true);
      expect(fakeDoc.memberships[0].coachRecordedActivities || []).toHaveLength(0);

      // Second identical pass deduplicates cleanly
      const secondPass = applyParsedExternalFieldMarksToDoc({
        doc: fakeDoc,
        matchedFieldItems: matchSummary.matchedFieldItems,
      });
      expect(secondPass.addedCount).toBe(0);
      expect(fakeDoc.fieldMarkLogs).toHaveLength(2);

      // Local sync helper also persists field logs cleanly without creating running VDOT activities
      const teamSummary = buildPresetExternalTeamSummary('COLLEGIATE_TFRRS', 'Coach Test');
      const localRes = applyExternalSyncLocallyToTeamSummary(teamSummary, { results: rows });
      expect(localRes.recordedResults).toBe(2);
      expect(localRes.updatedTeam.fieldMarkLogs?.length).toBe(2);
      const newAthlete = localRes.updatedTeam.memberships.find((m) => m.invitedName === 'Maya Singh');
      expect(newAthlete?.coachRecordedActivities || []).toHaveLength(0);
    });

    it('generalizes COURSE_DISTANCE_PRESETS and removes implicit Bay Area fallback defaults in AthleticNetTfrrsSyncModal', () => {
      expect(COURSE_DISTANCE_PRESETS[0].id).toBe('AUTO');
      expect(COURSE_DISTANCE_PRESETS[1].label).toContain('5K XC');
      expect(COURSE_DISTANCE_PRESETS.some((p) => p.label.includes('Bay Area / Toro / Mt. SAC'))).toBe(false);

      const modalPath = path.join(process.cwd(), 'src/components/AthleticNetTfrrsSyncModal.tsx');
      const modalSrc = fs.readFileSync(modalPath, 'utf8');
      expect(modalSrc).not.toContain('`${appOrigin}/team/willow-glen-high-school-xc`');
      expect(modalSrc).not.toContain("buildPresetExternalTeamSummary('WILLOW_GLEN'");
      expect(modalSrc).not.toContain('placeholder="e.g. Willow Glen"');
      expect(modalSrc).not.toContain('placeholder="https://www.athletic.net/team/1073/xc');
    });
  });
});
