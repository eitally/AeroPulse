// server/vercelApp.ts
import "dotenv/config";
import express4 from "express";

// server/apiRouter.ts
import express3 from "express";
import { AsyncLocalStorage } from "async_hooks";
import crypto5 from "crypto";
import fs4 from "fs";
import { GoogleGenAI, Type } from "@google/genai";

// server/garminConnectService.ts
import crypto2 from "crypto";
import fs2 from "fs";
import path from "path";

// server/tokenVault.ts
import crypto from "crypto";
import fs from "fs";
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
    derivedKeyCache = crypto.scryptSync(rawSecret, "thresh-vault-v1-salt", 32);
    return derivedKeyCache;
  }
  if (process.env.NODE_ENV === "production" && !warnedMissingVaultKey) {
    warnedMissingVaultKey = true;
    console.warn(
      "[THRESH Security] TOKEN_VAULT_KEY / SESSION_SECRET not set in production; deriving fallback vault key."
    );
  }
  const fallbackSeed = `thresh-local-vault:${os.hostname()}:${os.userInfo().username}`;
  derivedKeyCache = crypto.scryptSync(fallbackSeed, "thresh-dev-vault-salt", 32);
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
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
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
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
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
function getPostgresPool() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: dbUrl,
      max: 5,
      idleTimeoutMillis: 15e3,
      connectionTimeoutMillis: 5e3,
      ssl: dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1") ? void 0 : { rejectUnauthorized: false }
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
      `);
      pgSchemaInitialized = true;
    })().catch((err) => {
      pgSchemaPromise = null;
      throw err;
    });
  }
  await pgSchemaPromise;
}
var memoryVaultCache = /* @__PURE__ */ new Map();
function getEncryptedVaultFilePath(tenantId) {
  return `${VAULT_FILE_PREFIX}${sanitizeTenantId(tenantId)}.enc`;
}
function loadTenantVaultSync(tenantId, fallback) {
  const safeId = sanitizeTenantId(tenantId);
  const cached = memoryVaultCache.get(safeId);
  if (cached && Date.now() - cached.updatedAtMs < 5 * 60 * 1e3) {
    return structuredClone(cached.value);
  }
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs.existsSync(encPath)) {
      const envelope = fs.readFileSync(encPath, "utf8").trim();
      const decrypted = decryptJsonFromVault(envelope);
      if (decrypted !== null) {
        memoryVaultCache.set(safeId, { value: decrypted, updatedAtMs: Date.now() });
        return structuredClone(decrypted);
      }
    }
  } catch {
  }
  return structuredClone(fallback);
}
function saveTenantVaultSync(tenantId, data) {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.set(safeId, { value: structuredClone(data), updatedAtMs: Date.now() });
  const envelope = encryptJsonForVault(data);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs.writeFileSync(encPath, envelope, { encoding: "utf8", mode: 384 });
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
          memoryVaultCache.set(safeId, { value: decrypted, updatedAtMs: Date.now() });
          try {
            fs.writeFileSync(getEncryptedVaultFilePath(safeId), result.rows[0].encrypted_envelope, {
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
  memoryVaultCache.set(safeId, { value: structuredClone(data), updatedAtMs: Date.now() });
  const envelope = encryptJsonForVault(data);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    fs.writeFileSync(encPath, envelope, { encoding: "utf8", mode: 384 });
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
var VAULT_COOKIE_TTL_SECS = 30 * 24 * 60 * 60;
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
async function deleteTenantVault(tenantId) {
  const safeId = sanitizeTenantId(tenantId);
  memoryVaultCache.delete(safeId);
  try {
    const encPath = getEncryptedVaultFilePath(safeId);
    if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
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
    oauth_nonce: crypto2.randomBytes(16).toString("hex"),
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
  const signature = crypto2.createHmac("sha1", signingKey).update(baseString).digest("base64");
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
    if (fs2.existsSync(filePath)) {
      const raw = fs2.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      saveTenantVaultSync(vaultTenantKey, parsed);
      fs2.unlinkSync(filePath);
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
    if (fs2.existsSync(filePath)) {
      fs2.unlinkSync(filePath);
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
    description: (input.description || "Prescribed by Thresh Readiness Engine").slice(
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
  const endDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
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
function normalizeGarminPersonalApiActivities(rawActivities, ftpWatts = 250) {
  if (!Array.isArray(rawActivities)) return [];
  const activeFtp = Math.max(100, Number(ftpWatts || 250));
  return rawActivities.filter((a) => a && (a.activityId || a.id)).map((a) => {
    const id = String(a.activityId || a.id);
    const typeKey = String(
      a.activityType?.typeKey || a.activityType?.parentTypeId || a.type || ""
    ).toLowerCase();
    const name = String(a.activityName || a.name || typeKey || "Garmin Activity");
    const combined = `${typeKey} ${name}`.toLowerCase();
    let sportCategory = "Strength";
    if (/cycling|ride|biking|virtual_ride|indoor_cycling|road_biking|gravel|mountain_biking|zwift|peloton|spin/i.test(
      combined
    )) {
      sportCategory = "Cycling";
    } else if (/running|run|treadmill|trail_running|track_running|virtual_run/i.test(combined)) {
      sportCategory = "Running";
    } else if (/swimming|swim|lap_swimming|open_water/i.test(combined)) {
      sportCategory = "Swimming";
    } else if (/multi_sport|triathlon|duathlon/i.test(combined)) {
      sportCategory = "Multisport";
    }
    const startLat = Number(a.startLatitude ?? 0);
    const startLng = Number(a.startLongitude ?? 0);
    const isWatopiaOrMakuri = startLat >= -12.6 && startLat <= -9.8 && startLng >= 164.8 && startLng <= 168;
    const isVirtualPlatform = isWatopiaOrMakuri || /virtual_ride|virtual|zwift|watopia|makuri|rouvy|mywhoosh|trainerroad/i.test(combined);
    const isIndoor = isVirtualPlatform || /indoor|treadmill|virtual|trainer|spin|peloton|gym|strength|yoga/i.test(combined) || sportCategory === "Cycling" && !startLat && !startLng;
    let subType = "Road";
    if (sportCategory === "Cycling") {
      if (isVirtualPlatform) subType = "Virtual Cycling";
      else if (isIndoor) subType = "Smart Trainer";
      else if (/gravel/i.test(combined)) subType = "Gravel";
      else if (/mountain|mtb|trail/i.test(combined)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Running") {
      if (isIndoor) subType = "Treadmill";
      else if (/trail/i.test(combined)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Swimming") {
      subType = /open_water/i.test(combined) ? "Open Water" : "Pool";
    } else {
      subType = "Gym";
    }
    const movingTimeSecs = Math.round(
      Number(a.movingDuration ?? a.duration ?? a.elapsedDuration ?? 0)
    );
    const distanceMeters = Math.round(Number(a.distance ?? 0));
    const elevationGainMeters = Math.round(Number(a.elevationGain ?? 0));
    const avgPower = Number(a.avgPower) > 0 ? Math.round(Number(a.avgPower)) : void 0;
    const normalizedPower = Number(a.normPower) > 0 ? Math.round(Number(a.normPower)) : avgPower;
    const rawMaxPower = Number(a.maxPower ?? a.maxAvgPower_1 ?? 0);
    const maxPower = rawMaxPower > 0 ? Math.round(rawMaxPower) : void 0;
    const rawMax20m = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
    const max20MinPower = rawMax20m > 0 ? Math.round(rawMax20m) : void 0;
    const fastestSplit1000 = Number(a.fastestSplit_1000) > 0 ? Math.round(Number(a.fastestSplit_1000)) : void 0;
    const fastestSplit1609 = Number(a.fastestSplit_1609) > 0 ? Math.round(Number(a.fastestSplit_1609)) : void 0;
    const fastestSplit5000 = Number(a.fastestSplit_5000) > 0 ? Math.round(Number(a.fastestSplit_5000)) : void 0;
    const avgHr = Math.round(Number(a.averageHR ?? 0));
    const maxHr = Math.round(Number(a.maxHR ?? 0));
    const avgCadence = Number(a.averageBikingCadenceInRevPerMinute) > 0 ? Math.round(Number(a.averageBikingCadenceInRevPerMinute)) : Number(a.averageRunningCadenceInStepsPerMinute) > 0 ? Math.round(Number(a.averageRunningCadenceInStepsPerMinute)) : void 0;
    const intensityFactor = normalizedPower && activeFtp > 0 ? Number((normalizedPower / activeFtp).toFixed(2)) : void 0;
    let trainingLoad = Math.round(Number(a.activityTrainingLoad ?? 0));
    if (!trainingLoad && normalizedPower && movingTimeSecs > 0) {
      const ifVal = normalizedPower / activeFtp;
      trainingLoad = Math.round(
        movingTimeSecs * normalizedPower * ifVal / (activeFtp * 3600) * 100
      );
    } else if (!trainingLoad && avgHr > 0 && movingTimeSecs > 0) {
      trainingLoad = Math.round(movingTimeSecs / 3600 * Math.pow(avgHr / 153, 2) * 65);
    }
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
    const efficiencyFactor = normalizedPower && avgHr > 0 ? Number((normalizedPower / avgHr).toFixed(2)) : 0;
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
    const startDateLocal = String(a.startTimeLocal || a.startTimeGMT || "").trim().replace(" ", "T");
    const startLatLng = Math.abs(startLat) > 0.01 && Math.abs(startLng) > 0.01 ? [Number(startLat.toFixed(5)), Number(startLng.toFixed(5))] : void 0;
    const endLat = Number(a.endLatitude ?? 0);
    const endLng = Number(a.endLongitude ?? 0);
    const endLatLng = Math.abs(endLat) > 0.01 && Math.abs(endLng) > 0.01 ? [Number(endLat.toFixed(5)), Number(endLng.toFixed(5))] : void 0;
    return {
      id: `garmin-${id}`,
      garminId: id,
      startDateLocal,
      name,
      sportCategory,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      subType,
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters,
      avgPower,
      normalizedPower,
      max_watts: maxPower,
      max20MinPower,
      fastestSplit_1000: fastestSplit1000,
      fastestSplit_1609: fastestSplit1609,
      fastestSplit_5000: fastestSplit5000,
      intensityFactor,
      trainingLoad,
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

// server/securityUtils.ts
import crypto3 from "crypto";
import dns from "dns";
import fs3 from "fs";
import net from "net";
var SESSION_SECRET_FILE = "/tmp/thresh-session-secret.key";
var SESSION_COOKIE_NAME = "thresh_session";
var LEGACY_SESSION_COOKIE_NAME = "aeropulse_session";
var OAUTH_STATE_COOKIE_NAME = "thresh_oauth_state";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var OAUTH_STATE_TTL_MS = 15 * 60 * 1e3;
var cachedSecret = null;
function getSessionSecret() {
  if (cachedSecret) return cachedSecret;
  const envSecret = (process.env.SESSION_SECRET || process.env.TOKEN_VAULT_KEY || process.env.OAUTH_ENCRYPTION_KEY || process.env.STRAVA_CLIENT_SECRET || process.env.CRON_SECRET || "").trim();
  if (envSecret && envSecret.length >= 16) {
    cachedSecret = crypto3.createHash("sha256").update(`thresh:${envSecret}`).digest("hex");
    return cachedSecret;
  }
  try {
    if (fs3.existsSync(SESSION_SECRET_FILE)) {
      const existing = fs3.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
      if (existing.length >= 32) {
        cachedSecret = existing;
        return cachedSecret;
      }
    }
    const generated = crypto3.randomBytes(32).toString("hex");
    fs3.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: "utf8", mode: 384 });
    cachedSecret = generated;
    return cachedSecret;
  } catch {
    cachedSecret = crypto3.randomBytes(32).toString("hex");
    return cachedSecret;
  }
}
function deriveStravaSessionSid(stravaAthleteId) {
  const cleanId = String(stravaAthleteId || "").trim().replace(/[^0-9a-zA-Z_-]/g, "");
  if (!cleanId) {
    return crypto3.randomBytes(16).toString("hex");
  }
  return crypto3.createHmac("sha256", getSessionSecret()).update(`thresh_strava_sid_v1:${cleanId}`).digest("hex").slice(0, 32);
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
  const nonce = input.nonce && /^[a-f0-9_-]{12,64}$/i.test(input.nonce) ? input.nonce : crypto3.randomBytes(16).toString("hex");
  const claims = {
    nonce,
    sid: input.sid,
    flow: input.flow || "redirect",
    mode: input.mode,
    joinCode: input.joinCode,
    slug: input.slug,
    inviteToken: input.inviteToken,
    exp: Date.now() + OAUTH_STATE_TTL_MS
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = crypto3.createHmac("sha256", getSessionSecret()).update(`oauth_state:${payload}`).digest("base64url");
  return { stateToken: `${payload}.${sig}`, nonce };
}
function verifyOAuthStateToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expectedSig = crypto3.createHmac("sha256", getSessionSecret()).update(`oauth_state:${payload}`).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto3.timingSafeEqual(sigBuf, expectedBuf)) {
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
function issueSessionToken(subject = "authenticated", existingSid) {
  const sid = existingSid && /^[a-f0-9]{24,64}$/i.test(existingSid) ? existingSid : crypto3.randomBytes(16).toString("hex");
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sid, sub: subject, exp }), "utf8").toString(
    "base64url"
  );
  const sig = crypto3.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function decodeAndVerifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expectedSig = crypto3.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto3.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    const sub = String(decoded.sub || "authenticated");
    const sid = decoded.sid && /^[a-f0-9]{16,64}$/i.test(decoded.sid) ? decoded.sid : crypto3.createHash("sha256").update(`${sub}:${sig}`).digest("hex").slice(0, 32);
    return { sid, sub, exp: decoded.exp };
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
function setSessionCookie(req, res, subject = "authenticated", explicitSid) {
  const existing = getVerifiedSessionClaims(req);
  const token = issueSessionToken(subject, explicitSid || existing?.sid);
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
  return a.length === b.length && crypto3.timingSafeEqual(a, b);
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
  const reqPath = req.path || req.url || "";
  if (reqPath.startsWith("/api/") || reqPath.startsWith("/auth/") || reqPath.includes("/config") || reqPath.includes("/auth")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

// server/cleanRoomFirewall.ts
function isStravaOriginRecord(item) {
  if (!item || typeof item !== "object") return false;
  const obj = item;
  const src = String(
    obj.source || obj.ingestionSource || obj.externalSource || obj.id || ""
  ).toLowerCase();
  const badges = Array.isArray(obj.sourceBadges) ? obj.sourceBadges.map((b) => String(b).toLowerCase()) : [];
  const hasFirstPartyHardware = badges.some(
    (b) => b.includes("garmin") || b.includes("fit") || b.includes("wahoo") || b.includes("coros")
  );
  if (Boolean(obj.stravaId) && !hasFirstPartyHardware) return true;
  if (src.includes("strava") && !hasFirstPartyHardware) return true;
  if (badges.includes("strava") && !hasFirstPartyHardware) return true;
  return false;
}
function sanitizeTelemetryForCleanRoom(rawSummary) {
  if (!rawSummary || typeof rawSummary !== "object") return {};
  const clone = { ...rawSummary };
  let strippedCount = 0;
  for (const key of ["recentActivities", "activities", "workouts", "completedActivities"]) {
    if (Array.isArray(clone[key])) {
      const before = clone[key].length;
      clone[key] = clone[key].filter((item) => !isStravaOriginRecord(item));
      strippedCount += before - clone[key].length;
    }
  }
  delete clone.stravaSegments;
  delete clone.stravaKudos;
  delete clone.stravaAthleteId;
  delete clone.segmentEfforts;
  clone.cleanRoomPolicy = "FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY";
  clone.stravaRecordsFiltered = strippedCount;
  return clone;
}

// server/teamService.ts
import crypto4 from "crypto";

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
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
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
      const tMins = totalSecs / 60;
      const vMetersPerMin = distMeters / tMins;
      const vo2 = -4.6 + 0.182258 * vMetersPerMin + 104e-6 * vMetersPerMin * vMetersPerMin;
      const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMins) + 0.2989558 * Math.exp(-0.1932605 * tMins);
      const rawVdot = vo2 / pctMax;
      const effectiveVdot = distMeters <= 1610 ? rawVdot * 0.975 : rawVdot;
      const vdot = Math.max(28, Math.min(86, Number(effectiveVdot.toFixed(1))));
      const solvePaceSecsPerKmForPctVo2 = (pctVo2) => {
        const targetVo2 = vdot * pctVo2;
        const a = 104e-6;
        const b = 0.182258;
        const c = -4.6 - targetVo2;
        const velMpm = (-b + Math.sqrt(Math.max(0.01, b * b - 4 * a * c))) / (2 * a);
        return Math.max(145, Math.min(520, Math.round(1e3 / Math.max(110, velMpm) * 60)));
      };
      const ltSecsPerKm = solvePaceSecsPerKmForPctVo2(0.88);
      const easySecsPerKm = solvePaceSecsPerKmForPctVo2(0.7);
      const intervalSecsPerKm = solvePaceSecsPerKmForPctVo2(0.98);
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

// server/teamService.ts
var TEAMS_DIRECTORY_KEY = "teams_index_v1";
var EMAIL_DIRECTORY_KEY = "users_email_idx_v1";
function teamDocVaultKey(teamId) {
  return `team_doc_${teamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`;
}
function userTeamsVaultKey(sid) {
  return `user_teams_${sid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`;
}
function emailOtpVaultKey(email) {
  const hash = crypto4.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
  return `email_otp_${hash}`;
}
function hashToken(rawToken) {
  return crypto4.createHash("sha256").update(rawToken.trim()).digest("hex");
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
async function requestEmailOtpCode(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, deliveryStatus: "FAILED", error: "Enter a valid email address." };
  }
  const code = String(crypto4.randomInt(1e5, 999999));
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
  const isLocalDev = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  if (!res.delivered && !isLocalDev) {
    return {
      ok: false,
      deliveryStatus: res.status,
      error: res.error || "Email code delivery is not configured on this server. Please sign in with Strava instead."
    };
  }
  return {
    ok: res.status !== "FAILED",
    deliveryStatus: res.status,
    ...res.status === "READY_MANUAL_LINK" && isLocalDev ? { devPreviewCode: code } : {},
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
  if (a.length !== b.length || !crypto4.timingSafeEqual(a, b)) {
    stored.attempts += 1;
    await saveTenantVaultAsync(key, stored);
    return { ok: false, error: "Incorrect 6-digit code." };
  }
  await saveTenantVaultAsync(key, { ...stored, expiresAt: 0 });
  const emailDir = await loadTenantVaultAsync(EMAIL_DIRECTORY_KEY, {
    byEmail: {}
  });
  let account = emailDir.byEmail[email];
  if (!account) {
    const newSid = preferredSid && /^[a-f0-9]{24,64}$/i.test(preferredSid) ? preferredSid : crypto4.randomBytes(16).toString("hex");
    account = {
      sid: newSid,
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
}
async function migrateAnonymousTeamsToStravaSid(params) {
  const { oldSid, stravaSid, athleteName, stravaAthleteId } = params;
  if (!oldSid || !stravaSid || oldSid === stravaSid) return;
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
        m.userSid = stravaSid;
        if (stravaAthleteId) m.stravaAthleteId = stravaAthleteId;
        if (athleteName && (!m.invitedName || m.invitedName === "Team Athlete")) {
          m.invitedName = athleteName.slice(0, 64);
        }
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
      await addTeamToUserIndex(stravaSid, teamId, athleteName || oldIdx.displayName, oldIdx.email);
    }
  }
}
function projectTeamSummaryForCaller(doc, callerSid, originUrl) {
  const myMembership = doc.memberships.find(
    (m) => m.userSid === callerSid && m.status !== "REVOKED"
  );
  if (!myMembership) return null;
  const isCoach = myMembership.role === "HEAD_COACH" || myMembership.role === "ASSISTANT_COACH";
  const athleteMembers = doc.memberships.filter((m) => m.status !== "REVOKED");
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
  const sanitizedMemberships = athleteMembers.map((m) => {
    const isSelf = m.userSid === callerSid;
    const priv = m.liveSnapshot?.privacySettings;
    const hideWellnessFromCoach = !isSelf && priv?.shareWellnessAndHrv === "PRIVATE";
    const hidePmcFromCoach = !isSelf && priv?.sharePmcAndZones === "PRIVATE";
    const safeSportShieldEnforced = Boolean(
      doc.brand.defaultSafeSportShield || m.isMinorU18 || m.liveSnapshot?.safeSportHideWeight
    );
    let projectedSnapshot;
    if (m.liveSnapshot) {
      projectedSnapshot = {
        ...m.liveSnapshot,
        ftpWatts: safeSportShieldEnforced && !isCoach && !isSelf ? void 0 : m.liveSnapshot.ftpWatts,
        ctl: !isSelf && (!isCoach || hidePmcFromCoach) ? 0 : m.liveSnapshot.ctl,
        atl: !isSelf && (!isCoach || hidePmcFromCoach) ? 0 : m.liveSnapshot.atl,
        tsb: !isSelf && (!isCoach || hidePmcFromCoach) ? 0 : m.liveSnapshot.tsb,
        // Never leak raw biometric wellnessDays or activity logs to fellow teammates
        wellnessDays: isSelf || isCoach && !hideWellnessFromCoach ? m.liveSnapshot.wellnessDays : void 0,
        activities: isSelf || isCoach ? m.liveSnapshot.activities : void 0
      };
    }
    const base = {
      membershipId: m.membershipId,
      teamId: m.teamId,
      stravaAthleteId: isCoach || isSelf ? m.stravaAthleteId : void 0,
      sharingTier: m.sharingTier,
      role: m.role,
      squadGroup: m.squadGroup,
      invitedName: m.invitedName,
      graduationYear: m.graduationYear,
      isMinorU18: m.isMinorU18,
      seedMarkOrFtp: m.seedMarkOrFtp,
      status: m.status,
      emailDeliveryStatus: m.emailDeliveryStatus,
      invitedAt: m.invitedAt,
      openedAt: m.openedAt,
      joinedAt: m.joinedAt,
      liveSnapshot: projectedSnapshot
    };
    if (isCoach || isSelf) {
      base.invitedEmail = m.invitedEmail;
      base.invitedPhone = m.invitedPhone;
      base.parentGuardianEmail = m.parentGuardianEmail;
      if (m.rawInviteToken) {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}`;
      } else {
        base.magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}`;
      }
    }
    return base;
  });
  const visibleBroadcasts = (doc.broadcastWorkouts || []).filter((bw) => {
    if (isCoach) return true;
    if (Array.isArray(bw.targetMembershipIds) && bw.targetMembershipIds.length > 0) {
      return bw.targetMembershipIds.includes(myMembership.membershipId);
    }
    return bw.targetSquadGroup === "ALL" || bw.targetSquadGroup.toLowerCase() === myMembership.squadGroup.toLowerCase();
  });
  return {
    brand: doc.brand,
    myRole: myMembership.role,
    mySquadGroup: myMembership.squadGroup,
    myMembershipId: myMembership.membershipId,
    totalInvited,
    openedCount,
    activeCount,
    watchConnectedCount,
    memberships: sanitizedMemberships,
    broadcastWorkouts: visibleBroadcasts
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
    slug = `${slug}-${crypto4.randomInt(10, 99)}`;
  }
  let joinCode = generateTeamJoinCode(cleanShort);
  if (dir.byJoinCode[joinCode]) {
    joinCode = generateTeamJoinCode(cleanShort, crypto4.randomInt(10, 99));
  }
  const teamId = `tm_${crypto4.randomBytes(8).toString("hex")}`;
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
    createdAt: nowIso
  };
  const coachMembership = {
    membershipId: `mem_${crypto4.randomBytes(6).toString("hex")}`,
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
  dir.bySlug[slug] = teamId;
  dir.byJoinCode[joinCode.toUpperCase()] = teamId;
  if (!dir.allTeamIds.includes(teamId)) dir.allTeamIds.push(teamId);
  await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
  await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
  await addTeamToUserIndex(
    params.callerSid,
    teamId,
    brand.coachDisplayName,
    params.coachEmail
  );
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}
async function updateTeamBranding(params) {
  const doc = await loadTenantVaultAsync(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) return null;
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
    return null;
  }
  const u = params.updates;
  if (u.name) doc.brand.name = String(u.name).trim().slice(0, 80);
  if (u.shortName) doc.brand.shortName = String(u.shortName).trim().slice(0, 22);
  if (typeof u.mascotOrMotto === "string") {
    doc.brand.mascotOrMotto = u.mascotOrMotto.trim().slice(0, 64) || void 0;
  }
  if (u.orgType) doc.brand.orgType = u.orgType;
  if (u.primarySport) doc.brand.primarySport = u.primarySport;
  if (u.primaryHex) doc.brand.primaryHex = normalizeHexColor(u.primaryHex, doc.brand.primaryHex);
  if (u.secondaryHex) {
    doc.brand.secondaryHex = normalizeHexColor(u.secondaryHex, doc.brand.secondaryHex);
  }
  if (typeof u.defaultSafeSportShield === "boolean") {
    doc.brand.defaultSafeSportShield = u.defaultSafeSportShield;
  }
  if (typeof u.enableParentGuardianCc === "boolean") {
    doc.brand.enableParentGuardianCc = u.enableParentGuardianCc;
  }
  if (u.coachDisplayName) {
    doc.brand.coachDisplayName = String(u.coachDisplayName).trim().slice(0, 48);
  }
  if (u.logoDataUrl === "") {
    doc.brand.logoDataUrl = void 0;
  } else if (u.logoDataUrl && u.logoDataUrl.startsWith("data:image/") && u.logoDataUrl.length <= 96e3) {
    doc.brand.logoDataUrl = u.logoDataUrl;
  }
  doc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
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
  let addedCount = 0;
  let emailedCount = 0;
  let manualLinkCount = 0;
  for (const row of parsedRows.slice(0, 150)) {
    const cleanEmail = row.invitedEmail?.trim().toLowerCase();
    if (cleanEmail && doc.memberships.some(
      (existing) => existing.invitedEmail?.toLowerCase() === cleanEmail && existing.status !== "REVOKED"
    )) {
      continue;
    }
    const rawToken = crypto4.randomBytes(12).toString("base64url");
    const membershipId = `mem_${crypto4.randomBytes(6).toString("hex")}`;
    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${rawToken}`;
    const parentCc = doc.brand.enableParentGuardianCc && row.parentGuardianEmail ? row.parentGuardianEmail.trim().toLowerCase() : void 0;
    let emailDeliveryStatus = "READY_MANUAL_LINK";
    if (cleanEmail && params.sendEmailsNow !== false) {
      const emailContent = buildTeamInviteEmailContent({
        brand: doc.brand,
        invitedName: row.invitedName,
        squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || "Varsity",
        magicJoinUrl,
        hasParentCc: Boolean(parentCc),
        seedMarkOrFtp: row.seedMarkOrFtp
      });
      const sendRes = await sendEmailViaResend({
        to: cleanEmail,
        cc: parentCc,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      });
      emailDeliveryStatus = sendRes.status;
      if (sendRes.delivered) emailedCount += 1;
      else manualLinkCount += 1;
    } else {
      manualLinkCount += 1;
    }
    doc.memberships.push({
      membershipId,
      teamId: doc.brand.teamId,
      role: "ATHLETE",
      squadGroup: row.squadGroup || orgDefaults.defaultSquads[0] || "Varsity",
      invitedName: String(row.invitedName || "Team Athlete").trim().slice(0, 64),
      invitedEmail: cleanEmail,
      invitedPhone: row.invitedPhone,
      parentGuardianEmail: row.parentGuardianEmail?.trim().toLowerCase(),
      graduationYear: row.graduationYear,
      isMinorU18: Boolean(row.isMinorU18 || doc.brand.orgType === "HIGH_SCHOOL"),
      seedMarkOrFtp: row.seedMarkOrFtp,
      status: "INVITED",
      emailDeliveryStatus,
      rawInviteToken: rawToken,
      inviteTokenHash: hashToken(rawToken),
      invitedAt: nowIso
    });
    addedCount += 1;
  }
  doc.updatedAt = nowIso;
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return {
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
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
      m.rawInviteToken = crypto4.randomBytes(12).toString("base64url");
      m.inviteTokenHash = hashToken(m.rawInviteToken);
    }
    const magicJoinUrl = `${cleanOrigin}/join/${doc.brand.slug}?t=${m.rawInviteToken}`;
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
async function previewTeamJoinInvite(codeOrSlug, inviteToken) {
  const doc = await findTeamDocumentByCodeOrSlug(codeOrSlug);
  if (!doc) return { found: false };
  let matchedMem;
  if (inviteToken) {
    const targetHash = hashToken(inviteToken);
    matchedMem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== "REVOKED"
    );
    if (matchedMem && matchedMem.status === "INVITED") {
      matchedMem.status = "OPENED";
      matchedMem.openedAt = (/* @__PURE__ */ new Date()).toISOString();
      doc.updatedAt = matchedMem.openedAt;
      await saveTenantVaultAsync(teamDocVaultKey(doc.brand.teamId), doc);
    }
  } else {
    doc.anonymousLinkOpens = (doc.anonymousLinkOpens || 0) + 1;
    await saveTenantVaultAsync(teamDocVaultKey(doc.brand.teamId), doc);
  }
  return {
    found: true,
    brand: doc.brand,
    membership: matchedMem ? {
      membershipId: matchedMem.membershipId,
      invitedName: matchedMem.invitedName,
      invitedEmail: matchedMem.invitedEmail,
      squadGroup: matchedMem.squadGroup,
      role: matchedMem.role,
      isMinorU18: matchedMem.isMinorU18,
      seedMarkOrFtp: matchedMem.seedMarkOrFtp
    } : void 0
  };
}
async function claimTeamJoinInvite(params) {
  const doc = await findTeamDocumentByCodeOrSlug(params.codeOrSlug);
  if (!doc) {
    return {
      ok: false,
      error: "No team matched that Join Code or link. Check the 6-character code with your coach."
    };
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const cleanEmail = params.athleteEmail?.trim().toLowerCase();
  const cleanNameLower = params.athleteName?.trim().toLowerCase().replace(/\s+/g, " ");
  const cleanStravaId = params.stravaAthleteId?.trim();
  let mem;
  if (params.inviteToken) {
    const targetHash = hashToken(params.inviteToken);
    mem = doc.memberships.find(
      (m) => m.inviteTokenHash === targetHash && m.status !== "REVOKED"
    );
  }
  if (!mem) {
    mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
  }
  if (!mem && cleanStravaId) {
    mem = doc.memberships.find(
      (m) => m.stravaAthleteId === cleanStravaId && m.status !== "REVOKED"
    );
  }
  if (!mem && cleanEmail) {
    mem = doc.memberships.find(
      (m) => m.invitedEmail?.toLowerCase() === cleanEmail && m.status !== "REVOKED"
    );
  }
  if (!mem && cleanNameLower && cleanNameLower !== "team athlete" && cleanNameLower !== "athlete") {
    mem = doc.memberships.find(
      (m) => (m.status === "INVITED" || m.status === "OPENED") && !m.userSid && m.invitedName.trim().toLowerCase().replace(/\s+/g, " ") === cleanNameLower
    );
  }
  const orgDefaults = getOrgTypeSafeguardingDefaults(doc.brand.orgType);
  const resolvedSharingTier = params.sharingTier || "SUMMARY_ONLY";
  if (!mem) {
    mem = {
      membershipId: `mem_${crypto4.randomBytes(6).toString("hex")}`,
      teamId: doc.brand.teamId,
      userSid: params.callerSid,
      stravaAthleteId: cleanStravaId,
      sharingTier: resolvedSharingTier,
      role: "ATHLETE",
      squadGroup: params.squadGroup?.trim() || orgDefaults.defaultSquads[0] || "Varsity",
      invitedName: params.athleteName?.trim().slice(0, 64) || "Team Athlete",
      invitedEmail: cleanEmail,
      isMinorU18: doc.brand.orgType === "HIGH_SCHOOL",
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
    if (params.seedMarkOrFtp?.trim()) {
      mem.seedMarkOrFtp = params.seedMarkOrFtp.trim();
    }
    mem.status = "ACTIVE";
    if (!mem.openedAt) mem.openedAt = nowIso;
    if (!mem.joinedAt) mem.joinedAt = nowIso;
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
  await saveTenantVaultAsync(teamDocVaultKey(doc.brand.teamId), doc);
  await addTeamToUserIndex(
    params.callerSid,
    doc.brand.teamId,
    mem.invitedName,
    mem.invitedEmail
  );
  return {
    ok: true,
    summary: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    calibrated,
    safeSportShieldEnforced
  };
}
async function broadcastWorkoutToTeamSquad(params) {
  const doc = await loadTenantVaultAsync(
    teamDocVaultKey(params.teamId),
    null
  );
  if (!doc) return null;
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
  );
  if (!callerMem || callerMem.role !== "HEAD_COACH" && callerMem.role !== "ASSISTANT_COACH") {
    return null;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const cleanTargets = Array.isArray(params.targetMembershipIds) ? params.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
  const workout = {
    broadcastId: `bw_${crypto4.randomBytes(6).toString("hex")}`,
    teamId: doc.brand.teamId,
    targetSquadGroup: String(params.targetSquadGroup || "ALL").trim() || "ALL",
    ...cleanTargets && cleanTargets.length > 0 ? { targetMembershipIds: cleanTargets } : {},
    date: String(params.date || nowIso.slice(0, 10)).slice(0, 10),
    name: String(params.name || "Team Prescribed Session").trim().slice(0, 100),
    sportCategory: params.sportCategory || "Running",
    plannedDurationSecs: Math.max(300, Number(params.plannedDurationSecs) || 3600),
    plannedLoad: Math.max(5, Number(params.plannedLoad) || 65),
    workoutSyntax: String(params.workoutSyntax || "").slice(0, 2e3),
    description: String(params.description || "").slice(0, 1e3),
    pushedByCoachName: doc.brand.coachDisplayName,
    createdAt: nowIso
  };
  doc.broadcastWorkouts = [workout, ...doc.broadcastWorkouts || []].slice(0, 60);
  doc.updatedAt = nowIso;
  await saveTenantVaultAsync(teamDocVaultKey(params.teamId), doc);
  return projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
}
function buildConsentedCoachActivities(rawActivities, sharingTier, allowGpsRoutes) {
  if (!Array.isArray(rawActivities) || sharingTier === "LOAD_ONLY") {
    return [];
  }
  const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
    activities: rawActivities.slice(-25)
  });
  const cleanRoomActivities = Array.isArray(cleanRoomPayload.activities) ? cleanRoomPayload.activities : [];
  const firstPartyIds = new Set(
    cleanRoomActivities.map((a) => String(a?.id || ""))
  );
  const sourceList = sharingTier === "FULL_STREAMS" ? rawActivities.slice(-25) : cleanRoomActivities;
  return sourceList.map((act) => {
    const isFirstParty = firstPartyIds.has(String(act.id || ""));
    const includeGps = sharingTier === "FULL_STREAMS" && allowGpsRoutes && isFirstParty;
    const sanitized = {
      ...act,
      // Always strip Strava social/segment payloads from cross-user coach snapshots
      kudoers: void 0,
      comments: void 0,
      segmentEfforts: [],
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
    const doc = await loadTenantVaultAsync(
      teamDocVaultKey(teamId),
      null
    );
    if (!doc) continue;
    const mem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== "REVOKED"
    );
    if (!mem) continue;
    const effectiveTier = params.snapshot.sharingTier || mem.sharingTier || "SUMMARY_ONLY";
    mem.sharingTier = effectiveTier;
    const enforceHideWeight = Boolean(
      doc.brand.defaultSafeSportShield || mem.isMinorU18 || params.snapshot.safeSportHideWeight
    );
    const priv = params.snapshot.privacySettings;
    const allowGpsRoutes = !priv || priv.shareGpsRoutes !== "PRIVATE" && !priv.stravaComplianceShield;
    const coachActivities = buildConsentedCoachActivities(
      params.snapshot.activities,
      effectiveTier,
      allowGpsRoutes
    );
    const sanitizedWellness = Array.isArray(params.snapshot.wellnessDays) ? params.snapshot.wellnessDays.slice(-28).map(
      (w) => enforceHideWeight ? { ...w, weightKg: 0 } : w
    ) : void 0;
    if (params.athleteName?.trim() && mem.invitedName === "Team Athlete") {
      mem.invitedName = params.athleteName.trim().slice(0, 64);
    }
    mem.liveSnapshot = {
      updatedAt: nowIso,
      hasConnectedWatch: Boolean(params.snapshot.hasConnectedWatch),
      verdictLabel: String(params.snapshot.verdictLabel || "Active").slice(0, 48),
      readinessScore: Number(params.snapshot.readinessScore ?? 0),
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
      activities: coachActivities
    };
    doc.updatedAt = nowIso;
    await saveTenantVaultAsync(teamDocVaultKey(teamId), doc);
    const proj = projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl);
    if (proj) summaries.push(proj);
  }
  return summaries;
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
  const dateStr = (activity.startDateLocal || "").slice(0, 10);
  const thresholds = resolveThresholdsAtDate(profile, dateStr);
  const dur = activity.movingTimeSecs || 0;
  if (activity.sportCategory === "Cycling" && dur > 0) {
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

// src/physiology/orthopedicEngine.ts
function computeActivityThreeChannelLoads(act, profile) {
  const baseLoad = computeHistoricalActivityLoad(act, profile);
  const central = baseLoad;
  if (act.sportCategory === "Running") {
    const distKm = Math.max(0, (act.distanceMeters || 0) / 1e3);
    const durHrs = Math.max(0.05, (act.movingTimeSecs || 1) / 3600);
    const speedKph = distKm / durHrs;
    const speedFactor = Math.max(0.75, Math.min(2.1, Math.pow(speedKph / 12, 1.35)));
    const terrainShockFactor = act.elevationGainMeters > 150 ? 1.18 : act.environment === "INDOOR" ? 0.88 : 1;
    const eccentricImpact = distKm * 7.5 * speedFactor * terrainShockFactor;
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
  return {
    central: Math.round(central * 10) / 10,
    eccentricImpact: Math.round(baseLoad * 0.15 * 10) / 10,
    concentricTorque: Math.round(baseLoad * 0.4 * 10) / 10
  };
}
function evaluateOrthopedicInterference(activities, profile, todayPlannedEvents = [], referenceDateIso) {
  const refDateStr = (referenceDateIso || (/* @__PURE__ */ new Date()).toISOString()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);
  const dayMs = 864e5;
  let central7d = 0;
  let central28d = 0;
  let impact7d = 0;
  let impact28d = 0;
  let torque7d = 0;
  let torque28d = 0;
  for (const act of activities) {
    const actDate = (act.startDateLocal || "").slice(0, 10);
    const actMs = Date.parse(`${actDate}T12:00:00Z`);
    if (!Number.isFinite(actMs) || actMs > refMs) continue;
    const ageDays = (refMs - actMs) / dayMs;
    if (ageDays > 28) continue;
    const ch = computeActivityThreeChannelLoads(act, profile);
    central28d += ch.central;
    impact28d += ch.eccentricImpact;
    torque28d += ch.concentricTorque;
    if (ageDays <= 7) {
      central7d += ch.central;
      impact7d += ch.eccentricImpact;
      torque7d += ch.concentricTorque;
    }
  }
  const chronicCentralWeekly = Math.max(80, central28d / 4);
  const chronicImpactWeekly = Math.max(45, impact28d / 4);
  const chronicTorqueWeekly = Math.max(60, torque28d / 4);
  const centralAcwr = Math.round(central7d / chronicCentralWeekly * 100) / 100;
  const impactAcwr = Math.round(impact7d / chronicImpactWeekly * 100) / 100;
  const torqueAcwr = Math.round(torque7d / chronicTorqueWeekly * 100) / 100;
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
    suggestedBikeWorkoutSyntax
  };
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
  let bestHrr60Bpm = null;
  if (hasHr && n >= 240) {
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
  if (aerobicDecouplingPct !== null) {
    if (aerobicDecouplingPct <= 3.5) executionScore += 6;
    else if (aerobicDecouplingPct > 7.5) executionScore -= 10;
  }
  if (bestHrr60Bpm !== null && bestHrr60Bpm >= 25) executionScore += 4;
  executionScore = Math.max(55, Math.min(99, executionScore));
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
    insights: insights.slice(0, 3)
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
        targetWkg,
        targetPaceSecsPerKm: null,
        targetGapSecsPerKm: null,
        segmentDurationSecs: segSecs,
        carbsGramsTarget: Math.round(carbsGramsPerHour * segHours),
        sodiumMgTarget: Math.round(sodiumMgPerHour * segHours),
        fluidMlTarget: Math.round(fluidMlPerHour * segHours),
        coachingCue: i === 0 ? `Cap surges strictly at ${Math.round(targetWatts * 1.06)}W for the first 12 minutes to preserve W'.` : i === 2 ? `Crux climb (${segGradePct}% avg): hold ${targetWatts}W (${targetWkg} W/kg) seated at 85+ rpm.` : i === 3 ? `Entering deep work (${fatigueLabel}): take 1 gel + 200mL fluid before kilometer ${startKm}.` : `Empty remaining W' tank over the final ${(endKm - startKm).toFixed(1)} km.`
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
        coachingCue: i === 0 ? "Bank zero seconds early \u2014 lock onto target GAP rhythm and protect glycogen stores." : i === 2 ? `Grade rises to ${segGradePct}%: shorten stride, keep cadence >=176 spm, and run by GAP effort.` : i === 3 ? `Passing ${fatigueLabel}: ingest ${Math.max(20, Math.round(carbsGramsPerHour * segHours))}g carbs before neuromuscular fade sets in.` : "Final segment: lift cadence +3 spm and empty remaining D' reserve to the line."
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
    caffeineMgRecommendation: Math.round(weightKg * (totalHours > 1.5 ? 3.5 : 2.5))
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
    raceDate: input.raceDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
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
  const records = Array.isArray(payload.activities || payload.workouts || payload.records) ? payload.activities || payload.workouts || payload.records : [payload];
  res.status(200).json({
    ok: true,
    provider: provider.toUpperCase(),
    ingestionSource: `${provider.toUpperCase()}_WEBHOOK_FIRST_PARTY`,
    cleanRoomEligibleForAiAndCoaching: true,
    receivedCount: records.length,
    receivedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
});
webhooksAndExportRouter.post("/api/workouts/export", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const title = String(body.name || "THRESH Prescribed Session").trim();
  const sport = body.sportCategory === "Running" ? "Running" : "Cycling";
  const ftp = Math.max(100, Number(body.ftp) || 280);
  const thresholdPaceSecsPerKm = Math.max(150, Number(body.thresholdPaceSecsPerKm) || 245);
  const rawSteps = Array.isArray(body.steps) && body.steps.length > 0 ? body.steps : [
    { label: "Warmup", durationSecs: 600, targetPctFtp: 62 },
    { label: "Threshold Main Set", durationSecs: 1800, targetPctFtp: 96 },
    { label: "Cooldown", durationSecs: 600, targetPctFtp: 55 }
  ];
  const normalizedSteps = rawSteps.map((s, idx) => {
    const durationSecs = Math.max(30, Number(s.durationSecs) || 300);
    const pct = Math.max(40, Math.min(180, Number(s.targetPctFtp) || 75));
    const targetWatts = Math.round(ftp * pct / 100);
    const targetPaceSecsPerKm = Math.round(thresholdPaceSecsPerKm / (pct / 100));
    return {
      stepOrder: idx + 1,
      label: String(s.label || `Step ${idx + 1}`),
      durationSecs,
      targetPctFtp: pct,
      targetWatts,
      targetPaceSecsPerKm
    };
  });
  const appleWorkoutKitJson = {
    schemaVersion: "1.0",
    activityType: sport === "Running" ? "HKWorkoutActivityTypeRunning" : "HKWorkoutActivityTypeCycling",
    displayName: title,
    blocks: normalizedSteps.map((st) => ({
      stepType: st.stepOrder === 1 ? "warmup" : st.stepOrder === normalizedSteps.length ? "cooldown" : "work",
      goal: { type: "time", seconds: st.durationSecs },
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
  const garminTrainingApiJson = {
    workoutName: title,
    sportType: { sportTypeKey: sport === "Running" ? "running" : "cycling" },
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeKey: sport === "Running" ? "running" : "cycling" },
        workoutSteps: normalizedSteps.map((st) => ({
          type: "ExecutableStepDTO",
          stepOrder: st.stepOrder,
          description: st.label,
          endCondition: { conditionTypeKey: "time" },
          endConditionValue: st.durationSecs,
          targetType: {
            workoutTargetTypeKey: sport === "Cycling" ? "power.zone" : "pace.zone"
          },
          targetValueOne: sport === "Cycling" ? Math.round(st.targetWatts * 0.96) : Math.round(1e3 / (st.targetPaceSecsPerKm * 1.02) * 100) / 100,
          targetValueTwo: sport === "Cycling" ? Math.round(st.targetWatts * 1.04) : Math.round(1e3 / (st.targetPaceSecsPerKm * 0.98) * 100) / 100
        }))
      }
    ]
  };
  const zwoLines = [
    "<workout_file>",
    "  <author>Thresh</author>",
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
import express2 from "express";
var teamRouter = express2.Router();
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
function ensureSessionSid(req, res, subjectHint = "thresh-athlete") {
  const existing = getVerifiedSessionClaims(req);
  if (existing?.sid) {
    return { sid: existing.sid };
  }
  const sessionToken = setSessionCookie(req, res, subjectHint);
  const decoded = decodeAndVerifyToken(sessionToken);
  return {
    sid: decoded?.sid || "000000000000000000000000",
    sessionToken
  };
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
      ...result.devPreviewCode ? { devPreviewCode: result.devPreviewCode } : {}
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
      result.sid
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
    if (!claims?.sid) {
      res.json({
        ok: true,
        resendConfigured: isResendConfigured(),
        teams: []
      });
      return;
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
    const { sid, sessionToken } = ensureSessionSid(
      req,
      res,
      String(req.body?.coachDisplayName || "thresh-coach")
    );
    const originUrl = resolveRequestOrigin(req);
    const team = await createTeamForCoach({
      callerSid: sid,
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
      coachEmail: req.body?.coachEmail
    });
    res.json({
      ok: true,
      ...sessionToken ? { sessionToken } : {},
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
    if (!claims?.sid) {
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
    if (!claims?.sid) {
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
    if (!claims?.sid) {
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
    const preview = await previewTeamJoinInvite(codeOrSlug, token);
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
    const athleteName = String(req.body?.athleteName || "").trim();
    const { sid, sessionToken } = ensureSessionSid(
      req,
      res,
      athleteName || "thresh-athlete"
    );
    const originUrl = resolveRequestOrigin(req);
    const rawUnit = String(req.body?.distanceUnit || "").toLowerCase();
    const distanceUnit = rawUnit === "km" ? "km" : "mi";
    const rawTier = String(req.body?.sharingTier || "").toUpperCase();
    const sharingTier = rawTier === "FULL_STREAMS" || rawTier === "LOAD_ONLY" ? rawTier : "SUMMARY_ONLY";
    const claimed = await claimTeamJoinInvite({
      callerSid: sid,
      originUrl,
      codeOrSlug: String(req.body?.codeOrSlug || "").trim(),
      inviteToken: req.body?.inviteToken ? String(req.body.inviteToken).trim() : void 0,
      athleteName: athleteName || void 0,
      athleteEmail: req.body?.athleteEmail ? String(req.body.athleteEmail) : void 0,
      stravaAthleteId: req.body?.stravaAthleteId ? String(req.body.stravaAthleteId).trim() : void 0,
      squadGroup: req.body?.squadGroup ? String(req.body.squadGroup) : void 0,
      seedMarkOrFtp: req.body?.seedMarkOrFtp ? String(req.body.seedMarkOrFtp) : void 0,
      distanceUnit,
      sharingTier
    });
    if (!claimed.ok || !claimed.summary) {
      res.status(404).json({
        ok: false,
        error: claimed.error || "Team invite could not be claimed."
      });
      return;
    }
    const teams = await listTeamsForUser(sid, originUrl);
    res.json({
      ok: true,
      ...sessionToken ? { sessionToken } : {},
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
    if (!claims?.sid) {
      res.json({ ok: true, teams: [] });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const teams = await syncAthleteSnapshotAcrossTeams({
      callerSid: claims.sid,
      originUrl,
      athleteName: req.body?.athleteName ? String(req.body.athleteName) : void 0,
      snapshot: req.body?.snapshot || {}
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
    if (!claims?.sid) {
      res.status(401).json({ ok: false, error: "Authentication required." });
      return;
    }
    const originUrl = resolveRequestOrigin(req);
    const targetMembershipIds = Array.isArray(req.body?.targetMembershipIds) ? req.body.targetMembershipIds.map((id) => String(id).trim()).filter(Boolean) : void 0;
    const updated = await broadcastWorkoutToTeamSquad({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ""),
      originUrl,
      targetSquadGroup: String(req.body?.targetSquadGroup || "ALL"),
      targetMembershipIds,
      date: String(req.body?.date || ""),
      name: String(req.body?.name || ""),
      sportCategory: req.body?.sportCategory || "Running",
      plannedDurationSecs: Number(req.body?.plannedDurationSecs || 3600),
      plannedLoad: Number(req.body?.plannedLoad || 65),
      workoutSyntax: String(req.body?.workoutSyntax || ""),
      description: String(req.body?.description || "")
    });
    if (!updated) {
      res.status(403).json({ ok: false, error: "Coach permissions required." });
      return;
    }
    res.json({ ok: true, team: updated });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to broadcast workout."
    });
  }
});

// server/apiRouter.ts
var apiRouter = express3.Router();
var requestContext = new AsyncLocalStorage();
var explicitScopeKeyByReq = /* @__PURE__ */ new WeakMap();
apiRouter.use(securityHeadersMiddleware);
apiRouter.use((req, _res, next) => {
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
apiRouter.use(webhooksAndExportRouter);
apiRouter.use(teamRouter);
var SEGMENTS_BY_ACTIVITY_CACHE_FILE = "/tmp/thresh-segments-by-activity.json";
var ROUTES_BY_ACTIVITY_CACHE_FILE = "/tmp/thresh-routes-by-activity.json";
var STRAVA_KUDOS_CACHE_FILE = "/tmp/thresh-strava-kudos.json";
var GARMIN_SESSION_DIR = "/tmp/thresh-garmin";
function hasExplicitCredentialHeader(req) {
  if (!req) return false;
  return Boolean(
    String(req.headers["x-strava-refresh-token"] || "").trim() || String(req.headers["x-strava-access-token"] || "").trim() || String(req.headers["x-intervals-api-key"] || "").trim() || String(req.headers["x-garmin-personal-api-key"] || "").trim() || String(req.headers["x-garmin-bearer-token"] || "").trim() || String(req.headers["x-garmin-oauth1-token"] || "").trim()
  );
}
function isAuthenticatedRequest(req) {
  const activeReq = req ?? requestContext.getStore();
  if (!activeReq) return false;
  return hasValidSessionToken(activeReq) || hasExplicitCredentialHeader(activeReq);
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
  return crypto5.createHash("sha256").update(rawCredential).digest("hex").slice(0, 24);
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
  const scopeKey = explicitApiKey ? crypto5.createHash("sha256").update(explicitApiKey.trim()).digest("hex").slice(0, 24) : resolveSessionScopeKey(req);
  if (!scopeKey) return null;
  return `/tmp/thresh-planned-events-${scopeKey}.json`;
}
apiRouter.post("/api/auth/session", (req, res) => {
  const rawSubject = String(req.body?.athleteName || "thresh-athlete").trim().slice(0, 64);
  const sessionToken = setSessionCookie(req, res, rawSubject || "thresh-athlete");
  res.json({ ok: true, sessionToken });
});
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
    intervalsAthleteId: seed.intervalsAthleteId || "0",
    intervalsAthleteName: seed.intervalsAthleteName || "",
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
    if (cookieVault && cookieVault.sid?.slice(0, 24) === scopeKey) {
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
        intervalsAthleteId: loaded.intervalsAthleteId || cookieVault.intervalsAthleteId || "0",
        intervalsAthleteName: loaded.intervalsAthleteName || cookieVault.intervalsAthleteName || ""
      };
    }
    const hydrated = createDefaultRuntimeSessionStore(loaded);
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
var SERVER_ZONE_COLORS = [
  "#94A3B8",
  // Z1 Cool Mist
  "#0D9488",
  // Z2 Aerobic Teal
  "#D97706",
  // Z3 Ochre Tempo
  "#EA580C",
  // Z4 Thresh Vermilion
  "#DC2626",
  // Z5 VO2 Crimson
  "#7C3AED",
  // Z6 Anaerobic Violet
  "#A21CAF"
  // Z7 Neuromuscular
];
function deriveObservedPhysiologyFromActivities(activities, weightKg = 70) {
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
        a.sportCategory || a.sport_type || a.type || a.activityType?.typeKey || ""
      );
      const isBike = /ride|cycling|virtualride|bike|biking|zwift|peloton|spin/i.test(sport);
      const isRun = /run|trailrun|virtualrun|running|treadmill/i.test(sport);
      const dur = Number(
        a.movingTimeSecs ?? a.movingDuration ?? a.moving_time ?? a.elapsed_time ?? a.duration ?? 0
      );
      const dist = Number(a.distanceMeters ?? a.distance ?? 0);
      const avgP = Number(
        a.avgPower ?? a.icu_average_watts ?? a.average_watts ?? 0
      );
      const np = Number(
        a.normalizedPower ?? a.normPower ?? a.icu_weighted_avg_watts ?? a.weighted_average_watts ?? avgP
      );
      const sustainedBikeW = avgP > 0 && np > avgP * 1.08 ? Math.round(avgP * 1.05) : np;
      const p20 = Number(a.max20MinPower ?? a.maxAvgPower_1200 ?? 0);
      const maxW = Number(
        a.max_watts ?? a.maxPower ?? a.maxAvgPower_1 ?? a.pMax ?? np * 2.2
      );
      const avgHr = Number(a.avgHr ?? a.averageHR ?? a.average_heartrate ?? 0);
      const peakHr = Number(a.maxHr ?? a.maxHR ?? a.max_heartrate ?? 0);
      if (isBike) {
        if (p20 >= 80 && p20 <= 600) {
          if (p20 > maxBikeWatts20m) maxBikeWatts20m = p20;
        } else if (dur >= 1200 && sustainedBikeW >= 80 && sustainedBikeW <= 600 && sustainedBikeW > maxBikeWatts20m) {
          maxBikeWatts20m = sustainedBikeW;
        }
        if (maxW >= 250 && maxW <= 2500 && maxW > maxBikePeakWatts) {
          maxBikePeakWatts = maxW;
        }
        if (peakHr >= 130 && peakHr <= 225 && peakHr > maxBikeHr) {
          maxBikeHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 120 && avgHr <= 210 && avgHr > maxBikeSustainedHr) {
          maxBikeSustainedHr = avgHr;
        }
      } else if (isRun) {
        if (peakHr >= 130 && peakHr <= 225 && peakHr > maxRunHr) {
          maxRunHr = peakHr;
        }
        if (dur >= 1200 && avgHr >= 120 && avgHr <= 210 && avgHr > maxRunSustainedHr) {
          maxRunSustainedHr = avgHr;
        }
        if (dur >= 1200 && np >= 120 && np <= 650 && np > maxRunSustainedWatts) {
          maxRunSustainedWatts = np;
        }
        const split5k = Number(a.fastestSplit_5000 ?? 0);
        const paceFrom5k = split5k >= 780 && split5k <= 2700 ? Math.round(split5k / 5) : 0;
        const pace = paceFrom5k || Number(a.gapPaceSecsPerKm ?? a.avgPaceSecsPerKm ?? 0) || (dist >= 3e3 && dur >= 900 ? Math.round(dur / (dist / 1e3)) : 0);
        if ((paceFrom5k > 0 || dur >= 1200 && dist >= 3e3) && pace >= 165 && pace <= 600) {
          if (bestRunPaceSecsPerKm === 0 || pace < bestRunPaceSecsPerKm) {
            bestRunPaceSecsPerKm = pace;
          }
        }
      }
    }
  }
  const anyMaxHr = Math.max(maxBikeHr, maxRunHr);
  const obsBikeMaxHr = maxBikeHr || anyMaxHr || 0;
  const obsBikeLthr = maxBikeSustainedHr >= 130 ? Math.min(obsBikeMaxHr ? obsBikeMaxHr - 6 : 200, Math.round(maxBikeSustainedHr * 0.98)) : obsBikeMaxHr ? Math.round(obsBikeMaxHr * 0.9) : 0;
  const obsRunMaxHr = maxRunHr || obsBikeMaxHr || 0;
  const obsRunLthr = maxRunSustainedHr >= 135 ? Math.min(obsRunMaxHr ? obsRunMaxHr - 5 : 205, Math.round(maxRunSustainedHr * 0.98)) : obsRunMaxHr ? Math.round(obsRunMaxHr * 0.91) : obsBikeLthr ? obsBikeLthr + 4 : 0;
  const obsFtp = maxBikeWatts20m >= 90 ? Math.round(maxBikeWatts20m * 0.95) : 0;
  const obsPMax = maxBikePeakWatts >= 400 ? Math.round(maxBikePeakWatts) : obsFtp > 0 ? Math.round(obsFtp * 3.6) : 0;
  const obsWPrime = obsFtp > 0 ? Math.round(obsFtp * 75) : 0;
  const obsThresholdPace = bestRunPaceSecsPerKm > 0 ? Math.round(bestRunPaceSecsPerKm * 1.03) : 0;
  const safeW = weightKg > 30 ? weightKg : 70;
  const obsRunFtp = maxRunSustainedWatts >= 140 ? Math.round(maxRunSustainedWatts * 0.92) : obsThresholdPace > 0 ? Math.round(safeW * (1e3 / obsThresholdPace) * 0.98) : 0;
  const obsVo2Bike = obsFtp > 0 && safeW > 30 ? Math.max(32, Math.min(88, Math.round(10.8 * (obsFtp / safeW) + 7))) : 0;
  const obsVo2Run = obsThresholdPace > 0 ? Math.max(
    32,
    Math.min(88, Math.round(1e3 / obsThresholdPace * 60 * 0.2 + 3.5))
  ) : obsVo2Bike;
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
    runSetting?.ftp || rawProfile?.runFtp || latestWellness?.runEftp || obs.obsRunFtp || prev.runFtp || Math.round(weightKg * (1e3 / Math.max(160, thresholdPaceSecsPerKm)) * 0.98)
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
function emitEncryptedVaultCookieIfPossible(req, res, scopeKey, store) {
  if (!res || res.headersSent) return;
  const activeReq = req ?? requestContext.getStore();
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
    intervalsAthleteId: store.intervalsAthleteId && store.intervalsAthleteId !== "0" ? store.intervalsAthleteId : void 0,
    intervalsAthleteName: store.intervalsAthleteName || void 0,
    garminPersonalApiKey: garminSess?.personalApiKey || void 0
  };
  const header = buildEncryptedVaultCookieHeader(compact, isSecure);
  if (header) {
    appendSetCookieHeader(res, header);
  }
}
function saveSessionCache(req, res) {
  const scopeKey = resolveSessionScopeKey(req);
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(req);
  scopedStoresInMemory.set(scopeKey, store);
  saveTenantVaultSync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(req, res, scopeKey, store);
}
async function saveSessionCacheAsync(req, res, explicitSid) {
  const activeReq = req ?? requestContext.getStore();
  const scopeKey = explicitSid ? bindRequestScopeKey(activeReq, explicitSid) : resolveSessionScopeKey(activeReq);
  if (!scopeKey) return;
  const store = getScopedRuntimeStore(activeReq);
  scopedStoresInMemory.set(scopeKey, store);
  await saveTenantVaultAsync(`session_${scopeKey}`, store);
  emitEncryptedVaultCookieIfPossible(activeReq, res, scopeKey, store);
}
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
  if (hasValidSessionToken(activeReq) || Boolean(getVerifiedSessionClaims(activeReq)) || Boolean(readCompactVaultFromCookie(activeReq))) {
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
function getEffectiveIntervalsConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  if (activeReq && !isAuthenticatedRequest(activeReq)) {
    return { apiKey: "", athleteId: "0" };
  }
  const allowEnvFallback = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  const headerKey = activeReq?.headers["x-intervals-api-key"] || "";
  const headerAthlete = activeReq?.headers["x-intervals-athlete-id"] || "";
  const apiKey = (headerKey || runtimeStore.intervalsApiKey || (allowEnvFallback ? process.env.INTERVALS_API_KEY : "") || "").trim();
  const athleteId = (headerAthlete || runtimeStore.intervalsAthleteId || (allowEnvFallback ? process.env.INTERVALS_ATHLETE_ID : "") || "0").trim() || "0";
  return { apiKey, athleteId };
}
function getEffectiveStravaClientConfig(req) {
  const activeReq = req ?? requestContext.getStore();
  const allowEnvTokenFallback = process.env.ALLOW_DEV_ENV_CREDENTIALS === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  const headerClientId = activeReq?.headers["x-strava-client-id"];
  const headerClientSecret = activeReq?.headers["x-strava-client-secret"];
  const headerRefreshToken = activeReq?.headers["x-strava-refresh-token"];
  const headerAccessToken = activeReq?.headers["x-strava-access-token"];
  const headerExpiresAt = Number(activeReq?.headers["x-strava-expires-at"] || 0);
  const clientId = (headerClientId || runtimeStore.stravaClientId || process.env.STRAVA_CLIENT_ID || "").trim();
  const clientSecret = (headerClientSecret || runtimeStore.stravaClientSecret || process.env.STRAVA_CLIENT_SECRET || "").trim();
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
function isGenericName(name) {
  if (!name) return true;
  const t = name.trim();
  return !t || /^athlete$/i.test(t) || /^primary\s+athlete$/i.test(t) || /^strava\s+(user|athlete)$/i.test(t);
}
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
  const needsRefresh = forceRefresh || !activeAccessToken || activeExpiresAt === 0 || nowSecs >= activeExpiresAt - 300;
  if (needsRefresh && clientId && clientSecret && activeRefreshToken) {
    const candidateRefreshTokens = [activeRefreshToken.trim()].filter(Boolean);
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
          const refreshed = await refreshResp.json();
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
                athleteId: String(refreshed.athlete.id || ""),
                athleteName: name
              };
              stravaIdentityByToken.set(activeRefreshToken, entry);
              stravaIdentityByToken.set(activeAccessToken, entry);
            }
          }
          saveSessionCache();
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
    const rawAthlete = await resp.json();
    const athleteId = String(rawAthlete.id || "");
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
    runtimeStore.stravaAthleteId = athleteId || runtimeStore.stravaAthleteId;
    runtimeStore.stravaAthleteName = fullName;
    if (measurementPreference) {
      runtimeStore.stravaMeasurementPreference = measurementPreference;
    }
    await saveSessionCacheAsync(req);
    return entry;
  } catch {
    return null;
  }
}
var intervalsIdentityByKey = /* @__PURE__ */ new Map();
async function resolveIntervalsAthleteIdentity(req) {
  const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
  if (!apiKey) return null;
  const cached = intervalsIdentityByKey.get(apiKey);
  if (cached && !isGenericName(cached.athleteName)) {
    return cached;
  }
  try {
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    const resp = await fetch(
      `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId || "0")}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }
    );
    if (!resp.ok) return null;
    const rawProfile = await resp.json();
    const resolvedId = String(rawProfile.id || athleteId || "0");
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
    intervalsIdentityByKey.set(apiKey, entry);
    return entry;
  } catch {
    return null;
  }
}
function resolveCallbackUrl(req) {
  const explicitRedirect = (process.env.STRAVA_REDIRECT_URI || "").trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin);
  if (safeOrigin) {
    return `${safeOrigin}/auth/strava/callback`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || "");
  if (appUrl && !appUrl.includes("MY_APP_URL")) {
    return `${appUrl}/auth/strava/callback`;
  }
  const rawProto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim().toLowerCase();
  const proto = rawProto === "https" ? "https" : "http";
  const rawHost = String(
    req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000"
  ).split(",")[0].trim().replace(/[^a-zA-Z0-9.:-]/g, "");
  return `${proto}://${rawHost || "localhost:3000"}/auth/strava/callback`;
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
apiRouter.get(["/api/config/status", "/api/auth/status"], async (req, res) => {
  const isAuthed = isAuthenticatedRequest(req);
  const { apiKey: intervalsKey, athleteId } = getEffectiveIntervalsConfig(req);
  const {
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    refreshToken: stravaRefreshToken,
    accessToken: stravaAccessToken
  } = getEffectiveStravaClientConfig(req);
  if (intervalsKey && !runtimeStore.intervalsApiKey && !isServerOwnedSecret(intervalsKey)) {
    runtimeStore.intervalsApiKey = intervalsKey;
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
  const isIntervalsConnected = Boolean(intervalsKey);
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
  let sessionToken;
  if (isAuthed && (isStravaConnected || isGarminConnected || isIntervalsConnected)) {
    const canonicalSid = resolvedStravaAthleteId ? deriveStravaSessionSid(resolvedStravaAthleteId) : void 0;
    sessionToken = setSessionCookie(
      req,
      res,
      resolvedStravaName || resolvedGarminName || "athlete",
      canonicalSid
    );
    await saveSessionCacheAsync(req, res, canonicalSid);
  }
  res.json({
    vaultStorageBackend: getVaultStorageBackend(),
    garminConnected: isGarminConnected,
    garminAthleteName: resolvedGarminName,
    intervalsConnected: isIntervalsConnected,
    intervalsAthleteId: isIntervalsConnected ? intervalsIdentity?.athleteId || athleteId || "0" : "0",
    intervalsAthleteName: resolvedIntervalsName,
    intervalsSource: isIntervalsConnected ? "USER_INPUT" : "NONE",
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
    mapTileApiKey: isAuthed && effectiveMapKey ? effectiveMapKey : void 0
  });
});
apiRouter.post("/api/config/garmin", async (req, res) => {
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
apiRouter.get("/api/garmin/sync", async (req, res) => {
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
      syncedProfile.ftp || 250
    );
    runtimeStore.athleteFtp = syncedProfile.ftp;
    runtimeStore.athleteIndoorFtp = syncedProfile.indoorFtp;
    runtimeStore.athleteRunFtp = syncedProfile.runFtp;
    runtimeStore.athleteLthr = syncedProfile.lthr;
    runtimeStore.athleteMaxHr = syncedProfile.maxHr;
    runtimeStore.athleteProfile = syncedProfile;
    await saveSessionCacheAsync(req, res);
    const loadByDate = /* @__PURE__ */ new Map();
    for (const a of normalizedActivities) {
      const d = String(a.startDateLocal || "").slice(0, 10);
      if (d) {
        loadByDate.set(d, (loadByDate.get(d) || 0) + Number(a.trainingLoad || 0));
      }
    }
    let lastRhr = syncedProfile.restingHr || 0;
    let lastWeight = syncedProfile.weightKg || 0;
    let ctl = 0;
    let atl = 0;
    const ctlHistory = [];
    const formattedWellnessDays = (garminData.wellnessRows || []).map((w, idx) => {
      const d = String(w.id || "").slice(0, 10);
      const dailyLoad = loadByDate.get(d) || 0;
      ctl = Number((ctl + (dailyLoad - ctl) / 42).toFixed(1));
      atl = Number((atl + (dailyLoad - atl) / 7).toFixed(1));
      ctlHistory.push(ctl);
      const ctl7dAgo = idx >= 7 ? ctlHistory[idx - 7] : ctlHistory[0] || 0;
      const rampRate = Number((ctl - ctl7dAgo).toFixed(1));
      const tsb = Number((ctl - atl).toFixed(1));
      const loadRatio = ctl > 0 ? Number((atl / ctl).toFixed(2)) : 0;
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
apiRouter.delete("/api/config/garmin", async (req, res) => {
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
apiRouter.post("/api/garmin/workout/push", async (req, res) => {
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
    const name = String(body.name || "Thresh Daily Prescription");
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
apiRouter.post("/api/intervals/profile/sync", async (req, res) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    const stravaIdentity = await resolveStravaAthleteIdentity(req);
    const garminSession = getActiveGarminSession(req);
    if (!apiKey) {
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
          sAth = sAthResp.ok ? await sAthResp.json() : {};
          sZones = sZonesResp.ok ? await sZonesResp.json() : null;
        }
        const sId = String(sAth.id || stravaIdentity?.athleteId || "").replace(/[^0-9]/g, "");
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
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const oldest60d = new Date(Date.now() - 60 * 86400 * 1e3).toISOString().slice(0, 10);
    const [profileResp, wellnessResp, actsResp, garminDirect] = await Promise.all([
      fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}`, {
        headers: { Authorization: authHeader, Accept: "application/json" }
      }),
      fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/wellness?oldest=${oldest60d}&newest=${todayStr}`,
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
apiRouter.post("/api/athlete/profile", (req, res) => {
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
apiRouter.post("/api/map/config", (req, res) => {
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
apiRouter.post("/api/gemini/config", (req, res) => {
  const rawApiKey = String(req.body?.apiKey || req.body?.geminiApiKey || "").trim();
  runtimeStore.geminiApiKey = rawApiKey;
  saveSessionCache();
  res.json({
    ok: true,
    hasGeminiServerKey: Boolean(runtimeStore.geminiApiKey)
  });
});
apiRouter.get("/api/config/export-bundle", (req, res) => {
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
apiRouter.post("/api/config/import-bundle", (req, res) => {
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
apiRouter.post("/api/intervals/connect", async (req, res) => {
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
      const errText = await profileResp.text();
      res.status(profileResp.status).json({
        error: `Intervals.icu authentication failed (${profileResp.status}). Verify your Athlete ID (use "0" for default) and API Key at https://intervals.icu/settings. Details: ${errText.slice(0, 140)}`
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
apiRouter.post("/api/intervals/disconnect", async (req, res) => {
  runtimeStore.intervalsApiKey = "";
  runtimeStore.intervalsAthleteName = "";
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
apiRouter.post("/api/garmin/disconnect", async (req, res) => {
  const scopeKey = getGarminScopeKey(req);
  if (scopeKey && scopeKey !== "unauthenticated") {
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
  }
  await saveSessionCacheAsync(req, res);
  res.json({ connected: false });
});
async function syncIntervalsAllHistory(apiKey, athleteId, oldestActivitiesDate = "2010-01-01") {
  const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  const now = /* @__PURE__ */ new Date();
  const newest = now.toISOString().slice(0, 10);
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
  const wellnessByDateMap = /* @__PURE__ */ new Map();
  for (const w of wellnessDays) {
    if (w && w.date) wellnessByDateMap.set(w.date, w);
  }
  const knownGarminLoadByDate = /* @__PURE__ */ new Map();
  const stubsByDate = /* @__PURE__ */ new Map();
  const garminStravaIds = /* @__PURE__ */ new Set();
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
    let sportCategory = "Strength";
    if (/ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|trackride|cyclocross|zwift|trainerroad|peloton|rouvy|mywhoosh|wahoo|kickr|tacx/i.test(
      combinedMeta
    )) {
      sportCategory = "Cycling";
    } else if (/run|trailrun|virtualrun|treadmill/i.test(combinedMeta)) {
      sportCategory = "Running";
    } else if (/swim|openwater/i.test(combinedMeta)) {
      sportCategory = "Swimming";
    } else if (/triathlon|multisport|brick|transition/i.test(combinedMeta)) {
      sportCategory = "Multisport";
    } else {
      sportCategory = "Strength";
    }
    const rawStartLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length >= 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : void 0;
    const isWatopiaOrMakuriGps = rawStartLatLng && Number.isFinite(rawStartLatLng[0]) && Number.isFinite(rawStartLatLng[1]) && rawStartLatLng[0] >= -12.6 && rawStartLatLng[0] <= -9.8 && rawStartLatLng[1] >= 164.8 && rawStartLatLng[1] <= 168;
    const hasNoLatLngStream = Array.isArray(a.stream_types) && a.stream_types.length > 0 && !a.stream_types.includes("latlng");
    const isZeroGpsStationaryRide = sportCategory === "Cycling" && !rawStartLatLng && (hasNoLatLngStream || Number(a.total_elevation_gain ?? 0) === 0);
    const isVirtualPlatform = /virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
      combinedMeta
    ) || Boolean(isWatopiaOrMakuriGps);
    const isIndoor = Boolean(a.trainer) || Boolean(isVirtualPlatform) || Boolean(isZeroGpsStationaryRide) || /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga|pool/i.test(
      combinedMeta
    );
    let subType = "Road";
    if (sportCategory === "Cycling") {
      if (isVirtualPlatform) subType = "Virtual Cycling";
      else if (isIndoor) subType = "Smart Trainer";
      else if (/gravel/i.test(combinedMeta)) subType = "Gravel";
      else if (/mountain|mtb|trail/i.test(combinedMeta)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Running") {
      if (isIndoor) subType = "Treadmill";
      else if (/trail/i.test(combinedMeta)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Swimming") {
      subType = /open/i.test(rawType) ? "Open Water" : "Pool";
    } else {
      subType = "Gym";
    }
    const movingTimeSecs = Number(a.moving_time ?? a.elapsed_time ?? 0);
    const distanceMeters = Number(a.distance ?? 0);
    const avgPower = a.icu_average_watts ?? a.average_watts ?? void 0;
    const normalizedPower = a.icu_weighted_avg_watts ?? avgPower;
    const avgHr = Number(a.average_heartrate ?? 0);
    const maxHr = Number(a.max_heartrate ?? 0);
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
    const gapPaceSecsPerKm = sportCategory === "Running" && a.gap && Number(a.gap) > 0 ? Math.round(1e3 / Number(a.gap)) : avgPaceSecsPerKm;
    const ef = a.icu_efficiency_factor != null ? Number(Number(a.icu_efficiency_factor).toFixed(2)) : normalizedPower && avgHr > 0 ? Number((Number(normalizedPower) / avgHr).toFixed(2)) : 0;
    const decoupling = a.decoupling != null ? Number(Number(a.decoupling).toFixed(1)) : 0;
    let resolvedGearName = a.gear?.name || void 0;
    if (!resolvedGearName && a.gear_id && runtimeStore.gearItems.length > 0) {
      const foundGear = runtimeStore.gearItems.find((g) => g.id === String(a.gear_id));
      if (foundGear) resolvedGearName = foundGear.name;
    }
    return {
      id: String(a.id),
      intervalsId: String(a.id),
      stravaId: a.strava_id ? String(a.strava_id) : void 0,
      startDateLocal: String(a.start_date_local),
      name: String(a.name || rawType || sportCategory),
      sportCategory,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      subType,
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters: Math.round(Number(a.total_elevation_gain ?? 0)),
      avgPower: avgPower ? Math.round(Number(avgPower)) : void 0,
      normalizedPower: normalizedPower ? Math.round(Number(normalizedPower)) : void 0,
      intensityFactor: a.icu_intensity ? Number((Number(a.icu_intensity) / 100).toFixed(2)) : void 0,
      variabilityIndex: a.icu_variability_index ? Number(Number(a.icu_variability_index).toFixed(2)) : void 0,
      trainingLoad: Math.round(Number(a.icu_training_load ?? 0)),
      avgHr: Math.round(avgHr),
      maxHr: Math.round(maxHr),
      avgCadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : void 0,
      avgPaceSecsPerKm,
      gapPaceSecsPerKm,
      aerobicDecouplingPct: decoupling,
      efficiencyFactor: ef,
      firstHalfEf: ef > 0 ? Number((ef * (1 + decoupling / 200)).toFixed(2)) : 0,
      secondHalfEf: ef > 0 ? Number((ef * (1 - decoupling / 200)).toFixed(2)) : 0,
      calories: a.calories ? Math.round(Number(a.calories)) : void 0,
      deviceName: a.device_name ? String(a.device_name) : void 0,
      zoneSecs: {
        hr: Array.isArray(a.icu_hr_zone_times) ? a.icu_hr_zone_times.slice(0, 7).map((z) => typeof z === "number" ? z : Number(z?.secs ?? 0)) : [0, 0, 0, 0, 0, 0, 0],
        power: Array.isArray(a.icu_zone_times) ? a.icu_zone_times.slice(0, 7).map((z) => typeof z === "number" ? z : Number(z?.secs ?? 0)) : void 0
      },
      gearName: resolvedGearName,
      stravaPrCount: Number(a.pr_count ?? 0),
      hasSegments: Boolean(a.has_segments),
      routeLatLngs: void 0,
      startLatLng: void 0,
      endLatLng: void 0,
      kudosCount: void 0,
      commentCount: void 0,
      hasKudoed: void 0,
      kudoers: void 0,
      comments: void 0,
      segmentEfforts: [],
      sourceBadges: a.source === "GARMIN_CONNECT" ? ["Intervals.icu", "Garmin"] : a.strava_id ? ["Intervals.icu", "Strava"] : ["Intervals.icu"]
    };
  });
  const segmentsCache = loadJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, {});
  const routesCache = loadJsonFile(
    ROUTES_BY_ACTIVITY_CACHE_FILE,
    {}
  );
  const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
  const uncachedWithSegments = activities.filter(
    (act) => act.hasSegments && (act.sportCategory === "Cycling" || act.sportCategory === "Running") && (!Array.isArray(segmentsCache[act.id]) || !Array.isArray(routesCache[act.id]))
  );
  if ((Object.keys(segmentsCache).length < 36 || Object.keys(routesCache).length < 20) && uncachedWithSegments.length > 0) {
    const perSportLimit = isDeltaSync ? 3 : 14;
    const cyclingCandidates = uncachedWithSegments.filter((a) => a.sportCategory === "Cycling").slice(0, perSportLimit);
    const runningCandidates = uncachedWithSegments.filter((a) => a.sportCategory === "Running").slice(0, perSportLimit);
    const batchToHydrate = [...cyclingCandidates, ...runningCandidates];
    for (let i = 0; i < batchToHydrate.length; i += 10) {
      const slice = batchToHydrate.slice(i, i + 10);
      await Promise.all(
        slice.map(async (act) => {
          try {
            const [segResp, stResp] = await Promise.all([
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(act.id)}/segments`,
                { headers: { Authorization: authHeader, Accept: "application/json" } }
              ),
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(act.id)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,altitude`,
                { headers: { Authorization: authHeader, Accept: "application/json" } }
              )
            ]);
            if (segResp.ok && stResp.ok) {
              const rawSegs = await segResp.json();
              const rawStreams = await stResp.json();
              const efforts = computeIntervalsSegmentEfforts(rawSegs, rawStreams, act);
              segmentsCache[act.id] = efforts;
              const latlngEntry = Array.isArray(rawStreams) ? rawStreams.find((s) => s && s.type === "latlng") : void 0;
              if (latlngEntry && Array.isArray(latlngEntry.data) && Array.isArray(latlngEntry.data2) && latlngEntry.data.length > 2) {
                const step = Math.max(1, Math.floor(latlngEntry.data.length / 160));
                const compactPts = [];
                for (let k = 0; k < latlngEntry.data.length; k += step) {
                  const lat = latlngEntry.data[k];
                  const lng = latlngEntry.data2[k];
                  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) && Math.abs(lat) > 0.01) {
                    compactPts.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
                  }
                }
                if (compactPts.length > 2) {
                  routesCache[act.id] = compactPts;
                }
              }
            } else {
              if (!Array.isArray(segmentsCache[act.id])) segmentsCache[act.id] = [];
            }
          } catch {
          }
        })
      );
    }
    saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
  }
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
  const scopedPlannedFile = getScopedPlannedEventsFile(void 0, apiKey);
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
apiRouter.get("/api/intervals/sync", async (req, res) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: "Intervals.icu API Key is not configured." });
      return;
    }
    const oldestParam = String(req.query.oldest || "2010-01-01").trim();
    const payload = await syncIntervalsAllHistory(apiKey, athleteId, oldestParam);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to sync Intervals.icu data"
    });
  }
});
apiRouter.post("/api/segments/scan-more", async (req, res) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: "Intervals.icu API Key is not configured." });
      return;
    }
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    const resolvedId = athleteId || "0";
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const activitiesUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2015-01-01&newest=${todayStr}`;
    const actResp = await fetch(activitiesUrl, {
      headers: { Authorization: authHeader, Accept: "application/json" }
    });
    if (!actResp.ok) {
      res.status(actResp.status).json({ error: "Unable to fetch Intervals.icu activities list" });
      return;
    }
    const rawActivities = await actResp.json();
    const segmentsCache = loadJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, {});
    const routesCache = loadJsonFile(
      ROUTES_BY_ACTIVITY_CACHE_FILE,
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
    saveJsonFile(SEGMENTS_BY_ACTIVITY_CACHE_FILE, segmentsCache);
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
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
apiRouter.get("/api/intervals/activities/:id/streams", async (req, res) => {
  try {
    const { apiKey } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({ error: "Intervals.icu API Key is not configured." });
      return;
    }
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
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
apiRouter.get("/api/calendar/events", (req, res) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  if (!scopedFile) {
    res.json({ events: [] });
    return;
  }
  const localPlanned = loadJsonFile(scopedFile, []);
  res.json({ events: localPlanned });
});
apiRouter.post("/api/calendar/events", async (req, res) => {
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
      structuredSteps: Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0 ? body.structuredSteps : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs),
      source: body.source || "USER"
    };
    const scopedFile = getScopedPlannedEventsFile(req);
    let updated = [newEvent];
    if (scopedFile) {
      const existing = loadJsonFile(scopedFile, []);
      updated = [newEvent, ...existing];
      saveJsonFile(scopedFile, updated);
    }
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    let pushedToIntervals = false;
    if (apiKey && body.syncToIntervals !== false) {
      try {
        const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
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
              start_date_local: `${date}T08:00:00`,
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
apiRouter.delete("/api/calendar/events/:id", (req, res) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  if (!scopedFile) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const id = req.params.id;
  const existing = loadJsonFile(scopedFile, []);
  const updated = existing.filter((e) => e.id !== id);
  saveJsonFile(scopedFile, updated);
  res.json({ deleted: true, events: updated });
});
var pendingOAuthByState = /* @__PURE__ */ new Map();
function ensureRequestSessionSid(req, res, fallbackSubject = "thresh-athlete") {
  const verified = getVerifiedSessionClaims(req);
  if (verified?.sid) {
    bindRequestScopeKey(req, verified.sid);
    return verified.sid;
  }
  const sid = crypto5.randomBytes(16).toString("hex");
  setSessionCookie(req, res, fallbackSubject, sid);
  bindRequestScopeKey(req, sid);
  return sid;
}
async function activateStravaCanonicalScope(req, res, opts) {
  const prevClaims = getVerifiedSessionClaims(req);
  const prevStore = getScopedRuntimeStore(req);
  const canonicalSid = opts.athleteId ? deriveStravaSessionSid(opts.athleteId) : prevClaims?.sid || crypto5.randomBytes(16).toString("hex");
  if (opts.athleteId && prevClaims?.sid && prevClaims.sid !== canonicalSid) {
    await migrateAnonymousTeamsToStravaSid({
      oldSid: prevClaims.sid,
      stravaSid: canonicalSid,
      athleteName: !isGenericName(opts.athleteName) ? opts.athleteName : void 0,
      stravaAthleteId: opts.athleteId
    });
  }
  const scopeKey = canonicalSid.slice(0, 24);
  await loadTenantVaultAsync(`session_${scopeKey}`, {});
  bindRequestScopeKey(req, canonicalSid);
  const sessionToken = setSessionCookie(
    req,
    res,
    !isGenericName(opts.athleteName) ? opts.athleteName : "Strava Athlete",
    canonicalSid
  );
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
  if (!store.stravaSyncPolicy && prevStore.stravaSyncPolicy) {
    store.stravaSyncPolicy = prevStore.stravaSyncPolicy;
  }
  return { canonicalSid, scopeKey, sessionToken, store };
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
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">THRESH \xB7 Strava Identity</div>
      <h2 style="margin:0 0 10px;color:${accent};font-size:18px;line-height:1.3;">${opts.heading}</h2>
      <p style="margin:0 0 ${ctaHtml ? "20px" : "0"};color:#CBD5E1;font-size:13px;line-height:1.55;">${opts.body}</p>
      ${ctaHtml}
    </div>
    ${opts.scriptBody ? `<script>${opts.scriptBody}</script>` : ""}
  </body>
</html>`;
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
apiRouter.post("/api/strava/credentials", async (req, res) => {
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
apiRouter.get(["/api/strava/auth/url", "/api/auth/strava/url"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
  if (!clientId || !clientSecret) {
    res.status(400).json({
      error: "Strava OAuth is not configured on this server yet. Please set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in your Vercel Environment Variables (or local .env)."
    });
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const mode = String(req.query.mode || "cloud").toLowerCase();
  const flow = String(req.query.flow || "redirect").toLowerCase() === "popup" ? "popup" : "redirect";
  const prompt = String(req.query.prompt || "auto").toLowerCase() === "force" ? "force" : "auto";
  const clientNonce = String(req.query.state || "").trim();
  const joinCode = String(req.query.joinCode || req.query.join || "").trim().slice(0, 32) || void 0;
  const slug = String(req.query.slug || "").trim().slice(0, 64) || void 0;
  const inviteToken = String(req.query.inviteToken || req.query.t || "").trim().slice(0, 96) || void 0;
  const { stateToken, nonce } = issueOAuthStateToken({
    nonce: clientNonce || void 0,
    sid,
    flow,
    mode,
    joinCode,
    slug,
    inviteToken
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = mode === "localhost" ? "http://localhost/exchange_token" : resolveCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: prompt,
    scope: "read,activity:read_all,profile:read_all",
    state: stateToken
  });
  const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
  res.json({ url: authUrl, redirectUri, clientId, state: stateToken });
});
apiRouter.get(["/api/strava/auth/login", "/api/auth/strava/login"], (req, res) => {
  const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
  if (!clientId || !clientSecret) {
    const msg = encodeURIComponent(
      "Strava OAuth is not configured on this server yet (missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET)."
    );
    res.redirect(302, `/?auth_error=${msg}`);
    return;
  }
  const sid = ensureRequestSessionSid(req, res);
  const prompt = String(req.query.prompt || "auto").toLowerCase() === "force" ? "force" : "auto";
  const joinCode = String(req.query.joinCode || req.query.join || "").trim().slice(0, 32) || void 0;
  const slug = String(req.query.slug || "").trim().slice(0, 64) || void 0;
  const inviteToken = String(req.query.inviteToken || req.query.t || "").trim().slice(0, 96) || void 0;
  const { stateToken, nonce } = issueOAuthStateToken({
    sid,
    flow: "redirect",
    mode: "cloud",
    joinCode,
    slug,
    inviteToken
  });
  setOAuthStateCookie(req, res, nonce);
  const redirectUri = resolveCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: prompt,
    scope: "read,activity:read_all,profile:read_all",
    state: stateToken
  });
  res.redirect(302, `https://www.strava.com/oauth/authorize?${params.toString()}`);
});
apiRouter.get("/api/strava/auth/poll", async (req, res) => {
  const state = String(req.query.state || "").trim();
  const verifiedState = verifyOAuthStateToken(state);
  if (!verifiedState) {
    res.json({ completed: false });
    return;
  }
  const now = Date.now();
  for (const [k, v] of pendingOAuthByState.entries()) {
    if (now - v.createdAt > 180 * 1e3) {
      pendingOAuthByState.delete(k);
    }
  }
  let found = pendingOAuthByState.get(
    verifiedState.nonce
  );
  if (!found) {
    found = await loadTenantVaultAsync(
      `oauth_poll_${verifiedState.nonce}`,
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
  const authorizedCaller = cookieNonce && cookieNonce === verifiedState.nonce || verifiedState.sid && callerClaims?.sid === verifiedState.sid || canonicalSidForFound && callerClaims?.sid === canonicalSidForFound || !verifiedState.sid;
  if (!authorizedCaller) {
    res.json({ completed: false });
    return;
  }
  pendingOAuthByState.delete(verifiedState.nonce);
  await deleteTenantVault(`oauth_poll_${verifiedState.nonce}`);
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
      accessToken: found.accessToken,
      refreshToken: found.refreshToken,
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
  const tokenData = await tokenResp.json();
  return tokenData;
}
apiRouter.post("/api/strava/exchange-code", async (req, res) => {
  try {
    const codeOrUrl = String(req.body?.code || req.body?.url || "").trim();
    const tokenData = await exchangeStravaAuthCode(codeOrUrl, req);
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    const athleteName = [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(" ").trim() || tokenData.athlete?.username?.trim() || "Strava Athlete";
    const athleteId = tokenData.athlete?.id ? String(tokenData.athlete.id) : void 0;
    const weightKg = typeof tokenData.athlete?.weight === "number" && tokenData.athlete.weight > 30 ? Number(tokenData.athlete.weight.toFixed(1)) : void 0;
    const ftp = typeof tokenData.athlete?.ftp === "number" && tokenData.athlete.ftp > 80 ? Math.round(tokenData.athlete.ftp) : void 0;
    const measurementPreference = tokenData.athlete?.measurement_preference === "meters" ? "km" : tokenData.athlete?.measurement_preference === "feet" ? "mi" : void 0;
    const { canonicalSid, sessionToken, store } = await activateStravaCanonicalScope(req, res, {
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
apiRouter.post("/api/strava/token", async (req, res) => {
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
        const refreshed = await refreshResp.json();
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
      const athlete = await athleteResp.json();
      athleteName = [athlete.firstname, athlete.lastname].filter(Boolean).join(" ").trim() || athlete.username?.trim() || "Strava Athlete";
      if (athlete.id) athleteId = String(athlete.id);
      if (typeof athlete.weight === "number" && athlete.weight > 30) {
        weightKg = Number(athlete.weight.toFixed(1));
      }
      if (typeof athlete.ftp === "number" && athlete.ftp > 80) {
        ftp = Math.round(athlete.ftp);
      }
      if (athlete.measurement_preference === "meters") measurementPreference = "km";
      else if (athlete.measurement_preference === "feet") measurementPreference = "mi";
    }
    const { canonicalSid, sessionToken, store } = await activateStravaCanonicalScope(req, res, {
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
apiRouter.post("/api/strava/sync-policy", async (req, res) => {
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
apiRouter.post("/api/strava/disconnect", async (req, res) => {
  if (!isAuthenticatedRequest(req)) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  runtimeStore.stravaAccessToken = "";
  runtimeStore.stravaRefreshToken = "";
  runtimeStore.stravaExpiresAt = 0;
  runtimeStore.stravaAthleteId = void 0;
  runtimeStore.stravaAthleteName = "";
  runtimeStore.stravaMeasurementPreference = void 0;
  runtimeStore.stravaGrantedScope = void 0;
  runtimeStore.stravaSyncPolicy = void 0;
  await saveSessionCacheAsync(req, res);
  res.json({ ok: true, disconnected: "strava" });
});
var stravaCallbackHandler = async (req, res) => {
  const oauthState = String(req.query.state || "").trim();
  const verifiedState = oauthState ? verifyOAuthStateToken(oauthState) : null;
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
        error: friendlyErr
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
          scriptBody: `(function(){
              var payload = ${cancelJson};
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
              if (hasOpener || window.name === 'strava_oauth_popup') {
                setTimeout(function() { try { window.close(); } catch (e) {} }, 250);
              }
            })();`
        })
      );
      return;
    }
    const code = req.query.code;
    if (!code) {
      res.status(400).type("html").send(
        renderThreshOAuthHtml({
          title: "Missing Authorization Code",
          heading: "Missing Strava Authorization Code",
          accentColor: "#FB7185",
          body: "No authorization code was received from Strava. Please start sign-in from THRESH.",
          ctaLabel: "Return to THRESH Sign-In",
          ctaHref: "/"
        })
      );
      return;
    }
    if (oauthState && !verifiedState) {
      clearOAuthStateCookie(res);
      throw new Error(
        "OAuth security state expired or could not be verified. Please start Strava sign-in again from THRESH."
      );
    }
    const cookieNonce = getOAuthStateCookieNonce(req);
    if (verifiedState && cookieNonce && cookieNonce !== verifiedState.nonce) {
      clearOAuthStateCookie(res);
      throw new Error(
        "OAuth session state mismatch detected. Please start Strava sign-in again from THRESH."
      );
    }
    const grantedScope = String(req.query.scope || "").trim() || void 0;
    const { clientId, clientSecret } = getEffectiveStravaClientConfig(req);
    if (!clientId || !clientSecret) {
      const relayReturnUrl = buildReturnOnboardingUrl(verifiedState, { code });
      const codeRelayJson = safeJsonForScript({
        type: "OAUTH_AUTH_CODE",
        provider: "strava",
        code,
        state: oauthState || void 0,
        grantedScope,
        returnUrl: relayReturnUrl
      });
      res.type("html").send(
        renderThreshOAuthHtml({
          title: "Completing Strava Sign-In\u2026",
          heading: "Finishing Strava Connection\u2026",
          body: "Returning securely to THRESH\u2026",
          ctaLabel: "Continue to THRESH",
          ctaHref: relayReturnUrl,
          scriptBody: `(function() {
            var payload = ${codeRelayJson};
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
            if (hasOpener || window.name === 'strava_oauth_popup') {
              setTimeout(function() { try { window.close(); } catch (e) {} }, 300);
            } else {
              window.location.replace(payload.returnUrl);
            }
          })();`
        })
      );
      return;
    }
    const tokenData = await exchangeStravaAuthCode(code, req);
    let athleteName = [tokenData.athlete?.firstname, tokenData.athlete?.lastname].filter(Boolean).join(" ").trim() || tokenData.athlete?.username?.trim() || "";
    let athleteId = tokenData.athlete?.id ? String(tokenData.athlete.id) : void 0;
    let athleteWeightKg = typeof tokenData.athlete?.weight === "number" && tokenData.athlete.weight > 30 ? Number(tokenData.athlete.weight.toFixed(1)) : void 0;
    let athleteFtp = typeof tokenData.athlete?.ftp === "number" && tokenData.athlete.ftp > 80 ? Math.round(tokenData.athlete.ftp) : void 0;
    let measurementPreference = tokenData.athlete?.measurement_preference === "meters" ? "km" : tokenData.athlete?.measurement_preference === "feet" ? "mi" : void 0;
    if (!athleteName || isGenericName(athleteName) || !athleteWeightKg || !athleteFtp || !measurementPreference) {
      try {
        const profResp = await fetch("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (profResp.ok) {
          const prof = await profResp.json();
          const fetchedName = [prof.firstname, prof.lastname].filter(Boolean).join(" ").trim() || prof.username?.trim() || "";
          if (fetchedName && !isGenericName(fetchedName)) {
            athleteName = fetchedName;
          }
          if (!athleteId && prof.id) athleteId = String(prof.id);
          if (!athleteWeightKg && typeof prof.weight === "number" && prof.weight > 30) {
            athleteWeightKg = Number(prof.weight.toFixed(1));
          }
          if (!athleteFtp && typeof prof.ftp === "number" && prof.ftp > 80) {
            athleteFtp = Math.round(prof.ftp);
          }
          if (!measurementPreference) {
            if (prof.measurement_preference === "meters") measurementPreference = "km";
            else if (prof.measurement_preference === "feet") measurementPreference = "mi";
          }
        }
      } catch {
      }
    }
    if (!athleteName) {
      athleteName = "Strava Athlete";
    }
    if (athleteId && !isGenericName(athleteName)) {
      const identityEntry = {
        athleteId,
        athleteName,
        ftp: athleteFtp,
        weightKg: athleteWeightKg,
        measurementPreference
      };
      stravaIdentityByToken.set(tokenData.access_token, identityEntry);
      if (tokenData.refresh_token) {
        stravaIdentityByToken.set(tokenData.refresh_token, identityEntry);
      }
    }
    const { canonicalSid, sessionToken, store } = await activateStravaCanonicalScope(req, res, {
      athleteId,
      athleteName
    });
    const hasExistingSyncPolicy = Boolean(store.stravaSyncPolicy?.confirmedAt);
    store.stravaAccessToken = tokenData.access_token;
    store.stravaRefreshToken = tokenData.refresh_token;
    store.stravaExpiresAt = tokenData.expires_at;
    if (athleteId) store.stravaAthleteId = athleteId;
    if (measurementPreference) store.stravaMeasurementPreference = measurementPreference;
    if (grantedScope) store.stravaGrantedScope = grantedScope;
    if (clientId) store.stravaClientId = clientId;
    if (clientSecret) store.stravaClientSecret = clientSecret;
    if (!isGenericName(athleteName)) store.stravaAthleteName = athleteName;
    await saveSessionCacheAsync(req, res, canonicalSid);
    clearOAuthStateCookie(res);
    if (verifiedState?.nonce) {
      const pollEntry = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at,
        clientId: clientId || void 0,
        athleteId,
        athleteName: !isGenericName(athleteName) ? athleteName : void 0,
        weightKg: athleteWeightKg,
        ftp: athleteFtp,
        measurementPreference,
        grantedScope,
        hasExistingSyncPolicy,
        createdAt: Date.now()
      };
      pendingOAuthByState.set(verifiedState.nonce, pollEntry);
      await saveTenantVaultAsync(`oauth_poll_${verifiedState.nonce}`, pollEntry);
    }
    const returnOnboardingUrl = buildReturnOnboardingUrl(verifiedState, {
      oauth: "strava_connected"
    });
    const targetRedirectUrl = hasExistingSyncPolicy ? "/#fitness" : returnOnboardingUrl;
    const oauthPayloadJson = safeJsonForScript({
      type: "OAUTH_AUTH_SUCCESS",
      provider: "strava",
      hasExistingSyncPolicy,
      returnUrl: targetRedirectUrl,
      sessionToken,
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at,
        clientId: clientId || void 0,
        athleteId,
        athleteName: !isGenericName(athleteName) ? athleteName : void 0,
        weightKg: athleteWeightKg,
        ftp: athleteFtp,
        measurementPreference,
        grantedScope
      }
    });
    res.type("html").send(
      renderThreshOAuthHtml({
        title: "Strava Verified \xB7 THRESH",
        heading: `Strava Verified${!isGenericName(athleteName) ? ` \xB7 ${escapeHtml(athleteName)}` : ""}`,
        body: hasExistingSyncPolicy ? "Welcome back! Restoring your THRESH training workspace\u2026" : "Identity verified. Returning to THRESH so you can choose what Strava data to sync\u2026",
        ctaLabel: "Continue to THRESH",
        ctaHref: targetRedirectUrl,
        scriptBody: `(function() {
          var payload = ${oauthPayloadJson};
          try {
            if (payload.sessionToken) {
              localStorage.setItem('aeropulse_session_token', payload.sessionToken);
            }
            if (payload.tokens) {
              var prevAthleteId = localStorage.getItem('aeropulse_strava_athlete_id');
              if (prevAthleteId && payload.tokens.athleteId && String(payload.tokens.athleteId) !== prevAthleteId) {
                localStorage.removeItem('aeropulse_strava_athlete_name');
                localStorage.removeItem('aeropulse_auth_gate_passed');
              }
              if (payload.tokens.accessToken) localStorage.setItem('aeropulse_strava_access_token', payload.tokens.accessToken);
              if (payload.tokens.refreshToken) localStorage.setItem('aeropulse_strava_refresh_token', payload.tokens.refreshToken);
              if (payload.tokens.expiresAt) localStorage.setItem('aeropulse_strava_expires_at', String(payload.tokens.expiresAt));
              if (payload.tokens.clientId) localStorage.setItem('aeropulse_strava_client_id', payload.tokens.clientId);
              if (payload.tokens.athleteId) localStorage.setItem('aeropulse_strava_athlete_id', String(payload.tokens.athleteId));
              if (payload.tokens.athleteName) localStorage.setItem('aeropulse_strava_athlete_name', payload.tokens.athleteName);
              if (payload.tokens.weightKg) localStorage.setItem('aeropulse_strava_athlete_weight_kg', String(payload.tokens.weightKg));
              if (payload.tokens.ftp) localStorage.setItem('aeropulse_strava_athlete_ftp', String(payload.tokens.ftp));
              if (payload.tokens.measurementPreference) localStorage.setItem('aeropulse_strava_measurement_pref', payload.tokens.measurementPreference);
              if (payload.tokens.grantedScope) localStorage.setItem('aeropulse_strava_granted_scope', payload.tokens.grantedScope);
              localStorage.removeItem('aeropulse_logged_out');
              if (payload.hasExistingSyncPolicy) {
                localStorage.setItem('aeropulse_auth_gate_passed', '1');
              } else {
                localStorage.removeItem('aeropulse_auth_gate_passed');
              }
              localStorage.setItem('aeropulse_oauth_just_connected', '1');
            }
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
          var isPopupWindow = hasOpener || window.name === 'strava_oauth_popup';
          if (isPopupWindow) {
            setTimeout(function() {
              try { window.close(); } catch (e) {}
            }, 300);
          } else {
            window.location.replace(payload.returnUrl || '/');
          }
        })();`
      })
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    const returnHref = buildReturnOnboardingUrl(verifiedState, {
      auth_error: `Strava sign-in failed: ${errMsg}`
    });
    const errJson = safeJsonForScript({
      type: "OAUTH_AUTH_ERROR",
      provider: "strava",
      error: `Strava sign-in failed: ${errMsg}`
    });
    res.status(400).type("html").send(
      renderThreshOAuthHtml({
        title: "Strava Sign-In Error",
        heading: "Strava Sign-In Could Not Complete",
        accentColor: "#FB7185",
        body: escapeHtml(errMsg),
        ctaLabel: "Return to THRESH",
        ctaHref: returnHref,
        ctaOnClick: "if (window.opener || window.name === 'strava_oauth_popup') { try { window.close(); } catch (e) {} return false; }",
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
apiRouter.get(
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
apiRouter.get(["/api/index", "/api"], (req, res, next) => {
  if (req.query.code || req.query.error && req.query.state !== void 0) {
    void stravaCallbackHandler(req, res);
    return;
  }
  next();
});
async function syncStravaAllHistory(req, forceFull = false, deltaOnly = false, explicitWindow) {
  let activeAccessToken = await ensureValidStravaAccessToken(req, false);
  if (!activeAccessToken) {
    throw new Error("Strava is not connected via OAuth yet.");
  }
  const validWindows = /* @__PURE__ */ new Set(["90d", "180d", "365d", "all", "none"]);
  const effectiveWindow = explicitWindow && validWindows.has(explicitWindow) ? explicitWindow : forceFull ? "all" : runtimeStore.stravaSyncPolicy?.window || "90d";
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
      stravaTokens: getStravaTokenRotationPayload(req)
    };
  }
  const windowDays = effectiveWindow === "90d" ? 90 : effectiveWindow === "180d" ? 180 : effectiveWindow === "365d" ? 365 : 0;
  const afterEpoch = windowDays > 0 ? Math.floor((Date.now() - windowDays * 86400 * 1e3) / 1e3) : 0;
  const afterQuery = afterEpoch > 0 ? `&after=${afterEpoch}` : "";
  let headers = { Authorization: `Bearer ${activeAccessToken}` };
  let rawActivitiesMap = /* @__PURE__ */ new Map();
  let scopedArchiveFile = "";
  let firstPageResp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${afterQuery}`,
    { headers }
  );
  const { refreshToken: callerRefreshToken } = getEffectiveStravaClientConfig(req);
  if (firstPageResp.status === 401 && callerRefreshToken) {
    activeAccessToken = await ensureValidStravaAccessToken(req, true);
    headers = { Authorization: `Bearer ${activeAccessToken}` };
    firstPageResp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=1${afterQuery}`,
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
          stravaTokens: getStravaTokenRotationPayload(req)
        };
      }
      throw new Error(
        "Strava session expired or invalid. Reconnect Strava to refresh your session."
      );
    }
  } else {
    const firstPageItems = await firstPageResp.json();
    if (Array.isArray(firstPageItems)) {
      const stravaAthleteId2 = String(
        firstPageItems[0]?.athlete?.id || runtimeStore.stravaAthleteId || ""
      ).replace(/[^0-9]/g, "");
      if (stravaAthleteId2) {
        scopedArchiveFile = `/tmp/aeropulse-strava-archive-${stravaAthleteId2}.json`;
        const cachedArchive = loadJsonFile(scopedArchiveFile, []);
        for (const item of cachedArchive) {
          if (!item || !item.id) continue;
          if (afterEpoch > 0) {
            const itemEpoch = Math.floor(
              new Date(item.start_date || item.start_date_local || 0).getTime() / 1e3
            );
            if (itemEpoch > 0 && itemEpoch < afterEpoch) continue;
          }
          rawActivitiesMap.set(String(item.id), item);
        }
      }
      const existingCachedCount = rawActivitiesMap.size;
      for (const item of firstPageItems) {
        if (item && item.id) rawActivitiesMap.set(String(item.id), item);
      }
      const shouldPaginateAll = existingCachedCount <= 200 || !deltaOnly || forceFull;
      const isStravaRateLimited = (resp) => {
        const usage = resp.headers.get("x-ratelimit-usage") || "";
        const shortWindow = Number(usage.split(",")[0] || 0);
        return shortWindow >= 80;
      };
      const maxPageToFetch = effectiveWindow === "all" ? 10 : 3;
      if (shouldPaginateAll && firstPageItems.length === 200 && !isStravaRateLimited(firstPageResp)) {
        for (let page = 2; page <= maxPageToFetch; page += 2) {
          const pages = page + 1 <= maxPageToFetch ? [page, page + 1] : [page];
          const batchResps = await Promise.all(
            pages.map(
              (p) => fetch(
                `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${p}${afterQuery}`,
                { headers }
              )
            )
          );
          let reachedEnd = false;
          for (const r of batchResps) {
            if (!r.ok || isStravaRateLimited(r)) {
              reachedEnd = true;
              break;
            }
            const pageItems = await r.json();
            if (!Array.isArray(pageItems) || pageItems.length === 0) {
              reachedEnd = true;
            } else {
              for (const item of pageItems) {
                if (item && item.id) rawActivitiesMap.set(String(item.id), item);
              }
              if (pageItems.length < 200) reachedEnd = true;
            }
          }
          if (reachedEnd) break;
        }
      }
    }
  }
  const activitiesList = Array.from(rawActivitiesMap.values()).sort(
    (a, b) => new Date(b.start_date_local || 0).getTime() - new Date(a.start_date_local || 0).getTime()
  );
  if (activitiesList.length > 0 && scopedArchiveFile) {
    saveJsonFile(scopedArchiveFile, activitiesList);
  }
  const [starredResp, stravaProfileResp, stravaZonesResp] = await Promise.all([
    firstPageResp.ok ? fetch("https://www.strava.com/api/v3/segments/starred?per_page=15", { headers }) : Promise.resolve(null),
    fetch("https://www.strava.com/api/v3/athlete", { headers }),
    importProfileAndGear ? fetch("https://www.strava.com/api/v3/athlete/zones", { headers }) : Promise.resolve(null)
  ]);
  const starredSegments = starredResp && starredResp.ok ? await starredResp.json() : [];
  const stravaZonesData = stravaZonesResp && stravaZonesResp.ok ? await stravaZonesResp.json() : null;
  let stravaAthleteName = "";
  let stravaAthleteId = "";
  let stravaFtp;
  let stravaWeightKg;
  let stravaMeasurementPreference;
  let stravaGearItems = [];
  if (stravaProfileResp && stravaProfileResp.ok) {
    const rawAthlete = await stravaProfileResp.json();
    stravaAthleteId = String(rawAthlete.id || "");
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
        id: String(b.id),
        name: String(b.name || "Road Bike"),
        type: "BIKE",
        distanceMeters: Number(b.distance || 0),
        maxRecommendedMeters: 8046720,
        primary: Boolean(b.primary)
      })) : [];
      const shoes = Array.isArray(rawAthlete.shoes) ? rawAthlete.shoes.map((s) => ({
        id: String(s.id),
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
  const calibratedFtp = Math.max(100, prelimAthleteProfile.ftp || stravaFtp || 250);
  const calibratedBikeLthr = Math.max(120, prelimAthleteProfile.lthr || 163);
  const calibratedRunLthr = Math.max(125, prelimAthleteProfile.runLthr || 168);
  const calibratedThresholdPaceSecsPerKm = Math.max(
    155,
    prelimAthleteProfile.thresholdPaceSecsPerKm || 265
  );
  const topIds = activitiesList.slice(0, 2).map((a) => a.id);
  const detailedPayloads = await Promise.all(
    topIds.map(async (id) => {
      const dResp = await fetch(
        `https://www.strava.com/api/v3/activities/${id}?include_all_efforts=true`,
        { headers }
      );
      return dResp.ok ? await dResp.json() : null;
    })
  );
  const detailById = /* @__PURE__ */ new Map();
  for (const d of detailedPayloads) {
    if (d && d.id) detailById.set(Number(d.id), d);
  }
  const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
  const recentKudoCandidates = activitiesList.filter((a) => a && a.id && Number(a.kudos_count || 0) > 0 && !kudosCache[String(a.id)]?.kudoers).slice(0, 2);
  if (recentKudoCandidates.length > 0) {
    await Promise.all(
      recentKudoCandidates.map(async (act) => {
        const sid = String(act.id);
        try {
          const [kResp, cResp] = await Promise.all([
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/kudos?per_page=50`, {
              headers
            }),
            fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/comments?per_page=30`, {
              headers
            })
          ]);
          const kudoers = kResp.ok ? (await kResp.json() || []).map((k) => ({
            firstname: String(k.firstname || "Athlete"),
            lastname: String(k.lastname || ""),
            profileMedium: k.profile_medium || k.profile || void 0,
            city: k.city || void 0,
            state: k.state || void 0,
            country: k.country || void 0
          })) : [];
          const comments = cResp.ok ? (await cResp.json() || []).map((c, idx) => ({
            id: String(c.id || `sc-${sid}-${idx}`),
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
  const normalizedStravaActivities = activitiesList.map((a) => {
    const detail = detailById.get(Number(a.id)) || a;
    const sportType = String(a.sport_type || a.type || "").trim();
    const actName = String(a.name || "");
    let sportCategory = "Strength";
    if (/ride|cycling|bike|virtualride|gravel|mountainbike|ebike|velomobile|handcycle|spinning|peloton|zwift/i.test(
      sportType + " " + actName
    )) {
      sportCategory = "Cycling";
    } else if (/run|trailrun|virtualrun|treadmill/i.test(sportType)) {
      sportCategory = "Running";
    } else if (/swim|openwater/i.test(sportType)) {
      sportCategory = "Swimming";
    } else {
      sportCategory = "Strength";
    }
    const rawStartLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length === 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : void 0;
    const isWatopiaOrMakuriGps = rawStartLatLng && Number.isFinite(rawStartLatLng[0]) && Number.isFinite(rawStartLatLng[1]) && rawStartLatLng[0] >= -12.6 && rawStartLatLng[0] <= -9.8 && rawStartLatLng[1] >= 164.8 && rawStartLatLng[1] <= 168;
    const hasSummaryPolyline = Boolean(
      (detail.map?.summary_polyline || a.map?.summary_polyline || "").length > 4
    );
    const isStationaryZeroGpsCycling = sportCategory === "Cycling" && !hasSummaryPolyline && !rawStartLatLng;
    const combinedStravaMeta = `${sportType} ${actName} ${a.device_name || ""} ${detail.device_name || ""}`;
    const isVirtualPlatform = /virtualride|virtual|zwift|watopia|makuri|neokyo|urukazi|alpe du zwift|ven-top|crit city|rouvy|mywhoosh|indievelo|trainingpeaks virtual|bkool|fulgaz|kinomap|rgt/i.test(
      combinedStravaMeta
    ) || Boolean(isWatopiaOrMakuriGps);
    const isIndoor = Boolean(a.trainer) || Boolean(isVirtualPlatform) || Boolean(isStationaryZeroGpsCycling) || /virtual|indoor|treadmill|zwift|trainer|spinning|peloton|wahoo|rouvy|mywhoosh|trainerroad|sufferfest|kickr|tacx|wattbike|stages|erg mode|ramp test|gym|weight|hiit|workout|yoga/i.test(
      combinedStravaMeta
    );
    let subType = "Road";
    if (sportCategory === "Cycling") {
      if (isVirtualPlatform) subType = "Virtual Cycling";
      else if (isIndoor) subType = "Smart Trainer";
      else if (/gravel/i.test(combinedStravaMeta)) subType = "Gravel";
      else if (/mountain|mtb|trail/i.test(combinedStravaMeta)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Running") {
      if (isIndoor) subType = "Treadmill";
      else if (/trail/i.test(combinedStravaMeta)) subType = "Trail";
      else subType = "Road";
    } else if (sportCategory === "Swimming") {
      subType = "Pool";
    } else {
      subType = "Gym";
    }
    const movingTimeSecs = Number(a.moving_time || a.elapsed_time || 0);
    const distanceMeters = Number(a.distance || 0);
    const avgPower = a.average_watts ? Math.round(Number(a.average_watts)) : void 0;
    const normalizedPower = a.weighted_average_watts ? Math.round(Number(a.weighted_average_watts)) : avgPower;
    const avgHr = Math.round(Number(a.average_heartrate || 0));
    const maxHr = Math.round(Number(a.max_heartrate || 0));
    const avgPaceSecsPerKm = sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 ? Math.round(movingTimeSecs / (distanceMeters / 1e3)) : void 0;
    let trainingLoad = Math.round(Number(a.suffer_score || 0));
    let intensityFactor;
    if (normalizedPower && movingTimeSecs > 0 && sportCategory === "Cycling") {
      const ifVal = normalizedPower / calibratedFtp;
      intensityFactor = Number(ifVal.toFixed(2));
      if (!trainingLoad) {
        trainingLoad = Math.round(
          movingTimeSecs * normalizedPower * ifVal / (calibratedFtp * 3600) * 100
        );
      }
    } else if (avgHr > 0 && movingTimeSecs > 0) {
      const sportLthr = sportCategory === "Running" ? calibratedRunLthr : calibratedBikeLthr;
      const hrRatio = Math.max(0.45, Math.min(1.22, avgHr / sportLthr));
      intensityFactor = Number(hrRatio.toFixed(2));
      if (!trainingLoad) {
        trainingLoad = Math.round(movingTimeSecs / 3600 * Math.pow(hrRatio, 2) * 85);
      }
    } else if (sportCategory === "Running" && avgPaceSecsPerKm && avgPaceSecsPerKm > 120 && movingTimeSecs > 0) {
      const paceIf = Math.max(
        0.45,
        Math.min(1.25, calibratedThresholdPaceSecsPerKm / avgPaceSecsPerKm)
      );
      intensityFactor = Number(paceIf.toFixed(2));
      if (!trainingLoad) {
        trainingLoad = Math.round(movingTimeSecs / 3600 * paceIf * paceIf * 105);
      }
    } else if (!trainingLoad && movingTimeSecs > 0) {
      trainingLoad = Math.round(movingTimeSecs / 3600 * 42);
    }
    let efficiencyFactor = 0;
    if (normalizedPower && avgHr > 0) {
      efficiencyFactor = Number((normalizedPower / avgHr).toFixed(2));
    } else if (sportCategory === "Running" && distanceMeters > 0 && movingTimeSecs > 0 && avgHr > 0) {
      const speedMetersPerMin = distanceMeters / (movingTimeSecs / 60);
      efficiencyFactor = Number((speedMetersPerMin / avgHr).toFixed(2));
    }
    const rawEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
    const segmentEfforts = rawEfforts.slice(0, 40).map((se) => {
      const dist = Math.round(Number(se.distance || se.segment?.distance || 0));
      const elTime = Number(se.elapsed_time || 0);
      return {
        id: String(se.id),
        segmentId: String(se.segment?.id || se.id),
        name: String(se.name || se.segment?.name || "Segment"),
        sportCategory: sportCategory === "Running" ? "Running" : "Cycling",
        distanceMeters: dist,
        averageGradePct: Number(se.segment?.average_grade ?? 0),
        elapsedTimeSecs: elTime,
        movingTimeSecs: Number(se.moving_time || elTime),
        avgWatts: se.average_watts ? Math.round(Number(se.average_watts)) : void 0,
        avgPaceSecsPerKm: sportCategory === "Running" && dist > 0 && elTime > 0 ? Math.round(elTime / (dist / 1e3)) : void 0,
        avgHr: se.average_heartrate ? Math.round(Number(se.average_heartrate)) : void 0,
        prRank: se.pr_rank === 1 || se.pr_rank === 2 || se.pr_rank === 3 ? se.pr_rank : null,
        komRank: typeof se.kom_rank === "number" ? se.kom_rank : null,
        startDateLocal: String(se.start_date_local || a.start_date_local),
        activityId: String(a.id),
        activityName: String(a.name),
        startIndex: typeof se.start_index === "number" ? se.start_index : void 0,
        endIndex: typeof se.end_index === "number" ? se.end_index : void 0
      };
    });
    const summaryPolyline = detail.map?.summary_polyline || a.map?.summary_polyline || void 0;
    const decodedRoute = summaryPolyline ? decodeGooglePolyline(summaryPolyline) : void 0;
    const startLatLng = Array.isArray(a.start_latlng) && a.start_latlng.length === 2 ? [Number(a.start_latlng[0]), Number(a.start_latlng[1])] : decodedRoute && decodedRoute.length > 0 ? decodedRoute[0] : void 0;
    const endLatLng = Array.isArray(a.end_latlng) && a.end_latlng.length === 2 ? [Number(a.end_latlng[0]), Number(a.end_latlng[1])] : decodedRoute && decodedRoute.length > 0 ? decodedRoute[decodedRoute.length - 1] : void 0;
    const cachedK = kudosCache[String(a.id)];
    return {
      stravaId: String(a.id),
      startDateLocal: String(a.start_date_local || "").replace(/Z$/i, ""),
      name: String(a.name || sportType || sportCategory),
      sportCategory,
      environment: isIndoor ? "INDOOR" : "OUTDOOR",
      subType,
      distanceMeters,
      movingTimeSecs,
      elevationGainMeters: Math.round(Number(a.total_elevation_gain || 0)),
      avgPower,
      normalizedPower,
      intensityFactor,
      trainingLoad,
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
      routeLatLngs: decodedRoute && decodedRoute.length >= 2 ? decodedRoute : void 0,
      startLatLng,
      endLatLng,
      segmentEfforts
    };
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
    athleteProfile: importProfileAndGear ? {
      ...stravaAthleteProfile,
      gearItems: stravaGearItems
    } : void 0,
    gearItems: stravaGearItems,
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
apiRouter.get("/api/strava/sync", async (req, res) => {
  try {
    const forceFull = req.query.full === "true";
    const deltaOnly = req.query.deltaOnly === "true";
    const explicitWindow = typeof req.query.window === "string" ? req.query.window.trim() : void 0;
    const data = await syncStravaAllHistory(req, forceFull, deltaOnly, explicitWindow);
    res.json(data);
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : "Failed to sync Strava activities and segments"
    });
  }
});
apiRouter.get("/api/strava/activities/:id/streams", async (req, res) => {
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
    const raw = streamsResp.ok ? await streamsResp.json() : {};
    const timeData = Array.isArray(raw?.time?.data) ? raw.time.data : [];
    const step = Math.max(1, Math.floor(timeData.length / 500));
    const downsample = (arr) => Array.isArray(arr) ? arr.filter((_, idx) => idx % step === 0) : void 0;
    const rawLatLng = Array.isArray(raw?.latlng?.data) ? raw.latlng.data : void 0;
    const downsampledLatLng = rawLatLng ? rawLatLng.filter((_, idx) => idx % step === 0).filter((pt) => Array.isArray(pt) && pt.length === 2 && Math.abs(pt[0]) > 0.01).map((pt) => [Number(Number(pt[0]).toFixed(5)), Number(Number(pt[1]).toFixed(5))]) : void 0;
    let segmentEfforts = [];
    if (detailResp.ok) {
      const detail = await detailResp.json();
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
        return {
          id: String(se.id),
          segmentId: String(se.segment?.id || se.id),
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
          activityId: String(detail.id || activityId),
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
      const rawKudos = await kudosResp.json();
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
      kudoers
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load Strava activity streams"
    });
  }
});
apiRouter.get("/api/strava/activities/:id/kudos", async (req, res) => {
  try {
    const activityId = String(req.params.id);
    const stravaId = String(req.query.stravaId || activityId).replace(/^strava-/, "");
    const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
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
        const rawKudos = await kResp.json();
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
          const rawComments = await cResp.json();
          if (Array.isArray(rawComments)) {
            const remoteComments = rawComments.map((c, idx) => ({
              id: String(c.id || `sc-${stravaId}-${idx}`),
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
        saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);
      }
    }
    const entry = kudosCache[activityId] || kudosCache[stravaId] || {};
    res.json({
      kudosCount: entry.kudosCount || 0,
      hasKudoed: Boolean(entry.hasKudoed),
      kudoers: entry.kudoers || [],
      comments: entry.comments || []
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch Strava kudos"
    });
  }
});
apiRouter.post("/api/activities/:id/kudos", (req, res) => {
  try {
    const activityId = String(req.params.id);
    const { action = "toggle_kudos", commentText, athleteName } = req.body || {};
    const kudosCache = loadJsonFile(STRAVA_KUDOS_CACHE_FILE, {});
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
    saveJsonFile(STRAVA_KUDOS_CACHE_FILE, kudosCache);
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
apiRouter.post("/api/activities/hydrate-routes", async (req, res) => {
  try {
    const { apiKey, athleteId } = getEffectiveIntervalsConfig(req);
    if (!apiKey) {
      res.status(401).json({
        error: "Intervals.icu API Key is required to hydrate GPS routes.",
        routesByActivity: {}
      });
      return;
    }
    const routesCache = loadJsonFile(
      ROUTES_BY_ACTIVITY_CACHE_FILE,
      {}
    );
    const authHeader = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
    let activityIds = Array.isArray(req.body?.activityIds) ? req.body.activityIds.map(String).slice(0, 32) : [];
    if (activityIds.length === 0) {
      const resolvedId = athleteId || "0";
      const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const actResp = await fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2018-01-01&newest=${todayStr}`,
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
    saveJsonFile(ROUTES_BY_ACTIVITY_CACHE_FILE, routesCache);
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
apiRouter.all("/api/cron/hourly-sync", async (req, res) => {
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
apiRouter.post("/api/webhooks/intervals", async (req, res) => {
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
apiRouter.get("/api/webhooks/strava", (req, res) => {
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = String(req.query["hub.verify_token"] || "").trim();
  const expectedVerifyToken = String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "").trim();
  if (mode === "subscribe" && challenge) {
    if (expectedVerifyToken && verifyToken !== expectedVerifyToken) {
      res.status(403).json({ ok: false, error: "Invalid Strava webhook verify_token." });
      return;
    }
    res.json({ "hub.challenge": challenge });
    return;
  }
  res.json({ ok: true, status: "Strava webhook endpoint ready" });
});
apiRouter.post("/api/webhooks/strava", async (req, res) => {
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: "strava-webhook",
      aspectType: req.body?.aspect_type,
      objectId: req.body?.object_id,
      ...summary
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Strava webhook sync failed"
    });
  }
});
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
      title: isRun ? `Threshold Cruise Intervals (4\xD7${Math.max(4, Math.round(mainMins / 5))}m @ LT2 Pace)` : `Sweet Spot & Threshold Progression (3\xD7${Math.max(8, Math.round(mainMins / 3.5))}m @ 92% FTP)`,
      sportCategory: isRun ? "Running" : "Cycling",
      environment: environmentPreference,
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 1.15),
      summary: `Advances aerobic threshold durability guided by ${loadContextNote}.`,
      physiologicalWhy: `Calibrated for ${biometricContextNote}. ${isRun ? "Sustains controlled sub-threshold lactate clearance across repeatable cruise intervals." : `Sustains sub-threshold metabolic stimulus around ~${Math.round(ftp * 0.92)}W.`}`,
      workoutSyntax: isRun ? `- 15m 74% Pace
- 4x ${Math.max(4, Math.round(mainMins / 5))}m 98% Pace
- 10m 70% Pace` : `- 15m 62% FTP
- ${Math.max(20, mainMins)}m 91% FTP
- 10m 55% FTP`,
      structuredSteps: [
        { label: "Progressive Warmup", duration: "15m", targetZoneOrOutput: "Z1\u2013Z2 Aerobic Ramp" },
        {
          label: "Main Threshold / Sweet Spot Block",
          duration: `${mainMins}m`,
          targetZoneOrOutput: isRun ? "96\u201399% Threshold Pace (Z4)" : `${Math.round(ftp * 0.9)}\u2013${Math.round(ftp * 0.94)}W (90\u201394% FTP)`
        },
        { label: "Cooldown Flush", duration: "10m", targetZoneOrOutput: "Z1 Easy Recovery" }
      ]
    },
    {
      id: `opt-det-2-${Date.now()}`,
      tier: "MODULATED",
      tierLabel: "Option B \xB7 Modulated Aerobic Durability",
      title: isRun ? `Zone 2 Aerobic Base Run + 4\xD720s Neuromuscular Strides` : `Endurance Zone 2 Aerobic Efficiency (${Math.round(ftp * 0.68)}\u2013${Math.round(ftp * 0.74)}W)`,
      sportCategory: isRun ? "Running" : "Cycling",
      environment: environmentPreference,
      durationMinutes: dur,
      estimatedLoad: Math.round(dur * 0.78),
      summary: `Builds mitochondrial density and low-decoupling aerobic durability with controlled autonomic strain.`,
      physiologicalWhy: `Guided by ${biometricContextNote}\u2014accumulates high-quality aerobic volume without deepening sympathetic fatigue.`,
      workoutSyntax: isRun ? `- 10m 70% Pace
- ${Math.max(20, dur - 20)}m 78% Pace
- 10m 68% Pace` : `- 10m 58% FTP
- ${Math.max(20, dur - 20)}m 70% FTP
- 10m 55% FTP`,
      structuredSteps: [
        {
          label: "Easy Settling",
          duration: "10m",
          targetZoneOrOutput: isRun ? "Easy Z1/Z2 Jog" : "58\u201362% FTP (Z1/Z2)"
        },
        {
          label: "Steady Aerobic Cruise",
          duration: `${Math.max(20, dur - 20)}m`,
          targetZoneOrOutput: isRun ? "Conversational Z2 Aerobic Pace + 4\xD720s Strides" : `${Math.round(ftp * 0.68)}\u2013${Math.round(ftp * 0.74)}W (68\u201374% FTP \xB7 Z2)`
        },
        {
          label: "Cooldown",
          duration: "10m",
          targetZoneOrOutput: isRun ? "Easy Z1 Shakeout" : "55% FTP (Z1)"
        }
      ]
    },
    {
      id: `opt-det-3-${Date.now()}`,
      tier: "RECOVERY",
      tierLabel: "Option C \xB7 Active Parasympathetic Recovery",
      title: isRun ? "Zone 1 Recovery Shakeout & Mobility Flow" : `Zone 1 Parasympathetic Recovery Spin (${Math.round(ftp * 0.52)}W \xB7 95 rpm)`,
      sportCategory: isRun ? "Running" : "Cycling",
      environment: isRun ? environmentPreference : "INDOOR",
      durationMinutes: Math.min(45, dur),
      estimatedLoad: 28,
      summary: "Promotes parasympathetic rebound and keeps mechanical strain low ahead of your next key workout.",
      physiologicalWhy: `Keeping intensity strictly in Zone 1 accelerates autonomic and muscular restoration.`,
      workoutSyntax: isRun ? `- 10m 66% Pace
- 20m 70% Pace
- 10m 65% Pace` : `- 10m 50% FTP
- 25m 55% FTP
- 10m 48% FTP`,
      structuredSteps: [
        {
          label: "Easy Spin / Shakeout",
          duration: isRun ? "30m" : "35m",
          targetZoneOrOutput: isRun ? "Z1 Easy Shakeout \xB7 HR < 72% Max" : "50\u201355% FTP \xB7 HR < 68% Max"
        },
        { label: "Mobility & Cooldown", duration: "10m", targetZoneOrOutput: "Z1 Flush" }
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
  const rawProposals = wantsMultiDay ? [
    {
      date: todayStr,
      name: wantsRunOnly ? isSuppressed ? "Modulated Zone 2 Aerobic Base Run" : "Threshold Cruise Intervals (4\xD76m @ LT2 Pace)" : isSuppressed ? "Modulated Zone 2 Aerobic Base (HRV-Adjusted)" : "Sweet Spot 3\xD712m @ 90% FTP Progression",
      sportCategory: wantsRunOnly ? "Running" : "Cycling",
      environmentPreference: wantsRunOnly ? "OUTDOOR" : "INDOOR",
      plannedDurationSecs: 3600,
      plannedLoad: isSuppressed ? 52 : 78,
      workoutSyntax: wantsRunOnly ? isSuppressed ? "- 10m 68% Pace\n- 40m 76% Pace\n- 10m 66% Pace" : "- 15m 74% Pace\n- 4x 6m 98% Pace\n- 15m 70% Pace" : isSuppressed ? "- 10m 55% FTP\n- 40m 68% FTP\n- 10m 52% FTP" : "- 12m 62% FTP\n- 36m 90% FTP\n- 12m 55% FTP",
      description: isSuppressed ? "Modulated Z2 session protecting autonomic recovery while building aerobic volume." : wantsRunOnly ? `Controlled lactate threshold intervals capped near ${runLthr} bpm.` : `Builds sub-threshold muscular endurance around ${Math.round(ftp * 0.9)}W.`
    },
    {
      date: addDays(todayStr, 1),
      name: "Aerobic Zone 2 Road Run + Neuromuscular Strides",
      sportCategory: "Running",
      environmentPreference: "OUTDOOR",
      plannedDurationSecs: 3300,
      plannedLoad: 58,
      workoutSyntax: "- 10m 68% Pace\n- 35m 78% Pace\n- 10m 65% Pace",
      description: "Steady aerobic running economy session with <3% cardiac drift target."
    },
    {
      date: addDays(todayStr, 2),
      name: wantsRunOnly ? "Zone 1 Recovery Shakeout & Mobility" : "Active Parasympathetic Recovery Spin & Mobility",
      sportCategory: wantsRunOnly ? "Running" : "Cycling",
      environmentPreference: wantsRunOnly ? "OUTDOOR" : "INDOOR",
      plannedDurationSecs: 2700,
      plannedLoad: 28,
      workoutSyntax: wantsRunOnly ? "- 10m 66% Pace\n- 25m 70% Pace\n- 10m 65% Pace" : "- 10m 50% FTP\n- 25m 55% FTP\n- 10m 48% FTP",
      description: "Low-strain recovery flush to restore freshness ahead of mid-week quality."
    },
    {
      date: addDays(todayStr, 3),
      name: wantsRunOnly ? "Lactate Threshold Cruise Intervals (4\xD76m @ LT2)" : `Over-Under Lactate Clearance (3\xD710m @ ${Math.round(ftp * 0.95)}W)`,
      sportCategory: wantsRunOnly ? "Running" : "Cycling",
      environmentPreference: wantsRunOnly ? "OUTDOOR" : "INDOOR",
      plannedDurationSecs: 4200,
      plannedLoad: 86,
      workoutSyntax: wantsRunOnly ? "- 15m 74% Pace\n- 4x 6m 99% Pace\n- 15m 70% Pace" : "- 15m 62% FTP\n- 30m 95% FTP\n- 25m 65% FTP",
      description: "Key mid-week threshold stimulus once readiness rebounds."
    },
    {
      date: addDays(todayStr, 4),
      name: "Long Endurance Aerobic Base Progression",
      sportCategory: wantsRunOnly ? "Running" : "Cycling",
      environmentPreference: "OUTDOOR",
      plannedDurationSecs: 5400,
      plannedLoad: 98,
      workoutSyntax: wantsRunOnly ? "- 15m 72% Pace\n- 65m 79% Pace\n- 10m 68% Pace" : "- 15m 60% FTP\n- 65m 73% FTP\n- 10m 55% FTP",
      description: "Extended Zone 2 mitochondrial durability session."
    }
  ] : [
    {
      date: todayStr,
      name: wantsRunOnly ? isSuppressed ? "Zone 2 Aerobic Base Run (Readiness-Modulated)" : "Threshold Cruise Intervals (4\xD76m @ LT2 Pace)" : isSuppressed ? `HRV-Modulated Zone 2 Endurance (${Math.round(ftp * 0.68)}W)` : `Indoor Threshold & Sweet Spot (${Math.round(ftp * 0.91)}W)`,
      sportCategory: wantsRunOnly ? "Running" : "Cycling",
      environmentPreference: wantsRunOnly ? "OUTDOOR" : "INDOOR",
      plannedDurationSecs: 3600,
      plannedLoad: isSuppressed ? 50 : 76,
      workoutSyntax: wantsRunOnly ? isSuppressed ? "- 10m 68% Pace\n- 40m 76% Pace\n- 10m 66% Pace" : "- 15m 74% Pace\n- 4x 6m 98% Pace\n- 15m 70% Pace" : isSuppressed ? "- 10m 55% FTP\n- 40m 68% FTP\n- 10m 52% FTP" : "- 12m 62% FTP\n- 36m 91% FTP\n- 12m 55% FTP",
      description: isSuppressed ? "Caps intensity in Zone 2 while protecting autonomic recovery." : wantsRunOnly ? `Targets threshold cruise pace with HR capped near ${runLthr} bpm.` : `Targets 91% FTP (~${Math.round(ftp * 0.91)}W) with HR capped below ${lthr} bpm.`
    },
    {
      date: addDays(todayStr, 1),
      name: "Aerobic Base Run + 6\xD720s Strides",
      sportCategory: "Running",
      environmentPreference: "OUTDOOR",
      plannedDurationSecs: 3300,
      plannedLoad: 56,
      workoutSyntax: "- 10m 68% Pace\n- 35m 78% Pace\n- 10m 65% Pace",
      description: "Complementary aerobic run advancing weekly volume with low autonomic strain."
    }
  ];
  const proposedWorkouts = rawProposals.map((pw, i) => ({
    id: `ai-prop-${Date.now()}-${i}`,
    date: pw.date,
    name: pw.name,
    sportCategory: pw.sportCategory,
    environmentPreference: pw.environmentPreference,
    description: pw.description,
    plannedLoad: pw.plannedLoad,
    plannedDurationSecs: pw.plannedDurationSecs,
    targetZoneSummary: `${pw.plannedLoad} TSS \xB7 Thresh Physiology Engine`,
    workoutSyntax: pw.workoutSyntax,
    structuredSteps: parseWorkoutSyntaxToSteps(pw.workoutSyntax, pw.plannedDurationSecs),
    source: "AI_COACH"
  }));
  const readinessAnalysis = hrv != null && ctl != null ? isSuppressed ? `Your overnight **HRV is ${hrv} ms (${hrvStatus})** alongside a **CTL of ${ctl}** and **TSB of ${tsb}**${statusLabel ? ` (${statusLabel})` : ""}. Because your autonomic baseline (**${hrvBaseline} ms**) shows mild strain, today's optimal move is to **modulate high-glycolytic stress** and focus on **Zone 2 Aerobic Base** before your next threshold session.` : `Your morning **HRV is ${hrv} ms (${hrvStatus})**${sleepScore ? `, **Sleep Score is ${sleepScore}/100${sleepHours ? ` (${sleepHours}h)` : ""}**` : ""}, and **Fitness (CTL) stands at ${ctl}** with **Form (TSB) at ${tsb}**. Your baseline is well-positioned for a structured **Threshold / Sweet Spot progression** today.` : ctl != null ? `Your **42-day Fitness (CTL) is ${ctl}** with **Form (TSB) at ${tsb}** based on your synced workout load. Overnight HRV & sleep telemetry are not yet connected (optional via Garmin Connect or Intervals.icu), so today's prescription is anchored to your **acute-to-chronic load balance and calibrated threshold zones**.` : `Your THRESH account is calibrated to your initial threshold zones (${wantsRunOnly ? `Run LTHR ${runLthr} bpm` : `FTP ${ftp}W \xB7 LTHR ${lthr} bpm`}). As your Strava workouts sync, your 42-day Fitness (CTL) and Form (TSB) curves will populate automatically.`;
  const citedMetrics = [
    ctl != null ? `CTL ${ctl} \xB7 TSB ${tsb}` : "Load Baseline Calibrating",
    hrv != null ? `HRV ${hrv} ms (${hrvStatus})` : "HRV Optional (Not Linked)",
    ...sleepScore != null ? [`Sleep${sleepHours ? ` ${sleepHours}h` : ""} (Score ${sleepScore})`] : [],
    wantsRunOnly ? `Run LTHR ${runLthr} bpm` : `FTP ${ftp}W \xB7 LTHR ${lthr} bpm`
  ];
  const reply = `${readinessAnalysis}

I have generated **${proposedWorkouts.length} structured workouts** below tailored to your calibrated zones\u2014click **Schedule** on any card to push it directly to your Training Calendar.`;
  return {
    reply,
    citedMetrics,
    proposedWorkouts,
    engine: "LOCAL_PHYSIOLOGY_ENGINE"
  };
}
apiRouter.post("/api/coach/options", async (req, res) => {
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
  try {
    const ai = getGeminiClient(req);
    if (!ai) {
      res.json({
        options: buildDeterministicDailyWorkoutOptions(
          sportPreference,
          environmentPreference,
          durationMinutes,
          telemetrySummary
        ),
        engine: "LOCAL_PHYSIOLOGY_ENGINE"
      });
      return;
    }
    const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary);
    const prompt = `
You are Thresh AI Coach, an elite endurance sports physiologist and dual-sport running & cycling coach.
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
        telemetrySummary
      ),
      engine: "LOCAL_PHYSIOLOGY_ENGINE"
    });
  }
});
apiRouter.post("/api/coach/chat", async (req, res) => {
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
  try {
    const ai = getGeminiClient(req);
    if (!ai) {
      res.json(buildDeterministicCoachChatResponse(message, telemetrySummary, todayStr));
      return;
    }
    const conversationContext = Array.isArray(history) ? history.slice(-8).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n") : "";
    const cleanTelemetry = sanitizeTelemetryForCleanRoom(telemetrySummary);
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
        systemInstruction: `You are Thresh AI Coach, an elite exercise physiologist and dual-sport running & cycling performance coach inside Thresh (THRESH \u2014 Run & Ride Readiness).
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
    res.json(buildDeterministicCoachChatResponse(message, telemetrySummary, todayStr));
  }
});
apiRouter.post(["/api/races/parse", "/races/parse"], async (req, res) => {
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
apiRouter.post("/api/auth/logout", async (req, res) => {
  try {
    const wasAuthenticated = isAuthenticatedRequest(req);
    const scopeKey = resolveSessionScopeKey(req);
    clearSessionCookie(res);
    clearOAuthStateCookie(res);
    appendSetCookieHeader(res, buildClearVaultCookieHeader());
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
          if (fs4.existsSync(sessionPath)) fs4.unlinkSync(sessionPath);
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

// server/vercelApp.ts
var app = express4();
app.disable("x-powered-by");
app.use(securityHeadersMiddleware);
app.use(express4.json({ limit: "2mb" }));
app.use(apiRouter);
var vercelApp_default = app;
export {
  vercelApp_default as default
};
