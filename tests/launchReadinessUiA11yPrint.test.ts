import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSchoolPoInvoicePrintHtml,
  openPrintableSchoolPoInvoiceWindow,
} from '../src/utils/schoolPoInvoiceHelper.ts';
import {
  buildPrintablePodClipboardHtml,
  openPrintablePodClipboardWindow,
  openPrintableTeamPosterWindow,
} from '../src/utils/teamQrHelper.ts';
import {
  buildClientDistrictOverviewFromTeams,
  buildDistrictAdExecutiveSummaryHtml,
  formatBillingPlanLabel,
  formatBillingStatusLabel,
  formatOrgTypeLabel,
  openPrintableDistrictAdSummaryWindow,
} from '../src/utils/districtAdOverviewHelper.ts';
import { DistrictAdOverviewModal } from '../src/components/coach/DistrictAdOverviewModal.tsx';
import { TeamBillingAndPoModal } from '../src/components/coach/TeamBillingAndPoModal.tsx';
import { CoachingStaffPanel } from '../src/components/coach/CoachingStaffPanel.tsx';
import { CoachOnboardingWizard } from '../src/components/coach/CoachOnboardingWizard.tsx';
import { TeamRosterAndAuditSection } from '../src/components/team/TeamRosterAndAuditSection.tsx';
import { CoppaExplainerModal } from '../src/components/auth/CoppaExplainerModal.tsx';
import type {
  SchoolPoInvoiceRecord,
  TeamBrandConfig,
  TeamSummaryWithRole,
} from '../src/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

