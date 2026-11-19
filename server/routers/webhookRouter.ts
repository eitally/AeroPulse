import express, { type Request, type Response } from 'express';
import fs from 'fs';
import { runtimeStore, saveSessionCacheAsync } from '../sessionContext.ts';
import {
  deriveStravaSessionSid,
  hasValidCronAuthorization,
  isProductionDeployment,
  timingSafeStringEqual,
} from '../securityUtils.ts';
import { loadTenantVaultAsync, saveTenantVaultAsync } from '../tokenVault.ts';
import { getEffectiveIntervalsConfig, syncIntervalsAllHistory } from './intervalsRouter.ts';
import { syncStravaAllHistory } from './stravaRouter.ts';
import { extractStravaId } from '../stravaIdUtils.ts';

export async function executeHourlyBackgroundPoll() {
  const results: Record<string, any> = {
    triggeredAt: new Date().toISOString(),
    intervalsPolled: false,
    stravaPolled: false,
  };

  const { apiKey, athleteId } = getEffectiveIntervalsConfig();
  if (apiKey) {
    try {
      const intData = await syncIntervalsAllHistory(apiKey, athleteId);
      results.intervalsPolled = true;
      results.intervalsActivitiesCount = intData.activities.length;
      results.intervalsWellnessCount = intData.wellnessDays.length;
    } catch (e) {
      results.intervalsError = e instanceof Error ? e.message : 'Intervals poll error';
    }
  }

  if (runtimeStore.stravaAccessToken && runtimeStore.stravaSyncPolicy?.window !== 'none') {
    try {
      const stravaData = await syncStravaAllHistory(undefined, false);
      results.stravaPolled = true;
      results.stravaActivitiesCount = stravaData.activities.length;
    } catch (e) {
      results.stravaError = e instanceof Error ? e.message : 'Strava poll error';
    }
  }

  runtimeStore.lastSyncedAt = new Date().toISOString();
  runtimeStore.nextHourlySyncAt = new Date(Date.now() + 3600 * 1000).toISOString();
  await saveSessionCacheAsync();
  return results;
}

export const webhookRouter = express.Router();

webhookRouter.all('/api/cron/hourly-sync', async (req: Request, res: Response) => {
  if (!hasValidCronAuthorization(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized cron invocation.' });
    return;
  }
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Background sync failed',
    });
  }
});

// Real-Time Webhook Receiver for Intervals.icu (ACTIVITY_UPLOADED, WELLNESS_UPDATED, etc.)
webhookRouter.post('/api/webhooks/intervals', async (req: Request, res: Response) => {
  const intervalsSecret = String(process.env.INTERVALS_WEBHOOK_SECRET || '').trim();
  const cronSecretConfigured = Boolean((process.env.CRON_SECRET || '').trim());
  const suppliedSecret = String(
    req.headers['x-intervals-webhook-secret'] || req.query.secret || ''
  ).trim();
  const hasIntervalsSecret = Boolean(
    intervalsSecret && suppliedSecret && timingSafeStringEqual(suppliedSecret, intervalsSecret)
  );
  if (isProductionDeployment() && !intervalsSecret && !cronSecretConfigured) {
    res.status(503).json({ ok: false, error: 'Intervals webhook authentication is not configured.' });
    return;
  }
  const hasConfiguredCronAuth = Boolean(cronSecretConfigured && hasValidCronAuthorization(req));
  if (!hasConfiguredCronAuth && !hasIntervalsSecret) {
    res.status(401).json({ ok: false, error: 'Unauthorized Intervals webhook invocation.' });
    return;
  }
  try {
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: 'intervals-webhook',
      eventsReceived: Array.isArray(req.body?.events) ? req.body.events.length : 1,
      ...summary,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Intervals webhook sync failed',
    });
  }
});

