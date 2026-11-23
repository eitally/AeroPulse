import express, { type Request, type Response, type NextFunction } from 'express';
import { securityHeadersMiddleware } from './securityUtils.ts';
import {
  requestContext,
  responseByReq,
  resolveSessionScopeKey,
  loadTenantVaultAsync,
} from './sessionContext.ts';
import { checkPostgresHealthAsync, getVaultStorageBackend } from './tokenVault.ts';
import { getConfiguredRateLimitBackend } from './rateLimiter.ts';
import { parseSentryDsn } from './observability.ts';

declare const __MEETREADY_BUILD_TIMESTAMP__: string | undefined;
const SERVER_BOOT_ISO = new Date().toISOString();

// Domain routers
import { vaultAndPhysiologyRouter } from './routers/vaultAndPhysiologyRouter.ts';
import { athleteStateRouter } from './routers/athleteStateRouter.ts';
import { webhooksAndExportRouter } from './routers/webhooksAndExportRouter.ts';
import { teamRouter } from './routers/teamRouter.ts';
import { teamMeetDayRouter } from './routers/teamMeetDayRouter.ts';
import { teamInjuryRouter } from './routers/teamInjuryRouter.ts';
import { teamBillingRouter } from './routers/teamBillingRouter.ts';
import { teamSyncRouter } from './routers/teamSyncRouter.ts';
import { authRouter } from './routers/authRouter.ts';
import { configRouter } from './routers/configRouter.ts';
import { garminRouter } from './routers/garminRouter.ts';
import { corosRouter } from './routers/corosRouter.ts';
import { wahooRouter } from './routers/wahooRouter.ts';
import { polarRouter } from './routers/polarRouter.ts';
import { intervalsRouter } from './routers/intervalsRouter.ts';
import { stravaRouter } from './routers/stravaRouter.ts';
import { activitiesRouter } from './routers/activitiesRouter.ts';
import { coachRouter } from './routers/coachRouter.ts';
import { webhookRouter } from './routers/webhookRouter.ts';
import { analyticsRouter } from './routers/analyticsRouter.ts';

export const apiRouter = express.Router();

// Security headers, URL-encoded form parsing, & scoped session context middleware
apiRouter.use(securityHeadersMiddleware);
apiRouter.use(express.urlencoded({ extended: false }));
apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  responseByReq.set(req, res);
  requestContext.run(req, () => {
    const scopeKey = resolveSessionScopeKey(req);
    if (scopeKey && process.env.DATABASE_URL?.trim()) {
      Promise.all([
        loadTenantVaultAsync(`session_${scopeKey}`, {}),
        loadTenantVaultAsync(`garmin_${scopeKey}`, null),
      ])
        .then(() => next())
        .catch(() => next());
      return;
    }
    next();
  });
});

