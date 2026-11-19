import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_PREFERENCE_KEYS,
  STORAGE_KEYS,
  clearAllUserBrowserStorage,
} from '../src/utils/storageKeys';
import {
  areActivityTimestampsClose,
  normalizeActivityTimestamps,
  resolveIanaTimeZoneOffsetMinutes,
} from '../src/utils/activityTimestamp';
import {
  getSavedIntervalsHeaders,
  mergeActivitiesNonDestructive,
} from '../src/utils/telemetryStorage';
import {
  countPendingStopwatchOutboxEntries,
  enqueueStopwatchOutboxBatch,
  flushStopwatchOutbox,
  loadStopwatchOutbox,
  loadWalkOnStopwatchEntriesLocal,
  overlayPendingStopwatchOutboxOnTeams,
  partitionSavedStopwatchEntries,
  persistWalkOnStopwatchEntriesLocal,
} from '../src/utils/stopwatchTeamSync';
import { synthesizeTracksideWorkoutActivity } from '../src/utils/stopwatchActivitySynthesizer';
import { buildConnectedRosterFromTeam } from '../src/hooks/useTeamRoster';
import { normalizeRawStravaActivity } from '../server/stravaSyncService';
import { normalizePolarExercise } from '../server/routers/polarRouter';
import { parseFitBinaryBuffer } from '../src/workers/activityProcessor.worker';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData';
import { computeDualSportPmcSeries } from '../src/physiology/pmc';
import { simulateCoursePacingAndFueling } from '../src/physiology/raceSimulator';
import type {
  ConnectedAthleteRecord,
  TeamSummaryWithRole,
  UnifiedActivity,
} from '../src/types';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function buildTokyoFitBufferWithActivityOffset(utcUnixMs: number, offsetSecs: number): ArrayBuffer {
  const FIT_EPOCH_SECS = 631065600;
  const fitUtcTs = Math.round(utcUnixMs / 1000) - FIT_EPOCH_SECS;
  const fitLocalTs = fitUtcTs + offsetSecs;
  const bytes: number[] = [];

  const pushUint32LE = (val: number) => {
    bytes.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
  };
  const pushInt32LE = (val: number) => {
    pushUint32LE(val >>> 0);
  };
  const pushUint16LE = (val: number) => {
    bytes.push(val & 0xff, (val >>> 8) & 0xff);
  };

  // Def 0: Activity Msg 34 (local 0): timestamp(253,4B) + local_timestamp(5,4B)
  bytes.push(0x40, 0x00, 0x00, 34, 0x00, 2);
  bytes.push(253, 4, 0x86);
  bytes.push(5, 4, 0x86);
  // Data 0: Activity Msg 34
  bytes.push(0x00);
  pushUint32LE(fitUtcTs);
  pushUint32LE(fitLocalTs);

  // Def 1: Record Msg 20 (local 1): timestamp(253,4B), lat(0,4B), lon(1,4B), hr(3,1B), speed(6,2B)
  bytes.push(0x41, 0x00, 0x00, 20, 0x00, 5);
  bytes.push(253, 4, 0x86);
  bytes.push(0, 4, 0x85);
  bytes.push(1, 4, 0x85);
  bytes.push(3, 1, 0x02);
  bytes.push(6, 2, 0x84);

  const degToSemicircles = (deg: number) => Math.round((deg * Math.pow(2, 31)) / 180);
  for (let i = 0; i < 3; i += 1) {
    bytes.push(0x01);
    pushUint32LE(fitUtcTs + i);
    pushInt32LE(degToSemicircles(35.6812));
    pushInt32LE(degToSemicircles(139.7671));
    bytes.push(148 + i);
    pushUint16LE(3850);
  }

  const headerSize = 14;
  const total = new Uint8Array(headerSize + bytes.length + 2);
  const dv = new DataView(total.buffer);
  dv.setUint8(0, headerSize);
  dv.setUint8(1, 0x20);
  dv.setUint16(2, 2100, true);
  dv.setUint32(4, bytes.length, true);
  total[8] = 0x2e;
  total[9] = 0x46;
  total[10] = 0x49;
  total[11] = 0x54;
  dv.setUint16(12, 0, true);
  total.set(bytes, headerSize);
  dv.setUint16(headerSize + bytes.length, 0, true);
  return total.buffer;
}

