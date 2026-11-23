import crypto from 'crypto';

export interface ParsedSentryDsn {
  storeUrl: string;
  publicKey: string;
  projectId: string;
}

export interface ServerObservabilityContext {
  scope?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}

function sanitizeTelemetryString(raw: string, maxLen = 300): string {
  return String(raw || '')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|code|secret|key|t)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, maxLen);
}

export function parseSentryDsn(rawDsn?: string): ParsedSentryDsn | null {
  const trimmed = String(rawDsn || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const publicKey = parsed.username;
    const pathParts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    const projectId = pathParts.pop();
    if (!publicKey || !projectId || !parsed.host) return null;
    const prefix = pathParts.length > 0 ? `/${pathParts.join('/')}` : '';
    return {
      storeUrl: `${parsed.protocol}//${parsed.host}${prefix}/api/${encodeURIComponent(projectId)}/store/`,
      publicKey,
      projectId,
    };
  } catch {
    return null;
  }
}

async function postSentryEvent(
  dsn: ParsedSentryDsn,
  eventPayload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(dsn.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=meetready-server/2.1`,
      },
      body: JSON.stringify(eventPayload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Never allow telemetry transport errors to destabilize request handling
  }
}

function shouldSuppressConsoleTelemetry(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

export async function captureServerException(
  err: unknown,
  context: ServerObservabilityContext = {}
): Promise<void> {
  const errName = err instanceof Error ? err.name : 'Error';
  const errMsg = sanitizeTelemetryString(
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown server error'
  );
  const cleanPath = context.path ? sanitizeTelemetryString(context.path.split('?')[0], 160) : undefined;
  const scope = sanitizeTelemetryString(context.scope || 'server', 80);
  const timestamp = new Date().toISOString();

  if (!shouldSuppressConsoleTelemetry()) {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp,
        scope,
        ...(context.method ? { method: context.method } : {}),
        ...(cleanPath ? { path: cleanPath } : {}),
        ...(typeof context.statusCode === 'number' ? { statusCode: context.statusCode } : {}),
        errorName: errName,
        message: errMsg,
      })
    );
  }

  const dsn = parseSentryDsn(process.env.SENTRY_DSN);
  if (!dsn) return;

  await postSentryEvent(dsn, {
    event_id: crypto.randomBytes(16).toString('hex'),
    timestamp,
    level: 'error',
    platform: 'node',
    server_name: 'meetready-api',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    message: `${scope}: ${errMsg}`,
    tags: {
      scope,
      ...(context.method ? { method: context.method } : {}),
      ...(cleanPath ? { path: cleanPath } : {}),
      ...(typeof context.statusCode === 'number'
        ? { statusCode: String(context.statusCode) }
        : {}),
    },
    exception: {
      values: [
        {
          type: errName,
          value: errMsg,
        },
      ],
    },
  });
}

export async function captureServerWarning(
  scope: string,
  message: string,
  context: Record<string, string | number | boolean> = {}
): Promise<void> {
  const cleanScope = sanitizeTelemetryString(scope, 80);
  const cleanMsg = sanitizeTelemetryString(message, 300);
  const timestamp = new Date().toISOString();

  if (!shouldSuppressConsoleTelemetry()) {
    console.warn(
      JSON.stringify({
        level: 'warning',
        timestamp,
        scope: cleanScope,
        message: cleanMsg,
        ...context,
      })
    );
  }

  const dsn = parseSentryDsn(process.env.SENTRY_DSN);
  if (!dsn) return;

  await postSentryEvent(dsn, {
    event_id: crypto.randomBytes(16).toString('hex'),
    timestamp,
    level: 'warning',
    platform: 'node',
    server_name: 'meetready-api',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    message: `${cleanScope}: ${cleanMsg}`,
    tags: {
      scope: cleanScope,
      ...Object.fromEntries(
        Object.entries(context).map(([k, v]) => [k, sanitizeTelemetryString(String(v), 120)])
      ),
    },
  });
}
