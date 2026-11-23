import type {
  DistrictOverviewReport,
  DistrictSchoolRollupItem,
  SchoolPoInvoiceRecord,
  TeamBillingPlanCode,
  TeamBillingStatus,
} from '../src/types.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import { evaluateSafeSportPatternWatch } from '../src/physiology/safeSportPatternWatchEngine.ts';
import { summarizeNcaaCaraWeeklyHours } from '../src/physiology/scholasticEngine.ts';
import { TEAM_BILLING_PLANS } from './teamBillingService.ts';
import {
  canManageTeamGovernanceRole,
  loadTeamDocRaw,
  userTeamsVaultKey,
  type StoredTeamDocument,
  type UserTeamsIndex,
} from './teamStoreCore.ts';
import { loadTenantVaultAsync } from './tokenVault.ts';

const STAFF_ROLES = new Set(['HEAD_COACH', 'ASSISTANT_COACH', 'ATHLETIC_TRAINER', 'ORG_ADMIN']);

function sanitizeInvoiceForDistrictOverview(
  invoice?: SchoolPoInvoiceRecord
): SchoolPoInvoiceRecord | undefined {
  if (!invoice) return undefined;
  return {
    invoiceNumber: invoice.invoiceNumber,
    planCode: invoice.planCode,
    amountUsd: invoice.amountUsd,
    schoolOrDistrictName: invoice.schoolOrDistrictName,
    ...(invoice.poNumber ? { poNumber: invoice.poNumber } : {}),
    billingContactEmail: '',
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    status: invoice.status,
    ...(invoice.paidAt ? { paidAt: invoice.paidAt } : {}),
  };
}

