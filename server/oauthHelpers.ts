import type { Request, Response } from 'express';
import crypto from 'crypto';
import {
  escapeHtml,
  getVerifiedSessionClaims,
  isProductionDeployment,
  resolveSafeOrigin,
  resolveTrustedCorsOrigin,
  setSessionCookie,
} from './securityUtils.ts';
import { bindRequestScopeKey } from './sessionContext.ts';

export function ensureRequestSession(
  req: Request,
  res: Response,
  fallbackSubject = 'thresh-athlete'
): { sid: string; sessionToken: string } {
  const verified = getVerifiedSessionClaims(req);
  if (verified?.sid) {
    bindRequestScopeKey(req, verified.sid);
    const sessionToken = setSessionCookie(
      req,
      res,
      verified.sub || fallbackSubject,
      verified.sid
    );
    return { sid: verified.sid, sessionToken };
  }
  const sid = crypto.randomBytes(16).toString('hex');
  const sessionToken = setSessionCookie(req, res, fallbackSubject, sid);
  bindRequestScopeKey(req, sid);
  return { sid, sessionToken };
}

export function ensureRequestSessionSid(
  req: Request,
  res: Response,
  fallbackSubject = 'thresh-athlete'
): string {
  return ensureRequestSession(req, res, fallbackSubject).sid;
}

export function renderThreshOAuthHtml(opts: {
  title: string;
  heading: string;
  accentColor?: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaOnClick?: string;
  scriptBody?: string;
}): string {
  const accent = opts.accentColor || '#C8FF00';
  const ctaHtml =
    opts.ctaLabel && opts.ctaHref
      ? `<a href="${escapeHtml(opts.ctaHref)}"${
          opts.ctaOnClick ? ` onclick="${opts.ctaOnClick}"` : ''
        } style="display:inline-block;background:#C8FF00;color:#0B0F0D;text-decoration:none;border-radius:10px;padding:11px 22px;font-weight:800;font-size:13px;letter-spacing:0.02em;">${escapeHtml(
          opts.ctaLabel
        )}</a>`
      : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;background:#0C1D14;color:#F8FAFC;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px;box-sizing:border-box;">
    <div style="background:#111915;border:2px solid #25573A;border-radius:18px;padding:28px 26px;max-width:420px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.45);">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">MeetReady · Telemetry Connector</div>
      <h2 style="margin:0 0 10px;color:${accent};font-size:18px;line-height:1.3;">${opts.heading}</h2>
      <p style="margin:0 0 ${ctaHtml ? '20px' : '0'};color:#CBD5E1;font-size:13px;line-height:1.55;">${opts.body}</p>
      ${ctaHtml}
    </div>
    ${opts.scriptBody ? `<script>${opts.scriptBody}</script>` : ''}
  </body>
</html>`;
}

const CANONICAL_PROD_ORIGIN = 'https://meetready.app';
const LEGACY_PROD_ORIGIN = 'https://aeropulse-eta.vercel.app';

export function canonicalizeOrigin(origin: string): string {
  return origin.toLowerCase() === LEGACY_PROD_ORIGIN ? CANONICAL_PROD_ORIGIN : origin;
}

export function canonicalizeRedirectUrl(rawUrl: string): string {
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

function resolveStandardOAuthCallbackUrl(
  req: Request,
  envVarName: string,
  callbackPath: string
): string {
  const explicitRedirect = (process.env[envVarName] || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return canonicalizeRedirectUrl(parsed.toString());
      }
    } catch {
      // fall through
    }
  }
  const rawQueryOrigin = req.query.origin as string | undefined;
  const safeOrigin = isProductionDeployment()
    ? resolveTrustedCorsOrigin(rawQueryOrigin)
    : resolveSafeOrigin(rawQueryOrigin);
  if (safeOrigin) {
    return `${canonicalizeOrigin(safeOrigin)}${callbackPath}`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${canonicalizeOrigin(appUrl)}${callbackPath}`;
  }
  const rawProto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' || req.secure ? 'https' : 'http';
  const rawHost = String(
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  )
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  if (isProductionDeployment()) {
    const trustedHostOrigin = rawHost
      ? resolveTrustedCorsOrigin(`${proto}://${rawHost}`)
      : null;
    if (trustedHostOrigin) {
      return `${canonicalizeOrigin(trustedHostOrigin)}${callbackPath}`;
    }
    const appBaseUrl = resolveSafeOrigin(process.env.APP_BASE_URL || '');
    if (appBaseUrl && !appBaseUrl.includes('MY_APP_URL')) {
      return `${canonicalizeOrigin(appBaseUrl)}${callbackPath}`;
    }
    return `${CANONICAL_PROD_ORIGIN}${callbackPath}`;
  }
  const canonicalHost =
    rawHost.toLowerCase() === 'aeropulse-eta.vercel.app' ? 'meetready.app' : rawHost;
  return `${proto}://${canonicalHost || 'localhost:3000'}${callbackPath}`;
}

export function resolveStravaCallbackUrl(req: Request): string {
  return resolveStandardOAuthCallbackUrl(req, 'STRAVA_REDIRECT_URI', '/auth/strava/callback');
}

