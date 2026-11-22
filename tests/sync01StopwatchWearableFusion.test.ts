import { describe, expect, it } from 'vitest';
import type { ActivityStreamSet, TrackWorkoutSpec, UnifiedActivity } from '../src/types';
import {
  applyStopwatchStreamFusionToActivity,
  isSyntheticStopwatchActivity,
  mergeActivitiesNonDestructive,
} from '../src/utils/telemetryStorage';
import {
  formatLocalWallClockIso,
  fuseWearableStreamWithStopwatchSplits,
  synthesizeTracksideRaceActivity,
  synthesizeTracksideWorkoutActivity,
} from '../src/utils/stopwatchActivitySynthesizer';
import {
  applyResetStopwatch,
  applyToggleStartPause,
  readPersistedTracksideStopwatch,
} from '../src/hooks/useTracksideStopwatch';
import {
  isStravaOriginRecord,
  sanitizeTelemetryForCleanRoom,
} from '../server/cleanRoomFirewall';

function makeWearableTrackRun(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: 'garmin-12345',
    startDateLocal: '2026-11-17T15:12:00', // Started 18 min early for warm-up + drills
    name: 'Afternoon Run',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Road',
    movingTimeSecs: 3600,
    distanceMeters: 11200,
    elevationGainMeters: 12,
    trainingLoad: 84,
    loadModelVersion: 3,
    avgHr: 158,
    maxHr: 186,
    avgCadence: 184,
    avgPaceSecsPerKm: 321,
    gapPaceSecsPerKm: 320,
    aerobicDecouplingPct: 2.4,
    efficiencyFactor: 1.44,
    firstHalfEf: 1.46,
    secondHalfEf: 1.42,
    deviceName: 'Garmin Forerunner 965',
    zoneSecs: {
      hr: [720, 1200, 480, 720, 420, 60, 0],
      pace: [720, 1200, 480, 720, 420, 60, 0],
    },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
    ...overrides,
  };
}

function makeSyntheticOvalLatLng(countSecs: number): [number, number][] {
  // Standard World Athletics 400m track geometry loop centered near Stanford Cobb Track
  const centerLat = 37.4342;
  const centerLng = -122.1597;
  const latScale = 1 / 111111;
  const lngScale = 1 / (111111 * Math.cos((centerLat * Math.PI) / 180));
  const out: [number, number][] = [];
  for (let i = 0; i < countSecs; i++) {
    const theta = (i / 70) * 2 * Math.PI;
    const dx = 42 * Math.cos(theta);
    const dy = 78 * Math.sin(theta);
    out.push([
      Number((centerLat + dy * latScale).toFixed(6)),
      Number((centerLng + dx * lngScale).toFixed(6)),
    ]);
  }
  return out;
}

