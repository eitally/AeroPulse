import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter';
import {
  buildFitStepsFromWorkoutSyntax,
  encodeGarminFitWorkout,
} from '../src/utils/fitWorkoutEncoder';
import {
  parseStructuredTrackWorkout,
  parseWorkoutSteps,
} from '../src/utils/workoutParser';

const FIT_CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function computeFitCrc(bytes: Uint8Array, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0x0f];
    tmp = FIT_CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0x0f];
  }
  return crc & 0xffff;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

describe('TRK-04: Track Workout Parser v2 + Binary .FIT Distance/Speed/Repeat Encoder', () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(apiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('parses Main Set Nx repeat blocks, inline Nx repeats, meter distances, sub-minute durations, and @ pace targets without breaking legacy minute syntax', () => {
    const multiLineTrack = [
      '- 15m 68% Pace Warmup',
      'Main Set 8x',
      '- 400m @ 60.5s R',
      '- 90s 58% Pace Jog',
      '- 10m 65% Pace Cooldown',
    ].join('\n');

    const ast = parseStructuredTrackWorkout(multiLineTrack, 200);
    expect(ast).toHaveLength(3);
    expect(ast[0].type).toBe('step');
    expect(ast[1].type).toBe('repeat');
    if (ast[1].type === 'repeat') {
      expect(ast[1].repeatCount).toBe(8);
      expect(ast[1].steps).toHaveLength(2);
      expect(ast[1].steps[0].distanceMeters).toBe(400);
      expect(ast[1].steps[0].durationSecs).toBeCloseTo(60.5, 1);
      expect(ast[1].steps[0].targetPaceSecsPerKm).toBeCloseTo(151.3, 1);
      expect(ast[1].steps[0].stepKind).toBe('work');
      expect(ast[1].steps[1].durationSecs).toBe(90);
      expect(ast[1].steps[1].stepKind).toBe('rest');
    }

    // Unrolled steps for UI effort stripes preserve 1 + 8*2 + 1 = 18 steps
    const unrolled = parseWorkoutSteps(multiLineTrack, 200);
    expect(unrolled).toHaveLength(18);
    expect(unrolled[1].repeatTotal).toBe(8);
    expect(unrolled[1].repeatIndex).toBe(1);

    // Inline syntax "- 6x800m @ 2:24 (2m rest)"
    const inlineAst = parseStructuredTrackWorkout('- 6x800m @ 2:24 (2m rest)', 225);
    expect(inlineAst).toHaveLength(1);
    expect(inlineAst[0].type).toBe('repeat');
    if (inlineAst[0].type === 'repeat') {
      expect(inlineAst[0].repeatCount).toBe(6);
      expect(inlineAst[0].steps[0].distanceMeters).toBe(800);
      expect(inlineAst[0].steps[0].durationSecs).toBe(144);
      expect(inlineAst[0].steps[0].targetPaceSecsPerKm).toBe(180);
      expect(inlineAst[0].steps[1].durationSecs).toBe(120);
      expect(inlineAst[0].steps[1].stepKind).toBe('rest');
    }

    // Legacy minute-based cycling/running syntax stays unchanged (15m = 15 mins, not 15m!)
    const legacy = parseWorkoutSteps(
      '- 15m 60% FTP Warmup\n- 8m 90% FTP Sweet Spot\n- 10m 55% FTP Cooldown'
    );
    expect(legacy).toHaveLength(3);
    expect(legacy[0].distanceMeters).toBeUndefined();
    expect(legacy[0].durationMins).toBe(15);
    expect(legacy[0].durationSecs).toBe(900);
    expect(legacy[1].durationMins).toBe(8);
  });

  it('encodes binary Garmin .FIT with distance (cm), speed (mm/s), repeat_until_steps_cmplt loops, and valid CRC16', () => {
    const syntax = [
      '- 12m 68% Pace Warmup',
      'Main Set 8x',
      '- 400m @ 60.5s R',
      '- 90s 58% Pace Jog',
      '- 10m 65% Pace Cooldown',
    ].join('\n');

    const fitSteps = buildFitStepsFromWorkoutSyntax(syntax, {
      sport: 'Running',
      thresholdPaceSecsPerKm: 195,
    });
    expect(fitSteps).toHaveLength(5); // Warmup, 400m work, 90s rest, Repeat(8x @ idx 1), Cooldown

    const bytes = encodeGarminFitWorkout({
      name: '8x400m @ 60.5s',
      sport: 'Running',
      steps: fitSteps,
    });

    // Header magic ".FIT" & file CRC
    expect(bytes[0]).toBe(14);
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('.FIT');
    const expectedCrc = computeFitCrc(bytes, bytes.length - 2);
    const actualCrc = readUint16LE(bytes, bytes.length - 2);
    expect(actualCrc).toBe(expectedCrc);

    // Step 1 (index 1 = 400m @ 60.5s -> 6.612 m/s = ~6612 mm/s, distance = 40000 cm)
    const step0Offset = 118;
    const stepRecLen = 38;
    const workStepOffset = step0Offset + 1 * stepRecLen;
    expect(readUint16LE(bytes, workStepOffset + 1)).toBe(1); // message_index = 1
    expect(bytes[workStepOffset + 19]).toBe(1); // duration_type = 1 (distance)
    expect(readUint32LE(bytes, workStepOffset + 20)).toBe(40000); // 400.00 m in cm
    expect(bytes[workStepOffset + 24]).toBe(0); // target_type = 0 (speed)
    const speedLowMmS = readUint32LE(bytes, workStepOffset + 29);
    const speedHighMmS = readUint32LE(bytes, workStepOffset + 33);
    expect(speedLowMmS).toBeGreaterThan(6200);
    expect(speedLowMmS).toBeLessThan(6550);
    expect(speedHighMmS).toBeGreaterThan(6680);
    expect(speedHighMmS).toBeLessThan(7000);

    // Step 3 (index 3 = repeat_until_steps_cmplt pointing to index 1 for 8 iterations)
    const repeatStepOffset = step0Offset + 3 * stepRecLen;
    expect(bytes[repeatStepOffset + 19]).toBe(6); // duration_type = 6 (repeat_until_steps_cmplt)
    expect(readUint32LE(bytes, repeatStepOffset + 20)).toBe(1); // loop back to message_index 1
    expect(bytes[repeatStepOffset + 24]).toBe(2); // target_type = 2 (open)
    expect(readUint32LE(bytes, repeatStepOffset + 25)).toBe(8); // repeatCount = 8
  });

  it('POST /api/workouts/export supports structured track workoutSyntax and emits fitWorkoutBase64, intervalsIcuText, Apple distance blocks, and Garmin RepeatGroupDTO', async () => {
    const res = await fetch(`${baseUrl}/api/workouts/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '8x400m Mile R-Pace',
        sportCategory: 'Running',
        thresholdPaceSecsPerKm: 192,
        workoutSyntax:
          '- 15m 68% Pace Warmup\nMain Set 8x\n- 400m @ 60.5s (126% Pace) R\n- 90s 58% Pace Jog\n- 10m 65% Pace Cooldown',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(typeof json.fitWorkoutBase64).toBe('string');
    const decoded = Buffer.from(json.fitWorkoutBase64, 'base64');
    expect(decoded.slice(8, 12).toString('ascii')).toBe('.FIT');

    expect(json.intervalsIcuText).toContain('400m');
    expect(json.appleWorkoutKitJson.blocks[1].goal).toEqual({
      type: 'distance',
      meters: 400,
    });
    expect(json.garminTrainingApiJson.workoutSegments[0].workoutSteps[1]).toMatchObject({
      type: 'RepeatGroupDTO',
      numberOfIterations: 8,
    });
  });
});