// Health probe (bounded Postgres check + boolean-only integration readiness)
apiRouter.get('/api/health', async (_req: Request, res: Response) => {
  const pgHealth = await checkPostgresHealthAsync(2000);
  const ok = pgHealth.configured ? pgHealth.healthy === true : true;
  const env = process.env;
  const buildTimestamp =
    typeof __MEETREADY_BUILD_TIMESTAMP__ !== 'undefined' && __MEETREADY_BUILD_TIMESTAMP__
      ? __MEETREADY_BUILD_TIMESTAMP__
      : SERVER_BOOT_ISO;
  res.status(ok ? 200 : 503).json({
    ok,
    status: ok ? 'ok' : 'degraded',
    storageBackend: getVaultStorageBackend(),
    databaseConfigured: pgHealth.configured,
    databaseHealthy: pgHealth.healthy,
    dbPingLatencyMs: pgHealth.latencyMs,
    rateLimitBackend: getConfiguredRateLimitBackend(),
    uptimeSeconds: Math.floor(process.uptime()),
    appVersion: '2.1.0',
    buildTimestamp,
    integrations: {
      googleAuth: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
      strava: Boolean(env.STRAVA_CLIENT_ID?.trim() && env.STRAVA_CLIENT_SECRET?.trim()),
      garmin: Boolean(env.GARMIN_CLIENT_ID?.trim() && env.GARMIN_CLIENT_SECRET?.trim()),
      coros: Boolean(env.COROS_CLIENT_ID?.trim() && env.COROS_CLIENT_SECRET?.trim()),
      intervals: Boolean(env.INTERVALS_CLIENT_ID?.trim() && env.INTERVALS_CLIENT_SECRET?.trim()),
      wahoo: Boolean(env.WAHOO_CLIENT_ID?.trim() && env.WAHOO_CLIENT_SECRET?.trim()),
      polar: Boolean(env.POLAR_CLIENT_ID?.trim() && env.POLAR_CLIENT_SECRET?.trim()),
      resendEmail: Boolean(env.RESEND_API_KEY?.trim()),
      stripeBilling: Boolean(env.STRIPE_SECRET_KEY?.trim()),
      stripeWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
      geminiAi: Boolean(
        (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()
      ),
      webPushVapid: Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim()),
      sentryObservability: Boolean(parseSentryDsn(env.SENTRY_DSN)),
      cronAuth: Boolean(env.CRON_SECRET?.trim()),
    },
    timestamp: new Date().toISOString(),
  });
});

// Mount domain routers
apiRouter.use(vaultAndPhysiologyRouter);
apiRouter.use(athleteStateRouter);
apiRouter.use(webhooksAndExportRouter);
apiRouter.use(teamRouter);
apiRouter.use(teamMeetDayRouter);
apiRouter.use(teamInjuryRouter);
apiRouter.use(teamBillingRouter);
apiRouter.use(teamSyncRouter);
apiRouter.use(authRouter);
apiRouter.use(configRouter);
apiRouter.use(garminRouter);
apiRouter.use(corosRouter);
apiRouter.use(wahooRouter);
apiRouter.use(polarRouter);
apiRouter.use(intervalsRouter);
apiRouter.use(stravaRouter);
apiRouter.use(activitiesRouter);
apiRouter.use(coachRouter);
apiRouter.use(webhookRouter);
apiRouter.use(analyticsRouter);

// ----------------------------------------------------------------------------
// Backward-Compatibility Re-Exports (Test Suites & External Consumers)
// ----------------------------------------------------------------------------

export type { StoredStravaSyncPolicy } from './routers/stravaRouter.ts';

export {
  isServerOwnedSecret,
  hasClientByoGeminiKey,
  isAuthorizedForServerAi,
  isAuthorizedForAi,
  checkAiRateLimit,
  checkAiRateLimitAsync,
  getClientAiRateLimitKey,
  resetAiRateLimitsForTesting,
} from './secretManager.ts';
export {
  resetRateLimitsForTesting,
  resetRateLimitsForTesting as resetAllRateLimitsForTesting,
} from './rateLimiter.ts';

export {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
  getEffectiveIntervalsClientConfig,
  intervalsCallbackHandler,
} from './routers/intervalsRouter.ts';

export {
  resolveIntervalsCallbackUrl,
  resolveWahooCallbackUrl,
  resolvePolarCallbackUrl,
} from './oauthHelpers.ts';

export {
  getEffectiveWahooClientConfig,
  getEffectiveWahooTokens,
  ensureValidWahooAccessToken,
  wahooCallbackHandler,
} from './routers/wahooRouter.ts';

export {
  getEffectivePolarClientConfig,
  getEffectivePolarTokens,
  parsePolarDurationSecs,
  normalizePolarExercise,
  polarCallbackHandler,
} from './routers/polarRouter.ts';

export { parseWorkoutSyntaxToSteps } from './physiologyEngine.ts';

export { executeHourlyBackgroundPoll } from './routers/webhookRouter.ts';