// Real-Time Push Webhook Verification & Receiver for Strava
webhookRouter.get('/api/webhooks/strava', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = String(req.query['hub.verify_token'] || '').trim();
  const expectedVerifyToken = String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '').trim();
  if (mode === 'subscribe' && challenge) {
    if (!expectedVerifyToken && isProductionDeployment()) {
      res.status(503).json({ ok: false, error: 'Strava webhook verify token is not configured.' });
      return;
    }
    if (
      expectedVerifyToken &&
      (!verifyToken || !timingSafeStringEqual(verifyToken, expectedVerifyToken))
    ) {
      res.status(403).json({ ok: false, error: 'Invalid Strava webhook verify_token.' });
      return;
    }
    res.json({ 'hub.challenge': challenge });
    return;
  }
  res.json({ ok: true, status: 'Strava webhook endpoint ready' });
});

webhookRouter.post('/api/webhooks/strava', async (req: Request, res: Response) => {
  try {
    const expectedSubId = String(process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID || '').trim();
    if (!expectedSubId && isProductionDeployment()) {
      res
        .status(503)
        .json({ ok: false, error: 'Strava webhook subscription ID is not configured.' });
      return;
    }
    if (expectedSubId) {
      const incomingSubId = String(req.body?.subscription_id ?? '').trim();
      if (!incomingSubId || !timingSafeStringEqual(incomingSubId, expectedSubId)) {
        res.status(403).json({ ok: false, error: 'Invalid Strava webhook subscription_id.' });
        return;
      }
    }
    const aspectType = String(req.body?.aspect_type || '').toLowerCase();
    const objectType = String(req.body?.object_type || '').toLowerCase();
    const objectId = extractStravaId(req.body, 'object_id_str', 'object_id');
    const ownerId = extractStravaId(req.body, 'owner_id_str', 'owner_id');
    const updates = req.body?.updates as Record<string, unknown> | undefined;

    // Compliance: Handle Strava user deauthorization (revoke tokens & purge cached archives)
    if (
      ownerId &&
      objectType === 'athlete' &&
      (String(updates?.authorized || '').toLowerCase() === 'false' || aspectType === 'delete')
    ) {
      const scopeKey = deriveStravaSessionSid(ownerId).slice(0, 24);
      const vaultDoc = await loadTenantVaultAsync<Record<string, any> | null>(
        `session_${scopeKey}`,
        null
      );
      if (vaultDoc) {
        vaultDoc.stravaAccessToken = '';
        vaultDoc.stravaRefreshToken = '';
        vaultDoc.stravaExpiresAt = 0;
        vaultDoc.stravaAthleteId = undefined;
        await saveTenantVaultAsync(`session_${scopeKey}`, vaultDoc);
      }
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${ownerId}.json`;
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
      res.json({ ok: true, source: 'strava-webhook', handled: 'athlete-deauthorize', ownerId });
      return;
    }

    // Compliance: Handle deleted or made-private Strava activity events
    if (ownerId && objectType === 'activity' && aspectType === 'delete' && objectId) {
      let removedFromArchive = false;
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${ownerId}.json`;
        if (fs.existsSync(archivePath)) {
          const parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
          if (Array.isArray(parsed)) {
            const filtered = parsed.filter(
              (a) => String(a?.id || '') !== objectId && String(a?.stravaId || '') !== objectId
            );
            if (filtered.length !== parsed.length) {
              fs.writeFileSync(archivePath, JSON.stringify(filtered), {
                encoding: 'utf8',
                mode: 0o600,
              });
              removedFromArchive = true;
            }
          }
        }
      } catch {
        // ignore
      }
      res.json({
        ok: true,
        source: 'strava-webhook',
        handled: 'activity-delete',
        objectId,
        ownerId,
        removedFromArchive,
      });
      return;
    }

    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: 'strava-webhook',
      aspectType: req.body?.aspect_type,
      objectId: objectId || undefined,
      ownerId: ownerId || undefined,
      ...summary,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Strava webhook sync failed',
    });
  }
});
