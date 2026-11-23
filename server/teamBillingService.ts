import crypto from 'crypto';
import type {
  SchoolPoInvoiceRecord,
  TeamBillingPlanCode,
  TeamBillingSummary,
  TeamSummaryWithRole,
} from '../src/types.ts';
import {
  canManageTeamGovernanceRole,
  loadTeamDocRaw,
  projectTeamSummaryForCaller,
  saveTeamDocRaw,
} from './teamStoreCore.ts';
import {
  isResendConfigured,
  sendEmailViaResend,
  withBoundedTimeout,
} from './teamEmailAndOtpService.ts';
import { escapeHtml } from './securityUtils.ts';
import {
  appendAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withTeamRowLock,
  withVaultLock,
} from './tokenVault.ts';

export interface BillingPlanSpec {
  planCode: TeamBillingPlanCode;
  label: string;
  amountUsd: number;
  annualLabel: string;
  stripePriceEnvKey?:
    | 'STRIPE_PRICE_HS_ANNUAL'
    | 'STRIPE_PRICE_COLLEGIATE_ANNUAL'
    | 'STRIPE_PRICE_DISTRICT_ANNUAL';
}

export const TEAM_BILLING_PLANS: Record<TeamBillingPlanCode, BillingPlanSpec> = {
  FREE_FOUNDING: {
    planCode: 'FREE_FOUNDING',
    label: 'Founding Season Pilot',
    amountUsd: 0,
    annualLabel: '$0 / Season',
  },
  HS_250: {
    planCode: 'HS_250',
    label: 'High School Program',
    amountUsd: 250,
    annualLabel: '$250 / yr',
    stripePriceEnvKey: 'STRIPE_PRICE_HS_ANNUAL',
  },
  COLLEGIATE_1200: {
    planCode: 'COLLEGIATE_1200',
    label: 'Collegiate / NCAA Program',
    amountUsd: 1200,
    annualLabel: '$1,200 / yr',
    stripePriceEnvKey: 'STRIPE_PRICE_COLLEGIATE_ANNUAL',
  },
  DISTRICT_2000: {
    planCode: 'DISTRICT_2000',
    label: 'District Multi-School',
    amountUsd: 2000,
    annualLabel: '$2,000 / yr',
    stripePriceEnvKey: 'STRIPE_PRICE_DISTRICT_ANNUAL',
  },
};

export function isStripeBillingConfigured(): boolean {
  return Boolean((process.env.STRIPE_SECRET_KEY || '').trim());
}

function sanitizeBillingProjection(raw?: TeamBillingSummary): TeamBillingSummary {
  const base: TeamBillingSummary = raw || {
    planCode: 'FREE_FOUNDING',
    status: 'PILOT',
    poInvoices: [],
  };
  const {
    stripeCustomerId: _dropCust,
    stripeSubscriptionId: _dropSub,
    ...safe
  } = base;
  return {
    ...safe,
    stripeConfigured: isStripeBillingConfigured(),
    poInvoices: Array.isArray(safe.poInvoices) ? safe.poInvoices : [],
  };
}

function isValidPaidPlanCode(raw: unknown): raw is Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'> {
  return raw === 'HS_250' || raw === 'COLLEGIATE_1200' || raw === 'DISTRICT_2000';
}

const VALID_BILLING_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function getTeamBillingSummary(params: {
  callerSid: string;
  teamId: string;
}): Promise<{
  ok: boolean;
  status?: number;
  billing?: TeamBillingSummary;
  error?: string;
}> {
  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) {
    return { ok: false, status: 404, error: 'Team not found.' };
  }
  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Head Coach or Org Admin permissions required for team billing.',
    };
  }
  return {
    ok: true,
    billing: sanitizeBillingProjection(doc.billing),
  };
}

