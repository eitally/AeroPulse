import { describe, expect, it } from 'vitest';
import { computeWorldAthleticsOvalLaneGeometry } from '../src/physiology/trackEnvironmentPhysics';
import { snapGpsStreamToStandardTrackOval } from '../src/physiology/trackOvalGpsFusionEngine';
import { fuseWearableStreamWithStopwatchSplits } from '../src/utils/stopwatchActivitySynthesizer';
import { generatePostWorkoutDebrief } from '../src/physiology/workoutDebrief';
import type { AthleteProfile, UnifiedActivity } from '../src/types';

function synthesizeCapsulePoint(
  sMeters: number,
  lane: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  thetaRad: number,
  centerLat: number,
  centerLng: number,
  radialNoiseMeters: number
): [number, number] {
  const geom = computeWorldAthleticsOvalLaneGeometry(lane);
  const S = geom.straightMeters;
  const halfS = S / 2;
  const R = geom.effectiveRadiusMeters + radialNoiseMeters;
  const halfCirc = Math.PI * geom.effectiveRadiusMeters;
  const lapLen = geom.circumferenceMeters;
  const s = ((sMeters % lapLen) + lapLen) % lapLen;

  let u = 0;
  let v = 0;
  if (s <= S) {
    u = -halfS + s;
    v = -R;
  } else if (s <= S + halfCirc) {
    const phi = -Math.PI / 2 + (s - S) / geom.effectiveRadiusMeters;
    u = halfS + R * Math.cos(phi);
    v = R * Math.sin(phi);
  } else if (s <= 2 * S + halfCirc) {
    u = halfS - (s - (S + halfCirc));
    v = R;
  } else {
    const alpha = (s - (2 * S + halfCirc)) / geom.effectiveRadiusMeters;
    const phi = Math.PI / 2 + alpha;
    u = -halfS + R * Math.cos(phi);
    v = R * Math.sin(phi);
  }

  const east = u * Math.cos(thetaRad) - v * Math.sin(thetaRad) + 18; // +18m center shift
  const north = u * Math.sin(thetaRad) + v * Math.cos(thetaRad) - 11; // -11m center shift
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = 111319.49 * Math.cos((centerLat * Math.PI) / 180);
  return [centerLat + north / metersPerDegLat, centerLng + east / metersPerDegLng];
}

const DEFAULT_TEST_PROFILE: AthleteProfile = {
  athleteId: 'test-runner',
  name: 'Track Athlete',
  primarySport: 'Running',
  weightKg: 64,
  restingHr: 46,
  vo2MaxCycling: 62,
  vo2MaxRunning: 68,
  ftp: 280,
  indoorFtp: 270,
  eFtp: 280,
  wPrime: 18000,
  pMax: 900,
  lthr: 174,
  maxHr: 196,
  sweetSpotMinPct: 88,
  sweetSpotMaxPct: 94,
  runFtp: 310,
  runEFtp: 310,
  runLthr: 174,
  runMaxHr: 196,
  thresholdPaceSecsPerKm: 205,
  powerZones: [],
  hrZones: [],
  runHrZones: [],
  lastSyncedAt: '2026-11-15T12:00:00Z',
  source: 'CUSTOM_OVERRIDE',
};

