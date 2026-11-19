import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deriveShortNameFromTeamName, TeamManagementPanel } from '../src/components/TeamManagementPanel';
import { AthleteRosterModal } from '../src/components/AthleteRosterModal';
import { buildSampleDemoDataset } from '../src/data/sampleDemoData';

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

  it('renders AthleteRosterModal with 2 focused Connections & Privacy tabs and zero duplicated Coach/Stopwatch tabs', () => {
    const demo = buildSampleDemoDataset('2026-11-19');
    const modalHtml = renderToStaticMarkup(
      React.createElement(AthleteRosterModal, {
        isOpen: true,
        onClose: () => {},
        selfName: 'Sample Athlete',
        selfInviteCode: 'THR-TEST',
        selfCtl: 54,
        selfAtl: 52,
        selfTsb: 2,
        selfHrv: 72,
        selfProfile: demo.athleteProfile,
        selfPrivacySettings: {
          sharePmcAndZones: 'ALL_CONNECTIONS',
          shareWellnessAndHrv: 'COACHES_ONLY',
          shareGpsRoutes: 'COACHES_ONLY',
          stravaComplianceShield: true,
          allowCoachCalendarEdits: true,
        },
        onUpdateSelfPrivacy: () => {},
        roster: [
          {
            id: 'ath-view',
            name: 'Jordan Pace',
            avatarInitials: 'JP',
            location: 'San Jose, CA',
            stravaAthleteId: '99123',
            inviteCode: 'THR-JP1',
            role: 'FRIEND_VIEW',
            status: 'CONNECTED',
            primaryGoalSummary: '5000m Track Build',
            primarySport: 'Running',
            athleteProfile: demo.athleteProfile,
            privacySettings: {
              sharePmcAndZones: 'ALL_CONNECTIONS',
              shareWellnessAndHrv: 'PRIVATE',
              shareGpsRoutes: 'PRIVATE',
              stravaComplianceShield: true,
              allowCoachCalendarEdits: false,
            },
            wellnessDays: [],
            activities: [],
            plannedEvents: [],
            targetGoals: [],
          },
        ],
        activeAthleteId: 'SELF',
        onSelectAthleteViewport: () => {},
        onApproveRequest: () => {},
        onRemoveOrDeclineAthlete: () => {},
        onToggleAthleteRole: () => {},
        onAddFollowByInviteOrName: () => {},
        onPushCoachWorkout: () => {},
        distanceUnit: 'mi',
        myTeams: [],
        onOpenCoachWorkspace: () => {},
        onOpenFullScreenStopwatch: () => {},
      })
    );

    expect(modalHtml).toContain('Open THRESH Coach Desk');
    expect(modalHtml).toContain('data-testid="roster-open-stopwatch-btn"');
    expect(modalHtml).toContain('Teammate (View Only)');
    expect(modalHtml).toContain('Connections (1)');
    expect(modalHtml).toContain('Privacy Shield');
    expect(modalHtml).not.toContain('Teams &amp; Branding');
    expect(modalHtml).not.toContain('Scholastic Coach');
    expect(modalHtml).not.toContain('Trackside Split Pad');

    const privacyHtml = renderToStaticMarkup(
      React.createElement(AthleteRosterModal, {
        isOpen: true,
        onClose: () => {},
        initialTab: 'PRIVACY_SHIELD',
        selfName: 'Sample Athlete',
        selfInviteCode: 'THR-TEST',
        selfCtl: 54,
        selfAtl: 52,
        selfTsb: 2,
        selfHrv: 72,
        selfProfile: demo.athleteProfile,
        selfPrivacySettings: {
          sharePmcAndZones: 'ALL_CONNECTIONS',
          shareWellnessAndHrv: 'COACHES_ONLY',
          shareGpsRoutes: 'COACHES_ONLY',
          stravaComplianceShield: true,
          allowCoachCalendarEdits: true,
        },
        onUpdateSelfPrivacy: () => {},
        roster: [],
        activeAthleteId: 'SELF',
        onSelectAthleteViewport: () => {},
        onApproveRequest: () => {},
        onRemoveOrDeclineAthlete: () => {},
        onToggleAthleteRole: () => {},
        onAddFollowByInviteOrName: () => {},
        onPushCoachWorkout: () => {},
        distanceUnit: 'mi',
        myTeams: [],
      })
    );
    expect(privacyHtml).toContain('Shield Active');
  });

  it('keeps advanced branding and safeguarding collapsed by default when opening team creation studio', () => {
    const panelHtml = renderToStaticMarkup(
      React.createElement(TeamManagementPanel, {
        selfName: 'Coach Morales',
        myTeams: [],
        activeTeamId: null,
        resendConfigured: false,
        initialShowCreateStudio: true,
        onSelectActiveTeam: () => {},
        onTeamsUpdated: () => {},
      })
    );

    expect(panelHtml).toContain('data-testid="team-studio-form"');
    expect(panelHtml).toContain('data-testid="team-toggle-advanced-branding"');
    expect(panelHtml).toMatch(/data-testid="team-toggle-advanced-branding"[^>]*aria-expanded="false"/);
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
      'coach-fig-01-team-onboarding.webp',
      'coach-fig-02-safety-squad-triage.webp',
      'coach-fig-03-clipboard-workout-pods.webp',
      'coach-fig-04-cohort-plan-builder.webp',
      'coach-fig-05-trackside-stopwatch.webp',
      'coach-fig-06-post-workout-pmc.webp',
      'coach-fig-07-athleticnet-parent-hub.webp',
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
