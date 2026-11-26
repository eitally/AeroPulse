import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveGraduationYearFromGradeToken,
} from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  formatTrackMark,
  summarizeNcaaCaraWeeklyHours,
} from '../src/physiology/scholasticEngine.ts';
import {
  parseTrackSeedTimeToSecs,
  seedTrackHeats,
  type MeetEntryRecord,
} from '../src/physiology/meetDayOpsEngine.ts';
import { generateVerifiedRacePassport } from '../src/physiology/raceRubberBander.ts';
import { evaluateOrthopedicInterference } from '../src/physiology/orthopedicEngine.ts';
import { optimizeTrackRelayLineup } from '../src/physiology/trackMeetAndRelayEngine.ts';
import {
  parseFatTimeString,
  synthesizeOfficialRaceActivity,
} from '../src/utils/officialRaceSynthesizer.ts';
import { computeTeamSnapshotLoadAndCara } from '../src/hooks/useAthleteCloudSync.ts';
import {
  clearChatOutbox,
  enqueueChatOutboxMessage,
  flushChatOutbox,
  loadChatOutbox,
} from '../src/utils/chatOutbox.ts';
import {
  clearFieldOutboxDb,
  enqueueFieldOutboxBatch,
  loadFieldOutbox,
} from '../src/utils/fieldEventsOutbox.ts';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage/profileCalibration.ts';
import type { AthleteProfile, UnifiedActivity } from '../src/types.ts';

function makeRunActivity(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: overrides.id || `act-${Math.random().toString(36).slice(2, 8)}`,
    startDateLocal: overrides.startDateLocal || '2026-04-12T18:30:00',
    name: overrides.name || 'Track Session',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: overrides.movingTimeSecs ?? 3600,
    distanceMeters: overrides.distanceMeters ?? 10000,
    elevationGainMeters: 0,
    trainingLoad: overrides.trainingLoad ?? 65,
    avgHr: 160,
    maxHr: 182,
    avgPaceSecsPerKm: 240,
    aerobicDecouplingPct: 0,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.5,
    secondHalfEf: 1.5,
    zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    deviceName: 'Test Watch',
    sourceBadges: ['Garmin'],
    ...overrides,
  };
}