const MAX_VALIDATED_REDIRECT_ENTRIES = 200;
const validatedStravaRedirectCache = new Map<
  string,
  { redirectUri: string; expiresAt: number }
>();

function setBoundedValidatedRedirect(cacheKey: string, redirectUri: string, ttlMs: number): void {
  const now = Date.now();
  if (validatedStravaRedirectCache.has(cacheKey)) {
    validatedStravaRedirectCache.delete(cacheKey);
  } else if (validatedStravaRedirectCache.size >= MAX_VALIDATED_REDIRECT_ENTRIES) {
    for (const [k, v] of validatedStravaRedirectCache.entries()) {
      if (now >= v.expiresAt) validatedStravaRedirectCache.delete(k);
    }
    while (validatedStravaRedirectCache.size >= MAX_VALIDATED_REDIRECT_ENTRIES) {
      const oldestKey = validatedStravaRedirectCache.keys().next().value;
      if (oldestKey === undefined) break;
      validatedStravaRedirectCache.delete(oldestKey);
    }
  }
  validatedStravaRedirectCache.set(cacheKey, {
    redirectUri,
    expiresAt: now + ttlMs,
  });
}

export function clearStravaRedirectCacheForTesting(): void {
  validatedStravaRedirectCache.clear();
}

async function probeStravaRedirectUri(
  clientId: string,
  redirectUri: string
): Promise<'valid' | 'invalid_redirect' | 'unknown'> {
  try {
    const probeUrl = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&approval_prompt=auto&scope=read`;
    const resp = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(2500) : undefined,
    });
    if ((resp.status >= 300 && resp.status < 400) || resp.status === 200) {
      return 'valid';
    }
    if (resp.status === 400) {
      const text = await resp.text();
      if (text.includes('redirect_uri')) {
        return 'invalid_redirect';
      }
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Resolves the Strava OAuth callback URL and verifies against Strava that the domain is
 * accepted for the given clientId. Automatically falls back to the registered legacy domain
 * during a domain migration (which preserves query params across Vercel 307 redirect).
 */
export async function resolveValidatedStravaCallbackUrl(
  req: Request,
  clientId: string
): Promise<string> {
  const primaryUri = resolveStravaCallbackUrl(req);
  if (
    (process.env.STRAVA_REDIRECT_URI || '').trim() ||
    !clientId ||
    !primaryUri.startsWith('https://')
  ) {
    return primaryUri;
  }

  let primaryUrl: URL;
  try {
    primaryUrl = new URL(primaryUri);
  } catch {
    return primaryUri;
  }
  if (primaryUrl.hostname === 'localhost' || primaryUrl.hostname === '127.0.0.1') {
    return primaryUri;
  }

  const cacheKey = `${clientId}|${primaryUri}`;
  const cached = validatedStravaRedirectCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.redirectUri;
  }

  const primaryProbe = await probeStravaRedirectUri(clientId, primaryUri);
  if (primaryProbe === 'valid') {
    setBoundedValidatedRedirect(cacheKey, primaryUri, 15_000);
    return primaryUri;
  }
  if (primaryProbe === 'unknown') {
    return primaryUri;
  }

  const fallbackCandidates: string[] = [];
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate) return;
    if (candidate !== primaryUri && !fallbackCandidates.includes(candidate)) {
      fallbackCandidates.push(candidate);
    }
  };
  const envFallback = (process.env.STRAVA_FALLBACK_REDIRECT_URI || '').trim();
  if (envFallback) {
    try {
      const parsedFallback = new URL(envFallback);
      if (parsedFallback.protocol === 'https:') {
        pushCandidate(parsedFallback.toString());
      }
    } catch {
      // ignore invalid STRAVA_FALLBACK_REDIRECT_URI
    }
  }
  const appOrigin = resolveSafeOrigin(process.env.APP_URL || '');
  if (appOrigin && appOrigin.startsWith('https://') && !appOrigin.includes('MY_APP_URL')) {
    pushCandidate(`${appOrigin}/auth/strava/callback`);
  }
  pushCandidate(`${CANONICAL_PROD_ORIGIN}/auth/strava/callback`);
  pushCandidate('https://thresh-dev.vercel.app/auth/strava/callback');
  pushCandidate(`${LEGACY_PROD_ORIGIN}/auth/strava/callback`);

  for (const candidate of fallbackCandidates) {
    const candidateProbe = await probeStravaRedirectUri(clientId, candidate);
    if (candidateProbe === 'valid') {
      // Do not cache fallback redirects so Strava dashboard updates take effect on next attempt
      return candidate;
    }
  }

  return primaryUri;
}

export function resolveIntervalsCallbackUrl(req: Request): string {
  return resolveStandardOAuthCallbackUrl(req, 'INTERVALS_REDIRECT_URI', '/auth/intervals/callback');
}

export function resolveWahooCallbackUrl(req: Request): string {
  return resolveStandardOAuthCallbackUrl(req, 'WAHOO_REDIRECT_URI', '/auth/wahoo/callback');
}

export function resolvePolarCallbackUrl(req: Request): string {
  return resolveStandardOAuthCallbackUrl(req, 'POLAR_REDIRECT_URI', '/auth/polar/callback');
}

export const resolveCallbackUrl = resolveStravaCallbackUrl;