export async function issueSchoolPoInvoice(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  planCode: unknown;
  schoolOrDistrictName: unknown;
  billingContactEmail: unknown;
  poNumber?: unknown;
}): Promise<{
  ok: boolean;
  status?: number;
  invoice?: SchoolPoInvoiceRecord;
  emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  billing?: TeamBillingSummary;
  team?: TeamSummaryWithRole | null;
  error?: string;
}> {
  const rawPlan = String(params.planCode || '').trim().toUpperCase();
  if (!isValidPaidPlanCode(rawPlan)) {
    return {
      ok: false,
      status: 400,
      error: 'Select a valid paid annual plan (HS_250, COLLEGIATE_1200, or DISTRICT_2000).',
    };
  }

  const cleanSchool = String(params.schoolOrDistrictName || '').trim().slice(0, 120);
  if (!cleanSchool) {
    return { ok: false, status: 400, error: 'School or district name is required.' };
  }

  const cleanEmail = String(params.billingContactEmail || '').trim().toLowerCase().slice(0, 160);
  if (!cleanEmail || !VALID_BILLING_EMAIL_RE.test(cleanEmail)) {
    return { ok: false, status: 400, error: 'Valid billing contact email is required.' };
  }

  const cleanPo = String(params.poNumber || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 48);
  const planSpec = TEAM_BILLING_PLANS[rawPlan];

  let pendingEmail: { to: string; subject: string; html: string; text: string } | null = null;

  const lockedResult = await withTeamRowLock(params.teamId, async () => {
    const doc = await loadTeamDocRaw(params.teamId);
    if (!doc) {
      return { ok: false as const, status: 404, error: 'Team not found.' };
    }

    const callerMem = doc.memberships.find(
      (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
      return {
        ok: false as const,
        status: 403,
        error: 'Head Coach or Org Admin permissions required to issue a School PO invoice.',
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const year = now.getUTCFullYear();
    const suffix = crypto.randomInt(1000, 10000);
    const invoiceNumber = `MR-PO-${year}-${suffix}`;
    const dueDate = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

    const invoice: SchoolPoInvoiceRecord = {
      invoiceNumber,
      planCode: rawPlan,
      amountUsd: planSpec.amountUsd,
      schoolOrDistrictName: cleanSchool,
      ...(cleanPo ? { poNumber: cleanPo } : {}),
      billingContactEmail: cleanEmail,
      issuedAt: nowIso,
      dueDate,
      status: 'ISSUED',
    };

    const existingInvoices = Array.isArray(doc.billing?.poInvoices)
      ? doc.billing.poInvoices
      : [];

    doc.billing = {
      ...(doc.billing || {}),
      planCode: rawPlan,
      status: doc.billing?.status === 'ACTIVE_PAID' ? 'ACTIVE_PAID' : 'PO_ISSUED',
      schoolOrDistrictName: cleanSchool,
      billingContactEmail: cleanEmail,
      ...(cleanPo ? { poNumber: cleanPo } : {}),
      poInvoices: [invoice, ...existingInvoices].slice(0, 25),
      updatedAt: nowIso,
    };
    doc.updatedAt = nowIso;

    await saveTeamDocRaw(params.teamId, doc);
    await appendAuditLogAsync({
      teamId: params.teamId,
      actorSid: params.callerSid,
      action: 'BILLING_PO_ISSUED',
      targetId: invoice.invoiceNumber,
      metadata: {
        planCode: rawPlan,
        amountUsd: planSpec.amountUsd,
        schoolOrDistrictName: cleanSchool,
        ...(cleanPo ? { poNumber: cleanPo } : {}),
      },
    });

    if (isResendConfigured()) {
      const cleanOrigin = params.originUrl.replace(/\/+$/, '');
      const safeTeam = escapeHtml(doc.brand.name);
      const safeSchool = escapeHtml(cleanSchool);
      const safeInv = escapeHtml(invoice.invoiceNumber);
      const safePlan = escapeHtml(`${planSpec.label} (${planSpec.annualLabel})`);
      const safePo = cleanPo ? escapeHtml(cleanPo) : 'Pending ASB / District PO #';
      pendingEmail = {
        to: cleanEmail,
        subject: `MeetReady Net-30 School PO Invoice ${invoice.invoiceNumber} — ${doc.brand.name}`,
        html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#F6F3EC;padding:24px 12px;color:#121413;"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #CFC9BC;border-radius:16px;padding:24px;"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#B83A24;text-transform:uppercase;">MeetReady School &amp; District Billing</div><h1 style="font-size:20px;margin:8px 0 12px;">Net-30 Invoice ${safeInv}</h1><p style="font-size:14px;color:#2C2A26;line-height:1.5;">Issued for <strong>${safeSchool}</strong> (${safeTeam}).</p><div style="background:#F6F3EC;border:1px solid #CFC9BC;border-radius:12px;padding:14px;font-size:13px;line-height:1.6;"><div><strong>Invoice #:</strong> ${safeInv}</div><div><strong>Plan:</strong> ${safePlan}</div><div><strong>Amount Due (Net-30):</strong> $${planSpec.amountUsd} USD</div><div><strong>Due Date:</strong> ${dueDate}</div><div><strong>PO Reference:</strong> ${safePo}</div></div><p style="font-size:12px;color:#57544D;margin-top:16px;">Need our IRS W-9 or CA SDPC NDPA? Visit <a href="${escapeHtml(
          `${cleanOrigin}/procurement`
        )}" style="color:#B83A24;">${escapeHtml(`${cleanOrigin}/procurement`)}</a>.</p></div></body></html>`,
        text: [
          `MeetReady Net-30 School PO Invoice ${invoice.invoiceNumber}`,
          `School / District: ${cleanSchool}`,
          `Team: ${doc.brand.name}`,
          `Plan: ${planSpec.label} (${planSpec.annualLabel})`,
          `Amount Due: $${planSpec.amountUsd} USD (Net-30, Due ${dueDate})`,
          `PO Reference: ${cleanPo || 'Pending'}`,
          `Procurement Pack (W-9 / CA NDPA): ${cleanOrigin}/procurement`,
        ].join('\n'),
      };
    }

    return {
      ok: true as const,
      invoice,
      billing: sanitizeBillingProjection(doc.billing),
      team: projectTeamSummaryForCaller(doc, params.callerSid, params.originUrl),
    };
  });

  if (!lockedResult.ok) {
    return lockedResult;
  }

  let emailStatus: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED' = 'READY_MANUAL_LINK';
  if (pendingEmail) {
    const emailReq = pendingEmail as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    const [settled] = await Promise.allSettled([
      withBoundedTimeout(sendEmailViaResend(emailReq), 8000, 'po-invoice-email'),
    ]);
    if (settled.status === 'fulfilled') {
      emailStatus = settled.value.status;
    } else {
      emailStatus = 'FAILED';
    }
  }

  return {
    ...lockedResult,
    emailStatus,
  };
}

export async function createStripeCheckoutSession(params: {
  callerSid: string;
  teamId: string;
  originUrl: string;
  planCode: unknown;
  billingContactEmail?: unknown;
}): Promise<{
  ok: boolean;
  status?: number;
  stripeConfigured: boolean;
  fallback?: 'SCHOOL_PO';
  sessionId?: string;
  checkoutUrl?: string;
  message?: string;
  error?: string;
}> {
  const rawPlan = String(params.planCode || '').trim().toUpperCase();
  if (!isValidPaidPlanCode(rawPlan)) {
    return {
      ok: false,
      status: 400,
      stripeConfigured: isStripeBillingConfigured(),
      error: 'Select a valid paid annual plan (HS_250, COLLEGIATE_1200, or DISTRICT_2000).',
    };
  }

  const doc = await loadTeamDocRaw(params.teamId);
  if (!doc) {
    return {
      ok: false,
      status: 404,
      stripeConfigured: isStripeBillingConfigured(),
      error: 'Team not found.',
    };
  }

  const callerMem = doc.memberships.find(
    (m) => m.userSid === params.callerSid && m.status !== 'REVOKED' && m.status !== 'ALUMNI'
  );
  if (!callerMem || !canManageTeamGovernanceRole(callerMem.role)) {
    return {
      ok: false,
      status: 403,
      stripeConfigured: isStripeBillingConfigured(),
      error: 'Head Coach or Org Admin permissions required to start team checkout.',
    };
  }

  const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeKey) {
    return {
      ok: true,
      stripeConfigured: false,
      fallback: 'SCHOOL_PO',
      message:
        'Stripe checkout is not configured on this server yet. Generate a Net-30 School PO Invoice instead.',
    };
  }

  const planSpec = TEAM_BILLING_PLANS[rawPlan];
  const cleanOrigin = params.originUrl.replace(/\/+$/, '');
  const cleanEmail = String(
    params.billingContactEmail || doc.billing?.billingContactEmail || ''
  )
    .trim()
    .toLowerCase();

  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', `${cleanOrigin}/#coach?billing=success`);
  form.set('cancel_url', `${cleanOrigin}/#coach?billing=cancelled`);
  form.set('client_reference_id', doc.brand.teamId);
  form.set('metadata[teamId]', doc.brand.teamId);
  form.set('metadata[planCode]', rawPlan);
  form.set('subscription_data[metadata][teamId]', doc.brand.teamId);
  form.set('subscription_data[metadata][planCode]', rawPlan);

  if (cleanEmail && VALID_BILLING_EMAIL_RE.test(cleanEmail)) {
    form.set('customer_email', cleanEmail);
  }

  const configuredPriceId = planSpec.stripePriceEnvKey
    ? (process.env[planSpec.stripePriceEnvKey] || '').trim()
    : '';
  if (configuredPriceId) {
    form.set('line_items[0][price]', configuredPriceId);
    form.set('line_items[0][quantity]', '1');
  } else {
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(planSpec.amountUsd * 100));
    form.set('line_items[0][price_data][recurring][interval]', 'year');
    form.set(
      'line_items[0][price_data][product_data][name]',
      `MeetReady ${planSpec.label} (Annual)`
    );
    form.set('line_items[0][quantity]', '1');
  }

  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!resp.ok || !data.id || !data.url) {
      return {
        ok: false,
        status: 502,
        stripeConfigured: true,
        error: data.error?.message || `Stripe Checkout API returned HTTP ${resp.status}.`,
      };
    }

    return {
      ok: true,
      stripeConfigured: true,
      sessionId: data.id,
      checkoutUrl: data.url,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      stripeConfigured: true,
      error: err instanceof Error ? err.message : 'Unable to reach Stripe Checkout API.',
    };
  }
}

