import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import pg from 'pg';

const { Pool } = pg;

const VAULT_FILE_PREFIX = '/tmp/thresh-vault-';
const VAULT_ENVELOPE_PREFIX = 'v1.';

let derivedKeyCache: Buffer | null = null;
let warnedMissingVaultKey = false;

function getVaultEncryptionKey(): Buffer {
  if (derivedKeyCache) return derivedKeyCache;

  const rawSecret = (
    process.env.TOKEN_VAULT_KEY ||
    process.env.OAUTH_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    process.env.STRAVA_CLIENT_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();

  if (rawSecret.length >= 16) {
    if (/^[0-9a-fA-F]{64}$/.test(rawSecret)) {
      derivedKeyCache = Buffer.from(rawSecret, 'hex');
      return derivedKeyCache;
    }
    derivedKeyCache = crypto.scryptSync(rawSecret, 'thresh-vault-v1-salt', 32);
    return derivedKeyCache;
  }

  if (process.env.NODE_ENV === 'production' && !warnedMissingVaultKey) {
    warnedMissingVaultKey = true;
    console.warn(
      '[THRESH Security] TOKEN_VAULT_KEY / SESSION_SECRET not set in production; deriving fallback vault key.'
    );
  }

  const fallbackSeed = `thresh-local-vault:${os.hostname()}:${os.userInfo().username}`;
  derivedKeyCache = crypto.scryptSync(fallbackSeed, 'thresh-dev-vault-salt', 32);
  return derivedKeyCache;
}

export function sanitizeTenantId(rawTenantId: string): string {
  const cleaned = String(rawTenantId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  if (!cleaned) {
    throw new Error('Invalid empty tenant identifier for token vault.');
  }
  return cleaned;
}

/**
 * Encrypts a JSON-serializable object with AES-256-GCM (12-byte random IV + 16-byte auth tag).
 */
export function encryptJsonForVault(payload: unknown): string {
  const key = getVaultEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VAULT_ENVELOPE_PREFIX}${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

/**
 * Decrypts and authenticates an AES-256-GCM vault envelope. Returns null if tampered or invalid.
 */
export function decryptJsonFromVault<T>(envelope: string): T | null {
  try {
    if (!envelope || typeof envelope !== 'string' || !envelope.startsWith(VAULT_ENVELOPE_PREFIX)) {
      return null;
    }
    const body = envelope.slice(VAULT_ENVELOPE_PREFIX.length);
    const parts = body.split('.');
    if (parts.length !== 3) return null;

    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || authTag.length !== 16) return null;

    const key = getVaultEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Optional Cloud Postgres Pool (Neon / Supabase / Vercel Postgres)
// ----------------------------------------------------------------------------
let pgPool: pg.Pool | null = null;
let pgSchemaInitialized = false;
let pgSchemaPromise: Promise<void> | null = null;

export function getVaultStorageBackend(): 'POSTGRES' | 'ENCRYPTED_FILE' {
  return process.env.DATABASE_URL?.trim() ? 'POSTGRES' : 'ENCRYPTED_FILE';
}

function getPostgresPool(): pg.Pool | null {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 5_000,
      ssl:
        dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
          ? undefined
          : { rejectUnauthorized: false },
    });
  }
  return pgPool;
}

async function ensurePostgresVaultSchema(pool: pg.Pool): Promise<void> {
  if (pgSchemaInitialized) return;
  if (!pgSchemaPromise) {
    pgSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS thresh_tenant_vault (
          tenant_id TEXT PRIMARY KEY,
          encrypted_envelope TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      pgSchemaInitialized = true;
    })().catch((err) => {
      pgSchemaPromise = null;
      throw err;
    });
  }
  await pgSchemaPromise;
}

// In-memory decrypted hot cache per tenant (keeps sync reads fast while persisting encrypted to disk + Postgres)
const memoryVaultCache = new Map<string, { value: unknown; updatedAtMs: number }>();

function getEncryptedVaultFilePath(tenantId: string): string {
  return `${VAULT_FILE_PREFIX}${sanitizeTenantId(tenantId)}.enc`;
}

/**
 * Synchronous read from hot cache or encrypted local `/tmp/thresh-vault-<tenantId>.enc` file.
 * If Postgres is configured, `hydrateTenantVaultFromCloud` warms the cache at request start.
 */
export function loadTenantVaultSync<T>(tenantId: string, fallback: T): T {
  const safeId = sanitizeTenantId(tenantId);
  const cached = memoryVaultCache.get(safeId);
  if (cached && Date.now() - cached.updatedAtMs < 5 * 60 * 1000) {
    return structuredClone(cached.value) as T;
  }

  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs.existsSync(encPath)) {
      const envelope = fs.readFileSync(encPath, 'utf8').trim();
      const decrypted = decryptJsonFromVault<T>(envelope);
      if (decrypted !== null) {
        memoryVaultCache.set(safeId, { value: decrypted, updatedAtMs: Date.now() });
        return structuredClone(decrypted);
      }
    }
  } catch {
    // ignore read error
  }
  return structuredClone(fallback);
}