describe('Overnight Physiology Math, Track/Meet & Offline Sync Reliability', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearChatOutbox();
    await clearFieldOutboxDb();
  });

  it('P0: HS Fr/So/Jr/Sr grade tokens are NOT misclassified as college classes, while FR-1..SR-4 remain collegiate', () => {
    const ref = new Date('2026-04-10T12:00:00Z');
    for (const token of ['Fr', 'So', 'Jr', 'Sr', 'Freshman', 'Senior']) {
      const meta = resolveGraduationYearFromGradeToken(token, ref);
      expect(meta.isCollegeClass, `HS token "${token}" should not be collegiate`).toBeFalsy();
      expect(meta.graduationYear).toBeGreaterThanOrEqual(2026);
    }
    for (const colToken of ['FR-1', 'SO-2', 'JR-3', 'SR-4']) {
      const meta = resolveGraduationYearFromGradeToken(colToken, ref);
      expect(meta.isCollegeClass, `College token "${colToken}" should be collegiate`).toBe(true);
    }
  });

  it('P1: formatTrackMark & formatOfficialClock round ticks first (no 60.00s, 1:60.00, 1:59.100, or NaN)', () => {
    expect(formatTrackMark(59.996, 2)).toBe('1:00.00');
    expect(formatTrackMark(119.996, 2)).toBe('2:00.00');
    expect(formatTrackMark(3599.996, 2)).toBe('1:00:00.00');
    expect(formatTrackMark(Number.NaN, 2)).toBe('0.00s');
    expect(formatTrackMark(-5, 1)).toBe('0.0s');

    const passport = generateVerifiedRacePassport({
      athleteName: 'Taylor Swift-Runner',
      meetOrRaceName: 'Twilight 800',
      eventLabel: '800m',
      platform: 'Athletic.net',
      raceDate: '2026-04-18',
      certifiedDistanceMeters: 800,
      rawGpsDistanceMeters: 812,
      officialChipOrFatSecs: 119.996,
    });
    expect(passport.displayOfficialTime).toBe('2:00');
  });

  it('P1: summarizeNcaaCaraWeeklyHours uses pure local calendar days so evening practices are never dropped or shifted', () => {
    const acts: UnifiedActivity[] = [
      // Day -7 evening (should be OUTSIDE 7-day window ending 2026-04-12)
      makeRunActivity({ id: 'd-7', startDateLocal: '2026-04-05T19:30:00', movingTimeSecs: 3600 }),
      // Days -6..-1 & Today evening (6 active days + 1 day off on 2026-04-08)
      makeRunActivity({ id: 'd-6', startDateLocal: '2026-04-06T18:30:00', movingTimeSecs: 3600 }),
      makeRunActivity({ id: 'd-5', startDateLocal: '2026-04-07T18:30:00', movingTimeSecs: 3600 }),
      makeRunActivity({ id: 'd-3', startDateLocal: '2026-04-09T18:30:00', movingTimeSecs: 3600 }),
      makeRunActivity({ id: 'd-2', startDateLocal: '2026-04-10T18:30:00', movingTimeSecs: 3600 }),
      makeRunActivity({ id: 'd-1', startDateLocal: '2026-04-11T18:30:00', movingTimeSecs: 3600 }),
      makeRunActivity({ id: 'd-0', startDateLocal: '2026-04-12T19:45:00', movingTimeSecs: 3600 }),
    ];
    const audit = summarizeNcaaCaraWeeklyHours(acts, '2026-04-12');
    expect(audit.rolling7dCountableHours).toBe(6);
    expect(audit.daysOffCount).toBe(1);
    expect(audit.daysOffCompliant).toBe(true);
  });

  it('P1: seedTrackHeats assigns valid center-out lanes on 4, 6, 8, and 9-lane tracks and parseTrackSeedTimeToSecs rejects 0:00', () => {
    expect(parseTrackSeedTimeToSecs('0:00')).toBeNull();
    expect(parseTrackSeedTimeToSecs('0:00.00')).toBeNull();
    expect(parseTrackSeedTimeToSecs('10.123')).toBe(10.12);
    expect(parseTrackSeedTimeToSecs('1:05:30.50')).toBe(3930.5);

    const makeEntries = (n: number): MeetEntryRecord[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `e-${i}`,
        athleteId: `a-${i}`,
        athleteName: `Runner ${i + 1}`,
        eventCode: '400m',
        seedMark: `${50 + i}.00`,
      }));

    const heats6 = seedTrackHeats(makeEntries(6), '400m', 6, false);
    const lanes6 = heats6.map((h) => h.lane);
    expect(Math.max(...lanes6)).toBeLessThanOrEqual(6);
    expect(Math.min(...lanes6)).toBeGreaterThanOrEqual(1);
    expect(new Set(lanes6).size).toBe(6);
    expect(heats6.find((h) => h.athleteId === 'a-0')?.lane).toBe(3); // center of 6-lane track

    const heats4 = seedTrackHeats(makeEntries(4), '400m', 4, false);
    const lanes4 = heats4.map((h) => h.lane);
    expect(Math.max(...lanes4)).toBeLessThanOrEqual(4);
    expect(new Set(lanes4).size).toBe(4);

    const heats9 = seedTrackHeats(makeEntries(9), '400m', 9, false);
    expect(heats9.find((h) => h.athleteId === 'a-0')?.lane).toBe(5); // center of 9-lane championship track
    expect(new Set(heats9.map((h) => h.lane)).size).toBe(9);
  });

  it('P1: 48h Super-Spike Lock uses Date.now() when referenceDateIso is omitted (never unlocks ~16h early)', () => {
    const profile: AthleteProfile = buildCompleteAthleteProfile({
      name: 'Spike Athlete',
      academicDivision: 'HS_VARSITY',
    });
    const fortyHoursAgo = new Date(Date.now() - 40 * 3600 * 1000);
    const localIso = `${fortyHoursAgo.getFullYear()}-${String(fortyHoursAgo.getMonth() + 1).padStart(2, '0')}-${String(fortyHoursAgo.getDate()).padStart(2, '0')}T${String(fortyHoursAgo.getHours()).padStart(2, '0')}:${String(fortyHoursAgo.getMinutes()).padStart(2, '0')}:00`;
    const superSpikeSession = makeRunActivity({
      startDateLocal: localIso,
      distanceMeters: 2400,
      footwearClass: 'CARBON_SUPER_SPIKE',
    });
    const summary = evaluateOrthopedicInterference([superSpikeSession], profile, [], undefined, {
      isMinorU18: true,
    });
    expect(summary.hoursSinceLastSuperSpike).not.toBeNull();
    expect(summary.hoursSinceLastSuperSpike!).toBeGreaterThanOrEqual(38);
    expect(summary.hoursSinceLastSuperSpike!).toBeLessThanOrEqual(42);
    expect(summary.trainerOnly48hLockActive).toBe(true);
  });

  it('P2: optimizeTrackRelayLineup preserves pure sprinters on >10-athlete rosters and parseFatTimeString/synthesizeOfficialRaceActivity guard edge inputs', () => {
    const distanceSquad = Array.from({ length: 10 }, (_, i) => ({
      id: `dist-${i}`,
      name: `Distance ${i}`,
      thresholdPaceSecsPerKm: 205 + i * 2,
      mssMps: 7.4,
    }));
    const sprinters = Array.from({ length: 4 }, (_, i) => ({
      id: `spr-${i}`,
      name: `Sprinter ${i}`,
      thresholdPaceSecsPerKm: 295 + i * 3,
      mssMps: 10.2,
    }));
    const relay = optimizeTrackRelayLineup({
      relayEvent: '4x100m',
      candidates: [...distanceSquad, ...sprinters],
    });
    const chosenIds = relay.legs.map((l) => l.athleteId);
    expect(chosenIds.every((id) => id.startsWith('spr-'))).toBe(true);

    expect(parseFatTimeString('-1:30')).toBe(0);
    expect(parseFatTimeString('1:75')).toBe(0);
    expect(parseFatTimeString('1:56.38')).toBe(116.38);

    const synth = synthesizeOfficialRaceActivity({
      id: 'cand-zero-guard',
      platform: 'Athletic.net',
      meetName: 'Zero Guard Meet',
      eventLabel: '1600m',
      eventDistanceMeters: 0,
      fatTimeSecs: 0,
      displayFatTime: '0:00.00',
      date: '2026-04-18',
      trackType: 'OUTDOOR_400M',
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [],
      includeWarmupCooldown: false,
    });
    expect(Number.isFinite(synth.avgPaceSecsPerKm)).toBe(true);
    expect(Number.isFinite(synth.efficiencyFactor || 0)).toBe(true);
  });

  it('P1: computeTeamSnapshotLoadAndCara computes real energy buckets and deduplicates competition-day CARA hours', () => {
    const acts: UnifiedActivity[] = [
      // Competition day with race + separate warmup/shakeout on same day -> must count flat 3.0h total!
      makeRunActivity({
        id: 'race-1',
        startDateLocal: '2026-04-10T15:00:00',
        movingTimeSecs: 300,
        trainingLoad: 70,
        isCompetitionDay: true,
        zoneSecs: { hr: [0, 0, 0, 100, 100, 100, 0] },
      }),
      makeRunActivity({
        id: 'warmup-1',
        startDateLocal: '2026-04-10T14:00:00',
        movingTimeSecs: 1800,
        trainingLoad: 25,
        zoneSecs: { hr: [900, 900, 0, 0, 0, 0, 0] },
      }),
      // Separate practice day -> 1.0h
      makeRunActivity({
        id: 'easy-1',
        startDateLocal: '2026-04-11T16:00:00',
        movingTimeSecs: 3600,
        trainingLoad: 55,
        zoneSecs: { hr: [1800, 1800, 0, 0, 0, 0, 0] },
      }),
    ];
    const metrics = computeTeamSnapshotLoadAndCara(acts, '2026-04-12');
    expect(metrics.caraHours7d).toBe(4.0); // 3.0h flat comp day + 1.0h practice day (NOT 4.5h!)
    expect(metrics.acuteLoad7d).toBe(150);
    expect(metrics.lowAerobicPct + metrics.highAerobicPct + metrics.neuromuscularPct).toBe(100);
    expect(metrics.lowAerobicPct).not.toBe(76); // real computed bucket, not hardcoded 76/18/6
  });

  it('P0: chatOutbox & fieldEventsOutbox survive localStorage QuotaExceededError, isolate per-team flushes, and re-drain mid-flush items', async () => {
    const quotaStorage: Storage = {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', quotaStorage);

    const m1 = enqueueChatOutboxMessage({
      localId: 'c-t1-1',
      teamId: 'team-1',
      channelScope: 'ALL_TEAM',
      body: 'Team 1 first message',
    });
    const m2 = enqueueChatOutboxMessage({
      localId: 'c-t2-1',
      teamId: 'team-2',
      channelScope: 'ALL_TEAM',
      body: 'Team 2 message',
    });
    expect(m1 && m2).toBeTruthy();
    expect(loadChatOutbox()).toHaveLength(2);

    const sentIds: string[] = [];
    let addedMidFlush = false;
    const [res1, res2] = await Promise.all([
      flushChatOutbox(async (msg) => {
        sentIds.push(msg.localId);
        if (!addedMidFlush && msg.localId === 'c-t1-1') {
          addedMidFlush = true;
          enqueueChatOutboxMessage({
            localId: 'c-t1-2',
            teamId: 'team-1',
            channelScope: 'ALL_TEAM',
            body: 'Enqueued mid-flush',
          });
        }
      }, 'team-1'),
      flushChatOutbox(async (msg) => {
        sentIds.push(msg.localId);
      }, 'team-2'),
    ]);

    expect(res1.sentCount).toBe(2);
    expect(res2.sentCount).toBe(1);
    expect(sentIds.sort()).toEqual(['c-t1-1', 'c-t1-2', 'c-t2-1']);
    expect(loadChatOutbox()).toHaveLength(0);

    // Field outbox also preserves multiple batches under QuotaExceededError
    enqueueFieldOutboxBatch('team-1', [
      {
        athleteName: 'Jumper 1',
        date: '2026-04-12',
        eventCode: 'LJ',
        isCompetition: true,
        attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 6.45 }],
      },
    ], 'fb-1');
    enqueueFieldOutboxBatch('team-1', [
      {
        athleteName: 'Thrower 2',
        date: '2026-04-12',
        eventCode: 'SP',
        isCompetition: true,
        attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 15.2 }],
      },
    ], 'fb-2');
    expect(loadFieldOutbox()).toHaveLength(2);
  });

  it('P1: buildCompleteAthleteProfile survives SecurityError when window.localStorage is blocked', () => {
    const restrictedWindow = {
      get localStorage() {
        throw new Error('SecurityError: blocked in sandboxed iframe');
      },
    };
    vi.stubGlobal('window', restrictedWindow);
    const prof = buildCompleteAthleteProfile({ name: 'Restricted WebView Athlete' });
    expect(prof.name).toBe('Restricted WebView Athlete');
    expect(Number.isFinite(prof.ftp)).toBe(true);
  });
});
