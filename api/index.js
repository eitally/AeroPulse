// server/vercelApp.ts
import "dotenv/config";
import express10 from "express";

// server/apiRouter.ts
import express9 from "express";

// server/securityUtils.ts
import crypto from "crypto";
import dns from "dns";
import fs from "fs";
import net from "net";
var SESSION_SECRET_FILE = "/tmp/thresh-session-secret.key";
var SESSION_COOKIE_NAME = "thresh_session";
var LEGACY_SESSION_COOKIE_NAME = "aeropulse_session";
var OAUTH_STATE_COOKIE_NAME = "thresh_oauth_state";
var SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
var OAUTH_STATE_TTL_MS = 15 * 60 * 1e3;
function isProductionDeployment() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}
function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}
function isCanonicalAuthenticatedClaims(claims) {
  if (!claims || !claims.sub || !claims.sid) return false;
  if (claims.authLevel === "anon") return false;
  const sub = String(claims.sub).trim();
  if (!sub || sub.startsWith("anon_") || sub === "thresh-athlete") return false;
  return true;
}
var cachedSecret = null;
function getSessionSecret() {
  if (cachedSecret) return cachedSecret;
  const envSecret = (process.env.SESSION_SECRET || process.env.TOKEN_VAULT_KEY || process.env.OAUTH_ENCRYPTION_KEY || process.env.STRAVA_CLIENT_SECRET || process.env.CRON_SECRET || "").trim();
  if (envSecret && envSecret.length >= 16) {
    cachedSecret = crypto.createHash("sha256").update(`thresh:${envSecret}`).digest("hex");
    return cachedSecret;
  }
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const existing = fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
      if (existing.length >= 32) {
        cachedSecret = existing;
        return cachedSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: "utf8", mode: 384 });
    cachedSecret = generated;
    return cachedSecret;
  } catch {
    cachedSecret = crypto.randomBytes(32).toString("hex");
    return cachedSecret;
  }
}
function getPasskeyChallengeSecret() {
  return crypto.createHmac("sha256", getSessionSecret()).update("thresh-passkey-challenge-v2").digest();
}
function isSafeHttpsUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
function deriveStravaSessionSid(stravaAthleteId) {
  const cleanId = String(stravaAthleteId || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleanId) {
    return crypto.randomBytes(16).toString("hex");
  }
  return crypto.createHmac("sha256", getSessionSecret()).update(`thresh_strava_sid_v1:${cleanId}`).digest("hex").slice(0, 32);
}
function deriveUserSessionSid(userId) {
  const cleanId = String(userId || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleanId) {
    return crypto.randomBytes(16).toString("hex");
  }
  return crypto.createHmac("sha256", getSessionSecret()).update(`thresh_user_sid_v1:${cleanId}`).digest("hex").slice(0, 32);
}
function appendSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }
  if (Array.isArray(existing)) {
    const cookieName2 = cookieValue.split("=")[0]?.trim();
    const filtered = cookieName2 ? existing.filter((c) => !String(c).startsWith(`${cookieName2}=`)) : existing;
    res.setHeader("Set-Cookie", [...filtered.map(String), cookieValue]);
    return;
  }
  const prevStr = String(existing);
  const cookieName = cookieValue.split("=")[0]?.trim();
  if (cookieName && prevStr.startsWith(`${cookieName}=`)) {
    res.setHeader("Set-Cookie", [cookieValue]);
  } else {
    res.setHeader("Set-Cookie", [prevStr, cookieValue]);
  }
}
function issueOAuthStateToken(input) {
  const nonce = input.nonce && /^[a-f0-9_-]{12,64}$/i.test(input.nonce) ? input.nonce : crypto.randomBytes(16).toString("hex");
  const claims = {
    nonce,
    sid: input.sid,
    flow: input.flow || "redirect",
    mode: input.mode,
    origin: input.origin,
    joinCode: input.joinCode,
    slug: input.slug,
    inviteToken: input.inviteToken,
    userId: input.userId,
    codeVerifier: input.codeVerifier,
    exp: Date.now() + OAUTH_STATE_TTL_MS
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(`oauth_state:${payload}`).digest("base64url");
  return { stateToken: `${payload}.${sig}`, nonce };
}
function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
function verifyOAuthStateToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(`oauth_state:${payload}`).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    if (!decoded.exp || Date.now() > decoded.exp || !decoded.nonce) return null;
    return decoded;
  } catch {
    return null;
  }
}
function setOAuthStateCookie(req, res, nonce) {
  const isSecure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(nonce)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(OAUTH_STATE_TTL_MS / 1e3)}`
  ];
  if (isSecure) parts.push("Secure");
  appendSetCookieHeader(res, parts.join("; "));
}
function getOAuthStateCookieNonce(req) {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[OAUTH_STATE_COOKIE_NAME] || null;
}
function clearOAuthStateCookie(res) {
  appendSetCookieHeader(
    res,
    `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}
function issueSessionToken(subject = "authenticated", existingSid, authLevel) {
  const sid = existingSid && /^[a-f0-9]{24,64}$/i.test(existingSid) ? existingSid : crypto.randomBytes(16).toString("hex");
  const resolvedAuthLevel = authLevel || (subject.startsWith("anon_") || subject === "thresh-athlete" ? "anon" : "verified");
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ sid, sub: subject, exp, authLevel: resolvedAuthLevel }),
    "utf8"
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function decodeAndVerifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    const sub = String(decoded.sub || "authenticated");
    const authLevel = decoded.authLevel === "anon" || decoded.authLevel === "verified" ? decoded.authLevel : sub.startsWith("anon_") || sub === "thresh-athlete" ? "anon" : "verified";
    const sid = decoded.sid && /^[a-f0-9]{16,64}$/i.test(decoded.sid) ? decoded.sid : crypto.createHash("sha256").update(`${sub}:${sig}`).digest("hex").slice(0, 32);
    return { sid, sub, exp: decoded.exp, authLevel };
  } catch {
    return null;
  }
}
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}
function getVerifiedSessionClaims(req) {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME] || cookies[LEGACY_SESSION_COOKIE_NAME];
  if (cookieToken) {
    const verified = decodeAndVerifyToken(cookieToken);
    if (verified) return verified;
  }
  const headerToken = String(req.headers["x-session-token"] || "").trim();
  if (headerToken) {
    const verified = decodeAndVerifyToken(headerToken);
    if (verified) return verified;
  }
  return null;
}
function setSessionCookie(req, res, subject = "authenticated", explicitSid, authLevel) {
  const existing = getVerifiedSessionClaims(req);
  const targetSid = explicitSid || existing?.sid;
  const preserveCanonicalUserSub = Boolean(existing?.sub?.startsWith("usr_")) && !subject.startsWith("usr_") && Boolean(targetSid && existing?.sid && targetSid === existing.sid);
  const resolvedSubject = preserveCanonicalUserSub ? existing.sub : subject;
  const resolvedAuthLevel = preserveCanonicalUserSub ? "verified" : authLevel || (resolvedSubject.startsWith("anon_") || resolvedSubject === "thresh-athlete" ? "anon" : "verified");
  const token = issueSessionToken(resolvedSubject, targetSid, resolvedAuthLevel);
  const isSecure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  const maxAgeSecs = Math.floor(SESSION_TTL_MS / 1e3);
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSecs}`
  ];
  if (isSecure) cookieParts.push("Secure");
  appendSetCookieHeader(res, cookieParts.join("; "));
  return token;
}
function clearSessionCookie(res) {
  appendSetCookieHeader(
    res,
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  appendSetCookieHeader(
    res,
    `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  appendSetCookieHeader(
    res,
    "thresh_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
  clearOAuthStateCookie(res);
}
function hasValidSessionToken(req) {
  return getVerifiedSessionClaims(req) !== null;
}
function hasValidCronAuthorization(req) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  }
  const authHeader = String(req.headers.authorization || "").trim();
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const candidate = bearer || String(req.headers["x-cron-secret"] || "").trim();
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(cronSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function escapeHtml(input) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeJsonForScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function resolveSafeOrigin(rawOrigin) {
  if (!rawOrigin || typeof rawOrigin !== "string") return null;
  try {
    const parsed = new URL(rawOrigin.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
var TRUSTED_PROD_CORS_ORIGINS = /* @__PURE__ */ new Set([
  "https://thresh-dev.vercel.app",
  "https://aeropulse-eta.vercel.app",
  "https://thresh.app"
]);
function normalizeVercelHostToOrigin(host) {
  const clean = String(host || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!clean) return null;
  return resolveSafeOrigin(`https://${clean}`);
}
function resolveTrustedCorsOrigin(rawOrigin) {
  const safeOrigin = resolveSafeOrigin(rawOrigin);
  if (!safeOrigin) return null;
  if (TRUSTED_PROD_CORS_ORIGINS.has(safeOrigin)) {
    return safeOrigin;
  }
  const allowedCandidates = [
    process.env.APP_URL,
    process.env.APP_BASE_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(",")
  ];
  for (const cand of allowedCandidates) {
    const resolved = resolveSafeOrigin(cand);
    if (resolved && resolved === safeOrigin) {
      return safeOrigin;
    }
  }
  for (const vercelHost of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    const resolved = normalizeVercelHostToOrigin(vercelHost);
    if (resolved && resolved === safeOrigin) {
      return safeOrigin;
    }
  }
  if (process.env.NODE_ENV !== "production") {
    try {
      const parsed = new URL(safeOrigin);
      if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
        return safeOrigin;
      }
    } catch {
      return null;
    }
  }
  return null;
}
function isPrivateIpv4Octets(octets) {
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}
function isPrivateOrReservedIp(rawIp) {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateIpv4Octets(ip.split(".").map(Number));
  }
  if (version === 6) {
    if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0") {
      return true;
    }
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || ip.startsWith("ff")) {
      return true;
    }
    const v4MappedDotted = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedDotted) {
      return isPrivateIpv4Octets(v4MappedDotted[1].split(".").map(Number));
    }
    const v4MappedHex = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (v4MappedHex) {
      const hi = parseInt(v4MappedHex[1], 16);
      const lo = parseInt(v4MappedHex[2], 16);
      return isPrivateIpv4Octets([hi >> 8 & 255, hi & 255, lo >> 8 & 255, lo & 255]);
    }
    return false;
  }
  return true;
}
function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || /^\d+$/.test(hostname) || // Block decimal integer IP encoding (e.g. 2130706433)
    /^0x[0-9a-f]+$/i.test(hostname)) {
      return false;
    }
    if (net.isIP(hostname) !== 0 || hostname.includes(":")) {
      return !isPrivateOrReservedIp(hostname);
    }
    return true;
  } catch {
    return false;
  }
}
async function assertSafeExternalFetch(rawUrl, init = {}, maxRedirects = 2) {
  let currentUrl = rawUrl.trim();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalUrl(currentUrl)) return null;
    const parsed = new URL(currentUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    try {
      const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
      if (!records.length || records.some((r) => isPrivateOrReservedIp(r.address))) {
        return null;
      }
    } catch {
      return null;
    }
    const resp = await fetch(currentUrl, {
      ...init,
      redirect: "manual"
    });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get("location");
      if (!location || hop === maxRedirects) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  return null;
}
function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const allowedOrigin = resolveTrustedCorsOrigin(req.headers.origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-session-token, x-strava-client-id, x-strava-client-secret, x-strava-refresh-token, x-strava-access-token, x-strava-expires-at, x-strava-sync-window, x-strava-import-gear, x-intervals-api-key, x-intervals-athlete-id, x-intervals-access-token, x-wahoo-access-token, x-polar-access-token, x-garmin-personal-api-key, x-garmin-bearer-token, x-garmin-oauth1-token, x-garmin-oauth1-secret, x-map-tile-api-key, x-map-tile-provider, x-gemini-api-key"
    );
    res.setHeader("Vary", "Origin");
  }
  const reqPath = req.path || req.url || "";
  if (reqPath.startsWith("/api/") || reqPath.startsWith("/auth/") || reqPath.includes("/config") || reqPath.includes("/auth")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  if (req.method === "OPTIONS" && allowedOrigin) {
    res.status(204).end();
    return;
  }
  next();
}

// server/sessionContext.ts
import { AsyncLocalStorage } from "async_hooks";
import crypto4 from "crypto";
import fs4 from "fs";

// server/garminConnectService.ts
import crypto3 from "crypto";
import fs3 from "fs";
import path from "path";

// server/tokenVault.ts
import crypto2 from "crypto";
import fs2 from "fs";
import os from "os";
import pg from "pg";
var { Pool } = pg;
var VAULT_FILE_PREFIX = "/tmp/thresh-vault-";
var VAULT_ENVELOPE_PREFIX = "v1.";
var derivedKeyCache = null;
var warnedMissingVaultKey = false;
function getVaultEncryptionKey() {
  if (derivedKeyCache) return derivedKeyCache;
  const rawSecret = (process.env.TOKEN_VAULT_KEY || process.env.OAUTH_ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.STRAVA_CLIENT_SECRET || process.env.CRON_SECRET || "").trim();
  if (rawSecret.length >= 16) {
    if (/^[0-9a-fA-F]{64}$/.test(rawSecret)) {
      derivedKeyCache = Buffer.from(rawSecret, "hex");
      return derivedKeyCache;
    }
    derivedKeyCache = crypto2.scryptSync(rawSecret, "thresh-vault-v1-salt", 32);
    return derivedKeyCache;
  }
  if (process.env.NODE_ENV === "production" && !warnedMissingVaultKey) {
    warnedMissingVaultKey = true;
    console.warn(
      "[THRESH Security] TOKEN_VAULT_KEY / SESSION_SECRET not set in production; deriving fallback vault key."
    );
  }
  const fallbackSeed = `thresh-local-vault:${os.hostname()}:${os.userInfo().username}`;
  derivedKeyCache = crypto2.scryptSync(fallbackSeed, "thresh-dev-vault-salt", 32);
  return derivedKeyCache;
}
function sanitizeTenantId(rawTenantId) {
  const cleaned = String(rawTenantId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!cleaned) {
    throw new Error("Invalid empty tenant identifier for token vault.");
  }
  return cleaned;
}
function encryptJsonForVault(payload) {
  const key = getVaultEncryptionKey();
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VAULT_ENVELOPE_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decryptJsonFromVault(envelope) {
  try {
    if (!envelope || typeof envelope !== "string" || !envelope.startsWith(VAULT_ENVELOPE_PREFIX)) {
      return null;
    }
    const body = envelope.slice(VAULT_ENVELOPE_PREFIX.length);
    const parts = body.split(".");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "base64url");
    const authTag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || authTag.length !== 16) return null;
    const key = getVaultEncryptionKey();
    const decipher = crypto2.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}
var pgPool = null;
var pgSchemaInitialized = false;
var pgSchemaPromise = null;
function getVaultStorageBackend() {
  return process.env.DATABASE_URL?.trim() ? "POSTGRES" : "ENCRYPTED_FILE";
}
function buildPostgresSslConfig(dbUrl, env = process.env) {
  const clean = String(dbUrl || "").trim().toLowerCase();
  if (!clean || clean.includes("localhost") || clean.includes("127.0.0.1")) {
    return void 0;
  }
  return {
    rejectUnauthorized: env.PG_SSL_ALLOW_SELF_SIGNED === "true" ? false : true
  };
}
function getPostgresPool() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 15e3,
      connectionTimeoutMillis: 5e3,
      ssl: buildPostgresSslConfig(dbUrl)
    });
  }
  return pgPool;
}
async function ensurePostgresVaultSchema(pool) {
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
var MAX_MEMORY_VAULT_ENTRIES = 500;
var MEMORY_VAULT_TTL_MS = 5 * 60 * 1e3;
var memoryVaultCache = /* @__PURE__ */ new Map();
function setBoundedMemoryVaultEntry(safeId, value) {
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
      if (oldestKey === void 0) break;
      memoryVaultCache.delete(oldestKey);
    }
  }
  memoryVaultCache.set(safeId, { value, updatedAtMs: now });
}
function getEncryptedVaultFilePath(tenantId) {
  return `${VAULT_FILE_PREFIX}${sanitizeTenantId(tenantId)}.enc`;
}
function loadTenantVaultSync(tenantId, fallback) {
  const safeId = sanitizeTenantId(tenantId);
  const cached = memoryVaultCache.get(safeId);
  if (cached && Date.now() - cached.updatedAtMs < MEMORY_VAULT_TTL_MS) {
    memoryVaultCache.delete(safeId);
    memoryVaultCache.set(safeId, cached);
    return structuredClone(cached.value);
  }
  if (cached) {
    memoryVaultCache.delete(safeId);
  }
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs2.existsSync(encPath)) {
      const envelope = fs2.readFileSync(encPath, "utf8").trim();
      const decrypted = decryptJsonFromVault(envelope);
      if (decrypted !== null) {
        setBoundedMemoryVaultEntry(safeId, decrypted);
        return structuredClone(decrypted);
      }
    }
  } catch {
  }
  return structuredClone(fallback);
}
function saveTenantVaultSync(tenantId, data) {
  const safeId = sanitizeTenantId(tenantId);
  setBoundedMemoryVaultEntry(safeId, structuredClone(data));
  const envelope = encryptJsonForVault(data);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs2.writeFileSync(encPath, envelope, { encoding: "utf8", mode: 384 });
  } catch {
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
      }
    })();
  }
}
async function loadTenantVaultAsync(tenantId, fallback) {
  const safeId = sanitizeTenantId(tenantId);
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      const result = await pool.query(
        "SELECT encrypted_envelope FROM thresh_tenant_vault WHERE tenant_id = $1 LIMIT 1",
        [safeId]
      );
      if (result.rows.length > 0) {
        const decrypted = decryptJsonFromVault(result.rows[0].encrypted_envelope);
        if (decrypted !== null) {
          setBoundedMemoryVaultEntry(safeId, decrypted);
          try {
            fs2.writeFileSync(getEncryptedVaultFilePath(safeId), result.rows[0].encrypted_envelope, {
              encoding: "utf8",
              mode: 384
            });
          } catch {
          }
          return structuredClone(decrypted);
        }
      }
    } catch {
    }
  }
  return loadTenantVaultSync(safeId, fallback);
}
async function saveTenantVaultAsync(tenantId, data) {
  const safeId = sanitizeTenantId(tenantId);
  setBoundedMemoryVaultEntry(safeId, structuredClone(data));
  const envelope = encryptJsonForVault(data);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs2.writeFileSync(encPath, envelope, { encoding: "utf8", mode: 384 });
  } catch {
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
    }
  }
}
var VAULT_COOKIE_NAME = "thresh_vault";
var USER_VAULT_COOKIE_NAME = "thresh_user";
var VAULT_COOKIE_TTL_SECS = 365 * 24 * 60 * 60;
function buildEncryptedVaultCookieHeader(payload, isSecure) {
  const envelope = encryptJsonForVault(payload);
  const encoded = encodeURIComponent(envelope);
  if (encoded.length > 3700) {
    return null;
  }
  const parts = [
    `${VAULT_COOKIE_NAME}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VAULT_COOKIE_TTL_SECS}`
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}
function buildClearVaultCookieHeader() {
  return `${VAULT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function buildEncryptedUserCookieHeader(userPayload, isSecure) {
  const envelope = encryptJsonForVault(userPayload);
  const encoded = encodeURIComponent(envelope);
  if (encoded.length > 3700) {
    return null;
  }
  const parts = [
    `${USER_VAULT_COOKIE_NAME}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VAULT_COOKIE_TTL_SECS}`
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}
function buildClearUserCookieHeader() {
  return `${USER_VAULT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
async function deleteTenantVault(tenantId) {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.delete(safeId);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs2.existsSync(encPath)) fs2.unlinkSync(encPath);
  } catch {
  }
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      await pool.query("DELETE FROM thresh_tenant_vault WHERE tenant_id = $1", [safeId]);
    } catch {
    }
  }
}
var vaultOperationQueues = /* @__PURE__ */ new Map();
async function withVaultLock(tenantId, fn) {
  const safeId = sanitizeTenantId(tenantId);
  const prev = vaultOperationQueues.get(safeId) || Promise.resolve();
  const next = prev.catch(() => void 0).then(() => fn());
  vaultOperationQueues.set(safeId, next);
  try {
    return await next;
  } finally {
    if (vaultOperationQueues.get(safeId) === next) {
      vaultOperationQueues.delete(safeId);
    }
  }
}
async function syncNormalizedTeamPostgresAsync(teamId, metadata, docPayload, members) {
  const pool = getPostgresPool();
  if (!pool) return;
  const safeTeamId = sanitizeTenantId(teamId);
  const envelope = encryptJsonForVault(docPayload);
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    await ensurePostgresVaultSchema(pool);
    await client.query("BEGIN");
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
        envelope
      ]
    );
    await client.query("DELETE FROM thresh_team_members WHERE team_id = $1", [safeTeamId]);
    for (const m of members) {
      await client.query(
        `INSERT INTO thresh_team_members (team_id, membership_id, user_sid, invited_email, role, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          safeTeamId,
          String(m.membershipId).slice(0, 64),
          m.userSid ? String(m.userSid).slice(0, 96) : null,
          m.invitedEmail ? String(m.invitedEmail).trim().toLowerCase().slice(0, 160) : null,
          String(m.role || "ATHLETE").slice(0, 32),
          String(m.status || "INVITED").slice(0, 32)
        ]
      );
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => void 0);
  } finally {
    client.release();
  }
}
async function withTeamRowLock(teamId, fn) {
  const safeTeamId = sanitizeTenantId(teamId);
  const lockKey = `team_doc_${safeTeamId.slice(0, 40)}`;
  return withVaultLock(lockKey, async () => {
    const pool = getPostgresPool();
    if (!pool) return fn();
    const client = await pool.connect().catch(() => null);
    if (!client) return fn();
    try {
      await ensurePostgresVaultSchema(pool);
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [safeTeamId]);
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => void 0);
      throw err;
    } finally {
      client.release();
    }
  });
}
var MAX_LOCAL_AUDIT_ENTRIES = 500;
function auditVaultKey(teamId) {
  return `audit_log_${sanitizeTenantId(teamId).slice(0, 40)}`;
}
async function appendAuditLogAsync(params) {
  const entry = {
    eventId: `aud_${crypto2.randomBytes(8).toString("hex")}`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    teamId: sanitizeTenantId(params.teamId),
    actorSid: String(params.actorSid || "system").slice(0, 96),
    action: String(params.action || "UNKNOWN").slice(0, 64),
    ...params.targetId ? { targetId: String(params.targetId).slice(0, 96) } : {},
    metadata: params.metadata || {}
  };
  const key = auditVaultKey(entry.teamId);
  await withVaultLock(key, async () => {
    const existing = await loadTenantVaultAsync(key, []);
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
          JSON.stringify(entry.metadata)
        ]
      );
    } catch {
    }
  }
  return entry;
}
async function listTeamAuditLogAsync(teamId, limit = 100) {
  const safeTeamId = sanitizeTenantId(teamId);
  const clampedLimit = Math.max(1, Math.min(250, Math.round(limit)));
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensurePostgresVaultSchema(pool);
      const res = await pool.query(
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
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          teamId: r.team_id,
          actorSid: r.actor_sid,
          action: r.action,
          ...r.target_id ? { targetId: r.target_id } : {},
          metadata: (() => {
            try {
              return JSON.parse(r.metadata_json);
            } catch {
              return {};
            }
          })()
        }));
      }
    } catch {
    }
  }
  const local = await loadTenantVaultAsync(auditVaultKey(safeTeamId), []);
  return [...local].reverse().slice(0, clampedLimit);
}

// src/physiology/stravaLoadCalibration.ts
var STRAVA_LOAD_MODEL_VERSION = 4;
var BANISTER_CTL_DECAY = Math.exp(-1 / 42);
var BANISTER_ATL_DECAY = Math.exp(-1 / 7);
function getLocalDateIso(date = /* @__PURE__ */ new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function shiftIsoDate(isoDate, deltaDays) {
  const [yStr, mStr, dStr] = isoDate.slice(0, 10).split("-");
  const dt = new Date(
    Date.UTC(Number(yStr) || 2026, (Number(mStr) || 1) - 1, Number(dStr) || 1)
  );
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}
function isEBikeActivityText(rawSportType, name) {
  const combined = `${rawSportType || ""} ${name || ""}`;
  return /e[-_]?bike|e[-_]?mtb|emountainbike/i.test(combined);
}
function isVirtualCyclingText(text) {
  return /virtualride|virtual_ride|virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|\brgt\b/i.test(
    text || ""
  );
}
function classifyMultiSportActivity(rawSportType, name, opts) {
  const rawType = String(rawSportType || "").trim();
  const actName = String(name || "").trim();
  const combined = `${rawType} ${actName}`.trim();
  const hasGps = Boolean(opts?.hasGps);
  const trainer = Boolean(opts?.trainer);
  const isVirtual = Boolean(opts?.isVirtualPlatform) || isVirtualCyclingText(combined);
  if (/^(ebikeride|emountainbikeride)$/i.test(rawType) || isEBikeActivityText(rawType, "") && !/run|walk|hike/i.test(rawType)) {
    return {
      sportCategory: "Cycling",
      subType: "EBike",
      environment: trainer ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/^(hike|hiking|snowshoe)$/i.test(rawType)) {
    return { sportCategory: "Multisport", subType: "Hiking", environment: "OUTDOOR" };
  }
  if (/^(walk|casual_walking|speed_walking)$/i.test(rawType)) {
    return {
      sportCategory: "Multisport",
      subType: "Walking",
      environment: trainer ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/^(rowing|virtualrow|indoor_rowing)$/i.test(rawType)) {
    const indoor = trainer || /virtualrow|indoor_rowing/i.test(rawType) || !hasGps;
    return {
      sportCategory: "Multisport",
      subType: "Rowing",
      environment: indoor ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/^elliptical$/i.test(rawType)) {
    return { sportCategory: "Multisport", subType: "Elliptical", environment: "INDOOR" };
  }
  if (/^(stairstepper|stair_climbing|floor_climbing)$/i.test(rawType)) {
    return { sportCategory: "Multisport", subType: "Stair Stepper", environment: "INDOOR" };
  }
  if (/^(nordicski|rollerski|cross_country_skiing|xc_ski)$/i.test(rawType)) {
    const indoor = trainer || /skierg/i.test(actName) && !hasGps;
    return {
      sportCategory: "Multisport",
      subType: "Nordic Ski",
      environment: indoor ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/^(alpineski|backcountryski|snowboard|resort_skiing_snowboarding)$/i.test(rawType)) {
    return {
      sportCategory: "Multisport",
      subType: "Alpine & Backcountry Ski",
      environment: "OUTDOOR"
    };
  }
  if (/^(kayaking|canoeing|standuppaddling|stand_up_paddleboarding|surfing|windsurf|kitesurf|sailing)$/i.test(rawType)) {
    return {
      sportCategory: "Multisport",
      subType: "Paddling & Water",
      environment: "OUTDOOR"
    };
  }
  if (/^(soccer|tennis|pickleball|basketball|golf|iceskate|inlineskate|skateboard|badminton|squash|racquetball|tabletennis)$/i.test(rawType)) {
    return {
      sportCategory: "Multisport",
      subType: "Court & Field",
      environment: /badminton|squash|racquetball|tabletennis/i.test(rawType) && !hasGps ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/^hiit$/i.test(rawType)) {
    return { sportCategory: "Strength", subType: "HIIT & Circuit", environment: "INDOOR" };
  }
  if (/^(rockclimbing|bouldering)$/i.test(rawType)) {
    return {
      sportCategory: "Strength",
      subType: "Climbing",
      environment: hasGps ? "OUTDOOR" : "INDOOR"
    };
  }
  if (/^(yoga|pilates|stretching|stretch|mobility|meditation|breathwork)$/i.test(rawType)) {
    return { sportCategory: "Strength", subType: "Yoga & Mobility", environment: "INDOOR" };
  }
  if (/^(weighttraining|crossfit|workout|strength_training)$/i.test(rawType)) {
    const isHiitText = /hiit|crossfit|circuit|metcon|bootcamp|interval/i.test(combined);
    return {
      sportCategory: "Strength",
      subType: isHiitText ? "HIIT & Circuit" : "Gym",
      environment: "INDOOR"
    };
  }
  if (/swim|open_water|openwaterswim/i.test(rawType)) {
    const isOpenWater = /open[\s_-]*water|ocean|lake|sea/i.test(combined) || hasGps;
    return {
      sportCategory: "Swimming",
      subType: isOpenWater ? "Open Water" : "Pool",
      environment: isOpenWater ? "OUTDOOR" : "INDOOR"
    };
  }
  if (/^(run|trailrun|virtualrun|running|treadmill_running|trail_running|track_running|virtual_run)$/i.test(rawType) || /run|treadmill/i.test(rawType) && !/ride|cycle|bike/i.test(rawType)) {
    const isIndoorRun = trainer || /virtualrun|virtual_run|treadmill|indoor/i.test(combined);
    if (isIndoorRun) {
      return { sportCategory: "Running", subType: "Treadmill", environment: "INDOOR" };
    }
    if (/trail/i.test(combined)) {
      return { sportCategory: "Running", subType: "Trail", environment: "OUTDOOR" };
    }
    if (/\b(track|400m|200m)\b/i.test(actName)) {
      return { sportCategory: "Running", subType: "Track", environment: "OUTDOOR" };
    }
    if (/\b(xc|cross country)\b/i.test(actName)) {
      return { sportCategory: "Running", subType: "Cross Country", environment: "OUTDOOR" };
    }
    return { sportCategory: "Running", subType: "Road", environment: "OUTDOOR" };
  }
  if (/^(ride|virtualride|gravelride|mountainbikeride|handcycle|velomobile|cycling|virtual_ride|indoor_cycling|road_biking|gravel_cycling|mountain_biking)$/i.test(rawType) || /ride|cycling|bike|virtualride|gravel|mountainbike|handcycle|velomobile/i.test(rawType)) {
    const isEBike = isEBikeActivityText(rawType, actName);
    if (isEBike) {
      return {
        sportCategory: "Cycling",
        subType: "EBike",
        environment: trainer ? "INDOOR" : "OUTDOOR"
      };
    }
    const isIndoorBike = trainer || isVirtual || /indoor|trainer|spinning|peloton/i.test(combined) || !hasGps;
    if (isVirtual) {
      return { sportCategory: "Cycling", subType: "Virtual Cycling", environment: "INDOOR" };
    }
    if (isIndoorBike) {
      return { sportCategory: "Cycling", subType: "Smart Trainer", environment: "INDOOR" };
    }
    if (/gravel/i.test(combined)) {
      return { sportCategory: "Cycling", subType: "Gravel", environment: "OUTDOOR" };
    }
    if (/mountain|mtb|trail/i.test(combined)) {
      return { sportCategory: "Cycling", subType: "Trail", environment: "OUTDOOR" };
    }
    return { sportCategory: "Cycling", subType: "Road", environment: "OUTDOOR" };
  }
  if (/triathlon|duathlon|multisport/i.test(rawType)) {
    return { sportCategory: "Multisport", subType: "Road", environment: "OUTDOOR" };
  }
  if (/\b(hike|hiking|snowshoe)\b/i.test(actName)) {
    return { sportCategory: "Multisport", subType: "Hiking", environment: "OUTDOOR" };
  }
  if (/\b(walk|walking)\b/i.test(actName)) {
    return { sportCategory: "Multisport", subType: "Walking", environment: trainer ? "INDOOR" : "OUTDOOR" };
  }
  if (/\b(row|rowing|erg|concept2)\b/i.test(actName)) {
    return { sportCategory: "Multisport", subType: "Rowing", environment: trainer || !hasGps ? "INDOOR" : "OUTDOOR" };
  }
  if (/\belliptical\b/i.test(actName)) {
    return { sportCategory: "Multisport", subType: "Elliptical", environment: "INDOOR" };
  }
  if (/\b(yoga|pilates|mobility|stretch)\b/i.test(actName)) {
    return { sportCategory: "Strength", subType: "Yoga & Mobility", environment: "INDOOR" };
  }
  if (/\b(hiit|crossfit|circuit)\b/i.test(actName)) {
    return { sportCategory: "Strength", subType: "HIIT & Circuit", environment: "INDOOR" };
  }
  if (/ride|cycling|bike|zwift|peloton|spin/i.test(actName)) {
    return {
      sportCategory: "Cycling",
      subType: isVirtual ? "Virtual Cycling" : trainer || !hasGps ? "Smart Trainer" : "Road",
      environment: trainer || isVirtual || !hasGps ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/\b(run|treadmill|jog|marathon|5k|10k)\b/i.test(actName)) {
    return {
      sportCategory: "Running",
      subType: trainer || /treadmill/i.test(actName) ? "Treadmill" : "Road",
      environment: trainer || /treadmill/i.test(actName) ? "INDOOR" : "OUTDOOR"
    };
  }
  if (/\b(swim|pool)\b/i.test(actName)) {
    return {
      sportCategory: "Swimming",
      subType: hasGps ? "Open Water" : "Pool",
      environment: hasGps ? "OUTDOOR" : "INDOOR"
    };
  }
  return { sportCategory: "Strength", subType: "Gym", environment: "INDOOR" };
}
function deriveObservedPhysiologyMetrics(activities, weightKg = 70) {
  let maxBikeWatts20m = 0;
  let maxBikePeakWatts = 0;
  let maxBikeHr = 0;
  let maxBikeSustainedHr = 0;
  let maxRunHr = 0;
  let maxRunSustainedHr = 0;
  let maxRunSustainedWatts = 0;
  let bestRunPaceSecsPerKm = 0;
  if (Array.isArray(activities)) {
    for (const a of activities) {
      if (!a) continue;
      const sport = String(
        a.sportCategory || a.rawSportType || a.sport_type || a.type || a.activityType?.typeKey || ""
      );
      const rawType = String(a.rawSportType || a.sport_type || a.type || "");
      const actName = String(a.name || a.activityName || "");
      const isEBike = isEBikeActivityText(rawType || sport, actName);
      const isBike = !isEBike && /ride|cycling|virtualride|bike|biking|zwift|peloton|spin/i.test(sport);
      const isRun = /run|trailrun|virtualrun|running|treadmill/i.test(sport);
      const dur = Number(
        a.movingTimeSecs ?? a.movingDuration ?? a.moving_time ?? a.elapsed_time ?? a.duration ?? 0
      );
      const dist = Number(a.distanceMeters ?? a.distance ?? 0);
      const avgP = Number(a.avgPower ?? a.icu_average_watts ?? a.average_watts ?? 0);
      const np = Number(
        a.normalizedPower ?? a.normPower ?? a.icu_weighted_avg_watts ?? a.weighted_average_watts ?? avgP
      );
      const sustainedBikeW = avgP > 0 && np > avgP * 1.08 ? Math.round(avgP * 1.05) : np;
      const p20 = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
      const peakW = Number(a.max_watts ?? a.maxPower ?? a.maxAvgPower_1 ?? a.pMax ?? 0);
      const avgHr = Number(a.avgHr ?? a.averageHR ?? a.average_heartrate ?? 0);
      const peakHr = Number(a.maxHr ?? a.maxHR ?? a.max_heartrate ?? 0);
      const deviceWattsFlag = a.device_watts ?? a.deviceWatts;
      const hasMeteredBikeWatts = deviceWattsFlag !== false;
      if (isBike) {
        if (hasMeteredBikeWatts) {
          if (p20 >= 150 && p20 <= 600) {
            if (p20 > maxBikeWatts20m) maxBikeWatts20m = p20;
          } else if (dur >= 1200 && sustainedBikeW >= 150 && sustainedBikeW <= 600 && (avgHr === 0 || avgHr >= 142 || peakHr >= 160 && avgHr >= peakHr * 0.82) && sustainedBikeW > maxBikeWatts20m) {
            maxBikeWatts20m = sustainedBikeW;
          }
          if (peakW >= 250 && peakW <= 2500 && peakW > maxBikePeakWatts) {
            maxBikePeakWatts = Math.round(peakW);
          } else if (sustainedBikeW >= 150 && np > 0 && np * 2.25 > maxBikePeakWatts) {
            maxBikePeakWatts = Math.round(np * 2.25);
          }
        }
        if (peakHr >= 158 && peakHr <= 225 && peakHr > maxBikeHr) {
          maxBikeHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 146 && avgHr <= 210 && avgHr > maxBikeSustainedHr) {
          maxBikeSustainedHr = avgHr;
        }
      } else if (isRun) {
        if (peakHr >= 158 && peakHr <= 225 && peakHr > maxRunHr) {
          maxRunHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 148 && avgHr <= 210 && avgHr > maxRunSustainedHr) {
          maxRunSustainedHr = avgHr;
        }
        if (deviceWattsFlag !== false && dur >= 1200 && np >= 120 && np <= 650 && np > maxRunSustainedWatts) {
          maxRunSustainedWatts = np;
        }
        const split5k = Number(a.fastestSplit_5000 ?? 0);
        const paceFrom5k = split5k >= 780 && split5k <= 2100 ? Math.round(split5k / 5) : 0;
        const pace = paceFrom5k || Number(a.gapPaceSecsPerKm ?? a.avgPaceSecsPerKm ?? 0) || (dist >= 3e3 && dur >= 900 ? Math.round(dur / (dist / 1e3)) : 0);
        const isHardEnoughForThreshold = pace <= 300 || pace <= 420 && (avgHr >= 150 || peakHr >= 162 && avgHr >= peakHr * 0.85);
        if ((paceFrom5k > 0 || dur >= 1200 && dist >= 3e3) && pace >= 165 && pace <= 420 && isHardEnoughForThreshold) {
          if (bestRunPaceSecsPerKm === 0 || pace < bestRunPaceSecsPerKm) {
            bestRunPaceSecsPerKm = pace;
          }
        }
      }
    }
  }
  const anyMaxHr = Math.max(maxBikeHr, maxRunHr);
  const obsBikeMaxHr = maxBikeHr || anyMaxHr || 0;
  const obsBikeLthr = maxBikeSustainedHr >= 146 ? Math.max(
    148,
    Math.min(obsBikeMaxHr ? obsBikeMaxHr - 6 : 200, Math.round(maxBikeSustainedHr * 0.98))
  ) : obsBikeMaxHr >= 158 ? Math.max(148, Math.round(obsBikeMaxHr * 0.9)) : 0;
  const obsRunMaxHr = maxRunHr || obsBikeMaxHr || 0;
  const obsRunLthr = maxRunSustainedHr >= 148 ? Math.max(
    150,
    Math.min(obsRunMaxHr ? obsRunMaxHr - 5 : 205, Math.round(maxRunSustainedHr * 0.98))
  ) : obsRunMaxHr >= 158 ? Math.max(150, Math.round(obsRunMaxHr * 0.91)) : obsBikeLthr ? obsBikeLthr + 4 : 0;
  const obsFtp = maxBikeWatts20m >= 150 ? Math.round(maxBikeWatts20m * 0.95) : 0;
  const obsPMax = maxBikePeakWatts >= 400 ? Math.round(maxBikePeakWatts) : obsFtp > 0 ? Math.round(obsFtp * 3.6) : 0;
  const obsWPrime = obsFtp > 0 ? Math.round(obsFtp * 75) : 0;
  const obsThresholdPace = bestRunPaceSecsPerKm > 0 ? Math.round(bestRunPaceSecsPerKm * 1.03) : 0;
  const safeW = weightKg > 30 ? weightKg : 70;
  const obsRunFtp = maxRunSustainedWatts >= 140 ? Math.round(maxRunSustainedWatts * 0.92) : obsThresholdPace > 0 ? Math.round(safeW * (1e3 / obsThresholdPace) * 0.98) : 0;
  const obsVo2Bike = obsFtp > 0 && safeW > 30 ? Math.max(32, Math.min(88, Math.round(10.8 * (obsFtp / safeW) + 7))) : 0;
  const obsVo2Run = obsThresholdPace > 0 ? Math.max(32, Math.min(88, Math.round(1e3 / obsThresholdPace * 60 * 0.2 + 3.5))) : obsVo2Bike;
  return {
    obsFtp,
    obsPMax,
    obsWPrime,
    obsBikeMaxHr,
    obsBikeLthr,
    obsRunMaxHr,
    obsRunLthr,
    obsThresholdPace,
    obsRunFtp,
    obsVo2Bike,
    obsVo2Run
  };
}
function computeHrrRatio(avgBpm, lthrBpm, restingHr = 54) {
  const safeRest = Math.max(38, Math.min(78, restingHr || 54));
  const reserve = Math.max(65, (lthrBpm || 163) - safeRest);
  return Math.max(0, Math.min(1.22, (avgBpm - safeRest) / reserve));
}
function computeStravaActivityLoadV2(input) {
  const rawType = String(input.rawSportType || "").trim();
  const actName = String(input.name || "").trim();
  const combinedMeta = `${rawType} ${actName}`.trim();
  const isEBike = isEBikeActivityText(rawType, actName);
  const isMeditation = /^(meditation|breathwork|sauna)$/i.test(rawType) || /\b(meditation|breathwork|sauna)\b/i.test(actName);
  const isYogaOrMobility = !isEBike && !isMeditation && (/^(yoga|pilates|stretching|stretch|mobility)$/i.test(rawType) || /\b(yoga|pilates|stretching|stretch|mobility)\b/i.test(actName));
  const isWalk = !isEBike && /^(walk|casual_walking|speed_walking|golf|sailing|skateboard)$/i.test(rawType);
  const isLowImpactCasual = !isEBike && (isMeditation || isYogaOrMobility || isWalk);
  const isHike = !isEBike && /^(hike|hiking|snowshoe)$/i.test(rawType);
  const isAerobicCrossTrain = !isEBike && /^(rowing|virtualrow|indoor_rowing|nordicski|rollerski|cross_country_skiing|xc_ski|elliptical|stairstepper|stair_climbing|floor_climbing|kayaking|canoeing|standuppaddling|stand_up_paddleboarding)$/i.test(rawType);
  const isBackcountrySki = !isEBike && /^backcountryski$/i.test(rawType);
  const isAlpineSki = !isEBike && /^(alpineski|snowboard|resort_skiing_snowboarding)$/i.test(rawType);
  const isHiitOrCourt = !isEBike && (/^(hiit|crossfit|soccer|tennis|pickleball|basketball|badminton|squash|racquetball|tabletennis)$/i.test(rawType) || /^(workout)$/i.test(rawType) && /\b(hiit|crossfit|circuit|metcon|bootcamp)\b/i.test(actName));
  const isModerateOutdoor = !isEBike && !isLowImpactCasual && (isHike || isBackcountrySki || isAlpineSki || isAerobicCrossTrain);
  const movingTimeSecs = Math.max(0, Number(input.movingTimeSecs || 0));
  const hrs = movingTimeSecs / 3600;
  if (hrs <= 0.01) {
    return {
      trainingLoad: Math.min(20, Math.max(0, Math.round(Number(input.sufferScore || 0) * 0.25))),
      intensityFactor: void 0,
      isEBike,
      isLowImpactCasual,
      isModerateOutdoor
    };
  }
  const restHr = Math.max(38, Math.min(78, Number(input.restingHr || 54)));
  const avgHr = Math.round(Number(input.avgHr || 0));
  const maxHr = Math.round(Number(input.maxHr || 0));
  const bikeLthr = Math.max(135, Number(input.calibratedBikeLthr || 163));
  const runLthr = Math.max(140, Number(input.calibratedRunLthr || 168));
  const ftp = Math.max(120, Number(input.calibratedFtp || 250));
  const thresholdPace = Math.max(155, Number(input.calibratedThresholdPaceSecsPerKm || 255));
  const distMeters = Math.max(0, Number(input.distanceMeters || 0));
  const elevGain = Math.max(0, Number(input.elevationGainMeters || 0));
  const buildResult = (trainingLoad, intensityFactor) => ({
    trainingLoad: Math.max(0, Math.round(trainingLoad)),
    intensityFactor: intensityFactor !== void 0 ? Number(intensityFactor.toFixed(2)) : void 0,
    isEBike,
    isLowImpactCasual,
    isModerateOutdoor
  });
  if (isEBike) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(
        Math.min(Math.round(hrs * 40), Math.round(hrs * 65 * hrr * hrr)),
        Math.min(0.95, 0.35 + hrr * 0.5)
      );
    }
    return buildResult(hrs * 18, 0.42);
  }
  if (isMeditation) {
    return buildResult(hrs * 3, 0.2);
  }
  if (isYogaOrMobility) {
    const isPilates = /pilates/i.test(combinedMeta);
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      const cap = isPilates ? 32 : 22;
      const coeff = isPilates ? 58 : 48;
      return buildResult(
        Math.min(Math.round(hrs * cap), Math.round(hrs * coeff * hrr * hrr)),
        Math.min(0.78, 0.28 + hrr * 0.45)
      );
    }
    return buildResult(hrs * (isPilates ? 18 : 10), isPilates ? 0.42 : 0.32);
  }
  if (isWalk) {
    const isGolf = /^golf$/i.test(rawType);
    if (isGolf) {
      return buildResult(hrs * 14, 0.37);
    }
    const grade = distMeters > 200 ? elevGain / distMeters : 0;
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      const hrCap = grade >= 0.03 ? 55 : 30;
      return buildResult(
        Math.min(Math.round(hrs * hrCap), Math.round(hrs * 65 * hrr * hrr)),
        Math.min(0.85, 0.3 + hrr * 0.48)
      );
    }
    const baseRate = grade >= 0.03 ? Math.min(46, 18 + Math.round(grade * 260)) : 15;
    return buildResult(hrs * baseRate, Math.sqrt(baseRate / 100));
  }
  if (isHike || isBackcountrySki) {
    const grade = distMeters > 200 ? Math.max(0, elevGain / distMeters) : 0;
    const speedKph = distMeters > 200 && hrs > 0 ? distMeters / 1e3 / hrs : 4.2;
    const eqSpeedKph = speedKph * (1 + Math.min(1.6, grade * 9.5 + grade * grade * 28));
    const mechIf = Math.max(0.46, Math.min(1.04, eqSpeedKph / 12.2));
    const mechLoad = Math.round(hrs * 88 * mechIf * mechIf);
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, runLthr, restHr);
      const hrLoad = Math.round(hrs * 85 * hrr * hrr);
      const combined = Math.round(0.55 * hrLoad + 0.45 * mechLoad);
      return buildResult(
        combined,
        Math.min(1.1, Math.sqrt(Math.max(0.1, combined / Math.max(0.1, hrs * 100))))
      );
    }
    return buildResult(isBackcountrySki && distMeters < 300 ? hrs * 48 : mechLoad, mechIf);
  }
  if (isAlpineSki) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(
        Math.min(Math.round(hrs * 38), Math.round(hrs * 60 * hrr * hrr)),
        Math.min(0.85, 0.35 + hrr * 0.45)
      );
    }
    return buildResult(hrs * 22, 0.47);
  }
  if (isAerobicCrossTrain) {
    const np = Number(input.normalizedPower || input.avgPower || 0);
    const rowFtp = Math.max(110, ftp * 0.88);
    const hasErgWatts = Boolean(input.hasRealDeviceWatts && np > 0);
    const powerIf = hasErgWatts ? Math.max(0.35, Math.min(1.3, np / rowFtp)) : 0;
    const powerLoad = hasErgWatts ? Math.round(movingTimeSecs * np * powerIf / (rowFtp * 3600) * 100) : 0;
    const hrr = avgHr > 60 ? computeHrrRatio(avgHr, runLthr, restHr) : 0;
    const hrLoad = avgHr > 60 ? Math.min(Math.round(hrs * 115), Math.round(hrs * 92 * hrr * hrr)) : 0;
    if (powerLoad > 0 && hrLoad > 0) {
      const blended = Math.round(0.5 * powerLoad + 0.5 * hrLoad);
      return buildResult(
        blended,
        Math.min(1.22, Math.sqrt(Math.max(0.1, blended / Math.max(0.1, hrs * 100))))
      );
    }
    if (powerLoad > 0) return buildResult(powerLoad, powerIf);
    if (hrLoad > 0) return buildResult(hrLoad, Math.min(1.18, 0.42 + hrr * 0.58));
    if (/row/i.test(combinedMeta) && distMeters >= 500 && hrs > 0) {
      const secsPer500 = movingTimeSecs / (distMeters / 500);
      const rowIf = Math.max(0.45, Math.min(1.15, 118 / secsPer500));
      return buildResult(hrs * 95 * rowIf * rowIf, rowIf);
    }
    return buildResult(hrs * 46, 0.68);
  }
  if (isHiitOrCourt) {
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, runLthr, restHr);
      const peakBoost = maxHr >= 172 ? 1.1 : 1;
      const load = Math.min(Math.round(hrs * 95), Math.round(hrs * 88 * hrr * hrr * peakBoost));
      return buildResult(load, Math.min(1.12, 0.45 + hrr * 0.55));
    }
    const isPickle = /pickleball/i.test(rawType);
    const isHiit = /hiit|crossfit|workout|circuit|bootcamp/i.test(combinedMeta);
    const rate = isHiit ? 52 : isPickle ? 34 : 45;
    return buildResult(hrs * rate, Math.sqrt(rate / 100));
  }
  if (input.sportCategory === "Cycling") {
    const np = Number(input.normalizedPower || input.avgPower || 0);
    if (input.hasRealDeviceWatts && np > 0) {
      const ifVal = Math.max(0.25, Math.min(1.35, np / ftp));
      return buildResult(
        movingTimeSecs * np * ifVal / (ftp * 3600) * 100,
        ifVal
      );
    }
    if (avgHr > 60) {
      const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
      return buildResult(hrs * 92 * hrr * hrr, Math.min(1.18, 0.45 + hrr * 0.55));
    }
    const speedKph = distMeters > 0 && hrs > 0 ? distMeters / 1e3 / hrs : 18;
    const rate = speedKph < 16 ? 20 : speedKph < 22 ? 28 : 35;
    return buildResult(hrs * rate, Math.sqrt(rate / 100));
  }
  if (input.sportCategory === "Running") {
    const hrrRun = avgHr > 60 ? computeHrrRatio(avgHr, runLthr, restHr) : 0;
    const hrLoad = avgHr > 60 ? Math.round(hrs * 95 * hrrRun * hrrRun) : 0;
    let paceLoad = 0;
    let paceIf = 0;
    const rawPace = input.avgPaceSecsPerKm && input.avgPaceSecsPerKm > 120 ? input.avgPaceSecsPerKm : distMeters > 200 && movingTimeSecs > 0 ? movingTimeSecs / (distMeters / 1e3) : 0;
    if (rawPace > 120) {
      const gradeFraction = distMeters > 0 ? elevGain / distMeters : 0;
      const gapPace = rawPace / (1 + Math.min(0.25, Math.max(0, gradeFraction) * 3.1));
      paceIf = Math.max(0.35, Math.min(1.25, thresholdPace / gapPace));
      paceLoad = Math.round(hrs * 100 * paceIf * paceIf);
    }
    if (hrLoad > 0 && paceLoad > 0) {
      let resolvedLoad;
      if (hrrRun <= 0.78 && paceLoad > hrLoad * 1.2) {
        resolvedLoad = Math.round(hrLoad * 1.05);
      } else if (movingTimeSecs < 1500) {
        resolvedLoad = Math.max(hrLoad, paceLoad);
      } else {
        resolvedLoad = Math.round(0.5 * paceLoad + 0.5 * hrLoad);
      }
      const effIf = Math.min(
        1.22,
        Math.sqrt(Math.max(0.1, resolvedLoad / Math.max(0.1, hrs * 100)))
      );
      return buildResult(resolvedLoad, effIf);
    }
    if (paceLoad > 0) return buildResult(paceLoad, paceIf);
    if (hrLoad > 0) return buildResult(hrLoad, Math.min(1.18, 0.45 + hrrRun * 0.55));
    return buildResult(hrs * 38, 0.62);
  }
  if (input.sportCategory === "Swimming") {
    let sTss = 0;
    let swimIf = 0;
    if (distMeters >= 100 && movingTimeSecs > 0) {
      const pace100 = movingTimeSecs / (distMeters / 100);
      swimIf = Math.max(0.45, Math.min(1.22, 115 / Math.max(55, pace100)));
      sTss = Math.round(hrs * 100 * Math.pow(swimIf, 3));
    }
    const swimLthr = Math.max(130, bikeLthr - 5);
    const hrr = avgHr > 65 ? computeHrrRatio(avgHr, swimLthr, restHr) : 0;
    const hrSwimLoad = avgHr > 65 ? Math.round(hrs * 90 * hrr * hrr) : 0;
    if (sTss > 0 && hrSwimLoad > 0) {
      const blended = Math.round(0.65 * sTss + 0.35 * hrSwimLoad);
      return buildResult(
        blended,
        Math.min(1.18, Math.cbrt(Math.max(0.1, blended / Math.max(0.1, hrs * 100))))
      );
    }
    if (sTss > 0) return buildResult(sTss, swimIf);
    if (hrSwimLoad > 0) return buildResult(hrSwimLoad, Math.min(1.15, 0.45 + hrr * 0.55));
    return buildResult(hrs * 42, 0.65);
  }
  if (avgHr > 60) {
    const hrr = computeHrrRatio(avgHr, bikeLthr, restHr);
    const load = Math.min(
      Math.round(hrs * 58),
      Math.max(Math.round(hrs * 24), Math.round(hrs * (22 + 52 * hrr * hrr)))
    );
    return buildResult(load, Math.min(0.95, 0.4 + hrr * 0.45));
  }
  return buildResult(hrs * 30, 0.55);
}

// src/utils/activityTimestamp.ts
var HAS_EXPLICIT_TZ_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
var WALL_CLOCK_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;
function pad2(n) {
  return String(Math.trunc(n)).padStart(2, "0");
}
function formatWallClockIsoFromUtcMs(utcMs, offsetMinutes) {
  const safeOffsetMins = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const shifted = new Date(utcMs + safeOffsetMins * 6e4);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate()
  )}T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(
    shifted.getUTCSeconds()
  )}`;
}
function formatLocalWallClockFromDate(date = /* @__PURE__ */ new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
function estimateUtcOffsetMinutesFromLon(lonDeg) {
  if (!Number.isFinite(lonDeg) || lonDeg < -180 || lonDeg > 180) return 0;
  const hours = Math.round(lonDeg / 15);
  return Math.max(-720, Math.min(840, hours * 60));
}
function resolveIanaTimeZoneOffsetMinutes(utcMs, timeZone) {
  if (!timeZone || typeof timeZone !== "string" || !Number.isFinite(utcMs)) {
    return void 0;
  }
  const cleanTz = timeZone.trim();
  if (!cleanTz) return void 0;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: cleanTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const lookup = {};
    for (const p of parts) {
      if (p.type !== "literal") {
        lookup[p.type] = Number(p.value);
      }
    }
    if (!Number.isFinite(lookup.year) || !Number.isFinite(lookup.month) || !Number.isFinite(lookup.day) || !Number.isFinite(lookup.hour) || !Number.isFinite(lookup.minute) || !Number.isFinite(lookup.second)) {
      return void 0;
    }
    const hourNorm = lookup.hour === 24 ? 0 : lookup.hour;
    const asUtcMs = Date.UTC(
      lookup.year,
      lookup.month - 1,
      lookup.day,
      hourNorm,
      lookup.minute,
      lookup.second
    );
    const truncatedUtcMs = Math.floor(utcMs / 1e3) * 1e3;
    const offsetMins = Math.round((asUtcMs - truncatedUtcMs) / 6e4);
    return Math.max(-720, Math.min(840, offsetMins));
  } catch {
    return void 0;
  }
}
function parseIsoWithExplicitOffsetToUtcMs(iso) {
  if (typeof iso !== "string") return null;
  const trimmed = iso.trim();
  if (!trimmed || !HAS_EXPLICIT_TZ_SUFFIX_RE.test(trimmed)) return null;
  const normalized = trimmed.includes(" ") && !trimmed.includes("T") ? trimmed.replace(" ", "T") : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}
function stripTimezoneSuffix(iso) {
  const trimmed = String(iso || "").trim().replace(" ", "T");
  const match = trimmed.match(WALL_CLOCK_PARTS_RE);
  if (match) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  return trimmed.replace(/\.\d+(?=(Z|[+-]\d{2}:?\d{2})?$)/i, "").replace(HAS_EXPLICIT_TZ_SUFFIX_RE, "");
}
function parseFloatingWallClockAsUtcMs(floatingIso) {
  const match = stripTimezoneSuffix(floatingIso).match(WALL_CLOCK_PARTS_RE);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4] || 0);
  const mm = Number(match[5] || 0);
  const ss = Number(match[6] || 0);
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  return Number.isFinite(ms) ? ms : null;
}
function resolveExplicitOffsetMinutes(input) {
  if (typeof input.timeZoneOffsetMins === "number" && Number.isFinite(input.timeZoneOffsetMins)) {
    return Math.max(-720, Math.min(840, Math.round(input.timeZoneOffsetMins)));
  }
  if (typeof input.utcOffsetSecs === "number" && Number.isFinite(input.utcOffsetSecs)) {
    return Math.max(-720, Math.min(840, Math.round(input.utcOffsetSecs / 60)));
  }
  return void 0;
}
function normalizeActivityTimestamps(input) {
  const rawLocal = typeof input.startDateLocal === "string" ? input.startDateLocal.trim() : "";
  const explicitOffsetMins = resolveExplicitOffsetMinutes(input);
  const validLatLng = Array.isArray(input.startLatLng) && input.startLatLng.length >= 2 && Number.isFinite(input.startLatLng[1]) && Math.abs(input.startLatLng[0]) <= 90 && Math.abs(input.startLatLng[1]) <= 180 && (Math.abs(input.startLatLng[0]) > 0.01 || Math.abs(input.startLatLng[1]) > 0.01);
  const localHasNonUtcOffset = /[+-]\d{2}:?\d{2}$/.test(rawLocal);
  const localEndsWithZ = /Z$/i.test(rawLocal);
  let resolvedUtcMs = typeof input.startDateUtcMs === "number" && Number.isFinite(input.startDateUtcMs) && input.startDateUtcMs > 0 ? Math.round(input.startDateUtcMs) : void 0;
  if (resolvedUtcMs === void 0 && input.startDateUtc) {
    const parsedUtc = parseIsoWithExplicitOffsetToUtcMs(
      HAS_EXPLICIT_TZ_SUFFIX_RE.test(input.startDateUtc.trim()) ? input.startDateUtc : `${input.startDateUtc.trim().replace(" ", "T")}Z`
    );
    if (parsedUtc !== null) resolvedUtcMs = parsedUtc;
  }
  if (resolvedUtcMs === void 0 && rawLocal && HAS_EXPLICIT_TZ_SUFFIX_RE.test(rawLocal)) {
    const parsedLocalOffset = parseIsoWithExplicitOffsetToUtcMs(rawLocal);
    if (parsedLocalOffset !== null) resolvedUtcMs = parsedLocalOffset;
  }
  if (resolvedUtcMs === void 0 && rawLocal && !localEndsWithZ) {
    const floatingUtcMs = parseFloatingWallClockAsUtcMs(rawLocal);
    if (floatingUtcMs !== null) {
      if (explicitOffsetMins !== void 0) {
        resolvedUtcMs = floatingUtcMs - explicitOffsetMins * 6e4;
      } else if (validLatLng) {
        resolvedUtcMs = floatingUtcMs - estimateUtcOffsetMinutesFromLon(input.startLatLng[1]) * 6e4;
      }
    }
  }
  let resolvedLocal = "";
  if (rawLocal && (localHasNonUtcOffset || !localEndsWithZ && rawLocal.length >= 10)) {
    resolvedLocal = stripTimezoneSuffix(rawLocal);
  } else if (resolvedUtcMs !== void 0) {
    if (explicitOffsetMins !== void 0) {
      resolvedLocal = formatWallClockIsoFromUtcMs(resolvedUtcMs, explicitOffsetMins);
    } else if (validLatLng) {
      resolvedLocal = formatWallClockIsoFromUtcMs(
        resolvedUtcMs,
        estimateUtcOffsetMinutesFromLon(input.startLatLng[1])
      );
    } else if (input.fallbackBrowserTz) {
      resolvedLocal = formatLocalWallClockFromDate(new Date(resolvedUtcMs));
    } else {
      resolvedLocal = formatWallClockIsoFromUtcMs(resolvedUtcMs, 0);
    }
  } else if (rawLocal) {
    resolvedLocal = stripTimezoneSuffix(rawLocal);
  } else {
    const nowMs = Date.now();
    resolvedLocal = formatLocalWallClockFromDate(new Date(nowMs));
    if (resolvedUtcMs === void 0) resolvedUtcMs = nowMs;
  }
  return {
    startDateLocal: resolvedLocal,
    ...resolvedUtcMs !== void 0 ? { startDateUtcMs: resolvedUtcMs } : {}
  };
}
function resolveActivityStartEpochMs(act) {
  if (!act) return 0;
  if (typeof act.startDateUtcMs === "number" && Number.isFinite(act.startDateUtcMs) && act.startDateUtcMs > 0) {
    return act.startDateUtcMs;
  }
  const parsed = act.startDateLocal ? Date.parse(act.startDateLocal) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
function resolveComparableUtcMs(act) {
  if (typeof act.startDateUtcMs === "number" && Number.isFinite(act.startDateUtcMs) && act.startDateUtcMs > 0) {
    return act.startDateUtcMs;
  }
  return parseIsoWithExplicitOffsetToUtcMs(act.startDateLocal);
}
function areActivityTimestampsClose(a, b, windowSecs = 300) {
  const utcA = resolveComparableUtcMs(a);
  const utcB = resolveComparableUtcMs(b);
  if (utcA !== null && utcB !== null) {
    return Math.abs(utcA - utcB) / 1e3 <= windowSecs;
  }
  if (!a.startDateLocal || !b.startDateLocal) return false;
  const parsedA = Date.parse(a.startDateLocal);
  const parsedB = Date.parse(b.startDateLocal);
  if (Number.isNaN(parsedA) || Number.isNaN(parsedB)) return false;
  return Math.abs(parsedA - parsedB) / 1e3 <= windowSecs;
}
function parseClientTzOffsetMins(raw) {
  if (raw === void 0 || raw === null || raw === "") return void 0;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n < -720 || n > 840) return void 0;
  return Math.round(n);
}

// server/garminConnectService.ts
var DEFAULT_GARMIN_OAUTH_KEY = process.env.GARMIN_CONSUMER_KEY || "";
var DEFAULT_GARMIN_OAUTH_SECRET = process.env.GARMIN_CONSUMER_SECRET || "";
var GARMIN_API_BASE = "https://connectapi.garmin.com";
var GARMIN_PERSONAL_API_BASE = "https://personal.connectapi.garmin.com";
var GARMIN_USER_AGENT = "com.garmin.android.apps.connectmobile";
var GARMIN_5_ZONE_HR_NAMES = [
  "Z1 Warm Up",
  "Z2 Easy",
  "Z3 Aerobic",
  "Z4 Threshold",
  "Z5 Maximum"
];
function percentEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
function parseJwtExp(jwtToken) {
  try {
    const parts = jwtToken.split(".");
    if (parts.length < 2) return void 0;
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp === "number" && payload.exp > 0) {
      return payload.exp;
    }
  } catch {
  }
  return void 0;
}
async function obtainGarminPersonalApiBearerToken(session, forceRefresh = false) {
  const apiKey = (session.personalApiKey || getEnvGarminPersonalApiKey() || "").trim();
  if (!apiKey) {
    throw new Error("No Garmin Personal API Key (GCDC_...) configured.");
  }
  const nowSecs = Math.floor(Date.now() / 1e3);
  if (!forceRefresh && session.personalBearerToken && session.personalBearerExpiresAt && session.personalBearerExpiresAt - 3600 > nowSecs) {
    return session.personalBearerToken;
  }
  const tokenUrl = `${GARMIN_PERSONAL_API_BASE}/personalapitoken-service/personal-api/personal-api-key/token`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${apiKey}`,
      Accept: "application/json, text/plain, */*"
    }
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Garmin Personal API key token exchange failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }
  const rawBody = (await resp.text()).trim();
  let accessToken = "";
  let expiresAt = nowSecs + 86400;
  if (rawBody.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawBody);
      accessToken = String(
        parsed.access_token || parsed.accessToken || parsed.token || ""
      ).trim();
      if (parsed.expires_at) {
        expiresAt = Number(parsed.expires_at);
      } else if (parsed.expires_in) {
        expiresAt = nowSecs + Number(parsed.expires_in);
      }
    } catch {
      accessToken = rawBody.replace(/^"|"$/g, "");
    }
  } else {
    accessToken = rawBody.replace(/^"|"$/g, "");
  }
  if (!accessToken) {
    throw new Error("Garmin Personal API token endpoint returned an empty token.");
  }
  const jwtExp = parseJwtExp(accessToken);
  if (jwtExp) {
    expiresAt = jwtExp;
  }
  session.personalApiKey = apiKey;
  session.personalBearerToken = accessToken;
  session.personalBearerExpiresAt = expiresAt;
  return accessToken;
}
async function fetchGarminPersonalApiJson(endpointPath, session) {
  let token = await obtainGarminPersonalApiBearerToken(session, false);
  const url = endpointPath.startsWith("http") ? endpointPath : `${GARMIN_PERSONAL_API_BASE}${endpointPath}`;
  const doGet = async (bearer, acceptHeader = "application/json") => fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: acceptHeader
    }
  });
  let resp = await doGet(token, "application/json");
  if (resp.status === 406) {
    resp = await doGet(token, "*/*");
  }
  if (resp.status === 401) {
    token = await obtainGarminPersonalApiBearerToken(session, true);
    resp = await doGet(token, "application/json");
    if (resp.status === 406) {
      resp = await doGet(token, "*/*");
    }
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Garmin Personal API GET ${endpointPath} failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}
function buildOAuth1Header(method, url, consumerKey, consumerSecret, token, tokenSecret, extraParams = {}) {
  const parsedUrl = new URL(url);
  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto3.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1e3).toString(),
    oauth_version: "1.0",
    ...extraParams
  };
  if (token) {
    oauthParams.oauth_token = token;
  }
  const allParams = { ...oauthParams };
  parsedUrl.searchParams.forEach((v, k) => {
    allParams[k] = v;
  });
  const sortedParamStr = Object.keys(allParams).sort().map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");
  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(sortedParamStr)
  ].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${tokenSecret ? percentEncode(tokenSecret) : ""}`;
  const signature = crypto3.createHmac("sha1", signingKey).update(baseString).digest("base64");
  oauthParams.oauth_signature = signature;
  const headerParts = Object.keys(oauthParams).sort().map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(", ");
  return `OAuth ${headerParts}`;
}
function getGarminSessionFilePath(dataDir, scopeKey) {
  const safeScope = scopeKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dataDir, `garmin_session_${safeScope}.json`);
}
function loadGarminSession(dataDir, scopeKey) {
  const vaultTenantKey = `garmin_${scopeKey}`;
  const fromVault = loadTenantVaultSync(vaultTenantKey, null);
  if (fromVault) return fromVault;
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs3.existsSync(filePath)) {
      const raw = fs3.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      saveTenantVaultSync(vaultTenantKey, parsed);
      fs3.unlinkSync(filePath);
      return parsed;
    }
  } catch {
  }
  return null;
}
function saveGarminSession(_dataDir, scopeKey, session) {
  saveTenantVaultSync(`garmin_${scopeKey}`, session);
}
async function saveGarminSessionAsync(_dataDir, scopeKey, session) {
  await saveTenantVaultAsync(`garmin_${scopeKey}`, session);
}
async function clearGarminSessionAsync(dataDir, scopeKey) {
  await deleteTenantVault(`garmin_${scopeKey}`);
  const filePath = getGarminSessionFilePath(dataDir, scopeKey);
  try {
    if (fs3.existsSync(filePath)) {
      fs3.unlinkSync(filePath);
    }
  } catch {
  }
}
async function refreshGarminOAuth2Token(session) {
  if (!session.oauth1Token || !session.oauth1TokenSecret) {
    return session;
  }
  const exchangeUrl = `${GARMIN_API_BASE}/oauth-service/oauth/exchange/user/2.0`;
  const authHeader = buildOAuth1Header(
    "POST",
    exchangeUrl,
    DEFAULT_GARMIN_OAUTH_KEY,
    DEFAULT_GARMIN_OAUTH_SECRET,
    session.oauth1Token,
    session.oauth1TokenSecret
  );
  const resp = await fetch(exchangeUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "User-Agent": GARMIN_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });
  if (!resp.ok) {
    throw new Error(`Garmin OAuth2 token refresh failed (${resp.status})`);
  }
  const data = await resp.json();
  if (data?.access_token) {
    session.oauth2AccessToken = data.access_token;
    session.oauth2RefreshToken = data.refresh_token || session.oauth2RefreshToken;
    session.oauth2ExpiresAt = Math.floor(Date.now() / 1e3) + Number(data.expires_in || 3600);
  }
  return session;
}
async function authenticateGarminConnect(params) {
  const rawPersonalKey = (params.personalApiKey || (params.directBearerToken?.trim().startsWith("GCDC_") ? params.directBearerToken : "") || "").trim();
  if (rawPersonalKey) {
    const session2 = {
      personalApiKey: rawPersonalKey,
      connectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await obtainGarminPersonalApiBearerToken(session2, true);
    const settings = await fetchGarminPersonalApiJson(
      "/userprofile-service/userprofile/settings",
      session2
    ).catch(() => null);
    if (settings) {
      const displayName = settings.displayName || settings.userData?.displayName || settings.fullName || "Garmin Athlete";
      session2.displayName = displayName;
      session2.fullName = settings.fullName || displayName;
    }
    return session2;
  }
  if (params.directBearerToken?.trim()) {
    const cleanToken = params.directBearerToken.trim().replace(/^Bearer\s+/i, "");
    const session2 = {
      email: params.email?.trim() || void 0,
      oauth2AccessToken: cleanToken,
      oauth1Token: params.oauth1Token?.trim() || void 0,
      oauth1TokenSecret: params.oauth1TokenSecret?.trim() || void 0,
      oauth2ExpiresAt: Math.floor(Date.now() / 1e3) + 86400,
      connectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const profile2 = await fetchGarminJson(
      "/userprofile-service/socialProfile",
      session2
    ).catch(() => null);
    if (profile2) {
      session2.displayName = profile2.displayName || profile2.userName;
      session2.fullName = profile2.fullName || profile2.displayName;
    }
    return session2;
  }
  if (params.oauth1Token?.trim() && params.oauth1TokenSecret?.trim()) {
    const session2 = {
      email: params.email?.trim() || void 0,
      oauth1Token: params.oauth1Token.trim(),
      oauth1TokenSecret: params.oauth1TokenSecret.trim(),
      connectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await refreshGarminOAuth2Token(session2);
    const profile2 = await fetchGarminJson(
      "/userprofile-service/socialProfile",
      session2
    ).catch(() => null);
    if (profile2) {
      session2.displayName = profile2.displayName || profile2.userName;
      session2.fullName = profile2.fullName || profile2.displayName;
    }
    return session2;
  }
  const email = (params.email || "").trim();
  const password = params.password || "";
  if (!email || !password) {
    throw new Error(
      "Please provide your Garmin Personal API Key (GCDC_...), or your Garmin email & password."
    );
  }
  const ssoEmbedParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: "https://sso.garmin.com/sso"
  });
  const ssoSignInParams = new URLSearchParams({
    id: "gauth-widget",
    embedWidget: "true",
    gauthHost: "https://sso.garmin.com/sso/embed",
    service: "https://sso.garmin.com/sso/embed",
    source: "https://sso.garmin.com/sso/embed",
    redirectAfterAccountLoginUrl: "https://sso.garmin.com/sso/embed",
    redirectAfterAccountCreationUrl: "https://sso.garmin.com/sso/embed"
  });
  const embedResp = await fetch(
    `https://sso.garmin.com/sso/embed?${ssoEmbedParams.toString()}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
      }
    }
  );
  const embedCookies = embedResp.headers.get("set-cookie") || "";
  const signinPageResp = await fetch(
    `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        Cookie: embedCookies,
        Referer: `https://sso.garmin.com/sso/embed?${ssoEmbedParams.toString()}`
      }
    }
  );
  const signinHtml = await signinPageResp.text();
  const signinCookies = [
    embedCookies,
    signinPageResp.headers.get("set-cookie") || ""
  ].filter(Boolean).join("; ");
  const csrfMatch = signinHtml.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : "";
  const formBody = new URLSearchParams({
    username: email,
    password,
    embed: "true",
    _csrf: csrfToken
  });
  const loginResp = await fetch(
    `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        Cookie: signinCookies,
        Origin: "https://sso.garmin.com",
        Referer: `https://sso.garmin.com/sso/signin?${ssoSignInParams.toString()}`
      },
      body: formBody.toString()
    }
  );
  const loginHtml = await loginResp.text();
  const ticketMatch = loginHtml.match(/ticket=([A-Za-z0-9-]+-[A-Za-z0-9.-]+)/);
  if (!ticketMatch) {
    throw new Error(
      "Garmin SSO requires MFA on this account. Please paste your Garmin Personal API Key (GCDC_...) instead."
    );
  }
  const ticket = ticketMatch[1];
  const preauthUrl = `${GARMIN_API_BASE}/oauth-service/oauth/preauthorized?ticket=${encodeURIComponent(
    ticket
  )}&login-url=https://sso.garmin.com/sso/embed&accepts-mfa-tokens=true`;
  const oauth1Header = buildOAuth1Header(
    "GET",
    preauthUrl,
    DEFAULT_GARMIN_OAUTH_KEY,
    DEFAULT_GARMIN_OAUTH_SECRET
  );
  const preauthResp = await fetch(preauthUrl, {
    headers: {
      Authorization: oauth1Header,
      "User-Agent": GARMIN_USER_AGENT
    }
  });
  if (!preauthResp.ok) {
    throw new Error(`Garmin OAuth1 exchange failed (${preauthResp.status})`);
  }
  const preauthQuery = new URLSearchParams(await preauthResp.text());
  const oauth1Token = preauthQuery.get("oauth_token") || "";
  const oauth1TokenSecret = preauthQuery.get("oauth_token_secret") || "";
  if (!oauth1Token || !oauth1TokenSecret) {
    throw new Error("Garmin OAuth1 response missing token pair.");
  }
  const session = {
    email,
    oauth1Token,
    oauth1TokenSecret,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await refreshGarminOAuth2Token(session);
  const profile = await fetchGarminJson(
    "/userprofile-service/socialProfile",
    session
  ).catch(() => null);
  if (profile) {
    session.displayName = profile.displayName || profile.userName;
    session.fullName = profile.fullName || profile.displayName;
  }
  return session;
}
async function fetchGarminJson(endpointPath, session, options = {}) {
  const nowSec = Math.floor(Date.now() / 1e3);
  if ((!session.oauth2AccessToken || session.oauth2ExpiresAt && session.oauth2ExpiresAt - 120 < nowSec) && session.oauth1Token && session.oauth1TokenSecret) {
    await refreshGarminOAuth2Token(session);
  }
  if (!session.oauth2AccessToken) {
    throw new Error("No active Garmin Connect OAuth2 token available.");
  }
  const url = endpointPath.startsWith("http") ? endpointPath : `${GARMIN_API_BASE}${endpointPath}`;
  const doRequest = async (token) => fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "DI-Backend": "connectapi.garmin.com",
      "User-Agent": GARMIN_USER_AGENT,
      Accept: "application/json",
      ...options.body ? { "Content-Type": "application/json" } : {}
    },
    body: options.body ? JSON.stringify(options.body) : void 0
  });
  let resp = await doRequest(session.oauth2AccessToken);
  if (resp.status === 401 && session.oauth1Token && session.oauth1TokenSecret) {
    await refreshGarminOAuth2Token(session);
    if (session.oauth2AccessToken) {
      resp = await doRequest(session.oauth2AccessToken);
    }
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Garmin Connect API ${options.method || "GET"} ${endpointPath} failed (${resp.status}): ${errText.slice(0, 180)}`
    );
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : {};
}
async function pushWorkoutToGarminConnect(session, input) {
  if (!session.oauth2AccessToken && !session.oauth1Token) {
    throw new Error(
      'Garmin Personal API keys (GCDC_...) are read-only per Garmin policy. To send this workout to your Garmin watch or Edge head unit, click "Export Garmin .FIT" (or keep Intervals.icu Garmin workout upload enabled).'
    );
  }
  const isRunning = String(input.sportCategory).toLowerCase().includes("run");
  const sportType = isRunning ? { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 } : { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 };
  const activeFtp = Math.max(100, Number(input.ftpWatts || 250));
  const totalSteps = input.steps.length;
  const executableSteps = input.steps.map((s, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === totalSteps - 1 && totalSteps > 1;
    const pct = Number(s.targetPctFtp || 70);
    let stepTypeKey = s.stepType || "interval";
    if (!s.stepType) {
      if (isFirst) stepTypeKey = "warmup";
      else if (isLast) stepTypeKey = "cooldown";
      else if (pct <= 60 || /recov|easy|rest/i.test(s.label))
        stepTypeKey = "recovery";
      else stepTypeKey = "interval";
    }
    const stepTypeIdMap = {
      warmup: 1,
      cooldown: 2,
      interval: 3,
      recovery: 4
    };
    const centerWatts = Number(s.targetWatts) > 0 ? Math.round(Number(s.targetWatts)) : Math.round(pct / 100 * activeFtp);
    const lowWatts = Number(s.targetMinWatts) > 0 ? Math.round(Number(s.targetMinWatts)) : Math.max(40, centerWatts - 10);
    const highWatts = Number(s.targetMaxWatts) > 0 ? Math.round(Number(s.targetMaxWatts)) : centerWatts + 10;
    return {
      type: "ExecutableStepDTO",
      stepId: null,
      stepOrder: idx + 1,
      stepType: {
        stepTypeId: stepTypeIdMap[stepTypeKey] || 3,
        stepTypeKey,
        displayOrder: stepTypeIdMap[stepTypeKey] || 3
      },
      childStepId: null,
      description: `${s.label}${s.hrCeilingBpm ? ` (HR <= ${s.hrCeilingBpm} bpm)` : ""}`,
      endCondition: {
        conditionTypeId: 2,
        conditionTypeKey: "time",
        displayOrder: 2,
        displayable: true
      },
      endConditionValue: Math.max(30, Math.round(s.durationSecs)),
      preferredEndConditionUnit: null,
      endConditionCompare: null,
      targetType: {
        workoutTargetTypeId: 2,
        workoutTargetTypeKey: "power.zone",
        displayOrder: 2
      },
      targetValueOne: lowWatts,
      targetValueTwo: highWatts,
      zoneNumber: null
    };
  });
  const estimatedDurationInSecs = executableSteps.reduce(
    (acc, s) => acc + s.endConditionValue,
    0
  );
  const workoutPayload = {
    sportType,
    subSportType: null,
    workoutName: input.name.slice(0, 64),
    description: (input.description || "Prescribed by THRESH Readiness Engine").slice(
      0,
      512
    ),
    estimatedDurationInSecs,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType,
        workoutSteps: executableSteps
      }
    ]
  };
  const createdWorkout = await fetchGarminJson(
    "/workout-service/workout",
    session,
    {
      method: "POST",
      body: workoutPayload
    }
  );
  const workoutId = createdWorkout?.workoutId;
  if (!workoutId) {
    throw new Error("Garmin Connect did not return a workoutId.");
  }
  const scheduled = await fetchGarminJson(
    `/workout-service/schedule/${encodeURIComponent(String(workoutId))}`,
    session,
    {
      method: "POST",
      body: { date: input.date.slice(0, 10) }
    }
  );
  return {
    pushed: true,
    workoutId,
    scheduleId: scheduled?.workoutScheduleId || workoutId,
    message: `Pushed "${input.name}" directly to Garmin Connect Calendar (${input.date.slice(0, 10)}) \u2014 ready to sync to your Garmin watch & Edge head unit.`
  };
}
async function fetchDirectGarminProfileAndWellness(session, daysToFetch = 28) {
  const endDate = new Date(Date.now() + 86400 * 1e3).toISOString().slice(0, 10);
  const startDate = new Date(
    Date.now() - Math.min(daysToFetch, 30) * 86400 * 1e3
  ).toISOString().slice(0, 10);
  const weightStart180d = new Date(Date.now() - 180 * 86400 * 1e3).toISOString().slice(0, 10);
  if (session.personalApiKey || process.env.GARMIN_PERSONAL_API_KEY) {
    const [
      profileSettings,
      hrZonesData,
      weightRangeData,
      fitnessAgeData,
      sleepSummaries,
      hrvSummaries,
      dailySummaries,
      activitiesData
    ] = await Promise.all([
      fetchGarminPersonalApiJson(
        "/userprofile-service/userprofile/settings",
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        "/biometric-service/heartRateZones/v2",
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/weight-service/weight/range/${weightStart180d}/${endDate}?includeAll=true`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/fitnessage-service/fitnessage/v2/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/hrv-service/hrv/daily/${startDate}/${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/usersummary-service/v2/dailysummaries?startDate=${startDate}&endDate=${endDate}`,
        session
      ).catch(() => null),
      fetchGarminPersonalApiJson(
        `/activitylist-service/activities/search/activities?start=0&limit=100`,
        session
      ).catch(() => null)
    ]);
    const userData2 = profileSettings?.userData || profileSettings || {};
    let weightKg2;
    const weightList = weightRangeData?.dailyWeightSummaries || weightRangeData?.dateWeightList || (Array.isArray(weightRangeData) ? weightRangeData : []);
    if (Array.isArray(weightList) && weightList.length > 0) {
      const sortedWeights = [...weightList].sort((a, b) => {
        const dA = String(
          a?.summaryDate || a?.calendarDate || a?.latestWeight?.calendarDate || ""
        );
        const dB = String(
          b?.summaryDate || b?.calendarDate || b?.latestWeight?.calendarDate || ""
        );
        return dB.localeCompare(dA);
      });
      for (let i = 0; i < sortedWeights.length; i++) {
        const wItem = sortedWeights[i];
        const rawW = Number(
          wItem?.latestWeight?.weight ?? wItem?.summaryWeight ?? wItem?.weight ?? 0
        );
        if (rawW > 1e3) {
          weightKg2 = Number((rawW / 1e3).toFixed(1));
          break;
        } else if (rawW >= 35 && rawW <= 180) {
          weightKg2 = Number(rawW.toFixed(1));
          break;
        }
      }
    }
    if (!weightKg2) {
      const rawProfileWeight = Number(userData2.weight ?? 0);
      if (rawProfileWeight > 1e3) {
        weightKg2 = Number((rawProfileWeight / 1e3).toFixed(1));
      } else if (rawProfileWeight >= 35 && rawProfileWeight <= 180) {
        weightKg2 = Number(rawProfileWeight.toFixed(1));
      }
    }
    const zonesArray = Array.isArray(hrZonesData) ? hrZonesData : Array.isArray(hrZonesData?.heartRateZones) ? hrZonesData.heartRateZones : hrZonesData ? [hrZonesData] : [];
    const cyclingZoneObj = zonesArray.find(
      (z) => /cycling|bike|ride/i.test(String(z?.sport || z?.sportType || ""))
    ) || zonesArray.find(
      (z) => /default/i.test(String(z?.sport || z?.sportType || ""))
    ) || zonesArray[0] || {};
    const runningZoneObj = zonesArray.find(
      (z) => /running|run/i.test(String(z?.sport || z?.sportType || ""))
    ) || cyclingZoneObj || {};
    const bikeLthr = Number(
      cyclingZoneObj.lactateThresholdHeartRateUsed ?? cyclingZoneObj.lactateThresholdHeartRate ?? userData2.lactateThresholdHeartRate ?? 0
    );
    const bikeMaxHr = Number(
      cyclingZoneObj.maxHeartRateUsed ?? cyclingZoneObj.maxHeartRate ?? userData2.maxHeartRate ?? 0
    );
    const runLthr = Number(
      runningZoneObj.lactateThresholdHeartRateUsed ?? runningZoneObj.lactateThresholdHeartRate ?? bikeLthr ?? 0
    );
    const runMaxHr = Number(
      runningZoneObj.maxHeartRateUsed ?? runningZoneObj.maxHeartRate ?? bikeMaxHr ?? 0
    );
    const fitnessAgeRhr = Number(fitnessAgeData?.components?.rhr?.value ?? 0);
    const restingHrFromZones = Number(
      (fitnessAgeRhr >= 30 ? fitnessAgeRhr : 0) || cyclingZoneObj.restingHeartRateUsed || cyclingZoneObj.restingHeartRate || userData2.restingHeartRate || 0
    );
    const bikeHrFloors = [];
    const bikeHrCeilings = [];
    if (cyclingZoneObj.zone1Floor && cyclingZoneObj.zone2Floor && cyclingZoneObj.zone3Floor && cyclingZoneObj.zone4Floor && cyclingZoneObj.zone5Floor) {
      bikeHrFloors.push(
        Number(cyclingZoneObj.zone1Floor),
        Number(cyclingZoneObj.zone2Floor),
        Number(cyclingZoneObj.zone3Floor),
        Number(cyclingZoneObj.zone4Floor),
        Number(cyclingZoneObj.zone5Floor)
      );
      bikeHrCeilings.push(
        Number(cyclingZoneObj.zone2Floor) - 1,
        Number(cyclingZoneObj.zone3Floor) - 1,
        Number(cyclingZoneObj.zone4Floor) - 1,
        Number(cyclingZoneObj.zone5Floor) - 1,
        bikeMaxHr > 140 ? bikeMaxHr : Number(cyclingZoneObj.zone5Floor) + 15
      );
    }
    const runHrFloors = [];
    const runHrCeilings = [];
    if (runningZoneObj.zone1Floor && runningZoneObj.zone2Floor && runningZoneObj.zone3Floor && runningZoneObj.zone4Floor && runningZoneObj.zone5Floor) {
      runHrFloors.push(
        Number(runningZoneObj.zone1Floor),
        Number(runningZoneObj.zone2Floor),
        Number(runningZoneObj.zone3Floor),
        Number(runningZoneObj.zone4Floor),
        Number(runningZoneObj.zone5Floor)
      );
      runHrCeilings.push(
        Number(runningZoneObj.zone2Floor) - 1,
        Number(runningZoneObj.zone3Floor) - 1,
        Number(runningZoneObj.zone4Floor) - 1,
        Number(runningZoneObj.zone5Floor) - 1,
        runMaxHr > 140 ? runMaxHr : Number(runningZoneObj.zone5Floor) + 15
      );
    }
    const wellnessByDate = /* @__PURE__ */ new Map();
    const ensureDay = (d) => {
      const dateStr = String(d || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
      if (!wellnessByDate.has(dateStr)) {
        wellnessByDate.set(dateStr, {
          id: dateStr,
          weight: weightKg2
        });
      }
      return wellnessByDate.get(dateStr);
    };
    const dailyList = Array.isArray(dailySummaries) ? dailySummaries : Array.isArray(dailySummaries?.dailySummaries) ? dailySummaries.dailySummaries : Array.isArray(dailySummaries?.summaries) ? dailySummaries.summaries : [];
    for (const ds of dailyList) {
      const row = ensureDay(ds?.calendarDate || ds?.date || ds?.startTimeLocal);
      if (!row) continue;
      const rhr = Number(
        ds?.restingHeartRate ?? ds?.minHeartRate ?? ds?.currentDayRestingHeartRate ?? 0
      );
      if (rhr >= 30 && rhr <= 110) row.restingHR = rhr;
      if (Number(ds?.totalSteps) > 0) row.steps = Number(ds.totalSteps);
      if (Number(ds?.bodyBatteryHighestValue) > 0) {
        row.bodyBatteryHigh = Number(ds.bodyBatteryHighestValue);
      }
    }
    const sleepList = Array.isArray(sleepSummaries) ? sleepSummaries : Array.isArray(sleepSummaries?.dailySleepDTOs) ? sleepSummaries.dailySleepDTOs : Array.isArray(sleepSummaries?.sleepSummaries) ? sleepSummaries.sleepSummaries : [];
    for (const sl of sleepList) {
      const dto = sl?.dailySleepDTO || sl;
      const row = ensureDay(dto?.calendarDate || dto?.date);
      if (!row) continue;
      const sleepSecs = Number(
        dto?.sleepTimeSeconds ?? dto?.durationInSeconds ?? 0
      );
      if (sleepSecs > 0) row.sleepSecs = sleepSecs;
      const score = Number(
        dto?.sleepScores?.overall?.value ?? dto?.overallSleepScore?.value ?? dto?.sleepScore ?? 0
      );
      if (score > 0) {
        row.sleepScore = score;
      } else if (sleepSecs > 0) {
        const deepPct = sleepSecs > 0 ? Number(dto?.deepSleepSeconds || 0) / sleepSecs : 0.18;
        const remPct = sleepSecs > 0 ? Number(dto?.remSleepSeconds || 0) / sleepSecs : 0.2;
        const durRatio = Math.min(1.05, sleepSecs / (7.8 * 3600));
        row.sleepScore = Math.max(
          45,
          Math.min(
            98,
            Math.round(durRatio * 68 + Math.min(0.25, deepPct) * 65 + Math.min(0.25, remPct) * 65)
          )
        );
      }
      if (Number(dto?.deepSleepSeconds) >= 0)
        row.deepSleepSecs = Number(dto.deepSleepSeconds);
      if (Number(dto?.remSleepSeconds) >= 0)
        row.remSleepSecs = Number(dto.remSleepSeconds);
      if (Number(dto?.lightSleepSeconds) >= 0)
        row.lightSleepSecs = Number(dto.lightSleepSeconds);
      if (Number(dto?.awakeSleepSeconds) >= 0)
        row.awakeSecs = Number(dto.awakeSleepSeconds);
      if (Number(dto?.avgOvernightHrv) > 0)
        row.hrv = Number(dto.avgOvernightHrv);
      if (Number(dto?.restingHeartRate) >= 30 && !row.restingHR)
        row.restingHR = Number(dto.restingHeartRate);
    }
    const hrvList = Array.isArray(hrvSummaries) ? hrvSummaries : Array.isArray(hrvSummaries?.hrvSummaries) ? hrvSummaries.hrvSummaries : [];
    for (const h of hrvList) {
      const hDto = h?.hrvSummary || h;
      const row = ensureDay(hDto?.calendarDate || hDto?.date);
      if (!row) continue;
      const hrvVal = Number(
        hDto?.lastNightAvg ?? hDto?.weeklyAvg ?? hDto?.hrvValue ?? 0
      );
      if (hrvVal > 0) row.hrv = hrvVal;
      if (Number(hDto?.weeklyAvg) > 0) {
        row.hrvBaseline7d = Number(hDto.weeklyAvg);
      }
      if (Number(hDto?.baseline?.balancedLow) > 0) {
        row.hrvNormalLow = Number(hDto.baseline.balancedLow);
      }
      if (Number(hDto?.baseline?.balancedUpper) > 0) {
        row.hrvNormalHigh = Number(hDto.baseline.balancedUpper);
      }
      if (hDto?.status) row.garminHrvStatus = String(hDto.status);
    }
    const wellnessRows2 = Array.from(wellnessByDate.values()).sort(
      (a, b) => String(a.id).localeCompare(String(b.id))
    );
    const latestRhr = (restingHrFromZones >= 30 ? restingHrFromZones : void 0) || wellnessRows2.slice().reverse().find((w) => Number(w.restingHR) >= 30)?.restingHR;
    const rawActivitiesList = Array.isArray(activitiesData) ? activitiesData : Array.isArray(activitiesData?.activities) ? activitiesData.activities : [];
    const activityOwnerFullName = rawActivitiesList.find(
      (a) => a?.ownerFullName && typeof a.ownerFullName === "string" && a.ownerFullName.trim().length > 1
    )?.ownerFullName;
    const activityOwnerId = rawActivitiesList.find((a) => a?.ownerId)?.ownerId;
    const resolvedFullName = activityOwnerFullName || profileSettings?.fullName || userData2?.fullName || session.fullName || profileSettings?.displayName || session.displayName;
    if (resolvedFullName) {
      session.fullName = resolvedFullName;
    }
    let maxBike20mPower = 0;
    let maxBikePeakPower = 0;
    let maxRunSustainedPower = 0;
    let bestRun5kSecs = 0;
    for (const a of rawActivitiesList) {
      if (!a) continue;
      const typeKey = String(
        a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ""
      ).toLowerCase();
      const actName = String(a.activityName || a.name || "").toLowerCase();
      const combined = `${typeKey} ${actName}`;
      const isBike = /cycling|ride|biking|virtual_ride|indoor_cycling|road_biking|gravel|mountain_biking|zwift|peloton|spin/i.test(
        combined
      );
      const isRun = /running|run|treadmill|trail_running|track_running|virtual_run/i.test(combined);
      const dur = Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0);
      if (isBike) {
        const p20 = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
        const avgP = Number(a.avgPower ?? 0);
        const np = Number(a.normPower ?? a.avgPower ?? 0);
        const sustainedW = avgP > 0 && np > avgP * 1.08 ? Math.round(avgP * 1.05) : np;
        const peakP = Number(a.maxPower ?? a.maxAvgPower_1 ?? 0);
        if (p20 >= 80 && p20 <= 600) {
          if (p20 > maxBike20mPower) maxBike20mPower = p20;
        } else if (dur >= 1200 && sustainedW >= 80 && sustainedW <= 600 && sustainedW > maxBike20mPower) {
          maxBike20mPower = sustainedW;
        }
        if (peakP >= 250 && peakP <= 2500 && peakP > maxBikePeakPower) {
          maxBikePeakPower = peakP;
        }
      } else if (isRun) {
        const runNp = Number(a.normPower ?? a.avgPower ?? 0);
        if (dur >= 1200 && runNp >= 120 && runNp <= 650 && runNp > maxRunSustainedPower) {
          maxRunSustainedPower = runNp;
        }
        const split5k = Number(a.fastestSplit_5000 ?? 0);
        const dist = Number(a.distance ?? 0);
        if (split5k >= 780 && split5k <= 2700) {
          if (bestRun5kSecs === 0 || split5k < bestRun5kSecs) {
            bestRun5kSecs = split5k;
          }
        } else if (dist >= 4500 && dur >= 900) {
          const equiv5k = dur / dist * 5e3;
          if (equiv5k >= 780 && equiv5k <= 2700 && (bestRun5kSecs === 0 || equiv5k < bestRun5kSecs)) {
            bestRun5kSecs = equiv5k;
          }
        }
      }
    }
    const derivedBikeFtp = Number(userData2.ftp) > 60 ? Math.round(Number(userData2.ftp)) : maxBike20mPower >= 90 ? Math.round(maxBike20mPower * 0.95) : void 0;
    const derivedBikePMax = maxBikePeakPower >= 350 ? Math.round(maxBikePeakPower) : void 0;
    const derivedBikeWPrime = derivedBikeFtp && derivedBikeFtp > 60 ? Math.round(derivedBikeFtp * 75) : void 0;
    const derivedRunThresholdPace = bestRun5kSecs > 0 ? Math.round(bestRun5kSecs / 5 * 1.03) : void 0;
    const derivedRunFtp = maxRunSustainedPower >= 140 ? Math.round(maxRunSustainedPower * 0.92) : void 0;
    const rawProfile2 = {
      id: activityOwnerId || profileSettings?.id || "garmin-personal-api",
      name: resolvedFullName,
      weight: weightKg2,
      icu_resting_hr: latestRhr,
      ftp: derivedBikeFtp,
      eFtp: derivedBikeFtp,
      pMax: derivedBikePMax,
      wPrime: derivedBikeWPrime,
      runFtp: derivedRunFtp,
      thresholdPaceSecsPerKm: derivedRunThresholdPace,
      sportSettings: [
        {
          types: ["Ride", "VirtualRide"],
          ftp: derivedBikeFtp,
          eftp: derivedBikeFtp,
          p_max: derivedBikePMax,
          w_prime: derivedBikeWPrime,
          lthr: bikeLthr > 110 ? bikeLthr : bikeMaxHr > 140 ? Math.round(bikeMaxHr * 0.89) : void 0,
          max_hr: bikeMaxHr > 130 ? bikeMaxHr : void 0,
          hr_zones: bikeHrCeilings.length >= 5 ? bikeHrCeilings : void 0,
          hr_zone_floors: bikeHrFloors.length >= 5 ? bikeHrFloors : void 0,
          hr_zone_names: bikeHrCeilings.length === 5 ? GARMIN_5_ZONE_HR_NAMES : void 0
        },
        {
          types: ["Run", "VirtualRun"],
          ftp: derivedRunFtp,
          eftp: derivedRunFtp,
          threshold_pace: derivedRunThresholdPace,
          lthr: runLthr > 110 ? runLthr : runMaxHr > 140 ? Math.round(runMaxHr * 0.9) : void 0,
          max_hr: runMaxHr > 130 ? runMaxHr : void 0,
          hr_zones: runHrCeilings.length >= 5 ? runHrCeilings : void 0,
          hr_zone_floors: runHrFloors.length >= 5 ? runHrFloors : void 0,
          hr_zone_names: runHrCeilings.length === 5 ? GARMIN_5_ZONE_HR_NAMES : void 0
        }
      ]
    };
    session.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
    return { rawProfile: rawProfile2, wellnessRows: wellnessRows2, activities: rawActivitiesList };
  }
  const [socialProfile, personalInfo, userSettings, latestFtp, latestLthr] = await Promise.all([
    fetchGarminJson("/userprofile-service/socialProfile", session).catch(
      () => null
    ),
    fetchGarminJson(
      "/userprofile-service/userprofile/personal-information",
      session
    ).catch(() => null),
    fetchGarminJson(
      "/userprofile-service/userprofile/user-settings",
      session
    ).catch(() => null),
    fetchGarminJson(
      "/biometric-service/biometric/powerToWeight/latest",
      session
    ).catch(() => null),
    fetchGarminJson(
      "/biometric-service/biometric/lactateThreshold/latest",
      session
    ).catch(() => null)
  ]);
  const userData = userSettings?.userData || {};
  const bioInfo = personalInfo?.biometricProfile || {};
  const rawWeightGrams = Number(
    userData.weight ?? bioInfo.weight ?? personalInfo?.weight ?? 0
  );
  const weightKg = rawWeightGrams > 1e3 ? Number((rawWeightGrams / 1e3).toFixed(1)) : rawWeightGrams >= 35 && rawWeightGrams <= 180 ? Number(rawWeightGrams.toFixed(1)) : void 0;
  const ftp = Number(
    latestFtp?.functionalThresholdPower ?? userData.ftp ?? bioInfo.functionalThresholdPower ?? 0
  );
  const lthrBpm = Number(
    latestLthr?.heartRate ?? latestLthr?.lactateThresholdHeartRate ?? userData.lactateThresholdHeartRate ?? 0
  );
  const maxHr = Number(userData.maxHeartRate ?? bioInfo.maxHeartRate ?? 0);
  const restingHr = Number(
    userData.restingHeartRate ?? bioInfo.restingHeartRate ?? 0
  );
  const vo2MaxCycling = Number(
    userData.vo2MaxCycling ?? userData.vo2Max ?? 0
  );
  const vo2MaxRunning = Number(
    userData.vo2MaxRunning ?? userData.vo2Max ?? 0
  );
  const name = socialProfile?.fullName || personalInfo?.userInfo?.fullName || socialProfile?.displayName || session.fullName || session.displayName;
  if (name) {
    session.fullName = name;
    session.displayName = socialProfile?.displayName || name;
  }
  const today = /* @__PURE__ */ new Date();
  const dateStrings = [];
  for (let i = Math.min(daysToFetch, 14) - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400 * 1e3);
    dateStrings.push(d.toISOString().slice(0, 10));
  }
  const wellnessRows = [];
  for (const dateStr of dateStrings) {
    const [sleepData, hrvData] = await Promise.all([
      fetchGarminJson(
        `/wellness-service/wellness/dailySleepData?date=${dateStr}&nonSleepBufferMinutes=60`,
        session
      ).catch(() => null),
      fetchGarminJson(`/hrv-service/hrv/${dateStr}`, session).catch(() => null)
    ]);
    const sleepDto = sleepData?.dailySleepDTO;
    const hrvSummary = hrvData?.hrvSummary;
    if (sleepDto || hrvSummary) {
      wellnessRows.push({
        id: dateStr,
        weight: weightKg,
        restingHR: sleepData?.restingHeartRate ?? sleepDto?.restingHeartRate ?? (restingHr > 30 ? restingHr : void 0),
        hrv: hrvSummary?.lastNightAvg ?? sleepData?.avgOvernightHrv ?? void 0,
        sleepSecs: sleepDto?.sleepTimeSeconds ?? void 0,
        sleepScore: sleepDto?.sleepScores?.overall?.value ?? sleepDto?.overallSleepScore?.value ?? void 0,
        vo2max: vo2MaxCycling > 20 ? vo2MaxCycling : vo2MaxRunning > 20 ? vo2MaxRunning : void 0
      });
    }
  }
  const rawProfile = {
    id: socialProfile?.profileId || session.email || "garmin-direct",
    name,
    weight: weightKg,
    icu_resting_hr: restingHr > 30 ? restingHr : void 0,
    vo2max: vo2MaxCycling > 20 ? vo2MaxCycling : void 0,
    sportSettings: [
      {
        types: ["Ride", "VirtualRide"],
        ftp: ftp > 60 ? ftp : void 0,
        lthr: lthrBpm > 110 ? lthrBpm : void 0,
        max_hr: maxHr > 130 ? maxHr : void 0
      },
      {
        types: ["Run", "VirtualRun"],
        lthr: lthrBpm > 110 ? lthrBpm : void 0,
        max_hr: maxHr > 130 ? maxHr : void 0
      }
    ]
  };
  session.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
  return { rawProfile, wellnessRows, activities: [] };
}
function getEnvGarminPersonalApiKey() {
  if (process.env.ALLOW_DEV_ENV_CREDENTIALS !== "true") {
    return "";
  }
  return String(process.env.GARMIN_PERSONAL_API_KEY || "").trim();
}
function normalizeGarminPersonalApiActivities(rawActivities, ftpWatts = 250, calibrationOpts) {
  if (!Array.isArray(rawActivities)) return [];
  const activeFtp = Math.max(120, Number(ftpWatts || 250));
  return rawActivities.filter((a) => a && (a.activityId || a.id)).map((a) => {
    const id = String(a.activityId || a.id);
    const typeKey = String(
      a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ""
    ).toLowerCase();
    const name = String(a.activityName || a.name || typeKey || "Garmin Activity");
    const combined = `${typeKey} ${name}`.toLowerCase();
    const startLat = Number(a.startLatitude ?? 0);
    const startLng = Number(a.startLongitude ?? 0);
    const hasGps = Boolean((startLat || startLng) && !(startLat === 0 && startLng === 0));
    const isWatopiaOrMakuri = startLat >= -12.6 && startLat <= -9.8 && startLng >= 164.8 && startLng <= 168;
    const isVirtualPlatform = isWatopiaOrMakuri || /virtual_ride|virtual|zwift|watopia|makuri|rouvy|mywhoosh|trainerroad/i.test(combined);
    const classified = classifyMultiSportActivity(typeKey, name, {
      trainer: isVirtualPlatform || /indoor|treadmill|virtual|trainer|spin|peloton|gym|strength|yoga/i.test(combined),
      hasGps,
      isVirtualPlatform
    });
    const sportCategory = classified.sportCategory;
    const isEBike = classified.subType === "EBike";
    const isIndoor = classified.environment === "INDOOR";
    const subType = classified.subType;
    const movingTimeSecs = Math.round(
      Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0)
    );
    const distanceMeters = Math.round(Number(a.distance ?? 0));
    const elevationGainMeters = Math.round(Number(a.elevationGain ?? 0));
    const rawAvgPower = Number(a.avgPower) > 0 ? Math.round(Number(a.avgPower)) : void 0;
    const rawNormalizedPower = Number(a.normPower) > 0 ? Math.round(Number(a.normPower)) : rawAvgPower;
    const avgPower = isEBike ? void 0 : rawAvgPower;
    const normalizedPower = isEBike ? void 0 : rawNormalizedPower;
    const rawMaxPower = Number(a.maxPower ?? a.maxAvgPower_1 ?? 0);
    const maxPower = !isEBike && rawMaxPower > 0 ? Math.round(rawMaxPower) : void 0;
    const rawMax20m = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
    const max20MinPower = !isEBike && rawMax20m > 0 ? Math.round(rawMax20m) : void 0;
    const fastestSplit1000 = Number(a.fastestSplit_1000) > 0 ? Math.round(Number(a.fastestSplit_1000)) : void 0;
    const fastestSplit1609 = Number(a.fastestSplit_1609) > 0 ? Math.round(Number(a.fastestSplit_1609)) : void 0;
    const fastestSplit5000 = Number(a.fastestSplit_5000) > 0 ? Math.round(Number(a.fastestSplit_5000)) : void 0;
    const avgHr = Math.round(Number(a.averageHR ?? 0));
    const maxHr = Math.round(Number(a.maxHR ?? 0));
    const avgCadence = Number(a.averageBikingCadenceInRevPerMinute) > 0 ? Math.round(Number(a.averageBikingCadenceInRevPerMinute)) : Number(a.averageRunningCadenceInStepsPerMinute) > 0 ? Math.round(Number(a.averageRunningCadenceInStepsPerMinute)) : void 0;
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
    const hasRealCyclingWatts = !isEBike && sportCategory === "Cycling" && Boolean(normalizedPower && normalizedPower > 0);
    const loadResult = computeStravaActivityLoadV2({
      sportCategory,
      rawSportType: typeKey || void 0,
      name,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters,
      normalizedPower,
      avgPower,
      hasRealDeviceWatts: hasRealCyclingWatts,
      avgHr,
      maxHr,
      avgPaceSecsPerKm,
      calibratedFtp: activeFtp,
      calibratedBikeLthr: calibrationOpts?.lthr || 163,
      calibratedRunLthr: calibrationOpts?.runLthr || 168,
      calibratedThresholdPaceSecsPerKm: calibrationOpts?.thresholdPaceSecsPerKm || 255,
      restingHr: calibrationOpts?.restingHr || 52
    });
    const intensityFactor = loadResult.intensityFactor;
    const trainingLoad = loadResult.trainingLoad;
    let efficiencyFactor = 0;
    if (hasRealCyclingWatts && normalizedPower && avgHr > 0) {
      efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
    } else if (sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 && avgHr > 0) {
      const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
      efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
    }
    const hrZones = [
      Math.round(Number(a.hrTimeInZone_1 ?? 0)),
      Math.round(Number(a.hrTimeInZone_2 ?? 0)),
      Math.round(Number(a.hrTimeInZone_3 ?? 0)),
      Math.round(Number(a.hrTimeInZone_4 ?? 0)),
      Math.round(Number(a.hrTimeInZone_5 ?? 0)),
      0,
      0
    ];
    const powerZones = [
      Math.round(Number(a.powerTimeInZone_1 ?? 0)),
      Math.round(Number(a.powerTimeInZone_2 ?? 0)),
      Math.round(Number(a.powerTimeInZone_3 ?? 0)),
      Math.round(Number(a.powerTimeInZone_4 ?? 0)),
      Math.round(Number(a.powerTimeInZone_5 ?? 0)),
      Math.round(Number(a.powerTimeInZone_6 ?? 0)),
      Math.round(Number(a.powerTimeInZone_7 ?? 0))
    ];
    const hasPowerZones = powerZones.some((s) => s > 0);
    const startLatLng = Math.abs(startLat) > 0.01 && Math.abs(startLng) > 0.01 ? [Number(startLat.toFixed(5)), Number(startLng.toFixed(5))] : void 0;
    const garminTimestamps = normalizeActivityTimestamps({
      startDateLocal: a.startTimeLocal ? stripTimezoneSuffix(String(a.startTimeLocal).trim().replace(" ", "T")) : void 0,
      startDateUtc: a.startTimeGMT ? String(a.startTimeGMT).trim().replace(" ", "T") : void 0,
      startLatLng,
      fallbackBrowserTz: true
    });
    const endLat = Number(a.endLatitude ?? 0);
    const endLng = Number(a.endLongitude ?? 0);
    const endLatLng = Math.abs(endLat) > 0.01 && Math.abs(endLng) > 0.01 ? [Number(endLat.toFixed(5)), Number(endLng.toFixed(5))] : void 0;
    return {
      id: `garmin-${id}`,
      garminId: id,
      startDateLocal: garminTimestamps.startDateLocal,
      ...garminTimestamps.startDateUtcMs !== void 0 ? { startDateUtcMs: garminTimestamps.startDateUtcMs } : {},
      name,
      sportCategory,
      rawSportType: typeKey || void 0,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      subType,
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters,
      avgPower,
      normalizedPower,
      deviceWatts: sportCategory === "Cycling" ? hasRealCyclingWatts : void 0,
      max_watts: maxPower,
      max20MinPower,
      fastestSplit_1000: fastestSplit1000,
      fastestSplit_1609: fastestSplit1609,
      fastestSplit_5000: fastestSplit5000,
      intensityFactor,
      trainingLoad,
      loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
      avgHr,
      maxHr,
      avgCadence,
      avgPaceSecsPerKm,
      gapPaceSecsPerKm: avgPaceSecsPerKm,
      aerobicDecouplingPct: 0,
      efficiencyFactor,
      firstHalfEf: 0,
      secondHalfEf: 0,
      calories: a.calories ? Math.round(Number(a.calories)) : void 0,
      zoneSecs: {
        hr: hrZones,
        power: hasPowerZones ? powerZones : void 0
      },
      startLatLng,
      endLatLng,
      segmentEfforts: [],
      sourceBadges: ["Garmin"]
    };
  });
}

// server/sessionContext.ts
var requestContext = new AsyncLocalStorage();
var explicitScopeKeyByReq = /* @__PURE__ */ new WeakMap();
var responseByReq = /* @__PURE__ */ new WeakMap();
var SEGMENTS_BY_ACTIVITY_CACHE_FILE = "/tmp/thresh-segments-by-activity.json";
var ROUTES_BY_ACTIVITY_CACHE_FILE = "/tmp/thresh-routes-by-activity.json";
var STRAVA_KUDOS_CACHE_FILE = "/tmp/thresh-strava-kudos.json";
var GARMIN_SESSION_DIR = "/tmp/thresh-garmin";
function hasExplicitCredentialHeader(req) {
  if (!req) return false;
  return Boolean(
    String(req.headers["x-strava-refresh-token"] || "").trim() || String(req.headers["x-strava-access-token"] || "").trim() || String(req.headers["x-intervals-api-key"] || "").trim() || String(req.headers["x-intervals-access-token"] || "").trim() || String(req.headers["x-wahoo-access-token"] || "").trim() || String(req.headers["x-polar-access-token"] || "").trim() || String(req.headers["x-garmin-personal-api-key"] || "").trim() || String(req.headers["x-garmin-bearer-token"] || "").trim() || String(req.headers["x-garmin-oauth1-token"] || "").trim()
  );
}
function isAuthenticatedRequest(req) {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  return hasValidSessionToken(activeReq) || hasExplicitCredentialHeader(activeReq) || Boolean(readCompactVaultFromCookie(activeReq)?.sid);
}
function bindRequestScopeKey(req, sid) {
  const scopeKey = sid.slice(0, 24);
  if (req) {
    explicitScopeKeyByReq.set(req, scopeKey);
  }
  return scopeKey;
}
function readCompactVaultFromCookie(req) {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[VAULT_COOKIE_NAME];
  if (!raw) return null;
  return decryptJsonFromVault(raw);
}
function resolveSessionScopeKey(req) {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return null;
  const bound = explicitScopeKeyByReq.get(activeReq);
  if (bound) return bound;
  const verified = getVerifiedSessionClaims(activeReq);
  if (verified?.sid) {
    return verified.sid.slice(0, 24);
  }
  const cookieVault = readCompactVaultFromCookie(activeReq);
  if (cookieVault?.sid) {
    return cookieVault.sid.slice(0, 24);
  }
  const rawCredential = (String(activeReq.headers["x-garmin-personal-api-key"] || "").trim() || String(activeReq.headers["x-strava-refresh-token"] || "").trim() || String(activeReq.headers["x-strava-access-token"] || "").trim() || String(activeReq.headers["x-intervals-api-key"] || "").trim()).trim();
  if (!rawCredential) return null;
  return crypto4.createHash("sha256").update(rawCredential).digest("hex").slice(0, 24);
}
function getGarminScopeKey(req) {
  return resolveSessionScopeKey(req) || "unauthenticated";
}
function getActiveGarminSession(req) {
  const activeReq = req ?? requestContext.getStore();
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return null;
  }
  const scopeKey = resolveSessionScopeKey(activeReq);
  const stored = scopeKey ? loadGarminSession(GARMIN_SESSION_DIR, scopeKey) : null;
  const cookieVault = readCompactVaultFromCookie(activeReq);
  const cookiePersonalKey = cookieVault && (!scopeKey || cookieVault.sid?.slice(0, 24) === scopeKey) ? String(cookieVault.garminPersonalApiKey || "").trim() : "";
  const headerPersonalKey = activeReq ? String(activeReq.headers["x-garmin-personal-api-key"] || "").trim() : "";
  const headerBearer = activeReq ? String(activeReq.headers["x-garmin-bearer-token"] || "").trim() : "";
  const headerOauth1 = activeReq ? String(activeReq.headers["x-garmin-oauth1-token"] || "").trim() : "";
  const headerOauth1Secret = activeReq ? String(activeReq.headers["x-garmin-oauth1-secret"] || "").trim() : "";
  if (stored && (stored.personalApiKey || stored.oauth2AccessToken || stored.oauth1Token)) {
    if (headerPersonalKey && !stored.personalApiKey) {
      stored.personalApiKey = headerPersonalKey;
    }
    return stored;
  }
  if (cookiePersonalKey || headerPersonalKey || headerBearer || headerOauth1 && headerOauth1Secret) {
    return {
      personalApiKey: cookiePersonalKey || headerPersonalKey || void 0,
      oauth2AccessToken: headerBearer || void 0,
      oauth1Token: headerOauth1 || void 0,
      oauth1TokenSecret: headerOauth1Secret || void 0
    };
  }
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const fallbackPersonalKey = getEnvGarminPersonalApiKey();
    if (fallbackPersonalKey) {
      const envGarminName = (process.env.GARMIN_ATHLETE_NAME || "").trim();
      return {
        personalApiKey: fallbackPersonalKey,
        ...envGarminName ? { fullName: envGarminName } : {}
      };
    }
  }
  return null;
}
function getScopedPlannedEventsFile(req, explicitApiKey) {
  const scopeKey = explicitApiKey ? crypto4.createHash("sha256").update(explicitApiKey.trim()).digest("hex").slice(0, 24) : resolveSessionScopeKey(req);
  if (!scopeKey) return null;
  return `/tmp/thresh-planned-events-${scopeKey}.json`;
}
function loadJsonFile(filePath, fallback) {
  try {
    if (fs4.existsSync(filePath)) {
      return JSON.parse(fs4.readFileSync(filePath, "utf8"));
    }
  } catch {
  }
  return fallback;
}
function saveJsonFile(filePath, data) {
  try {
    fs4.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 384 });
  } catch {
  }
}
var initialEnvMapKey = (process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.THUNDERFOREST_API_KEY || "").trim();
var initialEnvGeminiKey = [
  process.env.GEMINI_API_KEY,
  process.env.GOOGLE_API_KEY,
  process.env.GOOGLE_GENERATIVE_AI_API_KEY
].map(
  (k) => (k || "").trim().replace(/^["']+|["']+$/g, "").trim()
).find((k) => k && k !== "MY_GEMINI_API_KEY" && k !== "YOUR_GEMINI_API_KEY") || "";
function createDefaultRuntimeSessionStore(seed = {}) {
  return {
    intervalsApiKey: seed.intervalsApiKey || "",
    intervalsAccessToken: seed.intervalsAccessToken || "",
    intervalsScope: seed.intervalsScope || "",
    intervalsAthleteId: seed.intervalsAthleteId || "0",
    intervalsAthleteName: seed.intervalsAthleteName || "",
    wahooClientId: seed.wahooClientId || process.env.WAHOO_CLIENT_ID || "",
    wahooClientSecret: seed.wahooClientSecret || process.env.WAHOO_CLIENT_SECRET || "",
    wahooAccessToken: seed.wahooAccessToken || "",
    wahooRefreshToken: seed.wahooRefreshToken || "",
    wahooExpiresAt: seed.wahooExpiresAt || 0,
    wahooScope: seed.wahooScope || "",
    wahooUserId: seed.wahooUserId || "",
    wahooAthleteName: seed.wahooAthleteName || "",
    polarClientId: seed.polarClientId || process.env.POLAR_CLIENT_ID || "",
    polarClientSecret: seed.polarClientSecret || process.env.POLAR_CLIENT_SECRET || "",
    polarAccessToken: seed.polarAccessToken || "",
    polarUserId: seed.polarUserId || "",
    polarAthleteName: seed.polarAthleteName || "",
    polarExpiresAt: seed.polarExpiresAt || 0,
    polarScope: seed.polarScope || "",
    stravaClientId: seed.stravaClientId || process.env.STRAVA_CLIENT_ID || "",
    stravaClientSecret: seed.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || "",
    stravaAccessToken: seed.stravaAccessToken || "",
    stravaRefreshToken: seed.stravaRefreshToken || "",
    stravaExpiresAt: seed.stravaExpiresAt || 0,
    stravaAthleteId: seed.stravaAthleteId || void 0,
    stravaAthleteName: seed.stravaAthleteName || "",
    stravaMeasurementPreference: seed.stravaMeasurementPreference || void 0,
    stravaGrantedScope: seed.stravaGrantedScope || void 0,
    stravaSyncPolicy: seed.stravaSyncPolicy || void 0,
    lastSyncedAt: seed.lastSyncedAt || (/* @__PURE__ */ new Date()).toISOString(),
    nextHourlySyncAt: seed.nextHourlySyncAt || new Date(Date.now() + 3600 * 1e3).toISOString(),
    totalActivitiesCount: seed.totalActivitiesCount || 0,
    earliestActivityDate: seed.earliestActivityDate || "",
    garminActivitiesCount: seed.garminActivitiesCount || 0,
    stravaActivitiesCount: seed.stravaActivitiesCount || 0,
    redactedStravaCount: seed.redactedStravaCount || 0,
    athleteFtp: seed.athleteFtp || 250,
    athleteIndoorFtp: seed.athleteIndoorFtp || 250,
    athleteRunFtp: seed.athleteRunFtp || 300,
    athleteLthr: seed.athleteLthr || 165,
    athleteMaxHr: seed.athleteMaxHr || 185,
    athleteProfile: seed.athleteProfile || void 0,
    geminiApiKey: seed.geminiApiKey || "",
    mapTileApiKey: seed.mapTileApiKey || initialEnvMapKey,
    mapTileProvider: seed.mapTileProvider || (initialEnvMapKey.startsWith("pk.") ? "MAPBOX" : initialEnvMapKey ? "THUNDERFOREST" : "OSM_KEYLESS"),
    gearItems: seed.gearItems || []
  };
}
var scopedStoresInMemory = /* @__PURE__ */ new Map();
var hydratedReqScopeMap = /* @__PURE__ */ new WeakMap();
var ephemeralStoresByReq = /* @__PURE__ */ new WeakMap();
function getScopedSessionFilePath(scopeKey) {
  return `/tmp/thresh-session-${scopeKey}.json`;
}
function getScopedRuntimeStore(req) {
  const activeReq = req ?? requestContext.getStore();
  const scopeKey = resolveSessionScopeKey(activeReq);
  if (scopeKey) {
    if (activeReq) {
      const perReq = hydratedReqScopeMap.get(activeReq);
      const reqCached = perReq?.get(scopeKey);
      if (reqCached) return reqCached;
    } else {
      const memExisting = scopedStoresInMemory.get(scopeKey);
      if (memExisting) return memExisting;
    }
    let loaded = loadTenantVaultSync(`session_${scopeKey}`, {});
    const legacyPath = getScopedSessionFilePath(scopeKey);
    if (Object.keys(loaded).length === 0 && fs4.existsSync(legacyPath)) {
      loaded = loadJsonFile(legacyPath, {});
      saveTenantVaultSync(`session_${scopeKey}`, loaded);
      try {
        fs4.unlinkSync(legacyPath);
      } catch {
      }
    }
    const cookieVault = readCompactVaultFromCookie(activeReq);
    const shouldHydrateCookieVault = Boolean(
      cookieVault && cookieVault.sid?.slice(0, 24) === scopeKey
    );
    if (cookieVault && shouldHydrateCookieVault) {
      loaded = {
        ...cookieVault,
        ...loaded,
        stravaAccessToken: loaded.stravaAccessToken || cookieVault.stravaAccessToken || "",
        stravaRefreshToken: loaded.stravaRefreshToken || cookieVault.stravaRefreshToken || "",
        stravaExpiresAt: (loaded.stravaExpiresAt || 0) >= (cookieVault.stravaExpiresAt || 0) ? loaded.stravaExpiresAt : cookieVault.stravaExpiresAt,
        stravaAthleteId: loaded.stravaAthleteId || cookieVault.stravaAthleteId,
        stravaAthleteName: loaded.stravaAthleteName || cookieVault.stravaAthleteName || "",
        stravaMeasurementPreference: loaded.stravaMeasurementPreference || cookieVault.stravaMeasurementPreference,
        stravaGrantedScope: loaded.stravaGrantedScope || cookieVault.stravaGrantedScope,
        stravaSyncPolicy: loaded.stravaSyncPolicy || cookieVault.stravaSyncPolicy,
        intervalsApiKey: loaded.intervalsApiKey || cookieVault.intervalsApiKey || "",
        intervalsAccessToken: loaded.intervalsAccessToken || cookieVault.intervalsAccessToken || "",
        intervalsScope: loaded.intervalsScope || cookieVault.intervalsScope || "",
        intervalsAthleteId: loaded.intervalsAthleteId || cookieVault.intervalsAthleteId || "0",
        intervalsAthleteName: loaded.intervalsAthleteName || cookieVault.intervalsAthleteName || "",
        wahooAccessToken: loaded.wahooAccessToken || cookieVault.wahooAccessToken || "",
        wahooRefreshToken: loaded.wahooRefreshToken || cookieVault.wahooRefreshToken || "",
        wahooExpiresAt: loaded.wahooExpiresAt || cookieVault.wahooExpiresAt || 0,
        wahooScope: loaded.wahooScope || cookieVault.wahooScope || "",
        wahooUserId: loaded.wahooUserId || cookieVault.wahooUserId || "",
        wahooAthleteName: loaded.wahooAthleteName || cookieVault.wahooAthleteName || "",
        polarAccessToken: loaded.polarAccessToken || cookieVault.polarAccessToken || "",
        polarUserId: loaded.polarUserId || cookieVault.polarUserId || "",
        polarAthleteName: loaded.polarAthleteName || cookieVault.polarAthleteName || "",
        polarExpiresAt: loaded.polarExpiresAt || cookieVault.polarExpiresAt || 0,
        polarScope: loaded.polarScope || cookieVault.polarScope || ""
      };
    }
    const hydrated = createDefaultRuntimeSessionStore(loaded);
    if (activeReq && !hydrated.stravaSyncPolicy && (hydrated.stravaRefreshToken || hydrated.stravaAccessToken)) {
      const headerWindow = String(activeReq.headers["x-strava-sync-window"] || "").trim();
      if (headerWindow === "90d" || headerWindow === "180d" || headerWindow === "365d" || headerWindow === "all" || headerWindow === "none") {
        hydrated.stravaSyncPolicy = {
          window: headerWindow,
          importProfileAndGear: activeReq.headers["x-strava-import-gear"] !== "0",
          confirmedAt: (/* @__PURE__ */ new Date()).toISOString(),
          grantedScope: hydrated.stravaGrantedScope || void 0
        };
      }
    }
    scopedStoresInMemory.set(scopeKey, hydrated);
    if (activeReq) {
      let map = hydratedReqScopeMap.get(activeReq);
      if (!map) {
        map = /* @__PURE__ */ new Map();
        hydratedReqScopeMap.set(activeReq, map);
      }
      map.set(scopeKey, hydrated);
    }
    return hydrated;
  }
  if (activeReq) {
    let eph = ephemeralStoresByReq.get(activeReq);
    if (!eph) {
      eph = createDefaultRuntimeSessionStore();
      ephemeralStoresByReq.set(activeReq, eph);
    }
    return eph;
  }
  return createDefaultRuntimeSessionStore();
}
var runtimeStore = new Proxy({}, {
  get(_target, prop) {
    return getScopedRuntimeStore()[prop];
  },
  set(_target, prop, value) {
    getScopedRuntimeStore()[prop] = value;
    return true;
  }
});
function mergeRuntimeStoreCredentials(target, source) {
  const srcExp = source.stravaExpiresAt || 0;
  const dstExp = target.stravaExpiresAt || 0;
  if ((source.stravaRefreshToken || source.stravaAccessToken) && (!target.stravaRefreshToken || srcExp >= dstExp)) {
    if (source.stravaAccessToken) target.stravaAccessToken = source.stravaAccessToken;
    if (source.stravaRefreshToken) target.stravaRefreshToken = source.stravaRefreshToken;
    if (srcExp > 0) target.stravaExpiresAt = srcExp;
  }
  if (!target.stravaClientId && source.stravaClientId) target.stravaClientId = source.stravaClientId;
  if (!target.stravaClientSecret && source.stravaClientSecret) target.stravaClientSecret = source.stravaClientSecret;
  if (!target.stravaAthleteId && source.stravaAthleteId) target.stravaAthleteId = source.stravaAthleteId;
  if (!target.stravaAthleteName && source.stravaAthleteName) target.stravaAthleteName = source.stravaAthleteName;
  if (!target.stravaMeasurementPreference && source.stravaMeasurementPreference) {
    target.stravaMeasurementPreference = source.stravaMeasurementPreference;
  }
  if (!target.stravaGrantedScope && source.stravaGrantedScope) target.stravaGrantedScope = source.stravaGrantedScope;
  if (!target.stravaSyncPolicy && source.stravaSyncPolicy) target.stravaSyncPolicy = source.stravaSyncPolicy;
  if (!target.intervalsApiKey && source.intervalsApiKey) target.intervalsApiKey = source.intervalsApiKey;
  if (!target.intervalsAccessToken && source.intervalsAccessToken) target.intervalsAccessToken = source.intervalsAccessToken;
  if (!target.intervalsAthleteName && source.intervalsAthleteName) target.intervalsAthleteName = source.intervalsAthleteName;
  if (!target.wahooAccessToken && source.wahooAccessToken) target.wahooAccessToken = source.wahooAccessToken;
  if (!target.wahooRefreshToken && source.wahooRefreshToken) target.wahooRefreshToken = source.wahooRefreshToken;
  if (!target.polarAccessToken && source.polarAccessToken) target.polarAccessToken = source.polarAccessToken;
  if ((!target.gearItems || target.gearItems.length === 0) && source.gearItems?.length) target.gearItems = source.gearItems;
  if (!target.athleteProfile && source.athleteProfile) target.athleteProfile = source.athleteProfile;
  if (!target.geminiApiKey && source.geminiApiKey) target.geminiApiKey = source.geminiApiKey;
}
function emitEncryptedVaultCookieIfPossible(req, res, scopeKey, store) {
  const activeReq = req ?? requestContext.getStore();
  const activeRes = res ?? (activeReq ? responseByReq.get(activeReq) ?? activeReq.res : void 0);
  if (!activeRes || activeRes.headersSent) return;
  const isSecure = Boolean(
    activeReq && (activeReq.secure || String(activeReq.headers["x-forwarded-proto"] || "").toLowerCase() === "https")
  );
  const garminSess = loadGarminSession(GARMIN_SESSION_DIR, scopeKey);
  const compact = {
    sid: scopeKey,
    stravaAccessToken: store.stravaAccessToken || void 0,
    stravaRefreshToken: store.stravaRefreshToken || void 0,
    stravaExpiresAt: store.stravaExpiresAt || void 0,
    stravaAthleteId: store.stravaAthleteId || void 0,
    stravaAthleteName: store.stravaAthleteName || void 0,
    stravaClientId: store.stravaClientId || void 0,
    stravaMeasurementPreference: store.stravaMeasurementPreference || void 0,
    stravaGrantedScope: store.stravaGrantedScope || void 0,
    stravaSyncPolicy: store.stravaSyncPolicy || void 0,
    intervalsApiKey: store.intervalsApiKey || void 0,
    intervalsAccessToken: store.intervalsAccessToken || void 0,
    intervalsScope: store.intervalsScope || void 0,
    intervalsAthleteId: store.intervalsAthleteId && store.intervalsAthleteId !== "0" ? store.intervalsAthleteId : void 0,
    intervalsAthleteName: store.intervalsAthleteName || void 0,
    wahooAccessToken: store.wahooAccessToken || void 0,
    wahooRefreshToken: store.wahooRefreshToken || void 0,
    wahooExpiresAt: store.wahooExpiresAt || void 0,
    wahooScope: store.wahooScope || void 0,
    wahooUserId: store.wahooUserId || void 0,
    wahooAthleteName: store.wahooAthleteName || void 0,
    polarAccessToken: store.polarAccessToken || void 0,
    polarUserId: store.polarUserId || void 0,
    polarAthleteName: store.polarAthleteName || void 0,
    polarExpiresAt: store.polarExpiresAt || void 0,
    polarScope: store.polarScope || void 0,
    garminPersonalApiKey: garminSess?.personalApiKey || void 0
  };
  let header = buildEncryptedVaultCookieHeader(compact, isSecure);
  if (!header) {
    header = buildEncryptedVaultCookieHeader(
      {
        sid: scopeKey,
        stravaAccessToken: compact.stravaAccessToken,
        stravaRefreshToken: compact.stravaRefreshToken,
        stravaExpiresAt: compact.stravaExpiresAt,
        stravaAthleteId: compact.stravaAthleteId,
        stravaClientId: compact.stravaClientId,
        stravaMeasurementPreference: compact.stravaMeasurementPreference,
        stravaGrantedScope: compact.stravaGrantedScope,
        stravaSyncPolicy: compact.stravaSyncPolicy,
        intervalsApiKey: compact.intervalsApiKey,
        intervalsAccessToken: compact.intervalsAccessToken,
        intervalsAthleteId: compact.intervalsAthleteId,
        wahooAccessToken: compact.wahooAccessToken,
        wahooRefreshToken: compact.wahooRefreshToken,
        wahooExpiresAt: compact.wahooExpiresAt,
        polarAccessToken: compact.polarAccessToken,
        garminPersonalApiKey: compact.garminPersonalApiKey
      },
      isSecure
    );
  }
  if (header) {
    appendSetCookieHeader(activeRes, header);
  }
}
function saveSessionCache(req, res) {
  const activeReq = req ?? requestContext.getStore();
  const scopeKey = resolveSessionScopeKey(activeReq);
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(activeReq);
  scopedStoresInMemory.set(scopeKey, store);
  saveTenantVaultSync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(activeReq, res, scopeKey, store);
}
async function saveSessionCacheAsync(req, res, explicitSid) {
  const activeReq = req ?? requestContext.getStore();
  const prevScopeKey = resolveSessionScopeKey(activeReq);
  const prevStore = prevScopeKey ? getScopedRuntimeStore(activeReq) : null;
  const scopeKey = explicitSid ? bindRequestScopeKey(activeReq, explicitSid) : prevScopeKey;
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(activeReq);
  if (prevStore && prevScopeKey && prevScopeKey !== scopeKey) {
    mergeRuntimeStoreCredentials(store, prevStore);
  }
  scopedStoresInMemory.set(scopeKey, store);
  await saveTenantVaultAsync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(activeReq, res, scopeKey, store);
}

// server/routers/vaultAndPhysiologyRouter.ts
import express from "express";

// src/physiology/powerPaceMetrics.ts
function computeNormalizedPower(wattsStream) {
  if (!Array.isArray(wattsStream) || wattsStream.length < 30) {
    if (Array.isArray(wattsStream) && wattsStream.length > 0) {
      const valid = wattsStream.filter((w) => Number.isFinite(w) && w >= 0);
      if (valid.length === 0) return null;
      return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    }
    return null;
  }
  const clean = wattsStream.map((w) => Number.isFinite(w) && w > 0 ? w : 0);
  const windowSize = 30;
  let windowSum = 0;
  for (let i = 0; i < windowSize; i++) {
    windowSum += clean[i];
  }
  let fourthPowerSum = Math.pow(windowSum / windowSize, 4);
  let count = 1;
  for (let i = windowSize; i < clean.length; i++) {
    windowSum += clean[i] - clean[i - windowSize];
    const rollingAvg = windowSum / windowSize;
    fourthPowerSum += Math.pow(rollingAvg, 4);
    count++;
  }
  const np = Math.pow(fourthPowerSum / count, 0.25);
  return Number.isFinite(np) && np > 0 ? Math.round(np) : null;
}
function computeCyclingTss(durationSecs, npOrAvgWatts, ftpWatts) {
  if (!(durationSecs > 0) || !(npOrAvgWatts > 0) || !(ftpWatts > 0)) return 0;
  const intensityFactor = npOrAvgWatts / ftpWatts;
  const tss = durationSecs * npOrAvgWatts * intensityFactor / (ftpWatts * 3600) * 100;
  return Math.round(tss * 10) / 10;
}
function computeMinettiCostMultiplier(gradeFraction) {
  if (!Number.isFinite(gradeFraction)) return 1;
  const g = Math.max(-0.35, Math.min(0.35, gradeFraction));
  const cost = 155.4 * Math.pow(g, 5) - 30.4 * Math.pow(g, 4) - 43.3 * Math.pow(g, 3) + 46.3 * Math.pow(g, 2) + 19.5 * g + 3.6;
  return Math.max(0.55, Math.min(3.4, cost / 3.6));
}
function computeGradeAdjustedPaceStream(velocityMps, altitudeMeters, distanceMeters) {
  if (!Array.isArray(velocityMps) || velocityMps.length === 0) {
    return { gapVelocityMps: [], avgGapSecsPerKm: null };
  }
  const n = velocityMps.length;
  const hasAlt = Array.isArray(altitudeMeters) && altitudeMeters.length === n;
  const hasDist = Array.isArray(distanceMeters) && distanceMeters.length === n;
  const gapVelocityMps = new Array(n);
  let movingGapSum = 0;
  let movingSamples = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(velocityMps[i]) && velocityMps[i] > 0 ? velocityMps[i] : 0;
    if (v < 0.5) {
      gapVelocityMps[i] = 0;
      continue;
    }
    let grade = 0;
    if (hasAlt) {
      const lookback = Math.max(0, i - 5);
      const lookahead = Math.min(n - 1, i + 5);
      const dAlt = (altitudeMeters[lookahead] ?? 0) - (altitudeMeters[lookback] ?? 0);
      let dHoriz = 0;
      if (hasDist) {
        dHoriz = (distanceMeters[lookahead] ?? 0) - (distanceMeters[lookback] ?? 0);
      } else {
        for (let k = lookback + 1; k <= lookahead; k++) {
          dHoriz += Math.max(0, velocityMps[k] || 0);
        }
      }
      if (dHoriz >= 6) {
        grade = dAlt / dHoriz;
      }
    }
    const mult = computeMinettiCostMultiplier(grade);
    const gapV = v * mult;
    gapVelocityMps[i] = gapV;
    movingGapSum += gapV;
    movingSamples++;
  }
  if (movingSamples === 0 || movingGapSum <= 0) {
    return { gapVelocityMps, avgGapSecsPerKm: null };
  }
  const meanGapV = movingGapSum / movingSamples;
  const avgGapSecsPerKm = meanGapV > 0.5 ? Math.round(1e3 / meanGapV * 10) / 10 : null;
  return { gapVelocityMps, avgGapSecsPerKm };
}
function computeRunningTss(durationSecs, gapSecsPerKm, thresholdPaceSecsPerKm) {
  if (!(durationSecs > 0) || !(gapSecsPerKm > 0) || !(thresholdPaceSecsPerKm > 0)) return 0;
  const intensityFactor = thresholdPaceSecsPerKm / gapSecsPerKm;
  const rtss = durationSecs / 3600 * Math.pow(intensityFactor, 2) * 100;
  return Math.round(rtss * 10) / 10;
}
function estimateVdotFromRace(distanceMeters, durationSecs) {
  if (!(distanceMeters >= 400) || !(durationSecs > 45)) return 0;
  const durationMins = durationSecs / 60;
  const velocityMetersPerMin = distanceMeters / durationMins;
  const vo2 = -4.6 + 0.182258 * velocityMetersPerMin + 104e-6 * velocityMetersPerMin * velocityMetersPerMin;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * durationMins) + 0.2989558 * Math.exp(-0.1932605 * durationMins);
  if (!(pctMax > 0.2) || !(vo2 > 5)) return 0;
  return Math.round(vo2 / pctMax * 10) / 10;
}

// src/physiology/pmc.ts
function resolveThresholdsAtDate(profile, isoDate) {
  const cleanDate = (isoDate || "").slice(0, 10);
  const history = Array.isArray(profile.thresholdHistory) ? [...profile.thresholdHistory].filter((h) => Boolean(h && h.effectiveDate)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)) : [];
  let matched = null;
  for (const entry of history) {
    if (entry.effectiveDate.slice(0, 10) <= cleanDate) {
      matched = entry;
    } else {
      break;
    }
  }
  if (!matched && history.length > 0) {
    matched = history[0];
  }
  if (matched) {
    return {
      ftp: matched.ftp > 0 ? matched.ftp : profile.ftp || 250,
      indoorFtp: matched.indoorFtp && matched.indoorFtp > 0 ? matched.indoorFtp : matched.ftp > 0 ? matched.ftp : profile.indoorFtp || profile.ftp || 250,
      lthr: matched.lthr > 0 ? matched.lthr : profile.lthr || 170,
      runLthr: matched.runLthr && matched.runLthr > 0 ? matched.runLthr : profile.runLthr || 175,
      thresholdPaceSecsPerKm: matched.thresholdPaceSecsPerKm > 0 ? matched.thresholdPaceSecsPerKm : profile.thresholdPaceSecsPerKm || 260
    };
  }
  return {
    ftp: profile.ftp || 250,
    indoorFtp: profile.indoorFtp || profile.ftp || 250,
    lthr: profile.lthr || 170,
    runLthr: profile.runLthr || profile.lthr || 175,
    thresholdPaceSecsPerKm: profile.thresholdPaceSecsPerKm || 260
  };
}
function computeHistoricalActivityLoad(activity, profile) {
  if (isEBikeActivityText(activity.rawSportType, activity.name)) {
    return Number.isFinite(activity.trainingLoad) && activity.trainingLoad >= 0 ? activity.trainingLoad : 0;
  }
  const hasHistoryOverrides = Array.isArray(profile.thresholdHistory) && profile.thresholdHistory.length > 0;
  if (activity.loadModelVersion === STRAVA_LOAD_MODEL_VERSION && !hasHistoryOverrides && profile.source !== "CUSTOM_OVERRIDE" && Number.isFinite(activity.trainingLoad)) {
    return Math.max(0, activity.trainingLoad);
  }
  const dateStr = (activity.startDateLocal || "").slice(0, 10);
  const thresholds = resolveThresholdsAtDate(profile, dateStr);
  const dur = activity.movingTimeSecs || 0;
  if (activity.sportCategory === "Cycling" && dur > 0 && activity.deviceWatts !== false) {
    const np = activity.normalizedPower || activity.avgPower || 0;
    const activeFtp = activity.environment === "INDOOR" ? thresholds.indoorFtp : thresholds.ftp;
    if (np > 0 && activeFtp > 0) {
      return computeCyclingTss(dur, np, activeFtp);
    }
  }
  if (activity.sportCategory === "Running" && dur > 0 && activity.distanceMeters > 200) {
    const rawPaceSecsPerKm = dur / (activity.distanceMeters / 1e3);
    const gradeFraction = activity.elevationGainMeters > 0 && activity.distanceMeters > 0 ? activity.elevationGainMeters / activity.distanceMeters : 0;
    const approxGapSecsPerKm = rawPaceSecsPerKm / (1 + Math.min(0.25, gradeFraction * 3.1));
    if (approxGapSecsPerKm > 100 && thresholds.thresholdPaceSecsPerKm > 0) {
      return computeRunningTss(dur, approxGapSecsPerKm, thresholds.thresholdPaceSecsPerKm);
    }
  }
  return Number.isFinite(activity.trainingLoad) && activity.trainingLoad > 0 ? activity.trainingLoad : 0;
}

// src/physiology/ageAndComplianceEngine.ts
function normalizeBirthMonthYear(raw) {
  if (!raw || typeof raw !== "string") return void 0;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed);
  if (!match) return void 0;
  const yr = Number(match[1]);
  if (yr < 1920 || yr > (/* @__PURE__ */ new Date()).getUTCFullYear() + 1) return void 0;
  return `${match[1]}-${match[2]}`;
}
function parseBirthYearFromBirthMonthYear(raw) {
  const norm = normalizeBirthMonthYear(raw);
  if (!norm) return void 0;
  return Number(norm.slice(0, 4));
}
function resolveAthleteAgeTier(params) {
  const nowDate = params.now instanceof Date ? params.now : params.now !== void 0 ? new Date(params.now) : /* @__PURE__ */ new Date();
  const safeNow = Number.isNaN(nowDate.getTime()) ? /* @__PURE__ */ new Date() : nowDate;
  const nowYear = safeNow.getUTCFullYear();
  const nowMonth = safeNow.getUTCMonth() + 1;
  const currentIsoDate = safeNow.toISOString().slice(0, 10);
  const normBmy = normalizeBirthMonthYear(params.birthMonthYear);
  const explicitYear = typeof params.birthYear === "number" && Number.isFinite(params.birthYear) && params.birthYear >= 1920 && params.birthYear <= nowYear + 1 ? Math.round(params.birthYear) : void 0;
  let estimatedAgeYears = null;
  if (normBmy) {
    const bYear = Number(normBmy.slice(0, 4));
    const bMonth = Number(normBmy.slice(5, 7));
    const completedMonths = (nowYear - bYear) * 12 + (nowMonth - bMonth) - 1;
    estimatedAgeYears = Math.max(0, Math.floor(completedMonths / 12));
  } else if (explicitYear !== void 0) {
    estimatedAgeYears = Math.max(0, nowYear - explicitYear);
  }
  let ageTier = "UNKNOWN";
  let isUnder13 = false;
  let isMinorU18 = Boolean(params.orgType === "HIGH_SCHOOL");
  if (estimatedAgeYears !== null) {
    if (estimatedAgeYears < 13) {
      ageTier = "U13_COPPA";
      isUnder13 = true;
      isMinorU18 = true;
    } else if (estimatedAgeYears < 18) {
      ageTier = "YOUTH_13_17";
      isUnder13 = false;
      isMinorU18 = true;
    } else {
      ageTier = "ADULT_18_PLUS";
      isUnder13 = false;
      isMinorU18 = false;
    }
  }
  const gradYr = typeof params.graduationYear === "number" && Number.isFinite(params.graduationYear) ? Math.round(params.graduationYear) : void 0;
  const shouldAutoGraduateHs = Boolean(
    params.orgType === "HIGH_SCHOOL" && gradYr && gradYr >= 2e3 && gradYr <= 2100 && currentIsoDate >= `${gradYr}-07-15`
  );
  return {
    ageTier,
    estimatedAgeYears,
    isUnder13,
    isMinorU18,
    shouldAutoGraduateHs,
    birthYear: parseBirthYearFromBirthMonthYear(normBmy) ?? explicitYear,
    birthMonthYear: normBmy
  };
}

// src/physiology/orthopedicEngine.ts
var M_SHOE_MULTIPLIERS = {
  DAILY_TRAINER: 1,
  LIGHTWEIGHT_FLAT_SUPER_TRAINER: 1.1,
  CARBON_ROAD_RACER: 1.2,
  TRADITIONAL_TRACK_SPIKE: 1.35,
  CARBON_SUPER_SPIKE: 1.52
};
function resolveActivityFootwearClass(act) {
  const explicit = act.footwearClass ?? act.quickLog?.footwearClass;
  if (explicit) return explicit;
  const gear = (act.gearName ?? act.quickLog?.gearName ?? "").toLowerCase();
  if (!gear) return "DAILY_TRAINER";
  if (/dragonfly|victory|ambition|avanti|md-x|ld-x|metaspike|maxfly|prime sp|takumi spike|super spike|carbon spike/.test(
    gear
  )) {
    return "CARBON_SUPER_SPIKE";
  }
  if (/spike|matumbo|mamba|rival|waffle|track spike/.test(gear)) {
    return "TRADITIONAL_TRACK_SPIKE";
  }
  if (/vaporfly|alphafly|metaspeed|adios pro|endorphin pro|cielo|sc elite|cloudboom/.test(gear)) {
    return "CARBON_ROAD_RACER";
  }
  if (/streakfly|takumi sen|sinister|hyperion|boston|endorphin speed|mach x|superblast/.test(gear)) {
    return "LIGHTWEIGHT_FLAT_SUPER_TRAINER";
  }
  return "DAILY_TRAINER";
}
function resolveTrackCurveMultiplier(act) {
  if (act.sportCategory !== "Running") return 1;
  const facility = act.trackFacility ?? act.quickLog?.trackFacility;
  if (facility === "INDOOR_FLAT_200M") return 1.16;
  const isTrackLike = Boolean(facility) || act.subType === "Track" || /\b(track|oval|200m|400m)\b/i.test(act.name || "");
  if (isTrackLike && act.environment === "INDOOR" && facility !== "INDOOR_BANKED_200M") {
    return 1.16;
  }
  if (facility === "OUTDOOR_400M" || facility === "INDOOR_BANKED_200M" || act.subType === "Track") {
    return 1.06;
  }
  return 1;
}
function resolveActivitySpikedMeters(act, footwearClass) {
  const explicit = act.spikedDistanceMeters ?? act.quickLog?.spikedDistanceMeters;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(0, Math.round(explicit));
  }
  if (footwearClass !== "TRADITIONAL_TRACK_SPIKE" && footwearClass !== "CARBON_SUPER_SPIKE") {
    return 0;
  }
  if (act.intervals && act.intervals.length > 0) {
    const workMeters = act.intervals.filter((iv) => iv.type === "WORK").reduce((acc, iv) => acc + Math.max(0, iv.distanceMeters || 0), 0);
    if (workMeters > 0) return Math.round(workMeters);
  }
  return Math.round(Math.min(act.distanceMeters || 0, 5e3));
}
function computeActivityThreeChannelLoads(act, profile) {
  const baseLoad = computeHistoricalActivityLoad(act, profile);
  const central = baseLoad;
  if (act.sportCategory === "Running") {
    const distKm = Math.max(0, (act.distanceMeters || 0) / 1e3);
    const durHrs = Math.max(0.05, (act.movingTimeSecs || 1) / 3600);
    const speedKph = distKm / durHrs;
    const speedFactor = Math.max(0.75, Math.min(2.1, Math.pow(speedKph / 12, 1.35)));
    const terrainShockFactor = act.elevationGainMeters > 150 ? 1.18 : act.environment === "INDOOR" ? 0.88 : 1;
    const footwearClass = resolveActivityFootwearClass(act);
    const spikedMeters = resolveActivitySpikedMeters(act, footwearClass);
    const totalMeters = Math.max(1, act.distanceMeters || 0);
    const spikeShare = spikedMeters > 0 ? Math.min(1, spikedMeters / totalMeters) : footwearClass === "CARBON_ROAD_RACER" || footwearClass === "LIGHTWEIGHT_FLAT_SUPER_TRAINER" ? 1 : 0;
    const effectiveShoeFactor = 1 + (M_SHOE_MULTIPLIERS[footwearClass] - 1) * spikeShare;
    const curveMultiplier = resolveTrackCurveMultiplier(act);
    const eccentricImpact = distKm * 7.5 * speedFactor * terrainShockFactor * effectiveShoeFactor * curveMultiplier;
    const uphillTorque = (act.elevationGainMeters || 0) * 0.08 + baseLoad * 0.25;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(eccentricImpact * 10) / 10,
      concentricTorque: Math.round(uphillTorque * 10) / 10
    };
  }
  if (act.sportCategory === "Cycling") {
    const cadence = act.avgCadence && act.avgCadence > 30 ? act.avgCadence : 85;
    const lowCadenceFactor = Math.max(0.8, Math.min(1.65, 85 / cadence));
    const climbingFactor = (act.elevationGainMeters || 0) > 600 ? 1.2 : 1;
    const concentricTorque = baseLoad * 0.85 * lowCadenceFactor * climbingFactor;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: 0,
      // Zero ground-reaction impact!
      concentricTorque: Math.round(concentricTorque * 10) / 10
    };
  }
  const rawMeta = `${act.rawSportType || ""} ${act.subType || ""} ${act.name || ""}`.toLowerCase();
  if (act.sportCategory === "Swimming" || act.subType === "Pool" || act.subType === "Open Water" || act.subType === "Rowing" || act.subType === "Elliptical" || act.subType === "Paddling & Water" || act.subType === "Yoga & Mobility" || /\b(swim|row|elliptical|kayak|canoe|paddle|surf|yoga|pilates|stretch|mobility|meditation)\b/.test(
    rawMeta
  )) {
    const torqueMult = act.subType === "Rowing" || act.subType === "Paddling & Water" ? 0.65 : act.subType === "Elliptical" ? 0.45 : 0;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: 0,
      concentricTorque: Math.round(baseLoad * torqueMult * 10) / 10
    };
  }
  if (act.subType === "Stair Stepper" || act.subType === "Nordic Ski" || /\b(stair|nordic|rollerski|xc ski|skierg)\b/.test(rawMeta)) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.05 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.75 * 10) / 10
    };
  }
  if (act.subType === "Hiking" || /\b(hike|hiking|snowshoe)\b/.test(rawMeta)) {
    const steepFactor = (act.elevationGainMeters || 0) > 400 ? 1.25 : 1;
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.3 * steepFactor * 10) / 10,
      concentricTorque: Math.round(((act.elevationGainMeters || 0) * 0.08 + baseLoad * 0.45) * 10) / 10
    };
  }
  if (act.subType === "Walking" || /\bwalk\b/.test(rawMeta)) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.12 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.25 * 10) / 10
    };
  }
  if (act.subType === "HIIT & Circuit" || act.subType === "Court & Field" || act.subType === "Alpine & Backcountry Ski" || /\b(hiit|crossfit|soccer|tennis|pickleball|basketball|alpine|snowboard|backcountry)\b/.test(
    rawMeta
  )) {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.42 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.55 * 10) / 10
    };
  }
  if (act.sportCategory === "Strength" || act.subType === "Climbing" || act.subType === "Gym") {
    return {
      central: Math.round(central * 10) / 10,
      eccentricImpact: Math.round(baseLoad * 0.12 * 10) / 10,
      concentricTorque: Math.round(baseLoad * 0.85 * 10) / 10
    };
  }
  return {
    central: Math.round(central * 10) / 10,
    eccentricImpact: Math.round(baseLoad * 0.15 * 10) / 10,
    concentricTorque: Math.round(baseLoad * 0.4 * 10) / 10
  };
}
function evaluateOrthopedicInterference(activities, profile, todayPlannedEvents = [], referenceDateIso, options) {
  const refDateStr = (referenceDateIso || getLocalDateIso()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);
  const refExactMs = referenceDateIso && referenceDateIso.includes("T") ? Date.parse(referenceDateIso) : refMs;
  const dayMs = 864e5;
  const hourMs = 36e5;
  const isU18Cohort = options?.isMinorU18 ?? (profile.birthMonthYear ? resolveAthleteAgeTier({ birthMonthYear: profile.birthMonthYear }).isMinorU18 : profile.academicDivision === "HS_VARSITY");
  const spikedMetersWeeklyCap = isU18Cohort ? 2e3 : profile.academicDivision === "NCAA_D1" ? 4400 : 3200;
  const superSpikeWeeklyCap = isU18Cohort ? 1600 : profile.academicDivision === "NCAA_D1" ? 3600 : 2400;
  let central7d = 0;
  let central28d = 0;
  let impact7d = 0;
  let impact28d = 0;
  let torque7d = 0;
  let torque28d = 0;
  let spikedMeters7d = 0;
  let superSpikeMeters7d = 0;
  let spikedMeters72h = 0;
  let spikeWeightedLoad7d = 0;
  let spikeWeightedLoad28d = 0;
  let hoursSinceLastSuperSpike = null;
  for (const act of activities) {
    const actDate = (act.startDateLocal || "").slice(0, 10);
    const actMs = Date.parse(`${actDate}T12:00:00Z`);
    if (!Number.isFinite(actMs) || actMs > refMs) continue;
    const ageDays = (refMs - actMs) / dayMs;
    if (ageDays > 28) continue;
    const actExactMs = act.startDateLocal && act.startDateLocal.includes("T") ? Date.parse(act.startDateLocal) : actMs;
    const hoursAgo = Number.isFinite(actExactMs) ? Math.max(0, (refExactMs - actExactMs) / hourMs) : ageDays * 24;
    const ch = computeActivityThreeChannelLoads(act, profile);
    central28d += ch.central;
    impact28d += ch.eccentricImpact;
    torque28d += ch.concentricTorque;
    if (ageDays <= 7) {
      central7d += ch.central;
      impact7d += ch.eccentricImpact;
      torque7d += ch.concentricTorque;
    }
    if (act.sportCategory === "Running") {
      const footwearClass = resolveActivityFootwearClass(act);
      const curveMultiplier = resolveTrackCurveMultiplier(act);
      const spikedMeters = resolveActivitySpikedMeters(act, footwearClass);
      const weightedSpike = spikedMeters * M_SHOE_MULTIPLIERS[footwearClass] * curveMultiplier;
      spikeWeightedLoad28d += weightedSpike;
      if (ageDays <= 7) {
        spikedMeters7d += spikedMeters;
        spikeWeightedLoad7d += weightedSpike;
        if (footwearClass === "CARBON_SUPER_SPIKE") {
          superSpikeMeters7d += spikedMeters;
        }
      }
      if (hoursAgo <= 72) {
        spikedMeters72h += spikedMeters;
      }
      if (footwearClass === "CARBON_SUPER_SPIKE" && spikedMeters > 0) {
        const roundedHrs = Math.round(hoursAgo * 10) / 10;
        hoursSinceLastSuperSpike = hoursSinceLastSuperSpike === null ? roundedHrs : Math.min(hoursSinceLastSuperSpike, roundedHrs);
      }
    }
  }
  const chronicCentralWeekly = Math.max(80, central28d / 4);
  const chronicImpactWeekly = Math.max(45, impact28d / 4);
  const chronicTorqueWeekly = Math.max(60, torque28d / 4);
  const chronicSpikeWeekly = Math.max(800, spikeWeightedLoad28d / 4);
  const centralAcwr = Math.round(central7d / chronicCentralWeekly * 100) / 100;
  const impactAcwr = Math.round(impact7d / chronicImpactWeekly * 100) / 100;
  const torqueAcwr = Math.round(torque7d / chronicTorqueWeekly * 100) / 100;
  const spikeAcwr = Math.round(spikeWeightedLoad7d / chronicSpikeWeekly * 100) / 100;
  const spikeRatio72h = Number((spikedMeters72h / Math.max(1, spikedMetersWeeklyCap)).toFixed(2));
  const within48hWindow = hoursSinceLastSuperSpike !== null && hoursSinceLastSuperSpike < 48;
  const sorenessTriggered = (options?.lowerLegSoreness ?? 0) >= 1;
  const trainerOnly48hLockActive = within48hWindow || sorenessTriggered;
  let trainerOnlyLockReason = null;
  if (within48hWindow && hoursSinceLastSuperSpike !== null) {
    trainerOnlyLockReason = `48h Trainers-Only Lock active (${hoursSinceLastSuperSpike.toFixed(1)}h since last carbon super-spike session).`;
  } else if (sorenessTriggered) {
    trainerOnlyLockReason = "48h Trainers-Only Lock triggered by shin/metatarsal or Achilles soreness >= 1.";
  }
  const spikeGuardrailStatus = trainerOnly48hLockActive ? "TRAINER_ONLY_48H_LOCK" : spikedMeters7d > spikedMetersWeeklyCap || superSpikeMeters7d > superSpikeWeeklyCap || spikeAcwr >= 1.35 ? "SPIKE_CAP_WARNING" : "CLEAR";
  const scheduledRun = todayPlannedEvents.find((e) => e.sportCategory === "Running");
  const baseRunMins = scheduledRun ? Math.max(30, Math.round(scheduledRun.plannedDurationSecs / 60)) : 45;
  const suggestedBikeDurationMins = Math.round(baseRunMins * 1.25 / 5) * 5;
  const suggestedBikeTss = scheduledRun?.plannedLoad ? Math.round(scheduledRun.plannedLoad * 0.95) : Math.round(suggestedBikeDurationMins * 0.82);
  const z2DurationMins = Math.max(20, suggestedBikeDurationMins - 20);
  const suggestedBikeWorkoutSyntax = `Warmup
- 10m 55%-68% 90rpm

Main Set
- ${z2DurationMins}m 70%-76% 92rpm

Cooldown
- 10m 50%-60% 85rpm`;
  let riskTier = "OPTIMAL";
  let guardrailHeadline = "Orthopedic Impact Balanced";
  let guardrailRecommendation = "7-day tibial/Achilles eccentric impact load is aligned with your 28-day chronic running baseline.";
  if (impactAcwr >= 1.32 && impact7d >= 85) {
    riskTier = "HIGH_IMPACT_GUARDRAIL";
    guardrailHeadline = `Impact ACWR ${impactAcwr.toFixed(2)}x \xB7 High Eccentric Strain`;
    guardrailRecommendation = scheduledRun ? `7d running impact spiked to ${Math.round(impact7d)} pts (${impactAcwr.toFixed(2)}x chronic baseline). Morph today's "${scheduledRun.name}" into a ${suggestedBikeDurationMins}m high-cadence Z2 ride to preserve aerobic CTL with zero tibial impact.` : `7d running impact reached ${Math.round(impact7d)} pts (${impactAcwr.toFixed(2)}x chronic baseline). Favor zero-impact Z2 spinning (${suggestedBikeDurationMins}m @ 90+ rpm) before your next quality run.`;
  } else if (impactAcwr >= 1.18 && impact7d >= 60) {
    riskTier = "ELEVATED_IMPACT";
    guardrailHeadline = `Impact ACWR ${impactAcwr.toFixed(2)}x \xB7 Watch Running Volume`;
    guardrailRecommendation = "Running mechanical load is building near your upper ramp ceiling. Keep easy runs on flat/soft surfaces or substitute an aerobic spin if calves/shins feel tight.";
  } else if (activities.length === 0) {
    guardrailHeadline = "Awaiting Run & Ride Load History";
    guardrailRecommendation = "Sync or upload workouts to track separated Central Cardiorespiratory, Eccentric Running Impact, and Concentric Bike Torque loads.";
  }
  const scheduledFootwear = scheduledRun?.footwearClass ?? scheduledRun?.trackSpec?.footwearClass;
  const scheduledIsSpike = scheduledFootwear === "CARBON_SUPER_SPIKE" || scheduledFootwear === "TRADITIONAL_TRACK_SPIKE";
  if (spikeGuardrailStatus === "TRAINER_ONLY_48H_LOCK" && (scheduledIsSpike || riskTier === "OPTIMAL")) {
    if (scheduledIsSpike) {
      riskTier = "HIGH_IMPACT_GUARDRAIL";
    } else if (riskTier === "OPTIMAL") {
      riskTier = "ELEVATED_IMPACT";
    }
    guardrailHeadline = `48h Trainers-Only Spike Lock (${Math.round(spikedMeters7d)}/${spikedMetersWeeklyCap}m 7d)`;
    guardrailRecommendation = `${trainerOnlyLockReason || "Super-spike recovery gate active."} Keep today's track work in Cushioned Daily Trainers / Flats to protect Achilles & metatarsal remodeling.`;
  } else if (spikeGuardrailStatus === "SPIKE_CAP_WARNING" && riskTier === "OPTIMAL") {
    riskTier = "ELEVATED_IMPACT";
    guardrailHeadline = `Spiked Exposure Watch (${Math.round(spikedMeters7d)}/${spikedMetersWeeklyCap}m \xB7 ${spikeAcwr.toFixed(2)}x)`;
    guardrailRecommendation = `Weekly spiked volume reached ${Math.round(spikedMeters7d)}m (cap ${spikedMetersWeeklyCap}m; carbon super-spikes ${Math.round(superSpikeMeters7d)}/${superSpikeWeeklyCap}m). Shift remaining intervals to Trainers / Flats.`;
  }
  return {
    centralAutonomicLoad7d: Math.round(central7d),
    eccentricImpactLoad7d: Math.round(impact7d),
    concentricTorqueLoad7d: Math.round(torque7d),
    impactAcwr,
    torqueAcwr,
    centralAcwr,
    riskTier,
    guardrailHeadline,
    guardrailRecommendation,
    canMorphTodayRunToBike: riskTier === "HIGH_IMPACT_GUARDRAIL" || riskTier === "ELEVATED_IMPACT" && Boolean(scheduledRun),
    suggestedBikeDurationMins,
    suggestedBikeTss,
    suggestedBikeWorkoutSyntax,
    spikedMeters7d: Math.round(spikedMeters7d),
    superSpikeMeters7d: Math.round(superSpikeMeters7d),
    spikedMeters72h: Math.round(spikedMeters72h),
    spikedMetersWeeklyCap,
    superSpikeWeeklyCap,
    spikeRatio72h,
    spikeAcwr,
    hoursSinceLastSuperSpike,
    trainerOnly48hLockActive,
    trainerOnlyLockReason,
    spikeGuardrailStatus
  };
}

// src/physiology/trackSpeedReserveEngine.ts
var clamp = (val, min, max) => Math.max(min, Math.min(max, val));
var round1 = (val) => Number(val.toFixed(1));
var round2 = (val) => Number(val.toFixed(2));
var round3 = (val) => Number(val.toFixed(3));
function vo2AtVelocityMpm(vMpm) {
  const safeV = Math.max(50, vMpm);
  return -4.6 + 0.182258 * safeV + 104e-6 * safeV * safeV;
}
function pctVo2MaxAtDurationMins(tMins) {
  const t = Math.max(0.5, tMins);
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}
function solveVelocityMpmForTargetVo2(targetVo2) {
  const a = 104e-6;
  const b = 0.182258;
  const c = -(4.6 + Math.max(8, targetVo2));
  const discriminant = Math.max(0, b * b - 4 * a * c);
  return (-b + Math.sqrt(discriminant)) / (2 * a);
}
function solveTrackPaceSecsPerKmForPctVdot(vdotAer, pctVo2, clampRange = [95, 540]) {
  const safeVdot = clamp(vdotAer || 50, 20, 92);
  const vMpm = solveVelocityMpmForTargetVo2(safeVdot * pctVo2);
  const rawPaceSecsPerKm = 6e4 / Math.max(80, vMpm);
  return round1(clamp(rawPaceSecsPerKm, clampRange[0], clampRange[1]));
}
function computeRawMarkVdot(distanceMeters, durationSecs) {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSecs)) return 50;
  if (distanceMeters < 150 || durationSecs < 15) return 50;
  const tMins = Math.max(0.75, durationSecs / 60);
  const vMpm = distanceMeters / tMins;
  const raw = vo2AtVelocityMpm(vMpm) / Math.max(0.55, pctVo2MaxAtDurationMins(tMins));
  return round2(clamp(raw, 22, 92));
}
function buildSplitRow(code, name, pctVdotAer, paceSecsPerKm) {
  const safePace = Math.max(95, paceSecsPerKm);
  const speedMps = 1e3 / safePace;
  return {
    code,
    name,
    pctVdotAer: round3(pctVdotAer),
    paceSecsPerKm: round1(safePace),
    speedMps: round3(speedMps),
    splitsSecs: {
      m200: round1(safePace * 200 / 1e3),
      m300: round1(safePace * 300 / 1e3),
      m400: round1(safePace * 400 / 1e3),
      m600: round1(safePace * 600 / 1e3),
      m800: round1(safePace * 800 / 1e3),
      m1000: round1(safePace),
      m1200: round1(safePace * 1200 / 1e3),
      m1600: round1(safePace * 1600 / 1e3)
    }
  };
}
function solveCriticalSpeedAndDPrimeOls(marks) {
  const valid = marks.filter(
    (m) => Number.isFinite(m.distanceMeters) && Number.isFinite(m.durationSecs) && m.distanceMeters >= 550 && m.distanceMeters <= 1e4 && m.durationSecs >= 45
  );
  if (valid.length < 2) return null;
  const bestByBucket = /* @__PURE__ */ new Map();
  for (const m of valid) {
    const bucket = Math.round(m.distanceMeters / 50) * 50;
    const existing = bestByBucket.get(bucket);
    if (!existing || m.durationSecs < existing.durationSecs) {
      bestByBucket.set(bucket, m);
    }
  }
  const allDistinct = Array.from(bestByBucket.values()).sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );
  const trackSevere = allDistinct.filter(
    (m) => m.distanceMeters >= 600 && m.distanceMeters <= 5e3
  );
  const pickPool = (pool, minDistSpan, minTimeSpan) => {
    if (pool.length < 2) return false;
    const dSpan = pool[pool.length - 1].distanceMeters - pool[0].distanceMeters;
    const tSpan = Math.max(...pool.map((p) => p.durationSecs)) - Math.min(...pool.map((p) => p.durationSecs));
    return dSpan >= minDistSpan && tSpan >= minTimeSpan;
  };
  const chosen = pickPool(trackSevere, 600, 45) ? trackSevere : pickPool(allDistinct, 500, 35) ? allDistinct : null;
  if (!chosen) return null;
  const n = chosen.length;
  const meanT = chosen.reduce((acc, m) => acc + m.durationSecs, 0) / n;
  const meanD = chosen.reduce((acc, m) => acc + m.distanceMeters, 0) / n;
  let num = 0;
  let den = 0;
  for (const m of chosen) {
    const dt = m.durationSecs - meanT;
    const dd = m.distanceMeters - meanD;
    num += dt * dd;
    den += dt * dt;
  }
  if (den <= 1e-6) return null;
  const rawCs = num / den;
  const csMps = round3(clamp(rawCs, 2.5, 6.8));
  const rawDPrime = meanD - csMps * meanT;
  const dPrimeMeters = Math.round(clamp(rawDPrime, 110, 420));
  return { csMps, dPrimeMeters, usedMarksCount: n };
}
function classifySpeedReservePhenotype(srr, dPrimeMeters, override) {
  if (override && override !== "AUTO") return override;
  if (srr >= 1.58 || dPrimeMeters > 235) return "SPEED";
  if (srr < 1.48 || dPrimeMeters < 205) return "ENDURANCE";
  return "HYBRID";
}
function buildTrackSpeedReserveProfile(input = {}) {
  const {
    marks = [],
    thresholdPaceSecsPerKm,
    maxSprintSpeedMps,
    flying30mSecs,
    phenotypeOverride = "AUTO"
  } = input;
  const validMarks = marks.filter(
    (m) => Number.isFinite(m.distanceMeters) && Number.isFinite(m.durationSecs) && m.distanceMeters >= 200 && m.durationSecs >= 20
  ).sort((a, b) => a.distanceMeters - b.distanceMeters);
  const vdotRawBest = validMarks.length > 0 ? Math.max(...validMarks.map((m) => computeRawMarkVdot(m.distanceMeters, m.durationSecs))) : thresholdPaceSecsPerKm && thresholdPaceSecsPerKm > 0 ? round2(
    clamp(
      vo2AtVelocityMpm(6e4 / clamp(thresholdPaceSecsPerKm, 130, 460)) / 0.88,
      22,
      90
    )
  ) : 50;
  const ols = solveCriticalSpeedAndDPrimeOls(validMarks);
  let modelSource = "PROFILE_THRESHOLD_FALLBACK";
  let csMps = 3.85;
  let dPrimeMeters = 215;
  let vdotAer = 50;
  if (ols) {
    modelSource = "MULTI_MARK_CS_DPRIME";
    csMps = ols.csMps;
    dPrimeMeters = ols.dPrimeMeters;
    vdotAer = round2(clamp(vo2AtVelocityMpm(csMps * 60) / 0.9215, 22, 90));
  } else if (validMarks.length > 0) {
    modelSource = "SINGLE_MARK_SCALED";
    const primary = [...validMarks].reverse().find((m) => m.distanceMeters >= 600) ?? validMarks[validMarks.length - 1];
    const rawVdot = computeRawMarkVdot(primary.distanceMeters, primary.durationSecs);
    let alpha = 1;
    if (primary.distanceMeters <= 900) {
      alpha = 0.945;
    } else if (primary.distanceMeters <= 1650) {
      alpha = phenotypeOverride === "SPEED" ? 0.96 : phenotypeOverride === "ENDURANCE" ? 0.99 : 0.975;
    }
    vdotAer = round2(clamp(rawVdot * alpha, 22, 90));
    csMps = round3(clamp(solveVelocityMpmForTargetVo2(0.9215 * vdotAer) / 60, 2.5, 6.8));
    const dPrimePrior = phenotypeOverride === "SPEED" ? 265 : phenotypeOverride === "ENDURANCE" ? 180 : 215;
    if (primary.distanceMeters <= 1650) {
      const impliedD = clamp(primary.distanceMeters - csMps * primary.durationSecs, 140, 320);
      dPrimeMeters = Math.round(0.5 * dPrimePrior + 0.5 * impliedD);
    } else {
      dPrimeMeters = dPrimePrior;
    }
  } else {
    modelSource = "PROFILE_THRESHOLD_FALLBACK";
    const safeThresh = clamp(thresholdPaceSecsPerKm || 255, 130, 460);
    vdotAer = round2(clamp(vo2AtVelocityMpm(6e4 / safeThresh) / 0.88, 22, 90));
    csMps = round3(clamp(solveVelocityMpmForTargetVo2(0.9215 * vdotAer) / 60, 2.5, 6.8));
    dPrimeMeters = phenotypeOverride === "SPEED" ? 260 : phenotypeOverride === "ENDURANCE" ? 180 : 215;
  }
  const masMps = round3(solveVelocityMpmForTargetVo2(vdotAer) / 60);
  let mssMps;
  if (typeof maxSprintSpeedMps === "number" && maxSprintSpeedMps >= 4.5) {
    mssMps = clamp(maxSprintSpeedMps, 4.5, 11.2);
  } else if (typeof flying30mSecs === "number" && flying30mSecs >= 2.6 && flying30mSecs <= 8) {
    mssMps = clamp(30 / flying30mSecs, 4.5, 11.2);
  } else {
    const mssFromDPrime = masMps * (1.26 + 118e-5 * dPrimeMeters);
    const mark400 = validMarks.find(
      (m) => m.distanceMeters >= 350 && m.distanceMeters <= 450
    );
    const mark800 = validMarks.find(
      (m) => m.distanceMeters >= 750 && m.distanceMeters <= 850
    );
    const est400 = mark400 ? mark400.distanceMeters / mark400.durationSecs * 1.11 : 0;
    const est800 = mark800 ? mark800.distanceMeters / mark800.durationSecs * 1.23 : 0;
    mssMps = clamp(Math.max(mssFromDPrime, est400, est800), 4.5, 11.2);
  }
  mssMps = round3(mssMps);
  const asrMps = round2(Math.max(1.2, mssMps - masMps));
  const srr = round3(mssMps / Math.max(2, masMps));
  const phenotype = classifySpeedReservePhenotype(srr, dPrimeMeters, phenotypeOverride);
  const paceE = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.7, [175, 540]);
  const paceSubT = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.86, [140, 430]);
  const paceT = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.88, [140, 430]);
  const paceCv = round1(clamp(1e3 / csMps, 135, 420));
  const paceI = solveTrackPaceSecsPerKmForPctVdot(vdotAer, 0.98, [125, 390]);
  const t1550 = (1550 - dPrimeMeters) / csMps;
  const pace1550Hyperbolic = Math.max(185, t1550) / 1550 * 1e3;
  const rawPaceR = modelSource === "PROFILE_THRESHOLD_FALLBACK" ? Math.min(paceI - 15, pace1550Hyperbolic) : Math.min(paceI - 6, pace1550Hyperbolic);
  const paceR = round1(clamp(rawPaceR, 110, 360));
  const t800Eff = (800 - 0.8 * dPrimeMeters) / csMps;
  const v800Eff = 800 / Math.max(92, t800Eff);
  const vFr = Math.max(v800Eff, masMps + 0.35 * asrMps, 1e3 / Math.max(105, paceR - 10));
  const paceFr = round1(clamp(1e3 / vFr, 95, 330));
  const zones = {
    E: buildSplitRow("E", "Easy / Recovery", 0.7, paceE),
    SUB_T: buildSplitRow("SUB_T", "Norwegian Sub-Threshold", 0.86, paceSubT),
    T: buildSplitRow("T", "Lactate Threshold", 0.88, paceT),
    CV: buildSplitRow("CV", "Critical Velocity (CS)", 0.9215, paceCv),
    I: buildSplitRow("I", "VO2max Interval", 0.98, paceI),
    R: buildSplitRow("R", "Mile / 1500m Repetition", 1.07, paceR),
    FR: buildSplitRow("FR", "800m / Fast Repetition", 1.18, paceFr)
  };
  return {
    modelSource,
    csMps,
    criticalPaceSecsPerKm: paceCv,
    dPrimeMeters,
    vdotAer,
    vdotRawBest,
    masMps,
    mssMps,
    asrMps,
    srr,
    phenotype,
    thresholdPaceSecsPerKm: paceT,
    zones
  };
}
function solve400mRacePaceSecsPerKm(profile) {
  const t400Eff = Math.max(
    43,
    (400 - 0.62 * profile.dPrimeMeters) / Math.max(2, profile.csMps)
  );
  const v400Hyper = 400 / t400Eff;
  const v400Asr = profile.masMps + 0.55 * profile.asrMps;
  const vMinFasterThan800 = 1e3 / Math.max(85, profile.zones.FR.paceSecsPerKm - 14);
  const v400 = Math.max(v400Hyper, v400Asr, vMinFasterThan800);
  return round1(clamp(1e3 / v400, 95, 290));
}

// src/physiology/trackProgressionAndKalmanEngine.ts
var clamp2 = (val, min, max) => Math.max(min, Math.min(max, val));
var round12 = (val) => Number(val.toFixed(1));
function computeTrackExecutionScore(input) {
  const splits = (input.workSplitsSecs || []).filter((s) => Number.isFinite(s) && s > 0);
  const k = splits.length;
  const target = Math.max(10, input.targetSplitSecs || (k > 0 ? splits[0] : 60));
  if (k === 0) {
    return {
      totalScore: 80,
      paceAdherenceScore: 80,
      splitDisciplineScore: 80,
      restFidelityScore: 100,
      driftRetentionScore: 80,
      positiveSplitFadePct: 0,
      mapePct: 0,
      cvPct: 0,
      meanActualRestSecs: input.plannedRestSecs || 0,
      workoutHeroFlag: false,
      restCheatingFlag: false,
      verdictLabel: "Awaiting Interval Splits"
    };
  }
  const mapePct = splits.reduce((acc, s) => acc + Math.abs(s - target) / target, 0) * (100 / k);
  const paceAdherenceScore = clamp2(100 - 4.5 * mapePct, 0, 100);
  const sliceLen = k >= 4 ? 2 : 1;
  const openMean = splits.slice(0, sliceLen).reduce((a, b) => a + b, 0) / sliceLen;
  const closeMean = splits.slice(k - sliceLen).reduce((a, b) => a + b, 0) / sliceLen;
  const positiveSplitFadePct = Math.max(0, (closeMean - openMean) / target * 100);
  const meanSplit = splits.reduce((a, b) => a + b, 0) / k;
  const variance = splits.reduce((a, b) => a + (b - meanSplit) ** 2, 0) / k;
  const cvPct = Math.sqrt(variance) / Math.max(1, meanSplit) * 100;
  const workoutHeroFlag = k >= 2 && (splits[0] < target * 0.975 && splits[k - 1] > target * 1.025 || positiveSplitFadePct >= 5 && splits[0] < target * 0.985);
  const heroPenalty = workoutHeroFlag ? 22 : 0;
  const splitDisciplineScore = clamp2(
    100 - 2.5 * positiveSplitFadePct - 2 * cvPct - heroPenalty,
    0,
    100
  );
  const plannedRest = Math.max(0, input.plannedRestSecs || 0);
  const actualArr = Array.isArray(input.actualRestSecs) ? input.actualRestSecs.filter((r) => Number.isFinite(r) && r >= 0) : typeof input.actualRestSecs === "number" && Number.isFinite(input.actualRestSecs) ? [input.actualRestSecs] : [plannedRest];
  const meanActualRestSecs = actualArr.length > 0 ? actualArr.reduce((a, b) => a + b, 0) / actualArr.length : plannedRest;
  let restFidelityScore = 100;
  if (plannedRest > 0) {
    if (meanActualRestSecs > plannedRest) {
      const excessPct = (meanActualRestSecs - plannedRest) / plannedRest * 100;
      restFidelityScore = clamp2(100 - 1.8 * excessPct, 0, 100);
    } else if (meanActualRestSecs < plannedRest) {
      const shortPct = (plannedRest - meanActualRestSecs) / plannedRest * 100;
      restFidelityScore = clamp2(100 - 0.4 * shortPct, 65, 100);
    }
  }
  const restCheatingFlag = plannedRest > 0 && restFidelityScore < 70;
  const decoupling = input.aerobicDecouplingPct ?? 2.5;
  const strideFade = input.strideLengthFadePct ?? 0;
  const driftRetentionScore = clamp2(
    88 - Math.max(0, decoupling - 2.5) * 3.5 - positiveSplitFadePct * 1.5 - Math.max(0, -strideFade - 1.5) * 2.5 + (k >= 3 && decoupling <= 2.5 && positiveSplitFadePct <= 1 ? 8 : 0),
    0,
    100
  );
  const rawTotal = 0.35 * paceAdherenceScore + 0.3 * splitDisciplineScore + 0.15 * restFidelityScore + 0.2 * driftRetentionScore;
  const totalScore = round12(clamp2(rawTotal, 0, 100));
  const verdictLabel = restCheatingFlag ? "Rest-Cheated Session" : workoutHeroFlag ? "Workout Hero Flag" : totalScore >= 90 ? "Precision Track Execution" : totalScore >= 75 ? "Controlled Stimulus" : "High Metabolic Drift";
  return {
    totalScore,
    paceAdherenceScore: round12(paceAdherenceScore),
    splitDisciplineScore: round12(splitDisciplineScore),
    restFidelityScore: round12(restFidelityScore),
    driftRetentionScore: round12(driftRetentionScore),
    positiveSplitFadePct: round12(positiveSplitFadePct),
    mapePct: round12(mapePct),
    cvPct: round12(cvPct),
    meanActualRestSecs: Math.round(meanActualRestSecs),
    workoutHeroFlag,
    restCheatingFlag,
    verdictLabel
  };
}
function extractTrackIntervalMetricsForActivity(activity, fallbackThresholdPaceSecsPerKm = 240, plannedRestOverrideSecs) {
  const workReps = (activity.intervals || []).filter((iv) => iv.type === "WORK");
  if (workReps.length >= 2) {
    const recReps = (activity.intervals || []).filter((iv) => iv.type === "RECOVERY");
    const workSplitsSecs = workReps.map((w) => w.durationSecs);
    const meanRepDist = workReps.reduce((s, w) => s + (w.distanceMeters || 400), 0) / workReps.length;
    const meanSpeedMps = workReps.reduce(
      (s, w) => s + (w.distanceMeters || meanRepDist) / Math.max(1, w.durationSecs),
      0
    ) / workReps.length;
    const safeThreshMps = 1e3 / Math.max(115, fallbackThresholdPaceSecsPerKm || 240);
    const impliedZoneMps = meanSpeedMps >= safeThreshMps * 1.12 ? safeThreshMps * 1.16 : meanSpeedMps >= safeThreshMps * 1.03 ? safeThreshMps * 1.07 : safeThreshMps;
    const targetSplitSecs = round12(meanRepDist / Math.max(1.5, impliedZoneMps));
    const plannedRestSecs = typeof plannedRestOverrideSecs === "number" ? plannedRestOverrideSecs : recReps.length > 0 ? recReps[0].durationSecs : 60;
    const actualRestSecs = recReps.length > 0 ? recReps.map((r) => r.durationSecs) : [plannedRestSecs];
    return {
      workSplitsSecs,
      targetSplitSecs,
      plannedRestSecs,
      actualRestSecs,
      aerobicDecouplingPct: activity.aerobicDecouplingPct
    };
  }
  if (activity.officialRaceData?.lapSplitsSecs && activity.officialRaceData.lapSplitsSecs.length >= 2) {
    const splits = activity.officialRaceData.lapSplitsSecs;
    const avgSplit = splits.reduce((a, b) => a + b, 0) / splits.length;
    return {
      workSplitsSecs: splits,
      targetSplitSecs: round12(avgSplit),
      plannedRestSecs: 0,
      actualRestSecs: [0],
      aerobicDecouplingPct: activity.aerobicDecouplingPct
    };
  }
  return null;
}

// src/physiology/workoutDebrief.ts
function formatClockOffset(sec) {
  const clean = Math.max(0, Math.round(sec));
  const h = Math.floor(clean / 3600);
  const m = Math.floor(clean % 3600 / 60);
  const s = clean % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
function formatPaceMmSs(secsPerKm) {
  const mins = Math.floor(secsPerKm / 60);
  const secs = Math.round(secsPerKm % 60);
  return secs === 60 ? `${mins + 1}:00/km` : `${mins}:${String(secs).padStart(2, "0")}/km`;
}
function generatePostWorkoutDebrief(activity, streams, profile) {
  if (!streams || !Array.isArray(streams.time) || streams.time.length < 120) {
    return null;
  }
  const n = streams.time.length;
  const totalDurationSec = streams.time[n - 1] || n;
  const thresholds = resolveThresholdsAtDate(
    profile,
    (activity.startDateLocal || "").slice(0, 10)
  );
  const watts = streams.watts;
  const hr = streams.heartrate;
  const vel = streams.velocitySmooth;
  const hasWatts = Array.isArray(watts) && watts.length === n && watts.some((w) => w > 20);
  const hasVel = Array.isArray(vel) && vel.length === n && vel.some((v) => v > 0.8);
  const hasHr = Array.isArray(hr) && hr.length === n && hr.some((h) => h > 60);
  if (!hasWatts && !hasVel) return null;
  const npWatts = hasWatts ? computeNormalizedPower(watts) : null;
  const gapResult = hasVel ? computeGradeAdjustedPaceStream(vel, streams.altitude, streams.distance) : { gapVelocityMps: [], avgGapSecsPerKm: null };
  const insights = [];
  let wPrimeMinPct = null;
  if (hasWatts) {
    const cp = activity.environment === "INDOOR" ? thresholds.indoorFtp : thresholds.ftp;
    const wCap = profile.wPrime > 4e3 ? profile.wPrime : 18e3;
    let wBal = wCap;
    let minWBal = wCap;
    let nadirIdx = 0;
    for (let i = 1; i < n; i++) {
      const dt = Math.max(1, (streams.time[i] ?? i) - (streams.time[i - 1] ?? i - 1));
      const p = watts[i] || 0;
      if (p > cp) {
        wBal = Math.max(0, wBal - (p - cp) * dt);
      } else {
        const dcp = Math.max(5, cp - p);
        const tau = 546 * Math.exp(-0.01 * dcp) + 316;
        wBal = Math.min(wCap, wBal + (wCap - wBal) * (1 - Math.exp(-dt / tau)));
      }
      if (wBal < minWBal) {
        minWBal = wBal;
        nadirIdx = i;
      }
    }
    wPrimeMinPct = Math.round(minWBal / wCap * 100);
    const nadirTimeSec = streams.time[nadirIdx] ?? nadirIdx;
    const winStart = Math.max(0, nadirTimeSec - 60);
    const winEnd = Math.min(totalDurationSec, nadirTimeSec + 45);
    const burnedKj = ((wCap - minWBal) / 1e3).toFixed(1);
    insights.push({
      id: "w-prime-nadir",
      badge: `W' Min ${wPrimeMinPct}%`,
      severity: wPrimeMinPct < 25 ? "STRAINED" : wPrimeMinPct < 55 ? "CAUTION" : "PRIME",
      title: wPrimeMinPct < 25 ? `Deep Anaerobic Match Burn (-${burnedKj} kJ above ${cp}W)` : wPrimeMinPct < 60 ? `Controlled Supra-Threshold Surge (-${burnedKj} kJ W')` : `Sub-Threshold Aerobic Discipline (${wPrimeMinPct}% W' Reserve Kept)`,
      detail: wPrimeMinPct < 60 ? `Anaerobic reserve dipped to ${wPrimeMinPct}% at ${formatClockOffset(nadirTimeSec)} before reconstituting.` : `Zero costly supra-threshold spikes above ${cp}W; anaerobic reserve stayed above ${wPrimeMinPct}% throughout.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
    });
  } else if (hasVel && gapResult.gapVelocityMps.length === n) {
    const csMps = 1e3 / Math.max(150, thresholds.thresholdPaceSecsPerKm);
    const dCap = 220;
    let dBal = dCap;
    let minDBal = dCap;
    let nadirIdx = 0;
    for (let i = 1; i < n; i++) {
      const dt = Math.max(1, (streams.time[i] ?? i) - (streams.time[i - 1] ?? i - 1));
      const v = gapResult.gapVelocityMps[i] || 0;
      if (v > csMps) {
        dBal = Math.max(0, dBal - (v - csMps) * dt);
      } else {
        dBal = Math.min(dCap, dBal + (dCap - dBal) * (1 - Math.exp(-dt / 180)));
      }
      if (dBal < minDBal) {
        minDBal = dBal;
        nadirIdx = i;
      }
    }
    wPrimeMinPct = Math.round(minDBal / dCap * 100);
    const nadirTimeSec = streams.time[nadirIdx] ?? nadirIdx;
    const winStart = Math.max(0, nadirTimeSec - 60);
    const winEnd = Math.min(totalDurationSec, nadirTimeSec + 45);
    insights.push({
      id: "d-prime-nadir",
      badge: `D' Min ${wPrimeMinPct}%`,
      severity: wPrimeMinPct < 25 ? "STRAINED" : wPrimeMinPct < 60 ? "CAUTION" : "PRIME",
      title: wPrimeMinPct < 55 ? `Peak Supra-Threshold Pace Surge (${wPrimeMinPct}% D' Floor)` : `Controlled Threshold Pacing (${wPrimeMinPct}% D' Intact)`,
      detail: `Session average GAP ${gapResult.avgGapSecsPerKm ? formatPaceMmSs(gapResult.avgGapSecsPerKm) : "\u2014"}; deepest speed-reserve draw hit at ${formatClockOffset(nadirTimeSec)}.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
    });
  }
  let aerobicDecouplingPct = null;
  if (hasHr && n >= 600) {
    const startIdx = Math.min(300, Math.floor(n * 0.12));
    const midIdx = startIdx + Math.floor((n - startIdx) / 2);
    const calcEf = (from, to) => {
      let outSum = 0;
      let hrSum = 0;
      let valid = 0;
      for (let i = from; i < to; i++) {
        const h = hr[i] || 0;
        const output = hasWatts ? watts[i] || 0 : (gapResult.gapVelocityMps[i] || 0) * 60;
        if (h > 85 && output > 25) {
          outSum += output;
          hrSum += h;
          valid++;
        }
      }
      if (valid < 60 || hrSum <= 0) return null;
      return outSum / hrSum;
    };
    const ef1 = calcEf(startIdx, midIdx);
    const ef2 = calcEf(midIdx, n);
    if (ef1 && ef2 && ef1 > 0) {
      aerobicDecouplingPct = Math.round((ef1 - ef2) / ef1 * 1e3) / 10;
      let driftIdx = midIdx;
      const winLen = 300;
      for (let i = startIdx + winLen; i <= n - winLen; i += 30) {
        const winEf = calcEf(i, i + winLen);
        if (winEf && (ef1 - winEf) / ef1 >= 0.05) {
          driftIdx = i;
          break;
        }
      }
      const driftTimeSec = streams.time[driftIdx] ?? driftIdx;
      const winStart = Math.max(0, driftTimeSec - 30);
      const winEnd = Math.min(totalDurationSec, driftTimeSec + 120);
      insights.push({
        id: "cardiac-decoupling",
        badge: `Drift ${aerobicDecouplingPct > 0 ? "+" : ""}${aerobicDecouplingPct.toFixed(1)}%`,
        severity: aerobicDecouplingPct <= 5 ? "PRIME" : aerobicDecouplingPct <= 8.5 ? "CAUTION" : "STRAINED",
        title: aerobicDecouplingPct <= 5 ? `Strong Aerobic Durability (${aerobicDecouplingPct.toFixed(1)}% Pw:Hr Drift)` : `Cardiac Decoupling Onset at ${formatClockOffset(driftTimeSec)} (+${aerobicDecouplingPct.toFixed(1)}%)`,
        detail: aerobicDecouplingPct <= 5 ? `Output-to-HR efficiency stayed locked (<5% ceiling) across the second half.` : `Efficiency factor dropped >5% starting around ${formatClockOffset(driftTimeSec)}\u2014review hydration, cooling, or carbohydrate intake.`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
      });
    }
  }
  const workReps = Array.isArray(activity.intervals) ? activity.intervals.filter((iv) => iv.type === "WORK") : [];
  let bestHrr60Bpm = null;
  let anchoredHrr60MeanBpm = null;
  if (hasHr && n >= 120 && workReps.length >= 1) {
    const findNearestIdx = (targetSec) => {
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < n; i++) {
        const diff = Math.abs((streams.time[i] ?? i) - targetSec);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      return bestDiff <= 6 ? bestIdx : -1;
    };
    const repDrops = [];
    for (let r = 0; r < workReps.length; r++) {
      const rep = workReps[r];
      const repEndSec = rep.startTimeSecs + rep.durationSecs;
      const nextWorkStart = r + 1 < workReps.length ? workReps[r + 1].startTimeSecs : Infinity;
      const recoverySpan = Math.min(totalDurationSec, nextWorkStart) - repEndSec;
      if (recoverySpan < 55) continue;
      let peakHr = 0;
      for (let i = 0; i < n; i++) {
        const t = streams.time[i] ?? i;
        if (t >= repEndSec - 5 && t <= repEndSec + 4) {
          peakHr = Math.max(peakHr, hr[i] || 0);
        }
      }
      const afterIdx = findNearestIdx(Math.min(repEndSec + 60, repEndSec + recoverySpan));
      if (peakHr > 90 && afterIdx >= 0) {
        const drop = peakHr - (hr[afterIdx] || peakHr);
        if (drop >= 8 && drop <= 85) {
          repDrops.push({ repNumber: r + 1, repEndSec, peakHr, dropBpm: drop });
        }
      }
    }
    if (repDrops.length > 0) {
      anchoredHrr60MeanBpm = Math.round(
        repDrops.reduce((s, d) => s + d.dropBpm, 0) / repDrops.length
      );
      const bestRepDrop = [...repDrops].sort((a, b) => b.dropBpm - a.dropBpm)[0];
      bestHrr60Bpm = Math.round(bestRepDrop.dropBpm);
      const winStart = Math.max(0, Math.round(bestRepDrop.repEndSec - 15));
      const winEnd = Math.min(totalDurationSec, Math.round(bestRepDrop.repEndSec + 75));
      insights.push({
        id: "hrr60-recovery",
        badge: `Anchored HRR60 -${anchoredHrr60MeanBpm} bpm`,
        severity: anchoredHrr60MeanBpm >= 26 ? "PRIME" : anchoredHrr60MeanBpm >= 16 ? "INFO" : "CAUTION",
        title: `Rep-Anchored Parasympathetic Recovery (-${anchoredHrr60MeanBpm} bpm mean across ${repDrops.length} recoveries)`,
        detail: `Peak recovery hit at Rep #${bestRepDrop.repNumber} finish (${formatClockOffset(bestRepDrop.repEndSec)}, ${Math.round(bestRepDrop.peakHr)} -> ${Math.round(bestRepDrop.peakHr - bestRepDrop.dropBpm)} bpm in 60s).`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
      });
    }
  }
  if (bestHrr60Bpm === null && hasHr && n >= 240) {
    const lthr = activity.sportCategory === "Running" ? thresholds.runLthr : thresholds.lthr;
    let maxDrop = 0;
    let bestDropIdx = -1;
    for (let i = 60; i < n - 65; i++) {
      const peakHr = hr[i] || 0;
      if (peakHr >= lthr * 0.92) {
        const after60 = hr[i + 60] || peakHr;
        const drop = peakHr - after60;
        if (drop > maxDrop && drop <= 75) {
          maxDrop = drop;
          bestDropIdx = i;
        }
      }
    }
    if (maxDrop >= 14 && bestDropIdx >= 0) {
      bestHrr60Bpm = Math.round(maxDrop);
      const dropTimeSec = streams.time[bestDropIdx] ?? bestDropIdx;
      const winStart = Math.max(0, dropTimeSec - 15);
      const winEnd = Math.min(totalDurationSec, dropTimeSec + 75);
      insights.push({
        id: "hrr60-recovery",
        badge: `HRR60 -${bestHrr60Bpm} bpm`,
        severity: bestHrr60Bpm >= 28 ? "PRIME" : bestHrr60Bpm >= 18 ? "INFO" : "CAUTION",
        title: `Fast Parasympathetic Rebound (-${bestHrr60Bpm} bpm in 60s)`,
        detail: `Following peak effort at ${formatClockOffset(dropTimeSec)} (${Math.round(hr[bestDropIdx])} bpm), heart rate recovered ${bestHrr60Bpm} bpm in 60 seconds.`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
      });
    }
  }
  let strideLengthFadePct = null;
  let cadenceFadePct = null;
  let fadePrimaryDriver = null;
  if (activity.sportCategory === "Running" && workReps.length >= 3) {
    const repBiomech = [];
    for (const rep of workReps) {
      const repEnd = rep.startTimeSecs + rep.durationSecs;
      const speedMps = rep.distanceMeters > 0 && rep.durationSecs > 0 ? rep.distanceMeters / rep.durationSecs : rep.avgPaceSecsPerKm && rep.avgPaceSecsPerKm > 0 ? 1e3 / rep.avgPaceSecsPerKm : 0;
      let cadRaw = rep.avgCadence;
      if ((!cadRaw || cadRaw <= 0) && Array.isArray(streams.cadence) && streams.cadence.length === n) {
        let sum = 0;
        let cnt = 0;
        for (let i = 0; i < n; i++) {
          const t = streams.time[i] ?? i;
          if (t >= rep.startTimeSecs && t <= repEnd && (streams.cadence[i] || 0) > 20) {
            sum += streams.cadence[i];
            cnt++;
          }
        }
        if (cnt > 0) cadRaw = sum / cnt;
      }
      if (speedMps > 1.5 && cadRaw && cadRaw > 50) {
        const spm = cadRaw < 120 ? cadRaw * 2 : cadRaw;
        const strideMeters = rep.strideLengthMeters ?? speedMps * 60 / spm;
        repBiomech.push({ strideMeters, cadenceSpm: spm });
      }
    }
    if (repBiomech.length >= 3) {
      const half = Math.max(1, Math.floor(repBiomech.length / 2));
      const openSlice = repBiomech.slice(0, half);
      const closeSlice = repBiomech.slice(repBiomech.length - half);
      const mean2 = (arr, fn) => arr.reduce((s, item) => s + fn(item), 0) / arr.length;
      const openStride = mean2(openSlice, (x) => x.strideMeters);
      const closeStride = mean2(closeSlice, (x) => x.strideMeters);
      const openCad = mean2(openSlice, (x) => x.cadenceSpm);
      const closeCad = mean2(closeSlice, (x) => x.cadenceSpm);
      strideLengthFadePct = Number(((closeStride - openStride) / Math.max(0.2, openStride) * 100).toFixed(1));
      cadenceFadePct = Number(((closeCad - openCad) / Math.max(60, openCad) * 100).toFixed(1));
      if (strideLengthFadePct <= -1.5 && Math.abs(strideLengthFadePct) >= Math.abs(cadenceFadePct)) {
        fadePrimaryDriver = "STRIDE_LENGTH_LOSS";
      } else if (cadenceFadePct <= -1.5 && Math.abs(cadenceFadePct) > Math.abs(strideLengthFadePct)) {
        fadePrimaryDriver = "CADENCE_DROP";
      } else {
        fadePrimaryDriver = "EVEN_MECHANICS";
      }
      const lastRep = workReps[workReps.length - 1];
      const winStart = Math.max(0, Math.round(lastRep.startTimeSecs - 15));
      const winEnd = Math.min(totalDurationSec, Math.round(lastRep.startTimeSecs + lastRep.durationSecs + 15));
      insights.push({
        id: "stride-cadence-fade",
        badge: fadePrimaryDriver === "STRIDE_LENGTH_LOSS" ? `Stride ${strideLengthFadePct.toFixed(1)}%` : fadePrimaryDriver === "CADENCE_DROP" ? `Cadence ${cadenceFadePct.toFixed(1)}%` : "Biomech Locked",
        severity: fadePrimaryDriver === "EVEN_MECHANICS" ? "PRIME" : Math.min(strideLengthFadePct, cadenceFadePct) <= -4.5 ? "STRAINED" : "CAUTION",
        title: fadePrimaryDriver === "STRIDE_LENGTH_LOSS" ? `Closing Fade Driven by Stride-Length Loss (${strideLengthFadePct.toFixed(1)}% vs ${cadenceFadePct.toFixed(1)}% Cadence)` : fadePrimaryDriver === "CADENCE_DROP" ? `Closing Fade Driven by Cadence Drop (${cadenceFadePct.toFixed(1)}% spm vs ${strideLengthFadePct.toFixed(1)}% Stride)` : `Consistent Closing Stride & Turnover (${strideLengthFadePct >= 0 ? "+" : ""}${strideLengthFadePct.toFixed(1)}% Stride / ${cadenceFadePct >= 0 ? "+" : ""}${cadenceFadePct.toFixed(1)}% spm)`,
        detail: `Comparing opening vs closing ${workReps.length}-rep biomechanics: stride ${openStride.toFixed(2)}m -> ${closeStride.toFixed(2)}m; cadence ${Math.round(openCad)} -> ${Math.round(closeCad)} spm.`,
        windowStartSec: winStart,
        windowEndSec: winEnd,
        timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
      });
    }
  }
  if (insights.length < 3) {
    const qLen = Math.max(30, Math.floor(n / 4));
    const avgSlice = (from, to) => {
      let s = 0;
      let c = 0;
      for (let i = from; i < to; i++) {
        const v = hasWatts ? watts[i] || 0 : (gapResult.gapVelocityMps[i] || 0) * 60;
        if (v > 10) {
          s += v;
          c++;
        }
      }
      return c > 0 ? s / c : 0;
    };
    const q1 = avgSlice(0, qLen);
    const q4 = avgSlice(n - qLen, n);
    const deltaPct = q1 > 0 ? Math.round((q4 - q1) / q1 * 1e3) / 10 : 0;
    const winStart = Math.max(0, totalDurationSec - Math.min(180, qLen));
    const winEnd = totalDurationSec;
    insights.push({
      id: "closing-split",
      badge: `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% Finish`,
      severity: deltaPct >= -3 ? "PRIME" : deltaPct >= -8 ? "CAUTION" : "STRAINED",
      title: deltaPct >= 1 ? `Negative-Split Closing Quarter (+${deltaPct.toFixed(1)}%)` : deltaPct >= -4 ? `Even-Paced Final Quarter (${deltaPct.toFixed(1)}%)` : `Late-Session Output Fade (${deltaPct.toFixed(1)}%)`,
      detail: `Final quarter output compared against opening quarter across the closing ${Math.round((winEnd - winStart) / 60)}m window.`,
      windowStartSec: winStart,
      windowEndSec: winEnd,
      timestampLabel: `${formatClockOffset(winStart)}\u2013${formatClockOffset(winEnd)}`
    });
  }
  let executionScore = 88;
  const trackMetrics = activity.sportCategory === "Running" && workReps.length >= 2 ? extractTrackIntervalMetricsForActivity(activity, thresholds.thresholdPaceSecsPerKm) : null;
  if (trackMetrics) {
    executionScore = Math.round(
      computeTrackExecutionScore({
        ...trackMetrics,
        aerobicDecouplingPct,
        strideLengthFadePct
      }).totalScore
    );
  } else {
    if (aerobicDecouplingPct !== null) {
      if (aerobicDecouplingPct <= 3.5) executionScore += 6;
      else if (aerobicDecouplingPct > 7.5) executionScore -= 10;
    }
    if (bestHrr60Bpm !== null && bestHrr60Bpm >= 25) executionScore += 4;
    executionScore = Math.max(55, Math.min(99, executionScore));
  }
  const headline = hasWatts ? `NP ${npWatts ?? "\u2014"}W \xB7 ${aerobicDecouplingPct !== null ? `${aerobicDecouplingPct.toFixed(1)}% Pw:Hr Drift` : `${Math.round(totalDurationSec / 60)}m 1Hz Signal Pass`}` : `GAP ${gapResult.avgGapSecsPerKm ? formatPaceMmSs(gapResult.avgGapSecsPerKm) : "\u2014"} \xB7 ${aerobicDecouplingPct !== null ? `${aerobicDecouplingPct.toFixed(1)}% Pa:Hr Drift` : `${Math.round(totalDurationSec / 60)}m 1Hz Signal Pass`}`;
  return {
    activityId: activity.id,
    headline,
    executionScore,
    normalizedPowerWatts: npWatts,
    gradeAdjustedPaceSecsPerKm: gapResult.avgGapSecsPerKm,
    aerobicDecouplingPct,
    wPrimeMinPct,
    bestHrr60Bpm,
    anchoredHrr60MeanBpm,
    strideLengthFadePct,
    cadenceFadePct,
    fadePrimaryDriver,
    insights: insights.slice(0, activity.sportCategory === "Running" ? 4 : 3)
  };
}

// server/routers/vaultAndPhysiologyRouter.ts
var vaultAndPhysiologyRouter = express.Router();
vaultAndPhysiologyRouter.get("/api/vault/status", (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  res.json({
    ok: true,
    storageBackend: getVaultStorageBackend(),
    encryptionCipher: "AES-256-GCM",
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    sessionIsolated: Boolean(claims?.sid),
    cleanRoomPolicy: "FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY"
  });
});
vaultAndPhysiologyRouter.post(
  "/api/physiology/orthopedic-summary",
  (req, res) => {
    try {
      const { activities = [], athleteProfile = {}, todayPlannedEvents = [] } = req.body || {};
      const summary = evaluateOrthopedicInterference(
        Array.isArray(activities) ? activities : [],
        athleteProfile,
        Array.isArray(todayPlannedEvents) ? todayPlannedEvents : []
      );
      res.json({ ok: true, summary });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to compute orthopedic summary."
      });
    }
  }
);
vaultAndPhysiologyRouter.post("/api/physiology/debrief", (req, res) => {
  try {
    const { activity, streams, athleteProfile } = req.body || {};
    if (!activity || !streams || !athleteProfile) {
      res.status(400).json({ error: "activity, streams, and athleteProfile are required." });
      return;
    }
    const report = generatePostWorkoutDebrief(activity, streams, athleteProfile);
    res.json({ ok: true, report });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to generate post-workout debrief."
    });
  }
});

// server/routers/athleteStateRouter.ts
import express2 from "express";
var athleteStateRouter = express2.Router();
async function ensureStoreSessionHydrated(req) {
  const store = getScopedRuntimeStore(req);
  if (store?.stravaAthleteId) return;
  const verified = getVerifiedSessionClaims(req);
  if (!verified?.sid) return;
  const shortSid = verified.sid.slice(0, 24);
  const persisted = await loadTenantVaultAsync(
    `session_${shortSid}`,
    null
  ) || await loadTenantVaultAsync(
    `session_${verified.sid}`,
    null
  );
  if (persisted?.stravaAthleteId && store) {
    store.stravaAthleteId = String(persisted.stravaAthleteId);
  }
}
var SAFE_PROFILE_KEYS = [
  "name",
  "primarySport",
  "weightKg",
  "restingHr",
  "ftp",
  "indoorFtp",
  "runFtp",
  "lthr",
  "maxHr",
  "runLthr",
  "runMaxHr",
  "thresholdPaceSecsPerKm",
  "thresholdHistory",
  "safeSportHideWeight",
  "birthMonthYear",
  "academicDivision",
  "competitionGender"
];
function resolveCanonicalAthleteVaultKey(req) {
  const verified = getVerifiedSessionClaims(req);
  if (verified && !isCanonicalAuthenticatedClaims(verified)) {
    return null;
  }
  const sub = String(verified?.sub || "").trim();
  if (sub.startsWith("usr_")) {
    const cleanUserId = sub.replace(/[^0-9a-zA-Z_-]/g, "");
    if (cleanUserId) {
      return `athlete_state_user_${cleanUserId}`;
    }
  }
  const store = getScopedRuntimeStore(req);
  const stravaId = String(store?.stravaAthleteId || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (stravaId) {
    return `athlete_state_strava_${stravaId}`;
  }
  if (verified?.sid) {
    const cleanSid = verified.sid.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 32);
    if (cleanSid) {
      return `athlete_state_sid_${cleanSid}`;
    }
  }
  const scopeKey = resolveSessionScopeKey(req);
  if (scopeKey && !verified) {
    return `athlete_state_sid_${scopeKey}`;
  }
  return null;
}
function sanitizeAthleteCloudState(raw, existing) {
  const input = raw || {};
  const base = existing || {
    version: 1,
    updatedAt: "",
    plannedEvents: [],
    targetGoals: [],
    annualMileageGoals: []
  };
  const plannedEvents = Array.isArray(input.plannedEvents) ? input.plannedEvents.slice(0, 450).map((ev) => ({
    id: String(ev?.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    date: String(ev?.date || "").slice(0, 10),
    name: String(ev?.name || "Structured Workout").slice(0, 140),
    sportCategory: ev?.sportCategory || "Running",
    environmentPreference: ev?.environmentPreference || "FLEXIBLE",
    description: String(ev?.description || "").slice(0, 1200),
    plannedLoad: Number(ev?.plannedLoad || 0),
    plannedDurationSecs: Number(ev?.plannedDurationSecs || 0),
    targetZoneSummary: String(ev?.targetZoneSummary || "").slice(0, 140),
    ...typeof ev?.workoutSyntax === "string" ? { workoutSyntax: ev.workoutSyntax.slice(0, 4e3) } : {},
    ...typeof ev?.scheduledTime === "string" && ev.scheduledTime.trim() ? { scheduledTime: ev.scheduledTime.trim().slice(0, 16) } : {},
    ...ev?.sessionSlot === "SINGLE" || ev?.sessionSlot === "AM" || ev?.sessionSlot === "PM" ? { sessionSlot: ev.sessionSlot } : {},
    ...typeof ev?.locationName === "string" && ev.locationName.trim() ? { locationName: ev.locationName.trim().slice(0, 120) } : {},
    ...typeof ev?.locationCategory === "string" && ev.locationCategory.trim() ? { locationCategory: ev.locationCategory.trim().slice(0, 40) } : {},
    ...typeof ev?.meetingNotes === "string" && ev.meetingNotes.trim() ? { meetingNotes: ev.meetingNotes.trim().slice(0, 240) } : {},
    ...Array.isArray(ev?.structuredSteps) ? { structuredSteps: ev.structuredSteps.slice(0, 80) } : {},
    ...ev?.trackSpec && typeof ev.trackSpec === "object" ? { trackSpec: ev.trackSpec } : {},
    ...ev?.footwearClass ? { footwearClass: ev.footwearClass } : {},
    ...typeof ev?.spikedDistanceMeters === "number" ? { spikedDistanceMeters: ev.spikedDistanceMeters } : {},
    ...ev?.trackFacility ? { trackFacility: ev.trackFacility } : {},
    ...ev?.meetPriorityTier ? { meetPriorityTier: ev.meetPriorityTier } : {},
    ...ev?.source ? { source: ev.source } : {},
    ...ev?.planBlockId ? { planBlockId: String(ev.planBlockId) } : {},
    ...ev?.planBlockName ? { planBlockName: String(ev.planBlockName) } : {},
    ...typeof ev?.planWeekNum === "number" ? { planWeekNum: ev.planWeekNum } : {}
  })) : base.plannedEvents;
  const targetGoals = Array.isArray(input.targetGoals) ? input.targetGoals.slice(0, 120) : base.targetGoals;
  const annualMileageGoals = Array.isArray(input.annualMileageGoals) ? input.annualMileageGoals.slice(0, 24) : base.annualMileageGoals;
  let athleteProfile = base.athleteProfile;
  if (input.athleteProfile && typeof input.athleteProfile === "object") {
    const picked = {};
    for (const key of SAFE_PROFILE_KEYS) {
      if (key in input.athleteProfile && input.athleteProfile[key] !== void 0) {
        picked[key] = input.athleteProfile[key];
      }
    }
    if (Object.keys(picked).length > 0) {
      athleteProfile = picked;
    }
  }
  const distanceUnit = input.distanceUnit === "km" || input.distanceUnit === "mi" ? input.distanceUnit : base.distanceUnit;
  const sessionCheckIns = Array.isArray(input.sessionCheckIns) ? input.sessionCheckIns.slice(0, 200) : base.sessionCheckIns;
  const coachArchivedActivities = Array.isArray(
    input.coachArchivedActivities
  ) ? input.coachArchivedActivities.slice(0, 150).map((act) => ({
    ...act,
    streams: void 0
  })) : base.coachArchivedActivities;
  return {
    version: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    plannedEvents,
    targetGoals,
    annualMileageGoals,
    ...athleteProfile ? { athleteProfile } : {},
    ...distanceUnit ? { distanceUnit } : {},
    ...sessionCheckIns ? { sessionCheckIns } : {},
    ...coachArchivedActivities?.length ? { coachArchivedActivities } : {}
  };
}
async function loadAthleteCloudState(req) {
  await ensureStoreSessionHydrated(req);
  const vaultKey = resolveCanonicalAthleteVaultKey(req);
  if (!vaultKey) return null;
  const existing = await loadTenantVaultAsync(vaultKey, null);
  if (existing && (Array.isArray(existing.plannedEvents) || Array.isArray(existing.coachArchivedActivities) || Boolean(existing.athleteProfile))) {
    return existing;
  }
  const store = getScopedRuntimeStore(req);
  const stravaId = String(store?.stravaAthleteId || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (stravaId) {
    const stravaKey = `athlete_state_strava_${stravaId}`;
    if (stravaKey !== vaultKey) {
      const stravaEnv = await loadTenantVaultAsync(stravaKey, null);
      if (stravaEnv && Array.isArray(stravaEnv.plannedEvents)) {
        await saveTenantVaultAsync(vaultKey, stravaEnv);
        return stravaEnv;
      }
    }
  }
  const verified = getVerifiedSessionClaims(req);
  const sidKey = verified?.sid ? `athlete_state_sid_${verified.sid.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 32)}` : null;
  if (sidKey && sidKey !== vaultKey) {
    const sidEnvelope = await loadTenantVaultAsync(sidKey, null);
    if (sidEnvelope && Array.isArray(sidEnvelope.plannedEvents)) {
      await saveTenantVaultAsync(vaultKey, sidEnvelope);
      return sidEnvelope;
    }
  }
  const legacyFile = getScopedPlannedEventsFile(req);
  const legacyEvents = legacyFile ? loadJsonFile(legacyFile, []) : [];
  if (legacyEvents.length > 0) {
    const migrated = sanitizeAthleteCloudState({ plannedEvents: legacyEvents });
    await saveTenantVaultAsync(vaultKey, migrated);
    return migrated;
  }
  const emptyUnsaved = sanitizeAthleteCloudState({
    plannedEvents: [],
    targetGoals: [],
    annualMileageGoals: []
  });
  emptyUnsaved.updatedAt = "";
  return emptyUnsaved;
}
async function saveAthleteCloudState(req, patch) {
  await ensureStoreSessionHydrated(req);
  const vaultKey = resolveCanonicalAthleteVaultKey(req);
  if (!vaultKey) return null;
  const existing = await loadAthleteCloudState(req);
  const sanitized = sanitizeAthleteCloudState(patch, existing);
  await saveTenantVaultAsync(vaultKey, sanitized);
  return sanitized;
}
athleteStateRouter.get("/api/athlete-state", async (req, res) => {
  try {
    const vaultKey = resolveCanonicalAthleteVaultKey(req);
    if (!vaultKey) {
      res.json({ ok: true, authenticated: false, state: null });
      return;
    }
    const state = await loadAthleteCloudState(req);
    res.json({ ok: true, authenticated: true, vaultKeyScope: vaultKey.slice(0, 20), state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load athlete cloud state"
    });
  }
});
athleteStateRouter.put("/api/athlete-state", async (req, res) => {
  try {
    const vaultKey = resolveCanonicalAthleteVaultKey(req);
    if (!vaultKey) {
      res.status(401).json({ error: "Authentication required to persist athlete cloud state." });
      return;
    }
    const saved = await saveAthleteCloudState(req, req.body || {});
    res.json({ ok: true, authenticated: true, state: saved });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to save athlete cloud state"
    });
  }
});

// server/routers/webhooksAndExportRouter.ts
import { Router } from "express";

// src/physiology/mmpCurves.ts
var CANONICAL_MMP_DURATIONS = [
  { secs: 1, label: "1s" },
  { secs: 5, label: "5s" },
  { secs: 15, label: "15s" },
  { secs: 30, label: "30s" },
  { secs: 60, label: "1m" },
  { secs: 120, label: "2m" },
  { secs: 180, label: "3m" },
  { secs: 300, label: "5m" },
  { secs: 480, label: "8m" },
  { secs: 720, label: "12m" },
  { secs: 1200, label: "20m" },
  { secs: 1800, label: "30m" },
  { secs: 2700, label: "45m" },
  { secs: 3600, label: "60m" },
  { secs: 5400, label: "90m" },
  { secs: 7200, label: "2h" }
];
function computeSlidingWindowPeaks(stream, durationsSecs = CANONICAL_MMP_DURATIONS.map((d) => d.secs)) {
  const n = stream.length;
  if (n === 0) return [];
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = stream[i];
    prefix[i + 1] = prefix[i] + (Number.isFinite(v) && v > 0 ? v : 0);
  }
  const out = [];
  for (const dur of durationsSecs) {
    if (dur <= 0 || dur > n) continue;
    let maxSum = -1;
    let bestStart = 0;
    for (let end = dur; end <= n; end++) {
      const sum = prefix[end] - prefix[end - dur];
      if (sum > maxSum) {
        maxSum = sum;
        bestStart = end - dur;
      }
    }
    const avg = maxSum / dur;
    if (avg > 0) {
      out.push({
        durationSecs: dur,
        bestValue: avg,
        startSecondOffset: bestStart
      });
    }
  }
  return out;
}

// src/physiology/durabilityEngine.ts
var CYCLING_KJ_KG_THRESHOLDS = [0, 10, 20, 30, 40];
var RUNNING_KCAL_THRESHOLDS = [0, 500, 1e3, 1500, 2e3];
function computeFatigueSlicedDurability(params) {
  const { discipline, activities, streamMap, athleteProfile } = params;
  const weightKg = Math.max(42, athleteProfile?.weightKg || 72);
  const baseFtp = Math.max(140, athleteProfile?.ftp || athleteProfile?.indoorFtp || 265);
  const basePaceSecsKm = Math.max(
    165,
    athleteProfile?.thresholdPaceSecsPerKm || 255
  );
  const thresholds = discipline === "Cycling" ? CYCLING_KJ_KG_THRESHOLDS : RUNNING_KCAL_THRESHOLDS;
  const unitLabel = discipline === "Cycling" ? "kJ/kg" : "kcal";
  const bucketBest5mPower = new Array(thresholds.length).fill(0);
  const bucketBest20mPower = new Array(thresholds.length).fill(0);
  const bucketBest5mGap = new Array(thresholds.length).fill(0);
  const bucketBest20mGap = new Array(thresholds.length).fill(0);
  const bucketHrDrifts = thresholds.map(() => []);
  const bucketSampleCounts = new Array(thresholds.length).fill(0);
  const matchingActs = activities.filter((a) => a.sportCategory === discipline);
  for (const act of matchingActs) {
    const stream = streamMap.get(act.id) || act.streams;
    if (discipline === "Cycling" && stream && Array.isArray(stream.watts) && stream.watts.length >= 300) {
      const watts = stream.watts;
      const hr = stream.heartrate;
      const n = watts.length;
      const cumKjPerKg = new Float64Array(n);
      let runningJoules = 0;
      for (let i = 0; i < n; i++) {
        const w = Number.isFinite(watts[i]) && watts[i] > 0 ? watts[i] : 0;
        runningJoules += w;
        cumKjPerKg[i] = runningJoules / 1e3 / weightKg;
      }
      for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
        const minKjKg = thresholds[bIdx];
        let startIdx = -1;
        for (let i = 0; i < n; i++) {
          if (cumKjPerKg[i] >= minKjKg) {
            startIdx = i;
            break;
          }
        }
        if (startIdx === -1 || n - startIdx < 300) continue;
        const sliceWatts = watts.slice(startIdx);
        const peaks = computeSlidingWindowPeaks(sliceWatts, [300, 1200]);
        const pk5 = peaks.find((p) => p.durationSecs === 300);
        const pk20 = peaks.find((p) => p.durationSecs === 1200);
        if (pk5) {
          bucketBest5mPower[bIdx] = Math.max(bucketBest5mPower[bIdx], Math.round(pk5.bestValue));
          bucketSampleCounts[bIdx]++;
        }
        if (pk20) {
          bucketBest20mPower[bIdx] = Math.max(bucketBest20mPower[bIdx], Math.round(pk20.bestValue));
        }
        if (Array.isArray(hr) && hr.length === n) {
          const validHr = hr.slice(startIdx).filter((h) => h > 80);
          if (validHr.length > 60) {
            const avgSliceHr = validHr.reduce((s, v) => s + v, 0) / validHr.length;
            const drift = (avgSliceHr - (act.avgHr || 148)) / Math.max(110, act.avgHr || 148) * 100;
            bucketHrDrifts[bIdx].push(Math.max(0, drift));
          }
        }
      }
    } else if (discipline === "Running" && stream && Array.isArray(stream.velocitySmooth) && stream.velocitySmooth.length >= 300) {
      const vel = stream.velocitySmooth;
      const hr = stream.heartrate;
      const { gapVelocityMps } = computeGradeAdjustedPaceStream(
        vel,
        stream.altitude,
        stream.distance
      );
      const n = gapVelocityMps.length;
      const cumKcal = new Float64Array(n);
      let runningMeters = 0;
      for (let i = 0; i < n; i++) {
        const v = Number.isFinite(vel[i]) && vel[i] > 0 ? vel[i] : 0;
        runningMeters += v;
        cumKcal[i] = runningMeters / 1e3 * weightKg * 1.036;
      }
      for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
        const minKcal = thresholds[bIdx];
        let startIdx = -1;
        for (let i = 0; i < n; i++) {
          if (cumKcal[i] >= minKcal) {
            startIdx = i;
            break;
          }
        }
        if (startIdx === -1 || n - startIdx < 300) continue;
        const sliceGapVel = gapVelocityMps.slice(startIdx);
        const peaks = computeSlidingWindowPeaks(sliceGapVel, [300, 1200]);
        const pk5 = peaks.find((p) => p.durationSecs === 300);
        const pk20 = peaks.find((p) => p.durationSecs === 1200);
        if (pk5 && pk5.bestValue > 1.5) {
          const pace5 = Math.round(1e3 / pk5.bestValue);
          bucketBest5mGap[bIdx] = bucketBest5mGap[bIdx] === 0 ? pace5 : Math.min(bucketBest5mGap[bIdx], pace5);
          bucketSampleCounts[bIdx]++;
        }
        if (pk20 && pk20.bestValue > 1.5) {
          const pace20 = Math.round(1e3 / pk20.bestValue);
          bucketBest20mGap[bIdx] = bucketBest20mGap[bIdx] === 0 ? pace20 : Math.min(bucketBest20mGap[bIdx], pace20);
        }
        if (Array.isArray(hr) && hr.length === n) {
          const validHr = hr.slice(startIdx).filter((h) => h > 85);
          if (validHr.length > 60) {
            const avgSliceHr = validHr.reduce((s, v) => s + v, 0) / validHr.length;
            const drift = (avgSliceHr - (act.avgHr || 152)) / Math.max(110, act.avgHr || 152) * 100;
            bucketHrDrifts[bIdx].push(Math.max(0, drift));
          }
        }
      }
    } else {
      const durSecs = Math.max(0, act.movingTimeSecs || 0);
      if (durSecs < 1200) continue;
      const decouple = Math.max(0, act.aerobicDecouplingPct || 2.8);
      if (discipline === "Cycling" && (act.normalizedPower || act.avgPower)) {
        const w = act.normalizedPower || act.avgPower || baseFtp * 0.82;
        const totalKjKg = w * durSecs / 1e3 / weightKg;
        for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
          if (totalKjKg >= thresholds[bIdx]) {
            const fatigueFactor = Math.max(0.78, 1 - bIdx * (0.014 + decouple * 18e-4));
            const est20m = Math.round(Math.max(w, baseFtp * 0.98) * fatigueFactor);
            const est5m = Math.round(est20m * 1.14);
            bucketBest5mPower[bIdx] = Math.max(bucketBest5mPower[bIdx], est5m);
            bucketBest20mPower[bIdx] = Math.max(bucketBest20mPower[bIdx], est20m);
            bucketHrDrifts[bIdx].push(decouple * (0.4 + bIdx * 0.25));
            bucketSampleCounts[bIdx]++;
          }
        }
      } else if (discipline === "Running" && act.distanceMeters > 3e3) {
        const totalKcal = act.distanceMeters / 1e3 * weightKg * 1.036;
        const rawPace = act.gapPaceSecsPerKm || act.avgPaceSecsPerKm || Math.round(durSecs / (act.distanceMeters / 1e3));
        for (let bIdx = 0; bIdx < thresholds.length; bIdx++) {
          if (totalKcal >= thresholds[bIdx]) {
            const fatigueSlowdown = 1 + bIdx * (0.013 + decouple * 16e-4);
            const est20mPace = Math.round(Math.min(rawPace, basePaceSecsKm * 0.99) * fatigueSlowdown);
            const est5mPace = Math.round(est20mPace * 0.92);
            bucketBest5mGap[bIdx] = bucketBest5mGap[bIdx] === 0 ? est5mPace : Math.min(bucketBest5mGap[bIdx], est5mPace);
            bucketBest20mGap[bIdx] = bucketBest20mGap[bIdx] === 0 ? est20mPace : Math.min(bucketBest20mGap[bIdx], est20mPace);
            bucketHrDrifts[bIdx].push(decouple * (0.4 + bIdx * 0.25));
            bucketSampleCounts[bIdx]++;
          }
        }
      }
    }
  }
  const avgObservedDecouple = matchingActs.length > 0 ? matchingActs.reduce((s, a) => s + Math.max(0, a.aerobicDecouplingPct || 3.2), 0) / matchingActs.length : 3.4;
  const fresh20mWatts = Math.max(bucketBest20mPower[0], Math.round(baseFtp * 1.02));
  const fresh5mWatts = Math.max(bucketBest5mPower[0], Math.round(fresh20mWatts * 1.16));
  const fresh20mGap = bucketBest20mGap[0] > 0 ? bucketBest20mGap[0] : Math.round(basePaceSecsKm * 0.98);
  const fresh5mGap = bucketBest5mGap[0] > 0 ? bucketBest5mGap[0] : Math.round(fresh20mGap * 0.92);
  const perStepDecay = Math.min(0.045, Math.max(0.011, 0.012 + avgObservedDecouple * 22e-4));
  const buckets = thresholds.map((val, idx) => {
    const retention = idx === 0 ? 1 : Math.max(0.76, 1 - idx * perStepDecay - (idx >= 3 ? (idx - 2) * 8e-3 : 0));
    const retentionPct = Math.round(retention * 1e3) / 10;
    const best20mW = discipline === "Cycling" ? bucketBest20mPower[idx] > 0 && idx > 0 ? Math.min(fresh20mWatts, bucketBest20mPower[idx]) : Math.round(fresh20mWatts * retention) : null;
    const best5mW = discipline === "Cycling" ? bucketBest5mPower[idx] > 0 && idx > 0 ? Math.min(fresh5mWatts, bucketBest5mPower[idx]) : Math.round(fresh5mWatts * Math.min(1, retention + 0.01)) : null;
    const best20mPace = discipline === "Running" ? bucketBest20mGap[idx] > 0 && idx > 0 ? Math.max(fresh20mGap, bucketBest20mGap[idx]) : Math.round(fresh20mGap / retention) : null;
    const best5mPace = discipline === "Running" ? bucketBest5mGap[idx] > 0 && idx > 0 ? Math.max(fresh5mGap, bucketBest5mGap[idx]) : Math.round(fresh5mGap / Math.min(1, retention + 0.01)) : null;
    const effectiveRetentionPct = discipline === "Cycling" && best20mW != null ? Math.round(best20mW / Math.max(1, fresh20mWatts) * 1e3) / 10 : discipline === "Running" && best20mPace != null ? Math.round(fresh20mGap / Math.max(1, best20mPace) * 1e3) / 10 : retentionPct;
    const rawDrifts = bucketHrDrifts[idx];
    const heartRateDriftPct = rawDrifts.length > 0 ? Math.round(rawDrifts.reduce((s, v) => s + v, 0) / rawDrifts.length * 10) / 10 : Math.round(idx * (avgObservedDecouple * 0.38) * 10) / 10;
    return {
      bucketIndex: idx,
      fatigueThresholdValue: val,
      fatigueLabel: idx === 0 ? `0 ${unitLabel} (Fresh)` : `${val.toLocaleString()} ${unitLabel}`,
      best5mWatts: best5mW,
      best20mWatts: best20mW,
      best5mGapSecsPerKm: best5mPace,
      best20mGapSecsPerKm: best20mPace,
      retentionPct: Math.min(100, effectiveRetentionPct),
      heartRateDriftPct,
      sampleCount: bucketSampleCounts[idx]
    };
  });
  const retentionAtDeepFatiguePct = buckets[buckets.length - 2]?.retentionPct ?? 92;
  const totalDropPct = Math.max(0, 100 - buckets[buckets.length - 1].retentionPct);
  const decaySlopePerUnitPct = Math.round(totalDropPct / 4 * 100) / 100;
  const durabilityTier = retentionAtDeepFatiguePct >= 95 ? "PRO_TOUR_RESILIENT" : retentionAtDeepFatiguePct >= 90.5 ? "WELL_CONDITIONED" : retentionAtDeepFatiguePct >= 85 ? "MODERATE_FADE" : "GLYCOGEN_FRAGILE";
  const deepDrift = buckets[buckets.length - 1]?.heartRateDriftPct ?? 4;
  const primaryLimiter = retentionAtDeepFatiguePct >= 94 ? "HIGH_DURABILITY_RETENTION" : deepDrift >= 6 ? "THERMAL_CARDIAC_DRIFT" : totalDropPct >= 11 ? "GLYCOGEN_DEPLETION" : "NEUROMUSCULAR_DECAY";
  const limiterExplanation = primaryLimiter === "HIGH_DURABILITY_RETENTION" ? `Retaining ${retentionAtDeepFatiguePct.toFixed(1)}% of fresh threshold after ${thresholds[3].toLocaleString()} ${unitLabel} places your aerobic durability in the elite <2% decay-per-bucket tier.` : primaryLimiter === "THERMAL_CARDIAC_DRIFT" ? `Heart rate drift reaches +${deepDrift.toFixed(1)}% in late-work buckets (${thresholds[3].toLocaleString()}+ ${unitLabel}), indicating cardiovascular/thermoregulatory strain precedes peripheral muscle failure.` : primaryLimiter === "GLYCOGEN_DEPLETION" ? `Threshold output drops sharply beyond ${thresholds[2].toLocaleString()} ${unitLabel} (-${decaySlopePerUnitPct}% per bucket), a classic signature of exogenous carbohydrate under-fueling past 90 minutes.` : `Moderate mechanical fade (-${decaySlopePerUnitPct}% per ${thresholds[1]} ${unitLabel}) appears in the final two work buckets while cardiac drift stays controlled.`;
  const fuelingPrescription = discipline === "Cycling" ? retentionAtDeepFatiguePct < 91 ? "Target 85\u201395 g/hr dual-source (2:1 glucose:fructose) carbohydrates + 650 mg/hr sodium on rides exceeding 20 kJ/kg, and include 2x15m Z3/Z4 intervals in the final 45m of long Z2 rides." : "Maintain 70\u201385 g/hr carbohydrates + 550 mg/hr sodium on sessions >25 kJ/kg to preserve your high late-race threshold retention." : retentionAtDeepFatiguePct < 91 ? "Target 65\u201380 g/hr isotonic gels/drink mix + 600 mg/hr sodium on runs exceeding 1,000 kcal, and practice fast-finish progression miles after 1,200 kcal." : "Maintain 60\u201375 g/hr carbohydrates + 500 mg/hr sodium on long runs >1,200 kcal to lock in late-marathon GAP stability.";
  return {
    discipline,
    unitLabel,
    buckets,
    retentionAtDeepFatiguePct,
    decaySlopePerUnitPct,
    durabilityTier,
    primaryLimiter,
    limiterExplanation,
    fuelingPrescription
  };
}

// src/physiology/raceSimulator.ts
function simulateCoursePacingAndFueling(input) {
  const {
    sport,
    raceName,
    distanceKm,
    elevationGainMeters,
    ambientTempC,
    altitudeMeters,
    athleteProfile,
    durabilityReport
  } = input;
  const cleanDistKm = Math.max(1.5, distanceKm);
  const cleanElevM = Math.max(0, elevationGainMeters);
  const hideWeightOrMinor = Boolean(
    athleteProfile.safeSportHideWeight || resolveAthleteAgeTier({ birthMonthYear: athleteProfile.birthMonthYear }).isMinorU18
  );
  const weightKg = Math.max(42, athleteProfile.weightKg || 72);
  const ftp = Math.max(140, athleteProfile.ftp || athleteProfile.indoorFtp || 275);
  const thresholdPaceSecsKm = Math.max(
    155,
    athleteProfile.thresholdPaceSecsPerKm || 245
  );
  const optimalTempC = sport === "Running" ? 12 : 16;
  const excessTempC = Math.max(0, ambientTempC - optimalTempC);
  const thermalDeratingPct = Math.round(Math.min(14, Math.pow(excessTempC, 1.28) * 0.42) * 10) / 10;
  const excessAltM = Math.max(0, altitudeMeters - 900);
  const altitudeDeratingPct = Math.round(Math.min(18, excessAltM / 100 * 0.65) * 10) / 10;
  const decayPerBucketPct = durabilityReport?.decaySlopePerUnitPct ?? 2.1;
  const envRetentionFactor = (1 - thermalDeratingPct / 100) * (1 - altitudeDeratingPct / 100);
  const gradeMultipliers = [0.7, 1.15, 1.35, 1.1, 0.7];
  const segmentLabels = [
    "Seg 1 \xB7 Opening Settling & Rhythm",
    "Seg 2 \xB7 Early Terrain Build",
    "Seg 3 \xB7 Mid-Course Crux & Climb",
    "Seg 4 \xB7 Deep-Fatigue Threshold Hold",
    "Seg 5 \xB7 Final Kick & Redline Finish"
  ];
  const segDistKm = cleanDistKm / 5;
  const baseGradePct = cleanElevM / (cleanDistKm * 1e3) * 100;
  const estHours = sport === "Cycling" ? cleanDistKm / 33 + cleanElevM / 1100 : cleanDistKm * thresholdPaceSecsKm / 3600;
  const baseRaceIf = estHours <= 0.45 ? 1.03 : estHours <= 1.1 ? 0.96 : estHours <= 2.2 ? 0.88 : estHours <= 4 ? 0.81 : 0.74;
  const rawCarbsPerHr = estHours < 0.85 ? 35 : estHours < 1.75 ? 65 : estHours < 3 ? sport === "Cycling" ? 85 : 75 : sport === "Cycling" ? 95 : 85;
  const carbsGramsPerHour = Math.round(rawCarbsPerHr);
  const glucoseFructoseRatio = carbsGramsPerHour >= 80 ? "1:0.8 High-Oxidation" : carbsGramsPerHour >= 55 ? "2:1 Dual-Source" : "Single-Source";
  const sweatFactor = Math.max(0, ambientTempC - 10) * 18;
  const sodiumMgPerHour = Math.round(500 + sweatFactor);
  const fluidMlPerHour = Math.round(520 + Math.max(0, ambientTempC - 10) * 22);
  const segments = [];
  let totalTimeSecs = 0;
  let weightedWattsSum = 0;
  let weightedPaceSum = 0;
  let cumKjPerKg = 0;
  let cumKcal = 0;
  for (let i = 0; i < 5; i++) {
    const startKm = Math.round(i * segDistKm * 10) / 10;
    const endKm = Math.round((i + 1) * segDistKm * 10) / 10;
    const segGradePct = Math.round(baseGradePct * gradeMultipliers[i] * 10) / 10;
    const durabilityPenaltyPct = i === 0 ? 0 : i === 1 ? decayPerBucketPct * 0.35 : i === 2 ? decayPerBucketPct * 0.85 : i === 3 ? decayPerBucketPct * 1.45 : decayPerBucketPct * 1.15;
    const segDurabilityFactor = Math.max(0.82, 1 - durabilityPenaltyPct / 100);
    const tacticalFactor = i === 0 ? 0.97 : i === 1 ? 1 : i === 2 ? 1.02 : i === 3 ? 0.99 : 1.02;
    if (sport === "Cycling") {
      const targetWatts = Math.round(
        ftp * baseRaceIf * envRetentionFactor * segDurabilityFactor * tacticalFactor
      );
      const targetWkg = Math.round(targetWatts / weightKg * 100) / 100;
      const gradeRad = segGradePct / 100;
      const flatSpeedMps = Math.pow(targetWatts / 0.24, 1 / 3);
      const climbPenaltyMps = gradeRad * 95;
      const speedMps = Math.max(3.4, flatSpeedMps - climbPenaltyMps);
      const segSecs = Math.round(segDistKm * 1e3 / speedMps);
      const fatigueLabel = `${Math.round(cumKjPerKg)} kJ/kg`;
      cumKjPerKg += targetWatts * segSecs / 1e3 / weightKg;
      const segHours = segSecs / 3600;
      segments.push({
        segmentIndex: i + 1,
        segmentLabel: segmentLabels[i],
        startKm,
        endKm,
        avgGradePct: segGradePct,
        accumulatedFatigueLabel: fatigueLabel,
        targetWatts,
        targetWkg: hideWeightOrMinor ? null : targetWkg,
        targetPaceSecsPerKm: null,
        targetGapSecsPerKm: null,
        segmentDurationSecs: segSecs,
        carbsGramsTarget: Math.round(carbsGramsPerHour * segHours),
        sodiumMgTarget: Math.round(sodiumMgPerHour * segHours),
        fluidMlTarget: Math.round(fluidMlPerHour * segHours),
        coachingCue: i === 0 ? `Cap surges strictly at ${Math.round(targetWatts * 1.06)}W for the first 12 minutes to preserve W'.` : i === 1 ? `Settle into steady aerodynamic rhythm at ${targetWatts}W${hideWeightOrMinor ? "" : ` (${targetWkg} W/kg)`} and begin fueling (${Math.max(15, Math.round(carbsGramsPerHour * segHours))}g carbs).` : i === 2 ? `Crux climb (${segGradePct}% avg): hold ${targetWatts}W${hideWeightOrMinor ? "" : ` (${targetWkg} W/kg)`} seated at 85+ rpm.` : i === 3 ? `Entering deep work (${fatigueLabel}): take 1 gel + 200mL fluid before kilometer ${startKm}.` : `Empty remaining W' tank over the final ${(endKm - startKm).toFixed(1)} km.`
      });
      totalTimeSecs += segSecs;
      weightedWattsSum += targetWatts * segSecs;
    } else {
      const effectiveIf = baseRaceIf * envRetentionFactor * segDurabilityFactor * tacticalFactor;
      const targetGapSecsPerKm = Math.round(thresholdPaceSecsKm / Math.max(0.65, effectiveIf));
      const gradeSlowdownFactor = 1 + Math.max(0, segGradePct) * 0.033;
      const targetPaceSecsPerKm = Math.round(targetGapSecsPerKm * gradeSlowdownFactor);
      const segSecs = Math.round(segDistKm * targetPaceSecsPerKm);
      const fatigueLabel = `${Math.round(cumKcal)} kcal`;
      cumKcal += segDistKm * weightKg * 1.036;
      const segHours = segSecs / 3600;
      segments.push({
        segmentIndex: i + 1,
        segmentLabel: segmentLabels[i],
        startKm,
        endKm,
        avgGradePct: segGradePct,
        accumulatedFatigueLabel: fatigueLabel,
        targetWatts: null,
        targetWkg: null,
        targetPaceSecsPerKm,
        targetGapSecsPerKm,
        segmentDurationSecs: segSecs,
        carbsGramsTarget: Math.round(carbsGramsPerHour * segHours),
        sodiumMgTarget: Math.round(sodiumMgPerHour * segHours),
        fluidMlTarget: Math.round(fluidMlPerHour * segHours),
        coachingCue: i === 0 ? "Bank zero seconds early \u2014 lock onto target GAP rhythm and protect glycogen stores." : i === 1 ? `Settle into relaxed cruise rhythm (${segGradePct >= 0 ? `+${segGradePct}%` : `${segGradePct}%`} avg grade) and stay ahead of fueling (${Math.max(15, Math.round(carbsGramsPerHour * segHours))}g carbs).` : i === 2 ? `Grade rises to ${segGradePct}%: shorten stride, keep cadence >=176 spm, and run by GAP effort.` : i === 3 ? `Passing ${fatigueLabel}: ingest ${Math.max(20, Math.round(carbsGramsPerHour * segHours))}g carbs before neuromuscular fade sets in.` : "Final segment: lift cadence +3 spm and empty remaining D' reserve to the line."
      });
      totalTimeSecs += segSecs;
      weightedPaceSum += targetPaceSecsPerKm * segDistKm;
    }
  }
  const totalHours = Math.max(0.25, totalTimeSecs / 3600);
  const durabilityDeratingPct = Math.round(decayPerBucketPct * 1.25 * 10) / 10;
  const fuelingPlan = {
    carbsGramsPerHour,
    totalCarbsGrams: Math.round(carbsGramsPerHour * totalHours),
    glucoseFructoseRatio,
    sodiumMgPerHour,
    totalSodiumMg: Math.round(sodiumMgPerHour * totalHours),
    fluidMlPerHour,
    totalFluidMl: Math.round(fluidMlPerHour * totalHours),
    gelEquivalentsCount: Math.max(0, Math.round(carbsGramsPerHour * totalHours / 25)),
    caffeineMgRecommendation: hideWeightOrMinor ? 0 : Math.round(weightKg * (totalHours > 1.5 ? 3.5 : 2.5))
  };
  const averageTargetWatts = sport === "Cycling" && totalTimeSecs > 0 ? Math.round(weightedWattsSum / totalTimeSecs) : null;
  return {
    sport,
    raceName: raceName || (sport === "Cycling" ? "Target Cycling Event" : "Target Road/Trail Race"),
    distanceKm: cleanDistKm,
    elevationGainMeters: cleanElevM,
    ambientTempC,
    altitudeMeters,
    predictedFinishTimeSecs: totalTimeSecs,
    averageTargetWatts,
    normalizedTargetWatts: averageTargetWatts ? Math.round(averageTargetWatts * 1.04) : null,
    averageTargetPaceSecsPerKm: sport === "Running" ? Math.round(weightedPaceSum / cleanDistKm) : null,
    thermalDeratingPct,
    altitudeDeratingPct,
    durabilityDeratingPct,
    fuelingPlan,
    segments
  };
}

// src/physiology/raceRubberBander.ts
function formatOfficialClock(secs) {
  const whole = Math.floor(secs);
  const hundredths = Math.round((secs - whole) * 100);
  const h = Math.floor(whole / 3600);
  const m = Math.floor(whole % 3600 / 60);
  const s = whole % 60;
  const dec = hundredths > 0 ? `.${String(hundredths).padStart(2, "0")}` : "";
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${dec}`;
  }
  return `${m}:${String(s).padStart(2, "0")}${dec}`;
}
function computeDeterministicHash(payload) {
  let h1 = 3735928559 ^ payload.length;
  let h2 = 1103547991 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `THV-${hex1.slice(0, 4).toUpperCase()}-${hex2.slice(0, 4).toUpperCase()}`;
}
function generateVerifiedRacePassport(input) {
  const certDist = Math.max(200, input.certifiedDistanceMeters);
  const rawGpsDist = Math.max(200, input.rawGpsDistanceMeters || certDist);
  const officialSecs = Math.max(25, input.officialChipOrFatSecs);
  const gpsDriftPct = Math.round((rawGpsDist - certDist) / certDist * 1e4) / 100;
  const certifiedPaceSecsPerKm = Math.round(officialSecs / (certDist / 1e3) * 10) / 10;
  const vdotScore = estimateVdotFromRace(certDist, officialSecs);
  const equivalentMarathonSecs = Math.round(
    officialSecs * Math.pow(42195 / certDist, 1.06)
  );
  const splitUnitM = certDist <= 3200 ? 400 : certDist <= 1e4 ? 1e3 : 5e3;
  const numSplits = Math.max(1, Math.min(10, Math.round(certDist / splitUnitM)));
  const perSplitCertM = Math.round(certDist / numSplits);
  const perSplitRawM = Math.round(rawGpsDist / numSplits * 10) / 10;
  const providedSplits = input.officialSplitsSecs && input.officialSplitsSecs.length === numSplits ? input.officialSplitsSecs : null;
  const driftRatio = certDist / rawGpsDist;
  const splits = [];
  for (let i = 0; i < numSplits; i++) {
    const rubberBandedSplitSecs = providedSplits ? Math.round(providedSplits[i] * 100) / 100 : Math.round(officialSecs / numSplits * 100) / 100;
    const rawGpsSplitSecs = Math.round(rubberBandedSplitSecs * driftRatio * 100) / 100;
    const deltaSecs = Math.round((rubberBandedSplitSecs - rawGpsSplitSecs) * 100) / 100;
    const splitPaceSecsKm = Math.round(rubberBandedSplitSecs / (perSplitCertM / 1e3) * 10) / 10;
    splits.push({
      splitIndex: i + 1,
      splitLabel: certDist <= 3200 ? `Lap ${i + 1} (${(i + 1) * perSplitCertM}m)` : `Split ${i + 1} (${((i + 1) * (perSplitCertM / 1e3)).toFixed(1)} km)`,
      certifiedDistanceMeters: perSplitCertM,
      rawGpsDistanceMeters: perSplitRawM,
      rawGpsSplitSecs,
      rubberBandedSplitSecs,
      certifiedPaceSecsPerKm: splitPaceSecsKm,
      deltaSecs
    });
  }
  const verificationHash = computeDeterministicHash(
    `${input.athleteName}|${input.meetOrRaceName}|${certDist}|${officialSecs.toFixed(2)}|${input.raceDate}`
  );
  return {
    passportId: `passport-${Date.now()}`,
    verificationHash,
    athleteName: input.athleteName || "THRESH Athlete",
    meetOrRaceName: input.meetOrRaceName || "Certified Championship Event",
    eventLabel: input.eventLabel || `${certDist}m`,
    platform: input.platform,
    raceDate: input.raceDate || getLocalDateIso(),
    certifiedDistanceMeters: certDist,
    rawGpsDistanceMeters: rawGpsDist,
    gpsDriftPct,
    officialChipOrFatSecs: officialSecs,
    displayOfficialTime: formatOfficialClock(officialSecs),
    certifiedPaceSecsPerKm,
    vdotScore,
    equivalentMarathonSecs,
    splits
  };
}

// src/utils/workoutParser.ts
var INTERVALS_EFFORT_ZONES = [
  {
    zone: 1,
    code: "Z1",
    name: "Recovery",
    color: "#94A3B8",
    inkClass: "text-slate-700 dark:text-slate-200",
    heightPct: 28
  },
  {
    zone: 2,
    code: "Z2",
    name: "Endurance",
    color: "#0D9488",
    inkClass: "ap-ink-teal",
    heightPct: 44
  },
  {
    zone: 3,
    code: "Z3",
    name: "Tempo / Sweet Spot",
    color: "#D97706",
    inkClass: "ap-ink-amber",
    heightPct: 62
  },
  {
    zone: 4,
    code: "Z4",
    name: "Threshold",
    color: "#EA580C",
    inkClass: "ap-ink-vermilion",
    heightPct: 78
  },
  {
    zone: 5,
    code: "Z5",
    name: "VO2max",
    color: "#DC2626",
    inkClass: "ap-ink-rose",
    heightPct: 92
  },
  {
    zone: 6,
    code: "Z6+",
    name: "Anaerobic / Sprint",
    color: "#7C3AED",
    inkClass: "ap-ink-violet",
    heightPct: 100
  }
];
function getIntervalsZoneFromIntensityPct(intensityPct) {
  if (intensityPct < 56) return INTERVALS_EFFORT_ZONES[0];
  if (intensityPct <= 75) return INTERVALS_EFFORT_ZONES[1];
  if (intensityPct <= 90) return INTERVALS_EFFORT_ZONES[2];
  if (intensityPct <= 105) return INTERVALS_EFFORT_ZONES[3];
  if (intensityPct <= 120) return INTERVALS_EFFORT_ZONES[4];
  return INTERVALS_EFFORT_ZONES[5];
}
function parseClockOrSecondsToken(token) {
  const trimmed = token.trim();
  const minSecMatch = trimmed.match(/^(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (minSecMatch) {
    return Number(minSecMatch[1]) * 60 + Number(minSecMatch[2]);
  }
  const secMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  if (secMatch) {
    return Number(secMatch[1]);
  }
  return null;
}
function extractDistanceMeters(cleanLine) {
  const distPart = cleanLine.replace(/(?:\b(?:at|@)\b).*$/i, "").trim();
  const source = distPart.length > 0 ? distPart : cleanLine;
  const kmMatch = source.match(/\b(\d+(?:\.\d+)?)\s*km\b/i);
  if (kmMatch) return Math.round(Number(kmMatch[1]) * 1e3);
  const miMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (miMatch) return Math.round(Number(miMatch[1]) * 1609.34);
  const metersWordMatch = source.match(/\b(\d+(?:\.\d+)?)\s*(?:meters|meter)\b/i);
  if (metersWordMatch) return Math.round(Number(metersWordMatch[1]));
  const mTokens = Array.from(source.matchAll(/\b(\d+)\s*m(?!in|ins|s)\b/gi));
  for (const tok of mTokens) {
    const val = Number(tok[1]);
    if (val >= 100) return val;
    if (val >= 30 && val <= 99 && /\b(sprint|stride|fly|accel|hill|walk|jog|float|rec|recovery)\b/i.test(cleanLine)) {
      return val;
    }
  }
  return void 0;
}
function resolveNamedTrackPaceSecsPerKm(cleanLine, thresholdPaceSecsPerKm) {
  const sr = buildTrackSpeedReserveProfile({ thresholdPaceSecsPerKm });
  if (/\bwarm\s*-?\s*up\b|\bcool\s*-?\s*down\b/i.test(cleanLine)) {
    return { paceSecsPerKm: sr.zones.E.paceSecsPerKm, forceIntensityPct: 55 };
  }
  if (/\b(?:walk|standing|recovery)\b/i.test(cleanLine) && !/\bjog\b/i.test(cleanLine)) {
    return { forceIntensityPct: 48 };
  }
  if (/\b400\s*m?\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = solve400mRacePaceSecsPerKm(sr);
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b800\s*m?\s*(?:race\s*)?(?:pace|effort)\b|\bFR\b|fast\s*rep/i.test(cleanLine)) {
    const pace = sr.zones.FR.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:1600\s*m?|1500\s*m?|1\s*mile|mile)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = sr.zones.R.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:3200\s*m?|3000\s*m?|3k|2\s*mile|2\s*mi)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = Number(((sr.zones.I.paceSecsPerKm + sr.zones.R.paceSecsPerKm) / 2).toFixed(1));
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:5000\s*m?|5k)\s*(?:race\s*)?(?:pace|effort)\b/i.test(cleanLine)) {
    const pace = sr.zones.I.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:10k|cv|critical\s*velocity)\b/i.test(cleanLine)) {
    const pace = sr.zones.CV.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:threshold|lt2)\b/i.test(cleanLine)) {
    const pace = sr.zones.T.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  if (/\b(?:sub-?t|sub-?threshold)\b/i.test(cleanLine)) {
    const pace = sr.zones.SUB_T.paceSecsPerKm;
    return { paceSecsPerKm: pace, forceIntensityPct: Math.round(thresholdPaceSecsPerKm / pace * 100) };
  }
  return {};
}
function extractExplicitIntensityPct(cleanLine) {
  const rangeMatch = cleanLine.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*%/);
  if (rangeMatch) {
    return Math.round((Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2);
  }
  const pctMatch = cleanLine.match(/(\d{2,3})\s*%/);
  if (pctMatch) {
    return Number(pctMatch[1]);
  }
  return void 0;
}
function extractTargetPaceSecsPerKm(cleanLine, distanceMeters) {
  const unitPaceMatch = cleanLine.match(
    /(?:@|at)\s*(\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?s?)\s*\/\s*(km|mi|400m|200m|800m)\b/i
  );
  if (unitPaceMatch) {
    const secs = parseClockOrSecondsToken(unitPaceMatch[1]);
    if (secs && secs > 5) {
      const unit = unitPaceMatch[2].toLowerCase();
      if (unit === "km") return { paceSecsPerKm: Number(secs.toFixed(1)) };
      if (unit === "mi") return { paceSecsPerKm: Number((secs / 1.60934).toFixed(1)) };
      if (unit === "400m") return { paceSecsPerKm: Number((secs * 2.5).toFixed(1)) };
      if (unit === "200m") return { paceSecsPerKm: Number((secs * 5).toFixed(1)) };
      if (unit === "800m") return { paceSecsPerKm: Number((secs * 1.25).toFixed(1)) };
    }
  }
  const repTargetMatch = cleanLine.match(
    /(?:@|at)\s*(\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?\s*s)\b/i
  );
  if (repTargetMatch && distanceMeters && distanceMeters > 0) {
    const splitSecs = parseClockOrSecondsToken(repTargetMatch[1]);
    if (splitSecs && splitSecs > 4) {
      const paceSecsPerKm = Number((splitSecs / distanceMeters * 1e3).toFixed(1));
      return { paceSecsPerKm, repSplitSecs: splitSecs };
    }
  }
  return {};
}
function inferStepKind(cleanLine, explicitKind) {
  if (explicitKind) return explicitKind;
  if (/\bwarm\s*-?\s*up\b/i.test(cleanLine)) return "warmup";
  if (/\bcool\s*-?\s*down\b/i.test(cleanLine)) return "cooldown";
  if (/\b(?:jog|walk|rest|recovery|float|standing)\b/i.test(cleanLine)) return "rest";
  return "work";
}
function parseSingleWorkoutLine(cleanLine, thresholdPaceSecsPerKm = 250, explicitKind) {
  const distanceMeters = extractDistanceMeters(cleanLine);
  const explicitPct = extractExplicitIntensityPct(cleanLine);
  const { paceSecsPerKm: parsedTargetPace, repSplitSecs } = extractTargetPaceSecsPerKm(
    cleanLine,
    distanceMeters
  );
  const stepKind = inferStepKind(cleanLine, explicitKind);
  const namedPace = explicitPct === void 0 && !parsedTargetPace ? resolveNamedTrackPaceSecsPerKm(cleanLine, thresholdPaceSecsPerKm) : {};
  let intensityPct = explicitPct ?? namedPace.forceIntensityPct ?? 65;
  if (explicitPct === void 0 && namedPace.forceIntensityPct === void 0) {
    if (parsedTargetPace && parsedTargetPace > 60) {
      intensityPct = Math.round(thresholdPaceSecsPerKm / parsedTargetPace * 100);
    } else if (/\bFR\b|fast\s*rep|800m\s*(?:race|pace|effort)/i.test(cleanLine)) {
      intensityPct = 122;
    } else if (/\bR\b|repetition|fast/i.test(cleanLine)) {
      intensityPct = 114;
    } else if (/\bsub-?t\b|sub-?threshold/i.test(cleanLine)) {
      intensityPct = 94;
    } else if (/\bcv\b|critical/i.test(cleanLine)) {
      intensityPct = 102;
    } else if (/z1|recovery|easy|warm\s*-?\s*up|cool\s*-?\s*down|jog|float|walk/i.test(cleanLine)) {
      intensityPct = 55;
    } else if (/z2|endurance|aerobic/i.test(cleanLine)) {
      intensityPct = 68;
    } else if (/z3|tempo|sweet\s*spot/i.test(cleanLine)) {
      intensityPct = 86;
    } else if (/z4|threshold|ftp|\bT\b/i.test(cleanLine)) {
      intensityPct = 98;
    } else if (/z5|vo2|\bI\b/i.test(cleanLine)) {
      intensityPct = 110;
    } else if (/z6|sprint|anaerobic/i.test(cleanLine)) {
      intensityPct = 130;
    }
  }
  const effectiveTargetPace = parsedTargetPace ?? namedPace.paceSecsPerKm ?? (distanceMeters ? Number((thresholdPaceSecsPerKm * 100 / Math.max(40, intensityPct)).toFixed(1)) : void 0);
  let durationSecs = 600;
  const hrMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs)\b/i);
  const secMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs)\b/i);
  const minMatch = cleanLine.match(/\b(\d+(?:\.\d+)?)\s*(?:min|mins)\b/i);
  const bareMinMatch = !distanceMeters ? cleanLine.match(/\b(\d+(?:\.\d+)?)\s*m\b/i) : null;
  if (hrMatch) {
    durationSecs = Math.round(Number(hrMatch[1]) * 3600);
  } else if (distanceMeters) {
    if (repSplitSecs && repSplitSecs > 4) {
      durationSecs = Number(repSplitSecs.toFixed(1));
    } else if (effectiveTargetPace) {
      durationSecs = Number((distanceMeters / 1e3 * effectiveTargetPace).toFixed(1));
    }
  } else if (minMatch) {
    durationSecs = Math.round(Number(minMatch[1]) * 60);
  } else if (secMatch && !/@\s*\d+(?:\.\d+)?s\b/.test(cleanLine)) {
    durationSecs = Number(secMatch[1]);
  } else if (bareMinMatch) {
    durationSecs = Math.round(Number(bareMinMatch[1]) * 60);
  }
  const durationMins = durationSecs >= 60 && durationSecs % 60 === 0 ? durationSecs / 60 : Math.max(0.25, Number((durationSecs / 60).toFixed(2)));
  const zoneMeta = getIntervalsZoneFromIntensityPct(intensityPct);
  return {
    label: cleanLine,
    durationMins,
    durationSecs,
    distanceMeters,
    intensityPct,
    targetPaceSecsPerKm: effectiveTargetPace,
    zone: zoneMeta.zone,
    zoneCode: zoneMeta.code,
    zoneColor: zoneMeta.color,
    stepKind
  };
}
function splitTopLevelClauses(line) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    if (depth === 0 && (ch === "+" || ch === ",")) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}
function normalizeInputLines(syntax) {
  const out = [];
  for (const raw of syntax.split("\n")) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    if (line.startsWith("-")) {
      out.push(line);
      continue;
    }
    if (line.includes("+") || line.includes(",")) {
      const clauses = splitTopLevelClauses(line);
      if (clauses.length > 1 && clauses.some(
        (c) => /^(?:\d{1,2}\s*[x×]|\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|m|min|mins|s|sec|secs)|warm\s*-?\s*up|cool\s*-?\s*down)/i.test(
          c
        )
      )) {
        for (const c of clauses) {
          out.push(c.startsWith("-") ? c : `- ${c}`);
        }
        continue;
      }
    }
    out.push(line);
  }
  return out;
}
function parseStructuredTrackWorkout(syntax, thresholdPaceSecsPerKm = 250) {
  if (!syntax || !syntax.trim()) return [];
  const rawLines = normalizeInputLines(syntax);
  const nodes = [];
  let currentRepeat = null;
  const flushRepeat = () => {
    if (currentRepeat && currentRepeat.steps.length > 0) {
      nodes.push({
        type: "repeat",
        repeatCount: currentRepeat.repeatCount,
        label: currentRepeat.label,
        steps: currentRepeat.steps
      });
    }
    currentRepeat = null;
  };
  for (const line of rawLines) {
    if (!line) {
      flushRepeat();
      continue;
    }
    const looksLikeStandaloneStep = !line.startsWith("-") && (/^(\d{1,2})\s*[x×]\s*\d+/i.test(line) || /^\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|m|min|mins|s|sec|secs)\b/i.test(line));
    if (!line.startsWith("-") && !looksLikeStandaloneStep) {
      const headerRepeatMatch = line.match(
        /^(?:main\s+set\s+|set\s*\d*\s*:?\s*|repeat\s+)?(\d{1,2})\s*[x×]\b[:\s-]*(.*)$/i
      );
      if (headerRepeatMatch) {
        flushRepeat();
        const count = Math.max(2, Number(headerRepeatMatch[1]));
        const suffix = headerRepeatMatch[2]?.trim();
        currentRepeat = {
          repeatCount: count,
          label: suffix ? `${count}x ${suffix}` : `Repeat ${count}x`,
          steps: []
        };
      } else {
        flushRepeat();
      }
      continue;
    }
    const clean = line.replace(/^-+\s*/, "").trim();
    if (!clean) continue;
    const inlineRepeatMatch = clean.match(/^(\d{1,2})\s*[x×](?:\s+|(?=\d))(.+)$/i);
    if (inlineRepeatMatch) {
      flushRepeat();
      const count = Math.max(1, Number(inlineRepeatMatch[1]));
      const remainder = inlineRepeatMatch[2].trim();
      let mainPart = remainder;
      let restPart = null;
      const parenRestMatch = remainder.match(
        /\(([^)]*(?:rest|jog|rec|float|walk|standing)[^)]*)\)\s*$/i
      );
      const withRestMatch = remainder.match(/\bw\/\s*(.+)$/i);
      if (parenRestMatch) {
        restPart = parenRestMatch[1].trim();
        mainPart = remainder.slice(0, parenRestMatch.index).trim();
      } else if (withRestMatch) {
        restPart = withRestMatch[1].trim();
        mainPart = remainder.slice(0, withRestMatch.index).trim();
      }
      const workStep = parseSingleWorkoutLine(mainPart, thresholdPaceSecsPerKm, "work");
      const groupSteps = [workStep];
      if (restPart) {
        groupSteps.push(parseSingleWorkoutLine(restPart, thresholdPaceSecsPerKm, "rest"));
      }
      nodes.push({
        type: "repeat",
        repeatCount: count,
        label: `${count}x ${mainPart.slice(0, 14)}`.trim(),
        steps: groupSteps
      });
      continue;
    }
    const step = parseSingleWorkoutLine(clean, thresholdPaceSecsPerKm);
    if (currentRepeat) {
      if (step.stepKind === "cooldown" || step.stepKind === "warmup") {
        flushRepeat();
        nodes.push({ type: "step", step });
      } else {
        currentRepeat.steps.push(step);
      }
    } else {
      nodes.push({ type: "step", step });
    }
  }
  flushRepeat();
  return nodes;
}

// src/utils/fitWorkoutEncoder.ts
var FIT_CRC_TABLE = [
  0,
  52225,
  55297,
  5120,
  61441,
  15360,
  10240,
  58369,
  40961,
  27648,
  30720,
  46081,
  20480,
  39937,
  34817,
  17408
];
function computeFitCrc(bytes, length) {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 15];
    crc = crc >> 4 & 4095;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 15];
    tmp = FIT_CRC_TABLE[crc & 15];
    crc = crc >> 4 & 4095;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte >> 4 & 15];
  }
  return crc & 65535;
}
function writeFixedAscii(buf, text, fixedLen) {
  const clean = text.replace(/[^\x20-\x7E]/g, "").slice(0, fixedLen - 1);
  for (let i = 0; i < fixedLen; i++) {
    buf.push(i < clean.length ? clean.charCodeAt(i) : 0);
  }
}
function writeUint16LE(buf, val) {
  const v = Math.max(0, Math.min(65535, Math.round(val)));
  buf.push(v & 255, v >> 8 & 255);
}
function writeUint32LE(buf, val) {
  const v = Math.max(0, Math.round(val)) >>> 0;
  buf.push(v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255);
}
function encodeGarminFitWorkout(workout) {
  const dataPayload = [];
  const fitTimestamp = Math.max(0, Math.floor(Date.now() / 1e3) - 631065600);
  dataPayload.push(
    64,
    // Definition header, local mesg 0
    0,
    0,
    // Little Endian
    0,
    0,
    // Global Mesg Num = 0 (file_id)
    4,
    // 4 fields
    0,
    1,
    0,
    // Field 0: type (enum)
    1,
    2,
    132,
    // Field 1: manufacturer (uint16)
    2,
    2,
    132,
    // Field 2: product (uint16)
    4,
    4,
    134
    // Field 4: time_created (uint32)
  );
  dataPayload.push(0);
  dataPayload.push(5);
  writeUint16LE(dataPayload, 1);
  writeUint16LE(dataPayload, 2026);
  writeUint32LE(dataPayload, fitTimestamp);
  dataPayload.push(
    65,
    // Definition header, local mesg 1
    0,
    0,
    26,
    0,
    // Global Mesg Num = 26 (workout)
    3,
    // 3 fields
    4,
    1,
    0,
    // Field 4: sport (enum)
    6,
    2,
    132,
    // Field 6: num_valid_steps (uint16)
    8,
    24,
    7
    // Field 8: wkt_name (string, 24 bytes)
  );
  dataPayload.push(1);
  dataPayload.push(workout.sport === "Running" ? 1 : 2);
  writeUint16LE(dataPayload, workout.steps.length);
  writeFixedAscii(dataPayload, workout.name || "THRESH Workout", 24);
  dataPayload.push(
    66,
    // Definition header, local mesg 2
    0,
    0,
    27,
    0,
    // Global Mesg Num = 27 (workout_step)
    9,
    // 9 fields
    254,
    2,
    132,
    // Field 254: message_index (uint16)
    0,
    16,
    7,
    // Field 0: wkt_step_name (string, 16 bytes)
    1,
    1,
    0,
    // Field 1: duration_type (enum)
    2,
    4,
    134,
    // Field 2: duration_value (uint32)
    3,
    1,
    0,
    // Field 3: target_type (enum)
    4,
    4,
    134,
    // Field 4: target_value (uint32)
    5,
    4,
    134,
    // Field 5: custom_target_value_low (uint32)
    6,
    4,
    134,
    // Field 6: custom_target_value_high (uint32)
    7,
    1,
    0
    // Field 7: intensity (enum)
  );
  const intensityMap = {
    active: 0,
    rest: 1,
    warmup: 2,
    cooldown: 3
  };
  workout.steps.forEach((step, idx) => {
    dataPayload.push(2);
    writeUint16LE(dataPayload, idx);
    writeFixedAscii(dataPayload, step.label || `Step ${idx + 1}`, 16);
    const durType = step.durationType ?? (typeof step.distanceMeters === "number" && step.distanceMeters > 0 ? "distance" : "time");
    if (durType === "repeat_until_steps_cmplt") {
      dataPayload.push(6);
      writeUint32LE(dataPayload, Math.max(0, Math.round(step.repeatFromStepIndex ?? 0)));
      dataPayload.push(2);
      writeUint32LE(dataPayload, Math.max(2, Math.round(step.repeatCount ?? 2)));
      writeUint32LE(dataPayload, 0);
      writeUint32LE(dataPayload, 0);
      dataPayload.push(0);
      return;
    }
    if (durType === "distance") {
      dataPayload.push(1);
      writeUint32LE(dataPayload, Math.max(100, Math.round((step.distanceMeters ?? 400) * 100)));
    } else if (durType === "open") {
      dataPayload.push(5);
      writeUint32LE(dataPayload, 4294967295);
    } else {
      dataPayload.push(0);
      writeUint32LE(dataPayload, Math.max(1e3, Math.round((step.durationSecs ?? 60) * 1e3)));
    }
    const useSpeedTarget = step.targetType === "speed" || step.targetType === void 0 && typeof step.targetMaxSpeedMps === "number" && step.targetMaxSpeedMps > 0;
    const usePowerTarget = step.targetType === "power" || step.targetType === void 0 && typeof step.targetMaxWatts === "number" && step.targetMaxWatts > 0;
    const useHrTarget = step.targetType === "heart_rate" || step.targetType === void 0 && typeof step.targetMaxHrBpm === "number" && step.targetMaxHrBpm > 0;
    if (useSpeedTarget && step.targetMaxSpeedMps && step.targetMaxSpeedMps > 0) {
      dataPayload.push(0);
      writeUint32LE(dataPayload, 0);
      const lowMmS = Math.max(500, Math.round((step.targetMinSpeedMps ?? step.targetMaxSpeedMps * 0.96) * 1e3));
      const highMmS = Math.max(lowMmS + 50, Math.round(step.targetMaxSpeedMps * 1e3));
      writeUint32LE(dataPayload, lowMmS);
      writeUint32LE(dataPayload, highMmS);
    } else if (usePowerTarget && step.targetMaxWatts && step.targetMaxWatts > 0) {
      dataPayload.push(4);
      writeUint32LE(dataPayload, 0);
      const lowW = Math.max(20, Math.round(step.targetMinWatts ?? step.targetMaxWatts * 0.95));
      const highW = Math.max(lowW + 5, Math.round(step.targetMaxWatts));
      writeUint32LE(dataPayload, lowW + 1e3);
      writeUint32LE(dataPayload, highW + 1e3);
    } else if (useHrTarget && step.targetMaxHrBpm && step.targetMaxHrBpm > 0) {
      dataPayload.push(1);
      writeUint32LE(dataPayload, 0);
      const lowHr = Math.max(60, Math.round(step.targetMinHrBpm ?? step.targetMaxHrBpm - 10));
      const highHr = Math.max(lowHr + 2, Math.round(step.targetMaxHrBpm));
      writeUint32LE(dataPayload, lowHr + 100);
      writeUint32LE(dataPayload, highHr + 100);
    } else {
      dataPayload.push(2);
      writeUint32LE(dataPayload, 0);
      writeUint32LE(dataPayload, 0);
      writeUint32LE(dataPayload, 0);
    }
    dataPayload.push(intensityMap[step.intensity || "active"] ?? 0);
  });
  const dataSize = dataPayload.length;
  const header = [
    14,
    // Header size
    16,
    // Protocol version 1.0
    8,
    8
    // Profile version 20.56 (LE)
  ];
  writeUint32LE(header, dataSize);
  header.push(46, 70, 73, 84);
  const headerCrc = computeFitCrc(new Uint8Array(header), 12);
  writeUint16LE(header, headerCrc);
  const fullWithoutCrc = new Uint8Array(14 + dataSize);
  fullWithoutCrc.set(new Uint8Array(header), 0);
  fullWithoutCrc.set(new Uint8Array(dataPayload), 14);
  const fileCrc = computeFitCrc(fullWithoutCrc, fullWithoutCrc.length);
  const finalFit = new Uint8Array(14 + dataSize + 2);
  finalFit.set(fullWithoutCrc, 0);
  finalFit[14 + dataSize] = fileCrc & 255;
  finalFit[14 + dataSize + 1] = fileCrc >> 8 & 255;
  return finalFit;
}
function parsedStepToFitStep(step, opts) {
  const intensity = step.stepKind === "warmup" ? "warmup" : step.stepKind === "cooldown" ? "cooldown" : step.stepKind === "rest" ? "rest" : "active";
  const hasDistance = typeof step.distanceMeters === "number" && step.distanceMeters > 0;
  const durationType = hasDistance ? "distance" : "time";
  const durationSecs = Math.max(1, Math.round(step.durationSecs || step.durationMins * 60));
  if (opts.sport === "Running") {
    if (intensity === "rest") {
      return {
        label: step.label.slice(0, 15),
        durationSecs,
        distanceMeters: step.distanceMeters,
        durationType,
        targetType: "open",
        intensity
      };
    }
    const effectivePaceSecsKm = step.targetPaceSecsPerKm ?? Math.max(95, opts.thresholdPaceSecsPerKm * 100 / Math.max(40, step.intensityPct || 75));
    const centerSpeedMps = 1e3 / effectivePaceSecsKm;
    return {
      label: step.label.slice(0, 15),
      durationSecs,
      distanceMeters: step.distanceMeters,
      durationType,
      targetType: "speed",
      targetMinSpeedMps: Number((centerSpeedMps * 0.975).toFixed(3)),
      targetMaxSpeedMps: Number((centerSpeedMps * 1.025).toFixed(3)),
      intensity
    };
  }
  const targetW = Math.round(opts.ftpWatts * Math.max(40, step.intensityPct || 70) / 100);
  return {
    label: step.label.slice(0, 15),
    durationSecs,
    durationType: "time",
    targetType: intensity === "rest" ? "open" : "power",
    targetMinWatts: intensity === "rest" ? void 0 : Math.round(targetW * 0.95),
    targetMaxWatts: intensity === "rest" ? void 0 : Math.round(targetW * 1.05),
    intensity
  };
}
function buildFitStepsFromWorkoutSyntax(workoutSyntax, opts) {
  const safeOpts = {
    sport: opts.sport,
    ftpWatts: Math.max(100, opts.ftpWatts || 280),
    lthrBpm: Math.max(110, opts.lthrBpm || 170),
    thresholdPaceSecsPerKm: Math.max(95, opts.thresholdPaceSecsPerKm || 250)
  };
  const ast = parseStructuredTrackWorkout(workoutSyntax, safeOpts.thresholdPaceSecsPerKm);
  const fitSteps = [];
  for (const node of ast) {
    if (node.type === "step") {
      fitSteps.push(parsedStepToFitStep(node.step, safeOpts));
    } else if (node.steps.length > 0) {
      const firstChildIndex = fitSteps.length;
      for (const child of node.steps) {
        fitSteps.push(parsedStepToFitStep(child, safeOpts));
      }
      if (node.repeatCount >= 2) {
        fitSteps.push({
          label: node.label.slice(0, 15),
          durationType: "repeat_until_steps_cmplt",
          repeatFromStepIndex: firstChildIndex,
          repeatCount: node.repeatCount,
          targetType: "open",
          intensity: "active"
        });
      }
    }
  }
  return fitSteps;
}

// server/routers/webhooksAndExportRouter.ts
var webhooksAndExportRouter = Router();
var SUPPORTED_WEBHOOK_PROVIDERS = /* @__PURE__ */ new Set([
  "garmin",
  "wahoo",
  "coros",
  "polar",
  "whoop",
  "oura",
  "apple-healthkit"
]);
webhooksAndExportRouter.get("/api/webhooks/:provider", (req, res, next) => {
  const provider = String(req.params.provider || "").trim().toLowerCase();
  if (provider === "strava" || provider === "intervals") {
    next();
    return;
  }
  if (!SUPPORTED_WEBHOOK_PROVIDERS.has(provider)) {
    res.status(400).json({ ok: false, error: `Unsupported provider "${provider}"` });
    return;
  }
  const challenge = req.query["hub.challenge"] || req.query.challenge || req.query["webhook_challenge"];
  if (challenge) {
    res.status(200).type("text/plain").send(String(challenge));
    return;
  }
  res.status(200).json({ ok: true, provider: provider.toUpperCase(), verified: true });
});
webhooksAndExportRouter.post("/api/webhooks/:provider", (req, res, next) => {
  const provider = String(req.params.provider || "").trim().toLowerCase();
  if (provider === "strava" || provider === "intervals") {
    next();
    return;
  }
  if (!SUPPORTED_WEBHOOK_PROVIDERS.has(provider)) {
    res.status(400).json({
      ok: false,
      error: `Unsupported hardware webhook provider "${provider}". Supported: ${Array.from(
        SUPPORTED_WEBHOOK_PROVIDERS
      ).join(", ")}`
    });
    return;
  }
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const records = Array.isArray(payload.activities || payload.workouts || payload.records) ? payload.activities || payload.workouts || payload.records : payload.workout ? [payload.workout] : [payload];
  let wahooWorkoutId;
  let wahooFileUrl;
  if (provider === "wahoo" && payload.workout) {
    wahooWorkoutId = payload.workout.id;
    wahooFileUrl = payload.workout.file?.url;
  }
  let polarEvent;
  let polarEntityId;
  if (provider === "polar") {
    polarEvent = payload.event;
    polarEntityId = payload.entity_id;
  }
  res.status(200).json({
    ok: true,
    provider: provider.toUpperCase(),
    ingestionSource: `${provider.toUpperCase()}_WEBHOOK_FIRST_PARTY`,
    cleanRoomEligibleForAiAndCoaching: true,
    receivedCount: records.length,
    workoutId: wahooWorkoutId,
    fileUrl: wahooFileUrl,
    polarEvent,
    polarEntityId,
    entityId: polarEntityId,
    receivedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
});
webhooksAndExportRouter.post("/api/workouts/export", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const title = String(body.name || "THRESH Prescribed Session").trim();
  const sport = body.sportCategory === "Running" ? "Running" : "Cycling";
  const ftp = Math.max(100, Number(body.ftp) || 280);
  const thresholdPaceSecsPerKm = Math.max(95, Number(body.thresholdPaceSecsPerKm) || 245);
  const workoutSyntax = typeof body.workoutSyntax === "string" ? body.workoutSyntax.trim() : "";
  let astNodes = null;
  let normalizedSteps = [];
  let fitSteps = [];
  if (workoutSyntax) {
    astNodes = parseStructuredTrackWorkout(workoutSyntax, thresholdPaceSecsPerKm);
    fitSteps = buildFitStepsFromWorkoutSyntax(workoutSyntax, {
      sport,
      ftpWatts: ftp,
      thresholdPaceSecsPerKm
    });
    let stepOrder = 0;
    for (const node of astNodes) {
      const expand = node.type === "step" ? [node.step] : node.steps;
      const reps = node.type === "repeat" ? node.repeatCount : 1;
      for (let r = 0; r < reps; r++) {
        for (const s of expand) {
          stepOrder += 1;
          const pct = Math.max(40, Math.min(180, s.intensityPct || 75));
          const paceSecsKm = s.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
          normalizedSteps.push({
            stepOrder,
            label: s.label,
            durationSecs: Math.max(5, Math.round(s.durationSecs || s.durationMins * 60)),
            distanceMeters: s.distanceMeters,
            targetPctFtp: pct,
            targetWatts: Math.round(ftp * pct / 100),
            targetPaceSecsPerKm: Math.round(paceSecsKm),
            stepKind: s.stepKind || "work"
          });
        }
      }
    }
  }
  if (normalizedSteps.length === 0) {
    const rawSteps = Array.isArray(body.steps) && body.steps.length > 0 ? body.steps : [
      { label: "Warmup", durationSecs: 600, targetPctFtp: 62 },
      { label: "Threshold Main Set", durationSecs: 1800, targetPctFtp: 96 },
      { label: "Cooldown", durationSecs: 600, targetPctFtp: 55 }
    ];
    let orderIdx = 0;
    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i];
      const pushSimpleStep = (item, kind) => {
        orderIdx += 1;
        const dist = typeof item.distanceMeters === "number" && item.distanceMeters > 0 ? Math.round(item.distanceMeters) : void 0;
        const explicitPace = typeof item.targetPaceSecsPerKm === "number" && item.targetPaceSecsPerKm > 60 ? Math.round(item.targetPaceSecsPerKm) : void 0;
        const pct = explicitPace ? Math.max(40, Math.min(180, Math.round(thresholdPaceSecsPerKm / explicitPace * 100))) : Math.max(40, Math.min(180, Number(item.targetPctFtp) || 75));
        const targetWatts = Math.round(ftp * pct / 100);
        const targetPaceSecsPerKm = explicitPace ?? Math.round(thresholdPaceSecsPerKm / (pct / 100));
        const durationSecs = typeof item.durationSecs === "number" && item.durationSecs > 0 ? Math.max(5, Math.round(item.durationSecs)) : dist ? Math.max(5, Math.round(dist / 1e3 * targetPaceSecsPerKm)) : 300;
        normalizedSteps.push({
          stepOrder: orderIdx,
          label: String(item.label || `Step ${orderIdx}`),
          durationSecs,
          distanceMeters: dist,
          targetPctFtp: pct,
          targetWatts,
          targetPaceSecsPerKm,
          stepKind: kind
        });
        const speedMps = 1e3 / Math.max(95, targetPaceSecsPerKm);
        fitSteps.push({
          label: String(item.label || `Step ${orderIdx}`).slice(0, 15),
          durationSecs,
          distanceMeters: dist,
          durationType: dist ? "distance" : "time",
          targetType: sport === "Running" ? kind === "rest" ? "open" : "speed" : kind === "rest" ? "open" : "power",
          targetMinSpeedMps: sport === "Running" && kind !== "rest" ? Number((speedMps * 0.975).toFixed(3)) : void 0,
          targetMaxSpeedMps: sport === "Running" && kind !== "rest" ? Number((speedMps * 1.025).toFixed(3)) : void 0,
          targetMinWatts: sport === "Cycling" && kind !== "rest" ? Math.round(targetWatts * 0.95) : void 0,
          targetMaxWatts: sport === "Cycling" && kind !== "rest" ? Math.round(targetWatts * 1.05) : void 0,
          intensity: kind === "work" ? "active" : kind
        });
      };
      if (Array.isArray(s.steps) && s.steps.length > 0 && (s.repeatCount || 1) >= 2) {
        const repTotal = Math.round(s.repeatCount || 2);
        const startIdx = fitSteps.length;
        for (let r = 0; r < repTotal; r++) {
          for (let j = 0; j < s.steps.length; j++) {
            if (r === 0) {
              pushSimpleStep(s.steps[j], j % 2 === 1 ? "rest" : "work");
            } else {
              const child = s.steps[j];
              const pct = Math.max(40, Math.min(180, Number(child.targetPctFtp) || 75));
              const pace = child.targetPaceSecsPerKm ?? Math.round(thresholdPaceSecsPerKm / (pct / 100));
              const dist = child.distanceMeters ? Math.round(child.distanceMeters) : void 0;
              const secs = child.durationSecs ? Math.max(5, Math.round(child.durationSecs)) : dist ? Math.max(5, Math.round(dist / 1e3 * pace)) : 60;
              orderIdx += 1;
              normalizedSteps.push({
                stepOrder: orderIdx,
                label: String(child.label || `Rep Step ${orderIdx}`),
                durationSecs: secs,
                distanceMeters: dist,
                targetPctFtp: pct,
                targetWatts: Math.round(ftp * pct / 100),
                targetPaceSecsPerKm: Math.round(pace),
                stepKind: j % 2 === 1 ? "rest" : "work"
              });
            }
          }
        }
        fitSteps.push({
          label: String(s.label || `Repeat ${repTotal}x`).slice(0, 15),
          durationType: "repeat_until_steps_cmplt",
          repeatFromStepIndex: startIdx,
          repeatCount: repTotal,
          targetType: "open",
          intensity: "active"
        });
      } else {
        const kind = i === 0 && rawSteps.length > 1 ? "warmup" : i === rawSteps.length - 1 && rawSteps.length > 2 ? "cooldown" : "work";
        pushSimpleStep(s, kind);
      }
    }
  }
  const fitBytes = encodeGarminFitWorkout({
    name: title,
    sport,
    steps: fitSteps
  });
  const fitWorkoutBase64 = Buffer.from(fitBytes).toString("base64");
  const intervalsIcuText = workoutSyntax || normalizedSteps.map((st) => {
    const durOrDist = st.distanceMeters ? `${st.distanceMeters}m` : `${st.durationSecs}s`;
    const cue = sport === "Running" ? "Pace" : "FTP";
    return `- ${durOrDist} ${Math.max(45, st.targetPctFtp - 2)}%-${Math.min(180, st.targetPctFtp + 2)}% ${cue} (${st.label})`;
  }).join("\n");
  const appleWorkoutKitJson = {
    schemaVersion: "1.0",
    activityType: sport === "Running" ? "HKWorkoutActivityTypeRunning" : "HKWorkoutActivityTypeCycling",
    displayName: title,
    blocks: normalizedSteps.map((st, idx) => ({
      stepType: st.stepKind === "warmup" || idx === 0 && normalizedSteps.length > 2 ? "warmup" : st.stepKind === "cooldown" || idx === normalizedSteps.length - 1 && normalizedSteps.length > 2 ? "cooldown" : st.stepKind === "rest" ? "recovery" : "work",
      goal: st.distanceMeters ? { type: "distance", meters: st.distanceMeters } : { type: "time", seconds: st.durationSecs },
      alert: sport === "Cycling" ? {
        type: "powerRange",
        minWatts: Math.round(st.targetWatts * 0.96),
        maxWatts: Math.round(st.targetWatts * 1.04)
      } : {
        type: "paceRange",
        minSecsPerKm: Math.round(st.targetPaceSecsPerKm * 0.98),
        maxSecsPerKm: Math.round(st.targetPaceSecsPerKm * 1.02)
      }
    }))
  };
  const toGarminExecStep = (st) => ({
    type: "ExecutableStepDTO",
    stepOrder: st.stepOrder,
    stepType: {
      stepTypeKey: st.stepKind === "warmup" ? "warmup" : st.stepKind === "cooldown" ? "cooldown" : st.stepKind === "rest" ? "rest" : "interval"
    },
    description: st.label,
    endCondition: {
      conditionTypeKey: st.distanceMeters ? "distance" : "time"
    },
    endConditionValue: st.distanceMeters ? st.distanceMeters : st.durationSecs,
    targetType: {
      workoutTargetTypeKey: st.stepKind === "rest" ? "no.target" : sport === "Cycling" ? "power.zone" : "pace.zone"
    },
    targetValueOne: st.stepKind === "rest" ? null : sport === "Cycling" ? Math.round(st.targetWatts * 0.96) : Math.round(1e3 / (st.targetPaceSecsPerKm * 1.02) * 100) / 100,
    targetValueTwo: st.stepKind === "rest" ? null : sport === "Cycling" ? Math.round(st.targetWatts * 1.04) : Math.round(1e3 / (st.targetPaceSecsPerKm * 0.98) * 100) / 100
  });
  const garminWorkoutSteps = astNodes ? astNodes.map((node, idx) => {
    if (node.type === "step") {
      const pct = Math.max(40, Math.min(180, node.step.intensityPct || 75));
      const pace = node.step.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
      return toGarminExecStep({
        stepOrder: idx + 1,
        label: node.step.label,
        durationSecs: Math.max(5, Math.round(node.step.durationSecs || 60)),
        distanceMeters: node.step.distanceMeters,
        targetWatts: Math.round(ftp * pct / 100),
        targetPaceSecsPerKm: Math.round(pace),
        stepKind: node.step.stepKind
      });
    }
    return {
      type: "RepeatGroupDTO",
      stepOrder: idx + 1,
      numberOfIterations: node.repeatCount,
      smartRepeat: false,
      workoutSteps: node.steps.map((inner, innerIdx) => {
        const pct = Math.max(40, Math.min(180, inner.intensityPct || 75));
        const pace = inner.targetPaceSecsPerKm || Math.round(thresholdPaceSecsPerKm / (pct / 100));
        return toGarminExecStep({
          stepOrder: innerIdx + 1,
          label: inner.label,
          durationSecs: Math.max(5, Math.round(inner.durationSecs || 60)),
          distanceMeters: inner.distanceMeters,
          targetWatts: Math.round(ftp * pct / 100),
          targetPaceSecsPerKm: Math.round(pace),
          stepKind: inner.stepKind
        });
      })
    };
  }) : normalizedSteps.map((st) => toGarminExecStep(st));
  const garminTrainingApiJson = {
    workoutName: title,
    sportType: { sportTypeKey: sport === "Running" ? "running" : "cycling" },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeKey: sport === "Running" ? "running" : "cycling" },
        workoutSteps: garminWorkoutSteps
      }
    ]
  };
  const zwoLines = [
    "<workout_file>",
    "  <author>THRESH</author>",
    `  <name>${title.replace(/[<>&]/g, "")}</name>`,
    `  <sportType>${sport === "Running" ? "run" : "bike"}</sportType>`,
    "  <workout>",
    ...normalizedSteps.map(
      (st) => `    <SteadyState Duration="${st.durationSecs}" Power="${(st.targetPctFtp / 100).toFixed(
        2
      )}" />`
    ),
    "  </workout>",
    "</workout_file>"
  ];
  let elapsedMins = 0;
  const ergDataLines = [];
  for (const st of normalizedSteps) {
    const nextMins = Number((elapsedMins + st.durationSecs / 60).toFixed(2));
    ergDataLines.push(`${elapsedMins.toFixed(2)}	${st.targetWatts}`);
    ergDataLines.push(`${nextMins.toFixed(2)}	${st.targetWatts}`);
    elapsedMins = nextMins;
  }
  const ergText = [
    "[COURSE HEADER]",
    "VERSION = 2",
    "UNITS = ENGLISH",
    `DESCRIPTION = ${title}`,
    `FTP = ${ftp}`,
    "MINUTES WATTS",
    "[END COURSE HEADER]",
    "[COURSE DATA]",
    ...ergDataLines,
    "[END COURSE DATA]"
  ].join("\n");
  res.status(200).json({
    ok: true,
    title,
    sport,
    fitWorkoutBase64,
    intervalsIcuText,
    appleWorkoutKitJson,
    garminTrainingApiJson,
    zwoXml: zwoLines.join("\n"),
    ergText
  });
});
webhooksAndExportRouter.post("/api/physiology/durability", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const report = computeFatigueSlicedDurability({
    discipline: body.discipline === "Running" ? "Running" : "Cycling",
    activities: Array.isArray(body.activities) ? body.activities : [],
    streamMap: /* @__PURE__ */ new Map(),
    athleteProfile: body.athleteProfile || null
  });
  res.status(200).json({ ok: true, report });
});
webhooksAndExportRouter.post("/api/physiology/race-simulator", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const report = simulateCoursePacingAndFueling({
    sport: body.sport === "Cycling" ? "Cycling" : "Running",
    raceName: String(body.raceName || "Target A-Race"),
    distanceKm: Number(body.distanceKm) || 21.1,
    elevationGainMeters: Number(body.elevationGainMeters) || 180,
    ambientTempC: Number(body.ambientTempC) ?? 18,
    altitudeMeters: Number(body.altitudeMeters) || 200,
    athleteProfile: body.athleteProfile || {
      ftp: 280,
      thresholdPaceSecsPerKm: 245,
      weightKg: 72
    }
  });
  res.status(200).json({ ok: true, report });
});
webhooksAndExportRouter.post("/api/physiology/race-passport", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const passport = generateVerifiedRacePassport({
    athleteName: String(body.athleteName || "THRESH Athlete"),
    meetOrRaceName: String(body.meetOrRaceName || "Official Championship"),
    eventLabel: String(body.eventLabel || "5000m"),
    platform: body.platform || "Official FAT",
    raceDate: String(body.raceDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)),
    certifiedDistanceMeters: Number(body.certifiedDistanceMeters) || 5e3,
    rawGpsDistanceMeters: Number(body.rawGpsDistanceMeters) || 5080,
    officialChipOrFatSecs: Number(body.officialChipOrFatSecs) || 930,
    officialSplitsSecs: Array.isArray(body.officialSplitsSecs) ? body.officialSplitsSecs : void 0
  });
  res.status(200).json({ ok: true, passport });
});

// server/routers/teamRouter.ts
import express3 from "express";

// server/authService.ts
import crypto5 from "crypto";
function hashKey(val) {
  return crypto5.createHash("sha256").update(String(val ?? "").toLowerCase().trim()).digest("hex").slice(0, 32);
}
async function saveUser(user) {
  user.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveTenantVaultAsync(`user_${user.id}`, user);
  if (user.email) {
    await saveTenantVaultAsync(`auth_email_${hashKey(user.email)}`, { userId: user.id });
  }
  for (const p of user.authProviders) {
    const provKey = `auth_prov_${p.provider}_${hashKey(p.providerId)}`;
    await saveTenantVaultAsync(provKey, { userId: user.id });
  }
}
async function getUserById(userId) {
  if (!userId) return null;
  const cleanId = String(userId).trim();
  const user = await loadTenantVaultAsync(`user_${cleanId}`, null);
  return user;
}
async function getUserByEmail(email) {
  if (!email) return null;
  const indexDoc = await loadTenantVaultAsync(
    `auth_email_${hashKey(email)}`,
    null
  );
  if (!indexDoc?.userId) return null;
  return getUserById(indexDoc.userId);
}
async function getUserByProvider(provider, providerId) {
  if (!provider || !providerId) return null;
  const provKey = `auth_prov_${provider}_${hashKey(providerId)}`;
  const indexDoc = await loadTenantVaultAsync(provKey, null);
  if (!indexDoc?.userId) return null;
  return getUserById(indexDoc.userId);
}
async function findOrCreateUser(provider, providerId, profile) {
  let user = await getUserByProvider(provider, providerId);
  if (user) {
    let changed = false;
    if (profile.name && (!user.name || user.name === "THRESH Athlete")) {
      user.name = profile.name;
      changed = true;
    }
    if (profile.picture && !user.picture) {
      user.picture = profile.picture;
      changed = true;
    }
    if (profile.email && !user.email) {
      user.email = profile.email.toLowerCase().trim();
      changed = true;
    }
    if (changed) {
      await saveUser(user);
    }
    return user;
  }
  const cleanEmail = (profile.email || "").toLowerCase().trim();
  if (cleanEmail) {
    user = await getUserByEmail(cleanEmail);
    if (user) {
      const exists = user.authProviders.some(
        (p) => p.provider === provider && p.providerId === providerId
      );
      if (!exists) {
        user.authProviders.push({
          provider,
          providerId,
          email: cleanEmail,
          name: profile.name,
          linkedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (profile.picture && !user.picture) user.picture = profile.picture;
      await saveUser(user);
      return user;
    }
  }
  const newUserId = `usr_${crypto5.randomBytes(8).toString("hex")}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const newUser = {
    id: newUserId,
    email: cleanEmail,
    name: profile.name?.trim() || (cleanEmail ? cleanEmail.split("@")[0] : "THRESH Athlete"),
    picture: profile.picture,
    role: "athlete",
    createdAt: now,
    updatedAt: now,
    authProviders: [
      {
        provider,
        providerId,
        email: cleanEmail || void 0,
        name: profile.name,
        linkedAt: now
      }
    ],
    passkeys: [],
    connectedServices: []
  };
  if (provider === "strava") {
    newUser.connectedServices.push({
      service: "strava",
      connectedAt: now,
      status: "CONNECTED",
      athleteId: providerId,
      athleteName: profile.name
    });
  }
  await saveUser(newUser);
  return newUser;
}
async function linkProviderToUser(userId, provider, providerId, profile) {
  const user = await getUserById(userId);
  if (!user) return null;
  const existing = user.authProviders.find(
    (p) => p.provider === provider && p.providerId === providerId
  );
  if (!existing) {
    user.authProviders.push({
      provider,
      providerId,
      email: profile?.email,
      name: profile?.name,
      linkedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await saveUser(user);
  }
  return user;
}
async function unlinkProviderFromUser(userId, provider) {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: "User not found" };
  if (user.authProviders.length <= 1) {
    return {
      ok: false,
      error: "Cannot remove your last remaining login method."
    };
  }
  const removedProviders = user.authProviders.filter((p) => p.provider === provider);
  user.authProviders = user.authProviders.filter((p) => p.provider !== provider);
  await saveUser(user);
  for (const removed of removedProviders) {
    await deleteTenantVault(`auth_prov_${removed.provider}_${hashKey(removed.providerId)}`);
  }
  return { ok: true };
}
async function updateUserPrimaryEmail(userId, newEmail) {
  const cleanNewEmail = String(newEmail || "").trim().toLowerCase();
  if (!cleanNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNewEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: "User not found." };
  const existingOwner = await getUserByEmail(cleanNewEmail);
  if (existingOwner && existingOwner.id !== user.id) {
    return {
      ok: false,
      error: "That email is already linked to another THRESH account."
    };
  }
  const oldEmail = (user.email || "").trim().toLowerCase();
  if (oldEmail && oldEmail !== cleanNewEmail) {
    await deleteTenantVault(`auth_email_${hashKey(oldEmail)}`);
  }
  const existingMagicLinks = user.authProviders.filter((p) => p.provider === "magic_link");
  user.authProviders = user.authProviders.filter((p) => p.provider !== "magic_link");
  for (const ml of existingMagicLinks) {
    if (ml.providerId && ml.providerId.toLowerCase() !== cleanNewEmail) {
      await deleteTenantVault(`auth_prov_magic_link_${hashKey(ml.providerId)}`);
    }
  }
  user.authProviders.push({
    provider: "magic_link",
    providerId: cleanNewEmail,
    email: cleanNewEmail,
    name: user.name,
    linkedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  user.email = cleanNewEmail;
  await saveUser(user);
  return { ok: true, user, oldEmail: oldEmail || void 0 };
}
function hashAuthLookupKey(val) {
  return hashKey(val);
}
async function updateUserBirthMonthYear(userId, birthMonthYear) {
  const clean = String(birthMonthYear || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(clean)) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  if (user.birthMonthYear !== clean) {
    user.birthMonthYear = clean;
    await saveUser(user);
  }
  return user;
}
async function connectServiceToUser(userId, service, serviceAthleteId, athleteName) {
  const user = await getUserById(userId);
  if (!user) return null;
  const existingIdx = user.connectedServices.findIndex((s) => s.service === service);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (existingIdx >= 0) {
    user.connectedServices[existingIdx] = {
      ...user.connectedServices[existingIdx],
      status: "CONNECTED",
      athleteId: serviceAthleteId || user.connectedServices[existingIdx].athleteId,
      athleteName: athleteName || user.connectedServices[existingIdx].athleteName,
      connectedAt: now
    };
  } else {
    user.connectedServices.push({
      service,
      status: "CONNECTED",
      athleteId: serviceAthleteId,
      athleteName,
      connectedAt: now
    });
  }
  await saveUser(user);
  return user;
}
async function disconnectServiceFromUser(userId, service) {
  const user = await getUserById(userId);
  if (!user) return null;
  const existingIdx = user.connectedServices.findIndex((s) => s.service === service);
  if (existingIdx >= 0) {
    user.connectedServices[existingIdx].status = "DISCONNECTED";
    await saveUser(user);
  }
  return user;
}
var MAGIC_LINK_TTL_MS = 15 * 60 * 1e3;
async function createMagicLinkToken(email, pendingJoin) {
  const cleanEmail = email.toLowerCase().trim();
  const rawToken = crypto5.randomBytes(32).toString("hex");
  const tokenHash = crypto5.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;
  await saveTenantVaultAsync(`magic_link_${tokenHash}`, {
    email: cleanEmail,
    expiresAt,
    ...pendingJoin?.joinCode || pendingJoin?.slug || pendingJoin?.inviteToken ? { pendingJoin } : {}
  });
  return { token: rawToken, expiresAt };
}
async function peekMagicLinkPayload(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = crypto5.createHash("sha256").update(rawToken.trim()).digest("hex");
  const record = await loadTenantVaultAsync(`magic_link_${tokenHash}`, null);
  if (!record || !record.email || !record.expiresAt) {
    return null;
  }
  if (Date.now() > record.expiresAt) {
    await saveTenantVaultAsync(`magic_link_${tokenHash}`, null);
    return null;
  }
  return { email: record.email, pendingJoin: record.pendingJoin };
}
async function verifyMagicLinkPayload(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = crypto5.createHash("sha256").update(rawToken.trim()).digest("hex");
  const vaultKey = `magic_link_${tokenHash}`;
  return withVaultLock(vaultKey, async () => {
    const record = await loadTenantVaultAsync(vaultKey, null);
    if (!record || !record.email || !record.expiresAt) {
      return null;
    }
    await saveTenantVaultAsync(vaultKey, null);
    if (Date.now() > record.expiresAt) {
      return null;
    }
    return { email: record.email, pendingJoin: record.pendingJoin };
  });
}
async function sendMagicLinkEmail(email, verifyUrl) {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const safeVerifyUrl = escapeHtml(verifyUrl);
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.AUTH_EMAIL_FROM || "THRESH <auth@thresh.run>",
          to: [email],
          subject: "Sign in to THRESH",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0E1612; color: #E2E8F0; border-radius: 16px;">
              <h2 style="color: #C8FF00; margin-top: 0;">Sign in to THRESH</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #94A3B8;">Click the secure link below to sign in to your THRESH endurance training cockpit. This link expires in 15 minutes.</p>
              <div style="margin: 24px 0;">
                <a href="${safeVerifyUrl}" style="background: #C8FF00; color: #0E1612; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 12px; display: inline-block; font-size: 14px;">Sign In to THRESH</a>
              </div>
              <p style="font-size: 12px; color: #64748B;">If you didn't request this email, you can safely ignore it.</p>
            </div>
          `
        })
      });
      if (res.ok) {
        return { sent: true };
      }
      console.warn("[THRESH Auth] Resend email send failed:", await res.text());
    } catch (err) {
      console.error("[THRESH Auth] Failed sending email via Resend:", err);
    }
  }
  if (isProductionDeployment()) {
    return {
      sent: false,
      error: "Email delivery service is temporarily unavailable. Please try Google, Passkey, or Strava."
    };
  }
  return {
    sent: true,
    devMode: true,
    previewUrl: verifyUrl
  };
}
async function createPendingEmailChange(userId, newEmail) {
  const cleanNewEmail = String(newEmail || "").trim().toLowerCase();
  if (!cleanNewEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNewEmail)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: "User not found." };
  const existingOwner = await getUserByEmail(cleanNewEmail);
  if (existingOwner && existingOwner.id !== user.id) {
    return {
      ok: false,
      error: "That email is already linked to another THRESH account."
    };
  }
  const code = String(crypto5.randomInt(1e5, 1e6));
  const codeHash = crypto5.createHash("sha256").update(code).digest("hex");
  await saveTenantVaultAsync(`email_change_${user.id}`, {
    newEmail: cleanNewEmail,
    codeHash,
    expiresAt: Date.now() + 15 * 60 * 1e3,
    attempts: 0
  });
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: process.env.AUTH_EMAIL_FROM || "THRESH <auth@thresh.run>",
          to: [cleanNewEmail],
          subject: "Verify your new THRESH email address",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0E1612; color: #E2E8F0; border-radius: 16px;">
              <h2 style="color: #C8FF00; margin-top: 0;">Confirm Email Change</h2>
              <p style="font-size: 14px; line-height: 1.6; color: #94A3B8;">Enter this 6-digit verification code in THRESH to confirm moving your primary login email to <strong>${escapeHtml(cleanNewEmail)}</strong>:</p>
              <div style="margin: 20px 0; font-family: monospace; font-size: 28px; font-weight: 800; letter-spacing: 0.2em; color: #C8FF00;">${escapeHtml(code)}</div>
              <p style="font-size: 12px; color: #64748B;">This code expires in 15 minutes. If you did not request this change, you can ignore this email.</p>
            </div>
          `
        })
      });
      if (res.ok) {
        return { ok: true };
      }
      console.warn("[THRESH Auth] Resend email-change dispatch failed:", await res.text());
    } catch (err) {
      console.error("[THRESH Auth] Failed sending email-change code via Resend:", err);
    }
  }
  if (isProductionDeployment()) {
    await saveTenantVaultAsync(`email_change_${user.id}`, null);
    return {
      ok: false,
      error: "Email verification service is unavailable right now. Please try again shortly."
    };
  }
  return { ok: true, devMode: true, devCode: code };
}
async function verifyAndCommitEmailChange(userId, rawCode, expectedNewEmail) {
  const cleanCode = String(rawCode || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: "Please enter the 6-digit verification code sent to your new email." };
  }
  const vaultKey = `email_change_${userId}`;
  return withVaultLock(vaultKey, async () => {
    const rec = await loadTenantVaultAsync(vaultKey, null);
    if (!rec || !rec.newEmail || !rec.codeHash || !rec.expiresAt) {
      return { ok: false, error: "No pending email verification request found. Request a new code." };
    }
    if (Date.now() > rec.expiresAt) {
      await saveTenantVaultAsync(vaultKey, null);
      return { ok: false, error: "Verification code has expired. Please request a new code." };
    }
    if (expectedNewEmail && expectedNewEmail.trim().toLowerCase() !== rec.newEmail) {
      return { ok: false, error: "Verification code was issued for a different email address." };
    }
    if (rec.attempts >= 5) {
      await saveTenantVaultAsync(vaultKey, null);
      return { ok: false, error: "Too many invalid attempts. Please request a new verification code." };
    }
    const incomingHash = crypto5.createHash("sha256").update(cleanCode).digest("hex");
    if (!timingSafeStringEqual(incomingHash, rec.codeHash)) {
      rec.attempts += 1;
      await saveTenantVaultAsync(vaultKey, rec);
      return { ok: false, error: "Invalid verification code." };
    }
    await saveTenantVaultAsync(vaultKey, null);
    const updated = await updateUserPrimaryEmail(userId, rec.newEmail);
    if (!updated.ok || !updated.user) {
      return { ok: false, error: updated.error || "Could not update email." };
    }
    return {
      ok: true,
      user: updated.user,
      oldEmail: updated.oldEmail,
      newEmail: rec.newEmail
    };
  });
}
function issuePasskeyChallengeToken(payload) {
  const data = JSON.stringify({
    ...payload,
    jti: crypto5.randomBytes(12).toString("hex"),
    exp: Date.now() + 5 * 60 * 1e3
    // 5 min TTL
  });
  const b64 = Buffer.from(data, "utf8").toString("base64url");
  const sig = crypto5.createHmac("sha256", getPasskeyChallengeSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}
function verifyPasskeyChallengeToken(token) {
  if (!token) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const expectedSig = crypto5.createHmac("sha256", getPasskeyChallengeSecret()).update(b64).digest("base64url");
  if (!timingSafeStringEqual(sig, expectedSig)) return null;
  try {
    const claims = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    if (!claims.exp || Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

// server/athleteArchiveHelper.ts
async function archiveCoachActivitiesForMember(member, activities) {
  if (!Array.isArray(activities) || activities.length === 0) return;
  const targetVaultKeys = /* @__PURE__ */ new Set();
  let resolvedUserId = member.userId?.trim();
  if (!resolvedUserId && member.invitedEmail) {
    const matchedUser = await getUserByEmail(member.invitedEmail).catch(() => null);
    if (matchedUser?.id) resolvedUserId = matchedUser.id;
  }
  if (resolvedUserId?.startsWith("usr_")) {
    const cleanUsr = resolvedUserId.replace(/[^0-9a-zA-Z_-]/g, "");
    if (cleanUsr) targetVaultKeys.add(`athlete_state_user_${cleanUsr}`);
  }
  if (member.stravaAthleteId) {
    const cleanStrava = String(member.stravaAthleteId).trim().replace(/[^0-9a-zA-Z_-]/g, "");
    if (cleanStrava) targetVaultKeys.add(`athlete_state_strava_${cleanStrava}`);
  }
  if (member.userSid) {
    const cleanSid = String(member.userSid).trim().replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 32);
    if (cleanSid) targetVaultKeys.add(`athlete_state_sid_${cleanSid}`);
  }
  if (targetVaultKeys.size === 0) return;
  const compactIncoming = activities.map((act) => ({
    ...act,
    streams: void 0
  }));
  for (const vaultKey of targetVaultKeys) {
    await withVaultLock(vaultKey, async () => {
      const existing = await loadTenantVaultAsync(
        vaultKey,
        null
      );
      const prevArchived = Array.isArray(existing?.coachArchivedActivities) ? existing.coachArchivedActivities : [];
      const mergedMap = /* @__PURE__ */ new Map();
      for (const item of [...compactIncoming, ...prevArchived]) {
        if (item?.id && !mergedMap.has(item.id)) {
          mergedMap.set(item.id, item);
        }
      }
      const nextArchived = Array.from(mergedMap.values()).sort((a, b) => String(b.startDateLocal || "").localeCompare(String(a.startDateLocal || ""))).slice(0, 150);
      const sanitized = sanitizeAthleteCloudState(
        { coachArchivedActivities: nextArchived },
        existing
      );
      await saveTenantVaultAsync(vaultKey, sanitized);
    });
  }
}

// server/teamService.ts
import crypto6 from "crypto";

// server/cleanRoomFirewall.ts
var FIRST_PARTY_HARDWARE_TOKENS = [
  "garmin",
  "fit",
  "wahoo",
  "coros",
  "suunto",
  "polar",
  "apple_watch",
  "apple watch",
  "intervals"
];
var ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS = [
  ...FIRST_PARTY_HARDWARE_TOKENS,
  "apple",
  "thresh_stopwatch",
  "thresh stopwatch",
  "stopwatch",
  "manual",
  "official_race",
  "official race",
  "official fat"
];
function isStravaOriginRecord(item) {
  if (!item || typeof item !== "object") return false;
  const obj = item;
  const src = String(
    obj.source || obj.ingestionSource || obj.externalSource || obj.id || ""
  ).toLowerCase();
  const badges = Array.isArray(obj.sourceBadges) ? obj.sourceBadges.map((b) => String(b).toLowerCase()) : [];
  const hasFirstPartyHardware = badges.some(
    (b) => FIRST_PARTY_HARDWARE_TOKENS.some((tok) => b.includes(tok))
  );
  if (Boolean(obj.stravaId) && !hasFirstPartyHardware) return true;
  if (src.includes("strava") && !hasFirstPartyHardware) return true;
  if (badges.includes("strava") && !hasFirstPartyHardware) return true;
  return false;
}
function hasVerifiedCleanRoomProvenance(item) {
  if (!item || typeof item !== "object") return false;
  if (isStravaOriginRecord(item)) return false;
  const obj = item;
  const badges = Array.isArray(obj.sourceBadges) ? obj.sourceBadges.map((b) => String(b).toLowerCase()) : [];
  if (badges.some(
    (b) => ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS.some((tok) => b.includes(tok))
  )) {
    return true;
  }
  const src = String(
    obj.source || obj.ingestionSource || obj.externalSource || obj.id || ""
  ).toLowerCase();
  return ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS.some((tok) => src.includes(tok));
}
var SAFESPORT_WEIGHT_AND_BODY_COMP_KEYS = /* @__PURE__ */ new Set([
  "weightkg",
  "weightlbs",
  "weight",
  "bmi",
  "bodymassindex",
  "bodyfatpct",
  "bodyfat",
  "leanbodymass",
  "wattsperkg",
  "avgwattsperkg",
  "targetwkg",
  "wkg",
  "wperkg"
]);
function stripSafeSportWeightAndBodyCompFields(input, options) {
  if (input === null || input === void 0 || typeof input !== "object") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map(
      (item) => stripSafeSportWeightAndBodyCompFields(item, options)
    );
  }
  const record = input;
  const isWellnessDayRecord = "hrvRMSSD" in record || "restingHR" in record;
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    const lowerKey = k.toLowerCase();
    if (lowerKey === "weightkg" && options?.maskWellnessWeightKgZero && isWellnessDayRecord) {
      out[k] = 0;
      continue;
    }
    if (SAFESPORT_WEIGHT_AND_BODY_COMP_KEYS.has(lowerKey)) {
      continue;
    }
    out[k] = stripSafeSportWeightAndBodyCompFields(v, options);
  }
  return out;
}
function sanitizeTelemetryForCleanRoom(rawSummary, options) {
  if (!rawSummary || typeof rawSummary !== "object") return {};
  let clone = { ...rawSummary };
  let strippedCount = 0;
  for (const key of [
    "recentWorkouts",
    "recentActivities",
    "activities",
    "workouts",
    "completedActivities"
  ]) {
    if (Array.isArray(clone[key])) {
      const before = clone[key].length;
      const requirePositive = Boolean(
        options?.requireFirstPartyProvenance || key === "recentWorkouts"
      );
      clone[key] = clone[key].filter(
        (item) => requirePositive ? hasVerifiedCleanRoomProvenance(item) : !isStravaOriginRecord(item)
      );
      strippedCount += before - clone[key].length;
    }
  }
  delete clone.stravaSegments;
  delete clone.stravaKudos;
  delete clone.stravaAthleteId;
  delete clone.segmentEfforts;
  if (options?.forceZeroWeight || clone.safeSportHideWeight || clone.isMinorU18 || clone.enforceZeroWeight) {
    clone = stripSafeSportWeightAndBodyCompFields(clone);
    clone.safeSportHideWeight = true;
    clone.zeroWeightEnforced = true;
  }
  clone.cleanRoomPolicy = "FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY";
  clone.stravaRecordsFiltered = strippedCount;
  return clone;
}

// src/physiology/safeSportPatternWatchEngine.ts
var DAY_MS = 864e5;
var mean = (vals) => vals.length === 0 ? 0 : vals.reduce((acc, v) => acc + v, 0) / vals.length;
function isHardSession(act) {
  const name = (act.name || "").toLowerCase();
  const hasWorkIntervals = Boolean(act.intervals && act.intervals.some((i) => i.type === "WORK"));
  const highRpe = (act.quickLog?.rpe ?? 0) >= 7;
  const highLoad = (act.trainingLoad ?? 0) >= 65;
  return act.subType === "Track" || Boolean(act.officialRaceData) || hasWorkIntervals || highRpe || highLoad || /\b(track|intervals?|tempo|threshold|race|meets?|repeats?|vo2|fartlek|time trial|5000m|3200m|1600m|800m)\b|\d+\s*[x×]\s*\d+/i.test(
    name
  );
}
function isEasySubmaximalRun(act) {
  if (act.sportCategory !== "Running") return false;
  if ((act.movingTimeSecs || 0) < 1200 || (act.distanceMeters || 0) < 2e3) return false;
  if (!(act.avgHr > 90)) return false;
  if (isHardSession(act)) return false;
  return true;
}
function extractActivityEf(act) {
  if (act.sportCategory !== "Running") return null;
  if ((act.movingTimeSecs || 0) < 1200 || !(act.avgHr > 90)) return null;
  if (typeof act.efficiencyFactor === "number" && act.efficiencyFactor > 0.3) {
    return act.efficiencyFactor;
  }
  if (act.distanceMeters > 1500 && act.movingTimeSecs > 0) {
    const speedMpm = act.distanceMeters / (act.movingTimeSecs / 60);
    return Number((speedMpm / act.avgHr).toFixed(3));
  }
  return null;
}
function extractHrr60Samples(act) {
  const samples = [];
  if (act.streams?.time && act.streams?.heartrate && act.intervals?.length) {
    const times = act.streams.time;
    const hrs = act.streams.heartrate;
    for (const iv of act.intervals) {
      if (iv.type !== "WORK") continue;
      const workEnd = iv.startTimeSecs + iv.durationSecs;
      const targetT = workEnd + 60;
      let startHr = null;
      let end60Hr = null;
      for (let i = 0; i < times.length; i++) {
        if (startHr === null && times[i] >= workEnd) {
          startHr = hrs[i];
        }
        if (times[i] >= targetT) {
          end60Hr = hrs[i];
          break;
        }
      }
      if (startHr !== null && end60Hr !== null && startHr > 110 && startHr > end60Hr) {
        samples.push(Math.round(startHr - end60Hr));
      }
    }
    if (samples.length > 0) return samples;
  }
  if (act.intervals && act.intervals.length >= 2) {
    for (let i = 0; i < act.intervals.length - 1; i++) {
      const cur = act.intervals[i];
      const next = act.intervals[i + 1];
      if (cur.type === "WORK" && next.type === "RECOVERY" && next.durationSecs >= 45) {
        const peak = cur.maxHr ?? cur.avgHr;
        if (peak && next.avgHr && peak > 120 && peak > next.avgHr) {
          samples.push(Math.round(peak - next.avgHr));
        }
      }
    }
  }
  return samples;
}
function evaluateSafeSportPatternWatch(params) {
  const {
    activities = [],
    wellnessDays = [],
    checkIn,
    isMinorU18 = false,
    hasParentGuardianCc = false,
    hasAthleticTrainer = false,
    referenceDateIso
  } = params;
  const refDateStr = (referenceDateIso || getLocalDateIso()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);
  const datedActivities = activities.map((act) => {
    const d = (act.startDateLocal || "").slice(0, 10);
    const ms = Date.parse(`${d}T12:00:00Z`);
    const ageDays = Number.isFinite(ms) ? (refMs - ms) / DAY_MS : Infinity;
    return { act, ageDays };
  }).filter((entry) => entry.ageDays >= 0 && entry.ageDays <= 56);
  const has56dHistory = datedActivities.some((entry) => entry.ageDays > 28);
  const windowBaselineDays = has56dHistory ? 56 : 28;
  const recentActs = datedActivities.filter((e) => e.ageDays <= 14).map((e) => e.act);
  const baselineActs = datedActivities.filter((e) => e.ageDays > 14 && e.ageDays <= 56).map((e) => e.act);
  const signals = [];
  const recentEasy = recentActs.filter(isEasySubmaximalRun);
  const baselineEasy = baselineActs.filter(isEasySubmaximalRun);
  let deltaEasyHrBpm = null;
  if (recentEasy.length >= 1 && baselineEasy.length >= 1) {
    const baseHr = mean(baselineEasy.map((a) => a.avgHr));
    const recHr = mean(recentEasy.map((a) => a.avgHr));
    deltaEasyHrBpm = Number((recHr - baseHr).toFixed(1));
    if (deltaEasyHrBpm >= 8) {
      signals.push({
        signalId: "EASY_HR_DRIFT_ELEVATED",
        severity: deltaEasyHrBpm >= 11 ? "ACTION_REQUIRED" : "WATCH",
        title: "Submaximal Easy-Run HR Drift",
        metricValue: `${Math.round(recHr)} bpm`,
        baselineValue: `${Math.round(baseHr)} bpm`,
        deltaDisplay: `+${deltaEasyHrBpm.toFixed(1)} bpm`,
        guidance: "Sustained upward HR drift at easy aerobic pace is a classic early cardiovascular marker of low energy availability or iron depletion."
      });
    }
  }
  const recentHard = recentActs.filter((a) => a.sportCategory === "Running" && isHardSession(a) && a.maxHr > 120);
  const baselineHard = baselineActs.filter((a) => a.sportCategory === "Running" && isHardSession(a) && a.maxHr > 120);
  const sortedWellness = [...wellnessDays].sort((a, b) => a.date.localeCompare(b.date));
  const latestWellness = sortedWellness[sortedWellness.length - 1];
  const highStrainContext = (latestWellness ? latestWellness.ctl - latestWellness.atl <= -10 : false) || checkIn?.energyFeel === "FLAT" || recentHard.some((a) => (a.quickLog?.rpe ?? 0) >= 7 || (a.trainingLoad ?? 0) >= 65);
  let chronotropicBluntingDetected = false;
  if (recentHard.length >= 1 && baselineHard.length >= 1) {
    const baseMaxHr = mean(baselineHard.map((a) => a.maxHr));
    const recMaxHr = mean(recentHard.map((a) => a.maxHr));
    const dropBpm = Number((baseMaxHr - recMaxHr).toFixed(1));
    if (dropBpm >= 6 && (highStrainContext || dropBpm >= 8)) {
      chronotropicBluntingDetected = true;
      signals.push({
        signalId: "CHRONOTROPIC_BLUNTING",
        severity: dropBpm >= 10 ? "ACTION_REQUIRED" : "WATCH",
        title: "Chronotropic Blunting on Quality Efforts",
        metricValue: `${Math.round(recMaxHr)} bpm peak`,
        baselineValue: `${Math.round(baseMaxHr)} bpm peak`,
        deltaDisplay: `-${dropBpm.toFixed(1)} bpm`,
        guidance: "Suppressed max HR during track or hard efforts under elevated training load warrants reduced anaerobic volume and medical review."
      });
    }
  }
  const recentEfVals = recentActs.map(extractActivityEf).filter((v) => v !== null);
  const baseEfVals = baselineActs.map(extractActivityEf).filter((v) => v !== null);
  let deltaEfficiencyFactorPct = null;
  if (recentEfVals.length >= 1 && baseEfVals.length >= 1) {
    const baseEf = mean(baseEfVals);
    const recEf = mean(recentEfVals);
    deltaEfficiencyFactorPct = Number(((recEf - baseEf) / Math.max(0.1, baseEf) * 100).toFixed(1));
    if (deltaEfficiencyFactorPct <= -6) {
      signals.push({
        signalId: "EFFICIENCY_FACTOR_DECAY",
        severity: deltaEfficiencyFactorPct <= -9 ? "ACTION_REQUIRED" : "WATCH",
        title: "Aerobic Efficiency Factor (EF) Drop",
        metricValue: `${recEf.toFixed(2)}`,
        baselineValue: `${baseEf.toFixed(2)}`,
        deltaDisplay: `${deltaEfficiencyFactorPct.toFixed(1)}%`,
        guidance: "14-day speed-to-HR efficiency fell >= 6% beneath baseline. Prioritize sleep, carbohydrate refueling around sessions, and reduced density."
      });
    }
  }
  const recentHrr60 = recentActs.flatMap(extractHrr60Samples);
  const baseHrr60 = baselineActs.flatMap(extractHrr60Samples);
  let deltaHrr60Bpm = null;
  if (recentHrr60.length >= 1 && baseHrr60.length >= 1) {
    const baseHrr = mean(baseHrr60);
    const recHrr = mean(recentHrr60);
    deltaHrr60Bpm = Number((recHrr - baseHrr).toFixed(1));
    if (deltaHrr60Bpm <= -6) {
      signals.push({
        signalId: "HRR60_PARASYMPATHETIC_DROP",
        severity: deltaHrr60Bpm <= -10 ? "ACTION_REQUIRED" : "WATCH",
        title: "60s Heart-Rate Recovery (HRR60) Blunted",
        metricValue: `${Math.round(recHrr)} bpm drop`,
        baselineValue: `${Math.round(baseHrr)} bpm drop`,
        deltaDisplay: `${deltaHrr60Bpm.toFixed(1)} bpm`,
        guidance: "Post-interval 60s parasympathetic rebound slowed >= 6 bpm. Swap next spiked session for low-impact aerobic recovery."
      });
    }
  }
  let ferritinStatus = "UNKNOWN";
  if (typeof checkIn?.ferritinNgMl === "number" && Number.isFinite(checkIn.ferritinNgMl)) {
    const f = checkIn.ferritinNgMl;
    if (f < 30) {
      ferritinStatus = "DEPLETED_UNDER_30";
      signals.push({
        signalId: "SERUM_FERRITIN_LOW",
        severity: "ACTION_REQUIRED",
        title: "Serum Ferritin Depleted (< 30 ng/mL)",
        metricValue: `${f.toFixed(0)} ng/mL`,
        baselineValue: ">= 50 ng/mL target",
        deltaDisplay: `${Math.round(f - 50)} ng/mL`,
        guidance: "Low endurance ferritin reserve (< 30 ng/mL) may limit aerobic recovery and oxygen transport. Coaching readiness indicator only (not a medical diagnosis) \u2014 consult a sports physician before iron supplementation."
      });
    } else if (f < 50) {
      ferritinStatus = "SUBOPTIMAL_30_50";
      signals.push({
        signalId: "SERUM_FERRITIN_LOW",
        severity: "WATCH",
        title: "Serum Ferritin Borderline (30\u201349 ng/mL)",
        metricValue: `${f.toFixed(0)} ng/mL`,
        baselineValue: ">= 50 ng/mL target",
        deltaDisplay: `${Math.round(f - 50)} ng/mL`,
        guidance: "Borderline iron stores for endurance runners. Discuss dietary heme-iron intake and physician lab follow-up."
      });
    } else {
      ferritinStatus = "OPTIMAL";
    }
  }
  const kneeScore = checkIn?.kneeGrowthPlateSoreness ?? 0;
  const heelScore = checkIn?.heelApophysisSoreness ?? 0;
  const maxPhvScore = Math.max(kneeScore, heelScore);
  const phvGrowthPlateFlag = maxPhvScore >= 1;
  if (phvGrowthPlateFlag) {
    const site = kneeScore >= heelScore ? "Tibial Tuberosity (Knee)" : "Calcaneal Apophysis (Heel)";
    signals.push({
      signalId: "PHV_GROWTH_PLATE_SORENESS",
      severity: maxPhvScore >= 2 ? "ACTION_REQUIRED" : "WATCH",
      title: `PHV Growth-Plate Traction Watch (${site})`,
      metricValue: `${maxPhvScore}/3`,
      baselineValue: "0/3 pain-free",
      deltaDisplay: `+${maxPhvScore}`,
      guidance: maxPhvScore >= 2 ? "PROTECT GROWTH PLATE: Pause plyometrics, hurdles, and spikes immediately; route to Athletic Trainer / Aqua Jog." : "Early apophyseal traction sensitivity. Eliminate track spikes & hard downhill/bounding work this week."
    });
  }
  const hasActionRequired = signals.some((s) => s.severity === "ACTION_REQUIRED");
  const medicalWatchCluster = signals.length >= 2 && (ferritinStatus !== "UNKNOWN" && ferritinStatus !== "OPTIMAL" ? true : deltaEasyHrBpm !== null && deltaEasyHrBpm >= 8 && deltaEfficiencyFactorPct !== null && deltaEfficiencyFactorPct <= -6);
  const trafficLight = hasActionRequired || medicalWatchCluster || maxPhvScore >= 2 || ferritinStatus === "DEPLETED_UNDER_30" ? "RED_MEDICAL_REVIEW" : signals.length >= 1 ? "AMBER_WATCH" : "GREEN_CLEAR";
  const authorizedRecipients = ["ATHLETE_SELF"];
  if (isMinorU18 || hasParentGuardianCc) {
    authorizedRecipients.push("PARENT_GUARDIAN_CC");
  }
  if (hasAthleticTrainer || trafficLight === "RED_MEDICAL_REVIEW") {
    authorizedRecipients.push("ATHLETIC_TRAINER_MEDICAL");
  }
  let headline = "Autonomic, Aerobic Efficiency & Growth-Plate Markers Clear";
  let athleteGuidance = "14-day cardiac efficiency, recovery HR, and growth-plate status sit cleanly inside your personal baseline (zero weight tracking).";
  let coachSafeSummaryLabel = "Clear \u2014 Normal Training Progression";
  if (trafficLight === "RED_MEDICAL_REVIEW") {
    headline = "Medical / AT Review Recommended \xB7 Non-Weight Biomarker Shift";
    athleteGuidance = "Multiple non-weight endurance & tissue signals shifted beneath baseline. Pause high-density spiked work and coordinate privately with your healthcare provider / Athletic Trainer.";
    coachSafeSummaryLabel = "AT / Medical Review & Load Modification Recommended (Zero-Weight Private Signal)";
  } else if (trafficLight === "AMBER_WATCH") {
    headline = "Early Non-Weight Pattern Watch \xB7 Monitor Recovery & Fueling";
    athleteGuidance = "One early cardiac, iron, or growth-plate signal stepped outside baseline. Emphasize 8.5h+ sleep, post-run carbohydrate/protein intake, and daily trainers.";
    coachSafeSummaryLabel = "Early Watch \u2014 Prioritize Recovery & Trainers Only (Zero-Weight Private Signal)";
  }
  const medicalRoutingSummary = isMinorU18 ? `Private U18 Route: Athlete Self${hasParentGuardianCc ? " + Parent/Guardian CC" : ""}${authorizedRecipients.includes("ATHLETIC_TRAINER_MEDICAL") ? " + Certified Athletic Trainer" : ""} (weight, BMI & W/kg strictly excluded).` : authorizedRecipients.includes("ATHLETIC_TRAINER_MEDICAL") ? "Private Athlete + Athletic Trainer / Medical Staff (weight, BMI & W/kg strictly excluded)." : "Private Athlete Only (solo adult \u2014 weight, BMI & W/kg strictly excluded).";
  return {
    evaluatedAtIso: (/* @__PURE__ */ new Date()).toISOString(),
    windowRecentDays: 14,
    windowBaselineDays,
    trafficLight,
    zeroWeightCompliant: true,
    isMinorU18,
    deltaEasyHrBpm,
    chronotropicBluntingDetected,
    deltaEfficiencyFactorPct,
    deltaHrr60Bpm,
    ferritinStatus,
    phvGrowthPlateFlag,
    signals,
    headline,
    athleteGuidance,
    medicalRoutingSummary,
    authorizedRecipients,
    coachSafeSummaryLabel
  };
}

// src/utils/officialRaceSynthesizer.ts
function formatFatTime(seconds, forceHundredths = true) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00.00";
  const totalHundredths = Math.round(seconds * 100);
  const hundredths = totalHundredths % 100;
  const wholeSecsTotal = Math.floor(totalHundredths / 100);
  const hours = Math.floor(wholeSecsTotal / 3600);
  const mins = Math.floor(wholeSecsTotal % 3600 / 60);
  const secs = wholeSecsTotal % 60;
  const hStr = hundredths.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}${forceHundredths ? `.${hStr}` : ""}`;
  }
  if (mins === 0) {
    return `${secs}.${hStr}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}${forceHundredths || hundredths > 0 ? `.${hStr}` : ""}`;
}
function computeJackDanielsVdot(distanceMeters, timeSecs) {
  if (!distanceMeters || !timeSecs || timeSecs <= 0) return 55;
  const timeMins = timeSecs / 60;
  const velocityMetersPerMin = distanceMeters / timeMins;
  const vo2Cost = -4.6 + 0.182258 * velocityMetersPerMin + 104e-6 * velocityMetersPerMin * velocityMetersPerMin;
  const pctVo2Max = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMins) + 0.2989558 * Math.exp(-0.1932605 * timeMins);
  const rawVdot = vo2Cost / Math.max(0.55, pctVo2Max);
  return Number(Math.max(32, Math.min(88, rawVdot)).toFixed(1));
}
function computeOfficialRaceTrainingLoad(distanceMeters, fatTimeSecs, includeWarmupCooldown) {
  let raceEffortTss = 45;
  if (distanceMeters <= 450) {
    raceEffortTss = 34;
  } else if (distanceMeters <= 900) {
    raceEffortTss = 44;
  } else if (distanceMeters <= 1700) {
    raceEffortTss = 54;
  } else if (distanceMeters <= 3400) {
    raceEffortTss = 68;
  } else if (distanceMeters <= 5200) {
    raceEffortTss = 84;
  } else if (distanceMeters <= 10500) {
    raceEffortTss = 108;
  } else {
    raceEffortTss = Math.round(Math.min(185, fatTimeSecs / 3600 * 112));
  }
  const warmupCooldownTss = includeWarmupCooldown ? 32 : 0;
  return raceEffortTss + warmupCooldownTss;
}
function generateDefaultLapSplits(eventDistanceMeters, fatTimeSecs, splitDistanceMeters = 400) {
  if (!fatTimeSecs || fatTimeSecs <= 0) return [];
  const numLaps = Math.max(1, Math.round(eventDistanceMeters / splitDistanceMeters));
  if (numLaps <= 1) return [Number(fatTimeSecs.toFixed(2))];
  const avgLap = fatTimeSecs / numLaps;
  const weights = [];
  for (let i = 0; i < numLaps; i++) {
    if (i === 0) weights.push(0.988);
    else if (i === numLaps - 1) weights.push(0.984);
    else weights.push(1 + 0.014);
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const rawSplits = weights.map(
    (w) => Number((w / weightSum * fatTimeSecs).toFixed(2))
  );
  const sumExceptLast = rawSplits.slice(0, -1).reduce((s, v) => s + v, 0);
  rawSplits[rawSplits.length - 1] = Number(Math.max(10, fatTimeSecs - sumExceptLast).toFixed(2));
  return rawSplits;
}
function synthesizeOfficialRaceActivity(candidate, athleteLthr = 172, athleteMaxHr = 192) {
  const splitMeters = candidate.lapSplitDistanceMeters || (candidate.eventDistanceMeters <= 400 ? 200 : candidate.eventDistanceMeters >= 5e3 ? 1e3 : 400);
  const splits = candidate.lapSplitsSecs && candidate.lapSplitsSecs.length > 0 ? candidate.lapSplitsSecs : generateDefaultLapSplits(candidate.eventDistanceMeters, candidate.fatTimeSecs, splitMeters);
  const vdot = computeJackDanielsVdot(candidate.eventDistanceMeters, candidate.fatTimeSecs);
  const trainingLoad = computeOfficialRaceTrainingLoad(
    candidate.eventDistanceMeters,
    candidate.fatTimeSecs,
    candidate.includeWarmupCooldown
  );
  const totalSecs = Math.max(10, Math.round(candidate.fatTimeSecs));
  const timeStream = [];
  const distanceStream = [];
  const velocityStream = [];
  const hrStream = [];
  const cadenceStream = [];
  const intervals = [];
  let elapsedSecsCursor = 0;
  let elapsedDistCursor = 0;
  splits.forEach((lapSecs, idx) => {
    const lapDist = idx === splits.length - 1 ? Math.max(100, candidate.eventDistanceMeters - elapsedDistCursor) : splitMeters;
    const lapSpeedMps = lapDist / Math.max(1, lapSecs);
    const lapPaceSecsKm = Math.round(1e3 / Math.max(0.5, lapSpeedMps));
    const lapDurationInt = Math.max(1, Math.round(lapSecs));
    const lapStartHr = idx === 0 ? Math.round(athleteLthr * 0.92) : Math.min(athleteMaxHr, Math.round(athleteLthr * 1.01 + idx * 2.5));
    const lapEndHr = Math.min(
      athleteMaxHr,
      Math.round(athleteLthr * 1.03 + (idx + 1) * 3)
    );
    for (let s = 0; s < lapDurationInt; s++) {
      const t = elapsedSecsCursor + s;
      const frac = s / Math.max(1, lapDurationInt);
      timeStream.push(t);
      distanceStream.push(Number((elapsedDistCursor + frac * lapDist).toFixed(1)));
      velocityStream.push(Number((lapSpeedMps * (0.99 + 0.02 * Math.sin(s * 0.4))).toFixed(2)));
      hrStream.push(Math.round(lapStartHr + frac * (lapEndHr - lapStartHr)));
      cadenceStream.push(
        candidate.eventDistanceMeters <= 1650 ? 194 + (idx === splits.length - 1 ? 6 : 0) : 186
      );
    }
    intervals.push({
      id: `lap-${idx + 1}`,
      type: "WORK",
      label: `Lap ${idx + 1} (${Math.round(lapDist)}m): ${formatFatTime(lapSecs)}`,
      startTimeSecs: Math.round(elapsedSecsCursor),
      durationSecs: Number(lapSecs.toFixed(2)),
      distanceMeters: Math.round(lapDist),
      avgPaceSecsPerKm: lapPaceSecsKm,
      gapPaceSecsPerKm: lapPaceSecsKm,
      avgHr: Math.round((lapStartHr + lapEndHr) / 2),
      maxHr: lapEndHr,
      avgCadence: candidate.eventDistanceMeters <= 1650 ? 196 : 186,
      zone: candidate.eventDistanceMeters <= 1650 ? 6 : 5
    });
    elapsedSecsCursor += lapSecs;
    elapsedDistCursor += lapDist;
  });
  const streams = {
    time: timeStream,
    distance: distanceStream,
    velocitySmooth: velocityStream,
    heartrate: hrStream,
    cadence: cadenceStream
  };
  const avgPaceSecsPerKm = Math.round(candidate.fatTimeSecs / candidate.eventDistanceMeters * 1e3);
  const firstHalfSplits = splits.slice(0, Math.ceil(splits.length / 2));
  const secondHalfSplits = splits.slice(Math.ceil(splits.length / 2));
  const firstHalfAvg = firstHalfSplits.reduce((s, v) => s + v, 0) / Math.max(1, firstHalfSplits.length);
  const secondHalfAvg = secondHalfSplits.length > 0 ? secondHalfSplits.reduce((s, v) => s + v, 0) / secondHalfSplits.length : firstHalfAvg;
  const splitFadePct = Number(((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100).toFixed(1));
  const warmupSecs = candidate.includeWarmupCooldown ? 2100 : 0;
  const z1Secs = candidate.includeWarmupCooldown ? 900 : 0;
  const z2Secs = candidate.includeWarmupCooldown ? 1200 : 0;
  const raceSecs = Math.round(candidate.fatTimeSecs);
  const zoneSecsHr = candidate.eventDistanceMeters <= 1700 ? [z1Secs, z2Secs, 0, Math.round(raceSecs * 0.15), Math.round(raceSecs * 0.35), Math.round(raceSecs * 0.35), Math.round(raceSecs * 0.15)] : [z1Secs, z2Secs, 0, Math.round(raceSecs * 0.3), Math.round(raceSecs * 0.55), Math.round(raceSecs * 0.15), 0];
  const isIndoorTrack = candidate.trackType === "INDOOR_BANKED_200M" || candidate.trackType === "INDOOR_FLAT_200M";
  const subType = candidate.trackType === "XC_COURSE" ? "Cross Country" : candidate.trackType === "ROAD" ? "Road" : "Track";
  const officialRaceData = {
    platform: candidate.platform,
    meetName: candidate.meetName,
    eventLabel: candidate.eventLabel,
    eventDistanceMeters: candidate.eventDistanceMeters,
    fatTimeSecs: candidate.fatTimeSecs,
    displayFatTime: candidate.displayFatTime || formatFatTime(candidate.fatTimeSecs),
    trackType: candidate.trackType,
    placeFinish: candidate.placeFinish,
    windReading: candidate.windReading,
    lapSplitDistanceMeters: splitMeters,
    lapSplitsSecs: splits,
    vdotScore: vdot,
    includeWarmupCooldown: candidate.includeWarmupCooldown,
    sourceUrl: candidate.sourceUrl
  };
  return {
    id: candidate.id || `official-race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    startDateLocal: candidate.startDateLocalIso || `${candidate.date.slice(0, 10)}T10:30:00`,
    name: `${candidate.eventLabel} Official Race (${officialRaceData.displayFatTime}) \u2014 ${candidate.meetName}`,
    sportCategory: "Running",
    environment: isIndoorTrack ? "INDOOR" : "OUTDOOR",
    subType,
    movingTimeSecs: Math.round(candidate.fatTimeSecs) + warmupSecs,
    distanceMeters: candidate.eventDistanceMeters + (candidate.includeWarmupCooldown ? 5600 : 0),
    elevationGainMeters: candidate.trackType === "XC_COURSE" ? 85 : 0,
    trainingLoad,
    avgHr: Math.round(athleteLthr * 1.02),
    maxHr: athleteMaxHr,
    avgCadence: candidate.eventDistanceMeters <= 1650 ? 196 : 186,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    aerobicDecouplingPct: splitFadePct,
    efficiencyFactor: Number((1e3 / avgPaceSecsPerKm * 60 / (athleteLthr * 1.02)).toFixed(2)),
    firstHalfEf: 1.58,
    secondHalfEf: 1.56,
    deviceName: `Watchless FAT Timing (${candidate.platform})`,
    zoneSecs: {
      hr: zoneSecsHr,
      pace: zoneSecsHr
    },
    stravaPrCount: 1,
    segmentEfforts: [],
    intervals,
    streams,
    officialRaceData,
    sourceBadges: [candidate.platform]
  };
}

// src/physiology/teamOnboardingEngine.ts
function getOrgTypeSafeguardingDefaults(orgType) {
  switch (orgType) {
    case "HIGH_SCHOOL":
      return {
        defaultSafeSportShield: true,
        enableParentGuardianCc: true,
        defaultPrimarySport: "Running",
        defaultSquads: ["Varsity", "Junior Varsity", "Frosh/Soph"],
        orgBadgeLabel: "High School \xB7 Safe-Sport Defaults ON"
      };
    case "COLLEGIATE":
      return {
        defaultSafeSportShield: true,
        enableParentGuardianCc: false,
        defaultPrimarySport: "Running",
        defaultSquads: ["Varsity Distance", "Mid-Distance", "Development"],
        orgBadgeLabel: "Collegiate \xB7 NCAA CARA Enabled"
      };
    case "RUNNING_CLUB":
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: "Running",
        defaultSquads: ["Marathon / Roads", "Track Group", "Community"],
        orgBadgeLabel: "Running Club"
      };
    case "CYCLING_CLUB":
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: "Cycling",
        defaultSquads: ["A Group / Race", "B Group / Tempo", "Social / Z2"],
        orgBadgeLabel: "Cycling Team / Club"
      };
    case "COACH_SQUAD":
    default:
      return {
        defaultSafeSportShield: false,
        enableParentGuardianCc: false,
        defaultPrimarySport: "Hybrid",
        defaultSquads: ["Squad A", "Squad B", "1-on-1 Coached"],
        orgBadgeLabel: "Coaching Squad"
      };
  }
}
function normalizeHexColor(input, fallback = "#1C5436") {
  const clean = String(input || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean.split("").map((c) => c + c).join("").toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toUpperCase()}`;
  }
  return fallback;
}
function hexToRgb(hex) {
  const norm = normalizeHexColor(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return [r, g, b];
}
function rgbToHex(r, g, b) {
  const clamp3 = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp3(r), clamp3(g), clamp3(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToRgb(h, s, l) {
  const hn = (h % 360 + 360) % 360 / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  if (sn === 0) {
    const v = ln * 255;
    return [v, v, v];
  }
  const hue2rgb = (p2, q2, t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p2 + (q2 - p2) * 6 * tn;
    if (tn < 1 / 2) return q2;
    if (tn < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - tn) * 6;
    return p2;
  };
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    hue2rgb(p, q, hn + 1 / 3) * 255,
    hue2rgb(p, q, hn) * 255,
    hue2rgb(p, q, hn - 1 / 3) * 255
  ];
}
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function ensureContrastAgainstSurface(hex, surfaceHex, minRatio = 4.55) {
  const clean = normalizeHexColor(hex);
  if (contrastRatio(clean, surfaceHex) >= minRatio) return clean;
  const surfaceLum = relativeLuminance(surfaceHex);
  const [r, g, b] = hexToRgb(clean);
  const [h, s, startL] = rgbToHsl(r, g, b);
  const darken = surfaceLum > 0.5;
  let curL = startL;
  for (let i = 0; i < 45; i++) {
    curL = darken ? Math.max(8, curL - 2) : Math.min(92, curL + 2);
    const [nr, ng, nb] = hslToRgb(h, Math.max(s, 35), curL);
    const candidate = rgbToHex(nr, ng, nb);
    if (contrastRatio(candidate, surfaceHex) >= minRatio) {
      return candidate;
    }
  }
  return darken ? "#14532D" : "#A3E635";
}
function selectButtonInk(bgHex) {
  const whiteCr = contrastRatio(bgHex, "#FFFFFF");
  const darkCr = contrastRatio(bgHex, "#080A09");
  return darkCr >= whiteCr ? "#080A09" : "#FFFFFF";
}
function computeAccessibleTeamPalette(rawPrimaryHex, rawSecondaryHex) {
  const primaryHex = normalizeHexColor(rawPrimaryHex, "#1C5436");
  const secondaryHex = normalizeHexColor(rawSecondaryHex, "#65A30D");
  let primaryOnLight = ensureContrastAgainstSurface(primaryHex, "#E9EFE9", 4.6);
  primaryOnLight = ensureContrastAgainstSurface(primaryOnLight, "#FFFFFF", 4.65);
  const primaryOnDark = ensureContrastAgainstSurface(primaryHex, "#15231B", 4.65);
  let secondaryOnLight = ensureContrastAgainstSurface(secondaryHex, "#E9EFE9", 4.55);
  secondaryOnLight = ensureContrastAgainstSurface(secondaryOnLight, "#FFFFFF", 4.6);
  const secondaryOnDark = ensureContrastAgainstSurface(
    secondaryHex,
    "#15231B",
    4.6
  );
  const textOnPrimaryLight = selectButtonInk(primaryOnLight);
  const textOnPrimaryDark = selectButtonInk(primaryOnDark);
  return {
    primaryHex,
    secondaryHex,
    primaryOnLight,
    primaryOnDark,
    secondaryOnLight,
    secondaryOnDark,
    textOnPrimaryLight,
    textOnPrimaryDark,
    hairlineGradientLight: `linear-gradient(90deg, ${primaryOnLight} 0%, ${secondaryOnLight} 100%)`,
    hairlineGradientDark: `linear-gradient(90deg, ${primaryOnDark} 0%, ${secondaryOnDark} 100%)`
  };
}
function slugifyTeamName(name) {
  const base = String(name || "team").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return base || "thresh-team";
}
function generateTeamJoinCode(shortName, suffixNum) {
  const prefix = String(shortName || "TEAM").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "TEAM";
  const digits = suffixNum !== void 0 ? String(suffixNum).padStart(2, "0").slice(-2) : String((/* @__PURE__ */ new Date()).getFullYear()).slice(-2);
  return `${prefix}-${digits}`;
}
function splitCsvLine(line, delimiter) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}
function inferNameFromEmail(email) {
  const local = email.split("@")[0] || "Athlete";
  return local.replace(/[._-]+/g, " ").replace(/\d+/g, "").trim().split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "Team Athlete";
}
function normalizePhoneDisplay(raw) {
  const cleaned = raw.trim();
  const digits = cleaned.replace(/[^\d+]/g, "");
  const onlyDigits = digits.replace(/\D/g, "");
  if (onlyDigits.length < 10 || onlyDigits.length > 15) return void 0;
  if (digits.startsWith("+")) return digits;
  if (onlyDigits.length === 10) return `+1${onlyDigits}`;
  if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) return `+${onlyDigits}`;
  return `+${onlyDigits}`;
}
function parseBulkRosterCsvOrText(rawText, orgType = "HIGH_SCHOOL", defaultSquad = "Varsity") {
  const lines = String(rawText || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const firstLine = lines[0];
  const delimiter = firstLine.includes("	") ? "	" : firstLine.includes(",") ? "," : firstLine.includes(";") ? ";" : ",";
  const firstCols = splitCsvLine(firstLine, delimiter).map(
    (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  const hasHeader = firstCols.length >= 2 && firstCols.some(
    (c) => [
      "name",
      "athletename",
      "fullname",
      "first",
      "firstname",
      "email",
      "athleteemail",
      "phone",
      "mobile",
      "squad",
      "group",
      "pod",
      "parentemail",
      "guardianemail"
    ].includes(c)
  );
  const colMap = {
    name: -1,
    firstName: -1,
    lastName: -1,
    email: -1,
    phone: -1,
    squad: -1,
    gradYear: -1,
    parentEmail: -1,
    seed: -1
  };
  if (hasHeader) {
    firstCols.forEach((col, idx) => {
      if (["name", "athletename", "fullname", "student", "athlete"].includes(col)) {
        colMap.name = idx;
      } else if (["first", "firstname", "fname"].includes(col)) {
        colMap.firstName = idx;
      } else if (["last", "lastname", "lname"].includes(col)) {
        colMap.lastName = idx;
      } else if (["email", "athleteemail", "studentemail", "mail"].includes(col)) {
        colMap.email = idx;
      } else if (["phone", "mobile", "cell", "cellphone", "phonenumber", "sms"].includes(col)) {
        colMap.phone = idx;
      } else if (["squad", "group", "pod", "level", "division", "team"].includes(col)) {
        colMap.squad = idx;
      } else if (["gradyear", "class", "classyear", "year", "grad"].includes(col)) {
        colMap.gradYear = idx;
      } else if ([
        "parentemail",
        "guardianemail",
        "parent",
        "guardian",
        "parentcc",
        "momemail",
        "dademail"
      ].includes(col)) {
        colMap.parentEmail = idx;
      } else if (["seed", "pr", "seedmark", "ftp", "5k", "1600m", "mile", "mark"].includes(col)) {
        colMap.seed = idx;
      }
    });
  }
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const rows = [];
  for (const line of dataLines) {
    const angleMatch = line.match(/^([^<,]+)<([^>]+@[^>]+)>$/);
    if (angleMatch && !hasHeader) {
      const invitedEmail2 = angleMatch[2].trim().toLowerCase();
      const invitedName2 = angleMatch[1].trim() || inferNameFromEmail(invitedEmail2);
      rows.push({
        invitedName: invitedName2,
        invitedEmail: invitedEmail2,
        squadGroup: defaultSquad,
        isMinorU18: orgType === "HIGH_SCHOOL"
      });
      continue;
    }
    const cols = splitCsvLine(line, delimiter);
    if (cols.every((c) => !c)) continue;
    let invitedName = "";
    let invitedEmail;
    let invitedPhone;
    let squadGroup = defaultSquad;
    let graduationYear;
    let parentGuardianEmail;
    let seedMarkOrFtp;
    if (hasHeader) {
      if (colMap.name >= 0) {
        invitedName = cols[colMap.name] || "";
      } else if (colMap.firstName >= 0 || colMap.lastName >= 0) {
        invitedName = [
          colMap.firstName >= 0 ? cols[colMap.firstName] : "",
          colMap.lastName >= 0 ? cols[colMap.lastName] : ""
        ].filter(Boolean).join(" ");
      }
      if (colMap.email >= 0 && cols[colMap.email]?.includes("@")) {
        invitedEmail = cols[colMap.email].trim().toLowerCase();
      }
      if (colMap.phone >= 0 && cols[colMap.phone]) {
        invitedPhone = normalizePhoneDisplay(cols[colMap.phone]);
      }
      if (colMap.squad >= 0 && cols[colMap.squad]) {
        squadGroup = cols[colMap.squad].trim();
      }
      if (colMap.gradYear >= 0 && cols[colMap.gradYear]) {
        const yr = parseInt(cols[colMap.gradYear].replace(/\D/g, ""), 10);
        if (yr >= 20 && yr <= 99) graduationYear = 2e3 + yr;
        else if (yr >= 2020 && yr <= 2045) graduationYear = yr;
      }
      if (colMap.parentEmail >= 0 && cols[colMap.parentEmail]?.includes("@")) {
        parentGuardianEmail = cols[colMap.parentEmail].trim().toLowerCase();
      }
      if (colMap.seed >= 0 && cols[colMap.seed]) {
        seedMarkOrFtp = cols[colMap.seed].trim();
      }
    } else {
      const emailsFound = [];
      for (const cell of cols) {
        const trimmed = cell.trim();
        if (!trimmed) continue;
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          emailsFound.push(trimmed.toLowerCase());
        } else if (!invitedPhone && normalizePhoneDisplay(trimmed) && /\d{3}.*\d{4}/.test(trimmed)) {
          invitedPhone = normalizePhoneDisplay(trimmed);
        } else if (!graduationYear && /^(202[4-9]|203[0-6])$/.test(trimmed)) {
          graduationYear = Number(trimmed);
        } else if (!seedMarkOrFtp && (/^\d{1,2}:\d{2}(\.\d+)?/.test(trimmed) || /^\d{2,3}\s*w$/i.test(trimmed))) {
          seedMarkOrFtp = trimmed;
        } else if (!invitedName) {
          invitedName = trimmed;
        } else if (squadGroup === defaultSquad) {
          squadGroup = trimmed;
        }
      }
      if (emailsFound[0]) invitedEmail = emailsFound[0];
      if (emailsFound[1]) parentGuardianEmail = emailsFound[1];
    }
    if (!invitedName && invitedEmail) {
      invitedName = inferNameFromEmail(invitedEmail);
    }
    if (!invitedName && !invitedEmail && !invitedPhone) continue;
    const isMinorU18 = orgType === "HIGH_SCHOOL" || Boolean(parentGuardianEmail) || Boolean(graduationYear && orgType !== "COLLEGIATE" && graduationYear >= currentYear + 1);
    rows.push({
      invitedName: invitedName || "Team Athlete",
      invitedEmail,
      invitedPhone,
      squadGroup: squadGroup || defaultSquad,
      graduationYear,
      parentGuardianEmail,
      seedMarkOrFtp,
      isMinorU18
    });
  }
  return rows;
}
function parseClockSecs(clock) {
  const parts = clock.trim().split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
function formatPaceDisplay(secsPerKm, unit) {
  const targetSecs = unit === "mi" ? secsPerKm * 1.60934 : secsPerKm;
  const m = Math.floor(targetSecs / 60);
  const s = Math.round(targetSecs % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}
function calibrateThresholdsFromSeedMark(seedInput, primarySport = "Running", distanceUnit = "mi") {
  const raw = String(seedInput || "").trim();
  const defaultPaceSecsKm = 270;
  const defaultFtp = 240;
  if (!raw) {
    return {
      cyclingFtpWatts: defaultFtp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      easyPaceInputDisplay: formatPaceDisplay(Math.round(defaultPaceSecsKm * 1.24), distanceUnit),
      intervalPaceInputDisplay: formatPaceDisplay(Math.round(defaultPaceSecsKm * 0.91), distanceUnit),
      summaryNote: "Default starter zones (auto-refines on first Strava / Garmin / FIT sync)"
    };
  }
  const twentyMinMatch = raw.match(/20\s*m(?:in(?:ute)?s?)?\s*[:@-]?\s*(\d{2,3})\s*w?/i) || raw.match(/(\d{2,3})\s*w(?:atts)?\s*(?:for\s*|@\s*|\(\s*|-)?\s*20\s*m(?:in)?/i);
  if (twentyMinMatch) {
    const rawWatts = Number(twentyMinMatch[1]);
    const ftp = Math.max(90, Math.min(550, Math.round(rawWatts * 0.95)));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Estimated ${ftp}W FTP from 20-minute power (${rawWatts}W \xD7 0.95)`
    };
  }
  const wattsMatch = raw.match(/(\d{2,3})\s*w(?:atts)?\b/i) || (primarySport !== "Running" && /^\d{2,3}$/.test(raw) ? [raw, raw] : null);
  if (wattsMatch) {
    const ftp = Math.max(85, Math.min(550, Math.round(Number(wattsMatch[1]))));
    return {
      cyclingFtpWatts: ftp,
      thresholdPaceSecsPerKm: defaultPaceSecsKm,
      thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
      summaryNote: `Calibrated to ${ftp}W Cycling FTP`
    };
  }
  const clockMatch = raw.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/);
  if (clockMatch) {
    const totalSecs = parseClockSecs(clockMatch[1]);
    if (totalSecs && totalSecs >= 90) {
      let distMeters = 5e3;
      const lower = raw.toLowerCase();
      if (/\b800\s*m?\b/.test(lower)) distMeters = 800;
      else if (/\b1500\s*m?\b/.test(lower)) distMeters = 1500;
      else if (/\b1600\s*m?\b/.test(lower)) distMeters = 1600;
      else if (lower.includes("mile") && !lower.includes("2 mile") && !lower.includes("two mile")) {
        distMeters = 1609.34;
      } else if (/\b3000\s*m?\b|\b3k\b/.test(lower)) distMeters = 3e3;
      else if (/\b3200\s*m?\b|2\s*mile|two\s*mile/.test(lower)) distMeters = 3200;
      else if (/\b5k\b|\b5000\s*m?\b/.test(lower)) distMeters = 5e3;
      else if (/\b10k\b|\b10000\s*m?\b/.test(lower)) distMeters = 1e4;
      else if (lower.includes("half") || /\bhm\b/.test(lower)) distMeters = 21097.5;
      else if (lower.includes("marathon")) distMeters = 42195;
      else if (totalSecs < 165) distMeters = 800;
      else if (totalSecs < 450) distMeters = 1600;
      else if (totalSecs < 810) distMeters = 3200;
      else distMeters = 5e3;
      const profile = buildTrackSpeedReserveProfile({
        marks: [{ distanceMeters: distMeters, durationSecs: totalSecs }]
      });
      const vdot = Math.max(24, Math.min(90, Number(profile.vdotAer.toFixed(1))));
      const ltSecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.88, [115, 520]));
      const easySecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.7, [145, 560]));
      const intervalSecsPerKm = Math.round(solveTrackPaceSecsPerKmForPctVdot(vdot, 0.98, [115, 480]));
      const disp = formatPaceDisplay(ltSecsPerKm, distanceUnit);
      const easyDisp = formatPaceDisplay(easySecsPerKm, distanceUnit);
      const intDisp = formatPaceDisplay(intervalSecsPerKm, distanceUnit);
      const eventLabel = distMeters === 1609.34 ? "Mile" : distMeters === 21097.5 ? "Half Marathon" : distMeters === 42195 ? "Marathon" : `${Math.round(distMeters)}m`;
      return {
        cyclingFtpWatts: defaultFtp,
        thresholdPaceSecsPerKm: ltSecsPerKm,
        thresholdPaceInputDisplay: disp,
        easyPaceInputDisplay: easyDisp,
        intervalPaceInputDisplay: intDisp,
        vdotEstimate: vdot,
        summaryNote: `VDOT ${vdot} \xB7 Easy ${easyDisp}/${distanceUnit} \xB7 Threshold ${disp}/${distanceUnit} \xB7 VO2 ${intDisp}/${distanceUnit} (from ${clockMatch[1]} ${eventLabel})`
      };
    }
  }
  return {
    cyclingFtpWatts: defaultFtp,
    thresholdPaceSecsPerKm: defaultPaceSecsKm,
    thresholdPaceInputDisplay: formatPaceDisplay(defaultPaceSecsKm, distanceUnit),
    summaryNote: "Starter zones ready"
  };
}
function inferEventGroupFromSeedMark(seed) {
  if (!seed || !seed.trim()) return void 0;
  const s = seed.trim();
  if (/\b(?:3000\s*m?|3200\s*m?|5000\s*m?|5\s*k|10000\s*m?|10\s*k|2\s*miles?|2\s*mi|xc)\b/i.test(s)) {
    return "DISTANCE";
  }
  if (/\b(?:800\s*m?|1500\s*m?|1600\s*m?|1\s*mile|mile)\b/i.test(s)) {
    return "MID_DISTANCE";
  }
  if (/\b(?:100\s*m?|200\s*m?|400\s*m?|hurdles?|dash|sprint)\b/i.test(s)) {
    return "SPRINTS";
  }
  return void 0;
}

// src/utils/athleticNetAndTfrrsEngine.ts
var ICONIC_COURSE_PATTERNS = [
  { pattern: /crystal\s*springs/i, distanceMeters: 4748, eventLabel: "2.95 mi XC (Crystal Springs)" },
  { pattern: /montgomery\s*hill/i, distanceMeters: 4410, eventLabel: "2.74 mi XC (Montgomery Hill)" },
  { pattern: /toro\s*park/i, distanceMeters: 4828, eventLabel: "3.0 mi XC (Toro Park)" },
  { pattern: /mt\.?\s*sac/i, distanceMeters: 4715, eventLabel: "2.93 mi XC (Mt. SAC)" },
  { pattern: /woodward\s*park/i, distanceMeters: 5e3, eventLabel: "XC 5K (Woodward Park)" },
  { pattern: /baylands/i, distanceMeters: 5e3, eventLabel: "XC 5K (Baylands)" },
  { pattern: /hellyer/i, distanceMeters: 4828, eventLabel: "3.0 mi XC (Hellyer)" },
  { pattern: /half\s*moon\s*bay/i, distanceMeters: 3862, eventLabel: "2.4 mi XC (Half Moon Bay)" },
  { pattern: /central\s*park|lynnbrook|fremont\s*high/i, distanceMeters: 3380, eventLabel: "2.1 mi XC" }
];
function normalizeWebcalUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  if (/^webcals:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcals:\/\//i, "https://");
  }
  if (/^webcal:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcal:\/\//i, "https://");
  }
  return trimmed;
}
function normalizeAthleticSportSlug(rawSegment) {
  const s = (rawSegment || "").toLowerCase();
  if (s.includes("indoor")) return "track-and-field-indoor";
  if (s.includes("track") || s.includes("tf")) return "track-and-field-outdoor";
  return "xc";
}
function titleCaseSlug(slug) {
  return slug.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean).map((w) => {
    if (w.toLowerCase() === "st") return "St.";
    if (w.length <= 2 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}
function parseExternalTeamUrl(rawUrl) {
  const cleaned = String(rawUrl || "").trim();
  if (!cleaned) return null;
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "athletic.net" || host.endsWith(".athletic.net")) {
    const modernMatch = parsed.pathname.match(
      /^\/(?:photos\/)?team\/(\d{2,10})(?:\/([a-z0-9-]+))?/i
    );
    const schoolIdParam = parsed.searchParams.get("SchoolID");
    const schoolId = modernMatch?.[1] || (schoolIdParam && /^\d{2,10}$/.test(schoolIdParam) ? schoolIdParam : "");
    if (!schoolId) return null;
    const legacySport = /trackandfield/i.test(parsed.pathname) ? "track-and-field-outdoor" : "xc";
    const sportSlug = normalizeAthleticSportSlug(modernMatch?.[2] || legacySport);
    const canonicalUrl = `https://www.athletic.net/team/${schoolId}/${sportSlug}`;
    const knownSchoolName = schoolId === "1073" ? "Willow Glen High School" : void 0;
    return {
      platform: "ATHLETIC_NET",
      canonicalUrl,
      athleticNetSchoolId: schoolId,
      athleticNetSportSlug: sportSlug,
      orgTypeHint: "HIGH_SCHOOL",
      ...knownSchoolName ? { inferredTeamName: knownSchoolName } : {}
    };
  }
  if (host === "tfrrs.org" || host.endsWith(".tfrrs.org")) {
    const teamMatch = parsed.pathname.match(
      /^\/teams\/(?:(xc|tf)\/)?([A-Za-z0-9_-]+?)(?:\.html?)?$/i
    );
    const tfrrsCode = teamMatch?.[2] || parsed.pathname.replace(/[^A-Za-z0-9_-]/g, "");
    const codeParts = tfrrsCode.split("_");
    const genderRaw = (codeParts[2] || "").toLowerCase();
    const genderHint = genderRaw === "m" ? "M" : genderRaw === "f" ? "F" : void 0;
    const slugName = codeParts.length >= 4 ? titleCaseSlug(codeParts.slice(3).join(" ")) : void 0;
    const isCollege = tfrrsCode.toLowerCase().includes("_college_");
    return {
      platform: "TFRRS",
      canonicalUrl: parsed.toString(),
      tfrrsTeamCode: tfrrsCode || void 0,
      genderHint,
      orgTypeHint: isCollege ? "COLLEGIATE" : "HIGH_SCHOOL",
      ...slugName ? { inferredTeamName: slugName } : {}
    };
  }
  return null;
}
function resolveRaceEventDistance(rawText, fallbackMeters = 5e3) {
  const s = String(rawText || "").trim();
  const isIndoor = /\bindoor\b|200m\s*banked|flat\s*200/i.test(s);
  const trackSurface = isIndoor ? "INDOOR_BANKED_200M" : "OUTDOOR_400M";
  for (const preset of ICONIC_COURSE_PATTERNS) {
    if (preset.pattern.test(s)) {
      return {
        eventLabel: preset.eventLabel,
        distanceMeters: preset.distanceMeters,
        trackType: "XC_COURSE",
        isCrossCountry: true
      };
    }
  }
  const mileMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (mileMatch) {
    const miles = parseFloat(mileMatch[1]);
    if (Number.isFinite(miles) && miles > 0) {
      const meters = Math.round(miles * 1609.344);
      if (Math.abs(miles - 1) < 0.02 && !/\bxc\b|cross\s*country/i.test(s)) {
        return { eventLabel: "1 Mile", distanceMeters: 1609, trackType: trackSurface, isCrossCountry: false };
      }
      if (Math.abs(miles - 2) < 0.03 && /\btrack\b|outdoor|indoor/i.test(s)) {
        return { eventLabel: "2 Mile", distanceMeters: 3219, trackType: trackSurface, isCrossCountry: false };
      }
      const isXc = /\bxc\b|cross|invitational|opener|classic|park|hill|springs|league|bval|ccs/i.test(s) || miles >= 1.9;
      return {
        eventLabel: isXc ? `${miles.toFixed(miles % 1 === 0 ? 1 : 2)} mi XC` : `${miles} mi`,
        distanceMeters: meters,
        trackType: isXc ? "XC_COURSE" : "ROAD",
        isCrossCountry: isXc
      };
    }
  }
  const kMatch = s.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const km = parseFloat(kMatch[1]);
    if (Number.isFinite(km) && km > 0) {
      const meters = Math.round(km * 1e3);
      const isXc = !/\broad\b|\btrack\b/i.test(s);
      return {
        eventLabel: isXc ? `XC ${km}K` : `Road ${km}K`,
        distanceMeters: meters,
        trackType: isXc ? "XC_COURSE" : "ROAD",
        isCrossCountry: isXc
      };
    }
  }
  const meterMatch = s.match(/(\d{3,5}(?:,\d{3})?)\s*m(?:eters?)?\b/i);
  if (meterMatch) {
    const meters = parseInt(meterMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(meters) && meters >= 60) {
      const isXc = /\bxc\b|cross\s*country|varsity|frosh|jv\b/i.test(s) && meters >= 3e3;
      const eventLabel = isXc && meters === 5e3 ? "XC 5K" : `${meters}m`;
      return {
        eventLabel,
        distanceMeters: meters,
        trackType: isXc ? "XC_COURSE" : trackSurface,
        isCrossCountry: isXc
      };
    }
  }
  const isFallbackXc = fallbackMeters >= 3e3;
  return {
    eventLabel: isFallbackXc ? fallbackMeters === 4748 ? "2.95 mi XC" : fallbackMeters === 4410 ? "2.74 mi XC" : `XC ${(fallbackMeters / 1e3).toFixed(fallbackMeters % 1e3 === 0 ? 0 : 1)}K` : `${fallbackMeters}m`,
    distanceMeters: fallbackMeters,
    trackType: isFallbackXc ? "XC_COURSE" : trackSurface,
    isCrossCountry: isFallbackXc
  };
}
function unescapeIcsValue(val) {
  return val.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
function parseIcsDateAndTime(rawValue) {
  const clean = rawValue.trim();
  const dateOnly = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}` };
  }
  const dateTimeMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (dateTimeMatch) {
    return {
      date: `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`,
      scheduledTime: `${dateTimeMatch[4]}:${dateTimeMatch[5]}`
    };
  }
  return null;
}
function inferVenueCategoryFromMeetText(text) {
  if (/track|oval|stadium|relay|twilight|invite.*1600/i.test(text)) return "TRACK";
  if (/road|half\s*marathon|10k\s*road|turkey\s*trot/i.test(text)) return "ROAD_CAMPUS";
  return "XC_COURSE";
}
function parseIcsCalendarToMeets(icsText, externalSource = "ATHLETIC_NET") {
  const unfolded = String(icsText || "").replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const meets = [];
  let inEvent = false;
  let summary = "";
  let dtstart = "";
  let location = "";
  let description = "";
  const flushEvent = () => {
    if (!summary || !dtstart) return;
    const parsedDt = parseIcsDateAndTime(dtstart);
    if (!parsedDt) return;
    const dist = resolveRaceEventDistance(`${summary} ${location} ${description}`, 5e3);
    meets.push({
      date: parsedDt.date,
      name: summary.slice(0, 100),
      ...location ? { locationName: location.slice(0, 120) } : {},
      locationCategory: inferVenueCategoryFromMeetText(`${summary} ${location}`),
      ...parsedDt.scheduledTime ? { scheduledTime: parsedDt.scheduledTime } : {},
      distanceMeters: dist.distanceMeters,
      ...description ? { description: description.slice(0, 260) } : {},
      externalSource
    });
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      summary = "";
      dtstart = "";
      location = "";
      description = "";
      continue;
    }
    if (line === "END:VEVENT") {
      flushEvent();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const rawKey = line.slice(0, colonIdx).split(";")[0].toUpperCase();
    const rawVal = unescapeIcsValue(line.slice(colonIdx + 1));
    if (rawKey === "SUMMARY") summary = rawVal;
    else if (rawKey === "DTSTART") dtstart = rawVal;
    else if (rawKey === "LOCATION") location = rawVal;
    else if (rawKey === "DESCRIPTION") description = rawVal;
  }
  return meets.sort((a, b) => a.date.localeCompare(b.date));
}
function normalizeAthleteMatchKey(name) {
  const s = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const commaParts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const reordered = commaParts.length === 2 ? `${commaParts[1]} ${commaParts[0]}` : s;
  return reordered.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// src/utils/workoutScheduleUtils.ts
function sanitizeScheduledTime(raw) {
  if (typeof raw !== "string") return void 0;
  const trimmed = raw.trim();
  const m = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return void 0;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}
function sanitizeSessionSlot(raw) {
  if (raw === "AM" || raw === "PM" || raw === "SINGLE") return raw;
  return void 0;
}
function sanitizePracticeVenueCategory(raw) {
  if (raw === "TRACK" || raw === "XC_COURSE" || raw === "ROAD_CAMPUS" || raw === "GYM_WEIGHTS" || raw === "POOL_CROSS" || raw === "OTHER") {
    return raw;
  }
  return void 0;
}

// server/teamService.ts
function canProgramWorkoutsRole(role) {
  return role === "HEAD_COACH" || role === "ASSISTANT_COACH";
}
function canViewSafeguardingMedicalRole(role) {
  return role === "HEAD_COACH" || role === "ASSISTANT_COACH" || role === "ATHLETIC_TRAINER" || role === "ORG_ADMIN";
}
function canViewAuditLogRole(role) {
  return role === "HEAD_COACH" || role === "ORG_ADMIN";
}
function maskEmailForDisplay(email) {
  const clean = String(email || "").trim().toLowerCase();
  const atIdx = clean.indexOf("@");
  if (atIdx <= 0) return void 0;
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}
function sanitizeExternalSyncConfig(raw, existing) {
  if (!raw && !existing) return void 0;
  const merged = { ...existing || {}, ...raw || {} };
  const cleanUrl = (v) => {
    if (!v) return void 0;
    const s = String(v).trim().slice(0, 300);
    return /^https?:\/\//i.test(s) || /^webcals?:\/\//i.test(s) ? s : void 0;
  };
  return {
    ...merged.platform === "ATHLETIC_NET" || merged.platform === "TFRRS" ? { platform: merged.platform } : {},
    ...merged.athleticNetSchoolId ? { athleticNetSchoolId: String(merged.athleticNetSchoolId).replace(/[^0-9]/g, "").slice(0, 12) } : {},
    ...merged.athleticNetSportSlug === "xc" || merged.athleticNetSportSlug === "track-and-field-outdoor" || merged.athleticNetSportSlug === "track-and-field-indoor" ? { athleticNetSportSlug: merged.athleticNetSportSlug } : {},
    ...cleanUrl(merged.athleticNetUrl) ? { athleticNetUrl: cleanUrl(merged.athleticNetUrl) } : {},
    ...cleanUrl(merged.tfrrsTeamUrl) ? { tfrrsTeamUrl: cleanUrl(merged.tfrrsTeamUrl) } : {},
    ...merged.tfrrsTeamCode ? { tfrrsTeamCode: String(merged.tfrrsTeamCode).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) } : {},
    ...merged.teamFilterKeyword ? { teamFilterKeyword: String(merged.teamFilterKeyword).trim().slice(0, 64) } : {},
    ...cleanUrl(merged.icsCalendarUrl) ? { icsCalendarUrl: cleanUrl(merged.icsCalendarUrl) } : {},
    enablePublicParentHub: typeof merged.enablePublicParentHub === "boolean" ? merged.enablePublicParentHub : false,
    ...merged.lastSyncedAt ? { lastSyncedAt: String(merged.lastSyncedAt).slice(0, 40) } : {}
  };
}
async function loadTeamDocRaw(teamId) {
  return loadTenantVaultAsync(teamDocVaultKey(teamId), null);
}
async function saveTeamDocRaw(teamId, doc) {
  await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
  await syncNormalizedTeamPostgresAsync(
    teamId,
    {
      slug: doc.brand.slug,
      joinCode: doc.brand.joinCode,
      orgType: doc.brand.orgType
    },
    doc,
    (doc.memberships || []).map((m) => ({
      membershipId: m.membershipId,
      userSid: m.userSid,
      invitedEmail: m.invitedEmail,
      role: m.role,
      status: m.status
    }))
  );
}
var TEAMS_DIRECTORY_KEY = "teams_index_v1";
var EMAIL_DIRECTORY_KEY = "users_email_idx_v1";
function teamDocVaultKey(teamId) {
  return `team_doc_${teamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`;
}
function userTeamsVaultKey(sid) {
  return `user_teams_${sid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`;
}
function emailOtpVaultKey(email) {
  const hash = crypto6.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
  return `email_otp_${hash}`;
}
function hashToken(rawToken) {
  return crypto6.createHash("sha256").update(rawToken.trim()).digest("hex");
}
function isResendConfigured() {
  return Boolean((process.env.RESEND_API_KEY || "").trim());
}
async function sendEmailViaResend(params) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return {
      delivered: false,
      status: "READY_MANUAL_LINK"
    };
  }
  const fromAddress = (process.env.RESEND_FROM_EMAIL || "THRESH Coaching <onboarding@resend.dev>").trim();
  try {
    const payload = {
      from: fromAddress,
      to: [params.to.trim()],
      subject: params.subject,
      html: params.html,
      text: params.text
    };
    if (params.cc && params.cc.includes("@")) {
      payload.cc = [params.cc.trim()];
    }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return {
        delivered: false,
        status: "FAILED",
        error: `Resend HTTP ${resp.status}: ${errBody.slice(0, 180)}`
      };
    }
    const data = await resp.json().catch(() => ({}));
    return {
      delivered: true,
      status: "SENT_RESEND",
      messageId: data.id
    };
  } catch (err) {
    return {
      delivered: false,
      status: "FAILED",
      error: err instanceof Error ? err.message : "Network error contacting Resend API"
    };
  }
}
function buildTeamInviteEmailContent(params) {
  const { brand, invitedName, squadGroup, magicJoinUrl, hasParentCc, seedMarkOrFtp } = params;
  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const firstName = invitedName.trim().split(/\s+/)[0] || "Athlete";
  const safeFirstName = escapeHtml(firstName);
  const safeTeamName = escapeHtml(brand.name);
  const safeShortName = escapeHtml(brand.shortName || brand.name);
  const safeCoach = escapeHtml(brand.coachDisplayName);
  const safeSquad = escapeHtml(squadGroup || "Roster");
  const safeCode = escapeHtml(brand.joinCode);
  const safeUrl = escapeHtml(magicJoinUrl);
  const safeSeed = seedMarkOrFtp ? escapeHtml(seedMarkOrFtp) : "";
  const subject = `Coach ${brand.coachDisplayName} invited ${firstName} to join ${brand.name} on THRESH`;
  const safeSportSection = brand.defaultSafeSportShield || hasParentCc ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-size:13px;line-height:1.5;">
          <strong>Scholastic &amp; Safe-Sport Protections Enabled:</strong>
          <ul style="margin:6px 0 0;padding-left:18px;">
            <li>Body weight &amp; W/kg metrics are masked by default to support healthy youth development.</li>
            <li>No paid GPS watch required \u2014 athletes can calibrate zones from a single track/XC race mark or upload <code>.FIT</code> files.</li>
            ${hasParentCc ? "<li>A parent/guardian was transparently CC&apos;d on this roster invitation by the coaching staff.</li>" : ""}
          </ul>
        </div>` : "";
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#F7F6F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111318;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:20px;overflow:hidden;border:1px solid #E5E7EB;">
    <div style="background:linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%);padding:24px 28px;color:#FFFFFF;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.9;">${safeShortName} \xD7 THRESH</div>
      <h1 style="margin:6px 0 2px;font-size:22px;font-weight:800;letter-spacing:-0.02em;">${safeTeamName}</h1>
      <div style="font-size:13px;opacity:0.92;">Coach ${safeCoach} \xB7 ${safeSquad}</div>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi <strong>${safeFirstName}</strong>,</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#374151;">
        Coach <strong>${safeCoach}</strong> added you to <strong>${safeTeamName}</strong> (${safeSquad}) on THRESH for daily training readiness, workout pacing pods, and post-workout performance analysis. Sign in with your free Strava account in one tap to claim your roster spot and choose what training summary you share.
        ${safeSeed ? `<br/><span style="color:#065F46;font-size:13px;">Your initial zones are pre-seeded from <strong>${safeSeed}</strong>.</span>` : ""}
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;padding:14px 26px;border-radius:12px;background:${palette.primaryOnLight};color:${palette.textOnPrimaryLight};text-decoration:none;font-weight:700;font-size:15px;">
          Sign In With Strava &amp; Join ${safeShortName} &rarr;
        </a>
      </div>
      <div style="padding:12px 16px;border-radius:12px;background:#F3F4F6;text-align:center;font-size:13px;color:#4B5563;">
        Or enter Team Join Code: <strong style="font-family:monospace;font-size:16px;color:#111318;letter-spacing:0.06em;">${safeCode}</strong>
      </div>
      ${safeSportSection}
    </div>
  </div>
</body>
</html>`;
  const text = [
    `Hi ${firstName},`,
    ``,
    `Coach ${brand.coachDisplayName} invited you to join ${brand.name} (${squadGroup}) on THRESH.`,
    `Tap your personalized link to sign in with Strava and join in 45 seconds: ${magicJoinUrl}`,
    `Team Join Code: ${brand.joinCode}`,
    brand.defaultSafeSportShield ? `Safe-Sport Protection: Body weight & W/kg are hidden by default.` : ``
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}
function buildParentConsentEmailContent(params) {
  const { brand, athleteName, parentConsentUrl } = params;
  const subject = `Notice: ${athleteName} joined ${brand.name} on THRESH (Scholastic Safeguards Active)`;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111318;background:#F4F6F3;margin:0;padding:24px 12px;">
  <div style="max-width:540px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="background:${brand.primaryHex};padding:24px;color:#FFFFFF;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">THRESH SCHOLASTIC SAFEGUARDING</div>
      <h1 style="margin:8px 0 4px;font-size:20px;font-weight:800;color:#FFFFFF;">Parent / Guardian Notice</h1>
      <div style="font-size:14px;opacity:0.9;">${escapeHtml(brand.name)} \xB7 Coach ${escapeHtml(brand.coachDisplayName)}</div>
    </div>
    <div style="padding:24px;">
      <p style="font-size:15px;margin:0 0 16px;">Hello,</p>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;">
        <strong>${escapeHtml(athleteName)}</strong> has joined the <strong>${escapeHtml(brand.name)}</strong> roster on THRESH for athletic training and workout tracking under Coach ${escapeHtml(brand.coachDisplayName)}.
      </p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:0 0 20px;">
        <div style="font-size:12px;font-weight:700;color:#0F172A;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Active Safeguards & Youth Privacy (COPPA & Safe Sport)</div>
        <ul style="font-size:13px;color:#475569;margin:0;padding-left:18px;line-height:1.6;">
          <li><strong>Safe-Sport Weight Shield Active:</strong> Body weight and power-to-weight ratios are strictly hidden to prevent disordered eating and RED-S syndrome.</li>
          <li><strong>Clean-Room Data Firewall:</strong> Training logs (distance, pace, heart rate) are shared only with certified team coaches. Zero advertising, zero tracking, and zero data sales to third parties.</li>
          <li><strong>Scholastic Retention:</strong> Roster participation data is maintained strictly for school athletic training and may be reviewed or deleted at any time upon parental request.</li>
        </ul>
      </div>

      <div style="text-align:center;margin:24px 0 16px;">
        <a href="${parentConsentUrl}" style="display:inline-block;background:${brand.primaryHex};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;">
          Acknowledge & Confirm Roster Enrollment
        </a>
      </div>

      <p style="font-size:12px;color:#64748B;text-align:center;margin:0;">
        Or review via browser: <a href="${parentConsentUrl}" style="color:${brand.primaryHex};word-break:break-all;">${parentConsentUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
  const text = [
    `THRESH SCHOLASTIC SAFEGUARDING - Parent / Guardian Notice`,
    ``,
    `Hello,`,
    `${athleteName} has joined ${brand.name} on THRESH for athletic training under Coach ${brand.coachDisplayName}.`,
    ``,
    `Active Safeguards:`,
    `- Safe-Sport Weight Shield: Body weight is hidden to prevent RED-S and disordered eating.`,
    `- Clean-Room Firewall: Activity data is private to team coaches; zero ad tracking, zero data sales.`,
    ``,
    `Please acknowledge your athlete's enrollment here:`,
    parentConsentUrl
  ].join("\n");
  return { subject, html, text };
}
async function requestEmailOtpCode(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, deliveryStatus: "FAILED", error: "Enter a valid email address." };
  }
  const code = String(crypto6.randomInt(1e5, 999999));
  const record = {
    email,
    codeHash: hashToken(`${email}:${code}`),
    expiresAt: Date.now() + 10 * 60 * 1e3,
    attempts: 0
  };
  await saveTenantVaultAsync(emailOtpVaultKey(email), record);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:460px;margin:0 auto;padding:24px;border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#14532D;text-transform:uppercase;">THRESH CROSS-DEVICE SIGN-IN</div>
    <h2 style="margin:8px 0 12px;color:#111318;">Your 6-Digit Verification Code</h2>
    <div style="font-family:monospace;font-size:32px;font-weight:800;letter-spacing:0.16em;padding:14px 20px;background:#F3F4F6;border-radius:12px;text-align:center;color:#111318;">${escapeHtml(code)}</div>
    <p style="font-size:13px;color:#4B5563;margin-top:14px;">Expires in 10 minutes. Enter this code in THRESH to sync your teams and athlete profile across devices.</p>
  </div>`;
  const res = await sendEmailViaResend({
    to: email,
    subject: `${code} is your THRESH sign-in code`,
    html,
    text: `Your THRESH verification code is ${code} (expires in 10 minutes).`
  });
  const isProd = isProductionDeployment();
  if (!res.delivered && isProd) {
    return {
      ok: false,
      deliveryStatus: res.status,
      error: res.error || "Email code delivery is not configured on this server. Please sign in with Strava instead."
    };
  }
  return {
    ok: res.status !== "FAILED",
    deliveryStatus: res.status,
    ...res.status === "READY_MANUAL_LINK" && !isProd ? { devPreviewCode: code } : {},
    ...res.error ? { error: res.error } : {}
  };
}
async function verifyEmailOtpCode(rawEmail, rawCode, preferredSid) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const code = String(rawCode || "").replace(/\D/g, "");
  if (!email || code.length !== 6) {
    return { ok: false, error: "Enter the 6-digit verification code." };
  }
  const key = emailOtpVaultKey(email);
  const stored = await loadTenantVaultAsync(key, null);
  if (!stored || Date.now() > stored.expiresAt) {
    return { ok: false, error: "Verification code expired. Request a fresh code." };
  }
  if (stored.attempts >= 5) {
    return { ok: false, error: "Too many attempts. Request a fresh code." };
  }
  const candidateHash = hashToken(`${email}:${code}`);
  const a = Buffer.from(candidateHash);
  const b = Buffer.from(stored.codeHash);
  if (a.length !== b.length || !crypto6.timingSafeEqual(a, b)) {
    stored.attempts += 1;
    await saveTenantVaultAsync(key, stored);
    return { ok: false, error: "Incorrect 6-digit code." };
  }
  await saveTenantVaultAsync(key, { ...stored, expiresAt: 0 });
  const otpUser = await findOrCreateUser("magic_link", email, {
    email,
    name: email.split("@")[0]
  });
  const canonicalOtpSid = deriveUserSessionSid(otpUser.id);
  const emailDir = await loadTenantVaultAsync(EMAIL_DIRECTORY_KEY, {
    byEmail: {}
  });
  let account = emailDir.byEmail[email];
  if (!account) {
    const newSid = preferredSid && /^[a-f0-9]{24,64}$/i.test(preferredSid) ? preferredSid : canonicalOtpSid;
    account = {
      sid: newSid,
      displayName: otpUser.name,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    emailDir.byEmail[email] = account;
    await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
  }
  const dir = await loadTenantVaultAsync(TEAMS_DIRECTORY_KEY, {
    bySlug: {},
    byJoinCode: {},
    allTeamIds: []
  });
  const userTeams = await loadTenantVaultAsync(
    userTeamsVaultKey(account.sid),
    {
      teamIds: [],
      email,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  );
  userTeams.email = email;
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    let mutated = false;
    for (const m of doc.memberships) {
      if (m.invitedEmail && m.invitedEmail.toLowerCase() === email && m.status !== "REVOKED") {
        m.userSid = account.sid;
        if (m.status !== "ACTIVE") {
          m.status = "ACTIVE";
          m.joinedAt = (/* @__PURE__ */ new Date()).toISOString();
        }
        if (!account.displayName && m.invitedName) {
          account.displayName = m.invitedName;
        }
        if (!userTeams.teamIds.includes(teamId)) {
          userTeams.teamIds.push(teamId);
        }
        mutated = true;
      }
    }
    if (mutated) {
      doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    }
  }
  userTeams.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveTenantVaultAsync(userTeamsVaultKey(account.sid), userTeams);
  emailDir.byEmail[email] = account;
  await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
  return {
    ok: true,
    sid: account.sid,
    email,
    displayName: account.displayName
  };
}
async function loadDirectory() {
  return loadTenantVaultAsync(TEAMS_DIRECTORY_KEY, {
    bySlug: {},
    byJoinCode: {},
    allTeamIds: []
  });
}
async function addTeamToUserIndex(sid, teamId, displayName, email) {
  await withVaultLock(userTeamsVaultKey(sid), async () => {
    const idx = await loadTenantVaultAsync(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!idx.teamIds.includes(teamId)) {
      idx.teamIds.push(teamId);
    }
    if (displayName) idx.displayName = displayName;
    if (email) idx.email = email;
    idx.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTenantVaultAsync(userTeamsVaultKey(sid), idx);
  });
}
async function removeTeamFromUserIndex(sid, teamId) {
  if (!sid) return;
  await withVaultLock(userTeamsVaultKey(sid), async () => {
    const idx = await loadTenantVaultAsync(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (idx.teamIds.includes(teamId)) {
      idx.teamIds = idx.teamIds.filter((id) => id !== teamId);
      idx.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTenantVaultAsync(userTeamsVaultKey(sid), idx);
    }
  });
}
async function updateTeamMemberEmailsForUser(params) {
  const cleanNew = params.newEmail.trim().toLowerCase();
  const cleanOld = params.oldEmail?.trim().toLowerCase();
  if (!cleanNew) return;
  if (cleanOld && cleanOld !== cleanNew) {
    await withVaultLock(EMAIL_DIRECTORY_KEY, async () => {
      const emailDir = await loadTenantVaultAsync(EMAIL_DIRECTORY_KEY, {
        byEmail: {}
      });
      const existingEntry = emailDir.byEmail[cleanOld];
      if (existingEntry) {
        delete emailDir.byEmail[cleanOld];
        emailDir.byEmail[cleanNew] = {
          ...existingEntry,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
      }
    });
  }
  if (params.callerSid) {
    const idx = await loadTenantVaultAsync(userTeamsVaultKey(params.callerSid), {
      teamIds: [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (idx.email !== cleanNew) {
      idx.email = cleanNew;
      idx.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTenantVaultAsync(userTeamsVaultKey(params.callerSid), idx);
    }
    for (const teamId of idx.teamIds) {
      await withVaultLock(teamDocVaultKey(teamId), async () => {
        const doc = await loadTenantVaultAsync(
          teamDocVaultKey(teamId),
          null
        );
        if (!doc) return;
        let changed = false;
        for (const m of doc.memberships) {
          if (m.userSid === params.callerSid && m.status !== "REVOKED") {
            m.invitedEmail = cleanNew;
            changed = true;
          }
        }
        if (changed) {
          doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
        }
      });
    }
  }
}
async function migrateAnonymousTeamsToSid(params) {
  const { oldSid, newSid, athleteName, stravaAthleteId, email } = params;
  if (!oldSid || !newSid || oldSid === newSid) return;
  const oldIdx = await loadTenantVaultAsync(userTeamsVaultKey(oldSid), {
    teamIds: [],
    updatedAt: ""
  });
  if (oldIdx.teamIds.length === 0) return;
  for (const teamId of oldIdx.teamIds) {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    let changed = false;
    for (const m of doc.memberships) {
      if (m.userSid === oldSid && m.status !== "REVOKED") {
        m.userSid = newSid;
        if (stravaAthleteId) m.stravaAthleteId = stravaAthleteId;
        if (email && !m.invitedEmail) m.invitedEmail = email;
        if (athleteName && (!m.invitedName || m.invitedName === "Team Athlete" || m.invitedName.toLowerCase().startsWith("anonymous"))) {
          m.invitedName = athleteName.slice(0, 64);
        }
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
      await addTeamToUserIndex(newSid, teamId, athleteName || oldIdx.displayName, email || oldIdx.email);
    }
  }
}
async function migrateAnonymousTeamsToStravaSid(params) {
  return migrateAnonymousTeamsToSid({
    oldSid: params.oldSid,
    newSid: params.stravaSid,
    athleteName: params.athleteName,
    stravaAthleteId: params.stravaAthleteId
  });
}
async function autoLinkPendingTeamInvitesByEmail(params) {
  const cleanEmail = params.email?.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@") || !params.userSid) return [];
  const dir = await loadDirectory();
  const linkedTeamIds = [];
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    let modified = false;
    for (const m of doc.memberships) {
      if (m.status === "REVOKED") continue;
      if (m.invitedEmail && m.invitedEmail.trim().toLowerCase() === cleanEmail) {
        if (m.userSid !== params.userSid) {
          m.userSid = params.userSid;
          modified = true;
        }
        if (m.status === "INVITED" || m.status === "OPENED") {
          m.status = "ACTIVE";
          if (!m.openedAt) m.openedAt = nowIso;
          if (!m.joinedAt) m.joinedAt = nowIso;
          modified = true;
        }
        if (params.stravaAthleteId && !m.stravaAthleteId) {
          m.stravaAthleteId = params.stravaAthleteId;
          modified = true;
        }
        if (params.athleteName && (!m.invitedName || m.invitedName === "Team Athlete" || m.invitedName.trim().length === 0)) {
          m.invitedName = params.athleteName.trim().slice(0, 64);
          modified = true;
        }
        if (!m.sharingTier) {
          m.sharingTier = "SUMMARY_ONLY";
          modified = true;
        }
        if (!m.liveSnapshot) {
          const safeSportShieldEnforced = Boolean(
            doc.brand.defaultSafeSportShield || m.isMinorU18
          );
          const calibrated = calibrateThresholdsFromSeedMark(
            m.seedMarkOrFtp || "",
            doc.brand.primarySport,
            "mi"
          );
          m.liveSnapshot = {
            updatedAt: nowIso,
            hasConnectedWatch: Boolean(m.stravaAthleteId),
            verdictLabel: "Auto-Matched \xB7 Email Verified",
            readinessScore: 0,
            ctl: 0,
            atl: 0,
            tsb: 0,
            acuteLoad7d: 0,
            lowAerobicPct: 0,
            highAerobicPct: 0,
            neuromuscularPct: 0,
            caraHours7d: 0,
            ftpWatts: calibrated.cyclingFtpWatts,
            thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
            safeSportHideWeight: safeSportShieldEnforced,
            sharingTier: m.sharingTier
          };
          modified = true;
        }
        await addTeamToUserIndex(
          params.userSid,
          teamId,
          m.invitedName,
          cleanEmail
        );
        if (!linkedTeamIds.includes(teamId)) {
          linkedTeamIds.push(teamId);
        }
      }
    }
    if (modified) {
      doc.updatedAt = nowIso;
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    }
  }
  return linkedTeamIds;
}
function resolveTeamPlanTier(memberships) {
  const activeOrInvitedAthletes = (memberships || []).filter(
    (m) => m.status !== "REVOKED" && m.status !== "ALUMNI" && m.role !== "HEAD_COACH" && m.role !== "ASSISTANT_COACH" && m.role !== "ORG_ADMIN" && m.role !== "ATHLETIC_TRAINER" && m.role !== "PARENT_FOLLOWER"
  ).length;
  return activeOrInvitedAthletes <= 5 ? "SANDBOX" : "FOUNDING_TEAM";
}
function projectTeamSummaryForCaller(doc, callerSid, originUrl) {
  const myMembership = doc.memberships.find(
    (m) => m.userSid === callerSid && m.status !== "REVOKED" && m.status !== "ALUMNI"
  );
  if (!myMembership) return null;
  const isStaffViewer = canViewSafeguardingMedicalRole(myMembership.role);
  const isCoach = isStaffViewer;
  const isParentFollower = myMembership.role === "PARENT_FOLLOWER";
  const parentFollowerEmail = myMembership.invitedEmail?.trim().toLowerCase();
  const linkedChildMembershipIds = isParentFollower ? new Set(
    doc.memberships.filter(
      (m) => m.role === "ATHLETE" && m.status !== "REVOKED" && Boolean(parentFollowerEmail) && m.parentGuardianEmail?.trim().toLowerCase() === parentFollowerEmail
    ).map((m) => m.membershipId)
  ) : null;
  const athleteMembers = doc.memberships.filter(
    (m) => m.status !== "REVOKED" && (!isParentFollower || m.role === "ATHLETE")
  );
  const totalInvited = athleteMembers.length;
  const individualOpened = athleteMembers.filter(
    (m) => m.status === "OPENED" || m.status === "ACTIVE"
  ).length;
  const openedCount = Math.max(
    individualOpened,
    individualOpened + (doc.anonymousLinkOpens || 0)
  );
  const activeCount = athleteMembers.filter((m) => m.status === "ACTIVE").length;
  const watchConnectedCount = athleteMembers.filter(
    (m) => Boolean(m.liveSnapshot?.hasConnectedWatch)
  ).length;
  const cleanOrigin = originUrl.replace(/\/+$/, "");
  const nowRef = /* @__PURE__ */ new Date();
  const sanitizedMemberships = athleteMembers.map((m) => {
    const isSelf = m.userSid === callerSid;
    const isPeerTeammate = !isSelf && !isCoach && !isParentFollower;
    const priv = m.liveSnapshot?.privacySettings;
    const hideWellnessFromCoach = !isSelf && priv?.shareWellnessAndHrv === "PRIVATE";
    const hidePmcFromCoach = !isSelf && priv?.sharePmcAndZones === "PRIVATE";
    const ageResolved = resolveAthleteAgeTier({
      birthMonthYear: m.birthMonthYear,
      birthYear: m.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: m.graduationYear,
      now: nowRef
    });
    const effectiveIsMinor = ageResolved.ageTier === "UNKNOWN" ? Boolean(m.isMinorU18) : ageResolved.isMinorU18;
    const safeSportShieldEnforced = Boolean(
      doc.brand.defaultSafeSportShield || effectiveIsMinor || m.liveSnapshot?.safeSportHideWeight
    );
    let projectedSnapshot;
    if (m.liveSnapshot && !isParentFollower) {
      const rawWatch = m.liveSnapshot.safeSportWatch;
      const projectedSafeSportWatch = !rawWatch ? void 0 : isSelf ? rawWatch : isCoach ? {
        trafficLight: rawWatch.trafficLight,
        coachSafeSummaryLabel: rawWatch.coachSafeSummaryLabel
      } : void 0;
      const hidePmc = !isSelf && (!isCoach || hidePmcFromCoach);
      const hideWellness = !isSelf && (!isCoach || hideWellnessFromCoach);
      const rawVerdict = m.liveSnapshot.verdictLabel;
      const isNeutralVerdict = rawVerdict === "Awaiting Parent Consent" || rawVerdict === "Active" || rawVerdict === "Connected" || rawVerdict === "Joined \xB7 Awaiting First Sync";
      const baseSnapshot = {
        ...m.liveSnapshot,
        verdictLabel: isPeerTeammate ? "Connected" : hideWellness && !isNeutralVerdict ? "Private" : rawVerdict,
        readinessScore: hideWellness ? 0 : m.liveSnapshot.readinessScore,
        acuteLoad7d: hidePmc ? 0 : m.liveSnapshot.acuteLoad7d,
        caraHours7d: hidePmc ? 0 : m.liveSnapshot.caraHours7d,
        lowAerobicPct: hidePmc ? 0 : m.liveSnapshot.lowAerobicPct,
        highAerobicPct: hidePmc ? 0 : m.liveSnapshot.highAerobicPct,
        neuromuscularPct: hidePmc ? 0 : m.liveSnapshot.neuromuscularPct,
        ftpWatts: hidePmc || safeSportShieldEnforced && !isCoach && !isSelf ? void 0 : m.liveSnapshot.ftpWatts,
        thresholdPaceSecsPerKm: hidePmc ? void 0 : m.liveSnapshot.thresholdPaceSecsPerKm,
        ctl: hidePmc ? 0 : m.liveSnapshot.ctl,
        atl: hidePmc ? 0 : m.liveSnapshot.atl,
        tsb: hidePmc ? 0 : m.liveSnapshot.tsb,
        // Never leak raw biometric wellnessDays or activity logs to fellow teammates
        wellnessDays: hideWellness ? void 0 : m.liveSnapshot.wellnessDays,
        activities: isSelf || isCoach ? m.liveSnapshot.activities : void 0,
        sessionCheckIns: hideWellness ? void 0 : m.liveSnapshot.sessionCheckIns,
        safeSportWatch: projectedSafeSportWatch
      };
      projectedSnapshot = safeSportShieldEnforced ? stripSafeSportWeightAndBodyCompFields(baseSnapshot, {
        maskWellnessWeightKgZero: true
      }) : baseSnapshot;
    }
    const officialPublicResults = Array.isArray(m.coachRecordedActivities) ? m.coachRecordedActivities.filter((a) => Boolean(a?.officialRaceData)).map((a) => ({
      ...a,
      athleteWeightKg: void 0,
      avgHr: 0,
      maxHr: 0,
      streams: void 0
    })) : void 0;
    const base = {
      membershipId: m.membershipId,
      teamId: m.teamId,
      userSid: isCoach || isSelf ? m.userSid : void 0,
      stravaAthleteId: isCoach || isSelf ? m.stravaAthleteId : void 0,
      sharingTier: isParentFollower ? void 0 : m.sharingTier,
      role: m.role,
      squadGroup: m.squadGroup,
      ...m.eventGroup ? { eventGroup: m.eventGroup } : {},
      invitedName: m.invitedName,
      graduationYear: m.graduationYear,
      birthYear: isCoach || isSelf ? m.birthYear : void 0,
      birthMonthYear: isCoach || isSelf ? m.birthMonthYear : void 0,
      isMinorU18: effectiveIsMinor,
      parentConsentStatus: isCoach || isSelf ? effectiveIsMinor ? m.parentConsentStatus : "NOT_REQUIRED" : void 0,
      parentConsentAt: isCoach || isSelf ? m.parentConsentAt : void 0,
      seedMarkOrFtp: m.seedMarkOrFtp,
      ...m.externalSource ? { externalSource: m.externalSource } : {},
      ...m.externalAthleteId ? { externalAthleteId: m.externalAthleteId } : {},
      ...m.externalProfileUrl ? { externalProfileUrl: m.externalProfileUrl } : {},
      ...m.genderDivision ? { genderDivision: m.genderDivision } : {},
      status: m.status,
      emailDeliveryStatus: isCoach || isSelf ? m.emailDeliveryStatus : void 0,
      invitedAt: m.invitedAt,
      openedAt: m.openedAt,
      joinedAt: m.joinedAt,
      ...m.leftAt ? { leftAt: m.leftAt } : {},
      ...m.graduatedAt ? { graduatedAt: m.graduatedAt } : {},
      liveSnapshot: projectedSnapshot,
      coachRecordedActivities: isParentFollower ? officialPublicResults : (isCoach || isSelf) && Array.isArray(m.coachRecordedActivities) ? safeSportShieldEnforced ? stripSafeSportWeightAndBodyCompFields(m.coachRecordedActivities, {
        maskWellnessWeightKgZero: true
      }) : m.coachRecordedActivities : void 0
    };
    if (isCoach || isSelf) {
      base.invitedEmail = m.invitedEmail;
      base.invitedPhone = m.invitedPhone;
      base.parentGuardianEmail = m.parentGuardianEmail;
      const emailParam = m.invitedEmail ? `email=${encodeURIComponent(m.invitedEmail)}` : "";
      if (m.rawInviteToken) {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}${emailParam ? `&${emailParam}` : ""}`;
      } else {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}${emailParam ? `?${emailParam}` : ""}`;
      }
    }
    return base;
  });
  const visibleBroadcasts = (doc.broadcastWorkouts || []).filter((bw) => {
    if (isCoach) return true;
    if (isParentFollower) {
      return !bw.targetMembershipIds || bw.targetMembershipIds.length === 0;
    }
    if (bw.athleteOverrides && bw.athleteOverrides[myMembership.membershipId]) {
      return true;
    }
    if (Array.isArray(bw.targetMembershipIds) && bw.targetMembershipIds.length > 0) {
      return bw.targetMembershipIds.includes(myMembership.membershipId);
    }
    const squadMatches = bw.targetSquadGroup === "ALL" || bw.targetSquadGroup.toLowerCase() === myMembership.squadGroup.toLowerCase();
    if (!squadMatches) return false;
    if (Array.isArray(bw.targetEventGroups) && bw.targetEventGroups.length > 0) {
      return Boolean(myMembership.eventGroup) && bw.targetEventGroups.includes(myMembership.eventGroup);
    }
    return true;
  }).map((bw) => {
    if (!isParentFollower) return bw;
    return {
      ...bw,
      athleteOverrides: void 0
    };
  });
  const visibleComments = (doc.workoutComments || []).filter((c) => {
    if (isStaffViewer) return true;
    if (isParentFollower) {
      return Boolean(
        c.guardianVisible && linkedChildMembershipIds && linkedChildMembershipIds.has(c.targetMembershipId)
      );
    }
    return c.targetMembershipId === myMembership.membershipId;
  });
  const visibleSafetyAlerts = (doc.guardianSafetyAlerts || []).filter((a) => {
    if (isStaffViewer) return true;
    if (isParentFollower) {
      return Boolean(
        linkedChildMembershipIds && linkedChildMembershipIds.has(a.targetMembershipId)
      );
    }
    return a.targetMembershipId === myMembership.membershipId;
  });
  return {
    brand: {
      ...doc.brand,
      planTier: resolveTeamPlanTier(doc.memberships)
    },
    myRole: myMembership.role,
    mySquadGroup: myMembership.squadGroup,
    ...myMembership.eventGroup ? { myEventGroup: myMembership.eventGroup } : {},
    myMembershipId: myMembership.membershipId,
    totalInvited,
    openedCount,
    activeCount,
    watchConnectedCount,
    memberships: sanitizedMemberships,
    broadcastWorkouts: visibleBroadcasts,
    ...isParentFollower ? {} : { workoutLibrary: doc.workoutLibrary || [] },
    workoutComments: visibleComments,
    guardianSafetyAlerts: visibleSafetyAlerts
  };
}
async function listTeamsForUser(callerSid, originUrl) {
  const userIdx = await loadTenantVaultAsync(
    userTeamsVaultKey(callerSid),
    {
      teamIds: [],
      updatedAt: ""
    }
  );
  const out = [];
  for (const teamId of userIdx.teamIds) {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    const summary = projectTeamSummaryForCaller(doc, callerSid, originUrl);
    if (summary) out.push(summary);
  }
  return out;
}
async function createTeamForCoach(params) {
  const dir = await loadDirectory();
  const orgType = params.orgType || "HIGH_SCHOOL";
  const orgDefaults = getOrgTypeSafeguardingDefaults(orgType);
  const cleanName = String(params.name || "").trim().slice(0, 80) || "Varsity Endurance";
  const cleanShort = String(params.shortName || "").trim().slice(0, 22) || cleanName.split(/\s+/).slice(0, 2).join(" ").toUpperCase().slice(0, 14);
  let slug = slugifyTeamName(cleanName);
  if (dir.bySlug[slug]) {
    slug = `${slug}-${crypto6.randomInt(10, 99)}`;
  }
  let joinCode = generateTeamJoinCode(cleanShort);
  if (dir.byJoinCode[joinCode]) {
    joinCode = generateTeamJoinCode(cleanShort, crypto6.randomInt(10, 99));
  }
  const teamId = `tm_${crypto6.randomBytes(8).toString("hex")}`;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const defaultSafeSportShield = typeof params.defaultSafeSportShield === "boolean" ? params.defaultSafeSportShield : orgDefaults.defaultSafeSportShield;
  const enableParentGuardianCc = typeof params.enableParentGuardianCc === "boolean" ? params.enableParentGuardianCc : orgDefaults.enableParentGuardianCc;
  const safeLogo = params.logoDataUrl && params.logoDataUrl.startsWith("data:image/") && params.logoDataUrl.length <= 96e3 ? params.logoDataUrl : void 0;
  const brand = {
    teamId,
    slug,
    joinCode,
    name: cleanName,
    shortName: cleanShort,
    mascotOrMotto: params.mascotOrMotto ? String(params.mascotOrMotto).trim().slice(0, 64) : void 0,
    orgType,
    primarySport: params.primarySport || orgDefaults.defaultPrimarySport,
    logoDataUrl: safeLogo,
    primaryHex: normalizeHexColor(params.primaryHex || "#14532D", "#14532D"),
    secondaryHex: normalizeHexColor(params.secondaryHex || "#D97706", "#D97706"),
    defaultSafeSportShield,
    enableParentGuardianCc,
    coachDisplayName: String(params.coachDisplayName || "").trim().slice(0, 48) || "Head Coach",
    planTier: "SANDBOX",
    ...params.externalSync ? { externalSync: sanitizeExternalSyncConfig(params.externalSync) } : {},
    createdAt: nowIso
  };
  const coachMembership = {
    membershipId: `mem_${crypto6.randomBytes(6).toString("hex")}`,
    teamId,
    userSid: params.callerSid,
    role: "HEAD_COACH",
    squadGroup: orgDefaults.defaultSquads[0] || "Varsity",
    invitedName: brand.coachDisplayName,
    invitedEmail: params.coachEmail ? params.coachEmail.trim().toLowerCase() : void 0,
    isMinorU18: false,
    status: "ACTIVE",
    invitedAt: nowIso,
    openedAt: nowIso,
    joinedAt: nowIso
  };
  const doc = {
    brand,
    memberships: [coachMembership],
    broadcastWorkouts: [],
    updatedAt: nowIso
  };
  await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
    const latestDir = await loadDirectory();
    latestDir.bySlug[slug] = teamId;
    latestDir.byJoinCode[joinCode.toUpperCase()] = teamId;
    if (!latestDir.allTeamIds.includes(teamId)) latestDir.allTeamIds.push(teamId);
    await saveTeamDocRaw(teamId, doc);
    await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, latestDir);
  });
  await addTeamToUserIndex(
    params.callerSid,
    teamId,
    brand.coachDisplayName,
    params.coachEmail
  );
  await appendAuditLogAsync({
    teamId,
    actorSid: params.callerSid,
    action: "TEAM_CREATED",
    targetId: teamId,
    metadata: { orgType, name: cleanName }
  });
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}
async function updateTeamBranding(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH" && callerMem.role !== "ORG_ADMIN") {
      return null;
    }
    const u = params.updates;
    if (u.name) doc.brand.name = String(u.name).trim().slice(0, 80);
    if (u.shortName) doc.brand.shortName = String(u.shortName).trim().slice(0, 22);
    if (typeof u.mascotOrMotto === "string") {
      doc.brand.mascotOrMotto = u.mascotOrMotto.trim().slice(0, 64) || void 0;
    }
    if (u.orgType && callerMem.role === "HEAD_COACH") doc.brand.orgType = u.orgType;
    if (u.primarySport) doc.brand.primarySport = u.primarySport;
    if (u.primaryHex) doc.brand.primaryHex = normalizeHexColor(u.primaryHex, doc.brand.primaryHex);
    if (u.secondaryHex) {
      doc.brand.secondaryHex = normalizeHexColor(u.secondaryHex, doc.brand.secondaryHex);
    }
    if (typeof u.defaultSafeSportShield === "boolean") {
      if (u.defaultSafeSportShield || callerMem.role === "HEAD_COACH") {
        doc.brand.defaultSafeSportShield = u.defaultSafeSportShield;
      }
    }
    if (typeof u.enableParentGuardianCc === "boolean") {
      if (u.enableParentGuardianCc || callerMem.role === "HEAD_COACH") {
        doc.brand.enableParentGuardianCc = u.enableParentGuardianCc;
      }
    }
    if (u.coachDisplayName && callerMem.role === "HEAD_COACH") {
      doc.brand.coachDisplayName = String(u.coachDisplayName).trim().slice(0, 48);
    }
    if (u.externalSync) {
      doc.brand.externalSync = sanitizeExternalSyncConfig(u.externalSync, doc.brand.externalSync);
    }
    if (u.logoDataUrl === "") {
      doc.brand.logoDataUrl = void 0;
    } else if (u.logoDataUrl && u.logoDataUrl.startsWith("data:image/") && u.logoDataUrl.length <= 96e3) {
      doc.brand.logoDataUrl = u.logoDataUrl;
    }
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function bulkCreateAndSendInvites(params) {
  const doc = await loadTenantVaultAsync(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured()
    };
  }
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured()
    };
  }
  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  const parsedRows = Array.isArray(params.rows) && params.rows.length > 0 ? params.rows : parseBulkRosterCsvOrText(
    params.rawCsvOrText || "",
    doc.brand.orgType,
    orgDefaults.defaultSquads[0] || "Varsity"
  );
  const cleanOrigin = params.originUrl.replace(/\/+$/, "");
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const pendingEmails = [];
  const lockedResult = await withTeamRowLock(params.teamId, async () => {
    const latestDoc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!latestDoc) return null;
    let addedCount2 = 0;
    let manualLinkCount2 = 0;
    for (const row of parsedRows.slice(0, 220)) {
      const cleanEmail = row.invitedEmail?.trim().toLowerCase();
      if (cleanEmail && latestDoc.memberships.some(
        (existing) => existing.invitedEmail?.toLowerCase() === cleanEmail && existing.status !== "REVOKED"
      )) {
        continue;
      }
      const rawToken = crypto6.randomBytes(12).toString("base64url");
      const membershipId = `mem_${crypto6.randomBytes(6).toString("hex")}`;
      const emailParam = cleanEmail ? `&email=${encodeURIComponent(cleanEmail)}` : "";
      const magicJoinUrl = `${cleanOrigin}/join/${latestDoc.brand.slug}?t=${rawToken}${emailParam}`;
      const parentCc = latestDoc.brand.enableParentGuardianCc && row.parentGuardianEmail ? row.parentGuardianEmail.trim().toLowerCase() : void 0;
      if (cleanEmail && params.sendEmailsNow !== false) {
        const emailContent = buildTeamInviteEmailContent({
          brand: latestDoc.brand,
          invitedName: row.invitedName,
          squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || "Varsity",
          magicJoinUrl,
          hasParentCc: Boolean(parentCc),
          seedMarkOrFtp: row.seedMarkOrFtp
        });
        pendingEmails.push({
          membershipId,
          to: cleanEmail,
          cc: parentCc,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text
        });
      } else {
        manualLinkCount2 += 1;
      }
      latestDoc.memberships.push({
        membershipId,
        teamId: latestDoc.brand.teamId,
        role: "ATHLETE",
        squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || "Varsity",
        ...inferEventGroupFromSeedMark(row.seedMarkOrFtp) ? { eventGroup: inferEventGroupFromSeedMark(row.seedMarkOrFtp) } : {},
        invitedName: String(row.invitedName || "Team Athlete").trim().slice(0, 64),
        invitedEmail: cleanEmail,
        invitedPhone: row.invitedPhone,
        parentGuardianEmail: row.parentGuardianEmail?.trim().toLowerCase(),
        graduationYear: row.graduationYear,
        isMinorU18: Boolean(row.isMinorU18 || latestDoc.brand.orgType === "HIGH_SCHOOL"),
        seedMarkOrFtp: row.seedMarkOrFtp,
        status: "INVITED",
        emailDeliveryStatus: "READY_MANUAL_LINK",
        rawInviteToken: rawToken,
        inviteTokenHash: hashToken(rawToken),
        invitedAt: nowIso
      });
      addedCount2 += 1;
    }
    latestDoc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, latestDoc);
    return { latestDoc, addedCount: addedCount2, manualLinkCount: manualLinkCount2 };
  });
  if (!lockedResult) {
    return {
      summary: null,
      addedCount: 0,
      emailedCount: 0,
      manualLinkCount: 0,
      resendConfigured: isResendConfigured()
    };
  }
  let { addedCount, manualLinkCount } = lockedResult;
  let emailedCount = 0;
  if (pendingEmails.length > 0) {
    const statusById = /* @__PURE__ */ new Map();
    for (let i = 0; i < pendingEmails.length; i += 4) {
      const batch = pendingEmails.slice(i, i + 4);
      await Promise.all(
        batch.map(async (item) => {
          const sendRes = await sendEmailViaResend({
            to: item.to,
            cc: item.cc,
            subject: item.subject,
            html: item.html,
            text: item.text
          });
          statusById.set(item.membershipId, sendRes.status);
          if (sendRes.delivered) emailedCount += 1;
          else manualLinkCount += 1;
        })
      );
    }
    await withTeamRowLock(params.teamId, async () => {
      const finalDoc2 = await loadTenantVaultAsync(
        teamDocVaultKey(params.teamId),
        null
      );
      if (!finalDoc2) return;
      for (const m of finalDoc2.memberships) {
        const nextStatus = statusById.get(m.membershipId);
        if (nextStatus) m.emailDeliveryStatus = nextStatus;
      }
      finalDoc2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTeamDocRaw(params.teamId, finalDoc2);
    });
  }
  const finalDoc = await loadTenantVaultAsync(
    teamDocVaultKey(params.teamId),
    null
  ) || lockedResult.latestDoc;
  return {
    summary: projectTeamSummaryForCaller(finalDoc, params.callerSid, params.originUrl),
    addedCount,
    emailedCount,
    manualLinkCount,
    resendConfigured: isResendConfigured()
  };
}
async function resendPendingTeamInvites(params) {
  const doc = await loadTenantVaultAsync(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) return { summary: null, emailedCount: 0, resendConfigured: isResendConfigured() };
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
    return { summary: null, emailedCount: 0, resendConfigured: isResendConfigured() };
  }
  const cleanOrigin = params.originUrl.replace(/\/+$/, "");
  let emailedCount = 0;
  for (const m of doc.memberships) {
    if (m.status === "ACTIVE" || m.status === "REVOKED" || !m.invitedEmail) continue;
    if (params.membershipId && params.membershipId !== "ALL_PENDING" && m.membershipId !== params.membershipId) {
      continue;
    }
    if (!m.rawInviteToken) {
      m.rawInviteToken = crypto6.randomBytes(12).toString("base64url");
      m.inviteTokenHash = hashToken(m.rawInviteToken);
    }
    const emailParam = m.invitedEmail ? `&email=${encodeURIComponent(m.invitedEmail)}` : "";
    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}${emailParam}`;
    const ccEmail = doc.brand.enableParentGuardianCc && m.parentGuardianEmail ? m.parentGuardianEmail : void 0;
    const emailContent = buildTeamInviteEmailContent({
      brand: doc.brand,
      invitedName: m.invitedName,
      squadGroup: m.squadGroup,
      magicJoinUrl,
      hasParentCc: Boolean(ccEmail),
      seedMarkOrFtp: m.seedMarkOrFtp
    });
    const sendRes = await sendEmailViaResend({
      to: m.invitedEmail,
      cc: ccEmail,
      subject: `Reminder: ${emailContent.subject}`,
      html: emailContent.html,
      text: emailContent.text
    });
    m.emailDeliveryStatus = sendRes.status;
    if (sendRes.delivered) emailedCount += 1;
  }
  doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    emailedCount,
    resendConfigured: isResendConfigured()
  };
}
async function findTeamDocumentByCodeOrSlug(rawCodeOrSlug) {
  const query = String(rawCodeOrSlug || "").trim();
  if (!query) return null;
  const dir = await loadDirectory();
  const teamId = dir.byJoinCode[query.toUpperCase()] || dir.bySlug[query.toLowerCase()] || dir.bySlug[slugifyTeamName(query)];
  if (!teamId) return null;
  return loadTenantVaultAsync(teamDocVaultKey(teamId), null);
}
async function previewTeamJoinInvite(codeOrSlug, inviteToken, athleteEmail) {
  const doc = await findTeamDocumentByCodeOrSlug(codeOrSlug);
  if (!doc) return { found: false };
  let matchedMem;
  const cleanEmail = athleteEmail?.trim().toLowerCase();
  if (inviteToken) {
    const targetHash = hashToken(inviteToken);
    matchedMem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== "REVOKED"
    );
  }
  if (!matchedMem && cleanEmail) {
    matchedMem = doc.memberships.find(
      (m) => m.invitedEmail?.toLowerCase() === cleanEmail && m.status !== "REVOKED"
    );
  }
  return {
    found: true,
    brand: doc.brand,
    membership: matchedMem ? {
      membershipId: matchedMem.membershipId,
      invitedName: matchedMem.invitedName,
      invitedEmail: matchedMem.invitedEmail,
      parentGuardianEmail: matchedMem.parentGuardianEmail,
      squadGroup: matchedMem.squadGroup,
      role: matchedMem.role,
      isMinorU18: matchedMem.isMinorU18,
      birthYear: matchedMem.birthYear,
      parentConsentStatus: matchedMem.parentConsentStatus,
      seedMarkOrFtp: matchedMem.seedMarkOrFtp
    } : void 0
  };
}
async function claimTeamJoinInvite(params) {
  const initialDoc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!initialDoc) {
    return {
      ok: false,
      error: "No team matched that Join Code or link. Check the 6-character code with your coach."
    };
  }
  return withTeamRowLock(initialDoc.brand.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(initialDoc.brand.teamId),
      null
    ) || initialDoc;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cleanEmail = params.athleteEmail?.trim().toLowerCase();
    const cleanNameLower = params.athleteName?.trim().toLowerCase().replace(/\s+/g, " ");
    const normClaimNameKey = params.athleteName ? normalizeAthleteMatchKey(params.athleteName) : "";
    const cleanStravaId = params.stravaAthleteId?.trim();
    let mem;
    if (params.inviteToken) {
      const targetHash = hashToken(params.inviteToken);
      mem = doc.memberships.find(
        (m) => m.inviteTokenHash === targetHash && m.status !== "REVOKED" && (!m.userSid || m.userSid === params.callerSid)
      );
    }
    if (!mem && cleanEmail) {
      mem = doc.memberships.find(
        (m) => m.role === "ATHLETE" && m.invitedEmail?.toLowerCase() === cleanEmail && m.status !== "REVOKED" && (!m.userSid || m.userSid === params.callerSid)
      );
    }
    if (!mem) {
      mem = doc.memberships.find(
        (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
      );
    }
    if (!mem && cleanStravaId) {
      mem = doc.memberships.find(
        (m) => m.role === "ATHLETE" && m.stravaAthleteId === cleanStravaId && m.status !== "REVOKED" && (!m.userSid || m.userSid === params.callerSid)
      );
    }
    if (!mem && cleanNameLower && cleanNameLower !== "team athlete" && cleanNameLower !== "athlete") {
      const unclaimed = doc.memberships.filter(
        (m) => (m.status === "INVITED" || m.status === "OPENED") && !m.userSid && m.role === "ATHLETE"
      );
      const exactMatches = unclaimed.filter(
        (m) => m.invitedName.trim().toLowerCase().replace(/\s+/g, " ") === cleanNameLower || normClaimNameKey && normalizeAthleteMatchKey(m.invitedName) === normClaimNameKey
      );
      if (exactMatches.length === 1) {
        mem = exactMatches[0];
      } else if (exactMatches.length > 1 && params.graduationYear) {
        mem = exactMatches.find((m) => m.graduationYear === params.graduationYear);
      } else if (normClaimNameKey) {
        const parts = normClaimNameKey.split(" ").filter(Boolean);
        const lastName = parts[parts.length - 1];
        if (lastName && lastName.length >= 3 && params.graduationYear) {
          const lastNameMatches = unclaimed.filter((m) => {
            const mParts = normalizeAthleteMatchKey(m.invitedName).split(" ").filter(Boolean);
            return mParts[mParts.length - 1] === lastName && m.graduationYear === params.graduationYear;
          });
          if (lastNameMatches.length === 1) {
            mem = lastNameMatches[0];
          }
        }
      }
    }
    const ageCheck = resolveAthleteAgeTier({
      birthMonthYear: mem?.birthMonthYear || params.birthMonthYear,
      birthYear: mem?.birthYear ?? params.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: params.graduationYear ?? mem?.graduationYear
    });
    if (ageCheck.isUnder13) {
      return {
        ok: false,
        error: "THRESH accounts require athletes to be 13 or older (COPPA). Coaches can time U13 athletes watchlessly using Trackside Stopwatch without child accounts."
      };
    }
    const effectiveParentEmail = params.parentGuardianEmail?.trim().toLowerCase() || mem?.parentGuardianEmail?.trim().toLowerCase();
    if ((ageCheck.ageTier === "YOUTH_13_17" || ageCheck.ageTier === "UNKNOWN" && doc.brand.orgType === "HIGH_SCHOOL") && !effectiveParentEmail) {
      return {
        ok: false,
        error: "Parent or guardian email is required for athletes aged 13\u201317."
      };
    }
    const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
    const resolvedSharingTier = params.sharingTier || "SUMMARY_ONLY";
    const isMinor = ageCheck.ageTier === "UNKNOWN" ? Boolean(doc.brand.orgType === "HIGH_SCHOOL" || mem?.isMinorU18) : ageCheck.isMinorU18;
    if (!mem) {
      mem = {
        membershipId: `mem_${crypto6.randomBytes(6).toString("hex")}`,
        teamId: doc.brand.teamId,
        userSid: params.callerSid,
        stravaAthleteId: cleanStravaId,
        sharingTier: resolvedSharingTier,
        role: "ATHLETE",
        squadGroup: params.squadGroup?.trim() || orgDefaults.defaultSquads[0] || "Varsity",
        ...inferEventGroupFromSeedMark(params.seedMarkOrFtp) ? { eventGroup: inferEventGroupFromSeedMark(params.seedMarkOrFtp) } : {},
        invitedName: params.athleteName?.trim().slice(0, 64) || "Team Athlete",
        invitedEmail: cleanEmail,
        graduationYear: params.graduationYear,
        isMinorU18: isMinor,
        seedMarkOrFtp: params.seedMarkOrFtp?.trim(),
        status: "ACTIVE",
        invitedAt: nowIso,
        openedAt: nowIso,
        joinedAt: nowIso
      };
      doc.memberships.push(mem);
    } else {
      mem.userSid = params.callerSid;
      if (cleanStravaId) mem.stravaAthleteId = cleanStravaId;
      if (params.sharingTier) mem.sharingTier = params.sharingTier;
      else if (!mem.sharingTier) mem.sharingTier = "SUMMARY_ONLY";
      if (params.athleteName?.trim()) {
        mem.invitedName = params.athleteName.trim().slice(0, 64);
      }
      if (cleanEmail && !mem.invitedEmail) {
        mem.invitedEmail = cleanEmail;
      }
      if (params.squadGroup?.trim()) {
        mem.squadGroup = params.squadGroup.trim();
      }
      if (params.graduationYear) {
        mem.graduationYear = params.graduationYear;
      }
      if (params.seedMarkOrFtp?.trim()) {
        mem.seedMarkOrFtp = params.seedMarkOrFtp.trim();
        if (!mem.eventGroup) {
          const inferredGroup = inferEventGroupFromSeedMark(mem.seedMarkOrFtp);
          if (inferredGroup) mem.eventGroup = inferredGroup;
        }
      }
      mem.status = "ACTIVE";
      if (!mem.openedAt) mem.openedAt = nowIso;
      if (!mem.joinedAt) mem.joinedAt = nowIso;
    }
    mem.isMinorU18 = isMinor;
    if (ageCheck.birthMonthYear && !mem.birthMonthYear) {
      mem.birthMonthYear = ageCheck.birthMonthYear;
    }
    if (ageCheck.birthYear && ageCheck.birthYear > 1900 && !mem.birthYear) {
      mem.birthYear = ageCheck.birthYear;
    }
    if (ageCheck.ageTier === "ADULT_18_PLUS") {
      mem.parentGuardianEmail = void 0;
      mem.parentConsentToken = void 0;
      mem.parentConsentTokenHash = void 0;
      mem.parentConsentStatus = "NOT_REQUIRED";
    } else if (effectiveParentEmail) {
      mem.parentGuardianEmail = effectiveParentEmail;
    }
    if (mem.isMinorU18 && mem.parentGuardianEmail) {
      let rawConsentToken = "";
      if (!mem.parentConsentTokenHash) {
        rawConsentToken = crypto6.randomBytes(16).toString("base64url");
        mem.parentConsentTokenHash = hashToken(rawConsentToken);
        mem.parentConsentToken = void 0;
      }
      if (!mem.parentConsentStatus || mem.parentConsentStatus === "NOT_REQUIRED") {
        mem.parentConsentStatus = "PENDING";
      }
      if (rawConsentToken) {
        const cleanOrigin = params.originUrl.replace(/\/+$/, "");
        const consentUrl = `${cleanOrigin}/api/teams/parent-consent?token=${rawConsentToken}`;
        const emailContent = buildParentConsentEmailContent({
          brand: doc.brand,
          athleteName: mem.invitedName,
          parentConsentUrl: consentUrl
        });
        void sendEmailViaResend({
          to: mem.parentGuardianEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text
        });
      }
    } else if (!mem.parentConsentStatus) {
      mem.parentConsentStatus = mem.isMinorU18 ? "PENDING" : "NOT_REQUIRED";
    }
    const safeSportShieldEnforced = Boolean(
      doc.brand.defaultSafeSportShield || mem.isMinorU18
    );
    const calibrated = calibrateThresholdsFromSeedMark(
      mem.seedMarkOrFtp || params.seedMarkOrFtp || "",
      doc.brand.primarySport,
      params.distanceUnit || "mi"
    );
    if (!mem.liveSnapshot) {
      mem.liveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: "Joined \xB7 Awaiting First Sync",
        readinessScore: 0,
        ctl: 0,
        atl: 0,
        tsb: 0,
        acuteLoad7d: 0,
        lowAerobicPct: 0,
        highAerobicPct: 0,
        neuromuscularPct: 0,
        caraHours7d: 0,
        ftpWatts: calibrated.cyclingFtpWatts,
        thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
        safeSportHideWeight: safeSportShieldEnforced,
        sharingTier: mem.sharingTier
      };
    } else {
      if (params.seedMarkOrFtp?.trim()) {
        mem.liveSnapshot.ftpWatts = calibrated.cyclingFtpWatts;
        mem.liveSnapshot.thresholdPaceSecsPerKm = calibrated.thresholdPaceSecsPerKm;
      }
      mem.liveSnapshot.sharingTier = mem.sharingTier;
    }
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(doc.brand.teamId, doc);
    await addTeamToUserIndex(
      params.callerSid,
      doc.brand.teamId,
      mem.invitedName,
      mem.invitedEmail
    );
    await appendAuditLogAsync({
      teamId: doc.brand.teamId,
      actorSid: params.callerSid,
      action: "MEMBER_JOINED",
      targetId: mem.membershipId,
      metadata: {
        role: mem.role,
        isMinorU18: mem.isMinorU18,
        parentConsentStatus: mem.parentConsentStatus
      }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
      calibrated,
      safeSportShieldEnforced
    };
  });
}
async function acknowledgeParentConsent(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    return { ok: false, error: "Invalid or missing parent consent token." };
  }
  const targetHash = hashToken(cleanToken);
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    const mem = doc.memberships.find(
      (m) => m.status !== "REVOKED" && (m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash) || m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken))
    );
    if (mem) {
      return withTeamRowLock(teamId, async () => {
        const freshDoc = await loadTenantVaultAsync(
          teamDocVaultKey(teamId),
          null
        ) || doc;
        const lockedMem = freshDoc.memberships.find((m) => m.membershipId === mem.membershipId);
        if (!lockedMem) return { ok: false, error: "Membership not found." };
        const wasAcknowledged = lockedMem.parentConsentStatus === "ACKNOWLEDGED";
        if (!wasAcknowledged) {
          lockedMem.parentConsentStatus = "ACKNOWLEDGED";
          lockedMem.parentConsentAt = (/* @__PURE__ */ new Date()).toISOString();
          freshDoc.updatedAt = lockedMem.parentConsentAt;
          await saveTeamDocRaw(teamId, freshDoc);
          await appendAuditLogAsync({
            teamId,
            actorSid: lockedMem.parentGuardianEmail || "guardian",
            action: "PARENT_CONSENT_ACKNOWLEDGED",
            targetId: lockedMem.membershipId,
            metadata: { athleteName: lockedMem.invitedName }
          });
        }
        return {
          ok: true,
          athleteName: lockedMem.invitedName,
          teamName: freshDoc.brand.name,
          coachName: freshDoc.brand.coachDisplayName,
          sport: freshDoc.brand.primarySport,
          parentEmail: lockedMem.parentGuardianEmail,
          acknowledgedAt: lockedMem.parentConsentAt,
          alreadyAcknowledged: wasAcknowledged
        };
      });
    }
  }
  return { ok: false, error: "Invalid or expired parent consent link." };
}
async function updateTeamMemberEventGroup(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const targetMem = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== "REVOKED"
    );
    if (!targetMem) return null;
    targetMem.eventGroup = params.eventGroup || void 0;
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function broadcastWorkoutToTeamSquad(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cleanTargets = Array.isArray(params.targetMembershipIds) ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
    const cleanEventGroups = Array.isArray(params.targetEventGroups) ? params.targetEventGroups.filter(
      (g) => g === "SPRINTS" || g === "MID_DISTANCE" || g === "DISTANCE"
    ) : void 0;
    const dateStr = String(params.date || nowIso.slice(0, 10)).slice(0, 10);
    const targetSquadGroup = String(params.targetSquadGroup || "ALL").trim() || "ALL";
    const scheduledTime = sanitizeScheduledTime(params.scheduledTime);
    const sessionSlot = sanitizeSessionSlot(params.sessionSlot);
    const locationName = params.locationName ? String(params.locationName).trim().slice(0, 120) : void 0;
    const locationCategory = sanitizePracticeVenueCategory(params.locationCategory);
    const meetingNotes = params.meetingNotes ? String(params.meetingNotes).trim().slice(0, 240) : void 0;
    const workout = {
      broadcastId: `bw_${crypto6.randomBytes(6).toString("hex")}`,
      teamId: doc.brand.teamId,
      targetSquadGroup,
      ...cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {},
      ...cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {},
      date: dateStr,
      name: String(params.name || "Team Prescribed Session").trim().slice(0, 100),
      sportCategory: params.sportCategory || "Running",
      plannedDurationSecs: Math.max(300, Number(params.plannedDurationSecs) || 3600),
      plannedLoad: Math.max(5, Number(params.plannedLoad) || 65),
      workoutSyntax: String(params.workoutSyntax || "").slice(0, 3e3),
      description: String(params.description || "").slice(0, 1e3),
      ...scheduledTime ? { scheduledTime } : {},
      ...sessionSlot ? { sessionSlot } : {},
      ...locationName ? { locationName } : {},
      ...locationCategory ? { locationCategory } : {},
      ...meetingNotes ? { meetingNotes } : {},
      ...params.trackSpec ? { trackSpec: params.trackSpec } : {},
      ...params.athleteOverrides && Object.keys(params.athleteOverrides).length > 0 ? { athleteOverrides: params.athleteOverrides } : {},
      ...params.planBlockId ? { planBlockId: String(params.planBlockId).slice(0, 80) } : {},
      ...params.planBlockName ? { planBlockName: String(params.planBlockName).slice(0, 120) } : {},
      ...typeof params.planWeekNum === "number" ? { planWeekNum: params.planWeekNum } : {},
      ...params.publishMode ? { publishMode: params.publishMode } : {},
      pushedByCoachName: callerMem.invitedName || doc.brand.coachDisplayName,
      createdAt: nowIso
    };
    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const nextSlot = workout.sessionSlot || "SINGLE";
    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceSameDateTarget === false) return true;
      const sameDate = bw.date === dateStr;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers = JSON.stringify((bw.targetMembershipIds || []).slice().sort()) === JSON.stringify((cleanTargets || []).slice().sort());
      const sameSlot = (bw.sessionSlot || "SINGLE") === nextSlot;
      const sameSport = (bw.sportCategory || "Running") === workout.sportCategory;
      return !(sameDate && sameSquad && sameGroups && sameMembers && sameSlot && sameSport);
    });
    doc.broadcastWorkouts = [workout, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function broadcastWorkoutBatchToTeamSquad(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cleanTargets = Array.isArray(params.targetMembershipIds) ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
    const cleanEventGroups = Array.isArray(params.targetEventGroups) ? params.targetEventGroups.filter(
      (g) => g === "SPRINTS" || g === "MID_DISTANCE" || g === "DISTANCE"
    ) : void 0;
    const targetSquadGroup = String(params.targetSquadGroup || "ALL").trim() || "ALL";
    const cleanBlockId = params.planBlockId ? String(params.planBlockId).slice(0, 80) : `tm-blk-${Date.now()}`;
    const cleanBlockName = params.planBlockName ? String(params.planBlockName).slice(0, 120) : void 0;
    const publishMode = params.publishMode === "ROLLING_1W" || params.publishMode === "ROLLING_2W" || params.publishMode === "FULL_BLOCK" ? params.publishMode : "FULL_BLOCK";
    const createdWorkouts = (params.workouts || []).slice(0, 160).map((w) => {
      const scheduledTime = sanitizeScheduledTime(w.scheduledTime);
      const sessionSlot = sanitizeSessionSlot(w.sessionSlot);
      const locationName = w.locationName ? String(w.locationName).trim().slice(0, 120) : void 0;
      const locationCategory = sanitizePracticeVenueCategory(w.locationCategory);
      const meetingNotes = w.meetingNotes ? String(w.meetingNotes).trim().slice(0, 240) : void 0;
      return {
        broadcastId: `bw_${crypto6.randomBytes(6).toString("hex")}`,
        teamId: doc.brand.teamId,
        targetSquadGroup,
        ...cleanEventGroups && cleanEventGroups.length > 0 ? { targetEventGroups: cleanEventGroups } : {},
        ...cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {},
        date: String(w.date || nowIso.slice(0, 10)).slice(0, 10),
        name: String(w.name || "Team Prescribed Session").trim().slice(0, 100),
        sportCategory: w.sportCategory || "Running",
        plannedDurationSecs: Math.max(300, Number(w.plannedDurationSecs) || 3600),
        plannedLoad: Math.max(5, Number(w.plannedLoad) || 65),
        workoutSyntax: String(w.workoutSyntax || "").slice(0, 3e3),
        description: String(w.description || "").slice(0, 1e3),
        ...scheduledTime ? { scheduledTime } : {},
        ...sessionSlot ? { sessionSlot } : {},
        ...locationName ? { locationName } : {},
        ...locationCategory ? { locationCategory } : {},
        ...meetingNotes ? { meetingNotes } : {},
        ...w.trackSpec ? { trackSpec: w.trackSpec } : {},
        planBlockId: cleanBlockId,
        ...cleanBlockName ? { planBlockName: cleanBlockName } : {},
        ...typeof w.planWeekNum === "number" ? { planWeekNum: w.planWeekNum } : {},
        publishMode,
        pushedByCoachName: doc.brand.coachDisplayName,
        createdAt: nowIso
      };
    });
    const eventGroupSignature = JSON.stringify((cleanEventGroups || []).slice().sort());
    const membersSignature = JSON.stringify((cleanTargets || []).slice().sort());
    const dates = createdWorkouts.map((c) => c.date).sort();
    const minDate = dates[0] || "";
    const maxDate = dates[dates.length - 1] || "";
    const existingFiltered = (doc.broadcastWorkouts || []).filter((bw) => {
      if (params.replaceExistingCohortRange === false || !minDate || !maxDate) return true;
      const inRange = bw.date >= minDate && bw.date <= maxDate;
      const sameSquad = bw.targetSquadGroup === targetSquadGroup;
      const sameGroups = JSON.stringify((bw.targetEventGroups || []).slice().sort()) === eventGroupSignature;
      const sameMembers = JSON.stringify((bw.targetMembershipIds || []).slice().sort()) === membersSignature;
      return !(inRange && sameSquad && sameGroups && sameMembers);
    });
    doc.broadcastWorkouts = [...createdWorkouts, ...existingFiltered].slice(0, 400);
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function updateBroadcastWorkoutOnTeam(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const cleanId = String(params.broadcastId || "").trim();
    const list = Array.isArray(doc.broadcastWorkouts) ? doc.broadcastWorkouts : [];
    const targetIdx = list.findIndex((bw) => bw.broadcastId === cleanId);
    if (targetIdx === -1) return null;
    const existing = list[targetIdx];
    const u = params.updates || {};
    const updatedWorkout = {
      ...existing,
      ...typeof u.date === "string" && u.date.trim() ? { date: u.date.trim().slice(0, 10) } : {},
      ...typeof u.name === "string" && u.name.trim() ? { name: u.name.trim().slice(0, 100) } : {},
      ...u.sportCategory ? { sportCategory: u.sportCategory } : {},
      ...typeof u.plannedDurationSecs === "number" && Number.isFinite(u.plannedDurationSecs) ? { plannedDurationSecs: Math.max(60, Math.round(u.plannedDurationSecs)) } : {},
      ...typeof u.plannedLoad === "number" && Number.isFinite(u.plannedLoad) ? { plannedLoad: Math.max(1, Math.round(u.plannedLoad)) } : {},
      ...typeof u.workoutSyntax === "string" ? { workoutSyntax: u.workoutSyntax.slice(0, 3e3) } : {},
      ...typeof u.description === "string" ? { description: u.description.slice(0, 1e3) } : {},
      ...u.trackSpec === null ? { trackSpec: void 0 } : u.trackSpec ? { trackSpec: u.trackSpec } : {}
    };
    if ("scheduledTime" in u) {
      const cleanTime = sanitizeScheduledTime(u.scheduledTime ?? void 0);
      if (cleanTime) updatedWorkout.scheduledTime = cleanTime;
      else delete updatedWorkout.scheduledTime;
    }
    if ("sessionSlot" in u) {
      const cleanSlot = sanitizeSessionSlot(u.sessionSlot ?? void 0);
      if (cleanSlot) updatedWorkout.sessionSlot = cleanSlot;
      else delete updatedWorkout.sessionSlot;
    }
    if ("locationName" in u) {
      const cleanLoc = u.locationName ? String(u.locationName).trim().slice(0, 120) : "";
      if (cleanLoc) updatedWorkout.locationName = cleanLoc;
      else delete updatedWorkout.locationName;
    }
    if ("locationCategory" in u) {
      const cleanCat = sanitizePracticeVenueCategory(u.locationCategory ?? void 0);
      if (cleanCat) updatedWorkout.locationCategory = cleanCat;
      else delete updatedWorkout.locationCategory;
    }
    if ("meetingNotes" in u) {
      const cleanNotes = u.meetingNotes ? String(u.meetingNotes).trim().slice(0, 240) : "";
      if (cleanNotes) updatedWorkout.meetingNotes = cleanNotes;
      else delete updatedWorkout.meetingNotes;
    }
    doc.broadcastWorkouts = [
      ...list.slice(0, targetIdx),
      updatedWorkout,
      ...list.slice(targetIdx + 1)
    ];
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function deleteBroadcastPlanBlockFromTeam(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const cleanBlockId = String(params.blockId || "").trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.planBlockId !== cleanBlockId
    );
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function deleteBroadcastWorkoutFromTeam(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const cleanBroadcastId = String(params.broadcastId || "").trim();
    doc.broadcastWorkouts = (doc.broadcastWorkouts || []).filter(
      (bw) => bw.broadcastId !== cleanBroadcastId
    );
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
}
async function recordCoachStopwatchActivities(params) {
  const archiveQueue = [];
  const summary = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(params.teamId),
      null
    );
    if (!doc) return null;
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return null;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    for (const entry of params.entries || []) {
      const cleanId = String(entry?.membershipId || "").trim();
      const rawAct = entry?.activity;
      if (!cleanId || !rawAct || !rawAct.id) continue;
      const mem = doc.memberships.find(
        (m) => m.membershipId === cleanId && m.status !== "REVOKED"
      );
      if (!mem) continue;
      const enforceHideWeight = Boolean(doc.brand.defaultSafeSportShield || mem.isMinorU18);
      const cleanList = sanitizeTelemetryForCleanRoom({ activities: [rawAct] }).activities || [];
      const safeAct = enforceHideWeight ? stripSafeSportWeightAndBodyCompFields(cleanList, { maskWellnessWeightKgZero: true })[0] : cleanList[0];
      if (!safeAct) continue;
      const prevRecorded = Array.isArray(mem.coachRecordedActivities) ? mem.coachRecordedActivities : [];
      mem.coachRecordedActivities = [
        safeAct,
        ...prevRecorded.filter((a) => a.id !== safeAct.id)
      ].slice(0, 50);
      archiveQueue.push({ member: { ...mem }, activity: safeAct });
      const baseSnap = mem.liveSnapshot || {
        updatedAt: nowIso,
        hasConnectedWatch: false,
        verdictLabel: "Coach Track Session",
        readinessScore: 80,
        ctl: 0,
        atl: 0,
        tsb: 0,
        acuteLoad7d: 0,
        lowAerobicPct: 80,
        highAerobicPct: 15,
        neuromuscularPct: 5,
        caraHours7d: 0,
        safeSportHideWeight: enforceHideWeight,
        sharingTier: mem.sharingTier || "SUMMARY_ONLY",
        activities: []
      };
      const prevSnapActs = Array.isArray(baseSnap.activities) ? baseSnap.activities : [];
      mem.liveSnapshot = {
        ...baseSnap,
        updatedAt: nowIso,
        safeSportHideWeight: baseSnap.safeSportHideWeight || enforceHideWeight,
        activities: [safeAct, ...prevSnapActs.filter((a) => a.id !== safeAct.id)].slice(0, 30)
      };
    }
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
    return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
  });
  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(item.member, [item.activity]).catch(() => void 0);
  }
  return summary;
}
function buildConsentedCoachActivities(rawActivities, sharingTier, allowGpsRoutes) {
  if (!Array.isArray(rawActivities) || sharingTier === "LOAD_ONLY") {
    return [];
  }
  const sortedNewestFirst = [...rawActivities].sort(
    (a, b) => String(b?.startDateLocal || "").localeCompare(String(a?.startDateLocal || ""))
  );
  const newest25 = sortedNewestFirst.slice(0, 25);
  const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
    activities: newest25
  });
  const cleanRoomActivities = Array.isArray(cleanRoomPayload.activities) ? cleanRoomPayload.activities : [];
  const firstPartyIds = new Set(
    cleanRoomActivities.map((a) => String(a?.id || ""))
  );
  const sourceList = cleanRoomActivities;
  return sourceList.map((act) => {
    const isFirstParty = firstPartyIds.has(String(act.id || ""));
    const includeGps = sharingTier === "FULL_STREAMS" && allowGpsRoutes && isFirstParty;
    const sanitized = {
      ...act,
      // Always strip Strava social/segment/gear payloads from cross-user coach snapshots (Strava Nov 2024 Developer Agreement Sec 5.3)
      kudoers: void 0,
      comments: void 0,
      segmentEfforts: [],
      gearName: isFirstParty ? act.gearName : void 0,
      summaryPolyline: includeGps ? act.summaryPolyline : void 0,
      routeLatLngs: includeGps ? act.routeLatLngs : void 0,
      startLatLng: includeGps ? act.startLatLng : void 0,
      endLatLng: includeGps ? act.endLatLng : void 0,
      streams: sharingTier === "FULL_STREAMS" && isFirstParty ? act.streams : void 0
    };
    return sanitized;
  });
}
async function syncAthleteSnapshotAcrossTeams(params) {
  const userIdx = await loadTenantVaultAsync(
    userTeamsVaultKey(params.callerSid),
    {
      teamIds: [],
      updatedAt: ""
    }
  );
  if (userIdx.teamIds.length === 0) return [];
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const summaries = [];
  for (const teamId of userIdx.teamIds) {
    const proj = await withTeamRowLock(teamId, async () => {
      const doc = await loadTenantVaultAsync(
        teamDocVaultKey(teamId),
        null
      );
      if (!doc) return null;
      const mem = doc.memberships.find(
        (m) => m.userSid === params.callerSid && m.status !== "REVOKED" && m.status !== "ALUMNI"
      );
      if (!mem) return null;
      const canonicalBirthMonthYear = mem.birthMonthYear || params.verifiedUserBirthMonthYear || (mem.isMinorU18 || mem.birthYear ? void 0 : params.snapshot.birthMonthYear);
      const ageCompliance = resolveAthleteAgeTier({
        birthMonthYear: canonicalBirthMonthYear,
        birthYear: mem.birthYear,
        orgType: doc.brand.orgType,
        graduationYear: mem.graduationYear,
        now: nowIso
      });
      if (ageCompliance.shouldAutoGraduateHs) {
        mem.status = "ALUMNI";
        mem.graduatedAt = nowIso;
        mem.liveSnapshot = void 0;
        doc.updatedAt = nowIso;
        await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
        return null;
      }
      const effectiveIsMinor = ageCompliance.ageTier === "UNKNOWN" ? Boolean(mem.isMinorU18) : ageCompliance.isMinorU18;
      mem.isMinorU18 = effectiveIsMinor;
      if (ageCompliance.birthMonthYear && !mem.birthMonthYear) {
        mem.birthMonthYear = ageCompliance.birthMonthYear;
      }
      if (ageCompliance.ageTier === "ADULT_18_PLUS" && mem.parentConsentStatus === "PENDING") {
        mem.parentConsentStatus = "NOT_REQUIRED";
        mem.parentConsentToken = void 0;
        mem.parentConsentTokenHash = void 0;
      }
      const quarantineMinorPendingConsent = Boolean(
        effectiveIsMinor && mem.parentConsentStatus !== "ACKNOWLEDGED"
      );
      let effectiveTier = quarantineMinorPendingConsent ? "LOAD_ONLY" : params.snapshot.sharingTier || mem.sharingTier || "SUMMARY_ONLY";
      if (params.snapshot.sharingTier && !quarantineMinorPendingConsent) {
        mem.sharingTier = params.snapshot.sharingTier;
      } else if (!mem.sharingTier) {
        mem.sharingTier = effectiveTier;
      }
      const enforceHideWeight = Boolean(
        doc.brand.defaultSafeSportShield || effectiveIsMinor || params.snapshot.safeSportHideWeight
      );
      const priv = params.snapshot.privacySettings;
      const hidePrivateWellness = priv?.shareWellnessAndHrv === "PRIVATE";
      const allowGpsRoutes = !priv || priv.shareGpsRoutes !== "PRIVATE" && !priv.stravaComplianceShield;
      const rawCoachActivities = buildConsentedCoachActivities(
        params.snapshot.activities,
        effectiveTier,
        allowGpsRoutes
      );
      const coachActivities = enforceHideWeight ? stripSafeSportWeightAndBodyCompFields(rawCoachActivities, {
        maskWellnessWeightKgZero: true
      }) : rawCoachActivities;
      const rawSanitizedWellness = quarantineMinorPendingConsent || hidePrivateWellness || !Array.isArray(params.snapshot.wellnessDays) ? void 0 : params.snapshot.wellnessDays.slice(-56);
      const sanitizedWellness = rawSanitizedWellness && enforceHideWeight ? stripSafeSportWeightAndBodyCompFields(rawSanitizedWellness, {
        maskWellnessWeightKgZero: true
      }) : rawSanitizedWellness;
      const watchReport = evaluateSafeSportPatternWatch({
        activities: params.snapshot.activities || [],
        wellnessDays: rawSanitizedWellness,
        isMinorU18: effectiveIsMinor,
        hasParentGuardianCc: Boolean(mem.parentGuardianEmail && effectiveIsMinor),
        hasAthleticTrainer: doc.brand.orgType === "HIGH_SCHOOL" || doc.brand.orgType === "COLLEGIATE"
      });
      if (params.athleteName?.trim() && mem.invitedName === "Team Athlete") {
        mem.invitedName = params.athleteName.trim().slice(0, 64);
      }
      const sanitizedCheckIns = quarantineMinorPendingConsent || hidePrivateWellness ? void 0 : Array.isArray(params.snapshot.sessionCheckIns) ? params.snapshot.sessionCheckIns.slice(0, 28).map((c) => {
        const validArea = c?.painArea === "KNEE" || c?.painArea === "SHIN" || c?.painArea === "ACHILLES" || c?.painArea === "HAMSTRING" || c?.painArea === "HIP" || c?.painArea === "FOOT" || c?.painArea === "BACK" || c?.painArea === "OTHER" ? c.painArea : void 0;
        const validLegFeel = c?.legFeel === "FRESH" || c?.legFeel === "NORMAL" || c?.legFeel === "HEAVY" ? c.legFeel : void 0;
        const validRitualSlot = c?.ritualSlot === "MORNING" || c?.ritualSlot === "POST_SESSION" || c?.ritualSlot === "TONIGHT" ? c.ritualSlot : void 0;
        const rawSleepTarget = Number(c?.sleepTargetHours);
        const validSleepTarget = Number.isFinite(rawSleepTarget) && rawSleepTarget >= 5 && rawSleepTarget <= 12 ? Number(rawSleepTarget.toFixed(1)) : void 0;
        return {
          id: String(c?.id || `chk-${Date.now()}`).slice(0, 64),
          date: String(c?.date || nowIso.slice(0, 10)).slice(0, 10),
          ...c?.plannedEventId ? { plannedEventId: String(c.plannedEventId).slice(0, 64) } : {},
          ...c?.workoutName ? { workoutName: String(c.workoutName).slice(0, 100) } : {},
          rpe: Math.max(1, Math.min(10, Math.round(Number(c?.rpe) || 5))),
          painFlag: Boolean(c?.painFlag),
          ...validArea ? { painArea: validArea } : {},
          ...c?.sorenessNote ? { sorenessNote: String(c.sorenessNote).slice(0, 140) } : {},
          ...c?.autoSwappedToRecovery ? { autoSwappedToRecovery: true } : {},
          ...validLegFeel ? { legFeel: validLegFeel } : {},
          ...c?.lifeStressFlag ? { lifeStressFlag: true } : {},
          ...validSleepTarget ? { sleepTargetHours: validSleepTarget } : {},
          ...c?.tomorrowLocked ? { tomorrowLocked: true } : {},
          ...validRitualSlot ? { ritualSlot: validRitualSlot } : {},
          createdAt: String(c?.createdAt || nowIso).slice(0, 40)
        };
      }) : mem.liveSnapshot?.sessionCheckIns;
      const assembledSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: Boolean(params.snapshot.hasConnectedWatch),
        verdictLabel: quarantineMinorPendingConsent ? "Awaiting Parent Consent" : String(params.snapshot.verdictLabel || "Active").slice(0, 48),
        readinessScore: quarantineMinorPendingConsent ? 0 : Number(params.snapshot.readinessScore ?? 0),
        ctl: Number(params.snapshot.ctl ?? 0),
        atl: Number(params.snapshot.atl ?? 0),
        tsb: Number(params.snapshot.tsb ?? 0),
        acuteLoad7d: Number(params.snapshot.acuteLoad7d ?? 0),
        lowAerobicPct: Number(params.snapshot.lowAerobicPct ?? 0),
        highAerobicPct: Number(params.snapshot.highAerobicPct ?? 0),
        neuromuscularPct: Number(params.snapshot.neuromuscularPct ?? 0),
        caraHours7d: Number(params.snapshot.caraHours7d ?? 0),
        ftpWatts: params.snapshot.ftpWatts,
        thresholdPaceSecsPerKm: params.snapshot.thresholdPaceSecsPerKm,
        safeSportHideWeight: enforceHideWeight,
        sharingTier: effectiveTier,
        privacySettings: priv,
        wellnessDays: sanitizedWellness,
        activities: coachActivities,
        ...sanitizedCheckIns && sanitizedCheckIns.length > 0 ? { sessionCheckIns: sanitizedCheckIns } : {},
        safeSportWatch: {
          trafficLight: watchReport.trafficLight,
          coachSafeSummaryLabel: watchReport.coachSafeSummaryLabel,
          privateAlertForSelfAndParentOnly: watchReport
        }
      };
      mem.liveSnapshot = enforceHideWeight ? stripSafeSportWeightAndBodyCompFields(assembledSnapshot, {
        maskWellnessWeightKgZero: true
      }) : assembledSnapshot;
      const latestPainCheckIn = Array.isArray(params.snapshot.sessionCheckIns) ? params.snapshot.sessionCheckIns.find((c) => Boolean(c?.painFlag)) : void 0;
      if (latestPainCheckIn && (effectiveIsMinor || doc.brand.orgType === "HIGH_SCHOOL")) {
        const painCheckInId = String(latestPainCheckIn.id || "").slice(0, 64);
        const existingAlerts = Array.isArray(doc.guardianSafetyAlerts) ? doc.guardianSafetyAlerts : [];
        const alreadyRecorded = Boolean(painCheckInId) && existingAlerts.some(
          (a) => a.sourceCheckInId === painCheckInId && a.targetMembershipId === mem.membershipId
        );
        if (!alreadyRecorded) {
          const painArea = latestPainCheckIn.painArea || "OTHER";
          const guardianEmail = mem.parentGuardianEmail?.trim().toLowerCase();
          let deliveryStatus = guardianEmail ? "LOCAL_LOGGED" : "NO_GUARDIAN_ON_FILE";
          const alertSummary = `${mem.invitedName} flagged ${painArea} pain (${latestPainCheckIn.autoSwappedToRecovery ? "auto-swapped to low-impact recovery" : "safety review requested"}).`;
          if (guardianEmail && isResendConfigured()) {
            const sendRes = await sendEmailViaResend({
              to: guardianEmail,
              subject: `[THRESH Safety Alert] ${mem.invitedName} \xB7 ${doc.brand.shortName}`,
              html: `<p>${escapeHtml(alertSummary)}</p><p>Logged inside ${escapeHtml(doc.brand.name)} under U18 Safe-Sport &amp; Guardian visibility.</p>`,
              text: `${alertSummary}
Team: ${doc.brand.name}`
            });
            deliveryStatus = sendRes.delivered ? "SENT" : "LOCAL_LOGGED";
          }
          const alertRecord = {
            id: `gsa_${crypto6.randomBytes(6).toString("hex")}`,
            teamId: doc.brand.teamId,
            targetMembershipId: mem.membershipId,
            athleteName: mem.invitedName,
            ...painCheckInId ? { sourceCheckInId: painCheckInId } : {},
            severity: "CAUTION",
            category: "PAIN_FLAG",
            summary: alertSummary,
            painLocation: painArea,
            guardianEmailMasked: maskEmailForDisplay(guardianEmail),
            deliveryStatus,
            createdAt: nowIso
          };
          doc.guardianSafetyAlerts = [alertRecord, ...existingAlerts].slice(0, 120);
          await appendAuditLogAsync({
            teamId: doc.brand.teamId,
            actorSid: params.callerSid,
            action: "GUARDIAN_SAFETY_ALERT",
            targetId: mem.membershipId,
            metadata: {
              category: alertRecord.category,
              painLocation: painArea,
              deliveryStatus
            }
          });
        }
      }
      doc.updatedAt = nowIso;
      await saveTeamDocRaw(teamId, doc);
      return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    });
    if (proj) summaries.push(proj);
  }
  return summaries;
}
async function recordGuardianSafetyAlert(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem) return { ok: false, error: "Not a member of this team." };
    const target = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== "REVOKED"
    );
    if (!target) return { ok: false, error: "Target athlete not found." };
    const isSelf = target.userSid === params.callerSid;
    if (!isSelf && !canViewSafeguardingMedicalRole(callerMem.role)) {
      return { ok: false, error: "Coach or Athletic Trainer permission required." };
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const guardianEmail = target.parentGuardianEmail?.trim().toLowerCase();
    const cleanSummary = String(params.summary || "").trim().slice(0, 280);
    if (!cleanSummary) {
      return { ok: false, error: "Safety alert summary is required." };
    }
    let deliveryStatus = guardianEmail ? "LOCAL_LOGGED" : "NO_GUARDIAN_ON_FILE";
    if (guardianEmail && isResendConfigured()) {
      const sendRes = await sendEmailViaResend({
        to: guardianEmail,
        subject: `[THRESH Safety Alert] ${target.invitedName} \xB7 ${doc.brand.shortName}`,
        html: `<p>${escapeHtml(cleanSummary)}</p><p>Reported via ${escapeHtml(doc.brand.name)} Safeguarding Desk.</p>`,
        text: `${cleanSummary}
Team: ${doc.brand.name}`
      });
      deliveryStatus = sendRes.delivered ? "SENT" : "LOCAL_LOGGED";
    }
    const alertRecord = {
      id: `gsa_${crypto6.randomBytes(6).toString("hex")}`,
      teamId: doc.brand.teamId,
      targetMembershipId: target.membershipId,
      athleteName: target.invitedName,
      severity: params.severity === "HIGH" ? "HIGH" : "CAUTION",
      category: params.category === "HIGH_STRAIN" || params.category === "SAFE_SPORT_WATCH" ? params.category : "PAIN_FLAG",
      summary: cleanSummary,
      ...params.painLocation ? { painLocation: String(params.painLocation).trim().slice(0, 32) } : {},
      guardianEmailMasked: maskEmailForDisplay(guardianEmail),
      deliveryStatus,
      createdAt: nowIso
    };
    doc.guardianSafetyAlerts = [alertRecord, ...doc.guardianSafetyAlerts || []].slice(0, 120);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "GUARDIAN_SAFETY_ALERT",
      targetId: target.membershipId,
      metadata: {
        category: alertRecord.category,
        severity: alertRecord.severity,
        deliveryStatus
      }
    });
    return {
      ok: true,
      alert: alertRecord,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function listTeamWorkoutLibrary(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, error: "Team not found." };
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem) return { ok: false, error: "Membership required." };
  return { ok: true, templates: doc.workoutLibrary || [] };
}
async function saveTeamWorkoutLibraryTemplate(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: "Only Head or Assistant Coaches may edit the team Workout Library."
      };
    }
    const cleanName = String(params.template.name || "").trim().slice(0, 100);
    if (!cleanName) {
      return { ok: false, status: 400, error: "Template name is required." };
    }
    const validCat = params.template.category === "TRACK" || params.template.category === "XC_TEMPO" || params.template.category === "ROAD" || params.template.category === "CYCLING" || params.template.category === "RECOVERY" ? params.template.category : "TRACK";
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const id = params.template.id ? String(params.template.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) : `wlib_${crypto6.randomBytes(6).toString("hex")}`;
    const record = {
      id: id || `wlib_${crypto6.randomBytes(6).toString("hex")}`,
      name: cleanName,
      category: validCat,
      sportCategory: params.template.sportCategory || "Running",
      workoutSyntax: String(params.template.workoutSyntax || "").slice(0, 3e3),
      description: String(params.template.description || "").slice(0, 1e3),
      plannedDurationSecs: Math.max(300, Number(params.template.plannedDurationSecs) || 2400),
      plannedLoad: Math.max(5, Number(params.template.plannedLoad) || 55),
      ...params.template.trackSpec ? { trackSpec: params.template.trackSpec } : {},
      createdByName: callerMem.invitedName || doc.brand.coachDisplayName,
      createdAt: nowIso
    };
    const existing = Array.isArray(doc.workoutLibrary) ? doc.workoutLibrary : [];
    doc.workoutLibrary = [record, ...existing.filter((t) => t.id !== record.id)].slice(0, 120);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "WORKOUT_LIBRARY_SAVED",
      targetId: record.id,
      metadata: { name: record.name, category: record.category }
    });
    return {
      ok: true,
      template: record,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function deleteTeamWorkoutLibraryTemplate(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || !canProgramWorkoutsRole(callerMem.role)) {
      return {
        ok: false,
        status: 403,
        error: "Only Head or Assistant Coaches may delete Workout Library templates."
      };
    }
    const cleanId = String(params.templateId || "").trim();
    doc.workoutLibrary = (doc.workoutLibrary || []).filter((t) => t.id !== cleanId);
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "WORKOUT_LIBRARY_DELETED",
      targetId: cleanId,
      metadata: {}
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function listTeamWorkoutComments(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, error: "Team not found." };
  const summary = projectTeamSummaryForCaller(doc, params.callerSid, "https://thresh.app");
  if (!summary) return { ok: false, error: "Membership required." };
  const allVisible = summary.workoutComments || [];
  const filtered = params.targetMembershipId ? allVisible.filter((c) => c.targetMembershipId === params.targetMembershipId) : allVisible;
  return { ok: true, comments: filtered };
}
async function postTeamWorkoutComment(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, status: 404, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem) {
      return { ok: false, status: 403, error: "Membership required to post workout comments." };
    }
    const targetMem = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== "REVOKED"
    );
    if (!targetMem) {
      return { ok: false, status: 404, error: "Target athlete not found." };
    }
    const isSelf = targetMem.userSid === params.callerSid;
    const isStaff = canViewSafeguardingMedicalRole(callerMem.role);
    if (!isSelf && !isStaff) {
      return {
        ok: false,
        status: 403,
        error: "Only coaching/medical staff or the athlete may post workout comments."
      };
    }
    const targetIsProtectedMinor = Boolean(
      targetMem.isMinorU18 || doc.brand.orgType === "HIGH_SCHOOL"
    );
    if (targetIsProtectedMinor && (params.privateDirectToMinor === true || params.guardianCc === false)) {
      return {
        ok: false,
        status: 403,
        error: "SafeSport policy requires parent/guardian visibility on all youth athlete workout comments."
      };
    }
    const cleanBody = String(params.body || "").trim().slice(0, 600);
    if (!cleanBody) {
      return { ok: false, status: 400, error: "Comment text is required." };
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const guardianCcApplied = Boolean(
      targetIsProtectedMinor || doc.brand.enableParentGuardianCc && targetMem.parentGuardianEmail
    );
    const comment = {
      id: `cmt_${crypto6.randomBytes(6).toString("hex")}`,
      teamId: doc.brand.teamId,
      targetMembershipId: targetMem.membershipId,
      targetAthleteName: targetMem.invitedName,
      ...params.activityId ? { activityId: String(params.activityId).slice(0, 80) } : {},
      workoutDate: String(params.workoutDate || nowIso.slice(0, 10)).slice(0, 10),
      authorSid: params.callerSid,
      authorName: callerMem.invitedName || doc.brand.coachDisplayName,
      authorRole: callerMem.role,
      body: cleanBody,
      guardianCcApplied,
      guardianVisible: true,
      createdAt: nowIso
    };
    if (guardianCcApplied && targetMem.parentGuardianEmail && callerMem.userSid !== targetMem.userSid && isResendConfigured()) {
      void sendEmailViaResend({
        to: targetMem.parentGuardianEmail,
        subject: `[THRESH Guardian CC] Coach note for ${targetMem.invitedName}`,
        html: `<p><strong>${escapeHtml(comment.authorName)}</strong> commented on ${escapeHtml(targetMem.invitedName)}&apos;s ${escapeHtml(comment.workoutDate)} workout:</p><blockquote>${escapeHtml(cleanBody)}</blockquote>`,
        text: `${comment.authorName} commented on ${targetMem.invitedName}'s ${comment.workoutDate} workout: ${cleanBody}`
      });
    }
    doc.workoutComments = [comment, ...doc.workoutComments || []].slice(0, 300);
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "WORKOUT_COMMENT_POSTED",
      targetId: targetMem.membershipId,
      metadata: {
        guardianCcApplied,
        workoutDate: comment.workoutDate
      }
    });
    return {
      ok: true,
      comment,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function getTeamGovernanceAuditLog(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) return { ok: false, status: 404, error: "Team not found." };
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem || !canViewAuditLogRole(callerMem.role)) {
    return {
      ok: false,
      status: 403,
      error: "Audit log access requires HEAD_COACH or ORG_ADMIN role."
    };
  }
  const entries = await listTeamAuditLogAsync(params.teamId, params.limit ?? 100);
  return { ok: true, entries };
}

// server/teamLifecycleService.ts
function sanitizeMemberPublicNameForDeletion(m) {
  m.userSid = void 0;
  m.stravaAthleteId = void 0;
  m.invitedEmail = void 0;
  m.invitedPhone = void 0;
  m.parentGuardianEmail = void 0;
  m.parentConsentToken = void 0;
  m.parentConsentTokenHash = void 0;
  m.liveSnapshot = void 0;
  m.rawInviteToken = void 0;
  m.inviteTokenHash = void 0;
}
async function leaveOrGraduateTeam(params) {
  const archiveQueue = [];
  const result = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!mem) return { ok: false, error: "Membership not found on this team." };
    if (mem.role === "HEAD_COACH") {
      const otherActive = doc.memberships.filter(
        (m) => m.membershipId !== mem.membershipId && m.status !== "REVOKED" && m.status !== "ALUMNI"
      );
      if (otherActive.length > 0) {
        return {
          ok: false,
          error: "Transfer Head Coach ownership to another staff member before leaving an active team."
        };
      }
    }
    if (Array.isArray(mem.coachRecordedActivities) && mem.coachRecordedActivities.length > 0) {
      archiveQueue.push({
        member: {
          ...mem,
          userSid: mem.userSid || params.callerSid,
          ...params.stravaAthleteId ? { stravaAthleteId: params.stravaAthleteId } : {}
        },
        activities: mem.coachRecordedActivities
      });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    mem.liveSnapshot = void 0;
    mem.parentGuardianEmail = void 0;
    mem.parentConsentToken = void 0;
    mem.parentConsentTokenHash = void 0;
    if (params.mode === "GRADUATE_ALUMNI") {
      mem.status = "ALUMNI";
      mem.graduatedAt = nowIso;
    } else {
      mem.status = "REVOKED";
      mem.leftAt = nowIso;
      mem.coachRecordedActivities = void 0;
    }
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await removeTeamFromUserIndex(params.callerSid, params.teamId);
    return { ok: true };
  });
  for (const item of archiveQueue) {
    await archiveCoachActivitiesForMember(
      { ...item.member, userId: params.userId },
      item.activities
    ).catch(() => void 0);
  }
  return result;
}
async function revokeAthleteGuardianConsentForTeam(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!mem) return { ok: false, error: "Membership not found." };
    const canonicalBmy = mem.birthMonthYear || params.verifiedUserBirthMonthYear || (mem.isMinorU18 && !mem.birthYear ? void 0 : params.birthMonthYear);
    const ageCheck = resolveAthleteAgeTier({
      birthMonthYear: canonicalBmy,
      birthYear: mem.birthYear,
      orgType: doc.brand.orgType,
      graduationYear: mem.graduationYear
    });
    const effectiveMinor = ageCheck.ageTier === "UNKNOWN" ? Boolean(mem.isMinorU18) : ageCheck.isMinorU18;
    if (effectiveMinor) {
      return {
        ok: false,
        error: "Parent/guardian contact can be removed once you reach 18 years of age."
      };
    }
    mem.isMinorU18 = false;
    mem.parentGuardianEmail = void 0;
    mem.parentConsentToken = void 0;
    mem.parentConsentTokenHash = void 0;
    mem.parentConsentStatus = "NOT_REQUIRED";
    if (canonicalBmy && !mem.birthMonthYear) {
      mem.birthMonthYear = canonicalBmy;
    }
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "GUARDIAN_CONSENT_REVOKED",
      targetId: mem.membershipId,
      metadata: { reason: "ADULT_18_PLUS" }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function updateMyTeamSharingTier(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED" && m.status !== "ALUMNI"
    );
    if (!mem) return { ok: false, error: "Active team membership not found." };
    if (mem.isMinorU18 && mem.parentConsentStatus !== "ACKNOWLEDGED" && params.sharingTier !== "LOAD_ONLY") {
      return {
        ok: false,
        error: "Parent/guardian consent must be acknowledged before expanding sharing beyond Load & Readiness Only."
      };
    }
    mem.sharingTier = params.sharingTier;
    if (mem.liveSnapshot) {
      mem.liveSnapshot.sharingTier = params.sharingTier;
      if (params.sharingTier === "LOAD_ONLY") {
        mem.liveSnapshot.activities = [];
      }
    }
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "SHARING_TIER_CHANGED",
      targetId: mem.membershipId,
      metadata: { sharingTier: params.sharingTier }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function updateMemberRosterLifecycleStatus(params) {
  let archiveTarget = null;
  let detachSid;
  const outcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
      return { ok: false, error: "Coach permissions required." };
    }
    const target = doc.memberships.find((m) => m.membershipId === params.membershipId);
    if (!target) return { ok: false, error: "Member not found." };
    if (target.role === "HEAD_COACH") {
      return { ok: false, error: "Cannot remove or archive the Head Coach directly." };
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if ((params.status === "ALUMNI" || params.status === "REVOKED") && Array.isArray(target.coachRecordedActivities) && target.coachRecordedActivities.length > 0) {
      archiveTarget = {
        member: { ...target },
        activities: target.coachRecordedActivities
      };
    }
    target.status = params.status;
    if (params.status === "ALUMNI") {
      target.graduatedAt = nowIso;
      target.liveSnapshot = void 0;
      detachSid = target.userSid;
    } else if (params.status === "REVOKED") {
      target.leftAt = nowIso;
      target.liveSnapshot = void 0;
      target.coachRecordedActivities = void 0;
      detachSid = target.userSid;
    }
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "MEMBER_REMOVED_OR_GRADUATED",
      targetId: target.membershipId,
      metadata: { status: params.status, targetName: target.invitedName }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
  if (archiveTarget) {
    const item = archiveTarget;
    await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => void 0);
  }
  if (detachSid) {
    await removeTeamFromUserIndex(detachSid, params.teamId).catch(() => void 0);
  }
  return outcome;
}
async function graduateTeamClass(params) {
  const archiveList = [];
  const res = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, graduatedCount: 0, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || callerMem.role !== "HEAD_COACH") {
      return { ok: false, graduatedCount: 0, error: "Head Coach permission required." };
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let count = 0;
    for (const m of doc.memberships) {
      if (m.role === "ATHLETE" && m.status !== "REVOKED" && m.status !== "ALUMNI" && m.graduationYear === params.graduationYear) {
        if (Array.isArray(m.coachRecordedActivities) && m.coachRecordedActivities.length > 0) {
          archiveList.push({ member: { ...m }, activities: m.coachRecordedActivities, sid: m.userSid });
        } else if (m.userSid) {
          archiveList.push({ member: { ...m }, activities: [], sid: m.userSid });
        }
        m.status = "ALUMNI";
        m.graduatedAt = nowIso;
        m.liveSnapshot = void 0;
        count += 1;
      }
    }
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(params.teamId, doc);
    return {
      ok: true,
      graduatedCount: count,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
  for (const item of archiveList) {
    if (item.activities.length > 0) {
      await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => void 0);
    }
    if (item.sid) {
      await removeTeamFromUserIndex(item.sid, params.teamId).catch(() => void 0);
    }
  }
  return res;
}
async function updateMemberRole(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ORG_ADMIN") {
      return { ok: false, error: "Only Head Coach or Org Admin can manage staff roles." };
    }
    const target = doc.memberships.find(
      (m) => m.membershipId === params.membershipId && m.status !== "REVOKED"
    );
    if (!target || target.role === "HEAD_COACH") {
      return { ok: false, error: "Target member cannot be reassigned." };
    }
    const prevRole = target.role;
    target.role = params.role;
    target.isMinorU18 = params.role !== "ATHLETE" ? false : target.isMinorU18;
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "ROLE_CHANGED",
      targetId: target.membershipId,
      metadata: { prevRole, nextRole: params.role, targetName: target.invitedName }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function transferTeamHeadCoachOwnership(params) {
  return withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const currentHead = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.role === "HEAD_COACH" && m.status !== "REVOKED"
    );
    if (!currentHead) {
      return { ok: false, error: "Only the current Head Coach can transfer ownership." };
    }
    const nextHead = doc.memberships.find(
      (m) => m.membershipId === params.newHeadCoachMembershipId && m.status === "ACTIVE" && Boolean(m.userSid)
    );
    if (!nextHead) {
      return {
        ok: false,
        error: "Successor must have an active signed-in THRESH membership."
      };
    }
    currentHead.role = "ASSISTANT_COACH";
    nextHead.role = "HEAD_COACH";
    nextHead.isMinorU18 = false;
    doc.brand.coachDisplayName = nextHead.invitedName || doc.brand.coachDisplayName;
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "OWNERSHIP_TRANSFERRED",
      targetId: nextHead.membershipId,
      metadata: { nextHeadName: nextHead.invitedName }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}
async function mergeDuplicateRosterMembers(params) {
  if (params.sourceMembershipId === params.targetMembershipId) {
    return { ok: false, error: "Source and target roster rows must be different." };
  }
  let archiveTarget = null;
  const outcome = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) return { ok: false, error: "Team not found." };
    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
      return { ok: false, error: "Coach permissions required." };
    }
    const source = doc.memberships.find((m) => m.membershipId === params.sourceMembershipId);
    const target = doc.memberships.find(
      (m) => m.membershipId === params.targetMembershipId && m.status !== "REVOKED"
    );
    if (!source || !target) return { ok: false, error: "Duplicate or target member not found." };
    const mergedActsMap = /* @__PURE__ */ new Map();
    for (const act of [
      ...target.coachRecordedActivities || [],
      ...source.coachRecordedActivities || []
    ]) {
      if (act?.id && !mergedActsMap.has(act.id)) {
        mergedActsMap.set(act.id, act);
      }
    }
    const mergedActivities = Array.from(mergedActsMap.values()).slice(0, 80);
    target.coachRecordedActivities = mergedActivities;
    if (!target.seedMarkOrFtp && source.seedMarkOrFtp) target.seedMarkOrFtp = source.seedMarkOrFtp;
    if (!target.externalSource && source.externalSource) target.externalSource = source.externalSource;
    if (!target.externalAthleteId && source.externalAthleteId) {
      target.externalAthleteId = source.externalAthleteId;
    }
    if (!target.externalProfileUrl && source.externalProfileUrl) {
      target.externalProfileUrl = source.externalProfileUrl;
    }
    if (!target.graduationYear && source.graduationYear) target.graduationYear = source.graduationYear;
    if (!target.genderDivision && source.genderDivision) target.genderDivision = source.genderDivision;
    for (const bw of doc.broadcastWorkouts || []) {
      if (Array.isArray(bw.targetMembershipIds)) {
        bw.targetMembershipIds = bw.targetMembershipIds.map(
          (id) => id === source.membershipId ? target.membershipId : id
        );
      }
      if (bw.athleteOverrides && bw.athleteOverrides[source.membershipId]) {
        if (!bw.athleteOverrides[target.membershipId]) {
          bw.athleteOverrides[target.membershipId] = bw.athleteOverrides[source.membershipId];
        }
        delete bw.athleteOverrides[source.membershipId];
      }
    }
    source.status = "REVOKED";
    source.leftAt = (/* @__PURE__ */ new Date()).toISOString();
    sanitizeMemberPublicNameForDeletion(source);
    source.coachRecordedActivities = void 0;
    if (mergedActivities.length > 0 && (target.userSid || target.invitedEmail || target.stravaAthleteId)) {
      archiveTarget = { member: { ...target }, activities: mergedActivities };
    }
    doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: "MEMBERS_MERGED",
      targetId: target.membershipId,
      metadata: { mergedSourceId: source.membershipId }
    });
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
  if (archiveTarget) {
    const item = archiveTarget;
    await archiveCoachActivitiesForMember(item.member, item.activities).catch(() => void 0);
  }
  return outcome;
}
async function previewParentConsentToken(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    return { ok: false, error: "Invalid or missing parent consent token." };
  }
  const targetHash = hashToken(cleanToken);
  const matchesToken = (m) => Boolean(
    m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash) || m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken)
  );
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const mem = doc.memberships.find(
      (m) => matchesToken(m) && m.status !== "REVOKED"
    );
    if (mem) {
      return {
        ok: true,
        athleteName: mem.invitedName,
        teamName: doc.brand.name,
        coachName: doc.brand.coachDisplayName,
        sport: doc.brand.primarySport,
        parentEmail: mem.parentGuardianEmail,
        alreadyAcknowledged: mem.parentConsentStatus === "ACKNOWLEDGED"
      };
    }
  }
  return { ok: false, error: "Invalid or expired parent consent link." };
}
async function declineAndPurgeParentConsent(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return { ok: false, error: "Invalid or missing parent consent token." };
  const targetHash = hashToken(cleanToken);
  const matchesToken = (m) => Boolean(
    m.parentConsentTokenHash && timingSafeStringEqual(m.parentConsentTokenHash, targetHash) || m.parentConsentToken && timingSafeStringEqual(m.parentConsentToken, cleanToken)
  );
  const dir = await loadDirectory();
  for (const teamId of dir.allTeamIds) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const targetMem = doc.memberships.find(
      (m) => matchesToken(m) && m.status !== "REVOKED"
    );
    if (!targetMem) continue;
    let detachedSid;
    const athleteName = targetMem.invitedName;
    const teamName = doc.brand.name;
    await withTeamRowLock(teamId, async () => {
      const freshDoc = await loadTeamDocRaw(teamId);
      if (!freshDoc) return;
      const mem = freshDoc.memberships.find((m) => matchesToken(m));
      if (!mem) return;
      detachedSid = mem.userSid;
      mem.status = "REVOKED";
      mem.leftAt = (/* @__PURE__ */ new Date()).toISOString();
      mem.invitedName = "Withdrawn Minor";
      sanitizeMemberPublicNameForDeletion(mem);
      mem.coachRecordedActivities = void 0;
      freshDoc.updatedAt = mem.leftAt;
      await saveTeamDocRaw(teamId, freshDoc);
      await appendAuditLogAsync({
        teamId,
        actorSid: "guardian",
        action: "PARENT_CONSENT_DECLINED",
        targetId: mem.membershipId,
        metadata: { originalName: athleteName }
      });
    });
    if (detachedSid) {
      await removeTeamFromUserIndex(detachedSid, teamId).catch(() => void 0);
    }
    return { ok: true, athleteName, teamName };
  }
  return { ok: false, error: "Invalid or expired parent consent link." };
}

// server/routers/teamRouter.ts
var teamRouter = express3.Router();
function resolveRequestOrigin(req) {
  const explicit = resolveSafeOrigin(
    String(req.body?.origin || req.query?.origin || "")
  );
  if (explicit) return explicit;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto === "https" || req.secure ? "https" : "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (host) {
    const candidate = resolveSafeOrigin(`${proto}://${host}`);
    if (candidate) return candidate;
  }
  return "https://thresh.app";
}
teamRouter.post("/api/auth/email/send-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const result = await requestEmailOtpCode(email);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error || "Unable to send OTP." });
      return;
    }
    res.json({
      ok: true,
      deliveryStatus: result.deliveryStatus,
      resendConfigured: isResendConfigured(),
      ...!isProductionDeployment() && result.devPreviewCode ? { devPreviewCode: result.devPreviewCode } : {}
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send verification code."
    });
  }
});
teamRouter.post("/api/auth/email/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const code = String(req.body?.code || "").trim();
    const currentClaims = getVerifiedSessionClaims(req);
    const result = await verifyEmailOtpCode(email, code, currentClaims?.sid);
    if (!result.ok || !result.sid) {
      res.status(400).json({ ok: false, error: result.error || "Invalid code." });
      return;
    }
    const sessionToken = setSessionCookie(
      req,
      res,
      result.displayName || result.email || "thresh-athlete",
      result.sid,
      "verified"
    );
    const originUrl = resolveRequestOrigin(req);
    const teams = await listTeamsForUser(result.sid, originUrl);
    res.json({
      ok: true,
      sessionToken,
      email: result.email,
      displayName: result.displayName,
      teams
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Verification failed."
    });
  }
});
teamRouter.get(["/api/teams/mine", "/api/teams"], async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.json({
        ok: true,
        resendConfigured: isResendConfigured(),
        teams: []
      });
      return;
    }
    if (claims.sub?.startsWith("usr_")) {
      const u = await getUserById(claims.sub);
      if (u?.email) {
        await autoLinkPendingTeamInvitesByEmail({
          email: u.email,
          userSid: claims.sid,
          athleteName: u.name
        });
      }
    }
    const originUrl = resolveRequestOrigin(req);
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      resendConfigured: isResendConfigured(),
      teams
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load teams."
    });
  }
});
teamRouter.post("/api/teams", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const team = await createTeamForCoach({
      callerSid: claims.sid,
      originUrl,
      name: String(req.body?.name || ""),
      shortName: req.body?.shortName ? String(req.body.shortName) : void 0,
      mascotOrMotto: req.body?.mascotOrMotto ? String(req.body.mascotOrMotto) : void 0,
      orgType: req.body?.orgType || "HIGH_SCHOOL",
      primarySport: req.body?.primarySport,
      primaryHex: req.body?.primaryHex,
      secondaryHex: req.body?.secondaryHex,
      logoDataUrl: req.body?.logoDataUrl,
      defaultSafeSportShield: req.body?.defaultSafeSportShield,
      enableParentGuardianCc: req.body?.enableParentGuardianCc,
      coachDisplayName: req.body?.coachDisplayName,
      coachEmail: req.body?.coachEmail,
      externalSync: req.body?.externalSync
    });
    res.json({
      ok: true,
      resendConfigured: isResendConfigured(),
      team
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create team."
    });
  }
});
teamRouter.put("/api/teams/:teamId", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await updateTeamBranding({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      updates: req.body || {}
    });
    if (!updated) {
      res.status(403).json({
        ok: false,
        error: "Only team coaches can modify team branding and safeguarding settings."
      });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update team."
    });
  }
});
teamRouter.post("/api/teams/:teamId/invites/bulk", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await bulkCreateAndSendInvites({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      rawCsvOrText: req.body?.rawCsvOrText,
      rows: Array.isArray(req.body?.rows) ? req.body.rows : void 0,
      sendEmailsNow: req.body?.sendEmailsNow !== false
    });
    if (!result.summary) {
      res.status(403).json({
        ok: false,
        error: "Coach permissions required to invite athletes to this team."
      });
      return;
    }
    res.json({
      ok: true,
      team: result.summary,
      addedCount: result.addedCount,
      emailedCount: result.emailedCount,
      manualLinkCount: result.manualLinkCount,
      resendConfigured: result.resendConfigured
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to process bulk invites."
    });
  }
});
teamRouter.post("/api/teams/:teamId/invites/resend", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await resendPendingTeamInvites({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      membershipId: req.body?.membershipId ? String(req.body.membershipId) : "ALL_PENDING"
    });
    if (!result.summary) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    res.json({
      ok: true,
      team: result.summary,
      emailedCount: result.emailedCount,
      resendConfigured: result.resendConfigured
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to resend invites."
    });
  }
});
teamRouter.get("/api/teams/join-preview", async (req, res) => {
  try {
    const codeOrSlug = String(req.query.codeOrSlug || "").trim();
    const token = req.query.t ? String(req.query.t).trim() : void 0;
    let verifiedCallerEmail;
    const claims = getVerifiedSessionClaims(req);
    if (isCanonicalAuthenticatedClaims(claims) && claims?.sub?.startsWith("usr_")) {
      const u = await getUserById(claims.sub);
      if (u?.email) verifiedCallerEmail = u.email;
    }
    const preview = await previewTeamJoinInvite(codeOrSlug, token, verifiedCallerEmail);
    res.json(preview);
  } catch (err) {
    res.status(400).json({
      found: false,
      error: err instanceof Error ? err.message : "Failed to preview invite."
    });
  }
});
teamRouter.post("/api/teams/join-claim", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Please sign in before joining a team." });
      return;
    }
    const athleteName = String(req.body?.athleteName || "").trim();
    const originUrl = resolveRequestOrigin(req);
    const rawUnit = String(req.body?.distanceUnit || "").toLowerCase();
    const distanceUnit = rawUnit === "km" ? "km" : "mi";
    const rawTier = String(req.body?.sharingTier || "").toUpperCase();
    const sharingTier = rawTier === "FULL_STREAMS" || rawTier === "LOAD_ONLY" ? rawTier : "SUMMARY_ONLY";
    let user = claims.sub?.startsWith("usr_") ? await getUserById(claims.sub) : claims.sub ? await getUserByProvider("strava", claims.sub) : null;
    const verifiedEmail = user?.email ? user.email.trim().toLowerCase() : void 0;
    const verifiedBirthMonthYear = user?.birthMonthYear;
    const store = getScopedRuntimeStore(req);
    const stravaFromUser = user?.authProviders?.find((p) => p.provider === "strava")?.providerId || user?.connectedServices?.find((s) => s.service === "strava")?.athleteId;
    const verifiedStravaId = (store?.stravaAthleteId ? String(store.stravaAthleteId).trim() : "") || (stravaFromUser ? String(stravaFromUser).trim() : "") || (!claims.sub?.startsWith("usr_") && /^\d+$/.test(claims.sub || "") ? claims.sub : "") || void 0;
    const claimed = await claimTeamJoinInvite({
      callerSid: claims.sid,
      originUrl,
      codeOrSlug: String(req.body?.codeOrSlug || "").trim(),
      inviteToken: req.body?.inviteToken ? String(req.body.inviteToken).trim() : void 0,
      athleteName: athleteName || user?.name || void 0,
      athleteEmail: verifiedEmail,
      stravaAthleteId: verifiedStravaId,
      squadGroup: req.body?.squadGroup ? String(req.body.squadGroup) : void 0,
      seedMarkOrFtp: req.body?.seedMarkOrFtp ? String(req.body.seedMarkOrFtp) : void 0,
      distanceUnit,
      sharingTier,
      birthYear: verifiedBirthMonthYear ? Number(verifiedBirthMonthYear.slice(0, 4)) : typeof req.body?.birthYear === "number" ? req.body.birthYear : req.body?.birthYear ? Number(req.body.birthYear) : void 0,
      birthMonthYear: verifiedBirthMonthYear || (req.body?.birthMonthYear ? String(req.body.birthMonthYear).trim() : void 0),
      graduationYear: typeof req.body?.graduationYear === "number" ? req.body.graduationYear : req.body?.graduationYear ? Number(req.body.graduationYear) : void 0,
      parentGuardianEmail: req.body?.parentGuardianEmail ? String(req.body.parentGuardianEmail).trim() : void 0
    });
    if (!claimed.ok || !claimed.summary) {
      const isValidationError = Boolean(claimed.error) && /COPPA|13 or older|Parent or guardian email/i.test(claimed.error || "");
      res.status(isValidationError ? 400 : 404).json({
        ok: false,
        error: claimed.error || "Team invite could not be claimed."
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({
      ok: true,
      team: claimed.summary,
      teams,
      calibrated: claimed.calibrated,
      safeSportShieldEnforced: claimed.safeSportShieldEnforced
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to join team."
    });
  }
});
teamRouter.post("/api/teams/sync-snapshot", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.json({ ok: true, teams: [] });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const verifiedUser = claims.sub?.startsWith("usr_") ? await getUserById(claims.sub).catch(() => null) : null;
    const mergedSnapshot = {
      ...req.body?.snapshot || {},
      ...req.body?.privacySettings && !req.body?.snapshot?.privacySettings ? { privacySettings: req.body.privacySettings } : {}
    };
    const teams = await syncAthleteSnapshotAcrossTeams({
      callerSid: claims.sid,
      originUrl,
      athleteName: req.body?.athleteName ? String(req.body.athleteName) : void 0,
      verifiedUserBirthMonthYear: verifiedUser?.birthMonthYear,
      snapshot: mergedSnapshot
    });
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to sync team snapshot."
    });
  }
});
teamRouter.post("/api/teams/:teamId/workouts/broadcast", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds) ? req.body.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
    const targetEventGroups = Array.isArray(req.body?.targetEventGroups) ? req.body.targetEventGroups.filter(
      (g) => g === "SPRINTS" || g === "MID_DISTANCE" || g === "DISTANCE"
    ) : void 0;
    const updated = await broadcastWorkoutToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || "ALL"),
      targetEventGroups,
      targetMembershipIds,
      date: String(req.body?.date || ""),
      name: String(req.body?.name || ""),
      sportCategory: req.body?.sportCategory || "Running",
      plannedDurationSecs: Number(req.body?.plannedDurationSecs || 3600),
      plannedLoad: Number(req.body?.plannedLoad || 65),
      workoutSyntax: String(req.body?.workoutSyntax || ""),
      description: String(req.body?.description || ""),
      scheduledTime: req.body?.scheduledTime,
      sessionSlot: req.body?.sessionSlot,
      locationName: req.body?.locationName,
      locationCategory: req.body?.locationCategory,
      meetingNotes: req.body?.meetingNotes,
      trackSpec: req.body?.trackSpec,
      athleteOverrides: req.body?.athleteOverrides,
      replaceSameDateTarget: typeof req.body?.replaceSameDateTarget === "boolean" ? req.body.replaceSameDateTarget : true
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to broadcast workout."
    });
  }
});
teamRouter.post("/api/teams/:teamId/workouts/broadcast-batch", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds) ? req.body.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
    const targetEventGroups = Array.isArray(req.body?.targetEventGroups) ? req.body.targetEventGroups.filter(
      (g) => g === "SPRINTS" || g === "MID_DISTANCE" || g === "DISTANCE"
    ) : void 0;
    const workouts = Array.isArray(req.body?.workouts) ? req.body.workouts : [];
    const updated = await broadcastWorkoutBatchToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || "ALL"),
      targetEventGroups,
      targetMembershipIds,
      publishMode: req.body?.publishMode,
      planBlockId: req.body?.planBlockId ? String(req.body.planBlockId) : void 0,
      planBlockName: req.body?.planBlockName ? String(req.body.planBlockName) : void 0,
      replaceExistingCohortRange: typeof req.body?.replaceExistingCohortRange === "boolean" ? req.body.replaceExistingCohortRange : true,
      workouts
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams, publishedCount: Math.min(160, workouts.length) });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to batch-broadcast training plan."
    });
  }
});
teamRouter.delete("/api/teams/:teamId/workouts/blocks/:blockId", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await deleteBroadcastPlanBlockFromTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      blockId: String(req.params.blockId || ""),
      originUrl
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to recall team training block."
    });
  }
});
teamRouter.put("/api/teams/:teamId/workouts/:broadcastId", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const updated = await updateBroadcastWorkoutOnTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      broadcastId: String(req.params.broadcastId || ""),
      originUrl,
      updates: {
        ...typeof body.date === "string" ? { date: body.date } : {},
        ...typeof body.name === "string" ? { name: body.name } : {},
        ...body.sportCategory ? { sportCategory: body.sportCategory } : {},
        ...body.plannedDurationSecs !== void 0 ? { plannedDurationSecs: Number(body.plannedDurationSecs) } : {},
        ...body.plannedLoad !== void 0 ? { plannedLoad: Number(body.plannedLoad) } : {},
        ...typeof body.workoutSyntax === "string" ? { workoutSyntax: body.workoutSyntax } : {},
        ...typeof body.description === "string" ? { description: body.description } : {},
        ..."scheduledTime" in body ? { scheduledTime: body.scheduledTime } : {},
        ..."sessionSlot" in body ? { sessionSlot: body.sessionSlot } : {},
        ..."locationName" in body ? { locationName: body.locationName } : {},
        ..."locationCategory" in body ? { locationCategory: body.locationCategory } : {},
        ..."meetingNotes" in body ? { meetingNotes: body.meetingNotes } : {},
        ..."trackSpec" in body ? { trackSpec: body.trackSpec } : {}
      }
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions or broadcast workout not found." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update broadcast workout."
    });
  }
});
teamRouter.delete("/api/teams/:teamId/workouts/:broadcastId", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const updated = await deleteBroadcastWorkoutFromTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      broadcastId: String(req.params.broadcastId || ""),
      originUrl
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: updated, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete broadcast workout."
    });
  }
});
teamRouter.patch("/api/teams/:teamId/members/:membershipId/event-group", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const rawGroup = req.body?.eventGroup;
    const eventGroup = rawGroup === "SPRINTS" || rawGroup === "MID_DISTANCE" || rawGroup === "DISTANCE" ? rawGroup : null;
    const originUrl = resolveRequestOrigin(req);
    const updated = await updateTeamMemberEventGroup({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      membershipId: String(req.params.membershipId || ""),
      originUrl,
      eventGroup
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions or roster member not found." });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update athlete event group."
    });
  }
});
teamRouter.post("/api/teams/:teamId/stopwatch-activities", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const originUrl = resolveRequestOrigin(req);
    const updated = await recordCoachStopwatchActivities({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      entries
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save stopwatch activities."
    });
  }
});
teamRouter.post("/api/teams/:teamId/leave", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const modeRaw = String(req.body?.mode || "LEAVE").toUpperCase();
    const mode = modeRaw === "GRADUATE_ALUMNI" ? "GRADUATE_ALUMNI" : "LEAVE";
    const originUrl = resolveRequestOrigin(req);
    const outcome = await leaveOrGraduateTeam({
      callerSid: claims.sid,
      userId: claims.sub?.startsWith("usr_") ? claims.sub : void 0,
      teamId: String(req.params.teamId || ""),
      mode,
      originUrl
    });
    if (!outcome.ok) {
      res.status(400).json({ ok: false, error: outcome.error || "Could not leave team." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to leave team."
    });
  }
});
teamRouter.delete("/api/teams/:teamId/members/me/guardian", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const verifiedUser = claims.sub?.startsWith("usr_") ? await getUserById(claims.sub).catch(() => null) : null;
    const outcome = await revokeAthleteGuardianConsentForTeam({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      birthMonthYear: req.body?.birthMonthYear ? String(req.body.birthMonthYear) : void 0,
      verifiedUserBirthMonthYear: verifiedUser?.birthMonthYear
    });
    if (!outcome.ok) {
      res.status(400).json({ ok: false, error: outcome.error });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, team: outcome.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to revoke guardian access."
    });
  }
});
teamRouter.patch(
  "/api/teams/:teamId/members/me/sharing-tier",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const rawTier = String(req.body?.sharingTier || "").toUpperCase();
      if (rawTier !== "LOAD_ONLY" && rawTier !== "SUMMARY_ONLY" && rawTier !== "FULL_STREAMS") {
        res.status(400).json({ ok: false, error: "Invalid coach data sharing tier." });
        return;
      }
      const sharingTier = rawTier;
      const originUrl = resolveRequestOrigin(req);
      const outcome = await updateMyTeamSharingTier({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        sharingTier,
        originUrl
      });
      if (!outcome.ok) {
        res.status(400).json({ ok: false, error: outcome.error });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: outcome.summary, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to update team sharing tier."
      });
    }
  }
);
teamRouter.patch(
  "/api/teams/:teamId/members/:membershipId/status",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const rawStatus = String(req.body?.status || "").toUpperCase();
      const allowed = ["ACTIVE", "INJURED", "OFF_SEASON", "ALUMNI", "REVOKED"];
      if (!allowed.includes(rawStatus)) {
        res.status(400).json({ ok: false, error: "Invalid member lifecycle status." });
        return;
      }
      const originUrl = resolveRequestOrigin(req);
      const outcome = await updateMemberRosterLifecycleStatus({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        membershipId: String(req.params.membershipId || ""),
        status: rawStatus,
        originUrl
      });
      if (!outcome.ok || !outcome.summary) {
        res.status(403).json({ ok: false, error: outcome.error || "Could not update member status." });
        return;
      }
      res.json({ ok: true, team: outcome.summary });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed updating member status."
      });
    }
  }
);
teamRouter.post("/api/teams/:teamId/graduate-class", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const graduationYear = Number(req.body?.graduationYear);
    if (!Number.isFinite(graduationYear) || graduationYear < 2e3 || graduationYear > 2100) {
      res.status(400).json({ ok: false, error: "Valid graduationYear is required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const outcome = await graduateTeamClass({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      graduationYear,
      originUrl
    });
    if (!outcome.ok) {
      res.status(403).json({ ok: false, error: outcome.error || "Head Coach permission required." });
      return;
    }
    res.json({ ok: true, graduatedCount: outcome.graduatedCount, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed graduating class."
    });
  }
});
teamRouter.patch(
  "/api/teams/:teamId/members/:membershipId/role",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const role = String(req.body?.role || "").toUpperCase();
      if (role !== "ATHLETE" && role !== "ASSISTANT_COACH" && role !== "ORG_ADMIN" && role !== "ATHLETIC_TRAINER") {
        res.status(400).json({
          ok: false,
          error: "Role must be ATHLETE, ASSISTANT_COACH, ORG_ADMIN, or ATHLETIC_TRAINER."
        });
        return;
      }
      const originUrl = resolveRequestOrigin(req);
      const outcome = await updateMemberRole({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        membershipId: String(req.params.membershipId || ""),
        role,
        originUrl
      });
      if (!outcome.ok || !outcome.summary) {
        res.status(403).json({ ok: false, error: outcome.error || "Head Coach permission required." });
        return;
      }
      res.json({ ok: true, team: outcome.summary });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed updating member role."
      });
    }
  }
);
teamRouter.post("/api/teams/:teamId/transfer-ownership", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const outcome = await transferTeamHeadCoachOwnership({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      newHeadCoachMembershipId: String(
        req.body?.newHeadCoachMembershipId || req.body?.targetMembershipId || ""
      ),
      originUrl
    });
    if (!outcome.ok || !outcome.summary) {
      res.status(403).json({ ok: false, error: outcome.error || "Could not transfer ownership." });
      return;
    }
    res.json({ ok: true, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed transferring ownership."
    });
  }
});
teamRouter.post("/api/teams/:teamId/members/merge", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const outcome = await mergeDuplicateRosterMembers({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      sourceMembershipId: String(req.body?.sourceMembershipId || ""),
      targetMembershipId: String(req.body?.targetMembershipId || ""),
      originUrl
    });
    if (!outcome.ok || !outcome.summary) {
      res.status(400).json({ ok: false, error: outcome.error || "Could not merge members." });
      return;
    }
    res.json({ ok: true, team: outcome.summary });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed merging roster entries."
    });
  }
});
teamRouter.get("/api/teams/parent-consent", async (req, res) => {
  try {
    const token = String(req.query.token || req.query.t || "").trim();
    const preview = await previewParentConsentToken(token);
    if (!preview.ok) {
      res.status(400).send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Parent Consent Link Error \xB7 THRESH</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px 16px;max-width:480px;margin:0 auto;text-align:center;color:#1F2937;">
  <h2 style="color:#DC2626;">Invalid or Expired Link</h2>
  <p>${escapeHtml(preview.error || "This consent link could not be verified.")}</p>
  <a href="/" style="display:inline-block;margin-top:16px;color:#14532D;font-weight:700;">Return to THRESH</a>
</body>
</html>`);
      return;
    }
    const safeAthlete = escapeHtml(preview.athleteName || "Athlete");
    const safeTeam = escapeHtml(preview.teamName || "Team");
    const safeCoach = escapeHtml(preview.coachName || "Coach");
    const safeToken = escapeHtml(token);
    const statusLine = preview.alreadyAcknowledged ? "Safeguarding consent is already active. You may review details or revoke access below." : "Please confirm parental consent for your athlete\u2019s team workspace below, or decline and purge their team data.";
    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Parent &amp; Guardian Consent \xB7 THRESH</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F4F6F3;padding:40px 16px;margin:0;color:#111318;">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:18px;border:1px solid #E2E8F0;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.04);">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#15803D;text-transform:uppercase;">COPPA &amp; SAFE-SPORT SAFEGUARDS</div>
    <h2 style="margin:8px 0 12px;font-size:22px;color:#111318;">Parent / Guardian Authorization</h2>
    <p style="font-size:14px;color:#4B5563;line-height:1.6;margin:0 0 18px;">${escapeHtml(statusLine)}</p>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:14px;font-size:13px;color:#334155;margin-bottom:20px;">
      <div><strong>Athlete:</strong> ${safeAthlete}</div>
      <div><strong>Team:</strong> ${safeTeam}</div>
      <div><strong>Coach:</strong> ${safeCoach}</div>
      <div><strong>Protections:</strong> Weight &amp; W/kg masking is locked ON until age 18.</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      <form method="POST" action="/api/teams/parent-consent" style="flex:1;">
        <input type="hidden" name="token" value="${safeToken}" />
        <input type="hidden" name="action" value="APPROVE" />
        <button type="submit" style="width:100%;min-height:44px;background:#14532D;color:#FFFFFF;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;padding:10px 16px;">Approve &amp; Acknowledge Safeguards</button>
      </form>
      <form method="POST" action="/api/teams/parent-consent" style="flex:1;">
        <input type="hidden" name="token" value="${safeToken}" />
        <input type="hidden" name="action" value="DECLINE" />
        <button type="submit" style="width:100%;min-height:44px;background:#FEE2E2;color:#B91C1C;border:1px solid #FECACA;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;padding:10px 16px;">Decline &amp; Delete Child Data</button>
      </form>
    </div>
  </div>
</body>
</html>`);
  } catch {
    res.status(500).send("An error occurred while loading parent consent status.");
  }
});
teamRouter.post(
  "/api/teams/parent-consent",
  express3.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const token = String(req.body?.token || req.query.token || "").trim();
      const action = String(req.body?.action || req.query.action || "APPROVE").trim().toUpperCase();
      const wantsHtml = String(req.headers.accept || "").includes("text/html");
      if (action === "DECLINE") {
        const decl = await declineAndPurgeParentConsent(token);
        if (!decl.ok) {
          res.status(400).json({ ok: false, error: decl.error });
          return;
        }
        if (wantsHtml) {
          res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px 16px;max-width:480px;margin:0 auto;text-align:center;"><h2>Child Data Removed</h2><p>Membership and synced biometrics for <strong>${escapeHtml(decl.athleteName || "Athlete")}</strong> on <strong>${escapeHtml(decl.teamName || "Team")}</strong> have been revoked and cleared.</p><a href="/">Return to THRESH</a></body></html>`);
          return;
        }
        res.json({ ...decl, declined: true });
        return;
      }
      const result = await acknowledgeParentConsent(token);
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
      if (wantsHtml) {
        res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px 16px;max-width:480px;margin:0 auto;text-align:center;"><h2 style="color:#15803D;">Safeguarding Acknowledged</h2><p>Parental acknowledgment for <strong>${escapeHtml(result.athleteName || "Athlete")}</strong> on <strong>${escapeHtml(result.teamName || "Team")}</strong> has been confirmed.</p><a href="/" style="display:inline-block;margin-top:16px;color:#14532D;font-weight:700;">Visit THRESH</a></body></html>`);
        return;
      }
      res.json({ ...result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed confirming consent."
      });
    }
  }
);
teamRouter.get("/api/teams/:teamId/audit-log", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const limit = Number(req.query?.limit || 100);
    const result = await getTeamGovernanceAuditLog({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      limit: Number.isFinite(limit) ? limit : 100
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || "Audit log permission required."
      });
      return;
    }
    res.json({ ok: true, entries: result.entries || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed loading audit log."
    });
  }
});
teamRouter.post("/api/teams/:teamId/safety-alerts", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const result = await recordGuardianSafetyAlert({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      targetMembershipId: String(req.body?.targetMembershipId || ""),
      category: req.body?.category || "PAIN_FLAG",
      severity: req.body?.severity || "CAUTION",
      summary: String(req.body?.summary || ""),
      painLocation: req.body?.painLocation ? String(req.body.painLocation) : void 0,
      originUrl
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || "Unable to record safety alert." });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, alert: result.alert, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed recording safety alert."
    });
  }
});
teamRouter.get("/api/teams/:teamId/workout-library", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const result = await listTeamWorkoutLibrary({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || "")
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || "Forbidden." });
      return;
    }
    res.json({ ok: true, templates: result.templates || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed loading workout library."
    });
  }
});
teamRouter.post("/api/teams/:teamId/workout-library", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const result = await saveTeamWorkoutLibraryTemplate({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      template: {
        ...body.id ? { id: String(body.id) } : {},
        name: String(body.name || ""),
        category: body.category || "TRACK",
        sportCategory: body.sportCategory || "Running",
        workoutSyntax: String(body.workoutSyntax || ""),
        description: String(body.description || ""),
        plannedDurationSecs: Number(body.plannedDurationSecs || 2400),
        plannedLoad: Number(body.plannedLoad || 55),
        ...body.trackSpec ? { trackSpec: body.trackSpec } : {}
      }
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || "Coach permissions required."
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, template: result.template, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed saving workout template."
    });
  }
});
teamRouter.delete(
  "/api/teams/:teamId/workout-library/:templateId",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const originUrl = resolveRequestOrigin(req);
      const result = await deleteTeamWorkoutLibraryTemplate({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        templateId: String(req.params.templateId || ""),
        originUrl
      });
      if (!result.ok) {
        res.status(result.status || 403).json({
          ok: false,
          error: result.error || "Coach permissions required."
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: result.summary, teams });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed deleting workout template."
      });
    }
  }
);
teamRouter.get("/api/teams/:teamId/comments", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const result = await listTeamWorkoutComments({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      targetMembershipId: req.query?.targetMembershipId ? String(req.query.targetMembershipId) : void 0
    });
    if (!result.ok) {
      res.status(403).json({ ok: false, error: result.error || "Forbidden." });
      return;
    }
    res.json({ ok: true, comments: result.comments || [] });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed loading comments."
    });
  }
});
teamRouter.post("/api/teams/:teamId/comments", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const body = req.body || {};
    const result = await postTeamWorkoutComment({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      targetMembershipId: String(body.targetMembershipId || ""),
      workoutDate: body.workoutDate ? String(body.workoutDate) : void 0,
      activityId: body.activityId ? String(body.activityId) : void 0,
      body: String(body.body || ""),
      privateDirectToMinor: body.privateDirectToMinor === true,
      guardianCc: body.guardianCc,
      originUrl
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || "Unable to post workout comment."
      });
      return;
    }
    const teams = await listTeamsForUser(claims.sid, originUrl);
    res.json({ ok: true, comment: result.comment, team: result.summary, teams });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed posting workout comment."
    });
  }
});

// server/routers/teamSyncRouter.ts
import express4 from "express";

// server/athleticSyncService.ts
import crypto7 from "crypto";
function assertCoachMembership(doc, callerSid) {
  const mem = doc.memberships.find(
    (m) => m.userSid === callerSid && m.status !== "REVOKED"
  );
  if (!mem || mem.role !== "HEAD_COACH" && mem.role !== "ASSISTANT_COACH") {
    return null;
  }
  return mem;
}
function upsertMeetEventsOnDoc(doc, meets, sourceLabel) {
  const existingKeySet = new Set(
    (doc.broadcastWorkouts || []).map(
      (bw) => `${bw.date}|${normalizeAthleteMatchKey(bw.name)}`
    )
  );
  let added = 0;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const additions = [];
  for (const meet of meets.slice(0, 60)) {
    const cleanName = String(meet.name || "").trim().slice(0, 100);
    const cleanDate = String(meet.date || "").slice(0, 10);
    if (!cleanName || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) continue;
    const dedupeKey = `${cleanDate}|${normalizeAthleteMatchKey(cleanName)}`;
    if (existingKeySet.has(dedupeKey)) continue;
    existingKeySet.add(dedupeKey);
    const estDist = meet.distanceMeters || 5e3;
    const estLoad = computeOfficialRaceTrainingLoad(estDist, estDist >= 4e3 ? 1100 : 300, true);
    additions.push({
      broadcastId: `meet_${crypto7.randomBytes(6).toString("hex")}`,
      teamId: doc.brand.teamId,
      targetSquadGroup: "ALL",
      date: cleanDate,
      name: cleanName,
      sportCategory: "Running",
      plannedDurationSecs: 5400,
      plannedLoad: estLoad,
      workoutSyntax: estDist >= 4e3 ? `Warmup 20m Z1
Main: ${cleanName}
Cooldown 15m Z1` : `Warmup 25m
Race: ${cleanName}
Cooldown 15m`,
      description: meet.description || `Synced ${sourceLabel === "TFRRS" ? "TFRRS" : "Athletic.net"} meet schedule event.`,
      ...meet.scheduledTime ? { scheduledTime: meet.scheduledTime } : {},
      locationName: meet.locationName,
      locationCategory: meet.locationCategory || "XC_COURSE",
      planBlockId: `ext-sched-${sourceLabel.toLowerCase()}`,
      planBlockName: sourceLabel === "TFRRS" ? "TFRRS Meet Schedule" : "Athletic.net Meet Schedule",
      isOfficialMeet: true,
      externalSource: meet.externalSource || sourceLabel,
      pushedByCoachName: doc.brand.coachDisplayName,
      createdAt: nowIso
    });
    added += 1;
  }
  if (additions.length > 0) {
    doc.broadcastWorkouts = [...additions, ...doc.broadcastWorkouts || []].slice(0, 400);
  }
  return added;
}
async function updateTeamExternalSyncConfig(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) return null;
  let mergedConfig = { ...params.config || {} };
  if (params.teamUrl) {
    const parsed = parseExternalTeamUrl(params.teamUrl);
    if (parsed) {
      mergedConfig = {
        ...mergedConfig,
        platform: parsed.platform,
        ...parsed.platform === "ATHLETIC_NET" ? {
          athleticNetSchoolId: parsed.athleticNetSchoolId,
          athleticNetSportSlug: parsed.athleticNetSportSlug,
          athleticNetUrl: parsed.canonicalUrl
        } : {
          tfrrsTeamUrl: parsed.canonicalUrl,
          tfrrsTeamCode: parsed.tfrrsTeamCode
        },
        ...parsed.inferredTeamName && !mergedConfig.teamFilterKeyword ? { teamFilterKeyword: parsed.inferredTeamName.replace(/\s+high\s+school$/i, "") } : {}
      };
    }
  }
  doc.brand.externalSync = sanitizeExternalSyncConfig(
    mergedConfig,
    doc.brand.externalSync
  );
  doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveTeamDocRaw(params.teamId, doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}
async function syncTeamIcsCalendar(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) {
    return {
      ok: false,
      summary: null,
      addedMeetsCount: 0,
      parsedMeetsCount: 0,
      note: "Coach permissions required to sync team schedule."
    };
  }
  let resolvedIcsText = String(params.icsText || "").trim();
  const normalizedUrl = params.icsUrl ? normalizeWebcalUrl(params.icsUrl) : "";
  if (!resolvedIcsText && normalizedUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const resp = await assertSafeExternalFetch(
        normalizedUrl,
        {
          headers: {
            "User-Agent": "THRESH-CalendarSync/2.1 (+https://thresh-dev.vercel.app)",
            Accept: "text/calendar, text/plain, */*;q=0.8"
          },
          signal: controller.signal
        },
        2
      );
      clearTimeout(timer);
      if (!resp) {
        return {
          ok: false,
          summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
          addedMeetsCount: 0,
          parsedMeetsCount: 0,
          note: "Blocked unsafe or private network calendar URL."
        };
      }
      const body = await resp.text();
      if (!resp.ok || /just a moment|cf-mitigated|enable javascript and cookies/i.test(body)) {
        return {
          ok: false,
          summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
          addedMeetsCount: 0,
          parsedMeetsCount: 0,
          cloudflareBlocked: true,
          note: "Athletic.net / remote firewall blocked direct server fetch (HTTP " + resp.status + '). Click "Download calendar" (.ics) in your browser and upload or paste it below.'
        };
      }
      resolvedIcsText = body;
    } catch {
      return {
        ok: false,
        summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
        addedMeetsCount: 0,
        parsedMeetsCount: 0,
        cloudflareBlocked: true,
        note: "Unable to fetch remote .ics URL from server; download the .ics file in your browser and drop or paste it below."
      };
    }
  }
  if (!resolvedIcsText || !resolvedIcsText.includes("VEVENT")) {
    return {
      ok: false,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
      addedMeetsCount: 0,
      parsedMeetsCount: 0,
      note: "No VEVENT calendar entries found in the provided .ics feed."
    };
  }
  const extSource = doc.brand.externalSync?.platform === "TFRRS" ? "TFRRS" : "ATHLETIC_NET";
  const meets = parseIcsCalendarToMeets(resolvedIcsText, extSource);
  const addedCount = upsertMeetEventsOnDoc(doc, meets, extSource);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  doc.brand.externalSync = sanitizeExternalSyncConfig(
    {
      ...normalizedUrl ? { icsCalendarUrl: normalizedUrl } : {},
      lastSyncedAt: nowIso
    },
    doc.brand.externalSync
  );
  doc.updatedAt = nowIso;
  await saveTeamDocRaw(params.teamId, doc);
  return {
    ok: true,
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    addedMeetsCount: addedCount,
    parsedMeetsCount: meets.length,
    note: addedCount > 0 ? `Added ${addedCount} meets from .ics calendar.` : `Checked ${meets.length} meets (all already up to date).`
  };
}
function findOrCreateExternalMembership(doc, candidate) {
  const normKey = normalizeAthleteMatchKey(candidate.name);
  const existing = doc.memberships.find((m) => {
    if (m.status === "REVOKED" || m.role === "PARENT_FOLLOWER") return false;
    if (candidate.externalAthleteId && m.externalAthleteId && m.externalAthleteId === candidate.externalAthleteId) {
      return true;
    }
    return Boolean(normKey) && normalizeAthleteMatchKey(m.invitedName) === normKey;
  });
  const safeSportOn = Boolean(
    doc.brand.defaultSafeSportShield || candidate.isMinorU18 || doc.brand.orgType === "HIGH_SCHOOL"
  );
  const calibrated = candidate.seedMarkOrFtp ? calibrateThresholdsFromSeedMark(
    candidate.seedMarkOrFtp,
    doc.brand.primarySport,
    "mi"
  ) : void 0;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const cleanCandidateUrl = candidate.externalProfileUrl && isSafeHttpsUrl(candidate.externalProfileUrl.trim()) ? candidate.externalProfileUrl.trim() : void 0;
  if (existing) {
    existing.externalSource = existing.externalSource || candidate.externalSource;
    if (candidate.externalAthleteId) existing.externalAthleteId = candidate.externalAthleteId;
    if (cleanCandidateUrl) existing.externalProfileUrl = cleanCandidateUrl;
    if (candidate.graduationYear) existing.graduationYear = candidate.graduationYear;
    if (candidate.genderDivision) existing.genderDivision = candidate.genderDivision;
    if (candidate.seedMarkOrFtp && !existing.seedMarkOrFtp) {
      existing.seedMarkOrFtp = candidate.seedMarkOrFtp;
    }
    if (!existing.eventGroup && candidate.seedMarkOrFtp) {
      existing.eventGroup = inferEventGroupFromSeedMark(candidate.seedMarkOrFtp) || "DISTANCE";
    }
    if (calibrated && (!existing.liveSnapshot || !existing.liveSnapshot.thresholdPaceSecsPerKm)) {
      existing.liveSnapshot = {
        updatedAt: nowIso,
        hasConnectedWatch: Boolean(existing.liveSnapshot?.hasConnectedWatch),
        verdictLabel: existing.liveSnapshot?.verdictLabel || "Synced Roster",
        readinessScore: existing.liveSnapshot?.readinessScore || 0,
        ctl: existing.liveSnapshot?.ctl || 0,
        atl: existing.liveSnapshot?.atl || 0,
        tsb: existing.liveSnapshot?.tsb || 0,
        acuteLoad7d: existing.liveSnapshot?.acuteLoad7d || 0,
        lowAerobicPct: existing.liveSnapshot?.lowAerobicPct || 0,
        highAerobicPct: existing.liveSnapshot?.highAerobicPct || 0,
        neuromuscularPct: existing.liveSnapshot?.neuromuscularPct || 0,
        caraHours7d: existing.liveSnapshot?.caraHours7d || 0,
        ...existing.liveSnapshot || {},
        thresholdPaceSecsPerKm: calibrated.thresholdPaceSecsPerKm,
        safeSportHideWeight: safeSportOn
      };
    }
    return { mem: existing, created: false };
  }
  const isMinorImport = Boolean(
    candidate.isMinorU18 || doc.brand.orgType === "HIGH_SCHOOL"
  );
  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  const rawToken = crypto7.randomBytes(12).toString("base64url");
  const createdMem = {
    membershipId: `mem_${crypto7.randomBytes(6).toString("hex")}`,
    teamId: doc.brand.teamId,
    role: "ATHLETE",
    squadGroup: candidate.squadGroup || orgDefaults.defaultSquads[0] || "Varsity",
    eventGroup: candidate.seedMarkOrFtp ? inferEventGroupFromSeedMark(candidate.seedMarkOrFtp) || "DISTANCE" : "DISTANCE",
    invitedName: String(candidate.name || "Team Athlete").trim().slice(0, 64),
    graduationYear: candidate.graduationYear,
    isMinorU18: isMinorImport,
    parentConsentStatus: isMinorImport ? "PENDING" : "NOT_REQUIRED",
    seedMarkOrFtp: candidate.seedMarkOrFtp,
    externalSource: candidate.externalSource,
    externalAthleteId: candidate.externalAthleteId,
    externalProfileUrl: cleanCandidateUrl,
    genderDivision: candidate.genderDivision,
    status: "INVITED",
    emailDeliveryStatus: "READY_MANUAL_LINK",
    rawInviteToken: rawToken,
    inviteTokenHash: crypto7.createHash("sha256").update(rawToken).digest("hex"),
    invitedAt: nowIso,
    liveSnapshot: {
      updatedAt: nowIso,
      hasConnectedWatch: false,
      verdictLabel: `${candidate.externalSource === "TFRRS" ? "TFRRS" : "Athletic.net"} Synced`,
      readinessScore: 0,
      ctl: 0,
      atl: 0,
      tsb: 0,
      acuteLoad7d: 0,
      lowAerobicPct: 0,
      highAerobicPct: 0,
      neuromuscularPct: 0,
      caraHours7d: 0,
      thresholdPaceSecsPerKm: calibrated?.thresholdPaceSecsPerKm || 245,
      safeSportHideWeight: safeSportOn
    }
  };
  doc.memberships.push(createdMem);
  return { mem: createdMem, created: true };
}
async function applyExternalTeamSyncBatch(params) {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc || !assertCoachMembership(doc, params.callerSid)) {
    return {
      summary: null,
      addedAthletes: 0,
      updatedAthletes: 0,
      addedMeets: 0,
      recordedResults: 0
    };
  }
  let addedAthletes = 0;
  let updatedAthletes = 0;
  let addedMeets = 0;
  let recordedResults = 0;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const ath of (params.athletes || []).slice(0, 150)) {
    const res = findOrCreateExternalMembership(doc, ath);
    if (res.created) addedAthletes += 1;
    else updatedAthletes += 1;
  }
  if (Array.isArray(params.meets) && params.meets.length > 0) {
    const extSource = params.externalSyncPatch?.platform === "TFRRS" || doc.brand.externalSync?.platform === "TFRRS" ? "TFRRS" : "ATHLETIC_NET";
    addedMeets = upsertMeetEventsOnDoc(doc, params.meets, extSource);
  }
  for (const row of (params.results || []).slice(0, 200)) {
    const { mem, created } = findOrCreateExternalMembership(doc, {
      name: row.athleteName,
      squadGroup: row.squadGroup,
      graduationYear: row.graduationYear,
      genderDivision: row.genderDivision,
      seedMarkOrFtp: row.displayFatTime,
      externalSource: row.externalSource,
      externalAthleteId: row.externalAthleteId,
      externalProfileUrl: row.externalProfileUrl,
      isMinorU18: doc.brand.orgType === "HIGH_SCHOOL"
    });
    if (created) addedAthletes += 1;
    const existingActs = Array.isArray(mem.coachRecordedActivities) ? mem.coachRecordedActivities : [];
    const duplicate = existingActs.some(
      (a) => a.startDateLocal?.slice(0, 10) === row.date && a.officialRaceData?.eventDistanceMeters === row.eventDistanceMeters && Math.abs((a.officialRaceData?.fatTimeSecs || 0) - row.fatTimeSecs) < 0.05
    );
    if (duplicate) continue;
    const activity = synthesizeOfficialRaceActivity({
      id: `ext-meet-${crypto7.randomBytes(5).toString("hex")}`,
      date: row.date,
      meetName: row.meetName,
      eventLabel: row.eventLabel,
      eventDistanceMeters: row.eventDistanceMeters,
      fatTimeSecs: row.fatTimeSecs,
      displayFatTime: row.displayFatTime || formatFatTime(row.fatTimeSecs),
      platform: row.platform,
      trackType: row.trackType,
      placeFinish: row.placeFinish,
      lapSplitDistanceMeters: row.eventDistanceMeters <= 400 ? 200 : row.eventDistanceMeters >= 3e3 ? 1e3 : 400,
      lapSplitsSecs: [],
      includeWarmupCooldown: false,
      sourceUrl: row.externalProfileUrl || row.sourceUrl,
      startDateLocalIso: `${row.date}T09:00:00`
    });
    mem.coachRecordedActivities = [activity, ...existingActs].slice(0, 80);
    if (!mem.seedMarkOrFtp) {
      mem.seedMarkOrFtp = activity.officialRaceData?.displayFatTime || row.displayFatTime;
    }
    if (mem.userSid || mem.stravaAthleteId || mem.invitedEmail) {
      await archiveCoachActivitiesForMember(mem, [activity]).catch(() => void 0);
    }
    recordedResults += 1;
  }
  doc.brand.externalSync = sanitizeExternalSyncConfig(
    {
      ...params.externalSyncPatch || {},
      lastSyncedAt: nowIso
    },
    doc.brand.externalSync
  );
  doc.updatedAt = nowIso;
  await saveTeamDocRaw(params.teamId, doc);
  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    addedAthletes,
    updatedAthletes,
    addedMeets,
    recordedResults
  };
}
async function getPublicTeamHubBySlugOrCode(slugOrCode) {
  const doc = await findTeamDocumentByCodeOrSlug(slugOrCode);
  if (!doc || !doc.brand.externalSync?.enablePublicParentHub) {
    return {
      found: false,
      error: "Team Hub not found or public parent access is turned off.",
      upcomingMeets: [],
      recentSchedule: [],
      rosterLeaderboard: [],
      stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 }
    };
  }
  const todayIso = getLocalDateIso();
  const meetItems = (doc.broadcastWorkouts || []).filter((bw) => bw.isOfficialMeet || /meet|invitational|finals|dual|champ|xc/i.test(bw.name)).filter((bw) => !bw.targetMembershipIds || bw.targetMembershipIds.length === 0).map((bw) => ({
    id: bw.broadcastId,
    date: bw.date,
    name: bw.name,
    ...bw.scheduledTime ? { scheduledTime: bw.scheduledTime } : {},
    ...bw.locationName ? { locationName: bw.locationName } : {},
    ...bw.locationCategory ? { locationCategory: bw.locationCategory } : {},
    ...bw.description ? { description: bw.description } : {},
    ...bw.externalSource ? { externalSource: bw.externalSource } : {}
  })).sort((a, b) => a.date.localeCompare(b.date));
  const upcomingMeets = meetItems.filter((m) => m.date >= todayIso);
  const recentSchedule = meetItems.filter((m) => m.date < todayIso).reverse();
  let officialResultCount = 0;
  const rosterLeaderboard = doc.memberships.filter((m) => m.status !== "REVOKED" && m.role === "ATHLETE").map((m) => {
    const officialResults = (m.coachRecordedActivities || []).filter((a) => Boolean(a.officialRaceData)).map((a) => {
      const r = a.officialRaceData;
      return {
        date: a.startDateLocal.slice(0, 10),
        meetName: r.meetName,
        eventLabel: r.eventLabel,
        eventDistanceMeters: r.eventDistanceMeters,
        displayFatTime: r.displayFatTime,
        fatTimeSecs: r.fatTimeSecs,
        ...r.placeFinish ? { placeFinish: r.placeFinish } : {},
        vdotScore: r.vdotScore,
        platform: r.platform,
        trackType: r.trackType,
        ...r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
    officialResultCount += officialResults.length;
    const abbreviateUnconsentedMinor = Boolean(
      !m.externalSource && m.isMinorU18 && m.parentConsentStatus === "PENDING"
    );
    let displayName = m.invitedName;
    if (abbreviateUnconsentedMinor) {
      const parts = m.invitedName.trim().split(/\s+/).filter(Boolean);
      displayName = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || "Athlete";
    }
    return {
      membershipId: m.membershipId,
      name: displayName,
      squadGroup: m.squadGroup,
      ...m.eventGroup ? { eventGroup: m.eventGroup } : {},
      ...m.graduationYear ? { graduationYear: m.graduationYear } : {},
      ...m.genderDivision ? { genderDivision: m.genderDivision } : {},
      ...m.seedMarkOrFtp ? { seedMarkOrFtp: m.seedMarkOrFtp } : {},
      ...m.externalSource ? { externalSource: m.externalSource } : {},
      ...m.externalAthleteId ? { externalAthleteId: m.externalAthleteId } : {},
      ...m.externalProfileUrl && isSafeHttpsUrl(m.externalProfileUrl.trim()) ? { externalProfileUrl: m.externalProfileUrl.trim() } : {},
      officialResults
    };
  });
  return {
    found: true,
    brand: {
      teamId: doc.brand.teamId,
      slug: doc.brand.slug,
      joinCode: doc.brand.joinCode,
      name: doc.brand.name,
      shortName: doc.brand.shortName,
      ...doc.brand.mascotOrMotto ? { mascotOrMotto: doc.brand.mascotOrMotto } : {},
      orgType: doc.brand.orgType,
      primarySport: doc.brand.primarySport,
      ...doc.brand.logoDataUrl ? { logoDataUrl: doc.brand.logoDataUrl } : {},
      primaryHex: doc.brand.primaryHex,
      secondaryHex: doc.brand.secondaryHex,
      defaultSafeSportShield: doc.brand.defaultSafeSportShield,
      coachDisplayName: doc.brand.coachDisplayName,
      ...doc.brand.externalSync ? { externalSync: doc.brand.externalSync } : {}
    },
    upcomingMeets,
    recentSchedule,
    rosterLeaderboard,
    stats: {
      athleteCount: rosterLeaderboard.length,
      meetCount: meetItems.length,
      officialResultCount
    }
  };
}
async function followTeamAsParentOrFan(params) {
  const initialDoc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!initialDoc) {
    return { ok: false, error: "Team not found for this code or URL." };
  }
  return withTeamRowLock(initialDoc.brand.teamId, async () => {
    const doc = await loadTeamDocRaw(initialDoc.brand.teamId) || initialDoc;
    if (!doc.brand.externalSync?.enablePublicParentHub) {
      return { ok: false, error: "Public parent/supporter following is disabled for this team." };
    }
    const cleanVerifiedEmail = params.verifiedEmail?.trim().toLowerCase();
    let mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!mem) {
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      mem = {
        membershipId: `mem_${crypto7.randomBytes(6).toString("hex")}`,
        teamId: doc.brand.teamId,
        userSid: params.callerSid,
        role: "PARENT_FOLLOWER",
        squadGroup: "Parents & Supporters",
        invitedName: String(params.followerName || "").trim().slice(0, 48) || "Parent / Supporter",
        ...cleanVerifiedEmail ? { invitedEmail: cleanVerifiedEmail } : {},
        isMinorU18: false,
        parentConsentStatus: "NOT_REQUIRED",
        status: "ACTIVE",
        invitedAt: nowIso,
        openedAt: nowIso,
        joinedAt: nowIso
      };
      doc.memberships.push(mem);
      doc.updatedAt = nowIso;
      await saveTeamDocRaw(doc.brand.teamId, doc);
    } else if (cleanVerifiedEmail && mem.invitedEmail !== cleanVerifiedEmail) {
      mem.invitedEmail = cleanVerifiedEmail;
      doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTeamDocRaw(doc.brand.teamId, doc);
    }
    await addTeamToUserIndex(params.callerSid, doc.brand.teamId, mem.invitedName, cleanVerifiedEmail);
    return {
      ok: true,
      summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl)
    };
  });
}

// server/routers/teamSyncRouter.ts
var teamSyncRouter = express4.Router();
function resolveSyncOrigin(req) {
  const explicit = resolveSafeOrigin(
    String(req.body?.origin || req.query?.origin || "")
  );
  if (explicit) return explicit;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || req.secure ? "https" : "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim();
  if (host) {
    const candidate = resolveSafeOrigin(`${proto}://${host}`);
    if (candidate) return candidate;
  }
  return "https://thresh-dev.vercel.app";
}
teamSyncRouter.post(
  "/api/teams/:teamId/external-sync/config",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const summary = await updateTeamExternalSyncConfig({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        originUrl,
        config: req.body?.config || req.body || {},
        teamUrl: req.body?.teamUrl ? String(req.body.teamUrl) : void 0
      });
      if (!summary) {
        res.status(403).json({
          ok: false,
          error: "Coach permissions required to update Athletic.net / TFRRS sync config."
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({ ok: true, team: summary, teams });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to update external sync settings."
      });
    }
  }
);
teamSyncRouter.post(
  "/api/teams/:teamId/external-sync/ics",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const result = await syncTeamIcsCalendar({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        originUrl,
        icsUrl: req.body?.icsUrl ? String(req.body.icsUrl) : void 0,
        icsText: req.body?.icsText ? String(req.body.icsText) : void 0
      });
      if (!result.summary) {
        res.status(403).json({ ok: false, error: result.note || "Forbidden." });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ...result,
        teams
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to sync .ics calendar."
      });
    }
  }
);
teamSyncRouter.post(
  "/api/teams/:teamId/external-sync/apply",
  async (req, res) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid) {
        res.status(401).json({ ok: false, error: "Authentication required." });
        return;
      }
      const originUrl = resolveSyncOrigin(req);
      const result = await applyExternalTeamSyncBatch({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ""),
        originUrl,
        externalSyncPatch: req.body?.externalSyncPatch,
        athletes: Array.isArray(req.body?.athletes) ? req.body.athletes : void 0,
        meets: Array.isArray(req.body?.meets) ? req.body.meets : void 0,
        results: Array.isArray(req.body?.results) ? req.body.results : void 0
      });
      if (!result.summary) {
        res.status(403).json({
          ok: false,
          error: "Coach permissions required to import external team data."
        });
        return;
      }
      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        team: result.summary,
        teams,
        addedAthletes: result.addedAthletes,
        updatedAthletes: result.updatedAthletes,
        addedMeets: result.addedMeets,
        recordedResults: result.recordedResults
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to apply team sync."
      });
    }
  }
);
teamSyncRouter.get(
  "/api/teams/public/:slugOrCode",
  async (req, res) => {
    try {
      const payload = await getPublicTeamHubBySlugOrCode(
        String(req.params.slugOrCode || "")
      );
      if (!payload.found) {
        res.status(404).json(payload);
        return;
      }
      res.json(payload);
    } catch (err) {
      res.status(500).json({
        found: false,
        error: err instanceof Error ? err.message : "Failed to load public team hub.",
        upcomingMeets: [],
        recentSchedule: [],
        rosterLeaderboard: [],
        stats: { athleteCount: 0, meetCount: 0, officialResultCount: 0 }
      });
    }
  }
);
teamSyncRouter.post("/api/teams/follow", async (req, res) => {
  try {
    const existing = getVerifiedSessionClaims(req);
    let sid = existing?.sid;
    let sessionToken;
    if (!sid) {
      sessionToken = setSessionCookie(
        req,
        res,
        String(req.body?.followerName || "thresh-supporter")
      );
      sid = decodeAndVerifyToken(sessionToken)?.sid || "000000000000000000000000";
    }
    const originUrl = resolveSyncOrigin(req);
    const verifiedUser = sid ? await getUserById(sid).catch(() => null) : null;
    const result = await followTeamAsParentOrFan({
      callerSid: sid,
      codeOrSlug: String(req.body?.codeOrSlug || ""),
      followerName: req.body?.followerName ? String(req.body.followerName) : void 0,
      verifiedEmail: verifiedUser?.email,
      originUrl
    });
    if (!result.ok || !result.summary) {
      res.status(400).json({ ok: false, error: result.error || "Could not follow team." });
      return;
    }
    const teams = await listTeamsForUser(sid, originUrl);
    res.json({
      ok: true,
      ...sessionToken ? { sessionToken } : {},
      team: result.summary,
      teams
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to follow team."
    });
  }
});

// server/routers/authRouter.ts
import express5 from "express";
import crypto9 from "crypto";

// server/webauthnVerify.ts
import crypto8 from "crypto";
function readCborLength(buf, addtl, offset) {
  if (addtl < 24) {
    return { length: addtl, nextOffset: offset };
  }
  if (addtl === 24) {
    if (offset + 1 > buf.length) throw new Error("Truncated CBOR 1-byte length.");
    return { length: buf.readUInt8(offset), nextOffset: offset + 1 };
  }
  if (addtl === 25) {
    if (offset + 2 > buf.length) throw new Error("Truncated CBOR 2-byte length.");
    return { length: buf.readUInt16BE(offset), nextOffset: offset + 2 };
  }
  if (addtl === 26) {
    if (offset + 4 > buf.length) throw new Error("Truncated CBOR 4-byte length.");
    return { length: buf.readUInt32BE(offset), nextOffset: offset + 4 };
  }
  if (addtl === 27) {
    if (offset + 8 > buf.length) throw new Error("Truncated CBOR 8-byte length.");
    const big = buf.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("CBOR integer exceeds JS safe integer range.");
    }
    return { length: Number(big), nextOffset: offset + 8 };
  }
  throw new Error(`Unsupported CBOR additional info: ${addtl}`);
}
function decodeCborValue(buf, offset = 0, depth = 0) {
  if (depth > 16) throw new Error("CBOR nesting limit exceeded.");
  if (offset >= buf.length) throw new Error("Unexpected end of CBOR input.");
  const initial = buf.readUInt8(offset);
  const major = initial >> 5;
  const addtl = initial & 31;
  let pos = offset + 1;
  if (major === 0) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    return { value: length, nextOffset };
  }
  if (major === 1) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    return { value: -1 - length, nextOffset };
  }
  if (major === 2) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    if (nextOffset + length > buf.length) throw new Error("Truncated CBOR byte string.");
    return { value: Buffer.from(buf.subarray(nextOffset, nextOffset + length)), nextOffset: nextOffset + length };
  }
  if (major === 3) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    if (nextOffset + length > buf.length) throw new Error("Truncated CBOR UTF-8 string.");
    return { value: buf.subarray(nextOffset, nextOffset + length).toString("utf8"), nextOffset: nextOffset + length };
  }
  if (major === 4) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    pos = nextOffset;
    const arr = [];
    for (let i = 0; i < length; i++) {
      const item = decodeCborValue(buf, pos, depth + 1);
      arr.push(item.value);
      pos = item.nextOffset;
    }
    return { value: arr, nextOffset: pos };
  }
  if (major === 5) {
    const { length, nextOffset } = readCborLength(buf, addtl, pos);
    pos = nextOffset;
    const map = /* @__PURE__ */ new Map();
    for (let i = 0; i < length; i++) {
      const key = decodeCborValue(buf, pos, depth + 1);
      const val = decodeCborValue(buf, key.nextOffset, depth + 1);
      map.set(key.value, val.value);
      pos = val.nextOffset;
    }
    return { value: map, nextOffset: pos };
  }
  if (major === 6) {
    const { nextOffset } = readCborLength(buf, addtl, pos);
    return decodeCborValue(buf, nextOffset, depth + 1);
  }
  if (major === 7) {
    if (addtl === 20) return { value: false, nextOffset: pos };
    if (addtl === 21) return { value: true, nextOffset: pos };
    if (addtl === 22) return { value: null, nextOffset: pos };
    if (addtl === 23) return { value: void 0, nextOffset: pos };
    if (addtl === 24) {
      if (pos + 1 > buf.length) throw new Error("Truncated CBOR simple value.");
      return { value: buf.readUInt8(pos), nextOffset: pos + 1 };
    }
  }
  throw new Error(`Unsupported CBOR major type ${major} / addtl ${addtl}`);
}
function padFixedCoord(buf, size) {
  if (buf.length === size) return buf;
  if (buf.length < size) {
    return Buffer.concat([Buffer.alloc(size - buf.length, 0), buf]);
  }
  if (buf.length === size + 1 && buf[0] === 0) {
    return buf.subarray(1);
  }
  throw new Error(`Invalid EC coordinate byte length: ${buf.length}`);
}
function coseKeyMapToSpki(coseMap) {
  const kty = Number(coseMap.get(1));
  const alg = Number(coseMap.get(3));
  if (kty === 2 && alg === -7) {
    const crv = Number(coseMap.get(-1));
    const xBuf = coseMap.get(-2);
    const yBuf = coseMap.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(xBuf) || !Buffer.isBuffer(yBuf)) {
      throw new Error("Invalid COSE EC2 P-256 public key parameters.");
    }
    const pubKey = crypto8.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: padFixedCoord(xBuf, 32).toString("base64url"),
        y: padFixedCoord(yBuf, 32).toString("base64url")
      },
      format: "jwk"
    });
    const spkiDer = pubKey.export({ format: "der", type: "spki" });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString("base64"),
      coseAlg: alg
    };
  }
  if (kty === 3 && alg === -257) {
    const nBuf = coseMap.get(-1);
    const eBuf = coseMap.get(-2);
    if (!Buffer.isBuffer(nBuf) || !Buffer.isBuffer(eBuf)) {
      throw new Error("Invalid COSE RSA public key parameters.");
    }
    const pubKey = crypto8.createPublicKey({
      key: {
        kty: "RSA",
        n: nBuf.toString("base64url"),
        e: eBuf.toString("base64url")
      },
      format: "jwk"
    });
    const spkiDer = pubKey.export({ format: "der", type: "spki" });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString("base64"),
      coseAlg: alg
    };
  }
  if (kty === 1 && alg === -8) {
    const crv = Number(coseMap.get(-1));
    const xBuf = coseMap.get(-2);
    if (crv !== 6 || !Buffer.isBuffer(xBuf)) {
      throw new Error("Invalid COSE Ed25519 public key parameters.");
    }
    const pubKey = crypto8.createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: padFixedCoord(xBuf, 32).toString("base64url")
      },
      format: "jwk"
    });
    const spkiDer = pubKey.export({ format: "der", type: "spki" });
    return {
      publicKeySpkiBase64: Buffer.from(spkiDer).toString("base64"),
      coseAlg: alg
    };
  }
  throw new Error(`Unsupported COSE key type (${kty}) or algorithm (${alg}).`);
}
function parseClientDataJson(rawB64Url, expectedType, expectedChallenge, expectedOrigins) {
  if (typeof rawB64Url !== "string" || !rawB64Url.trim()) {
    throw new Error("Missing WebAuthn clientDataJSON.");
  }
  const clientDataBytes = Buffer.from(rawB64Url.trim(), "base64url");
  if (clientDataBytes.length === 0) {
    throw new Error("Empty WebAuthn clientDataJSON.");
  }
  let parsed;
  try {
    parsed = JSON.parse(clientDataBytes.toString("utf8"));
  } catch {
    throw new Error("Malformed WebAuthn clientDataJSON.");
  }
  if (parsed.type !== expectedType) {
    throw new Error(`Unexpected WebAuthn ceremony type: ${String(parsed.type)}.`);
  }
  if (!parsed.challenge || !timingSafeStringEqual(parsed.challenge, expectedChallenge)) {
    throw new Error("WebAuthn challenge mismatch.");
  }
  const origin = String(parsed.origin || "").trim();
  if (!origin || !expectedOrigins.includes(origin)) {
    throw new Error(`Untrusted WebAuthn origin: ${origin || "missing"}.`);
  }
  return { clientDataBytes, origin };
}
function assertRpIdHashAndFlags(authData, expectedRpId, requireAtFlag) {
  const minLen = requireAtFlag ? 55 : 37;
  if (!Buffer.isBuffer(authData) || authData.length < minLen) {
    throw new Error("Truncated WebAuthn authenticatorData.");
  }
  const expectedRpHash = crypto8.createHash("sha256").update(expectedRpId).digest();
  const actualRpHash = authData.subarray(0, 32);
  if (!crypto8.timingSafeEqual(actualRpHash, expectedRpHash)) {
    throw new Error("WebAuthn RP ID hash mismatch.");
  }
  const flags = authData.readUInt8(32);
  const up = (flags & 1) !== 0;
  const at = (flags & 64) !== 0;
  if (!up) {
    throw new Error("WebAuthn user-present (UP) flag is not set.");
  }
  if (requireAtFlag && !at) {
    throw new Error("WebAuthn attested-credential-data (AT) flag is missing.");
  }
  return authData.readUInt32BE(33);
}
function verifyWebAuthnRegistration(params) {
  const cred = params.credential;
  if (!cred || typeof cred !== "object") {
    throw new Error("Missing credential payload.");
  }
  const claimedCredId = String(cred.id || cred.rawId || "").trim();
  if (!claimedCredId) {
    throw new Error("Missing WebAuthn credential ID.");
  }
  parseClientDataJson(
    cred.response?.clientDataJSON,
    "webauthn.create",
    params.expectedChallenge,
    params.expectedOrigins
  );
  const attObjB64 = cred.response?.attestationObject;
  if (typeof attObjB64 !== "string" || !attObjB64.trim()) {
    throw new Error("Missing WebAuthn attestationObject.");
  }
  const attBytes = Buffer.from(attObjB64.trim(), "base64url");
  const decodedAtt = decodeCborValue(attBytes).value;
  if (!(decodedAtt instanceof Map)) {
    throw new Error("Malformed WebAuthn attestationObject CBOR map.");
  }
  const authData = decodedAtt.get("authData");
  if (!Buffer.isBuffer(authData)) {
    throw new Error("Missing authData inside attestationObject.");
  }
  const signCount = assertRpIdHashAndFlags(authData, params.expectedRpId, true);
  const credIdLen = authData.readUInt16BE(53);
  const credIdEnd = 55 + credIdLen;
  if (credIdLen <= 0 || credIdEnd >= authData.length) {
    throw new Error("Invalid attested credential ID length.");
  }
  const credIdBuf = authData.subarray(55, credIdEnd);
  const attestedCredId = credIdBuf.toString("base64url");
  if (attestedCredId !== claimedCredId) {
    throw new Error("Attested credential ID does not match submitted credential.id.");
  }
  const coseDecoded = decodeCborValue(authData, credIdEnd).value;
  if (!(coseDecoded instanceof Map)) {
    throw new Error("Malformed COSE public key in attestationObject.");
  }
  const { publicKeySpkiBase64, coseAlg } = coseKeyMapToSpki(coseDecoded);
  return {
    credId: attestedCredId,
    publicKeySpkiBase64,
    coseAlg,
    signCount
  };
}
function verifyWebAuthnAssertion(params) {
  try {
    const cred = params.credential;
    if (!cred || typeof cred !== "object") {
      return { verified: false, newSignCount: params.storedCounter, error: "Missing credential." };
    }
    const { clientDataBytes } = parseClientDataJson(
      cred.response?.clientDataJSON,
      "webauthn.get",
      params.expectedChallenge,
      params.expectedOrigins
    );
    const authDataB64 = cred.response?.authenticatorData;
    const sigB64 = cred.response?.signature;
    if (typeof authDataB64 !== "string" || !authDataB64.trim() || typeof sigB64 !== "string" || !sigB64.trim()) {
      return {
        verified: false,
        newSignCount: params.storedCounter,
        error: "Missing authenticatorData or signature."
      };
    }
    const authData = Buffer.from(authDataB64.trim(), "base64url");
    const sigBuf = Buffer.from(sigB64.trim(), "base64url");
    const newSignCount = assertRpIdHashAndFlags(authData, params.expectedRpId, false);
    if ((params.storedCounter > 0 || newSignCount > 0) && newSignCount <= params.storedCounter) {
      return {
        verified: false,
        newSignCount,
        error: "Passkey signature counter regression detected."
      };
    }
    if (!params.publicKeySpkiBase64) {
      return {
        verified: false,
        newSignCount,
        error: "Passkey record lacks stored public key."
      };
    }
    const pubKey = crypto8.createPublicKey({
      key: Buffer.from(params.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki"
    });
    const clientDataHash = crypto8.createHash("sha256").update(clientDataBytes).digest();
    const signedData = Buffer.concat([authData, clientDataHash]);
    const algDigest = params.coseAlg === -8 ? null : "sha256";
    const isValidSig = crypto8.verify(algDigest, signedData, pubKey, sigBuf);
    if (!isValidSig) {
      return {
        verified: false,
        newSignCount,
        error: "Invalid WebAuthn assertion signature."
      };
    }
    return { verified: true, newSignCount };
  } catch (err) {
    return {
      verified: false,
      newSignCount: params.storedCounter,
      error: err instanceof Error ? err.message : "WebAuthn verification failed."
    };
  }
}
var consumedJtiInMemory = /* @__PURE__ */ new Set();
async function consumePasskeyChallengeJti(jti) {
  const cleanJti = String(jti || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleanJti || cleanJti.length < 8) return false;
  if (consumedJtiInMemory.has(cleanJti)) return false;
  const vaultKey = `passkey_jti_${cleanJti}`;
  return withVaultLock(vaultKey, async () => {
    if (consumedJtiInMemory.has(cleanJti)) return false;
    const existing = await loadTenantVaultAsync(vaultKey, null);
    if (existing?.usedAt) {
      consumedJtiInMemory.add(cleanJti);
      return false;
    }
    if (consumedJtiInMemory.size > 5e3) {
      const oldest = consumedJtiInMemory.values().next().value;
      if (oldest) consumedJtiInMemory.delete(oldest);
    }
    consumedJtiInMemory.add(cleanJti);
    await saveTenantVaultAsync(vaultKey, { usedAt: Date.now() });
    return true;
  });
}

// server/accountLifecycleService.ts
import fs5 from "fs";
async function bestEffortRevokeUpstreamTokens(stravaAccessToken, polarAccessToken, polarUserId) {
  const tasks = [];
  if (stravaAccessToken) {
    tasks.push(
      fetch(
        `https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(stravaAccessToken)}`,
        { method: "POST", signal: AbortSignal.timeout(4e3) }
      ).catch(() => void 0)
    );
  }
  if (polarAccessToken && polarUserId) {
    tasks.push(
      fetch(`https://polarremote.com/v2/users/${encodeURIComponent(polarUserId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${polarAccessToken}` },
        signal: AbortSignal.timeout(4e3)
      }).catch(() => void 0)
    );
  }
  await Promise.allSettled(tasks);
}
async function deleteThreshAccountPermanently(req, res) {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ ok: false, error: "Authentication required." });
    return;
  }
  let user = null;
  if (claims.sub?.startsWith("usr_")) {
    user = await getUserById(claims.sub);
  } else if (claims.sub) {
    user = await getUserByProvider("strava", claims.sub);
  }
  const activeStore = getScopedRuntimeStore(req);
  const candidateSids = /* @__PURE__ */ new Set([claims.sid]);
  if (user?.id) {
    candidateSids.add(deriveUserSessionSid(user.id));
  }
  const stravaIds = /* @__PURE__ */ new Set();
  if (activeStore?.stravaAthleteId) stravaIds.add(String(activeStore.stravaAthleteId));
  for (const p of user?.authProviders || []) {
    if (p.provider === "strava" && p.providerId) stravaIds.add(p.providerId);
  }
  for (const s of user?.connectedServices || []) {
    if (s.service === "strava" && s.athleteId) stravaIds.add(s.athleteId);
  }
  for (const sidVal of stravaIds) {
    candidateSids.add(deriveStravaSessionSid(sidVal));
  }
  const dirForGuard = await loadDirectory();
  for (const teamId of dirForGuard.allTeamIds || []) {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) continue;
    const isMyHeadCoach = doc.memberships.some(
      (m) => candidateSids.has(m.userSid || "") && m.role === "HEAD_COACH" && m.status !== "REVOKED"
    );
    if (!isMyHeadCoach) continue;
    const otherActive = doc.memberships.filter(
      (m) => !candidateSids.has(m.userSid || "") && m.status !== "REVOKED"
    );
    const hasAnotherHeadCoach = otherActive.some((m) => m.role === "HEAD_COACH");
    if (otherActive.length > 0 && !hasAnotherHeadCoach) {
      res.status(409).json({
        ok: false,
        error: "You are the sole Head Coach of an active team. Transfer Head Coach ownership to another staff member in Team Settings before permanently deleting your account."
      });
      return;
    }
  }
  let stravaAccessToken = activeStore?.stravaAccessToken || "";
  let stravaRefreshToken = activeStore?.stravaRefreshToken || "";
  let stravaExpiresAt = Number(activeStore?.stravaExpiresAt || 0);
  let stravaClientId = activeStore?.stravaClientId || (process.env.STRAVA_CLIENT_ID || "").trim();
  let stravaClientSecret = activeStore?.stravaClientSecret || (process.env.STRAVA_CLIENT_SECRET || "").trim();
  let polarAccessToken = activeStore?.polarAccessToken || "";
  let polarUserId = activeStore?.polarUserId || "";
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    const sDoc = await loadTenantVaultAsync(
      `session_${scopeKey}`,
      null
    );
    if (sDoc?.stravaAccessToken && !stravaAccessToken) stravaAccessToken = sDoc.stravaAccessToken;
    if (sDoc?.stravaRefreshToken && !stravaRefreshToken) stravaRefreshToken = sDoc.stravaRefreshToken;
    if (sDoc?.stravaExpiresAt && !stravaExpiresAt) stravaExpiresAt = Number(sDoc.stravaExpiresAt || 0);
    if (sDoc?.stravaClientId && !stravaClientId) stravaClientId = sDoc.stravaClientId;
    if (sDoc?.stravaClientSecret && !stravaClientSecret) stravaClientSecret = sDoc.stravaClientSecret;
    if (sDoc?.polarAccessToken && !polarAccessToken) polarAccessToken = sDoc.polarAccessToken;
    if (sDoc?.polarUserId && !polarUserId) polarUserId = sDoc.polarUserId;
  }
  const nowSecs = Math.floor(Date.now() / 1e3);
  if ((!stravaAccessToken || stravaExpiresAt > 0 && nowSecs >= stravaExpiresAt - 60) && stravaRefreshToken && stravaClientId && stravaClientSecret) {
    try {
      const refResp = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: stravaClientId,
          client_secret: stravaClientSecret,
          grant_type: "refresh_token",
          refresh_token: stravaRefreshToken
        }),
        signal: AbortSignal.timeout(4e3)
      });
      if (refResp.ok) {
        const refData = await refResp.json();
        if (refData.access_token) stravaAccessToken = refData.access_token;
      }
    } catch {
    }
  }
  await bestEffortRevokeUpstreamTokens(stravaAccessToken, polarAccessToken, polarUserId);
  const deletedTeamIds = [];
  for (const sid of candidateSids) {
    const idx = await loadTenantVaultAsync(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: ""
    });
    for (const teamId of idx.teamIds) {
      await withVaultLock(teamDocVaultKey(teamId), async () => {
        const doc = await loadTeamDocRaw(teamId);
        if (!doc) return;
        const myMems = doc.memberships.filter((m) => candidateSids.has(m.userSid || ""));
        const otherActive = doc.memberships.filter(
          (m) => !candidateSids.has(m.userSid || "") && m.status !== "REVOKED"
        );
        if (myMems.some((m) => m.role === "HEAD_COACH") && otherActive.length === 0) {
          await deleteTenantVault(teamDocVaultKey(teamId));
          deletedTeamIds.push(teamId);
          return;
        }
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        for (const m of doc.memberships) {
          if (candidateSids.has(m.userSid || "")) {
            m.status = "REVOKED";
            m.leftAt = nowIso;
            m.invitedName = "Deleted Athlete";
            m.userSid = void 0;
            m.stravaAthleteId = void 0;
            m.invitedEmail = void 0;
            m.invitedPhone = void 0;
            m.parentGuardianEmail = void 0;
            m.parentConsentToken = void 0;
            m.parentConsentTokenHash = void 0;
            m.liveSnapshot = void 0;
            m.coachRecordedActivities = void 0;
            m.rawInviteToken = void 0;
            m.inviteTokenHash = void 0;
          }
        }
        doc.updatedAt = nowIso;
        await saveTeamDocRaw(teamId, doc);
      });
      await removeTeamFromUserIndex(sid, teamId).catch(() => void 0);
    }
    await deleteTenantVault(userTeamsVaultKey(sid));
  }
  if (deletedTeamIds.length > 0) {
    await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
      const dir = await loadDirectory();
      const deletedSet = new Set(deletedTeamIds);
      for (const [slug, tId] of Object.entries(dir.bySlug)) {
        if (deletedSet.has(tId)) delete dir.bySlug[slug];
      }
      for (const [code, tId] of Object.entries(dir.byJoinCode)) {
        if (deletedSet.has(tId)) delete dir.byJoinCode[code];
      }
      dir.allTeamIds = dir.allTeamIds.filter((id) => !deletedSet.has(id));
      await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
    });
  }
  if (user?.email) {
    const cleanEmail = user.email.trim().toLowerCase();
    await deleteTenantVault(`auth_email_${hashAuthLookupKey(cleanEmail)}`);
    await withVaultLock(EMAIL_DIRECTORY_KEY, async () => {
      const emailDir = await loadTenantVaultAsync(EMAIL_DIRECTORY_KEY, {
        byEmail: {}
      });
      if (emailDir.byEmail[cleanEmail]) {
        delete emailDir.byEmail[cleanEmail];
        await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
      }
    });
  }
  if (user) {
    for (const p of user.authProviders || []) {
      await deleteTenantVault(`auth_prov_${p.provider}_${hashAuthLookupKey(p.providerId)}`);
    }
    await deleteTenantVault(`user_${user.id}`);
    await deleteTenantVault(`athlete_state_user_${user.id}`);
  }
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    await deleteTenantVault(`session_${scopeKey}`);
    await deleteTenantVault(`session_${sid}`);
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
    await deleteTenantVault(`athlete_state_sid_${sid.slice(0, 32)}`);
    await deleteTenantVault(`athlete_state_sid_${scopeKey}`);
  }
  for (const stravaId of stravaIds) {
    const cleanStravaId = String(stravaId).replace(/[^0-9a-zA-Z_-]/g, "");
    if (cleanStravaId) {
      await deleteTenantVault(`athlete_state_strava_${cleanStravaId}`);
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${cleanStravaId}.json`;
        if (fs5.existsSync(archivePath)) fs5.unlinkSync(archivePath);
      } catch {
      }
    }
  }
  runtimeStore.stravaAccessToken = "";
  runtimeStore.stravaRefreshToken = "";
  runtimeStore.stravaAthleteId = void 0;
  bindRequestScopeKey(req, "");
  clearSessionCookie(res);
  appendSetCookieHeader(res, buildClearVaultCookieHeader());
  appendSetCookieHeader(res, buildClearUserCookieHeader());
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, deleted: true, origin: resolveSafeOrigin(req.headers.origin) });
}

// server/routers/authRouter.ts
var authRouter = express5.Router();
var magicLinkRateStore = /* @__PURE__ */ new Map();
function checkMagicLinkRateLimit(key, limit, windowMs = 10 * 60 * 1e3) {
  const now = Date.now();
  if (magicLinkRateStore.size > 2e3) {
    for (const [k, v] of magicLinkRateStore.entries()) {
      if (now > v.resetAt) magicLinkRateStore.delete(k);
    }
  }
  const existing = magicLinkRateStore.get(key);
  if (!existing || now > existing.resetAt) {
    magicLinkRateStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) {
    return false;
  }
  existing.count += 1;
  return true;
}
function getRequestHostCandidate(req) {
  return String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim().replace(/[^a-zA-Z0-9.:-]/g, "");
}
function getAppBaseUrl(req) {
  const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "").split(",")[0].trim().toLowerCase();
  const isHttps = req.secure || rawProto === "https";
  const proto = isHttps ? "https" : "http";
  const host = getRequestHostCandidate(req);
  const headerOrigin = host ? `${proto}://${host}` : "";
  if (isProductionDeployment()) {
    const trustedHeaderOrigin = resolveTrustedCorsOrigin(headerOrigin);
    if (trustedHeaderOrigin) return trustedHeaderOrigin;
    const envCandidates = [
      process.env.APP_BASE_URL,
      process.env.APP_URL,
      process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : void 0,
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : void 0
    ];
    for (const cand of envCandidates) {
      const resolved = resolveSafeOrigin(cand);
      if (resolved && !resolved.includes("MY_APP_URL")) {
        return resolved;
      }
    }
    return "https://thresh-dev.vercel.app";
  }
  return resolveSafeOrigin(headerOrigin) || "http://localhost:3000";
}
function getRpId(req) {
  try {
    return new URL(getAppBaseUrl(req)).hostname || "localhost";
  } catch {
    return "localhost";
  }
}
function getExpectedWebAuthnOrigins(req) {
  const origins = /* @__PURE__ */ new Set([getAppBaseUrl(req)]);
  const headerOrigin = resolveTrustedCorsOrigin(req.headers.origin);
  if (headerOrigin) origins.add(headerOrigin);
  if (!isProductionDeployment()) {
    const host = getRequestHostCandidate(req);
    if (host) {
      origins.add(`http://${host}`);
      origins.add(`https://${host}`);
    }
  }
  return Array.from(origins);
}
function resolveGoogleCallbackUrl(req) {
  const explicitRedirect = (process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
    }
  }
  const reqOrigin = getAppBaseUrl(req);
  const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "").split(",")[0].trim().toLowerCase();
  const host = getRequestHostCandidate(req);
  const trustedForwarded = host ? resolveTrustedCorsOrigin(`${req.secure || rawProto === "https" ? "https" : "http"}://${host}`) : null;
  if (trustedForwarded) {
    return `${trustedForwarded}/api/auth/google/callback`;
  }
  const envOrigin = resolveSafeOrigin(process.env.APP_URL || "");
  if (envOrigin && !envOrigin.includes("MY_APP_URL") && (!envOrigin.includes("localhost") || reqOrigin.includes("localhost"))) {
    return `${envOrigin}/api/auth/google/callback`;
  }
  return `${reqOrigin}/api/auth/google/callback`;
}
function buildAuthReturnRedirectUrl(stateClaims) {
  const basePath = stateClaims?.slug ? `/join/${encodeURIComponent(stateClaims.slug)}` : "/";
  const params = new URLSearchParams();
  params.set("auth_just_signed_in", "1");
  if (stateClaims?.joinCode && !stateClaims?.slug) {
    params.set("join", stateClaims.joinCode);
  }
  if (stateClaims?.inviteToken) {
    params.set("t", stateClaims.inviteToken);
  }
  return `${basePath}?${params.toString()}`;
}
function toCompactUserBackupPayload(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    birthMonthYear: user.birthMonthYear,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    authProviders: (user.authProviders || []).slice(0, 6),
    passkeys: (user.passkeys || []).slice(0, 4).map((pk) => ({
      id: pk.id,
      publicKeySpkiBase64: pk.publicKeySpkiBase64 || "",
      ...pk.coseAlg !== void 0 ? { coseAlg: pk.coseAlg } : {},
      counter: pk.counter,
      createdAt: pk.createdAt
    })),
    connectedServices: (user.connectedServices || []).slice(0, 6)
  };
}
async function finalizeUserAuthentication(req, res, user) {
  const userSid = deriveUserSessionSid(user.id);
  const prevClaims = getVerifiedSessionClaims(req);
  const sessionToken = setSessionCookie(req, res, user.id, userSid, "verified");
  const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "").split(",")[0].trim().toLowerCase();
  const isSecure = req.secure || rawProto === "https";
  const userCookieHeader = buildEncryptedUserCookieHeader(
    toCompactUserBackupPayload(user),
    isSecure
  );
  if (userCookieHeader) {
    appendSetCookieHeader(res, userCookieHeader);
  }
  if (prevClaims?.sid && prevClaims.sid !== userSid) {
    try {
      await migrateAnonymousTeamsToSid({
        oldSid: prevClaims.sid,
        newSid: userSid,
        athleteName: user.name,
        email: user.email
      });
    } catch (err) {
      console.warn("[THRESH Auth] Anonymous teams migration warning:", err);
    }
  }
  if (user.email) {
    try {
      await autoLinkPendingTeamInvitesByEmail({
        email: user.email,
        userSid,
        athleteName: user.name
      });
    } catch (err) {
      console.warn("[THRESH Auth] Auto-link pending team invites warning:", err);
    }
  }
  return { userSid, sessionToken };
}
authRouter.get("/api/auth/me", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
      return res.json({ authenticated: false, user: null });
    }
    let user = null;
    if (claims.sub.startsWith("usr_")) {
      user = await getUserById(claims.sub);
      if (!user) {
        const cookies = parseCookies(req.headers.cookie);
        const backupEnvelope = cookies[USER_VAULT_COOKIE_NAME];
        if (backupEnvelope) {
          const restored = decryptJsonFromVault(backupEnvelope);
          if (restored && restored.id === claims.sub) {
            user = restored;
            try {
              await saveUser(restored);
            } catch {
            }
          }
        }
      }
    } else {
      user = await getUserByProvider("strava", claims.sub);
    }
    if (!user) {
      return res.json({
        authenticated: true,
        legacySession: true,
        sessionSub: claims.sub,
        user: null
      });
    }
    return res.json({
      authenticated: true,
      user,
      sessionToken: issueSessionToken(claims.sub, claims.sid)
    });
  } catch (err) {
    console.error("[THRESH Auth] /api/auth/me error:", err);
    return res.status(500).json({ error: "Failed retrieving session state." });
  }
});
authRouter.get("/api/auth/google/url", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = resolveGoogleCallbackUrl(req);
  if (!clientId) {
    if (isProductionDeployment()) {
      return res.json({
        configured: false,
        devMode: false,
        error: `Google Sign-In is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel Environment Variables (Authorized Redirect URI: ${redirectUri}).`
      });
    }
    return res.json({
      configured: false,
      devMode: true,
      message: "GOOGLE_CLIENT_ID not configured; dev mock login available.",
      devMockUrl: "/api/auth/mock-login?provider=google",
      devMockLoginUrl: "/api/auth/mock-login?provider=google"
    });
  }
  const joinCode = String(req.query.joinCode || req.query.join || "").trim().slice(0, 32) || void 0;
  const slug = String(req.query.slug || "").trim().slice(0, 64) || void 0;
  const inviteToken = String(req.query.inviteToken || req.query.t || "").trim().slice(0, 96) || void 0;
  const { stateToken, nonce } = issueOAuthStateToken({
    flow: req.query.flow || "redirect",
    joinCode,
    slug,
    inviteToken
  });
  setOAuthStateCookie(req, res, nonce);
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", stateToken);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "select_account");
  const url = googleAuthUrl.toString();
  return res.json({
    configured: true,
    url,
    authUrl: url,
    redirectUri
  });
});
authRouter.get("/api/auth/google/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  const error = String(req.query.error || "").trim();
  if (error || !code) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error || "missing_code")}`);
  }
  const stateClaims = verifyOAuthStateToken(state);
  const cookieNonce = getOAuthStateCookieNonce(req);
  clearOAuthStateCookie(res);
  if (!stateClaims || !cookieNonce || !timingSafeStringEqual(stateClaims.nonce, cookieNonce)) {
    return res.redirect("/?auth_error=invalid_state_csrf");
  }
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = resolveGoogleCallbackUrl(req);
  if (!clientId || !clientSecret) {
    return res.redirect("/?auth_error=google_not_configured");
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!tokenRes.ok) {
      console.error("[THRESH Auth] Google token exchange failed:", await tokenRes.text());
      return res.redirect("/?auth_error=google_token_exchange_failed");
    }
    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userRes.ok) {
      return res.redirect("/?auth_error=google_userinfo_failed");
    }
    const googleUser = await userRes.json();
    const user = await findOrCreateUser("google", googleUser.sub, {
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture
    });
    await finalizeUserAuthentication(req, res, user);
    return res.redirect(buildAuthReturnRedirectUrl(stateClaims));
  } catch (err) {
    console.error("[THRESH Auth] Google callback processing error:", err);
    return res.redirect("/?auth_error=internal_error");
  }
});
authRouter.post("/api/auth/magic-link/send", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length < 5) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const clientIp = String(req.headers["x-vercel-forwarded-for"] || req.ip || "local").split(",")[0].trim();
  if (!checkMagicLinkRateLimit(`ml_ip:${clientIp}`, 10) || !checkMagicLinkRateLimit(`ml_em:${email}`, 5)) {
    return res.status(429).json({
      error: "Too many sign-in link requests. Please wait a few minutes and try again."
    });
  }
  const joinCode = String(req.body?.joinCode || "").trim().slice(0, 32) || void 0;
  const slug = String(req.body?.slug || "").trim().slice(0, 64) || void 0;
  const inviteToken = String(req.body?.inviteToken || "").trim().slice(0, 96) || void 0;
  const pendingJoin = joinCode || slug || inviteToken ? { joinCode, slug, inviteToken } : void 0;
  try {
    const { token } = await createMagicLinkToken(email, pendingJoin);
    const baseUrl = getAppBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    const result = await sendMagicLinkEmail(email, verifyUrl);
    if (!result.sent) {
      return res.status(503).json({
        ok: false,
        error: result.error || "Email delivery service unavailable."
      });
    }
    const exposeDev = !isProductionDeployment() && Boolean(result.devMode);
    return res.json({
      ok: true,
      message: "A secure sign-in link has been sent to your email.",
      devMode: exposeDev,
      previewUrl: exposeDev ? result.previewUrl : void 0
    });
  } catch (err) {
    console.error("[THRESH Auth] Failed generating magic link:", err);
    return res.status(500).json({ error: "Unable to dispatch sign-in email. Please try again." });
  }
});
authRouter.get("/api/auth/magic-link/verify", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) {
    return res.redirect("/?auth_error=missing_magic_token");
  }
  try {
    const previewPayload = await peekMagicLinkPayload(token);
    if (!previewPayload?.email) {
      return res.redirect("/?auth_error=expired_or_invalid_magic_token");
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Confirm Sign-In \xB7 THRESH</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#080D0A;color:#F4F7F4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;">
    <div style="background:#111A15;border:2px solid #25573A;border-radius:18px;padding:28px 26px;max-width:420px;width:100%;text-align:center;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:14px;">THRESH \xB7 Email Sign-In</div>
      <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;">Complete Sign-In</h1>
      <p style="margin:0 0 20px;color:#C8D8CE;font-size:14px;line-height:1.55;">Confirm your sign-in as <strong>${escapeHtml(previewPayload.email)}</strong> to open your THRESH workspace.</p>
      <form method="POST" action="/api/auth/magic-link/verify">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" style="width:100%;min-height:44px;background:#C8FF00;color:#080A09;border:none;border-radius:12px;padding:12px 20px;font-weight:800;font-size:14px;cursor:pointer;">Complete Sign-In to THRESH</button>
      </form>
    </div>
  </body>
</html>`);
  } catch (err) {
    console.error("[THRESH Auth] Magic link preview error:", err);
    return res.redirect("/?auth_error=magic_link_verification_failed");
  }
});
authRouter.post("/api/auth/magic-link/verify", async (req, res) => {
  const token = String(req.body?.token || req.query.token || "").trim();
  if (!token) {
    return res.redirect(303, "/?auth_error=missing_magic_token");
  }
  try {
    const verifiedPayload = await verifyMagicLinkPayload(token);
    if (!verifiedPayload?.email) {
      return res.redirect(303, "/?auth_error=expired_or_invalid_magic_token");
    }
    const email = verifiedPayload.email;
    const user = await findOrCreateUser("magic_link", email, {
      email,
      name: email.split("@")[0]
    });
    await finalizeUserAuthentication(req, res, user);
    return res.redirect(303, buildAuthReturnRedirectUrl(verifiedPayload.pendingJoin || null));
  } catch (err) {
    console.error("[THRESH Auth] Magic link verification error:", err);
    return res.redirect(303, "/?auth_error=magic_link_verification_failed");
  }
});
authRouter.post("/api/auth/passkey/register-options", async (req, res) => {
  const rpId = getRpId(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || email.split("@")[0] || "Athlete").trim();
  const challenge = crypto9.randomBytes(32).toString("base64url");
  const userId = crypto9.randomBytes(16).toString("base64url");
  const challengeToken = issuePasskeyChallengeToken({
    challenge,
    purpose: "register",
    userId
  });
  const options = {
    challenge,
    rp: {
      name: "THRESH",
      id: rpId
    },
    user: {
      id: userId,
      name: email || "athlete@thresh.local",
      displayName: name
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },
      // ES256
      { alg: -257, type: "public-key" }
      // RS256
    ],
    timeout: 6e4,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred"
    }
  };
  return res.json({ options, challengeToken });
});
authRouter.post("/api/auth/passkey/register-verify", async (req, res) => {
  const { credential, challengeToken, email, name } = req.body || {};
  if (!credential || !challengeToken) {
    return res.status(400).json({ error: "Missing credential response or challenge token." });
  }
  const tokenClaims = verifyPasskeyChallengeToken(challengeToken);
  if (!tokenClaims || tokenClaims.purpose !== "register") {
    return res.status(400).json({ error: "Invalid or expired passkey registration challenge." });
  }
  const jtiFresh = await consumePasskeyChallengeJti(tokenClaims.jti);
  if (!jtiFresh) {
    return res.status(400).json({ error: "Passkey registration challenge has already been used." });
  }
  let verifiedReg;
  try {
    verifiedReg = verifyWebAuthnRegistration({
      credential,
      expectedChallenge: tokenClaims.challenge,
      expectedRpId: getRpId(req),
      expectedOrigins: getExpectedWebAuthnOrigins(req)
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid WebAuthn passkey registration."
    });
  }
  try {
    const cleanEmail = email ? String(email).trim().toLowerCase() : "";
    const activeClaims = getVerifiedSessionClaims(req);
    let user = null;
    if (isCanonicalAuthenticatedClaims(activeClaims) && activeClaims?.sub?.startsWith("usr_")) {
      user = await getUserById(activeClaims.sub);
      if (user) {
        await linkProviderToUser(user.id, "passkey", verifiedReg.credId, {
          email: user.email || (cleanEmail || void 0),
          name: user.name || (name ? String(name).trim() : "Passkey Athlete")
        });
        user = await getUserById(user.id) || user;
      }
    }
    if (!user) {
      if (cleanEmail) {
        const existingOwner = await getUserByEmail(cleanEmail);
        if (existingOwner) {
          return res.status(409).json({
            error: "An account with this email already exists. Please sign in first, then add a passkey from Account Settings."
          });
        }
      }
      user = await findOrCreateUser("passkey", verifiedReg.credId, {
        email: cleanEmail || void 0,
        name: name ? String(name).trim() : "Passkey Athlete"
      });
    }
    if (!user.passkeys) user.passkeys = [];
    const existingIdx = user.passkeys.findIndex((p) => p.id === verifiedReg.credId);
    const passkeyObj = {
      id: verifiedReg.credId,
      publicKeySpkiBase64: verifiedReg.publicKeySpkiBase64,
      coseAlg: verifiedReg.coseAlg,
      counter: verifiedReg.signCount,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (existingIdx >= 0) {
      user.passkeys[existingIdx] = passkeyObj;
    } else {
      user.passkeys.push(passkeyObj);
    }
    await saveUser(user);
    const { sessionToken } = await finalizeUserAuthentication(req, res, user);
    return res.json({ ok: true, user, sessionToken });
  } catch (err) {
    console.error("[THRESH Auth] Passkey registration verification error:", err);
    return res.status(500).json({ error: "Failed completing passkey registration." });
  }
});
authRouter.post("/api/auth/passkey/auth-options", (req, res) => {
  const rpId = getRpId(req);
  const challenge = crypto9.randomBytes(32).toString("base64url");
  const challengeToken = issuePasskeyChallengeToken({
    challenge,
    purpose: "auth"
  });
  const options = {
    challenge,
    rpId,
    timeout: 6e4,
    userVerification: "preferred"
  };
  return res.json({ options, challengeToken });
});
authRouter.post("/api/auth/passkey/auth-verify", async (req, res) => {
  const { credential, challengeToken } = req.body || {};
  if (!credential || !challengeToken) {
    return res.status(400).json({ error: "Missing credential response or challenge token." });
  }
  const tokenClaims = verifyPasskeyChallengeToken(challengeToken);
  if (!tokenClaims || tokenClaims.purpose !== "auth") {
    return res.status(400).json({ error: "Invalid or expired passkey auth challenge." });
  }
  const jtiFresh = await consumePasskeyChallengeJti(tokenClaims.jti);
  if (!jtiFresh) {
    return res.status(400).json({ error: "Passkey auth challenge has already been used." });
  }
  try {
    const credId = String(credential.id || credential.rawId || "").trim();
    if (!credId) {
      return res.status(400).json({ error: "Invalid credential ID received." });
    }
    const user = await getUserByProvider("passkey", credId);
    if (!user) {
      return res.status(404).json({ error: "No THRESH account associated with this passkey." });
    }
    const passkey = user.passkeys?.find((p) => p.id === credId);
    if (!passkey || !passkey.publicKeySpkiBase64) {
      return res.status(401).json({ error: "Stored passkey credential is missing or unverified." });
    }
    const assertionCheck = verifyWebAuthnAssertion({
      credential,
      expectedChallenge: tokenClaims.challenge,
      expectedRpId: getRpId(req),
      expectedOrigins: getExpectedWebAuthnOrigins(req),
      publicKeySpkiBase64: passkey.publicKeySpkiBase64,
      coseAlg: passkey.coseAlg,
      storedCounter: passkey.counter || 0
    });
    if (!assertionCheck.verified) {
      return res.status(401).json({ error: assertionCheck.error || "Passkey signature verification failed." });
    }
    if (assertionCheck.newSignCount > (passkey.counter || 0)) {
      passkey.counter = assertionCheck.newSignCount;
      await saveUser(user);
    }
    const { sessionToken } = await finalizeUserAuthentication(req, res, user);
    return res.json({ ok: true, user, sessionToken });
  } catch (err) {
    console.error("[THRESH Auth] Passkey auth verification error:", err);
    return res.status(500).json({ error: "Failed verifying passkey." });
  }
});
authRouter.post("/api/auth/mock-login", async (req, res) => {
  if (isProductionDeployment()) {
    return res.status(403).json({ error: "Mock login is disabled in production." });
  }
  const email = String(req.body?.email || req.query.email || "runner@thresh.local").trim().toLowerCase();
  const name = String(req.body?.name || req.query.name || "Sample Runner").trim();
  const provider = String(req.body?.provider || req.query.provider || "dev_mock");
  try {
    const user = await findOrCreateUser(provider, email, {
      email,
      name
    });
    await finalizeUserAuthentication(req, res, user);
    if (req.method === "GET" || req.query.redirect) {
      return res.redirect("/?auth_just_signed_in=1");
    }
    return res.json({ ok: true, user });
  } catch (err) {
    console.error("[THRESH Auth] Mock login failed:", err);
    return res.status(500).json({ error: "Failed logging in with mock credentials." });
  }
});
authRouter.get("/api/auth/mock-login", async (req, res) => {
  if (isProductionDeployment()) {
    return res.status(403).json({ error: "Mock login is disabled in production." });
  }
  const email = String(req.query.email || "runner@thresh.local").trim().toLowerCase();
  const name = String(req.query.name || "Sample Runner").trim();
  const provider = String(req.query.provider || "dev_mock");
  try {
    const user = await findOrCreateUser(provider, email, { email, name });
    await finalizeUserAuthentication(req, res, user);
    return res.redirect("/?auth_just_signed_in=1");
  } catch (err) {
    console.error("[THRESH Auth] Dev mock link failed:", err);
    return res.redirect("/?auth_error=dev_mock_failed");
  }
});
authRouter.post("/api/auth/unlink-provider", async (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const provider = String(req.body?.provider || "").trim();
  if (!provider) {
    return res.status(400).json({ error: "Missing provider to unlink." });
  }
  const result = await unlinkProviderFromUser(claims.sub, provider);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.json({ ok: true });
});
authRouter.post("/api/auth/change-email", async (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  let userId = claims.sub?.startsWith("usr_") ? claims.sub : "";
  if (!userId && claims.sub) {
    const byStrava = await getUserByProvider("strava", claims.sub);
    if (byStrava) userId = byStrava.id;
  }
  if (!userId) {
    return res.status(400).json({ error: "Please sign in with a THRESH account before changing email." });
  }
  const newEmail = String(req.body?.email || req.body?.newEmail || "").trim().toLowerCase();
  const verificationCode = String(req.body?.verificationCode || req.body?.code || "").trim();
  if (!verificationCode) {
    const reqRes = await createPendingEmailChange(userId, newEmail);
    if (!reqRes.ok) {
      const status = reqRes.error?.includes("unavailable") ? 503 : 400;
      return res.status(status).json({ error: reqRes.error || "Could not initiate email verification." });
    }
    const exposeDev = !isProductionDeployment() && Boolean(reqRes.devMode);
    return res.json({
      ok: true,
      verificationRequired: true,
      pendingEmail: newEmail,
      devMode: exposeDev,
      ...exposeDev && reqRes.devCode ? { devCode: reqRes.devCode } : {}
    });
  }
  const result = await verifyAndCommitEmailChange(
    userId,
    verificationCode,
    newEmail || void 0
  );
  if (!result.ok || !result.user || !result.newEmail) {
    return res.status(400).json({ error: result.error || "Could not verify and update email." });
  }
  try {
    await updateTeamMemberEmailsForUser({
      callerSid: claims.sid,
      oldEmail: result.oldEmail,
      newEmail: result.newEmail
    });
  } catch (err) {
    console.warn("[THRESH Auth] Team membership email update warning:", err);
  }
  const { sessionToken } = await finalizeUserAuthentication(req, res, result.user);
  return res.json({ ok: true, user: result.user, sessionToken });
});
authRouter.post("/api/auth/birth-month", async (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sub?.startsWith("usr_") || !isCanonicalAuthenticatedClaims(claims)) {
    return res.status(401).json({ error: "THRESH account required." });
  }
  const birthMonthYear = String(req.body?.birthMonthYear || "").trim();
  const incomingAge = resolveAthleteAgeTier({ birthMonthYear });
  if (incomingAge.ageTier === "UNKNOWN") {
    return res.status(400).json({ error: "Valid YYYY-MM birth month-year required." });
  }
  if (incomingAge.isUnder13) {
    return res.status(400).json({
      error: "THRESH accounts require athletes to be 13 or older (COPPA)."
    });
  }
  const existingUser = await getUserById(claims.sub);
  if (!existingUser) {
    return res.status(404).json({ error: "Account not found." });
  }
  if (existingUser.birthMonthYear) {
    const existingAge = resolveAthleteAgeTier({ birthMonthYear: existingUser.birthMonthYear });
    if (existingAge.isMinorU18 && incomingAge.ageTier === "ADULT_18_PLUS") {
      return res.status(403).json({
        error: "Minor birth date cannot be altered to an adult date directly."
      });
    }
  }
  const updated = await updateUserBirthMonthYear(claims.sub, birthMonthYear);
  if (!updated) {
    return res.status(400).json({ error: "Valid YYYY-MM birth month-year required." });
  }
  const { sessionToken } = await finalizeUserAuthentication(req, res, updated);
  return res.json({ ok: true, user: updated, sessionToken });
});
authRouter.delete("/api/auth/account", async (req, res) => {
  const confirmVal = String(req.body?.confirm || req.query.confirm || "").trim().toUpperCase();
  if (confirmVal !== "DELETE") {
    return res.status(400).json({
      ok: false,
      error: 'Please pass confirm: "DELETE" to permanently delete your THRESH account.'
    });
  }
  await deleteThreshAccountPermanently(req, res);
});

// server/routers/configRouter.ts
import { Router as Router6 } from "express";
import crypto12 from "crypto";
import fs7 from "fs";

// server/secretManager.ts
var SERVER_OWNED_SECRET_ENV_KEYS = [
  "STRAVA_CLIENT_SECRET",
  "STRAVA_REFRESH_TOKEN",
  "STRAVA_ACCESS_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "VITE_GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "NEXT_PUBLIC_GEMINI_API_KEY",
  "API_KEY",
  "MAPBOX_ACCESS_TOKEN",
  "VITE_MAPBOX_ACCESS_TOKEN",
  "THUNDERFOREST_API_KEY",
  "INTERVALS_API_KEY",
  "GARMIN_PERSONAL_API_KEY",
  "SESSION_SECRET",
  "TOKEN_VAULT_KEY"
];
function normalizeSecretValue(value) {
  return String(value ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}
function isServerOwnedSecret(value) {
  const clean = normalizeSecretValue(value);
  if (!clean) return false;
  return SERVER_OWNED_SECRET_ENV_KEYS.some(
    (key) => normalizeSecretValue(process.env[key]) === clean
  );
}
function userOwnedSecretOnly(value) {
  const clean = normalizeSecretValue(value);
  return clean && !isServerOwnedSecret(clean) ? clean : "";
}
function hasClientByoGeminiKey(req) {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  const headerKey = activeReq.headers["x-gemini-api-key"]?.trim();
  const bodyKey = typeof activeReq.body?.geminiApiKey === "string" ? activeReq.body.geminiApiKey.trim() : "";
  for (const c of [headerKey, bodyKey]) {
    const clean = (c || "").trim().replace(/^["']+|["']+$/g, "").trim();
    if (clean && clean !== "MY_GEMINI_API_KEY" && clean !== "YOUR_GEMINI_API_KEY") {
      return true;
    }
  }
  return false;
}
function isAuthorizedForServerAi(req) {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  const claims = getVerifiedSessionClaims(activeReq);
  if (isCanonicalAuthenticatedClaims(claims) || Boolean(readCompactVaultFromCookie(activeReq)?.sid)) {
    return true;
  }
  if (process.env.ALLOW_DEV_ENV_CREDENTIALS === "true") {
    return true;
  }
  return false;
}
function isAuthorizedForAi(req) {
  return hasClientByoGeminiKey(req) || isAuthorizedForServerAi(req);
}
var aiRateLimitStore = /* @__PURE__ */ new Map();
function checkAiRateLimit(key, limit = 20, windowMs = 6e4) {
  const now = Date.now();
  if (aiRateLimitStore.size > 2e3) {
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
      retryAfterSecs: Math.max(1, Math.ceil((record.resetAt - now) / 1e3))
    };
  }
  record.count += 1;
  return { allowed: true, retryAfterSecs: 0 };
}
function getClientAiRateLimitKey(req) {
  const scopeKey = resolveSessionScopeKey(req);
  if (scopeKey && scopeKey !== "unauthenticated") {
    return `session:${scopeKey}`;
  }
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
}

// server/physiologyEngine.ts
var SERVER_ZONE_COLORS = [
  "#94A3B8",
  // Z1 Cool Mist
  "#0D9488",
  // Z2 Aerobic Teal
  "#D97706",
  // Z3 Ochre Tempo
  "#EA580C",
  // Z4 THRESH Vermilion
  "#DC2626",
  // Z5 VO2 Crimson
  "#7C3AED",
  // Z6 Anaerobic Violet
  "#A21CAF"
  // Z7 Neuromuscular
];
function isGenericName(name) {
  if (!name) return true;
  const t = name.trim();
  return !t || /^athlete$/i.test(t) || /^primary\s+athlete$/i.test(t) || /^strava\s+(user|athlete)$/i.test(t);
}
function deriveObservedPhysiologyFromActivities(activities, weightKg = 70) {
  return deriveObservedPhysiologyMetrics(activities, weightKg);
}
function buildServerAthleteProfile(rawProfile, latestWellness, activities) {
  const prev = {};
  const sportSettingsList = Array.isArray(rawProfile?.sportSettings) ? rawProfile.sportSettings : rawProfile?.sportSettings && typeof rawProfile.sportSettings === "object" ? Object.values(rawProfile.sportSettings) : [];
  const bikeSetting = sportSettingsList.find(
    (s) => Array.isArray(s?.types) && (s.types.includes("Ride") || s.types.includes("VirtualRide") || s.types.includes("GravelRide") || s.types.includes("MountainBikeRide")) || /ride|bike|cycling/i.test(String(s?.type || ""))
  );
  const runSetting = sportSettingsList.find(
    (s) => Array.isArray(s?.types) && (s.types.includes("Run") || s.types.includes("VirtualRun") || s.types.includes("TrailRun")) || /run/i.test(String(s?.type || ""))
  );
  const stravaHrZonesRaw = Array.isArray(rawProfile?.stravaZones?.heart_rate?.zones) ? rawProfile.stravaZones.heart_rate.zones : [];
  const stravaPowerZonesRaw = Array.isArray(rawProfile?.stravaZones?.power?.zones) ? rawProfile.stravaZones.power.zones : [];
  let stravaDerivedMaxHr = 0;
  let stravaDerivedLthr = 0;
  if (stravaHrZonesRaw.length >= 4) {
    const z4Max = Number(stravaHrZonesRaw[3]?.max || 0);
    const z3Max = Number(stravaHrZonesRaw[2]?.max || 0);
    const z5Min = Number(stravaHrZonesRaw[4]?.min || z4Max);
    if (z4Max >= 135 && z4Max <= 215) {
      stravaDerivedLthr = z4Max;
      stravaDerivedMaxHr = Math.round(z4Max / 0.91);
    } else if (z3Max >= 125 && z3Max <= 200) {
      stravaDerivedLthr = Math.round(z3Max * 1.07);
      stravaDerivedMaxHr = Math.round(stravaDerivedLthr / 0.91);
    }
    if (z5Min > stravaDerivedLthr) {
      stravaDerivedLthr = z5Min;
    }
  }
  let stravaDerivedFtp = 0;
  if (stravaPowerZonesRaw.length >= 4) {
    const pZ4Max = Number(stravaPowerZonesRaw[3]?.max || 0);
    if (pZ4Max >= 90 && pZ4Max <= 600) {
      stravaDerivedFtp = Math.round(pZ4Max / 1.05);
    }
  }
  const explicitWeight = Number(
    rawProfile?.icu_weight || rawProfile?.weight || rawProfile?.weightKg || (latestWellness?.weightKg && Number(latestWellness.weightKg) !== 70 ? latestWellness.weightKg : 0) || latestWellness?.weightKg || prev.weightKg || 70
  );
  const weightKg = explicitWeight > 30 ? explicitWeight : 70;
  const obs = deriveObservedPhysiologyFromActivities(activities, weightKg);
  const ftp = Number(
    bikeSetting?.ftp || rawProfile?.ftp || latestWellness?.rideEftp || stravaDerivedFtp || obs.obsFtp || prev.ftp || 250
  );
  const indoorFtp = Number(
    bikeSetting?.indoor_ftp || rawProfile?.indoorFtp || prev.indoorFtp || ftp
  );
  const eFtp = Number(
    latestWellness?.rideEftp || bikeSetting?.eftp || bikeSetting?.eFtp || rawProfile?.eFtp || obs.obsFtp || prev.eFtp || ftp
  );
  const wPrime = Number(
    bikeSetting?.w_prime || latestWellness?.rideWPrime || rawProfile?.wPrime || obs.obsWPrime || prev.wPrime || Math.round(ftp * 75)
  );
  const pMax = Number(
    bikeSetting?.p_max || latestWellness?.ridePMax || rawProfile?.pMax || obs.obsPMax || prev.pMax || Math.round(ftp * 3.6)
  );
  const lthr = Number(
    bikeSetting?.lthr || rawProfile?.lthr || stravaDerivedLthr || obs.obsBikeLthr || prev.lthr || 163
  );
  const maxHr = Number(
    bikeSetting?.max_hr || rawProfile?.maxHr || stravaDerivedMaxHr || obs.obsBikeMaxHr || prev.maxHr || Math.max(lthr + 15, 182)
  );
  const sweetSpotMinPct = Number(
    bikeSetting?.sweet_spot_min || rawProfile?.sweetSpotMinPct || prev.sweetSpotMinPct || 84
  );
  const sweetSpotMaxPct = Number(
    bikeSetting?.sweet_spot_max || rawProfile?.sweetSpotMaxPct || prev.sweetSpotMaxPct || 97
  );
  const restingHr = Number(
    (latestWellness?.restingHR && Number(latestWellness.restingHR) > 25 ? latestWellness.restingHR : 0) || rawProfile?.icu_resting_hr || rawProfile?.restingHr || prev.restingHr || 50
  );
  const vo2MaxCycling = Number(
    (latestWellness?.vo2MaxCycling && Number(latestWellness.vo2MaxCycling) !== 50 ? latestWellness.vo2MaxCycling : 0) || rawProfile?.vo2MaxCycling || obs.obsVo2Bike || prev.vo2MaxCycling || Math.max(35, Math.min(85, Math.round(10.8 * (ftp / weightKg) + 7)))
  );
  const vo2MaxRunning = Number(
    (latestWellness?.vo2MaxRunning && Number(latestWellness.vo2MaxRunning) !== 50 ? latestWellness.vo2MaxRunning : 0) || rawProfile?.vo2MaxRunning || obs.obsVo2Run || prev.vo2MaxRunning || vo2MaxCycling
  );
  let thresholdPaceSecsPerKm = Number(
    rawProfile?.thresholdPaceSecsPerKm || obs.obsThresholdPace || prev.thresholdPaceSecsPerKm || 255
  );
  if (runSetting?.threshold_pace && Number(runSetting.threshold_pace) > 0) {
    const rawTp = Number(runSetting.threshold_pace);
    thresholdPaceSecsPerKm = rawTp < 15 ? Math.round(1e3 / rawTp) : Math.round(rawTp);
  }
  const runFtp = Number(
    runSetting?.ftp || rawProfile?.runFtp || latestWellness?.runEftp || obs.obsRunFtp || prev.runFtp || Math.round(weightKg * (1e3 / Math.max(130, thresholdPaceSecsPerKm)) * 0.98)
  );
  const runEFtp = Number(
    latestWellness?.runEftp || runSetting?.eftp || rawProfile?.runEFtp || prev.runEFtp || runFtp
  );
  const runLthr = Number(
    runSetting?.lthr || rawProfile?.runLthr || obs.obsRunLthr || prev.runLthr || Math.min(maxHr - 4, lthr + 4)
  );
  const runMaxHr = Number(
    runSetting?.max_hr || rawProfile?.runMaxHr || obs.obsRunMaxHr || prev.runMaxHr || Math.max(runLthr + 12, maxHr)
  );
  const rawPowerCeilings = Array.isArray(bikeSetting?.power_zones) && bikeSetting.power_zones.length >= 5 ? bikeSetting.power_zones.map((v) => Number(v)) : Array.isArray(rawProfile?.powerZones) && rawProfile.powerZones.length >= 5 ? rawProfile.powerZones.map((z) => Number(z.maxPct)) : Array.isArray(prev.powerZones) && prev.powerZones.length >= 5 ? prev.powerZones.map((z) => Number(z.maxPct)) : [55, 75, 90, 105, 120, 150, 999];
  const rawPowerNames = Array.isArray(bikeSetting?.power_zone_names) && bikeSetting.power_zone_names.length >= 5 ? bikeSetting.power_zone_names : Array.isArray(rawProfile?.powerZones) && rawProfile.powerZones.length >= 5 ? rawProfile.powerZones.map((z) => String(z.name || "")) : [
    "Active Recovery",
    "Endurance",
    "Tempo",
    "Lactate Threshold",
    "VO2 Max",
    "Anaerobic Capacity",
    "Neuromuscular Power"
  ];
  const powerZones = rawPowerCeilings.slice(0, 7).map((ceilPct, i) => {
    const minPct = i === 0 ? 0 : rawPowerCeilings[i - 1] + 1;
    const maxPct = ceilPct >= 900 ? 250 : ceilPct;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawPowerNames[i] || `Zone ${i + 1}`,
      minPct,
      maxPct,
      minWatts: i === 0 ? 0 : Math.round(rawPowerCeilings[i - 1] / 100 * ftp) + 1,
      maxWatts: Math.round(maxPct / 100 * ftp),
      minIndoorWatts: i === 0 ? 0 : Math.round(rawPowerCeilings[i - 1] / 100 * indoorFtp) + 1,
      maxIndoorWatts: Math.round(maxPct / 100 * indoorFtp),
      color: SERVER_ZONE_COLORS[i] || "#9333EA"
    };
  });
  const garmin5ZoneNames = [
    "Z1 Warm Up",
    "Z2 Easy",
    "Z3 Aerobic",
    "Z4 Threshold",
    "Z5 Maximum"
  ];
  const friel7ZoneNames = [
    "Z1 Recovery",
    "Z2 Aerobic Base",
    "Z3 Tempo",
    "Z4 Sub-Threshold",
    "Z5a Super-Threshold",
    "Z5b Aerobic Capacity",
    "Z5c Anaerobic"
  ];
  const defaultBikeHrCeilings = [
    Math.round(lthr * 0.85),
    Math.round(lthr * 0.98),
    Math.round(lthr * 1.05),
    Math.round(lthr * 1.09),
    maxHr
  ];
  const defaultBikeHrFloors = [
    Math.round(lthr * 0.71),
    defaultBikeHrCeilings[0] + 1,
    defaultBikeHrCeilings[1] + 1,
    defaultBikeHrCeilings[2] + 1,
    defaultBikeHrCeilings[3] + 1
  ];
  const rawHrCeilings = Array.isArray(bikeSetting?.hr_zones) && bikeSetting.hr_zones.length >= 5 ? bikeSetting.hr_zones.map((v) => Number(v)) : Array.isArray(rawProfile?.hrZones) && rawProfile.hrZones.length >= 5 ? rawProfile.hrZones.map((z) => Number(z.maxBpm)) : Array.isArray(prev.hrZones) && prev.hrZones.length >= 5 ? prev.hrZones.map((z) => Number(z.maxBpm)) : defaultBikeHrCeilings;
  const rawHrFloors = Array.isArray(bikeSetting?.hr_zone_floors) && bikeSetting.hr_zone_floors.length === rawHrCeilings.length ? bikeSetting.hr_zone_floors.map((v) => Number(v)) : Array.isArray(rawProfile?.hrZones) && rawProfile.hrZones.length === rawHrCeilings.length ? rawProfile.hrZones.map((z) => Number(z.minBpm)) : rawHrCeilings.length === 5 ? defaultBikeHrFloors : [];
  const rawHrNames = Array.isArray(bikeSetting?.hr_zone_names) && bikeSetting.hr_zone_names.length >= 5 ? bikeSetting.hr_zone_names : Array.isArray(rawProfile?.hrZones) && rawProfile.hrZones.length === rawHrCeilings.length ? rawProfile.hrZones.map((z) => String(z.name || "")) : rawHrCeilings.length === 5 ? garmin5ZoneNames : friel7ZoneNames;
  const hrZones = rawHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm = rawHrFloors[i] && rawHrFloors[i] > 40 ? rawHrFloors[i] : i === 0 ? rawHrCeilings.length === 5 ? Math.round(lthr * 0.71) : 60 : rawHrCeilings[i - 1] + 1;
    const maxBpm = i === rawHrCeilings.length - 1 ? Math.max(ceilBpm, maxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawHrNames[i] || `HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: Math.round(minBpm / Math.max(100, lthr) * 100),
      maxPctLthr: Math.round(maxBpm / Math.max(100, lthr) * 100),
      color: SERVER_ZONE_COLORS[i] || "#EF4444"
    };
  });
  const defaultRunHrCeilings = [
    Math.round(runLthr * 0.87),
    Math.round(runLthr * 0.97),
    Math.round(runLthr * 1.03),
    Math.round(runLthr * 1.1),
    runMaxHr
  ];
  const defaultRunHrFloors = [
    Math.round(runLthr * 0.71),
    defaultRunHrCeilings[0] + 1,
    defaultRunHrCeilings[1] + 1,
    defaultRunHrCeilings[2] + 1,
    defaultRunHrCeilings[3] + 1
  ];
  const rawRunHrCeilings = Array.isArray(runSetting?.hr_zones) && runSetting.hr_zones.length >= 5 ? runSetting.hr_zones.map((v) => Number(v)) : Array.isArray(rawProfile?.runHrZones) && rawProfile.runHrZones.length >= 5 ? rawProfile.runHrZones.map((z) => Number(z.maxBpm)) : defaultRunHrCeilings;
  const rawRunHrFloors = Array.isArray(runSetting?.hr_zone_floors) && runSetting.hr_zone_floors.length === rawRunHrCeilings.length ? runSetting.hr_zone_floors.map((v) => Number(v)) : Array.isArray(rawProfile?.runHrZones) && rawProfile.runHrZones.length === rawRunHrCeilings.length ? rawProfile.runHrZones.map((z) => Number(z.minBpm)) : rawRunHrCeilings.length === 5 ? defaultRunHrFloors : [];
  const rawRunHrNames = Array.isArray(runSetting?.hr_zone_names) && runSetting.hr_zone_names.length >= 5 ? runSetting.hr_zone_names : Array.isArray(rawProfile?.runHrZones) && rawProfile.runHrZones.length === rawRunHrCeilings.length ? rawProfile.runHrZones.map((z) => String(z.name || "")) : rawRunHrCeilings.length === 5 ? garmin5ZoneNames : friel7ZoneNames;
  const runHrZones = rawRunHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm = rawRunHrFloors[i] && rawRunHrFloors[i] > 40 ? rawRunHrFloors[i] : i === 0 ? rawRunHrCeilings.length === 5 ? Math.round(runLthr * 0.71) : 60 : rawRunHrCeilings[i - 1] + 1;
    const maxBpm = i === rawRunHrCeilings.length - 1 ? Math.max(ceilBpm, runMaxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawRunHrNames[i] || `Run HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: Math.round(minBpm / Math.max(100, runLthr) * 100),
      maxPctLthr: Math.round(maxBpm / Math.max(100, runLthr) * 100),
      color: SERVER_ZONE_COLORS[i] || "#EF4444"
    };
  });
  const candidateName = rawProfile?.name || [rawProfile?.firstname, rawProfile?.lastname].filter(Boolean).join(" ") || rawProfile?.username || prev.name || "";
  return {
    athleteId: String(rawProfile?.id || prev.athleteId || "0"),
    name: !isGenericName(candidateName) ? String(candidateName).trim() : "Athlete",
    weightKg: Number(weightKg.toFixed(1)),
    restingHr: Math.round(restingHr),
    vo2MaxCycling: Math.round(vo2MaxCycling),
    vo2MaxRunning: Math.round(vo2MaxRunning),
    ftp: Math.round(ftp),
    indoorFtp: Math.round(indoorFtp),
    eFtp: Math.round(eFtp),
    wPrime: Math.round(wPrime),
    pMax: Math.round(pMax),
    lthr: Math.round(lthr),
    maxHr: Math.round(maxHr),
    sweetSpotMinPct,
    sweetSpotMaxPct,
    runFtp: Math.round(runFtp),
    runEFtp: Math.round(runEFtp),
    runLthr: Math.round(runLthr),
    runMaxHr: Math.round(runMaxHr),
    thresholdPaceSecsPerKm: Math.round(thresholdPaceSecsPerKm),
    powerZones,
    hrZones,
    runHrZones,
    lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: rawProfile?.source || "INTERVALS_GARMIN"
  };
}
function parseWorkoutSyntaxToSteps(syntax, fallbackDurationSecs = 3600) {
  const lines = (syntax || "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"));
  if (lines.length === 0) {
    return [
      {
        label: "Warmup",
        durationSecs: Math.round(fallbackDurationSecs * 0.2),
        duration: `${Math.round(fallbackDurationSecs * 0.2 / 60)}m`,
        targetPctFtp: 60,
        targetZoneOrOutput: "60% FTP \xB7 Z1-Z2"
      },
      {
        label: "Main Set",
        durationSecs: Math.round(fallbackDurationSecs * 0.65),
        duration: `${Math.round(fallbackDurationSecs * 0.65 / 60)}m`,
        targetPctFtp: 88,
        targetZoneOrOutput: "85\u201392% FTP \xB7 Z3/Z4"
      },
      {
        label: "Cooldown",
        durationSecs: Math.round(fallbackDurationSecs * 0.15),
        duration: `${Math.round(fallbackDurationSecs * 0.15 / 60)}m`,
        targetPctFtp: 55,
        targetZoneOrOutput: "55% FTP \xB7 Z1"
      }
    ];
  }
  return lines.map((line, idx) => {
    const clean = line.replace(/^-+\s*/, "");
    const minMatch = clean.match(/(\d+)\s*m/i);
    const secMatch = clean.match(/(\d+)\s*s/i);
    const pctMatch = clean.match(/(\d+)\s*%/);
    const wattsMatch = clean.match(/(\d+)\s*w/i);
    const mins = minMatch ? Number(minMatch[1]) : secMatch ? Math.max(1, Math.round(Number(secMatch[1]) / 60)) : 10;
    const secs = secMatch && !minMatch ? Number(secMatch[1]) : mins * 60;
    const pct = pctMatch ? Number(pctMatch[1]) : wattsMatch ? Math.round(Number(wattsMatch[1]) / 300 * 100) : 75;
    return {
      label: clean.split(/\d+[ms]/i)[0]?.trim() || `Step ${idx + 1}`,
      durationSecs: secs,
      duration: minMatch ? `${mins}m` : `${secs}s`,
      targetPctFtp: pct,
      targetZoneOrOutput: clean
    };
  });
}

// server/oauthHelpers.ts
import crypto10 from "crypto";
function ensureRequestSession(req, res, fallbackSubject = "thresh-athlete") {
  const verified = getVerifiedSessionClaims(req);
  if (verified?.sid) {
    bindRequestScopeKey(req, verified.sid);
    const sessionToken2 = setSessionCookie(
      req,
      res,
      verified.sub || fallbackSubject,
      verified.sid
    );
    return { sid: verified.sid, sessionToken: sessionToken2 };
  }
  const sid = crypto10.randomBytes(16).toString("hex");
  const sessionToken = setSessionCookie(req, res, fallbackSubject, sid);
  bindRequestScopeKey(req, sid);
  return { sid, sessionToken };
}
function ensureRequestSessionSid(req, res, fallbackSubject = "thresh-athlete") {
  return ensureRequestSession(req, res, fallbackSubject).sid;
}
function renderThreshOAuthHtml(opts) {
  const accent = opts.accentColor || "#C8FF00";
  const ctaHtml = opts.ctaLabel && opts.ctaHref ? `<a href="${escapeHtml(opts.ctaHref)}"${opts.ctaOnClick ? ` onclick="${opts.ctaOnClick}"` : ""} style="display:inline-block;background:#C8FF00;color:#0B0F0D;text-decoration:none;border-radius:10px;padding:11px 22px;font-weight:800;font-size:13px;letter-spacing:0.02em;">${escapeHtml(
    opts.ctaLabel
  )}</a>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#0C1D14;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px;box-sizing:border-box;">
    <div style="background:#111915;border:2px solid #25573A;border-radius:18px;padding:28px 26px;max-width:420px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.45);">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">THRESH \xB7 Telemetry Connector</div>
      <h2 style="margin:0 0 10px;color:${accent};font-size:18px;line-height:1.3;">${opts.heading}</h2>
      <p style="margin:0 0 ${ctaHtml ? "20px" : "0"};color:#CBD5E1;font-size:13px;line-height:1.55;">${opts.body}</p>
      ${ctaHtml}
    </div>
    ${opts.scriptBody ? `<script>${opts.scriptBody}</script>` : ""}
  </body>
</html>`;
}
var CANONICAL_PROD_ORIGIN = "https://thresh-dev.vercel.app";
var LEGACY_PROD_ORIGIN = "https://aeropulse-eta.vercel.app";
function canonicalizeOrigin(origin) {
  return origin.toLowerCase() === LEGACY_PROD_ORIGIN ? CANONICAL_PROD_ORIGIN : origin;
}
function canonicalizeRedirectUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin.toLowerCase() === LEGACY_PROD_ORIGIN) {
      return `${CANONICAL_PROD_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
function resolveStandardOAuthCallbackUrl(req, envVarName, callbackPath) {
  const explicitRedirect = (process.env[envVarName] || "").trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return canonicalizeRedirectUrl(parsed.toString());
      }
    } catch {
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin);
  if (safeOrigin) {
    return `${canonicalizeOrigin(safeOrigin)}${callbackPath}`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || "");
  if (appUrl && !appUrl.includes("MY_APP_URL")) {
    return `${canonicalizeOrigin(appUrl)}${callbackPath}`;
  }
  const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim().toLowerCase();
  const proto = rawProto === "https" ? "https" : "http";
  const rawHost = String(
    req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000"
  ).split(",")[0].trim().replace(/[^a-zA-Z0-9.:-]/g, "");
  const canonicalHost = rawHost.toLowerCase() === "aeropulse-eta.vercel.app" ? "thresh-dev.vercel.app" : rawHost;
  return `${proto}://${canonicalHost || "localhost:3000"}${callbackPath}`;
}
function resolveStravaCallbackUrl(req) {
  return resolveStandardOAuthCallbackUrl(req, "STRAVA_REDIRECT_URI", "/auth/strava/callback");
}
var MAX_VALIDATED_REDIRECT_ENTRIES = 200;
var validatedStravaRedirectCache = /* @__PURE__ */ new Map();
function setBoundedValidatedRedirect(cacheKey, redirectUri, ttlMs) {
  const now = Date.now();
  if (validatedStravaRedirectCache.has(cacheKey)) {
    validatedStravaRedirectCache.delete(cacheKey);
  } else if (validatedStravaRedirectCache.size >= MAX_VALIDATED_REDIRECT_ENTRIES) {
    for (const [k, v] of validatedStravaRedirectCache.entries()) {
      if (now >= v.expiresAt) validatedStravaRedirectCache.delete(k);
    }
    while (validatedStravaRedirectCache.size >= MAX_VALIDATED_REDIRECT_ENTRIES) {
      const oldestKey = validatedStravaRedirectCache.keys().next().value;
      if (oldestKey === void 0) break;
      validatedStravaRedirectCache.delete(oldestKey);
    }
  }
  validatedStravaRedirectCache.set(cacheKey, {
    redirectUri,
    expiresAt: now + ttlMs
  });
}
async function probeStravaRedirectUri(clientId, redirectUri) {
  try {
    const probeUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&approval_prompt=auto&scope=read`;
    const resp = await fetch(probeUrl, {
      method: "GET",
      redirect: "manual",
      signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(2500) : void 0
    });
    if (resp.status >= 300 && resp.status < 400 || resp.status === 200) {
      return "valid";
    }
    if (resp.status === 400) {
      const text = await resp.text();
      if (text.includes("redirect_uri")) {
        return "invalid_redirect";
      }
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
async function resolveValidatedStravaCallbackUrl(req, clientId) {
  const primaryUri = resolveStravaCallbackUrl(req);
  if ((process.env.STRAVA_REDIRECT_URI || "").trim() || !clientId || !primaryUri.startsWith("https://")) {
    return primaryUri;
  }
  let primaryUrl;
  try {
    primaryUrl = new URL(primaryUri);
  } catch {
    return primaryUri;
  }
  if (primaryUrl.hostname === "localhost" || primaryUrl.hostname === "127.0.0.1") {
    return primaryUri;
  }
  const cacheKey = `${clientId}|${primaryUri}`;
  const cached = validatedStravaRedirectCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.redirectUri;
  }
  const primaryProbe = await probeStravaRedirectUri(clientId, primaryUri);
  if (primaryProbe === "valid") {
    setBoundedValidatedRedirect(cacheKey, primaryUri, 15e3);
    return primaryUri;
  }
  if (primaryProbe === "unknown") {
    return primaryUri;
  }
  const fallbackCandidates = [];
  const pushCandidate = (candidate) => {
    if (!candidate) return;
    if (candidate !== primaryUri && !fallbackCandidates.includes(candidate)) {
      fallbackCandidates.push(candidate);
    }
  };
  const envFallback = (process.env.STRAVA_FALLBACK_REDIRECT_URI || "").trim();
  if (envFallback) {
    try {
      const parsedFallback = new URL(envFallback);
      if (parsedFallback.protocol === "https:") {
        pushCandidate(parsedFallback.toString());
      }
    } catch {
    }
  }
  const appOrigin = resolveSafeOrigin(process.env.APP_URL || "");
  if (appOrigin && appOrigin.startsWith("https://") && !appOrigin.includes("MY_APP_URL")) {
    pushCandidate(`${appOrigin}/auth/strava/callback`);
  }
  pushCandidate(`${CANONICAL_PROD_ORIGIN}/auth/strava/callback`);
  pushCandidate(`${LEGACY_PROD_ORIGIN}/auth/strava/callback`);
  for (const candidate of fallbackCandidates) {
    const candidateProbe = await probeStravaRedirectUri(clientId, candidate);
    if (candidateProbe === "valid") {
      return candidate;
    }
  }
  return primaryUri;
}
function resolveIntervalsCallbackUrl(req) {
  return resolveStandardOAuthCallbackUrl(req, "INTERVALS_REDIRECT_URI", "/auth/intervals/callback");
}
function resolveWahooCallbackUrl(req) {
  return resolveStandardOAuthCallbackUrl(req, "WAHOO_REDIRECT_URI", "/auth/wahoo/callback");
}
function resolvePolarCallbackUrl(req) {
  return resolveStandardOAuthCallbackUrl(req, "POLAR_REDIRECT_URI", "/auth/polar/callback");
}
var resolveCallbackUrl = resolveStravaCallbackUrl;

// server/routers/intervalsRouter.ts
import express7 from "express";

// server/routers/activitiesRouter.ts
import { Router as Router2 } from "express";
var activitiesRouter = Router2();
function decodeGooglePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  const points = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  while (index < len) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32 && index < len);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32 && index < len);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push([Number((lat / 1e5).toFixed(5)), Number((lng / 1e5).toFixed(5))]);
  }
  return points;
}
function computeIntervalsSegmentEfforts(rawSegments, rawStreams, act) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return [];
  const fullStreamMap = {};
  let latArr = [];
  let lngArr = [];
  if (Array.isArray(rawStreams)) {
    for (const s of rawStreams) {
      if (s && s.type && Array.isArray(s.data)) {
        fullStreamMap[s.type] = s.data;
        if (s.type === "latlng" && Array.isArray(s.data2)) {
          latArr = s.data;
          lngArr = s.data2;
        }
      }
    }
  }
  const timeArr = fullStreamMap.time || [];
  const distArr = fullStreamMap.distance || [];
  const wattsArr = fullStreamMap.watts || [];
  const hrArr = fullStreamMap.heartrate || [];
  const altArr = fullStreamMap.altitude || [];
  const efforts = [];
  for (let idx = 0; idx < rawSegments.length; idx++) {
    const seg = rawSegments[idx];
    if (!seg || !seg.segment_id && !seg.id) continue;
    const sIdx = Math.max(0, Number(seg.start_index ?? 0));
    const eIdx = Math.max(sIdx, Number(seg.end_index ?? sIdx));
    const startTimeSecs = timeArr.length > sIdx && timeArr[sIdx] != null ? Math.round(timeArr[sIdx]) : sIdx;
    const endTimeSecs = timeArr.length > eIdx && timeArr[eIdx] != null ? Math.round(timeArr[eIdx]) : eIdx;
    const elapsedTimeSecs = timeArr.length > eIdx && timeArr[eIdx] != null && timeArr[sIdx] != null ? Math.max(1, Math.round(timeArr[eIdx] - timeArr[sIdx])) : Math.max(1, eIdx - sIdx);
    if (elapsedTimeSecs < 5) continue;
    let distanceMeters = 0;
    if (distArr.length > eIdx && distArr[eIdx] != null && distArr[sIdx] != null) {
      distanceMeters = Math.max(0, Math.round(distArr[eIdx] - distArr[sIdx]));
    }
    if (distanceMeters < 20) continue;
    let averageGradePct = 0;
    if (altArr.length > eIdx && altArr[eIdx] != null && altArr[sIdx] != null && distanceMeters > 25) {
      averageGradePct = Number(
        ((altArr[eIdx] - altArr[sIdx]) / distanceMeters * 100).toFixed(1)
      );
    }
    let avgWatts;
    if (wattsArr.length > sIdx) {
      const sliceW = wattsArr.slice(sIdx, Math.min(wattsArr.length, eIdx + 1)).filter((v) => v != null && !Number.isNaN(v) && v >= 0);
      if (sliceW.length > 0) {
        const meanW = Math.round(sliceW.reduce((a, b) => a + b, 0) / sliceW.length);
        if (meanW > 0) avgWatts = meanW;
      }
    }
    let avgHr = act.avgHr && act.avgHr > 0 ? act.avgHr : void 0;
    if (hrArr.length > sIdx) {
      const sliceHr = hrArr.slice(sIdx, Math.min(hrArr.length, eIdx + 1)).filter((v) => v != null && !Number.isNaN(v) && v > 40);
      if (sliceHr.length > 0) {
        avgHr = Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length);
      }
    }
    let startLatLng;
    let endLatLng;
    let pathLatLngs;
    if (latArr.length > eIdx && lngArr.length > eIdx) {
      const segStep = Math.max(1, Math.floor((eIdx - sIdx + 1) / 36));
      const pts = [];
      for (let k = sIdx; k <= eIdx; k += segStep) {
        if (latArr[k] != null && lngArr[k] != null && Math.abs(latArr[k]) > 0.01) {
          pts.push([Number(latArr[k].toFixed(5)), Number(lngArr[k].toFixed(5))]);
        }
      }
      if (latArr[eIdx] != null && lngArr[eIdx] != null && Math.abs(latArr[eIdx]) > 0.01 && pts.length > 0) {
        pts.push([Number(latArr[eIdx].toFixed(5)), Number(lngArr[eIdx].toFixed(5))]);
      }
      if (pts.length >= 2) {
        pathLatLngs = pts;
        startLatLng = pts[0];
        endLatLng = pts[pts.length - 1];
      }
    }
    const sportCategory = act.sportCategory === "Running" ? "Running" : "Cycling";
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 ? Math.round(elapsedTimeSecs / (distanceMeters / 1e3)) : void 0;
    efforts.push({
      id: `${act.id}-seg-${seg.id || seg.segment_id}-${idx}`,
      segmentId: String(seg.segment_id || seg.id),
      name: String(seg.name || "Strava Segment").trim(),
      sportCategory,
      distanceMeters,
      averageGradePct,
      elapsedTimeSecs,
      movingTimeSecs: elapsedTimeSecs,
      avgWatts,
      avgPaceSecsPerKm,
      avgHr,
      prRank: null,
      komRank: null,
      starred: Boolean(seg.starred),
      startDateLocal: String(act.startDateLocal),
      activityId: String(act.id),
      activityName: String(act.name),
      startTimeSecs,
      endTimeSecs,
      startIndex: sIdx,
      endIndex: eIdx,
      startLatLng,
      endLatLng,
      pathLatLngs
    });
  }
  return efforts;
}
activitiesRouter.post("/api/segments/scan-more", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const scopedSegmentsFile = `/tmp/thresh-segments-${scopeKey}.json`;
    const scopedRoutesFile = `/tmp/thresh-routes-${scopeKey}.json`;
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res.status(401).json({ error: "Intervals.icu is not connected (OAuth access token or API Key required)." });
      return;
    }
    const resolvedId = config.athleteId || "0";
    const newestStr = new Date(Date.now() + 86400 * 1e3).toISOString().slice(0, 10);
    const activitiesUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2015-01-01&newest=${newestStr}`;
    const actResp = await fetch(activitiesUrl, {
      headers: { Authorization: authHeader, Accept: "application/json" }
    });
    if (!actResp.ok) {
      res.status(actResp.status).json({ error: "Unable to fetch Intervals.icu activities list" });
      return;
    }
    const rawActivities = await actResp.json();
    const segmentsCache = loadJsonFile(scopedSegmentsFile, {});
    const routesCache = loadJsonFile(
      scopedRoutesFile,
      {}
    );
    const candidates = rawActivities.filter((a) => a && a.id && a.has_segments && !Array.isArray(segmentsCache[String(a.id)])).slice(0, 30);
    let scannedCount = 0;
    for (let i = 0; i < candidates.length; i += 10) {
      const slice = candidates.slice(i, i + 10);
      await Promise.all(
        slice.map(async (rawAct) => {
          const actId = String(rawAct.id);
          const rawType = String(rawAct.type || "");
          const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType) ? "Running" : "Cycling";
          try {
            const [segResp, stResp] = await Promise.all([
              fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/segments`, {
                headers: { Authorization: authHeader, Accept: "application/json" }
              }),
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,altitude`,
                { headers: { Authorization: authHeader, Accept: "application/json" } }
              )
            ]);
            if (segResp.ok && stResp.ok) {
              const rawSegs = await segResp.json();
              const rawStreams = await stResp.json();
              segmentsCache[actId] = computeIntervalsSegmentEfforts(rawSegs, rawStreams, {
                id: actId,
                name: String(rawAct.name || rawType || sportCategory),
                startDateLocal: String(rawAct.start_date_local || ""),
                sportCategory,
                avgHr: rawAct.average_heartrate ? Math.round(Number(rawAct.average_heartrate)) : void 0
              });
              const latlngEntry = Array.isArray(rawStreams) ? rawStreams.find((s) => s && s.type === "latlng") : void 0;
              if (latlngEntry && Array.isArray(latlngEntry.data) && Array.isArray(latlngEntry.data2) && latlngEntry.data.length > 2) {
                const step = Math.max(1, Math.floor(latlngEntry.data.length / 160));
                const compactPts = [];
                for (let k = 0; k < latlngEntry.data.length; k += step) {
                  const lat = latlngEntry.data[k];
                  const lng = latlngEntry.data2[k];
                  if (lat != null && lng != null && Math.abs(lat) > 0.01) {
                    compactPts.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
                  }
                }
                if (compactPts.length > 2) routesCache[actId] = compactPts;
              }
              scannedCount += 1;
            } else {
              segmentsCache[actId] = [];
            }
          } catch {
          }
        })
      );
    }
    saveJsonFile(scopedSegmentsFile, segmentsCache);
    saveJsonFile(scopedRoutesFile, routesCache);
    const ownedIds = new Set(rawActivities.map((a) => String(a?.id || "")).filter(Boolean));
    const scopedSegments = {};
    const scopedRoutes = {};
    for (const id of ownedIds) {
      if (Array.isArray(segmentsCache[id])) scopedSegments[id] = segmentsCache[id];
      if (Array.isArray(routesCache[id])) scopedRoutes[id] = routesCache[id];
    }
    res.json({
      scannedCount,
      remainingUnscannedCount: Math.max(
        0,
        rawActivities.filter(
          (a) => a && a.has_segments && !Array.isArray(segmentsCache[String(a.id)])
        ).length
      ),
      totalCachedActivities: Object.keys(scopedSegments).length,
      segmentsByActivity: scopedSegments,
      routesByActivity: scopedRoutes
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to scan additional segments"
    });
  }
});
activitiesRouter.post("/api/activities/hydrate-routes", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({
        error: "Authentication required.",
        routesByActivity: {}
      });
      return;
    }
    const scopedRoutesFile = `/tmp/thresh-routes-${scopeKey}.json`;
    const intervalsConfig = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(intervalsConfig);
    if (!intervalsAuth) {
      res.status(401).json({
        error: "Intervals.icu connection (OAuth or API Key) is required to hydrate GPS routes.",
        routesByActivity: {}
      });
      return;
    }
    const routesCache = loadJsonFile(
      scopedRoutesFile,
      {}
    );
    const authHeader = intervalsAuth;
    let activityIds = Array.isArray(req.body?.activityIds) ? req.body.activityIds.map(String).slice(0, 32) : [];
    if (activityIds.length === 0) {
      const resolvedId = intervalsConfig.athleteId || "0";
      const newestStr = new Date(Date.now() + 86400 * 1e3).toISOString().slice(0, 10);
      const actResp = await fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2018-01-01&newest=${newestStr}`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      );
      if (actResp.ok) {
        const rawActs = await actResp.json();
        activityIds = rawActs.filter(
          (a) => a && a.id && !a.trainer && Number(a.distance || 0) > 1e3 && !Array.isArray(routesCache[String(a.id)])
        ).slice(0, 32).map((a) => String(a.id));
      }
    }
    const toFetch = activityIds.filter((id) => id && !Array.isArray(routesCache[id]));
    for (let i = 0; i < toFetch.length; i += 8) {
      const slice = toFetch.slice(i, i + 8);
      await Promise.all(
        slice.map(async (actId) => {
          try {
            const mapResp = await fetch(
              `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/map`,
              { headers: { Authorization: authHeader, Accept: "application/json" } }
            );
            if (mapResp.ok) {
              const mapJson = await mapResp.json();
              if (Array.isArray(mapJson.latlngs) && mapJson.latlngs.length > 2) {
                const rawPts = mapJson.latlngs.filter(
                  (p) => Array.isArray(p) && p.length === 2 && p[0] != null && p[1] != null && Math.abs(p[0]) > 0.01
                );
                const step = Math.max(1, Math.floor(rawPts.length / 180));
                const compactPts = rawPts.filter((_, idx) => idx % step === 0).map((p) => [
                  Number(Number(p[0]).toFixed(5)),
                  Number(Number(p[1]).toFixed(5))
                ]);
                if (compactPts.length >= 2) {
                  routesCache[actId] = compactPts;
                }
              }
            }
          } catch {
          }
        })
      );
    }
    saveJsonFile(scopedRoutesFile, routesCache);
    const scopedRoutes = {};
    for (const id of activityIds) {
      if (Array.isArray(routesCache[id])) {
        scopedRoutes[id] = routesCache[id];
      }
    }
    res.json({ routesByActivity: scopedRoutes });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to hydrate GPS routes"
    });
  }
});

// server/routers/stravaRouter.ts
import express6 from "express";
import crypto11 from "crypto";
import fs6 from "fs";

// server/stravaIdUtils.ts
function extractStravaId(entity, strField = "id_str", numField = "id") {
  if (!entity || typeof entity !== "object") return "";
  const rawStr = entity[strField];
  if (rawStr !== void 0 && rawStr !== null && String(rawStr).trim() !== "") {
    return String(rawStr).trim();
  }
  const rawNum = entity[numField];
  if (rawNum !== void 0 && rawNum !== null && String(rawNum).trim() !== "") {
    return String(rawNum).trim();
  }
  return "";
}
function strava64BitJsonReviver(_key, value, context) {
  if (typeof value === "number" && !Number.isSafeInteger(value) && typeof context?.source === "string" && /^-?\d+$/.test(context.source)) {
    return context.source;
  }
  return value;
}
function parseStravaJson64Safe(rawText) {
  return JSON.parse(
    rawText,
    strava64BitJsonReviver
  );
}
async function readStravaResponseJson(resp) {
  if (typeof resp.text === "function") {
    const raw = await resp.text();
    if (typeof raw === "string" && raw.length > 0) {
      return parseStravaJson64Safe(raw);
    }
  }
  return await resp.json();
}

// server/stravaSyncService.ts
function normalizeRawStravaActivity(a, calibration, options) {
  const detail = options?.detail || a;
  const idx = options?.idx ?? 0;
  const cachedK = options?.kudosCacheEntry;
  const activityStravaId = extractStravaId(a) || extractStravaId(detail);
  const sportType = String(a.sport_type || a.type || "").trim();
  const actName = String(a.name || "");
  const rawStartLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length === 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : void 0;
  const isWatopiaOrMakuriGps = rawStartLatLng && Number.isFinite(rawStartLatLng[0]) && Number.isFinite(rawStartLatLng[1]) && rawStartLatLng[0] >= -12.6 && rawStartLatLng[0] <= -9.8 && rawStartLatLng[1] >= 164.8 && rawStartLatLng[1] <= 168;
  const hasSummaryPolyline = Boolean(
    (detail.map?.summary_polyline || a.map?.summary_polyline || "").length > 4
  );
  const hasAnyGps = Boolean(hasSummaryPolyline || rawStartLatLng);
  const combinedStravaMeta = `${sportType} ${actName} ${a.device_name || ""} ${detail.device_name || ""}`;
  const isVirtualPlatform = isVirtualCyclingText(combinedStravaMeta) || Boolean(isWatopiaOrMakuriGps);
  const classified = classifyMultiSportActivity(sportType, actName, {
    trainer: Boolean(a.trainer),
    hasGps: hasAnyGps,
    isVirtualPlatform
  });
  const sportCategory = classified.sportCategory;
  let subType = classified.subType;
  let environment = classified.environment;
  if (environment === "OUTDOOR" && (isVirtualPlatform || /treadmill|trainer|zwift|peloton|wattbike|stages|erg mode|smart_trainer/i.test(
    combinedStravaMeta
  ))) {
    environment = "INDOOR";
    if (sportCategory === "Cycling" && subType !== "EBike") {
      subType = isVirtualPlatform ? "Virtual Cycling" : "Smart Trainer";
    } else if (sportCategory === "Running") {
      subType = "Treadmill";
    }
  }
  const isEBike = subType === "EBike";
  const isIndoor = environment === "INDOOR";
  const rawMoving = Number(a.moving_time || 0);
  const rawElapsed = Number(a.elapsed_time || 0);
  const movingTimeSecs = rawMoving > 0 ? rawMoving : Math.min(rawElapsed, 5400);
  const distanceMeters = Number(a.distance || 0);
  const elevationGainMeters = Math.round(Number(a.total_elevation_gain || 0));
  const supportsMeteredWatts = !isEBike && (sportCategory === "Cycling" || subType === "Rowing" || subType === "Nordic Ski" || sportCategory === "Running");
  const hasRealDeviceWatts = supportsMeteredWatts && (a.device_watts === true || Boolean(isVirtualPlatform) && a.device_watts !== false);
  const avgPower = hasRealDeviceWatts && a.average_watts ? Math.round(Number(a.average_watts)) : void 0;
  const normalizedPower = hasRealDeviceWatts && a.weighted_average_watts ? Math.round(Number(a.weighted_average_watts)) : avgPower;
  const avgHr = Math.round(Number(a.average_heartrate || 0));
  const maxHr = Math.round(Number(a.max_heartrate || 0));
  const supportsPaceDisplay = sportCategory === "Running" || sportCategory === "Swimming" || subType === "Hiking" || subType === "Walking" || subType === "Rowing" || subType === "Nordic Ski";
  const avgPaceSecsPerKm = supportsPaceDisplay && distanceMeters > 0 && movingTimeSecs > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
  const loadResult = computeStravaActivityLoadV2({
    sportCategory,
    rawSportType: sportType,
    name: actName,
    environment: isIndoor ? "INDOOR" : "OUTDOOR",
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters,
    normalizedPower,
    avgPower,
    hasRealDeviceWatts,
    avgHr,
    maxHr,
    avgPaceSecsPerKm,
    sufferScore: Number(a.suffer_score || 0),
    calibratedFtp: calibration.calibratedFtp,
    calibratedBikeLthr: calibration.calibratedBikeLthr,
    calibratedRunLthr: calibration.calibratedRunLthr,
    calibratedThresholdPaceSecsPerKm: calibration.calibratedThresholdPaceSecsPerKm,
    restingHr: calibration.restingHr
  });
  let efficiencyFactor = 0;
  if (hasRealDeviceWatts && normalizedPower && avgHr > 0) {
    efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
  } else if (sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 && avgHr > 0) {
    const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
    efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
  }
  const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
  const segmentEfforts = rawEfforts.slice(0, 40).map((se) => {
    const dist = Math.round(Number(se.distance || se.segment?.distance || 0));
    const elTime = Number(se.elapsed_time || 0);
    const effortId = extractStravaId(se);
    const segId = extractStravaId(se.segment) || effortId;
    return {
      id: effortId,
      segmentId: segId,
      name: String(se.name || se.segment?.name || "Segment"),
      sportCategory: sportCategory === "Running" ? "Running" : "Cycling",
      distanceMeters: dist,
      averageGradePct: Number(se.segment?.average_grade ?? 0),
      elapsedTimeSecs: elTime,
      movingTimeSecs: Number(se.moving_time || elTime),
      avgWatts: hasRealDeviceWatts && se.average_watts ? Math.round(Number(se.average_watts)) : void 0,
      avgPaceSecsPerKm: sportCategory === "Running" && dist > 0 && elTime > 0 ? Math.round(elTime / (dist / 1e3)) : void 0,
      avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : void 0,
      prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
      komRank: typeof se.kom_rank === "number" ? se.kom_rank : null,
      startDateLocal: String(se.start_date_local || a.start_date_local),
      activityId: activityStravaId,
      activityName: String(a.name),
      startIndex: typeof se.start_index === "number" ? se.start_index : void 0,
      endIndex: typeof se.end_index === "number" ? se.end_index : void 0
    };
  });
  const summaryPolyline = detail.map?.summary_polyline || a.map?.summary_polyline || void 0;
  const decodedRoute = summaryPolyline ? decodeGooglePolyline(summaryPolyline) : void 0;
  const startLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length === 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : decodedRoute && decodedRoute.length > 0 ? decodedRoute[0] : void 0;
  const endLatLng = Array.isArray(a.end_latlng) && a.end_latlng.length === 2 ? [Number(a.end_latlng[0]), Number(a.end_latlng[1])] : decodedRoute && decodedRoute.length > 0 ? decodedRoute[decodedRoute.length - 1] : void 0;
  const normalizedTimestamps = normalizeActivityTimestamps({
    startDateLocal: a.start_date_local ? stripTimezoneSuffix(String(a.start_date_local)) : void 0,
    startDateUtc: a.start_date ? String(a.start_date) : void 0,
    utcOffsetSecs: typeof a.utc_offset === "number" && Number.isFinite(a.utc_offset) ? a.utc_offset : void 0,
    startLatLng,
    fallbackBrowserTz: true
  });
  return {
    stravaId: activityStravaId,
    startDateLocal: normalizedTimestamps.startDateLocal,
    ...normalizedTimestamps.startDateUtcMs !== void 0 ? { startDateUtcMs: normalizedTimestamps.startDateUtcMs } : {},
    name: String(a.name || sportType || sportCategory),
    sportCategory,
    rawSportType: sportType || void 0,
    environment: isIndoor ? "INDOOR" : "OUTDOOR",
    subType,
    distanceMeters,
    movingTimeSecs,
    elevationGainMeters,
    avgPower,
    normalizedPower,
    deviceWatts: hasRealDeviceWatts,
    intensityFactor: loadResult.intensityFactor,
    trainingLoad: loadResult.trainingLoad,
    loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
    avgHr,
    maxHr,
    avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : void 0,
    avgPaceSecsPerKm,
    efficiencyFactor,
    gearName: detail.gear?.name || void 0,
    stravaPrCount: Number(a.pr_count || 0),
    kudosCount: cachedK?.kudosCount ?? Number(a.kudos_count || 0),
    commentCount: cachedK?.comments?.length ?? Number(a.comment_count || 0),
    achievementCount: Number(a.achievement_count || 0),
    athleteCount: Number(a.athlete_count || 1),
    hasKudoed: cachedK?.hasKudoed ?? Boolean(a.has_kudoed),
    kudoers: cachedK?.kudoers,
    comments: cachedK?.comments,
    summaryPolyline,
    routeLatLngs: idx < 25 && decodedRoute && decodedRoute.length >= 2 ? decodedRoute : void 0,
    startLatLng,
    endLatLng,
    segmentEfforts
  };
}
async function syncStravaAllHistory(req, forceFull = false, deltaOnly = false, explicitWindow, clientAfterEpoch = 0, beforeEpoch = 0) {
  let activeAccessToken = await ensureValidStravaAccessToken(req, false);
  if (!activeAccessToken) {
    throw new Error("Strava is not connected via OAuth yet.");
  }
  const validWindows = /* @__PURE__ */ new Set(["90d", "180d", "365d", "all", "none"]);
  const effectiveWindow = explicitWindow && validWindows.has(explicitWindow) ? explicitWindow : forceFull || beforeEpoch > 0 ? "all" : runtimeStore.stravaSyncPolicy?.window || "90d";
  const importProfileAndGear = runtimeStore.stravaSyncPolicy?.importProfileAndGear !== false;
  if (effectiveWindow === "none") {
    const identity = await resolveStravaAthleteIdentity(req);
    return {
      athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || void 0,
      athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || void 0,
      gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
      activities: [],
      starredSegments: [],
      syncPaused: true,
      syncWindow: "none",
      hasMoreHistory: false,
      nextBeforeEpoch: null,
      rateLimitPaused: false,
      stravaTokens: getStravaTokenRotationPayload(req)
    };
  }
  const grantedScope = String(runtimeStore.stravaGrantedScope || "").trim();
  if (grantedScope && !grantedScope.includes("activity:read")) {
    const identity = await resolveStravaAthleteIdentity(req);
    return {
      athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || void 0,
      athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || void 0,
      gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
      activities: [],
      starredSegments: [],
      missingActivityScope: true,
      hasMoreHistory: false,
      nextBeforeEpoch: null,
      rateLimitPaused: false,
      stravaTokens: getStravaTokenRotationPayload(req)
    };
  }
  const windowDays = effectiveWindow === "90d" ? 90 : effectiveWindow === "180d" ? 180 : effectiveWindow === "365d" ? 365 : 0;
  const afterEpoch = windowDays > 0 && beforeEpoch === 0 ? Math.floor((Date.now() - windowDays * 86400 * 1e3) / 1e3) : 0;
  const effectiveAfterEpoch = !forceFull && beforeEpoch === 0 && deltaOnly && clientAfterEpoch > 0 ? Math.max(afterEpoch, Math.floor(clientAfterEpoch)) : afterEpoch;
  const afterQuery = effectiveAfterEpoch > 0 ? `&after=${effectiveAfterEpoch}` : "";
  const beforeQuery = beforeEpoch > 0 ? `&before=${Math.floor(beforeEpoch)}` : "";
  const cursorQuery = `${afterQuery}${beforeQuery}`;
  let headers = { Authorization: `Bearer ${activeAccessToken}` };
  let rawActivitiesMap = /* @__PURE__ */ new Map();
  const fetchedThisCallMap = /* @__PURE__ */ new Map();
  let scopedArchiveFile = "";
  let rateLimitPaused = false;
  let reachedNaturalEnd = false;
  let oldestFetchedEpoch = 0;
  const trackFetchedItem = (item) => {
    const itemId = extractStravaId(item);
    if (!item || !itemId) return;
    rawActivitiesMap.set(itemId, item);
    fetchedThisCallMap.set(itemId, item);
    const epoch = Math.floor(new Date(item.start_date || item.start_date_local || 0).getTime() / 1e3);
    if (Number.isFinite(epoch) && epoch > 0 && (oldestFetchedEpoch === 0 || epoch < oldestFetchedEpoch)) {
      oldestFetchedEpoch = epoch;
    }
  };
  let firstPageResp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${cursorQuery}`,
    { headers }
  );
  const { refreshToken: callerRefreshToken } = getEffectiveStravaClientConfig(req);
  if (firstPageResp.status === 401 && callerRefreshToken) {
    activeAccessToken = await ensureValidStravaAccessToken(req, true);
    headers = { Authorization: `Bearer ${activeAccessToken}` };
    firstPageResp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${cursorQuery}`,
      { headers }
    );
  }
  if (!firstPageResp.ok) {
    if (firstPageResp.status === 401 || firstPageResp.status === 403) {
      const errText = await firstPageResp.text();
      if (errText.includes("activity:read_permission")) {
        runtimeStore.stravaGrantedScope = "read";
        await saveSessionCacheAsync(req);
        const identity = await resolveStravaAthleteIdentity(req);
        return {
          athleteId: identity?.athleteId || runtimeStore.stravaAthleteId || void 0,
          athleteName: identity?.athleteName || runtimeStore.stravaAthleteName || void 0,
          gearItems: importProfileAndGear ? runtimeStore.gearItems || [] : [],
          activities: [],
          starredSegments: [],
          missingActivityScope: true,
          hasMoreHistory: false,
          nextBeforeEpoch: null,
          rateLimitPaused: false,
          stravaTokens: getStravaTokenRotationPayload(req)
        };
      }
      throw new Error(
        "Strava session expired or invalid. Reconnect Strava to refresh your session."
      );
    }
  } else {
    const firstPageItems = await readStravaResponseJson(firstPageResp);
    if (Array.isArray(firstPageItems)) {
      const stravaAthleteId2 = (extractStravaId(firstPageItems[0]?.athlete) || runtimeStore.stravaAthleteId || "").replace(/[^0-9]/g, "");
      if (stravaAthleteId2) {
        scopedArchiveFile = `/tmp/aeropulse-strava-archive-${stravaAthleteId2}.json`;
        const cachedArchive = loadJsonFile(scopedArchiveFile, []);
        for (const item of cachedArchive) {
          const itemId = extractStravaId(item);
          if (!item || !itemId) continue;
          if (afterEpoch > 0 && beforeEpoch === 0) {
            const itemEpoch = Math.floor(
              new Date(item.start_date || item.start_date_local || 0).getTime() / 1e3
            );
            if (itemEpoch > 0 && itemEpoch < afterEpoch) continue;
          }
          rawActivitiesMap.set(itemId, item);
        }
      }
      for (const item of firstPageItems) {
        trackFetchedItem(item);
      }
      if (firstPageItems.length < 200) {
        reachedNaturalEnd = true;
      }
      const shouldPaginateAll = forceFull || beforeEpoch > 0 || !deltaOnly;
      const isStravaRateLimited = (resp) => {
        const usage = resp.headers.get("x-ratelimit-usage") || "";
        const limit = resp.headers.get("x-ratelimit-limit") || "";
        const [shortUsage = 0, dailyUsage = 0] = usage.split(",").map(Number);
        const [shortLimit = 100, dailyLimit = 1e3] = limit.split(",").map((n) => Number(n) || 0);
        const effectiveShortCap = shortLimit > 0 ? Math.max(40, shortLimit - 15) : 85;
        const effectiveDailyCap = dailyLimit > 0 ? Math.max(200, dailyLimit - 25) : 975;
        return shortUsage >= effectiveShortCap || dailyUsage >= effectiveDailyCap;
      };
      if (isStravaRateLimited(firstPageResp)) {
        rateLimitPaused = true;
      }
      const maxPageToFetch = effectiveWindow === "all" ? 20 : effectiveWindow === "365d" ? 8 : effectiveWindow === "180d" ? 5 : 3;
      if (shouldPaginateAll && !reachedNaturalEnd && !rateLimitPaused) {
        for (let page = 2; page <= maxPageToFetch; page += 2) {
          const pages = page + 1 <= maxPageToFetch ? [page, page + 1] : [page];
          const batchResps = await Promise.all(
            pages.map(
              (p) => fetch(
                `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${p}${cursorQuery}`,
                { headers }
              )
            )
          );
          let stopLoop = false;
          for (const r of batchResps) {
            if (!r.ok) {
              if (r.status === 429) rateLimitPaused = true;
              stopLoop = true;
              break;
            }
            const pageItems = await readStravaResponseJson(r);
            if (!Array.isArray(pageItems) || pageItems.length === 0) {
              reachedNaturalEnd = true;
              stopLoop = true;
              break;
            }
            for (const item of pageItems) {
              trackFetchedItem(item);
            }
            if (pageItems.length < 200) {
              reachedNaturalEnd = true;
              stopLoop = true;
              break;
            }
            if (isStravaRateLimited(r)) {
              rateLimitPaused = true;
              stopLoop = true;
              break;
            }
          }
          if (stopLoop) break;
        }
      }
    }
  }
  const allArchiveList = Array.from(rawActivitiesMap.values()).sort(
    (a, b) => new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  );
  if (allArchiveList.length > 0 && scopedArchiveFile) {
    saveJsonFile(scopedArchiveFile, allArchiveList);
  }
  const activitiesList = beforeEpoch > 0 ? Array.from(fetchedThisCallMap.values()).sort(
    (a, b) => new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  ) : allArchiveList;
  const hasMoreHistory = !deltaOnly && effectiveWindow === "all" && !reachedNaturalEnd && oldestFetchedEpoch > 0 && (fetchedThisCallMap.size >= 200 || rateLimitPaused);
  const nextBeforeEpoch = hasMoreHistory ? oldestFetchedEpoch + 1 : null;
  const isCursorContinuation = beforeEpoch > 0;
  const [starredResp, stravaProfileResp, stravaZonesResp] = isCursorContinuation ? [null, null, null] : await Promise.all([
    firstPageResp.ok ? fetch("https://www.strava.com/api/v3/segments/starred?per_page=15", { headers }) : Promise.resolve(null),
    fetch("https://www.strava.com/api/v3/athlete", { headers }),
    importProfileAndGear ? fetch("https://www.strava.com/api/v3/athlete/zones", { headers }) : Promise.resolve(null)
  ]);
  const starredSegments = starredResp && starredResp.ok ? await readStravaResponseJson(starredResp) : [];
  const stravaZonesData = stravaZonesResp && stravaZonesResp.ok ? await readStravaResponseJson(stravaZonesResp) : null;
  let stravaAthleteName = "";
  let stravaAthleteId = "";
  let stravaFtp;
  let stravaWeightKg;
  let stravaMeasurementPreference;
  let stravaGearItems = [];
  if (stravaProfileResp && stravaProfileResp.ok) {
    const rawAthlete = await readStravaResponseJson(stravaProfileResp);
    stravaAthleteId = extractStravaId(rawAthlete);
    stravaAthleteName = [rawAthlete.firstname, rawAthlete.lastname].filter(Boolean).join(" ").trim() || String(rawAthlete.username || "").trim();
    if (importProfileAndGear) {
      if (Number(rawAthlete.ftp) > 80) stravaFtp = Math.round(Number(rawAthlete.ftp));
      if (Number(rawAthlete.weight) > 30) stravaWeightKg = Number(rawAthlete.weight);
    }
    if (rawAthlete.measurement_preference === "meters") stravaMeasurementPreference = "km";
    else if (rawAthlete.measurement_preference === "feet") stravaMeasurementPreference = "mi";
    if (stravaAthleteName && !isGenericName(stravaAthleteName)) {
      runtimeStore.stravaAthleteId = stravaAthleteId || runtimeStore.stravaAthleteId;
      runtimeStore.stravaAthleteName = stravaAthleteName;
      if (stravaMeasurementPreference) {
        runtimeStore.stravaMeasurementPreference = stravaMeasurementPreference;
      }
      const { refreshToken, accessToken } = getEffectiveStravaClientConfig(req);
      const entry = {
        athleteId: stravaAthleteId,
        athleteName: stravaAthleteName,
        ftp: stravaFtp,
        weightKg: stravaWeightKg,
        measurementPreference: stravaMeasurementPreference
      };
      if (refreshToken) stravaIdentityByToken.set(refreshToken, entry);
      if (accessToken) stravaIdentityByToken.set(accessToken, entry);
      stravaIdentityByToken.set(activeAccessToken, entry);
      await saveSessionCacheAsync(req);
    }
    if (importProfileAndGear) {
      const bikes = Array.isArray(rawAthlete.bikes) ? rawAthlete.bikes.map((b) => ({
        id: extractStravaId(b),
        name: String(b.name || "Road Bike"),
        type: "BIKE",
        distanceMeters: Number(b.distance || 0),
        maxRecommendedMeters: 8046720,
        primary: Boolean(b.primary)
      })) : [];
      const shoes = Array.isArray(rawAthlete.shoes) ? rawAthlete.shoes.map((s) => ({
        id: extractStravaId(s),
        name: String(s.name || "Running Shoe"),
        type: "SHOE",
        distanceMeters: Number(s.distance || 0),
        maxRecommendedMeters: 724205,
        primary: Boolean(s.primary)
      })) : [];
      stravaGearItems = [...bikes, ...shoes];
      runtimeStore.gearItems = stravaGearItems;
    }
  }
  const prelimAthleteProfile = buildServerAthleteProfile(
    {
      id: stravaAthleteId || runtimeStore.stravaAthleteId || "0",
      name: stravaAthleteName || runtimeStore.stravaAthleteName || void 0,
      ftp: stravaFtp,
      weightKg: stravaWeightKg,
      stravaZones: stravaZonesData,
      source: "STRAVA_OAUTH"
    },
    null,
    activitiesList
  );
  const calibratedFtp = Math.max(120, prelimAthleteProfile.ftp || stravaFtp || 250);
  const calibratedBikeLthr = Math.max(135, prelimAthleteProfile.lthr || 163);
  const calibratedRunLthr = Math.max(140, prelimAthleteProfile.runLthr || 168);
  const calibratedThresholdPaceSecsPerKm = Math.max(
    155,
    prelimAthleteProfile.thresholdPaceSecsPerKm || 255
  );
  const calibratedRestingHr = Math.max(38, Math.min(78, prelimAthleteProfile.restingHr || 54));
  const topIds = isCursorContinuation ? [] : activitiesList.slice(0, 2).map((a) => extractStravaId(a)).filter(Boolean);
  const detailedPayloads = topIds.length > 0 ? await Promise.all(
    topIds.map(async (id) => {
      const dResp = await fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(id)}?include_all_efforts=true`,
        { headers }
      );
      return dResp.ok ? await readStravaResponseJson(dResp) : null;
    })
  ) : [];
  const detailById = /* @__PURE__ */ new Map();
  for (const d of detailedPayloads) {
    const did = extractStravaId(d);
    if (d && did) detailById.set(did, d);
  }
  const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
  const recentKudoCandidates = isCursorContinuation ? [] : activitiesList.filter((a) => {
    const aid = extractStravaId(a);
    return Boolean(aid && Number(a.kudos_count || 0) > 0 && !kudosCache[aid]?.kudoers);
  }).slice(0, 2);
  if (recentKudoCandidates.length > 0) {
    await Promise.all(
      recentKudoCandidates.map(async (act) => {
        const sid = extractStravaId(act);
        try {
          const [kResp, cResp] = await Promise.all([
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/kudos?per_page=50`, {
              headers
            }),
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/comments?per_page=30`, {
              headers
            })
          ]);
          const kudoers = kResp.ok ? (await readStravaResponseJson(kResp) || []).map((k) => ({
            firstname: String(k.firstname || "Athlete"),
            lastname: String(k.lastname || ""),
            profileMedium: k.profile_medium || k.profile || void 0,
            city: k.city || void 0,
            state: k.state || void 0,
            country: k.country || void 0
          })) : [];
          const comments = cResp.ok ? (await readStravaResponseJson(cResp) || []).map((c, idx) => ({
            id: extractStravaId(c) || `sc-${sid}-${idx}`,
            text: String(c.text || ""),
            createdAt: String(c.created_at || act.start_date_local || ""),
            athleteName: [c.athlete?.firstname, c.athlete?.lastname].filter(Boolean).join(" ") || "Strava Athlete",
            avatarUrl: c.athlete?.profile_medium || void 0
          })) : [];
          kudosCache[sid] = {
            ...kudosCache[sid],
            kudosCount: Math.max(Number(act.kudos_count || 0), kudoers.length),
            kudoers,
            comments: [...kudosCache[sid]?.comments || [], ...comments]
          };
        } catch {
        }
      })
    );
    saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);
  }
  const normalizedStravaActivities = activitiesList.map((a, idx) => {
    const aid = extractStravaId(a);
    return normalizeRawStravaActivity(
      a,
      {
        calibratedFtp,
        calibratedBikeLthr,
        calibratedRunLthr,
        calibratedThresholdPaceSecsPerKm,
        restingHr: calibratedRestingHr
      },
      {
        detail: detailById.get(aid) || a,
        idx,
        kudosCacheEntry: kudosCache[aid]
      }
    );
  });
  const stravaAthleteProfile = buildServerAthleteProfile(
    {
      id: stravaAthleteId || runtimeStore.stravaAthleteId || "0",
      name: stravaAthleteName || runtimeStore.stravaAthleteName || void 0,
      ftp: stravaFtp,
      weightKg: stravaWeightKg,
      stravaZones: stravaZonesData,
      source: "STRAVA_OAUTH"
    },
    null,
    normalizedStravaActivities
  );
  return {
    athleteId: stravaAthleteId || runtimeStore.stravaAthleteId || void 0,
    athleteName: stravaAthleteProfile.name !== "Athlete" ? stravaAthleteProfile.name : void 0,
    measurementPreference: stravaMeasurementPreference || runtimeStore.stravaMeasurementPreference || void 0,
    syncWindow: effectiveWindow,
    hasMoreHistory,
    nextBeforeEpoch,
    rateLimitPaused,
    athleteProfile: !isCursorContinuation && importProfileAndGear ? {
      ...stravaAthleteProfile,
      gearItems: stravaGearItems
    } : void 0,
    gearItems: isCursorContinuation ? [] : stravaGearItems,
    activities: normalizedStravaActivities,
    stravaTokens: getStravaTokenRotationPayload(req),
    starredSegments: starredSegments.map((s) => ({
      segmentId: String(s.id),
      name: String(s.name),
      sportCategory: /run/i.test(String(s.activity_type || "")) ? "Running" : "Cycling",
      distanceMeters: Math.round(Number(s.distance || 0)),
      averageGradePct: Number(s.average_grade || 0),
      location: [s.city, s.state].filter(Boolean).join(", ") || "Starred Segment",
      prElapsedTimeSecs: Number(s.athlete_pr_effort?.elapsed_time || 0)
    }))
  };
}

// server/routers/stravaRouter.ts
function getEffectiveStravaClientConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  const allowEnvTokenFallback = process.env.ALLOW_DEV_ENV_CREDENTIALS === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  const headerClientId = activeReq?.headers["x-strava-client-id"];
  const headerClientSecret = activeReq?.headers["x-strava-client-secret"];
  const headerRefreshToken = activeReq?.headers["x-strava-refresh-token"];
  const headerAccessToken = activeReq?.headers["x-strava-access-token"];
  const headerExpiresAt = Number(activeReq?.headers["x-strava-expires-at"] || 0);
  const envClientId = (process.env.STRAVA_CLIENT_ID || "").trim();
  const envClientSecret = (process.env.STRAVA_CLIENT_SECRET || "").trim();
  const cleanHeaderId = (headerClientId || "").trim();
  const cleanHeaderSecret = (headerClientSecret || "").trim();
  const cleanStoreId = (runtimeStore.stravaClientId || "").trim();
  const cleanStoreSecret = (runtimeStore.stravaClientSecret || "").trim();
  const hasByoHeaderPair = Boolean(cleanHeaderId && cleanHeaderSecret);
  const hasByoStorePair = Boolean(
    cleanStoreId && cleanStoreSecret && !isServerOwnedSecret(cleanStoreSecret)
  );
  const clientId = hasByoHeaderPair ? cleanHeaderId : hasByoStorePair ? cleanStoreId : envClientId || cleanHeaderId || cleanStoreId;
  const clientSecret = hasByoHeaderPair ? cleanHeaderSecret : hasByoStorePair ? cleanStoreSecret : envClientSecret || cleanHeaderSecret || cleanStoreSecret;
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return {
      clientId,
      clientSecret,
      refreshToken: "",
      accessToken: "",
      expiresAt: 0
    };
  }
  const storeIsFresherOrPresent = Boolean(runtimeStore.stravaRefreshToken || runtimeStore.stravaAccessToken) && (runtimeStore.stravaExpiresAt || 0) >= headerExpiresAt;
  const refreshToken = ((storeIsFresherOrPresent ? runtimeStore.stravaRefreshToken || headerRefreshToken : headerRefreshToken || runtimeStore.stravaRefreshToken) || (allowEnvTokenFallback ? process.env.STRAVA_REFRESH_TOKEN : "") || "").trim();
  const accessToken = ((storeIsFresherOrPresent ? runtimeStore.stravaAccessToken || headerAccessToken : headerAccessToken || runtimeStore.stravaAccessToken) || (allowEnvTokenFallback ? process.env.STRAVA_ACCESS_TOKEN : "") || "").trim();
  const expiresAt = Math.max(headerExpiresAt || 0, runtimeStore.stravaExpiresAt || 0);
  return { clientId, clientSecret, refreshToken, accessToken, expiresAt };
}
var stravaIdentityByToken = /* @__PURE__ */ new Map();
function getStravaTokenRotationPayload(req) {
  if (req && !isAuthenticatedRequest(req)) {
    return void 0;
  }
  const { clientId, refreshToken, accessToken, expiresAt } = getEffectiveStravaClientConfig(req);
  if (!refreshToken && !accessToken) {
    return void 0;
  }
  const cached = (refreshToken ? stravaIdentityByToken.get(refreshToken) : void 0) || (accessToken ? stravaIdentityByToken.get(accessToken) : void 0);
  return {
    accessToken: accessToken || void 0,
    refreshToken: refreshToken || void 0,
    expiresAt: expiresAt || void 0,
    clientId: clientId || void 0,
    athleteId: cached?.athleteId || void 0,
    athleteName: cached?.athleteName || void 0
  };
}
async function ensureValidStravaAccessToken(req, forceRefresh = false) {
  const { clientId, clientSecret, refreshToken, accessToken, expiresAt } = getEffectiveStravaClientConfig(req);
  if (!accessToken && !refreshToken) {
    return "";
  }
  if (clientId && !runtimeStore.stravaClientId) runtimeStore.stravaClientId = clientId;
  if (clientSecret && !runtimeStore.stravaClientSecret && !isServerOwnedSecret(clientSecret))
    runtimeStore.stravaClientSecret = clientSecret;
  let activeAccessToken = accessToken;
  let activeRefreshToken = refreshToken;
  let activeExpiresAt = expiresAt;
  const nowSecs = Math.floor(Date.now() / 1e3);
  const isExpired = activeExpiresAt > 0 && nowSecs >= activeExpiresAt - 300;
  if ((!activeAccessToken || isExpired || forceRefresh) && activeRefreshToken) {
    if (!clientId || !clientSecret) {
      if (forceRefresh) return "";
      return activeAccessToken;
    }
    const candidateRefreshTokens = [];
    if (activeRefreshToken) candidateRefreshTokens.push(activeRefreshToken);
    if (runtimeStore.stravaRefreshToken && !candidateRefreshTokens.includes(runtimeStore.stravaRefreshToken)) {
      candidateRefreshTokens.push(runtimeStore.stravaRefreshToken);
    }
    const headerRefresh = req?.headers["x-strava-refresh-token"];
    if (headerRefresh && !candidateRefreshTokens.includes(headerRefresh.trim())) {
      candidateRefreshTokens.push(headerRefresh.trim());
    }
    let refreshedSuccessfully = false;
    for (const candidateToken of candidateRefreshTokens) {
      try {
        const refreshResp = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: candidateToken
          })
        });
        if (refreshResp.ok) {
          const refreshed = await readStravaResponseJson(refreshResp);
          const prevCached = stravaIdentityByToken.get(candidateToken);
          activeAccessToken = refreshed.access_token;
          activeRefreshToken = refreshed.refresh_token || candidateToken;
          activeExpiresAt = refreshed.expires_at;
          runtimeStore.stravaAccessToken = activeAccessToken;
          runtimeStore.stravaRefreshToken = activeRefreshToken;
          runtimeStore.stravaExpiresAt = activeExpiresAt;
          if (prevCached) {
            stravaIdentityByToken.set(activeRefreshToken, prevCached);
            stravaIdentityByToken.set(activeAccessToken, prevCached);
          }
          if (req) {
            req.headers["x-strava-access-token"] = activeAccessToken;
            req.headers["x-strava-refresh-token"] = activeRefreshToken;
            req.headers["x-strava-expires-at"] = String(activeExpiresAt);
          }
          if (refreshed.athlete) {
            const name = [refreshed.athlete.firstname, refreshed.athlete.lastname].filter(Boolean).join(" ").trim() || String(refreshed.athlete.username || "").trim();
            if (name) {
              runtimeStore.stravaAthleteName = name;
              const entry = {
                athleteId: extractStravaId(refreshed.athlete),
                athleteName: name
              };
              stravaIdentityByToken.set(activeRefreshToken, entry);
              stravaIdentityByToken.set(activeAccessToken, entry);
            }
          }
          await saveSessionCacheAsync(req);
          refreshedSuccessfully = true;
          break;
        }
      } catch {
      }
    }
    if (forceRefresh && !refreshedSuccessfully) {
      return "";
    }
  } else if (forceRefresh) {
    return "";
  }
  return activeAccessToken;
}
async function resolveStravaAthleteIdentity(req) {
  const { refreshToken, accessToken } = getEffectiveStravaClientConfig(req);
  const cacheKey = refreshToken || accessToken;
  if (!cacheKey) return null;
  const cached = stravaIdentityByToken.get(cacheKey);
  if (cached && !isGenericName(cached.athleteName)) {
    return cached;
  }
  try {
    let validToken = await ensureValidStravaAccessToken(req, false);
    if (!validToken) return null;
    let resp = await fetch("https://www.strava.com/api/v3/athlete", {
      headers: { Authorization: `Bearer ${validToken}` }
    });
    if (resp.status === 401 && refreshToken) {
      validToken = await ensureValidStravaAccessToken(req, true);
      if (validToken) {
        resp = await fetch("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${validToken}` }
        });
      }
    }
    if (!resp.ok) return null;
    const rawAthlete = await readStravaResponseJson(resp);
    const athleteId = extractStravaId(rawAthlete);
    const fullName = [rawAthlete.firstname, rawAthlete.lastname].filter(Boolean).join(" ").trim() || String(rawAthlete.username || "").trim();
    if (!fullName) return null;
    const ftp = Number(rawAthlete.ftp) > 80 ? Math.round(Number(rawAthlete.ftp)) : void 0;
    const weightKg = Number(rawAthlete.weight) > 30 ? Number(rawAthlete.weight) : void 0;
    const measurementPreference = rawAthlete.measurement_preference === "meters" ? "km" : rawAthlete.measurement_preference === "feet" ? "mi" : void 0;
    const entry = {
      athleteId,
      athleteName: fullName,
      ftp,
      weightKg,
      measurementPreference
    };
    stravaIdentityByToken.set(cacheKey, entry);
    stravaIdentityByToken.set(validToken, entry);
    if (runtimeStore.stravaAccessToken === validToken) {
      if (!runtimeStore.stravaAthleteName || isGenericName(runtimeStore.stravaAthleteName)) {
        runtimeStore.stravaAthleteName = fullName;
      }
      if (!runtimeStore.stravaAthleteId) {
        runtimeStore.stravaAthleteId = athleteId;
      }
      if (measurementPreference && !runtimeStore.stravaMeasurementPreference) {
        runtimeStore.stravaMeasurementPreference = measurementPreference;
      }
      await saveSessionCacheAsync(req);
    }
    return entry;
  } catch {
    return null;
  }
}
var pendingOAuthByState = /* @__PURE__ */ new Map();
async function activateStravaCanonicalScope(req, res, opts) {
  const prevClaims = getVerifiedSessionClaims(req);
  const prevStore = getScopedRuntimeStore(req);
  const prevScopeKey = (prevClaims?.sid || opts.expectedSid || "").slice(0, 24);
  const explicitUserId = prevClaims?.sub?.startsWith("usr_") ? prevClaims.sub : opts.expectedUserId?.startsWith("usr_") ? opts.expectedUserId : void 0;
  let canonicalUserId = explicitUserId;
  if (!canonicalUserId && opts.athleteId) {
    const existingUser = await getUserByProvider("strava", opts.athleteId);
    if (existingUser && existingUser.authProviders.some((p) => p.provider !== "strava")) {
      canonicalUserId = existingUser.id;
    }
  }
  let canonicalSid;
  let sessionSubject;
  if (canonicalUserId) {
    canonicalSid = (prevClaims?.sub === canonicalUserId ? prevClaims.sid : void 0) || (opts.expectedUserId === canonicalUserId ? opts.expectedSid : void 0) || deriveUserSessionSid(canonicalUserId);
    sessionSubject = canonicalUserId;
  } else {
    canonicalSid = opts.athleteId ? deriveStravaSessionSid(opts.athleteId) : prevClaims?.sid || opts.expectedSid || crypto11.randomBytes(16).toString("hex");
    sessionSubject = !isGenericName(opts.athleteName) ? opts.athleteName : "Strava Athlete";
  }
  if (opts.athleteId) {
    if (prevClaims?.sid && prevClaims.sid !== canonicalSid) {
      await migrateAnonymousTeamsToStravaSid({
        oldSid: prevClaims.sid,
        stravaSid: canonicalSid,
        athleteName: !isGenericName(opts.athleteName) ? opts.athleteName : void 0,
        stravaAthleteId: opts.athleteId
      });
    }
    const legacyStravaSid = deriveStravaSessionSid(opts.athleteId);
    if (legacyStravaSid !== canonicalSid) {
      await migrateAnonymousTeamsToStravaSid({
        oldSid: legacyStravaSid,
        stravaSid: canonicalSid,
        athleteName: !isGenericName(opts.athleteName) ? opts.athleteName : void 0,
        stravaAthleteId: opts.athleteId
      });
    }
  }
  const scopeKey = canonicalSid.slice(0, 24);
  await loadTenantVaultAsync(`session_${scopeKey}`, {});
  bindRequestScopeKey(req, canonicalSid);
  const sessionToken = setSessionCookie(req, res, sessionSubject, canonicalSid, "verified");
  const store = getScopedRuntimeStore(req);
  if (!store.stravaClientId && prevStore.stravaClientId) {
    store.stravaClientId = prevStore.stravaClientId;
  }
  if (!store.stravaClientSecret && prevStore.stravaClientSecret) {
    store.stravaClientSecret = prevStore.stravaClientSecret;
  }
  if (!store.intervalsApiKey && prevStore.intervalsApiKey) {
    store.intervalsApiKey = prevStore.intervalsApiKey;
    store.intervalsAthleteId = prevStore.intervalsAthleteId || "0";
    store.intervalsAthleteName = prevStore.intervalsAthleteName || "";
  }
  if (!store.intervalsAccessToken && prevStore.intervalsAccessToken) {
    store.intervalsAccessToken = prevStore.intervalsAccessToken;
    store.intervalsScope = prevStore.intervalsScope;
    store.intervalsAthleteId = prevStore.intervalsAthleteId || store.intervalsAthleteId || "0";
    store.intervalsAthleteName = prevStore.intervalsAthleteName || store.intervalsAthleteName || "";
  }
  if (!store.wahooAccessToken && prevStore.wahooAccessToken) {
    store.wahooAccessToken = prevStore.wahooAccessToken;
    store.wahooRefreshToken = prevStore.wahooRefreshToken;
    store.wahooExpiresAt = prevStore.wahooExpiresAt;
    store.wahooScope = prevStore.wahooScope;
    store.wahooUserId = prevStore.wahooUserId;
    store.wahooAthleteName = prevStore.wahooAthleteName;
  }
  if (!store.polarAccessToken && prevStore.polarAccessToken) {
    store.polarAccessToken = prevStore.polarAccessToken;
    store.polarUserId = prevStore.polarUserId;
    store.polarAthleteName = prevStore.polarAthleteName;
    store.polarExpiresAt = prevStore.polarExpiresAt;
    store.polarScope = prevStore.polarScope;
  }
  if (!store.stravaSyncPolicy && prevStore.stravaSyncPolicy) {
    store.stravaSyncPolicy = prevStore.stravaSyncPolicy;
  }
  if (prevScopeKey && prevScopeKey !== scopeKey) {
    const existingGarmin = await loadTenantVaultAsync(
      `garmin_${prevScopeKey}`,
      null
    );
    if (existingGarmin) {
      await saveTenantVaultAsync(`garmin_${scopeKey}`, existingGarmin);
    }
  }
  if (canonicalUserId && opts.athleteId) {
    try {
      const cleanName = !isGenericName(opts.athleteName) ? opts.athleteName : void 0;
      await linkProviderToUser(canonicalUserId, "strava", opts.athleteId, { name: cleanName });
      await connectServiceToUser(canonicalUserId, "strava", opts.athleteId, cleanName);
    } catch (err) {
      console.warn("[THRESH Auth] Linking Strava to existing ThreshUser warning:", err);
    }
  }
  return { canonicalSid, scopeKey, sessionToken, store, linkedUserId: canonicalUserId };
}
function buildReturnOnboardingUrl(verifiedState, extraParams = {}) {
  const basePath = verifiedState?.slug ? `/join/${encodeURIComponent(verifiedState.slug)}` : "/";
  const params = new URLSearchParams();
  if (verifiedState?.joinCode && !verifiedState?.slug) {
    params.set("join", verifiedState.joinCode);
  }
  if (verifiedState?.inviteToken) {
    params.set("t", verifiedState.inviteToken);
  }
  for (const [k, v] of Object.entries(extraParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
async function exchangeStravaAuthCode(codeInput, req) {
  let code = codeInput.trim();
  if (code.includes("code=")) {
    try {
      const urlObj = new URL(code.startsWith("http") ? code : `http://localhost/${code}`);
      const extracted = urlObj.searchParams.get("code");
      if (extracted) code = extracted.trim();
    } catch {
      const match = code.match(/[?&]code=([^&]+)/);
      if (match?.[1]) code = decodeURIComponent(match[1]).trim();
    }
  }
  if (!code) {
    throw new Error("Missing authorization code from Strava.");
  }
  const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Strava Client ID and Client Secret are required to exchange an authorization code."
    );
  }
  const tokenResp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code"
    })
  });
  if (!tokenResp.ok) {
    const errText = await tokenResp.text();
    throw new Error(`Strava token exchange failed: ${errText}`);
  }
  const tokenData = await readStravaResponseJson(tokenResp);
  return tokenData;
}
function buildStravaCallbackScript(opts) {
  return `(function(){
    var payload = ${opts.serializedPayload};
    ${opts.preScript || ""}
    var hasOpener = false;
    try {
      if (window.opener && window.opener !== window) {
        hasOpener = true;
        window.opener.postMessage(payload, window.location.origin);
        if (payload.openerOrigin && payload.openerOrigin !== window.location.origin) {
          window.opener.postMessage(payload, payload.openerOrigin);
        }
      }
    } catch (e) {}
    ${opts.redirectOnNonPopup ? `if (hasOpener && payload.openerOrigin === 'https://aeropulse-eta.vercel.app' && window.location.origin !== 'https://aeropulse-eta.vercel.app') {
      try { window.opener.location.href = window.location.origin + (payload.returnUrl || '/'); } catch (e) {}
    }` : ""}
    try {
      var bc = new BroadcastChannel('aeropulse_oauth');
      bc.postMessage(payload);
    } catch (e) {}
    try {
      localStorage.setItem('aeropulse_oauth_result_v1', JSON.stringify({ ts: Date.now(), payload: payload }));
    } catch (e) {}
    var isPopupWindow = Boolean(payload.isPopupFlow) || hasOpener || window.name === 'strava_oauth_popup';
    if (isPopupWindow) {
      setTimeout(function() { try { window.close(); } catch (e) {} }, 250);
    }${opts.redirectOnNonPopup ? ` else {
      window.location.replace(payload.returnUrl || '/');
    }` : ""}
  })();`;
}
var stravaCallbackHandler = async (req, res) => {
  const oauthState = String(req.query.state || "").trim();
  const verifiedState = oauthState ? verifyOAuthStateToken(oauthState) : null;
  const isPopupFlow = verifiedState?.flow === "popup";
  const trustedOpenerOrigin = resolveTrustedCorsOrigin(verifiedState?.origin) || void 0;
  try {
    const oauthErr = req.query.error;
    if (oauthErr) {
      clearOAuthStateCookie(res);
      const isCancelled = oauthErr === "access_denied";
      const friendlyErr = isCancelled ? "Strava sign-in was cancelled. Ready whenever you want to continue." : `Strava authorization failed: ${oauthErr}`;
      const returnHref = buildReturnOnboardingUrl(verifiedState, {
        auth_error: friendlyErr
      });
      const cancelJson = safeJsonForScript({
        type: "OAUTH_AUTH_ERROR",
        provider: "strava",
        cancelled: isCancelled,
        error: friendlyErr,
        isPopupFlow,
        openerOrigin: trustedOpenerOrigin
      });
      res.status(isCancelled ? 200 : 400).type("html").send(
        renderThreshOAuthHtml({
          title: isCancelled ? "Strava Sign-In Cancelled" : "Strava Authorization Error",
          heading: isCancelled ? "Strava Sign-In Cancelled" : "Strava Authorization Declined",
          accentColor: isCancelled ? "#FBBF24" : "#FB7185",
          body: escapeHtml(friendlyErr),
          ctaLabel: "Return to THRESH",
          ctaHref: returnHref,
          ctaOnClick: "if (window.opener || window.name === 'strava_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
          scriptBody: buildStravaCallbackScript({ serializedPayload: cancelJson })
        })
      );
      return;
    }
    const code = req.query.code;
    if (!code) {
      clearOAuthStateCookie(res);
      res.status(400).type("html").send(
        renderThreshOAuthHtml({
          title: "Strava Connection Incomplete",
          heading: "Missing Strava Code",
          accentColor: "#FB7185",
          body: "No authorization code was returned by Strava. Please try connecting again.",
          ctaLabel: "Return to THRESH",
          ctaHref: buildReturnOnboardingUrl(verifiedState)
        })
      );
      return;
    }
    const cookieNonce = getOAuthStateCookieNonce(req);
    const scopeParam = String(req.query.scope || "").trim();
    if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
      clearOAuthStateCookie(res);
      res.status(400).type("html").send(
        renderThreshOAuthHtml({
          title: "Security Verification Failed",
          heading: "Invalid OAuth State",
          accentColor: "#FB7185",
          body: !verifiedState ? "The security verification token has expired or is invalid. Please return and initiate connection again." : "The browser OAuth state cookie is missing or does not match. Please return and initiate connection again.",
          ctaLabel: "Return to THRESH",
          ctaHref: "/"
        })
      );
      return;
    }
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        "Strava Client ID and Secret are missing on this server. Configure them in Vercel or local .env."
      );
    }
    const tokenResp = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code"
      })
    });
    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      throw new Error(`Strava token exchange failed: ${errText}`);
    }
    const tokenData = await readStravaResponseJson(tokenResp);
    let athleteName = [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(" ").trim() || tokenData.athlete?.username?.trim() || "";
    let athleteId = extractStravaId(tokenData.athlete) || void 0;
    let weightKg = typeof tokenData.athlete?.weight === "number" && tokenData.athlete.weight > 30 ? Number(tokenData.athlete.weight.toFixed(1)) : void 0;
    let ftp = typeof tokenData.athlete?.ftp === "number" && tokenData.athlete.ftp > 80 ? Math.round(tokenData.athlete.ftp) : void 0;
    let measurementPreference = tokenData.athlete?.measurement_preference === "meters" ? "km" : tokenData.athlete?.measurement_preference === "feet" ? "mi" : void 0;
    if (!athleteName || isGenericName(athleteName) || !weightKg || !ftp || !measurementPreference) {
      try {
        const athResp = await fetch("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (athResp.ok) {
          const rawAth = await readStravaResponseJson(athResp);
          const enrichedName = [rawAth.firstname, rawAth.lastname].filter(Boolean).join(" ").trim() || String(rawAth.username || "").trim();
          if (enrichedName && (!athleteName || isGenericName(athleteName))) {
            athleteName = enrichedName;
          }
          const fetchedAthId = extractStravaId(rawAth);
          if (!athleteId && fetchedAthId) athleteId = fetchedAthId;
          if (!weightKg && Number(rawAth.weight) > 30) {
            weightKg = Number(Number(rawAth.weight).toFixed(1));
          }
          if (!ftp && Number(rawAth.ftp) > 80) {
            ftp = Math.round(Number(rawAth.ftp));
          }
          if (!measurementPreference) {
            if (rawAth.measurement_preference === "meters") measurementPreference = "km";
            else if (rawAth.measurement_preference === "feet") measurementPreference = "mi";
          }
        }
      } catch {
      }
    }
    if (!athleteName) athleteName = "Strava Athlete";
    const { canonicalSid, sessionToken, store, linkedUserId } = await activateStravaCanonicalScope(req, res, {
      athleteId,
      athleteName,
      expectedSid: verifiedState?.sid,
      expectedUserId: verifiedState?.userId
    });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);
    store.stravaAccessToken = tokenData.access_token;
    store.stravaRefreshToken = tokenData.refresh_token;
    store.stravaExpiresAt = tokenData.expires_at;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (scopeParam) store.stravaGrantedScope = scopeParam;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;
    if (athleteId) {
      const identityEntry = {
        athleteId,
        athleteName,
        ftp,
        weightKg,
        measurementPreference
      };
      stravaIdentityByToken.set(tokenData.access_token, identityEntry);
      stravaIdentityByToken.set(tokenData.refresh_token, identityEntry);
    }
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser("strava", athleteId, {
          name: !isGenericName(athleteName) ? athleteName : void 0
        });
      } catch (err) {
        console.warn("[THRESH Auth] Auto-migration of Strava athlete to THRESH accounts skipped:", err);
      }
    }
    await saveSessionCacheAsync(req, res, canonicalSid);
    const pendingPayload = {
      createdAt: Date.now(),
      nonce: verifiedState.nonce,
      sid: canonicalSid,
      athleteId,
      athleteName,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      clientId,
      measurementPreference,
      grantedScope: scopeParam,
      weightKg,
      ftp,
      hasExistingSyncPolicy
    };
    pendingOAuthByState.set(verifiedState.nonce, pendingPayload);
    if (verifiedState?.nonce) {
      await saveTenantVaultAsync(`oauth_poll_${verifiedState.nonce}`, pendingPayload);
    }
    clearOAuthStateCookie(res);
    const hasPendingTeamJoin = Boolean(verifiedState?.slug || verifiedState?.joinCode);
    const onboardingUrl = buildReturnOnboardingUrl(verifiedState, {
      oauth: "strava_connected",
      oauth_just_connected: "1",
      ...athleteId ? { strava_athlete_id: athleteId } : {},
      ...athleteName && !isGenericName(athleteName) ? { strava_athlete_name: athleteName } : {}
    });
    const returnUrl = !hasPendingTeamJoin ? "/#fitness" : onboardingUrl;
    const oauthSuccessPayload = safeJsonForScript({
      type: "OAUTH_AUTH_SUCCESS",
      provider: "strava",
      athleteId,
      athleteName,
      sessionToken,
      hasExistingSyncPolicy,
      hasPendingTeamJoin,
      measurementPreference,
      grantedScope: scopeParam,
      returnUrl,
      isPopupFlow,
      openerOrigin: trustedOpenerOrigin,
      tokens: {
        expiresAt: tokenData.expires_at,
        clientId,
        athleteId,
        athleteName,
        weightKg,
        ftp,
        measurementPreference,
        grantedScope: scopeParam
      }
    });
    const successHydrationScript = `try {
      if (payload.sessionToken) localStorage.setItem('aeropulse_session_token', payload.sessionToken);
      if (payload.tokens) {
        var prevAthleteId = localStorage.getItem('aeropulse_strava_athlete_id');
        if (prevAthleteId && payload.tokens.athleteId && String(payload.tokens.athleteId) !== prevAthleteId) {
          localStorage.removeItem('aeropulse_strava_athlete_name');
          localStorage.removeItem('aeropulse_auth_gate_passed');
          localStorage.removeItem('aeropulse_strava_sync_policy');
        }
        if (payload.tokens.expiresAt) localStorage.setItem('aeropulse_strava_expires_at', String(payload.tokens.expiresAt));
        if (payload.tokens.clientId) localStorage.setItem('aeropulse_strava_client_id', payload.tokens.clientId);
        if (payload.tokens.athleteId) localStorage.setItem('aeropulse_strava_athlete_id', String(payload.tokens.athleteId));
        if (payload.tokens.athleteName) localStorage.setItem('aeropulse_strava_athlete_name', payload.tokens.athleteName);
        if (payload.tokens.weightKg) localStorage.setItem('aeropulse_strava_athlete_weight_kg', String(payload.tokens.weightKg));
        if (payload.tokens.ftp) localStorage.setItem('aeropulse_strava_athlete_ftp', String(payload.tokens.ftp));
        if (payload.tokens.measurementPreference) localStorage.setItem('aeropulse_strava_measurement_pref', payload.tokens.measurementPreference);
        if (payload.tokens.grantedScope) localStorage.setItem('aeropulse_strava_granted_scope', payload.tokens.grantedScope);
        localStorage.removeItem('aeropulse_logged_out');
        var sameAthlete = !prevAthleteId || !payload.tokens.athleteId || String(payload.tokens.athleteId) === prevAthleteId;
        var hasLocalSyncPolicy = false;
        try { hasLocalSyncPolicy = Boolean(localStorage.getItem('aeropulse_strava_sync_policy')); } catch (e) {}
        if (!payload.hasPendingTeamJoin) {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
          if (!sameAthlete || !hasLocalSyncPolicy) {
            try {
              var granted = payload.tokens.grantedScope ? String(payload.tokens.grantedScope) : '';
              var hasActivityScope = !granted || granted.indexOf('activity:read') !== -1;
              localStorage.setItem('aeropulse_strava_sync_policy', JSON.stringify({
                window: hasActivityScope ? '90d' : 'none',
                importProfileAndGear: true,
                confirmedAt: new Date().toISOString(),
                grantedScope: granted || undefined
              }));
            } catch (e) {}
          }
        } else if (payload.hasExistingSyncPolicy || (sameAthlete && hasLocalSyncPolicy)) {
          localStorage.setItem('aeropulse_auth_gate_passed', '1');
        } else if (!sameAthlete) {
          localStorage.removeItem('aeropulse_auth_gate_passed');
        }
      } else {
        if (payload.athleteId) localStorage.setItem('aeropulse_strava_athlete_id', String(payload.athleteId));
        if (payload.athleteName) localStorage.setItem('aeropulse_strava_athlete_name', payload.athleteName);
        localStorage.removeItem('aeropulse_logged_out');
      }
      localStorage.setItem('aeropulse_oauth_just_connected', '1');
    } catch (e) {}`;
    res.status(200).type("html").send(
      renderThreshOAuthHtml({
        title: "Strava Connected \xB7 THRESH",
        heading: `Strava Connected${athleteName && !isGenericName(athleteName) ? ` \xB7 ${escapeHtml(athleteName)}` : ""}`,
        accentColor: "#10B981",
        body: !hasPendingTeamJoin ? "Strava connected! Opening your THRESH training workspace\u2026" : "Your Strava account is linked. Return to THRESH to complete your team roster setup.",
        ctaLabel: "Continue to THRESH",
        ctaHref: returnUrl,
        scriptBody: buildStravaCallbackScript({
          serializedPayload: oauthSuccessPayload,
          preScript: successHydrationScript,
          redirectOnNonPopup: true
        })
      })
    );
  } catch (error) {
    clearOAuthStateCookie(res);
    const friendlyErr = error instanceof Error ? error.message : "Unknown Strava OAuth authorization failure";
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "strava",
      error: friendlyErr,
      isPopupFlow,
      openerOrigin: trustedOpenerOrigin
    });
    res.status(500).type("html").send(
      renderThreshOAuthHtml({
        title: "Strava Connection Error",
        heading: "Strava Connection Failed",
        accentColor: "#FB7185",
        body: escapeHtml(friendlyErr),
        ctaLabel: "Return to THRESH",
        ctaHref: buildReturnOnboardingUrl(verifiedState, { auth_error: friendlyErr }),
        ctaOnClick: "if (window.opener || window.name === 'strava_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: buildStravaCallbackScript({ serializedPayload: errJson })
      })
    );
  }
};
var stravaRouter = express6.Router();
stravaRouter.post("/api/strava/credentials", async (req, res) => {
  const clientId = (req.body?.clientId || "").trim();
  const clientSecret = (req.body?.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: "Both Strava Client ID and Client Secret are required." });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  runtimeStore.stravaClientId = clientId;
  runtimeStore.stravaClientSecret = clientSecret;
  await saveSessionCacheAsync(req, res, sid);
  res.json({ saved: true, clientId });
});
async function buildStravaAuthorizeRequest(req, res, clientId) {
  const { sid, sessionToken } = ensureRequestSession(req, res);
  const mode = String(req.query.mode || "cloud").toLowerCase();
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const prompt = String(req.query.prompt || "auto").toLowerCase() === "force" ? "force" : "auto";
  const callerOrigin = resolveSafeOrigin(req.query.origin) || void 0;
  const clientNonce = String(req.query.state || "").trim();
  const joinCode = String(req.query.joinCode || req.query.join || "").trim().slice(0, 32) || void 0;
  const slug = String(req.query.slug || "").trim().slice(0, 64) || void 0;
  const inviteToken = String(req.query.inviteToken || req.query.t || "").trim().slice(0, 96) || void 0;
  const callerClaims = getVerifiedSessionClaims(req);
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || void 0,
    sid,
    flow,
    mode,
    origin: callerOrigin,
    joinCode,
    slug,
    inviteToken,
    userId: callerClaims?.sub?.startsWith("usr_") ? callerClaims.sub : void 0
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = mode === "localhost" ? "http://localhost/exchange_token" : await resolveValidatedStravaCallbackUrl(req, clientId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: prompt,
    scope: "read,activity:read_all,profile:read_all",
    state: stateToken
  });
  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  return { authUrl, redirectUri, stateToken, sessionToken };
}
stravaRouter.get(
  ["/api/strava/auth/url", "/api/auth/strava/url"],
  async (req, res) => {
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      res.status(400).json({
        error: "Strava OAuth is not configured on this server yet. Please set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in your Vercel Environment Variables (or local .env)."
      });
      return;
    }
    const { authUrl, redirectUri, stateToken, sessionToken } = await buildStravaAuthorizeRequest(
      req,
      res,
      clientId
    );
    res.json({ url: authUrl, redirectUri, clientId, state: stateToken, sessionToken });
  }
);
stravaRouter.get(
  ["/api/strava/auth/login", "/api/auth/strava/login"],
  async (req, res) => {
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      const msg = encodeURIComponent(
        "Strava OAuth is not configured on this server yet (missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET)."
      );
      res.redirect(302, `/?auth_error=${msg}`);
      return;
    }
    const { authUrl } = await buildStravaAuthorizeRequest(req, res, clientId);
    res.redirect(302, authUrl);
  }
);
stravaRouter.get("/api/strava/auth/poll", async (req, res) => {
  const state = String(req.query.state || "").trim();
  const verifiedState = verifyOAuthStateToken(state);
  const rawNonce = /^[a-f0-9_-]{12,64}$/i.test(state) ? state : "";
  const lookupNonce = verifiedState?.nonce || rawNonce;
  if (!lookupNonce) {
    res.json({ completed: false });
    return;
  }
  const now = Date.now();
  for (const [k, v] of pendingOAuthByState.entries()) {
    if (now - v.createdAt > 180 * 1e3) {
      pendingOAuthByState.delete(k);
    }
  }
  let found = pendingOAuthByState.get(lookupNonce);
  if (!found) {
    found = await loadTenantVaultAsync(
      `oauth_poll_${lookupNonce}`,
      null
    );
  }
  if (!found || now - found.createdAt > 180 * 1e3) {
    res.json({ completed: false });
    return;
  }
  const callerClaims = getVerifiedSessionClaims(req);
  const cookieNonce = getOAuthStateCookieNonce(req);
  const canonicalSidForFound = found.athleteId ? deriveStravaSessionSid(found.athleteId) : void 0;
  const cookieMatchesVerified = Boolean(
    cookieNonce && (verifiedState?.nonce && timingSafeStringEqual(cookieNonce, verifiedState.nonce) || lookupNonce && timingSafeStringEqual(cookieNonce, lookupNonce))
  );
  const callerMatchesSid = Boolean(
    callerClaims?.sid && (verifiedState?.sid && callerClaims.sid === verifiedState.sid || found.sid && callerClaims.sid === found.sid || canonicalSidForFound && callerClaims.sid === canonicalSidForFound)
  );
  const authorizedCaller = cookieMatchesVerified || callerMatchesSid;
  if (!authorizedCaller) {
    res.json({ completed: false });
    return;
  }
  pendingOAuthByState.delete(lookupNonce);
  await deleteTenantVault(`oauth_poll_${lookupNonce}`);
  clearOAuthStateCookie(res);
  const { canonicalSid, sessionToken, store } = await activateStravaCanonicalScope(req, res, {
    athleteId: found.athleteId,
    athleteName: found.athleteName || "Strava Athlete"
  });
  if (found.accessToken) store.stravaAccessToken = found.accessToken;
  if (found.refreshToken) store.stravaRefreshToken = found.refreshToken;
  if (found.expiresAt) store.stravaExpiresAt = found.expiresAt;
  if (found.clientId) store.stravaClientId = found.clientId;
  if (found.athleteId) store.stravaAthleteId = found.athleteId;
  if (found.athleteName && !isGenericName(found.athleteName)) {
    store.stravaAthleteName = found.athleteName;
  }
  if (found.measurementPreference) {
    store.stravaMeasurementPreference = found.measurementPreference;
  }
  if (found.grantedScope) {
    store.stravaGrantedScope = found.grantedScope;
  }
  await saveSessionCacheAsync(req, res, canonicalSid);
  res.json({
    completed: true,
    hasExistingSyncPolicy: Boolean(
      found.hasExistingSyncPolicy || store.stravaSyncPolicy?.confirmedAt
    ),
    sessionToken,
    athleteId: found.athleteId,
    athleteName: found.athleteName,
    measurementPreference: found.measurementPreference,
    grantedScope: found.grantedScope,
    tokens: {
      expiresAt: found.expiresAt,
      clientId: found.clientId,
      athleteId: found.athleteId,
      athleteName: found.athleteName,
      weightKg: found.weightKg,
      ftp: found.ftp,
      measurementPreference: found.measurementPreference,
      grantedScope: found.grantedScope
    }
  });
});
stravaRouter.post("/api/strava/exchange-code", async (req, res) => {
  try {
    const codeOrUrl = String(req.body?.code || req.body?.url || "").trim();
    const tokenData = await exchangeStravaAuthCode(codeOrUrl, req);
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    const athleteName = [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(" ").trim() || tokenData.athlete?.username?.trim() || "Strava Athlete";
    const athleteId = extractStravaId(tokenData.athlete) || void 0;
    const weightKg = typeof tokenData.athlete?.weight === "number" && tokenData.athlete.weight > 30 ? Number(tokenData.athlete.weight.toFixed(1)) : void 0;
    const ftp = typeof tokenData.athlete?.ftp === "number" && tokenData.athlete.ftp > 80 ? Math.round(tokenData.athlete.ftp) : void 0;
    const measurementPreference = tokenData.athlete?.measurement_preference === "meters" ? "km" : tokenData.athlete?.measurement_preference === "feet" ? "mi" : void 0;
    const { canonicalSid, sessionToken, store, linkedUserId } = await activateStravaCanonicalScope(req, res, {
      athleteId,
      athleteName
    });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);
    store.stravaAccessToken = tokenData.access_token;
    store.stravaRefreshToken = tokenData.refresh_token;
    store.stravaExpiresAt = tokenData.expires_at;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser("strava", athleteId, {
          name: !isGenericName(athleteName) ? athleteName : void 0
        });
      } catch (err) {
        console.warn("[THRESH Auth] Auto-migration of Strava athlete to THRESH accounts skipped:", err);
      }
    }
    await saveSessionCacheAsync(req, res, canonicalSid);
    res.json({
      connected: true,
      hasExistingSyncPolicy,
      sessionToken,
      athleteId,
      athleteName,
      weightKg,
      ftp,
      measurementPreference,
      expiresAt: tokenData.expires_at,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      clientId: clientId || void 0
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to exchange Strava authorization code"
    });
  }
});
stravaRouter.post("/api/strava/token", async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    const accessToken = String(req.body?.accessToken || "").trim();
    const allowIdentityOnly = Boolean(req.body?.allowIdentityOnly);
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!refreshToken && !accessToken) {
      res.status(400).json({ error: "Provide either a Strava Refresh Token or Access Token." });
      return;
    }
    let resolvedAccessToken = accessToken;
    let resolvedRefreshToken = refreshToken;
    let resolvedExpiresAt = Math.floor(Date.now() / 1e3) + 21600;
    if (refreshToken && clientId && clientSecret) {
      const refreshResp = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      });
      if (refreshResp.ok) {
        const refreshed = await readStravaResponseJson(refreshResp);
        resolvedAccessToken = refreshed.access_token;
        resolvedRefreshToken = refreshed.refresh_token || refreshToken;
        resolvedExpiresAt = refreshed.expires_at;
      } else if (!accessToken) {
        const errText = await refreshResp.text();
        res.status(400).json({ error: `Strava token refresh failed: ${errText}` });
        return;
      }
    } else if (!accessToken) {
      res.status(400).json({
        error: "Save your Strava Client ID & Secret first to use a Refresh Token, or also provide an Access Token."
      });
      return;
    }
    const [athleteResp, actCheckResp] = await Promise.all([
      fetch("https://www.strava.com/api/v3/athlete", {
        headers: { Authorization: `Bearer ${resolvedAccessToken}` }
      }),
      fetch("https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1", {
        headers: { Authorization: `Bearer ${resolvedAccessToken}` }
      })
    ]);
    let grantedScope = "read,activity:read_all,profile:read_all";
    if (!actCheckResp.ok) {
      const errBody = await actCheckResp.text();
      if (errBody.includes("activity:read_permission")) {
        if (!allowIdentityOnly) {
          res.status(400).json({
            error: "Strava's default API settings token only has profile 'read' scope (missing 'activity:read_all'). Please sign in via Strava OAuth to grant activity read permission."
          });
          return;
        }
        grantedScope = "read";
      }
    }
    let athleteName = "Strava Athlete";
    let athleteId;
    let weightKg;
    let ftp;
    let measurementPreference;
    if (athleteResp.ok) {
      const athlete = await readStravaResponseJson(athleteResp);
      athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim() || athlete.username?.trim() || "Strava Athlete";
      const fetchedAthId = extractStravaId(athlete);
      if (fetchedAthId) athleteId = fetchedAthId;
      if (typeof athlete.weight === "number" && athlete.weight > 30) {
        weightKg = Number(athlete.weight.toFixed(1));
      }
      if (typeof athlete.ftp === "number" && athlete.ftp > 80) {
        ftp = Math.round(athlete.ftp);
      }
      if (athlete.measurement_preference === "meters") measurementPreference = "km";
      else if (athlete.measurement_preference === "feet") measurementPreference = "mi";
    }
    const { canonicalSid, sessionToken, store, linkedUserId } = await activateStravaCanonicalScope(req, res, {
      athleteId,
      athleteName
    });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);
    store.stravaAccessToken = resolvedAccessToken;
    store.stravaRefreshToken = resolvedRefreshToken;
    store.stravaExpiresAt = resolvedExpiresAt;
    store.stravaGrantedScope = grantedScope;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;
    if (athleteId && !linkedUserId) {
      try {
        await findOrCreateUser("strava", athleteId, {
          name: !isGenericName(athleteName) ? athleteName : void 0
        });
      } catch (err) {
        console.warn("[THRESH Auth] Auto-migration of Strava athlete to THRESH accounts skipped:", err);
      }
    }
    await saveSessionCacheAsync(req, res, canonicalSid);
    res.json({
      connected: true,
      hasExistingSyncPolicy,
      sessionToken,
      athleteId,
      athleteName,
      weightKg,
      ftp,
      measurementPreference,
      grantedScope,
      accessToken: resolvedAccessToken,
      refreshToken: resolvedRefreshToken,
      expiresAt: resolvedExpiresAt,
      clientId: clientId || void 0
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to verify Strava token"
    });
  }
});
stravaRouter.post("/api/strava/sync-policy", async (req, res) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: "Sign in with Strava first to set your sync preference." });
    return;
  }
  const rawWindow = String(req.body?.window || "90d").trim();
  const validWindows = /* @__PURE__ */ new Set(["90d", "180d", "365d", "all", "none"]);
  const windowVal = validWindows.has(rawWindow) ? rawWindow : "90d";
  const importProfileAndGear = typeof req.body?.importProfileAndGear === "boolean" ? req.body.importProfileAndGear : typeof req.body?.includeGearAndProfile === "boolean" ? req.body.includeGearAndProfile : true;
  const policy = {
    window: windowVal,
    importProfileAndGear,
    confirmedAt: (/* @__PURE__ */ new Date()).toISOString(),
    grantedScope: runtimeStore.stravaGrantedScope || void 0
  };
  runtimeStore.stravaSyncPolicy = policy;
  await saveSessionCacheAsync(req, res);
  res.json({ ok: true, stravaSyncPolicy: policy });
});
stravaRouter.post("/api/strava/disconnect", async (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  if (!isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const cleanAthleteId = String(runtimeStore.stravaAthleteId || "").replace(/[^0-9a-zA-Z_-]/g, "");
  const accessToken = await ensureValidStravaAccessToken(req, false).catch(() => "");
  if (accessToken) {
    await fetch(
      `https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(accessToken)}`,
      { method: "POST", signal: AbortSignal.timeout(4e3) }
    ).catch(() => void 0);
  }
  if (claims?.sub?.startsWith("usr_")) {
    await disconnectServiceFromUser(claims.sub, "strava").catch(() => void 0);
  }
  if (cleanAthleteId) {
    try {
      const archivePath = `/tmp/aeropulse-strava-archive-${cleanAthleteId}.json`;
      if (fs6.existsSync(archivePath)) fs6.unlinkSync(archivePath);
    } catch {
    }
  }
  runtimeStore.stravaAccessToken = "";
  runtimeStore.stravaRefreshToken = "";
  runtimeStore.stravaExpiresAt = 0;
  runtimeStore.stravaAthleteId = void 0;
  runtimeStore.stravaAthleteName = "";
  runtimeStore.stravaMeasurementPreference = void 0;
  runtimeStore.stravaGrantedScope = void 0;
  runtimeStore.stravaSyncPolicy = void 0;
  runtimeStore.stravaClientId = "";
  runtimeStore.stravaClientSecret = "";
  await saveSessionCacheAsync(req, res);
  appendSetCookieHeader(res, buildClearVaultCookieHeader());
  res.json({ ok: true, disconnected: "strava" });
});
stravaRouter.get(
  [
    "/auth/strava/callback",
    "/auth/strava/callback/",
    "/api/strava/callback",
    "/api/strava/callback/",
    "/api/auth/strava/callback",
    "/api/auth/strava/callback/"
  ],
  stravaCallbackHandler
);
stravaRouter.get("/api/strava/sync", async (req, res) => {
  try {
    const forceFull = req.query.full === "true";
    const deltaOnly = req.query.deltaOnly === "true";
    const explicitWindow = typeof req.query.window === "string" ? req.query.window.trim() : void 0;
    const afterEpochParam = Number(req.query.afterEpoch || 0);
    const beforeEpochParam = Number(req.query.beforeEpoch || 0);
    const data = await syncStravaAllHistory(
      req,
      forceFull,
      deltaOnly,
      explicitWindow,
      Number.isFinite(afterEpochParam) && afterEpochParam > 0 ? afterEpochParam : 0,
      Number.isFinite(beforeEpochParam) && beforeEpochParam > 0 ? beforeEpochParam : 0
    );
    await saveSessionCacheAsync(req, res);
    res.json(data);
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Failed to sync Strava activities and segments"
    });
  }
});
stravaRouter.get("/api/strava/activities/:id/streams", async (req, res) => {
  try {
    const activeAccessToken = await ensureValidStravaAccessToken(req, false);
    if (!activeAccessToken) {
      res.status(401).json({ error: "Strava is not connected." });
      return;
    }
    const activityId = req.params.id;
    const headers = { Authorization: `Bearer ${activeAccessToken}` };
    const [streamsResp, detailResp, kudosResp] = await Promise.all([
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/streams?keys=time,distance,latlng,watts,heartrate,velocity_smooth,cadence,altitude&key_by_type=true`,
        { headers }
      ),
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}?include_all_efforts=true`,
        { headers }
      ),
      fetch(
        `https://www.strava.com/api/v3/activities/${encodeURIComponent(activityId)}/kudos?per_page=50`,
        { headers }
      )
    ]);
    if (!streamsResp.ok && !detailResp.ok) {
      res.status(streamsResp.status).json({ error: "Unable to load Strava streams for activity." });
      return;
    }
    const raw = streamsResp.ok ? await readStravaResponseJson(streamsResp) : {};
    const timeData = Array.isArray(raw?.time?.data) ? raw.time.data : [];
    const step = Math.max(1, Math.floor(timeData.length / 500));
    const downsample = (arr) => Array.isArray(arr) ? arr.filter((_, idx) => idx % step === 0) : void 0;
    const rawLatLng = Array.isArray(raw?.latlng?.data) ? raw.latlng.data : void 0;
    const downsampledLatLng = rawLatLng ? rawLatLng.filter((_, idx) => idx % step === 0).filter((pt) => Array.isArray(pt) && pt.length === 2 && Math.abs(pt[0]) > 0.01).map((pt) => [Number(Number(pt[0]).toFixed(5)), Number(Number(pt[1]).toFixed(5))]) : void 0;
    let segmentEfforts = [];
    if (detailResp.ok) {
      const detail = await readStravaResponseJson(detailResp);
      const resolvedActivityId = extractStravaId(detail) || activityId;
      const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
      const sportType = String(detail.sport_type || detail.type || "");
      const sportCat = /run|trailrun|virtualrun|treadmill/i.test(sportType) ? "Running" : "Cycling";
      segmentEfforts = rawEfforts.slice(0, 40).map((se) => {
        const dist = Math.round(Number(se.distance || se.segment?.distance || 0));
        const elTime = Number(se.elapsed_time || 0);
        const sIdx = typeof se.start_index === "number" ? se.start_index : void 0;
        const eIdx = typeof se.end_index === "number" ? se.end_index : void 0;
        let pathLatLngs;
        if (rawLatLng && sIdx !== void 0 && eIdx !== void 0 && rawLatLng.length > eIdx) {
          const segStep = Math.max(1, Math.floor((eIdx - sIdx + 1) / 36));
          const pts = [];
          for (let k = sIdx; k <= eIdx; k += segStep) {
            const p = rawLatLng[k];
            if (Array.isArray(p) && p.length === 2 && Math.abs(p[0]) > 0.01) {
              pts.push([Number(Number(p[0]).toFixed(5)), Number(Number(p[1]).toFixed(5))]);
            }
          }
          if (pts.length >= 2) pathLatLngs = pts;
        }
        const effortId = extractStravaId(se);
        return {
          id: effortId,
          segmentId: extractStravaId(se.segment) || effortId,
          name: String(se.name || se.segment?.name || "Segment"),
          sportCategory: sportCat,
          distanceMeters: dist,
          averageGradePct: Number(se.segment?.average_grade ?? 0),
          elapsedTimeSecs: elTime,
          movingTimeSecs: Number(se.moving_time || elTime),
          avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : void 0,
          avgPaceSecsPerKm: sportCat === "Running" && dist > 0 && elTime > 0 ? Math.round(elTime / (dist / 1e3)) : void 0,
          avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : void 0,
          prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
          komRank: typeof se.kom_rank === "number" ? se.kom_rank : null,
          startDateLocal: String(se.start_date_local || detail.start_date_local || ""),
          activityId: resolvedActivityId,
          activityName: String(detail.name || ""),
          startIndex: sIdx,
          endIndex: eIdx,
          startLatLng: pathLatLngs?.[0],
          endLatLng: pathLatLngs?.[pathLatLngs.length - 1],
          pathLatLngs
        };
      });
    }
    let kudoers;
    if (kudosResp.ok) {
      const rawKudos = await readStravaResponseJson(kudosResp);
      if (Array.isArray(rawKudos)) {
        kudoers = rawKudos.map((k) => ({
          firstname: String(k.firstname || "Athlete"),
          lastname: String(k.lastname || ""),
          profileMedium: k.profile_medium || k.profile || void 0,
          city: k.city || void 0,
          state: k.state || void 0,
          country: k.country || void 0
        }));
      }
    }
    await saveSessionCacheAsync(req, res);
    res.json({
      streams: {
        time: downsample(raw?.time?.data) || [],
        distance: downsample(raw?.distance?.data),
        latlng: downsampledLatLng,
        watts: downsample(raw?.watts?.data),
        heartrate: downsample(raw?.heartrate?.data),
        velocitySmooth: downsample(raw?.velocity_smooth?.data),
        cadence: downsample(raw?.cadence?.data),
        altitude: downsample(raw?.altitude?.data)
      },
      segmentEfforts,
      kudoers,
      stravaTokens: getStravaTokenRotationPayload(req)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load Strava activity streams"
    });
  }
});
stravaRouter.get("/api/strava/activities/:id/kudos", async (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const scopedKudosFile = `/tmp/thresh-strava-kudos-${scopeKey}.json`;
    const activityId = String(req.params.id);
    const stravaId = String(req.query.stravaId || activityId).replace(/^strava-/, "");
    const kudosCache = loadJsonFile(scopedKudosFile, {});
    const activeAccessToken = await ensureValidStravaAccessToken(req, false);
    if (activeAccessToken && /^\d+$/.test(stravaId)) {
      const headers = { Authorization: `Bearer ${activeAccessToken}` };
      const [kResp, cResp] = await Promise.all([
        fetch(
          `https://www.strava.com/api/v3/activities/${encodeURIComponent(stravaId)}/kudos?per_page=100`,
          { headers }
        ),
        fetch(
          `https://www.strava.com/api/v3/activities/${encodeURIComponent(stravaId)}/comments?per_page=50`,
          { headers }
        )
      ]);
      if (kResp.ok) {
        const rawKudos = await readStravaResponseJson(kResp);
        const kudoers = Array.isArray(rawKudos) ? rawKudos.map((k) => ({
          firstname: String(k.firstname || "Athlete"),
          lastname: String(k.lastname || ""),
          profileMedium: k.profile_medium || k.profile || void 0,
          city: k.city || void 0,
          state: k.state || void 0,
          country: k.country || void 0
        })) : [];
        const existing = kudosCache[activityId] || kudosCache[stravaId] || {};
        let mergedComments = existing.comments || [];
        if (cResp.ok) {
          const rawComments = await readStravaResponseJson(cResp);
          if (Array.isArray(rawComments)) {
            const remoteComments = rawComments.map((c, idx) => ({
              id: extractStravaId(c) || `sc-${stravaId}-${idx}`,
              text: String(c.text || ""),
              createdAt: String(c.created_at || (/* @__PURE__ */ new Date()).toISOString()),
              athleteName: [c.athlete?.firstname, c.athlete?.lastname].filter(Boolean).join(" ") || "Strava Athlete",
              avatarUrl: c.athlete?.profile_medium || void 0
            }));
            const seenIds = new Set(mergedComments.map((mc) => mc.id));
            mergedComments = [
              ...mergedComments,
              ...remoteComments.filter((rc) => !seenIds.has(rc.id))
            ];
          }
        }
        const updatedEntry = {
          ...existing,
          kudosCount: Math.max(existing.kudosCount || 0, kudoers.length + (existing.hasKudoed ? 1 : 0)),
          kudoers,
          comments: mergedComments
        };
        kudosCache[activityId] = updatedEntry;
        kudosCache[stravaId] = updatedEntry;
        saveJsonFile(scopedKudosFile, kudosCache);
      }
    }
    const entry = kudosCache[activityId] || kudosCache[stravaId] || {};
    await saveSessionCacheAsync(req, res);
    res.json({
      kudosCount: entry.kudosCount || 0,
      hasKudoed: Boolean(entry.hasKudoed),
      kudoers: entry.kudoers || [],
      comments: entry.comments || [],
      stravaTokens: getStravaTokenRotationPayload(req)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch Strava kudos"
    });
  }
});
stravaRouter.post("/api/activities/:id/kudos", (req, res) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const scopedKudosFile = `/tmp/thresh-strava-kudos-${scopeKey}.json`;
    const activityId = String(req.params.id);
    const { action = "toggle_kudos", commentText, athleteName } = req.body || {};
    const kudosCache = loadJsonFile(scopedKudosFile, {});
    const current = kudosCache[activityId] || {
      kudosCount: Number(req.body?.currentKudosCount || 0),
      hasKudoed: false,
      kudoers: [],
      comments: []
    };
    const resolvedName = req.body?.authorName || athleteName || "THRESH Athlete";
    const [first, ...rest] = String(resolvedName).trim().split(" ");
    const last = rest.join(" ") || "";
    if ((action === "comment" || action === "add_comment") && commentText && String(commentText).trim()) {
      const newComment = {
        id: `comment-${Date.now()}`,
        text: String(commentText).trim(),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        athleteName: resolvedName,
        authorName: resolvedName
      };
      current.comments = [...current.comments || [], newComment];
    } else {
      const nextKudoed = !current.hasKudoed;
      current.hasKudoed = nextKudoed;
      const baseCount = Math.max(0, Number(current.kudosCount || 0));
      current.kudosCount = nextKudoed ? baseCount + 1 : Math.max(0, baseCount - 1);
      const existingKudoers = Array.isArray(current.kudoers) ? [...current.kudoers] : [];
      if (nextKudoed) {
        if (!existingKudoers.some((k) => k.firstname === first && k.lastname === last)) {
          existingKudoers.unshift({
            firstname: first,
            lastname: last,
            city: "THRESH Club"
          });
        }
      } else {
        const idx = existingKudoers.findIndex((k) => k.firstname === first && k.lastname === last);
        if (idx >= 0) existingKudoers.splice(idx, 1);
      }
      current.kudoers = existingKudoers;
    }
    kudosCache[activityId] = current;
    saveJsonFile(scopedKudosFile, kudosCache);
    res.json({
      activityId,
      kudosCount: current.kudosCount || 0,
      hasKudoed: Boolean(current.hasKudoed),
      kudoers: current.kudoers || [],
      comments: current.comments || []
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update activity kudos"
    });
  }
});

// server/routers/intervalsRouter.ts
function getEffectiveIntervalsConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return { apiKey: "", accessToken: "", athleteId: "0", scope: "" };
  }
  const allowEnvFallback = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  const headerKey = activeReq?.headers["x-intervals-api-key"] || "";
  const headerToken = activeReq?.headers["x-intervals-access-token"] || "";
  const headerAthlete = activeReq?.headers["x-intervals-athlete-id"] || "";
  const apiKey = (headerKey || runtimeStore.intervalsApiKey || (allowEnvFallback ? process.env.INTERVALS_API_KEY : "") || "").trim();
  const accessToken = (headerToken || runtimeStore.intervalsAccessToken || "").trim();
  const athleteId = (headerAthlete || runtimeStore.intervalsAthleteId || (allowEnvFallback ? process.env.INTERVALS_ATHLETE_ID : "") || "0").trim() || "0";
  const scope = runtimeStore.intervalsScope || "";
  return { apiKey, accessToken, athleteId, scope };
}
function getIntervalsAuthHeader(config) {
  if (config.accessToken) {
    return `Bearer ${config.accessToken}`;
  }
  if (config.apiKey) {
    return `Basic ${Buffer.from(`API_KEY:${config.apiKey}`).toString("base64")}`;
  }
  return null;
}
function getEffectiveIntervalsClientConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = activeReq?.headers["x-intervals-client-id"] || "";
  const headerClientSecret = activeReq?.headers["x-intervals-client-secret"] || "";
  const clientId = (headerClientId || process.env.INTERVALS_CLIENT_ID || "").trim();
  const clientSecret = (headerClientSecret || process.env.INTERVALS_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}
var intervalsIdentityByKey = /* @__PURE__ */ new Map();
async function resolveIntervalsAthleteIdentity(req) {
  const config = getEffectiveIntervalsConfig(req);
  const authHeader = getIntervalsAuthHeader(config);
  if (!authHeader) return null;
  const cacheKey = config.accessToken ? `tok_${config.accessToken.slice(-10)}` : `key_${config.apiKey}`;
  const cached = intervalsIdentityByKey.get(cacheKey);
  if (cached && !isGenericName(cached.athleteName)) {
    return cached;
  }
  try {
    const resp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(config.athleteId || "0")}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    );
    if (!resp.ok) return null;
    const rawProfile = await resp.json();
    const resolvedId = String(rawProfile.id || config.athleteId || "0");
    const fullName = String(rawProfile.name || "").trim() || [rawProfile.firstname, rawProfile.lastname].filter(Boolean).join(" ").trim() || "";
    if (fullName && !isGenericName(fullName)) {
      runtimeStore.intervalsAthleteName = fullName;
      saveSessionCache();
    }
    const entry = {
      athleteId: resolvedId,
      athleteName: fullName,
      rawProfile
    };
    intervalsIdentityByKey.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}
function rankSegmentEffortsAcrossActivities(activities) {
  const bySegmentId = /* @__PURE__ */ new Map();
  for (const act of activities) {
    if (!Array.isArray(act.segmentEfforts)) continue;
    for (const eff of act.segmentEfforts) {
      if (!eff || !eff.segmentId || !(eff.elapsedTimeSecs > 0)) continue;
      const sid = String(eff.segmentId);
      const list = bySegmentId.get(sid) || [];
      list.push(eff);
      bySegmentId.set(sid, list);
    }
  }
  for (const list of bySegmentId.values()) {
    list.sort((a, b) => a.elapsedTimeSecs - b.elapsedTimeSecs);
    list.forEach((eff, idx) => {
      if (idx === 0) eff.prRank = 1;
      else if (idx === 1) eff.prRank = 2;
      else if (idx === 2) eff.prRank = 3;
      else eff.prRank = null;
    });
  }
  for (const act of activities) {
    if (Array.isArray(act.segmentEfforts) && act.segmentEfforts.length > 0) {
      const prCount = act.segmentEfforts.filter((e) => e.prRank === 1).length;
      if (prCount > (act.stravaPrCount || 0)) {
        act.stravaPrCount = prCount;
      }
    }
  }
}
async function syncIntervalsAllHistory(configOrKey, maybeAthleteId = "0", oldestActivitiesDate = "2010-01-01") {
  let authHeader;
  let athleteId;
  if (typeof configOrKey === "string") {
    authHeader = "Basic " + Buffer.from(`API_KEY:${configOrKey}`).toString("base64");
    athleteId = maybeAthleteId || "0";
  } else {
    const header = getIntervalsAuthHeader(configOrKey);
    if (!header) {
      throw new Error(
        "Intervals.icu authentication header could not be constructed (missing API key or access token)."
      );
    }
    authHeader = header;
    athleteId = configOrKey.athleteId || maybeAthleteId || "0";
  }
  const now = /* @__PURE__ */ new Date();
  const newest = new Date(now.getTime() + 86400 * 1e3).toISOString().slice(0, 10);
  const futureEventsDate = new Date(now);
  futureEventsDate.setUTCDate(futureEventsDate.getUTCDate() + 90);
  const newestEvents = futureEventsDate.toISOString().slice(0, 10);
  const oldestEventsDate = new Date(now);
  oldestEventsDate.setUTCDate(oldestEventsDate.getUTCDate() - 180);
  const oldestEvents = oldestEventsDate.toISOString().slice(0, 10);
  const safeOldestActs = /^\d{4}-\d{2}-\d{2}$/.test(oldestActivitiesDate) ? oldestActivitiesDate : "2010-01-01";
  const isDeltaSync = safeOldestActs > "2020-01-01";
  const oldestWellness = isDeltaSync ? "2024-01-01" : "2018-01-01";
  const [profileResp, wellnessResp, activitiesResp, eventsResp] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
      headers: { Authorization: authHeader, Accept: "application/json" }
    }),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldestWellness}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${safeOldestActs}&newest=${newest}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    ),
    fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events?oldest=${oldestEvents}&newest=${newestEvents}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    )
  ]);
  if (!wellnessResp.ok || !activitiesResp.ok) {
    throw new Error(
      `Intervals.icu sync returned status wellness=${wellnessResp.status}, activities=${activitiesResp.status}`
    );
  }
  let parsedRawProfile = null;
  if (profileResp.ok) {
    const profile = await profileResp.json();
    parsedRawProfile = profile;
    runtimeStore.intervalsAthleteName = profile.name || [profile.firstname, profile.lastname].filter(Boolean).join(" ") || runtimeStore.intervalsAthleteName;
    if (Array.isArray(profile.sportSettings)) {
      const bikeSetting = profile.sportSettings.find(
        (s) => Array.isArray(s.types) && s.types.includes("Ride")
      );
      const runSetting = profile.sportSettings.find(
        (s) => Array.isArray(s.types) && s.types.includes("Run")
      );
      if (bikeSetting) {
        if (bikeSetting.ftp) runtimeStore.athleteFtp = Number(bikeSetting.ftp);
        if (bikeSetting.indoor_ftp) runtimeStore.athleteIndoorFtp = Number(bikeSetting.indoor_ftp);
        if (bikeSetting.lthr) runtimeStore.athleteLthr = Number(bikeSetting.lthr);
        if (bikeSetting.max_hr) runtimeStore.athleteMaxHr = Number(bikeSetting.max_hr);
      }
      if (runSetting && runSetting.ftp) {
        runtimeStore.athleteRunFtp = Number(runSetting.ftp);
      }
    }
    const bikes = Array.isArray(profile.bikes) ? profile.bikes.map((b) => ({
      id: String(b.id),
      name: String(b.name || "Road Bike"),
      type: "BIKE",
      distanceMeters: Number(b.distance || 0),
      maxRecommendedMeters: 8046720,
      // 5,000 mi chain/service interval
      primary: Boolean(b.primary)
    })) : [];
    const shoes = Array.isArray(profile.shoes) ? profile.shoes.map((s) => ({
      id: String(s.id),
      name: String(s.name || "Running Shoe"),
      type: "SHOE",
      distanceMeters: Number(s.distance || 0),
      maxRecommendedMeters: 724205,
      // 450 mi shoe retirement threshold
      primary: Boolean(s.primary)
    })) : [];
    if (bikes.length > 0 || shoes.length > 0) {
      runtimeStore.gearItems = [...bikes, ...shoes];
    }
  }
  const rawWellnessAll = await wellnessResp.json();
  const rawActivities = await activitiesResp.json();
  const rawEvents = eventsResp.ok ? await eventsResp.json() : [];
  const rawWellness = rawWellnessAll.filter((w, i, a) => {
    const d = w?.id || w?.date;
    if (!d || d > newest) return false;
    if (i === a.length - 1 || d === newest) {
      const hasAnyTelemetry = w.sleepSecs != null || w.hrv != null || w.restingHR != null || w.steps != null;
      if (!hasAnyTelemetry && d >= newest) return false;
    }
    return true;
  });
  const redactedStravaCount = rawActivities.filter(
    (a) => a && a.source === "STRAVA" && !a.type && a.moving_time == null
  ).length;
  let lastValidWeight = Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight || 0) > 30 ? Number(Number(parsedRawProfile?.icu_weight || parsedRawProfile?.weight).toFixed(1)) : 70;
  let lastValidVo2 = 50;
  let lastValidRhr = Number(parsedRawProfile?.icu_resting_hr || 0) > 25 ? Math.round(Number(parsedRawProfile?.icu_resting_hr)) : 49;
  const wellnessDays = rawWellness.map((w, idx, arr) => {
    const ctl = Number((w.ctl ?? 0).toFixed(1));
    const atl = Number((w.atl ?? 0).toFixed(1));
    const tsb = Number((ctl - atl).toFixed(1));
    const loadRatio = ctl > 5 ? Number((atl / ctl).toFixed(2)) : 1;
    const rampRate = Number((w.rampRate ?? 0).toFixed(1));
    const hrv = Math.round(w.hrv ?? w.hrvRMSSD ?? 0);
    const slice7 = arr.slice(Math.max(0, idx - 6), idx + 1).map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0)).filter((v) => v > 0);
    const baseline7d = slice7.length > 0 ? slice7.reduce((a, b) => a + b, 0) / slice7.length : hrv;
    const slice60 = arr.slice(Math.max(0, idx - 59), idx + 1).map((item) => Number(item.hrv ?? item.hrvRMSSD ?? 0)).filter((v) => v > 0);
    const mean60 = slice60.length > 0 ? slice60.reduce((a, b) => a + b, 0) / slice60.length : baseline7d || 52;
    const variance60 = slice60.length > 1 ? slice60.reduce((acc, v) => acc + Math.pow(v - mean60, 2), 0) / slice60.length : 36;
    const sd60 = Math.max(4, Math.sqrt(variance60));
    const hrvNormalBandLow = Math.round(mean60 - 0.85 * sd60);
    const hrvNormalBandHigh = Math.round(mean60 + 0.85 * sd60);
    let hrvStatus = "Balanced";
    const checkHrv = baseline7d || hrv;
    if (checkHrv > 0) {
      if (checkHrv < hrvNormalBandLow - 3 || hrv > 0 && hrv < hrvNormalBandLow - 5) {
        hrvStatus = "Low";
      } else if (checkHrv < hrvNormalBandLow || checkHrv > hrvNormalBandHigh + 4) {
        hrvStatus = "Unbalanced";
      }
    }
    if (w.restingHR && Number(w.restingHR) > 0) lastValidRhr = Math.round(Number(w.restingHR));
    if (w.weight && Number(w.weight) > 0) lastValidWeight = Number(Number(w.weight).toFixed(1));
    if (w.vo2max && Number(w.vo2max) > 0) lastValidVo2 = Number(w.vo2max);
    const sleepSecs = Number(w.sleepSecs ?? 0);
    const sleepScore = Number(
      w.sleepScore ?? (sleepSecs > 0 ? Math.min(98, Math.round(sleepSecs / 28800 * 85)) : 0)
    );
    const sleepQuality = w.sleepQuality != null ? Number(w.sleepQuality) : void 0;
    const sleepSlice7 = arr.slice(Math.max(0, idx - 6), idx + 1).map((item) => Number(item.sleepSecs ?? 0)).filter((s) => s > 0);
    const sleepDebt7dSecs = sleepSlice7.length > 0 ? Math.max(
      0,
      Math.round(sleepSlice7.reduce((acc, s) => acc + Math.max(0, 27e3 - s), 0))
    ) : 0;
    const rideSport = Array.isArray(w.sportInfo) ? w.sportInfo.find((s) => s.type === "Ride") : void 0;
    const runSport = Array.isArray(w.sportInfo) ? w.sportInfo.find((s) => s.type === "Run") : void 0;
    const rideEftp = rideSport?.eftp ? Math.round(Number(rideSport.eftp)) : void 0;
    const rideWPrime = rideSport?.wPrime ? Math.round(Number(rideSport.wPrime)) : void 0;
    const ridePMax = rideSport?.pMax ? Math.round(Number(rideSport.pMax)) : void 0;
    const runEftp = runSport?.eftp ? Math.round(Number(runSport.eftp)) : void 0;
    const runWPrime = runSport?.wPrime ? Math.round(Number(runSport.wPrime)) : void 0;
    const runPMax = runSport?.pMax ? Math.round(Number(runSport.pMax)) : void 0;
    const prev28 = arr[Math.max(0, idx - 28)];
    const prevCtl = prev28 ? Number(prev28.ctl ?? ctl) : ctl;
    const ctlDelta28 = ctl - prevCtl;
    let garminTrainingStatus = "Maintaining";
    let trainingStatusReason = "Balanced acute-to-chronic workload and stable autonomic baseline.";
    if (loadRatio > 1.45 && (hrvStatus === "Low" || tsb < -22)) {
      garminTrainingStatus = "Overreaching";
      trainingStatusReason = `Very high acute load ratio (${loadRatio}x) with suppressed TSB (${tsb}) and HRV.`;
    } else if (hrvStatus === "Low" && (sleepScore > 0 && sleepScore < 72 || tsb < -12)) {
      garminTrainingStatus = "Strained";
      trainingStatusReason = `HRV (${hrv || Math.round(baseline7d)} ms) is below normal corridor (${hrvNormalBandLow}\u2013${hrvNormalBandHigh} ms) with elevated fatigue.`;
    } else if (ctl > 45 && tsb >= 4 && tsb <= 20 && rampRate < 0 && hrvStatus === "Balanced") {
      garminTrainingStatus = "Peaking";
      trainingStatusReason = `High aerobic base (CTL ${ctl}) paired with fresh positive form (TSB +${tsb}) and balanced HRV.`;
    } else if ((rampRate >= 0.4 || ctlDelta28 >= 1.5 || loadRatio >= 0.85 && loadRatio <= 1.3) && hrvStatus !== "Low") {
      garminTrainingStatus = "Productive";
      trainingStatusReason = `Optimal load ratio (${loadRatio}x) building aerobic fitness (CTL ${ctl}) with ${hrvStatus.toLowerCase()} HRV.`;
    } else if (loadRatio < 0.78 && tsb > 0 && ctlDelta28 >= -3) {
      garminTrainingStatus = "Recovery";
      trainingStatusReason = `Reduced acute training load (${loadRatio}x) allowing supercompensation and freshness.`;
    } else if (rampRate < -3.5 && ctlDelta28 < -4 && loadRatio < 0.7) {
      garminTrainingStatus = "Detraining";
      trainingStatusReason = `Sustained reduction in training load (Ramp ${rampRate}/wk) lowering chronic fitness.`;
    } else if (loadRatio > 1.15 && hrvStatus === "Unbalanced") {
      garminTrainingStatus = "Unproductive";
      trainingStatusReason = `High workload (${loadRatio}x) accompanied by unbalanced autonomic recovery.`;
    }
    let readinessStatus = "Optimal";
    if (garminTrainingStatus === "Strained" || garminTrainingStatus === "Overreaching" || tsb < -18 || hrvStatus === "Low") {
      readinessStatus = "Strain";
    } else if (garminTrainingStatus === "Unproductive" || tsb < -10 || hrvStatus === "Unbalanced" || sleepScore > 0 && sleepScore < 70) {
      readinessStatus = "Caution";
    }
    return {
      date: w.id || w.date || newest,
      ctl,
      atl,
      tsb,
      loadRatio,
      rampRate,
      hrvRMSSD: hrv,
      hrvBaseline7d: Math.round(baseline7d),
      hrvNormalBandLow,
      hrvNormalBandHigh,
      hrvStatus,
      restingHR: w.restingHR ? Math.round(Number(w.restingHR)) : lastValidRhr,
      sleepSecs,
      sleepScore,
      sleepQuality,
      sleepDebt7dSecs,
      weightKg: w.weight ? Number(Number(w.weight).toFixed(1)) : lastValidWeight,
      vo2MaxCycling: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      vo2MaxRunning: w.vo2max ? Number(w.vo2max) : lastValidVo2,
      spO2: w.spO2 ? Number(w.spO2) : void 0,
      respiration: w.respiration ? Number(w.respiration) : void 0,
      steps: w.steps != null ? Number(w.steps) : void 0,
      floorsClimbed: w.floorsClimbed != null ? Number(w.floorsClimbed) : void 0,
      soreness: w.soreness ?? void 0,
      rideEftp,
      rideWPrime,
      ridePMax,
      runEftp,
      runWPrime,
      runPMax,
      garminTrainingStatus,
      trainingStatusReason,
      readinessStatus,
      dailyLoad: Math.round(w.ctlLoad ?? w.atlLoad ?? 0)
    };
  });
  const icuStravaAthleteId = String(parsedRawProfile?.strava_id || "").replace(/[^0-9]/g, "");
  const cachedStravaArchive = icuStravaAthleteId ? loadJsonFile(
    `/tmp/aeropulse-strava-archive-${icuStravaAthleteId}.json`,
    []
  ) : [];
  const stravaArchiveById = /* @__PURE__ */ new Map();
  for (const sa of cachedStravaArchive) {
    if (sa && sa.id) stravaArchiveById.set(String(sa.id), sa);
  }
  const garminStravaIds = /* @__PURE__ */ new Set();
  const knownGarminLoadByDate = /* @__PURE__ */ new Map();
  const stubsByDate = /* @__PURE__ */ new Map();
  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    const d = String(a.start_date_local).slice(0, 10);
    if (a.source !== "STRAVA" && a.strava_id) {
      garminStravaIds.add(String(a.strava_id));
    }
    if (a.type || a.moving_time != null || a.elapsed_time != null) {
      knownGarminLoadByDate.set(
        d,
        (knownGarminLoadByDate.get(d) || 0) + Number(a.icu_training_load ?? 0)
      );
    } else if (a.source === "STRAVA") {
      const list = stubsByDate.get(d) || [];
      list.push(a);
      stubsByDate.set(d, list);
    }
  }
  const enrichedRawActivities = [];
  for (const a of rawActivities) {
    if (!a || !a.start_date_local) continue;
    if (a.source === "STRAVA" && !a.type && a.moving_time == null && a.elapsed_time == null) {
      const sid = String(a.strava_id || a.id);
      if (garminStravaIds.has(sid)) continue;
      const cachedSa = stravaArchiveById.get(sid);
      if (cachedSa && (cachedSa.moving_time || cachedSa.elapsed_time)) {
        enrichedRawActivities.push({
          ...a,
          id: `strava-${sid}`,
          strava_id: sid,
          type: cachedSa.sport_type || cachedSa.type || "Ride",
          name: cachedSa.name || "Recorded Session",
          moving_time: cachedSa.moving_time || cachedSa.elapsed_time,
          elapsed_time: cachedSa.elapsed_time || cachedSa.moving_time,
          distance: cachedSa.distance ?? 0,
          total_elevation_gain: cachedSa.total_elevation_gain ?? 0,
          trainer: Boolean(cachedSa.trainer),
          average_watts: cachedSa.average_watts,
          icu_weighted_avg_watts: cachedSa.weighted_average_watts || cachedSa.average_watts,
          average_heartrate: cachedSa.average_heartrate,
          max_heartrate: cachedSa.max_heartrate,
          average_cadence: cachedSa.average_cadence,
          device_name: cachedSa.device_name || void 0
        });
      }
      continue;
    }
    enrichedRawActivities.push(a);
  }
  const seenStravaIds = /* @__PURE__ */ new Set();
  const activities = enrichedRawActivities.filter((a) => {
    if (!a || !a.start_date_local) return false;
    if (!a.type && a.moving_time == null && a.elapsed_time == null) return false;
    if (a.source === "STRAVA" && !a.name && a.moving_time == null) return false;
    const duration = Number(a.moving_time ?? a.elapsed_time ?? 0);
    if (duration <= 0) return false;
    if (a.strava_id) {
      const sid = String(a.strava_id);
      if (seenStravaIds.has(sid)) return false;
      seenStravaIds.add(sid);
    }
    return true;
  }).map((a) => {
    const rawType = String(a.type || "").trim();
    const rawSubType = String(a.sub_type || "").trim();
    const rawName = String(a.name || "").trim();
    const rawDevice = String(a.device_name || "").trim();
    const combinedMeta = `${rawType} ${rawSubType} ${rawName} ${rawDevice}`;
    const rawStartLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length >= 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : void 0;
    const isWatopiaOrMakuriGps = rawStartLatLng && Number.isFinite(rawStartLatLng[0]) && Number.isFinite(rawStartLatLng[1]) && rawStartLatLng[0] >= -12.6 && rawStartLatLng[0] <= -9.8 && rawStartLatLng[1] >= 164.8 && rawStartLatLng[1] <= 168;
    const hasNoLatLngStream = Array.isArray(a.stream_types) && a.stream_types.length > 0 && !a.stream_types.includes("latlng");
    const isVirtualPlatform = /virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
      combinedMeta
    ) || Boolean(isWatopiaOrMakuriGps);
    const classified = classifyMultiSportActivity(rawType || rawSubType, `${rawSubType} ${rawName}`, {
      trainer: Boolean(a.trainer) || isVirtualPlatform || /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga|pool/i.test(combinedMeta),
      hasGps: Boolean(rawStartLatLng) && !hasNoLatLngStream,
      isVirtualPlatform
    });
    const sportCategory = classified.sportCategory;
    const isIndoor = classified.environment === "INDOOR";
    const subType = classified.subType;
    const movingTimeSecs = Number(a.moving_time ?? a.elapsed_time ?? 0);
    const distanceMeters = Number(a.distance ?? 0);
    const avgPower = a.icu_average_watts ?? a.average_watts ?? void 0;
    const normalizedPower = a.icu_weighted_avg_watts ?? avgPower;
    const avgHr = Number(a.average_heartrate ?? 0);
    const maxHr = Number(a.max_heartrate ?? 0);
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
    const gapPaceSecsPerKm = sportCategory === "Running" && a.gap && Number(a.gap) > 0 ? Math.round(1e3 / Number(a.gap)) : void 0;
    const canUsePowerForIf = sportCategory === "Cycling" || sportCategory === "Running" && Number(runtimeStore.athleteRunFtp) > 0;
    const userFtp = sportCategory === "Running" ? runtimeStore.athleteRunFtp || 350 : runtimeStore.athleteFtp || 250;
    const rawIcuIf = Number(a.icu_intensity ?? 0);
    let trainingLoad = Math.round(Number(a.icu_training_load ?? 0));
    let intensityFactor = rawIcuIf > 0 ? Number((rawIcuIf > 3 ? rawIcuIf / 100 : rawIcuIf).toFixed(2)) : void 0;
    if (canUsePowerForIf && normalizedPower && movingTimeSecs > 0) {
      const ifVal = normalizedPower / userFtp;
      if (!intensityFactor) {
        intensityFactor = Number(ifVal.toFixed(2));
      }
      if (!trainingLoad) {
        trainingLoad = Math.round(
          movingTimeSecs * normalizedPower * ifVal / (userFtp * 3600) * 100
        );
      }
    } else if (avgHr > 0 && movingTimeSecs > 0) {
      const userLthr = runtimeStore.athleteLthr || 165;
      const hrRatio = Math.max(0.4, Math.min(1.25, avgHr / userLthr));
      if (!intensityFactor) {
        intensityFactor = Number(hrRatio.toFixed(2));
      }
      if (!trainingLoad) {
        trainingLoad = Math.round(movingTimeSecs / 3600 * Math.pow(hrRatio, 2) * 80);
      }
    } else if (!trainingLoad && movingTimeSecs > 0) {
      trainingLoad = Math.round(movingTimeSecs / 3600 * 45);
    }
    let efficiencyFactor = 0;
    if (sportCategory === "Cycling" && normalizedPower && avgHr > 0) {
      efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
    } else if (sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 && avgHr > 0) {
      const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
      efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
    }
    const rawIntervals = Array.isArray(a.icu_intervals) ? a.icu_intervals : [];
    const intervals = rawIntervals.map((iv, idx) => {
      const dist = Number(iv.distance || 0);
      const dur = Number(iv.moving_time || iv.elapsed_time || 0);
      const avgSpeed = Number(iv.average_speed || 0);
      const gapSpeed = Number(iv.gap || avgSpeed);
      return {
        id: String(iv.id || `iv-${idx}`),
        type: iv.type === "WORK" ? "WORK" : "RECOVERY",
        label: iv.label || iv.group_id || (iv.type === "WORK" ? `Work Interval #${idx + 1}` : `Recovery #${idx + 1}`),
        startTimeSecs: Number(iv.start_time || 0),
        durationSecs: dur,
        distanceMeters: Math.round(dist),
        avgWatts: iv.average_watts ? Math.round(Number(iv.average_watts)) : void 0,
        weightedAvgWatts: iv.weighted_average_watts ? Math.round(Number(iv.weighted_average_watts)) : void 0,
        intensityPct: iv.intensity ? Math.round(Number(iv.intensity)) : void 0,
        zone: iv.zone ? Number(iv.zone) : void 0,
        avgHr: iv.average_heartrate ? Math.round(Number(iv.average_heartrate)) : void 0,
        maxHr: iv.max_heartrate ? Math.round(Number(iv.max_heartrate)) : void 0,
        avgPaceSecsPerKm: avgSpeed > 0 ? Math.round(1e3 / avgSpeed) : void 0,
        gapPaceSecsPerKm: gapSpeed > 0 ? Math.round(1e3 / gapSpeed) : void 0,
        avgCadence: iv.average_cadence ? Math.round(Number(iv.average_cadence)) : void 0,
        decouplingPct: iv.decoupling != null ? Number(Number(iv.decoupling).toFixed(1)) : void 0,
        strideLengthMeters: iv.average_stride ? Number(Number(iv.average_stride).toFixed(2)) : void 0
      };
    });
    const hrZoneSecs = Array.isArray(a.icu_hr_zone_times) ? a.icu_hr_zone_times.slice(0, 7).map((v) => Math.max(0, Math.round(Number(v || 0)))) : [0, 0, 0, 0, 0, 0, 0];
    const pwrZoneSecs = Array.isArray(a.icu_zone_times) ? a.icu_zone_times.slice(0, 7).map((v) => Math.max(0, Math.round(Number(v || 0)))) : void 0;
    const intervalsSourceBadges = Array.from(
      /* @__PURE__ */ new Set([
        "Intervals.icu",
        ...a.source === "GARMIN_CONNECT" ? ["Garmin"] : a.source === "STRAVA" ? ["Strava"] : []
      ])
    );
    const intervalsTimestamps = normalizeActivityTimestamps({
      startDateLocal: a.start_date_local ? stripTimezoneSuffix(String(a.start_date_local)) : void 0,
      startDateUtc: a.start_date ? String(a.start_date) : void 0,
      startLatLng: Array.isArray(a.latlng) && a.latlng.length === 2 ? [Number(a.latlng[0]), Number(a.latlng[1])] : void 0,
      fallbackBrowserTz: true
    });
    return {
      id: String(a.id),
      intervalsId: String(a.id),
      intervalsActivityId: String(a.id),
      stravaId: a.strava_id ? String(a.strava_id) : void 0,
      garminActivityId: a.source === "GARMIN_CONNECT" ? String(a.id) : void 0,
      source: a.source || "INTERVALS_ICU",
      sourceBadges: intervalsSourceBadges,
      rawSportType: rawType || void 0,
      name: rawName || `${subType} ${sportCategory}`,
      startDateLocal: intervalsTimestamps.startDateLocal,
      ...intervalsTimestamps.startDateUtcMs !== void 0 ? { startDateUtcMs: intervalsTimestamps.startDateUtcMs } : {},
      sportCategory,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      subType,
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
      avgPower: avgPower ? Math.round(avgPower) : void 0,
      normalizedPower: normalizedPower ? Math.round(normalizedPower) : void 0,
      intensityFactor,
      trainingLoad,
      avgHr: avgHr > 0 ? Math.round(avgHr) : void 0,
      maxHr: maxHr > 0 ? Math.round(maxHr) : void 0,
      avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : void 0,
      avgPaceSecsPerKm,
      gapPaceSecsPerKm,
      efficiencyFactor,
      aerobicDecouplingPct: a.decoupling != null ? Number(Number(a.decoupling).toFixed(1)) : void 0,
      variabilityIndex: normalizedPower && avgPower && avgPower > 0 ? Number((normalizedPower / avgPower).toFixed(2)) : void 0,
      zoneSecs: {
        hr: hrZoneSecs,
        ...pwrZoneSecs ? { power: pwrZoneSecs } : {}
      },
      gearName: a.gear?.name || void 0,
      deviceName: a.device_name ? String(a.device_name) : void 0,
      hasSegments: Boolean(a.has_segments),
      intervals
    };
  });
  const segmentsCache = loadJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, {});
  const routesCache = loadJsonFile(
    ROUTES_BY_ACTIVITY_CACHE_FILE,
    {}
  );
  const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
  for (const act of activities) {
    if (Array.isArray(segmentsCache[act.id]) && segmentsCache[act.id].length > 0) {
      act.segmentEfforts = segmentsCache[act.id].map((eff) => ({ ...eff }));
    }
    const routePts = routesCache[act.id];
    if (Array.isArray(routePts) && routePts.length >= 2) {
      act.routeLatLngs = routePts;
      act.startLatLng = routePts[0];
      act.endLatLng = routePts[routePts.length - 1];
      const [firstLat, firstLng] = routePts[0];
      if (act.sportCategory === "Cycling" && firstLat >= -12.6 && firstLat <= -9.8 && firstLng >= 164.8 && firstLng <= 168) {
        act.environment = "INDOOR";
        act.subType = "Virtual Cycling";
      }
    }
    const kEntry = kudosCache[act.id] || (act.stravaId ? kudosCache[act.stravaId] : void 0);
    if (kEntry) {
      if (kEntry.kudosCount !== void 0) act.kudosCount = kEntry.kudosCount;
      if (kEntry.hasKudoed !== void 0) act.hasKudoed = kEntry.hasKudoed;
      if (Array.isArray(kEntry.kudoers)) act.kudoers = kEntry.kudoers;
      if (Array.isArray(kEntry.comments)) {
        act.comments = kEntry.comments;
        act.commentCount = kEntry.comments.length;
      }
    }
  }
  rankSegmentEffortsAcrossActivities(activities);
  const cacheKey = typeof configOrKey === "string" ? configOrKey : configOrKey.apiKey || configOrKey.accessToken || "default";
  const scopedPlannedFile = getScopedPlannedEventsFile(void 0, cacheKey);
  const localPlanned = scopedPlannedFile ? loadJsonFile(scopedPlannedFile, []) : [];
  const icuPlanned = rawEvents.filter((ev) => ev && ev.start_date_local).map((ev) => {
    const dur = Number(ev.moving_time ?? 3600);
    const desc = String(ev.description || "");
    return {
      id: `icu-ev-${ev.id}`,
      date: String(ev.start_date_local).slice(0, 10),
      name: String(ev.name || "Planned Workout"),
      sportCategory: /run/i.test(String(ev.type || "")) ? "Running" : "Cycling",
      environmentPreference: /indoor|virtual|trainer/i.test(String(ev.type || "") + desc) ? "INDOOR" : "FLEXIBLE",
      description: desc || "Structured workout synced from Intervals.icu calendar.",
      plannedLoad: Math.round(Number(ev.icu_training_load ?? 65)),
      plannedDurationSecs: dur,
      targetZoneSummary: "Intervals.icu Calendar Event",
      workoutSyntax: desc,
      structuredSteps: parseWorkoutSyntaxToSteps(desc, dur),
      source: "INTERVALS_ICU"
    };
  });
  const plannedEvents = [...localPlanned, ...icuPlanned];
  const stravaLinkedCount = activities.filter((a) => Boolean(a.stravaId)).length;
  runtimeStore.garminActivitiesCount = activities.length;
  runtimeStore.redactedStravaCount = redactedStravaCount;
  if (runtimeStore.stravaActivitiesCount < stravaLinkedCount) {
    runtimeStore.stravaActivitiesCount = stravaLinkedCount;
  }
  runtimeStore.totalActivitiesCount = Math.max(
    activities.length,
    activities.length + Math.max(0, runtimeStore.stravaActivitiesCount - stravaLinkedCount)
  );
  runtimeStore.earliestActivityDate = activities.length > 0 ? activities[activities.length - 1].startDateLocal.slice(0, 10) : runtimeStore.earliestActivityDate;
  const accumulatedWellnessSummary = {};
  for (const w of wellnessDays) {
    if (w.weightKg && w.weightKg > 30 && w.weightKg !== 70) {
      accumulatedWellnessSummary.weightKg = w.weightKg;
    }
    if (w.restingHR && w.restingHR > 25 && w.restingHR !== 49) {
      accumulatedWellnessSummary.restingHR = w.restingHR;
    }
    if (w.vo2MaxCycling && w.vo2MaxCycling > 25 && w.vo2MaxCycling !== 50) {
      accumulatedWellnessSummary.vo2MaxCycling = w.vo2MaxCycling;
    }
    if (w.vo2MaxRunning && w.vo2MaxRunning > 25 && w.vo2MaxRunning !== 50) {
      accumulatedWellnessSummary.vo2MaxRunning = w.vo2MaxRunning;
    }
    if (w.rideEftp && w.rideEftp > 60) accumulatedWellnessSummary.rideEftp = w.rideEftp;
    if (w.rideWPrime && w.rideWPrime > 5e3) accumulatedWellnessSummary.rideWPrime = w.rideWPrime;
    if (w.ridePMax && w.ridePMax > 300) accumulatedWellnessSummary.ridePMax = w.ridePMax;
    if (w.runEftp && w.runEftp > 80) accumulatedWellnessSummary.runEftp = w.runEftp;
  }
  const fullProfile = buildServerAthleteProfile(
    parsedRawProfile,
    accumulatedWellnessSummary,
    activities
  );
  runtimeStore.athleteProfile = fullProfile;
  runtimeStore.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1e3).toISOString();
  saveSessionCache();
  return {
    wellnessDays,
    activities,
    plannedEvents,
    redactedStravaCount,
    athleteProfile: {
      ...fullProfile,
      gearItems: runtimeStore.gearItems
    },
    syncedAt: runtimeStore.lastSyncedAt,
    nextHourlySyncAt: runtimeStore.nextHourlySyncAt
  };
}
var intervalsCallbackHandler = async (req, res) => {
  const code = String(req.query.code || "").trim();
  const error = String(req.query.error || "").trim();
  const stateToken = String(req.query.state || "").trim();
  const cookieNonce = getOAuthStateCookieNonce(req);
  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);
  if (error) {
    const errMsg = error === "access_denied" ? "Access was denied by the user on Intervals.icu." : error;
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "intervals",
      error: `Intervals.icu connection failed: ${errMsg}`
    });
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Intervals.icu Connection Error",
        heading: "Intervals.icu Connection Could Not Complete",
        accentColor: "#FB7185",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
    return;
  }
  if (!code) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Missing Authorization Code",
        heading: "Intervals.icu Authorization Code Missing",
        accentColor: "#FB7185",
        body: "No authorization code was returned by Intervals.icu.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Invalid OAuth State",
        heading: "Security Verification Failed",
        accentColor: "#FB7185",
        body: !verifiedState ? "OAuth state token was invalid or expired. Please re-initiate Intervals.icu connection." : "Browser OAuth verification cookie was missing or did not match. Please re-initiate Intervals.icu connection.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  try {
    const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        "Intervals.icu OAuth client credentials (INTERVALS_CLIENT_ID / INTERVALS_CLIENT_SECRET) are not configured."
      );
    }
    const tokenResp = await fetch("https://intervals.icu/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code
      }).toString()
    });
    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Intervals.icu token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }
    const tokenData = await tokenResp.json();
    const accessToken = String(tokenData.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Intervals.icu did not return a valid access token.");
    }
    const athleteId = String(tokenData.id || tokenData.athlete?.id || "0").trim();
    const athleteName = String(
      tokenData.name || tokenData.athlete?.name || [tokenData.firstname, tokenData.lastname].filter(Boolean).join(" ") || `Athlete ${athleteId}`
    ).trim();
    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.intervalsAccessToken = accessToken;
    store.intervalsScope = tokenData.scope || "ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ";
    store.intervalsAthleteId = athleteId;
    store.intervalsAthleteName = athleteName;
    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
      await connectServiceToUser(callerClaims.sub, "intervals", athleteId, athleteName);
    }
    const sessionToken = setSessionCookie(req, res, athleteName, sid, "verified");
    await saveSessionCacheAsync(req, res, sid);
    const oauthPayloadJson = safeJsonForScript({
      type: "OAUTH_AUTH_SUCCESS",
      provider: "intervals",
      athleteId,
      athleteName,
      sessionToken,
      scope: tokenData.scope,
      returnUrl: "/#fitness?openDataSources=1"
    });
    res.type("html").send(
      renderThreshOAuthHtml({
        title: "Intervals.icu Connected \xB7 THRESH",
        heading: `Intervals.icu Connected${athleteName && !isGenericName(athleteName) ? ` \xB7 ${escapeHtml(athleteName)}` : ""}`,
        accentColor: "#10B981",
        body: "Your Intervals.icu account is now linked via OAuth 2.0. Structured workouts, wellness metrics, and training data are ready to sync.",
        ctaLabel: "Continue to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_intervals_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_intervals_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_intervals_connected', '1');
            localStorage.removeItem('aeropulse_intervals_api_key');
            localStorage.setItem('aeropulse_oauth_just_connected', '1');
          } catch (e) {}
          var hasOpener = false;
          try {
            if (window.opener && window.opener !== window) {
              hasOpener = true;
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
          var isPopupWindow = hasOpener || window.name === 'aeropulse_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/#fitness?openDataSources=1');
          }
        })();`
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "intervals",
      error: `Intervals.icu connection failed: ${errMsg}`
    });
    res.status(500).type("html").send(
      renderThreshOAuthHtml({
        title: "Intervals.icu Connection Error",
        heading: "Intervals.icu Connection Failed",
        accentColor: "#FB7185",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
  }
};
var intervalsRouter = express7.Router();
intervalsRouter.post("/api/intervals/profile/sync", async (req, res) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(config);
    const athleteId = config.athleteId || "0";
    const stravaIdentity = await resolveStravaAthleteIdentity(req);
    const garminSession = getActiveGarminSession(req);
    if (!intervalsAuth) {
      const [garminDirect2, validStravaToken] = await Promise.all([
        garminSession ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null) : Promise.resolve(null),
        ensureValidStravaAccessToken(req, false)
      ]);
      if (validStravaToken || garminDirect2) {
        let sAth = {};
        let sZones = null;
        if (validStravaToken) {
          const sHeaders = { Authorization: `Bearer ${validStravaToken}` };
          const [sAthResp, sZonesResp] = await Promise.all([
            fetch("https://www.strava.com/api/v3/athlete", { headers: sHeaders }),
            fetch("https://www.strava.com/api/v3/athlete/zones", { headers: sHeaders })
          ]);
          sAth = sAthResp.ok ? await readStravaResponseJson(sAthResp) : {};
          sZones = sZonesResp.ok ? await readStravaResponseJson(sZonesResp) : null;
        }
        const sId = (extractStravaId(sAth) || stravaIdentity?.athleteId || "").replace(/[^0-9]/g, "");
        const sActs = sId ? loadJsonFile(`/tmp/aeropulse-strava-archive-${sId}.json`, []) : [];
        const sName = garminDirect2?.rawProfile?.name || [sAth.firstname, sAth.lastname].filter(Boolean).join(" ").trim() || String(sAth.username || "").trim() || stravaIdentity?.athleteName || "Athlete";
        const latestGarminW = garminDirect2?.wellnessRows && garminDirect2.wellnessRows.length > 0 ? {
          ...garminDirect2.wellnessRows[garminDirect2.wellnessRows.length - 1],
          weightKg: garminDirect2.rawProfile?.weight,
          restingHR: garminDirect2.rawProfile?.icu_resting_hr
        } : {
          weightKg: garminDirect2?.rawProfile?.weight,
          restingHR: garminDirect2?.rawProfile?.icu_resting_hr
        };
        const normalizedGarminActs = garminDirect2?.activities ? normalizeGarminPersonalApiActivities(
          garminDirect2.activities,
          garminDirect2.rawProfile?.ftp || 250
        ) : [];
        const directSyncedProfile = buildServerAthleteProfile(
          {
            ...garminDirect2?.rawProfile || {},
            id: sId || garminDirect2?.rawProfile?.id || "0",
            name: sName,
            ftp: garminDirect2?.rawProfile?.sportSettings?.[0]?.ftp ?? garminDirect2?.rawProfile?.ftp ?? (Number(sAth.ftp) > 80 ? Math.round(Number(sAth.ftp)) : void 0),
            weightKg: garminDirect2?.rawProfile?.weight ?? (Number(sAth.weight) > 30 ? Number(sAth.weight) : void 0),
            stravaZones: sZones,
            source: garminDirect2 ? "INTERVALS_GARMIN" : "STRAVA_OAUTH"
          },
          latestGarminW,
          [...normalizedGarminActs, ...sActs]
        );
        runtimeStore.athleteProfile = directSyncedProfile;
        runtimeStore.athleteFtp = directSyncedProfile.ftp;
        runtimeStore.athleteIndoorFtp = directSyncedProfile.indoorFtp;
        runtimeStore.athleteRunFtp = directSyncedProfile.runFtp;
        runtimeStore.athleteLthr = directSyncedProfile.lthr;
        runtimeStore.athleteMaxHr = directSyncedProfile.maxHr;
        saveSessionCache(req);
        res.json({ ok: true, athleteProfile: directSyncedProfile, mode: "LIVE" });
        return;
      }
      const fallbackProfile = buildServerAthleteProfile(req.body?.overrides || null, null);
      res.json({ ok: true, athleteProfile: fallbackProfile, mode: "SANDBOX" });
      return;
    }
    const authHeader = intervalsAuth;
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const newestStr = new Date(Date.now() + 86400 * 1e3).toISOString().slice(0, 10);
    const oldest60d = new Date(Date.now() - 60 * 86400 * 1e3).toISOString().slice(0, 10);
    const [profileResp, wellnessResp, actsResp, garminDirect] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest60d}&newest=${newestStr}`,
        {
          headers: { Authorization: authHeader, Accept: "application/json" }
        }
      ),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest60d}&newest=${todayStr}`,
        {
          headers: { Authorization: authHeader, Accept: "application/json" }
        }
      ),
      garminSession ? fetchDirectGarminProfileAndWellness(garminSession, 14).catch(() => null) : Promise.resolve(null)
    ]);
    if (!profileResp.ok && !garminDirect) {
      res.status(profileResp.status).json({
        error: `Intervals.icu athlete profile request returned ${profileResp.status}.`
      });
      return;
    }
    const rawProfile = profileResp.ok ? await profileResp.json() : {};
    const rawWellnessList = wellnessResp.ok ? await wellnessResp.json() : [];
    const rawActsList = actsResp.ok ? await actsResp.json() : [];
    const latestWellnessSummary = {};
    for (const w of rawWellnessList) {
      if (w.weight && Number(w.weight) > 25) latestWellnessSummary.weightKg = Number(w.weight);
      if (w.restingHR && Number(w.restingHR) > 25)
        latestWellnessSummary.restingHR = Number(w.restingHR);
      if (w.vo2max && Number(w.vo2max) > 20) {
        latestWellnessSummary.vo2MaxCycling = Number(w.vo2max);
        latestWellnessSummary.vo2MaxRunning = Number(w.vo2max);
      }
      if (Array.isArray(w.sportInfo)) {
        const rideInfo = w.sportInfo.find((s) => s.type === "Ride");
        const runInfo = w.sportInfo.find((s) => s.type === "Run");
        if (rideInfo?.eftp) latestWellnessSummary.rideEftp = Math.round(Number(rideInfo.eftp));
        if (rideInfo?.wPrime) latestWellnessSummary.rideWPrime = Math.round(Number(rideInfo.wPrime));
        if (rideInfo?.pMax) latestWellnessSummary.ridePMax = Math.round(Number(rideInfo.pMax));
        if (runInfo?.eftp) latestWellnessSummary.runEftp = Math.round(Number(runInfo.eftp));
      }
    }
    if (garminDirect?.rawProfile?.weight) {
      latestWellnessSummary.weightKg = garminDirect.rawProfile.weight;
    }
    if (garminDirect?.rawProfile?.icu_resting_hr) {
      latestWellnessSummary.restingHR = garminDirect.rawProfile.icu_resting_hr;
    }
    const garminActs = garminDirect?.activities ? normalizeGarminPersonalApiActivities(
      garminDirect.activities,
      garminDirect.rawProfile?.ftp || 250
    ) : [];
    const mergedRawProfile = {
      ...rawProfile,
      ...garminDirect?.rawProfile || {},
      name: garminDirect?.rawProfile?.name || rawProfile.name || [rawProfile.firstname, rawProfile.lastname].filter(Boolean).join(" ") || stravaIdentity?.athleteName,
      weight: garminDirect?.rawProfile?.weight || rawProfile.icu_weight || rawProfile.weight || stravaIdentity?.weightKg,
      ftp: garminDirect?.rawProfile?.ftp || rawProfile.ftp || stravaIdentity?.ftp,
      sportSettings: Array.isArray(garminDirect?.rawProfile?.sportSettings) && garminDirect.rawProfile.sportSettings.length > 0 ? garminDirect.rawProfile.sportSettings : rawProfile.sportSettings
    };
    const syncedProfile = buildServerAthleteProfile(
      mergedRawProfile,
      latestWellnessSummary,
      [...garminActs, ...rawActsList]
    );
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    saveSessionCache(req);
    res.json({
      ok: true,
      athleteProfile: syncedProfile,
      mode: "LIVE"
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to sync Athlete Profile & Zones."
    });
  }
});
intervalsRouter.get(["/api/intervals/auth/url", "/api/auth/intervals/url"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error: "Intervals.icu OAuth is not configured on this server yet. Please set INTERVALS_CLIENT_ID and INTERVALS_CLIENT_SECRET in your Vercel Environment Variables (or local .env)."
    });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || "cloud").toLowerCase();
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const clientNonce = String(req.query.state || "").trim();
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || void 0,
    sid,
    flow,
    mode
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolveIntervalsCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ",
    state: stateToken
  });
  const authUrl = `https://intervals.icu/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});
intervalsRouter.get(["/api/intervals/auth/login", "/api/auth/intervals/login"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveIntervalsClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      "Intervals.icu OAuth is not configured on this server yet (missing INTERVALS_CLIENT_ID or INTERVALS_CLIENT_SECRET)."
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: "cloud" });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolveIntervalsCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ",
    state: stateToken
  });
  res.redirect(302, `https://intervals.icu/oauth/authorize?${params.toString()}`);
});
intervalsRouter.get(
  [
    "/auth/intervals/callback",
    "/auth/intervals/callback/",
    "/api/intervals/callback",
    "/api/intervals/callback/",
    "/api/auth/intervals/callback",
    "/api/auth/intervals/callback/"
  ],
  intervalsCallbackHandler
);
intervalsRouter.post("/api/intervals/connect", async (req, res) => {
  try {
    const apiKey = String(req.body?.apiKey || "").trim();
    const athleteId = String(req.body?.athleteId || "0").trim() || "0";
    if (!apiKey) {
      res.status(400).json({ error: "Please provide a valid Intervals.icu Personal API Key." });
      return;
    }
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    const profileResp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    );
    if (!profileResp.ok) {
      res.status(profileResp.status).json({
        error: `Intervals.icu authentication failed (${profileResp.status}). Verify your Athlete ID and Personal API Key.`
      });
      return;
    }
    const profileData = await profileResp.json();
    const resolvedId = profileData.id || athleteId;
    const resolvedName = profileData.name || [profileData.firstname, profileData.lastname].filter(Boolean).join(" ") || `Athlete ${resolvedId}`;
    const sessionToken = setSessionCookie(req, res, resolvedName);
    const createdClaims = decodeAndVerifyToken(sessionToken);
    if (createdClaims?.sid) {
      bindRequestScopeKey(req, createdClaims.sid);
    }
    runtimeStore.intervalsApiKey = apiKey;
    runtimeStore.intervalsAthleteId = resolvedId;
    runtimeStore.intervalsAthleteName = resolvedName;
    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
      await connectServiceToUser(callerClaims.sub, "intervals", resolvedId, resolvedName);
    }
    await saveSessionCacheAsync(req, res, createdClaims?.sid);
    res.json({
      connected: true,
      sessionToken,
      athleteId: resolvedId,
      athleteName: resolvedName
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to connect to Intervals.icu"
    });
  }
});
intervalsRouter.post("/api/intervals/disconnect", async (req, res) => {
  runtimeStore.intervalsApiKey = "";
  runtimeStore.intervalsAccessToken = "";
  runtimeStore.intervalsScope = "";
  runtimeStore.intervalsAthleteName = "";
  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
    await disconnectServiceFromUser(callerClaims.sub, "intervals");
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
intervalsRouter.get("/api/intervals/sync", async (req, res) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res.status(401).json({ error: "Intervals.icu is not connected (OAuth access token or API Key required)." });
      return;
    }
    const oldestParam = String(req.query.oldest || "2010-01-01").trim();
    const payload = await syncIntervalsAllHistory(config, config.athleteId, oldestParam);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to sync Intervals.icu data"
    });
  }
});
intervalsRouter.get("/api/intervals/activities/:id/streams", async (req, res) => {
  try {
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res.status(401).json({ error: "Intervals.icu is not connected (OAuth access token or API Key required)." });
      return;
    }
    const activityId = req.params.id;
    const [streamsResp, detailResp, segmentsResp] = await Promise.all([
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,cadence,altitude`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      ),
      fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/segments`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
      )
    ]);
    const streamMap = {};
    let downsampledLatLng;
    let rawStreamsList = [];
    if (streamsResp.ok) {
      const rawStreams = await streamsResp.json();
      if (Array.isArray(rawStreams)) {
        rawStreamsList = rawStreams;
        const timeEntry = rawStreams.find((s) => s && s.type === "time" && Array.isArray(s.data));
        const baseLen = timeEntry?.data?.length || rawStreams[0]?.data?.length || 1;
        const step = Math.max(1, Math.floor(baseLen / 500));
        for (const s of rawStreams) {
          if (!s || !s.type || !Array.isArray(s.data)) continue;
          if (s.type === "latlng" && Array.isArray(s.data2)) {
            const latArr = s.data;
            const lngArr = s.data2;
            const paired = [];
            for (let idx = 0; idx < latArr.length; idx += step) {
              const lat = latArr[idx];
              const lng = lngArr[idx];
              if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) && Math.abs(lat) > 0.01) {
                paired.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
              } else if (paired.length > 0) {
                paired.push(paired[paired.length - 1]);
              }
            }
            if (paired.length > 2) {
              downsampledLatLng = paired;
              const routesCache = loadJsonFile(
                ROUTES_BY_ACTIVITY_CACHE_FILE,
                {}
              );
              const compactStep = Math.max(1, Math.floor(paired.length / 160));
              routesCache[String(activityId)] = paired.filter((_, i) => i % compactStep === 0);
              saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
            }
          } else {
            streamMap[s.type] = s.data.filter((_, idx) => idx % step === 0);
          }
        }
      }
    }
    let intervals = [];
    let detailJson = {};
    if (detailResp.ok) {
      detailJson = await detailResp.json();
      if (Array.isArray(detailJson.icu_intervals)) {
        intervals = detailJson.icu_intervals.map((iv, idx) => {
          const dist = Number(iv.distance || 0);
          const dur = Number(iv.moving_time || iv.elapsed_time || 0);
          const avgSpeed = Number(iv.average_speed || 0);
          const gapSpeed = Number(iv.gap || avgSpeed);
          return {
            id: String(iv.id || `iv-${idx}`),
            type: iv.type === "WORK" ? "WORK" : "RECOVERY",
            label: iv.label || iv.group_id || (iv.type === "WORK" ? `Work Interval #${idx + 1}` : `Recovery #${idx + 1}`),
            startTimeSecs: Number(iv.start_time || 0),
            durationSecs: dur,
            distanceMeters: Math.round(dist),
            avgWatts: iv.average_watts ? Math.round(Number(iv.average_watts)) : void 0,
            weightedAvgWatts: iv.weighted_average_watts ? Math.round(Number(iv.weighted_average_watts)) : void 0,
            intensityPct: iv.intensity ? Math.round(Number(iv.intensity)) : void 0,
            zone: iv.zone ? Number(iv.zone) : void 0,
            avgHr: iv.average_heartrate ? Math.round(Number(iv.average_heartrate)) : void 0,
            maxHr: iv.max_heartrate ? Math.round(Number(iv.max_heartrate)) : void 0,
            avgPaceSecsPerKm: avgSpeed > 0 ? Math.round(1e3 / avgSpeed) : void 0,
            gapPaceSecsPerKm: gapSpeed > 0 ? Math.round(1e3 / gapSpeed) : void 0,
            avgCadence: iv.average_cadence ? Math.round(Number(iv.average_cadence)) : void 0,
            decouplingPct: iv.decoupling != null ? Number(Number(iv.decoupling).toFixed(1)) : void 0,
            strideLengthMeters: iv.average_stride ? Number(Number(iv.average_stride).toFixed(2)) : void 0
          };
        });
      }
    }
    let segmentEfforts = [];
    if (segmentsResp.ok) {
      const rawSegments = await segmentsResp.json();
      const rawType = String(detailJson.type || "");
      const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType) ? "Running" : "Cycling";
      segmentEfforts = computeIntervalsSegmentEfforts(rawSegments, rawStreamsList, {
        id: String(activityId),
        name: String(detailJson.name || rawType || sportCategory),
        startDateLocal: String(detailJson.start_date_local || ""),
        sportCategory,
        avgHr: detailJson.average_heartrate ? Math.round(Number(detailJson.average_heartrate)) : void 0
      });
      if (segmentEfforts.length > 0) {
        const segmentsCache = loadJsonFile(
          SEGMENTS_BY_ACTIVITY_CACHE_FILE,
          {}
        );
        segmentsCache[String(activityId)] = segmentEfforts;
        saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
      }
    }
    res.json({
      streams: {
        time: streamMap.time || [],
        distance: streamMap.distance,
        latlng: downsampledLatLng,
        watts: streamMap.watts,
        heartrate: streamMap.heartrate,
        velocitySmooth: streamMap.velocity_smooth,
        cadence: streamMap.cadence,
        altitude: streamMap.altitude
      },
      intervals,
      segmentEfforts
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load activity streams and intervals"
    });
  }
});
intervalsRouter.get("/api/calendar/events", async (req, res) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (cloud && cloud.plannedEvents.length > 0) {
    res.json({ events: cloud.plannedEvents });
    return;
  }
  if (!scopedFile) {
    res.json({ events: [] });
    return;
  }
  const localPlanned = loadJsonFile(scopedFile, []);
  res.json({ events: localPlanned });
});
intervalsRouter.post("/api/calendar/events", async (req, res) => {
  try {
    const body = req.body || {};
    const date = String(body.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).slice(0, 10);
    const name = String(body.name || "Structured Workout");
    const sportCategory = body.sportCategory || "Cycling";
    const environmentPreference = body.environmentPreference || "FLEXIBLE";
    const plannedDurationSecs = Number(body.plannedDurationSecs || 3600);
    const plannedLoad = Number(body.plannedLoad || 65);
    const workoutSyntax = String(
      body.workoutSyntax || body.description || `- 10m 60% FTP
- ${Math.max(15, Math.round(plannedDurationSecs / 60) - 20)}m 85% FTP
- 10m 55% FTP`
    );
    const scheduledTime = typeof body.scheduledTime === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(body.scheduledTime.trim()) ? body.scheduledTime.trim().padStart(5, "0") : void 0;
    const sessionSlot = body.sessionSlot === "AM" || body.sessionSlot === "PM" || body.sessionSlot === "SINGLE" ? body.sessionSlot : void 0;
    const locationName = typeof body.locationName === "string" && body.locationName.trim() ? body.locationName.trim().slice(0, 120) : void 0;
    const locationCategory = typeof body.locationCategory === "string" && body.locationCategory.trim() ? body.locationCategory.trim().slice(0, 32) : void 0;
    const meetingNotes = typeof body.meetingNotes === "string" && body.meetingNotes.trim() ? body.meetingNotes.trim().slice(0, 240) : void 0;
    const newEvent = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      name,
      sportCategory,
      environmentPreference,
      description: String(body.description || workoutSyntax),
      plannedLoad,
      plannedDurationSecs,
      targetZoneSummary: String(body.targetZoneSummary || `${plannedLoad} TSS Planned`),
      workoutSyntax,
      ...scheduledTime ? { scheduledTime } : {},
      ...sessionSlot ? { sessionSlot } : {},
      ...locationName ? { locationName } : {},
      ...locationCategory ? { locationCategory } : {},
      ...meetingNotes ? { meetingNotes } : {},
      structuredSteps: Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0 ? body.structuredSteps : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs),
      ...body.trackSpec && typeof body.trackSpec === "object" ? { trackSpec: body.trackSpec } : {},
      ...body.planBlockId ? { planBlockId: String(body.planBlockId) } : {},
      ...body.planBlockName ? { planBlockName: String(body.planBlockName) } : {},
      ...typeof body.planWeekNum === "number" ? { planWeekNum: body.planWeekNum } : {},
      source: body.source || "USER"
    };
    const scopedFile = getScopedPlannedEventsFile(req);
    const cloud = await loadAthleteCloudState(req);
    const existingLocal = scopedFile ? loadJsonFile(scopedFile, []) : [];
    const existing = cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
    const updated = [newEvent, ...existing];
    if (scopedFile) {
      saveJsonFile(scopedFile, updated);
    }
    await saveAthleteCloudState(req, { plannedEvents: updated });
    const intervalsConfig = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(intervalsConfig);
    let pushedToIntervals = false;
    if (intervalsAuth && body.syncToIntervals !== false) {
      try {
        const authHeader = intervalsAuth;
        const athleteId = intervalsConfig.athleteId || "0";
        const icuType = sportCategory === "Running" ? "Run" : environmentPreference === "INDOOR" ? "VirtualRide" : "Ride";
        const icuResp = await fetch(
          `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              category: "WORKOUT",
              start_date_local: `${date}T${scheduledTime ? `${scheduledTime}:00` : "08:00:00"}`,
              name,
              type: icuType,
              description: workoutSyntax,
              moving_time: plannedDurationSecs,
              icu_training_load: plannedLoad
            })
          }
        );
        pushedToIntervals = icuResp.ok;
      } catch {
      }
    }
    let pushedToGarmin = false;
    let garminWorkoutId;
    const garminSession = getActiveGarminSession(req);
    if (garminSession && body.syncToGarmin !== false) {
      try {
        const garminSteps = (newEvent.structuredSteps || []).map((st) => ({
          label: st.label || "Interval",
          durationSecs: Number(st.durationSecs || 600),
          targetPctFtp: Number(st.targetPctFtp || 75)
        }));
        const garminRes = await pushWorkoutToGarminConnect(garminSession, {
          date,
          name,
          sportCategory,
          description: newEvent.description,
          ftpWatts: Number(body.ftpWatts || runtimeStore.athleteProfile?.ftp || 250),
          lthrBpm: Number(body.lthrBpm || runtimeStore.athleteProfile?.lthr || 165),
          steps: garminSteps
        });
        pushedToGarmin = garminRes.pushed;
        garminWorkoutId = garminRes.workoutId;
        saveGarminSession(GARMIN_SESSION_DIR, getGarminScopeKey(req), garminSession);
      } catch {
      }
    }
    res.json({
      event: newEvent,
      pushedToGarmin,
      garminWorkoutId,
      pushedToIntervals,
      events: updated
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to schedule workout event"
    });
  }
});
intervalsRouter.put("/api/calendar/events/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  const nextSyntax = typeof body.workoutSyntax === "string" ? body.workoutSyntax : void 0;
  const nextDurationSecs = typeof body.plannedDurationSecs === "number" ? body.plannedDurationSecs : 3600;
  if (!scopedFile && !cloud) {
    res.json({ updated: true, event: { id, ...body } });
    return;
  }
  const existingLocal = scopedFile ? loadJsonFile(scopedFile, []) : [];
  const existing = cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const idx = existing.findIndex((e) => e.id === id);
  const patched = {
    ...idx >= 0 ? existing[idx] : {},
    ...body,
    id,
    ...nextSyntax ? {
      structuredSteps: Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0 ? body.structuredSteps : parseWorkoutSyntaxToSteps(nextSyntax, nextDurationSecs)
    } : {}
  };
  const updated = idx >= 0 ? existing.map((e, i) => i === idx ? patched : e) : [patched, ...existing];
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ updated: true, event: patched, events: updated });
});
intervalsRouter.delete("/api/calendar/blocks/:blockId", async (req, res) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const blockId = req.params.blockId;
  const existingLocal = scopedFile ? loadJsonFile(scopedFile, []) : [];
  const existing = cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.planBlockId !== blockId);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});
intervalsRouter.delete("/api/calendar/events/:id", async (req, res) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const id = req.params.id;
  const existingLocal = scopedFile ? loadJsonFile(scopedFile, []) : [];
  const existing = cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.id !== id);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});

// server/routers/wahooRouter.ts
import { Router as Router3 } from "express";
var wahooRouter = Router3();
function getEffectiveWahooClientConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = activeReq?.headers["x-wahoo-client-id"] || "";
  const headerClientSecret = activeReq?.headers["x-wahoo-client-secret"] || "";
  const clientId = (headerClientId || process.env.WAHOO_CLIENT_ID || "").trim();
  const clientSecret = (headerClientSecret || process.env.WAHOO_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}
function getEffectiveWahooTokens(req) {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const headerToken = activeReq?.headers["x-wahoo-access-token"] || "";
  const accessToken = (headerToken || store.wahooAccessToken || "").trim();
  const refreshToken = (store.wahooRefreshToken || "").trim();
  const expiresAt = store.wahooExpiresAt || 0;
  const athleteId = store.wahooUserId || "";
  const athleteName = store.wahooAthleteName || "";
  const scope = store.wahooScope || "";
  return { accessToken, refreshToken, expiresAt, athleteId, athleteName, scope };
}
async function ensureValidWahooAccessToken(req, forceRefresh = false) {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(activeReq);
  const { accessToken, refreshToken, expiresAt } = getEffectiveWahooTokens(activeReq);
  if (!accessToken && !refreshToken) {
    return "";
  }
  const nowSecs = Math.floor(Date.now() / 1e3);
  const needsRefresh = forceRefresh || !accessToken || expiresAt > 0 && nowSecs >= expiresAt - 300;
  if (needsRefresh && clientId && clientSecret && refreshToken) {
    try {
      const resp = await fetch("https://api.wahooligan.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        }).toString()
      });
      if (resp.ok) {
        const refreshed = await resp.json();
        store.wahooAccessToken = refreshed.access_token;
        if (refreshed.refresh_token) store.wahooRefreshToken = refreshed.refresh_token;
        if (refreshed.expires_in)
          store.wahooExpiresAt = Math.floor(Date.now() / 1e3) + refreshed.expires_in;
        if (activeReq) {
          activeReq.headers["x-wahoo-access-token"] = refreshed.access_token;
        }
        await saveSessionCacheAsync(activeReq);
        return refreshed.access_token;
      }
    } catch {
    }
  }
  return accessToken;
}
wahooRouter.get(["/api/wahoo/auth/url", "/api/auth/wahoo/url"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error: "Wahoo OAuth is not configured on this server yet. Please set WAHOO_CLIENT_ID and WAHOO_CLIENT_SECRET in your environment variables."
    });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || "cloud").toLowerCase();
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const clientNonce = String(req.query.state || "").trim();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || void 0,
    sid,
    flow,
    mode,
    codeVerifier
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolveWahooCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user_read workouts_read",
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  const authUrl = `https://api.wahooligan.com/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});
wahooRouter.get(["/api/wahoo/auth/login", "/api/auth/wahoo/login"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      "Wahoo OAuth is not configured on this server yet (missing WAHOO_CLIENT_ID or WAHOO_CLIENT_SECRET)."
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: "cloud", codeVerifier });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolveWahooCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user_read workouts_read",
    state: stateToken,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  res.redirect(302, `https://api.wahooligan.com/oauth/authorize?${params.toString()}`);
});
var wahooCallbackHandler = async (req, res) => {
  const code = String(req.query.code || "").trim();
  const error = String(req.query.error || "").trim();
  const stateToken = String(req.query.state || "").trim();
  const cookieNonce = getOAuthStateCookieNonce(req);
  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);
  if (error) {
    const errMsg = error === "access_denied" ? "Access was denied by the user on Wahoo." : error;
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "wahoo",
      error: `Wahoo connection failed: ${errMsg}`
    });
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Wahoo Connection Error",
        heading: "Wahoo Connection Could Not Complete",
        accentColor: "#0EA5E9",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
    return;
  }
  if (!code) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Missing Authorization Code",
        heading: "Wahoo Authorization Code Missing",
        accentColor: "#0EA5E9",
        body: "No authorization code was returned by Wahoo.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Invalid OAuth State",
        heading: "Security Verification Failed",
        accentColor: "#0EA5E9",
        body: !verifiedState ? "OAuth state token was invalid or expired. Please re-initiate Wahoo connection." : "Browser OAuth verification cookie was missing or did not match. Please re-initiate Wahoo connection.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  try {
    const { clientId, clientSecret } = getEffectiveWahooClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        "Wahoo OAuth client credentials (WAHOO_CLIENT_ID / WAHOO_CLIENT_SECRET) are not configured."
      );
    }
    const redirectUri = resolveWahooCallbackUrl(req);
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    });
    if (verifiedState.codeVerifier) {
      bodyParams.set("code_verifier", verifiedState.codeVerifier);
    }
    const tokenResp = await fetch("https://api.wahooligan.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: bodyParams.toString()
    });
    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Wahoo token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }
    const tokenData = await tokenResp.json();
    const accessToken = String(tokenData.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Wahoo did not return a valid access token.");
    }
    const athleteId = String(tokenData.user?.id || "0").trim();
    const athleteName = String(
      [tokenData.user?.first_name, tokenData.user?.last_name].filter(Boolean).join(" ") || `Wahoo Athlete ${athleteId}`
    ).trim();
    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.wahooAccessToken = accessToken;
    if (tokenData.refresh_token) store.wahooRefreshToken = tokenData.refresh_token;
    if (tokenData.expires_in) {
      store.wahooExpiresAt = Math.floor(Date.now() / 1e3) + tokenData.expires_in;
    }
    store.wahooScope = tokenData.scope || "user_read workouts_read";
    store.wahooUserId = athleteId;
    store.wahooAthleteName = athleteName;
    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
      await connectServiceToUser(callerClaims.sub, "wahoo", athleteId, athleteName);
    }
    const sessionToken = setSessionCookie(req, res, athleteName, sid, "verified");
    await saveSessionCacheAsync(req, res, sid);
    const oauthPayloadJson = safeJsonForScript({
      type: "OAUTH_AUTH_SUCCESS",
      provider: "wahoo",
      athleteId,
      athleteName,
      sessionToken,
      scope: tokenData.scope,
      returnUrl: "/#fitness?openDataSources=1"
    });
    res.type("html").send(
      renderThreshOAuthHtml({
        title: "Wahoo Connected \xB7 THRESH",
        heading: `Wahoo Connected${athleteName && !isGenericName(athleteName) ? ` \xB7 ${escapeHtml(athleteName)}` : ""}`,
        accentColor: "#0EA5E9",
        body: "Your Wahoo Cloud account is now linked via OAuth 2.0 / PKCE. ELEMNT rides, workouts, and FIT files will sync automatically with smart deduplication.",
        ctaLabel: "Continue to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_wahoo_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_wahoo_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_wahoo_connected', '1');
            localStorage.setItem('aeropulse_oauth_just_connected', '1');
          } catch (e) {}
          var hasOpener = false;
          try {
            if (window.opener && window.opener !== window) {
              hasOpener = true;
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
          var isPopupWindow = hasOpener || window.name === 'aeropulse_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/#fitness?openDataSources=1');
          }
        })();`
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "wahoo",
      error: `Wahoo connection failed: ${errMsg}`
    });
    res.status(500).type("html").send(
      renderThreshOAuthHtml({
        title: "Wahoo Connection Error",
        heading: "Wahoo Connection Failed",
        accentColor: "#FB7185",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
  }
};
wahooRouter.get(
  [
    "/auth/wahoo/callback",
    "/auth/wahoo/callback/",
    "/api/wahoo/callback",
    "/api/wahoo/callback/",
    "/api/auth/wahoo/callback",
    "/api/auth/wahoo/callback/"
  ],
  wahooCallbackHandler
);
wahooRouter.post("/api/wahoo/disconnect", async (req, res) => {
  const store = getScopedRuntimeStore(req);
  store.wahooAccessToken = "";
  store.wahooRefreshToken = "";
  store.wahooExpiresAt = 0;
  store.wahooScope = "";
  store.wahooUserId = "";
  store.wahooAthleteName = "";
  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
    await disconnectServiceFromUser(callerClaims.sub, "wahoo");
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
wahooRouter.get("/api/wahoo/workouts", async (req, res) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: "Wahoo account is not connected." });
      return;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 50));
    const url = `https://api.wahooligan.com/v1/workouts?page=${page}&per_page=${perPage}&order=created_at`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Wahoo workouts (${resp.status}): ${errText.slice(0, 160)}`
      });
      return;
    }
    const data = await resp.json();
    const rawWorkouts = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : [];
    res.json({ workouts: rawWorkouts });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to retrieve Wahoo workouts"
    });
  }
});
wahooRouter.get("/api/wahoo/workouts/:id/file", async (req, res) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: "Wahoo account is not connected." });
      return;
    }
    const workoutId = encodeURIComponent(String(req.params.id || "").trim());
    if (!workoutId) {
      res.status(400).json({ error: "Workout ID is required" });
      return;
    }
    const url = `https://api.wahooligan.com/v1/workouts/${workoutId}/file`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to download Wahoo FIT file (${resp.status}): ${errText.slice(0, 160)}`
      });
      return;
    }
    const arrayBuf = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="wahoo-workout-${workoutId}.fit"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to download Wahoo workout file"
    });
  }
});
wahooRouter.get("/api/wahoo/sync", async (req, res) => {
  try {
    const token = await ensureValidWahooAccessToken(req);
    if (!token) {
      res.status(401).json({ error: "Wahoo account is not connected." });
      return;
    }
    const resp = await fetch("https://api.wahooligan.com/v1/workouts?per_page=50&order=created_at", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Wahoo workouts (${resp.status}): ${errText.slice(0, 160)}`
      });
      return;
    }
    const data = await resp.json();
    const rawWorkouts = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : [];
    const clientTzName = String(
      req.headers["x-client-tz"] || req.query.tz || ""
    ).trim();
    const clientTzOffsetMins = parseClientTzOffsetMins(
      req.headers["x-client-tz-offset-mins"] ?? req.query.tzOffsetMins
    );
    const activities = rawWorkouts.map((w) => {
      const summary = w.workout_summary || {};
      const sport = w.workout_type_id === 2 ? "Running" : "Cycling";
      const duration = Number(summary.duration_active_seconds || summary.duration_seconds || 0);
      const isIndoor = /kickr|indoor|trainer/i.test(w.name || "");
      const rawStartUtc = w.starts || (/* @__PURE__ */ new Date()).toISOString();
      const rawUtcMs = parseIsoWithExplicitOffsetToUtcMs(rawStartUtc) ?? Date.parse(rawStartUtc);
      const resolvedOffsetMins = (typeof w.timezone === "string" && Number.isFinite(rawUtcMs) ? resolveIanaTimeZoneOffsetMinutes(rawUtcMs, w.timezone) : void 0) ?? (clientTzName && Number.isFinite(rawUtcMs) ? resolveIanaTimeZoneOffsetMinutes(rawUtcMs, clientTzName) : void 0) ?? clientTzOffsetMins;
      const normalizedTimestamps = normalizeActivityTimestamps({
        startDateUtc: rawStartUtc,
        timeZoneOffsetMins: resolvedOffsetMins,
        fallbackBrowserTz: true
      });
      return {
        id: `wahoo_${w.id}`,
        wahooId: String(w.id),
        startDateLocal: normalizedTimestamps.startDateLocal,
        ...normalizedTimestamps.startDateUtcMs !== void 0 ? { startDateUtcMs: normalizedTimestamps.startDateUtcMs } : {},
        name: w.name || "Wahoo Workout",
        sportCategory: sport,
        environment: isIndoor ? "INDOOR" : "OUTDOOR",
        subType: isIndoor ? "Smart Trainer" : "Road",
        movingTimeSecs: duration,
        distanceMeters: Number(summary.distance_metres || 0),
        elevationGainMeters: Number(summary.ascent_metres || 0),
        avgPower: summary.power_avg != null ? Number(summary.power_avg) : void 0,
        normalizedPower: summary.power_avg != null ? Number(summary.power_avg) : void 0,
        avgHr: Number(summary.heart_rate_avg || 0),
        maxHr: Number(summary.heart_rate_max || 0),
        avgCadence: summary.cadence_avg != null ? Number(summary.cadence_avg) : void 0,
        calories: summary.calories != null ? Number(summary.calories) : void 0,
        trainingLoad: Math.round(duration * 60 / 3600),
        sourceBadges: ["Wahoo"],
        deviceName: "Wahoo ELEMNT",
        fileUrl: w.file?.url || void 0,
        cleanRoomEligibleForAiAndCoaching: true
      };
    });
    const { athleteId, athleteName } = getEffectiveWahooTokens(req);
    res.json({
      ok: true,
      activities,
      athleteId,
      athleteName,
      receivedCount: activities.length,
      exercisesCount: activities.length
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to sync Wahoo workouts"
    });
  }
});

// server/routers/polarRouter.ts
import { Router as Router4 } from "express";
var polarRouter = Router4();
function getEffectivePolarClientConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  const headerClientId = activeReq?.headers["x-polar-client-id"] || "";
  const headerClientSecret = activeReq?.headers["x-polar-client-secret"] || "";
  const clientId = (headerClientId || process.env.POLAR_CLIENT_ID || "").trim();
  const clientSecret = (headerClientSecret || process.env.POLAR_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret };
}
function getEffectivePolarTokens(req) {
  const activeReq = req ?? requestContext.getStore();
  const store = getScopedRuntimeStore(activeReq);
  const headerToken = activeReq?.headers["x-polar-access-token"] || "";
  const accessToken = (headerToken || store.polarAccessToken || "").trim();
  const athleteId = store.polarUserId || "";
  const athleteName = store.polarAthleteName || "";
  const expiresAt = store.polarExpiresAt || 0;
  const scope = store.polarScope || "";
  return { accessToken, athleteId, athleteName, expiresAt, scope };
}
function parsePolarDurationSecs(rawDuration) {
  if (typeof rawDuration === "number") return Math.max(0, Math.round(rawDuration));
  if (typeof rawDuration !== "string") return 0;
  const match = rawDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/i);
  if (!match) {
    const raw = Number(rawDuration);
    return Number.isNaN(raw) ? 0 : Math.max(0, Math.round(raw));
  }
  const hours = Number(match[1] || 0);
  const mins = Number(match[2] || 0);
  const secs = Number(match[3] || 0);
  return Math.round(hours * 3600 + mins * 60 + secs);
}
function normalizePolarExercise(exercise, thresholdPaceSecsPerKm = 245, lthr = 165, clientTzOffsetMins) {
  const durationSecs = Math.max(
    1,
    parsePolarDurationSecs(exercise.duration || exercise.duration_seconds || exercise.durationSecs)
  );
  const distanceMeters = Number(
    exercise.distance || exercise.distance_metres || exercise.distanceMeters || 0
  );
  const sportStr = String(exercise.sport || exercise.detailed_sport_info || "").toUpperCase();
  const isRun = /RUN|JOG|TRACK/i.test(sportStr);
  const isCycle = /CYCL|BIKE|SPIN/i.test(sportStr);
  const sportCategory = isRun ? "Running" : isCycle ? "Cycling" : "Running";
  const isIndoor = /INDOOR|TREADMILL|STATIONARY/i.test(sportStr) || /treadmill|indoor|stationary/i.test(exercise.title || exercise.name || "");
  const subType = isIndoor ? isRun ? "Treadmill" : "Smart Trainer" : "Road";
  const avgHr = Number(exercise.heart_rate?.average || exercise.average_heart_rate || exercise.avgHr || 0);
  const maxHr = Number(exercise.heart_rate?.maximum || exercise.maximum_heart_rate || exercise.maxHr || 0);
  let trainingLoad = 0;
  let intensityFactor;
  if (isRun && distanceMeters > 0 && durationSecs > 0) {
    const paceSecsPerKm = durationSecs / distanceMeters * 1e3;
    const safeThresholdPace = Math.max(120, thresholdPaceSecsPerKm);
    const ifVal = Number((safeThresholdPace / paceSecsPerKm).toFixed(2));
    intensityFactor = ifVal;
    trainingLoad = Math.max(1, Math.round(durationSecs * ifVal ** 2 * 100 / 3600));
  } else if (avgHr > 0) {
    const safeLthr = Math.max(100, lthr);
    const ifVal = Number((avgHr / safeLthr).toFixed(2));
    intensityFactor = ifVal;
    trainingLoad = Math.max(1, Math.round(durationSecs * ifVal ** 2 * 100 / 3600));
  } else {
    trainingLoad = Math.max(1, Math.round(durationSecs * 60 / 3600));
  }
  let efficiencyFactor;
  if (avgHr > 0 && distanceMeters > 0 && durationSecs > 0) {
    const speedMPerMin = distanceMeters / (durationSecs / 60);
    efficiencyFactor = Number((speedMPerMin / avgHr).toFixed(2));
  }
  const hrZones = [0, 0, 0, 0, 0, 0, 0];
  const rawHrZones = Array.isArray(exercise.zones?.heart_rate) ? exercise.zones.heart_rate : Array.isArray(exercise.heart_rate?.zones) ? exercise.heart_rate.zones : [];
  if (rawHrZones.length > 0) {
    rawHrZones.forEach((z, i) => {
      const rawIdx = z.index != null ? Number(z.index) : i + 1;
      const targetIdx = rawIdx >= 1 && rawIdx <= 7 ? rawIdx - 1 : i;
      const inZoneSecs = parsePolarDurationSecs(z.in_zone ?? z.in_zone_seconds ?? z.duration ?? 0);
      if (targetIdx >= 0 && targetIdx < 7) {
        hrZones[targetIdx] = inZoneSecs;
      }
    });
  }
  const avgPaceSecsPerKm = distanceMeters > 0 ? Math.round(durationSecs / distanceMeters * 1e3) : void 0;
  const polarOffsetMins = typeof exercise.start_time_utc_offset === "number" && Number.isFinite(exercise.start_time_utc_offset) ? Math.round(exercise.start_time_utc_offset) : clientTzOffsetMins;
  const polarTimestamps = normalizeActivityTimestamps({
    startDateLocal: exercise.start_time || exercise.startTime || void 0,
    startDateUtc: exercise.start_time_utc || exercise.startTimeUtc || void 0,
    timeZoneOffsetMins: polarOffsetMins,
    fallbackBrowserTz: true
  });
  return {
    id: `polar_${exercise.id}`,
    polarId: String(exercise.id),
    startDateLocal: polarTimestamps.startDateLocal,
    ...polarTimestamps.startDateUtcMs !== void 0 ? { startDateUtcMs: polarTimestamps.startDateUtcMs } : {},
    name: exercise.title || exercise.name || (isRun ? "Polar Run" : "Polar Ride"),
    sportCategory,
    environment: isIndoor ? "INDOOR" : "OUTDOOR",
    subType,
    movingTimeSecs: durationSecs,
    distanceMeters,
    elevationGainMeters: Number(exercise.ascent || exercise.elevationGainMeters || 0),
    avgHr,
    maxHr,
    trainingLoad,
    intensityFactor,
    efficiencyFactor,
    avgPaceSecsPerKm,
    gapPaceSecsPerKm: avgPaceSecsPerKm,
    calories: exercise.calories != null ? Number(exercise.calories) : void 0,
    sourceBadges: ["Polar"],
    deviceName: exercise.device || exercise.device_name || exercise.deviceName || "Polar Flow",
    zoneSecs: { hr: hrZones },
    cleanRoomEligibleForAiAndCoaching: true
  };
}
polarRouter.get(["/api/polar/auth/url", "/api/auth/polar/url"], (req, res) => {
  const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error: "Polar OAuth is not configured on this server yet. Please set POLAR_CLIENT_ID and POLAR_CLIENT_SECRET in your environment variables."
    });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || "cloud").toLowerCase();
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const clientNonce = String(req.query.state || "").trim();
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || void 0,
    sid,
    flow,
    mode
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolvePolarCallbackUrl(req);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "accesslink.read_all",
    state: stateToken
  });
  const authUrl = `https://flow.polar.com/oauth2/authorization?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});
polarRouter.get(["/api/polar/auth/login", "/api/auth/polar/login"], (req, res) => {
  const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      "Polar OAuth is not configured on this server yet (missing POLAR_CLIENT_ID or POLAR_CLIENT_SECRET)."
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const { stateToken, nonce } = issueOAuthStateToken({ sid, flow, mode: "cloud" });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolvePolarCallbackUrl(req);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "accesslink.read_all",
    state: stateToken
  });
  res.redirect(302, `https://flow.polar.com/oauth2/authorization?${params.toString()}`);
});
var polarCallbackHandler = async (req, res) => {
  const code = String(req.query.code || "").trim();
  const error = String(req.query.error || "").trim();
  const stateToken = String(req.query.state || "").trim();
  const cookieNonce = getOAuthStateCookieNonce(req);
  const verifiedState = verifyOAuthStateToken(stateToken);
  clearOAuthStateCookie(res);
  if (error) {
    const errMsg = error === "access_denied" ? "Access was denied by the user on Polar." : error;
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "polar",
      error: `Polar connection failed: ${errMsg}`
    });
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Polar Connection Error",
        heading: "Polar Connection Could Not Complete",
        accentColor: "#EF4444",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
    return;
  }
  if (!code) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Missing Authorization Code",
        heading: "Polar Authorization Code Missing",
        accentColor: "#EF4444",
        body: "No authorization code was returned by Polar.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  if (!verifiedState || !cookieNonce || !timingSafeStringEqual(cookieNonce, verifiedState.nonce)) {
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Invalid OAuth State",
        heading: "Security Verification Failed",
        accentColor: "#EF4444",
        body: !verifiedState ? "OAuth state token was invalid or expired. Please re-initiate Polar connection." : "Browser OAuth verification cookie was missing or did not match. Please re-initiate Polar connection.",
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1"
      })
    );
    return;
  }
  try {
    const { clientId, clientSecret } = getEffectivePolarClientConfig(req);
    if (!clientId || !clientSecret) {
      throw new Error(
        "Polar OAuth client credentials (POLAR_CLIENT_ID / POLAR_CLIENT_SECRET) are not configured."
      );
    }
    const redirectUri = resolvePolarCallbackUrl(req);
    const basicAuth = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenResp = await fetch("https://polarremote.com/v2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json;charset=UTF-8",
        Authorization: basicAuth
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }).toString()
    });
    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      throw new Error(
        `Polar token exchange failed (${tokenResp.status}): ${errBody.slice(0, 160)}`
      );
    }
    const tokenData = await tokenResp.json();
    const accessToken = String(tokenData.access_token || "").trim();
    if (!accessToken) {
      throw new Error("Polar did not return a valid access token.");
    }
    const athleteId = String(tokenData.x_user_id || "0").trim();
    try {
      await fetch("https://polarremote.com/v2/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ "member-id": `thresh_${athleteId}` })
      });
    } catch {
    }
    let athleteName = `Polar Athlete ${athleteId}`;
    try {
      const profileResp = await fetch(`https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
      if (profileResp.ok) {
        const profData = await profileResp.json();
        const fullName = [profData["first-name"], profData["last-name"]].filter(Boolean).join(" ").trim();
        if (fullName) athleteName = fullName;
      }
    } catch {
    }
    const sid = verifiedState.sid || ensureRequestSessionSid(req, res);
    bindRequestScopeKey(req, sid);
    const store = getScopedRuntimeStore(req);
    store.polarAccessToken = accessToken;
    store.polarUserId = athleteId;
    store.polarAthleteName = athleteName;
    if (tokenData.expires_in) {
      store.polarExpiresAt = Math.floor(Date.now() / 1e3) + tokenData.expires_in;
    }
    const callerClaims = getVerifiedSessionClaims(req);
    if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
      await connectServiceToUser(callerClaims.sub, "polar", athleteId, athleteName);
    }
    const sessionToken = setSessionCookie(req, res, athleteName, sid, "verified");
    await saveSessionCacheAsync(req, res, sid);
    const oauthPayloadJson = safeJsonForScript({
      type: "OAUTH_AUTH_SUCCESS",
      provider: "polar",
      athleteId,
      athleteName,
      sessionToken,
      returnUrl: "/#fitness?openDataSources=1"
    });
    res.type("html").send(
      renderThreshOAuthHtml({
        title: "Polar Connected \xB7 THRESH",
        heading: `Polar Connected${athleteName && !isGenericName(athleteName) ? ` \xB7 ${escapeHtml(athleteName)}` : ""}`,
        accentColor: "#EF4444",
        body: "Your Polar AccessLink account is now linked via OAuth 2.0. Exercises, heart rate zones, and rTSS will sync automatically with smart deduplication.",
        ctaLabel: "Continue to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.athleteId) {
              localStorage.setItem('aeropulse_polar_athlete_id', String(payload.athleteId));
            }
            if (payload.athleteName) {
              localStorage.setItem('aeropulse_polar_athlete_name', payload.athleteName);
            }
            localStorage.setItem('aeropulse_polar_connected', '1');
            localStorage.setItem('aeropulse_oauth_just_connected', '1');
          } catch (e) {}
          var hasOpener = false;
          try {
            if (window.opener && window.opener !== window) {
              hasOpener = true;
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
          var isPopupWindow = hasOpener || window.name === 'aeropulse_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/#fitness?openDataSources=1');
          }
        })();`
      })
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "polar",
      error: `Polar connection failed: ${errMsg}`
    });
    res.status(500).type("html").send(
      renderThreshOAuthHtml({
        title: "Polar Connection Error",
        heading: "Polar Connection Failed",
        accentColor: "#FB7185",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: "/#fitness?openDataSources=1",
        ctaOnClick: "if (window.opener || window.name === 'aeropulse_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
        scriptBody: `(function() {
          var payload = ${errJson};
          try {
            if (window.opener && window.opener !== window) {
              window.opener.postMessage(payload, window.location.origin);
            }
          } catch (e) {}
          try {
            var bc = new BroadcastChannel('aeropulse_oauth');
            bc.postMessage(payload);
          } catch (e) {}
        })();`
      })
    );
  }
};
polarRouter.get(
  [
    "/auth/polar/callback",
    "/auth/polar/callback/",
    "/api/polar/callback",
    "/api/polar/callback/",
    "/api/auth/polar/callback",
    "/api/auth/polar/callback/"
  ],
  polarCallbackHandler
);
polarRouter.post("/api/polar/disconnect", async (req, res) => {
  const store = getScopedRuntimeStore(req);
  store.polarAccessToken = "";
  store.polarUserId = "";
  store.polarAthleteName = "";
  store.polarExpiresAt = 0;
  store.polarScope = "";
  const callerClaims = getVerifiedSessionClaims(req);
  if (callerClaims && callerClaims.sub?.startsWith("usr_")) {
    await disconnectServiceFromUser(callerClaims.sub, "polar");
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
polarRouter.get("/api/polar/exercises", async (req, res) => {
  try {
    const { accessToken, athleteId } = getEffectivePolarTokens(req);
    if (!accessToken) {
      res.status(401).json({ error: "Polar account is not connected." });
      return;
    }
    const url = athleteId ? `https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}/exercises` : "https://polarremote.com/v2/exercises";
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Polar exercises (${resp.status}): ${errText.slice(0, 160)}`
      });
      return;
    }
    const data = await resp.json();
    const rawExercises = Array.isArray(data) ? data : Array.isArray(data?.exercises) ? data.exercises : [];
    res.json({ exercises: rawExercises });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to retrieve Polar exercises"
    });
  }
});
polarRouter.get("/api/polar/sync", async (req, res) => {
  try {
    const { accessToken, athleteId, athleteName } = getEffectivePolarTokens(req);
    if (!accessToken) {
      res.status(401).json({ error: "Polar account is not connected." });
      return;
    }
    const url = athleteId ? `https://polarremote.com/v2/users/${encodeURIComponent(athleteId)}/exercises` : "https://polarremote.com/v2/exercises";
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(resp.status).json({
        error: `Failed to fetch Polar exercises (${resp.status}): ${errText.slice(0, 160)}`
      });
      return;
    }
    const data = await resp.json();
    const rawExercises = Array.isArray(data) ? data : Array.isArray(data?.exercises) ? data.exercises : [];
    const store = getScopedRuntimeStore(req);
    const athleteThresholdPace = 245;
    const athleteLthr = store.athleteLthr || 165;
    const clientTzOffsetMins = parseClientTzOffsetMins(
      req.headers["x-client-tz-offset-mins"] ?? req.query.tzOffsetMins
    );
    const activities = rawExercises.map(
      (ex) => normalizePolarExercise(ex, athleteThresholdPace, athleteLthr, clientTzOffsetMins)
    );
    res.json({
      ok: true,
      activities,
      athleteId,
      athleteName,
      receivedCount: activities.length,
      exercisesCount: activities.length
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to sync Polar exercises"
    });
  }
});

// server/routers/coachRouter.ts
import { Router as Router5 } from "express";
import { GoogleGenAI, Type } from "@google/genai";
var coachRouter = Router5();
function getEffectiveGeminiApiKey(req) {
  const activeReq = req ?? requestContext.getStore();
  const headerKey = activeReq?.headers["x-gemini-api-key"]?.trim();
  const bodyKey = typeof activeReq?.body?.geminiApiKey === "string" ? activeReq.body.geminiApiKey.trim() : "";
  for (const c of [headerKey, bodyKey]) {
    const clean = (c || "").trim().replace(/^["']+|["']+$/g, "").trim();
    if (clean && clean !== "MY_GEMINI_API_KEY" && clean !== "YOUR_GEMINI_API_KEY") {
      return clean;
    }
  }
  if (activeReq) {
    try {
      const currentScopeStore = getScopedRuntimeStore(activeReq);
      const storedKey = (currentScopeStore?.geminiApiKey || "").trim();
      if (storedKey && !isServerOwnedSecret(storedKey)) {
        const clean = storedKey.replace(/^["']+|["']+$/g, "").trim();
        if (clean && clean !== "MY_GEMINI_API_KEY" && clean !== "YOUR_GEMINI_API_KEY") {
          return clean;
        }
      }
    } catch {
    }
  }
  if (!isAuthorizedForServerAi(activeReq)) {
    return "";
  }
  const serverCandidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ];
  for (const c of serverCandidates) {
    const clean = (c || "").trim().replace(/^["']+|["']+$/g, "").trim();
    if (clean && clean !== "MY_GEMINI_API_KEY" && clean !== "YOUR_GEMINI_API_KEY") {
      return clean;
    }
  }
  return "";
}
function getGeminiClient(req) {
  const apiKey = getEffectiveGeminiApiKey(req);
  if (!apiKey) return null;
  if (!runtimeStore.geminiApiKey && !isServerOwnedSecret(apiKey)) {
    runtimeStore.geminiApiKey = apiKey;
  }
  return new GoogleGenAI({
    apiKey
  });
}
async function generateGeminiContentWithFallback(ai, params) {
  const candidateModels = ["gemini-2.5-flash", "gemini-2.0-flash"];
  let lastError = null;
  for (const model of candidateModels) {
    try {
      return await Promise.race([
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config
        }),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error(`Model ${model} timed out`)), 4500)
        )
      ]);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini API request failed across candidate models.");
}
function buildDeterministicDailyWorkoutOptions(sportPreference, environmentPreference, durationMinutes, telemetrySummary = {}) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const hasCtl = w.ctl != null && Number(w.ctl) > 0;
  const hasHrv = w.hrvRMSSD != null && Number(w.hrvRMSSD) > 0;
  const hasSleep = w.sleepScore != null && Number(w.sleepScore) > 0;
  const ctl = hasCtl ? Number(w.ctl).toFixed(1) : null;
  const tsb = hasCtl ? Number(w.tsb ?? 0).toFixed(1) : null;
  const hrv = hasHrv ? Math.round(Number(w.hrvRMSSD)) : null;
  const hrvStatus = hasHrv ? String(w.hrvStatus || "Balanced") : null;
  const sleepScore = hasSleep ? Math.round(Number(w.sleepScore)) : null;
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 250));
  const isRun = /run/i.test(sportPreference);
  const dur = Math.max(30, Math.round(Number(durationMinutes) || 60));
  const mainMins = Math.max(15, dur - 25);
  const loadContextNote = ctl ? `CTL ${ctl} \xB7 TSB ${tsb}` : "your current threshold calibration while your 42-day load baseline builds";
  const biometricContextNote = hrv && sleepScore ? `morning HRV ${hrv} ms (${hrvStatus}) and Sleep Score ${sleepScore}` : hrv ? `morning HRV ${hrv} ms (${hrvStatus})` : "your calibrated threshold zones (connect Garmin or Intervals.icu anytime to layer overnight HRV & sleep modulation)";
  return [
    {
      id: `opt-det-1-${Date.now()}`,
      tier: "OPTIMAL",
      tierLabel: "Option A \xB7 Optimal Progression",
      title: isRun ? "Threshold Cruiser Progression" : "Sweet Spot Aerobic Ramp",
      sportCategory: isRun ? "Running" : "Cycling",
      environment: environmentPreference || "INDOOR",
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 72 / 60),
      summary: isRun ? `Structured 10m warmup, ${mainMins}m sub-threshold tempo, and 10m cooldown calibrated to your current fitness.` : `Warmup, sustained ${mainMins}m block at 88-92% FTP (${Math.round(ftp * 0.9)}W), and spinout cooldown.`,
      physiologicalWhy: `Chosen from ${biometricContextNote} with ${loadContextNote} to stimulate mitochondrial density without exceeding autonomic recovery reserve.`,
      workoutSyntax: isRun ? `- 10m Warmup easy jog
- ${mainMins}m Sub-threshold tempo at 88% LTHR
- 10m Cooldown easy jog` : `- 10m 60% FTP (${Math.round(ftp * 0.6)}W)
- ${mainMins}m 88% FTP (${Math.round(ftp * 0.88)}W)
- 10m 55% FTP (${Math.round(ftp * 0.55)}W)`,
      structuredSteps: [
        { label: "Warmup", duration: "10m", targetZoneOrOutput: isRun ? "Zone 1-2" : `${Math.round(ftp * 0.6)}W \xB7 Z1-Z2` },
        { label: "Main Set", duration: `${mainMins}m`, targetZoneOrOutput: isRun ? "88% LTHR \xB7 Z3/Z4" : `${Math.round(ftp * 0.88)}W \xB7 Sweet Spot` },
        { label: "Cooldown", duration: "10m", targetZoneOrOutput: isRun ? "Easy jog" : `${Math.round(ftp * 0.55)}W \xB7 Recovery` }
      ]
    },
    {
      id: `opt-det-2-${Date.now()}`,
      tier: "MODULATED",
      tierLabel: "Option B \xB7 Aerobic Durability",
      title: isRun ? "Zone 2 Base Durability" : "Endurance Aerobic Cruise",
      sportCategory: isRun ? "Running" : "Cycling",
      environment: environmentPreference || "OUTDOOR",
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 50 / 60),
      summary: `Steady Zone 2 aerobic volume building fat oxidation capacity and capillary beds with low cardiac drift.`,
      physiologicalWhy: `Respects ${biometricContextNote}. Keeps parasympathetic activation high while banking steady endurance hours.`,
      workoutSyntax: isRun ? `- 5m Warmup walk/jog
- ${dur - 10}m Zone 2 aerobic base
- 5m Cooldown walk` : `- 10m 55% FTP (${Math.round(ftp * 0.55)}W)
- ${dur - 20}m 68% FTP (${Math.round(ftp * 0.68)}W)
- 10m 50% FTP (${Math.round(ftp * 0.5)}W)`,
      structuredSteps: [
        { label: "Warmup", duration: isRun ? "5m" : "10m", targetZoneOrOutput: "Z1 Warmup" },
        { label: "Base Durability", duration: `${isRun ? dur - 10 : dur - 20}m`, targetZoneOrOutput: isRun ? "Zone 2" : `${Math.round(ftp * 0.68)}W \xB7 Z2` },
        { label: "Cooldown", duration: isRun ? "5m" : "10m", targetZoneOrOutput: "Recovery" }
      ]
    },
    {
      id: `opt-det-3-${Date.now()}`,
      tier: "RECOVERY",
      tierLabel: "Option C \xB7 Active Recovery & Flush",
      title: isRun ? "Easy Shakeout & Mobility" : "Spindle Flush Spin",
      sportCategory: isRun ? "Running" : "Cycling",
      environment: "INDOOR",
      durationMinutes: Math.min(dur, 40),
      estimatedLoad: 20,
      summary: `Ultra-light Zone 1 flush stimulating lymph clearance and muscle blood flow without accumulating training fatigue.`,
      physiologicalWhy: `Safeguards recovery balance. Ideal when sleep or HRV signals caution or as an active rest day before high-intensity blocks.`,
      workoutSyntax: isRun ? `- 25m Easy conversational shakeout
- 5m Mobility and stretching` : `- 30m 50% FTP (${Math.round(ftp * 0.5)}W) high-cadence spin
- 5m Cooldown`,
      structuredSteps: [
        { label: "Flush", duration: "30m", targetZoneOrOutput: isRun ? "Zone 1 Recovery" : `${Math.round(ftp * 0.5)}W \xB7 Zone 1` },
        { label: "Mobility", duration: "5m", targetZoneOrOutput: "Stretching / Mobility" }
      ]
    }
  ];
}
function buildDeterministicCoachChatResponse(message, telemetrySummary = {}, todayStr) {
  const w = telemetrySummary?.latestWellness || {};
  const t = telemetrySummary?.athleteThresholds || {};
  const hasCtl = w.ctl != null && Number(w.ctl) > 0;
  const hasHrv = w.hrvRMSSD != null && Number(w.hrvRMSSD) > 0;
  const hasSleep = w.sleepScore != null && Number(w.sleepScore) > 0;
  const ctl = hasCtl ? Number(w.ctl).toFixed(1) : null;
  const atl = hasCtl ? Number(w.atl || 0).toFixed(1) : null;
  const tsb = hasCtl ? Number(w.tsb ?? Number(ctl) - Number(atl)).toFixed(1) : null;
  const hrv = hasHrv ? Math.round(Number(w.hrvRMSSD)) : null;
  const hrvBaseline = hasHrv ? Math.round(Number(w.hrvBaseline7d || hrv)) : null;
  const hrvStatus = hasHrv ? String(w.hrvStatus || (hrv < hrvBaseline - 3 ? "Unbalanced" : "Balanced")) : null;
  const sleepHours = w.sleepSecs ? (Number(w.sleepSecs) / 3600).toFixed(1) : null;
  const sleepScore = hasSleep ? Math.round(Number(w.sleepScore)) : null;
  const statusLabel = w.garminTrainingStatus ? String(w.garminTrainingStatus) : null;
  const ftp = Math.round(Number(t.ftp || runtimeStore.athleteFtp || 250));
  const lthr = Math.round(Number(t.lthr || runtimeStore.athleteLthr || 165));
  const runLthr = Math.round(Number(t.runLthr || lthr));
  const addDays = (base, offset) => {
    const d = /* @__PURE__ */ new Date(`${base}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const isSuppressed = hrvStatus === "Unbalanced" || hrvStatus === "Low" || tsb != null && Number(tsb) < -12;
  const wantsRunOnly = /\brun(ning)?\b/i.test(message) && !/\bcycl(e|ing)|bike|ride|trainer\b/i.test(message);
  const wantsMultiDay = /\b(week|5-day|schedule|plan|block|days)\b/i.test(message);
  const citedMetrics = [];
  if (sleepHours) citedMetrics.push(`Sleep ${sleepHours}h${sleepScore ? ` (${sleepScore})` : ""}`);
  if (hrv) citedMetrics.push(`HRV ${hrv} ms (${hrvStatus || "Balanced"})`);
  if (ctl) citedMetrics.push(`CTL ${ctl} \xB7 TSB ${tsb}`);
  if (ftp) citedMetrics.push(`Cycling FTP ${ftp}W`);
  if (runLthr) citedMetrics.push(`Run LTHR ${runLthr} bpm`);
  let reply = "";
  const proposedWorkouts = [];
  if (wantsMultiDay) {
    reply = `### Microcycle Prescription (${todayStr})

Here is your adaptive training microcycle structured against your physiological metrics:

- **Readiness Status:** ${hrvStatus || "Calibrating"} (${hrv ? `HRV ${hrv} ms` : "monitoring baselines"})
- **Chronic Training Load:** ${ctl ? `CTL ${ctl}, TSB ${tsb}` : "Building 42d baseline"}

I've prepared ready-to-schedule workouts below. Tap **Add to Plan** on any workout to place it on your training calendar.`;
    const dayConfigs = wantsRunOnly ? [
      { day: 0, sport: "Running", dur: 3600, load: 55, name: "Zone 2 Aerobic Foundation", syntax: "- 10m Warmup\n- 40m Zone 2 aerobic pace\n- 10m Cooldown" },
      { day: 1, sport: "Running", dur: 4500, load: 75, name: "Threshold Cruise Intervals", syntax: "- 15m Warmup\n- 3x 8m at 92% LTHR (2m recovery)\n- 10m Cooldown" },
      { day: 2, sport: "Running", dur: 2400, load: 30, name: "Recovery Shakeout & Drills", syntax: "- 30m Conversational Zone 1 jog\n- 10m Mobility" },
      { day: 4, sport: "Running", dur: 5400, load: 90, name: "Long Aerobic Progression", syntax: "- 15m Easy\n- 55m Steady endurance\n- 20m Aerobic finish" }
    ] : [
      { day: 0, sport: "Cycling", dur: 3600, load: 60, name: "Sweet Spot Ramp", syntax: `- 10m 60% FTP
- 30m 88% FTP (${Math.round(ftp * 0.88)}W)
- 10m 55% FTP` },
      { day: 1, sport: "Running", dur: 3600, load: 65, name: "Tempo Aerobic Run", syntax: `- 10m Warmup
- 35m Zone 3 tempo at ${Math.round(runLthr * 0.88)} bpm
- 15m Cooldown` },
      { day: 2, sport: "Cycling", dur: 2700, load: 35, name: "Active Recovery Spin", syntax: `- 40m 50% FTP (${Math.round(ftp * 0.5)}W)
- 5m Cooldown` },
      { day: 4, sport: "Cycling", dur: 5400, load: 105, name: "Over-Under Lactate Clearance", syntax: `- 15m Warmup
- 3x 12m Over/Under (95%/105% FTP)
- 15m Cooldown` }
    ];
    dayConfigs.forEach((cfg, idx) => {
      proposedWorkouts.push({
        id: `det-plan-${todayStr}-${idx}`,
        date: addDays(todayStr, cfg.day),
        name: cfg.name,
        sportCategory: cfg.sport,
        environmentPreference: "OUTDOOR",
        description: `Prescribed by THRESH AI Coach based on ${hrvStatus || "calibrated"} readiness.`,
        plannedLoad: cfg.load,
        plannedDurationSecs: cfg.dur,
        targetZoneSummary: `${cfg.load} TSS \xB7 AI Prescribed`,
        workoutSyntax: cfg.syntax,
        structuredSteps: parseWorkoutSyntaxToSteps(cfg.syntax, cfg.dur),
        source: "AI_COACH"
      });
    });
  } else {
    const recSport = wantsRunOnly ? "Running" : "Cycling";
    const recDur = 3600;
    const recLoad = isSuppressed ? 35 : 68;
    const recName = isSuppressed ? recSport === "Running" ? "Aerobic Recovery Shakeout" : "Autonomic Recovery Flush" : recSport === "Running" ? "Threshold Cruise Intervals" : "Sweet Spot Development";
    const recSyntax = isSuppressed ? recSport === "Running" ? "- 10m Warmup walk/jog\n- 25m Zone 1 conversational pace\n- 5m Cooldown" : `- 10m 50% FTP
- 25m 55% FTP (${Math.round(ftp * 0.55)}W)
- 10m 45% FTP` : recSport === "Running" ? `- 10m Warmup
- 3x 8m Threshold at ${runLthr} bpm (2m jog)
- 10m Cooldown` : `- 10m 60% FTP
- 3x 10m 90% FTP (${Math.round(ftp * 0.9)}W)
- 10m 55% FTP`;
    reply = `### Physiological Assessment

Based on your telemetry snapshot for **${todayStr}**:

- **Autonomic State:** ${hrvStatus ? `${hrvStatus} (HRV ${hrv} ms)` : "Calibrating baseline"}
- **Load Balance:** ${ctl ? `CTL ${ctl} \xB7 TSB ${tsb}` : "42-day baseline building"}
- **Prescription:** ${isSuppressed ? "Modulated recovery session to restore autonomic tone." : "Productive aerobic workout to advance threshold power and pace."}

I've formatted today's workout below. Tap **Add to Plan** to sync it to your schedule.`;
    proposedWorkouts.push({
      id: `det-single-${todayStr}`,
      date: todayStr,
      name: recName,
      sportCategory: recSport,
      environmentPreference: "INDOOR",
      description: `Targeted session based on your current readiness (${hrvStatus || "Calibrating"}).`,
      plannedLoad: recLoad,
      plannedDurationSecs: recDur,
      targetZoneSummary: `${recLoad} TSS \xB7 Prescribed Workout`,
      workoutSyntax: recSyntax,
      structuredSteps: parseWorkoutSyntaxToSteps(recSyntax, recDur),
      source: "AI_COACH"
    });
  }
  return {
    reply,
    citedMetrics,
    proposedWorkouts,
    engine: "LOCAL_PHYSIOLOGY_ENGINE"
  };
}
async function resolveCallerYouthSafeguardStatus(req, telemetrySummary) {
  let isMinorU18 = false;
  let forceZeroWeight = Boolean(
    telemetrySummary?.athleteProfile?.safeSportHideWeight || telemetrySummary?.safeSportHideWeight || telemetrySummary?.enforceZeroWeight
  );
  const clientAgeCheck = resolveAthleteAgeTier({
    birthMonthYear: telemetrySummary?.athleteProfile?.birthMonthYear || telemetrySummary?.birthMonthYear
  });
  if (clientAgeCheck.isMinorU18 || Boolean(telemetrySummary?.isMinorU18)) {
    isMinorU18 = true;
    forceZeroWeight = true;
  }
  const claims = getVerifiedSessionClaims(req);
  if (isCanonicalAuthenticatedClaims(claims)) {
    if (claims?.sub?.startsWith("usr_")) {
      const user = await getUserById(claims.sub).catch(() => null);
      if (user?.birthMonthYear) {
        const userAge = resolveAthleteAgeTier({ birthMonthYear: user.birthMonthYear });
        if (userAge.isMinorU18) {
          isMinorU18 = true;
          forceZeroWeight = true;
        }
      }
    }
    if (claims?.sid) {
      const teams = await listTeamsForUser(claims.sid, "https://thresh.app").catch(() => []);
      for (const t of teams) {
        if (t.brand?.defaultSafeSportShield) {
          forceZeroWeight = true;
        }
        const myMem = t.memberships?.find((m) => m.userSid === claims.sid);
        if (myMem?.isMinorU18) {
          isMinorU18 = true;
          forceZeroWeight = true;
        }
      }
    }
  }
  return { isMinorU18, forceZeroWeight };
}
coachRouter.post("/api/gemini/config", async (req, res) => {
  const claims = getVerifiedSessionClaims(req);
  if (!isCanonicalAuthenticatedClaims(claims)) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const rawApiKey = String(req.body?.apiKey || req.body?.geminiApiKey || "").trim();
  runtimeStore.geminiApiKey = rawApiKey;
  await saveSessionCacheAsync(req, res);
  res.json({
    ok: true,
    hasGeminiServerKey: Boolean(runtimeStore.geminiApiKey)
  });
});
coachRouter.post("/api/coach/options", async (req, res) => {
  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: "AI request limit reached. Please wait a moment before requesting another workout option.",
      retryAfterSecs: rateCheck.retryAfterSecs
    });
    return;
  }
  const {
    sportPreference = "Cycling",
    environmentPreference = "INDOOR",
    durationMinutes = 60,
    telemetrySummary
  } = req.body || {};
  const youthStatus = await resolveCallerYouthSafeguardStatus(req, telemetrySummary);
  const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary, {
    forceZeroWeight: youthStatus.forceZeroWeight,
    requireFirstPartyProvenance: true
  });
  try {
    const ai = !isAuthorizedForAi(req) || youthStatus.isMinorU18 ? null : getGeminiClient(req);
    if (!ai) {
      res.json({
        options: buildDeterministicDailyWorkoutOptions(
          sportPreference,
          environmentPreference,
          durationMinutes,
          cleanTelemetry
        ),
        engine: "LOCAL_PHYSIOLOGY_ENGINE"
      });
      return;
    }
    const prompt = `
You are THRESH AI Coach, an elite endurance sports physiologist and dual-sport running & cycling coach.
Generate 3 distinct, actionable daily workout options for today based on the athlete's live first-party Garmin health, sleep, HRV status, Training Status, and calibrated threshold telemetry:
- Preferred Sport for Today: ${sportPreference}
- Preferred Environment: ${environmentPreference} (e.g., OUTDOOR road/trail vs INDOOR Smart Trainer/Treadmill)
- Available Duration: ${durationMinutes} minutes
- Clean-Room Athlete Telemetry Context: ${JSON.stringify(cleanTelemetry)}

Return an array of 3 workout options in JSON matching the schema:
1. Tier "OPTIMAL" (Option A \xB7 Optimal Progression \u2014 pushes toward race/FTP/pace goals when readiness permits)
2. Tier "MODULATED" (Option B \xB7 Modulated Aerobic Durability \u2014 steady Zone 2 / controlled tempo advancing mileage with low autonomic cost)
3. Tier "RECOVERY" (Option C \xB7 Active Parasympathetic Recovery \u2014 low-strain Zone 1 spin/jog + mobility)
Include workoutSyntax (e.g., "- 10m 60% FTP\\n- 30m 85% FTP\\n- 10m 55% FTP") for each option.
`;
    const response = await generateGeminiContentWithFallback(ai, {
      contents: prompt,
      config: {
        systemInstruction: "Always cite exact numbers from the athlete telemetry (Garmin Sleep Score, Sleep Duration, HRV in ms vs 7d/60d baseline corridor, Garmin Training Status, Resting HR, CTL/ATL/TSB, eFTP, and annual mileage progress). Keep workout intervals crisp and practical.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              tier: { type: Type.STRING },
              tierLabel: { type: Type.STRING },
              title: { type: Type.STRING },
              sportCategory: { type: Type.STRING },
              environment: { type: Type.STRING },
              durationMinutes: { type: Type.INTEGER },
              estimatedLoad: { type: Type.INTEGER },
              summary: { type: Type.STRING },
              physiologicalWhy: { type: Type.STRING },
              workoutSyntax: { type: Type.STRING },
              structuredSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    targetZoneOrOutput: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      }
    });
    const jsonText = (response.text ?? "[]").trim();
    const parsed = JSON.parse(jsonText);
    res.json({ options: parsed, engine: "GEMINI_LIVE" });
  } catch {
    res.json({
      options: buildDeterministicDailyWorkoutOptions(
        sportPreference,
        environmentPreference,
        durationMinutes,
        cleanTelemetry
      ),
      engine: "LOCAL_PHYSIOLOGY_ENGINE"
    });
  }
});
coachRouter.post("/api/coach/chat", async (req, res) => {
  if (!isAuthorizedForAi(req)) {
    res.status(401).json({
      error: "Valid authenticated session or x-gemini-api-key required."
    });
    return;
  }
  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: "AI request limit reached. Please wait a moment before sending another message.",
      retryAfterSecs: rateCheck.retryAfterSecs
    });
    return;
  }
  const { message, history = [], telemetrySummary } = req.body || {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required." });
    return;
  }
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const youthStatus = await resolveCallerYouthSafeguardStatus(req, telemetrySummary);
  const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary, {
    forceZeroWeight: youthStatus.forceZeroWeight,
    requireFirstPartyProvenance: true
  });
  try {
    const ai = youthStatus.isMinorU18 ? null : getGeminiClient(req);
    if (!ai) {
      res.json(buildDeterministicCoachChatResponse(message, cleanTelemetry, todayStr));
      return;
    }
    const conversationContext = Array.isArray(history) ? history.slice(-8).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n") : "";
    const response = await generateGeminiContentWithFallback(ai, {
      contents: `
TODAY'S DATE: ${todayStr}

ATHLETE CLEAN-ROOM HEALTH, SLEEP, READINESS & CALIBRATED TELEMETRY SNAPSHOT:
${JSON.stringify(cleanTelemetry, null, 2)}

RECENT CONVERSATION:
${conversationContext}

ATHLETE QUESTION OR PROGRAM REQUEST:
${message}
`,
      config: {
        systemInstruction: `You are THRESH AI Coach, an elite exercise physiologist and dual-sport running & cycling performance coach inside THRESH (THRESH \u2014 Run & Ride Readiness).
1. Ground every answer in the athlete's actual clean-room metrics provided in the snapshot: Sleep Score & Duration, 7d Sleep Debt, HRV Status & rMSSD (ms) vs baseline corridor, Training Status, Resting HR, CTL/ATL/TSB, Load Ratio (ACWR), calibrated Cycling FTP/eFTP, Running Threshold Pace, and first-party workouts. Never invent metrics that are missing or null\u2014state clearly when calibration is needed.
2. Whenever the user asks about today's workout, tomorrow's session, or a multi-day / weekly cycling or running training plan, ALWAYS populate "proposedWorkouts" with 1 to 7 concrete, ready-to-schedule workouts (with exact YYYY-MM-DD dates starting from ${todayStr}, sportCategory "Cycling" or "Running", environmentPreference "OUTDOOR" or "INDOOR", plannedDurationSecs, plannedLoad, and step workoutSyntax lines starting with "- ").`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: {
              type: Type.STRING,
              description: "Clear, quantitative markdown coaching response referencing the athlete\u2019s exact sleep, HRV, Training Status, CTL/ATL/TSB, and power/pace zones."
            },
            citedMetrics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 5 short metric badges cited in the analysis (e.g., "Sleep 7h 19m (Score 75)", "HRV 38 ms", "CTL 72.4 / TSB +14.7", "Cycling eFTP 310W").'
            },
            proposedWorkouts: {
              type: Type.ARRAY,
              description: "1 to 7 structured workouts that the athlete can schedule onto their Training Calendar with 1 click.",
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, description: "YYYY-MM-DD date for the workout" },
                  name: { type: Type.STRING, description: "Concise workout title" },
                  sportCategory: { type: Type.STRING, description: "Cycling or Running" },
                  environmentPreference: {
                    type: Type.STRING,
                    description: "OUTDOOR, INDOOR, or FLEXIBLE"
                  },
                  plannedDurationSecs: {
                    type: Type.INTEGER,
                    description: "Total duration in seconds (e.g. 3600 for 60m)"
                  },
                  plannedLoad: {
                    type: Type.INTEGER,
                    description: "Estimated TSS training load"
                  },
                  workoutSyntax: {
                    type: Type.STRING,
                    description: 'Intervals.icu step syntax, each step on a new line starting with "- " (e.g. "- 10m 60% FTP\\n- 4x 5m 105% FTP\\n- 10m 55% FTP")'
                  },
                  description: {
                    type: Type.STRING,
                    description: "1-sentence coaching rationale for this session"
                  }
                }
              }
            }
          }
        }
      }
    });
    const rawText = (response.text ?? "{}").trim();
    const parsed = JSON.parse(rawText);
    const proposedWorkouts = Array.isArray(parsed.proposedWorkouts) ? parsed.proposedWorkouts.map((pw, i) => {
      const dur = Number(pw.plannedDurationSecs || 3600);
      const syntax = String(pw.workoutSyntax || "- 15m 65% FTP\n- 30m 85% FTP\n- 15m 55% FTP");
      return {
        id: `ai-prop-${Date.now()}-${i}`,
        date: String(pw.date || todayStr).slice(0, 10),
        name: String(pw.name || "AI Prescribed Session"),
        sportCategory: /run/i.test(String(pw.sportCategory || "")) ? "Running" : "Cycling",
        environmentPreference: /indoor/i.test(String(pw.environmentPreference || "")) ? "INDOOR" : /outdoor/i.test(String(pw.environmentPreference || "")) ? "OUTDOOR" : "FLEXIBLE",
        description: String(pw.description || syntax),
        plannedLoad: Number(pw.plannedLoad || 65),
        plannedDurationSecs: dur,
        targetZoneSummary: `${pw.plannedLoad || 65} TSS \xB7 AI Coach Prescription`,
        workoutSyntax: syntax,
        structuredSteps: parseWorkoutSyntaxToSteps(syntax, dur),
        source: "AI_COACH"
      };
    }) : [];
    res.json({
      reply: parsed.reply || "Here is my analysis based on your physiological profile.",
      citedMetrics: Array.isArray(parsed.citedMetrics) ? parsed.citedMetrics : [],
      proposedWorkouts,
      engine: "GEMINI_LIVE"
    });
  } catch {
    res.json(buildDeterministicCoachChatResponse(message, cleanTelemetry, todayStr));
  }
});
coachRouter.post(["/api/races/parse", "/races/parse"], async (req, res) => {
  const rateCheck = checkAiRateLimit(getClientAiRateLimitKey(req));
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: "Race parser rate limit reached. Please wait a moment.",
      retryAfterSecs: rateCheck.retryAfterSecs
    });
    return;
  }
  try {
    const { url, rawText } = req.body;
    let fetchedTextSnippet = "";
    let fetchNote = "";
    if (url && typeof url === "string" && /^https?:\/\//i.test(url.trim())) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);
        const remoteResp = await assertSafeExternalFetch(
          url.trim(),
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
            },
            signal: controller.signal
          },
          2
        );
        clearTimeout(timeoutId);
        if (!remoteResp) {
          fetchNote = "Blocked unsafe, private-DNS, or cross-network redirect URL; parsed provided text only.";
        } else if (remoteResp.ok) {
          const html = await remoteResp.text();
          fetchedTextSnippet = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<\/?(tr|p|div|li|br|h1|h2|h3|h4|table)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").slice(0, 18e3);
        } else {
          fetchNote = `Remote site returned HTTP ${remoteResp.status}; parsed provided text.`;
        }
      } catch {
        fetchNote = "Remote platform throttled direct crawler access; parsed pasted results text.";
      }
    }
    const combinedInput = [
      url ? `SOURCE URL: ${url}` : "",
      rawText ? `USER PASTED RESULTS:
${rawText}` : "",
      fetchedTextSnippet ? `FETCHED PAGE CONTENT:
${fetchedTextSnippet}` : ""
    ].filter(Boolean).join("\n\n");
    if (!combinedInput.trim()) {
      res.status(400).json({ error: "Provide an Athletic.net / TFRRS / MileSplit URL or pasted race results text." });
      return;
    }
    const ai = getGeminiClient(req);
    if (ai) {
      try {
        const response = await generateGeminiContentWithFallback(ai, {
          contents: `Extract all official track & field, cross country, or road race results from the following input (from Athletic.net, TFRRS, MileSplit, RunSignup, or meet result tables).
Convert every race into structured JSON with exact FAT time in seconds (to 0.01s precision, e.g. "1:56.38" -> 116.38, "4:16.42" -> 256.42), eventLabel ("400m", "800m", "1500m", "1600m", "1 Mile", "3000m", "3200m", "5000m", "10000m", "XC 5K", "Road 5K", "Half Marathon"), eventDistanceMeters, date (YYYY-MM-DD), meetName, placeFinish, platform ("Athletic.net", "TFRRS", "MileSplit", "RunSignup", or "Official FAT"), trackType ("OUTDOOR_400M", "INDOOR_BANKED_200M", "INDOOR_FLAT_200M", "XC_COURSE", or "ROAD"), and lapSplitsSecs (array of lap split times in seconds if present).

INPUT:
${combinedInput}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                races: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING, description: "YYYY-MM-DD" },
                      meetName: { type: Type.STRING },
                      eventLabel: { type: Type.STRING, description: "e.g. 800m, 1500m, 1600m, 3200m, XC 5K" },
                      eventDistanceMeters: { type: Type.NUMBER },
                      displayFatTime: { type: Type.STRING, description: "e.g. 1:56.38 or 4:16.42" },
                      fatTimeSecs: { type: Type.NUMBER, description: "Total seconds with decimals, e.g. 116.38" },
                      platform: { type: Type.STRING, description: "Athletic.net, TFRRS, MileSplit, RunSignup, or Official FAT" },
                      trackType: { type: Type.STRING, description: "OUTDOOR_400M, INDOOR_BANKED_200M, INDOOR_FLAT_200M, XC_COURSE, or ROAD" },
                      placeFinish: { type: Type.STRING },
                      windReading: { type: Type.STRING },
                      lapSplitsSecs: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER }
                      }
                    }
                  }
                }
              }
            }
          }
        });
        const parsedJson = JSON.parse((response.text ?? "{}").trim());
        if (Array.isArray(parsedJson.races) && parsedJson.races.length > 0) {
          res.json({
            races: parsedJson.races,
            fetchNote,
            source: "GEMINI_STRUCTURED"
          });
          return;
        }
      } catch {
      }
    }
    res.json({
      races: [],
      fetchNote: fetchNote || "Used fast local deterministic parser for Athletic.net / TFRRS / MileSplit table rows.",
      source: "CLIENT_DETERMINISTIC"
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to parse official race results."
    });
  }
});

// server/routers/configRouter.ts
var configRouter = Router6();
configRouter.post("/api/auth/session", (req, res) => {
  const existing = getVerifiedSessionClaims(req);
  if (existing && isCanonicalAuthenticatedClaims(existing)) {
    const refreshedToken = setSessionCookie(req, res, existing.sub, existing.sid, "verified");
    res.json({ ok: true, sessionToken: refreshedToken, authLevel: "verified" });
    return;
  }
  const anonSub = `anon_${crypto12.randomBytes(8).toString("hex")}`;
  const sessionToken = setSessionCookie(req, res, anonSub, void 0, "anon");
  res.json({ ok: true, sessionToken, authLevel: "anon" });
});
configRouter.get(["/api/config/status", "/api/auth/status"], async (req, res) => {
  const verifiedClaims = getVerifiedSessionClaims(req);
  const isVerifiedSession = isCanonicalAuthenticatedClaims(verifiedClaims);
  const isAuthed = isAuthenticatedRequest(req);
  const {
    apiKey: intervalsKey,
    accessToken: intervalsAccessToken,
    athleteId
  } = getEffectiveIntervalsConfig(req);
  const {
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    refreshToken: stravaRefreshToken,
    accessToken: stravaAccessToken
  } = getEffectiveStravaClientConfig(req);
  const {
    clientId: intervalsClientId,
    clientSecret: intervalsClientSecret
  } = getEffectiveIntervalsClientConfig(req);
  if (intervalsKey && !runtimeStore.intervalsApiKey && !isServerOwnedSecret(intervalsKey)) {
    runtimeStore.intervalsApiKey = intervalsKey;
    runtimeStore.intervalsAthleteId = athleteId;
  }
  if (intervalsAccessToken && !runtimeStore.intervalsAccessToken) {
    runtimeStore.intervalsAccessToken = intervalsAccessToken;
    runtimeStore.intervalsAthleteId = athleteId;
  }
  if (stravaClientId && !runtimeStore.stravaClientId) {
    runtimeStore.stravaClientId = stravaClientId;
  }
  if (stravaClientSecret && !runtimeStore.stravaClientSecret && !isServerOwnedSecret(stravaClientSecret)) {
    runtimeStore.stravaClientSecret = stravaClientSecret;
  }
  if (stravaRefreshToken && !runtimeStore.stravaRefreshToken) {
    runtimeStore.stravaRefreshToken = stravaRefreshToken;
  }
  if (stravaAccessToken && !runtimeStore.stravaAccessToken) {
    runtimeStore.stravaAccessToken = stravaAccessToken;
  }
  const headerMapKey = req.headers["x-map-tile-api-key"]?.trim();
  const headerMapProvider = req.headers["x-map-tile-provider"]?.trim();
  if (headerMapKey && !runtimeStore.mapTileApiKey) {
    runtimeStore.mapTileApiKey = headerMapKey;
  }
  if (headerMapProvider && (headerMapProvider === "OSM_KEYLESS" || headerMapProvider === "MAPBOX" || headerMapProvider === "THUNDERFOREST")) {
    runtimeStore.mapTileProvider = headerMapProvider;
  }
  const effectiveMapKey = (runtimeStore.mapTileApiKey || process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN || process.env.THUNDERFOREST_API_KEY || "").trim();
  const effectiveMapProvider = runtimeStore.mapTileProvider || (effectiveMapKey.startsWith("pk.") ? "MAPBOX" : effectiveMapKey ? "THUNDERFOREST" : "OSM_KEYLESS");
  const hasStravaEnv = Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
  const effectiveGeminiKey = getEffectiveGeminiApiKey(req);
  if (effectiveGeminiKey && !runtimeStore.geminiApiKey && !isServerOwnedSecret(effectiveGeminiKey)) {
    runtimeStore.geminiApiKey = effectiveGeminiKey;
  }
  const hasGeminiServerKey = Boolean(effectiveGeminiKey);
  const isIntervalsConnected = Boolean(intervalsKey || intervalsAccessToken);
  const isStravaConnected = Boolean(stravaAccessToken || stravaRefreshToken);
  const [stravaIdentity, intervalsIdentity] = await Promise.all([
    isStravaConnected ? resolveStravaAthleteIdentity(req) : Promise.resolve(null),
    isIntervalsConnected ? resolveIntervalsAthleteIdentity(req) : Promise.resolve(null)
  ]);
  const resolvedStravaAthleteId = stravaIdentity?.athleteId || runtimeStore.stravaAthleteId || void 0;
  const resolvedStravaName = stravaIdentity?.athleteName || (!isGenericName(runtimeStore.stravaAthleteName) ? runtimeStore.stravaAthleteName : void 0);
  const resolvedMeasurementPref = stravaIdentity?.measurementPreference || runtimeStore.stravaMeasurementPreference || void 0;
  const resolvedIntervalsName = intervalsIdentity?.athleteName || (!isGenericName(runtimeStore.intervalsAthleteName) ? runtimeStore.intervalsAthleteName : void 0);
  const activeGarminSession = getActiveGarminSession(req);
  const isGarminConnected = Boolean(
    activeGarminSession?.personalApiKey || activeGarminSession?.oauth2AccessToken || activeGarminSession?.oauth1Token
  );
  const resolvedGarminName = activeGarminSession?.fullName || activeGarminSession?.displayName || void 0;
  const { clientId: wahooClientId, clientSecret: wahooClientSecret } = getEffectiveWahooClientConfig(req);
  const { accessToken: wahooAccessToken, athleteId: wahooAthleteId, athleteName: wahooAthleteName } = getEffectiveWahooTokens(req);
  const isWahooConnected = Boolean(wahooAccessToken);
  const { clientId: polarClientId, clientSecret: polarClientSecret } = getEffectivePolarClientConfig(req);
  const { accessToken: polarAccessToken, athleteId: polarAthleteId, athleteName: polarAthleteName } = getEffectivePolarTokens(req);
  const isPolarConnected = Boolean(polarAccessToken);
  let sessionToken;
  if ((isVerifiedSession || Boolean(resolvedStravaAthleteId)) && (isStravaConnected || isGarminConnected || isIntervalsConnected || isWahooConnected || isPolarConnected)) {
    const existingClaims = verifiedClaims;
    const keepUserSub = Boolean(existingClaims?.sub?.startsWith("usr_"));
    const canonicalSid = keepUserSub ? existingClaims.sid : resolvedStravaAthleteId ? deriveStravaSessionSid(resolvedStravaAthleteId) : existingClaims?.sid;
    sessionToken = setSessionCookie(
      req,
      res,
      keepUserSub ? existingClaims.sub : resolvedStravaName || resolvedGarminName || resolvedIntervalsName || wahooAthleteName || polarAthleteName || "athlete",
      canonicalSid,
      "verified"
    );
    await saveSessionCacheAsync(req, res, canonicalSid);
  }
  res.json({
    vaultStorageBackend: getVaultStorageBackend(),
    garminConnected: isGarminConnected,
    garminAthleteName: resolvedGarminName,
    intervalsConfigured: Boolean(intervalsClientId && intervalsClientSecret),
    intervalsConnected: isIntervalsConnected,
    intervalsAuthMethod: intervalsAccessToken ? "OAUTH" : intervalsKey ? "API_KEY" : "NONE",
    intervalsAthleteId: isIntervalsConnected ? intervalsIdentity?.athleteId || athleteId || "0" : "0",
    intervalsAthleteName: resolvedIntervalsName,
    intervalsSource: intervalsAccessToken ? "OAUTH" : isIntervalsConnected ? "USER_INPUT" : "NONE",
    wahooConfigured: Boolean(wahooClientId && wahooClientSecret),
    wahooConnected: isWahooConnected,
    wahooAthleteId: isWahooConnected ? wahooAthleteId : void 0,
    wahooAthleteName: isWahooConnected ? wahooAthleteName : void 0,
    polarConfigured: Boolean(polarClientId && polarClientSecret),
    polarConnected: isPolarConnected,
    polarAthleteId: isPolarConnected ? polarAthleteId : void 0,
    polarAthleteName: isPolarConnected ? polarAthleteName : void 0,
    stravaConfigured: Boolean(stravaClientId && stravaClientSecret),
    stravaClientId: stravaClientId || void 0,
    stravaConnected: isStravaConnected,
    stravaAthleteId: resolvedStravaAthleteId,
    stravaAthleteName: resolvedStravaName || resolvedGarminName || resolvedIntervalsName,
    stravaAthleteFtp: stravaIdentity?.ftp,
    stravaAthleteWeightKg: stravaIdentity?.weightKg,
    stravaMeasurementPreference: resolvedMeasurementPref,
    stravaGrantedScope: runtimeStore.stravaGrantedScope || void 0,
    stravaSyncPolicy: runtimeStore.stravaSyncPolicy || void 0,
    stravaSource: isStravaConnected ? "OAUTH" : hasStravaEnv ? "ENV" : "NONE",
    hasGeminiServerKey,
    autoSyncCronActive: true,
    totalActivitiesCount: 0,
    earliestActivityDate: "",
    garminActivitiesCount: runtimeStore.garminActivitiesCount || 0,
    stravaActivitiesCount: runtimeStore.stravaActivitiesCount || 0,
    redactedStravaCount: runtimeStore.redactedStravaCount || 0,
    gearItems: runtimeStore.gearItems || [],
    athleteProfile: runtimeStore.athleteProfile || void 0,
    callbackUrl: resolveCallbackUrl(req),
    stravaTokens: isStravaConnected ? getStravaTokenRotationPayload(req) : void 0,
    sessionToken,
    mapTileProvider: effectiveMapProvider,
    mapTileApiKeyConfigured: Boolean(effectiveMapKey),
    mapTileApiKey: isVerifiedSession && effectiveMapKey ? effectiveMapKey : void 0
  });
});
configRouter.post("/api/athlete/profile", (req, res) => {
  const incoming = req.body?.athleteProfile || req.body || {};
  const updated = buildServerAthleteProfile(
    { ...incoming, source: "CUSTOM_OVERRIDE" },
    null
  );
  runtimeStore.athleteFtp = updated.ftp;
  runtimeStore.athleteIndoorFtp = updated.indoorFtp;
  runtimeStore.athleteRunFtp = updated.runFtp;
  runtimeStore.athleteLthr = updated.lthr;
  runtimeStore.athleteMaxHr = updated.maxHr;
  runtimeStore.athleteProfile = updated;
  saveSessionCache(req);
  res.json({
    ok: true,
    athleteProfile: updated
  });
});
configRouter.post("/api/map/config", (req, res) => {
  const rawProvider = String(req.body?.provider || "OSM_KEYLESS").trim().toUpperCase();
  const rawApiKey = String(req.body?.apiKey || "").trim();
  const provider = rawProvider === "MAPBOX" ? "MAPBOX" : rawProvider === "THUNDERFOREST" ? "THUNDERFOREST" : rawApiKey.startsWith("pk.") ? "MAPBOX" : "OSM_KEYLESS";
  runtimeStore.mapTileProvider = provider;
  runtimeStore.mapTileApiKey = rawApiKey;
  saveSessionCache();
  res.json({
    ok: true,
    mapTileProvider: runtimeStore.mapTileProvider,
    mapTileApiKeyConfigured: Boolean(runtimeStore.mapTileApiKey),
    mapTileApiKey: runtimeStore.mapTileApiKey || void 0
  });
});
configRouter.get("/api/config/export-bundle", (req, res) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: "Valid authenticated session required to export credentials." });
    return;
  }
  const effectiveIntervals = getEffectiveIntervalsConfig(req);
  const effectiveStrava = getEffectiveStravaClientConfig(req);
  const intervalsApiKey = userOwnedSecretOnly(effectiveIntervals.apiKey);
  const intervalsAthleteId = intervalsApiKey ? effectiveIntervals.athleteId : "0";
  const stravaClientId = effectiveStrava.clientId;
  const stravaClientSecret = userOwnedSecretOnly(effectiveStrava.clientSecret);
  const stravaRefreshToken = userOwnedSecretOnly(effectiveStrava.refreshToken);
  const stravaAccessToken = userOwnedSecretOnly(effectiveStrava.accessToken);
  if (!intervalsApiKey && !stravaRefreshToken && !stravaAccessToken) {
    res.status(401).json({ error: "Authentication required to export connection bundle." });
    return;
  }
  const mapTileApiKey = userOwnedSecretOnly(
    req.headers["x-map-tile-api-key"] || runtimeStore.mapTileApiKey || ""
  );
  const mapTileProvider = runtimeStore.mapTileProvider || "OSM_KEYLESS";
  const geminiApiKey = userOwnedSecretOnly(getEffectiveGeminiApiKey(req));
  const payload = {
    v: 1,
    intervalsApiKey,
    intervalsAthleteId,
    intervalsAthleteName: runtimeStore.intervalsAthleteName,
    stravaClientId,
    stravaClientSecret,
    stravaRefreshToken,
    stravaAccessToken,
    stravaExpiresAt: runtimeStore.stravaExpiresAt,
    stravaAthleteName: runtimeStore.stravaAthleteName,
    mapTileProvider,
    mapTileApiKey,
    geminiApiKey: geminiApiKey || void 0
  };
  const bundle = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const envLines = [
    ...geminiApiKey ? [`GEMINI_API_KEY="${geminiApiKey}"`] : [],
    `INTERVALS_API_KEY="${intervalsApiKey}"`,
    `INTERVALS_ATHLETE_ID="${intervalsAthleteId || "0"}"`,
    `STRAVA_CLIENT_ID="${stravaClientId}"`,
    ...stravaClientSecret ? [`STRAVA_CLIENT_SECRET="${stravaClientSecret}"`] : [],
    `STRAVA_REFRESH_TOKEN="${stravaRefreshToken}"`,
    ...mapTileApiKey ? [`MAPBOX_ACCESS_TOKEN="${mapTileApiKey}"`] : []
  ].join("\n");
  res.json({
    bundle,
    envText: envLines,
    credentials: payload
  });
});
configRouter.post("/api/config/import-bundle", (req, res) => {
  try {
    const rawInput = String(req.body?.bundle || "").trim();
    if (!rawInput) {
      res.status(400).json({ error: "Please paste a valid Connection Bundle or .env block." });
      return;
    }
    let parsed = {};
    if (rawInput.includes("INTERVALS_API_KEY=") || rawInput.includes("STRAVA_") || rawInput.includes("MAPBOX_") || rawInput.includes("GEMINI_API_KEY=")) {
      const lines = rawInput.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "GEMINI_API_KEY" || key === "GOOGLE_API_KEY") parsed.geminiApiKey = val;
        if (key === "INTERVALS_API_KEY") parsed.intervalsApiKey = val;
        if (key === "INTERVALS_ATHLETE_ID") parsed.intervalsAthleteId = val;
        if (key === "STRAVA_CLIENT_ID") parsed.stravaClientId = val;
        if (key === "STRAVA_CLIENT_SECRET") parsed.stravaClientSecret = val;
        if (key === "STRAVA_REFRESH_TOKEN") parsed.stravaRefreshToken = val;
        if (key === "STRAVA_ACCESS_TOKEN") parsed.stravaAccessToken = val;
        if (key === "MAPBOX_ACCESS_TOKEN" || key === "VITE_MAPBOX_ACCESS_TOKEN" || key === "THUNDERFOREST_API_KEY") {
          parsed.mapTileApiKey = val;
          parsed.mapTileProvider = val.startsWith("pk.") ? "MAPBOX" : "THUNDERFOREST";
        }
      }
    } else {
      const jsonStr = rawInput.startsWith("{") ? rawInput : Buffer.from(rawInput, "base64").toString("utf8");
      parsed = JSON.parse(jsonStr);
    }
    if (parsed.geminiApiKey) runtimeStore.geminiApiKey = String(parsed.geminiApiKey).trim();
    if (parsed.intervalsApiKey) runtimeStore.intervalsApiKey = parsed.intervalsApiKey.trim();
    if (parsed.intervalsAthleteId)
      runtimeStore.intervalsAthleteId = parsed.intervalsAthleteId.trim();
    if (parsed.intervalsAthleteName)
      runtimeStore.intervalsAthleteName = parsed.intervalsAthleteName;
    if (parsed.stravaClientId) runtimeStore.stravaClientId = String(parsed.stravaClientId).trim();
    if (parsed.stravaClientSecret)
      runtimeStore.stravaClientSecret = String(parsed.stravaClientSecret).trim();
    if (parsed.stravaRefreshToken)
      runtimeStore.stravaRefreshToken = String(parsed.stravaRefreshToken).trim();
    if (parsed.stravaAccessToken)
      runtimeStore.stravaAccessToken = String(parsed.stravaAccessToken).trim();
    if (parsed.stravaExpiresAt) runtimeStore.stravaExpiresAt = Number(parsed.stravaExpiresAt);
    if (parsed.stravaAthleteName) runtimeStore.stravaAthleteName = parsed.stravaAthleteName;
    if (parsed.mapTileApiKey !== void 0) {
      runtimeStore.mapTileApiKey = String(parsed.mapTileApiKey).trim();
    }
    if (parsed.mapTileProvider) {
      runtimeStore.mapTileProvider = parsed.mapTileProvider;
    }
    saveSessionCache();
    res.json({
      imported: true,
      credentials: {
        geminiApiKey: parsed.geminiApiKey,
        intervalsApiKey: parsed.intervalsApiKey,
        intervalsAthleteId: parsed.intervalsAthleteId || "0",
        stravaClientId: parsed.stravaClientId,
        stravaClientSecret: parsed.stravaClientSecret,
        stravaRefreshToken: parsed.stravaRefreshToken,
        stravaAccessToken: parsed.stravaAccessToken,
        mapTileProvider: parsed.mapTileProvider,
        mapTileApiKey: parsed.mapTileApiKey
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? `Invalid Connection Bundle format: ${err.message}` : "Failed to parse Connection Bundle."
    });
  }
});
configRouter.get(["/api/index", "/api"], (req, res, next) => {
  if (req.query.code || req.query.error && req.query.state !== void 0) {
    void stravaCallbackHandler(req, res);
    return;
  }
  next();
});
configRouter.post("/api/auth/logout", async (req, res) => {
  try {
    const wasAuthenticated = isAuthenticatedRequest(req);
    const scopeKey = resolveSessionScopeKey(req);
    clearSessionCookie(res);
    clearOAuthStateCookie(res);
    appendSetCookieHeader(res, buildClearVaultCookieHeader());
    appendSetCookieHeader(res, buildClearUserCookieHeader());
    const clearCredentials = Boolean(req.body?.clearCredentials) && wasAuthenticated;
    if (clearCredentials) {
      runtimeStore.stravaAccessToken = "";
      runtimeStore.stravaRefreshToken = "";
      runtimeStore.stravaExpiresAt = 0;
      runtimeStore.stravaAthleteId = void 0;
      runtimeStore.stravaAthleteName = "";
      runtimeStore.stravaMeasurementPreference = void 0;
      runtimeStore.stravaGrantedScope = void 0;
      runtimeStore.stravaSyncPolicy = void 0;
      runtimeStore.intervalsApiKey = "";
      runtimeStore.intervalsAthleteId = "0";
      runtimeStore.intervalsAthleteName = "";
      if (scopeKey) {
        scopedStoresInMemory.delete(scopeKey);
        hydratedReqScopeMap.delete(req);
        await Promise.all([
          deleteTenantVault(`session_${scopeKey}`),
          clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey)
        ]);
        try {
          const sessionPath = getScopedSessionFilePath(scopeKey);
          if (fs7.existsSync(sessionPath)) fs7.unlinkSync(sessionPath);
        } catch {
        }
      }
    }
    res.json({
      ok: true,
      clearedCredentials: clearCredentials
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to log out session."
    });
  }
});

// server/routers/garminRouter.ts
import { Router as Router7 } from "express";
var garminRouter = Router7();
garminRouter.post("/api/config/garmin", async (req, res) => {
  try {
    const body = req.body || {};
    const session = await authenticateGarminConnect({
      personalApiKey: body.personalApiKey,
      email: body.email,
      password: body.password,
      directBearerToken: body.directBearerToken,
      oauth1Token: body.oauth1Token,
      oauth1TokenSecret: body.oauth1TokenSecret
    });
    const sessionToken = setSessionCookie(
      req,
      res,
      session.fullName || session.displayName || "garmin-athlete"
    );
    const createdClaims = decodeAndVerifyToken(sessionToken);
    const scopeKey = createdClaims?.sid?.slice(0, 24) || getGarminScopeKey(req);
    await saveGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey, session);
    const garminData = await fetchDirectGarminProfileAndWellness(session, 28).catch(
      () => null
    );
    await saveGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey, session);
    await saveSessionCacheAsync(req, res, createdClaims?.sid);
    const stravaIdentity = await resolveStravaAthleteIdentity(req).catch(() => null);
    const sId = String(stravaIdentity?.athleteId || "").replace(/[^0-9]/g, "");
    const sActs = sId ? loadJsonFile(`/tmp/aeropulse-strava-archive-${sId}.json`, []) : [];
    const normalizedGarminActs = garminData?.activities ? normalizeGarminPersonalApiActivities(garminData.activities, 250) : [];
    const latestW = garminData?.wellnessRows && garminData.wellnessRows.length > 0 ? {
      ...garminData.wellnessRows[garminData.wellnessRows.length - 1],
      weightKg: garminData.rawProfile?.weight,
      restingHR: garminData.rawProfile?.icu_resting_hr
    } : {
      weightKg: garminData?.rawProfile?.weight,
      restingHR: garminData?.rawProfile?.icu_resting_hr
    };
    const syncedProfile = buildServerAthleteProfile(
      {
        ...garminData?.rawProfile || {},
        name: garminData?.rawProfile?.name || session.fullName || session.displayName || stravaIdentity?.athleteName,
        source: "INTERVALS_GARMIN"
      },
      latestW,
      [...normalizedGarminActs, ...sActs]
    );
    res.json({
      ok: true,
      garminConnected: true,
      garminAthleteName: garminData?.rawProfile?.name || session.fullName || session.displayName || syncedProfile.name,
      athleteProfile: syncedProfile,
      sessionToken,
      garminTokens: {
        personalApiKey: session.personalApiKey,
        oauth2AccessToken: session.oauth2AccessToken,
        oauth1Token: session.oauth1Token,
        oauth1TokenSecret: session.oauth1TokenSecret
      }
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to authenticate with Garmin Connect"
    });
  }
});
garminRouter.get("/api/garmin/sync", async (req, res) => {
  try {
    const session = getActiveGarminSession(req);
    if (!session) {
      res.status(401).json({ error: "Garmin Connect is not connected." });
      return;
    }
    const garminData = await fetchDirectGarminProfileAndWellness(session, 28);
    const scopeKey = getGarminScopeKey(req);
    if (scopeKey !== "unauthenticated") {
      saveGarminSession(GARMIN_SESSION_DIR, scopeKey, session);
    }
    const stravaIdentity = await resolveStravaAthleteIdentity(req).catch(() => null);
    const sId = String(stravaIdentity?.athleteId || "").replace(/[^0-9]/g, "");
    const sActs = sId ? loadJsonFile(`/tmp/aeropulse-strava-archive-${sId}.json`, []) : [];
    const prelimActivities = normalizeGarminPersonalApiActivities(
      garminData.activities || [],
      runtimeStore.athleteFtp || 250
    );
    const latestW = garminData.wellnessRows && garminData.wellnessRows.length > 0 ? {
      ...garminData.wellnessRows[garminData.wellnessRows.length - 1],
      weightKg: garminData.rawProfile?.weight,
      restingHR: garminData.rawProfile?.icu_resting_hr
    } : {
      weightKg: garminData.rawProfile?.weight,
      restingHR: garminData.rawProfile?.icu_resting_hr
    };
    const syncedProfile = buildServerAthleteProfile(
      {
        ...garminData.rawProfile || {},
        name: garminData.rawProfile?.name || session.fullName || session.displayName || stravaIdentity?.athleteName,
        source: "INTERVALS_GARMIN"
      },
      latestW,
      [...prelimActivities, ...sActs]
    );
    const normalizedActivities = normalizeGarminPersonalApiActivities(
      garminData.activities || [],
      syncedProfile.ftp || 250,
      {
        lthr: syncedProfile.lthr,
        runLthr: syncedProfile.runLthr,
        thresholdPaceSecsPerKm: syncedProfile.thresholdPaceSecsPerKm,
        restingHr: syncedProfile.restingHr
      }
    );
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    await saveSessionCacheAsync(req, res);
    const loadByDate = /* @__PURE__ */ new Map();
    const garminActivitiesList = [];
    for (const a of normalizedActivities) {
      const d = String(a.startDateLocal || "").slice(0, 10);
      if (d) {
        loadByDate.set(d, (loadByDate.get(d) || 0) + Number(a.trainingLoad || 0));
      }
      if (resolveActivityStartEpochMs(a) > 0) {
        garminActivitiesList.push(a);
      }
    }
    const stravaCal = {
      calibratedFtp: Math.max(120, syncedProfile.ftp || 250),
      calibratedBikeLthr: Math.max(135, syncedProfile.lthr || 163),
      calibratedRunLthr: Math.max(140, syncedProfile.runLthr || 168),
      calibratedThresholdPaceSecsPerKm: Math.max(
        155,
        syncedProfile.thresholdPaceSecsPerKm || 255
      ),
      restingHr: Math.max(38, Math.min(78, syncedProfile.restingHr || 52))
    };
    for (const rawSa of sActs) {
      if (!rawSa || !rawSa.start_date_local && !rawSa.start_date) continue;
      const saNorm = normalizeRawStravaActivity(rawSa, stravaCal);
      const isDup = garminActivitiesList.some(
        (gAct) => areActivityTimestampsClose(gAct, saNorm, 300)
      );
      if (isDup) continue;
      const d = saNorm.startDateLocal.slice(0, 10);
      if (d) {
        loadByDate.set(d, (loadByDate.get(d) || 0) + Number(saNorm.trainingLoad || 0));
      }
    }
    let lastRhr = syncedProfile.restingHr || 0;
    let lastWeight = syncedProfile.weightKg || 0;
    let ctlRaw = 0;
    let atlRaw = 0;
    const wellnessRows = garminData.wellnessRows || [];
    const firstWellnessDate = wellnessRows.length > 0 ? String(wellnessRows[0].id || "").slice(0, 10) : getLocalDateIso();
    const warmupStartDate = shiftIsoDate(firstWellnessDate, -365);
    for (let dWarm = warmupStartDate; dWarm < firstWellnessDate; dWarm = shiftIsoDate(dWarm, 1)) {
      const warmLoad = loadByDate.get(dWarm) || 0;
      ctlRaw = ctlRaw * BANISTER_CTL_DECAY + warmLoad * (1 - BANISTER_CTL_DECAY);
      atlRaw = atlRaw * BANISTER_ATL_DECAY + warmLoad * (1 - BANISTER_ATL_DECAY);
    }
    const ctlHistory = [];
    const formattedWellnessDays = wellnessRows.map((w, idx) => {
      const d = String(w.id || "").slice(0, 10);
      const dailyLoad = loadByDate.get(d) || 0;
      ctlRaw = ctlRaw * BANISTER_CTL_DECAY + dailyLoad * (1 - BANISTER_CTL_DECAY);
      atlRaw = atlRaw * BANISTER_ATL_DECAY + dailyLoad * (1 - BANISTER_ATL_DECAY);
      const ctl = Number(ctlRaw.toFixed(1));
      const atl = Number(atlRaw.toFixed(1));
      ctlHistory.push(ctl);
      const ctl7dAgo = idx >= 7 ? ctlHistory[idx - 7] : ctlHistory[0] || 0;
      const rampRate = Number((ctl - ctl7dAgo).toFixed(1));
      const tsb = Number((ctlRaw - atlRaw).toFixed(1));
      const loadRatio = ctl > 0 ? Number((atlRaw / ctlRaw).toFixed(2)) : 0;
      if (Number(w.restingHR) >= 30) lastRhr = Math.round(Number(w.restingHR));
      if (Number(w.weight) >= 35) lastWeight = Number(Number(w.weight).toFixed(1));
      const hrv = Math.round(Number(w.hrv || 0));
      const baseline7d = Math.round(Number(w.hrvBaseline7d || hrv || 0));
      const hrvLow = baseline7d > 0 ? Math.round(Number(w.hrvNormalLow || Math.max(20, baseline7d * 0.88))) : 0;
      const hrvHigh = baseline7d > 0 ? Math.round(Number(w.hrvNormalHigh || Math.max(hrvLow + 8, baseline7d * 1.15))) : 0;
      const rawStatus = String(w.garminHrvStatus || "").toUpperCase();
      const hrvStatus = rawStatus === "BALANCED" ? "Balanced" : rawStatus === "UNBALANCED" ? "Unbalanced" : rawStatus === "LOW" ? "Low" : rawStatus === "POOR" ? "Poor" : hrv > 0 && hrvLow > 0 && hrv < hrvLow ? "Low" : "Balanced";
      const sleepSecs = Math.round(Number(w.sleepSecs || 0));
      const sleepScore = Math.round(Number(w.sleepScore || 0));
      const sleepQuality = sleepScore >= 85 ? "Excellent" : sleepScore >= 75 ? "Good" : sleepScore >= 60 ? "Fair" : "Poor";
      return {
        date: d,
        ctl,
        atl,
        tsb,
        loadRatio,
        rampRate,
        hrvRMSSD: hrv,
        hrvBaseline7d: baseline7d,
        hrvNormalBandLow: hrvLow,
        hrvNormalBandHigh: hrvHigh,
        hrvStatus,
        restingHR: lastRhr,
        sleepSecs,
        sleepScore,
        sleepQuality,
        sleepDebt7dSecs: Math.max(0, 7.8 * 3600 - sleepSecs),
        weightKg: lastWeight,
        vo2MaxCycling: syncedProfile.vo2MaxCycling,
        vo2MaxRunning: syncedProfile.vo2MaxRunning,
        steps: w.steps != null ? Number(w.steps) : void 0,
        rideEftp: syncedProfile.eFtp,
        rideWPrime: syncedProfile.wPrime,
        ridePMax: syncedProfile.pMax,
        runEftp: syncedProfile.runEFtp,
        garminTrainingStatus: hrvStatus === "Low" ? "Strained" : "Productive",
        trainingStatusReason: `Synced directly via Garmin Connect Personal API (HRV ${hrv || baseline7d} ms \xB7 ${hrvStatus}, RHR ${lastRhr} bpm).`,
        readinessStatus: hrvStatus === "Low" ? "Strain" : hrvStatus === "Unbalanced" ? "Caution" : "Optimal",
        dailyLoad
      };
    });
    res.json({
      ok: true,
      garminAthleteName: syncedProfile.name,
      athleteProfile: syncedProfile,
      wellnessDays: formattedWellnessDays,
      activities: normalizedActivities
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to sync Garmin Connect Personal API"
    });
  }
});
garminRouter.delete("/api/config/garmin", async (req, res) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: "Authentication required to disconnect Garmin Connect." });
    return;
  }
  const scopeKey = getGarminScopeKey(req);
  if (scopeKey !== "unauthenticated") {
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
  }
  res.json({ ok: true, garminConnected: false });
});
garminRouter.post("/api/garmin/workout/push", async (req, res) => {
  try {
    const session = getActiveGarminSession(req);
    if (!session) {
      res.status(400).json({
        error: "Garmin Connect is not connected yet. Connect your Garmin account in Data Sources first."
      });
      return;
    }
    const body = req.body || {};
    const date = String(body.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).slice(0, 10);
    const name = String(body.name || "THRESH Daily Prescription");
    const sportCategory = body.sportCategory || "Cycling";
    const ftpWatts = Number(body.ftpWatts || runtimeStore.athleteProfile?.ftp || 250);
    const lthrBpm = Number(body.lthrBpm || runtimeStore.athleteProfile?.lthr || 165);
    const workoutSyntax = String(body.workoutSyntax || "");
    const plannedDurationSecs = Number(body.plannedDurationSecs || 3600);
    const parsedSteps = Array.isArray(body.steps) && body.steps.length > 0 ? body.steps : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs).map((st) => ({
      label: st.label,
      durationSecs: st.durationSecs || 600,
      targetPctFtp: st.targetPctFtp || 75
    }));
    const pushRes = await pushWorkoutToGarminConnect(session, {
      date,
      name,
      sportCategory,
      description: body.description || workoutSyntax,
      ftpWatts,
      lthrBpm,
      steps: parsedSteps
    });
    saveGarminSession(GARMIN_SESSION_DIR, getGarminScopeKey(req), session);
    res.json(pushRes);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to push workout to Garmin Connect"
    });
  }
});
garminRouter.post("/api/garmin/disconnect", async (req, res) => {
  const scopeKey = getGarminScopeKey(req);
  if (scopeKey && scopeKey !== "unauthenticated") {
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});

// server/routers/webhookRouter.ts
import express8 from "express";
import fs8 from "fs";
async function executeHourlyBackgroundPoll() {
  const results = {
    triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
    intervalsPolled: false,
    stravaPolled: false
  };
  const { apiKey, athleteId } = getEffectiveIntervalsConfig();
  if (apiKey) {
    try {
      const intData = await syncIntervalsAllHistory(apiKey, athleteId);
      results.intervalsPolled = true;
      results.intervalsActivitiesCount = intData.activities.length;
      results.intervalsWellnessCount = intData.wellnessDays.length;
    } catch (e) {
      results.intervalsError = e instanceof Error ? e.message : "Intervals poll error";
    }
  }
  if (runtimeStore.stravaAccessToken && runtimeStore.stravaSyncPolicy?.window !== "none") {
    try {
      const stravaData = await syncStravaAllHistory(void 0, false);
      results.stravaPolled = true;
      results.stravaActivitiesCount = stravaData.activities.length;
    } catch (e) {
      results.stravaError = e instanceof Error ? e.message : "Strava poll error";
    }
  }
  runtimeStore.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1e3).toISOString();
  await saveSessionCacheAsync();
  return results;
}
var webhookRouter = express8.Router();
webhookRouter.all("/api/cron/hourly-sync", async (req, res) => {
  if (!hasValidCronAuthorization(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized cron invocation." });
    return;
  }
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Background sync failed"
    });
  }
});
webhookRouter.post("/api/webhooks/intervals", async (req, res) => {
  const intervalsSecret = String(process.env.INTERVALS_WEBHOOK_SECRET || "").trim();
  const cronSecretConfigured = Boolean((process.env.CRON_SECRET || "").trim());
  const suppliedSecret = String(
    req.headers["x-intervals-webhook-secret"] || req.query.secret || ""
  ).trim();
  const hasIntervalsSecret = Boolean(
    intervalsSecret && suppliedSecret && timingSafeStringEqual(suppliedSecret, intervalsSecret)
  );
  if (isProductionDeployment() && !intervalsSecret && !cronSecretConfigured) {
    res.status(503).json({ ok: false, error: "Intervals webhook authentication is not configured." });
    return;
  }
  const hasConfiguredCronAuth = Boolean(cronSecretConfigured && hasValidCronAuthorization(req));
  if (!hasConfiguredCronAuth && !hasIntervalsSecret) {
    res.status(401).json({ ok: false, error: "Unauthorized Intervals webhook invocation." });
    return;
  }
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: "intervals-webhook",
      eventsReceived: Array.isArray(req.body?.events) ? req.body.events.length : 1,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Intervals webhook sync failed"
    });
  }
});
webhookRouter.get("/api/webhooks/strava", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = String(req.query["hub.verify_token"] || "").trim();
  const expectedVerifyToken = String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (mode === "subscribe" && challenge) {
    if (!expectedVerifyToken && isProductionDeployment()) {
      res.status(503).json({ ok: false, error: "Strava webhook verify token is not configured." });
      return;
    }
    if (expectedVerifyToken && (!verifyToken || !timingSafeStringEqual(verifyToken, expectedVerifyToken))) {
      res.status(403).json({ ok: false, error: "Invalid Strava webhook verify_token." });
      return;
    }
    res.json({ "hub.challenge": challenge });
    return;
  }
  res.json({ ok: true, status: "Strava webhook endpoint ready" });
});
webhookRouter.post("/api/webhooks/strava", async (req, res) => {
  try {
    const expectedSubId = String(process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID || "").trim();
    if (!expectedSubId && isProductionDeployment()) {
      res.status(503).json({ ok: false, error: "Strava webhook subscription ID is not configured." });
      return;
    }
    if (expectedSubId) {
      const incomingSubId = String(req.body?.subscription_id ?? "").trim();
      if (!incomingSubId || !timingSafeStringEqual(incomingSubId, expectedSubId)) {
        res.status(403).json({ ok: false, error: "Invalid Strava webhook subscription_id." });
        return;
      }
    }
    const aspectType = String(req.body?.aspect_type || "").toLowerCase();
    const objectType = String(req.body?.object_type || "").toLowerCase();
    const objectId = extractStravaId(req.body, "object_id_str", "object_id");
    const ownerId = extractStravaId(req.body, "owner_id_str", "owner_id");
    const updates = req.body?.updates;
    if (ownerId && objectType === "athlete" && (String(updates?.authorized || "").toLowerCase() === "false" || aspectType === "delete")) {
      const scopeKey = deriveStravaSessionSid(ownerId).slice(0, 24);
      const vaultDoc = await loadTenantVaultAsync(
        `session_${scopeKey}`,
        null
      );
      if (vaultDoc) {
        vaultDoc.stravaAccessToken = "";
        vaultDoc.stravaRefreshToken = "";
        vaultDoc.stravaExpiresAt = 0;
        vaultDoc.stravaAthleteId = void 0;
        await saveTenantVaultAsync(`session_${scopeKey}`, vaultDoc);
      }
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${ownerId}.json`;
        if (fs8.existsSync(archivePath)) fs8.unlinkSync(archivePath);
      } catch {
      }
      res.json({ ok: true, source: "strava-webhook", handled: "athlete-deauthorize", ownerId });
      return;
    }
    if (ownerId && objectType === "activity" && aspectType === "delete" && objectId) {
      let removedFromArchive = false;
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${ownerId}.json`;
        if (fs8.existsSync(archivePath)) {
          const parsed = JSON.parse(fs8.readFileSync(archivePath, "utf8"));
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
              (a) => String(a?.id || "") !== objectId && String(a?.stravaId || "") !== objectId
            );
            if (filtered.length !== parsed.length) {
              fs8.writeFileSync(archivePath, JSON.stringify(filtered), {
                encoding: "utf8",
                mode: 384
              });
              removedFromArchive = true;
            }
          }
        }
      } catch {
      }
      res.json({
        ok: true,
        source: "strava-webhook",
        handled: "activity-delete",
        objectId,
        ownerId,
        removedFromArchive
      });
      return;
    }
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: "strava-webhook",
      aspectType: req.body?.aspect_type,
      objectId: objectId || void 0,
      ownerId: ownerId || void 0,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Strava webhook sync failed"
    });
  }
});

// server/apiRouter.ts
var apiRouter = express9.Router();
apiRouter.use(securityHeadersMiddleware);
apiRouter.use(express9.urlencoded({ extended: false }));
apiRouter.use((req, res, next) => {
  responseByReq.set(req, res);
  requestContext.run(req, () => {
    const scopeKey = resolveSessionScopeKey(req);
    if (scopeKey && process.env.DATABASE_URL?.trim()) {
      Promise.all([
        loadTenantVaultAsync(`session_${scopeKey}`, {}),
        loadTenantVaultAsync(`garmin_${scopeKey}`, null)
      ]).then(() => next()).catch(() => next());
      return;
    }
    next();
  });
});
apiRouter.use(vaultAndPhysiologyRouter);
apiRouter.use(athleteStateRouter);
apiRouter.use(webhooksAndExportRouter);
apiRouter.use(teamRouter);
apiRouter.use(teamSyncRouter);
apiRouter.use(authRouter);
apiRouter.use(configRouter);
apiRouter.use(garminRouter);
apiRouter.use(wahooRouter);
apiRouter.use(polarRouter);
apiRouter.use(intervalsRouter);
apiRouter.use(stravaRouter);
apiRouter.use(activitiesRouter);
apiRouter.use(coachRouter);
apiRouter.use(webhookRouter);

// server/vercelApp.ts
var app = express10();
app.disable("x-powered-by");
app.use(securityHeadersMiddleware);
app.use(
  express10.json({
    limit: "2mb",
    reviver: strava64BitJsonReviver
  })
);
app.use(express10.urlencoded({ extended: false }));
app.use(apiRouter);
var vercelApp_default = app;
export {
  vercelApp_default as default
};
