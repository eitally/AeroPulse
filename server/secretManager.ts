import type { Request } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
} from './securityUtils.ts';
import {
  requestContext,
  resolveSessionScopeKey,
  readCompactVaultFromCookie,
} from './sessionContext.ts';

/**
 * SEC-01: Server-owned secrets (platform Strava app secret, platform AI/map keys, vault keys)
 * may be *used* server-side but must never be serialized back to any client or cached into
 * a per-athlete session store. Values are compared after the same quote/whitespace
 * normalization used when reading them.
 */
export const SERVER_OWNED_SECRET_ENV_KEYS = [
  'STRAVA_CLIENT_SECRET',
  'STRAVA_REFRESH_TOKEN',
  'STRAVA_ACCESS_TOKEN',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'VITE_GEMINI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'NEXT_PUBLIC_GEMINI_API_KEY',
  'API_KEY',
  'MAPBOX_ACCESS_TOKEN',
  'VITE_MAPBOX_ACCESS_TOKEN',
  'THUNDERFOREST_API_KEY',
  'INTERVALS_API_KEY',
  'GARMIN_PERSONAL_API_KEY',
  'SESSION_SECRET',
  'TOKEN_VAULT_KEY',
] as const;

export function normalizeSecretValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

export function isServerOwnedSecret(value: unknown): boolean {
  const clean = normalizeSecretValue(value);
  if (!clean) return false;
  return SERVER_OWNED_SECRET_ENV_KEYS.some(
    (key) => normalizeSecretValue(process.env[key]) === clean
  );
}

/** Returns the value only when it was supplied by the user (never a server env secret). */
export function userOwnedSecretOnly(value: unknown): string {
  const clean = normalizeSecretValue(value);
  return clean && !isServerOwnedSecret(clean) ? clean : '';
}

/**
 * Returns true if request caller provided their own explicit Gemini API key via
 * request header ('x-gemini-api-key') or request body ('geminiApiKey').
 */
export function hasClientByoGeminiKey(req?: Request): boolean {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  const headerKey = (activeReq.headers['x-gemini-api-key'] as string | undefined)?.trim();
  const bodyKey =
    typeof activeReq.body?.geminiApiKey === 'string' ? activeReq.body.geminiApiKey.trim() : '';
  for (const c of [headerKey, bodyKey]) {
    const clean = (c || '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (clean && clean !== 'MY_GEMINI_API_KEY' && clean !== 'YOUR_GEMINI_API_KEY') {
      return true;
    }
  }
  return false;
}

/**
 * Verifies that the caller has a legitimate authenticated session (valid HMAC session cookie,
 * valid session claims, or valid decrypted tenant vault cookie) authorized to consume
 * server-side Gemini quota.
 */
export function isAuthorizedForServerAi(req?: Request): boolean {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  const claims = getVerifiedSessionClaims(activeReq);
  if (
    isCanonicalAuthenticatedClaims(claims) ||
    Boolean(readCompactVaultFromCookie(activeReq)?.sid)
  ) {
    return true;
  }
  if (process.env.ALLOW_DEV_ENV_CREDENTIALS === 'true') {
    return true;
  }
  return false;
}

/**
 * Returns true if the request is authorized for AI invocation: either via a client-supplied
 * BYO key (consuming the user's own quota) or via a verified authenticated session.
 */
export function isAuthorizedForAi(req?: Request): boolean {
  return hasClientByoGeminiKey(req) || isAuthorizedForServerAi(req);
}

// In-memory sliding-window rate limiter per session / IP for AI endpoints
interface AiRateLimitRecord {
  count: number;
  resetAt: number;
}
const aiRateLimitStore = new Map<string, AiRateLimitRecord>();

export function checkAiRateLimit(
  key: string,
  limit = 20,
  windowMs = 60_000
): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  if (aiRateLimitStore.size > 2000) {
    for (const [k, rec] of aiRateLimitStore.entries()) {
      if (rec.resetAt <= now) {
        aiRateLimitStore.delete(k);
      }
    }
  }
  const record = aiRateLimitStore.get(key);
  if (!record || record.resetAt <= now) {
    aiRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSecs: 0 };
  }
  if (record.count >= limit) {
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
    };
  }
  record.count += 1;
  return { allowed: true, retryAfterSecs: 0 };
}

export function getClientAiRateLimitKey(req: Request): string {
  const scopeKey = resolveSessionScopeKey(req);
  if (scopeKey && scopeKey !== 'unauthenticated') {
    return `session:${scopeKey}`;
  }
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  return `ip:${ip}`;
}

export function resetAiRateLimitsForTesting(): void {
  aiRateLimitStore.clear();
}