describe('Sprint 0 Wave 0B — RT-10, RT-11, RT-12, RT-13 & RT-26 /docs route', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocalStorage) globalThis.localStorage = originalLocalStorage;
    if (originalSessionStorage) globalThis.sessionStorage = originalSessionStorage;
    if (originalFetch) globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('RT-10: sweeps every user/credential/dynamic storage key on Sign Out while preserving only device UI/unit preferences', () => {
    localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, 'secret-session-user-a');
    localStorage.setItem(STORAGE_KEYS.GARMIN_PERSONAL_API_KEY, 'GCDC_USER_A');
    localStorage.setItem(STORAGE_KEYS.GARMIN_BEARER_TOKEN, 'garmin-bearer-user-a');
    localStorage.setItem(STORAGE_KEYS.INTERVALS_API_KEY, 'intervals-user-a');
    localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, 'gemini-user-a');
    localStorage.setItem(`${STORAGE_KEYS.STRAVA_BACKFILL_PREFIX}778899`, '1');
    localStorage.setItem(STORAGE_KEYS.TARGET_GOALS, JSON.stringify([{ id: 'g1', title: 'User A PR' }]));
    localStorage.setItem(STORAGE_KEYS.ANNUAL_MILEAGE_GOALS, JSON.stringify([{ sportCategory: 'Running', targetDistanceMeters: 1500000 }]));
    localStorage.setItem(STORAGE_KEYS.MY_TEAMS, JSON.stringify([{ brand: { teamId: 'tm-a' } }]));
    localStorage.setItem(STORAGE_KEYS.STOPWATCH_OUTBOX, JSON.stringify([{ batchId: 'b1' }]));
    localStorage.setItem(STORAGE_KEYS.WALKON_STOPWATCH_LOGS, JSON.stringify([{ runnerId: 'w1' }]));
    localStorage.setItem(`${STORAGE_KEYS.DAILY_SORENESS_PREFIX}2026-11-19`, '{"academicStress":4}');
    localStorage.setItem(`${STORAGE_KEYS.TEAM_VENUES_PREFIX}tm-a`, '[{"name":"Track"}]');
    sessionStorage.setItem(STORAGE_KEYS.PENDING_TEAM_JOIN, 'WGHS-26');
    sessionStorage.setItem(STORAGE_KEYS.ONBOARDING_ROLE, 'COACH');

    // Device preferences MUST survive Sign Out
    localStorage.setItem(STORAGE_KEYS.THEME_DARK, '1');
    localStorage.setItem(STORAGE_KEYS.THEME_DAYTIME, 'TRACK_PINE');
    localStorage.setItem(STORAGE_KEYS.THEME_POLICY, 'AUTO_MIDNIGHT_SLATE');
    localStorage.setItem(STORAGE_KEYS.DISTANCE_UNIT, 'km');

    const removed = clearAllUserBrowserStorage({ preserveLoggedOutFlag: true });
    expect(removed.length).toBeGreaterThanOrEqual(13);
    expect(localStorage.getItem(STORAGE_KEYS.LOGGED_OUT)).toBe('1');
    expect(localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.GARMIN_PERSONAL_API_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.INTERVALS_API_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_API_KEY)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.STRAVA_BACKFILL_PREFIX}778899`)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.TARGET_GOALS)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.DAILY_SORENESS_PREFIX}2026-11-19`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.TEAM_VENUES_PREFIX}tm-a`)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.PENDING_TEAM_JOIN)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.ONBOARDING_ROLE)).toBeNull();

    for (const prefKey of DEVICE_PREFERENCE_KEYS) {
      if (
        prefKey === STORAGE_KEYS.THEME_DARK ||
        prefKey === STORAGE_KEYS.THEME_DAYTIME ||
        prefKey === STORAGE_KEYS.THEME_POLICY ||
        prefKey === STORAGE_KEYS.DISTANCE_UNIT
      ) {
        expect(localStorage.getItem(prefKey)).not.toBeNull();
      }
    }

    // Even if an attacker/stale tab sets a key without clearing LOGGED_OUT, headers must stay empty
    localStorage.setItem(STORAGE_KEYS.STRAVA_CLIENT_ID, 'stale-client');
    expect(getSavedIntervalsHeaders()).toEqual({});
  });

  it('RT-11: exposes watchless INVITED roster athletes to coaches, isolates walk-ons from SELF, and persists/flushes offline stopwatch outbox', async () => {
    const mockTeam: TeamSummaryWithRole = {
      brand: {
        teamId: 'tm_wghs',
        slug: 'willow-glen-xc',
        joinCode: 'WGHS-99',
        name: 'Willow Glen XC',
        shortName: 'WGHS',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        primaryHex: '#1C5436',
        secondaryHex: '#C8FF00',
        defaultSafeSportShield: true,
        enableParentGuardianCc: true,
        coachDisplayName: 'Coach Rivera',
        createdAt: '2026-11-01T00:00:00Z',
      },
      myMembershipId: 'mem_coach',
      myRole: 'HEAD_COACH',
      mySquadGroup: 'Varsity',
      totalInvited: 2,
      openedCount: 0,
      activeCount: 1,
      watchConnectedCount: 0,
      broadcastWorkouts: [],
      memberships: [
        {
          membershipId: 'mem_coach',
          teamId: 'tm_wghs',
          role: 'HEAD_COACH',
          invitedName: 'Coach Rivera',
          squadGroup: 'Varsity',
          isMinorU18: false,
          status: 'ACTIVE',
          sharingTier: 'FULL_STREAMS',
          invitedAt: '2026-11-01T00:00:00Z',
        },
        {
          membershipId: 'mem_watchless',
          teamId: 'tm_wghs',
          role: 'ATHLETE',
          invitedName: 'Maya Watchless',
          squadGroup: 'Varsity',
          isMinorU18: true,
          status: 'INVITED',
          sharingTier: 'LOAD_ONLY',
          invitedAt: '2026-11-18T00:00:00Z',
        },
      ],
    };

    const coachRoster = buildConnectedRosterFromTeam(mockTeam);
    expect(coachRoster.some((r) => r.id === 'team-mem-mem_watchless')).toBe(true);
    const athleteRosterView = buildConnectedRosterFromTeam({
      ...mockTeam,
      myRole: 'ATHLETE',
    });
    expect(athleteRosterView.some((r) => r.id === 'team-mem-mem_watchless')).toBe(false);

    const watchlessAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'team-mem-mem_watchless',
      runnerName: 'Maya Watchless',
      presetLabel: '4x800m',
      repDistanceMeters: 800,
      restDurationSecs: 90,
      lapSplitsSecs: [152.4, 151.9],
      thresholdPaceSecsPerKm: 235,
      startDateLocalIso: '2026-11-19T15:30:00',
      startDateUtcMs: Date.UTC(2026, 10, 19, 23, 30, 0),
    });
    const walkOnAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'walkon-temp-1',
      runnerName: 'Walk-On Jordan',
      presetLabel: '4x800m',
      repDistanceMeters: 800,
      restDurationSecs: 90,
      lapSplitsSecs: [160.1],
      thresholdPaceSecsPerKm: 245,
      startDateLocalIso: '2026-11-19T15:30:00',
    });
    const readOnlyFriend: ConnectedAthleteRecord = {
      id: 'friend-1',
      name: 'Read Only Friend',
      avatarInitials: 'RF',
      location: 'Local',
      stravaAthleteId: '',
      inviteCode: 'TH-1234-RF',
      role: 'FRIEND_VIEW',
      status: 'CONNECTED',
      primaryGoalSummary: '5K',
      primarySport: 'Running',
      privacySettings: coachRoster[0].privacySettings,
      athleteProfile: coachRoster[0].athleteProfile,
      wellnessDays: [],
      activities: [],
      plannedEvents: [],
      targetGoals: [],
    };
    const friendAct = { ...walkOnAct, id: 'sw-friend-1' };

    const partitioned = partitionSavedStopwatchEntries(
      [
        { runnerId: 'team-mem-mem_watchless', runnerName: 'Maya Watchless', activity: watchlessAct },
        { runnerId: 'walkon-temp-1', runnerName: 'Walk-On Jordan', activity: walkOnAct },
        { runnerId: 'friend-1', runnerName: 'Read Only Friend', activity: friendAct },
      ],
      [...coachRoster, readOnlyFriend],
      {
        isTeamCoach: true,
        activeTeamMembershipIds: new Set(['mem_watchless']),
      }
    );

    expect(partitioned.selfActs).toHaveLength(0);
    expect(partitioned.teamApiEntries).toHaveLength(1);
    expect(partitioned.teamApiEntries[0].membershipId).toBe('mem_watchless');
    expect(partitioned.walkOnEntries).toHaveLength(1);
    expect(partitioned.walkOnEntries[0].runnerName).toBe('Walk-On Jordan');
    expect(partitioned.skippedReadOnlyNames).toEqual(['Read Only Friend']);

    persistWalkOnStopwatchEntriesLocal(partitioned.walkOnEntries);
    expect(loadWalkOnStopwatchEntriesLocal()).toHaveLength(1);

    // Enqueue batch while offline & verify overlay survives across reloads until flushed online
    enqueueStopwatchOutboxBatch(mockTeam.brand.teamId, partitioned.teamApiEntries);
    expect(countPendingStopwatchOutboxEntries(mockTeam.brand.teamId)).toBe(1);

    const overlaid = overlayPendingStopwatchOutboxOnTeams([mockTeam]);
    const memWithOverlay = overlaid[0].memberships.find((m) => m.membershipId === 'mem_watchless')!;
    expect(memWithOverlay.coachRecordedActivities?.map((a) => a.id)).toContain(watchlessAct.id);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('offline'))
    );
    const failedFlush = await flushStopwatchOutbox();
    expect(failedFlush.syncedEntries).toBe(0);
    expect(failedFlush.remainingEntries).toBe(1);
    expect(loadStopwatchOutbox()[0].attempts).toBe(1);

    const updatedFromServer: TeamSummaryWithRole = overlaid[0];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, team: updatedFromServer }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const onTeamUpdated = vi.fn();
    const okFlush = await flushStopwatchOutbox(onTeamUpdated);
    expect(okFlush.syncedEntries).toBe(1);
    expect(okFlush.remainingEntries).toBe(0);
    expect(onTeamUpdated).toHaveBeenCalledTimes(1);
    expect(countPendingStopwatchOutboxEntries(mockTeam.brand.teamId)).toBe(0);
  });

  it('RT-12: preserves local wall-clock dates & canonical startDateUtcMs across Strava, Wahoo, Polar, FIT, and Stopwatch for cross-TZ dedup', () => {
    const eveningUtcIso = '2026-03-11T02:30:00Z'; // 2026-03-10T19:30:00 America/Los_Angeles (PDT, UTC-7)
    const expectedUtcMs = Date.parse(eveningUtcIso);

    const stravaRaw = normalizeRawStravaActivity(
      {
        id: 9900112233,
        name: 'Evening Track Threshold',
        sport_type: 'Run',
        start_date: eveningUtcIso,
        start_date_local: '2026-03-10T19:30:00Z', // Strava's notorious fake-Z local wall-clock!
        utc_offset: -25200,
        moving_time: 2400,
        distance: 9000,
        average_heartrate: 162,
        max_heartrate: 181,
      },
      {
        calibratedFtp: 280,
        calibratedBikeLthr: 168,
        calibratedRunLthr: 172,
        calibratedThresholdPaceSecsPerKm: 245,
        restingHr: 50,
      }
    );
    const stravaAct: UnifiedActivity = {
      ...(stravaRaw as unknown as UnifiedActivity),
      id: `strava_${stravaRaw.stravaId}`,
      sourceBadges: ['Strava'],
    };

    const laOffsetMins = resolveIanaTimeZoneOffsetMinutes(expectedUtcMs, 'America/Los_Angeles');
    expect(laOffsetMins).toBe(-420);
    const wahooTs = normalizeActivityTimestamps({
      startDateUtc: eveningUtcIso,
      timeZoneOffsetMins: laOffsetMins,
    });
    const wahooAct: UnifiedActivity = {
      ...stravaAct,
      id: 'wahoo_777',
      stravaId: undefined,
      wahooId: '777',
      startDateLocal: wahooTs.startDateLocal,
      startDateUtcMs: wahooTs.startDateUtcMs,
      sourceBadges: ['Wahoo'],
    };

    const polarAct = normalizePolarExercise(
      {
        id: 'pol_888',
        sport: 'RUNNING',
        start_time: '2026-03-10T19:30:00',
        start_time_utc_offset: -420,
        duration: 'PT40M0S',
        distance: 9000,
        heart_rate: { average: 162, maximum: 181 },
      },
      245,
      172
    ) as unknown as UnifiedActivity;

    const swAct = synthesizeTracksideWorkoutActivity({
      runnerId: 'SELF',
      runnerName: 'Dev Runner',
      presetLabel: '4x1600m',
      repDistanceMeters: 1600,
      restDurationSecs: 60,
      lapSplitsSecs: [358.2, 357.8],
      thresholdPaceSecsPerKm: 245,
      startDateLocalIso: '2026-03-10T19:38:00',
      startDateUtcMs: expectedUtcMs + 480_000,
    });

    for (const act of [stravaAct, wahooAct, polarAct]) {
      expect(act.startDateLocal).toBe('2026-03-10T19:30:00');
      expect(act.startDateUtcMs).toBe(expectedUtcMs);
      expect(areActivityTimestampsClose(stravaAct, act, 300)).toBe(true);
    }

    const mergedAll = mergeActivitiesNonDestructive(
      mergeActivitiesNonDestructive([stravaAct as UnifiedActivity], [wahooAct, polarAct]),
      [swAct]
    );
    expect(mergedAll).toHaveLength(1);
    expect(mergedAll[0].startDateLocal).toBe('2026-03-10T19:30:00');
    expect(mergedAll[0].sourceBadges).toEqual(
      expect.arrayContaining(['Strava', 'Wahoo', 'Polar'])
    );

    // Binary .FIT Msg 34 (+9h Tokyo local offset) must resolve Tokyo local wall clock even in non-JST runtime
    const tokyoUtcMs = Date.parse('2026-11-18T23:45:00Z'); // 2026-11-19T08:45:00+09:00
    const tokyoFitBuf = buildTokyoFitBufferWithActivityOffset(tokyoUtcMs, 9 * 3600);
    const parsedFit = parseFitBinaryBuffer(tokyoFitBuf, 'tokyo_track.fit', {
      ftp: 280,
      lthr: 170,
      maxHr: 190,
      restingHr: 50,
      weightKg: 68,
    });
    expect(parsedFit.startDateUtcMs).toBe(tokyoUtcMs);
    expect(parsedFit.startDateLocal).toBe('2026-11-19T08:45:00');
  });

  it('RT-13: seeds Dual-Sport PMC CTL/TSB from canonical Banister baseline and fixes Race Simulator Segment 2 cue', () => {
    const demo = buildSampleDemoDataset('2026-11-19');
    const latestW = demo.wellnessDays[demo.wellnessDays.length - 1];
    const dualSeeded = computeDualSportPmcSeries(demo.activities, demo.athleteProfile, 14, {
      seedWellnessDays: demo.wellnessDays,
    });
    const latestDual = dualSeeded[dualSeeded.length - 1];
    expect(Math.abs(latestDual.systemicCtl - latestW.ctl)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(latestDual.systemicTsb - latestW.tsb)).toBeLessThanOrEqual(0.5);

    const runSim = simulateCoursePacingAndFueling({
      sport: 'Running',
      raceName: 'Half Marathon',
      distanceKm: 21.1,
      elevationGainMeters: 120,
      ambientTempC: 18,
      altitudeMeters: 200,
      athleteProfile: demo.athleteProfile,
    });
    expect(runSim.segments).toHaveLength(5);
    expect(runSim.segments[1].coachingCue).not.toMatch(/final segment|empty remaining/i);
    expect(runSim.segments[4].coachingCue).toMatch(/final segment/i);

    const bikeSim = simulateCoursePacingAndFueling({
      sport: 'Cycling',
      raceName: 'Gran Fondo 100k',
      distanceKm: 100,
      elevationGainMeters: 1100,
      ambientTempC: 18,
      altitudeMeters: 300,
      athleteProfile: demo.athleteProfile,
    });
    expect(bikeSim.segments).toHaveLength(5);
    expect(bikeSim.segments[1].coachingCue).not.toMatch(/final|empty remaining W'/i);
    expect(bikeSim.segments[4].coachingCue).toMatch(/final/i);
  });

  it('RT-26 route: vercel.json maps /docs and /docs/ directly to /docs/index.html outside SPA fallback', () => {
    const vercel = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
    ) as { rewrites: Array<{ source: string; destination: string }> };

    const docsRewrite = vercel.rewrites.find((r) => r.source === '/docs');
    const docsSlashRewrite = vercel.rewrites.find((r) => r.source === '/docs/');
    const spaFallback = vercel.rewrites.find((r) => r.destination === '/index.html');

    expect(docsRewrite?.destination).toBe('/docs/index.html');
    expect(docsSlashRewrite?.destination).toBe('/docs/index.html');
    expect(spaFallback?.source).toContain('docs(?:/|$)');
  });
});
