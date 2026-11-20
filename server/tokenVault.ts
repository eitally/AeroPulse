import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import pg from 'pg';

const { Pool } = pg;

const VAULT_FILE_PREFIX = '/tmp/thresh-vault-';
const VAULT_ENVELOPE_PREFIX = 'v1.';

let derivedKeyCache: Buffer | null = null;
let warnedMissingVaultKey = false;

/**
 * Emits non-secret fallback diagnostics outside test runs without ever logging
 * tokens, keys, PII, or serialized payloads.
 */
export function warnServerFallback(scope: string, err: unknown): void {
  if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
    return;
  }
  const msg = err instanceof Error ? err.message : 'unknown error';
  console.warn(`[thresh:${scope}] ${msg}`);
}

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

export function buildPostgresSslConfig(
  dbUrl: string,
  env: NodeJS.ProcessEnv = process.env
): { rejectUnauthorized: boolean } | undefined {
  const clean = String(dbUrl || '').trim().toLowerCase();
  if (!clean || clean.includes('localhost') || clean.includes('127.0.0.1')) {
    return undefined;
  }
  return {
    rejectUnauthorized: env.PG_SSL_ALLOW_SELF_SIGNED === 'true' ? false : true,
  };
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
      ssl: buildPostgresSslConfig(dbUrl),
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
        CREATE TABLE IF NOT EXISTS thresh_teams (
          team_id TEXT PRIMARY KEY,
          slug TEXT,
          join_code TEXT,
          org_type TEXT,
          encrypted_doc TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS thresh_team_members (
          team_id TEXT NOT NULL,
          membership_id TEXT NOT NULL,
          user_sid TEXT,
          invited_email TEXT,
          role TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (team_id, membership_id)
        );
        CREATE INDEX IF NOT EXISTS idx_thresh_team_members_sid
          ON thresh_team_members (user_sid);
        CREATE INDEX IF NOT EXISTS idx_thresh_team_members_email
          ON thresh_team_members (invited_email);
        CREATE TABLE IF NOT EXISTS thresh_audit_log (
          id BIGSERIAL PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          team_id TEXT,
          actor_sid TEXT,
          action TEXT NOT NULL,
          target_id TEXT,
          metadata_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_thresh_audit_log_team_created
          ON thresh_audit_log (team_id, created_at DESC);
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
const MAX_MEMORY_VAULT_ENTRIES = 500;
const MEMORY_VAULT_TTL_MS = 5 * 60 * 1000;
const memoryVaultCache = new Map<string, { value: unknown; updatedAtMs: number }>();

function setBoundedMemoryVaultEntry(safeId: string, value: unknown): void {
  const now = Date.now();
  if (memoryVaultCache.has(safeId)) {
    memoryVaultCache.delete(safeId);
  } else if (memoryVaultCache.size >= MAX_MEMORY_VAULT_ENTRIES) {
    for (const [k, entry] of memoryVaultCache.entries()) {
      if (now - entry.updatedAtMs >= MEMORY_VAULT_TTL_MS) {
        memoryVaultCache.delete(k);
      }
    }
    while (memoryVaultCache.size >= MAX_MEMORY_VAULT_ENTRIES) {
      const oldestKey = memoryVaultCache.keys().next().value;
      if (oldestKey === undefined) break;
      memoryVaultCache.delete(oldestKey);
    }
  }
  memoryVaultCache.set(safeId, { value, updatedAtMs: now });
}

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
  if (cached && Date.now() - cached.updatedAtMs < MEMORY_VAULT_TTL_MS) {
    // Refresh LRU order on hot read
    memoryVaultCache.delete(safeId);
    memoryVaultCache.set(safeId, cached);
    return structuredClone(cached.value) as T;
  }
  if (cached) {
    memoryVaultCache.delete(safeId);
  }

  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs.existsSync(encPath)) {
      const envelope = fs.readFileSync(encPath, 'utf8').trim();
      const decrypted = decryptJsonFromVault<T>(envelope);
      if (decrypted !== null) {
        setBoundedMemoryVaultEntry(safeId, decrypted);
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
  setBoundedMemoryVaultEntry(safeId, structuredClone(data));
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
      } catch (err: unknown) {
        warnServerFallback('vault:bg-postgres-upsert', err);
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
          setBoundedMemoryVaultEntry(safeId, decrypted);
          try {
            fs.writeFileSync(getEncryptedVaultFilePath(safeId), result.rows[0].encrypted_envelope, {
              encoding: 'utf8',
              mode: 0o600,
            });
          } catch {
            // ignore ephemeral FS cache mirror failure
          }
          return structuredClone(decrypted);
        }
      }
    } catch (err: unknown) {
      warnServerFallback('vault:postgres-read-fallback', err);
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
  setBoundedMemoryVaultEntry(safeId, structuredClone(data));
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
    } catch (err: unknown) {
      warnServerFallback('vault:postgres-upsert', err);
    }
  }
}