describe('TRK-09: 400m Oval Huber GPS Snap & 1Hz Watch + 0.01s Stopwatch Fusion', () => {
  it('snaps noisy rotated 4-lap Lane 1 GPS coordinates with multipath spikes within <1.5% of 1600m', () => {
    const thetaRad = (37 * Math.PI) / 180;
    const latlng: [number, number][] = [];
    // 4 laps * 400m = 1600m at ~5.5 m/s (~291 samples)
    const speedMps = 5.5;
    for (let t = 0; t <= 291; t++) {
      const s = t * speedMps;
      // Add sinusoidal GPS drift + corner-cutting bias + 2 multipath outliers
      const outlier = t === 65 ? 19.0 : t === 190 ? -16.5 : 0;
      const noise = Math.sin(t * 0.45) * 3.4 + outlier;
      latlng.push(synthesizeCapsulePoint(s, 1, thetaRad, 37.437, -122.155, noise));
    }

    const snap = snapGpsStreamToStandardTrackOval(latlng, { lane: 1 });
    expect(snap).not.toBeNull();
    expect(snap!.lapLengthMeters).toBe(400);
    expect(snap!.snappedLatLng).toHaveLength(latlng.length);
    // Expected calibrated distance: 291 * 5.5 = 1600.5m
    expect(snap!.calibratedTrackDistanceMeters).toBeGreaterThan(1575);
    expect(snap!.calibratedTrackDistanceMeters).toBeLessThan(1625);
    expect(snap!.rawGpsDistanceMeters).toBeGreaterThan(snap!.calibratedTrackDistanceMeters);
    // Azimuth close to 37 deg (mod 180)
    expect(Math.abs(snap!.fittedAzimuthDeg - 37)).toBeLessThan(6);
  });

  it('calibrates Lane 4 perimeter to ~1689.5m across 4 laps', () => {
    const thetaRad = (112 * Math.PI) / 180;
    const geom = computeWorldAthleticsOvalLaneGeometry(4);
    const totalMeters = geom.circumferenceMeters * 4;
    const latlng: [number, number][] = [];
    const steps = 300;
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * totalMeters;
      const noise = Math.cos(i * 0.3) * 2.2;
      latlng.push(synthesizeCapsulePoint(s, 4, thetaRad, 37.437, -122.155, noise));
    }

    const snap = snapGpsStreamToStandardTrackOval(latlng, { lane: 4 });
    expect(snap).not.toBeNull();
    expect(snap!.lapLengthMeters).toBe(422.37);
    expect(Math.abs(snap!.calibratedTrackDistanceMeters - totalMeters)).toBeLessThan(20);
  });

  it('aligns #stopwatch 0.01s splits onto a 1Hz wearable stream with 120s warmup offset and feeds anchored debrief', () => {
    const repSplits = [64.25, 64.5, 66.8, 68.4]; // notice clear fading in closing half
    const restSecs = 65; // >= 55s recovery for HRR60 extraction
    const thetaRad = (25 * Math.PI) / 180;

    const time: number[] = [];
    const distance: number[] = [];
    const velocitySmooth: number[] = [];
    const heartrate: number[] = [];
    const cadence: number[] = [];
    const groundContactTimeMs: number[] = [];
    const latlng: [number, number][] = [];

    let tCursor = 0;
    let dCursor = 0;
    let ovalS = 0;

    const pushSeg = (
      secs: number,
      speed: number,
      hrStart: number,
      hrEnd: number,
      cad: number,
      gct: number
    ) => {
      const len = Math.round(secs);
      for (let i = 0; i < len; i++) {
        const frac = i / Math.max(1, len);
        time.push(tCursor);
        distance.push(Number(dCursor.toFixed(1)));
        velocitySmooth.push(speed);
        heartrate.push(Math.round(hrStart + frac * (hrEnd - hrStart)));
        cadence.push(cad);
        groundContactTimeMs.push(gct);
        latlng.push(
          synthesizeCapsulePoint(ovalS, 1, thetaRad, 37.437, -122.155, Math.sin(tCursor * 0.3) * 1.8)
        );
        tCursor += 1;
        dCursor += speed;
        ovalS += speed;
      }
    };

    // 120s easy warmup
    pushSeg(120, 2.85, 130, 142, 168, 252);

    // 4 x 400m reps with distinct cadence held high while velocity drops (stride length loss!)
    for (let r = 0; r < repSplits.length; r++) {
      const lap = repSplits[r];
      const vRep = 400 / lap;
      const cadRep = r < 2 ? 196 : 195; // cadence nearly constant while speed drops => stride length falls!
      const gctRep = r < 2 ? 178 : 192;
      pushSeg(lap, vRep, 152 + r * 2, 184 + r, cadRep, gctRep);

      if (r < repSplits.length - 1) {
        // 65s recovery with clear -28 bpm HRR60 drop
        pushSeg(restSecs, 1.85, 184 + r, 154 + r, 146, 285);
      }
    }

    // 90s cooldown
    pushSeg(90, 2.6, 156, 132, 164, 260);

    const fusion = fuseWearableStreamWithStopwatchSplits({
      wearableStreams: {
        time,
        distance,
        velocitySmooth,
        heartrate,
        cadence,
        groundContactTimeMs,
        latlng,
      },
      lapSplitsSecs: repSplits,
      repDistanceMeters: 400,
      restDurationSecs: restSecs,
      lane: 1,
      thresholdPaceSecsPerKm: 205,
    });

    expect(Math.abs(fusion.optimalLagSecs - 120)).toBeLessThanOrEqual(2);
    expect(fusion.correlationScore).toBeGreaterThan(0.85);
    expect(fusion.ovalSnapSummary).not.toBeNull();
    expect(fusion.fusedStreams.snappedTrackDistance?.length).toBe(time.length);

    const workIntervals = fusion.intervals.filter((iv) => iv.type === 'WORK');
    const recIntervals = fusion.intervals.filter((iv) => iv.type === 'RECOVERY');
    expect(workIntervals).toHaveLength(4);
    expect(recIntervals).toHaveLength(3);
    expect(workIntervals[0].durationSecs).toBe(64.25);
    expect(workIntervals[0].strideLengthMeters).toBeGreaterThan(1.8);
    expect(workIntervals[0].avgGroundContactTimeMs).toBeGreaterThan(165);

    const fusedActivity: UnifiedActivity = {
      id: 'fused-track-session',
      startDateLocal: '2026-11-15T15:30:00',
      name: '4 x 400m Fused Track Session',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: 'Track',
      movingTimeSecs: time.length,
      distanceMeters: dCursor,
      elevationGainMeters: 0,
      trainingLoad: 78,
      avgHr: 162,
      maxHr: 188,
      avgCadence: 184,
      avgPaceSecsPerKm: 215,
      aerobicDecouplingPct: 2.1,
      efficiencyFactor: 1.8,
      firstHalfEf: 1.84,
      secondHalfEf: 1.79,
      zoneSecs: { hr: [200, 120, 60, 140, 120, 0, 0] },
      stravaPrCount: 0,
      segmentEfforts: [],
      intervals: fusion.intervals,
      streams: fusion.fusedStreams,
      sourceBadges: ['Official FAT', 'Garmin'],
    };

    const debrief = generatePostWorkoutDebrief(
      fusedActivity,
      fusion.fusedStreams,
      DEFAULT_TEST_PROFILE
    );
    expect(debrief).not.toBeNull();
    expect(debrief!.anchoredHrr60MeanBpm).toBeGreaterThanOrEqual(24);
    expect(debrief!.strideLengthFadePct).toBeLessThan(-3.0);
    expect(debrief!.fadePrimaryDriver).toBe('STRIDE_LENGTH_LOSS');
    expect(debrief!.insights.some((i) => i.id === 'stride-cadence-fade')).toBe(true);
    expect(debrief!.insights.some((i) => i.id === 'hrr60-recovery')).toBe(true);
  });
});