function build1HzTrackStreamsWithWarmup(
  warmupSecs: number,
  splitsSecs: number[],
  repDistMeters: number | number[],
  restSecs: number | number[]
): ActivityStreamSet {
  const cooldownSecs = 240;
  const totalWorkAndRest = splitsSecs.reduce((acc, s, i) => {
    const r = Array.isArray(restSecs) ? restSecs[i] ?? 0 : restSecs;
    return acc + Math.round(s) + (i < splitsSecs.length - 1 ? r : 0);
  }, 0);
  const totalLen = warmupSecs + totalWorkAndRest + cooldownSecs;

  const time: number[] = [];
  const distance: number[] = [];
  const velocitySmooth: number[] = [];
  const heartrate: number[] = [];
  const cadence: number[] = [];
  const groundContactTimeMs: number[] = [];

  for (let t = 0; t < totalLen; t++) {
    time.push(t);
    distance.push(Number((t * 3.5).toFixed(1)));
    velocitySmooth.push(3.4);
    heartrate.push(138);
    cadence.push(168);
    groundContactTimeMs.push(228);
  }

  let cursor = warmupSecs;
  for (let i = 0; i < splitsSecs.length; i++) {
    const repSec = Math.round(splitsSecs[i]);
    const dist = Array.isArray(repDistMeters)
      ? repDistMeters[i] ?? 400
      : repDistMeters;
    const speed = dist / Math.max(1, splitsSecs[i]);
    for (let s = 0; s < repSec && cursor + s < totalLen; s++) {
      const idx = cursor + s;
      velocitySmooth[idx] = Number(speed.toFixed(2));
      heartrate[idx] = Math.round(172 + (s / Math.max(1, repSec)) * 12 + i);
      cadence[idx] = 194;
      groundContactTimeMs[idx] = 188;
    }
    cursor += repSec;

    const restSec = Array.isArray(restSecs) ? restSecs[i] ?? 0 : restSecs;
    if (i < splitsSecs.length - 1 && restSec > 0) {
      for (let s = 0; s < restSec && cursor + s < totalLen; s++) {
        const idx = cursor + s;
        velocitySmooth[idx] = 2.0;
        heartrate[idx] = Math.max(135, 168 - Math.round((s / restSec) * 24));
        cadence[idx] = 156;
        groundContactTimeMs[idx] = 250;
      }
      cursor += restSec;
    }
  }

  return {
    time,
    distance,
    velocitySmooth,
    heartrate,
    cadence,
    groundContactTimeMs,
    latlng: makeSyntheticOvalLatLng(totalLen),
  };
}

