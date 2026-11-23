import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseWorkspaceHash } from '../src/App';
import { StravaAuthGate } from '../src/components/StravaAuthGate';
import { AuthByoStravaKeysSection } from '../src/components/auth/AuthByoStravaKeysSection';
import { CoppaExplainerModal } from '../src/components/auth/CoppaExplainerModal';
import { TeamManagementPanel } from '../src/components/TeamManagementPanel';
import { TeamBrandingStudioForm } from '../src/components/team/TeamBrandingStudioForm';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData';
import { computeAccessibleTeamPalette } from '../src/physiology/teamOnboardingEngine';
import type { ConnectionStatus, TeamBrandConfig } from '../src/types';

const ROOT = process.cwd();

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function lineCount(relPath: string): number {
  return readRel(relPath).split('\n').length;
}

const BASE_STATUS: ConnectionStatus = {
  mode: 'SANDBOX_CALIBRATION',
  stravaConnected: false,
  stravaSource: 'NONE',
  garminConnected: false,
  intervalsConnected: false,
  intervalsAthleteId: '0',
  intervalsSource: 'NONE',
  hasGeminiServerKey: true,
  devCallbackUrl: 'https://meetready.app/api/strava/callback',
  sharedCallbackUrl: 'https://meetready.app/api/strava/callback',
  currentOriginCallbackUrl: 'https://meetready.app/api/strava/callback',
};

