import type { Request, Response } from 'express';
import crypto from 'crypto';
import {
  escapeHtml,
  getVerifiedSessionClaims,
  resolveSafeOrigin,
  setSessionCookie,
} from './securityUtils.ts';
import { bindRequestScopeKey } from './sessionContext.ts';

export function ensureRequestSessionSid(
  req: Request,
  res: Response,
  fallbackSubject = 'thresh-athlete'
): string {
  const verified = getVerifiedSessionClaims(req);
  if (verified?.sid) {
    bindRequestScopeKey(req, verified.sid);
    return verified.sid;
  }
  const sid = crypto.randomBytes(16).toString('hex');
  setSessionCookie(req, res, fallbackSubject, sid);
  bindRequestScopeKey(req, sid);
  return sid;
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
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#163022;border:1px solid #25573A;color:#C8FF00;font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px;">THRESH · Telemetry Connector</div>
      <h2 style="margin:0 0 10px;color:${accent};font-size:18px;line-height:1.3;">${opts.heading}</h2>
      <p style="margin:0 0 ${ctaHtml ? '20px' : '0'};color:#CBD5E1;font-size:13px;line-height:1.55;">${opts.body}</p>
      ${ctaHtml}
    </div>
    ${opts.scriptBody ? `<script>${opts.scriptBody}</script>` : ''}
  </body>
</html>`;
}

export function resolveStravaCallbackUrl(req: Request): string {
  const explicitRedirect = (process.env.STRAVA_REDIRECT_URI || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin as string | undefined);
  if (safeOrigin) {
    return `${safeOrigin}/auth/strava/callback`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/strava/callback`;
  }
  const rawProto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  const rawHost = String(
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  )
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  return `${proto}://${rawHost || 'localhost:3000'}/auth/strava/callback`;
}

export function resolveIntervalsCallbackUrl(req: Request): string {
  const explicitRedirect = (process.env.INTERVALS_REDIRECT_URI || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin as string | undefined);
  if (safeOrigin) {
    return `${safeOrigin}/auth/intervals/callback`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/intervals/callback`;
  }
  const rawProto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  const rawHost = String(
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  )
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  return `${proto}://${rawHost || 'localhost:3000'}/auth/intervals/callback`;
}

export function resolveWahooCallbackUrl(req: Request): string {
  const explicitRedirect = (process.env.WAHOO_REDIRECT_URI || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin as string | undefined);
  if (safeOrigin) {
    return `${safeOrigin}/auth/wahoo/callback`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/wahoo/callback`;
  }
  const rawProto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  const rawHost = String(
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  )
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  return `${proto}://${rawHost || 'localhost:3000'}/auth/wahoo/callback`;
}

export function resolvePolarCallbackUrl(req: Request): string {
  const explicitRedirect = (process.env.POLAR_REDIRECT_URI || '').trim();
  if (explicitRedirect) {
    try {
      const parsed = new URL(explicitRedirect);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  const safeOrigin = resolveSafeOrigin(req.query.origin as string | undefined);
  if (safeOrigin) {
    return `${safeOrigin}/auth/polar/callback`;
  }
  const appUrl = resolveSafeOrigin(process.env.APP_URL || '');
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    return `${appUrl}/auth/polar/callback`;
  }
  const rawProto = String((req.headers['x-forwarded-proto'] as string) || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'https' ? 'https' : 'http';
  const rawHost = String(
    (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000'
  )
    .split(',')[0]
    .trim()
    .replace(/[^a-zA-Z0-9.:-]/g, '');
  return `${proto}://${rawHost || 'localhost:3000'}/auth/polar/callback`;
}

export const resolveCallbackUrl = resolveStravaCallbackUrl;
