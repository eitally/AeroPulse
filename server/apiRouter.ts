import express, { type Request, type Response, type NextFunction } from 'express';
import { securityHeadersMiddleware } from './securityUtils.ts';
import {
  requestContext,
  responseByReq,
  resolveSessionScopeKey,
  loadTenantVaultAsync,
} from './sessionContext.ts';

// Domain routers
import { vaultAndPhysiologyRouter } from './routers/vaultAndPhysiologyRouter.ts';
import { athleteStateRouter } from './routers/athleteStateRouter.ts';
import { webhooksAndExportRouter } from './routers/webhooksAndExportRouter.ts';
import { teamRouter } from './routers/teamRouter.ts';
import { teamSyncRouter } from './routers/teamSyncRouter.ts';
import { authRouter } from './routers/authRouter.ts';
import { configRouter } from './routers/configRouter.ts';
import { garminRouter } from './routers/garminRouter.ts';
import { wahooRouter } from './routers/wahooRouter.ts';
import { polarRouter } from './routers/polarRouter.ts';
import { intervalsRouter } from './routers/intervalsRouter.ts';
import { stravaRouter } from './routers/stravaRouter.ts';
import { activitiesRouter } from './routers/activitiesRouter.ts';
import { coachRouter } from './routers/coachRouter.ts';
import { webhookRouter } from './routers/webhookRouter.ts';

export const apiRouter = express.Router();

// Security headers & scoped session context middleware
apiRouter.use(securityHeadersMiddleware);
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

// Mount domain routers
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
  getClientAiRateLimitKey,
  resetAiRateLimitsForTesting,
} from './secretManager.ts';

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
