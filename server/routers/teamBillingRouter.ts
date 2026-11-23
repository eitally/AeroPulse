import express, { type Request, type Response } from 'express';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
  resolveTrustedRequestOrigin,
} from '../securityUtils.ts';
import {
  createStripeCheckoutSession,
  getTeamBillingSummary,
  issueSchoolPoInvoice,
  processStripeWebhookEvent,
} from '../teamBillingService.ts';
import { getDistrictAdOverview } from '../teamDistrictService.ts';
import { listTeamsForUser } from '../teamStoreCore.ts';

type RequestWithRawBody = Request & { rawBody?: Buffer };

export const teamBillingRouter = express.Router();

teamBillingRouter.get('/api/teams/district-overview', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }

    const districtName =
      typeof req.query.districtName === 'string' && req.query.districtName.trim()
        ? req.query.districtName.trim()
        : undefined;
    const report = await getDistrictAdOverview({
      callerSid: claims.sid,
      districtName,
    });
    res.json({ ok: true, report });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading district AD overview.',
    });
  }
});

teamBillingRouter.get('/api/teams/:teamId/billing', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }

    const result = await getTeamBillingSummary({
      callerSid: claims.sid,
      teamId: String(req.params.teamId || ''),
    });
    if (!result.ok) {
      res.status(result.status || 403).json({
        ok: false,
        error: result.error || 'Unable to load team billing.',
      });
      return;
    }

    res.json({ ok: true, billing: result.billing });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed loading team billing.',
    });
  }
});

teamBillingRouter.post(
  '/api/teams/:teamId/billing/po-invoice',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }

      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await issueSchoolPoInvoice({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        planCode: body.planCode,
        schoolOrDistrictName: body.schoolOrDistrictName,
        billingContactEmail: body.billingContactEmail,
        poNumber: body.poNumber,
      });
      if (!result.ok) {
        res.status(result.status || 400).json({
          ok: false,
          error: result.error || 'Unable to issue School PO invoice.',
        });
        return;
      }

      const teams = await listTeamsForUser(claims.sid, originUrl);
      res.json({
        ok: true,
        invoice: result.invoice,
        emailStatus: result.emailStatus,
        billing: result.billing,
        team: result.team,
        teams,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed issuing School PO invoice.',
      });
    }
  }
);

teamBillingRouter.post(
  '/api/teams/:teamId/billing/checkout',
  async (req: Request, res: Response) => {
    try {
      const claims = getVerifiedSessionClaims(req);
      if (!claims?.sid || !isCanonicalAuthenticatedClaims(claims)) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }

      const originUrl = resolveTrustedRequestOrigin(req);
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await createStripeCheckoutSession({
        callerSid: claims.sid,
        teamId: String(req.params.teamId || ''),
        originUrl,
        planCode: body.planCode,
        billingContactEmail: body.billingContactEmail,
      });
      if (!result.ok) {
        res.status(result.status || 400).json({
          ok: false,
          stripeConfigured: result.stripeConfigured,
          error: result.error || 'Unable to start checkout.',
        });
        return;
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed creating Stripe checkout session.',
      });
    }
  }
);

teamBillingRouter.post('/api/billing/stripe/webhook', async (req: Request, res: Response) => {
  try {
    const reqWithRaw = req as RequestWithRawBody;
    const rawBody = reqWithRaw.rawBody
      ? reqWithRaw.rawBody
      : Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
          ? Buffer.from(req.body, 'utf8')
          : undefined;

    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Raw webhook body buffer is required for Stripe signature verification.',
      });
      return;
    }

    const sigHeader = String(req.headers['stripe-signature'] || '');
    const result = await processStripeWebhookEvent({
      rawBody,
      signatureHeader: sigHeader,
    });
    if (!result.ok) {
      res.status(result.status).json({
        ok: false,
        error: result.error || 'Invalid Stripe webhook.',
      });
      return;
    }

    res.status(200).json({
      received: true,
      duplicate: Boolean(result.duplicate),
      eventId: result.eventId,
      eventType: result.eventType,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Stripe webhook processing error.',
    });
  }
});