export const VAULT_COOKIE_NAME = 'thresh_vault';
export const USER_VAULT_COOKIE_NAME = 'thresh_user';
const VAULT_COOKIE_TTL_SECS = 365 * 24 * 60 * 60; // 365 days (sliding across deploys)

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
  intervalsAccessToken?: string;
  intervalsScope?: string;
  intervalsTokenType?: string;
  intervalsAthleteId?: string;
  intervalsAthleteName?: string;
  wahooAccessToken?: string;
  wahooRefreshToken?: string;
  wahooExpiresAt?: number;
  wahooScope?: string;
  wahooUserId?: string;
  wahooAthleteName?: string;
  polarAccessToken?: string;
  polarUserId?: string;
  polarAthleteName?: string;
  polarExpiresAt?: number;
  polarScope?: string;
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
 * Encrypts a compact ThreshUser identity record (< 3.5KB) into an HttpOnly AES-256-GCM
 * cookie so Google/Magic-Link/Passkey sessions survive Vercel cold starts without DATABASE_URL.
 */
export function buildEncryptedUserCookieHeader(
  userPayload: unknown,
  isSecure: boolean
): string | null {
  const envelope = encryptJsonForVault(userPayload);
  const encoded = encodeURIComponent(envelope);
  if (encoded.length > 3700) {
    return null;
  }
  const parts = [
    `${USER_VAULT_COOKIE_NAME}=${encoded}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VAULT_COOKIE_TTL_SECS}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearUserCookieHeader(): string {
  return `${USER_VAULT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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
  } catch (err: unknown) {
    warnServerFallback('vault:local-unlink', err);
  }
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      await pool.query('DELETE FROM thresh_tenant_vault WHERE tenant_id = $1', [safeId]);
    } catch (err: unknown) {
      warnServerFallback('vault:postgres-delete', err);
    }
  }
}

const vaultOperationQueues = new Map<string, Promise<unknown>>();

/**
 * Serializes concurrent read-modify-write mutations per tenant vault key inside
 * a single Node/Serverless runtime so simultaneous roster QR claims or snapshot syncs
 * cannot clobber each other.
 */
export async function withVaultLock<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  const safeId = sanitizeTenantId(tenantId);
  const prev = vaultOperationQueues.get(safeId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(() => fn());
  vaultOperationQueues.set(safeId, next);
  try {
    return await next;
  } finally {
    if (vaultOperationQueues.get(safeId) === next) {
      vaultOperationQueues.delete(safeId);
    }
  }
}

export interface NormalizedTeamMemberSyncInput {
  membershipId: string;
  userSid?: string;
  invitedEmail?: string;
  role: string;
  status: string;
}

/**
 * Mirrors encrypted team metadata & membership rows into normalized Postgres tables when
 * `DATABASE_URL` is configured, enabling indexed lookups and database-level row locking.
 */
export async function syncNormalizedTeamPostgresAsync(
  teamId: string,
  metadata: { slug?: string; joinCode?: string; orgType?: string },
  docPayload: unknown,
  members: NormalizedTeamMemberSyncInput[]
): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  const safeTeamId = sanitizeTenantId(teamId);
  const envelope = encryptJsonForVault(docPayload);
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    await ensurePostgresVaultSchema(pool);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO thresh_teams (team_id, slug, join_code, org_type, encrypted_doc, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (team_id)
       DO UPDATE SET
         slug = EXCLUDED.slug,
         join_code = EXCLUDED.join_code,
         org_type = EXCLUDED.org_type,
         encrypted_doc = EXCLUDED.encrypted_doc,
         updated_at = NOW();`,
      [
        safeTeamId,
        metadata.slug ? String(metadata.slug).slice(0, 80) : null,
        metadata.joinCode ? String(metadata.joinCode).slice(0, 32) : null,
        metadata.orgType ? String(metadata.orgType).slice(0, 32) : null,
        envelope,
      ]
    );
    await client.query('DELETE FROM thresh_team_members WHERE team_id = $1', [safeTeamId]);
    for (const m of members) {
      await client.query(
        `INSERT INTO thresh_team_members (team_id, membership_id, user_sid, invited_email, role, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          safeTeamId,
          String(m.membershipId).slice(0, 64),
          m.userSid ? String(m.userSid).slice(0, 96) : null,
          m.invitedEmail ? String(m.invitedEmail).trim().toLowerCase().slice(0, 160) : null,
          String(m.role || 'ATHLETE').slice(0, 32),
          String(m.status || 'INVITED').slice(0, 32),
        ]
      );
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
}

