#!/usr/bin/env node
/**
 * MeetReady Production Launch Readiness Verifier (`npm run check:prod`)
 *
 * Audits live https://meetready.app (or MEETREADY_PROD_URL) across:
 *   1. /api/health flags (PostgreSQL, rate-limit backend, Resend, VAPID, Cron, Stripe, Sentry)
 *   2. Public legal, procurement, and GTM routes (/procurement, /for-athletic-directors, /privacy, /terms, /subprocessors, /demo)
 *   3. DNS readiness (root MX for inbound procurement@/support@/privacy@/billing@, plus Resend DKIM/SPF/DMARC)
 *
 * Exits 0 only when all launch-blocking (P0) gates pass; exits 1 otherwise.
 */
import dns from 'node:dns/promises';

const BASE_URL = (process.env.MEETREADY_PROD_URL || 'https://meetready.app').replace(/\/+$/, '');
const DOMAIN = new URL(BASE_URL).hostname;

const results = [];

function record(severity, name, pass, detail) {
  results.push({ severity, name, pass, detail });
  const icon = pass ? 'PASS' : severity === 'P0' ? 'FAIL' : 'WARN';
  console.log(`[${icon}] (${severity}) ${name}: ${detail}`);
}

async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { redirect: 'follow' });
    if (!res.ok) {
      record('P0', 'API /api/health HTTP', false, `HTTP ${res.status}`);
      return;
    }
    const h = await res.json();
    const integrations = h.integrations || {};

    record('P0', 'API health ok', h.ok === true, `status=${h.status} version=${h.appVersion} built=${h.buildTimestamp}`);
    record(
      'P0',
      'PostgreSQL persistence (DATABASE_URL)',
      h.databaseConfigured === true && h.databaseHealthy === true && h.storageBackend !== 'ENCRYPTED_FILE',
      `storageBackend=${h.storageBackend} configured=${h.databaseConfigured} healthy=${h.databaseHealthy}`
    );
    record(
      'P0',
      'Distributed rate limiting',
      h.rateLimitBackend !== 'MEMORY',
      `rateLimitBackend=${h.rateLimitBackend} (need REDIS or POSTGRES)`
    );
    record('P0', 'Resend transactional email', integrations.resendEmail === true, `resendEmail=${integrations.resendEmail}`);
    record('P0', 'Google OAuth sign-in', integrations.googleAuth === true, `googleAuth=${integrations.googleAuth}`);
    record('P0', 'Web Push VAPID keys', integrations.webPushVapid === true, `webPushVapid=${integrations.webPushVapid}`);
    record('P0', 'Cron bearer secret (CRON_SECRET)', integrations.cronAuth === true, `cronAuth=${integrations.cronAuth}`);
    record(
      'P1',
      'Stripe card checkout & webhook',
      integrations.stripeBilling === true && integrations.stripeWebhook === true,
      `stripeBilling=${integrations.stripeBilling} stripeWebhook=${integrations.stripeWebhook}`
    );
    record('P1', 'Sentry error monitoring', integrations.sentryObservability === true, `sentryObservability=${integrations.sentryObservability}`);
    record(
      'P2',
      'Wearable partner OAuth (MEE-19)',
      Boolean(integrations.strava && integrations.garmin && integrations.wahoo && integrations.polar && integrations.coros && integrations.intervals),
      `strava=${integrations.strava} garmin=${integrations.garmin} wahoo=${integrations.wahoo} polar=${integrations.polar} coros=${integrations.coros} intervals=${integrations.intervals}`
    );
  } catch (err) {
    record('P0', 'API /api/health fetch', false, err instanceof Error ? err.message : String(err));
  }
}

async function checkPublicRoutes() {
  const routes = [
    { path: '/', expected: [200] },
    { path: '/procurement', expected: [200] },
    { path: '/for-athletic-directors', expected: [200] },
    { path: '/privacy', expected: [200] },
    { path: '/terms', expected: [200] },
    { path: '/subprocessors', expected: [200] },
    { path: '/demo', expected: [302, 307, 308] },
  ];

  for (const r of routes) {
    try {
      const res = await fetch(`${BASE_URL}${r.path}`, { redirect: 'manual' });
      const ok = r.expected.includes(res.status);
      record('P0', `Route ${r.path}`, ok, `HTTP ${res.status} (expected ${r.expected.join('/')})`);
    } catch (err) {
      record('P0', `Route ${r.path}`, false, err instanceof Error ? err.message : String(err));
    }
  }
}

async function checkDns() {
  try {
    const rootMx = await dns.resolveMx(DOMAIN).catch(() => []);
    record(
      'P0',
      `Inbound email MX (${DOMAIN})`,
      rootMx.length > 0,
      rootMx.length > 0
        ? rootMx.map((m) => `${m.priority} ${m.exchange}`).join(', ')
        : `No MX records — inbound mail to procurement@/privacy@/support@/billing@${DOMAIN} will bounce`
    );

    const dkim = await dns.resolveTxt(`resend._domainkey.${DOMAIN}`).catch(() => []);
    record('P0', `Outbound Resend DKIM (resend._domainkey.${DOMAIN})`, dkim.length > 0, dkim.length > 0 ? 'present' : 'missing');

    const sendMx = await dns.resolveMx(`send.${DOMAIN}`).catch(() => []);
    record('P0', `Outbound Resend bounce MX (send.${DOMAIN})`, sendMx.length > 0, sendMx.length > 0 ? sendMx.map((m) => m.exchange).join(', ') : 'missing');

    const dmarc = await dns.resolveTxt(`_dmarc.${DOMAIN}`).catch(() => []);
    record('P1', `DMARC policy (_dmarc.${DOMAIN})`, dmarc.length > 0, dmarc.length > 0 ? dmarc.flat().join(' ') : 'missing');
  } catch (err) {
    record('P0', 'DNS checks', false, err instanceof Error ? err.message : String(err));
  }
}

console.log(`\n=== MeetReady Production Launch Readiness Audit (${BASE_URL}) ===\n`);
await checkHealth();
await checkPublicRoutes();
await checkDns();

const p0Fails = results.filter((r) => r.severity === 'P0' && !r.pass);
const p1Warns = results.filter((r) => r.severity === 'P1' && !r.pass);
const p2Warns = results.filter((r) => r.severity === 'P2' && !r.pass);

console.log('\n=== Summary ===');
console.log(`P0 Launch Blockers Failed: ${p0Fails.length}`);
console.log(`P1 Recommended Warnings:   ${p1Warns.length}`);
console.log(`P2 Post-Pilot Warnings:    ${p2Warns.length}`);

if (p0Fails.length > 0) {
  process.exit(1);
}
