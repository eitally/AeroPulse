import express, { type Request, type Response } from 'express';
import { runtimeStore, saveSessionCacheAsync } from '../sessionContext.ts';
import { hasValidCronAuthorization } from '../securityUtils.ts';
import { getEffectiveIntervalsConfig, syncIntervalsAllHistory } from './intervalsRouter.ts';
import { syncStravaAllHistory } from './stravaRouter.ts';

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
    if (expectedVerifyToken && verifyToken !== expectedVerifyToken) {
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
    const summary = await executeHourlyBackgroundPoll();
    res.json({
      ok: true,
      source: 'strava-webhook',
      aspectType: req.body?.aspect_type,
      objectId: req.body?.object_id,
      ...summary,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Strava webhook sync failed',
    });
  }
});