export function verifyStripeWebhookSignature(params: {
  rawBody: Buffer | string;
  signatureHeader: string;
  webhookSecret: string;
  toleranceSecs?: number;
  nowEpochSecs?: number;
}): { valid: boolean; timestamp?: number; reason?: string } {
  const secret = String(params.webhookSecret || '').trim();
  const header = String(params.signatureHeader || '').trim();
  if (!secret || !header) {
    return { valid: false, reason: 'Missing Stripe webhook secret or signature header.' };
  }

  const rawBuffer = Buffer.isBuffer(params.rawBody)
    ? params.rawBody
    : Buffer.from(String(params.rawBody || ''), 'utf8');
  if (rawBuffer.length === 0) {
    return { valid: false, reason: 'Empty webhook payload.' };
  }

  let timestamp = 0;
  const v1Signatures: string[] = [];
  for (const part of header.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === 't') {
      const parsed = Number(val);
      if (Number.isFinite(parsed) && parsed > 0) timestamp = Math.floor(parsed);
    } else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(val)) {
      v1Signatures.push(val.toLowerCase());
    }
  }

  if (!timestamp || v1Signatures.length === 0) {
    return { valid: false, reason: 'Malformed Stripe-Signature header.' };
  }

  const tolerance = params.toleranceSecs ?? 300;
  const nowSecs = params.nowEpochSecs ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - timestamp) > tolerance) {
    return {
      valid: false,
      timestamp,
      reason: 'Stripe webhook timestamp outside 300s replay tolerance.',
    };
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    rawBuffer,
  ]);
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')
    .toLowerCase();
  const expectedBuf = Buffer.from(expectedHex, 'utf8');

  const matched = v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  });

  if (!matched) {
    return { valid: false, timestamp, reason: 'Stripe webhook signature mismatch.' };
  }

  return { valid: true, timestamp };
}

