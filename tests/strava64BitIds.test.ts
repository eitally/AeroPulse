import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractStravaId,
  parseStravaJson64Safe,
  readStravaResponseJson,
} from '../server/stravaIdUtils.ts';
import { normalizeRawStravaActivity } from '../server/stravaSyncService.ts';
import app from '../server/vercelApp.ts';

describe('Strava 64-bit Activity & Athlete ID (id_str) compatibility', () => {
  let server: http.Server | null = null;
  const origEnv = {
    INTERVALS_API_KEY: process.env.INTERVALS_API_KEY,
    VITE_INTERVALS_API_KEY: process.env.VITE_INTERVALS_API_KEY,
    STRAVA_ACCESS_TOKEN: process.env.STRAVA_ACCESS_TOKEN,
    STRAVA_REFRESH_TOKEN: process.env.STRAVA_REFRESH_TOKEN,
  };

  afterEach(async () => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('prefers id_str over float-rounded numeric id and handles legacy 32/53-bit numeric IDs', () => {
    const entityWith64BitId = {
      id: 9123456789012346000, // IEEE-754 float-rounded approximation of 9123456789012345678
      id_str: '9123456789012345678',
    };
    expect(extractStravaId(entityWith64BitId)).toBe('9123456789012345678');

    const legacyEntity = { id: 12345678901 };
    expect(extractStravaId(legacyEntity)).toBe('12345678901');

    const webhookPayload = {
      object_id: 9123456789012346000,
      object_id_str: '9123456789012345678',
      owner_id: 9223372036854776000,
      owner_id_str: '9223372036854775801',
    };
    expect(extractStravaId(webhookPayload, 'object_id_str', 'object_id')).toBe(
      '9123456789012345678'
    );
    expect(extractStravaId(webhookPayload, 'owner_id_str', 'owner_id')).toBe(
      '9223372036854775801'
    );
    expect(extractStravaId(null)).toBe('');
  });

  it('parseStravaJson64Safe preserves unquoted 64-bit JSON integers without rounding normal floats', () => {
    const rawJson = `{
      "id": 9123456789012345678,
      "athlete": { "id": 9223372036854775801 },
      "average_watts": 285.4,
      "moving_time": 3600
    }`;

    const parsed = parseStravaJson64Safe<{
      id: string;
      athlete: { id: string };
      average_watts: number;
      moving_time: number;
    }>(rawJson);

    expect(parsed.id).toBe('9123456789012345678');
    expect(parsed.athlete.id).toBe('9223372036854775801');
    expect(parsed.average_watts).toBe(285.4);
    expect(parsed.moving_time).toBe(3600);
  });

  it('readStravaResponseJson + normalizeRawStravaActivity retain exact 64-bit activity, effort & segment IDs', async () => {
    const rawActivityJson = JSON.stringify({
      name: 'Threshold Oval Repeats',
      sport_type: 'Run',
      type: 'Run',
      start_date_local: '2027-06-05T07:00:00Z',
      moving_time: 1800,
      elapsed_time: 1850,
      distance: 5000,
      total_elevation_gain: 12,
      average_heartrate: 171,
      max_heartrate: 184,
      id_str: '9123456789012345678',
      id: 9123456789012346000,
      athlete: {
        id_str: '9223372036854775801',
        id: 9223372036854776000,
      },
      segment_efforts: [
        {
          id_str: '9111111111111111119',
          id: 9111111111111112000,
          name: 'Bayshore 1km',
          distance: 1000,
          elapsed_time: 215,
          moving_time: 215,
          start_date_local: '2027-06-05T07:10:00Z',
          segment: {
            id_str: '9333333333333333337',
            id: 9333333333333334000,
            name: 'Bayshore 1km',
            average_grade: 0.2,
          },
        },
      ],
    });

    const resp = new Response(rawActivityJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const parsedActivity = await readStravaResponseJson<Record<string, any>>(resp);
    expect(extractStravaId(parsedActivity.athlete)).toBe('9223372036854775801');

    const normalized = normalizeRawStravaActivity(parsedActivity, {
      calibratedFtp: 280,
      calibratedBikeLthr: 168,
      calibratedRunLthr: 175,
      calibratedThresholdPaceSecsPerKm: 235,
      restingHr: 48,
    });

    expect(normalized.stravaId).toBe('9123456789012345678');
    expect(normalized.segmentEfforts).toHaveLength(1);
    expect(normalized.segmentEfforts[0].id).toBe('9111111111111111119');
    expect(normalized.segmentEfforts[0].segmentId).toBe('9333333333333333337');
    expect(normalized.segmentEfforts[0].activityId).toBe('9123456789012345678');
  });

  it('Express /api/webhooks/strava preserves 64-bit object_id and owner_id without IEEE-754 rounding', async () => {
    delete process.env.INTERVALS_API_KEY;
    delete process.env.VITE_INTERVALS_API_KEY;
    delete process.env.STRAVA_ACCESS_TOKEN;
    delete process.env.STRAVA_REFRESH_TOKEN;

    server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test HTTP server');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Raw JSON without id_str to verify the Express JSON reviver itself rescues >53-bit integers
    const rawWebhookBody = `{
      "aspect_type": "create",
      "object_type": "activity",
      "object_id": 9123456789012345678,
      "owner_id": 9223372036854775801
    }`;

    const webhookResp = await fetch(`${baseUrl}/api/webhooks/strava`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawWebhookBody,
    });
    expect(webhookResp.status).toBe(200);
    const payload = (await webhookResp.json()) as {
      ok: boolean;
      objectId?: string;
      ownerId?: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.objectId).toBe('9123456789012345678');
    expect(payload.ownerId).toBe('9223372036854775801');
  });
});
