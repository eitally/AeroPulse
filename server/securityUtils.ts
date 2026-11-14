import crypto from 'crypto';
import dns from 'dns';
import fs from 'fs';
import net from 'net';
import type { NextFunction, Request, Response } from 'express';

const SESSION_SECRET_FILE = '/tmp/thresh-session-secret.key';
export const SESSION_COOKIE_NAME = 'thresh_session';
export const LEGACY_SESSION_COOKIE_NAME = 'aeropulse_session';
export const OAUTH_STATE_COOKIE_NAME = 'thresh_oauth_state';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface VerifiedSessionClaims {
  sid: string;
  sub: string;
  exp: number;
}

export interface OAuthStateClaims {
  nonce: string;
  sid?: string;
  flow?: 'popup' | 'redirect';
  mode?: string;
  joinCode?: string;
  slug?: string;
  inviteToken?: string;
  exp: number;
}

let cachedSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const envSecret = (
    process.env.SESSION_SECRET ||
    process.env.TOKEN_VAULT_KEY ||
    process.env.OAUTH_ENCRYPTION_KEY ||
    process.env.STRAVA_CLIENT_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();
  if (envSecret && envSecret.length >= 16) {
    cachedSecret = crypto.createHash('sha256').update(`thresh:${envSecret}`).digest('hex');
    return cachedSecret;
  }
  try {
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const existing = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) {
        cachedSecret = existing;
        return cachedSecret;
      }
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: 'utf8', mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  } catch {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    return cachedSecret;
  }
}

/**
 * Derives a deterministic, non-reversible 32-char hex session ID from a verified Strava Athlete ID.
 * Guarantees that signing in with Strava on any device (laptop, phone, PWA) restores the exact same
 * THRESH server vault and team memberships without requiring a secondary email OTP login.
 */
export function deriveStravaSessionSid(stravaAthleteId: string | number): string {
  const cleanId = String(stravaAthleteId || '').trim().replace(/[^0-9a-zA-Z_-]/g, '');
  if (!cleanId) {
    return crypto.randomBytes(16).toString('hex');
  }
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(`thresh_strava_sid_v1:${cleanId}`)
    .digest('hex')
    .slice(0, 32);
}

export function appendSetCookieHeader(res: Response, cookieValue: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieValue]);
    return;
  }
  if (Array.isArray(existing)) {
    const cookieName = cookieValue.split('=')[0]?.trim();
    const filtered = cookieName
      ? existing.filter((c) => !String(c).startsWith(`${cookieName}=`))
      : existing;
    res.setHeader('Set-Cookie', [...filtered.map(String), cookieValue]);
    return;
  }
  const prevStr = String(existing);
  const cookieName = cookieValue.split('=')[0]?.trim();
  if (cookieName && prevStr.startsWith(`${cookieName}=`)) {
    res.setHeader('Set-Cookie', [cookieValue]);
  } else {
    res.setHeader('Set-Cookie', [prevStr, cookieValue]);
  }
}

export function issueOAuthStateToken(
  input: Omit<OAuthStateClaims, 'exp' | 'nonce'> & { nonce?: string }
): { stateToken: string; nonce: string } {
  const nonce =
    input.nonce && /^[a-f0-9_-]{12,64}$/i.test(input.nonce)
      ? input.nonce
      : crypto.randomBytes(16).toString('hex');
  const claims: OAuthStateClaims = {
    nonce,
    sid: input.sid,
    flow: input.flow || 'redirect',
    mode: input.mode,
    joinCode: input.joinCode,
    slug: input.slug,
    inviteToken: input.inviteToken,
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`oauth_state:${payload}`)
    .digest('base64url');
  return { stateToken: `${payload}.${sig}`, nonce };
}

export function verifyOAuthStateToken(token?: string | null): OAuthStateClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`oauth_state:${payload}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as OAuthStateClaims;
    if (!decoded.exp || Date.now() > decoded.exp || !decoded.nonce) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function setOAuthStateCookie(req: Request, res: Response, nonce: string): void {
  const isSecure =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  const parts = [
    `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(nonce)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(OAUTH_STATE_TTL_MS / 1000)}`,
  ];
  if (isSecure) parts.push('Secure');
  appendSetCookieHeader(res, parts.join('; '));
}

export function getOAuthStateCookieNonce(req?: Request): string | null {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[OAUTH_STATE_COOKIE_NAME] || null;
}

export function clearOAuthStateCookie(res: Response): void {
  appendSetCookieHeader(
    res,
    `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function issueSessionToken(subject = 'authenticated', existingSid?: string): string {
  const sid =
    existingSid && /^[a-f0-9]{24,64}$/i.test(existingSid)
      ? existingSid
      : crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sid, sub: subject, exp }), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function decodeAndVerifyToken(token?: string | null): VerifiedSessionClaims | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid?: string;
      sub?: string;
      exp?: number;
    };
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    const sub = String(decoded.sub || 'authenticated');
    // Derive deterministic fallback sid only for legacy pre-sid tokens signed with our secret
    const sid =
      decoded.sid && /^[a-f0-9]{16,64}$/i.test(decoded.sid)
        ? decoded.sid
        : crypto.createHash('sha256').update(`${sub}:${sig}`).digest('hex').slice(0, 32);
    return { sid, sub, exp: decoded.exp };
  } catch {
    return null;
  }
}