function makeBrand(overrides: Partial<TeamBrandConfig> = {}): TeamBrandConfig {
  return {
    teamId: 'team_wghs_xc',
    slug: 'wghs-xc',
    joinCode: 'WGHS-26',
    name: 'Willow Glen HS Cross Country',
    shortName: 'WGHS XC',
    orgType: 'HIGH_SCHOOL',
    primarySport: 'Running',
    primaryHex: '#0F766E',
    secondaryHex: '#D97706',
    defaultSafeSportShield: true,
    enableParentGuardianCc: true,
    coachDisplayName: 'Coach Elliott',
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function makeTeamSummary(overrides: Partial<TeamSummaryWithRole> = {}): TeamSummaryWithRole {
  const brand = overrides.brand ?? makeBrand();
  return {
    brand,
    myRole: 'HEAD_COACH',
    mySquadGroup: 'Varsity',
    myMembershipId: 'mem_coach_1',
    totalInvited: 2,
    openedCount: 2,
    activeCount: 2,
    watchConnectedCount: 1,
    memberships: [
      {
        membershipId: 'mem_coach_1',
        teamId: brand.teamId,
        role: 'HEAD_COACH',
        squadGroup: 'Staff',
        invitedName: 'Coach Elliott',
        isMinorU18: false,
        status: 'ACTIVE',
        invitedAt: '2026-09-01T00:00:00Z',
      },
      {
        membershipId: 'mem_ath_1',
        teamId: brand.teamId,
        role: 'ATHLETE',
        squadGroup: 'Varsity',
        eventGroup: 'DISTANCE',
        invitedName: 'Maya Lin',
        invitedEmail: 'maya@example.org',
        parentGuardianEmail: 'parent@example.org',
        isMinorU18: true,
        parentConsentStatus: 'ACKNOWLEDGED',
        status: 'ACTIVE',
        invitedAt: '2026-09-02T00:00:00Z',
      },
    ],
    broadcastWorkouts: [],
    billing: {
      planCode: 'HS_250',
      status: 'PO_ISSUED',
      billingContactEmail: 'ap@sjusd.edu',
      schoolOrDistrictName: 'San Jose Unified School District',
      poInvoices: [],
    },
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<SchoolPoInvoiceRecord> = {}): SchoolPoInvoiceRecord {
  return {
    invoiceNumber: 'INV-2026-0042',
    planCode: 'HS_250',
    amountUsd: 250,
    schoolOrDistrictName: 'San Jose Unified School District',
    poNumber: 'PO-99182',
    billingContactEmail: 'ap@sjusd.edu',
    issuedAt: '2026-11-01T00:00:00Z',
    dueDate: '2026-12-01T00:00:00Z',
    status: 'ISSUED',
    ...overrides,
  };
}

function setupMockPopupBrowser(popupShouldOpen: boolean) {
  const createdBlobs: Array<{ parts: BlobPart[]; options?: BlobPropertyBag }> = [];
  const clickedAnchors: Array<{ href: string; download: string; clicked: boolean; removed: boolean }> = [];
  const docWriteSpy = vi.fn();
  const docOpenSpy = vi.fn();
  const docCloseSpy = vi.fn();
  const focusSpy = vi.fn();

  const mockPopup: {
    document: { open: () => void; write: (html: string) => void; close: () => void };
    opener: unknown;
    focus: () => void;
    print: () => void;
  } = {
    document: {
      open: docOpenSpy,
      write: docWriteSpy,
      close: docCloseSpy,
    },
    opener: { secret: 'parent-window-ref' },
    focus: focusSpy,
    print: vi.fn(),
  };

  const windowOpenSpy = vi.fn(
    (_url?: string, _target?: string, _features?: string) => (popupShouldOpen ? mockPopup : null)
  );

  class MockBlob {
    parts: BlobPart[];
    options?: BlobPropertyBag;
    type: string;
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      this.parts = parts;
      this.options = options;
      this.type = options?.type ?? '';
      createdBlobs.push({ parts, options });
    }
  }

  const createObjectUrlSpy = vi.fn(() => 'blob:mock-download-123');
  const revokeObjectUrlSpy = vi.fn();

  const mockDocument = {
    body: {
      appendChild: vi.fn(),
    },
    createElement: vi.fn((tag: string) => {
      if (tag === 'a') {
        const record = { href: '', download: '', clicked: false, removed: false };
        clickedAnchors.push(record);
        return {
          set href(v: string) {
            record.href = v;
          },
          get href() {
            return record.href;
          },
          set download(v: string) {
            record.download = v;
          },
          get download() {
            return record.download;
          },
          style: { display: '' },
          click: () => {
            record.clicked = true;
          },
          remove: () => {
            record.removed = true;
          },
        };
      }
      return {};
    }),
  };

  vi.stubGlobal('window', { open: windowOpenSpy });
  vi.stubGlobal('document', mockDocument);
  vi.stubGlobal('Blob', MockBlob);
  vi.stubGlobal('URL', {
    createObjectURL: createObjectUrlSpy,
    revokeObjectURL: revokeObjectUrlSpy,
  });

  return {
    windowOpenSpy,
    mockPopup,
    docOpenSpy,
    docWriteSpy,
    docCloseSpy,
    focusSpy,
    createdBlobs,
    clickedAnchors,
    createObjectUrlSpy,
    revokeObjectUrlSpy,
  };
}

describe('Launch Readiness · UI/UX, Accessibility, Print & Static Pages Remediation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('1. Print helpers open without noopener/noreferrer, write HTML, close document, null opener, and fall back to Blob download when blocked', () => {
    const invoice = makeInvoice();
    const brand = makeBrand();
    const podParams = {
      workoutTitle: '8 x 1000m Threshold',
      dateStr: '2026-11-24',
      repDistanceMeters: 1000,
      repCount: 8,
      recoveryLabel: '90s jog',
      pods: [
        {
          podId: 'A',
          podName: 'Pod A · Varsity Boys',
          minVdot: 60,
          maxVdot: 64,
          centerVdot: 62,
          athletes: [
            { id: 'a1', name: 'Alex', vdot: 62, thresholdPaceSecsPerKm: 195 },
            { id: 'a2', name: 'Ben', vdot: 61, thresholdPaceSecsPerKm: 198 },
          ],
          intensity: 'THRESHOLD_CV' as const,
          targetPaceSecsPerKm: 195,
          targetRepSplitSecs: 195,
          pursuitStaggerOffsetSecs: 0,
          splitsSecs: {
            split200m: 39,
            split400m: 78,
            split800m: 156,
            split1000m: 195,
            split1600m: 312,
          },
          workoutPrescriptionLine: '8 x 1000m @ 3:15/km',
          workoutSyntax: '8x1000m @ T (90s jog)',
        },
      ],
      teamName: 'Willow Glen HS XC',
    };

    // Case A: Popups allowed across all print windows
    {
      const env = setupMockPopupBrowser(true);
      expect(openPrintableSchoolPoInvoiceWindow({ invoice, teamName: brand.name })).toBe(true);
      expect(env.windowOpenSpy).toHaveBeenLastCalledWith('', '_blank', 'width=820,height=900');
      expect(env.mockPopup.opener).toBeNull();
      expect(env.docOpenSpy).toHaveBeenCalled();
      expect(env.docWriteSpy).toHaveBeenCalled();
      expect(env.docCloseSpy).toHaveBeenCalled();

      env.mockPopup.opener = { ref: 'reset' };
      expect(openPrintableTeamPosterWindow(brand, 'https://meetready.app/join/wghs-xc')).toBe(true);
      expect(env.windowOpenSpy).toHaveBeenLastCalledWith('', '_blank', 'width=840,height=920');
      expect(env.mockPopup.opener).toBeNull();

      env.mockPopup.opener = { ref: 'reset' };
      expect(openPrintablePodClipboardWindow(podParams)).toBe(true);
      expect(env.windowOpenSpy).toHaveBeenLastCalledWith('', '_blank', 'width=1060,height=780');
      expect(env.mockPopup.opener).toBeNull();

      const report = buildClientDistrictOverviewFromTeams([makeTeamSummary()]);
      env.mockPopup.opener = { ref: 'reset' };
      expect(openPrintableDistrictAdSummaryWindow(report)).toBe(true);
      expect(env.mockPopup.opener).toBeNull();

      for (const call of env.windowOpenSpy.mock.calls) {
        const features = String(call[2] ?? '').toLowerCase();
        expect(features).not.toContain('noopener');
        expect(features).not.toContain('noreferrer');
      }
    }

    // Case B: Popups blocked (window.open returns null) -> HTML Blob download fallback & return false
    {
      const env = setupMockPopupBrowser(false);
      expect(openPrintableSchoolPoInvoiceWindow({ invoice, teamName: brand.name })).toBe(false);
      expect(openPrintableTeamPosterWindow(brand, 'https://meetready.app/join/wghs-xc')).toBe(false);
      expect(openPrintablePodClipboardWindow(podParams)).toBe(false);

      expect(env.createdBlobs).toHaveLength(3);
      for (const blob of env.createdBlobs) {
        expect(blob.options?.type).toBe('text/html;charset=utf-8');
        expect(String(blob.parts[0]).toLowerCase()).toContain('<!doctype html>');
      }
      expect(env.clickedAnchors).toHaveLength(3);
      expect(env.clickedAnchors.every((a) => a.clicked && a.removed && a.download.endsWith('.html'))).toBe(true);
    }

    // Pod clipboard HTML still contains expected structure
    const podHtml = buildPrintablePodClipboardHtml(podParams);
    expect(podHtml).toContain('Pod A');
    expect(podHtml).toContain('@page { size: landscape;');
  });

  it('2. Vendor & remittance clarity + escapeHtmlSafe null/XSS guards in invoice helper and procurement.html', () => {
    const xssInvoice = {
      ...makeInvoice({
        schoolOrDistrictName: '<script>alert("xss")</script>Oak Unified',
        poNumber: undefined,
      }),
      billingContactEmail: undefined as unknown as string,
    };
    const html = buildSchoolPoInvoicePrintHtml({
      invoice: xssInvoice,
      teamName: 'Test <Team>',
    });

    expect(html).toContain('MeetReady Athletics LLC');
    expect(html).toContain('Vendor &amp; Remittance Instructions');
    expect(html).toContain('AP Desk:');
    expect(html).toContain('procurement@meetready.app');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Oak Unified');
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).not.toContain('Remit ASB check or District PO payment to procurement@meetready.app');
    expect(html).not.toContain('checks payable to AeroPulse');

    const procurementHtml = fs.readFileSync(
      path.join(ROOT, 'public/legal/procurement.html'),
      'utf8'
    );
    expect(procurementHtml).toContain('Vendor &amp; Remittance Instructions');
    expect(procurementHtml).toContain('MeetReady Athletics LLC');
    expect(procurementHtml).toContain('procurement@meetready.app');
    expect(procurementHtml).not.toContain('Remit ASB check or District PO payment to procurement@meetready.app');
  });

  it('3. District AD overview formats raw enums into human labels, deduplicates $2,000 district commitment, and includes Issue $2,000 District PO action', () => {
    expect(formatOrgTypeLabel('HIGH_SCHOOL')).toBe('High School');
    expect(formatOrgTypeLabel('COLLEGIATE')).toBe('Collegiate');
    expect(formatBillingPlanLabel('FREE_FOUNDING')).toBe('Founding Pilot ($0)');
    expect(formatBillingPlanLabel('HS_250')).toBe('High School ($250/yr)');
    expect(formatBillingPlanLabel('COLLEGIATE_1200')).toBe('Collegiate ($1,200/yr)');
    expect(formatBillingPlanLabel('DISTRICT_2000')).toBe('District Tier ($2,000/yr)');
    expect(formatBillingStatusLabel('PO_ISSUED')).toBe('Net-30 PO Issued');
    expect(formatBillingStatusLabel('ACTIVE_PAID')).toBe('Active Paid');
    expect(formatBillingStatusLabel('RENEWAL_DUE')).toBe('Renewal Due');

    const pausdSchool1 = makeTeamSummary({
      brand: makeBrand({ teamId: 't1', name: 'Palo Alto HS', districtName: 'PAUSD', orgType: 'HIGH_SCHOOL' }),
      billing: {
        planCode: 'DISTRICT_2000',
        status: 'ACTIVE_PAID',
        billingContactEmail: 'ap@pausd.org',
        schoolOrDistrictName: 'PAUSD',
        poInvoices: [],
      },
    });
    const pausdSchool2 = makeTeamSummary({
      brand: makeBrand({ teamId: 't2', name: 'Gunn HS', districtName: 'PAUSD', orgType: 'HIGH_SCHOOL' }),
      billing: {
        planCode: 'DISTRICT_2000',
        status: 'PO_ISSUED',
        billingContactEmail: 'ap@pausd.org',
        schoolOrDistrictName: 'PAUSD',
        poInvoices: [],
      },
    });
    const sameDistrictReport = buildClientDistrictOverviewFromTeams([pausdSchool1, pausdSchool2]);
    expect(sameDistrictReport.totals.totalAnnualCommittedUsd).toBe(2000);

    const fuhsdSchool = makeTeamSummary({
      brand: makeBrand({ teamId: 't3', name: 'Homestead HS', districtName: 'FUHSD', orgType: 'HIGH_SCHOOL' }),
      billing: {
        planCode: 'DISTRICT_2000',
        status: 'ACTIVE_PAID',
        billingContactEmail: 'ap@fuhsd.org',
        schoolOrDistrictName: 'FUHSD',
        poInvoices: [],
      },
    });
    const multiDistrictReport = buildClientDistrictOverviewFromTeams([pausdSchool1, pausdSchool2, fuhsdSchool]);
    expect(multiDistrictReport.totals.totalAnnualCommittedUsd).toBe(4000);

    const execHtml = buildDistrictAdExecutiveSummaryHtml(
      buildClientDistrictOverviewFromTeams([
        makeTeamSummary({
          brand: makeBrand({ orgType: 'HIGH_SCHOOL' }),
          billing: {
            planCode: 'HS_250',
            status: 'PO_ISSUED',
            billingContactEmail: 'ap@sjusd.edu',
            schoolOrDistrictName: 'SJUSD',
            poInvoices: [],
          },
        }),
      ])
    );
    expect(execHtml).toContain('High School');
    expect(execHtml).toContain('High School ($250/yr)');
    expect(execHtml).toContain('Net-30 PO Issued');
    expect(execHtml).not.toContain('>HS_250<');
    expect(execHtml).not.toContain('>PO_ISSUED<');

    const modalHtml = renderToStaticMarkup(
      React.createElement(DistrictAdOverviewModal, {
        isOpen: true,
        onClose: () => {},
        myTeams: [makeTeamSummary()],
        activeTeamId: 'team_wghs_xc',
        isSampleDemoMode: true,
        onSelectActiveTeam: () => {},
        onOpenDistrictBilling: () => {},
      })
    );
    expect(modalHtml).toContain('Issue $2,000 District PO');
    expect(modalHtml).toContain('data-testid="district-issue-po-btn"');
    expect(modalHtml).toContain('High School');
    expect(modalHtml).toContain('High School ($250/yr)');
    expect(modalHtml).toContain('Net-30 PO Issued');
    expect(modalHtml).toContain('min-w-[680px]');
  });

  it('4. Zero unstyled ap-btn-volt across components and clean ap-btn-primary CTAs in staff & messaging', () => {
    const componentsDir = path.join(ROOT, 'src/components');
    const tsxFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) tsxFiles.push(full);
      }
    };
    walk(componentsDir);

    for (const file of tsxFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, `${path.relative(ROOT, file)} must not contain ap-btn-volt`).not.toContain('ap-btn-volt');
    }

    const staffHtml = renderToStaticMarkup(
      React.createElement(CoachingStaffPanel, {
        activeTeam: makeTeamSummary(),
        myTeams: [makeTeamSummary()],
        isSampleDemoMode: true,
        onTeamsUpdated: () => {},
      })
    );
    expect(staffHtml).toContain('ap-btn-primary');
    expect(staffHtml).not.toContain('ap-btn-volt');
  });

  it('5. Static legal pages, legal.css contrast/mobile/print rules, and copy alignment', () => {
    const legalCss = fs.readFileSync(path.join(ROOT, 'public/legal/legal.css'), 'utf8');
    expect(legalCss).toMatch(/\.legal-shell a:not\(\.legal-btn\)[\s\S]*var\(--accent-link\)/);
    expect(legalCss).toMatch(/\.legal-shell a:not\(\.legal-btn\):visited/);
    expect(legalCss).toContain('text-decoration: underline');
    expect(legalCss).toMatch(/@media \(max-width: 640px\)[\s\S]*\.legal-header[\s\S]*position:\s*static/);
    expect(legalCss).toMatch(/@media \(max-width: 640px\)[\s\S]*\.legal-nav[\s\S]*overflow-x:\s*auto/);
    expect(legalCss).toContain('@media print');
    expect(legalCss).toContain('#procurementPrintBtn');
    expect(legalCss).toContain('#adPrintBtn');

    const procurementHtml = fs.readFileSync(path.join(ROOT, 'public/legal/procurement.html'), 'utf8');
    expect(procurementHtml).not.toContain('onclick="window.print()"');
    expect(procurementHtml).toContain('id="procurementPrintBtn"');
    expect(procurementHtml).toContain("addEventListener('click'");
    expect(procurementHtml).toContain('meetready_funnel_dedupe_v1:landing_view');

    const adHtml = fs.readFileSync(path.join(ROOT, 'public/for-athletic-directors.html'), 'utf8');
    expect(adHtml).toContain('meetready_funnel_dedupe_v1:landing_view');

    const productMd = fs.readFileSync(path.join(ROOT, 'PRODUCT.md'), 'utf8');
    expect(productMd).not.toContain('$49/mo');

    const termsHtml = fs.readFileSync(path.join(ROOT, 'public/legal/terms.html'), 'utf8');
    expect(termsHtml).toContain('COROS');
    expect(termsHtml).toContain('Suunto');

    const subprocessorsHtml = fs.readFileSync(path.join(ROOT, 'public/legal/subprocessors.html'), 'utf8');
    expect(subprocessorsHtml).toMatch(/Polar[\s\S]{0,400}read-only/i);

    const privacyHtml = fs.readFileSync(path.join(ROOT, 'public/legal/privacy.html'), 'utf8');
    expect(privacyHtml).toContain('Account, Teams &amp; Privacy');
    expect(privacyHtml).toMatch(/authenticated minor/i);
  });

  it('6. Header overlap fix, mobile coach controls, StravaAuthGate minor privacy/add-ons, and modals hardening', () => {
    const headerSrc = fs.readFileSync(path.join(ROOT, 'src/components/CockpitHeader.tsx'), 'utf8');
    expect(headerSrc).toContain('shrink-0');
    expect(headerSrc).toContain('md:hidden');
    expect(headerSrc).not.toContain('py-0.2');

    const coachViewSrc = fs.readFileSync(path.join(ROOT, 'src/components/CoachWorkspaceView.tsx'), 'utf8');
    expect(coachViewSrc).toContain('h-[44px] sm:h-[36px]');
    expect(coachViewSrc).toContain('isSampleDemoMode={isSampleDemoMode}');
    expect(coachViewSrc).toContain("startsWith('demo_team_')");
    expect(coachViewSrc).toContain("startsWith('demo-team-')");

    const authGateSrc = fs.readFileSync(path.join(ROOT, 'src/components/StravaAuthGate.tsx'), 'utf8');
    // Ensure /api/auth/me block no longer fires auth_complete before age gate
    const authMeBlock = authGateSrc.slice(
      authGateSrc.indexOf("fetch('/api/auth/me'"),
      authGateSrc.indexOf('catch {')
    );
    expect(authMeBlock).not.toContain("emitFunnelEvent('auth_complete'");
    expect(authGateSrc).toContain('if (isMinorAthlete && !activeBrand)');
    expect(authGateSrc).toMatch(
      /status\.wahooConnected\s*\|\|\s*status\.polarConnected\s*\|\|\s*status\.corosConnected/
    );

    const addonsSrc = fs.readFileSync(path.join(ROOT, 'src/components/auth/AuthOptionalAddonsStep.tsx'), 'utf8');
    expect(addonsSrc).toContain('liquid-glass');
    expect(addonsSrc).toContain('<h2');
    expect(addonsSrc).toContain('ap-btn-secondary');

    const coppaHtml = renderToStaticMarkup(
      React.createElement(CoppaExplainerModal, { isOpen: true, onClose: () => {} })
    );
    expect(coppaHtml).toContain('aria-labelledby');
    expect(coppaHtml).toContain('max-h-[92dvh] overflow-y-auto');
    const coppaSrc = fs.readFileSync(path.join(ROOT, 'src/components/auth/CoppaExplainerModal.tsx'), 'utf8');
    expect(coppaSrc).toContain('useModalDialog');

    const messagingSrc = fs.readFileSync(path.join(ROOT, 'src/components/coach/TeamMessagingDrawer.tsx'), 'utf8');
    expect(messagingSrc).toContain('useModalDialog');
    expect(messagingSrc).toContain('aria-labelledby');
    expect(messagingSrc).toContain('max-h-[92dvh]');
  });

  it('7. Billing modal, Onboarding wizard, DataSources modal, and Roster CSV & touch target polish', () => {
    const billingHtml = renderToStaticMarkup(
      React.createElement(TeamBillingAndPoModal, {
        isOpen: true,
        onClose: () => {},
        activeTeam: makeTeamSummary({
          billing: {
            planCode: 'HS_250',
            status: 'PO_ISSUED',
            billingContactEmail: 'ap@sjusd.edu',
            schoolOrDistrictName: 'SJUSD',
            poInvoices: [makeInvoice()],
          },
        }),
        myTeams: [makeTeamSummary()],
        isSampleDemoMode: true,
        initialPlanCode: 'DISTRICT_2000',
        onTeamsUpdated: () => {},
      })
    );
    expect(billingHtml).toContain('Print Net-30 Invoice &amp; Vendor Sheet');
    expect(billingHtml).toContain('Net-30 PO Issued');

    const wizardHtml = renderToStaticMarkup(
      React.createElement(CoachOnboardingWizard, {
        isOpen: true,
        myTeams: [],
        selfName: 'Coach Elliott',
        isSampleDemoMode: true,
        onClose: () => {},
        onSetComplexityTier: () => {},
        onTeamCreated: () => {},
      })
    );
    expect(wizardHtml).toContain('data-testid="wizard-district-name-input"');
    expect(wizardHtml).toContain('aria-pressed="');

    const dataSourcesSrc = fs.readFileSync(path.join(ROOT, 'src/components/DataSourcesModal.tsx'), 'utf8');
    expect(dataSourcesSrc).toMatch(
      /wahooScopeTokens\.includes\('workouts_write'\)\s*&&\s*wahooScopeTokens\.includes\('plans_write'\)/
    );
    expect(dataSourcesSrc).toContain('text-rose-700 dark:text-rose-300');
    expect(dataSourcesSrc).toContain('aria-pressed={active}');

    const rosterHtml = renderToStaticMarkup(
      React.createElement(TeamRosterAndAuditSection, {
        activeTeam: makeTeamSummary(),
        myTeams: [makeTeamSummary()],
        activeJoinUrl: 'https://meetready.app/join/wghs-xc',
        originUrl: 'https://meetready.app',
        resendConfigured: false,
        isSampleDemoMode: true,
        isActiveTeamCoach: true,
        canManageGovernance: true,
        isDemoTeam: true,
        isSendingBulk: false,
        setIsSendingBulk: () => {},
        copiedId: null,
        onCopyText: () => {},
        onTeamsUpdated: () => {},
        onBannerMessage: () => {},
      })
    );
    expect(rosterHtml).toContain('data-testid="roster-export-csv-btn"');
    expect(rosterHtml).toContain('Export Roster CSV');
    expect(rosterHtml).toContain('min-w-[680px]');
    expect(rosterHtml).not.toContain('py-0.2');
    expect(rosterHtml).not.toContain('<option value="INVITED"');
  });
});