interface StripeWebhookStateVault {
  processedEventIds: string[];
  teamByStripeCustomer: Record<string, string>;
  teamByStripeSubscription: Record<string, string>;
}

const STRIPE_WEBHOOK_STATE_KEY = 'stripe_webhook_state_v1';

interface StripeWebhookEventPayload {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      customer?: string;
      subscription?: string;
      client_reference_id?: string;
      metadata?: Record<string, string>;
      subscription_details?: {
        metadata?: Record<string, string>;
      };
      current_period_end?: number;
      lines?: {
        data?: Array<{ period?: { end?: number } }>;
      };
    };
  };
}

export async function processStripeWebhookEvent(params: {
  rawBody: Buffer | string;
  signatureHeader: string;
  nowEpochSecs?: number;
}): Promise<{
  ok: boolean;
  status: number;
  duplicate?: boolean;
  eventId?: string;
  eventType?: string;
  teamId?: string;
  error?: string;
}> {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    return {
      ok: false,
      status: 503,
      error: 'STRIPE_WEBHOOK_SECRET is not configured.',
    };
  }

  const sigCheck = verifyStripeWebhookSignature({
    rawBody: params.rawBody,
    signatureHeader: params.signatureHeader,
    webhookSecret,
    toleranceSecs: 300,
    nowEpochSecs: params.nowEpochSecs,
  });
  if (!sigCheck.valid) {
    return {
      ok: false,
      status: 400,
      error: sigCheck.reason || 'Invalid Stripe webhook signature.',
    };
  }

  const rawText = Buffer.isBuffer(params.rawBody)
    ? params.rawBody.toString('utf8')
    : String(params.rawBody);

  let event: StripeWebhookEventPayload;
  try {
    event = JSON.parse(rawText) as StripeWebhookEventPayload;
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON in Stripe webhook body.' };
  }

  const eventId = String(event.id || '').trim();
  const eventType = String(event.type || '').trim();
  if (!eventId || !eventType) {
    return { ok: false, status: 400, error: 'Missing Stripe event id or type.' };
  }

  const obj = event.data?.object || {};
  const customerId = typeof obj.customer === 'string' ? obj.customer.trim() : undefined;
  const subscriptionId =
    typeof obj.subscription === 'string'
      ? obj.subscription.trim()
      : eventType.startsWith('customer.subscription.') && typeof obj.id === 'string'
        ? obj.id.trim()
        : undefined;

  const lockState = await withVaultLock(STRIPE_WEBHOOK_STATE_KEY, async () => {
    const state = await loadTenantVaultAsync<StripeWebhookStateVault>(
      STRIPE_WEBHOOK_STATE_KEY,
      {
        processedEventIds: [],
        teamByStripeCustomer: {},
        teamByStripeSubscription: {},
      }
    );

    if (state.processedEventIds.includes(eventId)) {
      return { duplicate: true as const, resolvedTeamId: undefined };
    }

    const metaTeamId =
      obj.metadata?.teamId ||
      obj.subscription_details?.metadata?.teamId ||
      obj.client_reference_id;
    const resolvedTeamId =
      (metaTeamId ? String(metaTeamId).trim() : '') ||
      (subscriptionId ? state.teamByStripeSubscription[subscriptionId] : '') ||
      (customerId ? state.teamByStripeCustomer[customerId] : '') ||
      undefined;

    if (resolvedTeamId) {
      if (customerId) state.teamByStripeCustomer[customerId] = resolvedTeamId;
      if (subscriptionId) state.teamByStripeSubscription[subscriptionId] = resolvedTeamId;
    }

    state.processedEventIds = [...state.processedEventIds, eventId].slice(-500);
    await saveTenantVaultAsync(STRIPE_WEBHOOK_STATE_KEY, state);
    return { duplicate: false as const, resolvedTeamId };
  });

  if (lockState.duplicate) {
    return {
      ok: true,
      status: 200,
      duplicate: true,
      eventId,
      eventType,
    };
  }

  const teamId = lockState.resolvedTeamId;
  if (!teamId) {
    return { ok: true, status: 200, eventId, eventType };
  }

  const metaPlan =
    obj.metadata?.planCode || obj.subscription_details?.metadata?.planCode;
  const periodEndEpoch =
    obj.current_period_end || obj.lines?.data?.[0]?.period?.end || undefined;

  await withTeamRowLock(teamId, async () => {
    const doc = await loadTeamDocRaw(teamId);
    if (!doc) return;

    const nowIso = new Date().toISOString();
    const nextBilling: TeamBillingSummary = {
      ...(doc.billing || { planCode: 'FREE_FOUNDING', status: 'PILOT' }),
      ...(isValidPaidPlanCode(metaPlan) ? { planCode: metaPlan } : {}),
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      updatedAt: nowIso,
    };

    let auditAction = 'BILLING_STRIPE_EVENT';
    if (eventType === 'checkout.session.completed' || eventType === 'invoice.paid') {
      nextBilling.status = 'ACTIVE_PAID';
      const cycleEnd = periodEndEpoch
        ? new Date(periodEndEpoch * 1000).toISOString()
        : new Date(Date.now() + 365 * 86_400_000).toISOString();
      nextBilling.billingCycleEndIso = cycleEnd;
      if (Array.isArray(nextBilling.poInvoices)) {
        nextBilling.poInvoices = nextBilling.poInvoices.map((inv) =>
          inv.status === 'ISSUED' &&
          (!isValidPaidPlanCode(metaPlan) || inv.planCode === metaPlan)
            ? { ...inv, status: 'PAID', paidAt: nowIso }
            : inv
        );
      }
      auditAction =
        eventType === 'checkout.session.completed'
          ? 'BILLING_STRIPE_ACTIVATED'
          : 'BILLING_STRIPE_RENEWED';
    } else if (eventType === 'invoice.payment_failed') {
      nextBilling.status = 'PAST_DUE';
      auditAction = 'BILLING_STRIPE_PAST_DUE';
    } else if (eventType === 'customer.subscription.deleted') {
      nextBilling.status = 'RENEWAL_DUE';
      auditAction = 'BILLING_STRIPE_SUB_ENDED';
    } else {
      return;
    }

    doc.billing = nextBilling;
    doc.updatedAt = nowIso;
    await saveTeamDocRaw(teamId, doc);
    await appendAuditLogAsync({
      teamId,
      actorSid: 'stripe_webhook',
      action: auditAction,
      targetId: eventId,
      metadata: {
        eventType,
        planCode: nextBilling.planCode,
        status: nextBilling.status,
      },
    });
  });

  return {
    ok: true,
    status: 200,
    eventId,
    eventType,
    teamId,
  };
}
