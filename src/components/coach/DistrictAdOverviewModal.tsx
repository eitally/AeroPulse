import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  ShieldCheck,
  X,
} from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';
import {
  buildClientDistrictOverviewFromTeams,
  fetchDistrictOverviewApi,
  formatBillingPlanLabel,
  formatBillingStatusLabel,
  formatOrgTypeLabel,
  openPrintableDistrictAdSummaryWindow,
} from '../../utils/districtAdOverviewHelper';
import type { DistrictOverviewReport, TeamSummaryWithRole } from '../../types';

export interface DistrictAdOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  isSampleDemoMode?: boolean;
  onSelectActiveTeam: (teamId: string) => void;
  onOpenDistrictBilling?: () => void;
}

export const DistrictAdOverviewModal: React.FC<DistrictAdOverviewModalProps> = ({
  isOpen,
  onClose,
  myTeams,
  activeTeamId,
  isSampleDemoMode = false,
  onSelectActiveTeam,
  onOpenDistrictBilling,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();
  useModalDialog({ isOpen, onClose, dialogRef });

  const [districtFilter, setDistrictFilter] = useState<string>('');
  const [serverReport, setServerReport] = useState<DistrictOverviewReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  const clientFallbackReport = useMemo(
    () =>
      buildClientDistrictOverviewFromTeams(myTeams, {
        districtName: districtFilter || undefined,
      }),
    [myTeams, districtFilter]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (isSampleDemoMode) {
      setServerReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchDistrictOverviewApi(districtFilter || undefined)
      .then((res) => {
        if (!cancelled && res.report) {
          setServerReport(res.report);
        }
      })
      .catch(() => {
        if (!cancelled) setServerReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, districtFilter, isSampleDemoMode]);

  if (!isOpen) return null;

  const report = serverReport || clientFallbackReport;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      data-testid="district-ad-overview-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-edge p-4 sm:p-5 space-y-4 shadow-2xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ap-frame/15 dark:border-ap-edge-dark pb-3">
          <div>
            <div className="text-2xs font-mono uppercase tracking-wider text-ap-clay dark:text-ap-volt font-bold">
              Multi-School District AD Overview · $2,000/yr District Tier
            </div>
            <h2
              id={headingId}
              className="text-lg sm:text-xl font-extrabold text-ap-ink dark:text-ap-chalk"
            >
              District Athletics Compliance &amp; Safety Rollup
            </h2>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Aggregate compliance across {report.totals.schoolCount} governed school
              {report.totals.schoolCount === 1 ? '' : 's'} (zero athlete PII or clinical AT notes).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {report.availableDistrictNames.length > 0 && (
              <select
                data-testid="district-filter-select"
                aria-label="Filter by district"
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
              >
                <option value="">All Districts</option>
                {report.availableDistrictNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              data-testid="district-print-summary-btn"
              onClick={() => {
                const opened = openPrintableDistrictAdSummaryWindow(report);
                setPrintNotice(
                  opened
                    ? null
                    : 'Pop-up window blocked by browser — downloaded the District AD Executive Summary as an offline .html file instead. Open the downloaded file to print or save as PDF.'
                );
              }}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Print District AD Executive Summary</span>
            </button>

            <button
              type="button"
              aria-label="Close district overview"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {printNotice && (
          <div
            role="status"
            data-testid="district-print-notice"
            className="rounded-xl ap-status-caution px-3.5 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{printNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setPrintNotice(null)}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-white/80 dark:bg-ap-carbon text-2xs font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Schools
            </div>
            <div className="text-lg font-extrabold font-mono text-ap-ink dark:text-ap-chalk tabular-nums">
              {report.totals.schoolCount}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Active Athletes
            </div>
            <div className="text-lg font-extrabold font-mono text-ap-ink dark:text-ap-chalk tabular-nums">
              {report.totals.activeAthletes}/{report.totals.totalAthletes}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              AT Injuries / Mod
            </div>
            <div className="text-lg font-extrabold font-mono text-ap-clay dark:text-ap-volt tabular-nums">
              {report.totals.activeAtInjuries} / {report.totals.modifiedAttendanceToday}
            </div>
          </div>
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              SafeSport Flags
            </div>
            <div className="text-lg font-extrabold font-mono text-ap-ink dark:text-ap-chalk tabular-nums">
              {report.totals.safeSportRedFlags}R · {report.totals.safeSportAmberFlags}A
            </div>
          </div>
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Guardian CC
            </div>
            <div className="text-lg font-extrabold font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
              {report.totals.overallGuardianCcCompliancePct}%
            </div>
          </div>
          <div className="rounded-xl ap-card-inset p-3">
            <div className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark">
              Annual Committed
            </div>
            <div className="text-lg font-extrabold font-mono text-ap-ink dark:text-ap-chalk tabular-nums">
              ${report.totals.totalAnnualCommittedUsd.toLocaleString('en-US')}
            </div>
          </div>
        </div>

        {!report.hasDistrictPlan && (
          <div className="rounded-xl ap-status-info px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                District Multi-School Tier ($2,000/yr) unlocks unified district-wide ASB/PO billing,
                CA SDPC NDPA coverage, and multi-campus compliance reporting.
              </span>
            </div>
            <button
              type="button"
              data-testid="district-issue-po-btn"
              onClick={() => {
                onClose();
                if (onOpenDistrictBilling) {
                  onOpenDistrictBilling();
                } else {
                  const targetTeamId = activeTeamId || report.schools[0]?.teamId;
                  if (targetTeamId) {
                    onSelectActiveTeam(targetTeamId);
                  }
                }
              }}
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3.5 py-1.5 text-xs font-bold shrink-0 cursor-pointer"
            >
              Issue $2,000 District PO
            </button>
          </div>
        )}

        {loading && (
          <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
            Refreshing live district compliance metrics…
          </div>
        )}

        {/* School Table */}
        <div className="overflow-x-auto rounded-xl border border-ap-frame/15 dark:border-ap-edge-dark">
          <table className="w-full min-w-[680px] text-left border-collapse text-xs">
            <thead>
              <tr className="bg-ap-inset/60 dark:bg-ap-carbon border-b border-ap-frame/15 dark:border-ap-edge-dark font-mono text-2xs uppercase text-ap-muted dark:text-ap-muted-dark">
                <th className="py-2.5 px-3">School / Program</th>
                <th className="py-2.5 px-3">Roster</th>
                <th className="py-2.5 px-3">AT &amp; Attendance</th>
                <th className="py-2.5 px-3">SafeSport &amp; Consent</th>
                <th className="py-2.5 px-3">CARA 7d</th>
                <th className="py-2.5 px-3">Plan / Renewal</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ap-frame/10 dark:divide-ap-edge-dark">
              {report.schools.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 px-4 text-center text-ap-muted dark:text-ap-muted-dark">
                    No governed school programs match this filter yet.
                  </td>
                </tr>
              ) : (
                report.schools.map((school) => {
                  const isCurrent = school.teamId === activeTeamId;
                  return (
                    <tr
                      key={school.teamId}
                      data-testid={`district-school-row-${school.teamId}`}
                      className="bg-white/70 dark:bg-ap-obsidian/60"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-ap-ink dark:text-ap-chalk">
                          {school.teamName}
                        </div>
                        <div className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                          {school.shortName} · {formatOrgTypeLabel(school.orgType)}
                          {school.districtName ? ` · ${school.districtName}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        <div>
                          {school.activeAthletes}/{school.totalAthletes} ath
                        </div>
                        <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                          {school.totalCoachesAndStaff} staff
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        <div>{school.activeAtInjuries} AT active</div>
                        <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                          {school.modifiedAttendanceToday} mod today
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        <div className="inline-flex items-center gap-1">
                          {school.safeSportRedFlags > 0 ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          )}
                          <span>
                            {school.safeSportRedFlags}R / {school.safeSportAmberFlags}A
                          </span>
                        </div>
                        <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                          {school.guardianCcCompliancePct}% consent
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        <div>{school.avgCaraHours7d}h avg</div>
                        <div className="text-2xs text-ap-muted dark:text-ap-muted-dark">
                          max {school.maxCaraHours7d}h · {school.caraOverCapCount} over
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <div className="font-bold">{formatBillingPlanLabel(school.billingPlanCode)}</div>
                        <div
                          className={`text-2xs ${
                            school.renewalAlert
                              ? 'text-amber-600 dark:text-amber-300 font-bold'
                              : 'text-ap-muted dark:text-ap-muted-dark'
                          }`}
                        >
                          {formatBillingStatusLabel(school.billingStatus)}
                          {school.renewalAlert ? ' · Renewal Alert' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          data-testid={`district-switch-school-${school.teamId}`}
                          onClick={() => {
                            onSelectActiveTeam(school.teamId);
                            onClose();
                          }}
                          className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-2xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                            isCurrent
                              ? 'ap-status-prime'
                              : 'ap-btn-secondary'
                          }`}
                        >
                          <span>{isCurrent ? 'Active School' : 'Switch School'}</span>
                          {!isCurrent && <ArrowRight className="w-3 h-3" />}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
