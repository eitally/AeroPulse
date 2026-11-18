import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveShortNameFromTeamName } from '../src/components/TeamManagementPanel';

function walkFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('Coach Onboarding Simplicity & Coach User Guide Contracts', () => {
  it('derives crisp header short names from school and club names without requiring manual input', () => {
    expect(deriveShortNameFromTeamName('Willow Glen High School')).toBe('WGHS');
    expect(deriveShortNameFromTeamName('Willow Glen High School XC')).toBe('WGHSXC');
    expect(deriveShortNameFromTeamName('WGHS XC')).toBe('WGHS XC');
    expect(deriveShortNameFromTeamName('Ultramarathoners')).toBe('ULTRAMARAT');
    expect(deriveShortNameFromTeamName('   ')).toBe('TEAM');
  });

  it('keeps AthleteRosterModal focused on 2 Connections & Privacy tabs while preserving key test contracts', () => {
    const modalSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/AthleteRosterModal.tsx'),
      'utf8'
    );

    expect(modalSource).toContain("type VisibleConnectionsTab = 'CONNECT_INVITE' | 'PRIVACY_SHIELD'");
    expect(modalSource).toContain("const order: VisibleConnectionsTab[] = ['CONNECT_INVITE', 'PRIVACY_SHIELD']");
    expect(modalSource).toContain('Open THRESH Coach Desk');
    expect(modalSource).toContain('data-testid="roster-open-stopwatch-btn"');
    expect(modalSource).toContain('Teammate (View Only)');
    expect(modalSource).toContain('Shield Active');
    expect(modalSource).toContain('onOpenCoachWorkspace');

    // Duplicated Team Creation / Coach Triage / VDOT Pods tabs must stay removed from the modal UI
    expect(modalSource).not.toContain("activeTab === 'TEAMS_BRANDING'");
    expect(modalSource).not.toContain("activeTab === 'SCHOLASTIC_COACH'");
    expect(modalSource).not.toContain("activeTab === 'TRACKSIDE_PAD'");
  });

  it('keeps advanced branding and safeguarding collapsed by default when creating a team', () => {
    const panelSource = fs.readFileSync(
      path.join(process.cwd(), 'src/components/TeamManagementPanel.tsx'),
      'utf8'
    );

    expect(panelSource).toContain(
      'const [showAdvancedBranding, setShowAdvancedBranding] = useState<boolean>(false);'
    );
    expect(panelSource).toContain('data-testid="team-toggle-advanced-branding"');
    expect(panelSource).toContain('aria-expanded={showAdvancedBranding}');
  });

  it('ships complete 5-chapter illustrated Coach User Guide with all 7 verified figures and zero forbidden filenames', () => {
    const coachDocPath = path.join(process.cwd(), 'public/docs/coach.html');
    expect(fs.existsSync(coachDocPath)).toBe(true);
    const coachHtml = fs.readFileSync(coachDocPath, 'utf8');

    for (const id of [
      'ch1-onboard',
      'ch2-safety',
      'ch3-workouts',
      'ch4-review',
      'ch5-integrations',
    ]) {
      expect(coachHtml).toContain(`id="${id}"`);
    }

    const expectedFigures = [
      'coach-fig-01-team-onboarding.png',
      'coach-fig-02-safety-squad-triage.png',
      'coach-fig-03-clipboard-workout-pods.png',
      'coach-fig-04-cohort-plan-builder.png',
      'coach-fig-05-trackside-stopwatch.png',
      'coach-fig-06-post-workout-pmc.png',
      'coach-fig-07-athleticnet-parent-hub.png',
    ];

    for (const fig of expectedFigures) {
      expect(coachHtml).toContain(`/docs/figures/${fig}`);
      const figOnDisk = path.join(process.cwd(), 'public/docs/figures', fig);
      expect(fs.existsSync(figOnDisk)).toBe(true);
      expect(fs.statSync(figOnDisk).size).toBeGreaterThan(10_000);
    }

    const allPublicFiles = walkFiles(path.join(process.cwd(), 'public'));
    const forbiddenMatches = allPublicFiles.filter((filePath) => /screenshot/i.test(filePath));
    expect(forbiddenMatches).toEqual([]);
  });
});
