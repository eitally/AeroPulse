import type { Request } from 'express';
import {
  consumeRateLimitPostgresAsync,
  getVaultStorageBackend,
  resetRateLimitsPostgresForTesting,
  warnServerFallback,
} from './tokenVault.ts';

export function getConfiguredRateLimitBackend(): 'UPSTASH_REDIS' | 'POSTGRES' | 'MEMORY' {
  const restUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const restToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (restUrl && restToken) return 'UPSTASH_REDIS';
  if (getVaultStorageBackend() === 'POSTGRES') return 'POSTGRES';
  return 'MEMORY';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSecs: number;
  remaining: number;
  backend: 'UPSTASH_REDIS' | 'POSTGRES' | 'MEMORY';
}

interface MemoryRateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryRateLimitStore = new Map<string, MemoryRateLimitRecord>();
const MAX_MEMORY_RATE_LIMIT_KEYS = 4000;

/**
 * Extracts a normalized client IP address for rate-limit scoping across Vercel/proxies.
 */
export function getClientRateLimitIp(req: Request): string {
  const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : '';
  const candidate = (firstForwarded || req.ip || req.socket?.remoteAddress || 'local').trim();
  return candidate.replace(/[^a-zA-Z0-9.:_-]/g, '').slice(0, 64) || 'local';
}

/**
 * Synchronous sliding-window counter backed by shared in-memory storage.
 */
export function checkMemoryRateLimitSync(
  key: string,
  limit = 20,
  windowMs = 60_000
): RateLimitResult {
  const cleanKey = String(key || '').trim().slice(0, 180) || 'default';
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1000, Math.floor(windowMs));
  const now = Date.now();

  if (memoryRateLimitStore.size > MAX_MEMORY_RATE_LIMIT_KEYS) {
    for (const [k, rec] of memoryRateLimitStore.entries()) {
      if (rec.resetAt <= now) {
        memoryRateLimitStore.delete(k);
      }
    }
    while (memoryRateLimitStore.size >= MAX_MEMORY_RATE_LIMIT_KEYS) {
      const oldest = memoryRateLimitStore.keys().next().value;
      if (oldest === undefined) break;
      memoryRateLimitStore.delete(oldest);
    }
  }

  const record = memoryRateLimitStore.get(cleanKey);
  if (!record || record.resetAt <= now) {
    memoryRateLimitStore.set(cleanKey, { count: 1, resetAt: now + safeWindowMs });
    return {
      allowed: true,
      retryAfterSecs: 0,
      remaining: Math.max(0, safeLimit - 1),
      backend: 'MEMORY',
    };
  }

  if (record.count >= safeLimit) {
    return {
      allowed: false,
      retryAfterSecs: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
      remaining: 0,
      backend: 'MEMORY',
    };
  }

  record.count += 1;
  return {
    allowed: true,
    retryAfterSecs: 0,
    remaining: Math.max(0, safeLimit - record.count),
    backend: 'MEMORY',
  };
}

async function tryUpstashRateLimitAsync(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const restUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const restToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!restUrl || !restToken) return null;

  const redisKey = `mr:rl:${key}`;
  try {
    const resp = await fetch(`${restUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PTTL', redisKey],
      ]),
      signal: AbortSignal.timeout(1500),
    });

    if (!resp.ok) {
      return null;
    }

    const rows = (await resp.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(rows) || rows.length < 2 || rows[0]?.error) {
      return null;
    }

    const count = Number(rows[0]?.result);
    let ttlMs = Number(rows[1]?.result);
    if (!Number.isFinite(count) || count <= 0) {
      return null;
    }

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      ttlMs = windowMs;
      await fetch(`${restUrl}/pexpire/${encodeURIComponent(redisKey)}/${windowMs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${restToken}` },
        signal: AbortSignal.timeout(1000),
      }).catch(() => undefined);
    }

    const allowed = count <= limit;
    return {
      allowed,
      retryAfterSecs: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
      remaining: Math.max(0, limit - count),
      backend: 'UPSTASH_REDIS',
    };
  } catch (err: unknown) {
    warnServerFallback('rate-limit:upstash-fallback', err);
    return null;
  }
}

/**
 * Distributed fixed/sliding-window rate limiter across serverless Lambdas:
 * 1. Upstash Redis REST (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)
 * 2. PostgreSQL (`thresh_rate_limits` via `DATABASE_URL`)
 * 3. Bounded in-memory fallback for local dev & tests
 */
export async function checkDistributedRateLimitAsync(
  key: string,
  limit = 20,
  windowMs = 60_000
): Promise<RateLimitResult> {
  const cleanKey = String(key || '').trim().slice(0, 180) || 'default';
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1000, Math.floor(windowMs));

  const upstashRes = await tryUpstashRateLimitAsync(cleanKey, safeLimit, safeWindowMs);
  if (upstashRes) {
    return upstashRes;
  }

  const pgRes = await consumeRateLimitPostgresAsync(cleanKey, safeLimit, safeWindowMs);
  if (pgRes) {
    return {
      ...pgRes,
      backend: 'POSTGRES',
    };
  }

  return checkMemoryRateLimitSync(cleanKey, safeLimit, safeWindowMs);
}

/**
 * Clears in-memory (and optional test Postgres) rate-limit counters for deterministic tests.
 */
export function resetRateLimitsForTesting(prefix?: string): void {
  if (!prefix) {
    memoryRateLimitStore.clear();
  } else {
    for (const k of memoryRateLimitStore.keys()) {
      if (k.startsWith(prefix)) {
        memoryRateLimitStore.delete(k);
      }
    }
  }
  void resetRateLimitsPostgresForTesting(prefix).catch(() => undefined);
}