/**
 * Serializes team document mutations with both per-runtime mutex and Postgres advisory/row locking
 * when `DATABASE_URL` is configured, preventing cross-Lambda concurrent QR claim races.
 */
export async function withTeamRowLock<T>(
  teamId: string,
  fn: () => Promise<T>
): Promise<T> {
  const safeTeamId = sanitizeTenantId(teamId);
  const lockKey = `team_doc_${safeTeamId.slice(0, 40)}`;
  return withVaultLock(lockKey, async () => {
    const pool = getPostgresPool();
    if (!pool) return fn();
    const client = await pool.connect().catch(() => null);
    if (!client) return fn();
    try {
      await ensurePostgresVaultSchema(pool);
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [safeTeamId]);
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}

export interface PersistedAuditLogEntry {
  eventId: string;
  createdAt: string;
  teamId: string;
  actorSid: string;
  action: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

const MAX_LOCAL_AUDIT_ENTRIES = 500;

function auditVaultKey(teamId: string): string {
  return `audit_log_${sanitizeTenantId(teamId).slice(0, 40)}`;
}

/**
 * Appends an immutable governance/safeguarding audit record to encrypted tenant storage and Postgres
 * `thresh_audit_log` (when configured).
 */
export async function appendAuditLogAsync(params: {
  teamId: string;
  actorSid: string;
  action: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<PersistedAuditLogEntry> {
  const entry: PersistedAuditLogEntry = {
    eventId: `aud_${crypto.randomBytes(8).toString('hex')}`,
    createdAt: new Date().toISOString(),
    teamId: sanitizeTenantId(params.teamId),
    actorSid: String(params.actorSid || 'system').slice(0, 96),
    action: String(params.action || 'UNKNOWN').slice(0, 64),
    ...(params.targetId ? { targetId: String(params.targetId).slice(0, 96) } : {}),
    metadata: params.metadata || {},
  };

  const key = auditVaultKey(entry.teamId);
  await withVaultLock(key, async () => {
    const existing = await loadTenantVaultAsync<PersistedAuditLogEntry[]>(key, []);
    const next = [...existing, entry].slice(-MAX_LOCAL_AUDIT_ENTRIES);
    await saveTenantVaultAsync(key, next);
  });

  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      await pool.query(
        `INSERT INTO thresh_audit_log (event_id, created_at, team_id, actor_sid, action, target_id, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          entry.eventId,
          entry.createdAt,
          entry.teamId,
          entry.actorSid,
          entry.action,
          entry.targetId || null,
          JSON.stringify(entry.metadata),
        ]
      );
    } catch (err: unknown) {
      warnServerFallback('audit:postgres-insert', err);
    }
  }

  return entry;
}

export async function listTeamAuditLogAsync(
  teamId: string,
  limit = 100
): Promise<PersistedAuditLogEntry[]> {
  const safeTeamId = sanitizeTenantId(teamId);
  const clampedLimit = Math.max(1, Math.min(250, Math.round(limit)));
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      const res = await pool.query<{
        event_id: string;
        created_at: Date | string;
        team_id: string;
        actor_sid: string;
        action: string;
        target_id: string | null;
        metadata_json: string;
      }>(
        `SELECT event_id, created_at, team_id, actor_sid, action, target_id, metadata_json
         FROM thresh_audit_log
         WHERE team_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [safeTeamId, clampedLimit]
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          eventId: r.event_id,
          createdAt:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          teamId: r.team_id,
          actorSid: r.actor_sid,
          action: r.action,
          ...(r.target_id ? { targetId: r.target_id } : {}),
          metadata: (() => {
            try {
              return JSON.parse(r.metadata_json) as Record<string, unknown>;
            } catch {
              return {};
            }
          })(),
        }));
      }
    } catch (err: unknown) {
      warnServerFallback('audit:postgres-list-fallback', err);
    }
  }

  const local = await loadTenantVaultAsync<PersistedAuditLogEntry[]>(auditVaultKey(safeTeamId), []);
  return [...local].reverse().slice(0, clampedLimit);
}
