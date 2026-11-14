import http from 'http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouter, resetAiRateLimitsForTesting } from '../server/apiRouter';
import { issueSessionToken, SESSION_COOKIE_NAME } from '../server/securityUtils';

describe('SEC-03 · AI Endpoints Session Gate & Rate Limiting', () => {
  const envBackup: Record<string, string | undefined> = {};
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    resetAiRateLimitsForTesting();
    for (const k of ['GEMINI_API_KEY', 'SESSION_SECRET', 'TOKEN_VAULT_KEY', 'ALLOW_DEV_ENV_CREDENTIALS']) {
      envBackup[k] = process.env[k];
    }
    process.env.GEMINI_API_KEY = 'AIza_test_server_gemini_key_12345';
    process.env.SESSION_SECRET = 'thresh_test_session_secret_0123456789abcdef0123456789abcdef';
    process.env.TOKEN_VAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    delete process.env.ALLOW_DEV_ENV_CREDENTIALS;

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

  it('fails to use server key when caller has arbitrary header and no verified session', async () => {
    const res = await fetch(`${baseUrl}/api/coach/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-intervals-api-key': 'attacker_supplied_junk',
      },
      body: JSON.stringify({ durationMinutes: 45 }),
    });
    const data = await res.json();
    // Must fall back to local physiology engine and NOT attempt server Gemini
    expect(data.engine).toBe('LOCAL_PHYSIOLOGY_ENGINE');
  });

  it('allows AI endpoint with server key when caller has a verified session token', async () => {
    const validToken = issueSessionToken('123456', 'session_sid_valid_123');
    const res = await fetch(`${baseUrl}/api/coach/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `${SESSION_COOKIE_NAME}=${validToken}`,
      },
      body: JSON.stringify({ durationMinutes: 45 }),
    });
    // Even if Gemini network call fails in unit test with dummy key, it was authorized to try
    expect(res.status).toBe(200);
  });

  it('allows AI endpoint when caller provides their own BYO Gemini key in header', async () => {
    const res = await fetch(`${baseUrl}/api/coach/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': 'AIza_client_byo_key_99999',
      },
      body: JSON.stringify({ durationMinutes: 45 }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects /api/coach/chat with 401 when caller has no verified session and no BYO key', async () => {
    const res = await fetch(`${baseUrl}/api/coach/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-strava-access-token': 'fake_token_attacker',
      },
      body: JSON.stringify({ message: 'Give me a workout' }),
    });
    expect(res.status).toBe(401);
  });

  it('enforces rate limits (429) when AI requests exceed quota threshold', async () => {
    const validToken = issueSessionToken('athlete_rate_limit_test', 'session_rate_limit_123');
    const headers = {
      'Content-Type': 'application/json',
      'Cookie': `${SESSION_COOKIE_NAME}=${validToken}`,
    };
    let got429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/coach/options`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ durationMinutes: 30 }),
      });
      if (res.status === 429) {
        got429 = true;
        const errJson = await res.json();
        expect(errJson.error).toContain('limit reached');
        expect(typeof errJson.retryAfterSecs).toBe('number');
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
