import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine.ts';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine.ts';
import { summarizeNcaaCaraWeeklyHours } from '../physiology/scholasticEngine.ts';
import type {
  DistrictOverviewReport,
  DistrictSchoolRollupItem,
  TeamBillingPlanCode,
  TeamBillingStatus,
  TeamSummaryWithRole,
} from '../types.ts';
import { buildThreshSessionHeaders, TeamLifecycleApiError } from './teamLifecycleApi.ts';

const STAFF_ROLES = new Set(['HEAD_COACH', 'ASSISTANT_COACH', 'ATHLETIC_TRAINER', 'ORG_ADMIN']);

const PLAN_AMOUNT_USD: Record<TeamBillingPlanCode, number> = {
  FREE_FOUNDING: 0,
  HS_250: 250,
  COLLEGIATE_1200: 1200,
  DISTRICT_2000: 2000,
};

export function formatOrgTypeLabel(orgType: string): string {
  switch (orgType) {
    case 'HIGH_SCHOOL':
      return 'High School';
    case 'COLLEGIATE':
      return 'Collegiate';
    case 'RUNNING_CLUB':
      return 'Track & XC Club';
    case 'CYCLING_CLUB':
      return 'Cycling Club';
    case 'COACH_SQUAD':
      return 'Coaching Group';
    default:
      return String(orgType || '').replace(/_/g, ' ');
  }
}

export function formatBillingPlanLabel(planCode: TeamBillingPlanCode | string): string {
  switch (planCode) {
    case 'FREE_FOUNDING':
      return 'Founding Pilot ($0)';
    case 'HS_250':
      return 'High School ($250/yr)';
    case 'COLLEGIATE_1200':
      return 'Collegiate ($1,200/yr)';
    case 'DISTRICT_2000':
      return 'District Tier ($2,000/yr)';
    default:
      return String(planCode || '').replace(/_/g, ' ');
  }
}

export function formatBillingStatusLabel(status: TeamBillingStatus | string): string {
  switch (status) {
    case 'PILOT':
      return 'Founding Pilot';
    case 'PO_ISSUED':
      return 'Net-30 PO Issued';
    case 'ACTIVE_PAID':
      return 'Active Paid';
    case 'RENEWAL_DUE':
      return 'Renewal Due';
    case 'PAST_DUE':
      return 'Past Due';
    default:
      return String(status || '').replace(/_/g, ' ');
  }
}

