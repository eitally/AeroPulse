import crypto from 'crypto';
import fs from 'fs';
import { NextFunction, Request, Response } from 'express';

const SESSION_SECRET_FILE = '/tmp/aeropulse-session-secret.key';
const SESSION_COOKIE_NAME = 'aeropulse_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cachedSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const envSecret = (
    process.env.SESSION_SECRET ||
    process.env.STRAVA_CLIENT_SECRET ||
    ''
  ).trim();
  if (envSecret && envSecret.length >= 16) {
    cachedSecret = crypto.createHash('sha256').update(`aeropulse:${envSecret}`).digest('hex');
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

export function issueSessionToken(subject = 'authenticated'): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sub: subject, exp }), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };
    if (!decoded.exp || Date.now() > decoded.exp) return false;
    return true;
  } catch {
    return false;
  }
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

export function setSessionCookie(req: Request, res: Response, subject = 'authenticated'): string {
  const token = issueSessionToken(subject);
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
  res.setHeader('Set-Cookie', cookieParts.join('; '));
  return token;
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function hasValidSessionToken(req?: Request): boolean {
  if (!req) return false;
  const headerToken = String(req.headers['x-session-token'] || '').trim();
  if (headerToken && verifySessionToken(headerToken)) {
    return true;
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && verifySessionToken(cookieToken)) {
    return true;
  }
  return false;
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

/**
 * Validates that a URL is an external public HTTP/HTTPS resource, blocking SSRF against
 * loopback, link-local cloud metadata (169.254.169.254), and RFC1918 private networks.
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
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '0:0:0:0:0:0:0:1' ||
      hostname.startsWith('fe80:') ||
      hostname.startsWith('fc00:') ||
      hostname.startsWith('fd00:')
    ) {
      return false;
    }

    // Check IPv4 ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1, 5).map(Number);
      if (octets.some((o) => o < 0 || o > 255)) return false;
      const [a, b] = octets;
      // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
      if (a === 0 || a === 10 || a === 127) return false;
      // 169.254.0.0/16 (AWS/GCP/Azure metadata & link-local)
      if (a === 169 && b === 254) return false;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return false;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return false;
      // 100.64.0.0/10 (Carrier-grade NAT)
      if (a === 100 && b >= 64 && b <= 127) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Express middleware that attaches standard security headers and prevents caching of auth/config endpoints.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const path = req.path || req.url || '';
  if (
    path.includes('/config') ||
    path.includes('/auth') ||
    path.includes('/strava/token') ||
    path.includes('/strava/exchange-code') ||
    path.includes('/strava/credentials')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}
