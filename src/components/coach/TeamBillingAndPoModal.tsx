import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  ShieldCheck,
  X,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  SCHOOL_BILLING_PLANS,
  createStripeCheckoutApi,
  fetchTeamBillingApi,
  issueSchoolPoInvoiceApi,
  openPrintableSchoolPoInvoiceWindow,
} from '../../utils/schoolPoInvoiceHelper';
import { emitFunnelEvent } from '../../utils/funnelTelemetry';
import type {
  SchoolPoInvoiceRecord,
  TeamBillingPlanCode,
  TeamBillingStatus,
  TeamBillingSummary,
  TeamSummaryWithRole,
} from '../../types';

export interface TeamBillingAndPoModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  isSampleDemoMode?: boolean;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
}

function billingStatusBadge(status?: TeamBillingStatus): {
  label: string;
  className: string;
} {
  if (status === 'ACTIVE_PAID') return { label: 'Active Annual Plan', className: 'ap-status-prime' };
  if (status === 'PO_ISSUED') return { label: 'Net-30 PO Issued', className: 'ap-status-info' };
  if (status === 'RENEWAL_DUE') return { label: 'Renewal Due', className: 'ap-status-caution' };
  if (status === 'PAST_DUE') return { label: 'Past Due', className: 'ap-status-strained' };
  return { label: 'Founding Season Pilot ($0)', className: 'ap-status-prime' };
}