export async function fetchDistrictOverviewApi(districtName?: string): Promise<{
  ok: boolean;
  report: DistrictOverviewReport;
}> {
  const qs = districtName?.trim()
    ? `?districtName=${encodeURIComponent(districtName.trim())}`
    : '';
  const resp = await fetch(`/api/teams/district-overview${qs}`, {
    method: 'GET',
    credentials: 'include',
    headers: buildThreshSessionHeaders(),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    report?: DistrictOverviewReport;
    error?: string;
  };
  if (!resp.ok || data.ok === false || !data.report) {
    throw new TeamLifecycleApiError(
      data.error || 'Failed to load district AD overview.',
      resp.status
    );
  }
  return { ok: true, report: data.report };
}

export function buildClientDistrictOverviewFromTeams(
  teams: TeamSummaryWithRole[],
  opts?: { districtName?: string; todayIso?: string }
): DistrictOverviewReport {
  const todayIso = (opts?.todayIso || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const nowRef = new Date(`${todayIso}T12:00:00Z`);
  const cleanDistrictFilter = opts?.districtName?.trim() || undefined;
  const normalizedFilter = cleanDistrictFilter?.toLowerCase();

  const governedTeams = (teams || []).filter(
    (t) => t.myRole === 'HEAD_COACH' || t.myRole === 'ORG_ADMIN'
  );

  const districtNameSet = new Set<string>();
  for (const t of governedTeams) {
    const dName = t.brand.districtName?.trim();
    if (dName) districtNameSet.add(dName);
  }
  const availableDistrictNames = Array.from(districtNameSet).sort((a, b) => a.localeCompare(b));
  const hasDistrictPlan = governedTeams.some((t) => t.billing?.planCode === 'DISTRICT_2000');

  const filteredTeams = normalizedFilter
    ? governedTeams.filter(
        (t) => (t.brand.districtName || '').trim().toLowerCase() === normalizedFilter
      )
    : governedTeams;

  let totalCaraSumAll = 0;
  let totalCaraTrackedAll = 0;

  const schools: DistrictSchoolRollupItem[] = filteredTeams.map((team) => {
    const liveMembers = (team.memberships || []).filter(
      (m) => m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    const athletes = liveMembers.filter((m) => m.role === 'ATHLETE');
    const coachesAndStaff = liveMembers.filter((m) => STAFF_ROLES.has(m.role));
    const activeAthletes = athletes.filter((m) => m.status === 'ACTIVE').length;
    const watchConnectedAthletes = athletes.filter((m) =>
      Boolean(m.liveSnapshot?.hasConnectedWatch)
    ).length;

    const activeAtInjuries = (team.injuryCases || []).filter(
      (c) => c.rtpStage !== 'CLEARED'
    ).length;

    const todayAttendance = team.attendanceByDate?.[todayIso] || {};
    const modifiedAttendanceToday = Object.values(todayAttendance).filter(
      (rec) => rec.status === 'INJURED_MODIFIED'
    ).length;

    let safeSportRedFlags = 0;
    let safeSportAmberFlags = 0;
    let minorAthleteCount = 0;
    let parentConsentAcknowledgedCount = 0;
    let caraTrackedAthletes = 0;
    let sumCara = 0;
    let maxCara = 0;
    let caraOverCapCount = 0;
    let caraWarningCount = 0;

    for (const ath of athletes) {
      const ageResolved = resolveAthleteAgeTier({
        birthMonthYear: ath.birthMonthYear,
        birthYear: ath.birthYear,
        orgType: team.brand.orgType,
        graduationYear: ath.graduationYear,
        now: nowRef,
      });
      const isMinor =
        ageResolved.ageTier === 'UNKNOWN' ? Boolean(ath.isMinorU18) : ageResolved.isMinorU18;
      if (isMinor) {
        minorAthleteCount += 1;
        if (ath.parentConsentStatus === 'ACKNOWLEDGED') {
          parentConsentAcknowledgedCount += 1;
        }
      }

      const cachedLight = ath.liveSnapshot?.safeSportWatch?.trafficLight;
      const light =
        cachedLight ??
        ((ath.liveSnapshot?.activities?.length || 0) > 0
          ? evaluateSafeSportPatternWatch({
              activities: ath.liveSnapshot?.activities || [],
              wellnessDays: ath.liveSnapshot?.wellnessDays || [],
              isMinorU18: isMinor,
              referenceDateIso: todayIso,
            }).trafficLight
          : 'GREEN_CLEAR');

      if (light === 'RED_MEDICAL_REVIEW') safeSportRedFlags += 1;
      else if (light === 'AMBER_WATCH') safeSportAmberFlags += 1;

      const actCount = ath.liveSnapshot?.activities?.length || 0;
      let hours: number | undefined;
      if (actCount > 0) {
        hours = summarizeNcaaCaraWeeklyHours(
          ath.liveSnapshot?.activities || [],
          todayIso
        ).rolling7dCountableHours;
      } else if (typeof ath.liveSnapshot?.caraHours7d === 'number') {
        hours = ath.liveSnapshot.caraHours7d;
      }
      if (typeof hours === 'number' && Number.isFinite(hours)) {
        caraTrackedAthletes += 1;
        sumCara += hours;
        totalCaraSumAll += hours;
        totalCaraTrackedAll += 1;
        if (hours > maxCara) maxCara = hours;
        if (hours > 20) caraOverCapCount += 1;
        else if (hours >= 17) caraWarningCount += 1;
      }
    }

    const billingPlanCode: TeamBillingPlanCode = team.billing?.planCode || 'FREE_FOUNDING';
    const billingStatus: TeamBillingStatus = team.billing?.status || 'PILOT';
    const endIso = team.billing?.billingCycleEndIso;
    const endMs = endIso ? Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`) : NaN;
    const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
    const renewalAlert = Boolean(
      billingStatus === 'RENEWAL_DUE' ||
        billingStatus === 'PAST_DUE' ||
        (Number.isFinite(endMs) && Number.isFinite(todayMs) && (endMs - todayMs) / 86_400_000 <= 30)
    );

    return {
      teamId: team.brand.teamId,
      teamName: team.brand.name,
      shortName: team.brand.shortName,
      orgType: team.brand.orgType,
      ...(team.brand.districtName ? { districtName: team.brand.districtName } : {}),
      myRole: team.myRole,
      totalAthletes: athletes.length,
      activeAthletes,
      totalCoachesAndStaff: coachesAndStaff.length,
      watchConnectedAthletes,
      activeAtInjuries,
      modifiedAttendanceToday,
      safeSportRedFlags,
      safeSportAmberFlags,
      safeSportShieldEnabled: Boolean(team.brand.defaultSafeSportShield),
      guardianCcEnabled: Boolean(team.brand.enableParentGuardianCc),
      minorAthleteCount,
      parentConsentAcknowledgedCount,
      guardianCcCompliancePct:
        minorAthleteCount === 0
          ? 100
          : Math.round((parentConsentAcknowledgedCount / minorAthleteCount) * 100),
      caraTrackedAthletes,
      avgCaraHours7d:
        caraTrackedAthletes > 0 ? Number((sumCara / caraTrackedAthletes).toFixed(1)) : 0,
      maxCaraHours7d: caraTrackedAthletes > 0 ? Number(maxCara.toFixed(1)) : 0,
      caraOverCapCount,
      caraWarningCount,
      billingPlanCode,
      billingStatus,
      ...(team.billing?.schoolOrDistrictName
        ? { billingSchoolOrDistrictName: team.billing.schoolOrDistrictName }
        : {}),
      ...(team.billing?.poNumber ? { poNumber: team.billing.poNumber } : {}),
      ...(endIso ? { billingCycleEndIso: endIso } : {}),
      renewalAlert,
    };
  });

  const seenDistrictCommitKeys = new Set<string>();
  const totalsAcc = schools.reduce(
    (acc, s) => {
      acc.totalAthletes += s.totalAthletes;
      acc.activeAthletes += s.activeAthletes;
      acc.totalCoachesAndStaff += s.totalCoachesAndStaff;
      acc.activeAtInjuries += s.activeAtInjuries;
      acc.modifiedAttendanceToday += s.modifiedAttendanceToday;
      acc.safeSportRedFlags += s.safeSportRedFlags;
      acc.safeSportAmberFlags += s.safeSportAmberFlags;
      acc.minorAthleteCount += s.minorAthleteCount;
      acc.parentConsentAcknowledgedCount += s.parentConsentAcknowledgedCount;
      acc.caraOverCapCount += s.caraOverCapCount;
      acc.caraWarningCount += s.caraWarningCount;
      if (s.renewalAlert) acc.schoolsNeedingRenewal += 1;
      if (
        s.billingPlanCode !== 'FREE_FOUNDING' &&
        (s.billingStatus === 'ACTIVE_PAID' ||
          s.billingStatus === 'PO_ISSUED' ||
          s.billingStatus === 'RENEWAL_DUE' ||
          s.billingStatus === 'PAST_DUE')
      ) {
        if (s.billingPlanCode === 'DISTRICT_2000') {
          const districtKey = (
            s.districtName?.trim() ||
            s.billingSchoolOrDistrictName?.trim() ||
            s.teamId
          ).toLowerCase();
          if (!seenDistrictCommitKeys.has(districtKey)) {
            seenDistrictCommitKeys.add(districtKey);
            acc.totalAnnualCommittedUsd += PLAN_AMOUNT_USD.DISTRICT_2000;
          }
        } else {
          acc.totalAnnualCommittedUsd += PLAN_AMOUNT_USD[s.billingPlanCode] || 0;
        }
      }
      return acc;
    },
    {
      totalAthletes: 0,
      activeAthletes: 0,
      totalCoachesAndStaff: 0,
      activeAtInjuries: 0,
      modifiedAttendanceToday: 0,
      safeSportRedFlags: 0,
      safeSportAmberFlags: 0,
      minorAthleteCount: 0,
      parentConsentAcknowledgedCount: 0,
      caraOverCapCount: 0,
      caraWarningCount: 0,
      schoolsNeedingRenewal: 0,
      totalAnnualCommittedUsd: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    ...(cleanDistrictFilter ? { districtFilter: cleanDistrictFilter } : {}),
    availableDistrictNames,
    hasDistrictPlan,
    totals: {
      schoolCount: schools.length,
      ...totalsAcc,
      overallGuardianCcCompliancePct:
        totalsAcc.minorAthleteCount === 0
          ? 100
          : Math.round(
              (totalsAcc.parentConsentAcknowledgedCount / totalsAcc.minorAthleteCount) * 100
            ),
      avgCaraHours7d:
        totalCaraTrackedAll > 0
          ? Number((totalCaraSumAll / totalCaraTrackedAll).toFixed(1))
          : 0,
    },
    schools,
  };
}

function escapeHtmlSafe(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDistrictAdExecutiveSummaryHtml(report: DistrictOverviewReport): string {
  const titleLabel = report.districtFilter
    ? `${report.districtFilter} — District AD Executive Summary`
    : 'MeetReady Multi-School District AD Executive Summary';

  const schoolRowsHtml = report.schools
    .map(
      (s) => `<tr>
        <td><strong>${escapeHtmlSafe(s.teamName)}</strong><br/><span class="muted">${escapeHtmlSafe(s.shortName)} · ${escapeHtmlSafe(formatOrgTypeLabel(s.orgType))}${s.districtName ? ` · ${escapeHtmlSafe(s.districtName)}` : ''}</span></td>
        <td class="num">${s.activeAthletes} / ${s.totalAthletes}<br/><span class="muted">${s.totalCoachesAndStaff} staff</span></td>
        <td class="num">${s.activeAtInjuries} AT · ${s.modifiedAttendanceToday} Mod</td>
        <td class="num">${s.safeSportRedFlags} Red / ${s.safeSportAmberFlags} Amber<br/><span class="muted">${s.guardianCcCompliancePct}% consent</span></td>
        <td class="num">${s.avgCaraHours7d}h avg (max ${s.maxCaraHours7d}h)</td>
        <td>${escapeHtmlSafe(formatBillingPlanLabel(s.billingPlanCode))}<br/><span class="muted">${escapeHtmlSafe(formatBillingStatusLabel(s.billingStatus))}${s.poNumber ? ` · PO ${escapeHtmlSafe(s.poNumber)}` : ''}</span></td>
      </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtmlSafe(titleLabel)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #121413; background: #F6F3EC; margin: 0; padding: 28px; }
  .sheet { max-width: 960px; margin: 0 auto; background: #FFFFFF; border: 1px solid #CFC9BC; border-radius: 16px; padding: 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #B83A24; padding-bottom: 14px; margin-bottom: 18px; }
  .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #B83A24; }
  h1 { margin: 4px 0 0; font-size: 22px; }
  .meta { text-align: right; font-family: ui-monospace, monospace; font-size: 11px; color: #57544D; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi { background: #FAF8F4; border: 1px solid #CFC9BC; border-radius: 10px; padding: 10px 12px; }
  .kpi-val { font-size: 18px; font-weight: 800; font-family: ui-monospace, monospace; }
  .kpi-lbl { font-size: 10px; text-transform: uppercase; color: #57544D; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #EDE9DF; vertical-align: top; }
  th { font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; color: #57544D; }
  .num { font-family: ui-monospace, monospace; }
  .muted { font-size: 10px; color: #57544D; }
  .footer { margin-top: 18px; font-size: 11px; color: #57544D; border-top: 1px solid #EDE9DF; padding-top: 10px; }
  @media print { body { background: #FFFFFF; padding: 0; } .sheet { border: none; padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="kicker">MeetReady · District Athletic Director Executive Summary</div>
        <h1>${escapeHtmlSafe(titleLabel)}</h1>
      </div>
      <div class="meta">
        <div><strong>Generated:</strong> ${escapeHtmlSafe(report.generatedAt.slice(0, 10))}</div>
        <div><strong>District Tier ($2,000/yr):</strong> ${report.hasDistrictPlan ? 'Active' : 'Standard Programs'}</div>
        <div><strong>Annual Committed:</strong> $${report.totals.totalAnnualCommittedUsd.toLocaleString('en-US')} USD</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="kpi-lbl">Schools / Programs</div><div class="kpi-val">${report.totals.schoolCount}</div></div>
      <div class="kpi"><div class="kpi-lbl">Active Athletes</div><div class="kpi-val">${report.totals.activeAthletes} / ${report.totals.totalAthletes}</div></div>
      <div class="kpi"><div class="kpi-lbl">Guardian Consent</div><div class="kpi-val">${report.totals.overallGuardianCcCompliancePct}%</div></div>
      <div class="kpi"><div class="kpi-lbl">AT Injuries / SafeSport</div><div class="kpi-val">${report.totals.activeAtInjuries} AT · ${report.totals.safeSportRedFlags}R / ${report.totals.safeSportAmberFlags}A</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>School / Program</th>
          <th>Athletes &amp; Staff</th>
          <th>Injuries &amp; Modified</th>
          <th>SafeSport &amp; Consent</th>
          <th>CARA 7d Load</th>
          <th>Billing / PO</th>
        </tr>
      </thead>
      <tbody>
        ${schoolRowsHtml || '<tr><td colspan="6">No schools match this district filter.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      Zero athlete PII, clinical AT notes, or personal contact records are included in this aggregate executive summary.
    </div>
  </div>
</body>
</html>`;
}

export function openPrintableDistrictAdSummaryWindow(report: DistrictOverviewReport): boolean {
  if (typeof window === 'undefined') return false;
  const popup = window.open('', '_blank', 'width=960,height=740');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(buildDistrictAdExecutiveSummaryHtml(report));
  popup.document.close();
  try {
    popup.opener = null;
  } catch {
    // ignore read-only opener implementations
  }
  try {
    popup.focus();
    popup.print();
  } catch {
    // ignore focus/print errors in headless contexts
  }
  return true;
}