describe('SYNC-01 · Coach #stopwatch + Athlete Wearable Deduplication & Stream Fusion', () => {
  it('deduplicates coach #stopwatch splits with an early-started athlete watch symmetrically in both merge orders', () => {
    const splits = [64.12, 63.88, 64.05, 63.71, 63.44, 62.19];
    const coachStopwatch = synthesizeTracksideWorkoutActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      thresholdPaceSecsPerKm: 230,
      lthr: 174,
      maxHr: 196,
      sessionTitle: '6x400m Threshold + Kick',
      presetLabel: '6 x 400m',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: splits,
      startDateLocalIso: '2026-11-17T15:30:00',
      lane: 2,
      footwearClass: 'CARBON_SUPER_SPIKE',
      trackFacility: 'OUTDOOR_400M',
      stimulusCompletionRatio: 0.92,
      autoRegPivotSummary: '+30s Rest (60s -> 90s)',
    });

    expect(isSyntheticStopwatchActivity(coachStopwatch)).toBe(true);
    expect(coachStopwatch.startDateLocal).toBe('2026-11-17T15:30:00');
    expect(coachStopwatch.stopwatchFusionMeta?.stopwatchActivityId).toBe(coachStopwatch.id);

    const garminWatch = makeWearableTrackRun();

    const athleteOrder = mergeActivitiesNonDestructive([garminWatch], [coachStopwatch]);
    const coachOrder = mergeActivitiesNonDestructive([coachStopwatch], [garminWatch]);

    for (const mergedList of [athleteOrder, coachOrder]) {
      expect(mergedList).toHaveLength(1);
      const unified = mergedList[0];
      expect(unified.id).toBe('garmin-12345');
      expect(isSyntheticStopwatchActivity(unified)).toBe(false);
      // Wearable wins biometrics, load & full WU+Workout+CD totals
      expect(unified.trainingLoad).toBe(84);
      expect(unified.distanceMeters).toBe(11200);
      expect(unified.movingTimeSecs).toBe(3600);
      expect(unified.avgHr).toBe(158);
      expect(unified.maxHr).toBe(186);
      // Generic 'Afternoon Run' upgraded to descriptive #stopwatch session title
      expect(unified.name).toContain('6x400m Threshold + Kick');
      expect(unified.deviceName).toBe('Garmin Forerunner 965 + MeetReady Stopwatch');
      // Coach #stopwatch wins track metadata & 0.01s splits
      expect(unified.subType).toBe('Track');
      expect(unified.footwearClass).toBe('CARBON_SUPER_SPIKE');
      expect(unified.spikedDistanceMeters).toBe(2400);
      expect(unified.trackFacility).toBe('OUTDOOR_400M');
      expect(unified.stimulusCompletionRatio).toBe(0.92);
      expect(unified.autoRegPivotSummary).toBe('+30s Rest (60s -> 90s)');
      expect(unified.matchedStopwatchId).toBe(coachStopwatch.id);
      expect(unified.sourceBadges).toEqual(expect.arrayContaining(['Garmin', 'Official FAT']));
      // Unfused summary keeps 0.01s splits and strips fake estimated HR until 1Hz streams arrive
      const workSplits = (unified.intervals || []).filter((iv) => iv.type === 'WORK');
      expect(workSplits.map((w) => w.durationSecs)).toEqual(splits);
      expect(workSplits[0].avgHr).toBeUndefined();
      // Never copy synthetic stopwatch streams onto the wearable summary record
      expect(unified.streams).toBeUndefined();
    }

    // Re-merging myTeamRecordedActivities is 100% idempotent
    const reMerged = mergeActivitiesNonDestructive(athleteOrder, [coachStopwatch]);
    expect(reMerged).toHaveLength(1);
    expect(reMerged[0].trainingLoad).toBe(84);

    // Subsequent Garmin/Strava summary re-sync with auto-laps does NOT clobber coach 0.01s splits
    const afterSummaryResync = mergeActivitiesNonDestructive(athleteOrder, [
      makeWearableTrackRun({
        name: 'Conference Prep Track Intervals',
        intervals: [
          {
            id: 'auto-lap-1',
            type: 'WORK',
            label: 'Auto Mile 1',
            startTimeSecs: 0,
            durationSecs: 380,
            distanceMeters: 1609,
          },
        ],
      }),
    ]);
    expect(afterSummaryResync).toHaveLength(1);
    const preservedWork = (afterSummaryResync[0].intervals || []).filter(
      (iv) => iv.type === 'WORK'
    );
    expect(preservedWork.map((w) => w.durationSecs)).toEqual(splits);
  });

  it('preserves a custom athlete title instead of overwriting it with #stopwatch sessionTitle', () => {
    const coachStopwatch = synthesizeTracksideWorkoutActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      thresholdPaceSecsPerKm: 230,
      sessionTitle: '4x400m Speed',
      presetLabel: '4 x 400m',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: [62.1, 61.9, 61.5, 60.8],
      startDateLocalIso: '2026-11-17T15:30:00',
    });
    const customWatchRun = makeWearableTrackRun({
      name: 'Conference Tune-Up w/ Team',
    });

    const merged = mergeActivitiesNonDestructive([customWatchRun], [coachStopwatch]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Conference Tune-Up w/ Team');
  });

  it('keeps genuine AM + PM 2-a-day runs separate on the same calendar date', () => {
    const morningShakeout = makeWearableTrackRun({
      id: 'garmin-am-shakeout',
      startDateLocal: '2026-11-17T06:30:00',
      name: 'Morning 4mi Shakeout',
      movingTimeSecs: 1800,
      distanceMeters: 6437,
      trainingLoad: 32,
    });
    const afternoonStopwatch = synthesizeTracksideWorkoutActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      thresholdPaceSecsPerKm: 230,
      presetLabel: '6 x 400m',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: [64.1, 63.9, 64.0, 63.8, 63.5, 62.2],
      startDateLocalIso: '2026-11-17T15:30:00',
    });

    const combined = mergeActivitiesNonDestructive([morningShakeout], [afternoonStopwatch]);
    expect(combined).toHaveLength(2);
    const totalTss = combined.reduce((sum, a) => sum + a.trainingLoad, 0);
    expect(totalTss).toBe(32 + afternoonStopwatch.trainingLoad);
  });

  it('automatically fuses 1Hz wearable streams + 0.01s stopwatch splits on merge, on lazy stream load, and across stripped-stream reloads', () => {
    const splits = [64.12, 63.88, 64.05, 62.45];
    const warmupSecs = 1080; // 18-minute warm-up before Rep 1
    const fullStreams = build1HzTrackStreamsWithWarmup(warmupSecs, splits, 400, 60);

    const coachStopwatch = synthesizeTracksideWorkoutActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      thresholdPaceSecsPerKm: 225,
      presetLabel: '4 x 400m',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: splits,
      startDateLocalIso: '2026-11-17T15:30:00',
      lane: 1,
    });

    // (a) Immediate fusion when watch .FIT / Garmin streams are already attached
    const watchWithStreams = makeWearableTrackRun({ streams: fullStreams });
    const immediateMerged = mergeActivitiesNonDestructive([watchWithStreams], [coachStopwatch]);
    expect(immediateMerged).toHaveLength(1);
    const fused = immediateMerged[0];
    expect(fused.stopwatchFusionMeta?.fusedWithWearableStreams).toBe(true);
    expect(Math.abs((fused.stopwatchFusionMeta?.optimalLagSecs ?? 0) - warmupSecs)).toBeLessThanOrEqual(3);
    const fusedWork = (fused.intervals || []).filter((iv) => iv.type === 'WORK');
    expect(fusedWork.map((w) => w.durationSecs)).toEqual(splits);
    expect(fusedWork[0].avgHr).toBeGreaterThanOrEqual(170);
    expect(fusedWork[0].maxHr).toBeGreaterThanOrEqual(178);
    expect(fusedWork[0].avgCadence).toBeGreaterThanOrEqual(188);
    expect(fusedWork[0].avgGroundContactTimeMs).toBeGreaterThanOrEqual(180);
    expect(fusedWork[0].strideLengthMeters).toBeGreaterThan(1.7);
    expect(fused.streams?.snappedTrackDistance?.length).toBe(fullStreams.time.length);

    // (b) Persistence across stripped streams (Dexie summary reload or Coach SUMMARY_ONLY snapshot)
    const strippedFused: UnifiedActivity = { ...fused, streams: undefined };
    const reloaded = mergeActivitiesNonDestructive([strippedFused], [coachStopwatch]);
    expect(reloaded).toHaveLength(1);
    const reloadedWork = (reloaded[0].intervals || []).filter((iv) => iv.type === 'WORK');
    expect(reloadedWork.map((w) => w.durationSecs)).toEqual(splits);
    expect(reloadedWork[0].avgHr).toBe(fusedWork[0].avgHr);

    // (c) Lazy stream hydration via applyStopwatchStreamFusionToActivity (useRouteStreams path)
    const summaryMerged = mergeActivitiesNonDestructive([makeWearableTrackRun()], [coachStopwatch])[0];
    expect(summaryMerged.stopwatchFusionMeta?.fusedWithWearableStreams).toBe(false);
    const lazyHydrated = applyStopwatchStreamFusionToActivity(summaryMerged, fullStreams);
    expect(lazyHydrated.stopwatchFusionMeta?.fusedWithWearableStreams).toBe(true);
    const lazyWork = (lazyHydrated.intervals || []).filter((iv) => iv.type === 'WORK');
    expect(lazyWork.map((w) => w.durationSecs)).toEqual(splits);
    expect(lazyWork[3].avgHr).toBeGreaterThanOrEqual(170);
  });

  it('supports multi-set workouts (2x200m + 2x400m) in fuseWearableStreamWithStopwatchSplits', () => {
    const multiSpec: TrackWorkoutSpec = {
      repCount: 4,
      repDistanceMeters: 200,
      zoneCode: 'I',
      podIntensity: 'INTERVAL_VO2',
      restDurationSecs: 45,
      sets: [
        {
          repCount: 2,
          repDistanceMeters: 200,
          zoneCode: 'R',
          podIntensity: 'REPETITION',
          restDurationSecs: 45,
          setRestAfterSecs: 120,
        },
        {
          repCount: 2,
          repDistanceMeters: 400,
          zoneCode: 'I',
          podIntensity: 'INTERVAL_VO2',
          restDurationSecs: 60,
        },
      ],
    };

    const splits = [31.14, 30.92, 64.45, 63.88];
    const streams = build1HzTrackStreamsWithWarmup(
      300,
      splits,
      [200, 200, 400, 400],
      [45, 120, 60]
    );

    const fusion = fuseWearableStreamWithStopwatchSplits({
      wearableStreams: streams,
      lapSplitsSecs: splits,
      repDistanceMeters: 200,
      restDurationSecs: 45,
      multiSetSpec: multiSpec,
    });

    const workInts = fusion.intervals.filter((iv) => iv.type === 'WORK');
    const recInts = fusion.intervals.filter((iv) => iv.type === 'RECOVERY');
    expect(workInts).toHaveLength(4);
    expect(workInts[0].distanceMeters).toBe(200);
    expect(workInts[1].distanceMeters).toBe(200);
    expect(workInts[2].distanceMeters).toBe(400);
    expect(workInts[3].distanceMeters).toBe(400);
    expect(workInts[0].label).toContain('Set 1');
    expect(workInts[2].label).toContain('Set 2');
    expect(recInts[1].durationSecs).toBe(120); // Inter-set recovery preserved
  });

  it('records real local wall-clock session start time on stopwatch state and synthesized activities', () => {
    const baseState = readPersistedTracksideStopwatch();
    const t0 = new Date(2026, 10, 17, 15, 31, 42).getTime();
    const started = applyToggleStartPause(baseState, t0);
    expect(started.isRunning).toBe(true);
    expect(started.sessionStartedEpochMs).toBe(t0);

    const paused = applyToggleStartPause(started, t0 + 15000);
    expect(paused.isRunning).toBe(false);
    expect(paused.sessionStartedEpochMs).toBe(t0);

    const resumed = applyToggleStartPause(paused, t0 + 25000);
    expect(resumed.sessionStartedEpochMs).toBe(t0);

    const reset = applyResetStopwatch(resumed);
    expect(reset.sessionStartedEpochMs).toBeNull();

    const localIso = formatLocalWallClockIso(t0);
    expect(localIso).toBe('2026-11-17T15:31:42');

    const raceAct = synthesizeTracksideRaceActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      eventLabel: '1600m',
      eventDistanceMeters: 1600,
      lapSplitDistanceMeters: 400,
      lapSplitsSecs: [64.2, 65.1, 65.4, 61.3],
      netTotalSecs: 256.0,
      startDateLocalIso: localIso,
      lane: 1,
    });
    expect(raceAct.startDateLocal).toBe('2026-11-17T15:31:42');
    expect(raceAct.stopwatchFusionMeta?.stopwatchActivityId).toBe(raceAct.id);
  });

  it('preserves strict CMP-01 Strava Clean-Room isolation when deduplicating a Strava-only watch run with coach #stopwatch', () => {
    const stravaOnlyRun = makeWearableTrackRun({
      id: 'strava-99887766',
      stravaId: '99887766',
      deviceName: 'Strava App / Watch Sync',
      sourceBadges: ['Strava'],
    });
    const coachStopwatch = synthesizeTracksideWorkoutActivity({
      runnerId: 'athlete-1',
      runnerName: 'Alex Mercer',
      thresholdPaceSecsPerKm: 230,
      presetLabel: '4 x 400m',
      repDistanceMeters: 400,
      restDurationSecs: 60,
      lapSplitsSecs: [64.2, 63.9, 64.1, 63.0],
      startDateLocalIso: '2026-11-17T15:30:00',
    });

    const athleteViewMerged = mergeActivitiesNonDestructive([stravaOnlyRun], [coachStopwatch]);
    expect(athleteViewMerged).toHaveLength(1);
    const merged = athleteViewMerged[0];
    expect(merged.stravaId).toBe('99887766');
    expect(merged.sourceBadges).toEqual(expect.arrayContaining(['Strava', 'Official FAT']));

    // CRITICAL CMP-01 ASSERTION: 'Official FAT' MUST NOT bypass the Strava Clean-Room firewall
    expect(isStravaOriginRecord(merged)).toBe(true);
    const cleaned = sanitizeTelemetryForCleanRoom({ activities: [merged] });
    expect(cleaned.activities).toHaveLength(0);
  });
});