describe('Sprint 3C Architecture Decomposition: Team, Auth & App Hook Modularity', () => {
  it('keeps decomposed monoliths well below line ceilings and uses eager static imports', () => {
    expect(lineCount('src/components/TeamManagementPanel.tsx')).toBeLessThanOrEqual(1400);
    expect(lineCount('src/components/StravaAuthGate.tsx')).toBeLessThanOrEqual(1450);
    expect(lineCount('src/App.tsx')).toBeLessThanOrEqual(2100);

    const teamPanelSrc = readRel('src/components/TeamManagementPanel.tsx');
    expect(teamPanelSrc).toContain("from './team/TeamBrandingStudioForm'");
    expect(teamPanelSrc).toContain("from './team/TeamBulkRosterImporter'");
    expect(teamPanelSrc).toContain("from './team/TeamRosterAndAuditSection'");
    expect(teamPanelSrc).not.toMatch(/lazyWithRetry\([^)]*TeamBrandingStudioForm/);
    expect(teamPanelSrc).not.toMatch(/lazyWithRetry\([^)]*TeamBulkRosterImporter/);
    expect(teamPanelSrc).not.toMatch(/lazyWithRetry\([^)]*TeamRosterAndAuditSection/);
    expect(teamPanelSrc).toContain('<WorkspaceErrorBoundary');
    expect(teamPanelSrc).toContain('School PO & Billing');
    expect(teamPanelSrc).toContain('districtName');

    for (const rel of [
      'src/components/TeamManagementPanel.tsx',
      'src/components/team/TeamBrandingStudioForm.tsx',
      'src/components/team/TeamBulkRosterImporter.tsx',
      'src/components/team/TeamRosterAndAuditSection.tsx',
    ]) {
      const src = readRel(rel);
      expect(src).not.toContain('free SMS');
      expect(src).not.toContain('Free SMS');
      expect(src).not.toContain('($0)');
    }

    const authGateSrc = readRel('src/components/StravaAuthGate.tsx');
    expect(authGateSrc).toContain("from './auth/AuthLandingStepOne'");
    expect(authGateSrc).toContain("from './auth/CoppaExplainerModal'");
    expect(authGateSrc).toContain('export interface FirstRunCalibrationPayload');
    expect(authGateSrc).toContain('export interface StravaOAuthJoinContext');

    const landingSrc = readRel('src/components/auth/AuthLandingStepOne.tsx');
    expect(landingSrc).toContain("from './AuthByoStravaKeysSection'");

    const appSrc = readRel('src/App.tsx');
    expect(appSrc).toContain("from './hooks/useSampleDemoWorkspace'");
    expect(appSrc).toContain("from './hooks/useStopwatchSyncBridge'");
    expect(appSrc).toContain("from './hooks/useAthleteProfileAndGoals'");
  });

  it('synchronously renders extracted TeamManagementPanel views and districtName input in TeamBrandingStudioForm', () => {
    const demo = buildSampleDemoDataset('2026-11-19');

    const teamDashboardHtml = renderToStaticMarkup(
      React.createElement(TeamManagementPanel, {
        selfName: 'Coach Morales',
        myTeams: demo.demoTeams,
        activeTeamId: demo.demoTeams[0]?.brand.teamId || null,
        resendConfigured: false,
        isSampleDemoMode: true,
        onSelectActiveTeam: () => {},
        onTeamsUpdated: () => {},
        onOpenPublicTeamHub: () => {},
      })
    );
    expect(teamDashboardHtml).toContain('Willow Glen High School XC');
    expect(teamDashboardHtml).toContain('data-testid="panel-open-public-hub-btn"');
    expect(teamDashboardHtml).toContain('data-testid="panel-open-billing-btn"');
    expect(teamDashboardHtml).toContain('data-testid="team-audit-log-btn"');
    expect(teamDashboardHtml).toContain('Invite or Import Athletes');

    const previewBrand: TeamBrandConfig = {
      teamId: 'preview',
      slug: 'preview',
      joinCode: 'TEAM-26',
      name: 'Willow Glen High School XC',
      shortName: 'WGHS XC',
      districtName: 'San Jose Unified School District',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      primaryHex: '#B83A24',
      secondaryHex: '#D8FF2A',
      defaultSafeSportShield: true,
      enableParentGuardianCc: true,
      coachDisplayName: 'Coach Morales',
      createdAt: '',
    };
    const palette = computeAccessibleTeamPalette('#B83A24', '#D8FF2A');

    const studioExpandedHtml = renderToStaticMarkup(
      React.createElement(TeamBrandingStudioForm, {
        formId: 'studio-test',
        studioMode: 'CREATE',
        orgType: 'HIGH_SCHOOL',
        onOrgTypeChange: () => {},
        teamName: 'Willow Glen High School XC',
        setTeamName: () => {},
        shortName: 'WGHS XC',
        setShortName: () => {},
        derivedShortName: 'WGHSXC',
        districtName: 'San Jose Unified School District',
        setDistrictName: () => {},
        coachDisplayName: 'Coach Morales',
        setCoachDisplayName: () => {},
        primaryHex: '#B83A24',
        setPrimaryHex: () => {},
        secondaryHex: '#D8FF2A',
        setSecondaryHex: () => {},
        logoDataUrl: '',
        setLogoDataUrl: () => {},
        defaultSafeSportShield: true,
        setDefaultSafeSportShield: () => {},
        enableParentGuardianCc: true,
        setEnableParentGuardianCc: () => {},
        showAdvancedBranding: true,
        setShowAdvancedBranding: () => {},
        isSavingStudio: false,
        previewBrand,
        livePalette: palette,
        lightRatio: '5.5',
        darkRatio: '4.6',
        onSubmit: () => {},
        onCancel: () => {},
        onErrorMessage: () => {},
      })
    );
    expect(studioExpandedHtml).toContain('District Name (Optional — Multi-School AD Rollup)');
    expect(studioExpandedHtml).toContain('data-testid="team-district-name-input"');
    expect(studioExpandedHtml).toContain('maxLength="80"');
    expect(studioExpandedHtml).toContain('San Jose Unified School District');
  });

  it('synchronously renders extracted StravaAuthGate Step 1, BYO keys section, and CoppaExplainerModal', () => {
    const authGateHtml = renderToStaticMarkup(
      React.createElement(StravaAuthGate, {
        status: BASE_STATUS,
        onLaunchStravaOAuth: async () => {},
        isSyncing: false,
        errorMessage: null,
        onEnterSampleDemo: () => {},
      })
    );
    expect(authGateHtml).toContain('data-testid="homepage-auth-card"');
    expect(authGateHtml).toContain('data-testid="continue-with-email-btn"');
    expect(authGateHtml).toContain('data-testid="splash-sample-card"');
    expect(authGateHtml).toContain('data-testid="splash-benefits-matrix"');
    expect(authGateHtml).toContain('data-testid="coppa-explainer-trigger"');

    const byoHtml = renderToStaticMarkup(
      React.createElement(AuthByoStravaKeysSection, {
        showCustomStravaKeys: true,
        setShowCustomStravaKeys: () => {},
        currentHostname: 'meetready.app',
        stravaClientId: '12345',
        setStravaClientId: () => {},
        stravaClientSecret: '',
        setStravaClientSecret: () => {},
        busy: false,
        setIsExchanging: () => {},
        onClearStepNotice: () => {},
        onSaveKeysAndLaunchStrava: async () => {},
        onExchangeStravaCode: async () => {},
      })
    );
    expect(byoHtml).toContain('Authorization Callback Domain');
    expect(byoHtml).toContain('meetready.app');
    expect(byoHtml).toContain('Save Keys');

    const coppaClosedHtml = renderToStaticMarkup(
      React.createElement(CoppaExplainerModal, { isOpen: false, onClose: () => {} })
    );
    expect(coppaClosedHtml).toBe('');

    const coppaOpenHtml = renderToStaticMarkup(
      React.createElement(CoppaExplainerModal, { isOpen: true, onClose: () => {} })
    );
    expect(coppaOpenHtml).toContain('data-testid="coppa-explainer-modal"');
    expect(coppaOpenHtml).toContain('data-testid="coppa-explainer-close"');
    expect(coppaOpenHtml).toContain('COPPA 13+');
  });

  it('hardens parseWorkspaceHash against Stripe return query suffixes like #coach?billing=success', () => {
    expect(parseWorkspaceHash('#coach?billing=success')).toEqual({ tab: 'coach' });
    expect(parseWorkspaceHash('/#coach?billing=success')).toEqual({ tab: 'coach' });
    expect(parseWorkspaceHash('#coach?billing=cancelled')).toEqual({ tab: 'coach' });
    expect(parseWorkspaceHash('#coach/roster?billing=success')).toEqual({
      tab: 'coach',
      coachSubTab: 'ROSTER',
    });
    expect(parseWorkspaceHash('#coach/plan?source=stripe')).toEqual({
      tab: 'coach',
      coachSubTab: 'TEAM_PLAN',
    });
    expect(parseWorkspaceHash('#plan-builder?utm_source=print')).toEqual({ tab: 'totals' });
    expect(parseWorkspaceHash('#today?demo=1')).toEqual({ tab: 'fitness' });
    expect(parseWorkspaceHash('')).toEqual({});
  });
});
