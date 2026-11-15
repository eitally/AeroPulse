import { describe, it, expect, beforeEach } from 'vitest';
import type { Request } from 'express';
import {
  normalizeSecretValue,
  isServerOwnedSecret,
  userOwnedSecretOnly,
  hasClientByoGeminiKey,
  checkAiRateLimit,
  resetAiRateLimitsForTesting,
  SERVER_OWNED_SECRET_ENV_KEYS,
} from '../server/secretManager.ts';

describe('SEC-04 · Centralized Secret Manager & AI Gate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetAiRateLimitsForTesting();
  });

  it('normalizes secret strings by trimming leading/trailing whitespace and quotes', () => {
    expect(normalizeSecretValue('  "super-secret-key"  ')).toBe('super-secret-key');
    expect(normalizeSecretValue(" 'another-key' ")).toBe('another-key');
    expect(normalizeSecretValue(null)).toBe('');
    expect(normalizeSecretValue(undefined)).toBe('');
    expect(normalizeSecretValue(12345)).toBe('12345');
  });

  it('identifies server-owned platform secrets and prevents export leaks', () => {
    process.env.STRAVA_CLIENT_SECRET = 'platform-strava-secret-999';
    process.env.GEMINI_API_KEY = 'platform-gemini-ai-key-888';

    expect(isServerOwnedSecret('platform-strava-secret-999')).toBe(true);
    expect(isServerOwnedSecret('  "platform-strava-secret-999"  ')).toBe(true);
    expect(isServerOwnedSecret('platform-gemini-ai-key-888')).toBe(true);
    expect(isServerOwnedSecret('user-custom-intervals-key')).toBe(false);

    expect(userOwnedSecretOnly('platform-strava-secret-999')).toBe('');
    expect(userOwnedSecretOnly('user-custom-intervals-key')).toBe('user-custom-intervals-key');
  });

  it('recognizes client BYO Gemini keys from header and request body', () => {
    const mockReqWithHeader = {
      headers: { 'x-gemini-api-key': 'AIzaSyByoTestKey123' },
      body: {},
    } as unknown as Request;

    expect(hasClientByoGeminiKey(mockReqWithHeader)).toBe(true);

    const mockReqWithBody = {
      headers: {},
      body: { geminiApiKey: 'AIzaSyByoTestKey456' },
    } as unknown as Request;

    expect(hasClientByoGeminiKey(mockReqWithBody)).toBe(true);

    const mockReqEmpty = {
      headers: {},
      body: {},
    } as unknown as Request;

    expect(hasClientByoGeminiKey(mockReqEmpty)).toBe(false);

    const mockReqPlaceholder = {
      headers: { 'x-gemini-api-key': 'MY_GEMINI_API_KEY' },
      body: {},
    } as unknown as Request;

    expect(hasClientByoGeminiKey(mockReqPlaceholder)).toBe(false);
  });

  it('enforces sliding-window rate limits and returns retryAfterSecs when limit is reached', () => {
    const key = 'test-client-ip-1';
    for (let i = 0; i < 5; i++) {
      const res = checkAiRateLimit(key, 5, 10_000);
      expect(res.allowed).toBe(true);
    }
    const blockedRes = checkAiRateLimit(key, 5, 10_000);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.retryAfterSecs).toBeGreaterThan(0);
    expect(blockedRes.retryAfterSecs).toBeLessThanOrEqual(10);
  });
});