export const TeamBillingAndPoModal: React.FC<TeamBillingAndPoModalProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  isSampleDemoMode = false,
  onTeamsUpdated,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  const formId = useId();

  useModalDialog({ isOpen, onClose, dialogRef });

  const defaultPlan: Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'> =
    activeTeam?.billing?.planCode && activeTeam.billing.planCode !== 'FREE_FOUNDING'
      ? activeTeam.billing.planCode
      : activeTeam?.brand.orgType === 'COLLEGIATE'
        ? 'COLLEGIATE_1200'
        : 'HS_250';

  const [selectedPlan, setSelectedPlan] =
    useState<Exclude<TeamBillingPlanCode, 'FREE_FOUNDING'>>(defaultPlan);
  const [schoolName, setSchoolName] = useState<string>(
    activeTeam?.billing?.schoolOrDistrictName || activeTeam?.brand.name || ''
  );
  const [billingEmail, setBillingEmail] = useState<string>(
    activeTeam?.billing?.billingContactEmail || ''
  );
  const [poNumber, setPoNumber] = useState<string>(activeTeam?.billing?.poNumber || '');
  const [billingState, setBillingState] = useState<TeamBillingSummary | null>(
    activeTeam?.billing || null
  );
  const [isSubmittingPo, setIsSubmittingPo] = useState<boolean>(false);
  const [isStartingStripe, setIsStartingStripe] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [lastEmailStatus, setLastEmailStatus] = useState<
    'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED' | null
  >(null);

  useEffect(() => {
    if (!isOpen || !activeTeam) return;
    setNotice(null);
    setLastEmailStatus(null);
    setSchoolName(activeTeam.billing?.schoolOrDistrictName || activeTeam.brand.name || '');
    setBillingEmail(activeTeam.billing?.billingContactEmail || '');
    setPoNumber(activeTeam.billing?.poNumber || '');
    setBillingState(
      activeTeam.billing || {
        planCode: 'FREE_FOUNDING',
        status: 'PILOT',
        poInvoices: [],
      }
    );
    if (activeTeam.billing?.planCode && activeTeam.billing.planCode !== 'FREE_FOUNDING') {
      setSelectedPlan(activeTeam.billing.planCode);
    } else {
      setSelectedPlan(
        activeTeam.brand.orgType === 'COLLEGIATE' ? 'COLLEGIATE_1200' : 'HS_250'
      );
    }

    if (isSampleDemoMode) return;
    let cancelled = false;
    fetchTeamBillingApi(activeTeam.brand.teamId)
      .then((res) => {
        if (!cancelled && res.billing) {
          setBillingState(res.billing);
        }
      })
      .catch(() => {
        // Keep team billing projection when offline or endpoint not mounted
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTeam?.brand.teamId, isSampleDemoMode]);

  if (!isOpen || !activeTeam) return null;

  const badge = billingStatusBadge(billingState?.status);
  const invoices = billingState?.poInvoices || [];
  const activePlanSpec =
    SCHOOL_BILLING_PLANS.find((p) => p.planCode === selectedPlan) || SCHOOL_BILLING_PLANS[0];

  const handleIssuePo = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSchool = schoolName.trim();
    const cleanEmail = billingEmail.trim();
    if (!cleanSchool || !cleanEmail) {
      setNotice({
        tone: 'error',
        text: 'Enter both school/district name and billing contact email.',
      });
      return;
    }

    if (isSampleDemoMode) {
      const now = new Date();
      const due = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
      const demoInvoice: SchoolPoInvoiceRecord = {
        invoiceNumber: `MR-PO-${now.getUTCFullYear()}-${String(now.getTime()).slice(-4)}`,
        planCode: selectedPlan,
        amountUsd: activePlanSpec.amountUsd,
        schoolOrDistrictName: cleanSchool,
        ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
        billingContactEmail: cleanEmail,
        issuedAt: now.toISOString(),
        dueDate: due,
        status: 'ISSUED',
      };
      const nextBilling: TeamBillingSummary = {
        ...(billingState || { planCode: selectedPlan, status: 'PO_ISSUED' }),
        planCode: selectedPlan,
        status: 'PO_ISSUED',
        schoolOrDistrictName: cleanSchool,
        billingContactEmail: cleanEmail,
        ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
        poInvoices: [demoInvoice, ...invoices].slice(0, 25),
        updatedAt: now.toISOString(),
      };
      setBillingState(nextBilling);
      const updatedTeam: TeamSummaryWithRole = { ...activeTeam, billing: nextBilling };
      onTeamsUpdated(
        myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t)),
        updatedTeam.brand.teamId
      );
      setNotice({
        tone: 'ok',
        text: `Generated Net-30 demo invoice ${demoInvoice.invoiceNumber} ($${demoInvoice.amountUsd} USD). Ready for manual PDF download below (READY_MANUAL_LINK).`,
      });
      setLastEmailStatus('READY_MANUAL_LINK');
      return;
    }

    setIsSubmittingPo(true);
    setNotice(null);
    setLastEmailStatus(null);
    try {
      const resp = await issueSchoolPoInvoiceApi(activeTeam.brand.teamId, {
        planCode: selectedPlan,
        schoolOrDistrictName: cleanSchool,
        billingContactEmail: cleanEmail,
        ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
      });
      setBillingState(resp.billing);
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        onTeamsUpdated(
          myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t)),
          resp.team.brand.teamId
        );
      }
      const deliveryStatus = resp.emailStatus || 'READY_MANUAL_LINK';
      setLastEmailStatus(deliveryStatus);
      emitFunnelEvent('po_generated', {
        role: activeTeam.myRole === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'COACH',
        tier: selectedPlan,
      });
      const deliverySuffix =
        deliveryStatus === 'SENT_RESEND'
          ? `Email sent via Resend to ${resp.invoice.billingContactEmail} (SENT_RESEND).`
          : deliveryStatus === 'FAILED'
            ? `Automated email failed — click Print Invoice & W-9 below to send manually (FAILED).`
            : `Ready for manual PDF download/forwarding to ${resp.invoice.billingContactEmail} (READY_MANUAL_LINK).`;
      setNotice({
        tone: 'ok',
        text: `Issued Net-30 School PO Invoice ${resp.invoice.invoiceNumber} ($${resp.invoice.amountUsd} USD, due ${resp.invoice.dueDate}). ${deliverySuffix}`,
      });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to issue School PO invoice.',
      });
    } finally {
      setIsSubmittingPo(false);
    }
  };

  const handleStripeCheckout = async () => {
    if (isSampleDemoMode) {
      setNotice({
        tone: 'ok',
        text: 'Demo preview: Sign in with a school account to launch Stripe annual card/P-Card checkout or generate a Net-30 PO invoice above.',
      });
      return;
    }

    setIsStartingStripe(true);
    setNotice(null);
    try {
      const resp = await createStripeCheckoutApi(activeTeam.brand.teamId, {
        planCode: selectedPlan,
        ...(billingEmail.trim() ? { billingContactEmail: billingEmail.trim() } : {}),
      });
      if (resp.stripeConfigured && resp.checkoutUrl) {
        emitFunnelEvent('stripe_checkout_started', {
          role: activeTeam.myRole === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'COACH',
          tier: selectedPlan,
          useBeacon: true,
        });
        window.location.assign(resp.checkoutUrl);
        return;
      }
      setNotice({
        tone: 'ok',
        text:
          resp.message ||
          'Stripe is not configured in this environment. Generate an instant Net-30 School PO Invoice above instead.',
      });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Unable to start online checkout.',
      });
    } finally {
      setIsStartingStripe(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="team-billing-po-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
    >
      <div className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-frame/25 dark:border-ap-edge p-4 sm:p-6 space-y-4 shadow-2xl text-ap-ink dark:text-ap-chalk">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ap-frame/15 dark:border-ap-edge pb-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md font-mono text-2xs font-bold uppercase tracking-wider bg-ap-obsidian text-ap-volt">
                School PO &amp; Annual Billing
              </span>
              <span
                data-testid="billing-status-badge"
                className={`px-2 py-0.5 rounded-md font-mono text-2xs font-bold ${badge.className}`}
              >
                {badge.label}
              </span>
            </div>
            <h2 id={headingId} className="text-lg sm:text-xl font-extrabold tracking-tight">
              {activeTeam.brand.name} · Program Renewal &amp; Purchase Orders
            </h2>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Students &amp; parents are always $0 forever. Choose Net-30 ASB / District PO invoicing or annual card checkout.
            </p>
          </div>

          <button
            type="button"
            data-testid="billing-modal-close-btn"
            aria-label="Close School PO and Billing modal"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {notice && (
          <div
            role="status"
            data-testid="billing-modal-notice"
            className={`rounded-xl px-3.5 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 ${
              notice.tone === 'ok' ? 'ap-status-prime' : 'ap-status-strained'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {notice.tone === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
            {lastEmailStatus && notice.tone === 'ok' && (
              <span
                data-testid="billing-email-status-badge"
                className="px-2 py-0.5 rounded font-mono text-2xs font-bold border border-current/25 shrink-0"
              >
                {lastEmailStatus === 'SENT_RESEND'
                  ? 'SENT_RESEND'
                  : lastEmailStatus === 'FAILED'
                    ? 'FAILED'
                    : 'READY_MANUAL_LINK'}
              </span>
            )}
          </div>
        )}

        {/* Plan Tiers */}
        <div
          role="group"
          aria-label="Select annual program plan"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
        >
          {SCHOOL_BILLING_PLANS.map((plan) => {
            const selected = selectedPlan === plan.planCode;
            return (
              <button
                key={plan.planCode}
                type="button"
                data-testid={`billing-plan-${plan.planCode}`}
                aria-pressed={selected}
                onClick={() => setSelectedPlan(plan.planCode)}
                className={`min-h-[44px] text-left rounded-xl p-3 border transition-all cursor-pointer space-y-1 ${
                  selected
                    ? 'liquid-capsule-active border-ap-clay dark:border-ap-volt'
                    : 'ap-card-inset border-ap-frame/20 dark:border-ap-edge'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold">{plan.title}</span>
                  {plan.recommended && (
                    <span className="px-1.5 py-0.5 rounded font-mono text-2xs font-bold bg-ap-clay text-white">
                      HS Flat
                    </span>
                  )}
                </div>
                <div className="text-lg font-extrabold font-mono text-ap-cobalt dark:text-ap-volt">
                  {plan.priceLabel}
                </div>
                <p className="text-2xs text-ap-muted dark:text-ap-muted-dark leading-snug">
                  {plan.summary}
                </p>
              </button>
            );
          })}
        </div>

        {(selectedPlan === 'DISTRICT_2000' || billingState?.planCode === 'DISTRICT_2000') && (
          <div
            data-testid="billing-district-rollup-note"
            className="rounded-xl ap-status-info px-3.5 py-2.5 text-xs flex items-start gap-2"
          >
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Multi-School District Rollup Active:</strong> Covers every high school and middle school program across your district under one District AD &amp; SafeSport compliance dashboard, countersigned California SDPC NDPA, and single Net-30 PO.
            </span>
          </div>
        )}

        {/* Net-30 School PO Form */}
        <form
          onSubmit={(e) => void handleIssuePo(e)}
          className="rounded-2xl ap-card p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-ap-clay dark:text-ap-volt" />
              <h3 className="text-sm font-bold">Instant Net-30 School / ASB PO Invoice</h3>
            </div>
            <span className="font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
              {activePlanSpec.priceLabel} · Net-30
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label
                htmlFor={`${formId}-school`}
                className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
              >
                School or District Name
              </label>
              <input
                id={`${formId}-school`}
                data-testid="billing-school-name-input"
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Willow Glen High School"
                className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-carbon px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-email`}
                className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
              >
                AD / Business Office Email
              </label>
              <input
                id={`${formId}-email`}
                data-testid="billing-contact-email-input"
                type="email"
                required
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="athletics-ap@school.edu"
                className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-carbon px-3 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-po`}
                className="block text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark mb-1"
              >
                ASB / District PO # (Optional)
              </label>
              <input
                id={`${formId}-po`}
                data-testid="billing-po-number-input"
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="PO-2026-4410"
                className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge bg-white dark:bg-ap-carbon px-3 text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              data-testid="billing-stripe-checkout-btn"
              disabled={isStartingStripe}
              onClick={() => void handleStripeCheckout()}
              className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>
                {isStartingStripe
                  ? 'Opening Checkout…'
                  : `Pay ${activePlanSpec.priceLabel} via Card / P-Card`}
              </span>
            </button>

            <button
              type="submit"
              data-testid="billing-issue-po-btn"
              disabled={isSubmittingPo}
              className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              <span>
                {isSubmittingPo ? 'Issuing Invoice…' : 'Generate Net-30 PO Invoice'}
              </span>
            </button>
          </div>
        </form>

        {/* Issued Invoices List */}
        {invoices.length > 0 && (
          <section
            data-testid="billing-invoices-list"
            className="rounded-2xl ap-card-inset p-3.5 space-y-2"
          >
            <div className="text-xs font-bold">Issued School PO Invoices ({invoices.length})</div>
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv.invoiceNumber}
                  className="rounded-xl bg-white dark:bg-ap-carbon border border-ap-frame/20 dark:border-ap-edge px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-mono font-bold flex flex-wrap items-center gap-2">
                      <span>{inv.invoiceNumber}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-2xs ${
                          inv.status === 'PAID' ? 'ap-status-prime' : 'ap-status-info'
                        }`}
                      >
                        {inv.status}
                      </span>
                      <span>${inv.amountUsd} USD</span>
                    </div>
                    <div className="text-2xs text-ap-muted dark:text-ap-muted-dark truncate">
                      {inv.schoolOrDistrictName} · Due {inv.dueDate}
                      {inv.poNumber ? ` · PO ${inv.poNumber}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      openPrintableSchoolPoInvoiceWindow({
                        invoice: inv,
                        teamName: activeTeam.brand.name,
                      })
                    }
                    className="min-h-[38px] px-3 rounded-lg ap-btn-secondary text-2xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Print Invoice &amp; W-9</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Procurement Links Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-2xs text-ap-muted dark:text-ap-muted-dark">
          <div className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-ap-cobalt dark:text-ap-volt shrink-0" />
            <span>Includes IRS W-9, CA SDPC NDPA &amp; HECVAT Lite documentation.</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-semibold">
            <a
              href="/procurement"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="billing-open-w9-ndpa-link"
              className="inline-flex items-center gap-1 text-ap-cobalt dark:text-ap-volt hover:underline"
            >
              <span>Open W-9 &amp; NDPA Pack ↗</span>
            </a>
            <a
              href="/for-athletic-directors"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ap-cobalt dark:text-ap-volt hover:underline"
            >
              <span>For Athletic Directors</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamBillingAndPoModal;
