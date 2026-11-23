import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData';
import { READINESS_PILL_SPECS, TYPOGRAPHY_HIERARCHY } from '../src/data/brandStyleGuideData';
import { buildPrintablePodClipboardHtml } from '../src/utils/teamQrHelper';
import {
  computeAccessibleTeamPalette,
  contrastRatio,
  normalizeHexColor,
} from '../src/utils/teamPalette';
import { computeTeamVdotPacingPods } from '../src/physiology/scholasticEngine';

const ROOT = process.cwd();

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('Track C Sprint 0 UI, Brand & Mobile Polish Guards', () => {
  it('eliminates all legacy green/lime hover-flash button classes across src/components', () => {
    const files = collectFiles(path.join(ROOT, 'src/components'));
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (src.includes('hover:bg-[#16422A]') || src.includes('dark:hover:bg-[#B5EB00]')) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps 390px stopwatch runner targets untruncated on a mobile sub-row and exposes Cards/Matrix + Tools while ticking', () => {
    const cardsSrc = readRel('src/components/stopwatch/TracksideRunnerCardsAndMatrix.tsx');
    expect(cardsSrc).toContain('min-h-[92px]');
    expect(cardsSrc).toContain('sm:hidden text-2xs font-mono text-ap-muted dark:text-ap-muted-dark leading-tight');

    const swSrc = readRel('src/components/TracksideStopwatchView.tsx');
    const setupContainerStart = swSrc.indexOf("(!stopwatchRunning && stopwatchElapsedMs === 0) || mobileSetupExpanded");
    const alwaysVisibleStart = swSrc.indexOf('Always-Visible Compact View Switcher & Tools Bar');
    expect(setupContainerStart).toBeGreaterThan(-1);
    expect(alwaysVisibleStart).toBeGreaterThan(setupContainerStart);

    const collapsedSection = swSrc.slice(setupContainerStart, alwaysVisibleStart);
    expect(collapsedSection).not.toContain('stopwatch-view-cards');
    expect(collapsedSection).not.toContain('stopwatch-view-matrix');
    expect(collapsedSection).not.toContain('stopwatch-tools-btn');

    const alwaysVisibleSection = swSrc.slice(alwaysVisibleStart, swSrc.indexOf('{showToolsDrawer &&'));
    expect(alwaysVisibleSection).toContain('stopwatch-view-cards');
    expect(alwaysVisibleSection).toContain('stopwatch-view-matrix');
    expect(alwaysVisibleSection).toContain('stopwatch-tools-btn');
    expect(swSrc).toContain('stopwatch-gun-btn');
    expect(swSrc).toContain('isFloatingFocusMode={false}');
    expect(swSrc).not.toContain('stopwatch-focus-mode-toggle');
  });

  it('cleans /brand Studio typography, filter pills, borders, copy, and Readiness Pill token docs', () => {
    const brandPage = readRel('src/components/BrandGuidePage.tsx');
    const interactive = readRel('src/components/BrandSystemInteractiveSections.tsx');

    expect(brandPage).not.toContain('font-display');
    expect(brandPage).not.toContain('17 SVGs');
    expect(brandPage).toContain('23 SVGs');
    expect(brandPage).not.toContain('ap-nav-volt-active');
    expect(brandPage).not.toContain('#244331');
    expect(brandPage).not.toMatch(/\bemerald-|\blime-/);

    expect(interactive).not.toContain('font-display');
    expect(interactive).not.toContain('2-FONT SYSTEM');
    expect(interactive).toContain('3-FONT SYSTEM');
    expect(interactive).not.toContain('Pine green');
    expect(interactive).not.toMatch(/\bemerald-|\blime-/);

    expect(TYPOGRAPHY_HIERARCHY[0].className).toContain('font-display');
    const prime = READINESS_PILL_SPECS.find((p) => p.id === 'prime')!;
    const info = READINESS_PILL_SPECS.find((p) => p.id === 'info')!;
    const strained = READINESS_PILL_SPECS.find((p) => p.id === 'strained')!;
    expect(prime.lightColors).toBe('#E7F3EC bg / #1E4D36 ink');
    expect(prime.darkColors).toBe('35% Infield Pine / #86EFAC ink');
    expect(info.lightColors).toBe('#F2F0E9 bg / #121413 ink');
    expect(info.darkColors).toBe('8% Chalk / #F6F3EC ink');
    expect(strained.lightColors).toBe('#FDF0ED bg / #8F2A18 ink');
    expect(strained.darkColors).toBe('22% Mondo Clay / #F6B8AC ink');
  });

  it('migrates printable clipboards and PWA manifest to Mondo Clay / Track Asphalt / Archivo & JetBrains Mono', () => {
    const qrHelper = readRel('src/utils/teamQrHelper.ts');
    expect(qrHelper).not.toContain('#1C5436');
    expect(qrHelper).not.toContain('Plus Jakarta Sans');
    expect(qrHelper).toContain('Archivo');
    expect(qrHelper).toContain('JetBrains Mono');

    const pods = computeTeamVdotPacingPods({
      roster: [
        { id: 'a1', name: 'Runner One', thresholdPaceSecsPerKm: 205, vdotOverride: 64 },
        { id: 'a2', name: 'Runner Two', thresholdPaceSecsPerKm: 245, vdotOverride: 54 },
      ],
      intensity: 'REPETITION',
      repCount: 6,
      repDistanceMeters: 400,
      recoveryLabel: '90s jog',
    });
    const html = buildPrintablePodClipboardHtml({
      workoutTitle: '6x400m Economy',
      dateStr: '2026-04-12',
      repDistanceMeters: 400,
      repCount: 6,
      recoveryLabel: '90s jog',
      pods,
      teamName: 'Oak Creek XC',
    });
    expect(html).toContain('#B83A24');
    expect(html).toContain('#121413');
    expect(html).toContain('#F6F3EC');
    expect(html).toContain('#EDE9DF');
    expect(html).toContain('@page { size: landscape');
    expect(html).toContain('.pod-grid');
    expect(html).toContain('Pursuit');
    expect(html).toContain('1600m');

    const viteCfg = readRel('vite.config.ts');
    expect(viteCfg).toContain("theme_color: '#121413'");
    expect(viteCfg).toContain("background_color: '#121413'");
    expect(viteCfg).toContain('|tee|go');
  });

  it('hardens CoachOnboardingWizard, TeamManagementPanel, Strava Step 2 CTA, and Willow Glen demo squad', () => {
    const wizard = readRel('src/components/coach/CoachOnboardingWizard.tsx');
    expect(wizard).toContain('useModalDialog');
    expect(wizard).toContain('aria-labelledby');
    expect(wizard).toContain('max-h-[92dvh] overflow-y-auto');
    expect(wizard).toContain('#B83A24');
    expect(wizard).toContain('#D8FF2A');
    expect(wizard).not.toContain('#1E5631');
    expect(wizard).not.toContain('Sparkles');
    expect(wizard).toContain('eventGroups: selectedGroups');
    expect(wizard).not.toContain('buildDemoTeam');
    expect(wizard).toContain('wizard-retry-btn');

    const coachView = readRel('src/components/CoachWorkspaceView.tsx');
    expect(coachView).toContain('setOpenCreateTeamOnSwitch(false);');
    expect(coachView).toContain('initialShowCreateStudio={openCreateTeamOnSwitch}');

    const teamPanel = readRel('src/components/TeamManagementPanel.tsx');
    expect(teamPanel.split('\n').length).toBeLessThanOrEqual(2500);
    expect(teamPanel).toContain('getStoredCoachAttribution');
    expect(teamPanel).toContain('attribution: getStoredCoachAttribution()');
    expect(teamPanel).toContain("useState('#B83A24')");

    const step2 = readRel('src/components/auth/AuthOnboardingStepTwo.tsx');
    expect(step2).toContain('ap-btn-strava min-h-[48px]');
    expect(step2).toContain('Connect with Strava');
    expect(step2).not.toContain('<span>Connect Strava</span>');

    const squad = buildSampleDemoCoachSquad('2026-04-12');
    expect(squad.brand.primaryHex).toBe('#B83A24');
    expect(squad.brand.secondaryHex).toBe('#D8FF2A');
    expect(squad.brand.name).toBe('Willow Glen High School XC');
    expect(squad.brand.shortName).toBe('WGHS XC');
    expect(squad.brand.coachDisplayName).toBe('Coach Morales');
    const athletes = squad.memberships.filter((m) => m.role === 'ATHLETE');
    expect(athletes).toHaveLength(12);
    expect(athletes.some((a) => a.invitedName === 'Maya Chen')).toBe(true);
    expect(squad.fieldMarkLogs?.map((f) => f.eventCode)).toEqual(['LJ', 'HJ', 'PV', 'SP']);
    expect((squad.announcements || []).length).toBeGreaterThanOrEqual(2);
  });

  it('verifies teamPalette defaults and >= 4.5 WCAG AA contrast across light & dark surfaces', () => {
    expect(normalizeHexColor('')).toBe('#B83A24');
    const lightSurfaces = ['#FFFFFF', '#F6F3EC', '#E9EFE9'];
    const darkSurfaces = ['#1A1D1B', '#15231B', '#121419'];

    for (const [rawA, rawB] of [
      ['', ''],
      ['#B83A24', '#D8FF2A'],
      ['#FACC15', '#38BDF8'],
      ['#121413', '#F6F3EC'],
    ] as const) {
      const pal = computeAccessibleTeamPalette(rawA, rawB);
      for (const s of lightSurfaces) {
        expect(contrastRatio(pal.primaryOnLight, s)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(pal.secondaryOnLight, s)).toBeGreaterThanOrEqual(4.5);
      }
      for (const s of darkSurfaces) {
        expect(contrastRatio(pal.primaryOnDark, s)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(pal.secondaryOnDark, s)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