export function verifySessionToken(token?: string | null): boolean {
  return decodeAndVerifyToken(token) !== null;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
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

export function getVerifiedSessionClaims(req?: Request): VerifiedSessionClaims | null {
  if (!req) return null;
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME] || cookies[LEGACY_SESSION_COOKIE_NAME];
  if (cookieToken) {
    const verified = decodeAndVerifyToken(cookieToken);
    if (verified) return verified;
  }
  const headerToken = String(req.headers['x-session-token'] || '').trim();
  if (headerToken) {
    const verified = decodeAndVerifyToken(headerToken);
    if (verified) return verified;
  }
  return null;
}

export function setSessionCookie(
  req: Request,
  res: Response,
  subject = 'authenticated',
  explicitSid?: string
): string {
  const existing = getVerifiedSessionClaims(req);
  const token = issueSessionToken(subject, explicitSid || existing?.sid);
  const isSecure =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  const maxAgeSecs = Math.floor(SESSION_TTL_MS / 1000);
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSecs}`,
  ];
  if (isSecure) cookieParts.push('Secure');
  appendSetCookieHeader(res, cookieParts.join('; '));
  return token;
}

export function clearSessionCookie(res: Response): void {
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

export function hasValidSessionToken(req?: Request): boolean {
  return getVerifiedSessionClaims(req) !== null;
}

export function hasValidCronAuthorization(req: Request): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (!cronSecret) {
    // Allow local manual dev trigger only when not running in production / Vercel
    return process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  }
  const authHeader = String(req.headers.authorization || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const candidate = bearer || String(req.headers['x-cron-secret'] || '').trim();
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(cronSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Escapes untrusted strings before interpolation into HTML markup to prevent Reflected XSS.
 */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely serializes a value for embedding inside a <script> tag without allowing </script> breakout.
 */
export function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Validates an origin string (e.g. from req.query.origin) so only clean http/https origins are accepted.
 */
export function resolveSafeOrigin(rawOrigin?: string): string | null {
  if (!rawOrigin || typeof rawOrigin !== 'string') return null;
  try {
    const parsed = new URL(rawOrigin.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isPrivateIpv4Octets(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // Cloud metadata / link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateIpv4Octets(ip.split('.').map(Number));
  }
  if (version === 6) {
    if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
      return true;
    }
    if (
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe8') ||
      ip.startsWith('fe9') ||
      ip.startsWith('fea') ||
      ip.startsWith('feb') ||
      ip.startsWith('ff')
    ) {
      return true;
    }
    // Check IPv4-mapped IPv6 in dotted form (::ffff:169.254.169.254) or hex form (::ffff:a9fe:a9fe)
    const v4MappedDotted = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedDotted) {
      return isPrivateIpv4Octets(v4MappedDotted[1].split('.').map(Number));
    }
    const v4MappedHex = ip.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (v4MappedHex) {
      const hi = parseInt(v4MappedHex[1], 16);
      const lo = parseInt(v4MappedHex[2], 16);
      return isPrivateIpv4Octets([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
    }
    return false;
  }
  return true;
}

/**
 * Validates that a URL is an external public HTTP/HTTPS resource, blocking SSRF against
 * loopback, link-local cloud metadata (169.254.169.254), IPv4-mapped IPv6, and RFC1918 networks.
 */
export function isSafeExternalUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      /^\d+$/.test(hostname) || // Block decimal integer IP encoding (e.g. 2130706433)
      /^0x[0-9a-f]+$/i.test(hostname) // Block hex IP encoding
    ) {
      return false;
    }

    if (net.isIP(hostname) !== 0 || hostname.includes(':')) {
      return !isPrivateOrReservedIp(hostname);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Performs post-DNS IP verification and manual redirect checking to prevent DNS-rebinding
 * and open-redirect SSRF attacks.
 */
export async function assertSafeExternalFetch(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 2
): Promise<globalThis.Response | null> {
  let currentUrl = rawUrl.trim();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalUrl(currentUrl)) return null;
    const parsed = new URL(currentUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
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
      redirect: 'manual',
    });

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location || hop === maxRedirects) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return resp;
  }
  return null;
}

/**
 * Express middleware that attaches standard security headers and prevents caching of API/auth endpoints.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const reqPath = req.path || req.url || '';
  if (
    reqPath.startsWith('/api/') ||
    reqPath.startsWith('/auth/') ||
    reqPath.includes('/config') ||
    reqPath.includes('/auth')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}