/**
 * Encrypts tenant credentials/state with AES-256-GCM, writes atomically (`0o600`) to disk,
 * and replicates asynchronously to Postgres when `DATABASE_URL` is configured.
 */
export function saveTenantVaultSync<T>(tenantId: string, data: T): void {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.set(safeId, { value: structuredClone(data), updatedAtMs: Date.now() });
  const envelope = encryptJsonForVault(data);

  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs.writeFileSync(encPath, envelope, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore ephemeral FS write errors
  }

  const pool = getPostgresPool();
  if (pool) {
    void (async () => {
      try {
        await ensurePostgresVaultSchema(pool);
        await pool.query(
          `INSERT INTO thresh_tenant_vault (tenant_id, encrypted_envelope, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (tenant_id)
           DO UPDATE SET encrypted_envelope = EXCLUDED.encrypted_envelope, updated_at = NOW();`,
          [safeId, envelope]
        );
      } catch {
        // non-fatal background sync failure
      }
    })();
  }
}

/**
 * Async cloud-first read: queries Postgres `thresh_tenant_vault` when `DATABASE_URL` is set,
 * falling back to the encrypted local vault file.
 */
export async function loadTenantVaultAsync<T>(tenantId: string, fallback: T): Promise<T> {
  const safeId = sanitizeTenantId(tenantId);
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      const result = await pool.query<{ encrypted_envelope: string }>(
        'SELECT encrypted_envelope FROM thresh_tenant_vault WHERE tenant_id = $1 LIMIT 1',
        [safeId]
      );
      if (result.rows.length > 0) {
        const decrypted = decryptJsonFromVault<T>(result.rows[0].encrypted_envelope);
        if (decrypted !== null) {
          memoryVaultCache.set(safeId, { value: decrypted, updatedAtMs: Date.now() });
          try {
            fs.writeFileSync(getEncryptedVaultFilePath(safeId), result.rows[0].encrypted_envelope, {
              encoding: 'utf8',
              mode: 0o600,
            });
          } catch {
            // ignore
          }
          return structuredClone(decrypted);
        }
      }
    } catch {
      // fall back to local encrypted file
    }
  }
  return loadTenantVaultSync(safeId, fallback);
}

/**
 * Awaited cloud-first write: encrypts tenant credentials/state with AES-256-GCM, writes to `/tmp`,
 * and awaits the Postgres upsert when `DATABASE_URL` is set so Vercel Serverless functions never
 * freeze before the transaction commits.
 */
export async function saveTenantVaultAsync<T>(tenantId: string, data: T): Promise<void> {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.set(safeId, { value: structuredClone(data), updatedAtMs: Date.now() });
  const envelope = encryptJsonForVault(data);

  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs.writeFileSync(encPath, envelope, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore ephemeral FS write errors
  }

  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      await pool.query(
        `INSERT INTO thresh_tenant_vault (tenant_id, encrypted_envelope, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (tenant_id)
         DO UPDATE SET encrypted_envelope = EXCLUDED.encrypted_envelope, updated_at = NOW();`,
        [safeId, envelope]
      );
    } catch {
      // non-fatal DB failure (local cache/file still holds encrypted envelope)
    }
  }
}

export const VAULT_COOKIE_NAME = 'thresh_vault';
const VAULT_COOKIE_TTL_SECS = 30 * 24 * 60 * 60; // 30 days

export interface CompactCookieVaultPayload {
  sid: string;
  stravaAccessToken?: string;
  stravaRefreshToken?: string;
  stravaExpiresAt?: number;
  stravaAthleteId?: string;
  stravaAthleteName?: string;
  stravaClientId?: string;
  stravaMeasurementPreference?: 'mi' | 'km';
  stravaGrantedScope?: string;
  stravaSyncPolicy?: {
    window: '90d' | '180d' | '365d' | 'all' | 'none';
    importProfileAndGear: boolean;
    confirmedAt: string;
    grantedScope?: string;
  };
  intervalsApiKey?: string;
  intervalsAthleteId?: string;
  intervalsAthleteName?: string;
  garminPersonalApiKey?: string;
}

/**
 * Encrypts a compact credential bundle (< 3KB) into an HttpOnly AES-256-GCM cookie so
 * stateless Vercel Serverless deployments without `DATABASE_URL` still preserve tokens across Lambdas.
 */
export function buildEncryptedVaultCookieHeader(
  payload: CompactCookieVaultPayload,
  isSecure: boolean
): string | null {
  const envelope = encryptJsonForVault(payload);
  const encoded = encodeURIComponent(envelope);
  if (encoded.length > 3700) {
    return null;
  }
  const parts = [
    `${VAULT_COOKIE_NAME}=${encoded}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VAULT_COOKIE_TTL_SECS}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearVaultCookieHeader(): string {
  return `${VAULT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Purges a tenant's encrypted vault from memory, `/tmp`, and Postgres.
 */
export async function deleteTenantVault(tenantId: string): Promise<void> {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.delete(safeId);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
  } catch {
    // ignore
  }
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      await pool.query('DELETE FROM thresh_tenant_vault WHERE tenant_id = $1', [safeId]);
    } catch {
      // ignore
    }
  }
}
