import type {
  SchoolPoInvoiceRecord,
  TeamBillingPlanCode,
  TeamBillingSummary,
  TeamSummaryWithRole,
} from '../types.ts';
import { buildThreshSessionHeaders } from './teamLifecycleApi.ts';

export interface SchoolBillingPlanDisplay {
  planCode: Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'>;
  title: string;
  priceLabel: string;
  amountUsd: number;
  summary: string;
  recommended?: boolean;
}

export const SCHOOL_BILLING_PLANS: readonly SchoolBillingPlanDisplay[] = [
  {
    planCode: 'HS_250',
    title: 'High School Program',
    priceLabel: '$250 / yr',
    amountUsd: 250,
    summary: 'Unlimited XC & Track athletes, Coach + Athletic Trainer seats, offline 0.01s Stopwatch & ASB/PO billing.',
    recommended: true,
  },
  {
    planCode: 'COLLEGIATE_1200',
    title: 'Collegiate / NCAA Program',
    priceLabel: '$1,200 / yr',
    amountUsd: 1200,
    summary: 'Combined Men’s & Women’s rosters, TFRRS sync, NCAA 20h CARA compliance export & AT Injury Hub.',
  },
  {
    planCode: 'DISTRICT_2000',
    title: 'District Multi-School',
    priceLabel: '$2,000 / yr',
    amountUsd: 2000,
    summary: 'District-wide athletics bundle with countersigned California SDPC NDPA, IRS W-9 & Net-30 PO.',
  },
] as const;

export class TeamBillingApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeamBillingApiError';
    this.status = status;
  }
}

async function requestBillingJson<T>(
  url: string,
  init: RequestInit
): Promise<T & { ok?: boolean; error?: string }> {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data?.ok === false) {
    throw new TeamBillingApiError(data?.error || 'Billing request failed.', resp.status);
  }
  return data;
}

export function fetchTeamBillingApi(teamId: string) {
  return requestBillingJson<{ billing: TeamBillingSummary }>(
    `/api/teams/${encodeURIComponent(teamId)}/billing`,
    { method: 'GET' }
  );
}

export function issueSchoolPoInvoiceApi(
  teamId: string,
  payload: {
    planCode: Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'>;
    schoolOrDistrictName: string;
    billingContactEmail: string;
    poNumber?: string;
  }
) {
  return requestBillingJson<{
    invoice: SchoolPoInvoiceRecord;
    emailStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
    billing: TeamBillingSummary;
    team?: TeamSummaryWithRole;
    teams?: TeamSummaryWithRole[];
  }>(`/api/teams/${encodeURIComponent(teamId)}/billing/po-invoice`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createStripeCheckoutApi(
  teamId: string,
  payload: {
    planCode: Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'>;
    billingContactEmail?: string;
  }
) {
  return requestBillingJson<{
    stripeConfigured: boolean;
    fallback?: 'SCHOOL_PO';
    sessionId?: string;
    checkoutUrl?: string;
    message?: string;
  }>(`/api/teams/${encodeURIComponent(teamId)}/billing/checkout`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function escapeHtmlSafe(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSchoolPoInvoicePrintHtml(params: {
  invoice: SchoolPoInvoiceRecord;
  teamName: string;
}): string {
  const { invoice, teamName } = params;
  const planMeta =
    SCHOOL_BILLING_PLANS.find((p) => p.planCode === invoice.planCode) ||
    SCHOOL_BILLING_PLANS[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MeetReady Net-30 Invoice ${escapeHtmlSafe(invoice.invoiceNumber)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #121413; background: #F6F3EC; margin: 0; padding: 32px; }
  .sheet { max-width: 720px; margin: 0 auto; background: #FFFFFF; border: 1px solid #CFC9BC; border-radius: 16px; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #B83A24; padding-bottom: 16px; margin-bottom: 20px; }
  .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #B83A24; }
  h1 { margin: 4px 0 0; font-size: 24px; }
  .meta { text-align: right; font-family: ui-monospace, monospace; font-size: 12px; color: #57544D; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #EDE9DF; }
  th { font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; color: #57544D; }
  .total { font-size: 18px; font-weight: 800; font-family: ui-monospace, monospace; text-align: right; }
  .box { background: #FAF8F4; border: 1px solid #CFC9BC; border-radius: 10px; padding: 14px; font-size: 12px; line-height: 1.6; color: #2C2A26; }
  @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="kicker">MeetReady · School &amp; District Athletics Invoice</div>
        <h1>Invoice ${escapeHtmlSafe(invoice.invoiceNumber)}</h1>
        <div style="font-size:13px;color:#57544D;margin-top:4px;">Remit To: MeetReady Athletics · procurement@meetready.app</div>
      </div>
      <div class="meta">
        <div><strong>Issued:</strong> ${escapeHtmlSafe(invoice.issuedAt.slice(0, 10))}</div>
        <div><strong>Terms:</strong> Net-30</div>
        <div><strong>Due Date:</strong> ${escapeHtmlSafe(invoice.dueDate)}</div>
        <div><strong>Status:</strong> ${escapeHtmlSafe(invoice.status)}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;">
      <div>
        <div class="kicker">Bill To</div>
        <div><strong>${escapeHtmlSafe(invoice.schoolOrDistrictName)}</strong></div>
        <div>Team: ${escapeHtmlSafe(teamName)}</div>
        <div>Billing Contact: ${escapeHtmlSafe(invoice.billingContactEmail)}</div>
      </div>
      <div>
        <div class="kicker">Purchase Order / ASB Reference</div>
        <div><strong>PO #:</strong> ${escapeHtmlSafe(invoice.poNumber || 'Pending School PO #')}</div>
        <div><strong>Tax / Compliance:</strong> IRS W-9 &amp; CA SDPC NDPA at meetready.app/procurement</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Annual Program Plan</th>
          <th>Billing Cycle</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${escapeHtmlSafe(planMeta.title)}</strong><br/><span style="font-size:12px;color:#57544D;">${escapeHtmlSafe(planMeta.summary)}</span></td>
          <td>12 Months (Unlimited Student &amp; Parent Seats Free)</td>
          <td style="text-align:right;font-family:ui-monospace,monospace;font-weight:700;">$${invoice.amountUsd.toFixed(2)} USD</td>
        </tr>
      </tbody>
    </table>

    <div class="total">Total Due (Net-30): $${invoice.amountUsd.toFixed(2)} USD</div>

    <div class="box" style="margin-top:20px;">
      <strong>Payment &amp; District Onboarding Instructions:</strong><br/>
      1. Remit ASB check, ACH, or district check referencing Invoice <strong>${escapeHtmlSafe(invoice.invoiceNumber)}</strong> to <strong>procurement@meetready.app</strong>.<br/>
      2. Need a signed IRS Form W-9, HECVAT Lite summary, or countersigned California SDPC NDPA? Download or request same-day countersignature at <strong>https://meetready.app/procurement</strong>.
    </div>

    <div class="no-print" style="margin-top:20px;text-align:right;">
      <button onclick="window.print()" style="padding:10px 18px;border-radius:8px;border:none;background:#121413;color:#D8FF2A;font-weight:700;cursor:pointer;">Print / Save PDF Invoice</button>
    </div>
  </div>
</body>
</html>`;
}

export function openPrintableSchoolPoInvoiceWindow(params: {
  invoice: SchoolPoInvoiceRecord;
  teamName: string;
}): boolean {
  if (typeof window === 'undefined') return false;
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=820,height=900');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(buildSchoolPoInvoicePrintHtml(params));
  popup.document.close();
  return true;
}
