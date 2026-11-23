import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildNcaaCaraComplianceCsv,
  summarizeNcaaCaraWeeklyHours,
} from '../src/physiology/scholasticEngine';
import { parseOfficialResultsTextDeterministically } from '../src/utils/officialRaceSynthesizer';
import { getTrackEventSeedPresets } from '../src/components/goals/TrackSpeedReservePanel';
import { apiRouter, resetAiRateLimitsForTesting } from '../server/apiRouter';
import { SESSION_COOKIE_NAME, issueSessionToken } from '../server/securityUtils';
import type { UnifiedActivity } from '../src/types';

function makeRunDay(id: string, isoDate: string, durationSecs: number): UnifiedActivity {
  return {
    id,
    startDateLocal: `${isoDate}T15:00:00`,
    name: `Session ${isoDate}`,
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: durationSecs,
    distanceMeters: 8000,
    elevationGainMeters: 10,
    trainingLoad: 58,
    avgHr: 152,
    maxHr: 178,
    aerobicDecouplingPct: 1.8,
    efficiencyFactor: 1.65,
    firstHalfEf: 1.66,
    secondHalfEf: 1.64,
    zoneSecs: { hr: [0, durationSecs, 0, 0, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

describe('Sprint 5B: NCAA CARA v2, Solo TFRRS/Athletic.net Parser & Event-Aware Track Presets', () => {
  const envBackup: Record<string, string | undefined> = {};
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    resetAiRateLimitsForTesting();
    for (const k of ['GEMINI_API_KEY', 'SESSION_SECRET', 'TOKEN_VAULT_KEY']) {
      envBackup[k] = process.env[k];
    }
    delete process.env.GEMINI_API_KEY;

    const app = express();
    app.use(express.json());
    app.use(apiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('enforces NCAA CARA v2 In-Season Weights/Meetings/VARA exclusion & mandatory 1 day off per week', () => {
    const sixDays = [
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
    ].map((d, i) => makeRunDay(`six-${i}`, d, 3600)); // 6h run practice

    const compliantAudit = summarizeNcaaCaraWeeklyHours(sixDays, '2026-11-10', 0, [], {
      seasonSegment: 'IN_SEASON',
      strengthHours: 2.5,
      meetingFilmHours: 1.0,
      varaHours: 6.0, // VARA must NOT count toward CARA total!
    });
    expect(compliantAudit.rolling7dCountableHours).toBe(9.5);
    expect(compliantAudit.weeklyCapHours).toBe(20);
    expect(compliantAudit.varaHours).toBe(6.0);
    expect(compliantAudit.daysOffCount).toBe(1);
    expect(compliantAudit.requiredDaysOff).toBe(1);
    expect(compliantAudit.daysOffCompliant).toBe(true);
    expect(compliantAudit.compliant).toBe(true);

    // Adding a 7th active practice day leaves 0 days off -> non-compliant despite <= 20h total
    const sevenDays = [...sixDays, makeRunDay('seven-day', '2026-11-10', 3600)];
    const zeroDayOffAudit = summarizeNcaaCaraWeeklyHours(sevenDays, '2026-11-10', 0, [], {
      seasonSegment: 'IN_SEASON',
    });
    expect(zeroDayOffAudit.daysOffCount).toBe(0);
    expect(zeroDayOffAudit.daysOffCompliant).toBe(false);
    expect(zeroDayOffAudit.compliant).toBe(false);
    expect(zeroDayOffAudit.statusLabel).toContain('Missing Required Day Off');
  });

  it('enforces Out-of-Season 8h cap, 2 days off, 2h/wk film cap, and sanitizes ARMS/Teamworks CSV output', () => {
    const acts = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map(
      (d, i) => makeRunDay(`oos-${i}`, d, 3600) // 5 active days -> 2 days off
    );

    const oosBreach = summarizeNcaaCaraWeeklyHours(acts, '2026-11-10', 0, [], {
      seasonSegment: 'OUT_OF_SEASON',
      strengthHours: 0.5,
      meetingFilmHours: 2.5, // > 2.0h out-of-season skill/film ceiling
      varaHours: 2.0,
    });
    expect(oosBreach.weeklyCapHours).toBe(8);
    expect(oosBreach.requiredDaysOff).toBe(2);
    expect(oosBreach.daysOffCompliant).toBe(true);
    expect(oosBreach.outOfSeasonSkillCompliant).toBe(false);
    expect(oosBreach.compliant).toBe(false);
    expect(oosBreach.statusLabel).toContain('Out-of-Season Skill/Film Cap');

    const csv = buildNcaaCaraComplianceCsv([
      {
        athleteName: '=CMD("calc")',
        seasonSegment: 'OUT_OF_SEASON',
        weekEndingIso: '2026-11-10',
        audit: oosBreach,
        varaHours: 2.0,
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Athlete,SeasonSegment,WeekEnding,CountableCaraHours,WeeklyCapHours');
    expect(lines[0]).toContain('VaraExcludedHours,DaysOff,RequiredDaysOff,Compliant,Status');
    expect(lines[1]).toContain(`'=CMD`);
    expect(lines[1]).toContain('OUT_OF_SEASON');
    expect(lines[1]).toContain(',2.00,2,2,NO,');
  });

  it('parses TFRRS uppercase rows, natural month dates, deduplicates rows, and works via /api/races/parse without Gemini key', async () => {
    const tfrrsPaste = [
      '800 METERS\t1:55.42a\tStanford Invitational\tApr 4, 2026',
      '800 METERS\t1:55.42a\tStanford Invitational\tApr 4, 2026', // duplicate row
      '1500 METERS\t3:49.18\tMt. SAC Relays\tApr 18, 2026',
      '3000S\t8:58.10\tPayton Jordan Invitational\tMay 14, 2026',
      '5000 METERS\t14:12.40\tWest Regionals\tMay 28, 2026',
    ].join('\n');

    const localParsed = parseOfficialResultsTextDeterministically(
      tfrrsPaste,
      'https://www.tfrrs.org/athletes/1234567/Stanford/Alex_Mercer.html'
    );
    expect(localParsed).toHaveLength(4);
    expect(localParsed[0]?.eventLabel).toBe('800m');
    expect(localParsed[0]?.date).toBe('2026-04-04');
    expect(localParsed[0]?.meetName).toBe('Stanford Invitational');
    expect(localParsed[0]?.platform).toBe('TFRRS');
    expect(localParsed[1]?.eventLabel).toBe('1500m');
    expect(localParsed[2]?.eventLabel).toBe('3000m');
    expect(localParsed[2]?.date).toBe('2026-05-14');
    expect(localParsed[3]?.eventLabel).toBe('5000m');

    const sessionCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_sprint5b_tfrrs', '0123456789abcdef0123456789abcdef', 'verified')}`;
    const resp = await fetch(`${baseUrl}/api/races/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        url: 'https://www.tfrrs.org/athletes/1234567',
        rawText: tfrrsPaste,
      }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      source: string;
      races: Array<{ eventLabel: string; fatTimeSecs: number }>;
    };
    expect(data.source).toBe('SERVER_DETERMINISTIC');
    expect(data.races).toHaveLength(4);
    expect(data.races[0]?.eventLabel).toBe('800m');
    expect(data.races[0]?.fatTimeSecs).toBe(115.42);
  });

  it('returns distinct event-aware seed presets for 800m, 1500/Mile, 3000/3200m, and 5000m', () => {
    const p800 = getTrackEventSeedPresets('800M');
    const pMile = getTrackEventSeedPresets('1500_MILE');
    const p3200 = getTrackEventSeedPresets('3000_3200M');
    const p5k = getTrackEventSeedPresets('5000M');

    expect(p800.presets).toEqual(['1:52', '2:00', '2:12', '2:25']);
    expect(pMile.presets).toContain('4:05');
    expect(p3200.presets[0]).toBe('8:55');
    expect(p5k.presets[0]).toBe('14:40');
    expect(p800.seedPlaceholder).toContain('800m');
    expect(p5k.seedPlaceholder).toContain('5k');
  });
});
