import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter';

/**
 * SEC-01 regression: `/api/config/export-bundle` must never serialize server-owned
 * secrets (process.env) back to a client — neither to a forged credential-header
 * caller nor to a legitimately authenticated athlete.
 */
const SERVER_SECRETS = {
  STRAVA_CLIENT_SECRET: 'server_strava_secret_DO_NOT_LEAK_0001',
  GEMINI_API_KEY: 'AIza_server_gemini_DO_NOT_LEAK_0002',
  MAPBOX_ACCESS_TOKEN: 'pk.server_mapbox_DO_NOT_LEAK_0003',
};

describe('SEC-01 · Connection bundle export never leaks server-owned secrets', () => {
  const envBackup: Record<string, string | undefined> = {};
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    for (const k of [
      ...Object.keys(SERVER_SECRETS),
      'STRAVA_CLIENT_ID',
      'SESSION_SECRET',
      'TOKEN_VAULT_KEY',
    ]) {
      envBackup[k] = process.env[k];
    }
    Object.assign(process.env, SERVER_SECRETS);
    process.env.STRAVA_CLIENT_ID = '144999';
    process.env.SESSION_SECRET = 'thresh_test_session_secret_0123456789abcdef0123456789abcdef';
    process.env.TOKEN_VAULT_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

  function expectNoServerSecrets(rawBody: string) {
    const decodedBundles = [...rawBody.matchAll(/"bundle":"([A-Za-z0-9+/=]+)"/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8')
    );
    for (const haystack of [rawBody, ...decodedBundles]) {
      for (const secret of Object.values(SERVER_SECRETS)) {
        expect(haystack).not.toContain(secret);
      }
    }
  }

  it('does not hand server secrets to a caller with a forged credential header', async () => {
    const resp = await fetch(`${baseUrl}/api/config/export-bundle`, {
      headers: { 'x-intervals-api-key': 'attacker-supplied-junk' },
    });
    expectNoServerSecrets(await resp.text());
  });

  it('still exports credentials the user supplied themselves', async () => {
    const resp = await fetch(`${baseUrl}/api/config/export-bundle`, {
      headers: {
        'x-intervals-api-key': 'user_intervals_key_123',
        'x-strava-client-id': '555',
        'x-strava-client-secret': 'user_byo_strava_secret',
        'x-gemini-api-key': 'AIza_user_byo_key',
        'x-map-tile-api-key': 'pk.user_byo_mapbox',
      },
    });
    const raw = await resp.text();
    expect(resp.status).toBe(200);
    expectNoServerSecrets(raw);
    const data = JSON.parse(raw);
    expect(data.credentials.intervalsApiKey).toBe('user_intervals_key_123');
    expect(data.credentials.stravaClientSecret).toBe('user_byo_strava_secret');
    expect(data.credentials.geminiApiKey).toBe('AIza_user_byo_key');
    expect(data.credentials.mapTileApiKey).toBe('pk.user_byo_mapbox');
  });

  it('does not leak server secrets after they were cached into the session store', async () => {
    const headers = { 'x-intervals-api-key': 'attacker-supplied-junk' };
    // Hit status first: historically copies env-derived keys into the per-session runtime store.
    await fetch(`${baseUrl}/api/config/status`, { headers }).catch(() => undefined);
    const resp = await fetch(`${baseUrl}/api/config/export-bundle`, { headers });
    expectNoServerSecrets(await resp.text());
  });
});
