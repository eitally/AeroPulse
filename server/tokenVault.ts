import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import pg from 'pg';
import { isProductionDeployment } from './securityUtils.ts';

const { Pool } = pg;

const VAULT_FILE_PREFIX = '/tmp/thresh-vault-';
const VAULT_ENVELOPE_PREFIX = 'v1.';

let derivedEnvKeyCache: { raw: string; key: Buffer } | null = null;
let derivedFallbackKeyCache: Buffer | null = null;
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
  const rawSecret = (
    process.env.TOKEN_VAULT_KEY ||
    process.env.OAUTH_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    process.env.STRAVA_CLIENT_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();

  if (rawSecret.length >= 16) {
    if (derivedEnvKeyCache && derivedEnvKeyCache.raw === rawSecret) {
      return derivedEnvKeyCache.key;
    }
    const key = /^[0-9a-fA-F]{64}$/.test(rawSecret)
      ? Buffer.from(rawSecret, 'hex')
      : crypto.scryptSync(rawSecret, 'thresh-vault-v1-salt', 32);
    derivedEnvKeyCache = { raw: rawSecret, key };
    return key;
  }

  if (isProductionDeployment() && !process.env.VITEST) {
    throw new Error(
      '[MeetReady Security] TOKEN_VAULT_KEY or SESSION_SECRET must be configured in production.'
    );
  }

  if (derivedFallbackKeyCache) return derivedFallbackKeyCache;

  if (process.env.NODE_ENV === 'production' && !warnedMissingVaultKey) {
    warnedMissingVaultKey = true;
    console.warn(
      '[MeetReady Security] TOKEN_VAULT_KEY / SESSION_SECRET not set in production; deriving fallback vault key.'
    );
  }

  const fallbackSeed = `thresh-local-vault:${os.hostname()}:${os.userInfo().username}`;
  derivedFallbackKeyCache = crypto.scryptSync(fallbackSeed, 'thresh-dev-vault-salt', 32);
  return derivedFallbackKeyCache;
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
let pgPoolUrl: string | null = null;
let testPgPoolOverride: pg.Pool | null = null;
let pgSchemaInitialized = false;
let pgSchemaPromise: Promise<void> | null = null;
const pgTxContext = new AsyncLocalStorage<pg.PoolClient>();

export function setPostgresPoolForTesting(pool: pg.Pool | null): void {
  testPgPoolOverride = pool;
  pgSchemaInitialized = false;
  pgSchemaPromise = null;
}

export function getVaultStorageBackend(): 'POSTGRES' | 'ENCRYPTED_FILE' {
  return process.env.DATABASE_URL?.trim() || testPgPoolOverride ? 'POSTGRES' : 'ENCRYPTED_FILE';
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
  if (testPgPoolOverride) return testPgPoolOverride;
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;
  if (pgPool && pgPoolUrl !== dbUrl) {
    const oldPool = pgPool;
    pgPool = null;
    pgPoolUrl = null;
    pgSchemaInitialized = false;
    pgSchemaPromise = null;
    void oldPool.end().catch(() => undefined);
  }
  if (!pgPool) {
    pgPoolUrl = dbUrl;
    pgPool = new Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 5_000,
      ssl: buildPostgresSslConfig(dbUrl),
    });
    pgPool.on('error', (err: Error) => {
      warnServerFallback('vault:pg-pool-error', err);
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
        CREATE INDEX IF NOT EXISTS idx_thresh_teams_slug
          ON thresh_teams (slug);
        CREATE INDEX IF NOT EXISTS idx_thresh_teams_join_code
          ON thresh_teams (join_code);
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
        CREATE TABLE IF NOT EXISTS thresh_rate_limits (
          rate_key TEXT PRIMARY KEY,
          window_start BIGINT NOT NULL,
          request_count INTEGER NOT NULL,
          expires_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_thresh_rate_limits_expires
          ON thresh_rate_limits (expires_at);
      `);
      pgSchemaInitialized = true;
    })().catch((err) => {
      pgSchemaPromise = null;
      throw err;
    });
  }
  await pgSchemaPromise;
}

export async function findTeamIdsByInvitedEmailPostgresAsync(
  email: string
): Promise<string[] | null> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return [];
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (!txClient && !pool) return null;
  try {
    if (!txClient && pool) {
      await ensurePostgresVaultSchema(pool);
    }
    const runner = txClient || pool!;
    const res = await runner.query<{ team_id: string }>(
      `SELECT DISTINCT team_id
       FROM thresh_team_members
       WHERE invited_email = $1
         AND status IN ('INVITED', 'OPENED')`,
      [cleanEmail]
    );
    return res.rows.map((r) => r.team_id);
  } catch (err: unknown) {
    warnServerFallback('vault:find-teams-by-email', err);
    return null;
  }
}

export async function checkPostgresHealthAsync(
  timeoutMs = 2000
): Promise<{ configured: boolean; healthy: boolean | null }> {
  const pool = getPostgresPool();
  if (!pool) {
    return { configured: false, healthy: null };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Postgres health check timed out')), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    return { configured: true, healthy: true };
  } catch (err: unknown) {
    warnServerFallback('vault:health-check', err);
    return { configured: true, healthy: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (txClient || pool) {
    try {
      if (!txClient && pool) {
        await ensurePostgresVaultSchema(pool);
      }
      const queryRunner = txClient || pool!;
      const result = await queryRunner.query<{ encrypted_envelope: string }>(
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
      // Confirmed Postgres miss (rows.length === 0) or undecryptable row:
      // purge memory cache + /tmp file so deleted rows are never resurrected.
      memoryVaultCache.delete(safeId);
      try {
        const encPath = getEncryptedVaultFilePath(safeId);
        if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
      } catch {
        // ignore ephemeral FS unlink failure
      }
      return structuredClone(fallback);
    } catch (err: unknown) {
      if (txClient) {
        throw err;
      }
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
  const envelope = encryptJsonForVault(data);

  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (txClient || pool) {
    try {
      if (!txClient && pool) {
        await ensurePostgresVaultSchema(pool);
      }
      const queryRunner = txClient || pool!;
      await queryRunner.query(
        `INSERT INTO thresh_tenant_vault (tenant_id, encrypted_envelope, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (tenant_id)
         DO UPDATE SET encrypted_envelope = EXCLUDED.encrypted_envelope, updated_at = NOW();`,
        [safeId, envelope]
      );
    } catch (err: unknown) {
      warnServerFallback('vault:postgres-upsert', err);
      throw err;
    }
  }

  setBoundedMemoryVaultEntry(safeId, structuredClone(data));
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs.writeFileSync(encPath, envelope, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignore ephemeral FS write errors
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
  garminOAuthAccessToken?: string;
  garminOAuthRefreshToken?: string;
  garminOAuthExpiresAt?: number;
  corosAccessToken?: string;
  corosRefreshToken?: string;
  corosExpiresAt?: number;
  corosAthleteId?: string;
  corosAthleteName?: string;
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
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (txClient || pool) {
    try {
      if (!txClient && pool) {
        await ensurePostgresVaultSchema(pool);
      }
      const queryRunner = txClient || pool!;
      await queryRunner.query('DELETE FROM thresh_tenant_vault WHERE tenant_id = $1', [safeId]);
    } catch (err: unknown) {
      warnServerFallback('vault:postgres-delete', err);
      throw err;
    }
  }
}

const vaultOperationQueues = new Map<string, Promise<unknown>>();
const activeVaultLocks = new AsyncLocalStorage<Set<string>>();

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
  const held = activeVaultLocks.getStore();
  if (held && held.has(safeId)) {
    return fn();
  }
  const prev = vaultOperationQueues.get(safeId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(() => {
    const nextHeld = new Set(held || []);
    nextHeld.add(safeId);
    return activeVaultLocks.run(nextHeld, fn);
  });
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

async function runNormalizedTeamSyncStatements(
  runner: pg.PoolClient,
  safeTeamId: string,
  metadata: { slug?: string; joinCode?: string; orgType?: string },
  envelope: string,
  members: NormalizedTeamMemberSyncInput[]
): Promise<void> {
  await runner.query(
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
  await runner.query('DELETE FROM thresh_team_members WHERE team_id = $1', [safeTeamId]);
  if (members.length > 0) {
    const teamIds: string[] = [];
    const membershipIds: string[] = [];
    const userSids: Array<string | null> = [];
    const invitedEmails: Array<string | null> = [];
    const roles: string[] = [];
    const statuses: string[] = [];

    for (const m of members) {
      teamIds.push(safeTeamId);
      membershipIds.push(String(m.membershipId).slice(0, 64));
      userSids.push(m.userSid ? String(m.userSid).slice(0, 96) : null);
      invitedEmails.push(
        m.invitedEmail ? String(m.invitedEmail).trim().toLowerCase().slice(0, 160) : null
      );
      roles.push(String(m.role || 'ATHLETE').slice(0, 32));
      statuses.push(String(m.status || 'INVITED').slice(0, 32));
    }

    await runner.query(
      `INSERT INTO thresh_team_members (team_id, membership_id, user_sid, invited_email, role, status, updated_at)
       SELECT u.team_id, u.membership_id, u.user_sid, u.invited_email, u.role, u.status, NOW()
       FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS u(team_id, membership_id, user_sid, invited_email, role, status)
       ON CONFLICT (team_id, membership_id)
       DO UPDATE SET
         user_sid = EXCLUDED.user_sid,
         invited_email = EXCLUDED.invited_email,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         updated_at = NOW();`,
      [teamIds, membershipIds, userSids, invitedEmails, roles, statuses]
    );
  }
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
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (!txClient && !pool) return;
  const safeTeamId = sanitizeTenantId(teamId);
  const envelope = encryptJsonForVault(docPayload);

  if (txClient) {
    await txClient.query('SAVEPOINT sync_norm_team');
    try {
      await runNormalizedTeamSyncStatements(txClient, safeTeamId, metadata, envelope, members);
      await txClient.query('RELEASE SAVEPOINT sync_norm_team');
    } catch (err: unknown) {
      await txClient.query('ROLLBACK TO SAVEPOINT sync_norm_team').catch(() => undefined);
      warnServerFallback('vault:sync-normalized-team', err);
      throw err;
    }
    return;
  }

  await ensurePostgresVaultSchema(pool!);
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    await runNormalizedTeamSyncStatements(client, safeTeamId, metadata, envelope, members);
    await client.query('COMMIT');
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    warnServerFallback('vault:sync-normalized-team', err);
    throw err;
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
    const existingClient = pgTxContext.getStore();
    if (existingClient) {
      await existingClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [safeTeamId]);
      return fn();
    }
    const pool = getPostgresPool();
    if (!pool) return fn();
    await ensurePostgresVaultSchema(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '4000ms'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [safeTeamId]);
      const result = await pgTxContext.run(client, fn);
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

  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (txClient || pool) {
    try {
      if (!txClient && pool) {
        await ensurePostgresVaultSchema(pool);
      }
      const queryRunner = txClient || pool!;
      await queryRunner.query(
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
      throw err;
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
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (txClient || pool) {
    try {
      if (!txClient && pool) {
        await ensurePostgresVaultSchema(pool);
      }
      const queryRunner = txClient || pool!;
      const res = await queryRunner.query<{
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
      if (txClient) throw err;
      warnServerFallback('audit:postgres-list-fallback', err);
    }
  }

  const local = await loadTenantVaultAsync<PersistedAuditLogEntry[]>(auditVaultKey(safeTeamId), []);
  return [...local].reverse().slice(0, clampedLimit);
}

/**
 * Atomic Postgres distributed rate-limit counter in `thresh_rate_limits`.
 * Returns `null` when Postgres is unconfigured or unreachable so callers can fall back cleanly.
 */
export async function consumeRateLimitPostgresAsync(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSecs: number; remaining: number } | null> {
  const cleanKey = String(key || '').trim().slice(0, 180);
  if (!cleanKey) {
    return { allowed: true, retryAfterSecs: 0, remaining: Math.max(0, limit) };
  }
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (!txClient && !pool) return null;

  try {
    if (!txClient && pool) {
      await ensurePostgresVaultSchema(pool);
    }
    const runner = txClient || pool!;
    const now = Date.now();
    const nextExpiresAt = now + Math.max(1000, Math.floor(windowMs));
    const res = await runner.query<{ request_count: number | string; expires_at: number | string }>(
      `INSERT INTO thresh_rate_limits (rate_key, window_start, request_count, expires_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (rate_key) DO UPDATE SET
         window_start = CASE
           WHEN thresh_rate_limits.expires_at <= $2 THEN $2
           ELSE thresh_rate_limits.window_start
         END,
         request_count = CASE
           WHEN thresh_rate_limits.expires_at <= $2 THEN 1
           ELSE thresh_rate_limits.request_count + 1
         END,
         expires_at = CASE
           WHEN thresh_rate_limits.expires_at <= $2 THEN $3
           ELSE thresh_rate_limits.expires_at
         END
       RETURNING request_count, expires_at`,
      [cleanKey, now, nextExpiresAt]
    );

    if (res.rows.length === 0) return null;
    const count = Number(res.rows[0].request_count);
    const expiresAt = Number(res.rows[0].expires_at);
    const allowed = count <= limit;

    if (!txClient && pool && Math.random() < 0.02) {
      void pool
        .query('DELETE FROM thresh_rate_limits WHERE expires_at <= $1', [now])
        .catch(() => undefined);
    }

    return {
      allowed,
      retryAfterSecs: allowed ? 0 : Math.max(1, Math.ceil((expiresAt - now) / 1000)),
      remaining: Math.max(0, limit - count),
    };
  } catch (err: unknown) {
    warnServerFallback('rate-limit:postgres', err);
    return null;
  }
}

export async function resetRateLimitsPostgresForTesting(prefix?: string): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  try {
    await ensurePostgresVaultSchema(pool);
    if (prefix) {
      await pool.query('DELETE FROM thresh_rate_limits WHERE rate_key LIKE $1', [
        `${prefix}%`,
      ]);
    } else {
      await pool.query('DELETE FROM thresh_rate_limits');
    }
  } catch {
    // ignore cleanup errors in tests
  }
}

/**
 * Deletes normalized Postgres rows (`thresh_team_members`, `thresh_teams`, `thresh_audit_log`)
 * for a purged or deleted team.
 */
export async function deleteTeamPostgresRowsAsync(teamId: string): Promise<void> {
  const safeTeamId = sanitizeTenantId(teamId);
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (!txClient && !pool) return;

  try {
    if (!txClient && pool) {
      await ensurePostgresVaultSchema(pool);
    }
    const runner = txClient || pool!;
    await runner.query('DELETE FROM thresh_team_members WHERE team_id = $1', [safeTeamId]);
    await runner.query('DELETE FROM thresh_teams WHERE team_id = $1', [safeTeamId]);
    await runner.query('DELETE FROM thresh_audit_log WHERE team_id = $1', [safeTeamId]);
  } catch (err: unknown) {
    warnServerFallback('vault:delete-team-postgres', err);
    if (txClient) throw err;
  }
}

/**
 * Deletes normalized Postgres `thresh_team_members` rows and scrubs PII in `thresh_audit_log`
 * for an erased athlete/user or declined minor consent.
 */
export async function deleteMemberPostgresRowsAsync(params: {
  teamId?: string;
  membershipIds?: string[];
  userSids?: string[];
  emails?: string[];
}): Promise<void> {
  const txClient = pgTxContext.getStore();
  const pool = getPostgresPool();
  if (!txClient && !pool) return;

  const safeTeamId = params.teamId ? sanitizeTenantId(params.teamId) : undefined;
  const membershipIds = Array.from(
    new Set((params.membershipIds || []).map((v) => String(v || '').trim()).filter(Boolean))
  );
  const userSids = Array.from(
    new Set((params.userSids || []).map((v) => String(v || '').trim()).filter(Boolean))
  );
  const emails = Array.from(
    new Set((params.emails || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))
  );

  if (membershipIds.length === 0 && userSids.length === 0 && emails.length === 0) {
    return;
  }

  try {
    if (!txClient && pool) {
      await ensurePostgresVaultSchema(pool);
    }
    const runner = txClient || pool!;
    if (safeTeamId && membershipIds.length > 0) {
      await runner.query(
        'DELETE FROM thresh_team_members WHERE team_id = $1 AND membership_id = ANY($2::text[])',
        [safeTeamId, membershipIds]
      );
      await runner.query(
        `UPDATE thresh_audit_log
         SET metadata_json = '{"redacted":true}'
         WHERE team_id = $1 AND target_id = ANY($2::text[])`,
        [safeTeamId, membershipIds]
      );
    }
    if (userSids.length > 0) {
      if (safeTeamId) {
        await runner.query(
          'DELETE FROM thresh_team_members WHERE team_id = $1 AND user_sid = ANY($2::text[])',
          [safeTeamId, userSids]
        );
        await runner.query(
          `UPDATE thresh_audit_log
           SET actor_sid = 'deleted_user', metadata_json = '{"redacted":true}'
           WHERE team_id = $1 AND actor_sid = ANY($2::text[])`,
          [safeTeamId, userSids]
        );
      } else {
        await runner.query(
          'DELETE FROM thresh_team_members WHERE user_sid = ANY($1::text[])',
          [userSids]
        );
        await runner.query(
          `UPDATE thresh_audit_log
           SET actor_sid = 'deleted_user', metadata_json = '{"redacted":true}'
           WHERE actor_sid = ANY($1::text[])`,
          [userSids]
        );
      }
    }
    if (emails.length > 0) {
      if (safeTeamId) {
        await runner.query(
          'DELETE FROM thresh_team_members WHERE team_id = $1 AND LOWER(invited_email) = ANY($2::text[])',
          [safeTeamId, emails]
        );
      } else {
        await runner.query(
          'DELETE FROM thresh_team_members WHERE LOWER(invited_email) = ANY($1::text[])',
          [emails]
        );
      }
    }
  } catch (err: unknown) {
    warnServerFallback('vault:delete-member-postgres', err);
    if (txClient) throw err;
  }
}
