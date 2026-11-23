import express, { type Request, type Response } from 'express';
import {
  getFunnelSummaryAsync,
  recordFunnelEventAsync,
} from '../funnelAnalyticsService.ts';
import {
  checkDistributedRateLimitAsync,
  getClientRateLimitIp,
} from '../rateLimiter.ts';
import { hasValidCronAuthorization } from '../securityUtils.ts';

export const analyticsRouter = express.Router();

analyticsRouter.post('/api/analytics/event', async (req: Request, res: Response) => {
  try {
    const rateLimit = await checkDistributedRateLimitAsync(
      `funnel:${getClientRateLimitIp(req)}`,
      60,
      60_000
    );
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSecs));
      res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded for funnel telemetry. Try again shortly.',
        retryAfterSecs: rateLimit.retryAfterSecs,
      });
      return;
    }

    const rawBody =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    // Never pass client IP, user-agent, cookies, or headers into funnel storage.
    const result = await recordFunnelEventAsync(rawBody);
    if (!result.ok) {
      res.status(result.status || 400).json({
        ok: false,
        error: result.error || 'Invalid funnel event.',
      });
      return;
    }

    res.status(202).json({ ok: true, recorded: true });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to record funnel event.',
    });
  }
});

analyticsRouter.get('/api/analytics/summary', async (req: Request, res: Response) => {
  if (!hasValidCronAuthorization(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized analytics summary request.' });
    return;
  }

  try {
    const rawQueryVal = req.query.windowDays;
    let windowDays = 30;
    if (typeof rawQueryVal === 'string' && rawQueryVal.trim() !== '') {
      const parsed = Number(rawQueryVal);
      if (Number.isFinite(parsed)) {
        windowDays = Math.max(1, Math.min(365, Math.floor(parsed)));
      }
    }

    const summary = await getFunnelSummaryAsync({ windowDays });
    res.status(200).json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading analytics summary.',
    });
  }
});