function isRenewalAlertDue(
  billingStatus: TeamBillingStatus,
  billingCycleEndIso: string | undefined,
  todayIso: string
): boolean {
  if (billingStatus === 'RENEWAL_DUE' || billingStatus === 'PAST_DUE') return true;
  if (!billingCycleEndIso) return false;
  const endMs = Date.parse(`${billingCycleEndIso.slice(0, 10)}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(endMs) || !Number.isFinite(todayMs)) return false;
  return (endMs - todayMs) / 86_400_000 <= 30;
}

function committedPlanAmountUsd(planCode: TeamBillingPlanCode, status: TeamBillingStatus): number {
  if (planCode === 'FREE_FOUNDING') return 0;
  if (status === 'ACTIVE_PAID' || status === 'PO_ISSUED' || status === 'RENEWAL_DUE' || status === 'PAST_DUE') {
    return TEAM_BILLING_PLANS[planCode]?.amountUsd ?? 0;
  }
  return 0;
}

/**
 * Pure Multi-School District AD rollup builder across stored team documents.
 * Strictly strips `privateClinicalNotes`, athlete PII/emails, and Stripe identifiers.
 */
export function buildDistrictOverviewFromDocs(
  docs: StoredTeamDocument[],
  callerSid: string,
  opts?: { districtName?: string; todayIso?: string }
): DistrictOverviewReport {
  const todayIso = (opts?.todayIso || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const nowRef = new Date(`${todayIso}T12:00:00Z`);
  const cleanDistrictFilter = opts?.districtName?.trim() || undefined;
  const normalizedFilter = cleanDistrictFilter?.toLowerCase();

  const governedDocs = (docs || []).filter((doc) => {
    const callerMem = (doc.memberships || []).find(
      (m) =>
        m.userSid === callerSid &&
        m.status !== 'REVOKED' &&
        m.status !== 'ALUMNI' &&
        canManageTeamGovernanceRole(m.role)
    );
    return Boolean(callerMem);
  });

  const districtNameSet = new Set<string>();
  for (const doc of governedDocs) {
    const dName = doc.brand.districtName?.trim();
    if (dName) districtNameSet.add(dName);
  }
  const availableDistrictNames = Array.from(districtNameSet).sort((a, b) => a.localeCompare(b));
  const hasDistrictPlan = governedDocs.some((d) => d.billing?.planCode === 'DISTRICT_2000');

  const filteredDocs = normalizedFilter
    ? governedDocs.filter(
        (d) => (d.brand.districtName || '').trim().toLowerCase() === normalizedFilter
      )
    : governedDocs;

  let totalCaraHoursSumAll = 0;
  let totalCaraTrackedAll = 0;

  const schools: DistrictSchoolRollupItem[] = filteredDocs.map((doc) => {
    const callerMem = doc.memberships.find(
      (m) =>
        m.userSid === callerSid &&
        m.status !== 'REVOKED' &&
        m.status !== 'ALUMNI' &&
        canManageTeamGovernanceRole(m.role)
    )!;

    const liveMembers = (doc.memberships || []).filter(
      (m) => m.status !== 'REVOKED' && m.status !== 'ALUMNI'
    );
    const athletes = liveMembers.filter((m) => m.role === 'ATHLETE');
    const coachesAndStaff = liveMembers.filter((m) => STAFF_ROLES.has(m.role));

    const activeAthletes = athletes.filter((m) => m.status === 'ACTIVE').length;
    const watchConnectedAthletes = athletes.filter((m) =>
      Boolean(m.liveSnapshot?.hasConnectedWatch)
    ).length;

    const activeAtInjuries = (doc.injuryCases || []).filter(
      (c) => c.rtpStage !== 'CLEARED'
    ).length;

    const todayAttendance = doc.attendanceByDate?.[todayIso] || {};
    const modifiedAttendanceToday = Object.values(todayAttendance).filter(
      (rec) => rec.status === 'INJURED_MODIFIED'
    ).length;

    let safeSportRedFlags = 0;
    let safeSportAmberFlags = 0;
    let minorAthleteCount = 0;
    let parentConsentAcknowledgedCount = 0;
    let caraTrackedAthletes = 0;
    let sumCaraHours = 0;
    let maxCaraHours = 0;
    let caraOverCapCount = 0;
    let caraWarningCount = 0;

    for (const ath of athletes) {
      const ageResolved = resolveAthleteAgeTier({
        birthMonthYear: ath.birthMonthYear,
        birthYear: ath.birthYear,
        orgType: doc.brand.orgType,
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
      const trafficLight =
        cachedLight ??
        ((ath.liveSnapshot?.activities?.length || 0) > 0
          ? evaluateSafeSportPatternWatch({
              activities: ath.liveSnapshot?.activities || [],
              wellnessDays: ath.liveSnapshot?.wellnessDays || [],
              isMinorU18: isMinor,
              referenceDateIso: todayIso,
            }).trafficLight
          : 'GREEN_CLEAR');

      if (trafficLight === 'RED_MEDICAL_REVIEW') safeSportRedFlags += 1;
      else if (trafficLight === 'AMBER_WATCH') safeSportAmberFlags += 1;

      const actCount = ath.liveSnapshot?.activities?.length || 0;
      let athCaraHours: number | undefined;
      if (actCount > 0) {
        athCaraHours = summarizeNcaaCaraWeeklyHours(
          ath.liveSnapshot?.activities || [],
          todayIso
        ).rolling7dCountableHours;
      } else if (typeof ath.liveSnapshot?.caraHours7d === 'number') {
        athCaraHours = ath.liveSnapshot.caraHours7d;
      }

      if (typeof athCaraHours === 'number' && Number.isFinite(athCaraHours)) {
        caraTrackedAthletes += 1;
        sumCaraHours += athCaraHours;
        totalCaraHoursSumAll += athCaraHours;
        totalCaraTrackedAll += 1;
        if (athCaraHours > maxCaraHours) maxCaraHours = athCaraHours;
        if (athCaraHours > 20) caraOverCapCount += 1;
        else if (athCaraHours >= 17) caraWarningCount += 1;
      }
    }

    const guardianCcCompliancePct =
      minorAthleteCount === 0
        ? 100
        : Math.round((parentConsentAcknowledgedCount / minorAthleteCount) * 100);

    const billingPlanCode: TeamBillingPlanCode = doc.billing?.planCode || 'FREE_FOUNDING';
    const billingStatus: TeamBillingStatus = doc.billing?.status || 'PILOT';
    const billingCycleEndIso = doc.billing?.billingCycleEndIso;
    const renewalAlert = isRenewalAlertDue(billingStatus, billingCycleEndIso, todayIso);

    return {
      teamId: doc.brand.teamId,
      teamName: doc.brand.name,
      shortName: doc.brand.shortName,
      orgType: doc.brand.orgType,
      ...(doc.brand.districtName ? { districtName: doc.brand.districtName } : {}),
      myRole: callerMem.role,
      totalAthletes: athletes.length,
      activeAthletes,
      totalCoachesAndStaff: coachesAndStaff.length,
      watchConnectedAthletes,
      activeAtInjuries,
      modifiedAttendanceToday,
      safeSportRedFlags,
      safeSportAmberFlags,
      safeSportShieldEnabled: Boolean(doc.brand.defaultSafeSportShield),
      guardianCcEnabled: Boolean(doc.brand.enableParentGuardianCc),
      minorAthleteCount,
      parentConsentAcknowledgedCount,
      guardianCcCompliancePct,
      caraTrackedAthletes,
      avgCaraHours7d:
        caraTrackedAthletes > 0 ? Number((sumCaraHours / caraTrackedAthletes).toFixed(1)) : 0,
      maxCaraHours7d: caraTrackedAthletes > 0 ? Number(maxCaraHours.toFixed(1)) : 0,
      caraOverCapCount,
      caraWarningCount,
      billingPlanCode,
      billingStatus,
      ...(doc.billing?.schoolOrDistrictName
        ? { billingSchoolOrDistrictName: doc.billing.schoolOrDistrictName }
        : {}),
      ...(doc.billing?.poNumber ? { poNumber: doc.billing.poNumber } : {}),
      ...(billingCycleEndIso ? { billingCycleEndIso } : {}),
      renewalAlert,
      ...(doc.billing?.poInvoices?.[0]
        ? { latestInvoice: sanitizeInvoiceForDistrictOverview(doc.billing.poInvoices[0]) }
        : {}),
    };
  });

  const totalsAccumulator = schools.reduce(
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
      acc.totalAnnualCommittedUsd += committedPlanAmountUsd(s.billingPlanCode, s.billingStatus);
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

  const overallGuardianCcCompliancePct =
    totalsAccumulator.minorAthleteCount === 0
      ? 100
      : Math.round(
          (totalsAccumulator.parentConsentAcknowledgedCount / totalsAccumulator.minorAthleteCount) *
            100
        );

  return {
    generatedAt: new Date().toISOString(),
    ...(cleanDistrictFilter ? { districtFilter: cleanDistrictFilter } : {}),
    availableDistrictNames,
    hasDistrictPlan,
    totals: {
      schoolCount: schools.length,
      ...totalsAccumulator,
      overallGuardianCcCompliancePct,
      avgCaraHours7d:
        totalCaraTrackedAll > 0
          ? Number((totalCaraHoursSumAll / totalCaraTrackedAll).toFixed(1))
          : 0,
    },
    schools,
  };
}

export async function getDistrictAdOverview(params: {
  callerSid: string;
  districtName?: string;
}): Promise<DistrictOverviewReport> {
  const userIdx = await loadTenantVaultAsync<UserTeamsIndex>(
    userTeamsVaultKey(params.callerSid),
    {
      teamIds: [],
      updatedAt: '',
    }
  );
  const docs: StoredTeamDocument[] = [];
  for (const teamId of userIdx.teamIds) {
    const doc = await loadTeamDocRaw(teamId);
    if (doc) docs.push(doc);
  }
  return buildDistrictOverviewFromDocs(docs, params.callerSid, {
    districtName: params.districtName,
  });
}
